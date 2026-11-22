/**
 * The model catalog (.specs/features/cerebro-busca-significado, door 3, Landing row 9): the only models the `local`
 * provider and the reranker run, each with the files to download, their sizes and SHA-256 sums fixed here, and the only
 * hosts a download may touch, redirects included. A model changed upstream fails its sum and is deleted; a model that is
 * not in this list cannot be named (the id names a folder of the home).
 *
 * The values were read from the repository's own listing (`/api/models/<repo>/tree/<commit>`: the size and, for a
 * large file, the SHA-256 of its content) and, for a small file, from the bytes downloaded at that commit, on
 * 16/11/2026, and each model was downloaded through `ModelDownloads` and its sums verified. `minSimilarity` is the
 * abstention's floor for that model's cosine scale (Assumptions "Limiar de abstenção"), measured the same day over the
 * Portuguese corpus (`tests/fixtures/pt-corpus`, `pt-queries.json`) with the real model on Linux x64: the best cosine of
 * the 12 `abstain` questions against that of the 48 others (EmbeddingGemma: abstain 0.48-0.65, others 0.63-0.84;
 * Qwen3-Embedding: abstain 0.25-0.61, others 0.41-0.83).
 */

export interface ModelFile {
  /** Relative to the model's folder and to `source`: forward slashes, no `..`, never absolute. */
  path: string;
  bytes: number;
  sha256: string;
}

export interface ModelEntry {
  id: string;
  kind: "embedder" | "reranker";
  /** What the screen shows. */
  name: string;
  repo: string;
  dtype: string;
  /** The URL every file path is read from (its `resolve/<commit>/` folder). */
  source: string;
  files: ModelFile[];
  /** The hosts a download may reach, the first request and every redirect; `*.<domain>` is any host under it. */
  hosts: string[];
  /** Embedders: the length of one vector, how many characters of a section it is given, its floor of similarity. */
  dimensions?: number;
  maxChars?: number;
  minSimilarity?: number;
  /** Embedders: how the token vectors become one (the model card's). */
  pooling?: "mean" | "last_token";
  license: { name: string; url: string; acceptRequired: boolean };
  queryPrefix?: string;
  documentPrefix?: string;
}

/**
 * Where the repository's large files are served from: the first request's 302 goes to a CDN host under `cdn.hf.co`
 * whose name changes with the request (seen on 16/11/2026: `us.aws.cdn.hf.co` and `us.gcp.cdn.hf.co`), so the entry
 * names that domain and any host under it, never another one.
 */
const HF_CDN_HOST = "cdn.hf.co";
const HF_HOSTS = ["huggingface.co", `*.${HF_CDN_HOST}`];
const APACHE = {
  name: "Apache-2.0",
  url: "https://www.apache.org/licenses/LICENSE-2.0",
  acceptRequired: false,
};

