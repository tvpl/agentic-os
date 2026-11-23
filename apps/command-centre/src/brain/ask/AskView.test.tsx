// @vitest-environment jsdom
/**
 * The view "Perguntar" in rendered components (.specs/features/cerebro-perguntar, C74-C93, C109-C111; design.md "Vista -
 * Perguntar"): the first open and the remembered mode and scope, the fields of each mode and `Mod+Enter`, the answering
 * state and "Cancelar", the answer of each mode with its citations, nature chips, provocation and "Como esta resposta foi
 * feita", the abstention, the refused, failed and off states, the ask in progress, the recent questions and their empty,
 * loading and error states, the scope's menu, chips, folder and hidden line. Every route is answered only for what the
 * test set (`testkit.tsx`); "now" is 2026-11-22 10:00 local.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { isInaccessible } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import postcss from "postcss";
import type * as ApiModule from "../../api";
import { installPage } from "../../ui/testkit";
import { note, resetNet } from "../notes/testnet";
import {
  MEM,
  NOW,
  NetError,
  ONBOARDING,
  PLANO,
  before,
  cite,
  cites,
  detail,
  fieldLabels,
  item,
  kit,
  listed,
  mountAsk,
  net,
  on,
  only,
  para,
  questionField,
  resetAsk,
  result,
  rows,
  savedAsk,
  sendButton,
  sent,
  shows,
} from "./testkit";

vi.mock("../../api", async (importOriginal) =>
  (await import("../notes/testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.setConfig({ testTimeout: 30_000 });

installPage();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  resetNet();
  resetAsk();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
});

const CSS = readFileSync(join(__dirname, "ask.css"), "utf8");
const THEME = readFileSync(join(__dirname, "..", "..", "theme.css"), "utf8");
/** The declarations of `selector` outside any at-rule. */
function rule(css: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(css).walkRules((r) => {
    const listed = r.selector.split(",").map((x) => x.trim());
    if (listed.includes(selector) && r.parent?.type === "root")
      r.walkDecls((d) => void (out[d.prop] = d.value));
  });
  return out;
}

const Q = "O que decidi sobre o onboarding?";
const withContext = () => {
  net.contexts = [{ id: "proj-x", name: "Projeto X", paths: [{ path: MEM, state: "ok" }], files: 3 }];
  net.prefs.activeContext = "proj-x";
};
const up = () => screen.findByRole("heading", { name: "Perguntar ao cérebro" }, { timeout: 10_000 });
const tab = (name: string) => screen.getByRole("tab", { name });
const scopeButton = (name: string) => screen.findByRole("button", { name }, { timeout: 10_000 });
const type = (el: HTMLTextAreaElement, text: string) => fireEvent.change(el, { target: { value: text } });
const takeField = () => screen.getByLabelText("Sua visão") as HTMLTextAreaElement;
/** The view's own live regions (the shell's toasts have theirs). */
const inView = () => within(document.querySelector<HTMLElement>(".ask")!);
const icons = (el: Element) => [...el.querySelectorAll("svg")].map((s) => s.getAttribute("class") ?? "");
const running = (over = {}) =>
  detail({ status: "running", answer: undefined, run: { provider: "claude", startedAt: NOW }, ...over });

/** The view with the question asked: `POST` answers 202 `run-1`, whose ask reads `then`. */
async function asked(
  then: Parameters<typeof shows>[0],
  body: Record<string, unknown> = { question: Q, mode: "direct", scope: { kind: "all" } },
) {
  on("ask", only(body, { status: "running", id: "run-1" }));
  shows(then, "run-1");
  const view = mountAsk();
  await up();
  await waitFor(() =>
    expect(rows().length + document.querySelectorAll(".ask-empty").length).toBeGreaterThan(0),
  );
  type(questionField(), String(body.question));
  if (body.take) type(takeField(), String(body.take));
  fireEvent.click(sendButton());
  await waitFor(() => expect(sent("ask")).toHaveLength(1));
  return view;
}

describe("C74 the first open on a machine", () => {
  it("C74 with no brain.ask preference and an active context: Perguntar direto is selected, the scope reads Contexto ativo: Projeto X", async () => {
    withContext();
    mountAsk();
    await up();
    expect(await scopeButton("Contexto ativo: Projeto X")).toBeTruthy();
    expect(tab("Perguntar direto").getAttribute("aria-selected")).toBe("true");
    expect(tab("Raciocine primeiro").getAttribute("aria-selected")).toBe("false");
  });

  it("C74 with no brain.ask preference and no active context: Perguntar direto, Todo o cérebro", async () => {
    mountAsk();
    await up();
    expect(await scopeButton("Todo o cérebro")).toBeTruthy();
    expect(tab("Perguntar direto").getAttribute("aria-selected")).toBe("true");
  });
});

describe("C75 the mode and the scope are remembered on this machine", () => {
  it("C75 changing the mode and the scope sends PUT /api/ui-preferences with brain.ask { mode, scope }, and a remount opens with them", async () => {
    withContext();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mountAsk();
    await up();
    await scopeButton("Contexto ativo: Projeto X");
    await user.click(tab("Raciocine primeiro"));
    await waitFor(() =>
      expect(savedAsk()).toEqual([{ mode: "reason_first", scope: { kind: "context", id: "proj-x" } }]),
    );
    await user.click(await scopeButton("Contexto ativo: Projeto X"));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Todo o cérebro" }));
    await waitFor(() =>
      expect(savedAsk()).toEqual([
        { mode: "reason_first", scope: { kind: "context", id: "proj-x" } },
        { mode: "reason_first", scope: { kind: "all" } },
      ]),
    );
    expect(net.prefs.brain.ask).toEqual({ mode: "reason_first", scope: { kind: "all" } });
    cleanup();
    mountAsk();
    await up();
    expect(await scopeButton("Todo o cérebro")).toBeTruthy();
    await waitFor(() => expect(tab("Raciocine primeiro").getAttribute("aria-selected")).toBe("true"));
  });
});

