/**
 * Control panel of the Second Brain: search, layout / view, typed-edge
 * toggles, local mode, filters, query groups, timeline, expand / collapse,
 * advanced sliders, workspace mode, bake, hygiene and the minimap.
 * Presentational: state comes from the parent as `ui` + `patch`.
 */
import { useId, type RefObject } from "react";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Eraser,
  List,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import { Segmented } from "../components/primitives";
import { useT } from "../i18n";
import type { HygieneReport } from "./engine/graph";
import {
  EDGE_KINDS,
  LAYOUTS,
  type EdgeKind,
  type LayoutKind,
  type ModifiedRange,
  type SizeRange,
  type ViewKind,
} from "./engine/world";
import { GROUP_PALETTE, MODIFIED_RANGES, SIZE_RANGES, type BrainUi } from "./state";

export interface TimelineState {
  range: [number, number] | null;
  value: number | null;
  playing: boolean;
}

export interface BrainPanelProps {
  ui: BrainUi;
  patch: (p: Partial<BrainUi>) => void;
  searchRef: RefObject<HTMLInputElement>;
  hits: Array<{ id: number; name: string; rel: string }>;
  facets: { exts: Array<[string, number]>; tags: Array<[string, number]> };
  /** Edge kinds present in the loaded graph (with counts). */
  kindCounts: Map<EdgeKind, number>;
  timeline: TimelineState;
  onTimeline: (value: number | null) => void;
  onTimelinePlay: () => void;
  onSelectId: (id: number, focus?: boolean) => void;
  onHub: (key: string) => void;
  onExpandAll: (expanded: boolean) => void;
  onReset: () => void;
  listOpen: boolean;
  onToggleList: () => void;
  onBake: () => void;
  hygiene: HygieneReport;
  dangling: string[];
  minimapRef: RefObject<HTMLCanvasElement>;
  truncated: boolean;
  lang: string;
}

const KIND_KEYS: Record<
  EdgeKind,
  | "brain.kind.markdown-link"
  | "brain.kind.related"
  | "brain.kind.same-dir"
  | "brain.kind.same-area"
  | "brain.kind.other"
> = {
  "markdown-link": "brain.kind.markdown-link",
  related: "brain.kind.related",
  "same-dir": "brain.kind.same-dir",
  "same-area": "brain.kind.same-area",
  other: "brain.kind.other",
};
const LAYOUT_KEYS: Record<
  LayoutKind,
  | "brain.layout.arcs"
  | "brain.layout.force"
  | "brain.layout.circle"
  | "brain.layout.hex"
  | "brain.layout.rings"
> = {
  arcs: "brain.layout.arcs",
  force: "brain.layout.force",
  circle: "brain.layout.circle",
  hex: "brain.layout.hex",
  rings: "brain.layout.rings",
};
const MOD_KEYS: Record<ModifiedRange, "brain.mod.24h" | "brain.mod.7d" | "brain.mod.30d" | "brain.mod.all"> =
  { "24h": "brain.mod.24h", "7d": "brain.mod.7d", "30d": "brain.mod.30d", all: "brain.mod.all" };
const SIZE_KEYS: Record<
  SizeRange,
  "brain.size.any" | "brain.size.small" | "brain.size.medium" | "brain.size.large"
> = {
  any: "brain.size.any",
  small: "brain.size.small",
  medium: "brain.size.medium",
  large: "brain.size.large",
};

