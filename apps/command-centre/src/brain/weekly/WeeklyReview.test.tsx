// @vitest-environment jsdom
process.env.TZ = "America/Sao_Paulo";
/**
 * The page "Revisão semanal" (.specs/features/cerebro-rituais, C78-C91; design.md "Página - Revisão semanal"): the
 * header and the step bar, the five steps with their lists, actions and empty texts, the decisions and their notices,
 * "Desfazer", the conflict and the failure, the archive, "Pronto" and a finished week. The list is answered only for
 * the query the screen sends (the active context, L-052) and each write only for the exact body the claim names.
 * Now is Monday 2026-11-09 10:00 in America/Sao_Paulo, pinned here (L-053).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as ApiModule from "../../api";
import { installPage, motion } from "../../ui/testkit";
import { resetNet } from "../notes/testnet";
import {
  MEM,
  NetError,
  WORK,
  actionsOf,
  answer,
  before,
  button,
  each,
  inOrder,
  itemWith,
  itemsOn,
  loop,
  mountWeekly,
  net,
  notice,
  on,
  only,
  project,
  reads,
  resetWeekly,
  sent,
  status,
  stepButtons,
  stepNow,
  weekly,
} from "./testkit";

vi.mock("../../api", async (importOriginal) =>
  (await import("../notes/testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.setConfig({ testTimeout: 30_000 });

const NOW = new Date(2026, 10, 9, 10, 0);
installPage();
beforeEach(() => {
  resetNet();
  resetWeekly();
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});
afterEach(() => vi.useRealTimers());

const withContext = () => {
  net.contexts = [{ id: "proj-x", name: "Projeto X", paths: [{ path: MEM, state: "ok" }], files: 3 }];
  net.prefs.activeContext = "proj-x";
};
const CTX = { context: "proj-x" };
const page = () => document.querySelector<HTMLElement>(".wk")!;
const loaded = () => waitFor(() => expect(document.querySelector(".wk-stage .wk-state")).toBeNull());
const goTo = async (name: string) => {
  fireEvent.click(stepButtons().find((b) => b.textContent!.endsWith(name))!);
  await waitFor(() => expect(stepNow()).toContain(name));
};
const flush = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
const titles = () => [...document.querySelectorAll(".wk-item .wk-title")].map((e) => e.textContent);
const loopTexts = () => [...document.querySelectorAll(".wk-item .wk-loop")].map((e) => e.textContent);
const icon = (el: Element, name: string) => el.querySelector(`svg.lucide-${name}`) !== null;

describe("C78 the header, the step bar and the footer", () => {
  it("C78 top to bottom: Revisão semanal, Semana de 9 a 15/11 and the context on its right, the five steps in order with Etapa 1 de 5 · Esvaziar, and the status 12 laços abertos", async () => {
    withContext();
    answer(weekly({ loops: { items: [loop("Ligar para a Ana")], total: 12 } }), CTX);
    mountWeekly();
    await waitFor(() => expect(document.querySelector(".wk-week")?.textContent).toBe("Semana de 9 a 15/11"));
    const h1 = page().querySelector("h1")!;
    expect(h1.textContent).toBe("Revisão semanal");
    const week = page().querySelector(".wk-week")!;
    const ctx = page().querySelector(".wk-context")!;
    await waitFor(() => expect(ctx.textContent).toBe("Contexto: Projeto X"));
    expect(before(h1, week) && before(week, ctx)).toBe(true);
    expect(h1.parentElement).toBe(week.parentElement!.parentElement);
    const steps = stepButtons();
    expect(steps.map((b) => b.textContent)).toEqual([
      "1Esvaziar",
      "2Atualizar",
      "3Algum dia",
      "4Arquivar",
      "5Pronto",
    ]);
    expect(steps.map((b) => b.tagName)).toEqual(Array(5).fill("BUTTON"));
    expect(before(ctx, steps[0]!)).toBe(true);
    expect(steps.map((b) => b.getAttribute("aria-current"))).toEqual(["step", null, null, null, null]);
    expect(stepNow()).toBe("Etapa 1 de 5 · Esvaziar");
    await waitFor(() => expect(status()).toBe("12 laços abertos"));
    expect(document.querySelector(".wk-status")!.getAttribute("role")).toBe("status");
    expect(reads()).toEqual(["context=proj-x"]);
  });

  it("C78 a week across two months reads Semana de 30/11 a 6/12", async () => {
    answer(weekly({ week: "2026-11-30" }));
    mountWeekly();
    await waitFor(() =>
      expect(document.querySelector(".wk-week")?.textContent).toBe("Semana de 30/11 a 6/12"),
    );
  });

  it("C78 any step opens at any time: Arquivar from step 1 shows Etapa 4 de 5 · Arquivar, then Atualizar shows Etapa 2 de 5 · Atualizar", async () => {
    answer(weekly({ loopItems: [loop("Ligar para a Ana")] }));
    mountWeekly();
    await loaded();
    fireEvent.click(stepButtons()[3]!);
    expect(stepNow()).toBe("Etapa 4 de 5 · Arquivar");
    expect(stepButtons().map((b) => b.getAttribute("aria-current"))).toEqual([
      null,
      null,
      null,
      "step",
      null,
    ]);
    fireEvent.click(stepButtons()[1]!);
    expect(stepNow()).toBe("Etapa 2 de 5 · Atualizar");
    expect(stepButtons()[1]!.getAttribute("aria-current")).toBe("step");
  });

  it("C78 the footer holds Voltar then Próxima etapa, a step left by Próxima etapa shows Check, and Pronto has Concluir revisão in its place", async () => {
    answer(weekly({ loopItems: [loop("Ligar para a Ana")] }));
    mountWeekly();
    await loaded();
    const foot = () => [...document.querySelectorAll(".wk-foot button")].map((b) => b.textContent);
    expect(foot()).toEqual(["Voltar", "Próxima etapa"]);
    expect(document.querySelector(".wk-foot button.btn.primary")!.textContent).toBe("Próxima etapa");
    expect(icon(stepButtons()[0]!, "check")).toBe(false);
    fireEvent.click(screen.getAllByRole("button", { name: "Próxima etapa" }).at(-1)!);
    expect(stepNow()).toBe("Etapa 2 de 5 · Atualizar");
    expect(icon(stepButtons()[0]!, "check")).toBe(true);
    expect(icon(stepButtons()[1]!, "check")).toBe(false);
    // Opened by the bar, a step is not "left by Próxima etapa".
    fireEvent.click(stepButtons()[4]!);
    expect(icon(stepButtons()[1]!, "check")).toBe(false);
    expect(foot()).toEqual(["Voltar", "Concluir revisão"]);
    expect(document.querySelector(".wk-foot button.btn.primary")!.textContent).toBe("Concluir revisão");
  });
});

describe("C79 step Esvaziar", () => {
  const three = () => {
    const a = loop("Ligar para a Ana", {
      sources: [
        { path: `${MEM}/journal/2026-10-22.md`, line: 4 },
        { path: `${MEM}/journal/2026-10-29.md`, line: 6 },
        { path: `${MEM}/MEMORY.md`, line: 12 },
      ],
    });
    const b = loop("Pagar o boleto", { ageDays: 3 });
    const c = loop("Revisar contrato", { ageDays: 1 });
    return [a, b, c];
  };

  it("C79 in order: Laços abertos (3) with each loop's text, há 18 dias and em 3 lugares (title the paths), and Fechar, Manter, Algum dia, Virar projeto, Virar tarefa; then Caixa de entrada (2); then Bell, 5 notas para revisar and Abrir Revisões", async () => {
    const [a, b, c] = three();
    answer(
      weekly({
        loopItems: [a, b, c],
        inboxItems: [
          { path: `${MEM}/inbox/ideia.md`, title: "Ideia", ageDays: 4 },
          { path: `${MEM}/inbox/link.md`, title: "Link", ageDays: 2 },
        ],
        reviewsDue: 5,
      }),
    );
    mountWeekly();
    await waitFor(() => expect(itemsOn()).toHaveLength(5));
    const blocks = [...document.querySelectorAll(".wk-block-title")].map((h) => h.textContent);
    expect(blocks).toEqual(["Laços abertos (3)", "Caixa de entrada (2)"]);
    expect(loopTexts()).toEqual(["Ligar para a Ana", "Pagar o boleto", "Revisar contrato"]);
    const first = itemWith("Ligar para a Ana");
    const line2 = first.querySelector(".wk-line2")!;
    expect([...line2.children].map((e) => e.textContent)).toEqual(["há 18 dias", "em 3 lugares"]);
    expect(line2.children[1]!.getAttribute("title")).toBe(
      `${MEM}/journal/2026-10-22.md\n${MEM}/journal/2026-10-29.md\n${MEM}/MEMORY.md`,
    );
    expect(before(first.querySelector(".wk-loop")!, line2)).toBe(true);
    expect(
      [...itemWith("Pagar o boleto").querySelector(".wk-line2")!.children].map((e) => e.textContent),
    ).toEqual(["há 3 dias"]);
    for (const li of itemsOn().slice(0, 3))
      expect(actionsOf(li)).toEqual(["Fechar", "Manter", "Algum dia", "Virar projeto", "Virar tarefa"]);
    const close = button(first, "Fechar");
    expect(close.className).toBe("btn primary");
    expect(icon(close, "check")).toBe(true);
    const ideia = itemWith("Ideia");
    expect(ideia.querySelector(".wk-mono")!.textContent).toBe("memory/inbox/ideia.md");
    expect(inOrder(ideia, ["Ideia", "memory/inbox/ideia.md", "há 4 dias", "Abrir", "Arquivar"])).toBe(true);
    expect(actionsOf(ideia)).toEqual(["Abrir", "Arquivar"]);
    const line = document.querySelector(".wk-reviews")!;
    expect(icon(line, "bell")).toBe(true);
    expect(line.textContent).toBe("5 notas para revisar" + "Abrir Revisões");
    const link = within(line as HTMLElement).getByRole("link", { name: "Abrir Revisões" });
    expect(link.getAttribute("href")).toBe("#/brain/reviews");
    const [loopsBlock, inboxBlock] = [...document.querySelectorAll(".wk-block")];
    expect(before(loopsBlock!, inboxBlock!) && before(inboxBlock!, line)).toBe(true);
  });

  it("C79 one loop with one source: Laços abertos (1), há 18 dias and no em N lugares", async () => {
    answer(weekly({ loopItems: [loop("Ligar para a Ana")] }));
    mountWeekly();
    await waitFor(() => expect(itemsOn()).toHaveLength(1));
    expect(document.querySelector(".wk-block-title")!.textContent).toBe("Laços abertos (1)");
    expect(itemsOn()[0]!.querySelector(".wk-line2")!.textContent).toBe("há 18 dias");
  });

  it("C79 Mostrando 50 de 73 sits above the block when total passes the items, and is absent at 50 of 50", async () => {
    const items = Array.from({ length: 50 }, (_, i) => loop(`Laço ${i + 1}`));
    answer(weekly({ loops: { items, total: 73 } }));
    const r = mountWeekly();
    await waitFor(() => expect(itemsOn()).toHaveLength(50));
    const cut = document.querySelector(".wk-cut")!;
    expect(cut.textContent).toBe("Mostrando 50 de 73");
    expect(before(cut, document.querySelector(".wk-block-title")!)).toBe(true);
    r.unmount();
    resetNet();
    resetWeekly();
    answer(weekly({ loops: { items, total: 50 } }));
    mountWeekly();
    await waitFor(() => expect(itemsOn()).toHaveLength(50));
    expect(document.querySelector(".wk-cut")).toBeNull();
  });

  it("C79 with no inbox file there is no Caixa de entrada block, and with 0 due notes no line to Revisões", async () => {
    answer(weekly({ loopItems: [loop("Ligar para a Ana")], reviewsDue: 0 }));
    mountWeekly();
    await waitFor(() => expect(itemsOn()).toHaveLength(1));
    expect([...document.querySelectorAll(".wk-block-title")].map((h) => h.textContent)).toEqual([
      "Laços abertos (1)",
    ]);
    expect(document.querySelector(".wk-reviews")).toBeNull();
    expect(page().textContent).not.toContain("notas para revisar");
  });
});

describe("C80 Virar projeto and Virar tarefa", () => {
  it("C80 Virar projeto opens a field with the loop text all selected and Criar, which sends key, action project, name and the active context", async () => {
    withContext();
    const a = loop("Ligar para a Ana");
    answer(weekly({ loopItems: [a, loop("Pagar o boleto")] }), CTX);
    const body = { key: a.key, action: "project", name: "Ligar para a Ana", context: "proj-x" };
    on(
      "loops",
      only(body, {
        key: a.key,
        state: "project",
        previous: null,
        created: { path: `${MEM}/notes/proj-x/ligar-para-a-ana.md`, version: "sha256:n1" },
      }),
    );
    mountWeekly();
    await waitFor(() => expect(itemsOn()).toHaveLength(2));
    const item = itemWith("Ligar para a Ana");
    fireEvent.click(button(item, "Virar projeto"));
    const field = await within(item).findByRole("textbox", { name: "Virar projeto" });
    const input = field as HTMLInputElement;
    expect(input.value).toBe("Ligar para a Ana");
    await waitFor(() => expect([input.selectionStart, input.selectionEnd]).toEqual([0, 16]));
    expect(document.activeElement).toBe(input);
    fireEvent.click(within(item).getByRole("button", { name: "Criar" }));
    await waitFor(() => expect(notice()?.textContent).toContain("Projeto criado: Ligar para a Ana."));
    expect(sent("loops")).toEqual([body]);
  });

  it("C80 Virar tarefa opens the Menu with the editable projects of step 2 only, and choosing one sends key, action task, the project's path and its version", async () => {
    const a = loop("Ligar para a Ana");
    const app = project("App");
    const fora = project("Fora", { path: `${WORK}/fora.md`, editable: false, version: null });
    answer(weekly({ loopItems: [a], projectItems: [app, fora] }));
    const body = { key: a.key, action: "task", project: app.path, baseVersion: "sha256:app" };
    on(
      "loops",
      only(body, {
        key: a.key,
        state: "task",
        previous: null,
        created: { path: app.path, version: "sha256:app2" },
      }),
    );
    mountWeekly();
    await waitFor(() => expect(itemsOn()).toHaveLength(1));
    const user = userEvent.setup();
    await user.click(button(itemsOn()[0]!, "Virar tarefa"));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((m) => m.textContent),
    ).toEqual(["App"]);
    await user.click(within(menu).getByRole("menuitem", { name: "App" }));
    await waitFor(() => expect(sent("loops")).toEqual([body]));
    await waitFor(() => expect(notice()?.textContent).toContain("Tarefa adicionada em App."));
  });

  it("C80 with no editable project Virar tarefa is disabled with the title Nenhum projeto ativo em memory/.", async () => {
    answer(
      weekly({
        loopItems: [loop("Ligar para a Ana")],
        projectItems: [project("Fora", { path: `${WORK}/fora.md`, editable: false, version: null })],
      }),
    );
    mountWeekly();
    await waitFor(() => expect(itemsOn()).toHaveLength(1));
    const task = button(itemsOn()[0]!, "Virar tarefa");
    expect(task.disabled).toBe(true);
    expect(task.getAttribute("title")).toBe("Nenhum projeto ativo em memory/.");
  });
});

describe("C81 step Atualizar", () => {
  const HEALTH = [
    ["behind", "Atrasado", "triangle-alert"],
    ["due_today", "Vence hoje", "clock"],
    ["in_review", "Em revisão", "eye"],
    ["on_track", "No prazo", "circle-check"],
  ] as const;

  for (const [health, text, svg] of HEALTH)
    it(`C81 the health badge ${health} reads ${text} with its icon, after the title`, async () => {
      answer(weekly({ projectItems: [project("App", { health })] }));
      mountWeekly();
      await loaded();
      await goTo("Atualizar");
      const line1 = itemWith("App").querySelector(".wk-line1")!;
      const badge = line1.querySelector(".badge")!;
      expect(badge.textContent).toBe(text);
      expect(icon(badge, svg)).toBe(true);
      expect(before(line1.querySelector(".wk-title")!, badge)).toBe(true);
    });

  it("C81 each item in order: the title (13px, weight-600 class), Próxima ação: Ligar, revisado há 9 dias, revisão vencida with CalendarClock, the field and Adicionar, then Revisado, Concluído, Pausar, Abrir", async () => {
    answer(
      weekly({
        projectItems: [project("App", { lastReviewed: "2026-10-31", reviewDue: true, health: "behind" })],
      }),
    );
    mountWeekly();
    await loaded();
    await goTo("Atualizar");
    expect(document.querySelector(".wk-block-title")!.textContent).toBe("Projetos ativos (1)");
    const li = itemWith("App");
    const title = li.querySelector(".wk-title")!;
    expect(title.textContent).toBe("App");
    const line2 = li.querySelector(".wk-line2")!;
    expect([...line2.children].map((e) => e.textContent)).toEqual([
      "Próxima ação: Ligar",
      "revisado há 9 dias",
      "revisão vencida",
    ]);
    expect(icon(line2.children[2]!, "calendar-clock")).toBe(true);
    expect(line2.children[2]!.classList.contains("tone-warn")).toBe(true);
    const field = within(li).getByPlaceholderText("O que é o próximo passo concreto?");
    const add = button(li, "Adicionar");
    expect(add.className).toBe("btn sm");
    const acts = li.querySelector(".wk-acts")!;
    expect(actionsOf(li)).toEqual(["Revisado", "Concluído", "Pausar", "Abrir"]);
    expect(button(li, "Revisado").className).toBe("btn primary");
    expect(button(li, "Abrir").className).toBe("btn ghost");
    expect(before(title, line2) && before(line2, field) && before(field, add) && before(add, acts)).toBe(
      true,
    );
  });

  it("C81 Sem próxima ação with AlertTriangle (tone-warn) when nextAction is null, nunca revisado with lastReviewed null, and no revisão vencida without reviewDue", async () => {
    answer(
      weekly({ projectItems: [project("App", { nextAction: null, lastReviewed: null, reviewDue: false })] }),
    );
    mountWeekly();
    await loaded();
    await goTo("Atualizar");
    const line2 = itemWith("App").querySelector(".wk-line2")!;
    expect([...line2.children].map((e) => e.textContent)).toEqual(["Sem próxima ação", "nunca revisado"]);
    expect(icon(line2.children[0]!, "triangle-alert")).toBe(true);
    expect(line2.children[0]!.classList.contains("tone-warn")).toBe(true);
    expect(line2.textContent).not.toContain("revisão vencida");
  });

  it("C81 Adicionar sends POST /api/memory/tasks with the path, the text and the item's version", async () => {
    const app = project("App", { nextAction: null });
    answer(weekly({ projectItems: [app] }));
    const body = { path: app.path, text: "Ligar para o cliente", baseVersion: "sha256:app" };
    on(
      "tasks",
      only(body, { path: app.path, version: "sha256:app2", task: { line: 9, done: false, text: body.text } }),
    );
    mountWeekly();
    await loaded();
    await goTo("Atualizar");
    const li = itemWith("App");
    fireEvent.change(within(li).getByPlaceholderText("O que é o próximo passo concreto?"), {
      target: { value: "Ligar para o cliente" },
    });
    fireEvent.click(button(li, "Adicionar"));
    await waitFor(() => expect(sent("tasks")).toEqual([body]));
    await waitFor(() =>
      expect(itemWith("App").querySelector(".wk-line2")!.textContent).toContain(
        "Próxima ação: Ligar para o cliente",
      ),
    );
  });

  it("C81 the items keep the order the route answered", async () => {
    answer(weekly({ projectItems: [project("Zeta"), project("Alfa"), project("Meio")] }));
    mountWeekly();
    await loaded();
    await goTo("Atualizar");
    expect(titles()).toEqual(["Zeta", "Alfa", "Meio"]);
  });
});

describe("C82 a project outside memory/", () => {
  it("C82 no Próxima ação field, only Revisado then Abrir, with Lock and the sentence above them; Revisado sends path and keep with no baseVersion", async () => {
    const fora = project("Fora", { path: `${WORK}/fora.md`, editable: false, version: null });
    answer(weekly({ projectItems: [fora] }));
    const body = { path: fora.path, action: "keep" };
    on("reviews", only(body, { path: fora.path, state: null, previous: null }));
    mountWeekly();
    await loaded();
    await goTo("Atualizar");
    const li = itemWith("Fora");
    expect(li.querySelector("input")).toBeNull();
    expect(actionsOf(li)).toEqual(["Revisado", "Abrir"]);
    const lock = li.querySelector(".wk-lock")!;
    expect(lock.textContent).toBe("Fora de memory/: a decisão fica no MordomoOS, o arquivo não muda.");
    expect(icon(lock, "lock")).toBe(true);
    expect(before(lock, li.querySelector(".wk-acts")!)).toBe(true);
    fireEvent.click(button(li, "Revisado"));
    await waitFor(() => expect(sent("reviews")).toEqual([body]));
  });
});

describe("C83 Revisado", () => {
  it("C83 sends path, keep and the item's version; on 200 the item stays, reads revisado hoje with Check (tone-ok), and is the last of the list", async () => {
    const app = project("App", { lastReviewed: "2026-10-31", reviewDue: true });
    answer(weekly({ projectItems: [app, project("Site"), project("Loja")] }));
    const body = { path: app.path, action: "keep", baseVersion: "sha256:app" };
    on("reviews", only(body, { path: app.path, state: null, previous: null, version: "sha256:app2" }));
    mountWeekly();
    await loaded();
    await goTo("Atualizar");
    fireEvent.click(button(itemWith("App"), "Revisado"));
    await waitFor(() => expect(titles()).toEqual(["Site", "Loja", "App"]));
    expect(sent("reviews")).toEqual([body]);
    const flag = [...itemWith("App").querySelectorAll(".wk-line2 > *")].find(
      (e) => e.textContent === "revisado hoje",
    )!;
    expect(icon(flag, "check")).toBe(true);
    expect(flag.classList.contains("tone-ok")).toBe(true);
    expect(itemWith("App").textContent).not.toContain("revisão vencida");
  });
});

describe("C84 after a saved decision", () => {
  type Case = {
    name: string;
    step?: string;
    setup: () => { target: string; next: string };
    act: (li: HTMLElement) => void | Promise<void>;
    text: string;
    action: "Desfazer" | "Abrir";
  };
  const loopCase = (name: string, label: string, action: string, text: string): Case => ({
    name,
    setup: () => {
      const a = loop("Ligar para a Ana");
      answer(weekly({ loopItems: [a, loop("Pagar o boleto")] }));
      on(
        "loops",
        only(
          { key: a.key, action },
          { key: a.key, state: action === "close" ? "closed" : action, previous: null },
        ),
      );
      return { target: "Ligar para a Ana", next: "Pagar o boleto" };
    },
    act: (li) => void fireEvent.click(button(li, label)),
    text,
    action: "Desfazer",
  });
  const statusCase = (
    name: string,
    label: string,
    status: string,
    text: string,
    step = "Atualizar",
  ): Case => ({
    name,
    step,
    setup: () => {
      const app = project("App", { status: step === "Algum dia" ? "paused" : "active" });
      const site = project("Site", { status: step === "Algum dia" ? "paused" : "active" });
      answer(
        step === "Algum dia"
          ? weekly({ someday: { loops: [], projects: [app, site] } })
          : weekly({ projectItems: [app, site] }),
      );
      on(
        "props",
        only(
          { path: app.path, baseVersion: "sha256:app", set: { status } },
          {
            path: app.path,
            name: "app.md",
            version: "sha256:app2",
            size: 10,
            mtime: 1,
            properties: [],
          },
        ),
      );
      return { target: "App", next: "Site" };
    },
    act: (li) => void fireEvent.click(button(li, label)),
    text,
    action: "Desfazer",
  });
  const cases: Case[] = [
    loopCase("close", "Fechar", "close", "Fechado."),
    loopCase("keep", "Manter", "keep", "Mantido até segunda."),
    loopCase("someday", "Algum dia", "someday", "Foi para algum dia."),
    statusCase("Concluído", "Concluído", "done", "Concluído: App."),
    statusCase("Pausar", "Pausar", "paused", "Pausado: App."),
    statusCase("Reativar", "Reativar", "active", "Reativado: App.", "Algum dia"),
    {
      name: "project",
      setup: () => {
        const a = loop("Ligar para a Ana");
        answer(weekly({ loopItems: [a, loop("Pagar o boleto")] }));
        on(
          "loops",
          only(
            { key: a.key, action: "project", name: "Ligar para a Ana" },
            {
              key: a.key,
              state: "project",
              previous: null,
              created: { path: `${MEM}/notes/l.md`, version: "sha256:l" },
            },
          ),
        );
        return { target: "Ligar para a Ana", next: "Pagar o boleto" };
      },
      act: async (li) => {
        fireEvent.click(button(li, "Virar projeto"));
        await flush();
        fireEvent.click(within(li).getByRole("button", { name: "Criar" }));
      },
      text: "Projeto criado: Ligar para a Ana.",
      action: "Abrir",
    },
    {
      name: "task",
      setup: () => {
        const a = loop("Ligar para a Ana");
        const app = project("App");
        answer(weekly({ loopItems: [a, loop("Pagar o boleto")], projectItems: [app] }));
        on(
          "loops",
          only(
            { key: a.key, action: "task", project: app.path, baseVersion: "sha256:app" },
            {
              key: a.key,
              state: "task",
              previous: null,
              created: { path: app.path, version: "sha256:app2" },
            },
          ),
        );
        return { target: "Ligar para a Ana", next: "Pagar o boleto" };
      },
      act: async () => {
        // The menu is open before the clock is frozen; choosing the project is the save.
        fireEvent.click(screen.getByRole("menuitem", { name: "App" }));
      },
      text: "Tarefa adicionada em App.",
      action: "Abrir",
    },
  ];

  for (const c of cases)
    it(`C84 ${c.name}: the item leaves, focus goes to the next item, and "${c.text}" with ${c.action} is on screen at 7 999 ms and gone at 8 000 ms`, async () => {
      const { target, next } = c.setup();
      mountWeekly();
      await loaded();
      if (c.step) await goTo(c.step);
      await waitFor(() => expect(itemWith(target)).toBeDefined());
      if (c.name === "task") await userEvent.setup().click(button(itemWith(target), "Virar tarefa"));
      await screen.findAllByRole("button");
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], now: NOW });
      await c.act(itemWith(target));
      await flush();
      const box = notice()!;
      expect(box.querySelector("span")!.textContent).toBe(c.text);
      expect([...box.querySelectorAll("button")].map((b) => b.textContent)).toEqual([c.action]);
      act(() => void vi.advanceTimersByTime(150));
      expect(itemsOn().some((li) => li.textContent!.includes(target))).toBe(false);
      expect(document.activeElement).toBe(itemWith(next));
      act(() => void vi.advanceTimersByTime(7_999 - 150));
      expect(notice()?.querySelector("span")?.textContent).toBe(c.text);
      act(() => void vi.advanceTimersByTime(1));
      expect(notice()).toBeNull();
    });

  it("C84 a 404 loop_not_found takes the item out with Este laço já tinha decisão.", async () => {
    const a = loop("Ligar para a Ana");
    answer(weekly({ loopItems: [a, loop("Pagar o boleto")] }));
    on("loops", (b) =>
      JSON.stringify(b) === JSON.stringify({ key: a.key, action: "close" })
        ? Promise.reject(new NetError(404, "loop_not_found"))
        : Promise.reject(new NetError(400, "unexpected_body")),
    );
    motion.reduced = true;
    mountWeekly();
    await waitFor(() => expect(itemsOn()).toHaveLength(2));
    fireEvent.click(button(itemWith("Ligar para a Ana"), "Fechar"));
    await waitFor(() => expect(loopTexts()).toEqual(["Pagar o boleto"]));
    expect(notice()!.textContent).toBe("Este laço já tinha decisão.");
  });
});

describe("C85 Desfazer", () => {
  const PREV = { action: "keep", week: "2026-11-02", target: null, decidedAt: 1_762_000_000_000 };
  for (const [label, action] of [
    ["Fechar", "close"],
    ["Manter", "keep"],
    ["Algum dia", "someday"],
  ] as const)
    it(`C85 after ${action} it sends key, restore and the previous the decision answered, and the loop comes back to its place`, async () => {
      const a = loop("Ligar para a Ana");
      const b = loop("Pagar o boleto");
      answer(weekly({ loopItems: [b, a, loop("Revisar contrato")] }));
      const restore = { key: a.key, action: "restore", previous: PREV };
      on(
        "loops",
        each(
          [
            { key: a.key, action },
            { key: a.key, state: action === "close" ? "closed" : action, previous: PREV },
          ],
          [restore, { key: a.key, state: "keep", previous: null }],
        ),
      );
      motion.reduced = true;
      mountWeekly();
      await waitFor(() => expect(itemsOn()).toHaveLength(3));
      fireEvent.click(button(itemWith("Ligar para a Ana"), label));
      await waitFor(() => expect(loopTexts()).toEqual(["Pagar o boleto", "Revisar contrato"]));
      fireEvent.click(within(notice() as HTMLElement).getByRole("button", { name: "Desfazer" }));
      await waitFor(() =>
        expect(loopTexts()).toEqual(["Pagar o boleto", "Ligar para a Ana", "Revisar contrato"]),
      );
      expect(sent("loops")).toEqual([{ key: a.key, action }, restore]);
    });

  for (const [label, from, set, step] of [
    ["Concluído", "active", { set: { status: "active" } }, "Atualizar"],
    ["Pausar", null, { remove: ["status"] }, "Atualizar"],
    ["Reativar", "paused", { set: { status: "paused" } }, "Algum dia"],
  ] as const)
    it(`C85 after ${label} it sends PUT properties with the version that PUT answered and ${"set" in set ? `status ${from}` : "the status removed"}, and the project comes back to its place`, async () => {
      const app = project("App", { status: from });
      const others = [project("Site", { status: from }), project("Loja", { status: from })];
      answer(
        step === "Algum dia"
          ? weekly({ someday: { loops: [], projects: [others[0], app, others[1]] } })
          : weekly({ projectItems: [others[0], app, others[1]] }),
      );
      const status = label === "Concluído" ? "done" : label === "Pausar" ? "paused" : "active";
      const written = (version: string) => ({
        path: app.path,
        name: "app.md",
        version,
        size: 1,
        mtime: 1,
        properties: [],
      });
      const undo = { path: app.path, baseVersion: "sha256:app2", ...set };
      on(
        "props",
        each(
          [{ path: app.path, baseVersion: "sha256:app", set: { status } }, written("sha256:app2")],
          [undo, written("sha256:app3")],
        ),
      );
      motion.reduced = true;
      mountWeekly();
      await loaded();
      await goTo(step);
      fireEvent.click(button(itemWith("App"), label));
      await waitFor(() => expect(titles()).toEqual(["Site", "Loja"]));
      fireEvent.click(within(notice() as HTMLElement).getByRole("button", { name: "Desfazer" }));
      await waitFor(() => expect(titles()).toEqual(["Site", "App", "Loja"]));
      expect(sent("props")).toEqual([{ path: app.path, baseVersion: "sha256:app", set: { status } }, undo]);
    });

  it("C85 after Arquivar of an inbox file it sends POST /api/memory/cleanup/undo with the manifest, and the file comes back to its place", async () => {
    const ideia = { path: `${MEM}/inbox/ideia.md`, title: "Ideia", ageDays: 4 };
    const link = { path: `${MEM}/inbox/link.md`, title: "Link", ageDays: 2 };
    answer(weekly({ inboxItems: [ideia, link] }));
    const manifest = `${MEM}/archive/2026-11-09-a1b2c3d4/manifest.json`;
    on(
      "archive",
      only(
        { week: "2026-11-09", paths: [ideia.path] },
        {
          manifest,
          moved: [{ from: ideia.path, to: `${MEM}/archive/2026-11-09-a1b2c3d4/inbox/ideia.md` }],
          skipped: [],
          proposals: null,
        },
      ),
    );
    on("undo", only({ manifest }, { restored: [{ from: "x", to: ideia.path }], skipped: [] }));
    motion.reduced = true;
    mountWeekly();
    await waitFor(() => expect(itemsOn()).toHaveLength(2));
    fireEvent.click(button(itemWith("Ideia"), "Arquivar"));
    await waitFor(() => expect(titles()).toEqual(["Link"]));
    expect(notice()!.querySelector("span")!.textContent).toBe("Arquivados: 1.");
    fireEvent.click(within(notice() as HTMLElement).getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(titles()).toEqual(["Ideia", "Link"]));
    expect(sent("undo")).toEqual([{ manifest }]);
  });
});

describe("C86 a save that fails", () => {
  type Conflict = [string, (app: ReturnType<typeof project>, key: string) => Promise<void>, string];
  const conflicts: Conflict[] = [
    [
      "Adicionar",
      async () => {
        await goTo("Atualizar");
        const li = itemWith("App");
        fireEvent.change(within(li).getByPlaceholderText("O que é o próximo passo concreto?"), {
          target: { value: "Ligar" },
        });
        fireEvent.click(button(li, "Adicionar"));
      },
      "App",
    ],
    [
      "Revisado",
      async () => {
        await goTo("Atualizar");
        fireEvent.click(button(itemWith("App"), "Revisado"));
      },
      "App",
    ],
    [
      "Concluído",
      async () => {
        await goTo("Atualizar");
        fireEvent.click(button(itemWith("App"), "Concluído"));
      },
      "App",
    ],
    [
      "Virar tarefa",
      async () => {
        const user = userEvent.setup();
        await user.click(button(itemWith("Ligar para a Ana"), "Virar tarefa"));
        await user.click(await screen.findByRole("menuitem", { name: "App" }));
      },
      "Ligar para a Ana",
    ],
  ];
  for (const [name, run, target] of conflicts)
    it(`C86 ${name} answering 409 edit_conflict keeps the item with AlertTriangle, the sentence and Recarregar, which asks the list again with the same context`, async () => {
      withContext();
      const app = project("App");
      answer(weekly({ loopItems: [loop("Ligar para a Ana")], projectItems: [app, project("Site")] }), CTX);
      const conflict = () => Promise.reject(new NetError(409, "edit_conflict"));
      for (const r of ["tasks", "reviews", "props", "loops"] as const) on(r, conflict);
      mountWeekly();
      await waitFor(() => expect(itemsOn().length).toBeGreaterThan(0));
      await run(app, "");
      const li = await waitFor(() => {
        const el = itemWith(target);
        expect(el.querySelector(".wk-trouble")).not.toBeNull();
        return el;
      });
      const box = li.querySelector(".wk-trouble")!;
      expect(icon(box, "triangle-alert")).toBe(true);
      expect(box.textContent).toBe("A nota mudou desde que a lista foi carregada." + "Recarregar");
      expect(itemsOn().includes(li)).toBe(true);
      expect(reads()).toEqual(["context=proj-x"]);
      fireEvent.click(within(box as HTMLElement).getByRole("button", { name: "Recarregar" }));
      await waitFor(() => expect(reads()).toEqual(["context=proj-x", "context=proj-x"]));
    });

  it("C86 a save answering 500 shows Não deu para salvar. and Tentar de novo, which sends the same body again", async () => {
    const a = loop("Ligar para a Ana");
    answer(weekly({ loopItems: [a] }));
    let n = 0;
    on("loops", (b) =>
      ++n === 1
        ? Promise.reject(new NetError(500, "internal"))
        : only({ key: a.key, action: "close" }, { key: a.key, state: "closed", previous: null })(b),
    );
    motion.reduced = true;
    mountWeekly();
    await waitFor(() => expect(itemsOn()).toHaveLength(1));
    fireEvent.click(button(itemWith("Ligar para a Ana"), "Fechar"));
    const box = await waitFor(() => {
      const el = itemWith("Ligar para a Ana").querySelector(".wk-trouble");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(box.textContent).toBe("Não deu para salvar." + "Tentar de novo");
    fireEvent.click(within(box as HTMLElement).getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(loopTexts()).toEqual([]));
    expect(sent("loops")).toEqual([
      { key: a.key, action: "close" },
      { key: a.key, action: "close" },
    ]);
  });
});

describe("C87 the states", () => {
  const emptyOf = () => document.querySelector(".wk-empty")!;
  it("C87 step 1 empty: CircleCheck at 32px, Nada solto. Todo laço tem decisão. and Próxima etapa", async () => {
    answer(weekly());
    mountWeekly();
    await waitFor(() => expect(document.querySelector(".wk-empty")).not.toBeNull());
    const svg = emptyOf().querySelector("svg.lucide-circle-check")!;
    expect([svg.getAttribute("width"), svg.getAttribute("height")]).toEqual(["32", "32"]);
    expect(emptyOf().textContent).toBe("Nada solto. Todo laço tem decisão." + "Próxima etapa");
    fireEvent.click(within(emptyOf() as HTMLElement).getByRole("button", { name: "Próxima etapa" }));
    expect(stepNow()).toBe("Etapa 2 de 5 · Atualizar");
  });

  for (const [step, svg, text] of [
    [
      "Atualizar",
      "folder-open",
      "Nenhum projeto ativo." + "Um laço vira projeto na etapa Esvaziar." + "Próxima etapa",
    ],
    ["Algum dia", "cloud-moon", "Nada em algum dia." + "Próxima etapa"],
    ["Arquivar", "archive", "Nenhum projeto concluído para arquivar." + "Próxima etapa"],
  ] as const)
    it(`C87 step ${step} empty: its icon and its text, in order`, async () => {
      answer(weekly());
      mountWeekly();
      await loaded();
      await goTo(step);
      expect(emptyOf().querySelector(`svg.lucide-${svg}`)).not.toBeNull();
      expect(emptyOf().textContent).toBe(text);
    });

  it("C87 while the list loads: the step bar and a spinner with Carregando…", async () => {
    answer("pending");
    mountWeekly();
    await waitFor(() => expect(document.querySelector(".wk-stage .wk-state")).not.toBeNull());
    expect(stepButtons()).toHaveLength(5);
    const state = document.querySelector(".wk-stage .wk-state")!;
    expect(state.querySelector(".spinner")).not.toBeNull();
    expect(state.textContent).toBe("Carregando…");
  });

  it("C87 when the list fails: role=alert with AlertTriangle, Não deu para carregar a revisão. and Tentar de novo, which asks again", async () => {
    answer(new NetError(500, "internal"));
    mountWeekly();
    // The toast provider's live region is an alert too: the page's is the one inside it.
    const alert = await within(await waitFor(() => page())).findByRole("alert");
    expect(icon(alert, "triangle-alert")).toBe(true);
    expect(alert.textContent).toBe("Não deu para carregar a revisão." + "Tentar de novo");
    expect(reads()).toHaveLength(1);
    answer(weekly({ loopItems: [loop("Ligar para a Ana")] }));
    fireEvent.click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(loopTexts()).toEqual(["Ligar para a Ana"]));
    expect(reads()).toHaveLength(2);
  });
});

describe("C88 step Algum dia", () => {
  it("C88 in order: Laços para algum dia (2) with Fechar, Virar projeto, Virar tarefa and Manter em algum dia (.btn.ghost, no request, focus to the next item); then Projetos pausados (1) with Reativar (Play) and Abrir", async () => {
    const a = loop("Ligar para a Ana");
    const b = loop("Aprender piano");
    const app = project("App", { status: "paused", health: "paused" });
    answer(weekly({ someday: { loops: [a, b], projects: [app] }, projectItems: [project("Site")] }));
    on(
      "props",
      only(
        { path: app.path, baseVersion: "sha256:app", set: { status: "active" } },
        {
          path: app.path,
          name: "app.md",
          version: "sha256:app2",
          size: 1,
          mtime: 1,
          properties: [],
        },
      ),
    );
    mountWeekly();
    await loaded();
    await goTo("Algum dia");
    expect([...document.querySelectorAll(".wk-block-title")].map((h) => h.textContent)).toEqual([
      "Laços para algum dia (2)",
      "Projetos pausados (1)",
    ]);
    const [first, second] = [...document.querySelectorAll(".wk-block")];
    expect(before(first!, second!)).toBe(true);
    for (const text of ["Ligar para a Ana", "Aprender piano"])
      expect(actionsOf(itemWith(text))).toEqual([
        "Fechar",
        "Virar projeto",
        "Virar tarefa",
        "Manter em algum dia",
      ]);
    const keep = button(itemWith("Ligar para a Ana"), "Manter em algum dia");
    expect(keep.className).toBe("btn ghost");
    fireEvent.click(keep);
    await waitFor(() => expect(document.activeElement).toBe(itemWith("Aprender piano")));
    expect(net.calls.filter((c) => c.method !== "GET")).toEqual([]);
    expect(loopTexts()).toEqual(["Ligar para a Ana", "Aprender piano"]);
    const paused = itemWith("App");
    expect(actionsOf(paused)).toEqual(["Reativar", "Abrir"]);
    expect(icon(button(paused, "Reativar"), "play")).toBe(true);
    fireEvent.click(button(paused, "Reativar"));
    await waitFor(() =>
      expect(sent("props")).toEqual([
        { path: app.path, baseVersion: "sha256:app", set: { status: "active" } },
      ]),
    );
  });
});

describe("C89 step Arquivar", () => {
  const app = { path: `${MEM}/notes/app.md`, title: "App", editable: true, doneSince: "2026-11-03" };
  const fora = { path: `${WORK}/fora.md`, title: "Fora", editable: false, doneSince: "2026-11-03" };
  const MANIFEST = `${MEM}/archive/2026-11-09-a1b2c3d4/manifest.json`;
  const boxes = () => [...document.querySelectorAll<HTMLInputElement>(".wk-item input[type=checkbox]")];
  const archiveButton = () => screen.getByRole("button", { name: /^Arquivar \d+$/ }) as HTMLButtonElement;

  it("C89 in order: the sentence, then each done project with its checkbox (checked), title, path (mono) or Lock and vira proposta, and concluído em 3/11; Arquivar 2, 1 and 0 (disabled) as boxes are unchecked", async () => {
    answer(weekly({ archiveItems: [app, fora] }));
    mountWeekly();
    await loaded();
    await goTo("Arquivar");
    const block = document.querySelector(".wk-block")!;
    const note = block.querySelector(".wk-prose")!;
    expect(note.textContent).toBe("Vão para memory/archive/ com desfazer. Nada é apagado.");
    const [li1, li2] = itemsOn();
    expect(before(note, li1!)).toBe(true);
    expect(boxes().map((b) => b.checked)).toEqual([true, true]);
    expect(li1!.querySelector(".wk-mono")!.textContent).toBe("memory/notes/app.md");
    expect(inOrder(li1!, ["App", "memory/notes/app.md", "concluído em 3/11"])).toBe(true);
    expect(before(li1!.querySelector("input")!, li1!.querySelector(".wk-title")!)).toBe(true);
    expect(li2!.querySelector(".wk-mono")).toBeNull();
    const lock = li2!.querySelector(".wk-lock")!;
    expect(lock.textContent).toBe("vira proposta");
    expect(icon(lock, "lock")).toBe(true);
    expect(inOrder(li2!, ["Fora", "vira proposta", "concluído em 3/11"])).toBe(true);
    expect(screen.getByRole("checkbox", { name: "App" })).toBe(boxes()[0]);
    expect(archiveButton().textContent).toBe("Arquivar 2");
    expect(archiveButton().className).toBe("btn primary");
    fireEvent.click(boxes()[0]!);
    expect(archiveButton().textContent).toBe("Arquivar 1");
    fireEvent.click(boxes()[1]!);
    expect(archiveButton().textContent).toBe("Arquivar 0");
    expect(archiveButton().disabled).toBe(true);
  });

  it("C89 Arquivar 1 sends the week and exactly the checked path; the result reads Arquivados: 1., and Desfazer sends the undo and reads Desfeito: 1 arquivos voltaram.", async () => {
    answer(weekly({ archiveItems: [app, fora] }));
    on(
      "archive",
      only(
        { week: "2026-11-09", paths: [fora.path] },
        { manifest: MANIFEST, moved: [{ from: fora.path, to: "x" }], skipped: [], proposals: null },
      ),
    );
    on("undo", only({ manifest: MANIFEST }, { restored: [{ from: "x", to: fora.path }], skipped: [] }));
    mountWeekly();
    await loaded();
    await goTo("Arquivar");
    fireEvent.click(boxes()[0]!);
    fireEvent.click(archiveButton());
    await waitFor(() => expect(document.querySelector(".wk-result")).not.toBeNull());
    expect(sent("archive")).toEqual([{ week: "2026-11-09", paths: [fora.path] }]);
    const result = document.querySelector(".wk-result")!;
    expect(result.querySelector(".wk-prose")!.textContent).toBe("Arquivados: 1.");
    expect(result.textContent).not.toContain("Pulados");
    expect(result.textContent).not.toContain("Abrir a lista de propostas");
    fireEvent.click(within(result as HTMLElement).getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(result.textContent).toContain("Desfeito: 1 arquivos voltaram."));
    expect(sent("undo")).toEqual([{ manifest: MANIFEST }]);
  });

  for (const [reason, text] of [
    ["changed", "mudou"],
    ["missing", "não existe mais"],
    ["exists", "o destino já existe"],
    ["forbidden_path", "caminho com link"],
  ] as const)
    it(`C89 a skip ${reason} reads Pulados: 1 with the path and ${text}; with proposals, Abrir a lista de propostas`, async () => {
      answer(weekly({ archiveItems: [app, fora] }));
      on(
        "archive",
        only(
          { week: "2026-11-09", paths: [app.path, fora.path] },
          {
            manifest: null,
            moved: [],
            skipped: [{ path: app.path, reason }],
            proposals: "/home/me/.mordomo/artifacts/cleanup/2026-11-09-a1b2c3d4.md",
          },
        ),
      );
      mountWeekly();
      await loaded();
      await goTo("Arquivar");
      fireEvent.click(archiveButton());
      const result = await waitFor(() => {
        const el = document.querySelector<HTMLElement>(".wk-result");
        expect(el).not.toBeNull();
        return el!;
      });
      expect([...result.querySelectorAll(".wk-prose")].map((p) => p.textContent)).toEqual([
        "Arquivados: 0.",
        "Pulados: 1",
      ]);
      expect(result.querySelector(".wk-skips li")!.textContent).toBe("memory/notes/app.md" + text);
      expect(within(result).getByRole("button", { name: "Abrir a lista de propostas" })).toBeTruthy();
    });
});

describe("C90 step Pronto", () => {
  beforeEach(() => {
    motion.reduced = true;
  });
  const numbers = () =>
    [...document.querySelectorAll(".wk-numbers li")].map((li) => [
      li.querySelector(".wk-num")!.textContent,
      li.querySelector(".wk-num-label")!.textContent,
    ]);

  it("C90 three numbers (20px class) labelled in order laços decididos, projetos revisados, arquivados, from counts; Ainda sem próxima ação: 2 with AlertTriangle", async () => {
    answer(
      weekly({
        counts: { loops: 4, projects: 2, archived: 1 },
        projectItems: [
          project("App", { nextAction: null }),
          project("Site", { nextAction: null }),
          project("Loja"),
        ],
      }),
    );
    mountWeekly();
    await loaded();
    await goTo("Pronto");
    await waitFor(() =>
      expect(numbers()).toEqual([
        ["4", "laços decididos"],
        ["2", "projetos revisados"],
        ["1", "arquivados"],
      ]),
    );
    expect([...document.querySelectorAll(".wk-numbers li")].every((li) => li.querySelector(".wk-num"))).toBe(
      true,
    );
    const warn = document.querySelector(".wk-warn")!;
    expect(warn.textContent).toBe("Ainda sem próxima ação: 2");
    expect(icon(warn, "triangle-alert")).toBe(true);
  });

  it("C90 no Ainda sem próxima ação when every listed project has one", async () => {
    answer(weekly({ projectItems: [project("App"), project("Site")] }));
    mountWeekly();
    await loaded();
    await goTo("Pronto");
    expect(document.querySelector(".wk-warn")).toBeNull();
    expect(page().textContent).not.toContain("Ainda sem próxima ação");
  });

  it("C90 Concluir revisão sends the week, then shows CircleCheck, Revisão da semana concluída., the answered counts and Próximo lembrete: sexta, 20/11, 16:00", async () => {
    answer(
      weekly({
        counts: { loops: 4, projects: 2, archived: 1 },
        nextReminder: new Date(2026, 10, 13, 16).getTime(),
      }),
    );
    const finishedAt = new Date(2026, 10, 9, 10, 5).getTime();
    on(
      "finish",
      only({ week: "2026-11-09" }, () => {
        answer(
          weekly({
            finishedAt,
            counts: { loops: 5, projects: 3, archived: 1 },
            nextReminder: new Date(2026, 10, 20, 16).getTime(),
          }),
        );
        return {
          week: "2026-11-09",
          finishedAt,
          counts: { loops: 5, projects: 3, archived: 1 },
          journal: { path: `${MEM}/journal/2026-11-09.md`, line: "- 10:05 Revisão semanal" },
        };
      }),
    );
    mountWeekly();
    await loaded();
    await goTo("Pronto");
    fireEvent.click(screen.getByRole("button", { name: "Concluir revisão" }));
    const done = await waitFor(() => {
      const el = document.querySelector(".wk-finished")!;
      expect(el.textContent).toBe("Revisão da semana concluída.");
      return el;
    });
    expect(icon(done, "circle-check")).toBe(true);
    expect(sent("finish")).toEqual([{ week: "2026-11-09" }]);
    expect(numbers().map(([n]) => n)).toEqual(["5", "3", "1"]);
    await waitFor(() => expect(page().textContent).toContain("Próximo lembrete: sexta, 20/11, 16:00"));
    expect(screen.queryByRole("button", { name: "Concluir revisão" })).toBeNull();
  });

  it("C90 with nextReminder null: Lembrete semanal desligado. with the link Ligar em Configurações", async () => {
    const finishedAt = new Date(2026, 10, 9, 10, 5).getTime();
    answer(weekly());
    on(
      "finish",
      only({ week: "2026-11-09" }, () => {
        answer(weekly({ finishedAt, nextReminder: null }));
        return {
          week: "2026-11-09",
          finishedAt,
          counts: { loops: 0, projects: 0, archived: 0 },
          journal: { path: `${MEM}/journal/2026-11-09.md`, line: "- 10:05 x" },
        };
      }),
    );
    mountWeekly();
    await loaded();
    await goTo("Pronto");
    fireEvent.click(screen.getByRole("button", { name: "Concluir revisão" }));
    await waitFor(() => expect(page().textContent).toContain("Lembrete semanal desligado."));
    const link = screen.getByRole("link", { name: "Ligar em Configurações" });
    expect(link.getAttribute("href")).toBe("#/settings?tab=notifications");
  });
});

describe("C91 a week already finished", () => {
  it("C91 opens on Etapa 5 de 5 · Pronto with Revisão desta semana concluída em 12/11. and the stored numbers, and Esvaziar still opens step 1", async () => {
    // 2026-11-13T01:30Z is 12/11 22:30 in São Paulo: the UTC day would say 13/11.
    const finishedAt = Date.UTC(2026, 10, 13, 1, 30);
    expect(process.env.TZ).toBe("America/Sao_Paulo");
    expect(new Date(finishedAt).getDate()).toBe(12);
    motion.reduced = true;
    answer(
      weekly({
        finishedAt,
        counts: { loops: 7, projects: 3, archived: 2 },
        loopItems: [loop("Ligar para a Ana")],
      }),
    );
    mountWeekly();
    await waitFor(() => expect(stepNow()).toBe("Etapa 5 de 5 · Pronto"));
    await waitFor(() =>
      expect(document.querySelector(".wk-finished")?.textContent).toBe(
        "Revisão desta semana concluída em 12/11.",
      ),
    );
    await waitFor(() =>
      expect([...document.querySelectorAll(".wk-num")].map((n) => n.textContent)).toEqual(["7", "3", "2"]),
    );
    fireEvent.click(stepButtons()[0]!);
    expect(stepNow()).toBe("Etapa 1 de 5 · Esvaziar");
    expect(loopTexts()).toEqual(["Ligar para a Ana"]);
  });
});
