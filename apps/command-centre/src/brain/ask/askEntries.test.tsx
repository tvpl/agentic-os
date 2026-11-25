// @vitest-environment jsdom
/**
 * Where "Perguntar" opens from (.specs/features/cerebro-perguntar, C72, C73, C90, C97, C99; design.md "Entradas", door
 * 6, binding `comandos-atalhos`): the moldura's `.btn.sm` "Perguntar" with `MessageSquare` before "Revisões (N)", the
 * Núcleo scene menu's row above the cleanup's, the palette's `global` command in both shells, `a` in `view:brain` (and
 * not in a field), each landing on `/brain/ask`; `useBrainMode` in the panel's route and in the router; the notes view's
 * "Perguntar sobre esta nota"; the view's own chunk; the gallery's story of the view's states.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense, lazy } from "react";
import { useLocation } from "react-router-dom";
import type * as ApiModule from "../../api";
import { installPage } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import { mountShell } from "../../commands/testkit";
import { CommandRegistry } from "../../commands/registry";
import { AppRouteContext } from "../../desktop/appRoute";
import { ENTRIES, edgesOf, loadTree, reachable } from "../../testing/sourceGraph";
import { BrainChrome, type BrainChromeProps } from "../BrainChrome";
import { useBrainMode } from "../BrainViewSwitch";
import { defaultUi } from "../state";
import { NoteReader } from "../notes/NoteReader";
import { fileRow, note, resetNet, type Asked } from "../notes/testnet";
import { list as reviewsList, resetReviews, reviews } from "../reviews/testkit";
import { resetWeekly } from "../weekly/testkit";
import { MEM, net, resetAsk } from "./testkit";

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
  resetWeekly();
  resetAsk();
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
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.location.hash = "";
});

const before = (a: Element, b: Element) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const askUp = () =>
  waitFor(() => expect(document.querySelector(".ask h1.ask-h1")?.textContent).toBe("Perguntar ao cérebro"), {
    timeout: 10_000,
  });
const withContext = () => {
  net.contexts = [{ id: "proj-x", name: "Projeto X", paths: [{ path: MEM, state: "ok" }], files: 3 }];
  net.prefs.activeContext = "proj-x";
};

function chrome(): BrainChromeProps {
  const noop = () => undefined;
  return {
    systemName: "Mordomo OS",
    total: 3,
    lang: "pt-BR",
    ui: defaultUi(),
    patch: noop,
    presenting: false,
    setPresenting: noop,
    loading: false,
    error: null,
    onRetry: noop,
    progress: null,
    indexNote: null,
    onCancelIndex: noop,
    refreshing: false,
    onRefresh: noop,
    liveCount: 0,
    onNavigate: noop,
    zoom: { in: noop, out: noop, fit: noop, reset: noop },
    legend: [],
    legendOpen: false,
    setLegendOpen: noop,
    ringCounts: { skills: 0, routines: 0, apps: 0 },
    kindCounts: new Map(),
    layoutLabel: "",
    layoutToast: null,
    hover: null,
  };
}

/** The Núcleo's brain scene on a graph of two notes. */
async function scene() {
  net.prefs.shell = "nucleo";
  const nodes = [1, 2].map((id) => ({
    ...fileRow(note(id, MEM, `n${id}.md`, { title: `Nota ${id}` })),
    tags: [],
  }));
  net.overrides.push((u: Asked) =>
    u.pathname === "/api/memory/graph"
      ? Promise.resolve({ nodes, edges: [], truncated: false, totalFiles: nodes.length })
      : undefined,
  );
  window.sessionStorage.removeItem("mordomo.brainScene.classic");
  await mountShell("/brain", "nucleo", "pt-BR");
}
const toolbar = () =>
  [...document.querySelectorAll(".brain-topbar-actions button.btn.sm")].map(
    (b) => b.getAttribute("aria-label") ?? b.textContent!.trim(),
  );