describe("C76 the fields of each mode", () => {
  it("C76 Raciocine primeiro: Sua visão before Pergunta; 19 de 20 caracteres and disabled with its title at 19; 20 caracteres and enabled at 20 with a 3-character question", async () => {
    net.prefs.brain.ask = { mode: "reason_first", scope: null };
    mountAsk();
    await up();
    await waitFor(() => expect(fieldLabels()).toEqual(["Sua visão", "Pergunta"]));
    const take = takeField();
    expect(before(take, questionField())).toBe(true);
    type(questionField(), "abc");
    type(take, "a".repeat(19));
    expect(screen.getByText("19 de 20 caracteres")).toBeTruthy();
    expect(sendButton().textContent).toBe("Perguntar");
    expect(sendButton().disabled).toBe(true);
    expect(sendButton().getAttribute("title")).toBe("Escreva pelo menos 20 caracteres da sua visão.");
    type(take, "a".repeat(20));
    expect(screen.getByText("20 caracteres")).toBeTruthy();
    expect(screen.queryByText("20 de 20 caracteres")).toBeNull();
    expect(sendButton().disabled).toBe(false);
    expect(sendButton().getAttribute("title")).toBeNull();
  });

  it("C76 Perguntar direto: no Sua visão; disabled at a 2-character question with the title Escreva a pergunta.", async () => {
    mountAsk();
    await up();
    expect(fieldLabels()).toEqual(["Pergunta"]);
    expect(screen.queryByLabelText("Sua visão")).toBeNull();
    type(questionField(), "ab");
    expect(sendButton().disabled).toBe(true);
    expect(sendButton().getAttribute("title")).toBe("Escreva a pergunta.");
    type(questionField(), "abc");
    expect(sendButton().disabled).toBe(false);
  });
});

describe("C77 Mod+Enter in the question", () => {
  it("C77 Mod+Enter inside the question field sends the same request as Perguntar", async () => {
    on(
      "ask",
      only({ question: Q, mode: "direct", scope: { kind: "all" } }, { status: "running", id: "run-1" }),
    );
    shows(running());
    mountAsk();
    await up();
    const field = questionField();
    type(field, Q);
    field.focus();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() =>
      expect(sent("ask")).toEqual([{ question: Q, mode: "direct", scope: { kind: "all" } }]),
    );
  });

  it("C77 with the button disabled (a 2-character question) Mod+Enter sends nothing", async () => {
    mountAsk();
    await up();
    const field = questionField();
    type(field, "ab");
    field.focus();
    expect(sendButton().disabled).toBe(true);
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).keyboard("{Control>}{Enter}{/Control}");
    await new Promise((r) => setTimeout(r, 50));
    expect(sent("ask")).toEqual([]);
  });
});

describe("C78 answering and Cancelar", () => {
  it("C78 after 202 the spinner, the status Lendo as suas notas e escrevendo a resposta… and the cost line; Cancelar cancels the run and reads Cancelado., the fields editable", async () => {
    on("cancel", only(undefined, { cancelled: true }));
    await asked(running());
    const status = await inView().findByRole("status");
    expect(status.textContent).toBe("Lendo as suas notas e escrevendo a resposta…");
    expect(status.querySelector(".spinner")).not.toBeNull();
    expect(within(result()!).getByText("Isso usa uma execução do Claude.")).toBeTruthy();
    fireEvent.click(within(result()!).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(sent("cancel")).toHaveLength(1));
    await waitFor(() => expect(inView().getByRole("status").textContent).toBe("Cancelado."));
    expect(questionField().readOnly).toBe(false);
    expect(questionField().value).toBe(Q);
    expect(sendButton().textContent).toBe("Perguntar");
  });
});

describe("C79 an answered direct answer", () => {
  it("C79 each paragraph in order through Markdown, followed by its citations as FileText buttons nome § seção; a click goes to /brain?sel=<fileId>; the citations wrap", async () => {
    const view = await asked(detail());
    await waitFor(() => expect(document.querySelectorAll(".ask-par")).toHaveLength(2));
    const pars = [...document.querySelectorAll<HTMLElement>(".ask-par")];
    expect(pars.map((p) => p.querySelector(".apps-md.ask-md")?.textContent)).toEqual([
      "Você decidiu fazer o onboarding em duas etapas.",
      "O próximo passo é testar com três clientes.",
    ]);
    expect(pars[1]!.querySelector(".apps-md strong")?.textContent).toBe("testar");
    expect(cites(pars[0]!)).toEqual(["onboarding.md § Decisão"]);
    expect(cites(pars[1]!)).toEqual(["onboarding.md § Decisão", "plano.md § Próximos passos"]);
    for (const p of pars)
      expect(before(p.querySelector(".apps-md")!, p.querySelector(".ask-cites")!)).toBe(true);
    for (const b of document.querySelectorAll(".ask-cite"))
      expect(icons(b)).toEqual(["lucide lucide-file-text"]);
    fireEvent.click(within(pars[1]!).getByRole("button", { name: "plano.md § Próximos passos" }));
    expect(view.setLocation).toHaveBeenLastCalledWith({ pathname: "/brain", search: "?sel=2" });
    const row = rule(CSS, ".ask .ask-cites");
    expect(row["flex-wrap"]).toBe("wrap");
    for (const sel of [".ask .ask-cites", ".ask .ask-cite-item", ".ask .ask-cite"]) {
      const d = rule(CSS, sel);
      expect(d["overflow-x"], sel).toBeUndefined();
      expect(d.overflow, sel).toBeUndefined();
      expect(d["white-space"], sel).toBeUndefined();
    }
    expect(rule(CSS, ".ask .ask-cite")["overflow-wrap"]).toBe("anywhere");
  });
});

describe("C80 the nature chip of a citation", () => {
  for (const [n, text] of [
    ["plano", "Plano"],
    ["hipotese", "Hipótese"],
    ["opiniao", "Opinião"],
  ] as const)
    it(`C80 a citation of a ${n} note shows the natureza chip right after it`, async () => {
      const c = cite("nota.md", "Ideia", 5, n);
      await asked(detail({ answer: { paragraphs: [para("Um parágrafo.", c, ONBOARDING)] } }));
      const button = await screen.findByRole("button", { name: "nota.md § Ideia" });
      const chip = button.nextElementSibling!;
      expect(chip.matches(".badge.nb")).toBe(true);
      expect(chip.textContent).toContain(text);
      const other = screen.getByRole("button", { name: "onboarding.md § Decisão" });
      expect(other.nextElementSibling).toBeNull();
    });

  it("C80 a citation with no natureza shows no chip", async () => {
    await asked(detail({ answer: { paragraphs: [para("Um parágrafo.", ONBOARDING)] } }));
    await screen.findByRole("button", { name: "onboarding.md § Decisão" });
    expect(result()!.querySelector(".nb")).toBeNull();
  });
});

const TAKE = "Eu acho que o onboarding deve ser em uma etapa só, sem formulário.";
const reasonFirst = (feedback: object, over = {}) =>
  detail({
    mode: "reason_first",
    take: TAKE,
    answer: {
      paragraphs: [para("Você decidiu fazer o onboarding em duas etapas.", ONBOARDING)],
      takeFeedback: { agrees: [], disagrees: [], missing: [], ...feedback },
    },
    ...over,
  });
const reasonBody = { question: Q, mode: "reason_first", scope: { kind: "all" }, take: TAKE };

