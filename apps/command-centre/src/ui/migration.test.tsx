// @vitest-environment jsdom
/**
 * The widgets that were made by hand and now stand on the primitives
 * (.specs/features/primitivas, C20-C24): each one is asserted through what a
 * person meets — the roles, the keys, where focus goes — not through what it is
 * built of (which `ui.source.test.ts` reads). The shell is mounted the way
 * App.tsx mounts it, on the commands harness (the network is a table).
 */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type * as ApiModule from "../api";
import { I18nContext } from "../i18n";
import { qk } from "../queries";
import { ToastProvider } from "../components/ui";
import { ConfirmProvider, useConfirm } from "../hooks/useConfirm";
import { ProviderGate } from "../components/ProviderGate";
import { defaultUi } from "../brain/state";
import { BrainSceneMenu } from "../nucleo/scenes/BrainSceneMenu";
import SkillsTools from "../nucleo/scenes/SkillsSceneTools";
import { CommandRegistry } from "../commands/registry";
import { PROVIDERS, installHarness, mountShell, openHelp, press } from "../commands/testkit";
import { getDialogDepth } from ".";

vi.mock("../api", async (importOriginal) =>
  (await import("../commands/testserver")).mockApi(await importOriginal<typeof ApiModule>()),
);
// The brain's canvases paint through WebGL / a 2D context jsdom does not have.
vi.mock("../brain/BrainCanvas", () => ({ BrainCanvas: () => null }));
vi.mock("../nucleo/scenes/BrainSceneCanvas", () => ({ BrainSceneCanvas: () => null }));

installHarness();

const modalRoot = () => document.getElementById("modal-root");
/** A lazy screen on a busy machine: more than the default second. */
const SLOW = { timeout: 15_000 };
const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));

/** The page the app gives a dialog: a #modal-root beside the shell. */
function withModalRoot() {
  if (!modalRoot()) {
    const el = document.createElement("div");
    el.id = "modal-root";
    document.body.appendChild(el);
  }
}

describe("C20 the dialogs", () => {
  it("C20 the command palette opens on the primitives' surface, takes focus, and Escape closes it and gives focus back", async () => {
    withModalRoot();
    await mountShell("/", "moldura");
    const opener = document.querySelector<HTMLElement>(".mold-search")!;
    opener.focus();
    press({ key: "k", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    expect(modalRoot()!.contains(dialog)).toBe(true);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.parentElement!.className).toContain("launcher");
    const input = within(dialog).getByRole("combobox");
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(getDialogDepth()).toBe(1);
    press({ key: "Escape" }, input);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(getDialogDepth()).toBe(0);
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);
  });

  it("C20 the shortcuts help is a modal dialog of the same surface", async () => {
    withModalRoot();
    await mountShell("/", "moldura");
    await openHelp();
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(modalRoot()!.contains(dialog)).toBe(true);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    press({ key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull());
  });

  it("C20 a confirmation puts focus on Cancel when it is destructive and on Confirm when it is not", async () => {
    withModalRoot();
    function Ask({ danger }: { danger: boolean }) {
      const confirm = useConfirm();
      return (
        <button onClick={() => void confirm({ title: "Delete it?", body: "Gone.", danger })}>ask</button>
      );
    }
    for (const [danger, focused] of [
      [true, "Cancel"],
      [false, "Confirm"],
    ] as const) {
      const view = render(
        <I18nContext.Provider value={{ lang: "en", setLang: () => undefined }}>
          <ToastProvider>
            <ConfirmProvider>
              <Ask danger={danger} />
            </ConfirmProvider>
          </ToastProvider>
        </I18nContext.Provider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "ask" }));
      const dialog = await screen.findByRole("dialog", { name: "Delete it?" });
      expect(modalRoot()!.contains(dialog)).toBe(true);
      await waitFor(() =>
        expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: focused })),
      );
      view.unmount();
    }
  });

  it("C20 the provider gate stays mounted while closed, opens as a dialog, and skips with Escape or its button", async () => {
    withModalRoot();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Nothing installed: the gate has to open.
    qc.setQueryData(
      qk.providers,
      PROVIDERS.map((p) => ({
        ...p,
        health: { ...p.health, installed: false, ok: false, authenticated: false },
      })),
    );
    render(
      <QueryClientProvider client={qc}>
        <I18nContext.Provider value={{ lang: "en", setLang: () => undefined }}>
          <ToastProvider>
            <MemoryRouter>
              <ProviderGate />
            </MemoryRouter>
          </ToastProvider>
        </I18nContext.Provider>
      </QueryClientProvider>,
    );
    const gate = await screen.findByTestId("provider-gate");
    expect(gate.getAttribute("role")).toBe("dialog");
    expect(gate.getAttribute("aria-modal")).toBe("true");
    expect(gate.getAttribute("aria-labelledby")).toBe("provider-gate-title");
    expect(modalRoot()!.contains(gate)).toBe(true);
    // A press outside does not skip it; Escape does.
    fireEvent.pointerDown(gate.parentElement!);
    fireEvent.click(gate.parentElement!);
    await settle();
    expect(screen.queryByTestId("provider-gate")).not.toBeNull();
    press({ key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("provider-gate")).toBeNull());
    expect(document.documentElement.dataset.providerGate).toBeUndefined();
  });
});

