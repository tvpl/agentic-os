import { z } from "zod";
import { CONTEXT_LIMITS, WorkContextSchema } from "./workContext.js";

/**
 * The shape of a provider id, not the list of providers: the providers are the
 * ones registered in the engine's `ProviderRegistry`.
 */
export const ProviderId = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]{1,31}$/,
    "A provider id is 2-32 lowercase letters, digits or dashes, starting with a letter",
  );
export type ProviderId = z.infer<typeof ProviderId>;

/** The providers shipped with MordomoOS, in registration order. */
export const BUILTIN_PROVIDER_IDS = ["claude", "cursor", "codex"] as const;
export type BuiltinProviderId = (typeof BUILTIN_PROVIDER_IDS)[number];

/** How a write run is treated: refused, parked for approval, or run. */
export const SecurityProfile = z.enum([
  "read_only",
  "review_before_write",
  "controlled_write",
  "approved_automation",
]);
export type SecurityProfile = z.infer<typeof SecurityProfile>;

/** How much reasoning a provider that supports it is asked for. */
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
/** At most this many tabs and open folders are kept (.specs/features/cerebro-vista-notas, door 4); the rest is cut on read. */
const BRAIN_NOTES_MAX_TABS = 12;
const BRAIN_NOTES_MAX_EXPANDED = 500;
const firstOf = (max: number) => (v: unknown) => (Array.isArray(v) ? v.slice(0, max) : v);
const NotePathSchema = z.string().min(1).max(4096);

/**
 * The notes view of the Second Brain (.specs/features/cerebro-vista-notas, door 4), per machine: the root, a Home per
 * root, the open tabs in their order, the active tab, the sort and the open folders, all absolute paths. A field this
 * version cannot read reads its default and the others are kept, like every presentation field.
 */
const BrainNotesSchema = z.object({
  root: NotePathSchema.nullable().catch(null),
  home: z.record(NotePathSchema).catch({}),
  tabs: z.preprocess(firstOf(BRAIN_NOTES_MAX_TABS), z.array(NotePathSchema)).catch([]),
  active: NotePathSchema.nullable().catch(null),
  sort: z.enum(["name", "updated"]).catch("name"),
  expanded: z.preprocess(firstOf(BRAIN_NOTES_MAX_EXPANDED), z.array(NotePathSchema)).catch([]),
});
export type BrainNotes = z.infer<typeof BrainNotesSchema>;

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
  notes: BrainNotesSchema.optional().catch(undefined),
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
      /**
       * Telegram user ids (`from.id`) allowed to decide. Empty: anyone in the
       * configured chat, as before; otherwise everyone else is ignored.
       */
      allowedUserIds: z.array(z.number().int()).default([]),
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

/** Version of `settings.json` this code reads and writes; older files are migrated on load (core/src/config/migrations.ts). */
/**
 * What `memory.embeddings.apiKeyEnv` may name: a conventional environment variable (capital letters, digits, `_`), at most
 * 64 characters, and never one of the service's own (`MORDOMO_*`). The value of the variable named goes to the
 * configured endpoint on every request, so the name is the whole of the setting's reach.
 */
export const EMBEDDINGS_KEY_ENV = /^(?!MORDOMO_)[A-Z][A-Z0-9_]{0,63}$/;

export const CURRENT_SETTINGS_VERSION = 2;

/** The work contexts (door 1 of cerebro-contextos): the id rule and the bounds are the package's; the schema is not. */
export { CONTEXT_ID, CONTEXT_LIMITS, type WorkContext } from "./workContext.js";

