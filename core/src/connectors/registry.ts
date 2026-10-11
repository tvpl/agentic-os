import fs from "node:fs";
import path from "node:path";
import type { MordomoPaths } from "../paths.js";
import { atomicWrite } from "../config/store.js";
import { resolveInsideDir } from "../security/ids.js";
import { homeReadScope, listWorkspaceDir, readWorkspaceText } from "../security/safeFs.js";
import type { StoreProblem } from "../routines/store.js";

/**
 * The connector definition lives in `@mordomo/contracts` (the API describes it in its route table and the interface
 * edits it); the core re-exports it so every existing importer keeps working.
 */
export {
  ConnectorSchema,
  DataMappingSchema,
  FieldSpecSchema,
  ItemFieldsSchema,
  ToolMappingSchema,
  type Connector,
  type DataMapping,
  type FieldSpec,
  type ItemFields,
  type ToolMapping,
} from "@mordomo/contracts";
import { ConnectorSchema, type Connector } from "@mordomo/contracts";


/** A connector definition is a small JSON file. */
const MAX_CONNECTOR_BYTES = 1024 * 1024;

export class ConnectorRegistry {
  private problems: StoreProblem[] = [];

  constructor(private readonly paths: MordomoPaths) {}

  /** Connector files are read through the safe-read primitive, confined to `connectors/`. */
  private readJson(file: string, scope = this.scope()): unknown {
    return JSON.parse(
      readWorkspaceText(scope, file, {
        maxBytes: MAX_CONNECTOR_BYTES,
        strict: true,
      }).text,
    );
  }

  private scope() {
    return homeReadScope(this.paths.home, [this.paths.connectors]);
  }

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
    const scope = this.scope(); // one scope for the whole listing
    for (const entry of listWorkspaceDir(scope, this.paths.connectors)) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;
      const full = path.join(this.paths.connectors, entry.name);
      try {
        out.push(ConnectorSchema.parse(this.readJson(full, scope)));
      } catch (err) {
        this.problems.push({ file: full, error: (err as Error).message });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): Connector | null {
    const file = this.fileFor(id);
    if (!fs.existsSync(file)) return null;
    return ConnectorSchema.parse(this.readJson(file));
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
