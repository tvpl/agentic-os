import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { splitSections as recallSplit } from "../core/src/memory/recall.js";
import {
  EMBEDDED_EXTENSIONS,
  MAX_SECTIONS,
  embeddedText,
  sectionRows,
  splitSections,
} from "../core/src/memory/sections.js";
import { embedPending } from "../core/src/memory/vectors.js";
import type { EmbeddingProvider } from "../core/src/memory/embeddings.js";
import { buscaWorld, type BuscaWorld } from "./helpers/buscaWorld.js";

/**
 * .specs/features/cerebro-busca-significado, S3, at its own layer: the section splitter shared by the recall and the
 * vectors phase (`core/src/memory/sections.ts`) and the text each section's vector is computed from.
 */

const repoRoot = path.resolve(import.meta.dirname, "..");
const worlds: BuscaWorld[] = [];
afterAll(async () => {
  for (const w of worlds) await w.close();
});

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

/** A provider that records what it is given and answers a vector per text (never all zeros). */
function recording(maxChars: number): EmbeddingProvider & { texts: string[] } {
  const texts: string[] = [];
  return {
    id: "recording:4",
    dim: 4,
    local: true,
    maxChars,
    texts,
    async embed(batch) {
      texts.push(...batch);
      return batch.map(() => new Float32Array([0.5, 0.5, 0.5, 0.5]));
    },
  };
}

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

  it("C23 through a pass: what a recording provider is sent", async () => {
    const w = await buscaWorld("mordomo-busca-c23-");
    worlds.push(w);
    const vendas = w.outside("vendas");
    const solta = w.outside("solta");
    w.update((s) => {
      s.indexedFolders = [
        { path: vendas, area: "Vendas", enabled: true },
        { path: solta, area: null, enabled: true },
      ];
    });
    const note = "---\ntitle: Política de devolução\n---\n# Prazos\n## Exceções\nAté 30 dias.\n";
    w.put(path.join(vendas, "devolucao.md"), note);
    w.put(path.join(solta, "devolucao.md"), note);
    // the maxChars edge: no area, no title (no H1), the path "S" and a body of 98 and 99 characters
    w.put(path.join(solta, "cem.md"), `## S\n${"a".repeat(98)}\n`);
    w.put(path.join(solta, "cento-e-um.md"), `## S\n${"b".repeat(99)}\n`);
    await w.index();
    w.hashOn();
    const provider = recording(100);
    await embedPending(w.ctx.db, w.ctx.settings().memory.embeddings, { provider });
    const sent = provider.texts;
    expect(sent).toContain("Vendas > Política de devolução > Prazos > Exceções\nAté 30 dias.");
    expect(sent).toContain("Política de devolução > Prazos > Exceções\nAté 30 dias.");
    // the preamble (the header of the note) has no path part
    expect(sent).toContain("Vendas > Política de devolução\n---\ntitle: Política de devolução\n---");
    expect(sent).toContain(`S\n${"a".repeat(98)}`);
    expect(`S\n${"a".repeat(98)}`).toHaveLength(100);
    expect(sent).toContain(`S\n${"b".repeat(98)}`);
    expect(sent.every((t) => t.length <= 100)).toBe(true);
    expect(sent).toHaveLength(6);
  });
});

describe("C36 one splitter for the recall and the vectors", () => {
  it("C36 the recall's splitSections is the shared one, defined once, and the vectors phase reads it", () => {
    expect(recallSplit).toBe(splitSections);
    const memoryDir = path.join(repoRoot, "core", "src", "memory");
    const defining = fs
      .readdirSync(memoryDir)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) =>
        /export function splitSections\(/.test(fs.readFileSync(path.join(memoryDir, f), "utf8")),
      );
    expect(defining).toEqual(["sections.ts"]);
    expect(fs.readFileSync(path.join(memoryDir, "vectors.ts"), "utf8")).toMatch(
      /import \{[^}]*\bsectionRows\b[^}]*\} from "\.\/sections\.js"/,
    );
    expect(fs.readFileSync(path.join(memoryDir, "recall.ts"), "utf8")).toMatch(
      /import \{ splitSections, type Section \} from "\.\/sections\.js"/,
    );
  });

  it("C36 the recall's sections of a note equal what splitSections gave on the base", () => {
    const md =
      "Intro da nota.\n\n# Nota\n\nCorpo um.\n\n## Segunda\n\nCorpo dois\ncom duas linhas.\n\n```\n# não é título\n```\n\n### Vazia\n\n## Terceira ##\n\nfim.\n";
    const txt = Array.from({ length: 45 }, (_, i) => `linha ${i + 1}`).join("\n") + "\n";
    // recorded from `splitSections` of `core/src/memory/recall.ts` at 2835feb, before it moved
    expect(recallSplit(md, true)).toEqual([
      { heading: "(top)", body: "Intro da nota.", level: 0, startLine: 1, endLine: 1 },
      { heading: "Nota", body: "Corpo um.", level: 1, startLine: 5, endLine: 5 },
      {
        heading: "Segunda",
        body: "Corpo dois\ncom duas linhas.\n\n```\n# não é título\n```",
        level: 2,
        startLine: 9,
        endLine: 14,
      },
      { heading: "Vazia", body: "", level: 3 },
      { heading: "Terceira", body: "fim.", level: 2, startLine: 20, endLine: 20 },
    ]);
    expect(recallSplit(txt, false)).toEqual([
      {
        heading: "lines 1-40",
        body: Array.from({ length: 40 }, (_, i) => `linha ${i + 1}`).join("\n"),
        level: 0,
      },
      { heading: "lines 41-46", body: "linha 41\nlinha 42\nlinha 43\nlinha 44\nlinha 45\n", level: 0 },
    ]);
  });
});
