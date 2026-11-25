// @vitest-environment jsdom
/**
 * The view "Resumos" in rendered components (.specs/features/cerebro-entidades-resumos, C119, C121-C128; design.md "Vista
 * - Resumos", "Resumo aberto", "Estados"): the arrangement in the DOM and in the stylesheet (the browser measures it,
 * `entidades.spec.ts` C119), the list rows by state, the open summary with its citations, sources and card, the stale
 * band, generating, failed or refused, the off state, the empty scope, no summary, no area nor context, and the list's
 * loading and error, over the routes as the API answers them. The interface reads pt-BR, so the claims' own words are
 * asserted.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import postcss from "postcss";
import type * as ApiModule from "../../api";
import { CommandRegistry } from "../../commands/registry";
import { installPage } from "../../ui/testkit";
import { resetNet } from "../notes/testnet";
import {
  NetError,
  before,
  detail,
  item,
  kit,
  mountSummaries,
  net,
  on,
  only,
  panel,
  paragraph,
  picks,
  resetSummaries,
  rowOf,
  searchOf,
  sent,
  NOW,
} from "./testkit";

// The claims' local day and hour (L-050): set before the clock of the testkit is read.
vi.hoisted(() => {
  process.env.TZ = "America/Sao_Paulo";
});
vi.mock("../../api", async (importOriginal) =>
  (await import("../notes/testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.setConfig({ testTimeout: 30_000 });

installPage();
beforeEach(() => {
  resetNet();
  resetSummaries();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
});

const CSS = readFileSync(join(__dirname, "summaries.css"), "utf8");
/** The declarations of `selector`, inside the at-rule whose params are `media` (or outside any). */
function rule(selector: string, media?: string): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(CSS).walkRules((r) => {
    const listed = r.selector.split(",").map((x) => x.trim());
    const parent = r.parent;
    const at = parent?.type === "atrule" ? (parent as postcss.AtRule).params : undefined;
    if (listed.includes(selector) && at === media) r.walkDecls((d) => void (out[d.prop] = d.value));
  });
  return out;
}

const PROJETOS = item("area", "Projetos", {
  state: "stale",
  generatedAt: NOW,
  changes: { changed: 3, removed: 1, added: 2 },
});
const PESSOAS = item("area", "Pessoas");
const FINANCAS = item("area", "Finanças", { state: "fresh", generatedAt: NOW });
const ATLAS = item("context", "Atlas", {
  state: "stale",
  generatedAt: NOW,
  changes: { changed: 3, removed: 0, added: 0 },
});
const MARKETING = item("context", "Marketing", { running: true });
const all = () => [PROJETOS, PESSOAS, FINANCAS, ATLAS, MARKETING];

const SOURCES = [
  { fileId: 1, path: "/m/notes/ata.md", name: "ata.md", state: "same" as const },
  { fileId: 2, path: "/m/notes/plano.md", name: "plano.md", state: "changed" as const },
  { path: "/m/notes/velha.md", name: "velha.md", state: "removed" as const },
];
const FULL = detail(PROJETOS, {
  paragraphs: [
    paragraph("Os **projetos** seguem em duas frentes.", [
      ["ata.md", "Decisão", 1],
      ["plano.md", "Próximos passos", 2, "plano"],
    ]),
    paragraph("O orçamento fechou no prazo.", [["ata.md", "Orçamento", 1]]),
  ],
  sources: SOURCES,
  run: { id: "run-1", provider: "claude", startedAt: NOW, finishedAt: NOW + 42_000 },
});

/** The view with the five scopes; `PROJETOS` open when `open` is given. */
async function up(open: typeof PROJETOS | null = null, registry?: CommandRegistry) {
  kit.items = all();
  kit.details.set("area:Projetos", FULL);
  const m = mountSummaries({
    ...(open ? { search: searchOf(open) } : {}),
    ...(registry ? { registry } : {}),
  });
  await waitFor(() => expect(picks().length).toBeGreaterThan(0));
  if (open) await waitFor(() => expect(panel()!.querySelector(".sum-pname")).not.toBeNull());
  return m;
}
const nameOf = (r: Element) => r.querySelector(".sum-name")!.textContent;