describe("C81 a reason_first answer", () => {
  it("C81 Sua visão first, then only the lists with items in order, each item with its citations, and last the closed Fold whose paragraphs are not in the accessible tree", async () => {
    net.prefs.brain.ask = { mode: "reason_first", scope: null };
    await asked(
      reasonFirst({
        agrees: [para("As notas também pedem menos passos.", ONBOARDING)],
        missing: [para("Nenhuma nota fala do custo.", PLANO)],
      }),
      reasonBody,
    );
    const answer = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".ask-answer");
      expect(el).not.toBeNull();
      return el!;
    });
    const heads = [...answer.querySelectorAll("h2, .notes-fold-head button")].map((h) => h.textContent);
    expect(heads).toEqual([
      "Sua visão",
      "Onde as notas concordam",
      "O que falta",
      "Ver a resposta do cérebro",
      "Como esta resposta foi feita",
    ]);
    expect(answer.querySelector(".ask-take-text")!.textContent).toBe(TAKE);
    const lists = [...answer.querySelectorAll(".ask-fb")];
    expect(icons(lists[0]!.querySelector("h2")!)).toEqual(["lucide lucide-circle-check"]);
    expect(icons(lists[1]!.querySelector("h2")!)).toEqual(["lucide lucide-circle-help"]);
    expect(cites(lists[0]!)).toEqual(["onboarding.md § Decisão"]);
    expect(cites(lists[1]!)).toEqual(["plano.md § Próximos passos"]);
    const fold = within(answer).getByRole("button", { name: "Ver a resposta do cérebro" });
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    const par = within(answer).getByText("Você decidiu fazer o onboarding em duas etapas.");
    expect(isInaccessible(par)).toBe(true);
    expect(before(lists[1]!, fold)).toBe(true);
    fireEvent.click(fold);
    expect(isInaccessible(par)).toBe(false);
  });

  it("C81 with only missing, only O que falta is shown", async () => {
    net.prefs.brain.ask = { mode: "reason_first", scope: null };
    await asked(reasonFirst({ missing: [para("Nenhuma nota fala do custo.", PLANO)] }), reasonBody);
    await waitFor(() => expect(document.querySelectorAll(".ask-fb")).toHaveLength(1));
    expect(document.querySelector(".ask-fb h2")!.textContent).toBe("O que falta");
    expect(icons(document.querySelector(".ask-fb h2")!)).toEqual(["lucide lucide-circle-help"]);
    expect(screen.queryByText("Onde as notas concordam")).toBeNull();
    expect(screen.queryByText("Onde discordam")).toBeNull();
  });
});

