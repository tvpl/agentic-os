/**
 * What the dashboards' two presentations share (.specs/features/cerebro-paineis, S5): the route (`/dashboards` is the
 * first overview, `/dashboards/<id>` one dashboard), the list, the stored snapshot of the one on screen asked with the
 * time of the last visit (`?since=`, AC 45), the refresh that keeps the old values until `dashboard.refreshed` arrives
 * (AC 32), the first overview made on the first open (AC 30), the visit written back when it is left (amendment 28),
 * and the small maths of time and numbers the widgets read. The page (`DashboardsPage`) and the Núcleo's scene
 * (`DashboardsScene`) both draw from `useDashboardBoard`.
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type * as Contracts from "@mordomo/contracts";
import { ApiError } from "../api";
import { apiCall } from "../apiCall";
import { useT, type TKey } from "../i18n";
import { useOsUiPreferences, useRouteQuery, useSaveUiPreferences } from "../queries";
import { useOsEvent } from "../hooks/useEventStream";
import { useToast } from "../components/ui";
import { AppRouteContext } from "../desktop/appRoute";
import { errorMessage } from "../views/shared";

export type DashboardList = Contracts.ApiCallResult<"GET /api/dashboards">;
export type DashboardListItem = DashboardList["dashboards"][number];
export type DashboardRead = Contracts.ApiCallResult<"GET /api/dashboards/:id">;
export type Definition = DashboardRead["definition"];
export type DefWidget = Definition["widgets"][number];
export type Snapshot = NonNullable<DashboardRead["snapshot"]>;
export type SnapWidget = Snapshot["widgets"][number];
export type SnapSource = Snapshot["sources"][number];
export type Highlight = DashboardRead["highlights"][number];
export type Row = Record<string, unknown>;

export const DASH_PATH = "/dashboards";
const LIST_KEY = ["dashboards", "list"] as const;
const oneKey = (id: string, since: number | null) => ["dashboards", "one", id, since] as const;

/* ---- time and numbers ----------------------------------------------------------------------------------------- */

