// @vitest-environment jsdom
/**
 * The nature on the brain's screens (.specs/features/cerebro-natureza, C74, C86, C87; design.md "Selo de natureza" and
 * "Busca e preview"; plan.md amendments 10 and 15): each badge as design.md's table draws it, the dense badge and the
 * nature filters of the search in the three screens that list `useBrainSearch` hits, and the preview's badges and
 * "Revisar agora". The network is `../notes/testnet`, whose search is answered here only for the query each case
 * expects (L-052).
 */
import { createElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import type * as ApiModule from "../../api";
import { installPage } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import { mountShell } from "../../commands/testkit";
import type { FileNode, World } from "../engine/world";
import { PreviewPanel } from "../PreviewPanel";
import NotesView from "../notes/NotesView";
import { MEM, WORK, asked, fileRow, net, note, resetNet, type Asked } from "../notes/testnet";
import { AbandonedBadge, NatureBadge, ScopeBadge, type Natureza } from "../natureza";
import { list, item, resetReviews } from "./testkit";

vi.mock("../../api", async (importOriginal) =>
  (await import("../notes/testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.mock("../../nucleo/scenes/BrainSceneCanvas", () => ({ BrainSceneCanvas: () => null }));
vi.mock("../BrainCanvas", () => ({ BrainCanvas: () => null }));
vi.setConfig({ testTimeout: 30_000 });

beforeAll(() => {
  const noop = () => undefined;
  const ctx = new Proxy(
    {},
    { get: (_t, p) => (p === "measureText" ? () => ({ width: 0 }) : noop), set: () => true },
  );
  HTMLCanvasElement.prototype.getContext = function () {
    return ctx;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
installPage();
beforeEach(() => {
  resetNet();
  resetReviews();
  globalThis.IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.scrollTo ??= () => undefined;
  window.localStorage.setItem(
    "mordomo.onboarding.v1",
    JSON.stringify({ version: 1, status: "completed", step: 12, visited: [], practiced: false }),
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const wide = this.classList.contains("notes-view");
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: wide ? 1440 : 0,
      bottom: 0,
      width: wide ? 1440 : 0,
      height: 0,
      toJSON() {},
    } as DOMRect;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

/* ---------------- C74: the badges ---------------- */

describe("C74 the badges, one case per row of design.md's table", () => {
  const rows: Array<[Natureza | null, string, string, string]> = [
    ["fato", "lucide-circle-check", "Fato", "tone-ok"],
    ["relato", "lucide-file-text", "Relato", "tone-muted"],
    ["plano", "lucide-compass", "Plano — ainda não é realidade", "tone-info"],
    ["hipotese", "lucide-flask-conical", "Hipótese", "tone-warn"],
    ["opiniao", "lucide-message-circle", "Opinião", "tone-accent"],
    [null, "lucide-circle-dashed", "Não classificado", "tone-muted"],
  ];
  for (const [n, icon, text, tone] of rows)
    it(`C74 ${n ?? "none"} → ${icon} + ${text} with ${tone}, an icon and a text`, () => {
      renderWith(createElement(NatureBadge, { n }), { lang: "pt-BR" });
      const badge = document.querySelector(".nb")!;
      expect(badge.classList.contains(tone)).toBe(true);
      const svgs = badge.querySelectorAll("svg");
      expect(svgs).toHaveLength(1);
      expect(svgs[0]!.classList.contains(icon)).toBe(true);
      expect(svgs[0]!.getAttribute("aria-hidden")).toBe("true");
      expect(badge.textContent).toBe(text);
    });

  /**
   * Every `color` a stylesheet declares on a rule that names the badge (`.nb`, a `tone-` class) or `.badge.meta`, at any
   * depth: inside `@media`, `@supports`, `@layer` and `@container` too, each with the at-rules around it (round 2).
   */
  async function colourRules(css: string) {
    const postcss = (await import("postcss")).default;
    const out: Array<{ selector: string; colour: string; within: string[] }> = [];
    postcss.parse(css).walkRules((r) => {
      const within: string[] = [];
      for (let p = r.parent; p && p.type !== "root"; p = p.parent)
        if (p.type === "atrule")
          within.unshift(`@${(p as { name: string }).name} ${(p as { params: string }).params}`.trim());
      for (const selector of r.selectors)
        if (/\.nb(?![\w-])|tone-|^\.badge\.meta$/.test(selector))
          r.each((d) => {
            if (d.type === "decl" && d.prop === "color") out.push({ selector, colour: d.value, within });
          });
    });
    return out;
  }

  it("C74 the stylesheet reader finds a tone colour at the root and inside @media, @supports, @layer and @container", async () => {
    expect(await colourRules(".nb.tone-ok { color: var(--ok); }")).toEqual([
      { selector: ".nb.tone-ok", colour: "var(--ok)", within: [] },
    ]);
    for (const at of [
      "@media (prefers-contrast: more)",
      "@supports (color: red)",
      "@layer badges",
      "@container (min-width: 1px)",
    ])
      expect(await colourRules(`${at} { .nb.tone-muted { color: var(--ok); } }`), at).toEqual([
        { selector: ".nb.tone-muted", colour: "var(--ok)", within: [at] },
      ]);
    expect(
      await colourRules("@media print { @supports (x: y) { [data-theme] .nb.tone-muted { color: red; } } }"),
    ).toEqual([
      {
        selector: "[data-theme] .nb.tone-muted",
        colour: "red",
        within: ["@media print", "@supports (x: y)"],
      },
    ]);
    expect(await colourRules(".nb-filter { color: var(--text-dim); }")).toEqual([]);
  });

  it("C74 the tone classes are drawn from the existing tokens, never a colour of their own, tone-muted included, at any depth of the stylesheet", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const badges = await colourRules(readFileSync(join(__dirname, "..", "natureza.css"), "utf8"));
    const theme = await colourRules(readFileSync(join(__dirname, "..", "..", "theme.css"), "utf8"));
    const tones: Array<[string, string]> = [
      ["tone-ok", "var(--ok)"],
      ["tone-info", "var(--info)"],
      ["tone-warn", "var(--warn)"],
      ["tone-accent", "var(--accent-text)"],
      ["tone-muted", "var(--text-dim)"],
    ];
    // Every badge is `.badge.meta.nb`: a tone with no rule of its own takes the colour of `.badge.meta`, which only
    // `theme.css`'s one top-level rule colours.
    const meta = theme.filter((c) => c.selector === ".badge.meta");
    expect(meta).toEqual([{ selector: ".badge.meta", colour: "var(--text-dim)", within: [] }]);
    // The badges' stylesheet colours a badge only by a top-level `.nb.<tone>` rule, with that tone's token: no rule on
    // every `.nb`, no other selector, and nothing nested in an at-rule.
    for (const c of badges) {
      const tone = tones.find(([t]) => c.selector === `.nb.${t}`);
      expect(tone, c.selector).toBeDefined();
      expect(c.within, c.selector).toEqual([]);
      expect(c.colour, c.selector).toBe(tone![1]);
    }
    for (const [tone, colour] of tones)
      expect(badges.find((c) => c.selector === `.nb.${tone}`)?.colour ?? meta[0]!.colour, tone).toBe(colour);
    // And the badge in the DOM carries those classes: `badge meta nb tone-muted` for relato and none.
    renderWith(createElement(NatureBadge, { n: "relato" }), { lang: "pt-BR" });
    expect(document.querySelector(".nb")!.className).toBe("badge meta nb tone-muted");
  });

  it("C74 the scope badge is text only, the abandoned badge is Archive + Abandonado em 2026-09-01, and the dense plano reads Plano with the rest as title", () => {
    renderWith(
      createElement("div", null, [
        createElement(ScopeBadge, { key: 1, s: "pessoal" }),
        createElement(ScopeBadge, { key: 2, s: "equipe" }),
        createElement(ScopeBadge, { key: 3, s: "externo" }),
        createElement(AbandonedBadge, { key: 4, date: "2026-09-01" }),
        createElement(NatureBadge, { key: 5, n: "plano", dense: true }),
        createElement(NatureBadge, { key: 6, n: "fato", dense: true }),
      ]),
      { lang: "pt-BR" },
    );
    const badges = [...document.querySelectorAll(".nb")];
    expect(badges.slice(0, 3).map((b) => [b.textContent, b.querySelectorAll("svg").length])).toEqual([
      ["Pessoal", 0],
      ["Equipe", 0],
      ["Externo", 0],
    ]);
    expect(badges[3]!.textContent).toBe("Abandonado em 2026-09-01");
    expect(badges[3]!.querySelector("svg.lucide-archive")).not.toBeNull();
    expect(badges[4]!.textContent).toBe("Plano");
    expect(badges[4]!.getAttribute("title")).toBe("Plano — ainda não é realidade");
    expect(badges[4]!.querySelector("svg.lucide-compass")).not.toBeNull();
    expect(badges[5]!.textContent).toBe("Fato");
  });
});

/* ---------------- C86: the search of the three screens ---------------- */

const withContext = () => {
  net.contexts = [{ id: "proj-x", name: "Projeto X", paths: [{ path: MEM, state: "ok" }], files: 3 }];
  net.contextRoots["proj-x"] = [{ path: MEM, name: "memory", editable: true, indexing: false }];
  net.prefs.activeContext = "proj-x";
};

/** Three notes, and a search answered only for `preco` in proj-x: all of them, or only the fato one with natureza=fato. */
function searchTable() {
  const fato = note(1, MEM, "preco-fato.md", { title: "Preço fato" });
  const plano = note(2, MEM, "preco-plano.md", { title: "Preço plano" });
  const errado = note(3, MEM, "errado.md", { title: "Errado" });
  const hit = (f: typeof fato, natureza: string | null) => ({
    ...fileRow(f),
    snippet: null,
    score: 1,
    via: "text",
    natureza,
    escopo: null,
  });
  net.overrides.push((u: Asked) => {
    if (u.pathname !== "/api/memory/search") return undefined;
    const q = Object.fromEntries(u.searchParams);
    const base = { limit: "8", context: "proj-x" };
    if (JSON.stringify(q) === JSON.stringify({ q: "preco", ...base }))
      return Promise.resolve([hit(fato, "fato"), hit(plano, "plano")]);
    if (JSON.stringify(q) === JSON.stringify({ q: "preco", ...base, natureza: "fato" }))
      return Promise.resolve([hit(fato, "fato")]);
    return Promise.resolve([hit(errado, null)]);
  });
  const nodes = [fato, plano, errado].map((f) => ({ ...fileRow(f), tags: [] }));
  net.overrides.push((u) =>
    u.pathname === "/api/memory/graph"
      ? Promise.resolve({ nodes, edges: [], truncated: false, totalFiles: nodes.length })
      : undefined,
  );
}

/** The search's filter row, the "Filtros" toggle and the hits, as each screen draws them. */
async function filterAndRead(scope: HTMLElement, hits: () => string[][], [fato, plano]: [string, string]) {
  const user = userEvent.setup();
  await waitFor(() =>
    expect(hits()).toEqual([
      [fato, "Fato"],
      [plano, "Plano"],
    ]),
  );
  expect(within(scope).queryByRole("group", { name: "Natureza" })).toBeNull();
  await user.click(within(scope).getByRole("button", { name: "Filtros" }));
  const row = within(scope).getByRole("group", { name: "Natureza" });
  expect(
    within(row)
      .getAllByRole("button")
      .map((b) => `${b.textContent}|${b.getAttribute("aria-pressed")}`),
  ).toEqual(["Fato|false", "Relato|false", "Plano|false", "Hipótese|false", "Opinião|false"]);
  await user.click(within(row).getByRole("button", { name: "Fato" }));
  await waitFor(() => expect(hits()).toEqual([[fato, "Fato"]]));
  const last = asked("/api/memory/search").at(-1)!;
  expect(Object.fromEntries(last)).toEqual({ q: "preco", limit: "8", context: "proj-x", natureza: "fato" });
}

describe("C86 the search's badge and nature filters, one case per screen", () => {
  it("C86 the moldura's graph: each hit's dense badge right after its name; the five filters behind Filtros; Fato asks natureza=fato in the context", async () => {
    withContext();
    searchTable();
    await mountShell("/brain", "moldura", "pt-BR");
    const panel = (await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".brain2-panel");
      expect(el).not.toBeNull();
      return el;
    }))!;
    fireEvent.change(panel.querySelector("input.input")!, { target: { value: "preco" } });
    await filterAndRead(
      panel,
      () =>
        [...panel.querySelectorAll(".brain-hit .brain-hit-name")].map((n) =>
          [...n.children].map((c) => c.textContent!),
        ),
      ["preco-fato.md", "preco-plano.md"],
    );
  });

  it("C86 the Núcleo's brain scene: each hit's dense badge right after its name; the five filters behind Filtros; Fato asks natureza=fato in the context", async () => {
    withContext();
    searchTable();
    window.sessionStorage.removeItem("mordomo.brainScene.classic");
    net.prefs.shell = "nucleo";
    await mountShell("/brain", "nucleo", "pt-BR");
    const tools = (await waitFor(
      () => {
        const el = document.querySelector<HTMLElement>(".bs-tools");
        expect(el).not.toBeNull();
        return el;
      },
      { timeout: 10_000 },
    ))!;
    fireEvent.change(tools.querySelector('input[type="search"]')!, { target: { value: "preco" } });
    fireEvent.focus(tools.querySelector('input[type="search"]')!);
    await filterAndRead(
      tools,
      () =>
        [...tools.querySelectorAll(".bs-hits li button")].map((b) =>
          [...b.children].slice(0, 2).map((c) => c.textContent!),
        ),
      ["preco-fato.md", "preco-plano.md"],
    );
  });

  it("C86 the notes view's search: each hit's dense badge right after its title; the five filters behind Filtros; Fato asks natureza=fato in the context", async () => {
    withContext();
    searchTable();
    renderWith(createElement(NotesView, { onShowInGraph: () => undefined }), { lang: "pt-BR" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Abrir outra nota" }));
    const box = await screen.findByRole("combobox", { name: "Abrir outra nota" });
    await user.type(box, "preco");
    const body = box.closest<HTMLElement>(".notes-search-body")!;
    await filterAndRead(
      body,
      () =>
        [...body.querySelectorAll(".notes-search-hit")].map((h) =>
          [...h.children].slice(1, 3).map((c) => c.textContent!),
        ),
      ["Preço fato", "Preço plano"],
    );
  });
});

/* ---------------- C87: the preview ---------------- */

const node = (over: Partial<FileNode>) =>
  ({
    id: 7,
    name: "lancamento.md",
    title: "Lançamento",
    path: `${MEM}/notes/lancamento.md`,
    ext: ".md",
    group: "memory",
    size: 10,
    mtime: 1,
    pinned: false,
    ...over,
  }) as unknown as FileNode;
const world = { files: [], edges: [] } as unknown as World;

function preview(n: FileNode) {
  return createElement(PreviewPanel, {
    preview: { node: n, content: "# Lançamento\n", kind: "text", message: null, editable: true },
    world,
    skills: new Set<string>(),
    lang: "pt-BR",
    onClose: () => undefined,
    onSelectId: () => undefined,
    onSkill: () => undefined,
    onUnpin: () => undefined,
    onDangling: () => undefined,
  });
}
/** What the router shows at `/brain/reviews`: the screen, as the brain mounts it there. */
async function routes(n: FileNode) {
  const { ReviewsView } = await import("../BrainViewSwitch");
  const { Suspense } = await import("react");
  return createElement(Routes, null, [
    createElement(Route, { key: "a", path: "/", element: preview(n) }),
    createElement(Route, {
      key: "b",
      path: "/brain/reviews",
      element: createElement(Suspense, { fallback: null }, createElement(ReviewsView)),
    }),
  ]);
}

describe("C87 the preview's badges and Revisar agora", () => {
  const fields = { natureza: "plano", escopo: "equipe", status: "archived", abandoned: "2026-09-01" };

  it("C87 a Markdown file: after group, extension, size, age and edges, the nature, then the scope, then the abandoned badge; Revisar agora (.btn.sm) right after the row", () => {
    renderWith(preview(node({ fields })), { lang: "pt-BR" });
    const row = document.querySelector(".brain-preview-badges")!;
    const badges = [...row.children].map((c) => c.textContent);
    expect(badges.slice(-3)).toEqual(["Plano — ainda não é realidade", "Equipe", "Abandonado em 2026-09-01"]);
    expect(badges).toHaveLength(8);
    expect(badges[0]).toBe("memory");
    expect(badges[1]).toBe(".md");
    expect(badges[4]).toMatch(/^Arestas|^Conexões|\d$/);
    const next = row.nextElementSibling as HTMLButtonElement;
    expect(next.tagName).toBe("BUTTON");
    expect(next.className).toBe("btn sm");
    expect(next.textContent).toBe("Revisar agora");
  });

  for (const listed of [true, false])
    it(`C87 Revisar agora opens /brain/reviews?path=<path>, with ${listed ? "that item selected when it is listed" : "the first item selected when it is not"}`, async () => {
      const path = `${MEM}/notes/lancamento.md`;
      const first = item("notes/primeira.md");
      const it2 = { ...item("notes/lancamento.md", { natureza: "plano" }), path };
      list({}, listed ? [first, it2] : [first, item("notes/outra.md")]);
      list({ kind: "unclassified" }, []);
      renderWith(await routes(node({ fields })), { lang: "pt-BR" });
      fireEvent.click(screen.getByRole("button", { name: "Revisar agora" }));
      const selected = await waitFor(
        () => {
          const el = document.querySelector('.rv-pick[aria-current="true"] .rv-name');
          expect(el).not.toBeNull();
          return el!;
        },
        { timeout: 10_000 },
      );
      expect(selected.textContent).toBe(listed ? "lancamento.md" : "primeira.md");
    });

  it("C87 the preview of a .pdf has none of them", () => {
    renderWith(preview(node({ name: "a.pdf", path: `${WORK}/a.pdf`, ext: ".pdf", fields })), {
      lang: "pt-BR",
    });
    expect(document.querySelectorAll(".brain-preview-badges .nb")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Revisar agora" })).toBeNull();
  });
});
