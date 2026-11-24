import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { audienceView } from "../apps/api/src/access.js";
import { buildServer } from "../apps/api/src/server.js";
import * as pagerank from "../core/src/memory/pagerank.js";
import {
  PPR_DAMPING,
  personalizedPageRank,
  pprSeeds,
  recallGraph,
  type PprGraph,
} from "../core/src/memory/pagerank.js";
import {
  coMentionEdges,
  computeEntities,
  readCorrections,
  readMentions,
} from "../core/src/memory/entities.js";
import { hybridRecall, runRecall, type HybridRecallOptions } from "../core/src/memory/recall.js";
import { corpusHome, PT_QUERIES } from "./helpers/buscaWorld.js";
import { memoriaWorld, type Json, type MemoriaWorld } from "./helpers/memoriaWorld.js";

/**
 * .specs/features/cerebro-entidades-resumos, batch B, S4 (door 5, Landing 5a): the personalized PageRank at its own layer
 * (hand-built graphs, scores against the test's own power iteration), the graph of a real index, and the recall with the
 * graph on and off through `runRecall` and `GET /api/memory/recall`.
 */

// The PageRank, wrapped so a test can see whether the recall called it (C50); every call goes to the real function.
vi.mock("../core/src/memory/pagerank.js", async (importOriginal) => {
  const real = await importOriginal<typeof pagerank>();
  return { ...real, personalizedPageRank: vi.fn(real.personalizedPageRank) };
});

// ---- the test's own power iteration -------------------------------------------------------------------------------

/**
 * Personalized PageRank by power iteration, written here: undirected edges (each listed once, both directions),
 * `r(i) = 0.15·p(i) + 0.85·Σ_j r(j)·w(j,i)/W(j) + 0.85·(mass of nodes with no edge)·p(i)`, from `r = p`, at most 30
 * iterations or until the L1 change is below 1e-6.
 */
function reference(
  nodes: number[],
  edges: Array<[number, number, number]>,
  seeds: Record<number, number>,
): { scores: Record<number, number>; iterations: number } {
  const out: Record<number, Array<[number, number]>> = {};
  for (const n of nodes) out[n] = [];
  for (const [a, b, w] of edges) {
    out[a]!.push([b, w]);
    out[b]!.push([a, w]);
  }
  const p: Record<number, number> = {};
  for (const n of nodes) p[n] = seeds[n] ?? 0;
  let r = { ...p };
  let iterations = 0;
  for (let t = 0; t < 30; t++) {
    iterations++;
    const next: Record<number, number> = {};
    for (const n of nodes) next[n] = 0;
    let dangling = 0;
    for (const j of nodes) {
      const total = out[j]!.reduce((s, [, w]) => s + w, 0);
      if (total === 0) dangling += r[j]!;
      else for (const [i, w] of out[j]!) next[i]! += (0.85 * r[j]! * w) / total;
    }
    let change = 0;
    for (const i of nodes) {
      next[i]! += (0.15 + 0.85 * dangling) * p[i]!;
      change += Math.abs(next[i]! - r[i]!);
    }
    r = next;
    if (change < 1e-6) break;
  }
  return { scores: r, iterations };
}

function graphOf(nodes: number[], edges: Array<[number, number, number]>): PprGraph {
  const g: PprGraph = new Map(nodes.map((n) => [n, new Map<number, number>()]));
  for (const [a, b, w] of edges) {
    g.get(a)!.set(b, w);
    g.get(b)!.set(a, w);
  }
  return g;
}

function expectScores(got: Map<number, number>, want: Record<number, number>): void {
  for (const [id, value] of Object.entries(want)) {
    expect(
      Math.abs(got.get(Number(id))! - value),
      `node ${id}: ${got.get(Number(id))} vs ${value}`,
    ).toBeLessThan(1e-9);
  }
}

