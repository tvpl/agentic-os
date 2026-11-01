// @vitest-environment jsdom
/**
 * "Revisões", the tab "Do agente", in rendered components (.specs/features/cerebro-memoria-confiavel, C88-C96; design.md
 * "Tela - Revisões, aba Do agente"): the three tabs and `?tab=agent`, each list item's two lines by kind, the detail top
 * to bottom and an op row left to right, the checkboxes' first state, accepting with the ticked ops and the shown
 * `baseVersion`, the two refusals, rejecting through a `Modal`, the empty, loading and failed tab, and the keys in both
 * shells. The network is `../notes/testnet` with the routes of `./testkit`, whose proposals list answers
 * `?status=pending` only (L-052).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import postcss from "postcss";
import type * as ApiModule from "../../api";
import { installPage } from "../../ui/testkit";
import { mountShell } from "../../commands/testkit";
import { asked, resetNet } from "../notes/testnet";
import {
  MEM,
  NetError,
  accepted,
  detailOf,
  item,
  list,
  mountReviews,
  net,
  op,
  pending,
  proposal,
  proposals,
  resetProposals,
  resetReviews,
  sent,
} from "./testkit";

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
  resetProposals();
});

const css = (file: string) => postcss.parse(readFileSync(join(__dirname, file), "utf8"));
/** The declarations of the root rules of `file` whose selector list holds `selector`. */
function rule(file: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  css(file).walkRules((r) => {
    if (r.parent?.type !== "root" || !r.selectors.includes(selector)) return;
    r.walkDecls((d) => void (out[d.prop] = d.value));
  });
  return out;
}
const before = (a: Element, b: Element) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const inOrder = (els: Element[]) => els.every((el, i) => i === 0 || before(els[i - 1]!, el));
const flush = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const titles = () => [...document.querySelectorAll(".rv-item .rv-name")].map((e) => e.textContent);
const selected = () => document.querySelector('.rv-pick[aria-current="true"] .rv-name')?.textContent;
const detailEl = () => document.querySelector<HTMLElement>(".ag-detail")!;
const pad = (n: number) => String(n).padStart(2, "0");
const day = (at: number) => {
  const d = new Date(at);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const HOURS_2 = Date.now() - 2 * 3_600_000;
const DIFF = "--- a/MEMORY.md\n+++ b/MEMORY.md\n@@ -1,2 +1,2 @@\n ## Decisions\n-- antiga\n+- nova\n";

/** The two review tabs as the natureza claims count them. */
function reviewTabs() {
  list({}, [item("notes/a.md"), item("notes/b.md")]);
  list(
    { kind: "unclassified" },
    Array.from({ length: 5 }, (_, i) => item(`notes/u${i}.md`)),
  );
}

/** One consolidation, open on the tab, with the given ops. */
async function oneConsolidation(ops = [op()], over: Parameters<typeof proposal>[0] = {}) {
  const p = proposal({ opCount: ops.length, ...over });
  pending([p]);
  detailOf(p, { ops, diff: DIFF });
  mountReviews({ search: "?tab=agent" });
  await waitFor(() => expect(document.querySelector(".ag-detail")).not.toBeNull());
  return p;
}

/* ---------------- C88: the third tab ---------------- */

describe("C88 the tabs of Revisões", () => {
  it("C88 three Tabs in order, Para revisar (2), Sem classificação (5), Do agente (3), N the total of ?status=pending only", async () => {
    reviewTabs();
    pending([proposal(), proposal(), proposal()]);
    mountReviews();
    await waitFor(() =>
      expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
        "Para revisar (2)",
        "Sem classificação (5)",
        "Do agente (3)",
      ]),
    );
    const tabs = screen.getAllByRole("tab");
    expect(inOrder(tabs)).toBe(true);
    expect(asked("/api/memory/proposals").map(String)).toEqual(
      asked("/api/memory/proposals").map(() => "status=pending"),
    );
    expect(asked("/api/memory/proposals").length).toBeGreaterThan(0);
  });

  it("C88 a total the mock answers for another query is not what the tab shows", async () => {
    // the list's own items say 3; the total says 7: the tab counts the route's `total`
    pending([proposal(), proposal(), proposal()], 7);
    mountReviews();
    await waitFor(() => expect(screen.getByRole("tab", { name: "Do agente (7)" })).toBeTruthy());
  });

  it("C88 /brain/reviews?tab=agent opens with Do agente selected", async () => {
    reviewTabs();
    pending([proposal()]);
    mountReviews({ search: "?tab=agent" });
    const tab = await screen.findByRole("tab", { name: /^Do agente/ });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: /^Para revisar/ }).getAttribute("aria-selected")).toBe("false");
  });

  for (const search of ["?tab=due", ""])
    it(`C88 ${search || "no tab"} opens Para revisar`, async () => {
      reviewTabs();
      pending([proposal()]);
      mountReviews({ search });
      const tab = await screen.findByRole("tab", { name: /^Para revisar/ });
      expect(tab.getAttribute("aria-selected")).toBe("true");
      expect(screen.getByRole("tab", { name: /^Do agente/ }).getAttribute("aria-selected")).toBe("false");
    });
});

