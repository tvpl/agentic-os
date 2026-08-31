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
  timezone: z.string().default("UTC"),
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
    })
    .default({}),
  favoriteSkills: z.array(z.string()).default([]),
});
export type Settings = z.infer<typeof SettingsSchema>;

export function defaultSettings(): Settings {
  return SettingsSchema.parse({});
}
