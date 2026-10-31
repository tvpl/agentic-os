// @vitest-environment jsdom
/**
 * The "Revisões" screen in rendered components (.specs/features/cerebro-natureza, C72, C73, C75-C79, C81-C85;
 * design.md "Tela - Revisões"; plan.md amendments 6-9, 23): the arrangement top to bottom and left to right, each list
 * item's two lines, the three action rows, each decision and its notice, the undo of each side and the partial one,
 * "Atualizar", "Adiar", the conflict, the states, the filters with the context, and the "Sem classificação" tab. The
 * network is `../notes/testnet` with the routes of `./testkit`, which answers each list only for the query it expects.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import postcss from "postcss";
import type * as ApiModule from "../../api";
import { installPage } from "../../ui/testkit";
import { OPEN_NOTE_EVENT } from "../noteEvents";
import { asked, resetNet } from "../notes/testnet";
import {
  NetError,
  WORK,
  actions,
  dayAfter,
  dayBefore,
  decided,
  detail,
  findList,
  item,
  itemNamed,
  list,
  listStatus,
  monthsBefore,
  mountReviews,
  names,
  net,
  notice,
  resetReviews,
  reviews,
  sent,
} from "./testkit";

vi.mock("../../api", async (importOriginal) =>
  (await import("../notes/testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.setConfig({ testTimeout: 30_000 });

installPage();
beforeEach(() => {
  resetNet();
  resetReviews();
});

const CSS = postcss.parse(readFileSync(join(__dirname, "reviews.css"), "utf8"));
/** The declarations of a rule of reviews.css whose selector list holds `selector`. */
function rule(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  CSS.walkRules((r) => {
    if (r.parent?.type !== "root" || !r.selectors.includes(selector)) return;
    r.walkDecls((d) => void (out[d.prop] = d.value));
  });
  return out;
}
const before = (a: Element, b: Element) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const flush = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const current = () => document.querySelector('.rv-pick[aria-current="true"] .rv-name')?.textContent;
const monthsBack = (n: number) => monthsBefore(new Date(), n).getTime();
const stateAlert = () =>
  waitFor(() => {
    const el = document.querySelector<HTMLElement>('.rv-state[role="alert"]');
    expect(el?.textContent).toBeTruthy();
    return el!;
  });
const withContext = () => {
  net.contexts = [{ id: "proj-x", name: "Projeto X", paths: [{ path: WORK, state: "ok" }], files: 3 }];
  net.prefs.activeContext = "proj-x";
};

/** Three items due, the first an editable plano. */
function three() {
  const a = item("notes/alfa.md", { natureza: "plano", lastReviewed: dayBefore(0, 4) });
  const b = item("notes/beta.md", { natureza: "opiniao" });
  const c = item("notes/gama.md", { natureza: "fato" });
  list({}, [a, b, c]);
  list({ kind: "unclassified" }, []);
  return [a, b, c] as const;
}

/* ---------------- C72: the arrangement ---------------- */

describe("C72 the screen top to bottom and left to right", () => {
  for (const ctx of [true, false])
    it(`C72 the title, then the Tabs Para revisar (2) and Sem classificação (5), the Natureza then Escopo filters and ${ctx ? "Contexto: Projeto X" : "Contexto: Todo o cérebro"} on the header's right, the list left of the detail`, async () => {
      if (ctx) withContext();
      const q = ctx ? { context: "proj-x" } : {};
      list(q, [item("notes/a.md"), item("notes/b.md")]);
      list(
        { ...q, kind: "unclassified" },
        Array.from({ length: 5 }, (_, i) => item(`notes/u${i}.md`)),
      );
      mountReviews();
      await findList();
      const title = screen.getByRole("heading", { level: 1, name: "Revisões" });
      const tabs = screen.getAllByRole("tab");
      expect(tabs.map((t) => t.textContent)).toEqual(["Para revisar (2)", "Sem classificação (5)"]);
      const head = document.querySelector(".rv-head")!;
      expect(head.firstElementChild).toBe(title);
      const tools = head.querySelector(".rv-tools")!;
      expect(before(title, tools)).toBe(true);
      expect([...tools.children].map((c) => c.getAttribute("aria-label") ?? c.textContent)).toEqual([
        "Natureza",
        "Escopo",
        ctx ? "Contexto: Projeto X" : "Contexto: Todo o cérebro",
      ]);
      // The header's two ends: the title on the left, the tools on the right.
      expect(rule(".rv-head")).toMatchObject({ display: "flex", "justify-content": "space-between" });
      expect(before(head, tabs[0]!)).toBe(true);
      const body = document.querySelector(".rv-body")!;
      expect(before(tabs[1]!, body)).toBe(true);
      expect([...body.children].map((c) => c.className)).toEqual(["rv-list", "rv-detail"]);
      expect(rule(".rv-body")).toMatchObject({
        display: "grid",
        "grid-template-columns": "minmax(240px, 2fr) 3fr",
      });
    });
});