describe("C21 the popovers", () => {
  it("C21 the bell hangs from the top bar as a popover: Escape closes it with focus back on the bell, and it has no command of its own", async () => {
    const registry = new CommandRegistry();
    await mountShell("/", "moldura", "en", registry);
    const bell = document.querySelector<HTMLElement>(".mold-bell")!;
    fireEvent.click(bell);
    const popover = await screen.findByRole("dialog", { name: "Notifications" });
    expect(popover.getAttribute("aria-modal")).toBe("false");
    expect(popover.className).toContain("popover");
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);
    expect(registry.list().map((c) => c.id)).not.toContain("moldura.bell.close");
    press({ key: "Escape" }, popover);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Notifications" })).toBeNull());
    expect(document.activeElement).toBe(bell);
  });

  it("C21 the console's model chip opens a popover over the control: not modal, Escape closes it and focus returns to the chip", async () => {
    withModalRoot();
    await mountShell("/", "moldura");
    const chip = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('.cons-ctl button[aria-haspopup="dialog"]');
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.click(chip);
    const popover = await screen.findByRole("dialog", { name: /^Model/ });
    expect(popover.getAttribute("aria-modal")).toBe("false");
    expect(modalRoot()!.contains(popover)).toBe(true);
    expect(popover.className).toContain("me-popover");
    // The page behind it stays live: nothing is inert.
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);
    expect(getDialogDepth()).toBe(0);
    press({ key: "Escape" }, popover);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /^Model/ })).toBeNull());
    expect(document.activeElement).toBe(chip);
  });
});

describe("C22 the tabs", () => {
  it("C22 Settings: a vertical tablist with one tab stop, the arrow keys move, and the panel keeps settings-tabs-panel-<tab>", async () => {
    await mountShell("/settings", "moldura");
    const list = await screen.findByRole("tablist", {}, SLOW);
    expect(list.getAttribute("aria-orientation")).toBe("vertical");
    const tabs = within(list).getAllByRole("tab");
    expect(tabs.length).toBeGreaterThan(5);
    expect(tabs.filter((t) => t.tabIndex === 0)).toHaveLength(0);
    expect(list.tabIndex).toBe(0);
    const first = tabs[0]!;
    expect(first.id).toBe("settings-tabs-tab-identity");
    expect(first.getAttribute("aria-controls")).toBe("settings-tabs-panel-identity");
    const panel = screen.getByRole("tabpanel");
    expect(panel.id).toBe("settings-tabs-panel-identity");
    expect(panel.getAttribute("aria-labelledby")).toBe("settings-tabs-tab-identity");
    await act(async () => void first.focus());
    fireEvent.keyDown(first, { key: "ArrowDown" });
    await settle();
    const second = tabs[1]!;
    expect(document.activeElement).toBe(second);
    expect(second.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").id).toBe(
      `settings-tabs-panel-${second.id.replace("settings-tabs-tab-", "")}`,
    );
  });

  it("C22 a skill's panes are line tabs tied to one panel", async () => {
    await mountShell("/skills/demo", "moldura");
    const tab = await screen.findByRole("tab", { name: /^SKILL\.md/ }, SLOW);
    expect(tab.id).toBe("skill-panes-tab-body");
    expect(tab.getAttribute("aria-controls")).toBe("skill-panes-panel-body");
    expect(tab.closest('[role="tablist"]')!.getAttribute("data-variant")).toBe("line");
    expect(screen.getByRole("tabpanel").id).toBe("skill-panes-panel-body");
    fireEvent.click(screen.getByRole("tab", { name: /Notes|Notas/ }));
    await waitFor(() => expect(screen.getByRole("tabpanel").id).toBe("skill-panes-panel-notes"));
  });

  it("C22 the Núcleo's run page has pill tabs tied to #rs-run-panel", async () => {
    await mountShell("/runs/r1", "nucleo");
    const tabs = await screen.findAllByRole("tab", {}, SLOW);
    const pills = tabs.filter((t) => t.id.startsWith("rs-tab-"));
    expect(pills.map((t) => t.id)).toEqual(["rs-tab-summary", "rs-tab-steps", "rs-tab-log"]);
    expect(pills[0]!.closest('[role="tablist"]')!.getAttribute("data-variant")).toBe("pill");
    const panel = screen.getByRole("tabpanel");
    expect(panel.id).toBe("rs-run-panel");
    expect(panel.getAttribute("aria-labelledby")).toBe("rs-tab-summary");
    fireEvent.click(pills[1]!);
    await waitFor(() =>
      expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe("rs-tab-steps"),
    );
  });
});