describe("C44 the PageRank at its own layer", () => {
  it("C44 damping 0.85; a 3-node chain from one end runs the 30 iterations", () => {
    expect(PPR_DAMPING).toBe(0.85);
    const nodes = [1, 2, 3];
    const edges: Array<[number, number, number]> = [
      [1, 2, 1],
      [2, 3, 1],
    ];
    const want = reference(nodes, edges, { 1: 1 });
    const got = personalizedPageRank(graphOf(nodes, edges), new Map([[1, 1]]));
    expect(want.iterations).toBe(30);
    expect(got.iterations).toBe(30);
    expectScores(got.scores, want.scores);
    expect(got.scores.get(1)!).toBeGreaterThan(got.scores.get(3)!);
  });

  it("C44 a star with two seeded leaves", () => {
    const nodes = [1, 2, 3, 4, 5];
    const edges: Array<[number, number, number]> = [
      [1, 2, 1],
      [1, 3, 1],
      [1, 4, 1],
      [1, 5, 1],
    ];
    const seeds = { 2: 0.5, 3: 0.5 };
    const want = reference(nodes, edges, seeds);
    const got = personalizedPageRank(
      graphOf(nodes, edges),
      new Map([
        [2, 0.5],
        [3, 0.5],
      ]),
    );
    expect(got.iterations).toBe(want.iterations);
    expectScores(got.scores, want.scores);
    expect(got.scores.get(4)!).toBeGreaterThan(0);
  });

  it("C44 two components: the one without seeds stays 0", () => {
    const nodes = [1, 2, 3, 4];
    const edges: Array<[number, number, number]> = [
      [1, 2, 1],
      [3, 4, 0.5],
    ];
    const want = reference(nodes, edges, { 1: 1 });
    const got = personalizedPageRank(graphOf(nodes, edges), new Map([[1, 1]]));
    expectScores(got.scores, want.scores);
    expect(got.scores.get(3)).toBe(0);
    expect(got.scores.get(4)).toBe(0);
  });

  it("C44 the L1 change under 1e-6 stops the iteration before 30", () => {
    // two nodes seeded alike are already where the walk leaves them: the first iteration changes nothing
    const nodes = [1, 2];
    const edges: Array<[number, number, number]> = [[1, 2, 1]];
    const want = reference(nodes, edges, { 1: 0.5, 2: 0.5 });
    const got = personalizedPageRank(
      graphOf(nodes, edges),
      new Map([
        [1, 0.5],
        [2, 0.5],
      ]),
    );
    expect(want.iterations).toBe(1);
    expect(got.iterations).toBe(1);
    expectScores(got.scores, want.scores);
  });
});

describe("C45 the seeds", () => {
  it("C45 25 fused files: the first 20 weigh 1/(60 + place) normalized to 1, the 21st 0", () => {
    const fused = Array.from({ length: 25 }, (_, i) => 100 + i);
    const seeds = pprSeeds(fused);
    expect(seeds.size).toBe(20);
    let total = 0;
    for (let place = 1; place <= 20; place++) total += 1 / (60 + place);
    fused.slice(0, 20).forEach((id, i) => {
      expect(Math.abs(seeds.get(id)! - 1 / (60 + i + 1) / total)).toBeLessThan(1e-12);
    });
    expect(seeds.get(fused[20]!) ?? 0).toBe(0);
    expect(Math.abs([...seeds.values()].reduce((a, b) => a + b, 0) - 1)).toBeLessThan(1e-12);
  });
});

// ---- a real index -------------------------------------------------------------------------------------------------

async function fresh(run: (w: MemoriaWorld, root: string) => Promise<void>): Promise<void> {
  const w = await memoriaWorld("mordomo-entidades-graph-");
  try {
    await run(w, w.indexedRoot("acervo"));
  } finally {
    await w.close();
  }
}

const idOf = (w: MemoriaWorld, file: string): number =>
  (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(file) as { id: number }).id;
const everyFile = (w: MemoriaWorld): number[] =>
  (w.ctx.db.prepare("SELECT id FROM files").all() as Array<{ id: number }>).map((r) => r.id);
