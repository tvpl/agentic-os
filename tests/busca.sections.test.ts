import { describe, expect, it } from "vitest";
import { EMBEDDED_EXTENSIONS, MAX_SECTIONS, embeddedText, sectionRows } from "../core/src/memory/sections.js";

/**
 * .specs/features/cerebro-busca-significado, S3, at its own layer: the section splitter shared by the recall and the
 * vectors phase (`core/src/memory/sections.ts`) and the text each section's vector is computed from.
 */

const headings = (text: string, ext = ".md") => sectionRows(text, ext).map((r) => r.heading);

describe("C19 the Markdown splitter", () => {
  it("C19 H1 to H6 each start a section, with the heading path of their ancestors", () => {
    for (let level = 1; level <= 6; level++) {
      const rows = sectionRows(`antes\n${"#".repeat(level)} Título\ncorpo ${level}\n`, ".md");
      expect(
        rows.map((r) => [r.ord, r.heading, r.body]),
        `H${level}`,
      ).toEqual([
        [0, "(top)", "antes"],
        [1, "Título", `corpo ${level}`],
      ]);
    }
    expect(headings("# a\nx\n## b\nx\n### c\nx\n#### d\nx\n##### e\nx\n###### f\nx\n")).toEqual([
      "a",
      "a > b",
      "a > b > c",
      "a > b > c > d",
      "a > b > c > d > e",
      "a > b > c > d > e > f",
    ]);
  });

  it("C19 seven hashes and a hash with no space are not headings", () => {
    expect(sectionRows("intro\n####### x\ncorpo\n", ".md").map((r) => [r.heading, r.body])).toEqual([
      ["(top)", "intro\n####### x\ncorpo"],
    ]);
    expect(sectionRows("intro\n#x\ncorpo\n", ".md").map((r) => [r.heading, r.body])).toEqual([
      ["(top)", "intro\n#x\ncorpo"],
    ]);
  });

  it("C19 a heading inside a ``` fence and inside a ~~~ fence is not one", () => {
    expect(sectionRows("# A\n```\n# x\n```\ncorpo\n", ".md").map((r) => [r.heading, r.body])).toEqual([
      ["A", "```\n# x\n```\ncorpo"],
    ]);
    expect(sectionRows("# A\n~~~\n# x\n~~~\ncorpo\n", ".md").map((r) => [r.heading, r.body])).toEqual([
      ["A", "~~~\n# x\n~~~\ncorpo"],
    ]);
  });

  it("C19 the text before the first heading is the section (top)", () => {
    const rows = sectionRows("primeiro parágrafo\n\n# A\ncorpo\n", ".md");
    expect(rows[0]).toMatchObject({
      ord: 0,
      heading: "(top)",
      body: "primeiro parágrafo",
      startLine: 1,
      endLine: 1,
    });
    expect(rows[1]).toMatchObject({ ord: 1, heading: "A" });
  });

  it("C19 a setext heading is not a heading: its two lines are body", () => {
    expect(sectionRows("Título\n======\ncorpo\n", ".md").map((r) => [r.ord, r.heading, r.body])).toEqual([
      [0, "(top)", "Título\n======\ncorpo"],
    ]);
  });

  it("C19 a heading with an empty body gives no row, and its title is still in its children's path", () => {
    expect(sectionRows("# A\n\n## B\ncorpo\n", ".md").map((r) => [r.ord, r.heading])).toEqual([[0, "A > B"]]);
  });

  it("C19 a CRLF file gives the same rows as its LF twin, with no carriage return in a heading or a body", () => {
    const lf = "antes\n# A\ncorpo a\n\n## B ##\ncorpo b\nmais\n";
    const crlf = lf.replace(/\n/g, "\r\n");
    const rows = sectionRows(crlf, ".md");
    expect(rows).toEqual(sectionRows(lf, ".md"));
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.heading).not.toContain("\r");
      expect(row.body).not.toContain("\r");
    }
  });
});

describe("C20 blocks of 40 lines outside Markdown", () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `linha ${i + 1}`).join("\n") + "\n";
  it("C20 a .txt of exactly 40 lines gives 1 row, 41 gives 2, 80 gives 2", () => {
    expect(sectionRows(lines(40), ".txt").map((r) => [r.ord, r.startLine, r.endLine])).toEqual([[0, 1, 40]]);
    expect(sectionRows(lines(41), ".txt").map((r) => [r.ord, r.startLine, r.endLine])).toEqual([
      [0, 1, 40],
      [1, 41, 41],
    ]);
    expect(sectionRows(lines(80), ".txt").map((r) => [r.ord, r.startLine, r.endLine])).toEqual([
      [0, 1, 40],
      [1, 41, 80],
    ]);
    // a block has no path of its own
    expect(sectionRows(lines(41), ".txt").map((r) => r.path)).toEqual([[], []]);
  });

  it("C20 a .markdown file splits by headings like .md; a .json and a .pdf are not embedded", () => {
    const text = "antes\n# A\ncorpo\n## B\nmais\n";
    expect(sectionRows(text, ".markdown")).toEqual(sectionRows(text, ".md"));
    expect(sectionRows(text, ".markdown").map((r) => r.heading)).toEqual(["(top)", "A", "A > B"]);
    expect(EMBEDDED_EXTENSIONS).toEqual([".md", ".markdown", ".txt"]);
    expect(EMBEDDED_EXTENSIONS).not.toContain(".json");
    expect(EMBEDDED_EXTENSIONS).not.toContain(".pdf");
    expect(MAX_SECTIONS).toBe(64);
  });
});

describe("C23 the embedded text", () => {
  it("C23 at its own layer: area, title, heading path and body; a missing part is left out with its separator", () => {
    const body = "Até 30 dias.";
    const big = 10_000;
    expect(
      embeddedText(
        { area: "Vendas", title: "Política de devolução", path: ["Prazos", "Exceções"] },
        body,
        big,
      ),
    ).toBe("Vendas > Política de devolução > Prazos > Exceções\nAté 30 dias.");
    expect(
      embeddedText({ area: null, title: "Política de devolução", path: ["Prazos", "Exceções"] }, body, big),
    ).toBe("Política de devolução > Prazos > Exceções\nAté 30 dias.");
    // the preamble and a block of a .txt add no path part
    const top = sectionRows("Até 30 dias.\n# Prazos\nx\n", ".md")[0]!;
    expect(
      embeddedText({ area: "Vendas", title: "Política de devolução", path: top.path }, top.body, big),
    ).toBe("Vendas > Política de devolução\nAté 30 dias.");
    const block = sectionRows("Até 30 dias.\n", ".txt")[0]!;
    expect(
      embeddedText({ area: "Vendas", title: "Política de devolução", path: block.path }, block.body, big),
    ).toBe("Vendas > Política de devolução\nAté 30 dias.");
    // the maxChars edge
    const exactly = "x".repeat(100);
    expect(embeddedText({ area: null, title: null, path: [] }, exactly, 100)).toBe(exactly);
    expect(embeddedText({ area: null, title: null, path: [] }, `${exactly}y`, 100)).toBe(exactly);
  });
});
