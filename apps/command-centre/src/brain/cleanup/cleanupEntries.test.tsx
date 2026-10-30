// @vitest-environment jsdom
/**
 * Where the guided cleanup opens from (.specs/features/cerebro-faxina-guiada, C51, C52; plan.md amendment 11): the
 * context selector's item, the graph's "Faxina" button, the Núcleo scene menu's row and the palette's command, each in
 * its place, and the step and scope each opens on. The network is `../notes/testnet` with the routes of `./testkit`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as ApiModule from "../../api";
import { installPage, tick } from "../../ui/testkit";
import { ContextSelector } from "../../contexts/ContextSelector";
import { BrainChrome, type BrainChromeProps } from "../BrainChrome";
import { BrainSceneMenu } from "../../nucleo/scenes/BrainSceneMenu";
import { defaultUi } from "../state";
import { useGlobalCommands } from "../../commands/global";
import { CommandRegistry } from "../../commands/registry";
import { net, resetNet } from "../notes/testnet";
import { renderWith } from "../../contexts/testkit";
import { atStep, context, mountHost, resetCleanup } from "./testkit";

vi.mock("../../api", async (importOriginal) =>
  (await import("../notes/testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.mock("../../hooks/useEventStream", async () => ({
  useOsEvent: (await import("../notes/testnet")).useOsEventMock,
}));
vi.setConfig({ testTimeout: 30_000 });

installPage();
beforeEach(() => {
  resetNet();
  resetCleanup();
  context("alfa", "Alfa");
  context("beta", "Beta");
});

/** The step-1 radios, by name, with which one is checked. */
const radios = () =>
  screen
    .getAllByRole("radio")
    .map((r) => `${r.closest("label")!.textContent}${(r as HTMLInputElement).checked ? " ✓" : ""}`);
const before = (a: Element, b: Element) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

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

function SceneMenu() {
  const noop = () => undefined;
  return (
    <div className="bs-menu">
      <BrainSceneMenu
        ui={defaultUi()}
        patch={noop}
        kindCounts={new Map()}
        facets={{ exts: [], tags: [] }}
        hygiene={{ orphans: [], stale: [], unopened: [] }}
        dangling={[]}
        refreshing={false}
        listOpen={false}
        truncated={false}
        onRefresh={noop}
        onToggleList={noop}
        onClassic={noop}
        onReset={noop}
        onBake={noop}
        onNote={noop}
      />
    </div>
  );
}

function Palette() {
  useGlobalCommands({
    shell: "moldura",
    openPalette: () => undefined,
    openHelp: () => undefined,
    onMetaChanged: () => undefined,
  });
  return null;
}