/** The co-mention edges of the owner's entities, worked out from the index. */
const ownerCoMentions = (w: MemoriaWorld) => () =>
  coMentionEdges(
    computeEntities(
      readMentions(w.ctx.db, () => true),
      readCorrections(w.ctx.db),
    ),
  );
/** No related edge but the ones a test writes (the pass works some out from the words). */
const noRelated = (w: MemoriaWorld) => {
  w.ctx.db.prepare("DELETE FROM file_related").run();
  w.ctx.db.prepare("DELETE FROM file_related_devices").run();
};
const weight = (g: PprGraph, a: number, b: number) => g.get(a)?.get(b);

describe("C46 the edges, one case per kind", () => {
  it("C46 a link is two edges of 1; a related edge of 0.4 weighs 0.4; two shared entities 1.0; an ignored entity and a hub add nothing", async () => {
    await fresh(async (w, root) => {
      const a = w.put(path.join(root, "a.md"), "veja [b](b.md)\n");
      const b = w.put(path.join(root, "b.md"), "nada\n");
      const c = w.put(path.join(root, "c.md"), "nada aqui\n");
      const d = w.put(path.join(root, "d.md"), "nada ali\n");
      const e = w.put(path.join(root, "e.md"), "notas #xis #ypsilon\n");
      const f = w.put(path.join(root, "f.md"), "outras #xis #ypsilon\n");
      const g = w.put(path.join(root, "g.md"), "notas #zeta\n");
      const h = w.put(path.join(root, "h.md"), "outras #zeta\n");
      const hubs = Array.from({ length: 51 }, (_, i) =>
        w.put(path.join(root, "hub", `h${String(i).padStart(2, "0")}.md`), `item ${i} #comum\n`),
      );
      await w.index();
      noRelated(w);
      const [ia, ib, ic, id, ie, iff, ig, ih] = [a, b, c, d, e, f, g, h].map((p) => idOf(w, p)) as number[];
      w.ctx.db
        .prepare(
          "INSERT INTO file_related (src_id, dst_id, score, terms, updated_at) VALUES (?, ?, 0.4, '[]', 0)",
        )
        .run(ic, id);
      w.ctx.db
        .prepare(
          "INSERT INTO entity_overrides (action, a, b, name, created_at) VALUES ('ignore', 'zeta', NULL, NULL, 1)",
        )
        .run();
      const graph = recallGraph(
        w.ctx.db,
        {
          allowRow: () => true,
          readable: () => true,
          relatedTable: "file_related",
          coMentions: ownerCoMentions(w),
        },
        everyFile(w),
      );
      expect([weight(graph, ia!, ib!), weight(graph, ib!, ia!)]).toEqual([1, 1]);
      expect([weight(graph, ic!, id!), weight(graph, id!, ic!)]).toEqual([0.4, 0.4]);
      expect([weight(graph, ie!, iff!), weight(graph, iff!, ie!)]).toEqual([1, 1]);
      expect(graph.get(ig!)?.size ?? 0).toBe(0);
      expect(graph.get(ih!)?.size ?? 0).toBe(0);
      const hubIds = hubs.map((p) => idOf(w, p));
      for (const id of hubIds) expect(graph.get(id)?.size ?? 0).toBe(0);
    });
  });
});

