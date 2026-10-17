/**
 * The trail (Brain scene, immersive shell): the path travelled from note to
 * note through their synapses — back, forward, and every stop a crumb you
 * can jump to. Each step is drawn as a synapse (a small arc) between icons.
 */
import { useT } from "../../i18n";
import { BrainGlyph } from "./BrainGlyph";
import type { ContentKind } from "./brainGlyphs";
import type { Trail } from "./brainTrail";
import { Tooltip } from "../../ui";

export interface TrailCrumb {
  id: number;
  label: string;
  kind: ContentKind;
}

const SHOWN = 6;

export function BrainSceneTrail({
  trail,
  crumbOf,
  onJump,
  onBack,
  onForward,
  compact = false,
}: {
  trail: Trail;
  crumbOf: (id: number) => TrailCrumb | null;
  onJump: (index: number) => void;
  onBack: () => void;
  onForward: () => void;
  compact?: boolean;
}) {
  const t = useT();
  if (trail.items.length < 2) return null;
  const start = Math.max(0, Math.min(trail.pos - (SHOWN - 2), trail.items.length - SHOWN));
  const shown = trail.items.slice(start, start + SHOWN).map((id, k) => ({ id, index: start + k }));
  return (
    <nav className="bs-trail" aria-label={t("scene.brain.trail")} data-compact={compact ? "" : undefined}>
      <Tooltip label={t("scene.brain.back")}>
        <button
          type="button"
          className="bs-trail-step"
          onClick={onBack}
          disabled={trail.pos <= 0}
          aria-label={t("scene.brain.back")}
        >
          ‹
        </button>
      </Tooltip>
      <Tooltip label={t("scene.brain.forward")}>
        <button
          type="button"
          className="bs-trail-step"
          onClick={onForward}
          disabled={trail.pos >= trail.items.length - 1}
          aria-label={t("scene.brain.forward")}
        >
          ›
        </button>
      </Tooltip>
      <ol className="bs-trail-list">
        {start > 0 && (
          <li className="bs-trail-more" aria-hidden>
            …
          </li>
        )}
        {shown.map(({ id, index }) => {
          const c = crumbOf(id);
          if (!c) return null;
          const here = index === trail.pos;
          return (
            <li
              key={`${index}-${id}`}
              data-here={here ? "" : undefined}
              data-ahead={index > trail.pos ? "" : undefined}
            >
              <button
                type="button"
                onClick={() => onJump(index)}
                aria-current={here ? "location" : undefined}
                title={c.label}
              >
                <BrainGlyph kind={c.kind} size={13} />
                <span>{c.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