/* ---------------- C89: the list items ---------------- */

describe("C89 each list item, newest first as the route answered", () => {
  it("C89 line 1 the title by kind, one case each, in the route's order; line 2 the author, há 2 horas and the op count", async () => {
    const items = [
      proposal({ kind: "consolidation", createdAt: HOURS_2, opCount: 3 }),
      proposal({ kind: "memory_edit", author: "run:a1b2c3", opCount: 1 }),
      proposal({
        kind: "fact",
        author: "mcp",
        runId: null,
        summary: "Cliente X · status · ativo",
        opCount: 1,
      }),
      proposal({ kind: "note_create", author: "mcp", runId: null, summary: "Reunião", opCount: 1 }),
      proposal({ kind: "note_save", author: "mcp", runId: null, summary: "cliente.md", opCount: 1 }),
    ];
    pending(items);
    for (const p of items) detailOf(p);
    mountReviews({ search: "?tab=agent" });
    await waitFor(() => expect(titles()).toHaveLength(5));
    expect(titles()).toEqual([
      `Consolidação de ${day(HOURS_2)}`,
      "Mudança no MEMORY.md por Execução a1b2c3",
      "Fato: Cliente X · status",
      "Nova nota: Reunião",
      "Edição de cliente",
    ]);
    const li = document.querySelectorAll<HTMLElement>(".rv-item")[0]!;
    // line 1 is the 13px weight-600 class; line 2 the 12px secondary one
    expect(li.querySelector(".rv-line1 > .rv-name")).not.toBeNull();
    expect(rule("reviews.css", ".rv-name")).toMatchObject({
      "font-size": "var(--fs-3)",
      "font-weight": "600",
    });
    expect(rule("reviews.css", ".rv-line2")).toMatchObject({
      color: "var(--text-dim)",
      "font-size": "var(--fs-2)",
    });
    expect([...li.querySelector(".rv-line2")!.children].map((c) => c.textContent)).toEqual([
      "Execução a1b2c3",
      "há 2 horas",
      "3 operações",
    ]);
    const second = document.querySelectorAll<HTMLElement>(".rv-item")[2]!;
    expect([...second.querySelector(".rv-line2")!.children].map((c) => c.textContent)[0]).toBe(
      "Agente (MCP)",
    );
    expect(second.querySelector(".rv-line2")!.lastElementChild!.textContent).toBe("1 operação");
  });

  it("C89 j and k move the selection and Enter on an item opens it", async () => {
    const items = [
      proposal({ kind: "note_create", summary: "Alfa" }),
      proposal({ kind: "note_create", summary: "Beta" }),
      proposal({ kind: "note_create", summary: "Gama" }),
    ];
    pending(items);
    for (const p of items) detailOf(p, { diff: "@@ -0,0 +1 @@\n+x\n" });
    mountReviews({ search: "?tab=agent" });
    await waitFor(() => expect(selected()).toBe("Nova nota: Alfa"));
    const user = userEvent.setup();
    await user.keyboard("j");
    await waitFor(() => expect(selected()).toBe("Nova nota: Beta"));
    await user.keyboard("j");
    await waitFor(() => expect(selected()).toBe("Nova nota: Gama"));
    await user.keyboard("k");
    await waitFor(() => expect(selected()).toBe("Nova nota: Beta"));
    document.querySelectorAll<HTMLButtonElement>(".rv-pick")[0]!.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(selected()).toBe("Nova nota: Alfa"));
    await waitFor(() =>
      expect(detailEl().querySelector(".ag-diff-title")!.textContent).toBe("O que muda em Alfa"),
    );
  });
});

