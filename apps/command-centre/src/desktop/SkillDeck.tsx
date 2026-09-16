/**
 * The radial skill deck (redesign F7).
 *
 * "Where do I run a skill from?" was the first question the desktop failed to
 * answer, and a scrolling list inside a card was not the answer. The deck fans
 * the skills out on an arc over the console — where the hand already is when
 * you are about to ask for something — and closes the moment one is picked.
 *
 * It is a real dialog, not a flourish: it renders outside the shell so the
 * shell can be made inert, and `useDialog` gives it Escape, the focus trap and
 * focus restore. Every skill is reachable from the keyboard.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MoreHorizontal, Sparkles } from "lucide-react";
import { useLang, useT } from "../i18n";
import { useOsSkills } from "../queries";
import { DialogPortal, useDialog, usePresence } from "../components/dialog";
import { localizeSkill } from "../views/Skills/localize";
import { useDesktopActions } from "./actions";

/** Past this the arc stops reading as a fan and starts reading as a list. */
const MAX_ON_ARC = 8;
/** Wide enough that eight 70 px hexagons never touch on the chord. */
const RADIUS = 232;
/** Degrees. The arc opens upward from the console, mirrored around its centre. */
const FROM = 196;
const SPAN = 148;
/** Matches `--dur-slow`: the fan-in runs undelayed, so that is the whole exit. */
const EXIT_MS = 320;

export default function SkillDeck({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { mounted, closing } = usePresence(open, EXIT_MS);
  if (!mounted) return null;
  return (
    <DialogPortal>
      <Deck closing={closing} onClose={onClose} />
    </DialogPortal>
  );
}

function Deck({ closing, onClose }: { closing: boolean; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const skills = useOsSkills();
  const { runSkill, runningSkills } = useDesktopActions();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  // Mount at the centre, then fan out on the next frame so the transition has
  // two states to interpolate between.
  const [fanned, setFanned] = useState(false);

  // Favourites first: the arc is small, so what earns a slot matters. What
  // does not fit is not hidden — the last seat says how many are left and
  // hands the rest to the skills page.
  const { deck, overflow } = useMemo(() => {
    const on = (skills.data ?? []).filter((s) => s.enabled);
    const ordered = [...on.filter((s) => s.favorite), ...on.filter((s) => !s.favorite)];
    return { deck: ordered.slice(0, MAX_ON_ARC), overflow: Math.max(0, ordered.length - MAX_ON_ARC) };
  }, [skills.data]);
  /** Seats on the arc, including the overflow one. */
  const seats = deck.length + (overflow > 0 ? 1 : 0);

  /** Where seat `i` of `seats` sits, as inline custom properties. */
  const seat = (i: number): React.CSSProperties => {
    // A lone seat sits at the top of the arc rather than at its left edge.
    const deg = seats > 1 ? FROM + (SPAN / (seats - 1)) * i : FROM + SPAN / 2;
    const angle = (deg * Math.PI) / 180;
    return {
      "--dx": `${Math.cos(angle) * RADIUS}px`,
      "--dy": `${Math.sin(angle) * RADIUS}px`,
      "--delay": `${i * 26}ms`,
    } as React.CSSProperties;
  };

  useDialog(ref, onClose);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setFanned(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className={`skill-deck${fanned && !closing ? " open" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={t("desktop.deck.title")}
      tabIndex={-1}
      ref={ref}
    >
      <button type="button" className="deck-scrim" aria-label={t("common.close")} onClick={onClose} />
      <span className="deck-rim" aria-hidden />
      <span className="deck-rim b" aria-hidden />
      {deck.length === 0 && <p className="deck-empty">{t("desktop.deck.empty")}</p>}
      {deck.map((skill, i) => {
        const style = seat(i);
        const local = localizeSkill(skill, lang);
        return (
          <button
            key={skill.slug}
            type="button"
            className={`deck-skill${runningSkills.has(skill.slug) ? " live" : ""}`}
            style={style}
            title={`/${skill.slug} · ${local.name}`}
            onClick={() => {
              onClose();
              runSkill(skill);
            }}
          >
            <span className="hex" aria-hidden />
            <span className="ic" aria-hidden>
              <Sparkles aria-hidden />
            </span>
            <span className="nm">{skill.slug}</span>
          </button>
        );
      })}
      {overflow > 0 && (
        <button
          type="button"
          className="deck-skill more"
          style={seat(seats - 1)}
          title={t("desktop.deck.more", { n: overflow })}
          onClick={() => {
            onClose();
            navigate("/skills");
          }}
        >
          <span className="hex" aria-hidden />
          <span className="ic" aria-hidden>
            <MoreHorizontal aria-hidden />
          </span>
          <span className="nm">{t("desktop.deck.more", { n: overflow })}</span>
        </button>
      )}
      <p className="deck-hint">{t("desktop.deck.hint")}</p>
    </div>
  );
}
