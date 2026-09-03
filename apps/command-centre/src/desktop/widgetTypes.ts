/** Shared widget prop / config-schema types (no React runtime, no cycles). */
import type { WidgetConfig } from "./defaultLayout";

export interface WidgetProps {
  /** Instance id in the layout ("today" or "today:2"). */
  instanceId?: string;
  config?: WidgetConfig;
  editing?: boolean;
}

export type ConfigField =
  | { key: string; kind: "select"; labelKey: string; options: Array<{ value: string; labelKey?: string; label?: string }>; default: string }
  | { key: string; kind: "number"; labelKey: string; min: number; max: number; step?: number; default: number }
  | { key: string; kind: "toggle"; labelKey: string; default: boolean }
  | { key: string; kind: "text"; labelKey: string; placeholder?: string; default: string };

export const cfgString = (c: WidgetConfig | undefined, key: string, fallback: string): string => (typeof c?.[key] === "string" ? (c[key] as string) : fallback);
export const cfgNumber = (c: WidgetConfig | undefined, key: string, fallback: number): number => (typeof c?.[key] === "number" && Number.isFinite(c[key]) ? (c[key] as number) : fallback);
export const cfgBool = (c: WidgetConfig | undefined, key: string, fallback: boolean): boolean => (typeof c?.[key] === "boolean" ? (c[key] as boolean) : fallback);
