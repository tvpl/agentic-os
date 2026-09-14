/**
 * The widget registry (analysis item 23). One entry per widget: id, title
 * key, icon, component, default box, minimum size and an optional
 * `configSchema` rendered by the gear popover in edit mode and persisted in
 * `settings.dashboardLayout[id].config`.
 *
 * Everything that used to be a hard-coded map in `index.tsx` lives here, so
 * the "Add widget" gallery and the per-widget settings are derived, never
 * written twice.
 */
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CalendarClock,
  CalendarDays,
  Coins,
  Grid3x3,
  Inbox,
  Mail,
  Sparkles,
  Terminal,
  Timer,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import type { TKey } from "../i18n";
import { baseId, type WidgetId } from "./defaultLayout";
import type { ConfigField, WidgetProps } from "./widgetTypes";
import MicroAppsWidget from "./widgets/MicroAppsWidget";
import TodayWidget from "./widgets/TodayWidget";
import WorkspaceWidget from "./widgets/WorkspaceWidget";
import DeckWidget from "./widgets/DeckWidget";
import BoardWidget from "./widgets/BoardWidget";
import PulseWidget from "./widgets/PulseWidget";
import AttentionWidget from "./widgets/AttentionWidget";
import PromptWidget from "./widgets/PromptWidget";
import InboxWidget from "./widgets/InboxWidget";
import AgendaWidget from "./widgets/AgendaWidget";
import CalendarWidget from "./widgets/CalendarWidget";
import EmailWidget from "./widgets/EmailWidget";
import NowPanel from "./NowPanel";
import CostWidget from "./widgets/CostWidget";

export interface WidgetDefinition {
  id: WidgetId;
  titleKey: TKey;
  icon: ReactNode;
  Component: ComponentType<WidgetProps>;
  configSchema?: readonly ConfigField[];
  /** May be added more than once ("today:2"). */
  duplicable?: boolean;
  /**
   * `false` when expanding cannot show more than the compact body already
   * does — the clock is the whole datum, so a full-screen clock is 70 % empty
   * space and a promise the widget cannot keep. The frame hides its maximize
   * control for these (redesign F1).
   */
  hasSurface?: boolean;
  /**
   * Smallest box, in CSS pixels, where the expanded composition is honest.
   * Read by the surface layer to decide between the full composition and the
   * compact one centred with room to breathe, instead of stretching.
   */
  surfaceMin?: { w: number; h: number };
}

/** Widgets are expandable unless they opt out. */
export function hasSurface(def: WidgetDefinition | undefined): boolean {
  return def?.hasSurface !== false;
}

const TZ_OPTIONS = [
  "UTC",
  "America/Los_Angeles",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Lisbon",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Australia/Sydney",
].map((value) => ({ value, label: value.split("/").pop()!.replace(/_/g, " ") }));

