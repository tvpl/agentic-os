/**
 * What only the Command Centre reads and writes: theme preset, micro apps,
 * layouts, the HUD and the Second Brain view. Stored in
 * `config/ui-preferences.json`, apart from the engine's settings, so a layout
 * change never rewrites the engine's file nor reaches its listeners.
 */
import { z } from "zod";
import { BrainSettingsSchema, MicroAppSchema } from "./settings.js";

/**
 * One desktop window: stage pixels, stacking order and per-widget config.
 *
 * `.catch({})` is load-bearing: a layout is presentation, and a box this
 * version cannot read must never invalidate the whole settings document and
 * take the service down with it. An unreadable layout falls back to the
 * default composition; providers, folders and identity survive untouched.
 */
const WindowLayoutSchema = z.record(
  z.object({
    x: z.number().int().min(-8000).max(16000),
    y: z.number().int().min(0).max(16000),
    w: z.number().int().min(120).max(16000),
    h: z.number().int().min(80).max(16000),
    /** Stacking order; higher is nearer the viewer. */
    z: z.number().int().min(0).max(1_000_000).default(1),
    visible: z.boolean().default(true),
    /** Collapsed to the dock but still part of the layout. */
    minimized: z.boolean().default(false),
    /**
     * Per-widget configuration (timezones, day counts, item limits …).
     * Opaque to the core: the widget that owns the id defines the shape,
     * so the record must survive a settings round-trip untouched.
     */
    config: z.record(z.unknown()).optional(),
    /**
     * Tabbed into another window's frame: the host's id. The window keeps
     * its own config; the desktop draws it inside the host's frame and drops
     * the link on read when the host is gone.
     */
    tabOf: z.string().min(1).max(4096).optional(),
    /** Position in the host's tab strip (order of arrival). */
    tabAt: z.number().int().min(0).max(10_000).optional(),
  }),
);
/** The same record, but degrading to an empty layout instead of throwing. */
const SafeWindowLayoutSchema = WindowLayoutSchema.catch({});

/**
 * The HUD (redesign G5): which instruments sit on the left and right pod
 * arcs, in order. Ids are the desktop's (`app:brain`, `pulse`, …); unknown
 * ones are ignored on read. Same rule as the layout: presentation never
 * invalidates the settings document, so an unreadable HUD is the default.
 */
export const DEFAULT_HUD = {
  l: [
    "app:brain",
    "app:skills",
    "app:artifacts",
    "app:generations",
    "app:connectors",
    "app:settings",
    "app:pixel",
  ],
  r: ["pulse", "attention", "runs", "routines", "inbox"],
};
const HudSchema = z.object({
  l: z.array(z.string().min(1).max(60)).max(16).default(DEFAULT_HUD.l),
  r: z.array(z.string().min(1).max(60)).max(16).default(DEFAULT_HUD.r),
});
const SafeHudSchema = HudSchema.catch(DEFAULT_HUD);

/** The keys that moved from `settings.json` to `ui-preferences.json` (settings version 1 → 2). */
export const UI_PREFERENCE_KEYS = [
  "themePreset",
  "microApps",
  "dashboardLayout",
  "spaces",
  "activeSpace",
  "hud",
  "brain",
] as const;
export type UiPreferenceKey = (typeof UI_PREFERENCE_KEYS)[number];

/**
 * Which interface mounts (.specs/features/moldura-app): the app frame
 * (sidebar, content, chat on the right) or the immersive Núcleo.
 */
export const UI_SHELLS = ["moldura", "nucleo"] as const;
export const UiShellSchema = z.enum(UI_SHELLS);
export type UiShell = z.infer<typeof UiShellSchema>;

/** How many dashboards `UiPreferences.dashboards.lastViewed` remembers (amendment 28). */
const DASHBOARDS_LAST_VIEWED_MAX = 200;

export const UiPreferencesSchema = z.object({
  version: z.literal(1).default(1),
  /**
   * Missing or unknown on disk reads as the frame, like every presentation
   * field; a write is checked strictly by the route (`UiShellSchema`).
   * Not one of `UI_PREFERENCE_KEYS`: it never lived in `settings.json`.
   */
  shell: UiShellSchema.catch("moldura"),
  /** Theme preset id (see apps/command-centre/src/theme.ts). */
  themePreset: z.enum(["hud-orange", "jarvis", "forest", "ocean", "mono"]).default("hud-orange"),
  /** User-defined micro apps listed on the desktop. */
  microApps: z.array(MicroAppSchema).default([]),
  /**
   * Desktop window layout, per widget id: stage pixels, not grid units. `x`
   * may be negative because a window may hang off the left edge; the frontend
   * clamps everything back into view on a smaller viewport.
   */
  dashboardLayout: SafeWindowLayoutSchema.default({}),
  /** Named desktop spaces, each remembering its arrangement; `dashboardLayout` is the active one's. */
  spaces: z
    .record(
      z.object({
        name: z.string().min(1).max(40),
        layout: SafeWindowLayoutSchema.default({}),
      }),
    )
    .default({}),
  /** Id of the space `dashboardLayout` currently belongs to. */
  activeSpace: z.string().min(1).max(60).default("work"),
  /** The pod arcs: editable, persisted, one HUD for every space. */
  hud: SafeHudSchema.default(DEFAULT_HUD),
  /** Second Brain view preferences; the shape is owned by the frontend (`brain/engine/world.ts`). */
  brain: BrainSettingsSchema.default({}),
  /**
   * The active work context of this machine (.specs/features/cerebro-contextos, door 5): one for the frame, the Núcleo
   * and the CLI; `null` is "the whole brain". Deleting the context it names sets it back to `null`.
   */
  activeContext: z.string().nullable().catch(null),
  /**
   * The dashboards (.specs/features/cerebro-paineis, AC 45, amendment 28): when each was last left, so the next open
   * asks for what is new since then. At most 200 entries; a value this version cannot read is `{ lastViewed: {} }`.
   */
  dashboards: z
    .object({
      lastViewed: z
        .record(z.number().int().min(0))
        .refine((r) => Object.keys(r).length <= DASHBOARDS_LAST_VIEWED_MAX, "at most 200 entries")
        .default({}),
    })
    .default({ lastViewed: {} })
    .catch({ lastViewed: {} }),
});

export type UiPreferences = z.infer<typeof UiPreferencesSchema>;

export function defaultUiPreferences(): UiPreferences {
  return UiPreferencesSchema.parse({});
}
