import type { Settings } from "../config/schema.js";
import { STOPWORDS, stemLite } from "./recall.js";

/**
 * Embedding providers for the semantic half of the search (.specs/features/cerebro-v2, S4, door 3).
 *
 * `hash` is the default and needs nothing: it turns a text into 256 numbers in this process, the same numbers on every
 * machine, with no model and no network. `http` sends the text to an endpoint the owner configured, and only when the
 * endpoint policy below lets it. Nothing here runs unless `memory.embeddings.enabled` is on.
 */

export interface EmbeddingProvider {
  /** What `file_vectors.provider` records: a change of this string recomputes every vector. */
  readonly id: string;
  readonly dim: number;
  /** True when the text never leaves this process. */
  readonly local: boolean;
  /** Most characters of one note the provider is given. */
  readonly maxChars: number;
  /** Cosine similarity under which a file is not a semantic hit at all (noise of a 256-slot hash, say). */
  readonly minSimilarity?: number;
  /** Unit-length vectors (`dim` numbers each), in the order of `texts`. */
  embed(texts: readonly string[], signal: AbortSignal): Promise<Float32Array[]>;
}

export type EmbeddingSettings = Settings["memory"]["embeddings"];

/** The provider could not do what was asked; `kind` says how, for `semantic.error`. */
export class EmbeddingError extends Error {
  constructor(
    readonly kind: "timeout" | "status" | "dimension" | "malformed" | "network",
    message: string,
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

// ----------------------------------------------------------------------------------------------------- hash

export const HASH_DIM = 256;
export const HASH_PROVIDER_ID = `hash-v1:${HASH_DIM}`;
const HASH_MAX_CHARS = 20_000;
/** A bigram is weaker evidence than the word itself. */
const BIGRAM_WEIGHT = 0.5;

/** FNV-1a over the UTF-8 bytes: 32 bits, the same on every platform and every run. */
function fnv1a(text: string, seed = 0): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (const byte of Buffer.from(text, "utf8")) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function words(text: string): string[] {
  const out: string[] = [];
  const folded = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  for (const part of folded.split(/[^a-z0-9]+/)) {
    if (part.length < 2 || STOPWORDS.has(part)) continue;
    if (/^\d+$/.test(part) && part.length < 4) continue;
    out.push(stemLite(part));
  }
  return out;
}

/**
 * The hashing embedder: unigrams and bigrams of the stemmed words, each hashed to one of 256 slots with a sign
 * (so unrelated words cancel instead of piling up), weighted by 1 + ln(count), and scaled to unit length. A text with
 * no words gives all zeros (length 0, never NaN). It sees spelling, not meaning: "refund" and "reimbursement" are as
 * far apart as any two words.
 */
export function hashEmbed(text: string): Float32Array {
  const sourced = words(text.slice(0, HASH_MAX_CHARS));
  const counts = new Map<string, { n: number; weight: number }>();
  const add = (feature: string, weight: number) => {
    const entry = counts.get(feature);
    if (entry) entry.n++;
    else counts.set(feature, { n: 1, weight });
  };
  sourced.forEach((word, i) => {
    add(`u:${word}`, 1);
    if (i > 0) add(`b:${sourced[i - 1]} ${word}`, BIGRAM_WEIGHT);
  });
  const slots = new Float64Array(HASH_DIM);
  for (const [feature, { n, weight }] of counts) {
    const at = fnv1a(feature) % HASH_DIM;
    const sign = (fnv1a(feature, 0x9e3779b9) & 1) === 0 ? 1 : -1;
    slots[at] = slots[at]! + sign * weight * (1 + Math.log(n));
  }
  return normalized(slots);
}

function normalized(values: ArrayLike<number>): Float32Array {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i]! * values[i]!;
  const out = new Float32Array(values.length);
  if (sum === 0) return out;
  const norm = Math.sqrt(sum);
  for (let i = 0; i < values.length; i++) out[i] = values[i]! / norm;
  return out;
}

export const hashProvider: EmbeddingProvider = {
  id: HASH_PROVIDER_ID,
  dim: HASH_DIM,
  local: true,
  maxChars: HASH_MAX_CHARS,
  minSimilarity: 0.2,
  async embed(texts) {
    return texts.map(hashEmbed);
  },
};

// ------------------------------------------------------------------------------------------------------ http

export const HTTP_BATCH = 16;
export const HTTP_MAX_CHARS = 8_000;
export const HTTP_TIMEOUT_MS = 30_000;
export const HTTP_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** `localhost`, `127.0.0.0/8`, `::1`: an endpoint on this machine. A name that resolves there is not trusted as one. */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);
}

export type EndpointVerdict = { ok: true; url: URL } | { ok: false; reason: string };

/**
 * May note text be sent to this endpoint? A loopback address always (an embeddings server the owner runs); anything
 * else only over `https` and only when `sendRemote` is on. A credential in the address, or a scheme other than
 * http(s), is never accepted.
 */