const pad = (n: number) => String(n).padStart(2, "0");
/** `HH:MM` in local time, 24 hours. */
export const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** The local day `AAAA-MM-DD` of an instant. */
export const localDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const dayDate = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};
/** Whole local days from `from` to `to` (both `AAAA-MM-DD`), by calendar, not by 24-hour steps. */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.UTC(...ymd(to)) - Date.UTC(...ymd(from))) / 86_400_000);
const ymd = (day: string): [number, number, number] => {
  const d = dayDate(day);
  return [d.getFullYear(), d.getMonth(), d.getDate()];
};
export const shortDate = (day: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(dayDate(day));

/** The greeting of the local hour (design.md "Página"): 05:00-11:59, 12:00-17:59, then the evening. */
export function greetingKey(hour: number): TKey {
  if (hour >= 5 && hour < 12) return "dash.greet.morning";
  if (hour >= 12 && hour < 18) return "dash.greet.afternoon";
  return "dash.greet.evening";
}

/** A KPI's value: grouped below ten thousand ("1.284"), compact above ("12,9 mil"). */
export function compactNumber(n: number, locale: string): string {
  if (Math.abs(n) < 10_000) return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n);
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** The reading of a record's field, as text, or null. */
export const text = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : null;
export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
export const rows = (v: unknown): Row[] =>
  Array.isArray(v) ? v.filter((r): r is Row => typeof r === "object" && r !== null) : [];

/* ---- navigation ------------------------------------------------------------------------------------------------ */

/** Where the dashboards are: the panel's own path inside a lâmina, the router's otherwise. */
export function useDashRoute() {
  const panel = useContext(AppRouteContext);
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = panel?.pathname ?? location.pathname;
  const m = /^\/dashboards\/([^/?#]+)/.exec(pathname);
  const id = m ? decodeURIComponent(m[1]!) : null;
  const show = useCallback(
    (next: string | null) => {
      const to = next === null ? DASH_PATH : `${DASH_PATH}/${encodeURIComponent(next)}`;
      if (panel) panel.setLocation({ pathname: to, search: "" });
      else navigate(to);
    },
    [panel, navigate],
  );
  return { id, show };
}

/** Open what an item names: a path of the app (`/brain?sel=…`) in the app, an address outside it in a new tab. */
export function useOpen() {
  const navigate = useNavigate();
  return useCallback(
    (target: string) => {
      if (/^https?:\/\//i.test(target)) window.open(target, "_blank", "noopener");
      else navigate(target);
    },
    [navigate],
  );
}

/* ---- the board ------------------------------------------------------------------------------------------------- */

export type CreateInput =
  | { template: "overview" }
  | { template: "area"; contextId: string }
  | {
      template: "question";
      question: string;
    };

export function useDashboardBoard() {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const route = useDashRoute();
  const savePrefs = useSaveUiPreferences();

  const list = useRouteQuery(LIST_KEY, "GET /api/dashboards", undefined, { retry: false });
  const prefs = useOsUiPreferences({ retry: false });
  const unauthorised =
    list.error instanceof ApiError && list.error.status === 403 && list.error.code !== "forbidden_path";
  const dashboards = useMemo(() => list.data?.dashboards ?? [], [list.data]);
  const currentId =
    route.id !== null && dashboards.some((d) => d.id === route.id)
      ? route.id
      : ((dashboards.find((d) => d.kind === "overview") ?? dashboards[0])?.id ?? null);
  const current = dashboards.find((d) => d.id === currentId) ?? null;

  /* the visit: `since` is read once per opening; leaving writes it (with every other entry) */
  const stored = prefs.data?.dashboards?.lastViewed;
  const mine = useRef<Record<string, number>>({});
  const lastViewed = useRef<Record<string, number>>({});
  lastViewed.current = { ...(stored ?? {}), ...mine.current };
  const prefsReady = prefs.isSuccess || prefs.isError;
  const [view, setView] = useState<{ id: string; since: number | null } | null>(null);
  useEffect(() => {
    if (!prefsReady || currentId === null || view?.id === currentId) return;
    setView({ id: currentId, since: lastViewed.current[currentId] ?? null });
  }, [prefsReady, currentId, view?.id]);
  const viewId = view?.id ?? null;
  useEffect(() => {
    if (viewId === null) return;
    return () => {
      mine.current = { ...mine.current, [viewId]: Date.now() };
      const next = { ...lastViewed.current, ...mine.current };
      void savePrefs({ dashboards: { lastViewed: next } }).catch(() => undefined);
    };
  }, [viewId, savePrefs]);

  const one = useRouteQuery(
    oneKey(view?.id ?? "", view?.since ?? null),
    "GET /api/dashboards/:id",
    { params: { id: view?.id ?? "" }, query: view?.since != null ? { since: view.since } : {} },
    { enabled: view !== null && view.id === currentId, staleTime: 60_000, retry: false },
  );

  /* the refresh: the values on screen stay until the stream says this dashboard was refreshed (AC 32) */
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const refresh = useCallback(
    async (id: string) => {
      setRefreshing(id);
      try {
        const answer = await apiCall("POST /api/dashboards/:id/refresh", { params: { id } });
        if ("snapshot" in answer) {
          let shown = false;
          qc.setQueriesData<DashboardRead>({ queryKey: ["dashboards", "one", id] }, (old) => {
            if (!old || old.snapshot !== null) return old;
            shown = true;
            return { ...old, snapshot: answer.snapshot, stale: false };
          });
          // Nothing was on screen: the new snapshot is shown at once, there are no old values to keep.
          if (shown) setRefreshing((r) => (r === id ? null : r));
        }
      } catch (err) {
        if (err instanceof ApiError && err.code === "refresh_in_progress") return;
        setRefreshing((r) => (r === id ? null : r));
        toast(errorMessage(err, t), "danger");
      }
    },
    [qc, t, toast],
  );
  useOsEvent("dashboard.refreshed", (event) => {
    const id = (event.payload as { id?: unknown } | undefined)?.id;
    if (typeof id !== "string") return;
    void qc.invalidateQueries({ queryKey: ["dashboards", "one", id] });
    void qc.invalidateQueries({ queryKey: LIST_KEY });
    setRefreshing((r) => (r === id ? null : r));
  });

  /* creating: the template, then its first refresh; the first open with no dashboard makes the overview */
  const create = useCallback(
    async (input: CreateInput) => {
      const made = await apiCall("POST /api/dashboards", { body: input });
      const item: DashboardListItem = {
        id: made.id,
        title: made.definition.title,
        kind: made.definition.kind,
        contextId: made.definition.contextId ?? null,
        refresh: made.definition.refresh,
        generatedAt: null,
        stale: false,
      };
      qc.setQueryData<DashboardList>(LIST_KEY, (old) =>
        old ? { ...old, dashboards: [...old.dashboards.filter((d) => d.id !== made.id), item] } : old,
      );
      const read: DashboardRead = {
        definition: made.definition,
        version: made.version,
        snapshot: null,
        stale: false,
        highlights: [],
      };
      qc.setQueryData(oneKey(made.id, lastViewed.current[made.id] ?? null), read);
      route.show(made.id);
      await refresh(made.id);
      return made.id;
    },
    [qc, route, refresh],
  );
  const made = useRef(false);
  useEffect(() => {
    if (!list.isSuccess || list.data.dashboards.length > 0 || made.current) return;
    made.current = true;
    create({ template: "overview" }).catch((err: unknown) => toast(errorMessage(err, t), "danger"));
  }, [list.isSuccess, list.data, create, toast, t]);

  const reload = useCallback(() => {
    if (currentId) void qc.invalidateQueries({ queryKey: ["dashboards", "one", currentId] });
  }, [qc, currentId]);
  const forget = useCallback(
    async (id: string) => {
      await apiCall("DELETE /api/dashboards/:id", { params: { id } });
      const left = dashboards.filter((d) => d.id !== id);
      qc.setQueryData<DashboardList>(LIST_KEY, (old) => (old ? { ...old, dashboards: left } : old));
      qc.removeQueries({ queryKey: ["dashboards", "one", id] });
      route.show(left[0]?.id ?? null);
    },
    [qc, dashboards, route],
  );

  return {
    list,
    dashboards,
    unauthorised,
    currentId,
    current,
    data: one.data && view?.id === currentId ? one.data : undefined,
    one,
    refreshing: refreshing !== null && refreshing === currentId,
    refresh,
    create,
    reload,
    forget,
    show: route.show,
  };
}
