/**
 * The index pass in the Second Brain bar (.specs/features/cerebro-v2, design.md "Tela - Progresso da indexação"): the
 * phase and the counters in text, a Cancel button while a pass runs, and how a pass that did not finish ended, in
 * text with its icon (never by colour alone).
 */
import type { CSSProperties } from "react";
import { Ban, CircleAlert } from "lucide-react";
import type { IndexProgressPayload } from "../api";
import { useT, type TKey } from "../i18n";

export interface IndexProgressProps {
  progress: IndexProgressPayload | null;
  /** A pass this screen asked for is running (before its first progress arrives). */
  refreshing: boolean;
  /** How the last pass ended when it did not finish. */
  note: "cancelled" | "failed" | null;
  onCancel: () => void;
}

export function IndexProgress({ progress, refreshing, note, onCancel }: IndexProgressProps) {
  const t = useT();
  if (progress !== null || refreshing) {
    const ratio = progress?.total ? Math.min(1, progress.scanned / progress.total) : 0;
    return (
      <div className="brain-progress" role="status" aria-live="polite">
        <span>
          {progress?.phase ? t(`brain.index.phase.${progress.phase}` as TKey) : t("brain.indexing")}
          {progress ? ` · ${progress.scanned}${progress.total ? ` / ${progress.total}` : ""}` : "…"}
        </span>
        <div className={`bar${progress?.total ? "" : " indeterminate"}`}>
          <span style={{ "--p": ratio } as CSSProperties} />
        </div>
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          {t("brain.index.cancel")}
        </button>
      </div>
    );
  }
  if (note === null) return null;
  return (
    <div className="brain-progress note" role="status" aria-live="polite">
      {note === "cancelled" ? <Ban aria-hidden /> : <CircleAlert aria-hidden />}
      <span>{t(note === "cancelled" ? "brain.index.cancelled" : "brain.index.failed")}</span>
    </div>
  );
}
