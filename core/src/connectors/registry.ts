import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ProviderId } from "../config/schema.js";
import type { MordomoPaths } from "../paths.js";
import { atomicWrite } from "../config/store.js";
import { resolveInsideDir } from "../security/ids.js";
import type { StoreProblem } from "../routines/store.js";

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
