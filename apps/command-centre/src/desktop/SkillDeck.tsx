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
import { useLang, useLocale, useT } from "../i18n";
import { useOsSkills } from "../queries";
import { DialogPortal, useDialog, usePresence } from "../components/dialog";
import { localizeSkill } from "../views/Skills/localize";
import { useDesktopActions } from "./actions";
import { useDesktopRuns } from "./data";
import { timeAgo } from "../components/ui";
import { useCommands, type Command } from "../commands/registry";

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
  const locale = useLocale();
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
  // Type to find (refino item 7): the arc shows what matches the words, by
  // slug, name, description and triggers, so "revisa" finds code-review.
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<string | null>(null);
  const runs = useDesktopRuns();
  const { deck, overflow } = useMemo(() => {
    const on = (skills.data ?? []).filter((s) => s.enabled);
    const q = query.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const scored = on
      .map((s) => {
        const local = localizeSkill(s, lang);
        // Where the word hits decides the rank: the slug or name outranks a
        // trigger, which outranks a mention in the description.
        const fields: Array<[string, number]> = [
          [`${s.slug} ${local.name}`.toLowerCase(), 3],
          [(s.triggers ?? []).join(" ").toLowerCase(), 2],
          [(local.description ?? "").toLowerCase(), 1],
        ];
        let score = q ? 0 : 1;
        for (const w of words) {
          const best = fields.find(([text]) => text.includes(w));
          if (!best) {
            score = 0;
            break;
          }
          score += best[1];
        }
        return { s, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || (b.s.favorite ? 1 : 0) - (a.s.favorite ? 1 : 0));
    const ordered = scored.map((x) => x.s);
    return { deck: ordered.slice(0, MAX_ON_ARC), overflow: Math.max(0, ordered.length - MAX_ON_ARC) };
  }, [skills.data, query, lang]);
  const focused = deck.find((s) => s.slug === focus) ?? deck[0] ?? null;
  const lastRun = useMemo(() => {
    if (!focused) return null;
    return (runs.data ?? []).find((r) => r.skillSlug === focused.slug) ?? null;
  }, [runs.data, focused]);
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

  const searchRef = useRef<HTMLInputElement>(null);
  useDialog(ref, onClose, { initialFocus: () => searchRef.current });
  // ⌘J opened the deck; with the deck up (a modal), ⌘J is the deck's own and puts it away.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const commands = useMemo<Command[]>(
    () => [
      {
        id: "deck.close",
        title: "common.close",
        group: "view",
        scope: "modal",
        keys: ["Mod+J"],
        run: () => closeRef.current(),
      },
    ],
    [],
  );
  useCommands(commands);

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
            className={`deck-skill${runningSkills.has(skill.slug) ? " live" : ""}${focused?.slug === skill.slug ? " focus" : ""}`}
            style={style}
            title={`/${skill.slug} · ${local.name}`}
            onMouseEnter={() => setFocus(skill.slug)}
            onFocus={() => setFocus(skill.slug)}
            onClick={() => {
              onClose();
              runSkill(skill);
            }}
          >
            <span className="hex" aria-hidden />
            <span className="ic" aria-hidden>
              <Sparkles aria-hidden />
            </span>
            <span className="nm">{local.name || skill.slug}</span>
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
      <div className="deck-centre">
        <input
          type="search"
          className="deck-search mono"
          placeholder={t("desktop.deck.searchPh")}
          aria-label={t("desktop.deck.searchPh")}
          value={query}
          ref={searchRef}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && focused) {
              e.preventDefault();
              onClose();
              runSkill(focused);
            }
          }}
        />
        {focused ? (
          <div className="deck-focus" aria-live="polite">
            <span className="deck-focus-name">{localizeSkill(focused, lang).name || focused.slug}</span>
            <span className="deck-focus-slug mono">/{focused.slug}</span>
            <span className="deck-focus-desc">{localizeSkill(focused, lang).description}</span>
            <span className="deck-focus-last mono">
              {lastRun
                ? `${t("desktop.deck.lastRun")} ${timeAgo(lastRun.createdAt, locale)} · ${t(`status.${lastRun.status}` as "status.done")}`
                : t("desktop.deck.neverRan")}
            </span>
          </div>
        ) : (
          <p className="deck-hint">{query ? t("desktop.deck.noMatch") : t("desktop.deck.hint")}</p>
        )}
      </div>
    </div>
  );
}
