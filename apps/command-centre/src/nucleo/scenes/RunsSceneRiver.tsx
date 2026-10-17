/**
 * The river itself (Runs scene): lanes by origin, capsules by time, the
 * glowing "now" line on the right, the axis underneath. One tab stop —
 * the arrow keys walk the capsules (roving focus), Enter opens one.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { useLocale, useT } from "../../i18n";
import {
  axisTicks,
  layoutRiver,
  neighbour,
  tickFormat,
  type ClusterMark,
  type Direction,
  type LaneId,
  type LaneLayout,
  type RiverItem,
  type RunMark,
} from "./runsRiver";
import { formatTick, formatWhen } from "./runsFormat";
import { Tooltip } from "../../ui";

const ROW_PITCH = 18;
const LANE_PAD = 17;

export interface RiverProps {
  items: readonly RiverItem[];
  /** Every lane that has runs before the status filter, so filtering does not reshuffle the lanes. */
  lanes: readonly LaneId[];
  counts: Partial<Record<LaneId, number>>;
  since: number;
  until: number;
  selectedId: string | null;
  laneFilter: LaneId | null;
  onSelect: (id: string) => void;
  onZoom: (from: number, to: number) => void;
  onLane: (lane: LaneId) => void;
  statusText: (id: string) => string;
  /** The window is zoomed into the past: no "now" edge. */
  zoomed: boolean;
}

const KEYS: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  Home: "home",
  End: "end",
};