describe("C119 the arrangement", () => {
  it("C119 the list column holds the header (Resumos and the support line) then the groups ÁREAS and CONTEXTOS in that order; the open summary holds header, stale band, paragraphs, Fontes and the card, top to bottom", async () => {
    await up(PROJETOS);
    const col = document.querySelector(".sum-view .sum-listcol")!;
    expect(col.querySelector(".sum-head h1")!.textContent).toBe("Resumos");
    expect(col.querySelector(".sum-head .sum-small")!.textContent).toBe(
      "O que cada área e cada contexto dizem, com as fontes. Gerar um resumo usa uma execução do Claude.",
    );
    const titles = [...col.querySelectorAll(".sum-group h2")];
    expect(titles.map((h) => h.textContent)).toEqual(["ÁREAS", "CONTEXTOS"]);
    expect(
      [col.querySelector(".sum-head")!, ...titles].every((n, i, list) => i === 0 || before(list[i - 1]!, n)),
    ).toBe(true);

    const p = panel()!;
    const parts = [
      p.querySelector(".sum-phead")!,
      p.querySelector(".sum-stale")!,
      p.querySelector(".sum-pars")!,
      p.querySelector(".notes-fold")!,
      p.querySelector(".sum-how")!,
    ];
    expect(parts.every(Boolean)).toBe(true);
    for (let i = 1; i < parts.length; i++) expect(before(parts[i - 1]!, parts[i]!)).toBe(true);
    const head = p.querySelector(".sum-phead")!;
    expect([...head.children].map((c) => c.className.split(" ")[0] || c.tagName)).toEqual([
      "sum-pname",
      "sum-small",
      "btn",
    ]);
    expect(head.querySelector(".sum-pname")!.textContent).toBe("Projetos");
    expect(head.querySelector(".sum-small")!.textContent).toBe("Área");
    expect(head.lastElementChild!.textContent).toBe(" Atualizar");
    expect(before(col, p)).toBe(true);
  });

  it("C119 the stylesheet: two columns, the list 320px and the summary the rest; one column below 720px, where an open summary hides the list and Voltar shows", () => {
    expect(rule(".sum-view .sum-cols")["grid-template-columns"]).toBe("320px minmax(0, 1fr)");
    expect(rule(".sum-view .sum-cols", "(max-width: 719px)")["grid-template-columns"]).toBe("minmax(0, 1fr)");
    expect(rule(".sum-view[data-open] .sum-listcol", "(max-width: 719px)").display).toBe("none");
    expect(rule(".sum-view:not([data-open]) .sum-panelcol", "(max-width: 719px)").display).toBe("none");
    expect(rule(".sum-view .sum-back").display).toBe("none");
    expect(rule(".sum-view .sum-back", "(max-width: 719px)").display).toBe("inline-flex");
    expect(rule(".sum-view .sum-phead > :last-child")["margin-inline-start"]).toBe("auto");
  });

  it("C119 an open summary sets data-open on the root and the panel starts with Voltar, which clears the scope from the route", async () => {
    const { setLocation } = await up(PROJETOS);
    expect(document.querySelector(".sum-view")!.hasAttribute("data-open")).toBe(true);
    const back = panel()!.querySelector(".sum-panel")!.firstElementChild as HTMLButtonElement;
    expect(back.textContent).toBe(" Voltar");
    fireEvent.click(back);
    expect(setLocation).toHaveBeenCalledWith({ pathname: "/brain/summaries", search: "" });
  });
});

