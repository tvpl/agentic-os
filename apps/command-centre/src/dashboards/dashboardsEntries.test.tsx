// @vitest-environment jsdom
/**
 * Where the dashboards are reached and how they are laid out (.specs/features/cerebro-paineis, C81, C82, C89, C90;
 * plan.md amendment 25; design.md "Página", "Cena" and "Tela Hoje"): the moldura's main group, the Núcleo's sixth
 * scene, the two palette commands, the same snapshot and selector in both shells, Today's link and its six cards, the
 * scene's composition, and the page's body on its 12-column grid.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import postcss from "postcss";
import type * as ApiModule from "../api";
import { installPage } from "../ui/testkit";
import { mountShell } from "../commands/testkit";
import { CommandRegistry } from "../commands/registry";
import { tf } from "../i18n";
import { NAV_GROUPS } from "../moldura/nav";
import { MAIN_SCENES } from "../nucleo/scenes";
import { NetError, net } from "../brain/notes/testnet";
import { dash, resetDash } from "./testnet";
import { cardIds, definition, mountBoard, ok, read, serve, snapshot, w } from "./testkit";

vi.mock("../api", async (importOriginal) =>
  (await import("./testnet")).dashMockApi(await importOriginal<typeof ApiModule>()),
);
vi.setConfig({ testTimeout: 60_000 });

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
  resetDash();
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

const CSS = postcss.parse(readFileSync(join(__dirname, "dashboards.css"), "utf8"));
/** A declaration of a rule at the top of the sheet (not inside a media query). */
const decl = (selector: string, prop: string) => {
  let v = "";
  CSS.walkRules(selector, (r) => {
    if (r.parent?.type === "root") r.walkDecls(prop, (d) => void (v = d.value));
  });
  return v;
};
const before = (a: Element, b: Element) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

const kpis = [1, 2, 3, 4, 5, 6].map((i) =>
  w(`k${i}`, "kpi", { kind: "notes" }, { measure: "count" }, `KPI ${i}`),
);
const cards = [
  w("s", "list", { kind: "notes" }, { size: "s" }, "Pequeno"),
  w("m", "list", { kind: "projects" }, { size: "m" }, "Médio"),
  w("l", "list", { kind: "runs" }, { size: "l" }, "Grande"),
  w("x", "list", { kind: "facts" }, { size: "xl" }, "Inteiro"),
];
const overview = definition("overview", [...kpis, ...cards]);
const snap = snapshot("visao-geral", [
  ...kpis.map((k) => ok(k.id, "kpi", { value: 1, series: [] })),
  ok("s", "list", { items: [{ title: "Uma nota" }], total: 1 }),
  ok("m", "list", { items: [{ title: "Um projeto", health: "on_track" }], total: 1 }),
  ok("l", "list", { items: [{ id: "r", skill: "brief", state: "running" }], total: 1 }),
  ok("x", "list", { items: [{ subject: "a", predicate: "é", object: "b" }], total: 1 }),
]);
const H = [{ rule: "due_today" as const, title: "Ligar", tone: "warn" as const, target: "/brain?sel=6" }];
const area = definition("area", [], { title: "Projeto X" });
const serveTwo = () => {
  serve("visao-geral", read(overview, snap, { highlights: H }));
  serve("contexto-x", read(area, null));
};

