import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ProviderId } from "../config/schema.js";
import type { MordomoPaths } from "../paths.js";
import { atomicWrite } from "../config/store.js";

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
  constructor(private readonly paths: MordomoPaths) {}

  list(): Connector[] {
    if (!fs.existsSync(this.paths.connectors)) return [];
    const out: Connector[] = [];
    for (const file of fs.readdirSync(this.paths.connectors)) {
      if (!file.endsWith(".json")) continue;
      try {
        out.push(ConnectorSchema.parse(JSON.parse(fs.readFileSync(path.join(this.paths.connectors, file), "utf8"))));
      } catch (err) {
        throw new Error(`Invalid connector file ${file}: ${(err as Error).message}`);
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): Connector | null {
    const file = path.join(this.paths.connectors, `${id}.json`);
    if (!fs.existsSync(file)) return null;
    return ConnectorSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  }

  save(connector: Connector): Connector {
    const parsed = ConnectorSchema.parse(connector);
    atomicWrite(path.join(this.paths.connectors, `${parsed.id}.json`), JSON.stringify(parsed, null, 2) + "\n");
    return parsed;
  }

  remove(id: string): boolean {
    const file = path.join(this.paths.connectors, `${id}.json`);
    if (!fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    return true;
  }
}
