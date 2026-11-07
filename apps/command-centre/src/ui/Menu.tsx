/**
 * A menu of actions on Radix (.specs/features/primitivas): the trigger opens it
 * (pointer, Enter, Space, ArrowDown), the arrow keys, Home, End and typed
 * letters move, Enter or Space runs the item and closes, Escape closes and
 * puts focus back on the trigger. The menu is named by its trigger, which is
 * what Radix points `aria-labelledby` at.
 */
import { useRef, useState, type ReactElement, type ReactNode } from "react";
import * as MenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { useCommandScope } from "../commands/registry";
import { noteEscape } from "./layers";
import { Tooltip } from "./Tooltip";

export interface MenuItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  /** An extra class on the item (the accent variant of a "new" action). */
  className?: string;
  /** One choice of a set: the item says whether it is the chosen one (`aria-checked`, and a check mark). */
  checked?: boolean;
  /** Run and keep the menu open (asking again for what it lists). */
  keepOpen?: boolean;
}
/** A line between two groups of items. */
export interface MenuSeparator {
  id: string;
  separator: true;
}
/** A line of text that is not an action: what the menu has to say (empty, loading, failed). */
export interface MenuNote {
  id: string;
  note: ReactNode;
  icon?: ReactNode;
}
export type MenuEntry = MenuItem | MenuSeparator | MenuNote;

export interface DropdownMenuProps {
  /** The element that opens the menu: it keeps its own markup, the menu only adds the behaviour. */
  trigger: ReactElement;
  /** The hint of the trigger when it has only an icon. */
  tip?: ReactNode;
  items: MenuEntry[];
  align?: "start" | "center" | "end";
  className?: string;
  /** Open it from elsewhere (a command): controlled when given, with `onOpenChange`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function DropdownMenu({
  trigger,
  tip,
  items,
  align = "end",
  className,
  open: controlled,
  onOpenChange,
}: DropdownMenuProps) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const setOpen = (next: boolean) => {
    setOwn(next);
    onOpenChange?.(next);
  };
  const panel = useRef<HTMLDivElement>(null);
  // While it is open the menu is a layer for the command registry, as a dialog is: the letters it
  // types to find an item, and the keys of the screen behind it, are not the screen's to answer.
  useCommandScope("overlay", open);
  return (
    // Not modal, like the popover: the page behind stays as it is (nothing `aria-hidden` with focus inside it);
    // a press outside closes the menu, and Tab inside it is held by the menu.
    <MenuPrimitive.Root modal={false} open={open} onOpenChange={setOpen}>
      <MenuPrimitive.Trigger asChild>
        <Tooltip label={tip}>{trigger}</Tooltip>
      </MenuPrimitive.Trigger>
      <MenuPrimitive.Portal container={document.getElementById("modal-root") ?? undefined}>
        <MenuPrimitive.Content
          ref={panel}
          onEscapeKeyDown={(event) => noteEscape(event, panel.current)}
          align={align}
          loop
          sideOffset={10}
          collisionPadding={8}
          className={["ui-menu", className ?? ""].filter(Boolean).join(" ")}
        >
          {items.map((item) => {
            if ("separator" in item) return <MenuPrimitive.Separator key={item.id} className="ui-menu-sep" />;
            if ("note" in item)
              return (
                <MenuPrimitive.Label key={item.id} className="ui-menu-note">
                  {item.icon}
                  {item.note}
                </MenuPrimitive.Label>
              );
            const select = (event: Event) => {
              if (item.keepOpen) event.preventDefault();
              item.onSelect();
            };
            const itemClass = ["ui-menu-item", item.className ?? ""].filter(Boolean).join(" ");
            if (item.checked !== undefined)
              return (
                <MenuPrimitive.CheckboxItem
                  key={item.id}
                  className={itemClass}
                  checked={item.checked}
                  onSelect={select}
                >
                  <span className="ui-menu-check" aria-hidden>
                    {item.checked && <Check />}
                  </span>
                  {item.icon}
                  {item.label}
                </MenuPrimitive.CheckboxItem>
              );
            return (
              <MenuPrimitive.Item key={item.id} className={itemClass} onSelect={select}>
                {item.icon}
                {item.label}
              </MenuPrimitive.Item>
            );
          })}
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}
