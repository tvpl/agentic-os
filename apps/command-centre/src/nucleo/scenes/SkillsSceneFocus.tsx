/**
 * The chosen skill as typography (immersive shell, Skills scene): category,
 * name, `/slug`, what it does, what it touches, when it last ran — and what
 * you can do with it. No card: it stands in the middle of the ring.
 */
import type { MouseEvent } from "react";
import {
  Info,
  MessageCircleQuestion,
  MessageSquarePlus,
  PanelRightOpen,
  Play,
  SlidersHorizontal,
  Star,
} from "lucide-react";
import type { RunRecord } from "../../api";
import { useLocale, useT, type TKey } from "../../i18n";
import { timeAgo } from "../../components/ui";
import type { SkillEntry } from "./skillsEntries";
import { askAbout, refWord } from "../subject";

export interface FocusActions {
  onRun: () => void;
  onAsk: () => void;
  /** Show or hide the readings beside the ring. */
  onDetails: () => void;
  detailsOpen: boolean;
  /** The full editor (instructions, inputs, model, notes, export). */
  onEdit: () => void;
  onConfigure: (anchor: HTMLElement) => void;
  onFavorite: () => void;
  onEnable: () => void;
  onOpenRun: (runId: string) => void;
  favoriteBusy: boolean;
  enableBusy: boolean;
}

/** A run status in words; a status without a translation reads as itself. */
function useStatusLabel() {
  const t = useT();
  return (status: string) => {
    const key = `status.${status}`;
    const label = t(key as TKey);
    return label === key ? status.replace(/_/g, " ") : label;
  };
}

