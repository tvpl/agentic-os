// @vitest-environment jsdom
process.env.TZ = "America/Sao_Paulo";
/**
 * What accepting a fact does, drawn on "Do agente" (.specs/features/cerebro-memoria-confiavel, C186-C189, C191; design.md
 * "Emenda 1"; Landing 21; round 3 finding 6): under each fact op (or the single fact) one line per effect of the detail's
 * `effects`, an icon and a text, in the order closes, refuses, unchanged, error; placed by the op's own index; never a live
 * region; and the decision asks nothing more (owner question G40, default). The date of a close is a local day, so the
 * zone is pinned (L-053): `2026-11-01T02:30:00Z` is 31 October here, 1 November in UTC. The mock answers each proposal's
 * own detail by its id and fails on any other (L-051, L-052).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import postcss from "postcss";
import type * as ApiModule from "../../api";
import { installPage } from "../../ui/testkit";
import { resetNet } from "../notes/testnet";
import {
  NetError,
  accepted,
  detailOf,
  effect,
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
vi.setConfig({ testTimeout: 30_000 });

installPage();
beforeEach(() => {
  resetNet();
  resetReviews();
  resetProposals();
});

/** 23:30 of 31 October in São Paulo, 02:30 of 1 November in UTC. */
const LATE = Date.UTC(2026, 10, 1, 2, 30);
const closing = (over: Record<string, unknown> = {}) => ({
  id: 7,
  object: "ativo",
  validFrom: Date.UTC(2026, 0, 1, 15),
  validTo: null,
  action: "close" as const,
  at: LATE,
  ...over,
});
const retracting = (over: Record<string, unknown> = {}) =>
  closing({ id: 8, object: "prospect", action: "retract", at: Date.UTC(2026, 9, 31, 12), ...over });
const FACT_OP = op({
  op: "fact",
  section: "Fact",
  text: "Cliente X · status · inadimplente",
  trust: "usuario",
});

const detailEl = () => document.querySelector<HTMLElement>(".ag-detail")!;
const effectsOf = (row: Element) => row.querySelector(".ag-text > .ag-effects");
const lines = (ul: Element | null) =>
  [...(ul?.querySelectorAll<HTMLElement>(":scope > .ag-effect") ?? [])].map((li) => ({
    kind: li.dataset.effect,
    text: li.textContent,
    icon: li.querySelector("svg")?.getAttribute("class") ?? "",
  }));
const selected = () => document.querySelector('.rv-pick[aria-current="true"] .rv-name')?.textContent;

/** One `fact` proposal open on the tab, its detail holding `effects`. */
async function factProposal(
  effects: ReturnType<typeof effect>[],
  over: Partial<Parameters<typeof proposal>[0]> = {},
) {
  const p = proposal({
    kind: "fact",
    author: "mcp",
    runId: null,
    summary: "Cliente X · status · inadimplente",
    opCount: 1,
    ...over,
  });
  pending([p]);
  detailOf(p, { ops: [FACT_OP], effects, baseVersion: null });
  mountReviews({ search: "?tab=agent" });
  await waitFor(() => expect(document.querySelector(".ag-op")).not.toBeNull());
  return p;
}

/* ---------------- C186: closes and retracts ---------------- */

