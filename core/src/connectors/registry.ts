import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ProviderId } from "../config/schema.js";
import type { MordomoPaths } from "../paths.js";
import { atomicWrite } from "../config/store.js";
import { resolveInsideDir } from "../security/ids.js";
import type { StoreProblem } from "../routines/store.js";

/** `string` = dot path into the item; object = path plus a predicate for booleans. */
export const FieldSpecSchema = z.union([
  z.string(),
  z.object({
    path: z.string(),
    /** Field is true when the value (string or array) contains any of these. */
    includesAny: z.array(z.string()).optional(),
    equals: z.union([z.string(), z.number(), z.boolean()]).optional(),
  }),
]);
export type FieldSpec = z.infer<typeof FieldSpecSchema>;

export const ItemFieldsSchema = z.object({
  id: FieldSpecSchema.optional(),
  title: FieldSpecSchema.optional(),
  subtitle: FieldSpecSchema.optional(),
  ts: FieldSpecSchema.optional(),
  flagged: FieldSpecSchema.optional(),
  tag: FieldSpecSchema.optional(),
  href: FieldSpecSchema.optional(),
});
export type ItemFields = z.infer<typeof ItemFieldsSchema>;

/** One read-only MCP tool call and how to turn its result into items. */
export const ToolMappingSchema = z.object({
  name: z.string().min(1),
  /** Tool arguments; string values may use {today}, {todayStart}, {todayEnd}, {tomorrow}, {tz}. */
  args: z.record(z.unknown()).default({}),
  /** How to read the tool's text content: JSON (default), one item per line, or "Key: value" blocks. */
  parse: z.enum(["json", "lines", "blocks"]).default("json"),
  /** Dot path to the items array inside the JSON (empty = the root). Supports `a.b[*].c` and `a[0]`. */
  path: z.string().default(""),
  fields: ItemFieldsSchema.default({}),
});
export type ToolMapping = z.infer<typeof ToolMappingSchema>;

/**
 * Read-only data mapping consumed by `core/src/connectors/client.ts` and
 * `GET /api/connectors/:id/data`. Only the tools named here may be called;
 * env entries are NAMES passed through from the service environment (values
 * are never stored, logged or returned).
 */
export const DataMappingSchema = z.object({
  /** Transport: MCP stdio server, or a plain HTTP GET JSON endpoint. */
  transport: z.enum(["mcp", "api"]).default("mcp"),
  /** MCP: executable (absolute path or a name resolved on PATH). */
  command: z.string().nullable().default(null),
  args: z.array(z.string()).default([]),
  /** MCP: names of environment variables to pass through (never values). */
  env: z.array(z.string()).default([]),
  /** API: URL to GET; `$ENV_NAME` tokens are substituted at request time. Null until the user provides one. */
  url: z.string().nullable().default(null),
  /** API: extra request headers; values may use `$ENV_NAME` tokens. */
  headers: z.record(z.string()).default({}),
  tools: z
    .object({
      list: ToolMappingSchema.optional(),
      /** Optional second read whose items mark matching `list` items as flagged (by id, then title). */
      flagged: ToolMappingSchema.optional(),
      /** Optional read whose numeric fields become the summary (`path` → object, `keys` → which fields). */
      summary: z
        .object({
          name: z.string().optional(),
          args: z.record(z.unknown()).default({}),
          path: z.string().default(""),
          keys: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .default({}),
  /** Human setup hints shown when data is not configured (install command, docs). */
  install: z.string().nullable().default(null),
  setup: z.array(z.string()).default([]),
});
export type DataMapping = z.infer<typeof DataMappingSchema>;

export const ConnectorSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string(),
  kind: z.enum(["mcp", "cli", "api", "micro-app"]),
  origin: z.string(),
  maintainer: z.string(),
  official: z.boolean().default(false),
  authMethod: z.enum(["none", "oauth", "api-key", "local-session", "unknown"]).default("unknown"),
  permissions: z.array(z.string()).default([]),
  readOperations: z.array(z.string()).default([]),
  writeOperations: z.array(z.string()).default([]),
  writeEnabled: z.boolean().default(false),
  risks: z.array(z.string()).default([]),
  compatibleProviders: z.array(ProviderId).default(["claude", "cursor", "codex"]),
  status: z.enum(["not_configured", "configured", "healthy", "unhealthy"]).default("not_configured"),
  lastUsedAt: z.number().nullable().default(null),
  lastHealthCheckAt: z.number().nullable().default(null),
  notes: z.string().default(""),
  /** For micro-apps: local entry point (relative to home). */
  entryPoint: z.string().nullable().default(null),
  /** Read-only data mapping (see DataMappingSchema); null = no data widget for this connector. */
  dataMapping: DataMappingSchema.nullable().default(null),
});
export type Connector = z.infer<typeof ConnectorSchema>;

export class ConnectorRegistry {
  private problems: StoreProblem[] = [];

  constructor(private readonly paths: MordomoPaths) {}

  /** Files skipped by the most recent `list()` call, with the reason. */
  lastProblems(): StoreProblem[] {
    return [...this.problems];
  }

  /** Path for an id, validated (regex + containment). Throws InvalidIdError (400). */
  private fileFor(id: string): string {
    return resolveInsideDir(this.paths.connectors, id, ".json", "connector id");
  }

  list(): Connector[] {
    this.problems = [];
    if (!fs.existsSync(this.paths.connectors)) return [];
    const out: Connector[] = [];
    for (const file of fs.readdirSync(this.paths.connectors)) {
      if (!file.endsWith(".json")) continue;
      const full = path.join(this.paths.connectors, file);
      try {
        out.push(ConnectorSchema.parse(JSON.parse(fs.readFileSync(full, "utf8"))));
      } catch (err) {
        this.problems.push({ file: full, error: (err as Error).message });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): Connector | null {
    const file = this.fileFor(id);
    if (!fs.existsSync(file)) return null;
    return ConnectorSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  }

  save(connector: Connector): Connector {
    const parsed = ConnectorSchema.parse(connector);
    atomicWrite(this.fileFor(parsed.id), JSON.stringify(parsed, null, 2) + "\n");
    return parsed;
  }

  remove(id: string): boolean {
    const file = this.fileFor(id);
    if (!fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    return true;
  }
}
