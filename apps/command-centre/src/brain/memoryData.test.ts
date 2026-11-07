// @vitest-environment jsdom
/**
 * One data layer for the three brain screens (.specs/features/cerebro-vista-notas, C72-C74, amendment 8): the graph,
 * the search and the related files are asked by `brain/memoryData.ts` only; a failed search or related request is an
 * error with "Tentar de novo" that drops the earlier hits, in the notes view and in the Núcleo's brain scene; and the
 * related request carries the active context as the graph and the search do. The network is `notes/testnet.ts`.
 */
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ts from "typescript";
import type * as ApiModule from "../api";
import { installPage } from "../ui/testkit";
import { renderWith } from "../contexts/testkit";
import { mountShell } from "../commands/testkit";
import NotesView from "./notes/NotesView";
import { MEM, NetError, asked, fileRow, net, note, resetNet } from "./notes/testnet";

vi.mock("../api", async (importOriginal) =>
  (await import("./notes/testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
// The scene's sky and the graph paint through WebGL and a 2D context jsdom does not have.
vi.mock("../nucleo/scenes/BrainSceneCanvas", () => ({ BrainSceneCanvas: () => null }));
vi.mock("./BrainCanvas", () => ({ BrainCanvas: () => null }));
vi.setConfig({ testTimeout: 30_000 });

const SRC = path.resolve(__dirname, "..");
const ROUTES = ["/api/memory/graph", "/api/memory/search", "/api/memory/related"];

/** The names a file imports from `brain/memoryData`. */
function importsFromData(file: string): string[] {
  const code = fs.readFileSync(path.join(SRC, file), "utf8");
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.importClause?.isTypeOnly)
      continue;
    const target = path.resolve(path.dirname(path.join(SRC, file)), st.moduleSpecifier.text);
    if (target !== path.join(SRC, "brain/memoryData")) continue;
    const named = st.importClause?.namedBindings;
    if (named && ts.isNamedImports(named))
      for (const el of named.elements) if (!el.isTypeOnly) out.push(el.name.text);
  }
  return out.sort();
}

describe("C72 one module asks for the graph, the search and the related files", () => {
  it("C72 SecondBrain.tsx, BrainScene.tsx and the notes view hold none of the three routes; each imports what it reads from brain/memoryData.ts, which holds the three", () => {
    const view = fs
      .readdirSync(path.join(SRC, "brain/notes"))
      .filter((n) => /\.tsx?$/.test(n) && !/\.test\.|^test(net|kit)\./.test(n))
      .map((n) => `brain/notes/${n}`);
    expect(view).toContain("brain/notes/NotesView.tsx");
    for (const file of ["views/SecondBrain.tsx", "nucleo/scenes/BrainScene.tsx", ...view]) {
      const code = fs.readFileSync(path.join(SRC, file), "utf8");
      for (const route of ROUTES) expect(code.includes(route), `${file} names ${route}`).toBe(false);
    }
    const data = fs.readFileSync(path.join(SRC, "brain/memoryData.ts"), "utf8");
    expect(data).toContain("`/api/memory/graph?maxNodes=${maxNodes}");
    expect(data).toContain('apiCall("GET /api/memory/search"');
    expect(data).toContain('apiCall("GET /api/memory/related"');
    // What each screen reads, it imports from the one module: the graph and the search (the Second Brain shows
    // the graph's own neighbours, amendment 8), all three (the brain scene), the search and the related (the notes).
    expect(importsFromData("views/SecondBrain.tsx")).toEqual(["graphRequest", "useBrainSearch"]);
    expect(importsFromData("nucleo/scenes/BrainScene.tsx")).toEqual([
      "graphRequest",
      "useBrainSearch",
      "useRelatedFiles",
    ]);
    const notes = [...new Set(view.flatMap(importsFromData))].sort();
    expect(notes).toEqual(["useBrainSearch", "useRelatedFiles"]);
    // The modules it replaced are gone, and the work context no longer builds the graph's request.
    expect(fs.existsSync(path.join(SRC, "brain/useBrainSearch.ts"))).toBe(false);
    expect(fs.readFileSync(path.join(SRC, "contexts/useWorkContext.ts"), "utf8")).not.toContain(
      "/api/memory/graph",
    );
  });
});

/* ---- the screens ---------------------------------------------------------------------------------------------- */

beforeAll(() => {
  // The Núcleo's canvases ask for a 2D context; this one draws nothing.
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
  // The notes view has room for its panel.
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

const notesView = (lang: "pt-BR" | "en" = "pt-BR") =>
  renderWith(createElement(NotesView, { onShowInGraph: () => undefined }), { lang });

function seedNotes() {
  const alfa = note(1, MEM, "alfa.md", { title: "Alfa" });
  const beta = note(2, MEM, "beta.md", { title: "Beta" });
  note(3, MEM, "prima.md", { title: "Prima" });
  net.related[1] = [{ id: 3, why: "Compartilham: plano." }];
  return { alfa, beta };
}

/** The Núcleo, its brain scene on note 1 of a graph of two notes. */
async function scene(at = "/brain?sel=1") {
  net.prefs.shell = "nucleo";
  const nodes = [1, 2].map((id) => ({
    ...fileRow(note(id, MEM, `n${id}.md`, { title: `Nota ${id}` })),
    tags: [],
  }));
  net.overrides.push((u) => {
    if (u.pathname === "/api/memory/graph")
      return Promise.resolve({ nodes, edges: [], truncated: false, totalFiles: nodes.length });
    if (u.pathname === "/api/memory/preview")
      return Promise.resolve({ kind: "text", content: "# Nota\n\ntexto", message: null, editable: true });
    return undefined;
  });
  window.sessionStorage.removeItem("mordomo.brainScene.classic");
  await mountShell(at, "nucleo", "pt-BR");
}

describe("C73 a failed search or related request is an error that asks again", () => {
  it("C73 the notes view's search: the error and Tentar de novo, no earlier hits; Tentar de novo asks again", async () => {
    seedNotes();
    let fail = false;
    net.overrides.push((u) =>
      u.pathname === "/api/memory/search" && fail ? Promise.reject(new NetError(500, "boom")) : undefined,
    );
    notesView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Abrir outra nota" }));
    const box = await screen.findByRole("combobox", { name: "Abrir outra nota" });
    await user.type(box, "alfa");
    expect(await screen.findByRole("option", { name: /Alfa/ })).toBeTruthy();
    fail = true;
    await user.clear(box);
    await user.type(box, "beta");
    const alert = (await screen.findByText("A busca falhou.")).closest('[role="alert"]') as HTMLElement;
    expect(alert).not.toBeNull();
    expect(screen.queryAllByRole("option")).toEqual([]);
    const before = asked("/api/memory/search").length;
    fail = false;
    await user.click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("option", { name: /Beta/ })).toBeTruthy();
    expect(asked("/api/memory/search").length).toBe(before + 1);
    expect(asked("/api/memory/search").at(-1)!.get("q")).toBe("beta");
  });

  it("C73 the notes view's related files: the error and Tentar de novo, no earlier related; Tentar de novo asks again", async () => {
    seedNotes();
    let fail = false;
    net.overrides.push((u) =>
      u.pathname === "/api/memory/related" && fail ? Promise.reject(new NetError(500, "boom")) : undefined,
    );
    notesView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("treeitem", { name: /Alfa/ }));
    const panel = await screen.findByRole("complementary", { name: "Painel da nota" });
    expect(await within(panel).findByRole("button", { name: "Prima" })).toBeTruthy();
    fail = true;
    await user.click(screen.getByRole("treeitem", { name: /Beta/ }));
    const failed = await within(panel).findByText("Não foi possível carregar os relacionados.");
    const alert = failed.closest('[role="alert"]') as HTMLElement;
    expect(within(panel).queryByRole("button", { name: "Prima" })).toBeNull();
    net.related[2] = [{ id: 3, why: "Compartilham: plano." }];
    fail = false;
    const before = asked("/api/memory/related").length;
    await user.click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    expect(await within(panel).findByRole("button", { name: "Prima" })).toBeTruthy();
    expect(asked("/api/memory/related").length).toBe(before + 1);
    expect(asked("/api/memory/related").at(-1)!.get("id")).toBe("2");
  });

  it("C73 the Núcleo's brain scene: a failed related request is the error and Tentar de novo; Tentar de novo asks again", async () => {
    let fail = true;
    net.overrides.push((u) =>
      u.pathname === "/api/memory/related" && fail ? Promise.reject(new NetError(500, "boom")) : undefined,
    );
    await scene();
    const failed = await screen.findByText(
      "Não foi possível carregar os relacionados.",
      {},
      { timeout: 10_000 },
    );
    const alert = failed.closest('[role="alert"]') as HTMLElement;
    expect(alert).not.toBeNull();
    const before = asked("/api/memory/related").length;
    fail = false;
    await userEvent.setup().click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(asked("/api/memory/related").length).toBe(before + 1));
    await waitFor(() => expect(screen.queryByText("Não foi possível carregar os relacionados.")).toBeNull());
    expect(asked("/api/memory/related").at(-1)!.get("id")).toBe("1");
  });
});