/* ---------------- C73: the list items ---------------- */

describe("C73 each list item, the order and the keys", () => {
  it("C73 line 1 the name (13px, 600) then the badge; line 2 (12px, secondary) the path, the age, the scope badge; the route's order kept", async () => {
    const reviewed = item("notes/revisada.md", {
      natureza: "opiniao",
      escopo: "equipe",
      lastReviewed: dayBefore(0, 4),
    });
    const never = item("notes/nunca.md", { lastReviewed: null, mtime: monthsBack(5), escopo: "pessoal" });
    const third = item("notes/outra.md", { natureza: "plano" });
    list({}, [never, third, reviewed]);
    list({ kind: "unclassified" }, []);
    mountReviews();
    await findList();
    expect(names()).toEqual(["nunca.md", "outra.md", "revisada.md"]);
    await waitFor(() =>
      expect(itemNamed("revisada.md").querySelector(".rv-path")!.textContent).toBe(
        "memory/notes/revisada.md",
      ),
    );
    const line = (li: HTMLElement, n: 1 | 2) =>
      [...li.querySelector(`.rv-line${n}`)!.children].map((c) => `${c.className}|${c.textContent}`);
    expect(line(itemNamed("revisada.md"), 1)).toEqual([
      "rv-name|revisada.md",
      "badge meta nb tone-accent|Opinião",
    ]);
    expect(line(itemNamed("revisada.md"), 2)).toEqual([
      "rv-path|memory/notes/revisada.md",
      "rv-age|revisado há 4 meses",
      "badge meta nb nb-scope|Equipe",
    ]);
    expect(line(itemNamed("nunca.md"), 2)).toEqual([
      "rv-path|memory/notes/nunca.md",
      "rv-age|nunca revisado · alterado há 5 meses",
      "badge meta nb nb-scope|Pessoal",
    ]);
    expect(rule(".rv-name")).toMatchObject({ "font-size": "var(--fs-3)", "font-weight": "600" });
    expect(rule(".rv-line2")).toMatchObject({ color: "var(--text-dim)", "font-size": "var(--fs-2)" });
  });

  it("C73 j and k move the selection and Enter on an item opens its detail", async () => {
    three();
    mountReviews();
    await findList();
    await waitFor(() => expect(current()).toBe("alfa.md"));
    const user = userEvent.setup();
    await user.keyboard("j");
    await waitFor(() => expect(current()).toBe("beta.md"));
    expect(detail().getByRole("heading", { level: 2 }).textContent).toBe("beta.md");
    await user.keyboard("j");
    await waitFor(() => expect(current()).toBe("gama.md"));
    await user.keyboard("k");
    await waitFor(() => expect(current()).toBe("beta.md"));
    itemNamed("alfa.md").querySelector<HTMLButtonElement>(".rv-pick")!.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(current()).toBe("alfa.md"));
    expect(detail().getByRole("heading", { level: 2 }).textContent).toBe("alfa.md");
  });
});

/* ---------------- C75: the action rows ---------------- */

const SIX = ["Ainda vale", "Atualizar", "Virou realidade", "Mudei de ideia", "Adiar", "Não cobrar mais"];
const FIVE = ["Ainda vale", "Atualizar", "Mudei de ideia", "Adiar", "Não cobrar mais"];