describe("C47 the edges by audience", () => {
  it("C47 a link to a hidden file is no edge and a file reached only through it is not reached; a device's related edges are its table's", async () => {
    await fresh(async (w, root) => {
      const hidden = path.join(root, "sigilo");
      const a = w.put(path.join(root, "a.md"), "veja [h](sigilo/h.md)\n");
      const h = w.put(path.join(hidden, "h.md"), "veja [c](../c.md)\n");
      const c = w.put(path.join(root, "c.md"), "nada\n");
      const d = w.put(path.join(root, "d.md"), "nada ali\n");
      await w.index();
      noRelated(w);
      const [ia, ih, ic, id] = [a, h, c, d].map((p) => idOf(w, p)) as number[];
      const insert = (table: string, score: number) =>
        w.ctx.db
          .prepare(
            `INSERT INTO ${table} (src_id, dst_id, score, terms, updated_at) VALUES (?, ?, ?, '[]', 0)`,
          )
          .run(ia, id, score);
      insert("file_related", 0.9);
      insert("file_related_devices", 0.3);
      const source = (
        readable: (p: string) => boolean,
        relatedTable: "file_related" | "file_related_devices",
      ) => ({
        allowRow: () => true,
        readable,
        relatedTable,
        coMentions: () => [],
      });
      // the owner: a reaches h and, through it, c
      const owner = recallGraph(
        w.ctx.db,
        source(() => true, "file_related"),
        [ia!],
      );
      expect(weight(owner, ia!, ih!)).toBe(1);
      expect(owner.has(ic!)).toBe(true);
      expect(weight(owner, ia!, id!)).toBe(0.9);
      // hidden from the caller: no edge to h, and c is not reached
      const device = recallGraph(
        w.ctx.db,
        source((p) => !p.startsWith(hidden), "file_related_devices"),
        [ia!],
      );
      expect(weight(device, ia!, ih!)).toBeUndefined();
      expect(device.has(ih!)).toBe(false);
      expect(device.has(ic!)).toBe(false);
      expect(weight(device, ia!, id!)).toBe(0.3);
    });
  });

  it("C47 at the boundary: with the graph on, the owner's recall reaches the hidden neighbour and a device's never names it", async () => {
    await fresh(async (w, root) => {
      const hidden = path.join(root, "sigilo");
      w.put(
        path.join(root, "m.md"),
        "# Girafa\n\nA girafa come folhas.\n\n## Ver também\n\n- [h](sigilo/h.md)\n",
      );
      const h = w.put(path.join(hidden, "h.md"), "# Tratador\n\nO tratador chega cedo.\n");
      w.update((s) => {
        s.memory.recall.graph.enabled = true;
        s.folderAccess = [{ path: hidden, agents: "read", devices: "hide" }];
      });
      await w.index();
      const owner = await w.call("GET", "/api/memory/recall?q=girafa&record=false");
      expect(owner.status).toBe(200);
      expect(owner.body.answerContext.map((c: Json) => c.path)).toContain(h);
      const device = await w.call(
        "GET",
        "/api/memory/recall?q=girafa&record=false",
        undefined,
        w.device(["content"]),
      );
      expect(device.status).toBe(200);
      expect(JSON.stringify(device.body)).not.toContain(hidden);
      expect(device.body.answerContext.length).toBeGreaterThan(0);
    });
  });
});

/** The recall of `q` through `runRecall` with the world's settings (or `settings`) and these options. */
const run = (w: MemoriaWorld, q: string, opts: HybridRecallOptions = {}, settings = w.ctx.settings()) =>
  runRecall(w.ctx.db, w.ctx.paths, settings, q, opts);
const pathsOf = (files: Array<{ path: string }> | null) => (files ?? []).map((f) => f.path);

