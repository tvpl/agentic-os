import fs from "node:fs";
import path from "node:path";
import type { LocalEmbedding, LocalModelEntry } from "../memory/embeddings.js";
import { checkCatalog, MODEL_CATALOG, type ModelEntry } from "./catalog.js";
import { ModelDownloads } from "./downloads.js";
import { LocalModelHost, resolveChildEntry, type ChildModel } from "./localHost.js";

/**
 * The local models of one engine (.specs/features/cerebro-busca-significado, doors 2, 3 and 8): the catalog, the
 * downloads into `<home>/models/`, and the one child process that runs them. Everything here belongs to the instance
 * (the child's handle, the download in progress, the idle timer): two engines in one process share nothing.
 */

/** What the assembly gives the engine (C104): the service's real values, or a test's stubs through the same keys. */
export interface LocalModelsOptions {
  catalog: readonly ModelEntry[];
  modelsDir: string;
  /** The child's script; null when there is none (the platform then reads unsupported). */
  childEntry: string | null;
  platform: NodeJS.Platform;
  arch: string;
  /** Whether `@huggingface/transformers` can be found from the child's script, without loading or resolving it. */
  runtimeAvailable: () => boolean;
  idleMs?: number;
}

/** The targets `onnxruntime-node` 1.30.0 has a CPU binary for (Out of scope: macOS Intel and Windows ARM have none). */
const RUNTIME_TARGETS = new Set(["linux/x64", "linux/arm64", "darwin/arm64", "win32/x64"]);

/**
 * Is the runtime package next to the child? Walks up from its folder looking for
 * `node_modules/@huggingface/transformers/package.json`, by file name only: the service never resolves the package.
 */
export function runtimeNear(from: string | null): boolean {
  if (!from) return false;
  for (let dir = path.dirname(from); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "node_modules", "@huggingface", "transformers", "package.json")))
      return true;
    if (path.dirname(dir) === dir) return false;
  }
}

/** The service's values (the real catalog, `<home>/models/`, the real child next to this module); `override` is a test's. */
export function localModelsOptions(
  home: string,
  override: Partial<LocalModelsOptions> = {},
): LocalModelsOptions {
  const childEntry =
    override.childEntry !== undefined ? override.childEntry : resolveChildEntry(import.meta.url);
  return {
    catalog: MODEL_CATALOG,
    modelsDir: path.join(home, "models"),
    childEntry,
    platform: process.platform,
    arch: process.arch,
    runtimeAvailable: () => runtimeNear(childEntry),
    ...override,
  };
}

const childModel = (entry: LocalModelEntry): ChildModel => ({
  id: entry.id,
  kind: entry.kind,
  dtype: entry.dtype,
  ...(entry.pooling ? { pooling: entry.pooling } : {}),
  ...(entry.dimensions ? { dimensions: entry.dimensions } : {}),
});

export class LocalModels implements LocalEmbedding {
  readonly downloads: ModelDownloads;
  readonly host: LocalModelHost;

  constructor(readonly options: LocalModelsOptions) {
    checkCatalog(options.catalog);
    this.downloads = new ModelDownloads(options.catalog, options.modelsDir);
    this.host = new LocalModelHost({
      entry: options.childEntry,
      modelsDir: options.modelsDir,
      ...(options.idleMs !== undefined ? { idleMs: options.idleMs } : {}),
    });
  }

  get catalog(): readonly ModelEntry[] {
    return this.options.catalog;
  }

  platform = (): { ok: true } | { ok: false; reason: "platform_unsupported" } => {
    const { platform, arch, childEntry, runtimeAvailable } = this.options;
    const ok = RUNTIME_TARGETS.has(`${platform}/${arch}`) && childEntry !== null && runtimeAvailable();
    return ok ? { ok: true } : { ok: false, reason: "platform_unsupported" };
  };

  ready = (id: string): LocalModelEntry | null => {
    const entry = this.downloads.entry(id);
    if (!entry || entry.kind !== "embedder") return null;
    return this.downloads.view(id).state === "ready" ? entry : null;
  };

  /** The reranker of the catalog when it is ready (door 5), or null. */
  reranker(): ModelEntry | null {
    const entry = this.options.catalog.find((e) => e.kind === "reranker");
    return entry && this.platform().ok && this.downloads.view(entry.id).state === "ready" ? entry : null;
  }

  state = (id: string) => this.downloads.view(id).state;

  embed = (entry: LocalModelEntry, texts: string[], signal: AbortSignal): Promise<number[][]> =>
    this.host.embed(childModel(entry), texts, signal);

  /** The reranker's "yes" probabilities for `texts` (door 5); `timeoutMs` that passes rejects with `kind: "timeout"`. */
  rerank(entry: ModelEntry, query: string, texts: string[], timeoutMs?: number): Promise<number[]> {
    return this.host.rerank(childModel(entry), query, texts, timeoutMs);
  }

  dispose(): void {
    this.host.dispose();
  }
}
