// @vitest-environment jsdom
/**
 * What the dashboards say about a local hour and a local day (.specs/features/cerebro-paineis, C66, C71, C76): the
 * header's greeting and the order of its two blocks, a task's due badge against today, and which event of the agenda
 * is now. Pinned to a zone away from UTC (AD-043 b, L-053), so a mutant that reads UTC hours or days is told apart.
 */
process.env.TZ = "America/Sao_Paulo";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import postcss from "postcss";
import type * as ApiModule from "../api";
import type * as EventsModule from "../hooks/useEventStream";
import { installPage } from "../ui/testkit";
import { MEM, WORK, net } from "../brain/notes/testnet";
import { resetDash } from "./testnet";
import { card, definition, icons, mountBoard, ok, read, serve, snapshot, w } from "./testkit";

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

const at = (h: number, m = 0, day = 30) => new Date(2026, 9, day, h, m).getTime();
const clock = (ms: number) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(ms);
};

describe("the zone is pinned", () => {
  it("C66 C71 C76 the file runs in America/Sao_Paulo, three hours behind UTC in October 2026", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/Sao_Paulo");
    expect(new Date(Date.UTC(2026, 9, 30, 12)).getHours()).toBe(9);
  });
});

describe("C66 the header", () => {
  const overview = definition("overview", [w("bom", "list", { kind: "notes" })]);
  const snap = snapshot("visao-geral", [ok("bom", "list", { items: [{ title: "Uma nota" }], total: 1 })], {
    generatedAt: at(14, 7),
    sources: [
      { id: "tasks", kind: "tasks", status: "ok", syncedAt: 1 },
      { id: "connector:calendar-google", kind: "connector", status: "error", syncedAt: null, message: "x" },
      { id: "connector:gmail", kind: "connector", status: "not_configured", syncedAt: null, message: "x" },
      { id: "facts", kind: "facts", status: "unavailable", syncedAt: null, message: "x" },
    ],
  });
  const greeting = async (ms: number) => {
    resetDash();
    clock(ms);
    serve("visao-geral", read(overview, snap));
    const view = mountBoard();
    await screen.findByText("Uma nota");
    const text = document.querySelector(".dsh-title")!.textContent;
    view.unmount();
    vi.useRealTimers();
    return text;
  };

  it("C66 Bom dia at 05:00 and 11:59, Boa tarde at 12:00 and 17:59, Boa noite at 18:00 and 04:59", async () => {
    expect(await greeting(at(5))).toBe("Bom dia");
    expect(await greeting(at(11, 59))).toBe("Bom dia");
    expect(await greeting(at(12))).toBe("Boa tarde");
    expect(await greeting(at(17, 59))).toBe("Boa tarde");
    expect(await greeting(at(18))).toBe("Boa noite");
    expect(await greeting(at(4, 59))).toBe("Boa noite");
  });

  it("C66 the greeting is 24px (calc of --fs-2 × 2) on an overview", async () => {
    const css = postcss.parse(readFileSync(join(__dirname, "dashboards.css"), "utf8"));
    let size = "";
    css.walkRules('.dsh-title[data-kind="overview"]', (r) =>
      r.walkDecls("font-size", (d) => void (size = d.value)),
    );
    expect(size).toBe("calc(var(--fs-2) * 2)");
    clock(at(9));
    serve("visao-geral", read(overview, snap));
    mountBoard();
    await screen.findByText("Uma nota");
    expect(document.querySelector<HTMLElement>(".dsh-title")!.dataset.kind).toBe("overview");
  });

  it("C66 the left block: the greeting; then the kind, the long date, Atualizado às 14:07 and the sources, each an icon then its name, in the snapshot's order", async () => {
    clock(at(14, 20));
    serve("visao-geral", read(overview, snap));
    mountBoard();
    await screen.findByText("Uma nota");
    const left = document.querySelector(".dsh-head-l")!;
    expect([...left.children].map((c) => c.className)).toEqual(["dsh-title", "dsh-meta"]);
    const meta = [...left.querySelector(".dsh-meta")!.children];
    expect(meta.map((c) => c.className)).toEqual(["dsh-kind", "dsh-date", "dsh-when", "dsh-sources"]);
    expect(meta.slice(0, 3).map((c) => c.textContent)).toEqual([
      "Visão geral",
      "sexta-feira, 30 de outubro",
      "Atualizado às 14:07",
    ]);
    const sources = [...meta[3]!.querySelectorAll("li")];
    expect(sources.map((s) => s.textContent)).toEqual(["Tarefas", "calendar-google", "gmail", "Fatos"]);
    expect(sources.map((s) => icons(s))).toEqual([
      ["lucide-check"],
      ["lucide-triangle-alert"],
      ["lucide-plug"],
      ["lucide-circle-slash"],
    ]);
    for (const s of sources) expect(s.firstElementChild!.tagName.toLowerCase()).toBe("svg");
  });

  it("C66 an area shows its title and Contexto: Projeto X; a question Pergunta", async () => {
    clock(at(9));
    net.contexts = [{ id: "projeto-x", name: "Projeto X", paths: [], files: 0 }];
    const area = definition("area", [w("bom", "list", { kind: "notes" })], { title: "Área do projeto" });
    serve("contexto-projeto-x", read(area, { ...snap, dashboardId: "contexto-projeto-x" }));
    mountBoard({ path: "/dashboards/contexto-projeto-x" });
    await screen.findByText("Uma nota");
    expect(document.querySelector(".dsh-title")!.textContent).toBe("Área do projeto");
    await waitFor(() => expect(document.querySelector(".dsh-kind")!.textContent).toBe("Contexto: Projeto X"));
  });

  it("C66 the right block: the selector (the dashboards by kind, then Novo painel…), Atualizar (.btn.sm with RefreshCw), Mais", async () => {
    clock(at(9));
    const area = definition("area", [], { title: "Projeto X" });
    const question = definition("question", [], { title: "Por que demora?" });
    serve("visao-geral", read(overview, snap));
    serve("contexto-x", read(area, null));
    serve("pergunta", read(question, null));
    mountBoard();
    await screen.findByText("Uma nota");
    const right = [...document.querySelector(".dsh-actions")!.children];
    expect(right.map((c) => c.className.split(" ").find((k) => k.startsWith("dsh-")))).toEqual([
      "dsh-pick",
      "dsh-refresh",
      "dsh-more",
    ]);
    expect(right[1]!.textContent).toBe("Atualizar");
    expect(right[1]!.className.split(" ")).toEqual(expect.arrayContaining(["btn", "sm"]));
    expect(icons(right[1]!)).toEqual(["lucide-refresh-cw"]);
    expect(right[2]!.getAttribute("aria-label")).toBe("Mais");
    fireEvent.pointerDown(right[0]!, { button: 0, pointerType: "mouse" });
    await screen.findByRole("menu");
    const entries = [...document.querySelectorAll('[role="menu"] [role^="menuitem"]')].map(
      (e) => e.textContent,
    );
    expect(entries).toEqual(["Visão geral", "Projeto X", "Por que demora?", "Novo painel…"]);
  });
});