describe("C75 the detail's action row, one case per kind of item", () => {
  const cases: Array<[string, Parameters<typeof item>[1], string[]]> = [
    ["an editable plano", { natureza: "plano" }, SIX],
    ["an editable hipotese", { natureza: "hipotese" }, SIX],
    ["an editable opiniao", { natureza: "opiniao" }, FIVE],
    ["an editable note with no nature", {}, FIVE],
    [
      "a file outside memory/ (editable: false)",
      { root: WORK, natureza: "plano" },
      ["Ainda vale", "Adiar", "Não cobrar mais"],
    ],
  ];
  for (const [label, over, row] of cases)
    it(`C75 ${label} shows ${row.join(", ")}, left to right`, async () => {
      list({}, [item(label.includes("outside") ? "fora.md" : "notes/n.md", over)]);
      mountReviews();
      await findList();
      await waitFor(() => expect(actions()).toEqual(row));
      const acts = [...document.querySelectorAll<HTMLButtonElement>(".rv-acts button")];
      const by = (name: string) => acts.find((b) => b.textContent!.trim() === name)!;
      expect(by("Ainda vale").className).toBe("btn primary");
      expect(by("Ainda vale").querySelector("svg.lucide-check")).not.toBeNull();
      expect(by("Adiar").getAttribute("aria-haspopup")).toBe("menu");
      expect(by("Não cobrar mais").className).toBe("btn ghost");
      expect(by("Não cobrar mais").querySelector("svg.lucide-bell-off")).not.toBeNull();
      const lock = document.querySelector(".rv-readonly");
      if (row.length === 3) {
        expect(lock!.textContent).toBe("Fora de memory/: a decisão fica no MordomoOS, o arquivo não muda.");
        expect(lock!.querySelector("svg.lucide-lock")).not.toBeNull();
        expect(before(lock!, document.querySelector(".rv-acts")!)).toBe(true);
        return;
      }
      expect(lock).toBeNull();
      expect(by("Atualizar").className).toBe("btn");
      expect(by("Atualizar").querySelector("svg.lucide-pencil-line")).not.toBeNull();
      expect(by("Mudei de ideia").className).toBe("btn");
      expect(by("Mudei de ideia").querySelector("svg.lucide-archive")).not.toBeNull();
      if (row.length === 6) {
        expect(by("Virou realidade").className).toBe("btn");
        expect(by("Virou realidade").querySelector("svg.lucide-circle-check")).not.toBeNull();
      }
    });

  it("C75 the detail shows up to 600 characters of the note's start through the one Markdown renderer, and its passages each with its badge", async () => {
    const long = `**Negrito** ${"x".repeat(900)}`;
    const content = `> [!plano] Lançamento em março\n> com 3 turmas\n\n> [!FATO] Preço\n\n${long}\n`;
    list({}, [item("notes/p.md", { natureza: "plano", content })]);
    mountReviews();
    await findList();
    const excerpt = await waitFor(() => {
      const el = document.querySelector(".rv-detail .rv-excerpt");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(excerpt.textContent!.length).toBeLessThanOrEqual(600);
    expect(content.slice(0, 600).includes("**Negrito**")).toBe(true);
    expect(excerpt.querySelector("strong")?.textContent).toBe("Negrito");
    const passages = [...document.querySelectorAll(".rv-passages li")].map((li) =>
      [...li.children].map((c) => c.textContent),
    );
    expect(passages).toEqual([
      ["Plano — ainda não é realidade", "Lançamento em março"],
      ["Fato", "Preço"],
    ]);
  });
});

/* ---------------- C76: a decision and its notice ---------------- */

describe("C76 a decision leaves the list with its notice", () => {
  it("C76 Ainda vale sends keep with the item's version; the item leaves, focus goes to the next, the notice is up at 7 999 ms and gone at 8 000 ms, and the status reads 2 itens para revisar", async () => {
    const [a] = three();
    reviews.decide = (b) => Promise.resolve(decided((b as { path: string }).path, { version: "sha256:v2" }));
    mountReviews();
    await findList();
    await waitFor(() => expect(listStatus()).toBe("3 itens para revisar"));
    await waitFor(() => expect(actions()[0]).toBe("Ainda vale"));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(button("Ainda vale"));
    await flush();
    expect(sent("POST", "/api/memory/reviews")).toEqual([
      {
        path: a.path,
        action: "keep",
        baseVersion: `sha256:${net.files.find((f) => f.rel === "notes/alfa.md")!.id}`,
      },
    ]);
    expect(notice()!.textContent).toBe("Marcado como ainda vale.Desfazer");
    act(() => void vi.advanceTimersByTime(150));
    expect(names()).toEqual(["beta.md", "gama.md"]);
    expect(document.activeElement?.querySelector(".rv-name")?.textContent).toBe("beta.md");
    expect(listStatus()).toBe("2 itens para revisar");
    act(() => void vi.advanceTimersByTime(7_999 - 150));
    expect(notice()).not.toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(notice()).toBeNull();
  });

  const others: Array<
    [
      string,
      Parameters<typeof item>[1],
      (u: ReturnType<typeof userEvent.setup>) => Promise<void>,
      string,
      Record<string, unknown>,
    ]
  > = [
    [
      "Adiar 14 dias",
      { natureza: "opiniao" },
      async (u) => {
        await u.click(button("Adiar"));
        await u.click(await screen.findByRole("menuitem", { name: "14 dias" }));
      },
      "Adiado por 14 dias.",
      { action: "snooze", days: 14 },
    ],
    [
      "Não cobrar mais",
      { natureza: "opiniao" },
      (u) => u.click(button("Não cobrar mais")),
      "Não vou cobrar mais.",
      { action: "never" },
    ],
    [
      "Mudei de ideia",
      { natureza: "opiniao" },
      (u) => u.click(button("Mudei de ideia")),
      "Marcado como abandonado.",
      { action: "abandon" },
    ],
    [
      "Virou realidade",
      { natureza: "plano" },
      async (u) => {
        await u.click(button("Virou realidade"));
        await u.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Confirmar" }));
      },
      "Marcado como realidade.",
      { action: "became_fact" },
    ],
  ];
  for (const [label, over, run, text, body] of others)
    it(`C76 ${label} shows ${text}`, async () => {
      const it1 = item("notes/n.md", over);
      list({}, [it1, item("notes/m.md")]);
      reviews.decide = (b) =>
        Promise.resolve(decided((b as { path: string }).path, { version: "sha256:v2" }));
      mountReviews();
      await findList();
      await waitFor(() => expect(actions()[0]).toBe("Ainda vale"));
      await run(userEvent.setup());
      await waitFor(() => expect(notice()?.textContent).toBe(`${text}Desfazer`));
      expect(sent("POST", "/api/memory/reviews")[0]).toMatchObject({ path: it1.path, ...body });
      await waitFor(() => expect(names()).toEqual(["m.md"]));
    });

  it("C76 Ainda vale on an item with editable: false sends no baseVersion", async () => {
    const out = item("fora.md", { root: WORK });
    list({}, [out]);
    reviews.decide = (b) => Promise.resolve(decided((b as { path: string }).path));
    mountReviews();
    await findList();
    await waitFor(() => expect(actions()).toEqual(["Ainda vale", "Adiar", "Não cobrar mais"]));
    await userEvent.setup().click(button("Ainda vale"));
    await waitFor(() =>
      expect(sent("POST", "/api/memory/reviews")).toEqual([{ path: out.path, action: "keep" }]),
    );
  });
});

/* ---------------- C77, C78: Desfazer ---------------- */

/** A kit route that answers only the body it expects; anything else is a refusal the screen would show. */
const only =
  (expected: unknown, answer: unknown) =>
  (body: unknown): Promise<unknown> =>
    JSON.stringify(body) === JSON.stringify(expected)
      ? Promise.resolve(answer)
      : Promise.reject(new NetError(400, "validation", `unexpected body ${JSON.stringify(body)}`));

describe("C77 Desfazer, one case per side", () => {
  for (const [label, props, change] of [
    [
      "puts back the old last_reviewed",
      [{ key: "last_reviewed", kind: "date", value: "2026-06-01" }],
      { set: { last_reviewed: "2026-06-01" } },
    ],
    ["removes last_reviewed when it was absent", [], { remove: ["last_reviewed"] }],
  ] as const)
    it(`C77 after a keep on an editable note, the properties change with the version the POST answered ${label}, and the item returns to its place`, async () => {
      const a = item("notes/a.md", { natureza: "opiniao", properties: [...props] });
      const b = item("notes/b.md");
      list({}, [a, b]);
      list({ kind: "unclassified" }, []);
      reviews.decide = only(
        {
          path: a.path,
          action: "keep",
          baseVersion: `sha256:${net.files.find((f) => f.rel === "notes/a.md")!.id}`,
        },
        decided(a.path, { version: "sha256:v2" }),
      );
      reviews.props = only(
        { path: a.path, baseVersion: "sha256:v2", ...change },
        { version: "sha256:v3", properties: [] },
      );
      mountReviews();
      await findList();
      await waitFor(() => expect(actions()[0]).toBe("Ainda vale"));
      const user = userEvent.setup();
      await user.click(button("Ainda vale"));
      await waitFor(() => expect(names()).toEqual(["b.md"]));
      await user.click(within(notice() as HTMLElement).getByRole("button", { name: "Desfazer" }));
      await waitFor(() => expect(names()).toEqual(["a.md", "b.md"]));
      expect(sent("PUT", "/api/memory/notes/properties")).toEqual([
        { path: a.path, baseVersion: "sha256:v2", ...change },
      ]);
      expect(notice()).toBeNull();
    });

  it("C77 after a snooze on a file outside memory/, restore with the previous the snooze answered", async () => {
    const out = item("fora.md", { root: WORK });
    list({}, [out]);
    const previous = { lastReviewed: 1_700_000_000_000, snoozeUntil: null, never: 0 };
    reviews.decide = (b) =>
      (b as { action: string }).action === "snooze"
        ? only(
            { path: out.path, action: "snooze", days: 7 },
            decided(out.path, { previous, state: { ...previous, snoozeUntil: 9 } }),
          )(b)
        : only(
            { path: out.path, action: "restore", state: previous },
            decided(out.path, { state: previous }),
          )(b);
    mountReviews();
    await findList();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Adiar" }));
    await user.click(await screen.findByRole("menuitem", { name: "7 dias" }));
    await waitFor(() => expect(notice()?.textContent).toBe("Adiado por 7 dias.Desfazer"));
    await user.click(within(notice() as HTMLElement).getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(names()).toEqual(["fora.md"]));
    expect(sent("POST", "/api/memory/reviews")).toEqual([
      { path: out.path, action: "snooze", days: 7 },
      { path: out.path, action: "restore", state: previous },
    ]);
    expect(sent("PUT", "/api/memory/notes/properties")).toEqual([]);
  });

  it("C77 after a became_fact with a fact, both the properties change and the fact's retract", async () => {
    const a = item("notes/plano.md", {
      natureza: "plano",
      properties: [{ key: "natureza", kind: "text", value: "plano" }],
    });
    list({}, [a]);
    const version = `sha256:${net.files.find((f) => f.rel === "notes/plano.md")!.id}`;
    reviews.decide = (b) => {
      const body = b as { fact: { validFrom: number } };
      return only(
        {
          path: a.path,
          action: "became_fact",
          baseVersion: version,
          fact: {
            subject: "Curso",
            predicate: "lançamento",
            object: "março",
            validFrom: body.fact?.validFrom,
          },
        },
        decided(a.path, { version: "sha256:v2", fact: { id: 7 } }),
      )(b);
    };
    reviews.props = only(
      {
        path: a.path,
        baseVersion: "sha256:v2",
        set: { natureza: "plano" },
        remove: ["was", "became_fact", "last_reviewed"],
      },
      { version: "sha256:v3", properties: [] },
    );
    reviews.retract = (id) =>
      id === "7" ? Promise.resolve({ id: 7 }) : Promise.reject(new NetError(404, "not_found"));
    mountReviews();
    await findList();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Virou realidade" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Registrar como fato" }));
    await user.type(within(dialog).getByLabelText("O quê"), "Curso");
    await user.type(within(dialog).getByLabelText("Atributo"), "lançamento");
    await user.type(within(dialog).getByLabelText("Valor"), "março");
    await user.click(within(dialog).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(notice()?.textContent).toBe("Marcado como realidade.Desfazer"));
    await user.click(within(notice() as HTMLElement).getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(names()).toEqual(["plano.md"]));
    expect(sent("PUT", "/api/memory/notes/properties")).toHaveLength(1);
    expect(sent("POST", "/api/memory/facts/7/retract")).toHaveLength(1);
    expect(notice()).toBeNull();
  });
});

