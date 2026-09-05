import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

/**
 * The producer side of the marketplace (plan follow-up 9): turn a folder of
 * skills into a registry — one `index.json` with a SHA-256 per file and the
 * files copied beside it — and sign the index with an Ed25519 key generated
 * once into `config/registry-signing.json`. A consumer that pins the public
 * key on the registry URL (`…/index.json#key=<base64url>`) refuses an index
 * that is unsigned, tampered or signed by anyone else.
 */

export interface SigningKeys {
  /** base64url of the raw 32-byte Ed25519 public key. */
  publicKey: string;
  /** base64url of the PKCS#8 DER private key. */
  privateKey: string;
}

export interface IndexSignature {
  alg: "ed25519";
  publicKey: string;
  sig: string;
}

const b64 = {
  enc: (b: Uint8Array | Buffer) => Buffer.from(b).toString("base64url"),
  dec: (s: string) => Buffer.from(s, "base64url"),
};

export function generateSigningKeys(): SigningKeys {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  return {
    publicKey: b64.enc(spki.subarray(spki.length - 32)),
    privateKey: b64.enc(privateKey.export({ type: "pkcs8", format: "der" }) as Buffer),
  };
}

/** Load or create the signing pair (0600). */
export function ensureSigningKeys(configDir: string): SigningKeys {
  const file = path.join(configDir, "registry-signing.json");
  if (fs.existsSync(file)) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<SigningKeys>;
    if (parsed.publicKey && parsed.privateKey) return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
  }
  const keys = generateSigningKeys();
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(keys, null, 2), { mode: 0o600 });
  return keys;
}

/** Deterministic JSON: keys sorted at every level, no whitespace. What gets signed. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function publicKeyObject(publicKey: string): crypto.KeyObject {
  const raw = b64.dec(publicKey);
  if (raw.length !== 32) throw new Error("Ed25519 public key must be 32 bytes");
  // SPKI prefix for Ed25519 (RFC 8410).
  const prefix = Buffer.from("302a300506032b6570032100", "hex");
  return crypto.createPublicKey({ key: Buffer.concat([prefix, raw]), type: "spki", format: "der" });
}

/** Sign `{ name, skills }` (everything but the signature block itself). */
export function signIndex<T extends { name: string; skills: unknown[] }>(index: T, keys: SigningKeys): T & { signature: IndexSignature } {
  const { signature: _drop, ...body } = index as T & { signature?: unknown };
  void _drop;
  const key = crypto.createPrivateKey({ key: b64.dec(keys.privateKey), type: "pkcs8", format: "der" });
  const sig = crypto.sign(null, Buffer.from(canonicalJson(body)), key);
  return { ...(body as T), signature: { alg: "ed25519", publicKey: keys.publicKey, sig: b64.enc(sig) } };
}

export interface VerifyResult {
  signed: boolean;
  /** True only when a signature is present and valid under `expectedPublicKey` (or its own key when none is expected). */
  verified: boolean;
  publicKey: string | null;
  reason?: string;
}

/** Verify a raw index document. With `expectedPublicKey`, the signer must be that key. */
export function verifyIndex(doc: unknown, expectedPublicKey?: string): VerifyResult {
  if (!doc || typeof doc !== "object") return { signed: false, verified: false, publicKey: null, reason: "not an object" };
  const { signature, ...body } = doc as { signature?: Partial<IndexSignature> } & Record<string, unknown>;
  if (!signature || typeof signature !== "object") return { signed: false, verified: false, publicKey: null, reason: "unsigned" };
  if (signature.alg !== "ed25519" || typeof signature.publicKey !== "string" || typeof signature.sig !== "string")
    return { signed: true, verified: false, publicKey: null, reason: "malformed signature" };
  if (expectedPublicKey && signature.publicKey !== expectedPublicKey)
    return { signed: true, verified: false, publicKey: signature.publicKey, reason: "signed by another key" };
  try {
    const ok = crypto.verify(null, Buffer.from(canonicalJson(body)), publicKeyObject(signature.publicKey), b64.dec(signature.sig));
    return { signed: true, verified: ok, publicKey: signature.publicKey, ...(ok ? {} : { reason: "signature does not match the index" }) };
  } catch (err) {
    return { signed: true, verified: false, publicKey: signature.publicKey, reason: (err as Error).message };
  }
}

