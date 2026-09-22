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
import {
  Activity,
  AlertTriangle,
  BookOpen,
  CalendarClock,
  Coins,
  Eye,
  Inbox,
  Lightbulb,
  ShieldCheck,
  Target,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import type { TKey } from "../i18n";
import type { WidgetId } from "./defaultLayout";
import type { WidgetProps } from "./widgetTypes";
import BoardWidget from "./widgets/BoardWidget";
import PulseWidget from "./widgets/PulseWidget";
import AttentionWidget from "./widgets/AttentionWidget";
import ApprovalsWidget from "./widgets/ApprovalsWidget";
import InboxWidget from "./widgets/InboxWidget";
import NowPanel from "./NowPanel";
import CostWidget from "./widgets/CostWidget";
import MissionWidget from "./widgets/MissionWidget";
import SentinelsWidget from "./widgets/SentinelsWidget";
import FactsWidget from "./widgets/FactsWidget";
import JournalWidget from "./widgets/JournalWidget";

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
  mission: {
    id: "mission",
    surfaceMin: { w: 480, h: 360 },
    titleKey: "desktop.widget.mission",
    refKey: "desktop.ref.mission",
    icon: <Target aria-hidden />,
    Component: MissionWidget,
  },
  sentinels: {
    id: "sentinels",
    surfaceMin: { w: 420, h: 320 },
    titleKey: "desktop.widget.sentinels",
    refKey: "desktop.ref.sentinels",
    icon: <Eye aria-hidden />,
    Component: SentinelsWidget,
  },
  facts: {
    id: "facts",
    surfaceMin: { w: 440, h: 320 },
    titleKey: "desktop.widget.facts",
    refKey: "desktop.ref.facts",
    icon: <Lightbulb aria-hidden />,
    Component: FactsWidget,
  },
  journal: {
    id: "journal",
    surfaceMin: { w: 440, h: 360 },
    titleKey: "desktop.widget.journal",
    refKey: "desktop.ref.journal",
    icon: <BookOpen aria-hidden />,
    Component: JournalWidget,
  },
};

/** Definition for a layout id. */
export function widgetDefinition(id: string): WidgetDefinition | undefined {
  return WIDGET_REGISTRY[id as WidgetId];
}