describe("C23 the switches", () => {
  const menu = (
    patch: (p: Partial<ReturnType<typeof defaultUi>>) => void,
    over: Partial<ReturnType<typeof defaultUi>> = {},
  ) => (
    <I18nContext.Provider value={{ lang: "en", setLang: () => undefined }}>
      <BrainSceneMenu
        ui={{ ...defaultUi(), ...over }}
        patch={patch}
        kindCounts={new Map([["markdown-link", 3]])}
        facets={{ exts: [], tags: [] }}
        hygiene={{ orphans: [], stale: [], unopened: [] }}
        dangling={[]}
        refreshing={false}
        listOpen={false}
        truncated={false}
        onRefresh={() => undefined}
        onToggleList={() => undefined}
        onClassic={() => undefined}
        onReset={() => undefined}
        onBake={() => undefined}
        onNote={() => undefined}
      />
    </I18nContext.Provider>
  );

  it("C23 the local-graph toggle and the edge-kind chips are switches that follow the state and keep their text and count", () => {
    const patch = vi.fn();
    const view = render(menu(patch, { local: false }));
    const local = screen.getByRole("switch", { name: /Local/i });
    expect(local.getAttribute("aria-checked")).toBe("false");
    expect(local.className).toContain("ui-switch");
    fireEvent.click(local);
    expect(patch).toHaveBeenCalledWith({ local: true });
    view.rerender(menu(patch, { local: true }));
    expect(screen.getByRole("switch", { name: /Local/i }).getAttribute("aria-checked")).toBe("true");
    const chip = screen.getByRole("switch", { name: /3/ });
    expect(chip.className).toContain("chip");
    expect(chip.textContent).toContain("3");
    expect(chip.getAttribute("aria-checked")).toBe(String(defaultUi().edgeKinds.includes("markdown-link")));
    fireEvent.click(chip);
    expect(patch).toHaveBeenLastCalledWith({ edgeKinds: expect.any(Array) });
  });
});

describe("C24 the Skills scene's menu", () => {
  it("C24 the + opens a menu of three items, each calls its callback once and closes the menu", async () => {
    withModalRoot();
    const qc = new QueryClient();
    qc.setQueryData(qk.providers, PROVIDERS);
    const run = { market: vi.fn(), export: vi.fn(), new: vi.fn() };
    function Host() {
      const [filters, setFilters] = useState({
        mode: "all",
        provider: "all",
        favOnly: false,
        showPaused: false,
      } as const);
      return (
        <SkillsTools
          query=""
          onQuery={() => undefined}
          onQueryKey={() => undefined}
          inputRef={{ current: null }}
          filters={filters}
          onFilters={(f) => setFilters(f as never)}
          pausedCount={0}
          shown={0}
          total={0}
          page={0}
          pages={1}
          onPage={() => undefined}
          onMarket={run.market}
          onExport={run.export}
          onNew={run.new}
        />
      );
    }
    render(
      <QueryClientProvider client={qc}>
        <I18nContext.Provider value={{ lang: "en", setLang: () => undefined }}>
          <Host />
        </I18nContext.Provider>
      </QueryClientProvider>,
    );
    const plus = screen.getByTestId("skills-more");
    expect(plus.getAttribute("aria-haspopup")).toBe("menu");
    expect(plus.hasAttribute("title")).toBe(false);
    for (const [name, spy] of [
      ["Marketplace", run.market],
      ["Export", run.export],
      ["New skill", run.new],
    ] as const) {
      fireEvent.pointerDown(plus, { button: 0, ctrlKey: false });
      const menu = await screen.findByRole("menu");
      const item = within(menu)
        .getAllByRole("menuitem")
        .find((i) => i.textContent?.includes(name))!;
      expect(item).toBeTruthy();
      fireEvent.click(item);
      await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    }
  });
});
