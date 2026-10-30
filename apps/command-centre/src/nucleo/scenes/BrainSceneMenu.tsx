/**
 * The Brain scene's "⋯" (immersive shell): everything the Second Brain could
 * do that is not the sky itself — refresh the index, the list view, areas or
 * folders, which links count, filters, local focus, hygiene, reset, save as
 * default, and the classic 2D map (layouts, pins, hubs, minimap, groups…).
 * Typographic rows, no cards.
 */
import { useId } from "react";
import { useT, type TKey } from "../../i18n";
import type { HygieneReport } from "../../brain/engine/graph";
import {
  EDGE_KINDS,
  type EdgeKind,
  type ModifiedRange,
  type SizeRange,
  type ViewKind,
} from "../../brain/engine/world";
import { MODIFIED_RANGES, SIZE_RANGES, type BrainUi } from "../../brain/state";
import { Switch } from "../../ui";
import { openCleanup } from "../../brain/cleanupEvents";

const KIND_KEYS: Record<EdgeKind, TKey> = {
  "markdown-link": "brain.kind.markdown-link",
  wikilink: "brain.kind.wikilink",
  related: "brain.kind.related",
  "same-dir": "brain.kind.same-dir",
  other: "brain.kind.other",
};
const MOD_KEYS: Record<ModifiedRange, TKey> = {
  "24h": "brain.mod.24h",
  "7d": "brain.mod.7d",
  "30d": "brain.mod.30d",
  all: "brain.mod.all",
};
const SIZE_KEYS: Record<SizeRange, TKey> = {
  any: "brain.size.any",
  small: "brain.size.small",
  medium: "brain.size.medium",
  large: "brain.size.large",
};

export interface BrainSceneMenuProps {
  ui: BrainUi;
  patch: (p: Partial<BrainUi>) => void;
  kindCounts: Map<EdgeKind, number>;
  facets: { exts: Array<[string, number]>; tags: Array<[string, number]> };
  hygiene: HygieneReport;
  dangling: string[];
  refreshing: boolean;
  listOpen: boolean;
  truncated: boolean;
  onRefresh: () => void;
  onToggleList: () => void;
  onClassic: () => void;
  onReset: () => void;
  onBake: () => void;
  /** The guided cleanup (cerebro-faxina-guiada, amendment 11): the last row of the actions; default, just open it. */
  onCleanup?: () => void;
  /** "Revisões (N)" (cerebro-natureza, amendment 10): after "Faxina", only with N > 0 files due in the context. */
  reviewsDue?: number;
  onReviews?: () => void;
  onNote: (id: number) => void;
}

