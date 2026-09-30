/**
 * The Skills scene's arsenal (immersive shell): the ring on wide screens, a
 * sectored grid on narrow ones. Both are one roving-focus group of buttons —
 * only the chosen skill is in the tab order; arrows move the choice.
 */
import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode, type WheelEvent } from "react";
import { useT, type TKey } from "../../i18n";
import { NAME_OFFSET, type RingGeometry, type RingLayout, type Sector } from "./skillsRing";
import type { SkillEntry } from "./skillsEntries";

export interface ArsenalProps {
  sectors: ReadonlyArray<Sector<SkillEntry>>;
  selected: string | null;
  scores: ReadonlyMap<string, number>;
  querying: boolean;
  running: ReadonlySet<string>;
  onPick: (slug: string) => void;
  onKey: (e: KeyboardEvent<HTMLElement>) => void;
  /** The ring's roving buttons, by slug, so focus can follow the choice. */
  buttons: React.MutableRefObject<Map<string, HTMLButtonElement>>;
}

function ItemButton({
  entry,
  props,
  className,
  style,
}: {
  entry: SkillEntry;
  props: ArsenalProps;
  className: string;
  style?: CSSProperties;
}) {
  const t = useT();
  const on = entry.slug === props.selected;
  const dim = props.querying && (props.scores.get(entry.slug) ?? 0) <= 0;
  const live = props.running.has(entry.slug);
  const s = entry.skill;
  const state = [
    t(s.mode === "write" ? "scene.skills.writes" : "scene.skills.readOnly"),
    entry.favorite ? t("scene.skills.favorited") : null,
    !s.enabled ? t("scene.skills.pausedTag") : null,
    live ? t("scene.skills.running") : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <button
      type="button"
      className={className}
      style={style}
      data-slug={entry.slug}
      data-mode={s.mode}
      data-dim={dim || undefined}
      data-live={live || undefined}
      data-paused={!s.enabled || undefined}
      aria-current={on ? "true" : undefined}
      aria-label={`${entry.name} — /${entry.slug} (${state})`}
      title={`/${entry.slug}`}
      tabIndex={on ? 0 : -1}
      ref={(el) => {
        if (el) props.buttons.current.set(entry.slug, el);
        else props.buttons.current.delete(entry.slug);
      }}
      onClick={() => props.onPick(entry.slug)}
      onKeyDown={props.onKey}
    >
      <span className="hx-w" aria-hidden>
        <span className="hx">{s.mode === "write" ? "✎" : "◇"}</span>
      </span>
      <span className="nm">
        {entry.favorite && (
          <span className="fav" aria-hidden>
            ★{" "}
          </span>
        )}
        {entry.name}
      </span>
    </button>
  );
}

const catKey = (c: string) => `scene.skills.cat.${c}` as TKey;

/** Pixels as a CSS length. */
const px = (n: number) => `${Math.round(n)}px`;

/**
 * The ring: an orbit as wide as the stage allows. Items, sector labels and
 * the ticks between sectors ride it with `cos()`/`sin()` of `--sks-rot`,
 * so the one registered angle turns everything.
 */
export function SkillRing({
  props,
  layout,
  rot,
  settled,
  width,
  height,
  geo,
  onWheelStep,
  children,
}: {
  props: ArsenalProps;
  layout: RingLayout;
  rot: number;
  settled: boolean;
  width: number;
  height: number;
  geo: RingGeometry;
  onWheelStep: (dir: 1 | -1) => void;
  children: ReactNode;
}) {
  const t = useT();
  const outer = geo.orbits[0]!;
  const items = props.sectors.flatMap((s) => s.items);
  const halfGap = layout.sectors[0]?.start ?? 0;
  const wheel = useRef({ acc: 0, at: 0 });
  const onWheel = (e: WheelEvent) => {
    const w = wheel.current;
    w.acc += Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    const now = performance.now();
    if (Math.abs(w.acc) < 40 || now - w.at < 130) return;
    onWheelStep(w.acc > 0 ? 1 : -1);
    w.acc = 0;
    w.at = now;
  };
  return (
    <div
      className="sks-ring-wrap"
      style={
        {
          width: px(width),
          height: px(height),
          "--cw": px(geo.centre.w),
          "--ch": px(geo.centre.h),
        } as CSSProperties
      }
      data-rings={layout.rings}
      onWheel={onWheel}
    >
      <svg className="sks-track" viewBox={`${-width / 2} ${-height / 2} ${width} ${height}`} aria-hidden>
        {geo.orbits.map((o, i) => (
          <ellipse key={i} className={i === 0 ? "orbit" : "orbit in"} rx={o.rx} ry={o.ry} />
        ))}
        <ellipse
          className="halo"
          rx={(geo.label?.rx ?? outer.rx - 40) - 30}
          ry={(geo.label?.ry ?? outer.ry - 30) - 22}
        />
      </svg>
      <div
        className={`sks-ring${settled ? " settled" : ""}`}
        style={{ "--sks-rot": `${rot}deg` } as CSSProperties}
      >
        {layout.sectors.length > 1 &&
          layout.sectors.map((sec, i) => {
            const cat = props.sectors[i]?.category ?? "other";
            return (
              <span key={`${cat}-${i}`} aria-hidden>
                <span
                  className="sks-tick"
                  style={
                    {
                      "--a": `${sec.start - halfGap}deg`,
                      "--rx": px(outer.rx),
                      "--ry": px(outer.ry),
                    } as CSSProperties
                  }
                />
                {geo.label && (
                  <span
                    className="sks-sector"
                    style={
                      {
                        "--a": `${sec.mid}deg`,
                        "--rx": px(geo.label.rx),
                        "--ry": px(geo.label.ry),
                      } as CSSProperties
                    }
                  >
                    {t(catKey(cat))}
                  </span>
                )}
              </span>
            );
          })}
        <div className="sks-items" role="group" aria-label={t("scene.skills.arsenal")}>
          {items.map((entry, i) => {
            const slot = layout.slots[i];
            const orbit = slot ? geo.orbits[slot.ring] : undefined;
            if (!slot || !orbit) return null;
            return (
              <ItemButton
                key={entry.slug}
                entry={entry}
                props={props}
                className="sks-item"
                style={
                  {
                    "--a": `${slot.angle}deg`,
                    "--rx": px(orbit.rx),
                    "--ry": px(orbit.ry),
                    "--ox": px(NAME_OFFSET.x * orbit.out),
                    "--oy": px(NAME_OFFSET.y * orbit.out),
                  } as CSSProperties
                }
              />
            );
          })}
        </div>
      </div>
      {children}
    </div>
  );
}

/** Narrow screens: the same arsenal as sectors of a grid. */
export function SkillGrid({ props }: { props: ArsenalProps }) {
  const t = useT();
  return (
    <div className="sks-list" role="group" aria-label={t("scene.skills.arsenal")}>
      {props.sectors.map((sec, i) => (
        <section key={`${sec.category}-${i}`} className="sks-list-sec">
          <h3 className="sks-list-h">{t(catKey(sec.category))}</h3>
          <div className="sks-grid">
            {sec.items.map((entry) => (
              <ItemButton key={entry.slug} entry={entry} props={props} className="sks-chip" />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