describe("C72 the entries, each in its place", () => {
  it("C72 the moldura's toolbar: Perguntar (MessageSquare) is a .btn.sm right before Revisões (3)", async () => {
    withContext();
    reviewsList({ context: "proj-x" }, [], { total: 3 });
    reviews.wrong = { items: [], total: 99, nextDue: null };
    renderWith(<BrainChrome {...chrome()} />, { lang: "pt-BR" });
    await waitFor(() => expect(toolbar()).toContain("Revisões (3)"));
    const names = toolbar();
    // cerebro-entidades-resumos (design.md "Entradas"): "Entidades" between them
    expect(names.indexOf("Perguntar")).toBe(names.indexOf("Revisões (3)") - 2);
    expect(names.indexOf("Entidades")).toBe(names.indexOf("Perguntar") + 1);
    const button = [...document.querySelectorAll(".brain-topbar-actions button.btn.sm")].find(
      (b) => b.textContent!.trim() === "Perguntar",
    )!;
    expect(button.querySelector("svg.lucide-message-square")).not.toBeNull();
  });

  it("C72 the moldura's Perguntar lands on /brain/ask", async () => {
    await mountShell("/brain", "moldura", "pt-BR");
    const b = await screen.findByRole("button", { name: "Perguntar" }, { timeout: 10_000 });
    fireEvent.click(b);
    await askUp();
    expect(window.location.hash).toBe("#/brain/ask");
  });

  it("C72 the Núcleo's brain scene menu: Perguntar ao cérebro is the row right above the cleanup's, and lands on /brain/ask", async () => {
    await scene();
    const more = await screen.findByRole("button", { name: "Mais" }, { timeout: 10_000 }).catch(() => null);
    fireEvent.click(more ?? document.querySelector(".bs-more")!);
    const acts = () => [...document.querySelectorAll(".bs-menu-acts > button")].map((b) => b.textContent);
    await waitFor(() => expect(acts()).toContain("Perguntar ao cérebro"));
    // cerebro-entidades-resumos (design.md "Entradas"): "Entidades" between them
    expect(acts().indexOf("Perguntar ao cérebro")).toBe(acts().indexOf("Faxina") - 2);
    expect(acts().indexOf("Entidades")).toBe(acts().indexOf("Perguntar ao cérebro") + 1);
    fireEvent.click(screen.getByRole("button", { name: "Perguntar ao cérebro" }));
    await askUp();
    expect(window.location.hash).toBe("#/brain/ask");
    expect(document.querySelector(".nu-shell .bs-notes .ask")).not.toBeNull();
  });

  it("C72 the registry holds Perguntar ao cérebro (global, in the palette; en Ask the brain)", async () => {
    const registry = new CommandRegistry();
    await mountShell("/", "moldura", "pt-BR", registry);
    const command = registry.list().find((c) => c.id === "action:ask-brain")!;
    expect([command.title, command.scope, command.palette]).toEqual(["ask.title", "global", true]);
    const { tf } = await import("../../i18n");
    expect(tf("pt-BR", command.title)).toBe("Perguntar ao cérebro");
    expect(tf("en", command.title)).toBe("Ask the brain");
  });

  for (const shell of ["moldura", "nucleo"] as const)
    it(`C72 the palette's Perguntar ao cérebro lands on /brain/ask in the ${shell}`, async () => {
      if (shell === "nucleo") net.prefs.shell = "nucleo";
      const registry = new CommandRegistry();
      await mountShell("/", shell, "pt-BR", registry);
      const command = registry.list().find((c) => c.id === "action:ask-brain")!;
      act(() => command.run());
      await askUp();
      expect(window.location.hash).toBe("#/brain/ask");
      if (shell === "nucleo") expect(document.querySelector(".nu-shell .bs-notes .ask")).not.toBeNull();
    });

  it("C72 a in the view:brain scope opens /brain/ask", async () => {
    const registry = new CommandRegistry();
    await mountShell("/brain", "moldura", "pt-BR", registry);
    await screen.findByRole("button", { name: "Perguntar" }, { timeout: 10_000 });
    const a = registry.list().find((c) => c.keys?.includes("a") && c.scope === "view:brain")!;
    expect([a.id, a.title]).toEqual(["brain.view.ask", "ask.title"]);
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.setup().keyboard("a");
    await askUp();
    expect(window.location.hash).toBe("#/brain/ask");
  });

  it("C72 a typed inside a field does not open it", async () => {
    await mountShell("/brain", "moldura", "pt-BR");
    await screen.findByRole("button", { name: "Perguntar" }, { timeout: 10_000 });
    const field = document.querySelector<HTMLInputElement>(
      ".brain-app input[type='search'], .brain-app input",
    )!;
    expect(field).not.toBeNull();
    const user = userEvent.setup();
    await user.click(field);
    await user.keyboard("a");
    expect(field.value.endsWith("a")).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    expect(window.location.hash.split("?")[0]).toBe("#/brain");
    expect(document.querySelector(".ask")).toBeNull();
  });
});

function Probe() {
  const { mode, go } = useBrainMode();
  const location = useLocation();
  return (
    <button type="button" data-mode={mode} data-at={location.pathname} onClick={() => go("ask")}>
      probe
    </button>
  );
}

