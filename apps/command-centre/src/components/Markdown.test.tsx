// @vitest-environment jsdom
/**
 * The one Markdown renderer (.specs/features/limpeza-legado, C15, C17 to C21): the same text, drawn by the three
 * surfaces, is the HTML the three renderers it replaced drew; raw HTML is text; a link leaves the app only as
 * http, https or mailto, and always with `rel="noreferrer noopener"`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import golden from "./markdown.golden.json";
import { COMMON, FILES, KNOWN_SKILLS, TABLE } from "./markdown.corpus";
import { Markdown, safeExternalHref, type MarkdownRefs, type MarkdownShape } from "./Markdown";
import { parseMarkdown, resolveReference, type Block, type Inline } from "../brain/markdown";
import { BrainGlyph } from "../nucleo/scenes/BrainGlyph";

afterEach(cleanup);

const SHAPES: MarkdownShape[] = ["page", "panel", "scene"];
const noop = () => undefined;

function refsFor(over: Partial<MarkdownRefs> = {}): MarkdownRefs {
  return {
    resolve: (ref) => resolveReference(ref, FILES),
    skills: new Set(KNOWN_SKILLS),
    onNote: noop,
    onSkill: noop,
    onPeek: noop,
    iconOf: () => null,
    ...over,
  };
}

/** The reader's refs as the scene gives them: the outline's ids by block index and the icon of a note. */
function sceneRefs(source: string, over: Partial<MarkdownRefs> = {}): MarkdownRefs {
  const headingIds = new Map<number, string>();
  parseMarkdown(source).forEach((b, i) => {
    if (b.type === "heading") headingIds.set(i, `h-${i}`);
  });
  const iconOf = () => <BrainGlyph kind="note" size={13} className="bs-md-link-icon" />;
  return refsFor({ headingIds, iconOf, ...over });
}

function draw(source: string, shape: MarkdownShape, over: Partial<MarkdownRefs> = {}): HTMLElement {
  const refs = shape === "scene" ? sceneRefs(source, over) : refsFor(over);
  const ui: ReactElement = (
    <Markdown source={source} shape={shape} refs={shape === "page" ? undefined : refs} />
  );
  const { container } = render(<MemoryRouter>{ui}</MemoryRouter>);
  return container.firstElementChild as HTMLElement;
}

function blockTypes(blocks: Block[]): Set<string> {
  return new Set(blocks.map((b) => b.type));
}
function inlineTypes(blocks: Block[]): Set<string> {
  const out = new Set<string>();
  const walk = (nodes: Inline[]) => {
    for (const n of nodes) {
      out.add(n.type);
      if (n.type === "strong" || n.type === "em") walk(n.children);
    }
  };
  for (const b of blocks) {
    if (b.type === "heading" || b.type === "paragraph" || b.type === "quote") walk(b.children);
    else if (b.type === "list") for (const item of b.items) walk(item.children);
    else if (b.type === "table") {
      b.header.forEach(walk);
      b.rows.forEach((row) => row.forEach(walk));
    }
  }
  return out;
}

describe("C15 the HTML the three old renderers drew", () => {
  it("C15 the corpus has every kind of block and of inline the parser produces", () => {
    const blocks = [...parseMarkdown(COMMON), ...parseMarkdown(TABLE)];
    expect([...blockTypes(blocks)].sort()).toEqual(
      ["code", "heading", "hr", "list", "paragraph", "quote", "table"].sort(),
    );
    expect([...inlineTypes(blocks)].sort()).toEqual(
      ["code", "em", "link", "path", "skill", "strong", "text"].sort(),
    );
  });

  it.each(SHAPES)("C15 the common corpus on the %s surface is the HTML of the old renderer", (shape) => {
    const el = draw(COMMON, shape);
    const expected = golden.common[shape];
    expect(el.outerHTML).toBe(expected);
  });

  it.each(["panel", "scene"] as const)(
    "C15 a table on the %s surface is the HTML of the old renderer",
    (shape) => {
      expect(draw(TABLE, shape).outerHTML).toBe(golden.table[shape]);
    },
  );
});

/** Raw HTML in each place text can sit. */
const PAYLOADS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  '<iframe src="javascript:alert(1)"></iframe>',
  '<a href="javascript:alert(1)">click</a>',
];
const placeIn: Array<[string, (p: string) => string]> = [
  ["a paragraph", (p) => `text ${p} text`],
  ["a heading", (p) => `# ${p}`],
  ["a quote", (p) => `> ${p}`],
  ["a list item", (p) => `- ${p}`],
  ["a table cell", (p) => `| h |\n| --- |\n| ${p} |`],
];

describe("C17 raw HTML is text", () => {
  it.each(SHAPES)("C17 on the %s surface no payload becomes an element, in any place", (shape) => {
    for (const payload of PAYLOADS)
      for (const [where, wrap] of placeIn) {
        const el = draw(wrap(payload), shape);
        expect(
          el.querySelector("script, img, iframe, style, object, embed"),
          `${where}: ${payload}`,
        ).toBeNull();
        expect(el.querySelector("a[href^='javascript' i]"), `${where}: ${payload}`).toBeNull();
        expect(el.querySelector("[onerror], [onclick], [onload]"), `${where}: ${payload}`).toBeNull();
        expect(el.textContent, `${where}: ${payload}`).toContain(payload.slice(0, 12));
        cleanup();
      }
  });
});

