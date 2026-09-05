import { z } from "zod";

export const ProviderId = z.enum(["claude", "cursor", "codex"]);
export type ProviderId = z.infer<typeof ProviderId>;

export const SecurityProfile = z.enum([
  "read_only",
  "review_before_write",
  "controlled_write",
  "approved_automation",
]);
export type SecurityProfile = z.infer<typeof SecurityProfile>;

export const EffortLevel = z.enum(["low", "medium", "high", "default"]);
export type EffortLevel = z.infer<typeof EffortLevel>;

export const ProviderSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  defaultModel: z.string().nullable().default(null),
  defaultEffort: EffortLevel.default("default"),
  /** Absolute path resolved at detection time; kept so the allowlist can pin it. */
  binaryPath: z.string().nullable().default(null),
});
export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>;

export const IndexedFolderSchema = z.object({
  path: z.string(),
  area: z.string().nullable().default(null),
  enabled: z.boolean().default(true),
});
export type IndexedFolder = z.infer<typeof IndexedFolderSchema>;

export const DEFAULT_EXCLUDES = [
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  "coverage",
  "tmp",
  ".tmp",
  ".DS_Store",
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "id_rsa*",
  "id_ed25519*",
  "*.keystore",
  "credentials*.json",
  ".credentials*",
  ".npmrc",
  ".netrc",
  "secrets",
  ".secrets",
  ".aws",
  ".ssh",
  ".gnupg",
];

/** A user-defined micro app shown in the desktop "Micro apps" widget (href = route or URL). */
export const MicroAppSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
  name: z.string().min(1),
  description: z.string().default(""),
  href: z.string().min(1),
});
export type MicroApp = z.infer<typeof MicroAppSchema>;

/** Second Brain preferences: every field optional so older clients keep working; the frontend validates values. */
export const BrainSettingsSchema = z.object({
  layout: z.string().optional(),
  view: z.string().optional(),
  spin: z.number().min(0).max(1).optional(),
  showNames: z.boolean().optional(),
  linkSpring: z.number().optional(),
  nodeScale: z.number().optional(),
  clusterSize: z.number().optional(),
  edgeKinds: z.array(z.string()).optional(),
  localHops: z.number().int().min(1).max(3).optional(),
  focusMode: z.boolean().optional(),
  workspace: z
    .object({
      pinned: z.array(z.object({ id: z.number().int(), x: z.number(), y: z.number() })).default([]),
      collapsed: z.array(z.string()).default([]),
    })
    .optional(),
});
export type BrainSettings = z.infer<typeof BrainSettingsSchema>;

/**
 * The machine's IANA timezone, or "UTC" when the runtime cannot resolve one.
 * Used as the settings default so a non-interactive setup does not leave the
 * clock and the routines in different zones.
 */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Sentinels and the triage run they may launch (Onda 2, items 1 and 2).
 * Everything is optional with a default, so a settings file written before
 * this existed keeps working and gains the defaults on the next save.
 */
export const SentinelSettingsSchema = z.object({
  /** Watch the enabled indexed folders and re-index after a quiet period. Off by default (cost on big trees). */
  fsWatch: z
    .object({
      enabled: z.boolean().default(false),
      /** Quiet period after the last change before the alert + re-index fire. */
      debounceMs: z.number().int().min(1_000).max(600_000).default(30_000),
    })
    .default({}),
  /** The same skill (or the same prompt head) failing repeatedly inside the window. */
  repeatedFailure: z
    .object({
      enabled: z.boolean().default(true),
      /** Failures needed inside the window before the sentinel fires. */
      threshold: z.number().int().min(2).max(50).default(2),
      windowHours: z.number().int().min(1).max(168).default(24),
    })
    .default({}),
  /** An enabled routine whose last run is older than `factor` × its expected interval. */
  silentRoutine: z
    .object({
      enabled: z.boolean().default(true),
      factor: z.number().min(1).max(20).default(2),
    })
    .default({}),
  /** New items in a connector's read mapping since the previous hourly check. */
  connectorDelta: z
    .object({
      enabled: z.boolean().default(true),
      /** Items read per connector per check. */
      maxItems: z.number().int().min(1).max(500).default(50),
    })
    .default({}),
  /** "You did this twice — make it a skill?" (Onda 4, item 2). */
  repeatDetector: z
    .object({
      enabled: z.boolean().default(true),
      /** How far back manual prompt runs are grouped. */
      days: z.number().int().min(1).max(365).default(30),
      /** Runs needed in a group before it is proposed. */
      minRuns: z.number().int().min(2).max(20).default(2),
      /** Jaccard threshold on the normalized token sets. */
      similarity: z.number().min(0.1).max(1).default(0.6),
    })
    .default({}),
  /** Short, cheap run that answers a `triage: true` sentinel with ignore/notify/propose. */
  triage: z
    .object({
      enabled: z.boolean().default(true),
      /** Model alias or id for the triage run (cheap on purpose). */
      model: z.string().default("haiku"),
      /** Spend cap for triage runs in one local day (0 = no triage). */
      dailyBudgetUsd: z.number().min(0).default(0.25),
      timeoutMs: z.number().int().min(10_000).max(600_000).default(90_000),
    })
    .default({}),
});
export type SentinelSettings = z.infer<typeof SentinelSettingsSchema>;