export function BrainSceneMenu(p: BrainSceneMenuProps) {
  const t = useT();
  const ids = useId();
  const due = p.reviewsDue ?? 0;
  const { ui, patch } = p;
  const toggleIn = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const filtersOn =
    ui.filters.exts.length > 0 ||
    ui.filters.tags.length > 0 ||
    ui.filters.modified !== "all" ||
    ui.filters.size !== "any";
  const hygieneCount = p.hygiene.orphans.length + p.hygiene.stale.length + p.dangling.length;

  return (
    <div className="bs-menu-body">
      <section className="bs-menu-acts" aria-label={t("scene.brain.actions")}>
        <button type="button" onClick={p.onRefresh} disabled={p.refreshing}>
          {p.refreshing ? t("brain.indexing") : t("brain.refresh")}
        </button>
        <button type="button" aria-pressed={p.listOpen} onClick={p.onToggleList}>
          {t("brain.listView")}
        </button>
        <button type="button" onClick={p.onClassic}>
          {t("scene.brain.classic")}
        </button>
        <button type="button" onClick={p.onReset}>
          {t("brain.reset")}
        </button>
        <button type="button" onClick={p.onBake}>
          {t("brain.bake")}
        </button>
        <button type="button" onClick={p.onCleanup ?? (() => openCleanup())}>
          {t("cleanup.open.button")}
        </button>
        {due > 0 && (
          <button type="button" onClick={p.onReviews}>
            {t("reviews.button", { n: due })}
          </button>
        )}
      </section>

      <section aria-labelledby={`${ids}-view`}>
        <p className="bs-eyebrow" id={`${ids}-view`}>
          {t("brain.view")}
        </p>
        <div className="bs-seg" role="radiogroup" aria-labelledby={`${ids}-view`}>
          {(["areas", "folders"] as ViewKind[]).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={ui.view === v}
              onClick={() => patch({ view: v, filterGroup: null })}
            >
              {t(v === "areas" ? "brain.view.areas" : "brain.view.folders")}
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby={`${ids}-edges`}>
        <p className="bs-eyebrow" id={`${ids}-edges`}>
          {t("brain.edges")}
        </p>
        <div className="bs-chips">
          {EDGE_KINDS.filter((k) => (p.kindCounts.get(k) ?? 0) > 0 || k === "markdown-link").map((k) => {
            const on = ui.edgeKinds.includes(k);
            return (
              <Switch
                key={k}
                checked={on}
                onCheckedChange={() => patch({ edgeKinds: toggleIn(ui.edgeKinds, k) as EdgeKind[] })}
              >
                <span className={`bs-kind k-${k}`} aria-hidden />
                {t(KIND_KEYS[k])} <small>{p.kindCounts.get(k) ?? 0}</small>
              </Switch>
            );
          })}
        </div>
      </section>

      <section aria-labelledby={`${ids}-local`}>
        <p className="bs-eyebrow" id={`${ids}-local`}>
          {t("brain.local")}
        </p>
        <div className="bs-row">
          <span className="bs-switch-row">
            <Switch
              checked={ui.local}
              onCheckedChange={(local) => patch({ local })}
              aria-labelledby={`${ids}-local ${ids}-local-state`}
            />
            <span id={`${ids}-local-state`}>{ui.local ? t("scene.brain.on") : t("scene.brain.off")}</span>
          </span>
          <label className="bs-range" htmlFor={`${ids}-hops`}>
            {t("brain.hops")}
            <input
              id={`${ids}-hops`}
              type="range"
              min={1}
              max={3}
              step={1}
              value={ui.localHops}
              onChange={(e) => patch({ localHops: Number(e.target.value) })}
            />
            <span className="mono">{ui.localHops}</span>
          </label>
        </div>
        <p className="bs-faint">
          {ui.local && ui.sel === null ? t("brain.local.hint") : t("scene.brain.localHint")}
        </p>
      </section>

      <section aria-labelledby={`${ids}-filters`}>
        <div className="bs-row">
          <p className="bs-eyebrow" id={`${ids}-filters`}>
            {t("brain.filters")}
          </p>
          {filtersOn && (
            <button
              type="button"
              className="bs-link-btn"
              onClick={() => patch({ filters: { exts: [], tags: [], modified: "all", size: "any" } })}
            >
              {t("brain.filters.clear")}
            </button>
          )}
        </div>
        {p.facets.exts.length > 0 && (
          <div className="bs-chips" role="group" aria-label={t("brain.ext")}>
            {p.facets.exts.map(([ext, count]) => (
              <button
                key={ext}
                type="button"
                aria-pressed={ui.filters.exts.includes(ext)}
                onClick={() => patch({ filters: { ...ui.filters, exts: toggleIn(ui.filters.exts, ext) } })}
              >
                {ext} <small>{count}</small>
              </button>
            ))}
          </div>
        )}
        {p.facets.tags.length > 0 && (
          <div className="bs-chips" role="group" aria-label={t("brain.tags")}>
            {p.facets.tags.map(([tag, count]) => (
              <button
                key={tag}
                type="button"
                aria-pressed={ui.filters.tags.includes(tag)}
                onClick={() => patch({ filters: { ...ui.filters, tags: toggleIn(ui.filters.tags, tag) } })}
              >
                #{tag} <small>{count}</small>
              </button>
            ))}
          </div>
        )}
        <div className="bs-seg" role="radiogroup" aria-label={t("brain.modified")}>
          {MODIFIED_RANGES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={ui.filters.modified === m}
              onClick={() => patch({ filters: { ...ui.filters, modified: m } })}
            >
              {t(MOD_KEYS[m])}
            </button>
          ))}
        </div>
        <div className="bs-seg" role="radiogroup" aria-label={t("brain.size")}>
          {SIZE_RANGES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={ui.filters.size === s}
              onClick={() => patch({ filters: { ...ui.filters, size: s } })}
            >
              {t(SIZE_KEYS[s])}
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby={`${ids}-hyg`}>
        <p className="bs-eyebrow" id={`${ids}-hyg`}>
          {t("brain.hygiene")} <span className="mono">{hygieneCount}</span>
        </p>
        {hygieneCount === 0 && <p className="bs-faint">{t("brain.hygiene.clean")}</p>}
        <HygieneRow
          title={t("brain.hygiene.orphans")}
          items={p.hygiene.orphans.map((n) => ({ key: `o${n.id}`, label: n.name, id: n.id }))}
          onNote={p.onNote}
        />
        <HygieneRow
          title={t("brain.hygiene.stale")}
          items={p.hygiene.stale.map((n) => ({ key: `s${n.id}`, label: n.name, id: n.id }))}
          onNote={p.onNote}
        />
        <HygieneRow
          title={t("brain.hygiene.dangling")}
          items={p.dangling.map((ref) => ({ key: `d${ref}`, label: ref }))}
          onNote={p.onNote}
        />
      </section>
      {p.truncated && <p className="bs-faint">{t("brain.truncated")}</p>}
    </div>
  );
}

function HygieneRow({
  title,
  items,
  onNote,
}: {
  title: string;
  items: Array<{ key: string; label: string; id?: number }>;
  onNote: (id: number) => void;
}) {
  const t = useT();
  if (items.length === 0) return null;
  const shown = items.slice(0, 8);
  return (
    <div className="bs-hyg">
      <p className="bs-link-kind">
        {title} <span className="bs-faint">×{items.length}</span>
      </p>
      <p className="bs-hyg-items">
        {shown.map((it) =>
          it.id !== undefined ? (
            <button key={it.key} type="button" className="bs-md-link" onClick={() => onNote(it.id!)}>
              {it.label}
            </button>
          ) : (
            <span key={it.key} className="bs-md-dangling">
              {it.label}
            </span>
          ),
        )}
        {items.length > shown.length && (
          <span className="bs-faint">{t("brain.moreN", { n: items.length - shown.length })}</span>
        )}
      </p>
    </div>
  );
}