describe("C81 the entries", () => {
  it("C81 the moldura's main group is Hoje, Painéis, then the items of before in their order", () => {
    expect(NAV_GROUPS.main.map((n) => n.id)).toEqual([
      "today",
      "dashboards",
      "runs",
      "skills",
      "routines",
      "brain",
    ]);
    expect(NAV_GROUPS.main[1]!.to).toBe("/dashboards");
    expect(tf("pt-BR", NAV_GROUPS.main[1]!.labelKey)).toBe("Painéis");
  });

  it("C81 MAIN_SCENES are the six, and the sixth (key 6) is /dashboards", () => {
    expect(MAIN_SCENES.map((s) => s.id)).toEqual([
      "nucleo",
      "brain",
      "runs",
      "skills",
      "routines",
      "dashboards",
    ]);
    expect(MAIN_SCENES[5]!.path).toBe("/dashboards");
  });

  for (const shell of ["moldura", "nucleo"] as const)
    it(`C81 the palette in the ${shell}: Abrir painéis everywhere, Atualizar painel only with a dashboard on screen, both apart from action:open-panel`, async () => {
      if (shell === "nucleo") net.prefs.shell = "nucleo";
      serveTwo();
      const registry = new CommandRegistry();
      await mountShell("/", shell, "pt-BR", registry);
      const open = () => registry.list().find((c) => c.id === "action:dashboards");
      const refresh = () => registry.list().find((c) => c.id === "action:dashboard-refresh");
      await waitFor(() => expect(open()).toBeTruthy());
      expect([open()!.scope, open()!.palette, open()!.when, tf("pt-BR", open()!.title)]).toEqual([
        "global",
        true,
        undefined,
        "Abrir painéis",
      ]);
      expect(refresh()).toBeUndefined();
      const panel = registry.list().find((c) => c.id === "action:open-panel")!;
      expect(tf("pt-BR", panel.title)).not.toBe("Abrir painéis");
      act(() => open()!.run());
      await waitFor(() => expect(window.location.hash).toBe("#/dashboards"));
      await screen.findByText("Uma nota", undefined, { timeout: 20_000 });
      await waitFor(() => expect(refresh()).toBeTruthy());
      expect([refresh()!.scope, refresh()!.palette, tf("pt-BR", refresh()!.title)]).toEqual([
        "global",
        true,
        "Atualizar painel",
      ]);
      expect(refresh()!.id).not.toBe(panel.id);
    });

  // After round 3: "only while a dashboard is on screen" also holds on the page with no dashboard (a device that may not
  // see dashboards answers 403, and the page shows no board).
  for (const shell of ["moldura", "nucleo"] as const)
    it(`C81 the palette in the ${shell} on the page with no dashboard (403): Abrir painéis is there, Atualizar painel is not`, async () => {
      if (shell === "nucleo") net.prefs.shell = "nucleo";
      dash.list = new NetError(403, "scope_required", "This device needs the content scope");
      const registry = new CommandRegistry();
      await mountShell("/dashboards", shell, "pt-BR", registry);
      await screen.findByText("Este dispositivo não tem permissão para ver painéis.", undefined, {
        timeout: 20_000,
      });
      const ids = () => registry.list().map((c) => c.id);
      await waitFor(() => expect(ids()).toContain("action:dashboards"));
      expect(ids()).not.toContain("action:dashboard-refresh");
    });

  it("C81 both shells show the same snapshot and the same selector entries", async () => {
    const read = async (shell: "moldura" | "nucleo") => {
      resetDash();
      net.prefs.shell = shell;
      serveTwo();
      await mountShell("/dashboards", shell, "pt-BR");
      await screen.findByText("Uma nota", undefined, { timeout: 20_000 });
      const widgets = [...document.querySelectorAll<HTMLElement>(".dsh-kpi, .dsh-card")].map(
        (e) => e.dataset.widget,
      );
      const trigger = document.querySelector(shell === "moldura" ? ".dsh-pick" : ".dsn-menu")!;
      fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
      const menu = await screen.findByRole("menu");
      const entries = [...menu.querySelectorAll('[role="menuitemcheckbox"]')].map((e) => e.textContent);
      const extra = within(menu).getByRole("menuitem", { name: "Novo painel…" });
      cleanup();
      window.location.hash = "";
      return { widgets, entries, hasNew: Boolean(extra) };
    };
    const frame = await read("moldura");
    const nucleo = await read("nucleo");
    // The sixth KPI is a tile on the grid (round 1 of the verification, minor: never dropped).
    expect(frame.widgets).toEqual(["k1", "k2", "k3", "k4", "k5", "k6", "s", "m", "l", "x"]);
    expect(nucleo).toEqual(frame);
    expect(frame.entries).toEqual(["Visão geral", "Projeto X"]);
  });
});

