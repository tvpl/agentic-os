/**
 * The primitives (.specs/features/primitivas): the only folder that imports `@radix-ui/*`.
 * Views and shells import from here, never from a package or from a file of this folder.
 * `ui.css` is loaded by the two assemblies, `main.tsx` and `gallery/main.tsx`, right after `theme.css`.
 */

export { Modal, DialogSurface } from "./Dialog";
export type { ModalProps, DialogSurfaceProps } from "./Dialog";
export { Popover } from "./Popover";
export type { PopoverProps, PopoverPlacement } from "./Popover";
export { Tabs } from "./Tabs";
export type { TabsProps, TabItem, TabsVariant } from "./Tabs";
export { Switch } from "./Switch";
export type { SwitchProps } from "./Switch";
export { DropdownMenu } from "./Menu";
export type { DropdownMenuProps, MenuEntry, MenuItem, MenuNote, MenuSeparator } from "./Menu";
export { Tooltip, UiProvider } from "./Tooltip";
export type { TooltipProps } from "./Tooltip";
export {
  escapeLayerOpen,
  escapeWasForAnOpenLayer,
  keyLayerOpen,
  getDialogDepth,
  subscribeDialogDepth,
  useDialogDepth,
  useDrawer,
  focusables,
} from "./layers";