describe("C48 the fusion of the two orders", () => {
  it("C48 five files: the order is the RRF (k 60) of the fused order and the PageRank order; each item's graph is its PageRank place", async () => {
    await fresh(async (w, root) => {
      const names = ["a", "b", "c", "d", "e"];
      const links: Record<string, string[]> = { a: ["c"], b: ["e"], c: ["d"], d: [], e: [] };
      const files = names.map((n, i) =>
        w.put(
          path.join(root, `${n}.md`),
          `# Nota ${n}\n\n${"a girafa come. ".repeat(i + 1)}\n\n## Ligações\n\n${links[n]!.map((t) => `- [${t}](${t}.md)`).join("\n")}\n`,
        ),
      );
      w.update((s) => {
        s.memory.recall.graph.enabled = true;
      });
      await w.index();
      noRelated(w);
      const ids = files.map((p) => idOf(w, p));
      const byName = Object.fromEntries(names.map((n, i) => [n, ids[i]!]));
      const got = await run(w, "girafa", { k: 5 });
      const fused = got.fused.map((f) => f.id);
      expect([...fused].sort()).toEqual([...ids].sort());

      // the PageRank the test computes: the links (each 1, both ways), seeds 1/(60 + place) over the fused order
      const edges: Array<[number, number, number]> = Object.entries(links).flatMap(([s, ts]) =>
        ts.map((t) => [byName[s]!, byName[t]!, 1] as [number, number, number]),
      );
      const total = fused.reduce((sum, _, i) => sum + 1 / (60 + i + 1), 0);
      const seeds = Object.fromEntries(fused.map((id, i) => [id, 1 / (60 + i + 1) / total]));
      const { scores } = reference(ids, edges, seeds);
      const pprOrder = [...fused].sort(
        (x, y) => scores[y]! - scores[x]! || fused.indexOf(x) - fused.indexOf(y),
      );
      // RRF, k 60: 1/(60 + place in each list), a tie to the lower id
      const rrf = (id: number) => 1 / (60 + fused.indexOf(id) + 1) + 1 / (60 + pprOrder.indexOf(id) + 1);
      const want = [...ids].sort((x, y) => rrf(y) - rrf(x) || x - y);
      expect(got.graphed!.map((f) => f.id)).toEqual(want);

      const res = await w.call("GET", "/api/memory/recall?q=girafa&k=5&record=false");
      expect(res.status).toBe(200);
      expect(res.body.answerContext).toHaveLength(5);
      for (const item of res.body.answerContext) {
        expect(item.graph, item.path).toBe(pprOrder.indexOf(idOf(w, item.path)) + 1);
      }
    });
  });
});

