import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../../brain/markdown";
import {
  contextOf,
  cut,
  excerptOf,
  outlineOf,
  plainInline,
  readingMinutes,
  relationRank,
  slugify,
  stripFrontmatter,
} from "./brainReading";

describe("text helpers", () => {
  it("reads flat frontmatter and returns the body", () => {
    const { body, fields } = stripFrontmatter('---\ntype: person\ntitle: "Ana"\n---\n# Ana\nHello');
    expect(fields).toEqual({ type: "person", title: "Ana" });
    expect(body).toBe("# Ana\nHello");
    expect(stripFrontmatter("no front").fields).toEqual({});
  });

  it("strips inline markdown", () => {
    expect(plainInline("**Bold** and _it_ with [a link](x.md), [[Note|alias]] and `code`")).toBe(
      "Bold and it with a link, alias and code",
    );
  });

  it("takes the first real text as an excerpt", () => {
    const src =
      "---\ntype: note\n---\n<!-- generated -->\n# Title\n\n```js\nnope()\n```\n| a | b |\n|---|---|\n\nThe **first** paragraph says what this is about. It goes on.\n\nSecond paragraph.";
    expect(excerptOf(src)).toBe("The first paragraph says what this is about. It goes on. Second paragraph.");
    expect(excerptOf(src, 60)).toBe("The first paragraph says what this is about. It goes on.");
    expect(excerptOf("- [ ] a task\n- [x] another")).toBe("a task another");
    expect(excerptOf("# Only a heading")).toBe("");
  });

  it("cuts at a word with an ellipsis", () => {
    expect(cut("one two three four five six", 14)).toBe("one two three…");
    expect(cut("short", 14)).toBe("short");
  });

  it("estimates reading time", () => {
    expect(readingMinutes("word ".repeat(50))).toBe(1);
    expect(readingMinutes("word ".repeat(1100))).toBe(5);
  });
});

describe("outlineOf", () => {
  it("lists headings with unique, stable ids", () => {
    const blocks = parseMarkdown("# Today\ntext\n## Decisões\n- a\n## Decisões\n### Open loops");
    const o = outlineOf(blocks);
    expect(o.map((x) => x.text)).toEqual(["Today", "Decisões", "Decisões", "Open loops"]);
    expect(o.map((x) => x.id)).toEqual(["bs-h-today", "bs-h-decisoes", "bs-h-decisoes-2", "bs-h-open-loops"]);
    expect(o[3]!.level).toBe(3);
    expect(slugify("¿?")).toBe("section");
  });
});

describe("contextOf", () => {
  const edges = [
    { a: 0, b: 1, kind: "markdown-link", why: "" }, // 0 cites 1
    { a: 2, b: 0, kind: "markdown-link", why: "" }, // 2 cites 0
    { a: 0, b: 3, kind: "related", why: "Similar content (40%): x." },
    { a: 0, b: 1, kind: "same-dir", why: "" }, // weaker than the citation
    { a: 4, b: 0, kind: "same-area", why: "" },
    { a: 5, b: 6, kind: "markdown-link", why: "" }, // not ours
  ];
  it("groups neighbours by their strongest relation", () => {
    const c = contextOf(0, edges);
    expect(c.outgoing.map((e) => e.index)).toEqual([1]);
    expect(c.backlink.map((e) => e.index)).toEqual([2]);
    expect(c.similar.map((e) => e.index)).toEqual([3]);
    expect(c.sibling.map((e) => e.index)).toEqual([4]);
    expect(c.other).toEqual([]);
  });
  it("ranks for the ego sectors and respects visibility", () => {
    const c = contextOf(0, edges, (i) => i !== 4);
    expect(c.sibling).toEqual([]);
    const rank = relationRank(c);
    expect(rank(2)).toBeLessThan(rank(1));
    expect(rank(1)).toBeLessThan(rank(3));
    expect(rank(99)).toBe(5);
  });
});
