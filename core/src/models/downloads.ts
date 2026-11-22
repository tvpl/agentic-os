import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hostAllowed, isModelFilePath, MODEL_ID, type ModelEntry } from "./catalog.js";

/**
 * Downloads of the catalog's models (.specs/features/cerebro-busca-significado, doors 3 and 8): one at a time, each file
 * to `<home>/models/<id>/<path>`, from the entry's `source` and only through its `hosts` (redirects included), each
 * checked against its SHA-256 as it arrives. A download that fails or is cancelled deletes the model's folder; a model
 * reads `ready` only when every file has its catalog size and the install's verification record is there (G20).
 *
 * This is the only module of the engine that writes under `<home>/models/` (the downloader's row of the raw `fs` list).
 */

export type ModelState = "absent" | "downloading" | "ready" | "failed";

export interface ModelView {
  state: ModelState;
  progress?: { done: number; total: number };
  reason?: string;
}

/** A refused action of door 8; each is raised with its literal `statusCode` and `code` (`refuse` below). */
export class ModelRefusal extends Error {
  declare statusCode: number;
  declare code: string;
  constructor(message: string) {
    super(message);
    this.name = "ModelRefusal";
  }
}

class DownloadFailure extends Error {}

const VERIFIED = ".verified.json";
const MAX_REDIRECTS = 5;

/** `localhost`, `127.0.0.0/8`, `::1`: only a host on this machine may be reached over plain `http` (a test's stub host). */
const isLoopback = (host: string) =>
  host === "localhost" || host === "[::1]" || /^127(\.\d{1,3}){3}$/.test(host);

interface Current {
  id: string;
  abort: AbortController;
  done: number;
  total: number;
  cancelled: boolean;
  promise: Promise<void>;
}

export class ModelDownloads {
  private current: Current | null = null;
  /** Why the last download of a model failed; in memory only, so a restart reads it `absent` (G20). */
  private readonly failed = new Map<string, string>();

  constructor(
    private readonly catalog: readonly ModelEntry[],
    readonly modelsDir: string,
  ) {}

  entry(id: string): ModelEntry | undefined {
    return this.catalog.find((entry) => entry.id === id);
  }

  /** `<home>/models/<id>`, for a catalog id only; an id that could leave the folder is never joined. */
  folder(entry: ModelEntry): string {
    if (!MODEL_ID.test(entry.id) || entry.id.includes("..")) throw new Error(`not a model id: ${entry.id}`);
    const dir = path.join(this.modelsDir, entry.id);
    if (path.dirname(dir) !== path.resolve(this.modelsDir)) throw new Error(`not a model id: ${entry.id}`);
    return dir;
  }

  /** The id being downloaded, or null. */
  downloading(): string | null {
    return this.current?.id ?? null;
  }

  view(id: string): ModelView {
    const entry = this.entry(id);
    if (!entry) return { state: "absent" };
    const current = this.current;
    if (current?.id === id)
      return { state: "downloading", progress: { done: current.done, total: current.total } };
    if (this.isReady(entry)) return { state: "ready" };
    const reason = this.failed.get(id);
    return reason === undefined ? { state: "absent" } : { state: "failed", reason };
  }

  /** Every file has its catalog size and the verification record names exactly the catalog's files and sums. */
  isReady(entry: ModelEntry): boolean {
    const dir = this.folder(entry);
    try {
      const record = JSON.parse(fs.readFileSync(path.join(dir, VERIFIED), "utf8")) as {
        v?: unknown;
        id?: unknown;
        files?: Array<{ path?: unknown; bytes?: unknown; sha256?: unknown }>;
      };
      if (record.v !== 1 || record.id !== entry.id || !Array.isArray(record.files)) return false;
      if (record.files.length !== entry.files.length) return false;
      return entry.files.every((file, i) => {
        const seen = record.files![i]!;
        if (seen.path !== file.path || seen.bytes !== file.bytes || seen.sha256 !== file.sha256) return false;
        const stat = fs.statSync(path.join(dir, file.path), { throwIfNoEntry: false });
        return stat !== undefined && stat.isFile() && stat.size === file.bytes;
      });
    } catch {
      return false;
    }
  }

  /**
   * Start a download and answer at once; the files arrive in the background and `view` follows them. Refused, with
   * nothing fetched and no folder written: an id outside the catalog, a platform with no runtime, another download
   * running, a license not accepted.
   */
  install(id: string, acceptTerms: boolean | undefined, platformOk: boolean): ModelView {
    const entry = this.entry(id);
    if (!entry)
      throw Object.assign(new ModelRefusal(`No model of the catalog is called ${id}.`), {
        statusCode: 404,
        code: "model_not_found",
      });
    if (!platformOk)
      throw Object.assign(new ModelRefusal("This computer has no runtime for local models."), {
        statusCode: 409,
        code: "local_unavailable",
      });
    if (this.current)
      throw Object.assign(new ModelRefusal(`The model ${this.current.id} is downloading; one at a time.`), {
        statusCode: 409,
        code: "download_in_progress",
      });
    if (entry.license.acceptRequired && acceptTerms !== true)
      throw Object.assign(
        new ModelRefusal(`${entry.name} needs its license (${entry.license.name}) accepted.`),
        {
          statusCode: 400,
          code: "terms_not_accepted",
        },
      );
    this.failed.delete(id);
    const current: Current = {
      id,
      abort: new AbortController(),
      done: 0,
      total: entry.files.reduce((sum, file) => sum + file.bytes, 0),
      cancelled: false,
      promise: Promise.resolve(),
    };
    this.current = current;
    current.promise = this.run(entry, current)
      .then(
        () => undefined,
        (error: unknown) => {
          fs.rmSync(this.folder(entry), { recursive: true, force: true });
          if (!current.cancelled) this.failed.set(id, reasonOf(error));
        },
      )
      .finally(() => {
        if (this.current === current) this.current = null;
      });
    return { state: "downloading", progress: { done: 0, total: current.total } };
  }