/**
 * External delivery channels. The bot token is NEVER stored: only the NAME of
 * the environment variable that holds it (`process.env[botTokenEnv]`), the
 * same rule connector mappings follow.
 */
export const ChannelSettingsSchema = z.object({
  telegram: z
    .object({
      enabled: z.boolean().default(false),
      /** Environment variable holding the bot token. */
      botTokenEnv: z.string().default("MORDOMO_TELEGRAM_TOKEN"),
      /** Chat the bot posts to (a user id or a @channel). */
      chatId: z.string().default(""),
      /** Lowest inbox tone that is worth a message. */
      minTone: z.enum(["ok", "info", "warn", "danger"]).default("warn"),
      /** Long-poll the bot for replies: approve / deny from the phone. Only the configured chat is honoured. */
      inbound: z.boolean().default(false),
    })
    .default({}),
  /** Web Push to installed PWAs (VAPID keys live in config/vapid.json, subscriptions in SQLite). */
  push: z
    .object({
      enabled: z.boolean().default(false),
      minTone: z.enum(["ok", "info", "warn", "danger"]).default("warn"),
      /** Contact the push service may use (`mailto:` or `https:`). */
      subject: z.string().default("mailto:mordomo@localhost"),
    })
    .default({}),
});
export type ChannelSettings = z.infer<typeof ChannelSettingsSchema>;

