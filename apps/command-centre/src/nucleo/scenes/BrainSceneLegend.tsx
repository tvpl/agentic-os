/**
 * The legend (Brain scene, immersive shell): the dimension switcher — the
 * same stars arranged by areas, time, types or links — and, under it, the
 * groups of the current arrangement. A group flies the camera to it and
 * lights its stars; choosing it again lets go.
 */
import type { CSSProperties } from "react";
import { useT, type TKey } from "../../i18n";
import { BrainGlyph } from "./BrainGlyph";
import { DIMENSIONS, type Dimension } from "./brainDimensions";
import type { ContentKind } from "./brainGlyphs";

export interface LegendItem {
  key: string;
  label: string;
  count: number;
  color?: string;
  kind?: ContentKind;
}

const DIM_KEYS: Record<Dimension, TKey> = {
  areas: "scene.brain.dim.areas",
  time: "scene.brain.dim.time",
  types: "scene.brain.dim.types",
  links: "scene.brain.dim.links",
};

const SHOWN = 9;

export function BrainSceneLegend({
  dim,
  onDim,
  areasLabel,
  heading,
  items,
  active,
  onItem,
  open,
  onToggle,
  all,
  onAll,
  footer,
}: {
  dim: Dimension;
  onDim: (d: Dimension) => void;
  /** "Areas" or "Folders", whichever the areas arrangement groups by. */
  areasLabel: string;
  heading: string;
  items: LegendItem[];
  active: string | null;
  onItem: (key: string) => void;
  open: boolean;
  onToggle: () => void;
  all: boolean;
  onAll: () => void;
  footer?: React.ReactNode;
}) {
  const t = useT();
  const shown = all ? items : items.slice(0, SHOWN);
  return (
    <nav
      className="bs-legend"
      aria-label={t("scene.brain.legend")}
      data-open={open ? "" : undefined}
      data-dim={dim}
    >
      <button type="button" className="bs-legend-toggle" aria-expanded={open} onClick={onToggle}>
        {dim === "areas" ? areasLabel : t(DIM_KEYS[dim])}
        <span aria-hidden> ▾</span>
      </button>
      <div className="bs-dims" role="radiogroup" aria-label={t("scene.brain.dims")}>
        {DIMENSIONS.map((d, k) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={d === dim}
            title={`${d === "areas" ? areasLabel : t(DIM_KEYS[d])} · ${t("scene.brain.dimKey", { n: k + 1 })}`}
            onClick={() => onDim(d)}
          >
            <DimIcon dim={d} />
            <span>{d === "areas" ? areasLabel : t(DIM_KEYS[d])}</span>
          </button>
        ))}
      </div>
      <p className="bs-eyebrow bs-legend-head">{heading}</p>
      <ul className="bs-legend-list">
        {shown.map((c) => (
          <li key={c.key}>
            <button
              type="button"
              className="bs-area"
              data-glyph={c.kind ? "" : undefined}
              style={{ "--c": c.color ?? "var(--text-dim)" } as CSSProperties}
              aria-pressed={active === c.key}
              onClick={() => onItem(c.key)}
            >
              {c.kind ? <BrainGlyph kind={c.kind} size={14} /> : <i aria-hidden />}
              <span className="bs-area-name">{c.label}</span>
              <small>{c.count}</small>
            </button>
          </li>
        ))}
        {items.length > SHOWN && (
          <li>
            <button type="button" className="bs-link-btn" onClick={onAll}>
              {all ? t("scene.brain.fewerAreas") : t("scene.brain.moreAreas", { n: items.length - SHOWN })}
            </button>
          </li>
        )}
      </ul>
      {footer}
    </nav>
  );
}

/** Tiny pictograms of the four arrangements. */
function DimIcon({ dim }: { dim: Dimension }) {
  const d =
    dim === "areas"
      ? "M7 8.5a3.5 3.5 0 1 1 0 .01 M16.5 7a2.5 2.5 0 1 1 0 .01 M14.5 16.5a3.5 3.5 0 1 1 0 .01"
      : dim === "time"
        ? "M3 12h18 M19 9.5l2.5 2.5-2.5 2.5 M6 12c0-4 3-4 3 0s3 4 3 0 3-4 3 0"
        : dim === "types"
          ? "M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M17 14a3 3 0 1 1 0 6a3 3 0 1 1 0-6z"
          : "M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0 M12 3v4 M12 17v4 M3 12h4 M17 12h4 M5.5 5.5l3 3 M15.5 15.5l3 3";
  return (
    <svg
      className="bs-dim-icon"
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}
