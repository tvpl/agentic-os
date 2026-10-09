/** The bell: the existing notification inbox, dropped from the top bar. */
import { useEffect, useRef } from "react";
import { useT } from "../i18n";
import { InboxList } from "../desktop/widgets/InboxWidget";
import { useOutsidePress } from "./hooks";

/**
 * A popover, not a modal: it closes on a press outside and on Esc (focus goes
 * back to the bell). A modal drawer opened over it takes Esc first, because
 * the dialog stack stops the key before it reaches this listener.
 */
export function BellPopover({
  anchor,
  onClose,
}: {
  /** The wrapper holding the bell button and this popover: a press inside it is not outside. */
  anchor: React.RefObject<HTMLElement | null>;
  onClose: (restoreFocus: boolean) => void;
}) {
  const t = useT();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useOutsidePress(anchor, () => closeRef.current(false));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      closeRef.current(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div
      className="mold-popover"
      role="dialog"
      aria-modal="false"
      aria-label={t("moldura.top.notifications")}
    >
      <InboxList limit={12} />
    </div>
  );
}