describe("C71 a task's row against today", () => {
  const checklist = definition("overview", [w("tarefas", "checklist", { kind: "tasks", window: "week" })]);
  const task = (rel: string, due: string, over: Record<string, unknown> = {}, root = MEM) => ({
    path: `${root}/${rel}`,
    line: 3,
    fileId: 9,
    text: `Tarefa ${due}`,
    done: false,
    due,
    overdue: false,
    priority: 0,
    title: `Nota ${rel}`,
    ...over,
  });
  const mount = async (items: unknown[]) => {
    clock(at(10));
    serve(
      "visao-geral",
      read(checklist, snapshot("visao-geral", [ok("tarefas", "checklist", { items, total: items.length })])),
    );
    mountBoard();
    await waitFor(() => expect(card("tarefas").querySelectorAll(".dsh-task")).toHaveLength(items.length));
    return [...card("tarefas").querySelectorAll<HTMLElement>(".dsh-task")];
  };

  it("C71 the order: the box, ChevronsUp when priority is 2, the text, the note's name, the due badge", async () => {
    const [high, plain] = await mount([
      task("notes/a.md", "2026-10-30", { priority: 2 }),
      task("notes/b.md", "2026-10-30", { priority: 1 }),
    ]);
    const parts = (row: HTMLElement) =>
      [...row.children].map((c) =>
        c.tagName.toLowerCase() === "svg"
          ? [...c.classList].find((k) => k.startsWith("lucide-"))
          : c.className.split(" ")[0],
      );
    expect(parts(high!)).toEqual(["dsh-box", "lucide-chevrons-up", "dsh-task-t", "dsh-task-from", "badge"]);
    expect(parts(plain!)).toEqual(["dsh-box", "dsh-task-t", "dsh-task-from", "badge"]);
    expect(high!.querySelector(".dsh-task-t")!.textContent).toBe("Tarefa 2026-10-30");
    expect(high!.querySelector(".dsh-task-from")!.textContent).toBe("Nota notes/a.md");
  });

  it("C71 due 28/10 danger Atrasada há 2 d, 30/10 warn Vence hoje, 31/10 info Amanhã, 04/11 the short date", async () => {
    const rows = await mount([
      task("notes/a.md", "2026-10-28"),
      task("notes/b.md", "2026-10-30"),
      task("notes/c.md", "2026-10-31"),
      task("notes/d.md", "2026-11-04"),
    ]);
    const due = rows.map((r) => r.querySelector<HTMLElement>(".dsh-due")!);
    expect(due.map((d) => d.textContent)).toEqual(["Atrasada há 2 d", "Vence hoje", "Amanhã", "4 de nov."]);
    expect(due[0]!.classList.contains("danger")).toBe(true);
    expect(due[1]!.classList.contains("warn")).toBe(true);
    expect(due[2]!.classList.contains("info")).toBe(true);
    for (const d of due) expect(d.querySelectorAll("svg")).toHaveLength(1);
  });

  it("C71 outside memory/: a disabled box with Lock and the reason as title; memory/journal/: disabled with Gerada pelo MordomoOS; memory/notes/: enabled", async () => {
    const [outside, journal, mine] = await mount([
      task("relatorio.md", "2026-10-30", {}, WORK),
      task("journal/2026-10-30.md", "2026-10-30"),
      task("notes/a.md", "2026-10-30"),
    ]);
    const box = (r: HTMLElement) => r.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box(outside!).disabled).toBe(true);
    expect(icons(outside!.querySelector(".dsh-box")!)).toEqual(["lucide-lock"]);
    expect(outside!.querySelector(".dsh-box")!.getAttribute("title")).toBe(
      "Fora de memory/: abra a nota para marcar.",
    );
    expect(box(journal!).disabled).toBe(true);
    expect(journal!.querySelector(".dsh-box")!.getAttribute("title")).toBe("Gerada pelo MordomoOS");
    await waitFor(() => expect(box(mine!).disabled).toBe(false));
    expect(mine!.querySelector(".dsh-lock")).toBeNull();
  });
});