describe("C51 the four entries, each in its place, and where each opens", () => {
  it("C51 the selector: with a context active, Fazer faxina neste contexto is the first item after the actions separator, before Novo contexto…, and opens step 2 on that context; with Todo o cérebro it is absent", async () => {
    net.prefs.activeContext = "beta";
    mountHost(<ContextSelector variant="frame" />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Beta/ }));
    await tick();
    const rows = [...document.querySelectorAll('[role="menu"] > *')];
    const seps = rows.map((r, i) => (r.getAttribute("role") === "separator" ? i : -1)).filter((i) => i >= 0);
    expect(seps).toHaveLength(2);
    const after = rows.slice(seps[1]! + 1).map((r) => r.textContent);
    expect(after).toEqual(["Fazer faxina neste contexto", "Novo contexto…", "Gerenciar contextos"]);
    await user.click(screen.getByRole("menuitem", { name: "Fazer faxina neste contexto" }));
    await atStep("Etapa 2 de 5 · O que tem aqui");
    expect(document.querySelector(".cln-scope-line")!.textContent).toBe("Beta");
  });

  it("C51 the selector with Todo o cérebro active has no cleanup item", async () => {
    net.prefs.activeContext = null;
    const user = userEvent.setup();
    renderWith(<ContextSelector variant="frame" />, { lang: "pt-BR" });
    await user.click(await screen.findByRole("button", { name: /Todo o cérebro/ }));
    await tick();
    const texts = [...document.querySelectorAll('[role="menu"] > *')].map((r) => r.textContent);
    expect(texts).toContain("Novo contexto…");
    expect(texts).not.toContain("Fazer faxina neste contexto");
  });

  for (const active of ["alfa", null] as const) {
    it(`C51 the graph's Faxina is the third .btn.sm of .brain-topbar-actions, after Atualizar índice and Modo apresentação (p), before the os-chips, and opens step 1 ${active ? "with the active context chosen" : "with nothing chosen under Todo o cérebro"}`, async () => {
      net.prefs.activeContext = active;
      mountHost(<BrainChrome {...chrome()} />);
      const row = document.querySelector(".brain-topbar-actions")!;
      const buttons = [...row.querySelectorAll("button.btn.sm")];
      expect(buttons.map((b) => b.getAttribute("aria-label") ?? b.textContent!.trim())).toEqual([
        "Atualizar índice",
        "Modo apresentação (p)",
        "Faxina",
      ]);
      const chips = [...row.querySelectorAll(".os-chip")];
      expect(chips.length).toBeGreaterThan(0);
      for (const chip of chips) expect(before(buttons[2]!, chip)).toBe(true);
      expect(buttons[2]!.querySelector("svg")).not.toBeNull();
      fireEvent.click(buttons[2]!);
      await atStep("Etapa 1 de 5 · Escopo");
      await waitFor(() => expect(radios()).toHaveLength(2));
      await waitFor(() =>
        expect(radios().filter((r) => r.endsWith("✓"))).toEqual(
          active ? [expect.stringContaining("Alfa")] : [],
        ),
      );
    });
  }

  for (const active of ["alfa", null] as const) {
    it(`C51 the Núcleo's Faxina is the last row of bs-menu-acts, after Salvar como visão padrão, and opens step 1 ${active ? "with the active context chosen" : "with nothing chosen"}`, async () => {
      net.prefs.activeContext = active;
      mountHost(<SceneMenu />);
      const rows = [...document.querySelectorAll(".bs-menu-acts > button")].map((b) => b.textContent);
      expect(rows.at(-1)).toBe("Faxina");
      expect(rows.at(-2)).toBe("Salvar como visão padrão");
      fireEvent.click(screen.getByRole("button", { name: "Faxina" }));
      await atStep("Etapa 1 de 5 · Escopo");
      await waitFor(() => expect(radios()).toHaveLength(2));
      await waitFor(() =>
        expect(radios().filter((r) => r.endsWith("✓"))).toEqual(
          active ? [expect.stringContaining("Alfa")] : [],
        ),
      );
    });
  }

  for (const active of ["beta", null] as const) {
    it(`C51 the palette's Faxina guiada opens step 1 ${active ? "with the active context chosen" : "with nothing chosen under Todo o cérebro"}`, async () => {
      net.prefs.activeContext = active;
      const registry = new CommandRegistry();
      mountHost(<Palette />, "pt-BR", registry);
      const command = registry.list().find((c) => c.id === "action:cleanup")!;
      act(() => command.run());
      const dialog = await screen.findByRole("dialog", undefined, { timeout: 5000 });
      expect(within(dialog).getByRole("heading", { name: "Faxina guiada" })).toBeTruthy();
      await atStep("Etapa 1 de 5 · Escopo");
      await waitFor(() => expect(radios()).toHaveLength(2));
      await waitFor(() =>
        expect(radios().filter((r) => r.endsWith("✓"))).toEqual(
          active ? [expect.stringContaining("Beta")] : [],
        ),
      );
    });
  }
});

describe("C52 the palette's command", () => {
  it("C52 the registry holds Faxina guiada with scope global and palette: true, and no key of its own", async () => {
    const mine = new CommandRegistry();
    renderWith(<Palette />, { lang: "pt-BR", registry: mine });
    const command = mine.list().find((c) => c.title === "cleanup.title");
    expect(command).toBeDefined();
    expect(command!.scope).toBe("global");
    expect(command!.palette).toBe(true);
    expect(command!.keys).toBeUndefined();
    const { tf } = await import("../../i18n");
    expect(tf("pt-BR", command!.title)).toBe("Faxina guiada");
  });
});
