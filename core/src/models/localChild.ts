/**
 * The child process of the local models (.specs/features/cerebro-busca-significado, door 2): the ONLY file of MordomoOS
 * that loads `@huggingface/transformers` (and through it `onnxruntime-node`). The service reaches it only as the path
 * it gives `child_process.fork`. It reads models from `<home>/models/` and never from the network: remote models are
 * off, and a model that is not in its folder is an error. It answers `embed`, `rerank` and `ping`, and ends on `exit`
 * or when the service goes.
 */
import type * as TransformersModule from "@huggingface/transformers";
import type { ChildModel, ChildReply, ChildRequest } from "./localHost.js";

type Transformers = typeof TransformersModule;

/** The runtime and the models this process holds: one process, one owner, so they live in `main`'s closure. */
interface Held {
  runtime: Promise<Transformers> | null;
  models: Map<string, Promise<unknown>>;
}

async function transformers(held: Held, modelsDir: string): Promise<Transformers> {
  held.runtime ??= import("@huggingface/transformers");
  const t = await held.runtime;
  t.env.allowRemoteModels = false;
  t.env.allowLocalModels = true;
  t.env.localModelPath = modelsDir;
  t.env.cacheDir = modelsDir;
  return t;
}

async function embedder(held: Held, modelsDir: string, model: ChildModel) {
  const t = await transformers(held, modelsDir);
  const key = `embed:${model.id}`;
  if (!held.models.has(key))
    held.models.set(
      key,
      t.pipeline("feature-extraction", model.id, { dtype: model.dtype as "q4", device: "cpu" }),
    );
  return (await held.models.get(key)) as Awaited<ReturnType<typeof t.pipeline<"feature-extraction">>>;
}

async function reranker(held: Held, modelsDir: string, model: ChildModel) {
  const t = await transformers(held, modelsDir);
  const key = `rerank:${model.id}`;
  if (!held.models.has(key))
    held.models.set(
      key,
      Promise.all([
        t.AutoTokenizer.from_pretrained(model.id),
        t.AutoModelForCausalLM.from_pretrained(model.id, { dtype: model.dtype as "q4", device: "cpu" }),
      ]),
    );
  return (await held.models.get(key)) as [
    Awaited<ReturnType<typeof t.AutoTokenizer.from_pretrained>>,
    Awaited<ReturnType<typeof t.AutoModelForCausalLM.from_pretrained>>,
  ];
}

const RERANK_SYSTEM =
  'Judge whether the Document meets the requirements based on the Query and the Instruct provided. Note that the answer can only be "yes" or "no".';
const RERANK_INSTRUCT = "Given a web search query, retrieve relevant passages that answer the query";

async function handle(held: Held, message: ChildRequest): Promise<ChildReply> {
  if (message.t === "ping") return { t: "result", id: message.id };
  if (message.t === "embed") {
    const extract = await embedder(held, message.modelsDir, message.model);
    const output = await extract(message.texts, {
      pooling: message.model.pooling === "last_token" ? "last_token" : "mean",
      normalize: true,
    });
    return { t: "result", id: message.id, vectors: output.tolist() as number[][] };
  }
  // The probability of "yes" against "no" at the last token of the model card's prompt (door 5).
  const [tokenizer, model] = await reranker(held, message.modelsDir, message.model);
  const yes = tokenizer.convert_tokens_to_ids("yes") as number;
  const no = tokenizer.convert_tokens_to_ids("no") as number;
  const scores: number[] = [];
  for (const text of message.texts) {
    const prompt =
      `<|im_start|>system\n${RERANK_SYSTEM}<|im_end|>\n<|im_start|>user\n` +
      `<Instruct>: ${RERANK_INSTRUCT}\n<Query>: ${message.query}\n<Document>: ${text}<|im_end|>\n` +
      `<|im_start|>assistant\n<think>\n\n</think>\n\n`;
    const inputs = tokenizer(prompt);
    const { logits } = (await model(inputs)) as { logits: { dims: number[]; data: Float32Array } };
    const [, length, vocab] = logits.dims as [number, number, number];
    const last = (length - 1) * vocab;
    const a = logits.data[last + yes]!;
    const b = logits.data[last + no]!;
    const top = Math.max(a, b);
    scores.push(Math.exp(a - top) / (Math.exp(a - top) + Math.exp(b - top)));
  }
  return { t: "result", id: message.id, scores };
}

function main(): void {
  const held: Held = { runtime: null, models: new Map() };
  process.on("message", (raw: unknown) => {
    const message = raw as ChildRequest | { t: "exit" };
    if (message.t === "exit") process.exit(0);
    handle(held, message).then(
      (reply) => process.send?.(reply),
      (error: unknown) =>
        process.send?.({
          t: "error",
          id: message.id,
          message: error instanceof Error ? error.message : String(error),
        }),
    );
  });
  // The service is gone: so is the model.
  process.on("disconnect", () => process.exit(0));
}

main();
