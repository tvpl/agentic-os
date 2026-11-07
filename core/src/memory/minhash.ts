/**
 * MinHash signatures of a text (.specs/features/cerebro-faxina-guiada, door 2): `minhash-v1:64:w5`, 64 hash functions
 * over the set of 5-word shingles of the text with its words folded, each value a `Uint32` written little-endian (256
 * bytes). Only 32-bit integer arithmetic (`Math.imul`, `>>> 0`) and the code points of the text: the same text gives the
 * same bytes on every run and platform, whatever the locale or the time zone. Near-duplicates are found by LSH, 16 bands
 * of 4 values: two texts whose estimated Jaccard similarity is 0.8 or more share a band almost always.
 *
 * This module imports nothing, so that a test can load it in a child process with another `LANG` and `TZ`.
 */

export const MINHASH_ALGO = "minhash-v1:64:w5";
export const MINHASH_FUNCTIONS = 64;
export const MINHASH_SHINGLE_WORDS = 5;
export const MINHASH_BANDS = 16;
export const MINHASH_ROWS = 4;
/** The estimated Jaccard similarity from which two texts are near-duplicates. */
export const NEAR_DUPLICATE_SIMILARITY = 0.8;

/** The words of a text, folded: NFC and Unicode lower case (never the locale's), split on what is not a letter or digit. */
export function minhashWords(text: string): string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

/** The 5-word shingles of a text; a text of fewer words is one shingle, an empty one none. */
export function minhashShingles(text: string): Set<string> {
  const words = minhashWords(text);
  const out = new Set<string>();
  if (words.length === 0) return out;
  if (words.length < MINHASH_SHINGLE_WORDS) {
    out.add(words.join(" "));
    return out;
  }
  for (let i = 0; i + MINHASH_SHINGLE_WORDS <= words.length; i++) {
    out.add(words.slice(i, i + MINHASH_SHINGLE_WORDS).join(" "));
  }
  return out;
}

/** FNV-1a over the UTF-16 code units of a string, 32 bits. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The finaliser of MurmurHash3: spreads a 32-bit value over all 32 bits. */
function mix(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The seeds of the 64 functions, from a fixed start: part of the algorithm id, never to change under `minhash-v1`. */
const SEEDS: readonly number[] = (() => {
  const seeds: number[] = [];
  let state = 0x9e3779b9;
  for (let i = 0; i < MINHASH_FUNCTIONS; i++) {
    state = (state + 0x9e3779b9) >>> 0;
    seeds.push(mix(state));
  }
  return seeds;
})();

/** The signature of a text: 256 bytes, or null for a text with no word. */
export function minhashSignature(text: string): Uint8Array | null {
  const shingles = minhashShingles(text);
  if (shingles.size === 0) return null;
  const mins = new Uint32Array(MINHASH_FUNCTIONS).fill(0xffffffff);
  for (const shingle of shingles) {
    const base = fnv1a(shingle);
    for (let i = 0; i < MINHASH_FUNCTIONS; i++) {
      const value = mix(base ^ SEEDS[i]!);
      if (value < mins[i]!) mins[i] = value;
    }
  }
  const out = new Uint8Array(MINHASH_FUNCTIONS * 4);
  const view = new DataView(out.buffer);
  for (let i = 0; i < MINHASH_FUNCTIONS; i++) view.setUint32(i * 4, mins[i]!, true);
  return out;
}

/** The 64 values of a stored signature. */
export function minhashValues(sig: Uint8Array): Uint32Array {
  const view = new DataView(sig.buffer, sig.byteOffset, sig.byteLength);
  const out = new Uint32Array(MINHASH_FUNCTIONS);
  for (let i = 0; i < MINHASH_FUNCTIONS; i++) out[i] = view.getUint32(i * 4, true);
  return out;
}

/** The estimated Jaccard similarity of two signatures: the share of the 64 values they agree on. */
export function minhashSimilarity(a: Uint8Array, b: Uint8Array): number {
  const va = minhashValues(a);
  const vb = minhashValues(b);
  let same = 0;
  for (let i = 0; i < MINHASH_FUNCTIONS; i++) if (va[i] === vb[i]) same++;
  return same / MINHASH_FUNCTIONS;
}

/**
 * The pairs of ids whose signatures share at least one of the 16 bands of 4 values (the LSH candidates), each pair
 * once, the smaller id first.
 */
export function minhashCandidates(signatures: ReadonlyArray<{ id: number; sig: Uint8Array }>): Array<[number, number]> {
  const pairs = new Map<string, [number, number]>();
  for (let band = 0; band < MINHASH_BANDS; band++) {
    const buckets = new Map<string, number[]>();
    for (const { id, sig } of signatures) {
      if (sig.byteLength !== MINHASH_FUNCTIONS * 4) continue;
      const values = minhashValues(sig);
      const key = Array.from(values.subarray(band * MINHASH_ROWS, (band + 1) * MINHASH_ROWS)).join(",");
      const list = buckets.get(key);
      if (list) list.push(id);
      else buckets.set(key, [id]);
    }
    for (const ids of buckets.values()) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = Math.min(ids[i]!, ids[j]!);
          const b = Math.max(ids[i]!, ids[j]!);
          pairs.set(`${a}:${b}`, [a, b]);
        }
      }
    }
  }
  return [...pairs.values()].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}
