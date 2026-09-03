/**
 * "MODEL + EFFORT" popover anchored to a deck card (RUBRIC 1.5): rows are
 * models, columns are efforts; one coloured pill bar fills from LOW up to
 * the chosen effort on the chosen row and slides to another row (transform,
 * 200 ms) when it is clicked. Persists through `useSaveSkillMatrix`, the
 * same PUT as `SkillMatrixModal`.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import type { ProviderId, ProviderSnapshot, Skill } from "../api";
import { DialogPortal, useDialog, usePresence } from "../components/dialog";
import { Segmented } from "../components/primitives";
import { EFFORTS, pickProvider, shortModel, skillEffort, useEffortLabels, useProviderModels, useSaveSkillMatrix, type Effort } from "./SkillMatrixModal";
import { modelFamily } from "./data";

export interface ModelEffortPopoverProps {
  skill: Skill;
  providers: ProviderSnapshot[];
  anchor: HTMLElement;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const WIDTH = 300;
const ROW_H = 30;
const LABEL_W = 64;

export default function ModelEffortPopover({ skill, providers, anchor, open, onClose, onSaved }: ModelEffortPopoverProps) {
  const t = useT();
  const labels = useEffortLabels();
  const ref = useRef<HTMLDivElement>(null);
  const { mounted, closing } = usePresence(open, 160);
  const { enabled, initial } = pickProvider(skill, providers);
  const [provider, setProvider] = useState<ProviderId>(initial);
  const models = useProviderModels(provider);
  const [model, setModel] = useState<string | null>(skill.recommendedModel ?? null);
  const [effort, setEffort] = useState<Effort>(skillEffort(skill));
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean }>({ left: 0, top: 0, below: true });
  const save = useSaveSkillMatrix(skill, onSaved);

  useDialog(ref, onClose, { initialFocus: () => ref.current });

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const height = 60 + ROW_H * (2 + (models.data?.length ?? 0));
    const below = r.bottom + height + 12 < window.innerHeight || r.top - height < 0;
    const left = Math.max(8, Math.min(window.innerWidth - WIDTH - 8, r.right - WIDTH));
    setPos({ left, top: below ? r.bottom + 6 : r.top - height - 6, below });
  }, [anchor, models.data]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => onClose();
    window.addEventListener("resize", onScroll);
    return () => window.removeEventListener("resize", onScroll);
  }, [open, onClose]);

  if (!mounted) return null;
  const rows: Array<{ id: string | null; label: string }> = [{ id: null, label: "AUTO" }, ...(models.data ?? []).map((m) => ({ id: m.id, label: shortModel(m.id) }))];
  const rowIdx = Math.max(
    0,
    rows.findIndex((r) => r.id === model),
  );
  const effortIdx = EFFORTS.indexOf(effort);
  const family = modelFamily(model);
  const pick = (m: string | null, e: Effort) => {
    setModel(m);
    setEffort(e);
    save.mutate({ model: m, effort: e });
  };

  return (
    <DialogPortal>
      <div
        ref={ref}
        className={`me-popover${closing ? " closing" : ""}${pos.below ? "" : " above"}`}
        role="dialog"
        aria-modal="false"
        aria-label={`/${skill.slug} — ${t("desktop.deck.modelEffort")}`}
        tabIndex={-1}
        style={{ left: pos.left, top: pos.top, width: WIDTH }}
      >
        <div className="me-head">
          <span className="hud-label accent">{t("desktop.deck.modelEffort")}</span>
          <span className="mono me-skill">/{skill.slug}</span>
        </div>
        {enabled.length > 1 && (
          <Segmented size="sm" ariaLabel={t("skills.provider")} value={provider} onChange={setProvider} options={enabled.map((p) => ({ value: p.id, label: p.id }))} className="me-provider" />
        )}
        <div className="me-matrix" style={{ "--me-label-w": `${LABEL_W}px`, "--me-row-h": `${ROW_H}px` } as React.CSSProperties}>
          <div className="me-cols" aria-hidden>
            <span />
            {EFFORTS.map((e) => (
              <span key={e} className="me-col">
                {labels[e]}
              </span>
            ))}
          </div>
          <div className="me-rows" role="grid" aria-busy={save.isPending || models.isPending}>
            <div
              className={`me-bar model-${family}`}
              aria-hidden
              style={{ transform: `translateY(${rowIdx * ROW_H}px) scaleX(${(effortIdx + 1) / EFFORTS.length})` }}
            />
            {rows.map((row, ri) => (
              <div key={row.id ?? "auto"} className={`me-row${ri === rowIdx ? " active" : ""}`} role="row">
                <span className={`me-model model-${modelFamily(row.id)}`} role="rowheader">
                  {row.label}
                </span>
                {EFFORTS.map((e, ei) => {
                  const selected = ri === rowIdx && e === effort;
                  return (
                    <button
                      key={e}
                      type="button"
                      role="gridcell"
                      className={`me-cell${selected ? " selected" : ""}${ri === rowIdx && ei <= effortIdx ? " filled" : ""}`}
                      aria-label={`${row.label} · ${labels[e]}`}
                      aria-pressed={selected}
                      disabled={save.isPending}
                      onClick={() => pick(row.id, e)}
                    >
                      <span className="me-dot" />
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <p className="me-hint">{t("matrix.hint")}</p>
      </div>
    </DialogPortal>
  );
}
