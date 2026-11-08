/**
 * The second confirmation of an accept that closes or retracts facts that exist (cerebro-memoria-confiavel, owner answer
 * G40 / AD-047, design.md "Emenda 3"): a `Modal` that names each fact (the lines the detail already draws, handed in as
 * children) and says what happens to it, "Cancelar" first, then "Aceitar". The primitive focuses the first control that
 * is not the X, which is "Cancelar" (the facts are text), so the safe button holds focus first; Escape and the X cancel
 * too, and focus goes back to the button that asked. A chunk of its own (`lazy`): it is fetched only when an
 * accept of this kind is asked for, so the tab's own chunk does not carry it.
 */
import type { ReactNode } from "react";
import { useT } from "../../i18n";
import { Modal } from "../../ui";

export default function AgentConfirm({
  onCancel,
  onConfirm,
  children,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <Modal title={t("effects.confirm.title")} onClose={onCancel} className="rv-dialog">
      <div className="rv-dialog-body">{children}</div>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button type="button" className="btn primary" onClick={onConfirm}>
          {t("proposals.acceptOne")}
        </button>
      </div>
    </Modal>
  );
}