describe("C121 the list rows", () => {
  it("C121 each state: Atual · 24/11 (CircleCheck), Velho: 3 mudaram, 1 saiu, 2 novas (Clock), Sem resumo (CircleDashed), Gerando… (Loader)", async () => {
    await up();
    const state = (name: string) => rowOf(name).querySelector(".sum-state")!;
    expect(state("Finanças").textContent).toBe("Atual · 24/11");
    expect(state("Finanças").querySelector("svg.lucide-circle-check")).not.toBeNull();
    expect(state("Projetos").textContent).toBe("Velho: 3 mudaram, 1 saiu, 2 novas");
    expect(state("Projetos").querySelector("svg.lucide-clock")).not.toBeNull();
    expect(state("Pessoas").textContent).toBe("Sem resumo");
    expect(state("Pessoas").querySelector("svg.lucide-circle-dashed")).not.toBeNull();
    expect(state("Marketing").textContent).toBe("Gerando…");
    expect(state("Marketing").querySelector("svg.lucide-loader")).not.toBeNull();
    expect(rule(".sum-view .sum-state")["font-size"]).toBe("var(--fs-2)");
    expect(rule(".sum-view .sum-name")["font-size"] ?? "var(--fs-3)").toBe("var(--fs-3)");
  });

  it("C121 only the counts that are not zero: changed 3 alone reads Velho: 3 mudaram", async () => {
    await up();
    expect(rowOf("Atlas").querySelector(".sum-state")!.textContent).toBe("Velho: 3 mudaram");
  });

  it("C121 the button is Gerar without a summary and Atualizar with one, disabled while generating", async () => {
    await up();
    const button = (name: string) => rowOf(name).querySelector<HTMLButtonElement>("button.btn.sm")!;
    expect(button("Pessoas").textContent).toBe("Gerar");
    expect(button("Finanças").textContent).toBe("Atualizar");
    expect(button("Projetos").textContent).toBe("Atualizar");
    expect(button("Marketing").disabled).toBe(true);
    expect(button("Pessoas").disabled).toBe(false);
  });

  it("C121 the names in order, areas then contexts; aria-current on the open one only", async () => {
    await up(PROJETOS);
    expect(picks().map((p) => p.querySelector(".sum-name")!.textContent)).toEqual([
      "Projetos",
      "Pessoas",
      "Finanças",
      "Atlas",
      "Marketing",
    ]);
    expect(picks().map((p) => p.getAttribute("aria-current"))).toEqual(["true", null, null, null, null]);
  });

  it("C121 j and k move in the list and Enter opens", async () => {
    const registry = new CommandRegistry();
    const { setLocation } = await up(null, registry);
    const user = userEvent.setup();
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("j");
    expect(document.activeElement).toBe(picks()[0]);
    await user.keyboard("j");
    expect(document.activeElement).toBe(picks()[1]);
    await user.keyboard("k");
    expect(document.activeElement).toBe(picks()[0]);
    await user.keyboard("{Enter}");
    expect(setLocation).toHaveBeenCalledWith({
      pathname: "/brain/summaries",
      search: "?kind=area&id=Projetos",
    });
  });

  it("C121 the row's button starts the summary of its scope with POST /api/memory/summaries and opens it", async () => {
    const { setLocation } = await up();
    on("start", only({ scope: { kind: "area", id: "Pessoas" } }, { id: "run-9", status: "running" }));
    fireEvent.click(rowOf("Pessoas").querySelector("button.btn.sm")!);
    await waitFor(() => expect(sent("start")).toEqual([{ scope: { kind: "area", id: "Pessoas" } }]));
    expect(setLocation).toHaveBeenCalledWith({
      pathname: "/brain/summaries",
      search: "?kind=area&id=Pessoas",
    });
  });
});

