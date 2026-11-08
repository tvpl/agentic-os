/**
 * "Virou realidade" (.specs/features/cerebro-natureza, design.md "Diálogo - Virou realidade", plan.md amendment 8): the
 * day it became real and, optionally, the fact as three fields. With "Registrar como fato" open and filled, the day goes
 * as `fact.validFrom` (local midnight, in ms); closed, nothing but the decision is sent. A failed save is shown here, and
 * the dialog stays open with what was typed.
 */
import { useId, useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { Modal } from "../../ui";
import { useT } from "../../i18n";
import { errorMessage } from "../../views/shared";

export interface FactInput {
  subject: string;
  predicate: string;
  object: string;
  validFrom: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function BecameFactDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  /** Resolves when saved (the parent closes the dialog); rejects with the error to show. */
  onConfirm: (fact: FactInput | undefined) => Promise<void>;
}) {
  const t = useT();
  const id = useId();
  const [since, setSince] = useState(today);
  const [open, setOpen] = useState(false);
  const [fact, setFact] = useState({ subject: "", predicate: "", object: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const filled = fact.subject.trim() !== "" && fact.predicate.trim() !== "" && fact.object.trim() !== "";
  const confirm = async () => {
    const [y, m, d] = since.split("-").map(Number);
    setBusy(true);
    setError(null);
    try {
      await onConfirm(open ? { ...fact, validFrom: new Date(y!, m! - 1, d!).getTime() } : undefined);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };
  const field = (key: keyof typeof fact, label: string) => (
    <div className="field">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <input
        id={`${id}-${key}`}
        className="input"
        maxLength={200}
        value={fact[key]}
        onChange={(e) => setFact((f) => ({ ...f, [key]: e.target.value }))}
      />
    </div>
  );
  return (
    <Modal title={t("reviews.becameFact")} onClose={onCancel} className="rv-dialog">
      <div className="rv-dialog-body">
        <div className="field">
          <label htmlFor={`${id}-since`}>{t("reviews.fact.since")}</label>
          <input
            id={`${id}-since`}
            className="input"
            type="date"
            value={since}
            onChange={(e) => setSince(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn ghost sm rv-record"
          aria-expanded={open}
          aria-controls={`${id}-fact`}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown aria-hidden />
          {t("reviews.fact.record")}
        </button>
        {open && (
          <fieldset id={`${id}-fact`} className="rv-fact">
            {field("subject", t("reviews.fact.subject"))}
            {field("predicate", t("reviews.fact.predicate"))}
            {field("object", t("reviews.fact.object"))}
          </fieldset>
        )}
        {error && (
          <p className="rv-error" role="alert">
            <AlertTriangle aria-hidden />
            {error}
          </p>
        )}
      </div>
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={busy || !since || (open && !filled)}
          onClick={() => void confirm()}
        >
          {t("reviews.confirm")}
        </button>
      </div>
    </Modal>
  );
}