describe("C82 Today's link", () => {
  it("C82 with an overview listed: Ver a visão geral → after the date, to /dashboards/visao-geral; the six cards as before", async () => {
    serveTwo();
    await mountShell("/", "moldura", "pt-BR");
    const link = await screen.findByRole("link", { name: "Ver a visão geral →" }, { timeout: 20_000 });
    expect(link.getAttribute("href")).toBe("#/dashboards/visao-geral");
    expect(before(document.querySelector(".mold-today-date")!, link)).toBe(true);
    expect(link.closest(".mold-today-h")).not.toBeNull();
    const six = [...document.querySelectorAll<HTMLElement>(".mold-cards > .mold-card")].map(
      (c) => c.dataset.widget,
    );
    expect(six).toEqual(["approvals", "now", "routines", "inbox", "journal", "cost"]);
  });

  it("C82 with no overview, no link, and the six cards the same", async () => {
    serve("contexto-x", read(area, null));
    await mountShell("/", "moldura", "pt-BR");
    await waitFor(() => expect(net.calls.some((c) => c.url === "/api/dashboards")).toBe(true), {
      timeout: 20_000,
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("link", { name: "Ver a visão geral →" })).toBeNull();
    const six = [...document.querySelectorAll<HTMLElement>(".mold-cards > .mold-card")].map(
      (c) => c.dataset.widget,
    );
    expect(six).toEqual(["approvals", "now", "routines", "inbox", "journal", "cost"]);
    expect(dash.unexpected).toEqual([]);
  });
});

describe("C89 the Núcleo's scene", () => {
  it("C89 the header as the voice line, then the highlights row and the KPI strip at the top (amendment 31), the cards lâminas in order in two columns, the selector in the scene's menu", async () => {
    net.prefs.shell = "nucleo";
    serveTwo();
    await mountShell("/dashboards", "nucleo", "pt-BR");
    await screen.findByText("Uma nota", undefined, { timeout: 20_000 });
    const scene = document.querySelector(".nu-scene-app .dsn")!;
    expect(scene).not.toBeNull();
    const parts = [...scene.children].map(
      (c) => c.className.split(" ").find((k) => k.startsWith("dsn-")) ?? c.className,
    );
    // Amendment 31 (round 1, finding 3): the voice line, then the highlights row, then the KPI strip.
    expect(parts.indexOf("dsn-voice")).toBe(0);
    expect(parts.indexOf("dsh-highlights")).toBe(1);
    expect(parts.indexOf("dsn-kpis")).toBe(2);
    expect(parts.indexOf("dsn-laminas")).toBeGreaterThan(2);
    const voice = scene.querySelector(".dsn-voice")!;
    expect(voice.querySelector(".dsh-title")!.textContent).toMatch(/^(Bom dia|Boa tarde|Boa noite)$/);
    expect(voice.querySelector(".dsh-when")!.textContent).toMatch(/^Atualizado às \d\d:\d\d$/);
    expect(scene.querySelectorAll(".dsn-kpis > .dsh-kpi")).toHaveLength(5);
    expect(
      [...scene.querySelectorAll<HTMLElement>(".dsn-laminas > .dsh-card")].map((c) => c.dataset.widget),
    ).toEqual(["s", "m", "l", "x"]);
    expect(
      [...scene.querySelectorAll<HTMLElement>(".dsn-laminas > [data-widget]")].map((c) => c.dataset.widget),
    ).toEqual(["k6", "s", "m", "l", "x"]);
    expect(decl(".dsn-laminas", "grid-template-columns")).toBe("repeat(2, minmax(0, 1fr))");
    expect(voice.querySelector(".dsn-menu")).not.toBeNull();
    expect(scene.querySelector(".dsh-pick")).toBeNull();
  });

  it("C89 no camera moves: nothing of the scene's travel or camera is imported, and no rule of .dsn moves or transforms", () => {
    const sources = [
      "DashboardsScene.tsx",
      "DashboardBoard.tsx",
      "widgets.tsx",
      "charts.tsx",
      "dashboardsData.ts",
    ];
    for (const f of sources) {
      const imports = [...readFileSync(join(__dirname, f), "utf8").matchAll(/from\s+"([^"]+)"/g)].map(
        (m) => m[1]!,
      );
      expect(
        imports.filter((i) => /travel|[Cc]amera|Lamina|flip/.test(i)),
        f,
      ).toEqual([]);
    }
    const moving: string[] = [];
    CSS.walkRules((r) => {
      if (!r.selector.includes(".dsn")) return;
      r.walkDecls((d) => {
        if (/^(transform|perspective|animation|transition|translate|scale|rotate)/.test(d.prop))
          moving.push(`${r.selector} ${d.prop}`);
      });
    });
    expect(moving).toEqual([]);
  });
});