export const WIDGET_REGISTRY: Record<WidgetId, WidgetDefinition> = {
  now: {
    id: "now",
    surfaceMin: { w: 460, h: 320 },
    titleKey: "now.title",
    icon: <Activity aria-hidden />,
    Component: NowPanel,
  },
  microapps: {
    id: "microapps",
    titleKey: "desktop.widget.microapps",
    icon: <Grid3x3 aria-hidden />,
    Component: MicroAppsWidget,
  },
  today: {
    id: "today",
    titleKey: "desktop.widget.today",
    icon: <CalendarClock aria-hidden />,
    Component: TodayWidget,
    duplicable: true,
    // The time is the whole datum: expanding it adds nothing.
    hasSurface: false,
    configSchema: [
      { key: "analog", kind: "toggle", labelKey: "desktop.cfg.analog", default: true },
      { key: "seconds", kind: "toggle", labelKey: "desktop.cfg.seconds", default: true },
      { key: "quarterGrid", kind: "toggle", labelKey: "desktop.cfg.quarterGrid", default: true },
      {
        key: "zone1",
        kind: "select",
        labelKey: "desktop.cfg.zone1",
        options: TZ_OPTIONS,
        default: "America/Los_Angeles",
      },
      {
        key: "zone2",
        kind: "select",
        labelKey: "desktop.cfg.zone2",
        options: TZ_OPTIONS,
        default: "America/New_York",
      },
      {
        key: "zone3",
        kind: "select",
        labelKey: "desktop.cfg.zone3",
        options: TZ_OPTIONS,
        default: "Europe/London",
      },
    ],
  },
  workspace: {
    id: "workspace",
    titleKey: "desktop.widget.workspace",
    icon: <BrainCircuit aria-hidden />,
    Component: WorkspaceWidget,
    configSchema: [{ key: "rows", kind: "number", labelKey: "desktop.cfg.rows", min: 2, max: 8, default: 4 }],
  },
  deck: {
    id: "deck",
    surfaceMin: { w: 420, h: 360 },
    titleKey: "desktop.widget.deck",
    icon: <Sparkles aria-hidden />,
    Component: DeckWidget,
  },
  routines: {
    id: "routines",
    surfaceMin: { w: 400, h: 260 },
    titleKey: "desktop.widget.routines",
    icon: <CalendarClock aria-hidden />,
    Component: BoardWidget,
    configSchema: [
      { key: "limit", kind: "number", labelKey: "desktop.cfg.limit", min: 3, max: 12, default: 8 },
    ],
  },
  pulse: {
    id: "pulse",
    surfaceMin: { w: 420, h: 340 },
    titleKey: "desktop.widget.pulse",
    icon: <Activity aria-hidden />,
    Component: PulseWidget,
    configSchema: [
      { key: "days", kind: "number", labelKey: "desktop.cfg.days", min: 7, max: 30, default: 14 },
    ],
  },
  attention: {
    id: "attention",
    surfaceMin: { w: 380, h: 220 },
    titleKey: "desktop.widget.attention",
    icon: <AlertTriangle aria-hidden />,
    Component: AttentionWidget,
  },
  prompt: {
    id: "prompt",
    surfaceMin: { w: 520, h: 380 },
    titleKey: "desktop.widget.prompt",
    icon: <Terminal aria-hidden />,
    Component: PromptWidget,
    configSchema: [
      {
        key: "mode",
        kind: "select",
        labelKey: "desktop.cfg.mode",
        options: [
          { value: "read_only", labelKey: "desktop.prompt.readOnly" },
          { value: "write", labelKey: "desktop.prompt.write" },
        ],
        default: "read_only",
      },
    ],
  },
  inbox: {
    id: "inbox",
    titleKey: "desktop.widget.inbox",
    icon: <Inbox aria-hidden />,
    Component: InboxWidget,
    configSchema: [
      { key: "limit", kind: "number", labelKey: "desktop.cfg.limit", min: 3, max: 20, default: 8 },
      { key: "unreadOnly", kind: "toggle", labelKey: "desktop.cfg.unread", default: false },
    ],
  },
  agenda: {
    id: "agenda",
    titleKey: "desktop.widget.agenda",
    icon: <Timer aria-hidden />,
    Component: AgendaWidget,
    configSchema: [
      {
        key: "span",
        kind: "select",
        labelKey: "desktop.cfg.span",
        options: [
          { value: "24h", label: "24h" },
          { value: "7d", label: "7d" },
        ],
        default: "24h",
      },
    ],
  },
  calendar: {
    id: "calendar",
    titleKey: "desktop.widget.calendar",
    icon: <CalendarDays aria-hidden />,
    Component: CalendarWidget,
    configSchema: [
      {
        key: "connector",
        kind: "text",
        labelKey: "desktop.cfg.connector",
        placeholder: "calendar-google",
        default: "calendar-google",
      },
    ],
  },
  email: {
    id: "email",
    titleKey: "desktop.widget.email",
    icon: <Mail aria-hidden />,
    Component: EmailWidget,
    configSchema: [
      {
        key: "connector",
        kind: "text",
        labelKey: "desktop.cfg.connector",
        placeholder: "email-gmail",
        default: "email-gmail",
      },
      { key: "limit", kind: "number", labelKey: "desktop.cfg.limit", min: 1, max: 8, default: 3 },
    ],
  },
  cost: {
    id: "cost",
    titleKey: "desktop.widget.cost",
    icon: <Coins aria-hidden />,
    Component: CostWidget,
  },
};

/** Definition for a layout id, resolving duplicates ("today:2" → today). */
export function widgetDefinition(instanceId: string): WidgetDefinition | undefined {
  return WIDGET_REGISTRY[baseId(instanceId) as WidgetId];
}

/** Defaults declared by a widget's `configSchema` (the base every stored config merges over). */
export function defaultConfig(def: WidgetDefinition | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of def?.configSchema ?? []) out[field.key] = field.default;
  return out;
}
