import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EmbeddingError } from "../core/src/memory/embeddings.js";
import { rerankFailure, rerankPlan } from "../core/src/memory/recall.js";
import { RERANKER, localWorld, type LocalWorld, type LocalWorldOptions } from "./helpers/buscaStubs.js";
import type { Json } from "./helpers/buscaWorld.js";

/**
 * .specs/features/cerebro-busca-significado, S6 (door 5): the optional reranker of the recall, against the stub child's
 * reranker (checks "Level honesty" c: a "yes" probability per candidate text is the test's choice). The fused order here
 * is the words' (the search off), read from the recall's own `candidates`.
 */

const opened: LocalWorld[] = [];
afterEach(async () => {
  for (const w of opened.splice(0)) await w.close();
});

/** `n` notes that each hold the question word a different number of times: one section, a body of its own. */
const body = (i: number) => `${Array.from({ length: i + 1 }, () => "amora").join(" ")} nota ${i}.`;

async function world(n: number, opts: { install?: boolean; enabled?: boolean } & LocalWorldOptions = {}) {
  const w = await localWorld("mordomo-busca-rerank-", opts);
  opened.push(w);
  if (opts.install !== false) await w.install(RERANKER);
  for (let i = 0; i < n; i++) w.note(`n${String(i).padStart(2, "0")}`, `## Nota ${i}\n\n${body(i)}\n`);
  await w.index();
  w.update((s) => {
    s.memory.recall = {
      ...s.memory.recall,
      rerank: { ...s.memory.recall.rerank, enabled: opts.enabled !== false },
    };
  });
  return w;
}

const reranks = (w: LocalWorld) =>
  w.child.log().filter((m) => m.t === "rerank") as Array<Json & { texts: string[]; pid: number }>;
