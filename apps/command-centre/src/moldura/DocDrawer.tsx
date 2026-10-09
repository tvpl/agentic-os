/** A document, opened from anywhere, in a modal drawer over the content (design Tela 1). */
import { useRef } from "react";
import { X } from "lucide-react";
import { useT } from "../i18n";
import { useDialog } from "../components/dialog";
import DocWindow from "../desktop/DocWindow";
import { docId } from "../desktop/docIds";
import { useScrimPress } from "./hooks";

export function DocDrawer({ path, onClose }: { path: string; onClose: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  // Focus goes in, the rest of the frame is inert, Esc closes, focus returns to what opened it.
  useDialog(ref, onClose, { initialFocus: () => closeButton.current });
  useScrimPress(onClose, true);
  const name = path.split(/[\\/]/).pop() || path;
  return (
    <div
      ref={ref}
      className="mold-drawer mold-doc"
      role="dialog"
      aria-modal="true"
      aria-label={t("moldura.doc.label")}
      tabIndex={-1}
    >
      <div className="mold-drawer-head">
        <span className="mold-drawer-t mono" title={path}>
          {name}
        </span>
        <button type="button" className="btn sm" ref={closeButton} onClick={onClose}>
          <X aria-hidden /> {t("moldura.doc.close")}
        </button>
      </div>
      <div className="mold-drawer-body">
        <DocWindow instanceId={docId(path)} key={path} />
      </div>
    </div>
  );
}