describe("C76 the agenda at 14:20", () => {
  const agenda = definition("overview", [
    w("agenda", "agenda", { kind: "connector", id: "calendar-google", read: "list" }, { size: "l" }),
  ]);
  const event = (h: number, title: string, subtitle?: string) => ({
    id: title,
    title,
    ts: at(h),
    ...(subtitle ? { subtitle } : {}),
  });

  it("C76 time (tabular-nums), title and prep note in order; 14:00 is now and 09:00 past", async () => {
    clock(at(14, 20));
    serve(
      "visao-geral",
      read(
        agenda,
        snapshot("visao-geral", [
          ok("agenda", "agenda", {
            connector: { id: "calendar-google", name: "Calendar" },
            items: [
              event(16, "Revisão"),
              event(9, "Café", "Levar a pauta"),
              event(14, "Cliente", "Ler o contrato"),
            ],
            total: 3,
          }),
        ]),
      ),
    );
    mountBoard();
    await screen.findByText("Cliente");
    const rows = [...card("agenda").querySelectorAll<HTMLElement>(".dsh-event")];
    expect(rows.map((r) => r.querySelector(".dsh-event-time")!.textContent)).toEqual([
      "09:00",
      "14:00",
      "16:00",
    ]);
    expect(rows.map((r) => r.dataset.mark)).toEqual(["past", "now", "next"]);
    expect(rows[0]!.classList.contains("past")).toBe(true);
    expect(rows[1]!.classList.contains("now")).toBe(true);
    expect([...rows[1]!.children].map((c) => c.className.split(" ")[0])).toEqual([
      "dsh-event-time",
      "dsh-event-t",
      "dsh-event-prep",
    ]);
    expect(rows[1]!.querySelector(".dsh-event-prep")!.textContent).toBe("Ler o contrato");
    expect(rows[1]!.querySelector(".dsh-event-time")!.classList.contains("dsh-num")).toBe(true);
    const css = postcss.parse(readFileSync(join(__dirname, "dashboards.css"), "utf8"));
    let numeric = "";
    css.walkRules(".dsh-num", (r) => r.walkDecls("font-variant-numeric", (d) => void (numeric = d.value)));
    expect(numeric).toBe("tabular-nums");
    let mark = "";
    css.walkRules(".dsh-event.now", (r) => r.walkDecls("border-left-color", (d) => void (mark = d.value)));
    expect(mark).toBe("var(--chart-mark)");
  });

  it("C76 with no events: Agenda livre hoje.", async () => {
    clock(at(14, 20));
    serve(
      "visao-geral",
      read(
        agenda,
        snapshot("visao-geral", [
          { id: "agenda", kind: "agenda", status: "empty", data: { items: [], total: 0 } },
        ]),
      ),
    );
    mountBoard();
    await screen.findByText("Agenda livre hoje.");
  });
});