describe("C78 a partial undo", () => {
  it("C78 the properties change answers and the retract fails: the note stays restored, Não foi possível desfazer tudo. with Tentar de novo, which sends only the retract again and clears the notice", async () => {
    const a = item("notes/plano.md", { natureza: "plano" });
    list({}, [a]);
    reviews.decide = (b) =>
      Promise.resolve(decided((b as { path: string }).path, { version: "sha256:v2", fact: { id: 9 } }));
    reviews.props = () => Promise.resolve({ version: "sha256:v3", properties: [] });
    let fail = true;
    reviews.retract = () => (fail ? Promise.reject(new NetError(500, "boom")) : Promise.resolve({ id: 9 }));
    mountReviews();
    await findList();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Virou realidade" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Registrar como fato" }));
    await user.type(within(dialog).getByLabelText("O quê"), "a");
    await user.type(within(dialog).getByLabelText("Atributo"), "b");
    await user.type(within(dialog).getByLabelText("Valor"), "c");
    await user.click(within(dialog).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(notice()?.textContent).toBe("Marcado como realidade.Desfazer"));
    await user.click(within(notice() as HTMLElement).getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(notice()?.textContent).toBe("Não foi possível desfazer tudo.Tentar de novo"));
    expect(notice()!.querySelector("svg.lucide-triangle-alert")).not.toBeNull();
    expect(sent("PUT", "/api/memory/notes/properties")).toHaveLength(1);
    expect(sent("POST", "/api/memory/facts/9/retract")).toHaveLength(1);
    fail = false;
    await user.click(within(notice() as HTMLElement).getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(notice()).toBeNull());
    expect(sent("POST", "/api/memory/facts/9/retract")).toHaveLength(2);
    expect(sent("PUT", "/api/memory/notes/properties")).toHaveLength(1);
    expect(names()).toEqual(["plano.md"]);
  });
});