  /** Stop the download that runs (or nothing, G22) and wait until its files are gone. */
  async cancel(): Promise<void> {
    const current = this.current;
    if (!current) return;
    current.cancelled = true;
    current.abort.abort(new DownloadFailure("cancelled"));
    await current.promise;
  }

  /** Delete a model's folder. The active embedder is refused (G23); an absent model answers as it is (G22). */
  remove(id: string, active: boolean): ModelView {
    const entry = this.entry(id);
    if (!entry)
      throw Object.assign(new ModelRefusal(`No model of the catalog is called ${id}.`), {
        statusCode: 404,
        code: "model_not_found",
      });
    if (active)
      throw Object.assign(new ModelRefusal(`${entry.name} is the model the search uses.`), {
        statusCode: 409,
        code: "model_in_use",
      });
    if (this.current?.id === id)
      throw Object.assign(new ModelRefusal(`The model ${id} is downloading; cancel it first.`), {
        statusCode: 409,
        code: "download_in_progress",
      });
    fs.rmSync(this.folder(entry), { recursive: true, force: true });
    this.failed.delete(id);
    return { state: "absent" };
  }

  /** Wait for the download that runs, if any (tests, closing). */
  async settled(): Promise<void> {
    await this.current?.promise;
  }

  private async run(entry: ModelEntry, current: Current): Promise<void> {
    const dir = this.folder(entry);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (const file of entry.files) {
      if (!isModelFilePath(file.path)) throw new DownloadFailure("checksum");
      const target = path.join(dir, ...file.path.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const response = await fetchWithin(new URL(file.path, entry.source), entry.hosts, current.abort.signal);
      const hash = crypto.createHash("sha256");
      const out = fs.openSync(target, "w", 0o600);
      let written = 0;
      try {
        const reader = response.body!.getReader();
        for (;;) {
          const step = await reader.read();
          if (step.done) break;
          written += step.value.byteLength;
          // More bytes than the catalog says is a different file: no need to read the rest.
          if (written > file.bytes) {
            await reader.cancel().catch(() => undefined);
            throw new DownloadFailure("checksum");
          }
          hash.update(step.value);
          fs.writeSync(out, step.value);
          current.done += step.value.byteLength;
        }
      } finally {
        fs.closeSync(out);
      }
      if (written !== file.bytes || hash.digest("hex") !== file.sha256) throw new DownloadFailure("checksum");
    }
    const record = {
      v: 1,
      id: entry.id,
      files: entry.files.map(({ path: p, bytes, sha256 }) => ({ path: p, bytes, sha256 })),
    };
    fs.writeFileSync(path.join(dir, VERIFIED), `${JSON.stringify(record)}\n`, { mode: 0o600 });
  }
}

/**
 * May a request go to `at`: a host of the entry, over `https` on the default port (443), or over plain `http` or any
 * port only to a host on this machine (door 3 and its port limit, owner decision of 19/11/2026).
 */
export function hopAllowed(hosts: readonly string[], at: URL): boolean {
  if (!hostAllowed(hosts, at.hostname)) return false;
  if (isLoopback(at.hostname)) return at.protocol === "https:" || at.protocol === "http:";
  return at.protocol === "https:" && (at.port === "" || at.port === "443");
}

/**
 * GET `url`, following redirects by hand: every hop must be on one of `hosts`, over `https` (plain `http` only to a
 * host on this machine), or the download stops with `host_not_allowed` before the next request is made.
 */
async function fetchWithin(url: URL, hosts: readonly string[], signal: AbortSignal): Promise<Response> {
  let at = url;
  for (let hop = 0; ; hop++) {
    if (!hopAllowed(hosts, at)) throw new DownloadFailure("host_not_allowed");
    let response: Response;
    try {
      response = await fetch(at, { redirect: "manual", signal });
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      throw error;
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      const location = response.headers.get("location");
      if (!location || hop >= MAX_REDIRECTS)
        throw new Error(`the repository answered ${response.status} with no place to go`);
      at = new URL(location, at);
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`the repository answered ${response.status}`);
    }
    return response;
  }
}

/** `checksum`, `host_not_allowed`, or `network: <message>` (G21). */
function reasonOf(error: unknown): string {
  if (error instanceof DownloadFailure) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : "";
  return `network: ${message}${cause}`;
}