describe("C74 the related request carries the active context", () => {
  const withContext = () => {
    net.contexts = [{ id: "alfa", name: "Alfa", paths: [{ path: MEM, state: "ok" }], files: 3 }];
    net.contextRoots.alfa = [{ path: MEM, name: "memory", editable: true, indexing: false }];
    net.prefs.activeContext = "alfa";
  };

  it("C74 the notes view: context=<id> with a context active, as the search does; no context with none", async () => {
    seedNotes();
    withContext();
    const { unmount } = notesView();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("treeitem", { name: /Alfa/ }));
    await waitFor(() => expect(asked("/api/memory/related").length).toBeGreaterThan(0));
    for (const q of asked("/api/memory/related")) expect(q.get("context")).toBe("alfa");
    await user.click(screen.getByRole("button", { name: "Abrir outra nota" }));
    await user.type(await screen.findByRole("combobox", { name: "Abrir outra nota" }), "beta");
    await waitFor(() => expect(asked("/api/memory/search").length).toBeGreaterThan(0));
    for (const q of asked("/api/memory/search")) expect(q.get("context")).toBe("alfa");
    unmount();

    resetNet();
    seedNotes();
    notesView();
    await user.click(await screen.findByRole("treeitem", { name: /Alfa/ }));
    await waitFor(() => expect(asked("/api/memory/related").length).toBeGreaterThan(0));
    for (const q of asked("/api/memory/related")) expect(q.has("context")).toBe(false);
  });

  it("C74 the brain scene: context=<id> with a context active, as its graph does", async () => {
    withContext();
    await scene();
    await waitFor(() => expect(asked("/api/memory/related").length).toBeGreaterThan(0), { timeout: 10_000 });
    for (const q of asked("/api/memory/related")) expect(q.get("context")).toBe("alfa");
    for (const q of asked("/api/memory/graph")) expect(q.get("context")).toBe("alfa");
  });

  it("C74 the brain scene: no context with none", async () => {
    await scene();
    await waitFor(() => expect(asked("/api/memory/related").length).toBeGreaterThan(0), { timeout: 10_000 });
    for (const q of asked("/api/memory/related")) expect(q.has("context")).toBe(false);
  });
});
