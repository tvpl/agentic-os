// @vitest-environment jsdom
process.env.TZ = "America/Sao_Paulo";
/**
 * Where "Revisão semanal" opens from, and its keys (.specs/features/cerebro-rituais, C76, C77; G17, G18; design.md
 * "Entradas" and binding `comandos-atalhos`): the graph's `.btn.sm` right after "Revisões (N)" (or after "Faxina" with
 * none) with `Check` and "Concluída em 12/11" once the week is finished, the Núcleo scene menu's last row, the palette's
 * command in both shells and the `weeklyReview` inbox row; the registry's command and the `view:weekly` keys, which a
 * field keeps as letters. The list is answered only for the query the screen sends (L-052).
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
import { fileRow, note, resetNet } from "../notes/testnet";
import { list as reviewsList, resetReviews, reviews } from "../reviews/testkit";
import {
  MEM,
  answer,
  button,
  itemWith,
  itemsOn,
  loop,
  mountWeekly,
  net,
  on,
  only,
  project,
  resetWeekly,
  sent,
  weekly,
} from "./testkit";
import type { Asked } from "../notes/testnet";

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
/** "Revisões (n)": `n` for the active context's due query, 99 for any other. */
function due(n: number) {
  reviewsList({ context: "proj-x" }, [], { total: n });
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
const weeklyUp = () =>
  waitFor(() => expect(document.querySelector(".wk h1.wk-h1")?.textContent).toBe("Revisão semanal"), {
    timeout: 10_000,
  });
const rowNames = () =>
  [...document.querySelectorAll(".brain-topbar-actions button.btn.sm")].map(
    (b) => b.getAttribute("aria-label") ?? b.textContent!.trim(),
  );

describe("C76 the entries, each in its place", () => {
  it("C76 the moldura's graph: Revisão semanal (CalendarCheck) is the .btn.sm right after Revisões (3), before the os-chips", async () => {
    withContext();
    due(3);
    answer(weekly(), { context: "proj-x" });
    renderWith(<BrainChrome {...chrome()} />, { lang: "pt-BR" });
    await waitFor(() =>
      expect(rowNames()).toEqual([
        "Atualizar índice",
        "Modo apresentação (p)",
        "Faxina",
        "Revisões (3)",
        "Revisão semanal",
      ]),
    );
    const row = document.querySelector(".brain-topbar-actions")!;
    const buttons = [...row.querySelectorAll("button.btn.sm")];
    const weeklyButton = buttons[4]!;
    expect(weeklyButton.querySelector("svg.lucide-calendar-check")).not.toBeNull();
    expect(weeklyButton.getAttribute("title")).toBeNull();
    const chips = [...row.querySelectorAll(".os-chip")];
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) expect(before(weeklyButton, chip)).toBe(true);
  });

  it("C76 the moldura's graph with Revisões absent (N = 0): Revisão semanal is right after Faxina", async () => {
    withContext();
    due(0);
    answer(weekly(), { context: "proj-x" });
    renderWith(<BrainChrome {...chrome()} />, { lang: "pt-BR" });
    await waitFor(() =>
      expect(
        net.calls.some((c) => c.url.startsWith("/api/memory/reviews") && c.url.includes("context=proj-x")),
      ).toBe(true),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(rowNames()).toEqual(["Atualizar índice", "Modo apresentação (p)", "Faxina", "Revisão semanal"]);
  });

  it("C76 with the week finished (12/11) the button's icon is Check and its title Concluída em 12/11", async () => {
    // 2026-11-13T01:30Z is 12/11 22:30 in São Paulo.
    const finishedAt = Date.UTC(2026, 10, 13, 1, 30);
    expect(new Date(finishedAt).getDate()).toBe(12);
    answer(weekly({ finishedAt }));
    renderWith(<BrainChrome {...chrome()} />, { lang: "pt-BR" });
    const b = await waitFor(() => {
      const el = [...document.querySelectorAll(".brain-topbar-actions button.btn.sm")].at(-1)!;
      expect(el.getAttribute("title")).toBe("Concluída em 12/11");
      return el;
    });
    expect(b.textContent!.trim()).toBe("Revisão semanal");
    expect(b.querySelector("svg.lucide-check")).not.toBeNull();
    expect(b.querySelector("svg.lucide-calendar-check")).toBeNull();
  });

  it("C76 the moldura's Revisão semanal opens the page at /brain/weekly", async () => {
    answer(weekly());
    await mountShell("/brain", "moldura", "pt-BR");
    const b = await screen.findByRole("button", { name: "Revisão semanal" }, { timeout: 10_000 });
    fireEvent.click(b);
    await weeklyUp();
    expect(window.location.hash).toBe("#/brain/weekly");
  });

  for (const n of [3, 0])
    it(`C76 the Núcleo's brain scene menu: Revisão semanal is the last row of bs-menu-acts, after ${n ? "Revisões (3)" : "Faxina with N = 0"}, and opens the page`, async () => {
      withContext();
      due(n);
      answer(weekly(), { context: "proj-x" });
      await scene();
      const more = await screen.findByRole("button", { name: "Mais" }, { timeout: 10_000 }).catch(() => null);
      fireEvent.click(more ?? document.querySelector(".bs-more")!);
      const acts = () => [...document.querySelectorAll(".bs-menu-acts > button")].map((b) => b.textContent);
      await waitFor(() => expect(acts().at(-1)).toBe("Revisão semanal"));
      if (n) await waitFor(() => expect(acts().at(-2)).toBe("Revisões (3)"));
      else {
        await new Promise((r) => setTimeout(r, 50));
        expect(acts().at(-2)).toBe("Faxina");
      }
      fireEvent.click(screen.getByRole("button", { name: "Revisão semanal" }));
      await weeklyUp();
      expect(window.location.hash).toBe("#/brain/weekly");
    });

  for (const shell of ["moldura", "nucleo"] as const)
    it(`C76 the palette's Revisão semanal opens /brain/weekly in the ${shell}`, async () => {
      if (shell === "nucleo") net.prefs.shell = "nucleo";
      answer(weekly());
      const registry = new CommandRegistry();
      await mountShell("/", shell, "pt-BR", registry);
      const command = registry.list().find((c) => c.id === "action:weekly-review")!;
      act(() => command.run());
      await weeklyUp();
      expect(window.location.hash).toBe("#/brain/weekly");
      if (shell === "nucleo") expect(document.querySelector(".nu-shell .bs-notes .wk")).not.toBeNull();
    });

  it("C76 activating a weeklyReview inbox row navigates to /brain/weekly", async () => {
    answer(weekly());
    net.overrides.push((u: Asked) =>
      u.pathname === "/api/notifications"
        ? Promise.resolve({
            items: [
              {
                id: "n_weekly",
                kind: "system",
                title: "Time for the weekly review",
                body: "3 open loops, 2 projects to review.",
                ts: Date.now(),
                read: false,
                href: "/brain/weekly",
                messageKey: "sentinel.weeklyReview",
                messageParams: { loops: 3, projects: 2 },
                tone: "info",
              },
            ],
          })
        : undefined,
    );
    await mountShell("/", "moldura", "pt-BR");
    fireEvent.click(document.querySelector(".mold-bell")!);
    const rows = await screen.findAllByRole("button", { name: /weekly review/i });
    fireEvent.click(rows[0]!);
    await weeklyUp();
    expect(window.location.hash).toBe("#/brain/weekly");
  });
});

describe("C77 the command and the keys", () => {
  it("C77 the registry holds Revisão semanal (global, palette: true) and, in view:weekly, j, k, f, m and r", async () => {
    const registry = new CommandRegistry();
    await mountShell("/", "moldura", "pt-BR", registry);
    const global = registry.list().find((c) => c.id === "action:weekly-review")!;
    expect([global.title, global.scope, global.palette]).toEqual(["weekly.title", "global", true]);
    const { tf } = await import("../../i18n");
    expect(tf("pt-BR", global.title)).toBe("Revisão semanal");
    expect(tf("en", global.title)).toBe("Weekly review");
    cleanup();
    answer(weekly({ loopItems: [loop("Ligar para a Ana")] }));
    const mine = new CommandRegistry();
    mountWeekly({ registry: mine });
    await waitFor(() => expect(itemsOn()).toHaveLength(1));
    const keys = mine
      .list()
      .filter((c) => c.scope === "view:weekly")
      .map((c) => [c.title, c.keys]);
    expect(keys).toEqual([
      ["reviews.cmd.next", ["j"]],
      ["reviews.cmd.prev", ["k"]],
      ["weekly.close", ["f"]],
      ["weekly.keep", ["m"]],
      ["weekly.reviewed", ["r"]],
    ]);
    expect(keys.map(([t]) => tf("pt-BR", t as never))).toEqual([
      "Próximo item",
      "Item anterior",
      "Fechar",
      "Manter",
      "Revisado",
    ]);
  });

  it("C77 j and k move the selection; f closes the selected loop and m keeps it", async () => {
    const a = loop("Ligar para a Ana");
    const b = loop("Pagar o boleto");
    const c = loop("Revisar contrato");
    answer(weekly({ loopItems: [a, b, c] }));
    on("loops", (body) => {
      const k = (body as { key: string; action: string }).key;
      const action = (body as { action: string }).action;
      return only(
        { key: k, action },
        { key: k, state: action === "close" ? "closed" : action, previous: null },
      )(body);
    });
    mountWeekly();
    await waitFor(() => expect(itemsOn()).toHaveLength(3));
    const user = userEvent.setup();
    await user.keyboard("j");
    await waitFor(() => expect(document.activeElement).toBe(itemWith("Pagar o boleto")));
    expect(itemWith("Pagar o boleto").getAttribute("aria-current")).toBe("true");
    await user.keyboard("k");
    await waitFor(() => expect(document.activeElement).toBe(itemWith("Ligar para a Ana")));
    await user.keyboard("j");
    await user.keyboard("f");
    await waitFor(() => expect(sent("loops")).toEqual([{ key: b.key, action: "close" }]));
    await waitFor(() => expect(itemWith("Revisar contrato").getAttribute("aria-current")).toBe("true"));
    await user.keyboard("m");
    await waitFor(() =>
      expect(sent("loops")).toEqual([
        { key: b.key, action: "close" },
        { key: c.key, action: "keep" },
      ]),
    );
  });

  it("C77 r marks the selected project Revisado", async () => {
    const app = project("App");
    answer(weekly({ projectItems: [app, project("Site")] }));
    const body = { path: app.path, action: "keep", baseVersion: "sha256:app" };
    on("reviews", only(body, { path: app.path, state: null, previous: null, version: "sha256:app2" }));
    mountWeekly();
    await waitFor(() => expect(document.querySelector(".wk-empty")).not.toBeNull());
    fireEvent.click([...document.querySelectorAll<HTMLButtonElement>(".wk-steps button")][1]!);
    await waitFor(() => expect(itemsOn()).toHaveLength(2));
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.setup().keyboard("r");
    await waitFor(() => expect(sent("reviews")).toEqual([body]));
  });

  it("C77 f typed in the Próxima ação field and in the Virar projeto name field does not act and sends no request", async () => {
    const a = loop("Ligar para a Ana");
    answer(weekly({ loopItems: [a], projectItems: [project("App")] }));
    mountWeekly();
    await waitFor(() => expect(itemsOn()).toHaveLength(1));
    const user = userEvent.setup();
    const li = itemWith("Ligar para a Ana");
    await user.click(button(li, "Virar projeto"));
    const name = within(li).getByRole("textbox", { name: "Virar projeto" }) as HTMLInputElement;
    await user.click(name);
    await user.keyboard("{End}f");
    expect(name.value).toBe("Ligar para a Anaf");
    fireEvent.click([...document.querySelectorAll<HTMLButtonElement>(".wk-steps button")][1]!);
    await waitFor(() => expect(itemWith("App")).toBeDefined());
    const field = within(itemWith("App")).getByPlaceholderText(
      "O que é o próximo passo concreto?",
    ) as HTMLInputElement;
    await user.click(field);
    await user.keyboard("f");
    expect(field.value).toBe("f");
    await new Promise((r) => setTimeout(r, 50));
    expect(net.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });
});
