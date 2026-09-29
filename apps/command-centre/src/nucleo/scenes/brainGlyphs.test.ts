import { describe, expect, it } from "vitest";
import { CONTENT_KINDS, GLYPHS, inferKind, type KindInput } from "./brainGlyphs";

const note = (rel: string, over: Partial<KindInput> = {}): KindInput => {
  const name = rel.split("/").pop()!;
  const dot = name.lastIndexOf(".");
  return { name, rel, ext: dot > 0 ? name.slice(dot) : "", title: null, tags: [], ...over };
};

describe("inferKind", () => {
  it("reads binary and structured formats from the extension", () => {
    expect(inferKind(note("assets/photo.JPG"))).toBe("image");
    expect(inferKind(note("papers/attention.pdf"))).toBe("pdf");
    expect(inferKind(note("exports/sales.csv"))).toBe("data");
    expect(inferKind(note("src/app.tsx"))).toBe("code");
    expect(inferKind(note("config/settings.yaml"))).toBe("config");
    expect(inferKind(note("slides/pitch.pptx"))).toBe("doc");
  });

  it("prefers what the author declared: a type field, then a tag", () => {
    expect(inferKind(note("notes/ana.md", { fields: { type: "person" } }))).toBe("person");
    expect(inferKind(note("notes/x.md", { fields: { tipo: "reunião" } }))).toBe("meeting");
    expect(inferKind(note("notes/x.md", { tags: ["project/alpha"] }))).toBe("project");
    expect(inferKind(note("notes/x.md", { fields: { source: "https://example.com/a" } }))).toBe("web");
  });

  it("reads the folder the note lives in", () => {
    expect(inferKind(note("memory/journal/2026-09-21.md"))).toBe("journal");
    expect(inferKind(note("Pessoas/Ana Souza.md"))).toBe("person");
    expect(inferKind(note("work/projetos/site.md"))).toBe("project");
    expect(inferKind(note("Clippings/Some article.md"))).toBe("web");
    expect(inferKind(note("areas/financas.md", { title: "Finanças — Index" }))).toBe("index");
  });

  it("falls back to the name and title", () => {
    expect(inferKind(note("2026-09-21.md"))).toBe("journal");
    expect(inferKind(note("ROUTER.md", { title: "MordomoOS — Master Router" }))).toBe("index");
    expect(inferKind(note("README.md"))).toBe("index");
    expect(inferKind(note("notes/q3.md", { title: "Weekly sync with design" }))).toBe("meeting");
    expect(inferKind(note("notes/list.md", { title: "TODO before launch" }))).toBe("tasks");
    expect(inferKind(note("notes/idea.md", { title: "An idea" }))).toBe("note");
    expect(inferKind(note("memory/.gitkeep", { ext: "", name: ".gitkeep" }))).toBe("note");
    expect(inferKind(note("bin/tool.exe"))).toBe("file");
  });

  it("keeps an html file a web clip, unless a folder says otherwise", () => {
    expect(inferKind(note("saved/page.html"))).toBe("web");
  });
});

describe("GLYPHS", () => {
  it("has one path per kind, on the 24 grid", () => {
    for (const k of CONTENT_KINDS) {
      const d = GLYPHS[k];
      expect(d, k).toMatch(/^M/);
      const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
      expect(Math.max(...nums), k).toBeLessThanOrEqual(24);
    }
    expect(new Set(CONTENT_KINDS).size).toBe(Object.keys(GLYPHS).length);
  });
});
