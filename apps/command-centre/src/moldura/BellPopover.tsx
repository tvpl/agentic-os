/** The bell: the existing notification inbox, dropped from the top bar. */
import type { RefObject } from "react";
import { useT } from "../i18n";
import { InboxList } from "../desktop/widgets/InboxWidget";
import { Popover } from "../ui";

/**
 * A popover, not a modal: it closes on a press outside and on Esc (focus goes
 * back to the bell when Esc closed it). A modal drawer opened over it takes
 * Esc first: a dialog is a layer above this one.
 */
export function BellPopover({
  open,
  anchor,
  onClose,
}: {
  open: boolean;
  /** The bell button: the popover hangs from it and focus goes back to it. */
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Popover
      open={open}
      onClose={onClose}
      anchor={anchor}
      placement="bottom-end"
      portal={false}
      ariaLabel={t("moldura.top.notifications")}
      className="mold-popover"
    >
      <InboxList limit={12} />
    </Popover>
  );
}
