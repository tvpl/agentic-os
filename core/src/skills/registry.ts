/**
 * Skill registries (plan Onda 3 §6): a registry is a JSON index served over
 * https listing skills as sets of files with SHA-256 digests. Installing
 * downloads every file, verifies each digest before anything touches the
 * catalog, stages the skill in a temporary directory and imports it through
 * the same `importFrom` path a local import uses. Only hosts of the
 * configured registries are ever fetched; nothing is executed.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface RegistrySkillFile {
  url: string;
  sha256: string;
}
export interface RegistrySkill {
  slug: string;
  name: string;
  description: string;
  version: string;
  /** Relative path inside the skill folder → where to fetch it. `SKILL.md` is required. */
  files: Record<string, RegistrySkillFile>;
  /** Free-form provenance shown in the UI. */
  author?: string;
  homepage?: string;
}
export interface RegistryIndex {
  name: string;
  skills: RegistrySkill[];
}
export interface RegistryEntry extends RegistrySkill {
  registry: string;
  registryName: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const REL_RE = /^(?!\.)(?!.*\.\.)[A-Za-z0-9._\-/]{1,200}$/;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 40;
const FETCH_TIMEOUT_MS = 15_000;

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; bytes: Uint8Array }>;

/** https for the network; `file://` for a local or synced folder (what `mordomo skills publish` writes). */
export function isRegistryUrl(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("file://");
}

export const defaultFetcher: Fetcher = async (url) => {
  if (url.startsWith("file://")) {
    try {
      const bytes = fs.readFileSync(fileURLToPath(url));
      return { ok: true, status: 200, bytes: new Uint8Array(bytes) };
    } catch {
      return { ok: false, status: 404, bytes: new Uint8Array() };
    }
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "error" });
  const buf = new Uint8Array(await res.arrayBuffer());
  return { ok: res.ok, status: res.status, bytes: buf };
};

/**
 * A skill file must live where its index lives: same https host, or — for a
 * file registry — inside the directory of the index file.
 */
function sameOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    if (ua.protocol === "file:" && ub.protocol === "file:") {
      const dir = path.dirname(fileURLToPath(ub));
      const file = fileURLToPath(ua);
      const rel = path.relative(dir, file);
      return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
    }
    return ua.protocol === "https:" && ub.protocol === "https:" && ua.host === ub.host;
  } catch {
    return false;
  }
}

/** Validate an index document without trusting its shape. */
export function parseIndex(raw: unknown, registryUrl: string): RegistryIndex {
  if (!raw || typeof raw !== "object") throw new Error("Registry index is not an object");
  const doc = raw as { name?: unknown; skills?: unknown };
  const name = typeof doc.name === "string" && doc.name.trim() ? doc.name.trim().slice(0, 80) : new URL(registryUrl).host;
  if (!Array.isArray(doc.skills)) throw new Error("Registry index has no skills array");
  const skills: RegistrySkill[] = [];
  for (const item of doc.skills.slice(0, 500)) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    if (typeof s.slug !== "string" || !SLUG_RE.test(s.slug)) continue;
    if (!s.files || typeof s.files !== "object") continue;
    const files: Record<string, RegistrySkillFile> = {};
    for (const [rel, f] of Object.entries(s.files as Record<string, unknown>)) {
      if (!REL_RE.test(rel) || !f || typeof f !== "object") continue;
      const { url, sha256 } = f as { url?: unknown; sha256?: unknown };
      if (typeof url !== "string" || typeof sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(sha256)) continue;
      if (!sameOrigin(url, registryUrl)) continue; // files must live where the index lives
      files[rel] = { url, sha256: sha256.toLowerCase() };
    }
    if (!files["SKILL.md"] || Object.keys(files).length > MAX_FILES) continue;
    skills.push({
      slug: s.slug,
      name: typeof s.name === "string" ? s.name.slice(0, 120) : s.slug,
      description: typeof s.description === "string" ? s.description.slice(0, 500) : "",
      version: typeof s.version === "string" ? s.version.slice(0, 40) : "0.0.0",
      files,
      ...(typeof s.author === "string" ? { author: s.author.slice(0, 120) } : {}),
      ...(typeof s.homepage === "string" && s.homepage.startsWith("https://") ? { homepage: s.homepage.slice(0, 300) } : {}),
    });
  }
  return { name, skills };
}

export class SkillRegistry {
  private cache = new Map<string, { at: number; index: RegistryIndex }>();

  constructor(
    private readonly fetcher: Fetcher = defaultFetcher,
    private readonly ttlMs = 10 * 60_000,
  ) {}

  async index(registryUrl: string, now = Date.now(), force = false): Promise<RegistryIndex> {
    if (!isRegistryUrl(registryUrl)) throw new Error("Registries must be https:// or file:// URLs");
    const hit = this.cache.get(registryUrl);
    if (hit && !force && now - hit.at < this.ttlMs) return hit.index;
    const res = await this.fetcher(registryUrl);
    if (!res.ok) throw new Error(`Registry ${registryUrl} answered ${res.status}`);
    const index = parseIndex(JSON.parse(Buffer.from(res.bytes).toString("utf8")), registryUrl);
    this.cache.set(registryUrl, { at: now, index });
    return index;
  }

  /** Every skill of every registry, tagged with where it came from; a failing registry is skipped with its error. */
  async catalog(
    registries: readonly string[],
    opts: { force?: boolean } = {},
  ): Promise<{ entries: RegistryEntry[]; errors: Array<{ registry: string; error: string }> }> {
    const entries: RegistryEntry[] = [];
    const errors: Array<{ registry: string; error: string }> = [];
    for (const registry of registries) {
      try {
        const idx = await this.index(registry, Date.now(), opts.force === true);
        for (const s of idx.skills) entries.push({ ...s, registry, registryName: idx.name });
      } catch (err) {
        errors.push({ registry, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { entries, errors };
  }

  /**
   * Download and verify every file of a registry skill into a fresh temp
   * directory. Returns the directory; the caller imports it and removes it.
   */
  async stage(entry: RegistrySkill): Promise<string> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mordomo-skill-${entry.slug}-`));
    try {
      for (const [rel, f] of Object.entries(entry.files)) {
        const res = await this.fetcher(f.url);
        if (!res.ok) throw new Error(`${rel}: ${res.status}`);
        if (res.bytes.byteLength > MAX_FILE_BYTES) throw new Error(`${rel}: larger than ${MAX_FILE_BYTES} bytes`);
        const digest = crypto.createHash("sha256").update(res.bytes).digest("hex");
        if (digest !== f.sha256) throw new Error(`${rel}: digest mismatch`);
        const target = path.join(dir, rel);
        if (!target.startsWith(dir + path.sep)) throw new Error(`${rel}: escapes the skill folder`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, res.bytes);
      }
      return dir;
    } catch (err) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw err;
    }
  }
}