const NOTA = cite("contrato.md", "Cláusula", 7);
describe("C82 the provocation", () => {
  for (const [kind, first] of [
    ["contradiz", "Uma nota contradiz isto"],
    ["complica", "Uma nota complica isto"],
    ["falta", "Uma nota acrescenta o que falta"],
  ] as const)
    it(`C82 ${kind}: after the paragraphs, ${first}, the text and the citation, no alert, the tokens --line-strong and --surface-2`, async () => {
      await asked(
        detail({
          answer: {
            paragraphs: [para("Você decidiu fazer o onboarding em duas etapas.", ONBOARDING)],
            provocation: { kind, text: "O contrato pede uma etapa só.", citation: NOTA },
          },
        }),
      );
      const block = await waitFor(() => {
        const el = document.querySelector<HTMLElement>(".ask-provocation");
        expect(el).not.toBeNull();
        return el!;
      });
      expect(before(document.querySelector(".ask-pars")!, block)).toBe(true);
      expect([...block.children].map((c) => c.textContent)).toEqual([
        first,
        "O contrato pede uma etapa só.",
        "contrato.md § Cláusula",
        "Abrir a notaPerguntar sobre isto",
      ]);
      expect(block.closest('[role="alert"]')).toBeNull();
      expect(block.querySelector('[role="alert"]')).toBeNull();
      expect(icons(block).filter((c) => /alert/.test(c))).toEqual([]);
      const css = rule(CSS, ".ask .ask-provocation");
      expect(css["border-left"]).toBe("2px solid var(--line-strong)");
      expect(css.background).toBe("var(--surface-2)");
      expect(rule(THEME, ":root")["--line-strong"]).toBe("var(--border-strong)");
    });

  it("C82 in reason_first the provocation comes after the Fold", async () => {
    net.prefs.brain.ask = { mode: "reason_first", scope: null };
    const d = reasonFirst({ missing: [para("Nenhuma nota fala do custo.", PLANO)] });
    d.answer!.provocation = { kind: "complica", text: "O contrato pede uma etapa só.", citation: NOTA };
    await asked(d, reasonBody);
    const block = await waitFor(() => {
      const el = document.querySelector(".ask-provocation");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(before(document.querySelector(".notes-fold")!, block)).toBe(true);
  });

  it("C82 Abrir a nota goes to /brain?sel=<fileId>; Perguntar sobre isto fills the question, sets Estas notas with the note's chip and focuses the question", async () => {
    const view = await asked(
      detail({
        answer: {
          paragraphs: [para("Você decidiu fazer o onboarding em duas etapas.", ONBOARDING)],
          provocation: { kind: "contradiz", text: "O contrato pede uma etapa só.", citation: NOTA },
        },
      }),
    );
    const block = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".ask-provocation");
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.click(within(block).getByRole("button", { name: "Abrir a nota" }));
    expect(view.setLocation).toHaveBeenLastCalledWith({ pathname: "/brain", search: "?sel=7" });
    expect(icons(within(block).getByRole("button", { name: "Abrir a nota" }))).toEqual([
      "lucide lucide-external-link",
    ]);
    const ask = within(block).getByRole("button", { name: "Perguntar sobre isto" });
    expect(icons(ask)).toEqual(["lucide lucide-message-square-plus"]);
    fireEvent.click(ask);
    expect(questionField().value).toBe("O contrato pede uma etapa só.");
    expect(document.activeElement).toBe(questionField());
    expect(await scopeButton("Estas notas")).toBeTruthy();
    expect([...document.querySelectorAll(".ask-chip span")].map((s) => s.textContent)).toEqual([
      "contrato.md",
    ]);
    await waitFor(() =>
      expect(savedAsk().at(-1)).toEqual({
        mode: "direct",
        scope: { kind: "notes", paths: [`${MEM}/notes/contrato.md`] },
      }),
    );
  });
});

describe("C83 the abstention", () => {
  it("C83 SearchX, Não encontrei nada nas suas notas sobre isso. and Procurei em Todo o cérebro: 3 arquivos.; with the scope all there is no Perguntar em todo o cérebro", async () => {
    on(
      "ask",
      only(
        { question: Q, mode: "direct", scope: { kind: "all" } },
        { status: "abstained", abstainReason: "no_match", consulted: 3 },
      ),
    );
    mountAsk();
    await up();
    type(questionField(), Q);
    fireEvent.click(sendButton());
    const none = await waitFor(() => {
      const el = document.querySelector(".ask-none");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(icons(none)).toEqual(["lucide lucide-search-x"]);
    expect(
      within(none as HTMLElement).getByText("Não encontrei nada nas suas notas sobre isso."),
    ).toBeTruthy();
    expect(within(none as HTMLElement).getByText("Procurei em Todo o cérebro: 3 arquivos.")).toBeTruthy();
    expect(
      within(none as HTMLElement).queryByRole("button", { name: "Perguntar em todo o cérebro" }),
    ).toBeNull();
  });

  it("C83 with a context scope, Perguntar em todo o cérebro sends the same question with scope { kind: all }", async () => {
    withContext();
    const ctx = { question: Q, mode: "direct", scope: { kind: "context", id: "proj-x" } };
    const all = { question: Q, mode: "direct", scope: { kind: "all" } };
    net.writes.set("POST /api/memory/ask", (body) =>
      JSON.stringify(body) === JSON.stringify(ctx)
        ? Promise.resolve({ status: "abstained", abstainReason: "weak", consulted: 3 })
        : JSON.stringify(body) === JSON.stringify(all)
          ? Promise.resolve({ status: "running", id: "run-1" })
          : Promise.reject(new NetError(400, "unexpected_body")),
    );
    shows(running());
    mountAsk();
    await up();
    await scopeButton("Contexto ativo: Projeto X");
    type(questionField(), Q);
    fireEvent.click(sendButton());
    const none = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".ask-none");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(within(none).getByText("Procurei em Contexto ativo: Projeto X: 3 arquivos.")).toBeTruthy();
    fireEvent.click(within(none).getByRole("button", { name: "Perguntar em todo o cérebro" }));
    await waitFor(() => expect(sent("ask")).toEqual([ctx, all]));
  });
});

describe("C84 refused and failed", () => {
  for (const [status, title, reason] of [
    [
      "refused",
      "A resposta não passou na conferência das fontes.",
      `A citação do parágrafo 1 nomeia ${MEM}/notes/x.md, que o índice não tem.`,
    ],
    ["failed", "A execução não terminou.", "A execução terminou em failed."],
  ] as const)
    it(`C84 ${status}: the alert band with AlertTriangle, ${title}, the reason, and Tentar de novo sends the same question, mode, take and scope`, async () => {
      withContext();
      const scope = { kind: "context", id: "proj-x" } as const;
      listed([item("run-1", Q, { mode: "reason_first", scope, status })]);
      shows(detail({ mode: "reason_first", take: TAKE, scope, status, answer: undefined, reason }));
      const again = { question: Q, mode: "reason_first", scope, take: TAKE };
      on("ask", only(again, { status: "running", id: "run-2" }));
      shows(running({ id: "run-2", mode: "reason_first", take: TAKE, scope }));
      mountAsk();
      await up();
      await waitFor(() => expect(rows()).toHaveLength(1));
      fireEvent.click(rows()[0]!);
      const band = await inView().findByRole("alert");
      expect(band.classList.contains("ask-band")).toBe(true);
      expect(icons(band)[0]).toMatch(/lucide-(triangle-alert|alert-triangle)/);
      expect(within(band).getByText(title)).toBeTruthy();
      expect(within(band).getByText(reason)).toBeTruthy();
      expect(before(within(band).getByText(title), within(band).getByText(reason))).toBe(true);
      fireEvent.click(within(band).getByRole("button", { name: "Tentar de novo" }));
      await waitFor(() => expect(sent("ask")).toEqual([again]));
    });
});

describe("C85 the ask is off", () => {
  it("C85 409 skill_unavailable: Lock and the sentence in place of the fields; Ligar sends memorySkills with brain-ask at the end, and the fields come back with the question", async () => {
    kit.settings = { memorySkills: ["recall", "minha-skill"], folderAccess: [] };
    on(
      "ask",
      only({ question: Q, mode: "direct", scope: { kind: "all" } }, new NetError(409, "skill_unavailable")),
    );
    on("settings", only({ memorySkills: ["recall", "minha-skill", "brain-ask"] }, {}));
    mountAsk();
    await up();
    type(questionField(), Q);
    fireEvent.click(sendButton());
    const off = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".ask-off");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(document.querySelector(".ask-fields")).toBeNull();
    expect(document.querySelector("textarea")).toBeNull();
    expect(icons(off)).toEqual(["lucide lucide-lock"]);
    expect(
      within(off).getByText("Perguntar está desligado: a skill brain-ask não pode ler a memória."),
    ).toBeTruthy();
    const turnOn = within(off).getByRole("button", { name: "Ligar" });
    expect(turnOn.matches(".btn.primary")).toBe(true);
    fireEvent.click(turnOn);
    await waitFor(() =>
      expect(sent("settings")).toEqual([{ memorySkills: ["recall", "minha-skill", "brain-ask"] }]),
    );
    await waitFor(() => expect(questionField().value).toBe(Q));
    expect(document.querySelector(".ask-off")).toBeNull();
  });
});

describe("C86 another ask in progress", () => {
  it("C86 409 ask_in_progress opens the newest running ask of GET /api/memory/ask and shows no error", async () => {
    on(
      "ask",
      only({ question: Q, mode: "direct", scope: { kind: "all" } }, new NetError(409, "ask_in_progress")),
    );
    listed([
      item("run-9", "O que está parado?", { status: "running" }),
      item("run-8", "Outra pergunta antiga", { status: "running", startedAt: NOW - 60 * 60_000 }),
      item("run-7", "Uma resposta"),
    ]);
    shows(running({ id: "run-9", question: "O que está parado?" }));
    mountAsk();
    await up();
    await waitFor(() => expect(rows()).toHaveLength(3));
    type(questionField(), Q);
    fireEvent.click(sendButton());
    await waitFor(() =>
      expect(inView().getByRole("status").textContent).toBe("Lendo as suas notas e escrevendo a resposta…"),
    );
    expect(inView().queryByRole("alert")).toBeNull();
    await waitFor(() => expect(questionField().value).toBe("O que está parado?"));
    await waitFor(() => expect(rows()[0]!.getAttribute("aria-current")).toBe("true"));
    expect(rows()[1]!.getAttribute("aria-current")).toBeNull();
  });
});

describe("C87 the recent questions", () => {
  it("C87 up to 30 lines of GET /api/memory/ask, each with the question, the mode as icon and text, the scope and the relative time; running, refused and failed say so", async () => {
    withContext();
    const many = Array.from({ length: 30 }, (_, i) => item(`run-${i + 10}`, `Pergunta ${i + 10}`));
    listed([
      item("run-1", "O que decidi?", { status: "running", scope: { kind: "context", id: "proj-x" } }),
      item("run-2", "Por que mudei?", { mode: "reason_first", status: "refused" }),
      item("run-3", "Quando termina?", { status: "failed" }),
      ...many.slice(0, 27),
    ]);
    mountAsk();
    await up();
    await waitFor(() => expect(rows()).toHaveLength(30));
    expect(net.calls.filter((c) => c.url.split("?")[0] === "/api/memory/ask").map((c) => c.url)).toEqual(
      expect.arrayContaining(["/api/memory/ask"]),
    );
    const [a, b, c, d] = rows();
    expect(a!.querySelector(".ask-row-q")!.textContent).toBe("O que decidi?");
    const meta = (row: Element) =>
      [...row.querySelector(".ask-row-meta")!.children].map((s) => s.textContent);
    expect(meta(a!)).toEqual(["Direto", "Contexto ativo: Projeto X", "há 5 minutos", "Respondendo…"]);
    expect(icons(a!)).toEqual(["lucide lucide-message-square", "lucide lucide-loader"]);
    expect(meta(b!)).toEqual(["Raciocine primeiro", "Todo o cérebro", "há 5 minutos", "Recusada"]);
    expect(icons(b!)[0]).toBe("lucide lucide-pen-line");
    expect(icons(b!)[1]).toMatch(/lucide-(triangle-alert|alert-triangle)/);
    expect(meta(c!)).toEqual(["Direto", "Todo o cérebro", "há 5 minutos", "Falhou"]);
    expect(meta(d!)).toEqual(["Direto", "Todo o cérebro", "há 5 minutos"]);
    expect(rule(CSS, ".ask .ask-row-q")["text-overflow"]).toBe("ellipsis");
  });

  it("C87 clicking a line opens it with aria-current, the fields read-only and Nova pergunta, which clears them", async () => {
    listed([item("run-1", "O que decidi?"), item("run-2", "Por que mudei?", { mode: "reason_first" })]);
    shows(detail({ id: "run-2", question: "Por que mudei?", mode: "reason_first", take: TAKE }));
    mountAsk();
    await up();
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(rows()[1]!);
    await waitFor(() => expect(questionField().value).toBe("Por que mudei?"));
    expect(rows()[1]!.getAttribute("aria-current")).toBe("true");
    expect(rows()[0]!.getAttribute("aria-current")).toBeNull();
    expect(questionField().readOnly).toBe(true);
    expect(takeField().value).toBe(TAKE);
    expect(takeField().readOnly).toBe(true);
    expect(tab("Raciocine primeiro").getAttribute("aria-selected")).toBe("true");
    expect(sendButton().textContent).toBe("Nova pergunta");
    expect(icons(sendButton())).toEqual(["lucide lucide-plus"]);
    expect(screen.queryByRole("button", { name: "Perguntar" })).toBeNull();
    fireEvent.click(sendButton());
    expect(questionField().value).toBe("");
    expect(questionField().readOnly).toBe(false);
    expect(sendButton().textContent).toBe("Perguntar");
    expect(rows()[1]!.getAttribute("aria-current")).toBeNull();
  });
});

describe("C88 the empty list", () => {
  it("C88 Nenhuma pergunta ainda. and three examples that fill the question; with the most-cited area clientes the first reads O que eu já decidi sobre clientes?", async () => {
    kit.areas = [
      { area: "vendas", count: 2 },
      { area: "clientes", count: 9 },
    ];
    mountAsk();
    await up();
    const empty = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".ask-empty");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(within(empty).getByText("Nenhuma pergunta ainda.")).toBeTruthy();
    await waitFor(() =>
      expect(
        within(empty)
          .getAllByRole("button")
          .map((b) => b.textContent),
      ).toEqual([
        "O que eu já decidi sobre clientes?",
        "Quais planos meus ainda não viraram realidade?",
        "O que está parado há mais tempo?",
      ]),
    );
    fireEvent.click(
      within(empty).getByRole("button", { name: "Quais planos meus ainda não viraram realidade?" }),
    );
    expect(questionField().value).toBe("Quais planos meus ainda não viraram realidade?");
  });

  it("C88 with no area the first example reads O que eu já decidi este mês?", async () => {
    mountAsk();
    await up();
    const first = await screen.findByRole("button", { name: "O que eu já decidi este mês?" });
    fireEvent.click(first);
    expect(questionField().value).toBe("O que eu já decidi este mês?");
  });
});

