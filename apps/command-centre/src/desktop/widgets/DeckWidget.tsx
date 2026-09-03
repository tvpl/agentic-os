/**
 * Skills deck: scrollable, with a visible fade and a "n more" hint while
 * cards are below the fold; names never wrap letter-by-letter.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Play, Settings2, Sparkles } from "lucide-react";
import type { Skill } from "../../api";
import { useT } from "../../i18n";
import { useOsSkills } from "../../queries";
import { shortModel } from "../SkillMatrixModal";
import { WidgetGate } from "./WidgetGate";

export interface DeckWidgetProps {
  onRun: (skill: Skill) => void;
  onConfig: (skill: Skill) => void;
}

export default function DeckWidget({ onRun, onConfig }: DeckWidgetProps) {
  const skills = useOsSkills();
  return (
    <WidgetGate queries={[skills]} lines={4}>
      {skills.data && <DeckBody skills={skills.data} onRun={onRun} onConfig={onConfig} />}
    </WidgetGate>
  );
}

function DeckBody({ skills, onRun, onConfig }: { skills: Skill[] } & DeckWidgetProps) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [below, setBelow] = useState(0);
  const deck = useMemo(() => {
    const favorites = skills.filter((s) => s.favorite && s.enabled);
    const rest = skills.filter((s) => s.enabled && !s.favorite);
    return [...favorites, ...rest];
  }, [skills]);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const fold = el.scrollTop + el.clientHeight;
    let n = 0;
    for (const card of Array.from(el.querySelectorAll<HTMLElement>(".deck-card"))) {
      if (card.offsetTop + card.offsetHeight * 0.5 > fold) n += 1;
    }
    setBelow(n);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, deck.length]);

  const effortLabel = (effort: string) => {
    const key = `effort.${effort}` as Parameters<typeof t>[0];
    const label = t(key);
    return label === key ? effort : label;
  };

  return (
    <div className="deck">
      <div className="deck-head">
        <span className="deck-hint">{t("dash.tapToRun")}</span>
        <Link to="/skills" className="deck-add">
          {t("dash.addSkill")}
        </Link>
      </div>
      <div className={`deck-scroll${below > 0 ? " has-more" : ""}`} ref={scrollRef} onScroll={measure}>
        <div className="deck-grid">
          {deck.map((s) => (
            <div className="deck-card" key={s.slug}>
              <Sparkles className="deck-icon" aria-hidden />
              <Link to={`/skills/${s.slug}`} className="slug" title={`/${s.slug}`}>
                /{s.slug}
              </Link>
              <div className="config">
                <span className="model">{shortModel(s.recommendedModel)}</span>
                <span className="sep">·</span>
                <span className="effort">{effortLabel(s.recommendedEffort)}</span>
              </div>
              <div className="deck-actions">
                <button type="button" className="btn sm outline-accent icon-only" onClick={() => onRun(s)} aria-label={`${t("common.run")} /${s.slug}`}>
                  <Play aria-hidden />
                </button>
                <button type="button" className="btn sm ghost icon-only" onClick={() => onConfig(s)} aria-label={`${t("matrix.title")} /${s.slug}`}>
                  <Settings2 aria-hidden />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {below > 0 && (
        <button
          type="button"
          className="deck-more"
          onClick={() => scrollRef.current?.scrollBy({ top: scrollRef.current.clientHeight * 0.8, behavior: "smooth" })}
        >
          {t("widget.more", { n: below })}
        </button>
      )}
    </div>
  );
}