describe("C90 the page's body", () => {
  it("C90 top to bottom: the highlights, the KPI row (five tiles; the sixth is a tile on the grid, never dropped), the cards in the definition's order on the grid", async () => {
    serveTwo();
    mountBoard();
    await screen.findByText("Uma nota");
    const body = document.querySelector(".dsh-body")!;
    expect([...body.children].map((c) => c.className)).toEqual(["dsh-highlights", "dsh-kpis", "dsh-grid"]);
    expect(body.querySelectorAll(".dsh-kpis > .dsh-kpi")).toHaveLength(5);
    expect(cardIds()).toEqual(["s", "m", "l", "x"]);
    expect(
      [...document.querySelectorAll<HTMLElement>(".dsh-grid > .dsh-card")].map((c) => c.dataset.size),
    ).toEqual(["s", "m", "l", "xl"]);
    // Settled (round 1, minor): a KPI past the fifth sits on the grid, first in the definition's order, 4 columns.
    const grid = [...document.querySelectorAll<HTMLElement>(".dsh-grid > [data-widget]")];
    expect(grid.map((c) => c.dataset.widget)).toEqual(["k6", "s", "m", "l", "x"]);
    expect(grid[0]!.classList.contains("dsh-kpi")).toBe(true);
    expect(grid[0]!.querySelector(".dsh-kpi-label")!.textContent).toBe("KPI 6");
    expect(decl(".dsh-grid > .dsh-kpi", "grid-column")).toBe("span 4");
  });

  it("C90 the stylesheet: five equal columns of KPIs, two below 960 px, one below 560 px; 12 columns, and s, m, l, xl span 4, 6, 8, 12", () => {
    expect(decl(".dsh-kpis", "grid-template-columns")).toBe("repeat(5, minmax(0, 1fr))");
    const at = (query: string) => {
      let v = "";
      CSS.walkAtRules("media", (m) => {
        if (m.params === query)
          m.walkRules(".dsh-kpis", (r) => r.walkDecls("grid-template-columns", (d) => void (v = d.value)));
      });
      return v;
    };
    expect(at("(max-width: 959px)")).toBe("repeat(2, minmax(0, 1fr))");
    expect(at("(max-width: 559px)")).toBe("minmax(0, 1fr)");
    expect(decl(".dsh-grid", "grid-template-columns")).toBe("repeat(12, minmax(0, 1fr))");
    expect(["s", "m", "l", "xl"].map((s) => decl(`.dsh-card[data-size="${s}"]`, "grid-column"))).toEqual([
      "span 4",
      "span 6",
      "span 8",
      "span 12",
    ]);
  });
});

describe("C101 the header wraps below 720 px", () => {
  it("C101 the left block comes before the actions, and below 720 px the header is a column (two lines)", async () => {
    serveTwo();
    mountBoard();
    await screen.findByText("Uma nota");
    const head = document.querySelector(".dsh-head")!;
    expect([...head.children].map((c) => c.className)).toEqual(["dsh-head-l", "dsh-actions"]);
    expect(decl(".dsh-head", "display")).toBe("flex");
    // One line above 720 px: the actions never wrap under the title block there; the block wraps inside itself.
    expect(decl(".dsh-head", "flex-wrap")).toBe("nowrap");
    expect(decl(".dsh-head-l", "min-width")).toBe("0");
    expect(decl(".dsh-actions", "flex")).toBe("none");
    let column = "";
    CSS.walkAtRules("media", (m) => {
      if (m.params === "(max-width: 719px)")
        m.walkRules(".dsh-head", (r) => r.walkDecls("flex-direction", (d) => void (column = d.value)));
    });
    expect(column).toBe("column");
  });
});

describe("C102 the highlights row is one line that scrolls sideways", () => {
  it("C102 the pills sit in one flex line that never wraps and scrolls on x; a pill neither shrinks nor wraps its text", async () => {
    serveTwo();
    mountBoard();
    await screen.findByText("Uma nota");
    expect(document.querySelector(".dsh-highlights")!.children).toHaveLength(1);
    // The row lends the page no width (width 0) and takes the row's (min-width 100%), so the row is what scrolls.
    expect(decl(".dsh-highlights", "width")).toBe("0");
    expect(decl(".dsh-highlights", "min-width")).toBe("100%");
    expect(decl(".dsh-highlights", "display")).toBe("flex");
    expect(["", "nowrap"]).toContain(decl(".dsh-highlights", "flex-wrap"));
    expect(decl(".dsh-highlights", "overflow-x")).toBe("auto");
    expect(decl(".dsh-pill", "flex")).toBe("none");
    expect(decl(".dsh-pill", "white-space")).toBe("nowrap");
  });
});