describe("C73 the mode ask of the brain (door 6)", () => {
  it("C73 in a panel's route: /brain/ask reads as ask and go(ask) sets the panel to /brain/ask", () => {
    const setLocation = vi.fn();
    renderWith(
      <AppRouteContext.Provider value={{ pathname: "/brain/ask", search: "", setLocation }}>
        <Probe />
      </AppRouteContext.Provider>,
    );
    const probe = screen.getByRole("button", { name: "probe" });
    expect(probe.dataset.mode).toBe("ask");
    fireEvent.click(probe);
    expect(setLocation).toHaveBeenCalledWith({ pathname: "/brain/ask", search: "" });
    cleanup();
    renderWith(
      <AppRouteContext.Provider value={{ pathname: "/brain", search: "", setLocation }}>
        <Probe />
      </AppRouteContext.Provider>,
    );
    expect(screen.getByRole("button", { name: "probe" }).dataset.mode).toBe("graph");
  });

  it("C73 in the router: go(ask) navigates to /brain/ask, which reads as ask", async () => {
    renderWith(<Probe />);
    const probe = screen.getByRole("button", { name: "probe" });
    expect(probe.dataset.mode).toBe("graph");
    fireEvent.click(probe);
    await waitFor(() => expect(probe.dataset.at).toBe("/brain/ask"));
    expect(probe.dataset.mode).toBe("ask");
  });
});

const PLANO = `${MEM}/notes/plano.md`;
describe("C90 the notes view's Perguntar sobre esta nota", () => {
  it("C90 the note's action menu has Perguntar sobre esta nota (MessageSquarePlus), which opens /brain/ask with that note", async () => {
    note(4, MEM, "notes/plano.md", { title: "Plano" });
    const setLocation = vi.fn();
    const user = userEvent.setup();
    renderWith(
      <AppRouteContext.Provider value={{ pathname: "/brain/notes", search: "", setLocation }}>
        <NoteReader
          path={PLANO}
          meta={{ id: 4, title: "Plano" }}
          id={4}
          onOpen={() => undefined}
          onShowInGraph={() => undefined}
          onSetHome={() => undefined}
        />
      </AppRouteContext.Provider>,
      { lang: "pt-BR" },
    );
    await user.click(await screen.findByRole("button", { name: "Mais" }, { timeout: 10_000 }));
    const item = await screen.findByRole("menuitem", { name: "Perguntar sobre esta nota" });
    expect(item.querySelector("svg.lucide-message-square-plus")).not.toBeNull();
    await user.click(item);
    expect(setLocation).toHaveBeenCalledWith({
      pathname: "/brain/ask",
      search: `?note=${encodeURIComponent(PLANO)}`,
    });
  });

  it("C90 /brain/ask?note=<that note> in the shell: the scope Estas notas with its chip, the focus in the question", async () => {
    await mountShell(`/brain/ask?note=${encodeURIComponent(PLANO)}`, "moldura", "pt-BR");
    await askUp();
    expect(await screen.findByRole("button", { name: "Estas notas" })).toBeTruthy();
    expect([...document.querySelectorAll(".ask-chip span")].map((s) => s.textContent)).toEqual(["plano.md"]);
    await waitFor(() =>
      expect(document.activeElement).toBe(document.querySelector('.ask textarea[placeholder^="Ex.:"]')),
    );
  });
});

describe("C97 the view is its own chunk", () => {
  it("C97 BrainViewSwitch reaches AskView only through lazyRoute(import()); neither entry loads brain/ask/ until then", () => {
    const tree = loadTree();
    const source = tree.get("brain/BrainViewSwitch.tsx")!;
    expect(source).toContain('export const AskView = lazyRoute(() => import("./ask/AskView"));');
    for (const entry of ENTRIES) {
      const seen = new Set<string>([entry]);
      const queue = [entry];
      while (queue.length > 0)
        for (const edge of edgesOf(tree, queue.pop()!)) {
          if (edge.how === "dynamic" || edge.how === "url" || seen.has(edge.to)) continue;
          seen.add(edge.to);
          queue.push(edge.to);
        }
      expect(
        [...seen].filter((f) => f.startsWith("brain/ask/")),
        entry,
      ).toEqual([]);
    }
    expect(reachable(tree).has("brain/ask/AskView.tsx")).toBe(true);
    const importers = (to: string) =>
      [...tree.keys()]
        .filter(
          (f) =>
            !/\.test\./.test(f) && f !== "brain/ask/testkit.tsx" && edgesOf(tree, f).some((e) => e.to === to),
        )
        .sort();
    const how = (from: string, to: string) => edgesOf(tree, from).find((e) => e.to === to)?.how;
    expect(importers("brain/ask/AskView.tsx")).toEqual(["brain/BrainViewSwitch.tsx", "gallery/askStory.tsx"]);
    expect(how("brain/BrainViewSwitch.tsx", "brain/ask/AskView.tsx")).toBe("dynamic");
    expect(importers("gallery/askStory.tsx")).toEqual(["gallery/main.tsx"]);
    expect(how("gallery/main.tsx", "gallery/askStory.tsx")).toBe("dynamic");
  });
});