/* ---------------- C79: Atualizar ---------------- */

describe("C79 Atualizar", () => {
  it("C79 opens the note editor on the item's path, sends no decision, and the item stays listed and selected", async () => {
    const [a] = three();
    const asked: unknown[] = [];
    const hear = (e: Event) => asked.push((e as CustomEvent).detail);
    window.addEventListener(OPEN_NOTE_EVENT, hear);
    mountReviews();
    await findList();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Atualizar" }));
    window.removeEventListener(OPEN_NOTE_EVENT, hear);
    expect(asked).toEqual([{ mode: "edit", path: a.path }]);
    expect(sent("POST", "/api/memory/reviews")).toEqual([]);
    expect(names()).toEqual(["alfa.md", "beta.md", "gama.md"]);
    expect(current()).toBe("alfa.md");
  });
});

/* ---------------- C81: Adiar ---------------- */

describe("C81 Adiar", () => {
  it("C81 opens the primitives' menu with 7, 14, 30 and 90 dias in that order, and 30 dias sends snooze with days 30", async () => {
    const [a] = three();
    reviews.decide = (b) => Promise.resolve(decided((b as { path: string }).path));
    mountReviews();
    await findList();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Adiar" }));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((m) => m.textContent),
    ).toEqual(["7 dias", "14 dias", "30 dias", "90 dias"]);
    await user.click(within(menu).getByRole("menuitem", { name: "30 dias" }));
    await waitFor(() =>
      expect(sent("POST", "/api/memory/reviews")).toEqual([{ path: a.path, action: "snooze", days: 30 }]),
    );
  });
});

