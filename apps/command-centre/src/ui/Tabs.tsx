/**
 * Tabs on Radix (.specs/features/primitivas): one tab stop, the arrow keys,
 * Home and End, and `aria-selected` / `aria-controls` tied to one tabpanel.
 *
 * Three looks, chosen by `variant`: `line` (an underline), `list` (a vertical
 * navigation, the Settings') and `pill` (a rounded bar, the Núcleo's run tabs).
 * `Tabs` is the usual one-piece form (the list, and the active panel as its
 * children); `Tabs.Root`, `.List`, `.Group`, `.Tab` and `.Panel` are its parts,
 * for a screen whose list and panel live in different places of the layout.
 */
import { createContext, useContext, useId, type ComponentPropsWithoutRef, type ReactNode } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

export type TabsVariant = "line" | "list" | "pill";

export interface TabItem {
  id: string;
  label: ReactNode;
  /** With the `list` variant: the heading of the group this tab opens (set on the first tab of a group). */
  group?: ReactNode;
}

interface Ids {
  /** Id of a tab; default `${id}-tab-${tab}`. */
  tab: (tab: string) => string;
  /** Id of the panel; default `${id}-panel-${tab}`. */
  panel: (tab: string) => string;
}

interface TabsState extends Ids {
  value: string;
  onChange: (id: string) => void;
}

const TabsContext = createContext<TabsState | null>(null);
function useTabs(): TabsState {
  const state = useContext(TabsContext);
  if (!state) throw new Error("Tabs.Tab and Tabs.Panel go inside Tabs.Root");
  return state;
}

export interface TabsRootProps {
  value: string;
  onChange: (id: string) => void;
  orientation?: "horizontal" | "vertical";
  /** Id base shared by the tabs and the panel: `${id}-tab-${tab}` and `${id}-panel-${tab}`. */
  id?: string;
  /** Override the default ids (a panel shared by every tab, say). */
  ids?: Partial<Ids>;
  className?: string;
  children: ReactNode;
}

function TabsRoot({
  value,
  onChange,
  orientation = "horizontal",
  id,
  ids,
  className,
  children,
}: TabsRootProps) {
  const generated = useId();
  const base = id ?? generated;
  const state: TabsState = {
    value,
    onChange,
    tab: ids?.tab ?? ((tab) => `${base}-tab-${tab}`),
    panel: ids?.panel ?? ((tab) => `${base}-panel-${tab}`),
  };
  return (
    <TabsContext.Provider value={state}>
      <TabsPrimitive.Root
        value={value}
        onValueChange={onChange}
        orientation={orientation}
        className={["ui-tabs-root", className ?? ""].filter(Boolean).join(" ")}
      >
        {children}
      </TabsPrimitive.Root>
    </TabsContext.Provider>
  );
}

function TabsList({
  label,
  variant = "line",
  className,
  children,
}: {
  label?: string;
  variant?: TabsVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <TabsPrimitive.List
      aria-label={label}
      data-variant={variant}
      className={["ui-tabs-list", variant === "line" ? "tabs" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </TabsPrimitive.List>
  );
}

/** The heading of a group of tabs in the `list` look: a label, not a tab. */
function TabsGroup({ children }: { children: ReactNode }) {
  return (
    <div role="presentation" className="ui-tabs-group">
      {children}
    </div>
  );
}

function TabsTab({ value, className, children }: { value: string; className?: string; children: ReactNode }) {
  const state = useTabs();
  return (
    <TabsPrimitive.Trigger
      value={value}
      id={state.tab(value)}
      aria-controls={state.panel(value)}
      className={className}
      // Radix selects on mouse down and on focus; a click that reaches us by itself (a script, a tap) selects too.
      onClick={() => value !== state.value && state.onChange(value)}
    >
      {children}
    </TabsPrimitive.Trigger>
  );
}

function TabsPanel({
  value,
  className,
  children,
  ...rest
}: {
  /** The tab this panel belongs to; default the active one. */
  value?: string;
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"div">, "id" | "className" | "role" | "children" | "aria-labelledby">) {
  const state = useTabs();
  const tab = value ?? state.value;
  return (
    <TabsPrimitive.Content
      {...rest}
      value={tab}
      id={state.panel(tab)}
      aria-labelledby={state.tab(tab)}
      className={className}
    >
      {children}
    </TabsPrimitive.Content>
  );
}

export interface TabsProps extends Pick<TabsRootProps, "id" | "ids" | "orientation"> {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
  variant?: TabsVariant;
  /** The active tab's panel content; omit it when the panel is rendered elsewhere with `Tabs.Panel`. */
  children?: ReactNode;
  className?: string;
  panelClassName?: string;
  panelProps?: Omit<ComponentPropsWithoutRef<"div">, "id" | "className" | "role" | "children">;
}

function TabsOnePiece({
  tabs,
  active,
  onChange,
  ariaLabel,
  variant = "line",
  children,
  className,
  panelClassName,
  panelProps,
  ...root
}: TabsProps) {
  return (
    <TabsRoot value={active} onChange={onChange} {...root}>
      <TabsList label={ariaLabel} variant={variant} className={className}>
        {tabs.map((tab) => (
          <TabItemView key={tab.id} tab={tab} grouped={variant === "list"} />
        ))}
      </TabsList>
      {children !== undefined && (
        <TabsPanel className={panelClassName} {...panelProps}>
          {children}
        </TabsPanel>
      )}
    </TabsRoot>
  );
}

function TabItemView({ tab, grouped }: { tab: TabItem; grouped: boolean }) {
  return (
    <>
      {grouped && tab.group !== undefined && <TabsGroup>{tab.group}</TabsGroup>}
      <TabsTab value={tab.id}>{tab.label}</TabsTab>
    </>
  );
}

export const Tabs = Object.assign(TabsOnePiece, {
  Root: TabsRoot,
  List: TabsList,
  Group: TabsGroup,
  Tab: TabsTab,
  Panel: TabsPanel,
});
