// @vitest-environment jsdom
/**
 * Where "Revisões" opens from, and its keys (.specs/features/cerebro-natureza, C70, C71; plan.md amendment 10; design.md
 * binding `comandos-atalhos`): the graph's "Revisões (N)" as the fourth `.btn.sm` of its action row, the Núcleo scene
 * menu's last row, the palette's command in both shells and the `reviewDue` inbox row, each with N the `total` the kit
 * answers for the query of the active context only (L-052); and the registry's "Revisões" and `view:reviews` keys.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as ApiModule from "../../api";
import { installPage } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import { mountShell } from "../../commands/testkit";
import { CommandRegistry } from "../../commands/registry";
import { BrainChrome, type BrainChromeProps } from "../BrainChrome";
import { defaultUi } from "../state";
import { MEM, fileRow, net, note, resetNet, type Asked } from "../notes/testnet";
import { decided, item, list, mountReviews, resetReviews, reviews, sent } from "./testkit";

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
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.location.hash = "";
});

const before = (a: Element, b: Element) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const withContext = () => {
  net.contexts = [{ id: "proj-x", name: "Projeto X", paths: [{ path: MEM, state: "ok" }], files: 3 }];
  net.prefs.activeContext = "proj-x";
};
/** The count the kit answers: `n` for the active context's due query, 99 for any other (a dropped scope shows 99). */
function count(n: number) {
  list({ context: "proj-x" }, [], { total: n });
  reviews.wrong = { items: [], total: 99, nextDue: null };
}

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
const reviewsUp = () =>
  waitFor(() => expect(document.querySelector(".rv h1.rv-title")?.textContent).toBe("Revisões"), {
    timeout: 10_000,
  });

describe("C70 the entries, each in its place", () => {
  it("C70 the moldura's graph: Revisões (3) is the fourth .btn.sm of .brain-topbar-actions, after Atualizar índice, Modo apresentação (p) and Faxina, before the os-chips, with the context's total, and opens /brain/reviews", async () => {
    withContext();
    count(3);
    renderWith(<BrainChrome {...chrome()} />, { lang: "pt-BR" });
    const row = document.querySelector(".brain-topbar-actions")!;
    const names = () =>
      [...row.querySelectorAll("button.btn.sm")].map(
        (b) => b.getAttribute("aria-label") ?? b.textContent!.trim(),
      );
    await waitFor(() =>
      expect(names()).toEqual(["Atualizar índice", "Modo apresentação (p)", "Faxina", "Revisões (3)"]),
    );
    const buttons = [...row.querySelectorAll("button.btn.sm")];
    const chips = [...row.querySelectorAll(".os-chip")];
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) expect(before(buttons[3]!, chip)).toBe(true);
  });

  it("C70 the moldura's graph: no Revisões when the context's total is 0", async () => {
    withContext();
    count(0);
    renderWith(<BrainChrome {...chrome()} />, { lang: "pt-BR" });
    await waitFor(() =>
      expect(
        net.calls.some((c) => c.url.startsWith("/api/memory/reviews") && c.url.includes("context=proj-x")),
      ).toBe(true),
    );
    await new Promise((r) => setTimeout(r, 50));
    const names = [...document.querySelectorAll(".brain-topbar-actions button.btn.sm")].map(
      (b) => b.getAttribute("aria-label") ?? b.textContent!.trim(),
    );
    expect(names).toEqual(["Atualizar índice", "Modo apresentação (p)", "Faxina"]);
  });

  it("C70 the moldura's Revisões (3) opens the screen at /brain/reviews", async () => {
    withContext();
    count(3);
    await mountShell("/brain", "moldura", "pt-BR");
    const button = await screen.findByRole("button", { name: "Revisões (3)" }, { timeout: 10_000 });
    fireEvent.click(button);
    await reviewsUp();
    expect(window.location.hash).toBe("#/brain/reviews");
  });

  for (const n of [3, 0])
    it(`C70 the Núcleo's brain scene menu: ${n ? "Revisões (3) is the last row of bs-menu-acts, after Faxina, and opens the screen" : "no Revisões row with 0"}`, async () => {
      withContext();
      count(n);
      await scene();
      const more = await screen.findByRole("button", { name: "Mais" }, { timeout: 10_000 }).catch(() => null);
      fireEvent.click(more ?? document.querySelector(".bs-more")!);
      const acts = () => [...document.querySelectorAll(".bs-menu-acts > button")].map((b) => b.textContent);
      if (n === 0) {
        await waitFor(() => expect(acts().at(-1)).toBe("Faxina"));
        await new Promise((r) => setTimeout(r, 50));
        expect(acts().at(-1)).toBe("Faxina");
        expect(acts()).not.toContain("Revisões (99)");
        return;
      }
      await waitFor(() => expect(acts().at(-1)).toBe("Revisões (3)"));
      expect(acts().at(-2)).toBe("Faxina");
      fireEvent.click(screen.getByRole("button", { name: "Revisões (3)" }));
      await reviewsUp();
      expect(window.location.hash).toBe("#/brain/reviews");
    });

  for (const shell of ["moldura", "nucleo"] as const)
    it(`C70 the palette's Revisões opens /brain/reviews in the ${shell}`, async () => {
      if (shell === "nucleo") net.prefs.shell = "nucleo";
      const registry = new CommandRegistry();
      await mountShell("/", shell, "pt-BR", registry);
      const command = registry.list().find((c) => c.id === "action:reviews")!;
      act(() => command.run());
      await reviewsUp();
      expect(window.location.hash).toBe("#/brain/reviews");
      if (shell === "nucleo") expect(document.querySelector(".nu-shell .bs-notes .rv")).not.toBeNull();
    });

  it("C70 activating a reviewDue inbox row navigates to /brain/reviews", async () => {
    net.overrides.push((u: Asked) =>
      u.pathname === "/api/notifications"
        ? Promise.resolve({
            items: [
              {
                id: "n_review",
                kind: "system",
                title: "3 items to review",
                body: "Notes whose review date has passed are waiting in Reviews.",
                ts: Date.now(),
                read: false,
                href: "/brain/reviews",
                messageKey: "sentinel.reviewDue",
                messageParams: { count: 3, display: "3" },
                tone: "info",
              },
            ],
          })
        : undefined,
    );
    await mountShell("/", "moldura", "pt-BR");
    fireEvent.click(document.querySelector(".mold-bell")!);
    const rows = await screen.findAllByRole("button", { name: /3 itens para revisar/ });
    fireEvent.click(rows[0]!);
    await reviewsUp();
    expect(window.location.hash).toBe("#/brain/reviews");
  });
});

