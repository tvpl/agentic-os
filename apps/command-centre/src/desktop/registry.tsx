/**
 * The panel registry (redesign G1). One entry per instrument surface: id,
 * title key, the `@ref` the console resolves, icon, component, honest
 * minimum for the expanded form.
 *
 * What used to be here — fourteen widgets, per-widget config schemas, the
 * gallery and the presets — went with the dashboard. The prototype has one
 * primitive, the panel, and these are the panels of kind `surface`: the
 * instruments a pod on the right arc opens. Apps (kind `app`), documents
 * (`artifact`) and traces (`run`) are registered elsewhere.
 */
import { Activity, AlertTriangle, CalendarClock, Coins, Inbox, ShieldCheck, Terminal } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import type { TKey } from "../i18n";
import type { WidgetId } from "./defaultLayout";
import type { WidgetProps } from "./widgetTypes";
import BoardWidget from "./widgets/BoardWidget";
import PulseWidget from "./widgets/PulseWidget";
import AttentionWidget from "./widgets/AttentionWidget";
import ApprovalsWidget from "./widgets/ApprovalsWidget";
import PromptWidget from "./widgets/PromptWidget";
import InboxWidget from "./widgets/InboxWidget";
import NowPanel from "./NowPanel";
import CostWidget from "./widgets/CostWidget";

export interface WidgetDefinition {
  id: WidgetId;
  titleKey: TKey;
  /** The `@name` the console uses for this panel; localised, one word. */
  refKey: TKey;
  icon: ReactNode;
  Component: ComponentType<WidgetProps>;
  /**
   * `false` when expanding cannot show more than the compact body already
   * does. The frame hides its expand control for these (redesign F1).
   */
  hasSurface?: boolean;
  /**
   * Smallest box, in CSS pixels, where the expanded composition is honest.
   * Read by the surface layer to decide between the full composition and the
   * compact one centred with room to breathe, instead of stretching.
   */
  surfaceMin?: { w: number; h: number };
}

/** Panels are expandable unless they opt out. */
export function hasSurface(def: WidgetDefinition | undefined): boolean {
  return def?.hasSurface !== false;
}

export const WIDGET_REGISTRY: Record<WidgetId, WidgetDefinition> = {
  now: {
    id: "now",
    surfaceMin: { w: 460, h: 320 },
    titleKey: "now.title",
    refKey: "desktop.ref.now",
    icon: <Activity aria-hidden />,
    Component: NowPanel,
  },
  routines: {
    id: "routines",
    surfaceMin: { w: 400, h: 260 },
    titleKey: "desktop.widget.routines",
    refKey: "desktop.ref.routines",
    icon: <CalendarClock aria-hidden />,
    Component: BoardWidget,
  },
  pulse: {
    id: "pulse",
    surfaceMin: { w: 420, h: 340 },
    titleKey: "desktop.widget.pulse",
    refKey: "desktop.ref.pulse",
    icon: <Activity aria-hidden />,
    Component: PulseWidget,
  },
  attention: {
    id: "attention",
    surfaceMin: { w: 380, h: 220 },
    titleKey: "desktop.widget.attention",
    refKey: "desktop.ref.attention",
    icon: <AlertTriangle aria-hidden />,
    Component: AttentionWidget,
  },
  approvals: {
    id: "approvals",
    surfaceMin: { w: 420, h: 300 },
    titleKey: "desktop.widget.approvals",
    refKey: "desktop.ref.approvals",
    icon: <ShieldCheck aria-hidden />,
    Component: ApprovalsWidget,
  },
  prompt: {
    id: "prompt",
    surfaceMin: { w: 520, h: 380 },
    titleKey: "desktop.widget.prompt",
    refKey: "desktop.ref.prompt",
    icon: <Terminal aria-hidden />,
    Component: PromptWidget,
  },
  inbox: {
    id: "inbox",
    titleKey: "desktop.widget.inbox",
    refKey: "desktop.ref.inbox",
    icon: <Inbox aria-hidden />,
    Component: InboxWidget,
  },
  cost: {
    id: "cost",
    titleKey: "desktop.widget.cost",
    refKey: "desktop.ref.cost",
    icon: <Coins aria-hidden />,
    Component: CostWidget,
  },
};

/** Definition for a layout id. */
export function widgetDefinition(id: string): WidgetDefinition | undefined {
  return WIDGET_REGISTRY[id as WidgetId];
}
