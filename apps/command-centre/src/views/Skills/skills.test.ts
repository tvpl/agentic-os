// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Skill, SkillResource } from "../../api";
import { canPreviewInline, groupByFolder, kindOf, resourceUrl, resourcesOf, MAX_INLINE_TEXT_BYTES } from "./resources";
import { clearDraft, draftKey, isEmptyDraft, readDraft, writeDraft } from "./runDraft";
import { buildSplitPrompt, sectionHeadings, ROUTER_TARGET_LINES } from "./splitPrompt";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const res = (rel: string, kind: SkillResource["kind"], size = 10): SkillResource => ({ name: rel.split("/").pop() ?? rel, rel, kind, size });

describe("skill resources", () => {
  it("classifies by extension, unknown falls back to other", () => {
    expect(kindOf("brand.md")).toBe("markdown");
    expect(kindOf("BRAND.MD")).toBe("markdown");
    expect(kindOf("index.html")).toBe("html");
    expect(kindOf("logo.SVG")).toBe("image");
    expect(kindOf("deck.pdf")).toBe("pdf");
    expect(kindOf("data.csv")).toBe("other");
    expect(kindOf("LICENSE")).toBe("other");
  });

  it("prefers the rich list and derives one from legacy paths", () => {
    const rich = [res("resources/a.md", "markdown", 42)];
    expect(resourcesOf({ resources: ["ignored"], resourceFiles: rich })).toEqual(rich);
    expect(resourcesOf({ resources: ["resources/brand.html"] })).toEqual([
      { name: "brand.html", rel: "resources/brand.html", kind: "html", size: 0 },
    ]);
    expect(resourcesOf({ resources: [] })).toEqual([]);
  });

  it("builds a containment-safe, encoded resource URL", () => {
    expect(resourceUrl("my-skill", "resources/a b.md")).toBe("/api/skills/my-skill/resource?rel=resources%2Fa%20b.md");
    // No token in the test document → `withToken` cannot add one.
    expect(resourceUrl("s", "a.md", true)).toBe("/api/skills/s/resource?rel=a.md");
  });

  it("only previews inline what the panel can actually render", () => {
    expect(canPreviewInline(res("a.md", "markdown"))).toBe(true);
    expect(canPreviewInline(res("a.md", "markdown", MAX_INLINE_TEXT_BYTES + 1))).toBe(false);
    expect(canPreviewInline(res("a.html", "html", 5_000_000))).toBe(true);
    expect(canPreviewInline(res("a.png", "image"))).toBe(true);
    expect(canPreviewInline(res("a.pdf", "pdf"))).toBe(false);
    expect(canPreviewInline(res("a.bin", "other"))).toBe(false);
  });

  it("groups by top-level folder, keeping order and root files", () => {
    const groups = groupByFolder([res("README.md", "markdown"), res("resources/a.md", "markdown"), res("brand/logo.png", "image"), res("resources/b/c.md", "markdown")]);
    expect(groups.map((g) => g.folder)).toEqual(["", "resources", "brand"]);
    expect(groups[1]?.items.map((i) => i.rel)).toEqual(["resources/a.md", "resources/b/c.md"]);
  });
});

describe("run draft", () => {
  it("round-trips a draft per skill", () => {
    const storage = memoryStorage();
    writeDraft("digest", { provider: "claude", model: "opus", effort: "high", inputs: { topic: "week" } }, storage);
    expect(storage.map.has(draftKey("digest"))).toBe(true);
    expect(readDraft("digest", storage)).toEqual({ provider: "claude", model: "opus", effort: "high", inputs: { topic: "week" } });
    expect(readDraft("other", storage)).toBeNull();
  });

  it("drops an empty draft instead of storing noise", () => {
    const storage = memoryStorage();
    writeDraft("digest", { inputs: { topic: "  " } }, storage);
    expect(storage.map.size).toBe(0);
    expect(isEmptyDraft({ inputs: {} })).toBe(true);
    expect(isEmptyDraft({ inputs: { a: "x" } })).toBe(false);
  });

  it("survives corrupt or foreign values", () => {
    const storage = memoryStorage();
    storage.setItem(draftKey("bad"), "{not json");
    expect(readDraft("bad", storage)).toBeNull();
    storage.setItem(draftKey("weird"), JSON.stringify({ provider: 7, inputs: { a: 1, b: "ok" } }));
    expect(readDraft("weird", storage)).toEqual({ provider: undefined, model: undefined, effort: undefined, inputs: { b: "ok" } });
  });

  it("clears one skill only", () => {
    const storage = memoryStorage();
    writeDraft("a", { inputs: { x: "1" } }, storage);
    writeDraft("b", { inputs: { x: "2" } }, storage);
    clearDraft("a", storage);
    expect(readDraft("a", storage)).toBeNull();
    expect(readDraft("b", storage)?.inputs).toEqual({ x: "2" });
  });
});

describe("split assistant prompt", () => {
  const body = ["# Goal", "text", "```", "# not a heading", "```", "## Steps", "1. do it", "### Detail"].join("\n");

  it("collects headings outside fenced code", () => {
    expect(sectionHeadings(body)).toEqual(["Goal", "Steps", "Detail"]);
  });

  it("names the skill, its file, the target size and the existing resources", () => {
    const skill: Pick<Skill, "name" | "slug" | "skillFile" | "bodyLineCount" | "body" | "resources"> = {
      name: "Workspace digest",
      slug: "workspace-digest",
      skillFile: "/home/u/.mordomo/skills/workspace-digest/SKILL.md",
      bodyLineCount: 320,
      body,
      resources: ["resources/templates.md"],
    };
    const prompt = buildSplitPrompt(skill);
    expect(prompt).toContain("/workspace-digest");
    expect(prompt).toContain(skill.skillFile);
    expect(prompt).toContain(`under ${ROUTER_TARGET_LINES} lines`);
    expect(prompt).toContain("resources/templates.md");
    expect(prompt).toContain("- Steps");
    expect(buildSplitPrompt({ ...skill, resources: [] })).toContain("(none yet)");
  });
});
