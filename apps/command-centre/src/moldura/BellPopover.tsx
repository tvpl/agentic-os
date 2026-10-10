/** The bell: the existing notification inbox, dropped from the top bar. */
import { useMemo, useRef } from "react";
import { useCommands, type Command } from "../commands/registry";
import { useT } from "../i18n";
import { InboxList } from "../desktop/widgets/InboxWidget";
import { useOutsidePress } from "./hooks";

/**
 * A popover, not a modal: it closes on a press outside and on Esc (focus goes
 * back to the bell; the `moldura` scope). A modal drawer opened over it takes
 * Esc first: a dialog is a layer that hides this scope.
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
  const commands = useMemo<Command[]>(
    () => [
      {
        id: "moldura.bell.close",
        title: "cmd.moldura.bell",
        group: "navigation",
        scope: "moldura",
        keys: ["Escape"],
        allowInInput: true,
        run: () => closeRef.current(true),
      },
    ],
    [],
  );
  useCommands(commands);
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