describe("C99 the gallery's story of the view", () => {
  it("C99 the gallery holds the story Perguntar through the view's chunk, with its states: empty, answering, direct answer, reason-first answer, abstained, refused, off", async () => {
    const tree = loadTree();
    expect(tree.get("gallery/main.tsx")).toContain('const AskStory = lazy(() => import("./askStory"));');
    expect(tree.get("gallery/main.tsx")).toMatch(
      /<Story id="ask" title="Perguntar">\s*<Suspense fallback=\{null\}>\s*<AskStory \/>/,
    );
    const Story = lazy(() => import("../../gallery/askStory"));
    renderWith(
      <Suspense fallback={null}>
        <Story />
      </Suspense>,
      { lang: "pt-BR" },
    );
    const col = await waitFor(() => {
      const el = document.querySelector(".ask .ask-col");
      expect(el?.children.length).toBeGreaterThan(0);
      return el!;
    });
    const parts = [...col.children];
    const kinds = parts.map((p) =>
      p.matches(".ask-empty")
        ? "empty"
        : p.matches(".ask-wait")
          ? "answering"
          : p.matches(".ask-answer") && p.querySelector(".notes-fold")
            ? "reason-first answer"
            : p.matches(".ask-answer")
              ? "direct answer"
              : p.matches(".ask-none")
                ? "abstained"
                : p.matches(".ask-band")
                  ? "refused"
                  : p.matches(".ask-off")
                    ? "off"
                    : p.className,
    );
    expect(kinds).toEqual([
      "empty",
      "answering",
      "direct answer",
      "reason-first answer",
      "abstained",
      "refused",
      "off",
    ]);
    expect(parts[0]!.textContent).toContain("Nenhuma pergunta ainda.");
    expect(parts[1]!.textContent).toContain("Lendo as suas notas e escrevendo a resposta…");
    expect(parts[2]!.querySelector(".ask-provocation")).not.toBeNull();
    expect(parts[3]!.textContent).toContain("Onde as notas concordam");
    expect(parts[4]!.textContent).toContain("Não encontrei nada nas suas notas sobre isso.");
    expect(parts[5]!.textContent).toContain("A resposta não passou na conferência das fontes.");
    expect(parts[6]!.textContent).toContain(
      "Perguntar está desligado: a skill brain-ask não pode ler a memória.",
    );
    expect(before(parts[0]!, parts[6]!)).toBe(true);
  });
});

describe("C99 the gallery's story of the tab Agentes (MCP)", () => {
  it("C99 the gallery holds the story Agentes (MCP) through the tab's chunk, with its states: connected, not connected, no usage, with usage", async () => {
    const tree = loadTree();
    expect(tree.get("gallery/main.tsx")).toContain(
      'const AgentsMcpStory = lazy(() => import("./agentsMcpStory"));',
    );
    expect(tree.get("gallery/main.tsx")).toMatch(
      /<Story id="agents-mcp" title="Agentes \(MCP\)">\s*<Suspense fallback=\{null\}>\s*<AgentsMcpStory \/>/,
    );
    expect(tree.get("gallery/agentsMcpStory.tsx")).toContain('from "../views/settings/AgentsMcp"');
    const Story = lazy(() => import("../../gallery/agentsMcpStory"));
    renderWith(
      <Suspense fallback={null}>
        <Story />
      </Suspense>,
      { lang: "pt-BR" },
    );
    const cards = await waitFor(() => {
      const els = [...document.querySelectorAll(".am > .card.stack")];
      expect(els.length).toBeGreaterThan(3);
      return els;
    });
    const states = [
      ...[...cards[0]!.querySelectorAll(":scope > .am-col")].map((b) =>
        b.querySelector(".am-ok") ? "connected" : b.querySelector("pre") ? "not connected" : b.className,
      ),
      ...cards
        .filter((c) => c.querySelector("h3"))
        .map((c) =>
          c.textContent!.includes("Nenhum agente leu o cérebro ainda.")
            ? "no usage"
            : c.textContent!.includes("leituras desde")
              ? "with usage"
              : c.textContent,
        ),
    ];
    expect(states).toEqual(["connected", "not connected", "not connected", "no usage", "with usage"]);
    expect(cards[0]!.textContent).toContain("Não deu para ler /fixture/.codex/config.toml.");
    expect(cards[1]!.querySelectorAll("li")).toHaveLength(13);
    expect(cards.at(-1)!.querySelectorAll(".am-fill").length).toBeGreaterThan(0);
  });
});
