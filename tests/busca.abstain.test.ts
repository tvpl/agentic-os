import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fuse } from "../core/src/memory/semantic.js";
import {
  decideAbstention,
  prefersVectorSection,
  recall,
  withinTokenBudget,
} from "../core/src/memory/recall.js";
import { buscaWorld, type BuscaWorld } from "./helpers/buscaWorld.js";

/**
 * .specs/features/cerebro-busca-significado, S5 at its own layer (Test policy "Decides, reached across a boundary"): the
 * fusion, the section choice, the abstention, the hops and the token budget, called with no HTTP.
 */

const worlds: BuscaWorld[] = [];
afterAll(async () => {
  for (const w of worlds) await w.close();
});

// ---------------------------------------------------------------------------------------------- C69

describe("C69 the fusion at its own layer", () => {
  // The check writes B's score as 1/61 + 1/61; B is second in the text list, so RRF gives it 1/62 + 1/61 (reported to
  // the coordinator); the order B, A, C is the claim's.
  it("C69 text [A 5, B 2] and vectors [B, C 9] with k 60 give B (1/62 + 1/61), A (1/61), C (1/62)", () => {
    expect(
      fuse(
        [
          [5, 2],
          [2, 9],
        ],
        60,
      ),
    ).toEqual([
      { id: 2, score: 1 / 62 + 1 / 61 },
      { id: 5, score: 1 / 61 },
      { id: 9, score: 1 / 62 },
    ]);
  });
  it("C69 two files with equal scores go lower id first (D 3 before A 5), and a file in neither list is absent", () => {
    const fused = fuse([[5], [3]], 60);
    expect(fused.map((f) => f.id)).toEqual([3, 5]);
    expect(fused[0]!.score).toBe(fused[1]!.score);
    expect(fused.some((f) => f.id === 7)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------- C73

describe("C73 which section a fused file gives, at its own layer", () => {
  it("C73 the vector section scoring higher is taken", () => {
    expect(prefersVectorSection(4, 5)).toBe(true);
  });
  it("C73 the vector section scoring exactly equal is taken", () => {
    expect(prefersVectorSection(4.5, 4.5)).toBe(true);
  });
  it("C73 the vector section scoring lower leaves the best text section", () => {
    expect(prefersVectorSection(4.5, 4.49)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------- C76

describe("C76 the weak rule at its own layer", () => {
  const base = { candidates: 3, minSimilarity: 0.2, abstain: true };
  it.each([
    ["4 keywords, a section matching exactly 2, any cosine: not weak", 4, 2, 0.01, null],
    ["4 keywords, a section matching exactly 2, no vectors: not weak", 4, 2, null, null],
    ["4 keywords, best match 1, cosine 0.19 under 0.2: weak", 4, 1, 0.19, "weak"],
    ["4 keywords, best match 1, cosine exactly 0.2: not weak", 4, 1, 0.2, null],
    ["4 keywords, best match 1, no vectors: weak", 4, 1, null, "weak"],
    ["5 keywords, a section matching 3: not weak", 5, 3, 0.1, null],
    ["5 keywords, best match 2, cosine 0.1: weak", 5, 2, 0.1, "weak"],
  ] as const)("C76 %s", (_name, keywords, matched, cosine, want) => {
    expect(decideAbstention({ ...base, keywords, matched, cosine })).toBe(want);
  });
  it.each([
    [4, 1, 0.19],
    [4, 1, null],
    [5, 2, 0.1],
  ] as const)(
    "C76 with abstain false, %s keywords, match %s, cosine %s is not weak",
    (keywords, matched, cosine) => {
      expect(decideAbstention({ ...base, abstain: false, keywords, matched, cosine })).toBe(null);
    },
  );
  it("C76 no keyword or no candidate is no_match, with abstain true and false", () => {
    for (const abstain of [true, false]) {
      expect(decideAbstention({ ...base, abstain, keywords: 0, matched: 0, cosine: null })).toBe("no_match");
      expect(
        decideAbstention({ ...base, abstain, candidates: 0, keywords: 2, matched: 0, cosine: 0.9 }),
      ).toBe("no_match");
    }
  });
});

// ---------------------------------------------------------------------------------------------- C80

/**
 * A chain A → B → C → D (G32): A is the one candidate opened (`k` 1, it alone holds both words), and each linked section
 * scores higher than the one that pointed to it (one keyword, more often, under the heading "Amora").
 */
const amoras = (n: number) => Array.from({ length: n }, () => "amora").join(" ");
export const CHAIN = {
  inicio: "Inicio amora, veja [b](./b.md).\n",
  b: `## Amora\n\n${amoras(4)} e [c](./c.md).\n`,
  c: `## Amora\n\n${amoras(8)} e [d](./d.md).\n`,
  d: `## Amora\n\n${amoras(16)}.\n`,
};

async function chainWorld(c = CHAIN.c): Promise<BuscaWorld> {
  const w = await buscaWorld("mordomo-busca-c80-");
  worlds.push(w);
  w.note("inicio", CHAIN.inicio);
  w.note("b", CHAIN.b);
  w.note("c", c);
  w.note("d", CHAIN.d);
  await w.index();
  return w;
}

describe("C80 the hops at their own layer", () => {
  it("C80 hops 1, 2 and 3 give A B, A B C and A B C D, each via the file that pointed directly", async () => {
    const w = await chainWorld();
    const rel = (p: string | undefined) => (p ? path.basename(p, ".md") : null);
    const at = (hops: number) => {
      w.update((s) => {
        s.memory.recall = { ...s.memory.recall, hops };
      });
      return recall(w.ctx.db, w.ctx.paths, w.ctx.settings(), "inicio amora", { k: 1 })
        .answerContext.map((c) => [rel(c.path), rel(c.via)])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    };
    const [a, b, c, d] = [
      ["inicio", null],
      ["b", "inicio"],
      ["c", "b"],
      ["d", "c"],
    ];
    // by path: the answer itself is in today's order, by score
    expect(at(1)).toEqual([b, a]);
    expect(at(2)).toEqual([b, c, a]);
    expect(at(3)).toEqual([b, c, d, a]);
  });
  it("C80 with C scoring no higher than B, C is not added and D is not reached", async () => {
    const w = await chainWorld(`## Amora\n\n${amoras(4)} e [d](./d.md).\n`);
    w.update((s) => {
      s.memory.recall = { ...s.memory.recall, hops: 3 };
    });
    const answer = recall(w.ctx.db, w.ctx.paths, w.ctx.settings(), "inicio amora", { k: 1 }).answerContext;
    expect(answer.map((c) => path.basename(c.path, ".md")).sort()).toEqual(["b", "inicio"]);
  });
});

// ---------------------------------------------------------------------------------------------- C82

describe("C82 the token budget at its own layer", () => {
  const ex = (n: number) => ({ excerpt: "x".repeat(n) });
  it("C82 budget 500 with excerpts of 1 996, 8 and 4 characters keeps the first and the third, tokensEstimate exactly 500", () => {
    const answer = [ex(1996), ex(8), ex(4)];
    const out = withinTokenBudget(answer, 500);
    expect(out.kept).toEqual([answer[0], answer[2]]);
    expect(out.tokensEstimate).toBe(500);
  });
  it("C82 an excerpt of 2 000 characters alone fits a budget of 500", () => {
    expect(withinTokenBudget([ex(2000)], 500)).toEqual({ kept: [ex(2000)], tokensEstimate: 500 });
  });
  it("C82 an excerpt of 2 004 characters alone is dropped and tokensEstimate is 0", () => {
    expect(withinTokenBudget([ex(2004)], 500)).toEqual({ kept: [], tokensEstimate: 0 });
  });
});
