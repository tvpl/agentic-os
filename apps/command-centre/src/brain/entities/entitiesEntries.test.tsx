// @vitest-environment jsdom
/**
 * Where "Entidades" opens from (.specs/features/cerebro-entidades-resumos, C102, C116; design.md "Entradas" and "Dobra -
 * Entidades do painel da nota", door 8, binding `comandos-atalhos` and `cerebro-rituais`): the moldura's `.btn.sm`
 * "Entidades" with `Users` right after "Perguntar", the Núcleo scene menu's row right below "Perguntar ao cérebro", the
 * palette's `global` command in both shells, each landing on `/brain/entities`; `useBrainMode` in the panel's route and
 * in the router; and the note panel's fold "Entidades (N)" right after "Menções sem link", with its header, its chips
 * each opening `/brain/entities?key=<key>`, and its empty line.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Suspense, lazy } from "react";
import { useLocation } from "react-router-dom";
import type * as ApiModule from "../../api";
import { installPage } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import { loadTree } from "../../testing/sourceGraph";
import { mountShell } from "../../commands/testkit";
import { CommandRegistry } from "../../commands/registry";
import { AppRouteContext } from "../../desktop/appRoute";
import { BrainChrome, type BrainChromeProps } from "../BrainChrome";
import { useBrainMode } from "../BrainViewSwitch";
import { defaultUi } from "../state";
import { NotePanel } from "../notes/NotePanel";
import { fileRow, note, pathOf, resetNet, type Asked } from "../notes/testnet";
import { resetReviews } from "../reviews/testkit";
import { resetWeekly } from "../weekly/testkit";
import { MEM, entity, kit, net, resetEntities } from "./testkit";

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
  resetEntities();
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

const entitiesUp = () =>
  waitFor(() => expect(document.querySelector(".ent-view h1.ent-h1")?.textContent).toBe("Entidades"), {
    timeout: 10_000,
  });

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

describe("C102 the entries, each in its place", () => {
  it("C102 the moldura's toolbar: Entidades (Users) is a .btn.sm right after Perguntar", async () => {
    renderWith(<BrainChrome {...chrome()} />, { lang: "pt-BR" });
    await waitFor(() => expect(toolbar()).toContain("Entidades"));
    const names = toolbar();
    expect(names.indexOf("Entidades")).toBe(names.indexOf("Perguntar") + 1);
    const button = [...document.querySelectorAll(".brain-topbar-actions button.btn.sm")].find(
      (b) => b.textContent!.trim() === "Entidades",
    )!;
    expect(button.querySelector("svg.lucide-users")).not.toBeNull();
  });

  it("C102 the moldura's Entidades lands on /brain/entities", async () => {
    await mountShell("/brain", "moldura", "pt-BR");
    const b = await screen.findByRole("button", { name: "Entidades" }, { timeout: 10_000 });
    fireEvent.click(b);
    await entitiesUp();
    expect(window.location.hash).toBe("#/brain/entities");
  });

  it("C102 the Núcleo's brain scene menu: Entidades is the row right below Perguntar ao cérebro, and lands on /brain/entities", async () => {
    await scene();
    const more = await screen.findByRole("button", { name: "Mais" }, { timeout: 10_000 }).catch(() => null);
    fireEvent.click(more ?? document.querySelector(".bs-more")!);
    const acts = () => [...document.querySelectorAll(".bs-menu-acts > button")].map((b) => b.textContent);
    await waitFor(() => expect(acts()).toContain("Entidades"));
    expect(acts().indexOf("Entidades")).toBe(acts().indexOf("Perguntar ao cérebro") + 1);
    fireEvent.click(
      [...document.querySelectorAll<HTMLButtonElement>(".bs-menu-acts > button")].find(
        (b) => b.textContent === "Entidades",
      )!,
    );
    await entitiesUp();
    expect(window.location.hash).toBe("#/brain/entities");
    expect(document.querySelector(".nu-shell .bs-notes .ent-view")).not.toBeNull();
  });

  it("C102 the registry holds Entidades (global, in the palette; en Entities)", async () => {
    const registry = new CommandRegistry();
    await mountShell("/", "moldura", "pt-BR", registry);
    const command = registry.list().find((c) => c.id === "action:entities")!;
    expect([command.title, command.scope, command.palette]).toEqual(["entities.title", "global", true]);
    const { tf } = await import("../../i18n");
    expect(tf("pt-BR", command.title)).toBe("Entidades");
    expect(tf("en", command.title)).toBe("Entities");
  });

  for (const shell of ["moldura", "nucleo"] as const)
    it(`C102 the palette's Entidades lands on /brain/entities in the ${shell}`, async () => {
      if (shell === "nucleo") net.prefs.shell = "nucleo";
      const registry = new CommandRegistry();
      await mountShell("/", shell, "pt-BR", registry);
      const command = registry.list().find((c) => c.id === "action:entities")!;
      act(() => command.run());
      await entitiesUp();
      expect(window.location.hash).toBe("#/brain/entities");
      if (shell === "nucleo") expect(document.querySelector(".nu-shell .bs-notes .ent-view")).not.toBeNull();
    });
});

function Probe() {
  const { mode, go } = useBrainMode();
  const location = useLocation();
  return (
    <button type="button" data-mode={mode} data-at={location.pathname} onClick={() => go("entities")}>
      probe
    </button>
  );
}

describe("C102 the mode entities of the brain (door 8)", () => {
  it("C102 in a panel's route: /brain/entities reads as entities and go(entities) sets the panel to /brain/entities", () => {
    const setLocation = vi.fn();
    renderWith(
      <AppRouteContext.Provider value={{ pathname: "/brain/entities", search: "", setLocation }}>
        <Probe />
      </AppRouteContext.Provider>,
    );
    const probe = screen.getByRole("button", { name: "probe" });
    expect(probe.dataset.mode).toBe("entities");
    fireEvent.click(probe);
    expect(setLocation).toHaveBeenCalledWith({ pathname: "/brain/entities", search: "" });
  });

  it("C102 in the router: go(entities) navigates to /brain/entities, which reads as entities", async () => {
    renderWith(<Probe />);
    const probe = screen.getByRole("button", { name: "probe" });
    expect(probe.dataset.mode).toBe("graph");
    fireEvent.click(probe);
    await waitFor(() => expect(probe.dataset.at).toBe("/brain/entities"));
    expect(probe.dataset.mode).toBe("entities");
  });
});

describe("C116 the note panel's fold Entidades", () => {
  const heads = () => [
    ...document.querySelectorAll<HTMLElement>(".notes-panel-body > .notes-fold .notes-fold-head button"),
  ];
  function mountPanel() {
    const f = note(1, MEM, "notes/ata.md", { title: "Ata" });
    const setLocation = vi.fn();
    net.mentions["1|"] = { file: fileRow(f), terms: ["Ata"], items: [], total: 0 };
    renderWith(
      <AppRouteContext.Provider value={{ pathname: "/brain/notes", search: "", setLocation }}>
        <NotePanel path={pathOf(f)} id={1} onOpen={() => undefined} />
      </AppRouteContext.Provider>,
      { lang: "pt-BR" },
    );
    return setLocation;
  }

  it("C116 Entidades (2) right after Menções sem link, with the same header element and class; chips with the kind's icon and the name, each opening /brain/entities?key=<key>", async () => {
    const ana = entity("perfil", "Ana Souza", 3);
    const atlas = entity("projeto", "Atlas", 2);
    kit.byFile.set(1, { items: [ana, atlas], total: 2 });
    const setLocation = mountPanel();
    await waitFor(() => expect(heads()[2]?.textContent).toBe("Entidades (2)"));
    expect(heads()[1]!.textContent).toBe("Menções sem link (0)");
    const [mentions, entities] = [heads()[1]!, heads()[2]!];
    for (const h of [mentions, entities]) {
      expect(h.parentElement!.tagName).toBe("H3");
      expect(h.parentElement!.className).toBe("notes-fold-head");
      expect(h.closest("section")!.className).toBe("notes-fold");
    }
    expect(
      new URLSearchParams(
        net.calls.find((c) => c.url.startsWith("/api/memory/entities?"))!.url.split("?")[1],
      ).toString(),
    ).toBe("file=1&limit=200");
    const fold = entities.closest("section")!;
    const chips = [...fold.querySelectorAll<HTMLButtonElement>("button.btn.sm")];
    expect(chips.map((c) => c.textContent)).toEqual(["Ana Souza", "Atlas"]);
    expect(chips[0]!.querySelector("svg.lucide-user")).not.toBeNull();
    expect(chips[1]!.querySelector("svg.lucide-folder-kanban")).not.toBeNull();
    fireEvent.click(chips[1]!);
    expect(setLocation).toHaveBeenCalledWith({ pathname: "/brain/entities", search: "?key=projeto%3Aatlas" });
  });

  it("C116 with none: Entidades (0) and Nenhuma entidade nesta nota. in 12px", async () => {
    kit.byFile.set(1, { items: [], total: 0 });
    mountPanel();
    await waitFor(() => expect(heads()[2]?.textContent).toBe("Entidades (0)"));
    const line = heads()[2]!.closest("section")!.querySelector("p")!;
    expect(line.textContent).toBe("Nenhuma entidade nesta nota.");
    expect(line.className).toBe("mf-dim");
  });
});

describe("C145 the gallery's stories of the two views", () => {
  const tree = loadTree();
  const mounted = async (file: "entitiesStory" | "summariesStory") => {
    const Story = lazy(() =>
      file === "entitiesStory"
        ? import("../../gallery/entitiesStory")
        : import("../../gallery/summariesStory"),
    );
    renderWith(
      <Suspense fallback={null}>
        <Story />
      </Suspense>,
      { lang: "pt-BR" },
    );
    await waitFor(() => expect(document.querySelectorAll(".ent-view, .sum-view").length).toBeGreaterThan(0));
  };
  const text = (el: Element | null) => el?.textContent ?? "";

  for (const [Name, file, id, title] of [
    ["EntitiesStory", "entitiesStory", "entities", "Entidades"],
    ["SummariesStory", "summariesStory", "summaries", "Resumos"],
  ] as const)
    it(`C145 the gallery's index registers the story ${title} through its own lazy module`, () => {
      const main = tree.get("gallery/main.tsx")!;
      expect(main).toContain(`const ${Name} = lazy(() => import("./${file}"));`);
      expect(main).toMatch(
        new RegExp(`<Story id="${id}" title="${title}">\\s*<Suspense fallback=\\{null\\}>\\s*<${Name} />`),
      );
      expect(tree.has(`gallery/${file}.tsx`)).toBe(true);
    });

  it("C145 Entidades renders its four frames without error: empty with the card off, an entity open with mentions, duplicates, a correction and a batch, the card with none, the view off", async () => {
    await mounted("entitiesStory");
    const views = [...document.querySelectorAll<HTMLElement>(".ent-view")];
    expect(views).toHaveLength(4);
    const [empty, open, none, viewOff] = views as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    expect(text(empty.querySelector(".ent-empty .ent-line"))).toContain("Nenhuma entidade ainda.");
    expect(text(empty.querySelector(".ent-ai .ent-ai-state .ent-line"))).toBe("Nenhum lote ainda.");
    expect(empty.querySelector(".ent-ai-top button")!.getAttribute("aria-pressed")).toBe("false");

    expect(text(open.querySelector(".ent-pname"))).toBe("Ana Souza");
    expect(text(open.querySelector(".ent-mentions h3"))).toBe("MENÇÕES (2)");
    expect(text(open.querySelector(".ent-dup .ent-name"))).toBe("Ana Sousa");
    expect(text(open.querySelector(".ent-corrows li span"))).toMatch(/^Juntou com A\. Souza em \d\d\/\d\d$/);
    expect(text(open.querySelector(".ent-ai .notes-fold-head"))).toBe("Sugestões (2)");
    expect(open.querySelectorAll(".ent-sugg")).toHaveLength(2);
    expect(text(open.querySelector(".ent-ai .ent-ai-state .ent-line"))).toMatch(
      /^Último lote: \d\d\/\d\d, 2 sugestões$/,
    );

    expect(text(none.querySelector(".ent-ai > .ent-small:last-child"))).toBe("Nenhuma sugestão nova.");
    expect(none.querySelector(".ent-ai-top button")!.getAttribute("aria-pressed")).toBe("true");

    expect(text(viewOff.querySelector(".ent-off .ent-line"))).toContain("Entidades desligadas.");
    expect(text(viewOff.querySelector(".ent-off button"))).toBe("Ligar");
  });

  it("C145 Resumos renders its three frames without error: the list with fresh, stale, missing and generating and a stale summary open; a summary being generated; the view off", async () => {
    await mounted("summariesStory");
    const views = [...document.querySelectorAll<HTMLElement>(".sum-view")];
    expect(views).toHaveLength(3);
    const [list, generating, off] = views as [HTMLElement, HTMLElement, HTMLElement];
    const states = [...list.querySelectorAll(".sum-row .sum-state")].map((s) => text(s));
    expect(states).toEqual([
      "Velho: 3 mudaram, 1 saiu, 2 novas",
      "Sem resumo",
      expect.stringMatching(/^Atual · \d\d\/\d\d$/),
      "Gerando…",
    ]);
    expect(text(list.querySelector(".sum-pname"))).toBe("Projects");
    expect(list.querySelector(".sum-stale")).not.toBeNull();
    expect(list.querySelectorAll(".sum-par")).toHaveLength(2);
    expect(generating.querySelector(".sum-panel")).not.toBeNull();
    expect(text(generating)).toContain("Gerando…");
    expect(text(off.querySelector(".sum-off"))).toContain("Resumos está desligado");
  });
});
