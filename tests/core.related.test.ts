import { describe, expect, it } from "vitest";
import { relatedFromTexts, tokenizeForRelated } from "@mordomo/core";

/** Related-by-content edges: TF-IDF cosine over the indexed text, no model needed. */
describe("related edges", () => {
  it("tokenizes with stop words removed, unicode kept, short tokens dropped", () => {
    const toks = tokenizeForRelated("The Orçamento de setembro: 2026 é sobre ROI, roi e receita!");
    expect(toks).toContain("orçamento");
    expect(toks).toContain("setembro");
    expect(toks).toContain("receita");
    expect(toks).not.toContain("the");
    expect(toks).not.toContain("é");
    expect(toks).not.toContain("2026");
  });

  it("links documents about the same subject and leaves unrelated ones alone", () => {
    const docs = [
      {
        id: 1,
        text: "Invoice for consulting hours: client Acme, hourly rate, payment terms, invoice number, due date.",
      },
      {
        id: 2,
        text: "Acme invoice follow-up: payment terms agreed, hourly consulting rate confirmed, invoice sent.",
      },
      {
        id: 3,
        text: "Sourdough starter notes: flour hydration, levain feeding schedule, oven temperature, crust.",
      },
      {
        id: 4,
        text: "Bread baking log: hydration at 78 percent, levain doubled, oven preheated, crust colour good.",
      },
      { id: 5, text: "Random meeting agenda: introductions, roadmap, questions." },
    ];
    const edges = relatedFromTexts(docs);
    const pair = (a: number, b: number) =>
      edges.find((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a));
    expect(pair(1, 2)).toBeDefined();
    expect(pair(3, 4)).toBeDefined();
    expect(pair(1, 3)).toBeUndefined();
    expect(pair(2, 4)).toBeUndefined();
    expect(pair(1, 2)!.terms.length).toBeGreaterThan(0);
    expect(pair(1, 2)!.score).toBeGreaterThan(0.18);
    for (const e of edges) expect(e.score).toBeLessThanOrEqual(1);
  });

  it("keeps at most topK neighbours per document and drops terms shared by almost everyone", () => {
    // Three clusters of four; cluster words appear in a third of the corpus,
    // "everywhere" appears in every document and must carry no signal.
    const words = ["alpha beta gamma delta", "flour levain crust oven", "invoice payment client rate"];
    const docs = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      text: `everywhere common ${words[i % 3]} ${words[i % 3]} unique${i} extra${i}`,
    }));
    const edges = relatedFromTexts(docs, { topK: 2, minSim: 0.05 });
    expect(edges.length).toBeGreaterThan(0);
    const degree = new Map<number, number>();
    for (const e of edges) {
      expect((e.source - 1) % 3).toBe((e.target - 1) % 3); // only within a cluster
      expect(e.terms).not.toContain("everywhere");
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    // Symmetric top-K: a node can be chosen by others, but each chooses at most K of its own.
    expect(edges.length).toBeLessThanOrEqual(docs.length * 2);
    for (let i = 1; i <= 12; i++) expect(degree.get(i) ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("returns nothing for fewer than two documents", () => {
    expect(relatedFromTexts([{ id: 1, text: "alone here with words" }])).toEqual([]);
  });
});