export function endpointPolicy(config: Pick<EmbeddingSettings, "endpoint" | "sendRemote">): EndpointVerdict {
  const raw = config.endpoint?.trim();
  if (!raw) return { ok: false, reason: "the endpoint is missing" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "the endpoint is not a URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "the endpoint is not http or https" };
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "the endpoint carries a credential" };
  if (isLoopbackHost(url.hostname)) return { ok: true, url };
  if (url.protocol !== "https:") return { ok: false, reason: "the endpoint is not https and not on this machine" };
  if (!config.sendRemote) return { ok: false, reason: "sending notes to a remote endpoint needs sendRemote" };
  return { ok: true, url };
}

/** The body of a response, never more than `limit` bytes of it (a declared length past it is refused unread). */
async function readCapped(response: Response, limit: number): Promise<string> {
  const tooLarge = () => new EmbeddingError("malformed", `the response is larger than ${limit} bytes`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let step: ReadableStreamReadResult<Uint8Array>;
    try {
      step = await reader.read();
    } catch (error) {
      throw new EmbeddingError("network", `the answer broke off: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (step.done) break;
    total += step.value.byteLength;
    if (total > limit) {
      // The stream may already be torn down by the other end; the verdict is the same.
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(step.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function httpProvider(url: URL, config: EmbeddingSettings, dim: number): EmbeddingProvider {
  const model = config.model ?? "";
  return {
    id: `http:${model}:${dim}`,
    dim,
    local: false,
    maxChars: HTTP_MAX_CHARS,
    async embed(texts, signal) {
      const out: Float32Array[] = [];
      for (let from = 0; from < texts.length; from += HTTP_BATCH) {
        out.push(...(await postBatch(url, config, dim, texts.slice(from, from + HTTP_BATCH).map((t) => t.slice(0, HTTP_MAX_CHARS)), signal)));
      }
      return out;
    },
  };
}

async function postBatch(
  url: URL,
  config: EmbeddingSettings,
  dim: number,
  input: string[],
  signal: AbortSignal,
): Promise<Float32Array[]> {
  const key = config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined;
  const timeout = AbortSignal.timeout(HTTP_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model: config.model ?? "", input }),
      signal: AbortSignal.any([signal, timeout]),
    });
  } catch (error) {
    if (timeout.aborted) throw new EmbeddingError("timeout", `no answer in ${HTTP_TIMEOUT_MS} ms`);
    if (signal.aborted) throw error;
    // undici says "fetch failed" and keeps the reason (an unexpected redirect, a refused connection) in `cause`.
    const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : "";
    throw new EmbeddingError("network", `${error instanceof Error ? error.message : String(error)}${cause}`);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new EmbeddingError("status", `the endpoint answered ${response.status}`);
  }
  let body: unknown;
  try {
    body = JSON.parse(await readCapped(response, HTTP_MAX_RESPONSE_BYTES));
  } catch (error) {
    if (error instanceof EmbeddingError) throw error;
    throw new EmbeddingError("malformed", "the answer is not JSON");
  }
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data) || data.length !== input.length)
    throw new EmbeddingError("malformed", "the answer has no `data` with one entry per text");
  return data.map((row: unknown) => {
    const vector = (row as { embedding?: unknown } | null)?.embedding;
    if (!Array.isArray(vector) || !vector.every((n) => typeof n === "number" && Number.isFinite(n)))
      throw new EmbeddingError("malformed", "an embedding is not a list of numbers");
    if (vector.length !== dim) throw new EmbeddingError("dimension", `an embedding has ${vector.length} numbers, not ${dim}`);
    return normalized(vector as number[]);
  });
}

// ------------------------------------------------------------------------------------------------ the choice

export type ProviderChoice =
  | { state: "off" }
  | { state: "blocked"; reason: string }
  | { state: "ready"; provider: EmbeddingProvider };

/** The provider these settings ask for, or why there is none. Pure: nothing is sent, nothing is loaded. */
export function chooseProvider(config: EmbeddingSettings): ProviderChoice {
  if (!config.enabled) return { state: "off" };
  if (config.provider === "hash") return { state: "ready", provider: hashProvider };
  const verdict = endpointPolicy(config);
  if (!verdict.ok) return { state: "blocked", reason: verdict.reason };
  if (!config.model) return { state: "blocked", reason: "the model is missing" };
  if (config.dimensions === undefined) return { state: "blocked", reason: "dimensions is missing: the length of one vector" };
  return { state: "ready", provider: httpProvider(verdict.url, config, config.dimensions) };
}

/** Vectors as the database stores them: Float32, little-endian, whatever the machine. */
export function vectorToBlob(vector: Float32Array): Buffer {
  const out = Buffer.alloc(vector.length * 4);
  for (let i = 0; i < vector.length; i++) out.writeFloatLE(vector[i]!, i * 4);
  return out;
}

export function blobToVector(blob: Buffer): Float32Array {
  const out = new Float32Array(blob.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = blob.readFloatLE(i * 4);
  return out;
}