describe("C89 the list's loading and error", () => {
  it("C89 while the list loads: a spinner and Carregando…", async () => {
    listed("pending");
    mountAsk();
    await up();
    const recent = document.querySelector<HTMLElement>(".ask-recent")!;
    const line = await within(recent).findByText("Carregando…");
    expect(line.querySelector(".spinner")).not.toBeNull();
  });

  it("C89 a list that fails: Não deu para carregar as perguntas. and Tentar de novo, which fetches again", async () => {
    listed(new NetError(500, "internal"));
    mountAsk();
    await up();
    const recent = document.querySelector<HTMLElement>(".ask-recent")!;
    const alert = await within(recent).findByRole("alert");
    expect(within(alert).getByText("Não deu para carregar as perguntas.")).toBeTruthy();
    const gets = () => net.calls.filter((c) => c.method === "GET" && c.url === "/api/memory/ask").length;
    const n = gets();
    listed([item("run-1", "O que decidi?")]);
    fireEvent.click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(gets()).toBe(n + 1));
    await waitFor(() => expect(rows()).toHaveLength(1));
  });
});

const PLANO_PATH = `${MEM}/notes/plano.md`;
describe("C90 the notes scope", () => {
  for (const ctx of [true, false])
    it(`C90 the chosen note as a chip with an X Tirar plano.md; removing the last returns the scope to ${ctx ? "the active context" : "Todo o cérebro"}`, async () => {
      if (ctx) withContext();
      mountAsk({ search: `?note=${encodeURIComponent(PLANO_PATH)}` });
      await up();
      expect(await scopeButton("Estas notas")).toBeTruthy();
      expect(document.activeElement).toBe(questionField());
      const chips = [...document.querySelectorAll(".ask-chip")];
      expect(chips.map((c) => c.querySelector("span")!.textContent)).toEqual(["plano.md"]);
      const x = screen.getByRole("button", { name: "Tirar plano.md" });
      expect(icons(x)).toEqual(["lucide lucide-x"]);
      fireEvent.click(x);
      expect(await scopeButton(ctx ? "Contexto ativo: Projeto X" : "Todo o cérebro")).toBeTruthy();
      expect(document.querySelector(".ask-chip")).toBeNull();
    });

  it("C90 the notes scope is sent as { kind: notes, paths: [<that note>] }", async () => {
    on(
      "ask",
      only(
        { question: Q, mode: "direct", scope: { kind: "notes", paths: [PLANO_PATH] } },
        { status: "running", id: "run-1" },
      ),
    );
    shows(running());
    mountAsk({ search: `?note=${encodeURIComponent(PLANO_PATH)}` });
    await up();
    type(questionField(), Q);
    fireEvent.click(sendButton());
    await waitFor(() =>
      expect(sent("ask")).toEqual([
        { question: Q, mode: "direct", scope: { kind: "notes", paths: [PLANO_PATH] } },
      ]),
    );
  });
});