export default function RunsRiver(props: RiverProps) {
  const { items, lanes, since, until, selectedId } = props;
  const t = useT();
  const locale = useLocale();
  const trackRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const apply = () => setWidth(el.clientWidth);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = width > 0 && width < 520;

  const layout = useMemo<LaneLayout[]>(() => {
    if (width <= 0) return [];
    const placed = layoutRiver(items, {
      since,
      until,
      width,
      maxRows: narrow ? 2 : 3,
      minW: narrow ? 8 : 10,
    });
    // Lanes with nothing left after the filters still show, empty, so the river keeps its shape.
    return lanes.map((lane) => placed.find((l) => l.lane === lane) ?? { lane, rows: 1, marks: [] });
  }, [items, since, until, width, narrow, lanes]);

  // A label centred on a tick near the left edge would be cut in half: those go.
  const ticks = useMemo(
    () => axisTicks(since, until, width, narrow ? 90 : 120).filter((tk) => tk.x >= 26),
    [since, until, width, narrow],
  );
  const fmt = tickFormat(since, until);

  // Roving focus: the selected run, else the newest mark.
  const allIds = useMemo(() => layout.flatMap((l) => l.marks.map((m) => m.id)), [layout]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const markOf = (id: string | null) =>
    id
      ? layout
          .flatMap((l) => l.marks)
          .find((m) => m.id === id || (m.kind === "cluster" && m.ids.includes(id)))
      : undefined;
  const selectedMark = markOf(selectedId);
  const newest = useMemo(() => {
    let best: { id: string; x: number } | null = null;
    for (const l of layout)
      for (const m of l.marks) if (!best || m.x + m.w > best.x) best = { id: m.id, x: m.x + m.w };
    return best?.id ?? null;
  }, [layout]);
  const tabId = focusId && allIds.includes(focusId) ? focusId : (selectedMark?.id ?? newest);
  useEffect(() => {
    if (selectedMark) setFocusId(selectedMark.id);
  }, [selectedMark]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = KEYS[e.key];
    if (!dir) return;
    e.preventDefault();
    const next = neighbour(layout, tabId, dir);
    if (!next) return;
    setFocusId(next);
    trackRef.current?.querySelector<HTMLElement>(`[data-mark="${CSS.escape(next)}"]`)?.focus();
  };

  const fmtWhen = (ts: number) => formatWhen(ts, until, locale);

  return (
    <div className="rs-river" data-narrow={narrow || undefined} data-zoom={props.zoomed || undefined}>
      <div className="rs-lanes">
        {layout.map((l) => {
          const h = Math.max(52, l.rows * ROW_PITCH + LANE_PAD * 2 - 2);
          const on = props.laneFilter === l.lane;
          return (
            <div
              key={l.lane}
              className="rs-lane"
              data-lane={l.lane}
              style={{ "--lane-h": `${h}px` } as CSSProperties}
            >
              <button
                type="button"
                className="rs-lane-name"
                aria-pressed={on}
                title={t("scene.runs.lane.only", { lane: t(`scene.runs.lane.${l.lane}`) })}
                onClick={() => props.onLane(l.lane)}
              >
                {t(`scene.runs.lane.${l.lane}`)}
                <small className="tnum">{props.counts[l.lane] ?? 0}</small>
              </button>
              <div className="rs-flow" aria-hidden />
            </div>
          );
        })}
      </div>

      {/* The marks live in one track laid over the lanes, so one roving group spans them all. */}
      <div
        ref={trackRef}
        className="rs-track"
        role="toolbar"
        aria-orientation="horizontal"
        aria-label={t("scene.runs.river")}
        onKeyDown={onKeyDown}
      >
        {(() => {
          let top = 0;
          return layout.map((l) => {
            const h = Math.max(52, l.rows * ROW_PITCH + LANE_PAD * 2 - 2);
            const laneTop = top;
            top += h;
            const single = l.rows === 1;
            return l.marks.map((m) => {
              const y = laneTop + (single ? h / 2 : LANE_PAD + m.row * ROW_PITCH + ROW_PITCH / 2 - 2);
              return m.kind === "run" ? (
                <Capsule
                  key={m.id}
                  m={m}
                  y={y}
                  selected={m.id === selectedId}
                  tabbable={m.id === tabId}
                  label={t("scene.runs.capsule", {
                    title: m.label,
                    status: props.statusText(m.id),
                    when: fmtWhen(items.find((i) => i.id === m.id)?.start ?? since),
                  })}
                  onFocus={() => setFocusId(m.id)}
                  onClick={() => props.onSelect(m.id)}
                />
              ) : (
                <Cluster
                  key={m.id}
                  m={m}
                  y={y}
                  selected={selectedId !== null && m.ids.includes(selectedId)}
                  tabbable={m.id === tabId}
                  label={t("scene.runs.cluster", {
                    n: m.ids.length,
                    from: fmtWhen(m.start),
                    to: fmtWhen(m.end),
                    bad: m.tones.fail ? t("scene.runs.cluster.bad", { n: m.tones.fail }) : "",
                  })}
                  onFocus={() => setFocusId(m.id)}
                  onClick={() => {
                    const pad = Math.max((m.end - m.start) * 0.15, 5 * 60_000);
                    props.onZoom(m.start - pad, Math.min(until, m.end + pad));
                  }}
                />
              );
            });
          });
        })()}
        <span className="rs-now" aria-hidden />
      </div>

      <div className="rs-axis" aria-hidden>
        {ticks.map((tk) => (
          <span key={tk.t} style={{ left: tk.x }}>
            {formatTick(tk.t, fmt, locale)}
          </span>
        ))}
        <span className="now">{t("scene.runs.now")}</span>
      </div>
    </div>
  );
}

function Capsule({
  m,
  y,
  selected,
  tabbable,
  label,
  onFocus,
  onClick,
}: {
  m: RunMark;
  y: number;
  selected: boolean;
  tabbable: boolean;
  label: string;
  onFocus: () => void;
  onClick: () => void;
}) {
  const always = m.tagFits && (m.tone === "fail" || m.tone === "live" || m.tone === "wait");
  return (
    <button
      type="button"
      className={`rs-cap${selected ? " sel" : ""}${always ? " tagged" : ""}${m.tagLeft ? " tag-left" : ""}`}
      data-tone={m.tone}
      data-mark={m.id}
      aria-label={label}
      aria-current={selected || undefined}
      tabIndex={tabbable ? 0 : -1}
      style={{ left: m.x, width: m.w, top: y }}
      onFocus={onFocus}
      onClick={onClick}
    >
      <span className="rs-tag" aria-hidden>
        {m.label}
      </span>
    </button>
  );
}

function Cluster({
  m,
  y,
  selected,
  tabbable,
  label,
  onFocus,
  onClick,
}: {
  m: ClusterMark;
  y: number;
  selected: boolean;
  tabbable: boolean;
  label: string;
  onFocus: () => void;
  onClick: () => void;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className={`rs-cap rs-cluster${selected ? " sel" : ""}`}
        data-tone={m.tone}
        data-mark={m.id}
        aria-label={label}
        tabIndex={tabbable ? 0 : -1}
        style={{ left: m.x, width: m.w, top: y }}
        onFocus={onFocus}
        onClick={onClick}
      >
        <span className="rs-cluster-n tnum" aria-hidden>
          {m.ids.length}
        </span>
      </button>
    </Tooltip>
  );
}