export function SkillFocus({
  entry,
  live,
  lastRun,
  actions,
  compact,
}: {
  entry: SkillEntry;
  /** The run in flight for this skill, when there is one. */
  live: RunRecord | null;
  lastRun: RunRecord | null;
  actions: FocusActions;
  compact?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const statusLabel = useStatusLabel();
  const s = entry.skill;
  const required = s.inputs.filter((i) => i.required).length;
  return (
    <div className={`sks-focus${compact ? " compact" : ""}`} data-mode={s.mode} aria-live="polite">
      <div className="sks-eyebrow-row">
        <button
          type="button"
          className="sks-icon"
          aria-pressed={entry.favorite}
          aria-label={t(entry.favorite ? "scene.skills.unfavorite" : "scene.skills.favorite")}
          title={t(entry.favorite ? "scene.skills.unfavorite" : "scene.skills.favorite")}
          disabled={actions.favoriteBusy}
          onClick={actions.onFavorite}
        >
          <Star aria-hidden fill={entry.favorite ? "currentColor" : "none"} />
        </button>
        <p className="sks-eyebrow">{t(`scene.skills.cat.${entry.category}` as TKey)}</p>
        {s.enabled && (
          <button
            type="button"
            className="sks-icon"
            aria-label={t("scene.skills.configure")}
            title={t("scene.skills.configure")}
            onClick={(e: MouseEvent<HTMLButtonElement>) => actions.onConfigure(e.currentTarget)}
          >
            <SlidersHorizontal aria-hidden />
          </button>
        )}
      </div>
      <h2 className="sks-name">{entry.name}</h2>
      <p className="sks-tags">
        <span className="sks-cmd">/{s.slug}</span>
        <span className="tg" data-mode={s.mode}>
          {t(s.mode === "write" ? "scene.skills.writes" : "scene.skills.readOnly")}
        </span>
        {!s.enabled && <span className="tg paused">{t("scene.skills.pausedTag")}</span>}
        {s.providers.length > 0 && <span className="tg prov">{s.providers.join(" · ")}</span>}
        {required > 0 && <span className="tg">{t("scene.skills.needsInputs", { n: required })}</span>}
      </p>
      {entry.description && <p className="sks-desc">{entry.description}</p>}
      <p className="sks-state">
        {live ? (
          <button type="button" className="sks-live" onClick={() => actions.onOpenRun(live.id)}>
            {t("scene.skills.running")} · {t("scene.skills.openRun")}
          </button>
        ) : lastRun ? (
          <button type="button" className="sks-last" onClick={() => actions.onOpenRun(lastRun.id)}>
            {t("desktop.deck.lastRun")} {timeAgo(lastRun.createdAt, locale)} ·{" "}
            <span data-status={lastRun.status}>{statusLabel(lastRun.status)}</span>
          </button>
        ) : (
          <span className="sks-never">{t("desktop.deck.neverRan")}</span>
        )}
      </p>
      <div className="sks-acts">
        {s.enabled ? (
          <button type="button" className="sks-act primary" onClick={actions.onRun}>
            <Play aria-hidden /> {t("scene.skills.run")}
          </button>
        ) : (
          <button
            type="button"
            className="sks-act primary"
            disabled={actions.enableBusy}
            onClick={actions.onEnable}
          >
            <Play aria-hidden /> {t("scene.skills.enable")}
          </button>
        )}
        {/* Compact: the same two actions as labelled glyphs, so the row stays one row. */}
        <button
          type="button"
          className={compact ? "sks-icon" : "sks-act"}
          title={t("scene.skills.askHint", { slug: s.slug })}
          aria-label={compact ? t("scene.skills.ask") : undefined}
          onClick={actions.onAsk}
        >
          {compact ? <MessageSquarePlus aria-hidden /> : t("scene.skills.ask")}
        </button>
        <button
          type="button"
          className={compact ? "sks-icon" : "sks-act"}
          aria-pressed={actions.detailsOpen}
          title={compact ? t("scene.skills.details") : undefined}
          aria-label={compact ? t("scene.skills.details") : undefined}
          onClick={actions.onDetails}
        >
          {compact ? <Info aria-hidden /> : t("scene.skills.details")}
        </button>
        <button
          type="button"
          className={compact ? "sks-icon" : "sks-act"}
          data-details
          title={compact ? t("scene.skills.edit") : undefined}
          aria-label={compact ? t("scene.skills.edit") : undefined}
          onClick={actions.onEdit}
        >
          {compact ? <PanelRightOpen aria-hidden /> : t("scene.skills.edit")}
        </button>
      </div>
    </div>
  );
}

/** Readings beside the ring: the skill's recent runs, its inputs, its model. */
export function SkillReadings({
  entry,
  runs,
  onOpenRun,
}: {
  entry: SkillEntry;
  runs: readonly RunRecord[];
  onOpenRun: (runId: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const statusLabel = useStatusLabel();
  const s = entry.skill;
  return (
    <aside className="sks-read" aria-label={entry.name}>
      <button
        type="button"
        className="sks-read-ask"
        onClick={() =>
          askAbout({
            id: `subject:skill:${s.slug}`,
            kind: "surface",
            ref: refWord("skill", s.slug),
            title: `${entry.name} (skill /${s.slug})`,
          })
        }
      >
        <MessageCircleQuestion aria-hidden /> {t("concept.runs.ask")}
      </button>
      <p className="k">{t("scene.skills.history")}</p>
      {runs.length === 0 ? (
        <p className="v faint">{t("desktop.deck.neverRan")}</p>
      ) : (
        <ul className="sks-runs">
          {runs.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onOpenRun(r.id)}>
                <span className="when">{timeAgo(r.createdAt, locale)}</span>
                <span className="st" data-status={r.status}>
                  {statusLabel(r.status)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="k">{t("scene.skills.inputs")}</p>
      {s.inputs.length === 0 ? (
        <p className="v faint">{t("concept.skills.noInputs")}</p>
      ) : (
        <p className="v">
          {s.inputs.map((i, n) => (
            <span key={i.name}>
              {n > 0 && " · "}
              {i.label || i.name}
              {i.required && <span className="req">*</span>}
            </span>
          ))}
        </p>
      )}
      <p className="k">{t("scene.skills.model")}</p>
      <p className="v mono">
        {s.recommendedModel ?? t("scene.skills.auto")}
        {s.recommendedEffort ? ` · ${s.recommendedEffort}` : ""}
      </p>
      <p className="v mono faint">v{s.version}</p>
    </aside>
  );
}