/* ---------------- C90: the detail ---------------- */

describe("C90 the detail top to bottom", () => {
  it("C90 a consolidation: summary, author, the diff, Marcar todas then Desmarcar todas, the ops, then Aceitar selecionadas (1) and Recusar", async () => {
    await oneConsolidation();
    const d = detailEl();
    const summary = d.querySelector(".ag-summary")!;
    expect(summary.textContent).toBe("Três decisões da semana.");
    const author = d.querySelector(".mc-author")!;
    expect(author.textContent).toBe("Execução a1b2c3");
    expect(author.querySelector("svg.lucide-bot")).not.toBeNull();
    const title = d.querySelector(".ag-diff-title")!;
    expect(title.textContent).toBe("O que muda no MEMORY.md");
    const diff = d.querySelector(".ag-diff")!;
    expect(rule("agent.css", ".ag-diff")).toMatchObject({ "max-height": "50%", overflow: "auto" });
    expect([...diff.querySelectorAll(".mc-sign")].map((s) => s.textContent)).toEqual(["", "", "-", "+"]);
    expect(rule("../memoriaDiff.css", ".mc-diff table")).toMatchObject({
      "font-family": "var(--font-mono)",
      "font-size": "var(--fs-2)",
    });
    const all = within(d).getByRole("button", { name: "Marcar todas" });
    const none = within(d).getByRole("button", { name: "Desmarcar todas" });
    expect(all.className).toBe("btn ghost sm");
    expect(none.className).toBe("btn ghost sm");
    const ops = d.querySelector(".ag-ops")!;
    const accept = within(d).getByRole("button", { name: "Aceitar selecionadas (1)" });
    const reject = within(d).getByRole("button", { name: "Recusar" });
    expect(accept.className).toBe("btn primary");
    expect(accept.querySelector("svg.lucide-check")).not.toBeNull();
    expect(reject.className).toBe("btn");
    expect(reject.querySelector("svg.lucide-x")).not.toBeNull();
    expect(inOrder([summary, author, title, diff, all, none, ops, accept, reject])).toBe(true);
  });

  it("C90 an op row left to right: the checkbox, the section, the text, the source opening the notes view at the line, the trust badge", async () => {
    await oneConsolidation();
    const row = detailEl().querySelector(".ag-op")!;
    const cells = [...row.children];
    expect(
      cells.map((c) => c.tagName.toLowerCase() + (c.className ? `.${c.className.split(" ").join(".")}` : "")),
    ).toEqual([
      "input",
      "span.ag-section",
      "span.ag-text",
      "a.ag-source",
      "span.badge.meta.mc-trust.tone-ok",
    ]);
    expect((cells[0] as HTMLInputElement).type).toBe("checkbox");
    expect(cells[1]!.textContent).toBe("Decisions");
    expect(cells[2]!.textContent).toBe("Usar SQLite para o histórico");
    const link = cells[3] as HTMLAnchorElement;
    expect(link.textContent).toBe("journal/2026-09-03.md:12");
    const [path, query] = link.getAttribute("href")!.split("?");
    expect(path).toBe("#/brain/notes");
    const q = new URLSearchParams(query);
    expect(q.get("open")).toBe(`${MEM}/journal/2026-09-03.md`);
    expect(q.get("line")).toBe("12");
    expect(cells[4]!.textContent).toBe("Escrito por você");
  });

  it("C90 a note_save shows O que muda em cliente and only Aceitar then Recusar, with no op list", async () => {
    const p = proposal({ kind: "note_save", author: "mcp", runId: null, summary: "cliente.md", opCount: 1 });
    pending([p]);
    detailOf(p, { diff: "@@ -1 +1 @@\n-a\n+b\n", baseVersion: "sha256:n1" });
    mountReviews({ search: "?tab=agent" });
    await waitFor(() => expect(document.querySelector(".ag-detail")).not.toBeNull());
    const d = detailEl();
    expect(d.querySelector(".ag-diff-title")!.textContent).toBe("O que muda em cliente");
    expect(d.querySelector(".ag-ops")).toBeNull();
    expect(within(d).queryByRole("button", { name: "Marcar todas" })).toBeNull();
    expect([...d.querySelectorAll(".rv-acts button")].map((b) => b.textContent)).toEqual([
      "Aceitar",
      "Recusar",
    ]);
  });
});