export const SettingsSchema = z.object({
  version: z.number().default(1),
  systemName: z.string().default("MordomoOS"),
  language: z.enum(["en", "pt-BR"]).default("en"),
  theme: z.enum(["dark", "light", "system"]).default("dark"),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#f97316"),
  port: z.number().int().min(1024).max(65535).default(4777),
  bindAddress: z.string().default("127.0.0.1"),
  timezone: z.string().default(() => detectTimezone()),
  autostart: z.boolean().default(false),
  setupCompleted: z.boolean().default(false),
  defaultProvider: ProviderId.default("claude"),
  securityProfile: SecurityProfile.default("review_before_write"),
  providers: z
    .object({
      claude: ProviderSettingsSchema.default({}),
      cursor: ProviderSettingsSchema.default({}),
      codex: ProviderSettingsSchema.default({}),
    })
    .default({}),
  /**
   * Remote access (Onda 3): paired devices may call the API from the listed
   * hosts. `bindAddress` must also leave loopback (an `expose_port` approval).
   */
  remote: z
    .object({
      enabled: z.boolean().default(false),
      /** Host names / IPs (optionally with port) the server answers to besides loopback. */
      allowedHosts: z.array(z.string().min(1).max(253)).default([]),
      /** Lifetime of a device token in days (0 = never expires). */
      deviceTtlDays: z.number().int().min(0).default(90),
    })
    .default({}),
  /** Skill registries (Onda 3): https index URLs the marketplace lists and installs from. */
  marketplace: z
    .object({
      registries: z.array(z.string().url().startsWith("https://")).default([]),
    })
    .default({}),
  indexedFolders: z.array(IndexedFolderSchema).default([]),
  excludes: z.array(z.string()).default(DEFAULT_EXCLUDES),
  areas: z
    .array(z.string())
    .default(["Worker", "Documentos", "Finanças", "Projetos"]),
  limits: z
    .object({
      maxConcurrentRuns: z.number().int().min(1).max(16).default(3),
      defaultTimeoutMs: z.number().int().min(10_000).default(15 * 60_000),
      logRetentionDays: z.number().int().min(1).default(30),
      logMaxFileBytes: z.number().int().min(65536).default(5 * 1024 * 1024),
      maxIndexedFileBytes: z.number().int().min(1024).default(2 * 1024 * 1024),
      previewMaxBytes: z.number().int().min(1024).default(256 * 1024),
      /** Finished runs older than this are deleted by `RunManager.prune()`. */
      runRetentionDays: z.number().int().min(1).default(90),
      /** Hard cap on finished runs kept, newest first (0 = no cap). */
      runRetentionMax: z.number().int().min(0).default(2000),
      /** Rows kept in `routine_history`. */
      routineHistoryRetentionDays: z.number().int().min(1).default(90),
      /** A pending approval older than this is swept to `expired`. */
      approvalTtlDays: z.number().int().min(1).default(7),
      /** Daily spend budget in USD across every provider (0 = no budget). The desktop warns at 80 %. */
      dailyBudgetUsd: z.number().min(0).default(0),
      /** How long a brokered tool prompt waits for a human before it is denied. */
      toolApprovalTimeoutMs: z.number().int().min(10_000).default(600_000),
    })
    .default({}),
  favoriteSkills: z.array(z.string()).default([]),
  /** Theme preset id (see apps/command-centre/src/theme.ts); the shell reads `settings.themePreset`. */
  themePreset: z.enum(["hud-orange", "jarvis", "forest", "ocean", "mono"]).default("hud-orange"),
  /** User-defined micro apps listed on the desktop. */
  microApps: z.array(MicroAppSchema).default([]),
  /** Routine engine defaults (F-BACKEND: routines v2). */
  routines: z
    .object({
      /** `delivery: "webhook"` is refused at validation unless this is on. */
      allowWebhooks: z.boolean().default(false),
      /** Default interval for new heartbeat routines (minutes). */
      heartbeatIntervalMinutes: z.number().int().min(1).default(30),
      /** Token a heartbeat run must print to be considered quiet. */
      heartbeatOkToken: z.string().min(1).default("HEARTBEAT_OK"),
    })
    .default({}),
  /** Read-only connector data client (F-BACKEND: `GET /api/connectors/:id/data`). */
  connectors: z
    .object({
      /** Cache TTL for connector data reads. */
      dataCacheTtlMs: z.number().int().min(0).default(5 * 60_000),
      /** Hard timeout for one data read (spawn + protocol + tool call). */
      dataTimeoutMs: z.number().int().min(1000).default(30_000),
      /**
       * Extra executables connector mappings may spawn: absolute paths or bare
       * names resolved on PATH (e.g. "npx"). The base allowlist stays as-is.
       */
      allowedCommands: z.array(z.string()).default([]),
    })
    .default({}),
  /** Second-brain memory options (journal injection into the master router, …). */
  memory: z
    .object({
      /** Token budget for today's + yesterday's journal inside memory/ROUTER.md (chars/4). */
      journalBudgetTokens: z.number().int().min(100).max(20_000).default(1200),
    })
    .default({}),
  /** Command Centre desktop widget layout (24-col grid units), per widget id. */
  dashboardLayout: z
    .record(
      z.object({
        x: z.number().int().min(0).max(23),
        y: z.number().int().min(0).max(60),
        w: z.number().int().min(2).max(24),
        h: z.number().int().min(2).max(40),
        visible: z.boolean().default(true),
        /**
         * Per-widget configuration (timezones, day counts, item limits …).
         * Opaque to the core: the widget that owns the id defines the shape,
         * so the record must survive a settings round-trip untouched.
         */
        config: z.record(z.unknown()).optional(),
      }),
    )
    .default({}),
  /**
   * Sentinels (Onda 2, item 1): cheap observers that need no LLM. Every
   * sentinel is togglable on its own; `fsWatch` is off by default because a
   * recursive watch over a large tree costs real memory and wakeups.
   */
  sentinels: SentinelSettingsSchema.default({}),
  /** External delivery channels (Onda 2, item 4). Tokens live in the environment, never here. */
  channels: ChannelSettingsSchema.default({}),
  /** Second Brain view preferences (Command Centre); the shape is owned by the frontend (`brain/engine/world.ts` BrainSettings). */
  brain: BrainSettingsSchema.default({}),
});
export type Settings = z.infer<typeof SettingsSchema>;

export function defaultSettings(): Settings {
  return SettingsSchema.parse({});
}