export const MODEL_CATALOG: readonly ModelEntry[] = [
  {
    id: "embeddinggemma-300m-q4",
    kind: "embedder",
    name: "EmbeddingGemma 300M",
    repo: "onnx-community/embeddinggemma-300m-ONNX",
    dtype: "q4",
    source:
      "https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX/resolve/5090578d9565bb06545b4552f76e6bc2c93e4a66/",
    files: [
      {
        path: "config.json",
        bytes: 1765,
        sha256: "6e1f06404b7163e0325ed2ea3e6781cde50f4a50b31780a95ad0d30e8404d77b",
      },
      {
        path: "tokenizer.json",
        bytes: 20323312,
        sha256: "4dda02faaf32bc91031dc8c88457ac272b00c1016cc679757d1c441b248b9c47",
      },
      {
        path: "tokenizer_config.json",
        bytes: 1156830,
        sha256: "3ca953eea6c3c9fcda9cf3df22949ff18b216f7c74bd6459230f3f1013953f3a",
      },
      {
        path: "onnx/model_q4.onnx",
        bytes: 519322,
        sha256: "ad1dfee81a70f7944b9b9d1cc6e48075b832881cf33fab2f2b248be78f3f0043",
      },
      {
        path: "onnx/model_q4.onnx_data",
        bytes: 196725760,
        sha256: "599962c3143b040de2dd05e5975be3e9091dd067cacc6a8f7186e3203bab9e02",
      },
    ],
    hosts: HF_HOSTS,
    dimensions: 768,
    maxChars: 2000,
    minSimilarity: 0.62,
    pooling: "mean",
    license: { name: "Gemma", url: "https://ai.google.dev/gemma/terms", acceptRequired: true },
    queryPrefix: "task: search result | query: ",
    documentPrefix: "title: none | text: ",
  },
  {
    id: "qwen3-embedding-0.6b-q4f16",
    kind: "embedder",
    name: "Qwen3-Embedding 0.6B",
    repo: "onnx-community/Qwen3-Embedding-0.6B-ONNX",
    dtype: "q4f16",
    source:
      "https://huggingface.co/onnx-community/Qwen3-Embedding-0.6B-ONNX/resolve/c25a394dd583836952667c12f008335071b3f43d/",
    files: [
      {
        path: "config.json",
        bytes: 1576,
        sha256: "66a10929782f3c9a3cd5dec90e2a95c60e05736134a63cd54479eeae80bed175",
      },
      {
        path: "tokenizer.json",
        bytes: 11423705,
        sha256: "def76fb086971c7867b829c23a26261e38d9d74e02139253b38aeb9df8b4b50a",
      },
      {
        path: "tokenizer_config.json",
        bytes: 9731,
        sha256: "977648852447cb6587327ff3205b0a84cf2fc9f05621d6c8e88a497caafab2e1",
      },
      {
        path: "onnx/model_q4f16.onnx",
        bytes: 567458583,
        sha256: "7f9ebb9a77c428f2b4c2d8ed8a2ee64f292a0b1ce7a3f027ccaaef150ef7bdd1",
      },
    ],
    hosts: HF_HOSTS,
    dimensions: 1024,
    maxChars: 2000,
    minSimilarity: 0.45,
    pooling: "last_token",
    license: APACHE,
    queryPrefix:
      "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery:",
  },
  {
    id: "qwen3-reranker-0.6b-q4",
    kind: "reranker",
    name: "Qwen3-Reranker 0.6B",
    repo: "onnx-community/Qwen3-Reranker-0.6B-ONNX",
    dtype: "q4",
    source:
      "https://huggingface.co/onnx-community/Qwen3-Reranker-0.6B-ONNX/resolve/9995c50e2310679108a55f5ccd16ba8be9f17c20/",
    files: [
      {
        path: "config.json",
        bytes: 1359,
        sha256: "ea7e71d263350d75f8fd0ad710328e96453be8ce2aa9dfe296000ee1366bb869",
      },
      {
        path: "generation_config.json",
        bytes: 214,
        sha256: "64d86df2173901c58389974bde21f7d2ab9eb7d79f35a337753329d39cf265c0",
      },
      {
        path: "tokenizer.json",
        bytes: 11422654,
        sha256: "aeb13307a71acd8fe81861d94ad54ab689df773318809eed3cbe794b4492dae4",
      },
      {
        path: "tokenizer_config.json",
        bytes: 5404,
        sha256: "443bfa629eb16387a12edbf92a76f6a6f10b2af3b53d87ba1550adfcf45f7fa0",
      },
      {
        path: "onnx/model_q4.onnx",
        bytes: 995235866,
        sha256: "787193952a9aa58374381ec7647b160ac6c200a386dbfc3bc998a3c458081330",
      },
    ],
    hosts: HF_HOSTS,
    license: APACHE,
  },
];

/** Is `host` one of `hosts`: the same name, or a host under the domain of a `*.<domain>` entry (not the domain itself). */
export function hostAllowed(hosts: readonly string[], host: string): boolean {
  const name = host.toLowerCase();
  return hosts.some((entry) =>
    entry.startsWith("*.") ? name.endsWith(entry.slice(1)) && name.length > entry.length - 1 : name === entry,
  );
}

/** A catalog id: lower-case letters, digits, `.`, `-`, `_`, starting with a letter or digit; never `.` or `..`. */
export const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** A file path of the catalog: relative segments of the same characters, none of them `.` or `..`. */
export function isModelFilePath(file: string): boolean {
  const parts = file.split("/");
  return parts.every((part) => /^[A-Za-z0-9._-]+$/.test(part) && part !== "." && part !== "..");
}

/**
 * Throws when a catalog cannot be trusted to name folders and URLs: an id or a path that could leave its folder, a sum
 * that is not 64 hex digits, a file of no bytes, a source whose host is not one of its own `hosts`, an embedder without
 * its numbers. The assembly checks the catalog it is given (the real one, or a test's) before anything reads it.
 */
export function checkCatalog(catalog: readonly ModelEntry[]): void {
  const seen = new Set<string>();
  for (const entry of catalog) {
    const where = `model catalog: ${entry.id}`;
    if (!MODEL_ID.test(entry.id) || entry.id.includes(".."))
      throw new Error(`${where}: the id cannot name a folder`);
    if (seen.has(entry.id)) throw new Error(`${where}: listed twice`);
    seen.add(entry.id);
    if (entry.files.length === 0) throw new Error(`${where}: no files`);
    for (const file of entry.files) {
      if (!isModelFilePath(file.path))
        throw new Error(`${where}: the path ${file.path} could leave its folder`);
      if (!(Number.isSafeInteger(file.bytes) && file.bytes > 0))
        throw new Error(`${where}: ${file.path} has no size`);
      if (!/^[0-9a-f]{64}$/.test(file.sha256)) throw new Error(`${where}: ${file.path} has no SHA-256`);
    }
    const source = new URL(entry.source);
    if (!hostAllowed(entry.hosts, source.hostname))
      throw new Error(`${where}: the source is not on one of its hosts`);
    if (entry.kind === "embedder") {
      if (!(entry.dimensions && entry.dimensions > 0)) throw new Error(`${where}: no dimensions`);
      if (!(entry.maxChars && entry.maxChars > 0)) throw new Error(`${where}: no maxChars`);
      if (!(entry.minSimilarity !== undefined && entry.minSimilarity > 0 && entry.minSimilarity < 1))
        throw new Error(`${where}: minSimilarity is not between 0 and 1`);
    }
  }
}
