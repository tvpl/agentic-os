import { describe, expect, it } from "vitest";
import { collectReferences, inlineText, isPathLike, parseInline, parseMarkdown, resolveReference } from "./markdown";

const DOC = `# Content router

Some **bold** and _italic_ text with \`code\` and a [link](docs/plan.md).
<script>alert(1)</script> stays text.

## Steps
1. [x] Draft in notes/draft.md
2. [ ] Review with /review-skill

- Skills: /clean-up, /summarize
- Files: content/CONTENT.md, ./assets/logo.png
- Reference: [[Weekly plan]]

> quoted line

\`\`\`ts
const x = 1;
\`\`\`

---
`;

describe("parseMarkdown", () => {
  const blocks = parseMarkdown(DOC);

  it("produces headings, paragraphs, lists, quotes, code and rules — never HTML", () => {
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "heading", "list", "list", "quote", "code", "hr"]);
    const h = blocks[0]!;
    expect(h.type === "heading" && h.level).toBe(1);
    const p = blocks[1]!;
    expect(p.type).toBe("paragraph");
    if (p.type !== "paragraph") throw new Error();
    expect(p.children.some((n) => n.type === "strong")).toBe(true);
    expect(p.children.some((n) => n.type === "em")).toBe(true);
    expect(p.children.some((n) => n.type === "code")).toBe(true);
    const link = p.children.find((n) => n.type === "link");
    expect(link).toEqual({ type: "link", text: "link", href: "docs/plan.md" });
    expect(inlineText(p.children)).toContain("<script>alert(1)</script> stays text.");
    const code = blocks[6]!;
    expect(code).toEqual({ type: "code", text: "const x = 1;", lang: "ts" });
  });

  it("recognises task states, labels and path / skill tokens in list items", () => {
    const ordered = blocks[3]!;
    if (ordered.type !== "list") throw new Error();
    expect(ordered.ordered).toBe(true);
    expect(ordered.items[0]!.checked).toBe(true);
    expect(ordered.items[1]!.checked).toBe(false);
    expect(ordered.items[0]!.children).toContainEqual({ type: "path", text: "notes/draft.md" });
    expect(ordered.items[1]!.children).toContainEqual({ type: "skill", slug: "review-skill" });

    const bullets = blocks[4]!;
    if (bullets.type !== "list") throw new Error();
    expect(bullets.items.map((i) => i.label)).toEqual(["Skills", "Files", "Reference"]);
    expect(bullets.items[0]!.children.filter((n) => n.type === "skill").map((n) => n.type === "skill" && n.slug)).toEqual(["clean-up", "summarize"]);
    expect(bullets.items[1]!.children.filter((n) => n.type === "path").map((n) => n.type === "path" && n.text)).toEqual(["content/CONTENT.md", "./assets/logo.png"]);
    expect(bullets.items[2]!.children).toContainEqual({ type: "link", text: "Weekly plan", href: "Weekly plan" });
  });

  it("keeps unbalanced markers literal and tolerates empty input", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseInline("a * b * c")).toEqual([{ type: "text", text: "a * b * c" }]);
    expect(parseInline("2 ** 3")).toEqual([{ type: "text", text: "2 ** 3" }]);
    expect(parseInline("`unclosed")).toEqual([{ type: "text", text: "`unclosed" }]);
    expect(parseInline("v1.2.3 and a/b")).toEqual([{ type: "text", text: "v1.2.3 and a/b" }]);
  });

  it("isPathLike accepts file-like tokens and rejects urls, versions and words", () => {
    expect(isPathLike("README.md")).toBe(true);
    expect(isPathLike("src/a/b.ts")).toBe(true);
    expect(isPathLike("../x.json")).toBe(true);
    expect(isPathLike("https://x.com/a.md")).toBe(false);
    expect(isPathLike("1.2.3")).toBe(false);
    expect(isPathLike("hello")).toBe(false);
    expect(isPathLike("e.g")).toBe(false);
  });
});

describe("references", () => {
  const files = [
    { id: 1, rel: "content/CONTENT.md", name: "CONTENT.md" },
    { id: 2, rel: "notes/draft.md", name: "draft.md" },
    { id: 3, rel: "plans/Weekly plan.md", name: "Weekly plan.md" },
  ];

  it("collects paths and relative link targets, skipping external urls and anchors", () => {
    const refs = collectReferences(parseMarkdown(DOC));
    expect(refs).toContain("docs/plan.md");
    expect(refs).toContain("notes/draft.md");
    expect(refs).toContain("content/CONTENT.md");
    expect(refs).toContain("Weekly plan");
    expect(collectReferences(parseMarkdown("[a](https://x.y/z.md) [b](#top)"))).toEqual([]);
  });

  it("resolves exact rel, suffix and bare name (with or without .md)", () => {
    expect(resolveReference("content/CONTENT.md", files)).toBe(1);
    expect(resolveReference("./CONTENT.md", files)).toBe(1);
    expect(resolveReference("draft.md#section", files)).toBe(2);
    expect(resolveReference("Weekly plan", files)).toBe(3);
    expect(resolveReference("missing.md", files)).toBeNull();
    expect(resolveReference("", files)).toBeNull();
  });
});