/* ---------------- C82: the conflict ---------------- */

describe("C82 a 409 edit_conflict", () => {
  it("C82 keeps the item in its place with AlertTriangle, the sentence and Recarregar, which asks the list again with the same query", async () => {
    withContext();
    const a = item("notes/a.md", { natureza: "opiniao" });
    const b = item("notes/b.md");
    list({ context: "proj-x" }, [a, b]);
    reviews.decide = () => Promise.reject(new NetError(409, "edit_conflict", "The file changed"));
    mountReviews();
    await findList();
    await waitFor(() => expect(names()).toEqual(["a.md", "b.md"]));
    await waitFor(() => expect(actions()[0]).toBe("Ainda vale"));
    const user = userEvent.setup();
    await user.click(button("Ainda vale"));
    const box = await waitFor(() => {
      const el = itemNamed("a.md").querySelector(".rv-conflict");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(box.querySelector("svg.lucide-triangle-alert")).not.toBeNull();
    expect(box.textContent).toBe("A nota mudou desde que a lista foi carregada.Recarregar");
    expect(names()).toEqual(["a.md", "b.md"]);
    const due = () => asked("/api/memory/reviews").filter((q) => q.get("kind") === "due");
    const n = due().length;
    await user.click(within(box).getByRole("button", { name: "Recarregar" }));
    await waitFor(() => expect(due().length).toBe(n + 1));
    expect(due().at(-1)!.toString()).toBe(due().at(-2)!.toString());
    expect(due().at(-1)!.get("context")).toBe("proj-x");
  });
});

/* ---------------- C83: the states ---------------- */

describe("C83 the states, one case each", () => {
  it("C83 empty with nextDue 12 days ahead: the 32 px CircleCheck, Nada para revisar hoje. and below Próxima revisão em 12 dias", async () => {
    list({}, [], { nextDue: dayAfter(12) });
    mountReviews();
    const empty = await waitFor(() => {
      const el = document.querySelector(".rv-empty");
      expect(el).not.toBeNull();
      return el!;
    });
    const icon = empty.querySelector("svg.lucide-circle-check")!;
    expect(icon.getAttribute("width")).toBe("32");
    expect([...empty.children].slice(1).map((c) => c.textContent)).toEqual([
      "Nada para revisar hoje.",
      "Próxima revisão em 12 dias",
    ]);
  });

  it("C83 empty with nextDue null: the icon and the sentence, no third line", async () => {
    list({}, [], { nextDue: null });
    mountReviews();
    const empty = await waitFor(() => {
      const el = document.querySelector(".rv-empty");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(
      [...empty.children].map((c) => (c.tagName.toLowerCase() === "svg" ? "svg" : c.textContent)),
    ).toEqual(["svg", "Nada para revisar hoje."]);
  });

  it("C83 while the list loads, a spinner with Carregando…", async () => {
    list({}, "pending");
    mountReviews();
    const state = await waitFor(() => {
      const el = document.querySelector(".rv-state");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(state.querySelector(".spinner")).not.toBeNull();
    expect(state.textContent).toBe("Carregando…");
  });

  it("C83 when it fails, the error with Tentar de novo, which asks the list again", async () => {
    list({}, new NetError(500, "boom", "Falhou."));
    mountReviews();
    const alert = await stateAlert();
    expect(alert.textContent).toBe("Falhou.Tentar de novo");
    expect(alert.querySelector("svg.lucide-triangle-alert")).not.toBeNull();
    const n = asked("/api/memory/reviews").filter((q) => q.get("kind") === "due").length;
    list({}, [item("notes/volta.md")]);
    await userEvent.setup().click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(names()).toEqual(["volta.md"]));
    expect(asked("/api/memory/reviews").filter((q) => q.get("kind") === "due").length).toBe(n + 1);
  });
});

/* ---------------- C84: the filters ---------------- */

describe("C84 the filters and the context", () => {
  it("C84 five nature buttons and three scope buttons with aria-pressed; Plano and Equipe under proj-x ask exactly that query and show its answer", async () => {
    withContext();
    list({ context: "proj-x" }, [item("notes/todos.md")]);
    list({ context: "proj-x", natureza: "plano", escopo: "equipe" }, [
      item("notes/certa.md", { natureza: "plano", escopo: "equipe" }),
    ]);
    reviews.wrong = { items: [item("notes/errada.md")], total: 1, nextDue: null };
    mountReviews();
    await waitFor(() => expect(names()).toEqual(["todos.md"]));
    const nature = screen.getByRole("group", { name: "Natureza" });
    const scope = screen.getByRole("group", { name: "Escopo" });
    expect(
      within(nature)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Fato", "Relato", "Plano — ainda não é realidade", "Hipótese", "Opinião"]);
    for (const b of within(nature).getAllByRole("button")) {
      expect(b.getAttribute("aria-pressed")).toBe("false");
      expect(b.querySelector(".nb svg")).not.toBeNull();
    }
    expect(
      within(scope)
        .getAllByRole("button")
        .map((b) => `${b.textContent}|${b.getAttribute("aria-pressed")}`),
    ).toEqual(["Pessoal|false", "Equipe|false", "Externo|false"]);
    const user = userEvent.setup();
    await user.click(within(nature).getByRole("button", { name: /Plano/ }));
    await user.click(within(scope).getByRole("button", { name: "Equipe" }));
    expect(within(nature).getByRole("button", { name: /Plano/ }).getAttribute("aria-pressed")).toBe("true");
    expect(within(scope).getByRole("button", { name: "Equipe" }).getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(names()).toEqual(["certa.md"]));
    const last = asked("/api/memory/reviews")
      .filter((q) => q.get("kind") === "due")
      .at(-1)!;
    expect(Object.fromEntries(last)).toEqual({
      kind: "due",
      context: "proj-x",
      natureza: "plano",
      escopo: "equipe",
    });
  });
});

/* ---------------- C85: Sem classificação ---------------- */

describe("C85 the tab Sem classificação", () => {
  async function openTab(items: Parameters<typeof list>[1]) {
    list({}, [item("notes/devida.md")]);
    list({ kind: "unclassified" }, items);
    mountReviews();
    await findList();
    await userEvent.setup().click(screen.getByRole("tab", { name: /Sem classificação/ }));
  }

  it("C85 a suggestion of plano reads Sugestão: Plano with Confirmar (classify plano with the version), Opinião sends opiniao, Não classificar sends snooze 90", async () => {
    const u = item("notes/sem.md", { suggested: "plano", dueSince: null });
    const v = item("notes/outra.md", { suggested: "plano", dueSince: null });
    const w = item("notes/mais.md", { suggested: "plano", dueSince: null });
    reviews.decide = (b) => Promise.resolve(decided((b as { path: string }).path, { version: "sha256:v2" }));
    await openTab([u, v, w]);
    await waitFor(() => expect(names()).toEqual(["sem.md", "outra.md", "mais.md"]));
    const suggest = await waitFor(() => {
      const el = document.querySelector(".rv-suggest");
      expect(el?.textContent).toBe("Sugestão: PlanoConfirmar");
      return el!;
    });
    expect(suggest.querySelector(".nb.tone-info svg.lucide-compass")).not.toBeNull();
    const natures = [...document.querySelectorAll(".rv-natures button")].map((b) => b.textContent);
    expect(natures).toEqual(["Fato", "Relato", "Plano — ainda não é realidade", "Hipótese", "Opinião"]);
    const user = userEvent.setup();
    await waitFor(() => expect(asked("/api/memory/note").some((q) => q.get("p") === u.path)).toBe(true));
    await user.click(within(suggest as HTMLElement).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(notice()?.textContent).toBe("Classificado como Plano.Desfazer"));
    await waitFor(() => expect(asked("/api/memory/note").some((q) => q.get("p") === v.path)).toBe(true));
    await waitFor(() => expect(names()).toEqual(["outra.md", "mais.md"]));
    await user.click(
      within(document.querySelector(".rv-natures") as HTMLElement).getByRole("button", { name: "Opinião" }),
    );
    await waitFor(() => expect(names()).toEqual(["mais.md"]));
    await user.click(screen.getByRole("button", { name: "Não classificar" }));
    await waitFor(() => expect(sent("POST", "/api/memory/reviews")).toHaveLength(3));
    const id = (rel: string) => net.files.find((f) => f.rel === rel)!.id;
    expect(sent("POST", "/api/memory/reviews")).toEqual([
      { path: u.path, action: "classify", natureza: "plano", baseVersion: `sha256:${id("notes/sem.md")}` },
      {
        path: v.path,
        action: "classify",
        natureza: "opiniao",
        baseVersion: `sha256:${id("notes/outra.md")}`,
      },
      { path: w.path, action: "snooze", days: 90 },
    ]);
  });

  it("C85 an item with suggested: null shows Sem sugestão and the five buttons", async () => {
    await openTab([item("notes/nada.md", { suggested: null, dueSince: null })]);
    await waitFor(() => expect(document.querySelector(".rv-suggest")?.textContent).toBe("Sem sugestão"));
    expect([...document.querySelectorAll(".rv-natures button")].map((b) => b.textContent)).toEqual([
      "Fato",
      "Relato",
      "Plano — ainda não é realidade",
      "Hipótese",
      "Opinião",
    ]);
    expect(document.querySelector(".rv-acts")).toBeNull();
  });

  it("C85 empty reads as in C83", async () => {
    await openTab([]);
    await waitFor(() =>
      expect(document.querySelector(".rv-empty")?.textContent).toBe("Nada para revisar hoje."),
    );
    expect(document.querySelector(".rv-empty svg.lucide-circle-check")).not.toBeNull();
  });

  it("C85 loading reads as in C83", async () => {
    list({}, []);
    list({ kind: "unclassified" }, "pending");
    mountReviews();
    await userEvent.setup().click(await screen.findByRole("tab", { name: /Sem classificação/ }));
    await waitFor(() => expect(document.querySelector(".rv-state")?.textContent).toBe("Carregando…"));
    expect(document.querySelector(".rv-state .spinner")).not.toBeNull();
  });

  it("C85 error reads as in C83, and Tentar de novo asks the tab's list again", async () => {
    list({}, []);
    list({ kind: "unclassified" }, new NetError(500, "boom", "Falhou."));
    mountReviews();
    await userEvent.setup().click(await screen.findByRole("tab", { name: /Sem classificação/ }));
    const alert = await stateAlert();
    expect(alert.textContent).toBe("Falhou.Tentar de novo");
    const n = asked("/api/memory/reviews").filter((q) => q.get("kind") === "unclassified").length;
    await userEvent.setup().click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() =>
      expect(asked("/api/memory/reviews").filter((q) => q.get("kind") === "unclassified").length).toBe(n + 1),
    );
  });
});