export interface PublishOptions {
  /** Folder holding one sub-folder per skill (each with a SKILL.md). */
  skillsDir: string;
  /** Registry output folder: `index.json` plus a copy of every published file. */
  outDir: string;
  /** Where the files will be served from; defaults to the `file://` URL of `outDir`. */
  baseUrl?: string;
  name?: string;
  /** Sign the index (recommended). Omit to publish unsigned. */
  keys?: SigningKeys;
  /** Only these slugs (default: every skill in the folder). */
  slugs?: string[];
}

export interface PublishResult {
  indexFile: string;
  registryUrl: string;
  skills: Array<{ slug: string; version: string; files: number }>;
  skipped: Array<{ dir: string; reason: string }>;
  signed: boolean;
  publicKey: string | null;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 40;
/** Local-only files that never travel: notes, archives, backups, hidden files. */
const EXCLUDED = new Set(["NOTES.md", "NOTES.archive.md"]);

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (/\.bak(-\d+)?$/.test(entry.name)) continue;
      out.push(...walk(full, base));
    } else if (entry.isFile()) {
      const rel = path.relative(base, full).split(path.sep).join("/");
      if (EXCLUDED.has(rel) || /\.bak(-\d+)?$/.test(entry.name)) continue;
      out.push(rel);
    }
  }
  return out.sort();
}

export function publishRegistry(opts: PublishOptions): PublishResult {
  const outDir = path.resolve(opts.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const baseUrl = (opts.baseUrl ?? `file://${outDir}`).replace(/\/+$/, "");
  const skills: Array<Record<string, unknown>> = [];
  const summary: PublishResult["skills"] = [];
  const skipped: PublishResult["skipped"] = [];
  const wanted = opts.slugs ? new Set(opts.slugs) : null;
  for (const entry of fs.readdirSync(opts.skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = path.join(opts.skillsDir, entry.name);
    const skillFile = path.join(dir, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;
    let front: Record<string, unknown>;
    try {
      front = matter(fs.readFileSync(skillFile, "utf8")).data as Record<string, unknown>;
    } catch (err) {
      skipped.push({ dir, reason: `frontmatter: ${(err as Error).message}` });
      continue;
    }
    const slug = typeof front.slug === "string" ? front.slug : entry.name;
    if (!SLUG_RE.test(slug)) {
      skipped.push({ dir, reason: `invalid slug "${slug}"` });
      continue;
    }
    if (wanted && !wanted.has(slug)) continue;
    const rels = walk(dir);
    if (rels.length > MAX_FILES) {
      skipped.push({ dir, reason: `${rels.length} files (max ${MAX_FILES})` });
      continue;
    }
    const files: Record<string, { url: string; sha256: string }> = {};
    let tooBig: string | null = null;
    for (const rel of rels) {
      const bytes = fs.readFileSync(path.join(dir, rel));
      if (bytes.length > MAX_FILE_BYTES) {
        tooBig = rel;
        break;
      }
      const target = path.join(outDir, slug, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
      files[rel] = { url: `${baseUrl}/${slug}/${rel}`, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
    }
    if (tooBig) {
      skipped.push({ dir, reason: `${tooBig} larger than ${MAX_FILE_BYTES} bytes` });
      fs.rmSync(path.join(outDir, slug), { recursive: true, force: true });
      continue;
    }
    const version = typeof front.version === "string" ? front.version : "1.0.0";
    skills.push({
      slug,
      name: typeof front.name === "string" ? front.name : slug,
      description: typeof front.description === "string" ? front.description : "",
      version,
      files,
      ...(typeof front.author === "string" ? { author: front.author } : {}),
    });
    summary.push({ slug, version, files: rels.length });
  }
  const index = { name: opts.name ?? path.basename(outDir), skills };
  const doc = opts.keys ? signIndex(index, opts.keys) : index;
  const indexFile = path.join(outDir, "index.json");
  fs.writeFileSync(indexFile, `${JSON.stringify(doc, null, 2)}\n`);
  const registryUrl = `${baseUrl}/index.json${opts.keys ? `#key=${opts.keys.publicKey}` : ""}`;
  return { indexFile, registryUrl, skills: summary, skipped, signed: !!opts.keys, publicKey: opts.keys?.publicKey ?? null };
}