const recallOf = async (w: LocalWorld, query: string) => {
  const res = await w.call("GET", `/api/memory/recall?${query}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};
const fileOf = (p: string) => path.basename(p, ".md");
/** The fused order: the recall's candidates, read with the reranker off for this request. */
const fusedOrder = async (w: LocalWorld, k = 5) =>
  ((await recallOf(w, `q=amora&k=${k}&rerank=false&record=false`)).candidates as Json[]).map((c) =>
    fileOf(c.path),
  );
const bodyOf = (name: string) => body(Number(name.slice(1)));

// ---------------------------------------------------------------------------------------------- C89

describe("C89 used", () => {
  it("C89 with candidates 3 the reranker gets the 3 best fused sections in the fused order, and the answer takes them by its yes, then the rest in the fused order", async () => {
    const w = await world(5);
    w.update((s) => {
      s.memory.recall = { ...s.memory.recall, rerank: { ...s.memory.recall.rerank, candidates: 3 } };
    });
    const fused = await fusedOrder(w);
    expect(fused).toHaveLength(5);
    const [a, b, c, d, e] = fused as [string, string, string, string, string];
    w.child.control({ scores: { [bodyOf(a)]: 0.1, [bodyOf(b)]: 0.5, [bodyOf(c)]: 0.9 } });
    const answer = await recallOf(w, "q=amora&k=5&record=false");
    expect(reranks(w).map((m) => m.texts)).toEqual([[bodyOf(a), bodyOf(b), bodyOf(c)]]);
    expect(answer.rerank).toBe("used");
    expect((answer.answerContext as Json[]).map((x) => fileOf(x.path))).toEqual([c, b, a, d, e]);
  });
});

// ---------------------------------------------------------------------------------------------- C90

describe("C90 the five outcomes", () => {
  it("C90 at the deciding function's own layer", () => {
    const plan = (enabled: boolean, query: boolean | undefined, ready: boolean) =>
      rerankPlan({ enabled, query, abstained: false, ready });
    expect(plan(false, undefined, true)).toBe("off");
    expect(plan(true, false, true)).toBe("off");
    expect(plan(false, true, true)).toBe("off");
    expect(plan(true, undefined, false)).toBe("skipped");
    expect(plan(true, true, true)).toBe("call");
    expect(rerankFailure(new EmbeddingError("timeout", "late"))).toBe("timeout");
    expect(rerankFailure(new EmbeddingError("local_crashed", "ended"))).toBe("failed");
    expect(rerankFailure(new Error("other"))).toBe("failed");
  });

  /** The answer's files with the reranker off: what every outcome but `used` keeps. */
  const unreranked = async (w: LocalWorld) =>
    ((await recallOf(w, "q=amora&k=5&rerank=false&record=false")).answerContext as Json[]).map((x) =>
      fileOf(x.path),
    );
  const check = async (w: LocalWorld, query: string, want: string) => {
    const keep = await unreranked(w);
    const res = await recallOf(w, `q=amora&k=5&record=false${query}`);
    expect(res.rerank, query).toBe(want);
    expect(
      (res.answerContext as Json[]).map((x) => fileOf(x.path)),
      query,
    ).toEqual(keep);
    return res;
  };

  it("C90 off when disabled, off with rerank=false, and rerank=true cannot turn a disabled reranker on", async () => {
    const w = await world(5, { enabled: false });
    w.child.control({ scores: { [bodyOf("n00")]: 0.99 } });
    await check(w, "", "off");
    await check(w, "&rerank=true", "off");
    w.update((s) => {
      s.memory.recall = { ...s.memory.recall, rerank: { ...s.memory.recall.rerank, enabled: true } };
    });
    await check(w, "&rerank=false", "off");
    expect(reranks(w)).toEqual([]);
  });
  it("C90 skipped when enabled and no reranker is ready", async () => {
    const w = await world(5, { install: false });
    await check(w, "", "skipped");
    expect(w.child.pids()).toEqual([]);
  });
  it("C90 skipped when the platform has no runtime", async () => {
    const w = await world(5, { install: false, platform: "darwin", arch: "x64" });
    expect((await w.embedder()).body.platform).toEqual({ ok: false, reason: "platform_unsupported" });
    await check(w, "", "skipped");
    expect(w.child.pids()).toEqual([]);
  });
  it("C90 timeout when the reranker takes longer than timeoutMs", async () => {
    const w = await world(5);
    w.update((s) => {
      s.memory.recall = { ...s.memory.recall, rerank: { ...s.memory.recall.rerank, timeoutMs: 1000 } };
    });
    w.child.control({ rerankDelayMs: 1500, scores: { [bodyOf("n00")]: 0.99 } });
    await check(w, "", "timeout");
  });
  it("C90 failed when the child ends during rerank", async () => {
    const w = await world(5);
    w.child.control({ crashOnRerank: true, scores: { [bodyOf("n00")]: 0.99 } });
    await check(w, "", "failed");
    expect(reranks(w)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------- C91

describe("C91 the timeout's two sides", () => {
  it("C91 with timeoutMs 1000 set by PUT: 1 500 ms is timeout and the fused order before 1 500 ms, 900 ms is used, and the next recall reaches the same child", async () => {
    const w = await world(5);
    const put = await w.call("PUT", "/api/settings", {
      memory: { recall: { rerank: { enabled: true, candidates: 20, timeoutMs: 1000 } } },
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const fused = await fusedOrder(w);
    const keep = ((await recallOf(w, "q=amora&k=5&rerank=false&record=false")).answerContext as Json[]).map(
      (x) => fileOf(x.path),
    );
    // the last fused file first, by the reranker's yes
    w.child.control({ rerankDelayMs: 1500, scores: { [bodyOf(fused[4]!)]: 0.99 } });
    const started = Date.now();
    const late = await recallOf(w, "q=amora&k=5&record=false");
    expect(Date.now() - started).toBeLessThan(1500);
    expect(late.rerank).toBe("timeout");
    expect((late.answerContext as Json[]).map((x) => fileOf(x.path))).toEqual(keep);
    w.child.control({ rerankDelayMs: 900, scores: { [bodyOf(fused[4]!)]: 0.99 } });
    const inTime = await recallOf(w, "q=amora&k=5&record=false");
    expect(inTime.rerank).toBe("used");
    expect(fileOf((inTime.answerContext as Json[])[0]!.path)).toBe(fused[4]);
    const pids = reranks(w).map((m) => m.pid);
    expect(pids).toHaveLength(2);
    expect(new Set(pids).size).toBe(1);
    expect(w.child.pids()).toHaveLength(1);
  }, 20_000);
});

// ---------------------------------------------------------------------------------------------- C92

describe("C92 the candidates' edges", () => {
  it("C92 with 60 fused sections, candidates 1 sends 1 text, 50 sends 50 and the default sends 20", async () => {
    const w = await world(60);
    expect((await recallOf(w, "q=amora&rerank=false&record=false")).candidatesConsidered).toBe(60);
    const sent: number[] = [];
    for (const candidates of [1, 50, undefined]) {
      const recall =
        candidates === undefined ? {} : { rerank: { enabled: true, candidates, timeoutMs: 15000 } };
      const put = await w.call("PUT", "/api/settings", {
        memory: { recall: candidates === undefined ? { rerank: { enabled: true } } : recall },
      });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      const before = reranks(w).length;
      expect((await recallOf(w, "q=amora&record=false")).rerank).toBe("used");
      sent.push(
        ...reranks(w)
          .slice(before)
          .map((m) => m.texts.length),
      );
    }
    expect(sent).toEqual([1, 50, 20]);
  }, 30_000);
});

// ---------------------------------------------------------------------------------------------- C94

describe("C94 the search never reranks", () => {
  it("C94 with the reranker enabled and ready, a search in text, semantic and auto sends no rerank message", async () => {
    const w = await world(5);
    w.hashOn();
    await w.index();
    for (const mode of ["text", "semantic", "auto"] as const) {
      const res = await w.search("amora", mode);
      expect(res.status, mode).toBe(200);
      expect(res.names.length, mode).toBeGreaterThan(0);
    }
    expect(reranks(w)).toEqual([]);
    // the reranker is there: the recall does call it
    expect((await recallOf(w, "q=amora&record=false")).rerank).toBe("used");
    expect(reranks(w)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------- C96

describe("C96 an abstained answer never calls the reranker", () => {
  it("C96 off when disabled or rerank=false, skipped otherwise, and no rerank message", async () => {
    const w = await world(5);
    for (const q of ["xenobiologiaquantica", "o que é isso?", "amora xablau yyzzq wwqqp zzkkv"]) {
      const on = await recallOf(w, `q=${encodeURIComponent(q)}&record=false`);
      expect([on.abstained, on.rerank], q).toEqual([true, "skipped"]);
      const flag = await recallOf(w, `q=${encodeURIComponent(q)}&rerank=false&record=false`);
      expect([flag.abstained, flag.rerank], q).toEqual([true, "off"]);
    }
    w.update((s) => {
      s.memory.recall = { ...s.memory.recall, rerank: { ...s.memory.recall.rerank, enabled: false } };
    });
    const off = await recallOf(w, "q=xenobiologiaquantica&record=false");
    expect([off.abstained, off.rerank]).toEqual([true, "off"]);
    expect(reranks(w)).toEqual([]);
  });
});
