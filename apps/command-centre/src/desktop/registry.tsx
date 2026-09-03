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
import { DEFAULT_LAYOUT, MIN_H, MIN_W, baseId, type WidgetId } from "./defaultLayout";
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
import CostWidget from "./widgets/CostWidget";

export interface WidgetDefinition {
  id: WidgetId;
  titleKey: TKey;
  icon: ReactNode;
  Component: ComponentType<WidgetProps>;
  /** Default box for a freshly added instance. */
  box: { w: number; h: number };
  min: { w: number; h: number };
  configSchema?: readonly ConfigField[];
  /** May be added more than once ("today:2"). */
  duplicable?: boolean;
}

const box = (id: WidgetId) => ({ w: DEFAULT_LAYOUT[id]!.w, h: DEFAULT_LAYOUT[id]!.h });
const min = { w: MIN_W, h: MIN_H };

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
  microapps: {
    id: "microapps",
    titleKey: "desktop.widget.microapps",
    icon: <Grid3x3 aria-hidden />,
    Component: MicroAppsWidget,
    box: box("microapps"),
    min,
  },
  today: {
    id: "today",
    titleKey: "desktop.widget.today",
    icon: <CalendarClock aria-hidden />,
    Component: TodayWidget,
    box: box("today"),
    min: { w: 4, h: 5 },
    duplicable: true,
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
    box: box("workspace"),
    min,
    configSchema: [{ key: "rows", kind: "number", labelKey: "desktop.cfg.rows", min: 2, max: 8, default: 4 }],
  },
  deck: {
    id: "deck",
    titleKey: "desktop.widget.deck",
    icon: <Sparkles aria-hidden />,
    Component: DeckWidget,
    box: box("deck"),
    min: { w: 4, h: 5 },
  },
  routines: {
    id: "routines",
    titleKey: "desktop.widget.routines",
    icon: <CalendarClock aria-hidden />,
    Component: BoardWidget,
    box: box("routines"),
    min,
    configSchema: [
      { key: "limit", kind: "number", labelKey: "desktop.cfg.limit", min: 3, max: 12, default: 8 },
    ],
  },
  pulse: {
    id: "pulse",
    titleKey: "desktop.widget.pulse",
    icon: <Activity aria-hidden />,
    Component: PulseWidget,
    box: box("pulse"),
    min,
    configSchema: [
      { key: "days", kind: "number", labelKey: "desktop.cfg.days", min: 7, max: 30, default: 14 },
    ],
  },
  attention: {
    id: "attention",
    titleKey: "desktop.widget.attention",
    icon: <AlertTriangle aria-hidden />,
    Component: AttentionWidget,
    box: box("attention"),
    min,
  },
  prompt: {
    id: "prompt",
    titleKey: "desktop.widget.prompt",
    icon: <Terminal aria-hidden />,
    Component: PromptWidget,
    box: box("prompt"),
    min: { w: 6, h: 3 },
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
    box: box("inbox"),
    min,
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
    box: box("agenda"),
    min,
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
    box: box("calendar"),
    min,
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
    box: box("email"),
    min,
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
    box: box("cost"),
    min,
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
