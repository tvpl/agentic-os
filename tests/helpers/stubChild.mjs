/**
 * The stub of the local models' child process (.specs/features/cerebro-busca-significado, checks "Level honesty" b
 * and c): it speaks the real child's messages (`embed`, `rerank`, `ping`, `exit`) and loads no model. Its vectors and
 * its reranker's "yes" probabilities come from a table the test writes, so a "synonym" is the test's choice; it writes
 * its pid and every message it receives to files the test reads, and crashes or waits when told to.
 *
 * `run(dir)` is called by a small `child.mjs` the test writes into `dir` (see `buscaStubs.ts`), so the service is given
 * one path, the same option it gives the real child.
 *
 * `dir/control.json` (read at each message):
 *   vectors:   { "<text as received>": number[] }   the vector of a text; any other text gets a fixed one of its length
 *   scores:    { "<text>": number }                 the reranker's "yes" probability of a candidate (default 0.5)
 *   crash:     "every" | number[]                   end with code 1 on every embed, or on these embeds (1-based, over
 *                                                    every child: the count is kept in `dir/embeds`)
 *   delayMs:   number                               wait this long before each answer
 *   rerankDelayMs: number                           wait this long before a rerank answer
 *   crashOnRerank: boolean                          end with code 1 on a rerank
 */
import fs from "node:fs";
import path from "node:path";

const read = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};

/** A deterministic vector for a text the table does not name: the same text, the same vector. */
function fallback(text, dims) {
  const out = [];
  let h = 2166136261;
  for (const ch of Buffer.from(text, "utf8")) h = Math.imul(h ^ ch, 16777619) >>> 0;
  for (let i = 0; i < dims; i++) {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
    out.push(((h % 2000) - 1000) / 1000 || 0.001);
  }
  return out;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function run(dir) {
  fs.appendFileSync(path.join(dir, "pids"), `${process.pid}\n`);
  const log = (message) =>
    fs.appendFileSync(path.join(dir, "log.jsonl"), `${JSON.stringify({ pid: process.pid, ...message })}\n`);
  process.on("message", async (message) => {
    log(message);
    const control = read(path.join(dir, "control.json"), {});
    if (message.t === "exit") process.exit(0);
    if (message.t === "ping") return process.send({ t: "result", id: message.id });
    if (message.t === "embed") {
      const count = Number(read(path.join(dir, "embeds"), 0)) + 1;
      fs.writeFileSync(path.join(dir, "embeds"), String(count));
      if (control.crash === "every" || (Array.isArray(control.crash) && control.crash.includes(count)))
        process.exit(1);
      if (control.delayMs) await sleep(control.delayMs);
      const dims = message.model.dimensions ?? 8;
      const vectors = message.texts.map((text) => control.vectors?.[text] ?? fallback(text, dims));
      return process.send({ t: "result", id: message.id, vectors });
    }
    if (message.t === "rerank") {
      if (control.crashOnRerank) process.exit(1);
      if (control.rerankDelayMs) await sleep(control.rerankDelayMs);
      const scores = message.texts.map((text) => control.scores?.[text] ?? 0.5);
      return process.send({ t: "result", id: message.id, scores });
    }
  });
  process.on("disconnect", () => process.exit(0));
}
