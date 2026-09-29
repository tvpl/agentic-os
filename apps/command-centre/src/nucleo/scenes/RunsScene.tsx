/**
 * The Runs scene (immersive shell): a river of time instead of a table.
 *
 * Up top, the window in words ("Last 24 h") and its counts in type — each
 * count is also the status filter. Below, the river: one lane per origin,
 * each run a capsule placed by when it started and as long as it took,
 * "now" a cyan line on the right edge, live runs pulsing and growing. Pick
 * one (click, arrows + Enter, or a `/runs/:id` link) and its trace unfolds
 * in place underneath; "Full detail" slides the complete run view in from
 * the right. The list view is the same runs, one per line.
 *
 * State that is a place lives in the URL: the run in the path, the range,
 * status, lane, view and the detail sheet in the query — so a link, a
 * reload and the Back button all land where you were.
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import { useLocale, useT } from "../../i18n";
import { useOsProviders } from "../../queries";
import { ErrorBox } from "../../components/ui";
import { AppRouteContext, usePanelParams, usePanelSearchParams } from "../../desktop/appRoute";
import { useTicker } from "../../desktop/data";
import { useApprovals } from "../../runs/ApprovalCards";
import { formatTokens, formatUsd, totalTokens } from "../../runs/usage";
import { getLaminas, project } from "../projections";
import type { SceneViewProps } from "../sceneViews";
import {
  LANE_ORDER,
  RANGE_IDS,
  RANGE_MS,
  countRuns,
  filterRuns,
  inWindow,
  isLaneId,
  isRangeId,
  isStatusFilter,
  laneOf,
  pickRange,
  runEnd,
  runLabel,
  runStart,
  toneOf,
  type LaneId,
  type RangeId,
  type RiverItem,
  type StatusFilter,
} from "./runsRiver";
import { formatSpan } from "./runsFormat";
import { useRiverRuns } from "./runsData";
import RunsRiver from "./RunsSceneRiver";
import RunsTrace from "./RunsSceneTrace";
import RunsList from "./RunsSceneList";
import RunsSheet from "./RunsSceneSheet";
import "./runsScene.css";

const COUNT_FILTERS: ReadonlyArray<{ key: "done" | "failed" | "cancelled" | "live"; filter: StatusFilter }> =
  [
    { key: "done", filter: "done" },
    { key: "failed", filter: "failed" },
    { key: "cancelled", filter: "cancelled" },
    { key: "live", filter: "live" },
  ];

export default function RunsScene(_props: SceneViewProps) {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const route = useContext(AppRouteContext);
  const { id: rawId } = usePanelParams<"id">("/runs/:id");
  const selectedId = rawId ? decodeURIComponent(rawId) : null;
  const [params, setParams] = usePanelSearchParams();

  /* ---- where we are: path + query ------------------------------------------ */
  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params);
      if (value === null) next.delete(key);
      else next.set(key, value);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );
  const goTo = useCallback(
    (pathname: string) => {
      if (route) route.setLocation({ pathname });
      else navigate({ pathname, search: params.toString() ? `?${params}` : "" });
    },
    [route, navigate, params],
  );
  const select = useCallback(
    (id: string | null) => goTo(id && id !== selectedId ? `/runs/${encodeURIComponent(id)}` : "/runs"),
    [goTo, selectedId],
  );

  const rangeParam = params.get("range");
  const statusParam = params.get("status");
  const laneParam = params.get("lane");
  const status: StatusFilter = isStatusFilter(statusParam) ? statusParam : "all";
  const lane: LaneId | null = isLaneId(laneParam) ? laneParam : null;
  const view = params.get("view") === "list" ? "list" : "river";
  const detailOpen = params.get("detail") === "1" && selectedId !== null;
  const provider = params.get("provider");
  const [query, setQuery] = useState("");
  const [zoom, setZoom] = useState<{ from: number; to: number } | null>(null);
  // A new range (the switch, a link, Back) is a new window: the zoom was into the old one.
  useEffect(() => setZoom(null), [rangeParam]);
  const [asc, setAsc] = useState(false);
  const [older, setOlder] = useState(false);

  /* ---- data ------------------------------------------------------------------ */
  const providers = useOsProviders();
  const approvals = useApprovals();
  const pendingApprovals = (approvals.data ?? []).filter((a) => a.status === "pending").length;
  const [autoRange, setAutoRange] = useState<RangeId | null>(null);
  const range: RangeId = isRangeId(rangeParam) ? rangeParam : (autoRange ?? "24h");
  const [liveNow, setLiveNow] = useState(false);
  const now = useTicker(liveNow ? 5_000 : 60_000);
  const since = zoom?.from ?? now - RANGE_MS[range];
  const until = zoom?.to ?? now;
  const data = useRiverRuns(zoom ? zoom.from : now - RANGE_MS[range], provider);
  const runs = data.runs;
  useEffect(() => {
    if (!autoRange && data.isSuccess) setAutoRange(pickRange(runs, Date.now()));
  }, [autoRange, data.isSuccess, runs]);
  const anyLive = runs.some((r) => ["live", "wait"].includes(toneOf(r.status)));
  useEffect(() => setLiveNow(anyLive), [anyLive]);

  const windowed = useMemo(() => inWindow(runs, since, until), [runs, since, until]);
  const laneAndQuery = useMemo(
    () => filterRuns(windowed, { status: "all", lane, query }),
    [windowed, lane, query],
  );
  const shown = useMemo(
    () => filterRuns(laneAndQuery, { status, lane: null, query: "" }),
    [laneAndQuery, status],
  );
  const counts = useMemo(() => countRuns(laneAndQuery), [laneAndQuery]);
  const lanes = useMemo(() => {
    const present = new Set(filterRuns(windowed, { status: "all", lane: null, query }).map((r) => laneOf(r)));
    return LANE_ORDER.filter((l) => present.has(l) && (!lane || l === lane));
  }, [windowed, query, lane]);
  const laneCounts = useMemo(() => {
    const out: Partial<Record<LaneId, number>> = {};
    for (const r of shown) out[laneOf(r)] = (out[laneOf(r)] ?? 0) + 1;
    return out;
  }, [shown]);
  const items = useMemo<RiverItem[]>(
    () =>
      shown.map((r) => ({
        id: r.id,
        lane: laneOf(r),
        start: runStart(r),
        end: runEnd(r, until),
        tone: toneOf(r.status),
        label: runLabel(r, 34),
      })),
    [shown, until],
  );
  const spend = useMemo(() => {
    let tokens = 0;
    let cost = 0;
    for (const r of shown) {
      if (!r.usage) continue;
      tokens += totalTokens(r.usage);
      cost += r.usage.costUsd ?? 0;
    }
    return { tokens, cost };
  }, [shown]);
  const listRuns = useMemo(
    () => (older ? filterRuns(runs, { status, lane, query }) : shown),
    [older, runs, status, lane, query, shown],
  );

  const statusWord = useCallback(
    (s: string) => {
      if (s === "timed_out") return t("scene.runs.status.timedOut");
      const key = `status.${s}` as Parameters<typeof t>[0];
      const w = t(key);
      return w === key ? s.replace(/_/g, " ") : w;
    },
    [t],
  );
  const byId = useMemo(() => new Map(runs.map((r) => [r.id, r])), [runs]);
  const statusOfId = useCallback((id: string) => statusWord(byId.get(id)?.status ?? ""), [byId, statusWord]);

  /* ---- the trace and the sheet -------------------------------------------------- */
  const traceRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectedId) return;
    // Bring the head of the trace into view, no further: the river stays on screen when it can.
    const id = window.setTimeout(() => {
      const trace = traceRef.current;
      const scroller = scrollRef.current;
      if (!trace || !scroller) return;
      const below = trace.getBoundingClientRect().top + 180 - scroller.getBoundingClientRect().bottom;
      if (below <= 0) return;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      scroller.scrollBy({ top: below, behavior: reduce ? "auto" : "smooth" });
    }, 120);
    return () => window.clearTimeout(id);
  }, [selectedId]);
  const closeDetail = useCallback(() => {
    setParam("detail", null);
    window.setTimeout(() => document.querySelector<HTMLElement>("[data-detail-trigger]")?.focus(), 0);
  }, [setParam]);

  // Escape steps back one thing at a time — the sheet, then the trace, then the zoom — and only
  // then lets the shell go home. A lâmina that is up goes first (the shell's own Escape).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || getLaminas().length > 0) return;
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest('[role="dialog"]')) return;
      if (el instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (detailOpen) {
        e.preventDefault();
        closeDetail();
      } else if (selectedId) {
        e.preventDefault();
        select(null);
      } else if (zoom) {
        e.preventDefault();
        setZoom(null);
      }
    };
    // Capture, so this runs before the app's own Escape ("go home"), whatever order they mounted in.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [detailOpen, selectedId, zoom, closeDetail, select]);

  const filtered = status !== "all" || lane !== null || query.trim() !== "";
  const selectedInWindow = selectedId ? shown.some((r) => r.id === selectedId) : true;

  /* ---- render ---------------------------------------------------------------------- */
  const head = (
    <header className="rs-head">
      <div className="rs-head-main">
        <h2 className="rs-title">
          {zoom ? formatSpan(zoom.from, zoom.to, now, locale) : t(`scene.runs.range.${range}`)}
        </h2>
        <div className="rs-counts" role="group" aria-label={t("scene.runs.count.group")}>
          {COUNT_FILTERS.map(({ key, filter }) => {
            const n = counts[key];
            const on = status === filter;
            return (
              <button
                key={key}
                type="button"
                className="rs-count"
                data-k={key}
                data-zero={n === 0 || undefined}
                aria-pressed={on}
                title={
                  on
                    ? t("scene.runs.count.filterOn", { what: t(`scene.runs.count.${key}`, { n }) })
                    : undefined
                }
                onClick={() => setParam("status", on ? null : filter)}
              >
                <b className="tnum">{n}</b> {t(`scene.runs.count.${key}`, { n })}
              </button>
            );
          })}
        </div>
      </div>
      <div className="rs-tools">
        <div className="rs-seg" role="group" aria-label={t("scene.runs.range.group")}>
          {RANGE_IDS.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={!zoom && r === range}
              onClick={() => {
                setZoom(null);
                setParam("range", r);
              }}
            >
              {t(`scene.runs.range.short.${r}`)}
            </button>
          ))}
        </div>
        <label className="rs-search">
          <Search aria-hidden />
          <input
            type="search"
            value={query}
            placeholder={t("scene.runs.searchPh")}
            aria-label={t("scene.runs.search")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.preventDefault();
                setQuery("");
              }
            }}
          />
        </label>
        {(providers.data?.length ?? 0) > 1 && (
          <select
            className="rs-select"
            value={provider ?? "all"}
            aria-label={t("runs.provider")}
            onChange={(e) => setParam("provider", e.target.value === "all" ? null : e.target.value)}
          >
            <option value="all">{t("scene.runs.provider.all")}</option>
            {(providers.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.id}
              </option>
            ))}
          </select>
        )}
        <div className="rs-seg" role="group" aria-label={t("scene.runs.view.group")}>
          <button type="button" aria-pressed={view === "river"} onClick={() => setParam("view", null)}>
            {t("scene.runs.view.river")}
          </button>
          <button type="button" aria-pressed={view === "list"} onClick={() => setParam("view", "list")}>
            {t("scene.runs.view.list")}
          </button>
        </div>
      </div>
      <p className="rs-sub mono">
        {spend.tokens > 0 && (
          <span>
            {t("scene.runs.spend", { tokens: formatTokens(spend.tokens), cost: formatUsd(spend.cost) })}
          </span>
        )}
        {pendingApprovals > 0 && (
          <button type="button" className="rs-link warn" onClick={() => project("approvals")}>
            {t("scene.runs.approvals", { n: pendingApprovals })}
          </button>
        )}
        {zoom && (
          <button type="button" className="rs-chip" onClick={() => setZoom(null)}>
            {t("scene.runs.zoomOut")} <X aria-hidden />
          </button>
        )}
        {lane && (
          <button type="button" className="rs-chip" onClick={() => setParam("lane", null)}>
            {t("scene.runs.lane.only", { lane: t(`scene.runs.lane.${lane}`) })} <X aria-hidden />
          </button>
        )}
      </p>
    </header>
  );

  const loading = data.isPending && runs.length === 0;
  const body = loading ? (
    <p className="rs-quiet rs-pulse">{t("scene.runs.loading")}</p>
  ) : data.isError && runs.length === 0 ? (
    <ErrorBox message={data.error.message} onRetry={() => void data.refetch()} />
  ) : view === "list" ? null : shown.length === 0 && lanes.length === 0 ? (
    <div className="rs-empty">
      <p>{filtered ? t("scene.runs.emptyFiltered") : t("scene.runs.empty")}</p>
      {filtered ? (
        <button
          type="button"
          className="rs-btn ghost"
          onClick={() => {
            setQuery("");
            const next = new URLSearchParams(params);
            next.delete("status");
            next.delete("lane");
            setParams(next, { replace: true });
          }}
        >
          {t("scene.runs.clearFilters")}
        </button>
      ) : (
        range !== "30d" &&
        !zoom && (
          <button
            type="button"
            className="rs-btn ghost"
            onClick={() => setParam("range", range === "24h" ? "7d" : "30d")}
          >
            {t("scene.runs.widen", { range: t(`scene.runs.range.${range === "24h" ? "7d" : "30d"}`) })}
          </button>
        )
      )}
    </div>
  ) : (
    <RunsRiver
      items={items}
      lanes={lanes}
      counts={laneCounts}
      since={since}
      until={until}
      selectedId={selectedId}
      laneFilter={lane}
      onSelect={(id) => select(id)}
      onZoom={(from, to) => setZoom({ from, to })}
      onLane={(l) => setParam("lane", lane === l ? null : l)}
      statusText={statusOfId}
      zoomed={zoom !== null}
    />
  );

  const trace = (
    <section
      ref={traceRef}
      className={`rs-trace${selectedId ? " on" : ""}`}
      aria-label={t("scene.runs.trace")}
      key={selectedId ?? "none"}
    >
      {selectedId ? (
        <>
          {!selectedInWindow && view === "river" && (
            <p className="rs-eyebrow rs-outside">{t("scene.runs.trace.outside")}</p>
          )}
          <RunsTrace
            id={selectedId}
            detailOpen={detailOpen}
            onClose={() => select(null)}
            onDetail={() => setParam("detail", detailOpen ? null : "1")}
          />
        </>
      ) : (
        view === "river" && !loading && shown.length > 0 && <p className="rs-quiet">{t("scene.runs.hint")}</p>
      )}
    </section>
  );

  return (
    <div className="rs-scene" data-detail={detailOpen || undefined}>
      <div ref={scrollRef} className="rs-scroll">
        {head}
        {body}
        {trace}
        {view === "list" && !loading && (
          <RunsList
            runs={listRuns}
            now={now}
            selectedId={selectedId}
            asc={asc}
            onSort={() => setAsc((v) => !v)}
            onSelect={(id) => select(id)}
            canLoadOlder={
              Boolean(data.hasNextPage) ||
              (!older && listRuns.length < filterRuns(runs, { status, lane, query }).length)
            }
            loadingOlder={data.isFetchingNextPage}
            onLoadOlder={() => {
              // First everything already fetched past the window, then the next page.
              setOlder(true);
              if (data.hasNextPage) void data.fetchNextPage();
            }}
            statusText={statusWord}
          />
        )}
      </div>
      {detailOpen && selectedId && <RunsSheet id={selectedId} onClose={closeDetail} />}
    </div>
  );
}