export function BrainPanel(p: BrainPanelProps) {
  const t = useT();
  const { ui, patch } = p;
  const ids = useId();
  const filtersOn =
    ui.filters.exts.length > 0 ||
    ui.filters.tags.length > 0 ||
    ui.filters.modified !== "all" ||
    ui.filters.size !== "any";
  const toggleIn = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const fmtDate = (ms: number) =>
    new Date(ms).toLocaleDateString(p.lang, { year: "2-digit", month: "short", day: "numeric" });

  return (
    <div className="brain2-panel" aria-label={t("brain.controls")}>
      <input
        ref={p.searchRef}
        className="input"
        placeholder={t("brain.searchPh")}
        title={`${t("brain.searchPh")} ( / )`}
        value={ui.query}
        onChange={(e) => patch({ query: e.target.value })}
        aria-label={t("common.search")}
      />
      {p.hits.length > 0 && (
        <div className="brain-hits" role="list">
          {p.hits.map((h) => (
            <div key={h.id} role="listitem">
              <button
                type="button"
                className="microapp-row brain-hit"
                onClick={() => p.onSelectId(h.id, true)}
              >
                <span className="ma-text">
                  <span className="ma-name truncate">{h.name}</span>
                  <span className="ma-desc truncate">{h.rel}</span>
                </span>
              </button>
            </div>
          ))}
        </div>
      )}

      <section className="brain-section">
        <div className="hud-label">{t("brain.layout")}</div>
        <Segmented<LayoutKind>
          size="sm"
          ariaLabel={t("brain.layout")}
          value={ui.layout}
          onChange={(layout) => patch({ layout })}
          options={LAYOUTS.map((k) => ({ value: k, label: t(LAYOUT_KEYS[k]) }))}
        />
      </section>
      <section className="brain-section">
        <div className="hud-label">{t("brain.view")}</div>
        <Segmented<ViewKind>
          size="sm"
          ariaLabel={t("brain.view")}
          value={ui.view}
          onChange={(view) => patch({ view, filterGroup: null })}
          options={[
            { value: "areas", label: t("brain.view.areas") },
            { value: "folders", label: t("brain.view.folders") },
          ]}
        />
      </section>

      <section className="brain-section">
        <div className="hud-label">{t("brain.edges")}</div>
        <div className="brain-chips" role="group" aria-label={t("brain.edges")}>
          {EDGE_KINDS.filter((k) => (p.kindCounts.get(k) ?? 0) > 0 || k === "markdown-link").map((k) => {
            const on = ui.edgeKinds.includes(k);
            return (
              <button
                key={k}
                type="button"
                role="switch"
                aria-checked={on}
                className={`brain-chip kind${on ? " on" : ""}`}
                onClick={() => patch({ edgeKinds: toggleIn(ui.edgeKinds, k) as EdgeKind[] })}
              >
                <span className={`brain-kind-swatch ${k}`} aria-hidden />
                {t(KIND_KEYS[k])}
                <span className="count">{p.kindCounts.get(k) ?? 0}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="brain-section">
        <div className="row">
          <button
            type="button"
            className={`btn sm${ui.local ? " outline-accent" : ""}`}
            aria-pressed={ui.local}
            onClick={() => patch({ local: !ui.local })}
            title={`${t("brain.local")} (f)`}
          >
            {t("brain.local")}
          </button>
          <label className="brain-inline-label" htmlFor={`${ids}-hops`}>
            {t("brain.hops")}
            <input
              id={`${ids}-hops`}
              type="range"
              min={1}
              max={3}
              step={1}
              value={ui.localHops}
              onChange={(e) => patch({ localHops: Number(e.target.value) })}
              className="brain-hops"
            />
            <span className="val">{ui.localHops}</span>
          </label>
        </div>
        <p className="brain-hint">
          {ui.local && ui.sel === null ? t("brain.local.hint") : t("brain.hover.hint")}
        </p>
      </section>

      <section className="brain-section">
        <div className="row">
          <div className="hud-label">{t("brain.filters")}</div>
          {filtersOn && (
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => patch({ filters: { exts: [], tags: [], modified: "all", size: "any" } })}
            >
              <Eraser aria-hidden /> {t("brain.filters.clear")}
            </button>
          )}
        </div>
        {p.facets.exts.length > 0 && (
          <div className="brain-chips" role="group" aria-label={t("brain.ext")}>
            {p.facets.exts.map(([ext, count]) => {
              const on = ui.filters.exts.includes(ext);
              return (
                <button
                  key={ext}
                  type="button"
                  className={`brain-chip${on ? " on" : ""}`}
                  aria-pressed={on}
                  onClick={() => patch({ filters: { ...ui.filters, exts: toggleIn(ui.filters.exts, ext) } })}
                >
                  {ext}
                  <span className="count">{count}</span>
                </button>
              );
            })}
          </div>
        )}
        {p.facets.tags.length > 0 && (
          <div className="brain-chips" role="group" aria-label={t("brain.tags")}>
            {p.facets.tags.map(([tag, count]) => {
              const on = ui.filters.tags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  className={`brain-chip tag${on ? " on" : ""}`}
                  aria-pressed={on}
                  onClick={() => patch({ filters: { ...ui.filters, tags: toggleIn(ui.filters.tags, tag) } })}
                >
                  #{tag}
                  <span className="count">{count}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="brain-subrow">
          <span className="brain-inline-label">{t("brain.modified")}</span>
          <Segmented<ModifiedRange>
            size="sm"
            ariaLabel={t("brain.modified")}
            value={ui.filters.modified}
            onChange={(modified) => patch({ filters: { ...ui.filters, modified } })}
            options={MODIFIED_RANGES.map((m) => ({ value: m, label: t(MOD_KEYS[m]) }))}
          />
        </div>
        <div className="brain-subrow">
          <span className="brain-inline-label">{t("brain.size")}</span>
          <Segmented<SizeRange>
            size="sm"
            ariaLabel={t("brain.size")}
            value={ui.filters.size}
            onChange={(size) => patch({ filters: { ...ui.filters, size } })}
            options={SIZE_RANGES.map((s) => ({ value: s, label: t(SIZE_KEYS[s]) }))}
          />
        </div>
      </section>

      <section className="brain-section">
        <div className="row">
          <div className="hud-label">{t("brain.groups")}</div>
          {ui.groups.length < 4 && (
            <button
              type="button"
              className="btn ghost sm"
              onClick={() =>
                patch({
                  groups: [
                    ...ui.groups,
                    { query: "", color: GROUP_PALETTE[ui.groups.length % GROUP_PALETTE.length]! },
                  ],
                })
              }
            >
              <Plus aria-hidden /> {t("brain.groups.add")}
            </button>
          )}
        </div>
        {ui.groups.map((g, i) => (
          <div className="brain-group-row" key={i}>
            <input
              type="color"
              value={g.color}
              aria-label={`${t("brain.groups")} ${i + 1}`}
              onChange={(e) =>
                patch({ groups: ui.groups.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })
              }
            />
            <input
              className="input sm"
              placeholder={t("brain.groups.ph")}
              value={g.query}
              aria-label={`${t("brain.groups.ph")} ${i + 1}`}
              onChange={(e) =>
                patch({ groups: ui.groups.map((x, j) => (j === i ? { ...x, query: e.target.value } : x)) })
              }
            />
            <button
              type="button"
              className="btn ghost sm icon-only"
              aria-label={t("brain.groups.remove")}
              onClick={() => patch({ groups: ui.groups.filter((_, j) => j !== i) })}
            >
              <X aria-hidden />
            </button>
          </div>
        ))}
      </section>

      {p.timeline.range && (
        <section className="brain-section brain-timeline">
          <div className="row">
            <label className="brain-check" htmlFor={`${ids}-tl`}>
              <input
                id={`${ids}-tl`}
                type="checkbox"
                checked={p.timeline.value !== null}
                onChange={(e) => p.onTimeline(e.target.checked ? p.timeline.range![1] : null)}
              />
              {t("brain.timeline")}
            </label>
            {p.timeline.value !== null && (
              <button
                type="button"
                className="btn ghost sm icon-only"
                onClick={p.onTimelinePlay}
                aria-label={p.timeline.playing ? t("brain.timeline.pause") : t("brain.timeline.play")}
                aria-pressed={p.timeline.playing}
              >
                {p.timeline.playing ? <Pause aria-hidden /> : <Play aria-hidden />}
              </button>
            )}
          </div>
          {p.timeline.value !== null && (
            <div className="slider-row wide">
              <input
                type="range"
                min={p.timeline.range[0]}
                max={p.timeline.range[1]}
                step={Math.max(1, Math.floor((p.timeline.range[1] - p.timeline.range[0]) / 400))}
                value={p.timeline.value}
                onChange={(e) => p.onTimeline(Number(e.target.value))}
                aria-label={t("brain.timeline")}
              />
              <span className="val">{fmtDate(p.timeline.value)}</span>
            </div>
          )}
        </section>
      )}

      <div className="row">
        <button className="btn sm" onClick={() => p.onExpandAll(true)}>
          <ChevronsUpDown aria-hidden /> {t("brain.expandAll")}
        </button>
        <button className="btn sm" onClick={() => p.onExpandAll(false)}>
          <ChevronsDownUp aria-hidden /> {t("brain.collapseAll")}
        </button>
      </div>
      <div className="row">
        <button className="btn sm" onClick={p.onReset}>
          <RotateCcw aria-hidden /> {t("brain.reset")}
        </button>
        <button
          className={`btn sm${p.listOpen ? " outline-accent" : ""}`}
          onClick={p.onToggleList}
          aria-pressed={p.listOpen}
        >
          <List aria-hidden /> {t("brain.listView")}
        </button>
      </div>

      <details className="brain2-advanced">
        <summary className="hud-label">{t("brain.advanced")}</summary>
        <div>
          <div className="hud-label">{t("brain.spin")}</div>
          <div className="slider-row">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={ui.spin}
              onChange={(e) => patch({ spin: Number(e.target.value) })}
              aria-label={t("brain.spin")}
            />
            <span className="val">{ui.spin.toFixed(2)}</span>
          </div>
        </div>
        <label className="brain-check" htmlFor={`${ids}-names`}>
          <input
            id={`${ids}-names`}
            type="checkbox"
            checked={ui.showNames}
            onChange={(e) => patch({ showNames: e.target.checked })}
          />
          {t("brain.fileNames")} <kbd>l</kbd>
        </label>
        <label className="brain-check" htmlFor={`${ids}-focus`}>
          <input
            id={`${ids}-focus`}
            type="checkbox"
            checked={ui.focusMode}
            onChange={(e) => patch({ focusMode: e.target.checked })}
          />
          {t("brain.focusMode")}
        </label>
        <div>
          <div className="hud-label">{t("brain.springs")}</div>
          <div className="slider-row">
            <input
              type="range"
              min={0.01}
              max={0.2}
              step={0.01}
              value={ui.linkSpring}
              onChange={(e) => patch({ linkSpring: Number(e.target.value) })}
              aria-label={t("brain.springs")}
            />
            <span className="val">{ui.linkSpring.toFixed(2)}</span>
          </div>
        </div>
        <div>
          <div className="hud-label">{t("brain.clusterSize")}</div>
          <div className="slider-row">
            <input
              type="range"
              min={0.5}
              max={1.8}
              step={0.05}
              value={ui.clusterSize}
              onChange={(e) => patch({ clusterSize: Number(e.target.value) })}
              aria-label={t("brain.clusterSize")}
            />
            <span className="val">{ui.clusterSize.toFixed(2)}</span>
          </div>
        </div>
        <div>
          <div className="hud-label">{t("brain.nodeSize")}</div>
          <div className="slider-row">
            <input
              type="range"
              min={0.4}
              max={2}
              step={0.05}
              value={ui.nodeScale}
              onChange={(e) => patch({ nodeScale: Number(e.target.value) })}
              aria-label={t("brain.nodeSize")}
            />
            <span className="val">{ui.nodeScale.toFixed(2)}</span>
          </div>
        </div>
        <label className="brain-check" htmlFor={`${ids}-ws`} title={t("brain.workspace.hint")}>
          <input
            id={`${ids}-ws`}
            type="checkbox"
            checked={ui.workspaceMode}
            onChange={(e) => patch({ workspaceMode: e.target.checked })}
          />
          {t("brain.workspace")}
        </label>
        <button className="btn sm outline-accent" onClick={p.onBake}>
          <Save aria-hidden /> {t("brain.bake")}
        </button>
      </details>

      <details className="brain2-advanced brain-hygiene">
        <summary className="hud-label">
          {t("brain.hygiene")}
          <span className="count">
            {p.hygiene.orphans.length +
              p.hygiene.stale.length +
              p.hygiene.unopened.length +
              p.dangling.length}
          </span>
        </summary>
        <HygieneList
          title={t("brain.hygiene.orphans")}
          items={p.hygiene.orphans.map((n) => ({
            key: `o${n.id}`,
            label: n.name,
            onClick: () => p.onSelectId(n.id, true),
          }))}
        />
        <HygieneList
          title={t("brain.hygiene.stale")}
          items={p.hygiene.stale.map((n) => ({
            key: `s${n.id}`,
            label: n.name,
            onClick: () => p.onSelectId(n.id, true),
          }))}
        />
        <HygieneList
          title={t("brain.hygiene.unopened")}
          items={p.hygiene.unopened.map((h) => ({
            key: `h${h.key}`,
            label: `${h.key} · ${h.count}`,
            onClick: () => p.onHub(h.key),
          }))}
        />
        <HygieneList
          title={t("brain.hygiene.dangling")}
          items={p.dangling.map((ref) => ({ key: `d${ref}`, label: ref }))}
        />
        {p.hygiene.orphans.length + p.hygiene.stale.length + p.hygiene.unopened.length + p.dangling.length ===
          0 && <p className="brain-hint">{t("brain.hygiene.clean")}</p>}
      </details>

      {ui.filterGroup && (
        <button className="btn sm outline-accent" onClick={() => patch({ filterGroup: null })}>
          <X aria-hidden /> {ui.filterGroup}
        </button>
      )}
      <div>
        <div className="hud-label brain-minimap-label">{t("brain.minimap")}</div>
        <canvas ref={p.minimapRef} className="brain2-minimap" aria-label={t("brain.minimap")} />
      </div>
      {p.truncated && <p className="brain-hint">{t("brain.truncated")}</p>}
    </div>
  );
}

function HygieneList({
  title,
  items,
}: {
  title: string;
  items: Array<{ key: string; label: string; onClick?: () => void }>;
}) {
  const t = useT();
  if (items.length === 0) return null;
  const shown = items.slice(0, 8);
  return (
    <div className="brain-hygiene-group">
      <div className="brain-inline-label">
        {title} <span className="count">{items.length}</span>
      </div>
      <div className="brain-hygiene-items">
        {shown.map((it) =>
          it.onClick ? (
            <button key={it.key} type="button" className="brain-md-link" onClick={it.onClick}>
              {it.label}
            </button>
          ) : (
            <span key={it.key} className="brain-md-dangling">
              {it.label}
            </span>
          ),
        )}
        {items.length > shown.length && (
          <span className="brain-more">{t("brain.moreN", { n: items.length - shown.length })}</span>
        )}
      </div>
    </div>
  );
}