/** The engine's settings. What only the Command Centre reads lives in `UiPreferences` (preferences.ts). */
export const SettingsSchema = z.object({
  version: z.number().default(CURRENT_SETTINGS_VERSION),
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
  /** One entry per provider id: the builtins always exist (with their defaults), any other id is kept as written. */
  providers: z
    .record(ProviderId, ProviderSettingsSchema)
    .default({})
    .transform(
      (providers): Record<ProviderId, ProviderSettings> & Record<BuiltinProviderId, ProviderSettings> => ({
        claude: ProviderSettingsSchema.parse({}),
        cursor: ProviderSettingsSchema.parse({}),
        codex: ProviderSettingsSchema.parse({}),
        ...providers,
      }),
    ),
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
      /**
       * A second, https listener for remote devices with a self-signed
       * certificate generated into config/tls/ (loopback stays plain http on
       * `port`). `port` null = settings.port + 1.
       */
      tls: z
        .object({
          enabled: z.boolean().default(false),
          port: z.number().int().min(1).max(65535).nullable().default(null),
        })
        .default({}),
    })
    .default({}),
  /** Skill registries (Onda 3): https index URLs the marketplace lists and installs from. */
  marketplace: z
    .object({
      registries: z
        .array(
          z
            .string()
            .url()
            .refine(
              (u) => u.startsWith("https://") || u.startsWith("file://"),
              "Registries must be https:// or file:// URLs",
            ),
        )
        .default([]),
    })
    .default({}),
  /** Update check against the public releases (off by default: it is the one outbound request the OS makes on its own). */
  updates: z
    .object({
      check: z.boolean().default(false),
    })
    .default({}),
  indexedFolders: z.array(IndexedFolderSchema).default([]),
  excludes: z.array(z.string()).default(DEFAULT_EXCLUDES),
  areas: z.array(z.string()).default(["Worker", "Documentos", "Finanças", "Projetos"]),
  /**
   * The work contexts (.specs/features/cerebro-contextos, door 1), at most 50, each `id` once. A duplicate `id` or an
   * entry past the 50th is refused as that entry, so the tolerant read drops it and keeps the others.
   */
  contexts: z
    .array(WorkContextSchema)
    .superRefine((list, issues) => {
      const seen = new Set<string>();
      list.forEach((entry, index) => {
        if (index >= CONTEXT_LIMITS.contexts) {
          issues.addIssue({ code: "custom", path: [index], message: "at most 50 contexts" });
        } else if (seen.has(entry.id)) {
          issues.addIssue({ code: "custom", path: [index], message: `the id ${entry.id} is taken` });
        }
        seen.add(entry.id);
      });
    })
    .default([]),
  limits: z
    .object({
      maxConcurrentRuns: z.number().int().min(1).max(16).default(3),
      /** Entries kept in a skill's NOTES.md; older ones move to NOTES.archive.md. */
      skillNotesMax: z.number().int().min(5).max(500).default(40),
      defaultTimeoutMs: z
        .number()
        .int()
        .min(10_000)
        .default(15 * 60_000),
      logRetentionDays: z.number().int().min(1).default(30),
      logMaxFileBytes: z
        .number()
        .int()
        .min(65536)
        .default(5 * 1024 * 1024),
      maxIndexedFileBytes: z
        .number()
        .int()
        .min(1024)
        .default(2 * 1024 * 1024),
      previewMaxBytes: z
        .number()
        .int()
        .min(1024)
        .default(256 * 1024),
      /** Finished runs older than this are deleted by `RunManager.prune()`. */
      runRetentionDays: z.number().int().min(1).default(90),
      /** Hard cap on finished runs kept, newest first (0 = no cap). */
      runRetentionMax: z.number().int().min(0).default(2000),
      /** Backups kept in `config/backups/`: a new one deletes the sealed ones beyond this many (legacy ones are never deleted). */
      backupRetention: z.number().int().min(1).default(10),
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
  /**
   * Slugs of the skills that work on the second brain: a run of one is given `memory/` and a credential of its own
   * for the memory routes of the local API (AD-012). Only the owner changes it (`PUT /api/settings`); it is not a
   * field of any SKILL.md, which anything that can write the file could set. The default names the three built-in
   * memory skills (`organize-brain` from cerebro-organizar, AC 9); a home whose settings store another list keeps it.
   */
  memorySkills: z
    .array(z.string().regex(/^[a-z0-9][a-z0-9-]*$/))
    .default(["recall", "consolidate-memory", "organize-brain"]),
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
      dataCacheTtlMs: z
        .number()
        .int()
        .min(0)
        .default(5 * 60_000),
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
      /**
       * How a compiled AGENTS.md / CLAUDE.md asks an agent to treat a request against the owner's goals
       * (.specs/features/cerebro-organizar, door 7): `neutral` says nothing; `contest-conflicts` adds the line that asks
       * it to say so and propose the alternative first. Only the owner changes it; an unreadable value reads `neutral`.
       */
      agentStance: z.enum(["neutral", "contest-conflicts"]).default("neutral"),
      /**
       * The notes of `memory/notes/` (.specs/features/cerebro-vista-notas, door 5). `fixedStructure` on: a new note
       * goes only into a folder that exists; one that would make a folder or go straight into `memory/notes/` is
       * `409 structure_fixed`, from the API, the CLI and the MCP alike. Off by default; an unreadable value reads off.
       */
      notes: z
        .object({
          fixedStructure: z.boolean().default(false),
        })
        .default({}),
      /**
       * The guided cleanup of a context or a folder (.specs/features/cerebro-faxina-guiada, amendment 14): a file whose
       * age (or `last_reviewed`) passes `staleDays` is `stale`, one past `largeBytes` is `large-file`. The scan reads
       * them when it starts. `PUT /api/settings` replaces `memory.cleanup` whole, like the other fields of `memory`.
       */
      cleanup: z
        .object({
          staleDays: z.number().int().min(1).max(36_500).default(180),
          largeBytes: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(5_242_880),
        })
        .default({}),
      /**
       * Semantic search over the notes (.specs/features/cerebro-v2, S4). OFF by default: nothing is embedded, no
       * extension is loaded and no connection is made until the owner turns it on. `hash` is computed in this
       * process from the text alone (no model, no network); `http` sends the text of each note to `endpoint`
       * (OpenAI-style `POST` `{ model, input }`), which is a loopback address (a local embeddings server) or, with
       * `sendRemote`, an `https` one. The key is read from the environment variable `apiKeyEnv`, never from here.
       */
      embeddings: z
        .object({
          enabled: z.boolean().default(false),
          provider: z.enum(["hash", "http"]).default("hash"),
          endpoint: z.string().max(2000).optional(),
          model: z.string().max(200).optional(),
          /**
           * The NAME of the environment variable that holds the key (never the key): its value is sent as
           * `Authorization: Bearer` to `endpoint` on every request. Capital letters, digits and `_`, at most 64, and not
           * one of the service's own (`MORDOMO_*`): a name that does not fit is refused, so that this setting cannot be
           * pointed at the variable of some other credential by accident. See `EMBEDDINGS_KEY_ENV`.
           */
          apiKeyEnv: z
            .string()
            .refine(
              (name) => name === "" || EMBEDDINGS_KEY_ENV.test(name),
              "apiKeyEnv: capital letters, digits and _ (at most 64), not starting with MORDOMO_",
            )
            .optional(),
          /** What the `http` endpoint answers: the length of one vector (8 to 4096). */
          dimensions: z.number().int().min(8).max(4096).optional(),
          /** A non-loopback endpoint receives note text only when this is on. */
          sendRemote: z.boolean().default(false),
        })
        .default({}),
    })
    .default({}),
  /**
   * Sentinels (Onda 2, item 1): cheap observers that need no LLM. Every
   * sentinel is togglable on its own; `fsWatch` is off by default because a
   * recursive watch over a large tree costs real memory and wakeups.
   */
  sentinels: SentinelSettingsSchema.default({}),
  /** External delivery channels (Onda 2, item 4). Tokens live in the environment, never here. */
  channels: ChannelSettingsSchema.default({}),
});
/** The settings document (`config/settings.json`). */
export type Settings = z.infer<typeof SettingsSchema>;

export function defaultSettings(): Settings {
  return SettingsSchema.parse({});
}