describe("C186 the facts accepting closes or retracts", () => {
  it("C186 the zone is pinned: 2026-11-01T02:30:00Z is 31 October here", () => {
    expect(process.env.TZ).toBe("America/Sao_Paulo");
    expect(new Date(LATE).getDate()).toBe(31);
    expect(new Date(LATE).getUTCDate()).toBe(1);
  });

  it("C186 a fact proposal: under its one op row's text, in the route's order, Encerra o fato … em 31/10/2026 (the effect's `at` as a local day) then Retrata o fato … como nunca verdadeiro, each an icon and a text", async () => {
    await factProposal([effect({ closes: [closing(), retracting()] })]);
    const row = document.querySelector(".ag-op")!;
    const text = row.querySelector(".ag-text")!;
    // the effects come after the op's own text inside its cell, and the row keeps its five cells
    expect([...text.children].map((c) => c.className || c.tagName.toLowerCase())).toEqual([
      "span",
      "ag-effects",
    ]);
    expect(row.children).toHaveLength(5);
    expect(lines(effectsOf(row))).toEqual([
      {
        kind: "close",
        text: "Encerra o fato Cliente X · status · ativo em 31/10/2026.",
        icon: expect.stringContaining("lucide-calendar-days"),
      },
      {
        kind: "retract",
        text: "Retrata o fato Cliente X · status · prospect como nunca verdadeiro. Não tem volta.",
        icon: expect.stringContaining("lucide-undo2"),
      },
    ]);
    expect(text.textContent).not.toContain("01/11/2026");
  });

  it("C186 exactly one effect line (a list of one) is drawn, and the retract line carries no date", async () => {
    await factProposal([effect({ closes: [retracting({ at: LATE })] })]);
    const found = lines(effectsOf(document.querySelector(".ag-op")!));
    expect(found.map((l) => l.kind)).toEqual(["retract"]);
    expect(found[0]!.text).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it("C186 in en the lines read Closes the fact … on 31/10/2026 and Retracts the fact … as never true", async () => {
    const p = proposal({
      kind: "fact",
      author: "mcp",
      runId: null,
      summary: "Cliente X · status · inadimplente",
    });
    pending([p]);
    detailOf(p, {
      ops: [FACT_OP],
      effects: [effect({ closes: [closing(), retracting()] })],
      baseVersion: null,
    });
    mountReviews({ lang: "en", search: "?tab=agent" });
    await waitFor(() => expect(document.querySelector(".ag-effects")).not.toBeNull());
    expect(lines(effectsOf(document.querySelector(".ag-op")!)).map((l) => l.text)).toEqual([
      "Closes the fact Cliente X · status · ativo on 31/10/2026.",
      "Retracts the fact Cliente X · status · prospect as never true. This cannot be undone.",
    ]);
  });
});

/* ---------------- C187: refuses, unchanged, error; and no second question ---------------- */

describe("C187 a refusal, an identical fact, a fact that cannot be asserted", () => {
  const cases: Array<[string, Partial<ReturnType<typeof effect>>, string, string, string]> = [
    [
      "refuses",
      { refuses: { id: 9, object: "ativo", validFrom: Date.UTC(2026, 0, 1), validTo: null } },
      "Será recusado: o fato Cliente X · status · ativo já vale em todo esse período. Aceitar dá o erro 409 fact_overlap.",
      "lucide-triangle-alert",
      "refuses",
    ],
    ["unchanged", { unchanged: 5 }, "Já existe um fato idêntico. Nada muda.", "lucide-check", "unchanged"],
    [
      "error",
      { error: "validTo: must be after validFrom" },
      "Não pode ser registrado: validTo: must be after validFrom",
      "lucide-triangle-alert",
      "error",
    ],
  ];
  for (const [name, over, text, icon, kind] of cases)
    it(`C187 ${name}: one line with its icon and the text, and nothing else`, async () => {
      await factProposal([effect(over)]);
      expect(lines(effectsOf(document.querySelector(".ag-op")!))).toEqual([
        { kind, text, icon: expect.stringContaining(icon) },
      ]);
    });

  it("C187 all of them together keep the order: the closes and retracts, then the refusal, then the identical fact, then the error", async () => {
    await factProposal([
      effect({
        closes: [retracting(), closing()],
        refuses: { id: 9, object: "ativo", validFrom: Date.UTC(2026, 0, 1), validTo: null },
        unchanged: 5,
        error: "x",
      }),
    ]);
    expect(lines(effectsOf(document.querySelector(".ag-op")!)).map((l) => l.kind)).toEqual([
      "retract",
      "close",
      "refuses",
      "unchanged",
      "error",
    ]);
  });

  it("C187 accepting asks nothing more (owner question G40, default): the button sends the decision at once and no dialog opens", async () => {
    const p = await factProposal([effect({ closes: [retracting()] })]);
    proposals.decide = () => Promise.resolve(accepted(p));
    fireEvent.click(within(detailEl()).getByRole("button", { name: "Aceitar selecionadas (1)" }));
    await waitFor(() =>
      expect(sent("POST", `/api/memory/proposals/${p.id}/decide`)).toEqual([{ action: "accept", ops: [0] }]),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("C187 a fact the route says would be refused is still offered: its checkbox is not disabled", async () => {
    await factProposal([effect({ refuses: { id: 9, object: "ativo", validFrom: 1, validTo: null } })]);
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(false);
  });
});

/* ---------------- C188: where the effects go ---------------- */

describe("C188 an effect goes under its own fact op, by the op's index", () => {
  it("C188 a consolidation: the effect of op 1 under op 1 and the effect of op 3 under op 3, none under the add, the invalid fact op or a fact with nothing to say", async () => {
    const p = proposal({ opCount: 5 });
    pending([p]);
    detailOf(p, {
      ops: [
        op({}),
        op({ op: "fact", section: "Fact", text: "um", trust: "usuario" }),
        op({ op: "fact", section: "Fact", text: "dois", state: "invalid", reason: "origem" }),
        op({ op: "fact", section: "Fact", text: "tres", trust: "usuario" }),
        op({ op: "fact", section: "Fact", text: "quatro", trust: "usuario" }),
      ],
      effects: [
        effect({ op: 1, closes: [closing()] }),
        effect({ op: 3, unchanged: 5 }),
        // a new fact of another key: it closes nothing and has nothing to say
        effect({ op: 4 }),
      ],
    });
    mountReviews({ search: "?tab=agent" });
    await waitFor(() => expect(document.querySelectorAll(".ag-op")).toHaveLength(5));
    const rows = [...document.querySelectorAll(".ag-op")];
    expect(rows.map((r) => lines(effectsOf(r)).map((l) => l.kind))).toEqual([
      [],
      ["close"],
      [],
      ["unchanged"],
      [],
    ]);
    expect(rows.map((r) => r.querySelector(".ag-effects") !== null)).toEqual([
      false,
      true,
      false,
      true,
      false,
    ]);
    expect(lines(effectsOf(rows[1]!))[0]!.text).toContain("Cliente X · status · ativo");
  });

  it("C188 the other kinds have none: a memory_edit, a note_create, a note_save and a consolidation with no fact op draw no effects", async () => {
    const kinds = [
      proposal({ kind: "memory_edit", summary: "MEMORY.md" }),
      proposal({ kind: "note_create", summary: "Reunião" }),
      proposal({ kind: "note_save", summary: "cliente.md" }),
      proposal({ kind: "consolidation", opCount: 1 }),
    ];
    pending(kinds);
    for (const p of kinds)
      detailOf(p, { ops: p.kind === "consolidation" ? [op({})] : [], diff: "@@ -0,0 +1 @@\n+x\n" });
    mountReviews({ search: "?tab=agent" });
    const user = userEvent.setup();
    for (let i = 0; i < kinds.length; i++) {
      await waitFor(() =>
        expect(document.querySelectorAll(".rv-pick")[i]!.getAttribute("aria-current")).toBe("true"),
      );
      await waitFor(() => expect(document.querySelector(".ag-detail")).not.toBeNull());
      expect(document.querySelector(".ag-effects"), kinds[i]!.kind).toBeNull();
      await user.keyboard("j");
    }
  });

  it("C188 each proposal's detail shows its own effects: choosing another proposal replaces them (the mock answers by id)", async () => {
    const a = proposal({ kind: "fact", author: "mcp", runId: null, summary: "A · a · 1" });
    const b = proposal({ kind: "fact", author: "mcp", runId: null, summary: "B · b · 2" });
    pending([a, b]);
    detailOf(a, { ops: [FACT_OP], effects: [effect({ closes: [closing()] })], baseVersion: null });
    detailOf(b, { ops: [FACT_OP], effects: [effect({ unchanged: 5 })], baseVersion: null });
    mountReviews({ search: "?tab=agent" });
    await waitFor(() =>
      expect(lines(effectsOf(document.querySelector(".ag-op")!)).map((l) => l.kind)).toEqual(["close"]),
    );
    expect(selected()).toBe("Fato: A · a");
    fireEvent.click(document.querySelectorAll<HTMLButtonElement>(".rv-pick")[1]!);
    await waitFor(() => expect(selected()).toBe("Fato: B · b"));
    await waitFor(() =>
      expect(lines(effectsOf(document.querySelector(".ag-op")!)).map((l) => l.kind)).toEqual(["unchanged"]),
    );
    expect(net.calls.filter((c) => c.url === `/api/memory/proposals/${b.id}`)).toHaveLength(1);
  });
});

/* ---------------- C189: nothing announced twice ---------------- */

describe("C189 the effects are not a live region", () => {
  const live = "[role=status], [role=alert], [aria-live]";

  it("C189 no effect list or line carries a live role, and the detail has the same live regions with and without effects", async () => {
    const full = effect({
      closes: [closing(), retracting()],
      refuses: { id: 9, object: "ativo", validFrom: 1, validTo: null },
      unchanged: 5,
      error: "x",
    });
    await factProposal([full]);
    const ul = document.querySelector(".ag-effects")!;
    expect(ul.matches(live) || ul.querySelector(live) !== null).toBe(false);
    expect([...ul.querySelectorAll("li")].every((li) => !li.matches(live))).toBe(true);
    const withEffects = detailEl().querySelectorAll(live).length;
    document.body.innerHTML = '<div id="root"></div><div id="modal-root"></div>';
    resetProposals();
    await factProposal([]);
    expect(document.querySelector(".ag-effects")).toBeNull();
    expect(detailEl().querySelectorAll(live).length).toBe(withEffects);
  });

  it("C189 a 409 fact_overlap on accepting is said once, by the detail's one alert; the effect that foretold it is plain text beside it", async () => {
    const p = await factProposal([
      effect({ refuses: { id: 9, object: "ativo", validFrom: 1, validTo: null } }),
    ]);
    proposals.decide = () =>
      Promise.reject(new NetError(409, "fact_overlap", "Um fato já vale em todo o período."));
    fireEvent.click(within(detailEl()).getByRole("button", { name: "Aceitar selecionadas (1)" }));
    await waitFor(() => expect(detailEl().querySelectorAll('[role="alert"]')).toHaveLength(1));
    const alert = detailEl().querySelector<HTMLElement>('[role="alert"]')!;
    expect(alert.textContent).toBe("Um fato já vale em todo o período.");
    expect(alert.closest(".ag-effects")).toBeNull();
    expect(document.querySelectorAll(".ag-effect")).toHaveLength(1);
    expect(sent("POST", `/api/memory/proposals/${p.id}/decide`)).toHaveLength(1);
  });
});

/* ---------------- C191: tones, sizes and tokens ---------------- */

const THEME = postcss.parse(readFileSync(join(__dirname, "..", "..", "theme.css"), "utf8"));
const AGENT = postcss.parse(readFileSync(join(__dirname, "agent.css"), "utf8"));
const decls = (selector: string): Record<string, string> => {
  const out: Record<string, string> = {};
  AGENT.walkRules((r) => {
    if (r.parent?.type === "root" && r.selectors.includes(selector))
      r.walkDecls((d) => void (out[d.prop] = d.value));
  });
  return out;
};

describe("C191 the effect lines use the existing tones and say it by icon and text", () => {
  it("C191 sentences at 13px; the retraction in --danger, the refusal and the error in --warn, the rest in the dim text colour; each from a token the theme defines", () => {
    expect(decls(".ag-effect")).toMatchObject({ color: "var(--text-dim)", "font-size": "var(--fs-3)" });
    expect(decls('.ag-effect[data-effect="retract"]')).toEqual({ color: "var(--danger)" });
    expect(decls('.ag-effect[data-effect="refuses"]')).toEqual({ color: "var(--warn)" });
    expect(decls('.ag-effect[data-effect="error"]')).toEqual({ color: "var(--warn)" });
    const defined = new Set<string>();
    THEME.walkRules(":root", (r) => r.walkDecls(/^--/, (d) => void defined.add(d.prop)));
    const used = new Set<string>();
    AGENT.walkRules((r) => {
      if (/ag-effect/.test(r.selector))
        r.walkDecls((d) => [...d.value.matchAll(/var\((--[\w-]+)/g)].forEach((m) => used.add(m[1]!)));
    });
    expect([...used].sort()).toEqual(["--danger", "--fs-3", "--s-2", "--text-dim", "--warn"]);
    for (const token of used) expect(defined.has(token), token).toBe(true);
    // and the sheet defines no token of its own
    AGENT.walkDecls(/^--/, (d) => expect.fail(`agent.css defines ${d.prop}`));
  });

  it("C191 every kind of line renders an icon and a non-empty text", async () => {
    await factProposal([
      effect({
        closes: [closing(), retracting()],
        refuses: { id: 9, object: "ativo", validFrom: 1, validTo: null },
        unchanged: 5,
        error: "x",
      }),
    ]);
    const found = [...document.querySelectorAll<HTMLElement>(".ag-effect")];
    expect(found.map((l) => l.dataset.effect)).toEqual(["close", "retract", "refuses", "unchanged", "error"]);
    for (const li of found) {
      expect(li.querySelector("svg"), li.dataset.effect).not.toBeNull();
      expect(li.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
      expect(li.textContent!.trim().length, li.dataset.effect).toBeGreaterThan(10);
    }
  });
});
