/**
 * Reading, clamping and persisting the desktop's window layout (redesign F4a).
 *
 * Ported from the grid's `useLayoutState`: the debounce, the optimistic
 * commit, the conflict handshake and the config mirror are unchanged — only
 * the geometry moved from grid cells to stage pixels. The one new rule is
 * that a stage resize clamps but never persists: shrinking the app window
 * must not silently rewrite the arrangement made on a larger screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, getToken, type SettingsDoc } from "../api";
import { qk } from "../queries";
import { minFor, normalizeWindows } from "./defaultWindows";
import { clampLayout, layoutsEqual, type Size, type WindowMap } from "./windowModel";
import { shouldStack } from "./defaultLayout";

export interface StageMetrics extends Size {
  /** Narrow viewport: windows collapse into one scrollable column. */
  stacked: boolean;
}

/**
 * The stage's own box, measured from its element. Memoized on the numbers so
 * a consumer that reports it upward does not feed a parent → child → effect
 * → parent loop on every render.
 */
export function useStageSize(ref: React.RefObject<HTMLElement>): StageMetrics {
  const [size, setSize] = useState({ w: 1200, h: 700 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setSize((prev) =>
        prev.w === el.clientWidth && prev.h === el.clientHeight
          ? prev
          : { w: el.clientWidth, h: el.clientHeight },
      );
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  const stacked = shouldStack(window.innerWidth, window.innerHeight);
  return useMemo(() => ({ w: size.w, h: size.h, stacked }), [size.w, size.h, stacked]);
}

const PERSIST_DEBOUNCE_MS = 300;
const CONFIG_MIRROR_KEY = "mordomo.desktop.widgetConfig";

/**
 * Per-widget `config` mirrored in localStorage: the server settings schema
 * may not carry `config` yet (it strips unknown keys), so the mirror keeps
 * user choices alive until it does. Server wins when present.
 */
function readConfigMirror(): Record<string, Record<string, unknown>> {
  try {
    const raw = localStorage.getItem(CONFIG_MIRROR_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Record<string, unknown>>) : {};
  } catch {
    return {};
  }
}
function writeConfigMirror(layout: WindowMap) {
  try {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [id, box] of Object.entries(layout)) if (box.config) out[id] = box.config;
    localStorage.setItem(CONFIG_MIRROR_KEY, JSON.stringify(out));
  } catch {
    /* ignore */
  }
}
/**
 * A layout that was still waiting for its debounced save when the page went
 * away (a reload right after a drag or a deep link). Parked here so the next
 * boot shows it at once — the keepalive save may land after the boot's GET —
 * and re-sends it.
 */
const PENDING_KEY = "mordomo.desktop.pendingLayout.v1";
const PENDING_MAX_AGE_MS = 30_000;
function parkPendingLayout(layout: WindowMap) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ at: Date.now(), layout }));
  } catch {
    /* ignore */
  }
}
function takePendingLayout(): WindowMap | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_KEY);
    const parsed = JSON.parse(raw) as { at?: number; layout?: WindowMap };
    if (!parsed.layout || typeof parsed.at !== "number" || Date.now() - parsed.at > PENDING_MAX_AGE_MS)
      return null;
    return parsed.layout;
  } catch {
    return null;
  }
}

function mergeMirror(layout: WindowMap): WindowMap {
  const mirror = readConfigMirror();
  let changed = false;
  const out: WindowMap = { ...layout };
  for (const [id, cfg] of Object.entries(mirror)) {
    const box = out[id];
    if (box && !box.config) {
      out[id] = { ...box, config: cfg };
      changed = true;
    }
  }
  return changed ? out : layout;
}

export interface WindowLayoutState {
  layout: WindowMap;
  /** Apply a new layout locally and persist it (debounced). */
  /** Replace the layout, or derive it from the latest committed one (`prev`): two
   *  commits in one tick — a form closing while its run opens — must not
   *  overwrite each other from the same stale render. */
  commit: (next: WindowMap | ((prev: WindowMap) => WindowMap)) => void;
  /** The latest committed or adopted layout — what a commit in this tick builds on. */
  latest: () => WindowMap;
  saving: boolean;
  /** Local changes not yet confirmed by the server. */
  dirty: boolean;
  conflict: boolean;
  resolveConflict: (keepLocal: boolean) => Promise<void>;
}