describe("C91 the scope's menu", () => {
  const contexts = () => {
    net.contexts = [
      { id: "proj-x", name: "Projeto X", paths: [{ path: MEM, state: "ok" }], files: 3 },
      { id: "cliente-a", name: "Cliente A", paths: [{ path: `${MEM}/clientes`, state: "ok" }], files: 1 },
      { id: "pessoal", name: "Pessoal", paths: [{ path: `${MEM}/pessoal`, state: "ok" }], files: 1 },
    ];
  };
  const entries = () =>
    [...document.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]')].map((e) => e.textContent);

  it("C91 with an active context: Contexto ativo, Todo o cérebro, the other contexts by name, Uma pasta…", async () => {
    contexts();
    net.prefs.activeContext = "proj-x";
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mountAsk();
    await up();
    await user.click(await scopeButton("Contexto ativo: Projeto X"));
    await screen.findByRole("menuitem", { name: "Uma pasta…" });
    expect(entries()).toEqual([
      "Contexto ativo: Projeto X",
      "Todo o cérebro",
      "Cliente A",
      "Pessoal",
      "Uma pasta…",
    ]);
  });

  it("C91 with no active context there is no Contexto ativo; with a notes scope, Estas notas closes the menu", async () => {
    contexts();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mountAsk({ search: `?note=${encodeURIComponent(PLANO_PATH)}` });
    await up();
    await user.click(await scopeButton("Estas notas"));
    await screen.findByRole("menuitem", { name: "Uma pasta…" });
    expect(entries()).toEqual([
      "Todo o cérebro",
      "Projeto X",
      "Cliente A",
      "Pessoal",
      "Uma pasta…",
      "Estas notas",
    ]);
  });

  it("C91 Uma pasta… opens a Popover with the notes view's folder tree; choosing a folder sets scope { kind: folder, path }", async () => {
    note(1, MEM, "projetos/app.md");
    note(2, MEM, "pessoal/diario.md");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mountAsk();
    await up();
    await user.click(await scopeButton("Todo o cérebro"));
    await user.click(await screen.findByRole("menuitem", { name: "Uma pasta…" }));
    const pop = await screen.findByRole("dialog", { name: "Uma pasta…" });
    const tree = await within(pop).findAllByRole("tree");
    expect(tree.length).toBeGreaterThan(0);
    const folder = await within(tree[0]!).findByRole("treeitem", { name: "projetos" });
    await user.click(folder);
    await waitFor(() =>
      expect(savedAsk().at(-1)).toEqual({
        mode: "direct",
        scope: { kind: "folder", path: `${MEM}/projetos` },
      }),
    );
    expect(await scopeButton("projetos")).toBeTruthy();
  });
});