/* ---------------- C91: the checkboxes ---------------- */

describe("C91 the checkboxes' first state, one case per row", () => {
  const FIVE = [
    op({ text: "um", trust: "usuario" }),
    op({ text: "dois", trust: "ferramenta" }),
    op({ text: "tres", trust: "inferido" }),
    op({ text: "quatro", state: "invalid", reason: "journal/2099-01-01.md não existe" }),
    op({ text: "cinco", state: "conflict", reason: "a linha não está no MEMORY.md" }),
  ];
  const box = (name: string) => screen.getByRole("checkbox", { name }) as HTMLInputElement;

  it("C91 valid usuario ticked; valid ferramenta and inferido unticked; invalid and conflict disabled with their icon, name and reason in 12px below the text", async () => {
    await oneConsolidation(FIVE);
    expect([box("um").checked, box("um").disabled]).toEqual([true, false]);
    expect([box("dois").checked, box("dois").disabled]).toEqual([false, false]);
    expect([box("tres").checked, box("tres").disabled]).toEqual([false, false]);
    expect([box("quatro").checked, box("quatro").disabled]).toEqual([false, true]);
    expect([box("cinco").checked, box("cinco").disabled]).toEqual([false, true]);
    const rows = [...detailEl().querySelectorAll(".ag-op")];
    const state = (i: number) => rows[i]!.querySelector(".ag-text > .mc-opstate")!;
    expect(state(3).querySelector("svg.lucide-circle-slash")).not.toBeNull();
    expect(state(3).textContent).toBe("Origem inválidajournal/2099-01-01.md não existe");
    expect(state(4).querySelector("svg.lucide-triangle-alert, svg.lucide-alert-triangle")).not.toBeNull();
    expect(state(4).textContent).toBe("A linha mudoua linha não está no MEMORY.md");
    // below the text: after it in the text cell, which stacks; 12px
    expect(before(rows[3]!.querySelector(".ag-text > span")!, state(3))).toBe(true);
    expect(rule("agent.css", ".ag-text")).toMatchObject({ display: "flex", "flex-direction": "column" });
    expect(rule("../memoria.css", ".mc-opstate")).toMatchObject({ "font-size": "var(--fs-2)" });
    for (const i of [0, 1, 2]) expect(rows[i]!.querySelector(".mc-opstate")).toBeNull();
  });

  it("C91 none ticked disables Aceitar selecionadas (0); Marcar todas ticks only the enabled ones; Desmarcar todas unticks them", async () => {
    await oneConsolidation(FIVE);
    const user = userEvent.setup();
    await user.click(box("um"));
    const accept = within(detailEl()).getByRole("button", { name: "Aceitar selecionadas (0)" });
    expect((accept as HTMLButtonElement).disabled).toBe(true);
    await user.click(button("Marcar todas"));
    expect(["um", "dois", "tres", "quatro", "cinco"].map((n) => box(n).checked)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(within(detailEl()).getByRole("button", { name: "Aceitar selecionadas (3)" })).toBeTruthy();
    await user.click(button("Desmarcar todas"));
    expect(["um", "dois", "tres", "quatro", "cinco"].map((n) => box(n).checked)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

/* ---------------- C92: accepting ---------------- */

describe("C92 Aceitar selecionadas", () => {
  it("C92 sends exactly the ticked ops and the shown baseVersion; the item leaves, the notice with Ver histórico is up at 7 999 ms and gone at 8 000 ms", async () => {
    const ops = [op({ text: "a" }), op({ text: "b", trust: "ferramenta" }), op({ text: "c" })];
    const p = proposal({ opCount: 3 });
    // a second item, so the list stays and the selection moves to it
    const other = proposal({ kind: "note_create", summary: "Outra" });
    pending([p, other]);
    detailOf(p, { ops, diff: DIFF });
    detailOf(other, { diff: "@@ -0,0 +1 @@\n+x\n" });
    mountReviews({ search: "?tab=agent" });
    await waitFor(() => expect(document.querySelector(".ag-ops")).not.toBeNull());
    proposals.decide = () => Promise.resolve(accepted(p, [{ path: "MEMORY.md", version: "sha256:mem2" }]));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(button("Aceitar selecionadas (2)"));
    await flush();
    expect(sent("POST", `/api/memory/proposals/${p.id}/decide`)).toEqual([
      { action: "accept", ops: [0, 2], baseVersion: "sha256:mem1" },
    ]);
    act(() => void vi.advanceTimersByTime(150));
    expect(titles()).toEqual(["Nova nota: Outra"]);
    expect(document.activeElement?.querySelector(".rv-name")?.textContent).toBe("Nova nota: Outra");
    const notice = document.querySelector(".rv-notice")!;
    expect(notice.textContent).toBe("Proposta aceita.Ver histórico");
    const link = within(notice as HTMLElement).getByRole("link", { name: "Ver histórico" });
    expect(new URLSearchParams(link.getAttribute("href")!.split("?")[1]).get("open")).toBe(
      `${MEM}/MEMORY.md`,
    );
    expect(link.getAttribute("href")!.startsWith("#/brain/notes?")).toBe(true);
    act(() => void vi.advanceTimersByTime(7_999 - 150));
    expect(document.querySelector(".rv-notice")).not.toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(document.querySelector(".rv-notice")).toBeNull();
  });

  it("C92 a memory_edit's Aceitar sends { action: accept, baseVersion } with no ops", async () => {
    const p = proposal({ kind: "memory_edit", opCount: 1 });
    pending([p]);
    detailOf(p, { diff: DIFF, baseVersion: "sha256:mem7" });
    proposals.decide = () => Promise.resolve(accepted(p, [{ path: "MEMORY.md", version: "sha256:mem8" }]));
    mountReviews({ search: "?tab=agent" });
    await waitFor(() => expect(document.querySelector(".ag-detail")).not.toBeNull());
    fireEvent.click(within(detailEl()).getByRole("button", { name: "Aceitar" }));
    await flush();
    expect(sent("POST", `/api/memory/proposals/${p.id}/decide`)).toEqual([
      { action: "accept", baseVersion: "sha256:mem7" },
    ]);
  });
});

/* ---------------- C93: the refusals ---------------- */

describe("C93 a refused decision keeps the item", () => {
  it("C93 409 edit_conflict: AlertTriangle, the text and Recarregar, which asks for the proposal again; the item stays selected", async () => {
    const p = await oneConsolidation();
    proposals.decide = () => Promise.reject(new NetError(409, "edit_conflict", "The file changed"));
    fireEvent.click(button("Aceitar selecionadas (1)"));
    const banner = await waitFor(() => {
      const el = detailEl().querySelector<HTMLElement>(".ag-banner");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(banner.querySelector("svg.lucide-triangle-alert, svg.lucide-alert-triangle")).not.toBeNull();
    expect(banner.textContent).toBe("O MEMORY.md mudou desde que a proposta foi aberta.Recarregar");
    expect(titles()).toHaveLength(1);
    expect(selected()).toBe(`Consolidação de ${day(p.createdAt)}`);
    const reads = () => net.calls.filter((c) => c.url === `/api/memory/proposals/${p.id}`).length;
    const n = reads();
    fireEvent.click(within(banner).getByRole("button", { name: "Recarregar" }));
    await waitFor(() => expect(reads()).toBe(n + 1));
  });

  it("C93 409 memory_over_budget: the ceiling's text; the item stays selected", async () => {
    const p = await oneConsolidation();
    proposals.decide = () => Promise.reject(new NetError(409, "memory_over_budget", "over"));
    fireEvent.click(button("Aceitar selecionadas (1)"));
    const banner = await waitFor(() => {
      const el = detailEl().querySelector<HTMLElement>(".ag-banner");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(banner.textContent).toBe(
      "Com estas operações o MEMORY.md passaria de 200 linhas ou 25 KB. Desmarque operações ou peça uma nova consolidação.",
    );
    expect(titles()).toHaveLength(1);
    expect(selected()).toBe(`Consolidação de ${day(p.createdAt)}`);
  });
});

/* ---------------- C94: rejecting ---------------- */

describe("C94 Recusar asks first", () => {
  it("C94 a Modal Recusar esta proposta? with its text, Cancelar then Recusar (.btn.danger); Cancelar sends nothing; only the modal's Recusar sends reject", async () => {
    const p = await oneConsolidation();
    proposals.decide = () => Promise.resolve(accepted(p));
    const user = userEvent.setup();
    await user.click(within(detailEl()).getByRole("button", { name: "Recusar" }));
    let dialog = await screen.findByRole("dialog", { name: "Recusar esta proposta?" });
    expect(dialog.textContent).toContain("Nada será gravado. A proposta fica no histórico de propostas.");
    const footer = [...dialog.querySelectorAll(".modal-actions button")];
    expect(footer.map((b) => b.textContent)).toEqual(["Cancelar", "Recusar"]);
    expect(footer[1]!.className).toBe("btn danger");
    expect(sent("POST", `/api/memory/proposals/${p.id}/decide`)).toEqual([]);
    await user.click(footer[0]!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sent("POST", `/api/memory/proposals/${p.id}/decide`)).toEqual([]);
    await user.click(within(detailEl()).getByRole("button", { name: "Recusar" }));
    dialog = await screen.findByRole("dialog", { name: "Recusar esta proposta?" });
    await user.click(within(dialog).getByRole("button", { name: "Recusar" }));
    await waitFor(() =>
      expect(sent("POST", `/api/memory/proposals/${p.id}/decide`)).toEqual([{ action: "reject" }]),
    );
  });
});

/* ---------------- C95: empty, loading, failed ---------------- */

describe("C95 the tab's states", () => {
  it("C95 total 0: the 32px Inbox, Nada do agente para revisar. and Consolidar agora, which starts consolidate-memory once and then says so", async () => {
    pending([]);
    proposals.run = () => Promise.resolve({ runId: "r1", status: "queued" });
    mountReviews({ search: "?tab=agent" });
    const empty = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".ag-empty");
      expect(el).not.toBeNull();
      return el!;
    });
    const icon = empty.querySelector("svg.lucide-inbox")!;
    expect(icon.getAttribute("width")).toBe("32");
    expect(empty.textContent).toContain("Nada do agente para revisar.");
    const go = within(empty).getByRole("button", { name: "Consolidar agora" });
    expect(go.className).toBe("btn");
    expect(go.querySelector("svg.lucide-sparkles")).not.toBeNull();
    fireEvent.click(go);
    await waitFor(() =>
      expect(empty.textContent).toContain("Consolidação iniciada. A proposta aparece aqui quando terminar."),
    );
    expect(
      net.calls.filter((c) => c.method === "POST" && c.url === "/api/skills/consolidate-memory/run"),
    ).toHaveLength(1);
  });

  it("C95 while the list loads: Carregando…", async () => {
    proposals.list = "pending";
    mountReviews({ search: "?tab=agent" });
    await waitFor(() => expect(document.querySelector(".rv-state")?.textContent).toBe("Carregando…"));
  });

  it("C95 when the list fails: the message and Tentar de novo, which asks again", async () => {
    proposals.list = new NetError(500, "boom", "falhou a lista");
    mountReviews({ search: "?tab=agent" });
    const failed = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('.rv-state[role="alert"]');
      expect(el?.textContent).toContain("falhou a lista");
      return el!;
    });
    const n = asked("/api/memory/proposals").length;
    pending([]);
    fireEvent.click(within(failed).getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(asked("/api/memory/proposals").length).toBe(n + 1));
    await waitFor(() => expect(document.querySelector(".ag-empty")).not.toBeNull());
  });
});

/* ---------------- C96: the keys, both shells ---------------- */

describe("C96 the keys of Do agente, and the Núcleo", () => {
  it("C96 j, k and Enter act; a, v, r and Enter away from a button send no request", async () => {
    const items = [proposal({ summary: "um" }), proposal({ summary: "dois" })];
    pending(items);
    for (const p of items) detailOf(p, { ops: [op()], diff: DIFF });
    proposals.decide = (id) => Promise.resolve(accepted(items.find((p) => p.id === id)!));
    mountReviews({ search: "?tab=agent" });
    await waitFor(() => expect(document.querySelector(".ag-detail")).not.toBeNull());
    const user = userEvent.setup();
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("j");
    await waitFor(() =>
      expect(document.querySelectorAll(".rv-pick")[1]!.getAttribute("aria-current")).toBe("true"),
    );
    await user.keyboard("k");
    await waitFor(() =>
      expect(document.querySelectorAll(".rv-pick")[0]!.getAttribute("aria-current")).toBe("true"),
    );
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("a");
    await user.keyboard("v");
    await user.keyboard("r");
    await user.keyboard("{Enter}");
    await flush();
    expect(net.calls.filter((c) => c.method === "POST")).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    document.querySelectorAll<HTMLButtonElement>(".rv-pick")[1]!.focus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(document.querySelectorAll(".rv-pick")[1]!.getAttribute("aria-current")).toBe("true"),
    );
    expect(net.calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("C96 in the Núcleo's Revisões scene panel the same tab and items render", async () => {
    window.localStorage.setItem(
      "mordomo.onboarding.v1",
      JSON.stringify({ version: 1, status: "completed", step: 12, visited: [], practiced: false }),
    );
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
    const p = proposal({ kind: "note_create", summary: "Reunião" });
    pending([p]);
    detailOf(p, { diff: "@@ -0,0 +1 @@\n+x\n" });
    net.prefs.shell = "nucleo";
    await mountShell("/brain/reviews?tab=agent", "nucleo", "pt-BR");
    const panel = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".nu-shell .bs-notes .rv");
      expect(el).not.toBeNull();
      return el!;
    });
    await waitFor(() =>
      expect(within(panel).getByRole("tab", { name: "Do agente (1)" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );
    await waitFor(() =>
      expect(panel.querySelector(".rv-item .rv-name")?.textContent).toBe("Nova nota: Reunião"),
    );
    window.localStorage.clear();
  });
});

/* ---------------- C165: the two regions of the tab ---------------- */

describe("C165 the list on the left, the detail on the right", () => {
  it("C165 .rv-body holds the list first and the detail second, in the DOM and in the grid: two columns, the list's the narrower, aligned to the start; no rule reorders them", async () => {
    const items = [proposal({ summary: "um" }), proposal({ summary: "dois" })];
    pending(items);
    for (const p of items) detailOf(p, { ops: [op()], diff: DIFF });
    mountReviews({ search: "?tab=agent" });
    await waitFor(() => expect(document.querySelector(".ag-detail")).not.toBeNull());
    const body = document.querySelector<HTMLElement>(".rv-body")!;
    // the DOM: exactly two regions, the list then the detail, and the list holds the items, not the detail
    expect([...body.children].map((c) => `${c.tagName.toLowerCase()}.${c.className}`)).toEqual([
      "ul.rv-list",
      "div.rv-detail ag-detail",
    ]);
    const [list, detail] = [...body.children];
    expect(before(list!, detail!)).toBe(true);
    expect(list!.querySelectorAll(".rv-item")).toHaveLength(2);
    expect(list!.contains(detailEl())).toBe(false);
    expect(detail!.contains(document.querySelector(".rv-pick"))).toBe(false);
    // the grid: two tracks, the list's 2fr (at least 240px) and the detail's 3fr, from the top
    expect(rule("reviews.css", ".rv-body")).toMatchObject({
      display: "grid",
      "grid-template-columns": "minmax(240px, 2fr) 3fr",
      "align-items": "start",
    });
    // nothing puts the detail before the list or both in one column
    for (const sel of [".rv-body", ".rv-list", ".rv-detail", ".ag-detail"])
      for (const file of ["reviews.css", "agent.css"]) {
        const declared = rule(file, sel);
        for (const prop of ["order", "grid-column", "grid-row", "grid-area", "direction", "float"])
          expect(declared[prop], `${file} ${sel} ${prop}`).toBeUndefined();
      }
  });
});

/* ---------------- C169: the list's state is announced ---------------- */

describe("C169 the tab's state is announced in role=status", () => {
  const live = () => [...document.querySelectorAll<HTMLElement>('[role="status"], [role="alert"]')];
  const line = () => document.querySelector<HTMLElement>(".rv-status")!;

  it("C169 loading: Carregando… is a role=status of its own (a spinner with the text), and the screen's line is empty", async () => {
    proposals.list = "pending";
    mountReviews({ search: "?tab=agent" });
    const state = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('.rv-state[role="status"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(state.textContent).toBe("Carregando…");
    expect(state.querySelector(".spinner")).not.toBeNull();
    expect(line().getAttribute("role")).toBe("status");
    expect(line().textContent).toBe("");
  });

  it("C169 empty: the screen's role=status line says 0 propostas do agente para revisar while the tab shows Nada do agente para revisar.", async () => {
    pending([]);
    mountReviews({ search: "?tab=agent" });
    await waitFor(() => expect(document.querySelector(".ag-empty")).not.toBeNull());
    await waitFor(() => expect(line().textContent).toBe("0 propostas do agente para revisar"));
    expect(line().getAttribute("role")).toBe("status");
    expect(document.querySelector(".ag-empty")!.textContent).toContain("Nada do agente para revisar.");
  });

  it("C169 with items: the line says 2 propostas do agente para revisar and no loading state is left", async () => {
    const items = [proposal({ summary: "um" }), proposal({ summary: "dois" })];
    pending(items);
    for (const p of items) detailOf(p, { ops: [op()], diff: DIFF });
    proposals.decide = (id) => Promise.resolve(accepted(items.find((p) => p.id === id)!));
    mountReviews({ search: "?tab=agent" });
    await waitFor(() => expect(line().textContent).toBe("2 propostas do agente para revisar"));
    await waitFor(() => expect(document.querySelector(".ag-detail")).not.toBeNull());
    expect(live().filter((e) => e.matches(".rv-state"))).toEqual([]);
  });

  it("C169 failed: the message is a role=alert (an assertive live region of its own), with Tentar de novo, and the line stays empty so nothing is said twice", async () => {
    proposals.list = new NetError(500, "boom", "falhou a lista");
    mountReviews({ search: "?tab=agent" });
    const failed = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('.rv-state[role="alert"]');
      expect(el?.textContent).toContain("falhou a lista");
      return el!;
    });
    expect(within(failed).getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
    expect(failed.querySelector("svg.lucide-triangle-alert, svg.lucide-alert-triangle")).not.toBeNull();
    expect(line().textContent).toBe("");
    expect(live().filter((e) => e.textContent?.includes("falhou a lista"))).toEqual([failed]);
  });
});
