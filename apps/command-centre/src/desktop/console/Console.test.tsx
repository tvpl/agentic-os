// @vitest-environment jsdom
/**
 * The voice line (the console of G4), asserted on what it promises the hand:
 * the tray lists everything it can point at, `@` completes any of it, `/` on
 * an empty field is the deck, the controls fold behind one button, and the
 * line lights while a run is in flight.
 * The conversation and the launch are exercised end to end in Playwright;
 * here the network is a stub.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { qk } from "../../queries";
import { DesktopActionsProvider, type DesktopActions } from "../actions";
import type { OpenPanel } from "../panelKinds";
import type * as ApiModule from "../../api";
import Console from "./Console";

vi.mock("../../api", async (importOriginal) => {
  const mod = await importOriginal<typeof ApiModule>();
  return {
    ...mod,
    api: {
      ...mod.api,
      get: vi.fn(() => new Promise(() => undefined)),
      post: vi.fn(() => new Promise(() => undefined)),
      put: vi.fn(() => new Promise(() => undefined)),
    },
  };
});

const PANELS: OpenPanel[] = [
  {
    id: "doc:/tmp/report.md",
    kind: "artifact",
    ref: "report.md",
    title: "report.md",
    path: "/tmp/report.md",
    minimized: false,
  },
  { id: "app:runs", kind: "app", ref: "runs", title: "Runs", minimized: false },
];

function setup(
  over: Partial<DesktopActions> = {},
  props: Partial<React.ComponentProps<typeof Console>> = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false } } });
  qc.setQueryData(qk.providers, [
    {
      id: "claude",
      enabled: true,
      isDefault: true,
      health: { installed: true, ok: true, authenticated: true },
    },
  ]);
  qc.setQueryData(qk.skills, []);
  qc.setQueryData(qk.settings, { indexedFolders: [] });
  const onToggleDeck = vi.fn();
  const actions: DesktopActions = {
    runSkill: () => undefined,
    configureSkill: () => undefined,
    focusDeck: () => undefined,
    runningSkills: new Set<string>(),
    openPanels: PANELS,
    openDoc: () => undefined,
    openApp: () => undefined,
    openRun: () => undefined,
    openSkillForm: () => undefined,
    openPanel: () => undefined,
    referencePanel: () => undefined,
    ...over,
  };
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <DesktopActionsProvider value={actions}>
          <Console busy={false} deckOpen={false} onToggleDeck={onToggleDeck} stacked={false} {...props} />
        </DesktopActionsProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { onToggleDeck };
}

const input = () => screen.getByRole("textbox") as HTMLTextAreaElement;

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
});

describe("Console", () => {
  it("is a fixed plate, not a window, and lists every open panel in its tray", () => {
    setup();
    const plate = document.querySelector("section.cons")!;
    expect(plate.hasAttribute("data-console")).toBe(true);
    expect(plate.querySelector(".panel-head")).toBeNull();
    const chips = [...document.querySelectorAll(".cons-tray .chp")].map((c) => c.textContent);
    expect(chips.some((c) => c?.endsWith("@report.md"))).toBe(true);
    expect(chips.some((c) => c?.endsWith("@runs"))).toBe(true);
  });

  it("folds its context and controls behind one button", () => {
    setup();
    const toggle = screen.getByRole("button", { name: /Context and controls|Contexto e controles/ });
    const side = document.getElementById("cons-side")!;
    const wasOpen = !side.hidden;
    fireEvent.click(toggle);
    expect(side.hidden).toBe(wasOpen);
    expect(toggle.getAttribute("aria-expanded")).toBe(String(!wasOpen));
  });

  it("writes a chip's reference into the draft and lights the chip", () => {
    setup();
    const side = document.getElementById("cons-side")!;
    if (side.hidden)
      fireEvent.click(screen.getByRole("button", { name: /Context and controls|Contexto e controles/ }));
    fireEvent.click(screen.getByRole("button", { name: /@runs$/ }));
    expect(input().value).toBe("@runs ");
    expect(document.querySelector(".cons-tray .chp.on")?.textContent).toContain("@runs");
  });

  it("completes any open panel from a half-typed @", () => {
    setup();
    fireEvent.change(input(), { target: { value: "look at @rep", selectionStart: 12 } });
    // The folder picker has options of its own; the completion is the popover's.
    const options = () => document.querySelectorAll('.cons-ac [role="option"]');
    expect(options()).toHaveLength(1);
    expect(options()[0]!.textContent).toContain("@report.md");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(input().value).toBe("look at @report.md ");
    expect(options()).toHaveLength(0);
  });

  it("opens the deck on a lone slash and keeps the field empty", () => {
    const { onToggleDeck } = setup();
    fireEvent.change(input(), { target: { value: "/" } });
    expect(onToggleDeck).toHaveBeenCalledWith(true);
    expect(input().value).toBe("");
  });

  it("lights its frame while a run is in flight", () => {
    setup({}, { busy: true });
    expect(document.querySelector("section.cons")!.classList.contains("busy")).toBe(true);
  });
});