describe("C49 the files the graph lets in", () => {
  it("C49 a graph offering 5 files outside the fusion admits the 3 with the highest PageRank", async () => {
    await fresh(async (w, root) => {
      const outs = ["o1", "o2", "o3", "o4", "o5"];
      w.put(
        path.join(root, "m.md"),
        `# Girafa\n\nA girafa come.\n\n## Ver\n\n${outs.map((o) => `- [${o}](${o}.md)`).join("\n")}\n`,
      );
      // o1 is also linked to o2 and o4: their walk keeps more of the mass
      w.put(path.join(root, "o1.md"), "um\n\n- [o2](o2.md)\n- [o4](o4.md)\n");
      for (const o of outs.slice(1)) w.put(path.join(root, `${o}.md`), `nada ${o}\n`);
      w.update((s) => {
        s.memory.recall.graph.enabled = true;
      });
      await w.index();
      noRelated(w);
      const m = idOf(w, path.join(root, "m.md"));
      const ids = Object.fromEntries(outs.map((o) => [o, idOf(w, path.join(root, `${o}.md`))]));
      const got = await run(w, "girafa");
      expect(got.fused.map((f) => f.id)).toEqual([m]);
      const edges: Array<[number, number, number]> = [
        ...outs.map((o) => [m, ids[o]!, 1] as [number, number, number]),
        [ids.o1!, ids.o2!, 1],
        [ids.o1!, ids.o4!, 1],
      ];
      const { scores } = reference([m, ...Object.values(ids)], edges, { [m]: 1 });
      const top3 = Object.values(ids)
        .sort((x, y) => scores[y]! - scores[x]! || x - y)
        .slice(0, 3);
      expect(top3).toEqual([ids.o1, ids.o2, ids.o4]);
      expect(
        got
          .graphed!.map((f) => f.id)
          .filter((id) => id !== m)
          .sort(),
      ).toEqual([...top3].sort());
    });
  });

  /** m links to ok and to `refused` (both with the front matter `mFront`); without the refusal both enter, with it only ok. */
  async function refusal(
    setup: (w: MemoriaWorld, root: string) => void,
    refused: string,
    asked: (
      w: MemoriaWorld,
      root: string,
    ) => { opts?: HybridRecallOptions; settings?: ReturnType<MemoriaWorld["ctx"]["settings"]> },
    mFront = "",
  ): Promise<void> {
    await fresh(async (w, root) => {
      w.put(
        path.join(root, "m.md"),
        `${mFront}# Girafa\n\nA girafa come.\n\n## Ver\n\n- [ok](ok.md)\n- [x](${refused})\n`,
      );
      w.put(path.join(root, "ok.md"), `${mFront}# Ok\n\nnada aqui\n`);
      setup(w, root);
      w.update((s) => {
        s.memory.recall.graph.enabled = true;
      });
      await w.index();
      noRelated(w);
      const ok = path.join(root, "ok.md");
      const target = path.join(root, refused);
      const control = await run(w, "girafa");
      expect(pathsOf(control.graphed)).toEqual(expect.arrayContaining([ok, target]));
      const { opts = {}, settings } = asked(w, root);
      const got = await run(w, "girafa", opts, settings ?? w.ctx.settings());
      expect(got.result.abstained).toBe(false);
      expect(pathsOf(got.graphed)).toContain(ok);
      expect(pathsOf(got.graphed)).not.toContain(target);
      expect(got.result.answerContext.map((c) => c.path)).not.toContain(target);
    });
  }

  it("C49 a neighbour the policy excludes today never enters", async () => {
    await refusal(
      (w, root) => w.put(path.join(root, "pol.md"), "# Pol\n\nnada pol\n"),
      "pol.md",
      (w) => {
        w.update((s) => {
          s.excludes = [...s.excludes, "pol.md"];
        });
        return {};
      },
    );
  });

  it("C49 a neighbour outside the asked context never enters", async () => {
    await refusal(
      (w, root) => w.put(path.join(root, "fora", "f.md"), "# Fora\n\nnada fora\n"),
      "fora/f.md",
      (_w, root) => ({
        opts: { within: (row: { rel: string }) => !row.rel.startsWith("fora") && root.length > 0 },
      }),
    );
  });

  it("C49 a neighbour of a natureza the query filters out never enters", async () => {
    await refusal(
      (w, root) => w.put(path.join(root, "opi.md"), "---\nnatureza: opiniao\n---\n# Opi\n\nnada opi\n"),
      "opi.md",
      () => ({ opts: { natureza: ["fato"] } }),
      "---\nnatureza: fato\n---\n",
    );
  });

  it("C49 a neighbour hidden from the caller never enters", async () => {
    await refusal(
      (w, root) => {
        w.put(path.join(root, "sigilo", "s.md"), "# Sig\n\nnada sig\n");
        w.update((s) => {
          s.folderAccess = [{ path: path.join(root, "sigilo"), agents: "read", devices: "hide" }];
        });
      },
      "sigilo/s.md",
      (w) => ({ settings: audienceView(w.ctx, "devices").settings }),
    );
  });
});

