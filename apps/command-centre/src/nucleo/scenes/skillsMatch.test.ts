import { describe, expect, it } from "vitest";
import { bestMatch, filterSkills, matchScore, NO_FILTERS, stepIndex, withSlashCommand } from "./skillsMatch";

const sk = (slug: string, extra: Partial<Parameters<typeof filterSkills>[0][number]> = {}) => ({
  slug,
  mode: "read_only" as const,
  providers: ["claude" as const],
  enabled: true,
  favorite: false,
  ...extra,
});

describe("filterSkills", () => {
  const list = [
    sk("a"),
    sk("b", { mode: "write" }),
    sk("c", { enabled: false }),
    sk("d", { favorite: true, providers: ["claude", "codex"] }),
  ];
  const slugs = (xs: Array<{ slug: string }>) => xs.map((x) => x.slug);

  it("hides paused skills unless asked", () => {
    expect(slugs(filterSkills(list, NO_FILTERS))).toEqual(["a", "b", "d"]);
    expect(slugs(filterSkills(list, { ...NO_FILTERS, showPaused: true }))).toEqual(["a", "b", "c", "d"]);
  });
  it("filters by mode, provider and favourites", () => {
    expect(slugs(filterSkills(list, { ...NO_FILTERS, mode: "write" }))).toEqual(["b"]);
    expect(slugs(filterSkills(list, { ...NO_FILTERS, provider: "codex" }))).toEqual(["d"]);
    expect(slugs(filterSkills(list, { ...NO_FILTERS, favOnly: true }))).toEqual(["d"]);
  });
  it("keeps the deep-linked skill whatever the filters say", () => {
    expect(slugs(filterSkills(list, { ...NO_FILTERS, mode: "write" }, "c"))).toEqual(["b", "c"]);
  });
});

describe("matchScore", () => {
  const review = {
    slug: "code-review",
    names: ["Code Review", "Revisão de código"],
    triggers: ["review code"],
    descriptions: ["Review a diff for correctness bugs"],
  };
  it("ranks slug starts over names over triggers over descriptions", () => {
    expect(matchScore(review, "code")).toBe(5);
    expect(matchScore(review, "revisão")).toBe(3);
    expect(matchScore({ ...review, names: [] }, "review")).toBe(3);
    expect(matchScore(review, "bugs")).toBe(1);
  });
  it("needs every word and ignores a leading slash", () => {
    expect(matchScore(review, "code nothing")).toBe(0);
    expect(matchScore(review, "/code")).toBe(5);
    expect(matchScore(review, "  ")).toBe(0);
  });
});

describe("bestMatch", () => {
  it("takes the top score, favourites on ties, ring order otherwise", () => {
    expect(
      bestMatch([
        { slug: "a", score: 1 },
        { slug: "b", score: 3 },
        { slug: "c", score: 3 },
      ]),
    ).toBe("b");
    expect(
      bestMatch([
        { slug: "b", score: 3 },
        { slug: "c", score: 3, favorite: true },
      ]),
    ).toBe("c");
    expect(bestMatch([{ slug: "a", score: 0 }])).toBeNull();
  });
});

describe("withSlashCommand", () => {
  it("puts the command in front of what was typed", () => {
    expect(withSlashCommand("", "recall")).toBe("/recall ");
    expect(withSlashCommand("  what about X  ", "recall")).toBe("/recall what about X");
  });
  it("replaces a command already there", () => {
    expect(withSlashCommand("/code-review the auth diff", "recall")).toBe("/recall the auth diff");
    expect(withSlashCommand("/code-review", "recall")).toBe("/recall ");
  });
});

describe("stepIndex", () => {
  it("wraps both ways", () => {
    expect(stepIndex(0, -1, 5)).toBe(4);
    expect(stepIndex(4, 1, 5)).toBe(0);
    expect(stepIndex(0, 1, 0)).toBe(0);
  });
});