describe("C92 the line of the folders hidden from agents", () => {
  const hide = (path: string) => {
    kit.settings = { memorySkills: ["recall"], folderAccess: [{ path, agents: "hide", devices: "read" }] };
  };
  const line = () => screen.queryByText("Pastas escondidas dos agentes não entram nas respostas.");

  it("C92 the whole brain with a hidden folder: the line with EyeOff shows", async () => {
    hide(`${MEM}/segredo`);
    mountAsk();
    await up();
    await waitFor(() => expect(line()).not.toBeNull());
    expect(icons(line()!.parentElement!)).toEqual(["lucide lucide-eye-off"]);
  });

  it("C92 a context whose path holds the hidden folder shows it; one that does not, does not", async () => {
    hide(`${MEM}/segredo`);
    net.contexts = [
      { id: "proj-x", name: "Projeto X", paths: [{ path: MEM, state: "ok" }], files: 3 },
      { id: "obra", name: "Obra", paths: [{ path: "/work", state: "ok" }], files: 1 },
    ];
    net.prefs.activeContext = "proj-x";
    mountAsk();
    await up();
    await scopeButton("Contexto ativo: Projeto X");
    await waitFor(() => expect(line()).not.toBeNull());
    cleanup();
    net.prefs.activeContext = "obra";
    mountAsk();
    await up();
    await scopeButton("Contexto ativo: Obra");
    await waitFor(() => expect(net.calls.some((c) => c.url === "/api/settings")).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(line()).toBeNull();
  });

  it("C92 the scope's folder holding a hidden folder shows it; a folder beside it does not", async () => {
    hide(`${MEM}/notes/segredo`);
    net.prefs.brain.ask = { mode: "direct", scope: { kind: "folder", path: `${MEM}/notes` } };
    mountAsk();
    await up();
    await waitFor(() => expect(line()).not.toBeNull());
    cleanup();
    net.prefs.brain.ask = { mode: "direct", scope: { kind: "folder", path: `${MEM}/projetos` } };
    mountAsk();
    await up();
    await scopeButton("projetos");
    await new Promise((r) => setTimeout(r, 50));
    expect(line()).toBeNull();
  });

  it("C92 with no hidden folder the line does not show", async () => {
    kit.settings = {
      memorySkills: ["recall"],
      folderAccess: [{ path: `${MEM}/segredo`, agents: "read", devices: "hide" }],
    };
    mountAsk();
    await up();
    await waitFor(() => expect(net.calls.some((c) => c.url === "/api/settings")).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(line()).toBeNull();
  });
});

describe("C93 how this answer was made", () => {
  it("C93 the card closes an answered result: Respondida por Claude em 42 s · 10:00 and Ver a execução to the run", async () => {
    await asked(detail());
    const card = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".ask-how");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(document.querySelector(".ask-answer")!.lastElementChild).toBe(card);
    expect(card.querySelector("h2")!.textContent).toBe("Como esta resposta foi feita");
    expect(within(card).getByText("Respondida por Claude em 42 s · 10:00")).toBeTruthy();
    const link = within(card).getByRole("link", { name: "Ver a execução" });
    expect(link.getAttribute("href")).toBe("/runs/run-1");
  });
});

/* ---------------- Round 1 fixes (batch F1): C109-C111, the arrangement ---------------- */

/** The view's column and its direct children, the regions of design.md "Vista - Perguntar". */
const column = () => document.querySelector<HTMLElement>(".ask .ask-col")!;
const regions = () => [...column().children] as HTMLElement[];
const HINT =
  "Escreva o que você pensa antes. O cérebro responde dizendo onde as suas notas concordam, discordam e o que falta.";
/** Open the reason-first ask `run-2` of the list, with this take; the view settled with its result. */
async function openReasonFirst(take: string) {
  listed([item("run-2", "Por que mudei?", { mode: "reason_first" })]);
  shows(reasonFirst({ missing: [para("Nenhuma nota fala do custo.", PLANO)] }, { id: "run-2", take }));
  mountAsk();
  await up();
  await waitFor(() => expect(rows()).toHaveLength(1));
  fireEvent.click(rows()[0]!);
  return waitFor(() => {
    const el = document.querySelector<HTMLElement>(".ask-take-text");
    expect(el).not.toBeNull();
    return el!;
  });
}
const lines = (n: number, word = "linha") =>
  Array.from({ length: n }, (_, i) => `${word} ${i + 1} da visão`).join("\n");

describe("C109 the six regions of the view", () => {
  it("C109 with an open reason-first ask the column holds exactly six regions in order: header, scope, mode with its hint, fields, result, recent questions", async () => {
    await openReasonFirst(TAKE);
    const [head, scope, mode, fields, res, recent] = regions();
    expect(regions()).toHaveLength(6);
    // 1. header: the title, and below it the line
    const h1 = within(head!).getByRole("heading", { level: 1, name: "Perguntar ao cérebro" });
    const lede = within(head!).getByText("As respostas citam as suas notas. Confira as fontes.");
    expect(before(h1, lede)).toBe(true);
    // 2. scope: "Sobre:" and a .btn.sm whose label is the scope, with ChevronDown
    const about = within(scope!).getByText("Sobre:");
    const trigger = within(scope!).getByRole("button", { name: "Todo o cérebro" });
    expect(trigger.matches(".btn.sm")).toBe(true);
    expect(icons(trigger)).toEqual(["lucide lucide-chevron-down"]);
    expect(before(about, trigger)).toBe(true);
    // 3. mode: the two tabs and, with Raciocine primeiro selected, its hint below them
    const tabs = within(mode!).getByRole("tablist");
    expect(
      within(tabs)
        .getAllByRole("tab")
        .map((t) => t.textContent),
    ).toEqual(["Perguntar direto", "Raciocine primeiro"]);
    expect(tab("Raciocine primeiro").getAttribute("aria-selected")).toBe("true");
    const hint = within(mode!).getByText(HINT);
    expect(before(tabs, hint)).toBe(true);
    // 4. fields: the tabs' panel, with Sua visão, Pergunta and the button
    expect(fields!.getAttribute("role")).toBe("tabpanel");
    expect(within(fields!).getByLabelText("Sua visão")).toBeTruthy();
    expect(within(fields!).getByLabelText("Pergunta")).toBeTruthy();
    expect(fields!.contains(sendButton())).toBe(true);
    // 5. result, present with an open ask
    expect(res!.matches(".ask-result")).toBe(true);
    expect(res!.querySelector(".ask-answer")).not.toBeNull();
    // 6. recent questions, headed PERGUNTAS RECENTES
    expect(within(recent!).getByRole("heading", { name: "PERGUNTAS RECENTES" })).toBeTruthy();
    expect(recent!.contains(rows()[0]!)).toBe(true);
  });

  it("C109 with no open ask there is no result: five regions, and in Perguntar direto the mode holds no hint", async () => {
    mountAsk();
    await up();
    await waitFor(() => expect(document.querySelector(".ask-empty")).not.toBeNull());
    expect(regions()).toHaveLength(5);
    expect(document.querySelector(".ask-result")).toBeNull();
    const [, , mode, fields, recent] = regions();
    expect(within(mode!).getByRole("tablist")).toBeTruthy();
    expect(within(mode!).queryByText(HINT)).toBeNull();
    expect(fields!.getAttribute("role")).toBe("tabpanel");
    expect(within(recent!).getByRole("heading", { name: "PERGUNTAS RECENTES" })).toBeTruthy();
  });

  it("C109 the column is one reading column of at most 720px, centred; the title 13px weight 600, the line 12px secondary", () => {
    expect(rule(CSS, ".ask .ask-col")).toMatchObject({
      display: "flex",
      "flex-direction": "column",
      "max-width": "720px",
      margin: "0 auto",
    });
    expect(rule(CSS, ".ask .ask-h1")).toMatchObject({ "font-size": "var(--fs-3)", "font-weight": "600" });
    expect(rule(CSS, ".ask .ask-small")).toMatchObject({
      "font-size": "var(--fs-2)",
      color: "var(--text-dim)",
    });
    expect(rule(THEME, ":root")).toMatchObject({ "--fs-2": "12px", "--fs-3": "13px" });
  });
});

describe("C110 the fields' arrangement", () => {
  it("C110 Raciocine primeiro: Sua visão 4 rows growing with its lines to 12 (20 lines show 12), Pergunta 2 rows growing to 6", async () => {
    net.prefs.brain.ask = { mode: "reason_first", scope: null };
    mountAsk();
    await up();
    await waitFor(() => expect(fieldLabels()).toEqual(["Sua visão", "Pergunta"]));
    expect(takeField().rows).toBe(4);
    type(takeField(), lines(7));
    expect(takeField().rows).toBe(7);
    type(takeField(), lines(12));
    expect(takeField().rows).toBe(12);
    type(takeField(), lines(20));
    expect(takeField().rows).toBe(12);
    expect(questionField().rows).toBe(2);
    type(questionField(), lines(4, "pergunta"));
    expect(questionField().rows).toBe(4);
    type(questionField(), lines(10, "pergunta"));
    expect(questionField().rows).toBe(6);
  });

  it("C110 Perguntar direto: Pergunta 2 rows growing to 6", async () => {
    mountAsk();
    await up();
    expect(fieldLabels()).toEqual(["Pergunta"]);
    expect(questionField().rows).toBe(2);
    type(questionField(), lines(3, "pergunta"));
    expect(questionField().rows).toBe(3);
    type(questionField(), lines(9, "pergunta"));
    expect(questionField().rows).toBe(6);
  });

  it("C110 Perguntar is .btn.primary with Send, below the fields, at their right", async () => {
    net.prefs.brain.ask = { mode: "reason_first", scope: null };
    mountAsk();
    await up();
    await waitFor(() => expect(fieldLabels()).toEqual(["Sua visão", "Pergunta"]));
    const button = sendButton();
    expect(button.textContent).toBe("Perguntar");
    expect(button.matches(".btn.primary")).toBe(true);
    expect(icons(button)).toEqual(["lucide lucide-send"]);
    expect(before(takeField(), button)).toBe(true);
    expect(before(questionField(), button)).toBe(true);
    expect(button.parentElement!.matches(".ask-send")).toBe(true);
    expect(rule(CSS, ".ask .ask-send")).toMatchObject({ display: "flex", "justify-content": "flex-end" });
    // a textarea is as tall as its rows, not the inputs' least height
    expect(rule(CSS, ".ask textarea.input")).toMatchObject({ "min-height": "0" });
  });
});

describe("C111 the card Sua visão", () => {
  it("C111 a 10-line take is 12px secondary text clamped to 6 lines with Mostrar tudo, which shows the whole take", async () => {
    const take = lines(10);
    const text = await openReasonFirst(take);
    const card = text.closest<HTMLElement>(".ask-take")!;
    expect(within(card).getByRole("heading", { name: "Sua visão" })).toBeTruthy();
    expect(text.textContent).toBe(take);
    expect(text.hasAttribute("data-clamped")).toBe(true);
    expect(rule(CSS, ".ask .ask-take-text")).toMatchObject({
      "font-size": "var(--fs-2)",
      color: "var(--text-dim)",
    });
    expect(rule(CSS, ".ask .ask-take-text[data-clamped]")).toMatchObject({
      display: "-webkit-box",
      overflow: "hidden",
      "-webkit-box-orient": "vertical",
      "-webkit-line-clamp": "6",
    });
    fireEvent.click(within(card).getByRole("button", { name: "Mostrar tudo" }));
    expect(text.hasAttribute("data-clamped")).toBe(false);
    expect(text.textContent).toBe(take);
    expect(within(card).queryByRole("button", { name: "Mostrar tudo" })).toBeNull();
  });

  it("C111 a 3-line take shows no Mostrar tudo and is not clamped", async () => {
    const take = "Acho que é uma etapa só.\nSem formulário.\nE já decidimos isso.";
    const text = await openReasonFirst(take);
    expect(text.textContent).toBe(take);
    expect(text.hasAttribute("data-clamped")).toBe(false);
    expect(
      within(text.closest<HTMLElement>(".ask-take")!).queryByRole("button", { name: "Mostrar tudo" }),
    ).toBeNull();
  });
});

/* ---------------- Round 2 fixes (batch F2): C116, the off state's arrangement ---------------- */

describe("C116 the off state replaces only the fields", () => {
  /** Send `Q` directly and get `409 skill_unavailable`; the off card on screen. */
  async function turnedOff() {
    kit.settings = { memorySkills: ["recall", "minha-skill"], folderAccess: [] };
    on(
      "ask",
      only({ question: Q, mode: "direct", scope: { kind: "all" } }, new NetError(409, "skill_unavailable")),
    );
    on("settings", only({ memorySkills: ["recall", "minha-skill", "brain-ask"] }, {}));
    mountAsk();
    await up();
    await waitFor(() => expect(document.querySelector(".ask-empty")).not.toBeNull());
    type(questionField(), Q);
    fireEvent.click(sendButton());
    await waitFor(() => expect(document.querySelector(".ask-off")).not.toBeNull());
  }
  /** The five regions of the off state, each checked for what it holds; the mode region and the off region. */
  function offRegions() {
    expect(regions()).toHaveLength(5);
    const [head, scope, mode, off, recent] = regions();
    expect(within(head!).getByRole("heading", { level: 1, name: "Perguntar ao cérebro" })).toBeTruthy();
    expect(within(scope!).getByText("Sobre:")).toBeTruthy();
    expect(within(scope!).getByRole("button", { name: "Todo o cérebro" }).matches(".btn.sm")).toBe(true);
    const tabs = within(mode!).getByRole("tablist");
    expect(
      within(tabs)
        .getAllByRole("tab")
        .map((t) => t.textContent),
    ).toEqual(["Perguntar direto", "Raciocine primeiro"]);
    // the off card where the fields were: Lock, the sentence and Ligar, and no field
    const card = off!.querySelector<HTMLElement>(".ask-off");
    expect(card).not.toBeNull();
    expect(icons(card!)).toEqual(["lucide lucide-lock"]);
    expect(
      within(card!).getByText("Perguntar está desligado: a skill brain-ask não pode ler a memória."),
    ).toBeTruthy();
    expect(within(card!).getByRole("button", { name: "Ligar" }).matches(".btn.primary")).toBe(true);
    expect(off!.querySelector("textarea")).toBeNull();
    expect(document.querySelector(".ask-fields")).toBeNull();
    expect(document.querySelector(".ask-result")).toBeNull();
    expect(within(recent!).getByRole("heading", { name: "PERGUNTAS RECENTES" })).toBeTruthy();
    return { mode: mode!, off: off! };
  }

  it("C116 after 409 skill_unavailable the regions are header, scope, mode (two tabs, selectable), the off card in the fields' place, recent questions", async () => {
    await turnedOff();
    const { mode } = offRegions();
    expect(tab("Perguntar direto").getAttribute("aria-selected")).toBe("true");
    for (const t of within(mode).getAllByRole("tab")) expect(t.hasAttribute("disabled")).toBe(false);
    expect(within(mode).queryByText(HINT)).toBeNull();
  });

  it("C116 switching the mode in the off state keeps the off card, with Raciocine primeiro's hint in the mode; Ligar brings the fields back in that mode, with the question", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await turnedOff();
    await user.click(tab("Raciocine primeiro"));
    await waitFor(() => expect(tab("Raciocine primeiro").getAttribute("aria-selected")).toBe("true"));
    const { mode, off } = offRegions();
    const hint = within(mode).getByText(HINT);
    expect(before(within(mode).getByRole("tablist"), hint)).toBe(true);
    // and back: the off card stays in either mode
    await user.click(tab("Perguntar direto"));
    await waitFor(() => expect(tab("Perguntar direto").getAttribute("aria-selected")).toBe("true"));
    offRegions();
    await user.click(tab("Raciocine primeiro"));
    await waitFor(() => expect(tab("Raciocine primeiro").getAttribute("aria-selected")).toBe("true"));
    offRegions();

    fireEvent.click(within(off).getByRole("button", { name: "Ligar" }));
    await waitFor(() =>
      expect(sent("settings")).toEqual([{ memorySkills: ["recall", "minha-skill", "brain-ask"] }]),
    );
    await waitFor(() => expect(document.querySelector(".ask-off")).toBeNull());
    expect(tab("Raciocine primeiro").getAttribute("aria-selected")).toBe("true");
    expect(fieldLabels()).toEqual(["Sua visão", "Pergunta"]);
    expect(questionField().value).toBe(Q);
    const [, , , fields] = regions();
    expect(regions()).toHaveLength(5);
    expect(fields!.getAttribute("role")).toBe("tabpanel");
    expect(fields!.querySelector(".ask-fields")).not.toBeNull();
  });
});

// A test must not leak the fake clock into another file's timers.
afterEach(() => void act(() => undefined));
