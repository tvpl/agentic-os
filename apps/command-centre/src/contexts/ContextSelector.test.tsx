// @vitest-environment jsdom
/**
 * The work-context selector (.specs/features/cerebro-contextos, C31, C37, C38; design.md "Tela - Seletor de
 * contexto"): what its menu lists and in which order, its empty, loading and failed states, and what the screens do
 * when the active context is gone. The network is `./testnet`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as ApiModule from "../api";
import { installPage, tick } from "../ui/testkit";
import { Sidebar } from "../moldura/Sidebar";
import { NAV_GROUPS } from "../moldura/nav";
import { ContextSelector } from "./ContextSelector";
import { graphRequest } from "../brain/memoryData";
import { useWorkContext } from "./useWorkContext";
import { CONTEXT, net, resetNet } from "./testnet";
import { renderWith } from "./testkit";

vi.mock("../api", async (importOriginal) =>
  (await import("./testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);

installPage();
beforeEach(() => resetNet());

const openMenu = async (name: RegExp | string) => {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name }));
  await tick();
  return screen.getByRole("menu");
};
const rows = () =>
  [...document.querySelectorAll('[role="menu"] > *')].map((el) => ({
    role: el.getAttribute("role"),
    text: el.textContent ?? "",
    checked: el.getAttribute("aria-checked"),
  }));

describe("C31 the selector lists the whole brain first, then each context, and the two actions", () => {
  it("C31 Whole brain, a separator, the contexts in settings order with their file counts and the active one checked, then New context… and Manage contexts", async () => {
    net.contexts = [
      CONTEXT("zeta", "Zeta do cliente", { files: 1240 }),
      CONTEXT("alfa", "Alfa", { files: 7, paths: [{ path: "/work/alfa", state: "missing" }] }),
    ];
    net.prefs.activeContext = "zeta";
    renderWith(<ContextSelector variant="frame" />);
    // The button names the active context and its count.
    const button = await screen.findByRole("button", { name: /Zeta do cliente/ });
    expect(button.textContent).toContain("1,240 files");
    // The button draws the Crosshair, the name and the count: no other mark (design.md, the selector).
    expect(button.querySelectorAll("svg")).toHaveLength(1);
    await openMenu(/Zeta do cliente/);
    const list = rows();
    expect(list.map((r) => r.role)).toEqual([
      "menuitemcheckbox",
      "separator",
      "menuitemcheckbox",
      "menuitemcheckbox",
      "separator",
      "menuitem",
      "menuitem",
      "menuitem",
    ]);
    expect(list[0]!.text).toBe("Whole brain");
    expect(list[0]!.checked).toBe("false");
    // The order of settings.contexts, not the alphabet.
    expect(list[2]!.text).toContain("Zeta do cliente");
    expect(list[2]!.text).toContain("1,240 files");
    expect(list[2]!.checked).toBe("true");
    expect(list[3]!.text).toContain("Alfa");
    expect(list[3]!.text).toContain("7 files");
    expect(list[3]!.checked).toBe("false");
    // A context with a path that is not ok says so in text, with its icon.
    expect(list[3]!.text).toContain("Folder needs attention");
    expect(list[2]!.text).not.toContain("Folder needs attention");
    // With a context active, the guided cleanup of it opens the actions (cerebro-faxina-guiada, amendment 11).
    expect(list[5]!.text).toBe("Clean up this context");
    expect(list[6]!.text).toBe("New context…");
    expect(list[7]!.text).toBe("Manage contexts");
  });

  it("C31 with no context active, Whole brain is the checked one and names the button, with the index's file count", async () => {
    net.contexts = [CONTEXT("alfa", "Alfa")];
    net.total = 980;
    renderWith(<ContextSelector variant="frame" />);
    const button = await screen.findByRole("button", { name: /Whole brain/ });
    await waitFor(() => expect(button.textContent).toContain("980 files"));
    await openMenu(/Whole brain/);
    expect(screen.getByRole("menuitemcheckbox", { name: "Whole brain" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByRole("menuitemcheckbox", { name: /Alfa/ }).getAttribute("aria-checked")).toBe("false");
  });

  it("C31 the copy in pt-BR: Todo o cérebro, Novo contexto… and Gerenciar contextos", async () => {
    net.contexts = [CONTEXT("alfa", "Alfa", { files: 2 })];
    renderWith(<ContextSelector variant="nucleo" />, { lang: "pt-BR" });
    await openMenu(/Todo o cérebro/);
    const text = rows().map((r) => r.text);
    expect(text[0]).toBe("Todo o cérebro");
    expect(text[2]).toContain("2 arquivos");
    expect(text).toContain("Novo contexto…");
    expect(text).toContain("Gerenciar contextos");
  });

  it("C31 in the frame it sits between the brand and the main group; folded, only its icon, named by the context", async () => {
    net.contexts = [CONTEXT("alfa", "Alfa")];
    net.prefs.activeContext = "alfa";
    const props = {
      name: "Mordomo",
      current: NAV_GROUPS.main[0]!,
      overlay: false,
      pending: 0,
      onToggle: () => undefined,
      onFold: () => undefined,
    };
    const { rerender } = renderWith(<Sidebar {...props} collapsed={false} />);
    const brand = document.querySelector(".mold-brand")!;
    await waitFor(() => expect(brand.nextElementSibling?.textContent).toContain("Alfa"));
    expect(brand.nextElementSibling!.classList.contains("ctx-sel")).toBe(true);
    // The main group comes after it.
    expect(brand.nextElementSibling!.nextElementSibling!.classList.contains("mold-list")).toBe(true);
    rerender(<Sidebar {...props} collapsed />);
    const folded = document.querySelector(".mold-brand")!.nextElementSibling as HTMLElement;
    expect(folded.getAttribute("aria-label")).toBe("Alfa");
    expect(folded.querySelector(".ctx-sel-text")).toBeNull();
  });

  it("C31 choosing a context writes activeContext by PUT /api/ui-preferences", async () => {
    net.contexts = [CONTEXT("alfa", "Alfa")];
    renderWith(<ContextSelector variant="frame" />);
    await openMenu(/Whole brain/);
    await userEvent.setup().click(screen.getByRole("menuitemcheckbox", { name: /Alfa/ }));
    await waitFor(() =>
      expect(net.calls).toContainEqual({
        method: "PUT",
        url: "/api/ui-preferences",
        body: { activeContext: "alfa" },
      }),
    );
    expect(await screen.findByRole("button", { name: /Alfa/ })).toBeTruthy();
  });
});

describe("C37 the selector's empty, loading and failed states", () => {
  it("C37 with no context: Whole brain and the line that invites to make one, above New context…", async () => {
    renderWith(<ContextSelector variant="frame" />);
    await openMenu(/Whole brain/);
    const list = rows();
    expect(list[0]!.text).toBe("Whole brain");
    const line = list.findIndex((r) => r.text === "Create a context to focus the brain on a project.");
    expect(line).toBeGreaterThan(0);
    expect(list.findIndex((r) => r.text === "New context…")).toBeGreaterThan(line);
    // The line is text, not an action.
    expect(list[line]!.role).toBeNull();
  });

  it("C37 while the list loads: a spinner with Loading…", async () => {
    net.list = "pending";
    renderWith(<ContextSelector variant="frame" />);
    await openMenu(/Whole brain/);
    const loading = rows().find((r) => r.text === "Loading…");
    expect(loading).toBeDefined();
    expect(document.querySelector('[role="menu"] .spinner')).not.toBeNull();
    expect(screen.queryAllByRole("menuitemcheckbox")).toHaveLength(1);
  });

  it("C37 when it fails: the error and Try again, which asks again (and in pt-BR, Tentar de novo)", async () => {
    net.list = "fail";
    renderWith(<ContextSelector variant="frame" />);
    await openMenu(/Whole brain/);
    await waitFor(() => expect(rows().some((r) => r.text === "The service did not answer.")).toBe(true));
    const asked = () => net.calls.filter((c) => c.method === "GET" && c.url === "/api/contexts").length;
    const before = asked();
    net.list = "answer";
    net.contexts = [CONTEXT("alfa", "Alfa")];
    await userEvent.setup().click(screen.getByRole("menuitem", { name: "Try again" }));
    await waitFor(() => expect(asked()).toBe(before + 1));
    // The menu stays open and now lists the context.
    expect(await screen.findByRole("menuitemcheckbox", { name: /Alfa/ })).toBeTruthy();
  });

  it("C37 Tentar de novo and Carregando… in pt-BR", async () => {
    net.list = "fail";
    const { unmount } = renderWith(<ContextSelector variant="frame" />, { lang: "pt-BR" });
    await openMenu(/Todo o cérebro/);
    expect(await screen.findByRole("menuitem", { name: "Tentar de novo" })).toBeTruthy();
    unmount();
    net.list = "pending";
    renderWith(<ContextSelector variant="frame" />, { lang: "pt-BR" });
    await openMenu(/Todo o cérebro/);
    expect(rows().some((r) => r.text === "Carregando…")).toBe(true);
  });
});

/** What a screen sends: the graph it asks for and the context of its reads. */
function Probe() {
  const work = useWorkContext();
  const graph = graphRequest(3000, work.query);
  return (
    <output data-testid="probe" data-ready={String(work.ready)}>
      {graph.path}
    </output>
  );
}