describe("C122 the open summary", () => {
  it("C122 paragraphs through Markdown with their citations nome § seção, buttons to /brain?sel=<fileId>, and the natureza chip on a plano note's", async () => {
    const { setLocation } = await up(PROJETOS);
    const pars = [...panel()!.querySelectorAll(".sum-par")];
    expect(pars).toHaveLength(2);
    expect(pars[0]!.querySelector(".sum-md strong")!.textContent).toBe("projetos");
    const cites = [...pars[0]!.querySelectorAll<HTMLButtonElement>("button.sum-link")];
    expect(cites.map((c) => c.textContent)).toEqual(["ata.md § Decisão", "plano.md § Próximos passos"]);
    expect(cites[0]!.querySelector("svg.lucide-file-text")).not.toBeNull();
    const items = [...pars[0]!.querySelectorAll(".sum-cite-item")];
    expect(items[0]!.querySelector(".badge")).toBeNull();
    expect(items[1]!.querySelector(".badge")!.textContent).toBe("Plano");
    fireEvent.click(cites[1]!);
    expect(setLocation).toHaveBeenCalledWith({ pathname: "/brain", search: "?sel=2" });
  });

  it("C122 the fold Fontes (3), closed: each source's name and state, igual (Check), mudou (PencilLine), saiu (X) with no link", async () => {
    const { setLocation } = await up(PROJETOS);
    const fold = panel()!.querySelector<HTMLElement>(".notes-fold")!;
    const head = fold.querySelector<HTMLButtonElement>(".notes-fold-head button")!;
    expect(head.textContent).toBe("Fontes (3)");
    expect(head.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(head);
    const lis = [...fold.querySelectorAll("li")];
    expect(lis.map((li) => li.textContent)).toEqual(["ata.mdigual", "plano.mdmudou", "velha.mdsaiu"]);
    expect(lis[0]!.querySelector("svg.lucide-check")).not.toBeNull();
    expect(lis[1]!.querySelector("svg.lucide-pencil-line")).not.toBeNull();
    expect(lis[2]!.querySelector("svg.lucide-x")).not.toBeNull();
    expect(lis[0]!.querySelector("button")).not.toBeNull();
    expect(lis[2]!.querySelector("button")).toBeNull();
    fireEvent.click(lis[1]!.querySelector("button")!);
    expect(setLocation).toHaveBeenCalledWith({ pathname: "/brain", search: "?sel=2" });
  });

  it("C122 the card Como este resumo foi feito: Feito por Claude em 42 s · 24/11, 10:00 and the link Ver a execução to the run", async () => {
    await up(PROJETOS);
    const card = panel()!.querySelector<HTMLElement>(".sum-how")!;
    expect(card.classList.contains("card")).toBe(true);
    expect(card.querySelector("h2")!.textContent).toBe("Como este resumo foi feito");
    expect(card.querySelector(".sum-small")!.textContent).toBe("Feito por Claude em 42 s · 24/11, 10:00");
    const link = card.querySelector("a")!;
    expect(link.textContent).toBe("Ver a execução");
    expect(link.getAttribute("href")).toBe("/runs/run-1");
  });
});

describe("C123 the stale band", () => {
  it("C123 the 2px left border in --warn on --surface-2, Clock, and Este resumo é de 24/11. Desde então: 3 fontes mudaram, 1 saiu, 2 arquivos novos.", async () => {
    await up(PROJETOS);
    const band = panel()!.querySelector<HTMLElement>(".sum-stale")!;
    expect(band.textContent).toBe(
      "Este resumo é de 24/11. Desde então: 3 fontes mudaram, 1 saiu, 2 arquivos novos.Atualizar",
    );
    expect(band.querySelector("svg.lucide-clock")).not.toBeNull();
    expect(rule(".sum-view .sum-stale")["border-inline-start"]).toBe("2px solid var(--warn)");
    expect(rule(".sum-view .sum-stale")["background"]).toBe("var(--surface-2)");
  });

  it("C123 only the parts that are not zero: added 2 alone reads … Desde então: 2 arquivos novos.", async () => {
    const only2 = item("area", "Projetos", {
      state: "stale",
      generatedAt: NOW,
      changes: { changed: 0, removed: 0, added: 2 },
    });
    kit.items = [only2];
    kit.details.set("area:Projetos", { ...FULL, ...only2 });
    mountSummaries({ search: searchOf(only2) });
    const band = await waitFor(() => {
      const b = panel()!.querySelector<HTMLElement>(".sum-stale");
      expect(b).not.toBeNull();
      return b!;
    });
    expect(band.querySelector("span")!.textContent).toBe(
      "Este resumo é de 24/11. Desde então: 2 arquivos novos.",
    );
  });

  it("C123 Atualizar of the band sends POST /api/memory/summaries with the scope", async () => {
    await up(PROJETOS);
    on("start", only({ scope: { kind: "area", id: "Projetos" } }, { id: "run-9", status: "running" }));
    fireEvent.click(
      within(panel()!.querySelector<HTMLElement>(".sum-stale")!).getByRole("button", { name: "Atualizar" }),
    );
    await waitFor(() => expect(sent("start")).toEqual([{ scope: { kind: "area", id: "Projetos" } }]));
  });

  it("C123 a fresh summary has no band", async () => {
    kit.items = [FINANCAS];
    kit.details.set("area:Finanças", detail(FINANCAS, { paragraphs: [paragraph("Tudo em dia.")] }));
    mountSummaries({ search: searchOf(FINANCAS) });
    await waitFor(() => expect(panel()!.querySelector(".sum-par")).not.toBeNull());
    expect(panel()!.querySelector(".sum-stale")).toBeNull();
  });
});

describe("C124 generating", () => {
  const running = detail(PROJETOS, { ...FULL, running: true });

  it("C124 Gerando… with a spinner in role=status and Cancelar in place of the button; the current summary's paragraphs stay below", async () => {
    kit.items = [{ ...PROJETOS, running: true }];
    kit.details.set("area:Projetos", running);
    mountSummaries({ search: searchOf(PROJETOS) });
    await waitFor(() => expect(panel()!.querySelector(".sum-par")).not.toBeNull());
    const head = panel()!.querySelector(".sum-phead")!;
    const status = head.querySelector('[role="status"]')!;
    expect(status.textContent).toBe(" Gerando…");
    expect(status.querySelector(".spinner")).not.toBeNull();
    expect(within(head as HTMLElement).queryByRole("button", { name: "Atualizar" })).toBeNull();
    expect(within(head as HTMLElement).getByRole("button", { name: "Cancelar" })).toBeTruthy();
    expect(panel()!.querySelectorAll(".sum-par")).toHaveLength(2);
  });

  it("C124 Cancelar finds the open run of the scope and calls the run cancel route", async () => {
    kit.items = [{ ...PROJETOS, running: true }];
    kit.details.set("area:Projetos", running);
    kit.active = [
      { id: "run-a", skillSlug: "other" },
      { id: "run-b", skillSlug: "brain-summarize" },
      { id: "run-c", skillSlug: "brain-summarize" },
    ];
    const request = (scope: string) => ({
      run: { request: { kind: "skill", inputs: { scope } } },
      events: [],
    });
    kit.runs.set("run-b", request("area:Pessoas"));
    kit.runs.set("run-c", request("area:Projetos"));
    const cancelled: string[] = [];
    on("POST /api/runs/run-c/cancel", () => {
      cancelled.push("run-c");
      return Promise.resolve({ cancelled: true });
    });
    on("POST /api/runs/run-b/cancel", () => Promise.reject(new NetError(500, "wrong_run")));
    mountSummaries({ search: searchOf(PROJETOS) });
    await waitFor(() => expect(panel()!.querySelector(".sum-par")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(cancelled).toEqual(["run-c"]));
  });
});

describe("C125 a failed or refused newest run", () => {
  it("C125 the role=alert band O último resumo não foi aceito. with lastError below and Tentar de novo, which sends the POST; the current summary stays", async () => {
    const failed = detail(PROJETOS, { ...FULL, lastError: "O resumo cita um arquivo fora do escopo." });
    kit.items = [PROJETOS];
    kit.details.set("area:Projetos", failed);
    mountSummaries({ search: searchOf(PROJETOS) });
    const band = await waitFor(() => {
      const b = panel()!.querySelector<HTMLElement>('[role="alert"]');
      expect(b).not.toBeNull();
      return b!;
    });
    const lines = [...band.querySelectorAll("p")].map((p) => p.textContent);
    expect(lines).toEqual(["O último resumo não foi aceito.", "O resumo cita um arquivo fora do escopo."]);
    expect(band.querySelector("svg.lucide-triangle-alert, svg.lucide-alert-triangle")).not.toBeNull();
    expect(panel()!.querySelectorAll(".sum-par")).toHaveLength(2);
    on("start", only({ scope: { kind: "area", id: "Projetos" } }, { id: "run-9", status: "running" }));
    fireEvent.click(within(band).getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(sent("start")).toHaveLength(1));
  });

  it("C125 with no summary at all the band shows too, over the no-summary state", async () => {
    const none = detail(PESSOAS, { lastError: "A execução terminou em failed." });
    kit.items = [PESSOAS];
    kit.details.set("area:Pessoas", none);
    mountSummaries({ search: searchOf(PESSOAS) });
    await waitFor(() => expect(panel()!.querySelector('[role="alert"]')).not.toBeNull());
    expect(panel()!.querySelector(".sum-none")).not.toBeNull();
  });
});

describe("C126 skill_unavailable", () => {
  it("C126 a 409 skill_unavailable shows Lock, Resumos está desligado: … and Ligar, which sends memorySkills = the stored list plus brain-summarize at the end", async () => {
    await up(PESSOAS);
    kit.details.set("area:Pessoas", detail(PESSOAS));
    on("start", () => Promise.reject(new NetError(409, "skill_unavailable")));
    fireEvent.click(rowOf("Pessoas").querySelector("button.btn.sm")!);
    const off = await waitFor(() => {
      const o = panel()!.querySelector<HTMLElement>(".sum-off");
      expect(o).not.toBeNull();
      return o!;
    });
    expect(off.querySelector("p")!.textContent).toBe(
      " Resumos está desligado: a skill brain-summarize não pode ler a memória.",
    );
    expect(off.querySelector("svg.lucide-lock")).not.toBeNull();
    on("settings", only({ memorySkills: ["recall", "x", "brain-summarize"] }, {}));
    fireEvent.click(within(off).getByRole("button", { name: "Ligar" }));
    await waitFor(() =>
      expect(sent("settings")).toEqual([{ memorySkills: ["recall", "x", "brain-summarize"] }]),
    );
    await waitFor(() => expect(panel()!.querySelector(".sum-off")).toBeNull());
  });

  it("C126 the skill already listed is not added twice", async () => {
    kit.settings = { defaultProvider: "claude", memorySkills: ["brain-summarize", "x"] };
    await up(PESSOAS);
    kit.details.set("area:Pessoas", detail(PESSOAS));
    on("start", () => Promise.reject(new NetError(409, "skill_unavailable")));
    fireEvent.click(rowOf("Pessoas").querySelector("button.btn.sm")!);
    on("settings", only({ memorySkills: ["brain-summarize", "x"] }, {}));
    fireEvent.click(await screen.findByRole("button", { name: "Ligar" }));
    await waitFor(() => expect(sent("settings")).toEqual([{ memorySkills: ["brain-summarize", "x"] }]));
  });
});

describe("C127 what the off state and an empty scope replace", () => {
  it("C127 the off state replaces only the summary's body: the header with the name and the kind stays, and so does the list column", async () => {
    await up(PROJETOS);
    on("start", () => Promise.reject(new NetError(409, "skill_unavailable")));
    fireEvent.click(
      within(panel()!.querySelector<HTMLElement>(".sum-stale")!).getByRole("button", { name: "Atualizar" }),
    );
    await waitFor(() => expect(panel()!.querySelector(".sum-off")).not.toBeNull());
    const head = panel()!.querySelector(".sum-phead")!;
    expect(head.querySelector(".sum-pname")!.textContent).toBe("Projetos");
    expect(head.querySelector(".sum-small")!.textContent).toBe("Área");
    expect(panel()!.querySelector(".sum-par")).toBeNull();
    expect(panel()!.querySelector(".sum-stale")).toBeNull();
    expect(picks().map(nameOf)).toEqual(["Projetos", "Pessoas", "Finanças", "Atlas", "Marketing"]);
    expect(document.querySelector(".sum-view .sum-head h1")!.textContent).toBe("Resumos");
  });

  it("C127 409 empty_scope reads Pessoas ainda não tem notas para resumir. in place of the body, the header and the list staying", async () => {
    await up(PESSOAS);
    kit.details.set("area:Pessoas", detail(PESSOAS));
    on("start", () => Promise.reject(new NetError(409, "empty_scope")));
    fireEvent.click(rowOf("Pessoas").querySelector("button.btn.sm")!);
    await waitFor(() => expect(screen.getByText("Pessoas ainda não tem notas para resumir.")).toBeTruthy());
    expect(panel()!.querySelector(".sum-pname")!.textContent).toBe("Pessoas");
    expect(panel()!.querySelector(".sum-none")).toBeNull();
    expect(picks()).toHaveLength(5);
  });
});

describe("C128 no summary, no scope, loading and error", () => {
  it("C128 no summary: FileQuestion, Ainda não há resumo de Pessoas. and a primary Gerar", async () => {
    kit.items = all();
    kit.details.set("area:Pessoas", detail(PESSOAS));
    mountSummaries({ search: searchOf(PESSOAS) });
    const none = await waitFor(() => {
      const n = panel()!.querySelector<HTMLElement>(".sum-none");
      expect(n).not.toBeNull();
      return n!;
    });
    expect(none.querySelector("p")!.textContent).toBe(" Ainda não há resumo de Pessoas.");
    expect(none.querySelector("svg.lucide-file-question, svg.lucide-file-question-mark")).not.toBeNull();
    const make = within(none).getByRole("button", { name: "Gerar" });
    expect(make.className).toContain("primary");
    on("start", only({ scope: { kind: "area", id: "Pessoas" } }, { id: "run-9", status: "running" }));
    fireEvent.click(make);
    await waitFor(() => expect(sent("start")).toHaveLength(1));
  });

  it("C128 no area nor context: Layers, Nenhuma área nem contexto para resumir. and the link Criar uma área nas Configurações to Settings > Memória", async () => {
    kit.items = [];
    mountSummaries();
    const empty = await waitFor(() => {
      const e = document.querySelector<HTMLElement>(".sum-view .sum-empty");
      expect(e).not.toBeNull();
      return e!;
    });
    expect(empty.querySelector("p")!.textContent).toBe(" Nenhuma área nem contexto para resumir.");
    expect(empty.querySelector("svg.lucide-layers")).not.toBeNull();
    const link = within(empty).getByRole("link", { name: "Criar uma área nas Configurações" });
    expect(link.getAttribute("href")).toBe("/settings?tab=memory");
    expect(document.querySelector(".sum-view .sum-group")).toBeNull();
  });

  it("C128 the list loading is Carregando… in role=status; its error is Não deu para carregar os resumos. with Tentar de novo, which asks again", async () => {
    kit.list = "pending";
    const { unmount } = mountSummaries();
    const status = await waitFor(() => {
      const s = document.querySelector<HTMLElement>('.sum-view [role="status"]');
      expect(s).not.toBeNull();
      return s!;
    });
    expect(status.textContent).toBe(" Carregando…");
    unmount();
    cleanup();
    kit.list = new NetError(500, "boom");
    mountSummaries();
    const alert = await waitFor(() => {
      const a = document.querySelector<HTMLElement>('.sum-view [role="alert"]');
      expect(a).not.toBeNull();
      return a!;
    });
    expect(alert.querySelector("span")!.textContent).toBe("Não deu para carregar os resumos.");
    kit.list = null;
    kit.items = all();
    fireEvent.click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(picks()).toHaveLength(5));
  });

  it("C128 the open summary's own load fails with the same words and asks again", async () => {
    kit.items = [PROJETOS];
    kit.details.set("area:Projetos", new NetError(500, "boom"));
    mountSummaries({ search: searchOf(PROJETOS) });
    const alert = await waitFor(() => {
      const a = panel()!.querySelector<HTMLElement>('[role="alert"]');
      expect(a).not.toBeNull();
      return a!;
    });
    expect(alert.querySelector("span")!.textContent).toBe("Não deu para carregar os resumos.");
    kit.details.set("area:Projetos", FULL);
    fireEvent.click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(panel()!.querySelector(".sum-par")).not.toBeNull());
    expect(net.calls.filter((c) => c.url === "/api/memory/summaries/area/Projetos").length).toBeGreaterThan(
      1,
    );
  });
});
