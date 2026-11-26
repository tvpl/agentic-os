// @vitest-environment jsdom
/**
 * Where "Resumos" opens from, and the two views' chunks (.specs/features/cerebro-entidades-resumos, C120, C130; design.md
 * "Entradas", door 8, binding `comandos-atalhos` and `moldura-app`): the moldura's `.btn.sm` "Resumos" with `ScrollText`
 * right after "Entidades", the Núcleo scene menu's row right below "Entidades", the palette's `global` command in both
 * shells, each landing on `/brain/summaries`; `useBrainMode` in the panel's route and in the router; and each of the
 * two views reached only through `lazyRoute(import())`, so neither entry fetches it before its route opens.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import type * as ApiModule from "../../api";
import { installPage } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import { mountShell } from "../../commands/testkit";
import { CommandRegistry } from "../../commands/registry";
import { AppRouteContext } from "../../desktop/appRoute";
import { BrainChrome, type BrainChromeProps } from "../BrainChrome";
import { useBrainMode } from "../BrainViewSwitch";
import { defaultUi } from "../state";
import { fileRow, note, resetNet, type Asked } from "../notes/testnet";
import { resetReviews } from "../reviews/testkit";
import { resetWeekly } from "../weekly/testkit";
import { MEM, net, resetSummaries } from "./testkit";
import { ENTRIES, edgesOf, loadTree, reachable } from "../../testing/sourceGraph";

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
  resetSummaries();
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

const summariesUp = () =>
  waitFor(() => expect(document.querySelector(".sum-view h1.sum-h1")?.textContent).toBe("Resumos"), {
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

describe("C120 the entries, each in its place", () => {
  it("C120 the moldura's toolbar: Resumos (ScrollText) is a .btn.sm right after Entidades", async () => {
    renderWith(<BrainChrome {...chrome()} />, { lang: "pt-BR" });
    await waitFor(() => expect(toolbar()).toContain("Resumos"));
    const names = toolbar();
    expect(names.indexOf("Resumos")).toBe(names.indexOf("Entidades") + 1);
    const button = [...document.querySelectorAll(".brain-topbar-actions button.btn.sm")].find(
      (b) => b.textContent!.trim() === "Resumos",
    )!;
    expect(button.querySelector("svg.lucide-scroll-text")).not.toBeNull();
  });

  it("C120 the moldura's Resumos lands on /brain/summaries", async () => {
    await mountShell("/brain", "moldura", "pt-BR");
    const b = await screen.findByRole("button", { name: "Resumos" }, { timeout: 10_000 });
    fireEvent.click(b);
    await summariesUp();
    expect(window.location.hash).toBe("#/brain/summaries");
  });

  it("C120 the Núcleo's brain scene menu: Resumos is the row right below Entidades, and lands on /brain/summaries", async () => {
    await scene();
    const more = await screen.findByRole("button", { name: "Mais" }, { timeout: 10_000 }).catch(() => null);
    fireEvent.click(more ?? document.querySelector(".bs-more")!);
    const acts = () => [...document.querySelectorAll(".bs-menu-acts > button")].map((b) => b.textContent);
    await waitFor(() => expect(acts()).toContain("Resumos"));
    expect(acts().indexOf("Resumos")).toBe(acts().indexOf("Entidades") + 1);
    fireEvent.click(
      [...document.querySelectorAll<HTMLButtonElement>(".bs-menu-acts > button")].find(
        (b) => b.textContent === "Resumos",
      )!,
    );
    await summariesUp();
    expect(window.location.hash).toBe("#/brain/summaries");
    expect(document.querySelector(".nu-shell .bs-notes .sum-view")).not.toBeNull();
  });

  it("C120 the registry holds Resumos (global, in the palette; en Summaries)", async () => {
    const registry = new CommandRegistry();
    await mountShell("/", "moldura", "pt-BR", registry);
    const command = registry.list().find((c) => c.id === "action:summaries")!;
    expect([command.title, command.scope, command.palette]).toEqual(["summaries.title", "global", true]);
    const { tf } = await import("../../i18n");
    expect(tf("pt-BR", command.title)).toBe("Resumos");
    expect(tf("en", command.title)).toBe("Summaries");
  });

  for (const shell of ["moldura", "nucleo"] as const)
    it(`C120 the palette's Resumos lands on /brain/summaries in the ${shell}`, async () => {
      if (shell === "nucleo") net.prefs.shell = "nucleo";
      const registry = new CommandRegistry();
      await mountShell("/", shell, "pt-BR", registry);
      const command = registry.list().find((c) => c.id === "action:summaries")!;
      act(() => command.run());
      await summariesUp();
      expect(window.location.hash).toBe("#/brain/summaries");
      if (shell === "nucleo") expect(document.querySelector(".nu-shell .bs-notes .sum-view")).not.toBeNull();
    });
});

function Probe() {
  const { mode, go } = useBrainMode();
  const location = useLocation();
  return (
    <button type="button" data-mode={mode} data-at={location.pathname} onClick={() => go("summaries")}>
      probe
    </button>
  );
}

describe("C120 the mode summaries of the brain (door 8)", () => {
  it("C120 in a panel's route: /brain/summaries reads as summaries and go(summaries) sets the panel to /brain/summaries", () => {
    const setLocation = vi.fn();
    renderWith(
      <AppRouteContext.Provider value={{ pathname: "/brain/summaries", search: "", setLocation }}>
        <Probe />
      </AppRouteContext.Provider>,
    );
    const probe = screen.getByRole("button", { name: "probe" });
    expect(probe.dataset.mode).toBe("summaries");
    fireEvent.click(probe);
    expect(setLocation).toHaveBeenCalledWith({ pathname: "/brain/summaries", search: "" });
  });

  it("C120 in the router: go(summaries) navigates to /brain/summaries, which reads as summaries", async () => {
    renderWith(<Probe />);
    const probe = screen.getByRole("button", { name: "probe" });
    expect(probe.dataset.mode).toBe("graph");
    fireEvent.click(probe);
    await waitFor(() => expect(probe.dataset.at).toBe("/brain/summaries"));
    expect(probe.dataset.mode).toBe("summaries");
  });
});

describe("C130 each view is its own chunk, fetched the first time its route opens", () => {
  const VIEWS = [
    [
      "EntitiesView",
      "brain/entities/EntitiesView.tsx",
      "./entities/EntitiesView",
      "gallery/entitiesStory.tsx",
    ],
    [
      "SummariesView",
      "brain/summaries/SummariesView.tsx",
      "./summaries/SummariesView",
      "gallery/summariesStory.tsx",
    ],
  ] as const;

  for (const [name, file, spec, story] of VIEWS)
    it(`C130 ${name} is reached only through lazyRoute(import()) of BrainViewSwitch: neither entry loads it, or its folder's view, before its route opens`, () => {
      const tree = loadTree();
      expect(tree.get("brain/BrainViewSwitch.tsx")!).toContain(
        `export const ${name} = lazyRoute(() => import("${spec}"));`,
      );
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
          [...seen].filter((f) => f === file),
          entry,
        ).toEqual([]);
      }
      expect(reachable(tree).has(file)).toBe(true);
      const importers = [...tree.keys()]
        .filter(
          (f) =>
            !/\.test\./.test(f) && !f.endsWith("/testkit.tsx") && edgesOf(tree, f).some((e) => e.to === file),
        )
        .sort();
      // and the gallery's story of the view (C145), which main.tsx loads lazily
      expect(importers).toEqual(["brain/BrainViewSwitch.tsx", story]);
      expect(edgesOf(tree, "gallery/main.tsx").find((e) => e.to === story)?.how).toBe("dynamic");
      expect(edgesOf(tree, "brain/BrainViewSwitch.tsx").find((e) => e.to === file)?.how).toBe("dynamic");
    });
});