describe("C38 the active context no longer exists", () => {
  it("C38 the screens use Whole brain, send no context, and the notice says so once", async () => {
    net.contexts = [CONTEXT("alfa", "Alfa")];
    net.prefs.activeContext = "apagado";
    const { rerender } = renderWith(
      <>
        <ContextSelector variant="frame" />
        <Probe />
      </>,
    );
    const notice = await screen.findByText("The active context no longer exists.");
    expect(notice).toBeTruthy();
    expect(await screen.findByRole("button", { name: /Whole brain/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("probe").dataset.ready).toBe("true"));
    expect(screen.getByTestId("probe").textContent).toBe("/api/memory/graph?maxNodes=3000");
    // It is set back to the whole brain for the machine, so the notice does not come back.
    await waitFor(() =>
      expect(net.calls).toContainEqual({
        method: "PUT",
        url: "/api/ui-preferences",
        body: { activeContext: null },
      }),
    );
    rerender(
      <>
        <ContextSelector variant="frame" />
        <Probe />
      </>,
    );
    await tick(50);
    expect(screen.getAllByText("The active context no longer exists.")).toHaveLength(1);
    // No read went out with the context that is gone.
    expect(net.calls.some((c) => c.url.includes("context=apagado"))).toBe(false);
  });

  it("C38 a context that is listed is sent, and none is judged gone while the list is still on its way", async () => {
    net.contexts = [CONTEXT("alfa", "Alfa")];
    net.prefs.activeContext = "alfa";
    renderWith(<Probe />);
    await waitFor(() =>
      expect(screen.getByTestId("probe").textContent).toBe("/api/memory/graph?maxNodes=3000&context=alfa"),
    );
    resetNet();
    net.list = "pending";
    net.prefs.activeContext = "alfa";
    renderWith(
      <>
        <ContextSelector variant="frame" />
      </>,
    );
    await tick(50);
    expect(screen.queryByText("The active context no longer exists.")).toBeNull();
  });
});

describe("C53 the frame selector's file count sits below the name", () => {
  it("C53 in the frame the name comes first and the count after it, in the button's text column; the Núcleo shows the name only", async () => {
    net.contexts = [CONTEXT("zeta", "Zeta do cliente", { files: 1240 })];
    net.prefs.activeContext = "zeta";
    const { unmount } = renderWith(<ContextSelector variant="frame" />);
    const button = await screen.findByRole("button", { name: /Zeta do cliente/ });
    const column = button.querySelector(".ctx-sel-text")!;
    expect([...column.children].map((el) => [el.className, el.textContent])).toEqual([
      ["ctx-sel-name", "Zeta do cliente"],
      ["ctx-sel-count", "1,240 files"],
    ]);
    unmount();
    renderWith(<ContextSelector variant="nucleo" />);
    const compact = await screen.findByRole("button", { name: /Zeta do cliente/ });
    expect(compact.querySelector(".ctx-sel-count")).toBeNull();
  });
});