describe("C50 an abstaining recall with the graph on", () => {
  it("C50 abstained, the same reason, no answer, and the PageRank never called", async () => {
    await fresh(async (w, root) => {
      w.put(path.join(root, "m.md"), "# Girafa\n\nA girafa come.\n\n## Ver\n\n- [o](o.md)\n");
      w.put(path.join(root, "o.md"), "nada\n");
      await w.index();
      const q = "xyzzy plugh";
      const off = await hybridRecall(w.ctx.db, w.ctx.paths, w.ctx.settings(), q);
      w.update((s) => {
        s.memory.recall.graph.enabled = true;
      });
      const spy = vi.mocked(pagerank.personalizedPageRank);
      spy.mockClear();
      const on = await hybridRecall(w.ctx.db, w.ctx.paths, w.ctx.settings(), q);
      expect(off.abstained).toBe(true);
      expect([on.abstained, on.abstainReason, on.answerContext]).toEqual([true, off.abstainReason, []]);
      const res = await w.call("GET", `/api/memory/recall?q=${encodeURIComponent(q)}&record=false`);
      expect([res.body.abstained, res.body.abstainReason, res.body.answerContext]).toEqual([
        true,
        off.abstainReason,
        [],
      ]);
      expect(spy).not.toHaveBeenCalled();
      // the spy sees the calls of a recall that answers
      await hybridRecall(w.ctx.db, w.ctx.paths, w.ctx.settings(), "girafa");
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});

describe("C51 the plan's independent test", () => {
  it("C51 the note linked only from the matching note is out of the top 3 with the graph off and in it with the graph on", async () => {
    await fresh(async (w, root) => {
      w.put(
        path.join(root, "girafa.md"),
        "# Girafa\n\nA girafa do zoológico come folhas.\n\n## Ver também\n\n- [quem cuida](tratador.md)\n",
      );
      const answer = w.put(
        path.join(root, "tratador.md"),
        "# Tratador\n\nO tratador chega às sete horas e alimenta os animais.\n",
      );
      w.put(path.join(root, "outra.md"), "# Outra\n\nUma nota sobre o jardim.\n");
      await w.index();
      const top3 = async () => {
        const res = await w.call(
          "GET",
          `/api/memory/recall?q=${encodeURIComponent("girafa do zoológico")}&record=false`,
        );
        expect(res.status).toBe(200);
        return res.body.answerContext.slice(0, 3).map((c: Json) => c.path);
      };
      expect(await top3()).not.toContain(answer);
      w.update((s) => {
        s.memory.recall.graph.enabled = true;
      });
      expect(await top3()).toContain(answer);
    });
  });
});

describe("C43 the graph off is the C9 recall", () => {
  it("C43 twelve questions of the corpus answer deep-equal to C9's result with no graph key; k=0 400 validation and context=nope 404, on and off", async () => {
    const home = await corpusHome("hash");
    const app = await buildServer(home.ctx);
    try {
      const token = home.ctx.token();
      const get = async (url: string) => {
        const res = await app.inject({ method: "GET", url, headers: { "x-mordomo-token": token } });
        return { status: res.statusCode, body: res.json() as Json };
      };
      const set = (on: boolean) => {
        const s = home.ctx.settings();
        s.memory.recall.graph.enabled = on;
        home.ctx.settingsStore.save(s);
      };
      set(false);
      // C9's answers, read with the code of the base before this feature (tests/fixtures/entidades/recall-c9.json)
      const c9 = JSON.parse(
        fs.readFileSync(path.join(import.meta.dirname, "fixtures", "entidades", "recall-c9.json"), "utf8"),
      ).results as Json[];
      const queries = (JSON.parse(fs.readFileSync(PT_QUERIES, "utf8")).queries as Array<{ q: string }>).slice(
        0,
        12,
      );
      expect(c9).toHaveLength(12);
      for (const [i, { q }] of queries.entries()) {
        const res = await get(`/api/memory/recall?q=${encodeURIComponent(q)}&record=false`);
        expect(res.status).toBe(200);
        const { durationMs, ...body } = res.body;
        expect(typeof durationMs).toBe("number");
        expect(JSON.parse(JSON.stringify(body).split(home.folder).join("<corpus>")), q).toEqual(c9[i]);
        for (const item of body.answerContext) expect("graph" in item, q).toBe(false);
      }
      for (const on of [false, true]) {
        set(on);
        const zero = await get("/api/memory/recall?q=forno&k=0");
        expect([zero.status, zero.body.error?.code], `graph ${on}`).toEqual([400, "validation"]);
        const nope = await get("/api/memory/recall?q=forno&context=nope");
        expect([nope.status, nope.body.error?.code], `graph ${on}`).toEqual([404, "context_not_found"]);
      }
    } finally {
      await app.close();
      home.cleanup();
    }
  }, 120_000);
});