const UNSAFE = [
  "javascript:alert(1)",
  "JAVASCRIPT:alert(1)",
  "java\tscript:alert(1)",
  "data:text/html,<b>x</b>",
  "vbscript:msgbox(1)",
  "file:///etc/passwd",
  "//evil.example/x",
  "#anchor",
];
const SAFE = ["http://example.com/a", "https://example.com/b?c=1&d=2", "mailto:me@example.com"];

describe("C18 a link that cannot leave the app is inert text", () => {
  it("C18 safeExternalHref refuses each of them and accepts the three that may leave", () => {
    for (const href of UNSAFE) expect(safeExternalHref(href), href).toBeNull();
    for (const href of SAFE) expect(safeExternalHref(href), href).toBe(href);
    expect(safeExternalHref("  HTTPS://example.com  ")).toBe("HTTPS://example.com");
    expect(safeExternalHref("")).toBeNull();
    expect(safeExternalHref("example.com")).toBeNull();
  });

  it.each(SHAPES)("C18 on the %s surface none of them is drawn as an <a>", (shape) => {
    for (const href of UNSAFE) {
      const el = draw(`see [the label](${href}) here`, shape);
      expect(el.querySelector("a"), href).toBeNull();
      expect(el.textContent, href).toContain("the label");
      cleanup();
    }
  });

  it("C18 the parser really hands the renderer a link for the ones with no whitespace", () => {
    const paragraph = parseMarkdown("[x](javascript:alert)")[0]!;
    expect(paragraph).toMatchObject({
      type: "paragraph",
      children: [{ type: "link", text: "x", href: "javascript:alert" }],
    });
  });
});

describe("C19 a link that may leave the app", () => {
  it.each(SHAPES)(
    "C19 on the %s surface each is an <a> that opens elsewhere and tells neither side",
    (shape) => {
      for (const href of SAFE) {
        const el = draw(`see [the label](${href}) here`, shape);
        const a = el.querySelector("a")!;
        expect(a, href).not.toBeNull();
        expect(a.getAttribute("href")).toBe(href);
        expect(a.getAttribute("target")).toBe("_blank");
        expect(a.getAttribute("rel")).toBe("noreferrer noopener");
        expect(el.querySelectorAll("a")).toHaveLength(1);
        cleanup();
      }
    },
  );
});

describe("C20 a table in a skill body", () => {
  it("C20 the page surface draws its header and its rows", () => {
    const el = draw(TABLE, "page");
    const table = el.querySelector("table")!;
    expect(table).not.toBeNull();
    expect([...table.querySelectorAll("th")].map((c) => c.textContent)).toEqual(["Name", "Link"]);
    expect(table.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(table.querySelector("tbody a")?.getAttribute("href")).toBe("https://example.com");
    expect(table.querySelector("tbody code")?.textContent).toBe("c");
  });
});

describe("C21 a reference that names a note or a skill", () => {
  it("C21 on the panel and the scene a resolved path, a resolved link and a known skill are buttons that act", () => {
    for (const shape of ["panel", "scene"] as const) {
      const onNote = vi.fn();
      const onSkill = vi.fn();
      const el = draw("A docs/guide.md and [idea](notes/ideas.md) and /deploy-site.", shape, {
        onNote,
        onSkill,
      });
      const buttons = [...el.querySelectorAll("button")];
      expect(buttons.map((b) => b.textContent)).toEqual(["docs/guide.md", "idea", "/deploy-site"]);
      fireEvent.click(buttons[0]!);
      fireEvent.click(buttons[1]!);
      fireEvent.click(buttons[2]!);
      expect(onNote.mock.calls).toEqual([[7], [9]]);
      expect(onSkill.mock.calls).toEqual([["deploy-site"]]);
      cleanup();
    }
  });

  it("C21 an unresolved path, an unresolved link and an unknown skill are not buttons", () => {
    for (const shape of ["panel", "scene"] as const) {
      const el = draw("A nowhere/x.md and [gone](missing/page.md) and /ghost.", shape);
      expect(el.querySelectorAll("button")).toHaveLength(0);
      const cls = shape === "panel" ? "brain-md-dangling" : "bs-md-dangling";
      expect([...el.querySelectorAll(`.${cls}`)].map((s) => s.getAttribute("title"))).toEqual([
        "Dangling references",
        "missing/page.md",
      ]);
      expect(el.querySelector("code")?.textContent).toBe("/ghost");
      cleanup();
    }
  });

  it("C21 on the scene a hover or a focus on a note points at it and leaving stops pointing, and the icon comes first", () => {
    const onPeek = vi.fn();
    const el = draw("See docs/guide.md.", "scene", { onPeek, iconOf: (id) => <i data-icon={id} /> });
    const button = el.querySelector("button")!;
    expect(button.firstElementChild?.getAttribute("data-icon")).toBe("7");
    fireEvent.mouseEnter(button);
    fireEvent.mouseLeave(button);
    fireEvent.focus(button);
    fireEvent.blur(button);
    expect(onPeek.mock.calls).toEqual([[7], [null], [7], [null]]);
  });

  it("C21 on the scene a heading carries the id of the outline and its level", () => {
    const el = draw("# One\n\n## Two\n", "scene");
    const heads = [...el.querySelectorAll("h3, h4")];
    expect(heads.map((h) => [h.tagName, h.id, h.getAttribute("data-level")])).toEqual([
      ["H3", "h-0", "1"],
      ["H4", "h-1", "2"],
    ]);
  });
});
