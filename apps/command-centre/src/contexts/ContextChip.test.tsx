// @vitest-environment jsdom
/**
 * The chip above the composer (.specs/features/cerebro-contextos, C33; design.md "Tela - Chip no chat"), in the real
 * Console: "In this context: <name>" with an `X` ("Use the whole brain") that turns the context off for the machine,
 * a new run that carries `contextId`, and nothing at all without an active context. The network is `./testnet`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as ApiModule from "../api";
import { qk } from "../queries";
import { installPage } from "../ui/testkit";
import { DesktopActionsProvider, type DesktopActions } from "../desktop/actions";
import Console from "../desktop/console/Console";
import { CONTEXT, net, resetNet } from "./testnet";
import { renderWith } from "./testkit";

vi.mock("../api", async (importOriginal) =>
  (await import("./testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);

installPage();
beforeEach(() => {
  resetNet();
  sessionStorage.clear();
  localStorage.clear();
  net.answers.set("POST /api/runs", () =>
    Promise.resolve({ runId: "r-new", sessionId: "s-new", status: "running", pendingApproval: null }),
  );
});

const ACTIONS: DesktopActions = {
  runSkill: () => undefined,
  configureSkill: () => undefined,
  focusDeck: () => undefined,
  runningSkills: new Set<string>(),
  openPanels: [],
  openDoc: () => undefined,
  openApp: () => undefined,
  openRun: () => undefined,
  openSkillForm: () => undefined,
  openPanel: () => undefined,
  referencePanel: () => undefined,
};

function mountConsole(lang: "en" | "pt-BR" = "en") {
  const out = renderWith(
    <DesktopActionsProvider value={ACTIONS}>
      <Console busy={false} deckOpen={false} onToggleDeck={() => undefined} stacked />
    </DesktopActionsProvider>,
    { lang },
  );
  out.qc.setQueryData(qk.providers, [
    {
      id: "claude",
      enabled: true,
      isDefault: true,
      health: { installed: true, ok: true, authenticated: true },
    },
  ]);
  out.qc.setQueryData(qk.skills, []);
  return out;
}

const send = async (text: string) => {
  const field = screen.getByRole("textbox", {
    name: /Ask|Pergunte|Talk|Fale|prompt/i,
  }) as HTMLTextAreaElement;
  fireEvent.change(field, { target: { value: text } });
  fireEvent.keyDown(field, { key: "Enter" });
};
const runRequests = () => net.calls.filter((c) => c.method === "POST" && c.url === "/api/runs");

describe("C33 the chip of the active context in the composer", () => {
  it("C33 with a context active: the chip, and a run started from the composer carries contextId", async () => {
    net.contexts = [CONTEXT("cliente-x", "App do cliente X")];
    net.prefs.activeContext = "cliente-x";
    mountConsole();
    const chip = await screen.findByText("In this context: App do cliente X");
    expect(chip.closest(".ctx-chip")).not.toBeNull();
    // Above the field.
    const row = document.querySelector(".cons-row")!;
    expect(
      chip.closest(".ctx-chip")!.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await send("resuma o projeto");
    await waitFor(() => expect(runRequests()).toHaveLength(1));
    expect(runRequests()[0]!.body).toMatchObject({ prompt: "resuma o projeto", contextId: "cliente-x" });
  });

  it("C33 its X, Use the whole brain, sets activeContext to null and the chip goes; the next run carries no contextId", async () => {
    net.contexts = [CONTEXT("cliente-x", "App do cliente X")];
    net.prefs.activeContext = "cliente-x";
    mountConsole();
    await screen.findByText("In this context: App do cliente X");
    await userEvent.setup().click(screen.getByRole("button", { name: "Use the whole brain" }));
    await waitFor(() =>
      expect(net.calls).toContainEqual({
        method: "PUT",
        url: "/api/ui-preferences",
        body: { activeContext: null },
      }),
    );
    await waitFor(() => expect(document.querySelector(".ctx-chip")).toBeNull());
    await send("e agora?");
    await waitFor(() => expect(runRequests()).toHaveLength(1));
    expect(runRequests()[0]!.body).not.toHaveProperty("contextId");
  });

  it("C33 with no context active no chip is rendered, and the run carries no contextId", async () => {
    net.contexts = [CONTEXT("cliente-x", "App do cliente X")];
    mountConsole();
    await waitFor(() => expect(net.calls.some((c) => c.url === "/api/contexts")).toBe(true));
    expect(document.querySelector(".ctx-chip")).toBeNull();
    expect(screen.queryByText(/In this context/)).toBeNull();
    await send("oi");
    await waitFor(() => expect(runRequests()).toHaveLength(1));
    expect(runRequests()[0]!.body).not.toHaveProperty("contextId");
  });

  it("C33 the copy in pt-BR: Neste contexto: <nome> and Usar todo o cérebro", async () => {
    net.contexts = [CONTEXT("cliente-x", "App do cliente X")];
    net.prefs.activeContext = "cliente-x";
    mountConsole("pt-BR");
    expect(await screen.findByText("Neste contexto: App do cliente X")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Usar todo o cérebro" })).toBeTruthy();
  });
});
