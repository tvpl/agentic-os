// @vitest-environment jsdom
/**
 * The page "Painéis" (.specs/features/cerebro-paineis, C65, C67, C68, C69, C83, C84, C88; design.md "Página" and
 * "Widgets"): the first open, the refresh that keeps the old values until the stream says, the header's states, each
 * widget state on its widget alone, the device that may not see dashboards, the visit written back and sent as
 * `since`, and the question dashboard. The network answers by method, path and query and refuses anything else.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type * as ApiModule from "../api";
import type * as EventsModule from "../hooks/useEventStream";
import { installPage, motion } from "../ui/testkit";
import { NetError, emit, net } from "../brain/notes/testnet";
import { answerRead, dash, resetDash, sent, urls } from "./testnet";
import { card, cardIds, definition, icons, mountBoard, ok, read, serve, snapshot, tile, w } from "./testkit";

vi.mock("../api", async (importOriginal) =>
  (await import("./testnet")).dashMockApi(await importOriginal<typeof ApiModule>()),
);
vi.mock("../hooks/useEventStream", async (importOriginal) => ({
  ...(await importOriginal<typeof EventsModule>()),
  useOsEvent: (await import("../brain/notes/testnet")).useOsEventMock,
}));
vi.setConfig({ testTimeout: 30_000 });

installPage();
beforeEach(() => {
  resetDash();
});

const kpi = w(
  "prioridades-kpi",
  "kpi",
  { kind: "tasks", window: "today" },
  { measure: "done_of_due" },
  "Prioridades",
);
const decisions = w(
  "decisoes",
  "list",
  { kind: "decisions", window: "week" },
  { size: "m" },
  "Decisões da semana",
);
const overview = definition("overview", [kpi, decisions]);
const snapOf = (value: number, text = "Usar Postgres") =>
  snapshot("visao-geral", [
    ok("prioridades-kpi", "kpi", { value, of: 5, series: [] }),
    ok("decisoes", "list", {
      items: [{ text, state: "decided", natureza: "fato", day: "2026-10-28" }],
      total: 1,
    }),
  ]);
const kpiValue = () => tile("prioridades-kpi").querySelector(".dsh-kpi-value")?.textContent;
const status = () => document.querySelector('[role="status"].dsh-when');
const before = (a: Element, b: Element) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe("C65 the first open makes the overview", () => {
  it("C65 with no dashboard: one POST of the overview, one refresh, the returned snapshot's widgets, then the two next steps in order", async () => {
    dash.list = [];
    dash.writes.set("POST /api/dashboards", async () => {
      dash.list = [
        {
          id: "visao-geral",
          title: "Visão geral",
          kind: "overview",
          contextId: null,
          refresh: "15m",
          generatedAt: null,
          stale: false,
        },
      ];
      return { id: "visao-geral", definition: overview, version: `sha256:${"b".repeat(64)}` };
    });
    dash.writes.set("POST /api/dashboards/visao-geral/refresh", async () => ({
      snapshot: snapOf(3, "Da primeira vez"),
    }));
    answerRead("visao-geral", read(overview, snapOf(3, "Da primeira vez")));
    mountBoard();
    await screen.findByText("Da primeira vez");
    expect(kpiValue()).toBe("3");
    expect(sent("POST", "/api/dashboards")).toEqual([{ template: "overview" }]);
    expect(sent("POST", "/api/dashboards/visao-geral/refresh")).toHaveLength(1);
    const order = net.calls.filter((c) => c.method === "POST").map((c) => c.url);
    expect(order).toEqual(["/api/dashboards", "/api/dashboards/visao-geral/refresh"]);
    const next = [...document.querySelectorAll(".dsh-next button")].map((b) => b.textContent);
    expect(next).toEqual(["Painel de um contexto", "Painel de uma pergunta"]);
    expect(before(card("decisoes"), document.querySelector(".dsh-next")!)).toBe(true);
    expect(dash.unexpected).toEqual([]);
  });

  it("C65 with a dashboard listed, no POST is sent", async () => {
    serve("visao-geral", read(overview, snapOf(2)));
    mountBoard();
    await screen.findByText("Usar Postgres");
    expect(net.calls.filter((c) => c.method === "POST")).toEqual([]);
    expect(dash.unexpected).toEqual([]);
  });
});

describe("C67 a refresh keeps the values until the stream says", () => {
  it("C67 Atualizando… with a spinning Loader in role=status; 3 stays until dashboard.refreshed of this id, then 4; another id changes nothing", async () => {
    motion.reduced = true;
    serve("visao-geral", read(overview, snapOf(3)));
    let answered = false;
    dash.writes.set("POST /api/dashboards/visao-geral/refresh", async () => {
      answered = true;
      return { snapshot: snapOf(4) };
    });
    mountBoard();
    await screen.findByText("Usar Postgres");
    expect(kpiValue()).toBe("3");
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() => expect(answered).toBe(true));
    await waitFor(() => expect(status()?.textContent).toBe("Atualizando…"));
    expect(icons(status()!)).toEqual(["lucide-loader"]);
    expect(status()!.querySelector("svg")!.classList.contains("dsh-spin")).toBe(true);
    // The server already has the new snapshot; the screen does not ask for it before the stream says so.
    answerRead("visao-geral", read(overview, snapOf(4, "Outra")));
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(kpiValue()).toBe("3");
    act(() => emit("dashboard.refreshed", { id: "outro", generatedAt: Date.now(), status: "ok" }));
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(kpiValue()).toBe("3");
    expect(status()?.textContent).toBe("Atualizando…");
    act(() => emit("dashboard.refreshed", { id: "visao-geral", generatedAt: Date.now(), status: "ok" }));
    await waitFor(() => expect(kpiValue()).toBe("4"));
    expect(screen.getByText("Outra")).toBeTruthy();
    expect(status()?.textContent).toMatch(/^Atualizado às \d\d:\d\d$/);
  });
});

describe("C68 the header when out of date and when never refreshed", () => {
  it("C68 stale: Clock, Desatualizado — atualizado às 09:15 and Atualizar", async () => {
    const at = new Date(2026, 9, 30, 9, 15).getTime();
    serve("visao-geral", read(overview, { ...snapOf(3), generatedAt: at }, { stale: true }));
    mountBoard();
    await screen.findByText("Usar Postgres");
    expect(status()!.textContent).toBe("Desatualizado — atualizado às 09:15");
    expect(icons(status()!)).toEqual(["lucide-clock"]);
    expect(screen.getByRole("button", { name: "Atualizar" })).toBeTruthy();
  });

  it("C68 no snapshot: Ainda sem dados, Atualizar, and every card the skeleton", async () => {
    serve("visao-geral", read(overview, null));
    mountBoard();
    await waitFor(() => expect(status()?.textContent).toBe("Ainda sem dados"));
    expect(screen.getByRole("button", { name: "Atualizar" })).toBeTruthy();
    expect(card("decisoes").querySelector(".dsh-skel")).not.toBeNull();
    expect(tile("prioridades-kpi").querySelector(".dsh-skel")).not.toBeNull();
  });
});

describe("C69 each state of a widget, on that widget alone", () => {
  const connector = { id: "calendar-google", name: "Calendar (Google Calendar MCP)" };
  const states = definition("overview", [
    w("bom", "list", { kind: "notes" }, undefined, "Bom"),
    w("falha", "list", { kind: "decisions", window: "week" }, undefined, "Falha"),
    w("ausente", "list", { kind: "facts" }, undefined, "Ausente"),
    w("agenda", "agenda", { kind: "connector", id: "calendar-google", read: "list" }, undefined, "Agenda"),
  ]);
  const snap = snapshot(
    "visao-geral",
    [
      ok("bom", "list", { items: [{ title: "Nota boa", fileId: 3 }], total: 1 }),
      { id: "falha", kind: "list", status: "error", error: "The index could not be read." },
      { id: "ausente", kind: "list", status: "error", error: "Esta fonte ainda não existe nesta versão." },
      {
        id: "agenda",
        kind: "agenda",
        status: "error",
        error: "This connector has no read-only data mapping yet.",
        data: { connector, setup: [] },
      },
    ],
    {
      sources: [
        { id: "notes", kind: "notes", status: "ok", syncedAt: 1 },
        {
          id: "decisions",
          kind: "decisions",
          status: "error",
          syncedAt: null,
          message: "The index could not be read.",
        },
        { id: "facts", kind: "facts", status: "unavailable", syncedAt: null, message: "x" },
        {
          id: "connector:calendar-google",
          kind: "connector",
          status: "not_configured",
          syncedAt: null,
          message: "x",
        },
      ],
    },
  );

  it("C69 error: AlertTriangle, the message and Tentar de novo (.btn.sm, which refreshes) in role=alert; the others keep their data", async () => {
    serve("visao-geral", read(states, snap));
    dash.writes.set("POST /api/dashboards/visao-geral/refresh", () => new Promise(() => undefined));
    mountBoard();
    await screen.findByText("Nota boa");
    const alert = within(card("falha")).getByRole("alert");
    expect(icons(alert)).toEqual(["lucide-triangle-alert"]);
    expect(alert.textContent).toContain("The index could not be read.");
    const retry = within(alert).getByRole("button", { name: "Tentar de novo" });
    expect(retry.className.split(" ")).toEqual(expect.arrayContaining(["btn", "sm"]));
    expect(card("bom").textContent).toContain("Nota boa");
    expect(within(card("bom")).queryByRole("alert")).toBeNull();
    fireEvent.click(retry);
    await waitFor(() => expect(sent("POST", "/api/dashboards/visao-geral/refresh")).toHaveLength(1));
  });

  it("C69 unavailable: CircleSlash and the sentence of AC 25, no alert", async () => {
    serve("visao-geral", read(states, snap));
    mountBoard();
    await screen.findByText("Nota boa");
    const body = card("ausente").querySelector(".dsh-card-b")!;
    expect(body.textContent).toBe("Esta fonte ainda não existe nesta versão.");
    expect(icons(body)).toEqual(["lucide-circle-slash"]);
    expect(within(card("ausente")).queryByRole("alert")).toBeNull();
  });

  it("C69 not configured: Plug, Conecte Calendar (Google Calendar MCP) para ver isto. and a link to /connectors#calendar-google", async () => {
    serve("visao-geral", read(states, snap));
    mountBoard();
    await screen.findByText("Nota boa");
    const body = card("agenda").querySelector(".dsh-card-b")!;
    expect(icons(body)).toEqual(["lucide-plug"]);
    expect(body.querySelector(".dsh-state-text")!.textContent).toBe(
      "Conecte Calendar (Google Calendar MCP) para ver isto.",
    );
    expect(body.querySelector("a")!.getAttribute("href")).toBe("/connectors#calendar-google");
  });

  const EMPTY: Array<[string, string, Parameters<typeof w>[2], string]> = [
    ["checklist", "checklist", { kind: "tasks", window: "today" }, "Nada com prazo para hoje."],
    ["list de decisions", "list", { kind: "decisions", window: "week" }, "Nenhuma decisão nesta semana."],
    ["list de projects", "list", { kind: "projects" }, "Nenhum projeto ativo."],
    ["list de notes", "list", { kind: "notes" }, "Nenhuma nota."],
    ["list de openLoops", "list", { kind: "openLoops", window: "week" }, "Nenhuma pendência aberta."],
    ["list de reviews", "list", { kind: "reviews" }, "Nada para revisar."],
    ["list de facts", "list", { kind: "facts" }, "Nenhum fato registrado."],
    ["list de runs", "list", { kind: "runs" }, "Nenhuma execução recente."],
    ["list de approvals", "list", { kind: "approvals" }, "Nenhuma aprovação pendente."],
    [
      "list de connector",
      "list",
      { kind: "connector", id: "calendar-google", read: "flagged" },
      "Nada de Calendar (Google Calendar MCP) hoje.",
    ],
    ["table", "table", { kind: "notes" }, "Nada para mostrar."],
    ["bars", "bars", { kind: "notes", groupBy: "status" }, "Sem dados para comparar."],
    ["agenda", "agenda", { kind: "connector", id: "calendar-google", read: "list" }, "Agenda livre hoje."],
    ["note", "note", { kind: "notes" }, "Esta nota está vazia."],
  ];
  for (const [name, kind, source, text] of EMPTY)
    it(`C69 empty ${name}: “${text}” with an icon`, async () => {
      const def = definition("overview", [w("vazio", kind as never, source)]);
      serve(
        "visao-geral",
        read(
          def,
          snapshot("visao-geral", [
            { id: "vazio", kind: kind as never, status: "empty", data: { items: [], total: 0, connector } },
          ]),
        ),
      );
      mountBoard();
      await waitFor(() => expect(card("vazio").querySelector(".dsh-empty")).not.toBeNull());
      const empty = card("vazio").querySelector(".dsh-empty")!;
      expect(empty.textContent).toBe(text);
      expect(empty.querySelectorAll("svg")).toHaveLength(1);
      if (kind === "checklist")
        expect(within(card("vazio")).getByRole("button", { name: "Como marcar um prazo" })).toBeTruthy();
    });

  it("C69 loading (no snapshot yet): the skeleton in each card, with no text of a state", async () => {
    serve("visao-geral", read(states, null));
    mountBoard();
    await waitFor(() => expect(cardIds()).toEqual(["bom", "falha", "ausente", "agenda"]));
    for (const id of ["bom", "falha", "ausente", "agenda"]) {
      expect(card(id).querySelector(".dsh-card-b > .dsh-skel")).not.toBeNull();
      expect(card(id).querySelector(".dsh-card-b")!.textContent).toBe("");
    }
  });
});

describe("C83 a device without content", () => {
  it("C83 403 scope_required: the sentence, and no selector, no widget and no POST", async () => {
    dash.list = new NetError(403, "scope_required", "This device needs the content scope");
    mountBoard();
    await screen.findByText("Este dispositivo não tem permissão para ver painéis.");
    expect(document.querySelector(".dsh-pick")).toBeNull();
    expect(document.querySelector(".dsh-card, .dsh-kpi")).toBeNull();
    expect(net.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });
});

describe("C84 the visit is written back and sent as since", () => {
  const area = definition("area", [decisions], { title: "Projeto X" });
  const pick = async (name: string) => {
    fireEvent.pointerDown(document.querySelector(".dsh-pick")!, { button: 0, pointerType: "mouse" });
    const option = await screen.findByRole("menuitemcheckbox", { name });
    fireEvent.click(option);
  };

  it("C84 leaving visao-geral sends lastViewed with its now, keeping the others; its next open asks ?since=<that now>; with no entry, no since", async () => {
    (net.prefs as Record<string, unknown>).dashboards = { lastViewed: { outro: 5 } };
    serve("visao-geral", read(overview, snapOf(3)));
    serve(
      "contexto-x",
      read(
        area,
        snapshot("contexto-x", [ok("decisoes", "list", { items: [{ text: "Do contexto" }], total: 1 })]),
      ),
    );
    mountBoard({ path: "/dashboards/visao-geral" });
    await screen.findByText("Usar Postgres");
    expect(urls("GET", "/api/dashboards/visao-geral")).toEqual(["/api/dashboards/visao-geral"]);
    const t0 = Date.now();
    await pick("Projeto X");
    await screen.findByText("Do contexto");
    await waitFor(() => expect(sent("PUT", "/api/ui-preferences")).toHaveLength(1));
    const body = sent("PUT", "/api/ui-preferences")[0] as {
      dashboards: { lastViewed: Record<string, number> };
    };
    expect(Object.keys(body)).toEqual(["dashboards"]);
    const at = body.dashboards.lastViewed["visao-geral"]!;
    expect(at).toBeGreaterThanOrEqual(t0);
    expect(at).toBeLessThanOrEqual(Date.now());
    expect(body.dashboards.lastViewed).toEqual({ outro: 5, "visao-geral": at });
    // The next open of visao-geral: the table answers only the query with that `since`.
    dash.reads.clear();
    answerRead("visao-geral", read(overview, snapOf(3, "Desde a visita")), at);
    answerRead("contexto-x", read(area, null));
    await pick("Visão geral");
    await screen.findByText("Desde a visita");
    expect(urls("GET", "/api/dashboards/visao-geral").at(-1)).toBe(`/api/dashboards/visao-geral?since=${at}`);
    expect(dash.unexpected).toEqual([]);
  });

  it("C84 leaving the page writes the visit too", async () => {
    serve("visao-geral", read(overview, snapOf(3)));
    const view = mountBoard({ path: "/dashboards/visao-geral" });
    await screen.findByText("Usar Postgres");
    view.unmount();
    await waitFor(() => expect(sent("PUT", "/api/ui-preferences")).toHaveLength(1));
    const body = sent("PUT", "/api/ui-preferences")[0] as {
      dashboards: { lastViewed: Record<string, number> };
    };
    expect(Object.keys(body.dashboards.lastViewed)).toEqual(["visao-geral"]);
  });
});

describe("C88 a question dashboard", () => {
  const question = definition("question", [], { title: "Por que demora?", question: "Por que demora?" });
  const cite = {
    path: "/home/me/.mordomo/memory/notes/plano.md",
    section: "Metas",
    name: "plano.md",
    fileId: 7,
  };
  const answered = (sources = [{ id: "question", kind: "question", status: "ok" as const, syncedAt: 1 }]) =>
    snapshot(
      "pergunta",
      [
        ok("clientes", "kpi", { value: 18, of: 30, title: "Clientes", citations: [cite], series: [] }),
        ok("motivos", "list", { title: "Motivos", items: [{ title: "Contrato" }], citations: [cite] }),
        ok("como-foi-feita", "note", { runId: "run-1", finishedAt: new Date(2026, 9, 30, 10, 0).getTime() }),
      ],
      { sources },
    );

  it("C88 the question as title; Fontes and plano.md § Metas under each widget; the last card How this answer was made with the date and /runs/run-1", async () => {
    serve("pergunta", read(question, answered()));
    mountBoard({ path: "/dashboards/pergunta" });
    await screen.findByText("Contrato");
    expect(document.querySelector(".dsh-title")!.textContent).toBe("Por que demora?");
    for (const el of [tile("clientes"), card("motivos")]) {
      const cites = el.querySelector(".dsh-cites")!;
      expect(cites.querySelector(".dsh-cites-t")!.textContent).toBe("Fontes");
      expect([...cites.querySelectorAll(".dsh-cite")].map((c) => c.textContent)).toEqual([
        "plano.md § Metas",
      ]);
    }
    expect(cardIds().at(-1)).toBe("como-foi-feita");
    const how = card("como-foi-feita");
    expect(how.querySelector(".dsh-card-t")!.textContent).toBe("Como esta resposta foi feita");
    const link = how.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/runs/run-1");
    expect(link.textContent).toContain("2026");
  });

  it("C88 the question source in error: its message and Tentar de novo, which refreshes", async () => {
    serve(
      "pergunta",
      read(
        question,
        answered([
          {
            id: "question",
            kind: "question",
            status: "error",
            syncedAt: null,
            message: "The run of the question finished failed.",
          } as never,
        ]),
      ),
    );
    dash.writes.set("POST /api/dashboards/pergunta/refresh", async () => ({ runId: "run-2" }));
    mountBoard({ path: "/dashboards/pergunta" });
    await screen.findByText("Contrato");
    const alert = document.querySelector<HTMLElement>(".dsh-question-error")!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("The run of the question finished failed.");
    fireEvent.click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(sent("POST", "/api/dashboards/pergunta/refresh")).toHaveLength(1));
  });
});