describe("C71 the commands and the keys", () => {
  it("C71 the registry holds Revisões (global, palette: true) and, in view:reviews, j, k, v and a", async () => {
    const registry = new CommandRegistry();
    await mountShell("/", "moldura", "pt-BR", registry);
    const global = registry.list().find((c) => c.id === "action:reviews")!;
    expect([global.title, global.scope, global.palette]).toEqual(["reviews.title", "global", true]);
    const { tf } = await import("../../i18n");
    expect(tf("pt-BR", global.title)).toBe("Revisões");
    cleanup();
    list({}, [item("notes/a.md", { natureza: "plano" }), item("notes/b.md")]);
    const mine = new CommandRegistry();
    mountReviews({ registry: mine });
    await screen.findByRole("list", { name: "Revisões" });
    const keys = mine
      .list()
      .filter((c) => c.scope === "view:reviews")
      .map((c) => [c.title, c.keys]);
    expect(keys).toEqual([
      ["reviews.cmd.next", ["j"]],
      ["reviews.cmd.prev", ["k"]],
      ["reviews.keep", ["v"]],
      ["reviews.snooze", ["a"]],
    ]);
  });

  it("C71 v acts on the selected item, a opens Adiar, and v typed in the fact dialog's field does not act", async () => {
    const a = item("notes/a.md", { natureza: "plano" });
    list({}, [a, item("notes/b.md")]);
    reviews.decide = (b) => Promise.resolve(decided((b as { path: string }).path, { version: "sha256:v2" }));
    mountReviews();
    await screen.findByRole("list", { name: "Revisões" });
    await waitFor(() => expect(document.querySelector(".rv-acts")).not.toBeNull());
    const user = userEvent.setup();
    await user.keyboard("a");
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(4);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await user.click(screen.getByRole("button", { name: "Virou realidade" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Registrar como fato" }));
    const field = within(dialog).getByLabelText("O quê");
    await user.type(field, "v");
    expect((field as HTMLInputElement).value).toBe("v");
    expect(sent("POST", "/api/memory/reviews")).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("v");
    await waitFor(() => expect(sent("POST", "/api/memory/reviews")).toHaveLength(1));
    expect(sent("POST", "/api/memory/reviews")[0]).toMatchObject({ path: a.path, action: "keep" });
  });
});
