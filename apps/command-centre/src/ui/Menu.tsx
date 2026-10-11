/**
 * A menu of actions on Radix (.specs/features/primitivas): the trigger opens it
 * (pointer, Enter, Space, ArrowDown), the arrow keys, Home, End and typed
 * letters move, Enter or Space runs the item and closes, Escape closes and
 * puts focus back on the trigger. The menu is named by its trigger, which is
 * what Radix points `aria-labelledby` at.
 */
import { useState, type ReactElement, type ReactNode } from "react";
import * as MenuPrimitive from "@radix-ui/react-dropdown-menu";
import { useCommandScope } from "../commands/registry";
import { Tooltip } from "./Tooltip";

export interface MenuItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  /** An extra class on the item (the accent variant of a "new" action). */
  className?: string;
}

export interface DropdownMenuProps {
  /** The element that opens the menu: it keeps its own markup, the menu only adds the behaviour. */
  trigger: ReactElement;
  /** The hint of the trigger when it has only an icon. */
  tip?: ReactNode;
  items: MenuItem[];
  align?: "start" | "center" | "end";
  className?: string;
}

export function DropdownMenu({ trigger, tip, items, align = "end", className }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
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
          align={align}
          loop
          sideOffset={10}
          collisionPadding={8}
          className={["ui-menu", className ?? ""].filter(Boolean).join(" ")}
        >
          {items.map((item) => (
            <MenuPrimitive.Item
              key={item.id}
              className={["ui-menu-item", item.className ?? ""].filter(Boolean).join(" ")}
              onSelect={item.onSelect}
            >
              {item.icon}
              {item.label}
            </MenuPrimitive.Item>
          ))}
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}