export function useWindowLayout({
  serverLayout,
  stage,
  spaceId,
  onError,
}: {
  serverLayout: Partial<Record<string, Partial<WindowMap[string]>>> | undefined;
  stage: Size;
  /**
   * The space the layout belongs to. A switch replaces the whole arrangement,
   * so the server's layout is adopted even when local edits are still in
   * flight — otherwise the desktop would keep showing the space you left.
   */
  spaceId?: string;
  onError: (err: Error) => void;
}): WindowLayoutState {
  const qc = useQueryClient();
  const [layout, setLayout] = useState<WindowMap>(() => mergeMirror(normalizeWindows(serverLayout, stage)));
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const baseRef = useRef(serverLayout ?? {});
  const latestRef = useRef(layout);
  const timerRef = useRef<number>();
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const mutation = useMutation({
    scope: { id: "desktop-layout" },
    mutationFn: (next: WindowMap) =>
      api.put<{ settings: SettingsDoc }>("/api/settings", {
        dashboardLayout: next,
        dashboardLayoutBase: baseRef.current,
      }),
    onSuccess: (data, vars) => {
      baseRef.current = data.settings?.dashboardLayout ?? vars;
      setConflict(false);
      // The response is the document the server now holds: put it in the
      // cache *before* `dirty` clears. Otherwise the adoption effect below
      // runs against the previous fetch and, for one refetch, hands the
      // desktop a layout that is one edit behind — harmless when a layout
      // was only geometry, fatal now that a panel's config carries live app
      // state (the brain read its selection as "gone", then as "new").
      if (data.settings) qc.setQueryData(qk.settings, data.settings);
      if (vars === latestRef.current) setDirty(false);
      qc.invalidateQueries({ queryKey: qk.settings }).catch(() => undefined);
    },
    onError: (err: Error) => {
      if (err instanceof ApiError && err.code === "layout_conflict") setConflict(true);
      else onErrorRef.current(err);
    },
  });
  const { mutate, isPending } = mutation;

  // A space switch adopts unconditionally: it is not a competing edit, it is
  // a different desktop.
  const spaceRef = useRef(spaceId);
  useEffect(() => {
    if (spaceId === spaceRef.current) return;
    spaceRef.current = spaceId;
    setDirty(false);
    setLayout(normalizeWindows(serverLayout, stage));
  }, [spaceId, serverLayout, stage]);

  // Adopt the server layout only when idle: nothing pending, nothing dirty.
  useEffect(() => {
    if (isPending || dirty || !serverLayout) return;
    baseRef.current = serverLayout;
    const next = mergeMirror(normalizeWindows(serverLayout, stage));
    setLayout((prev) => (layoutsEqual(prev, next) ? prev : next));
    // A commit in this same tick (a deep link opening its panel the moment
    // the stored layout arrives) must build on what was just adopted, not on
    // the defaults the desktop booted with — or the stored panels are lost.
    latestRef.current = next;
  }, [serverLayout, stage, isPending, dirty]);

  // The stage changed size: pull the windows back into view. Not a user
  // edit, so it is never persisted — resizing the app must not rewrite the
  // layout the user arranged on a bigger screen.
  useEffect(() => {
    setLayout((prev) => {
      const next = clampLayout(prev, stage, minFor);
      return layoutsEqual(prev, next) ? prev : next;
    });
  }, [stage]);

  useEffect(() => {
    latestRef.current = layout;
  }, [layout]);

  const commit = useCallback(
    (update: WindowMap | ((prev: WindowMap) => WindowMap)) => {
      const next = typeof update === "function" ? update(latestRef.current) : update;
      latestRef.current = next;
      setLayout(next);
      setDirty(true);
      writeConfigMirror(next);
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = undefined;
        mutate(next);
      }, PERSIST_DEBOUNCE_MS);
    },
    [mutate],
  );

  // Flush a pending save on unmount (navigating away right after a drag).
  useEffect(
    () => () => {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
        timerRef.current = undefined;
        mutate(latestRef.current);
      }
    },
    [mutate],
  );
  // …and on a reload or a closed tab, where an ordinary fetch is cut off with
  // the page: a `keepalive` request outlives the document, so a panel opened
  // a moment before the reload is still there afterwards.
  useEffect(() => {
    const onHide = () => {
      if (timerRef.current === undefined) return;
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
      try {
        void fetch("/api/settings", {
          method: "PUT",
          keepalive: true,
          headers: { "content-type": "application/json", "x-mordomo-token": getToken() },
          body: JSON.stringify({ dashboardLayout: latestRef.current, dashboardLayoutBase: baseRef.current }),
        });
      } catch {
        /* the page is going away; nothing to report to */
      }
      parkPendingLayout(latestRef.current);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);
  // The previous page left a layout that never reached the server: show it
  // now and send it, instead of the stale one the boot's GET brought back.
  useEffect(() => {
    const pending = takePendingLayout();
    if (!pending) return;
    commit(normalizeWindows(pending, stage));
    // Once, at boot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolveConflict = async (keepLocal: boolean) => {
    try {
      const current = await api.get<SettingsDoc>("/api/settings");
      baseRef.current = current.dashboardLayout;
      qc.setQueryData(qk.settings, current);
      if (keepLocal) mutate(latestRef.current);
      else {
        window.clearTimeout(timerRef.current);
        timerRef.current = undefined;
        const next = mergeMirror(normalizeWindows(current.dashboardLayout, stage));
        latestRef.current = next;
        setLayout(next);
        setDirty(false);
        setConflict(false);
      }
    } catch (error) {
      onErrorRef.current(error as Error);
    }
  };
  const latest = useCallback(() => latestRef.current, []);
  return { layout, commit, latest, saving: isPending, dirty, conflict, resolveConflict };
}
