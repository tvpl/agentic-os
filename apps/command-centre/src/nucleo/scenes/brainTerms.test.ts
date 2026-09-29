import { describe, expect, it } from "vitest";
import { buildCorpus, keyTerms, notesWith, sharedTermNeighbours, tokenize, whyTerms } from "./brainTerms";

describe("tokenize", () => {
  it("keeps meaningful words in both languages and drops the glue, code and links", () => {
    const t = tokenize(
      "The OAuth session failed — a sessão não foi renovada. See `npm run x` and https://example.com/a ```\ncode block\n```",
    );
    expect(t).toContain("oauth");
    expect(t).toContain("session");
    expect(t).toContain("sessão");
    expect(t).toContain("renovada");
    expect(t).not.toContain("the");
    expect(t).not.toContain("não");
    expect(t).not.toContain("npm");
    expect(t).not.toContain("example");
    expect(t).not.toContain("code");
  });
  it("ignores numbers and tiny words", () => {
    expect(tokenize("2026 a to be 42 x1 abc")).toEqual(["abc"]);
  });
});

describe("keyTerms", () => {
  const texts = [
    "Budget review for the kitchen renovation. Budget numbers, contractor quotes.",
    "Weekly review of the project roadmap.",
    "Review the garden plan.",
    "Kitchen tiles and paint.",
    "Review notes on reading.",
  ];
  const corpus = buildCorpus(texts);
  it("prefers what is frequent in the note and rare in the brain", () => {
    const terms = keyTerms(texts[0]!, corpus).map((k) => k.term);
    expect(terms[0]).toBe("budget");
    expect(terms).toContain("kitchen");
    // "review" is in most notes: not a key
    expect(terms).not.toContain("review");
  });
  it("weighs title words more and caps the list", () => {
    const terms = keyTerms(texts[0]!, corpus, { emphasis: "Contractor quotes", max: 2 }).map((k) => k.term);
    expect(terms).toHaveLength(2);
    expect(terms).toContain("contractor");
  });
  it("finds the notes that share a term and the closest unlinked notes", () => {
    expect(notesWith("kitchen", corpus, 0)).toEqual([3]);
    const near = sharedTermNeighbours(["kitchen", "budget"], corpus, 0, new Set());
    expect(near[0]).toEqual({ index: 3, shared: ["kitchen"] });
    expect(sharedTermNeighbours(["kitchen"], corpus, 0, new Set([3]))).toEqual([]);
  });
});

describe("whyTerms", () => {
  it("reads the terms out of a similarity reason", () => {
    expect(whyTerms("Similar content (76%): settings, area, assign.")).toEqual([
      "settings",
      "area",
      "assign",
    ]);
    expect(whyTerms("One file links to the other with a markdown link.")).toEqual([]);
  });
});
