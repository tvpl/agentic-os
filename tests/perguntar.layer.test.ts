import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { checkAskAnswer, countSentences, resolveAskScope } from "@mordomo/core/internal";
import { audienceOf, audienceView } from "../apps/api/src/access.js";
import { mcpClientName } from "../apps/api/src/mcp/mordomo.js";
import { principalFromHeaders } from "../apps/api/src/server.js";
import { askWorld, paragraph, threeNotes, type AskWorld, type Json } from "./helpers/perguntarWorld.js";

/**
 * .specs/features/cerebro-perguntar, batch A, at their own layer (Test policy row 1, L-034): the answer's check
 * (`checkAskAnswer`, door 3), the scope's resolution (`resolveAskScope`) and the sentence rule (`countSentences`),
 * called with no HTTP over a real home and its index, one asserted case per row, each refused for its own reason alone
 * (L-039): every refused answer differs from an accepted one by that one rule.
 */

let w: AskWorld;
let notes: { onboarding: string; plano: string; clientes: string };
let seq = 0;

beforeAll(async () => {
  w = await askWorld(`mordomo-perguntar-layer-${++seq}-`);
  notes = await threeNotes(w);
});
afterAll(async () => {
  await w.close();
  vi.restoreAllMocks();
});

const envOf = (world: AskWorld) => {
  const view = audienceView(world.ctx, "agents");
  return { db: world.ctx.db, paths: world.ctx.paths, settings: world.ctx.settings(), hidden: view.hidden };
};
type Mode = "direct" | "reason_first";
const check = (
  content: unknown,
  opts: {
    mode?: Mode;
    within?: ((row: { root: string; rel: string }) => boolean) | null;
    world?: AskWorld;
  } = {},
) =>
  checkAskAnswer(
    Buffer.isBuffer(content)
      ? content
      : Buffer.from(typeof content === "string" ? content : JSON.stringify(content)),
    {
      ...envOf(opts.world ?? w),
      within: opts.within ?? null,
      mode: opts.mode ?? "direct",
    },
  );
const accepted = (verdict: ReturnType<typeof check>) => {
  expect(verdict.ok, verdict.ok ? "" : verdict.reason).toBe(true);
  return verdict.ok ? verdict.answer : (null as never);
};
const refused = (verdict: ReturnType<typeof check>) => {
  expect(verdict.ok).toBe(false);
  return verdict.ok ? "" : verdict.reason;
};
const fileId = (file: string, world: AskWorld = w) =>
  (world.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(file) as { id: number }).id;
const one = (file = notes.onboarding, section = "Decisão"): Json => ({
  v: 1,
  paragraphs: [paragraph(file, section)],
});
const cite = (file: string, section: string) => ({ path: file, section });

describe("C10 the natureza of a citation comes from the index", () => {
  it("C10 a note of plano, hipotese and opiniao gets the key; fato, relato and none get none; an answer saying fato for the plano note still reads plano", async () => {
    const own = await askWorld(`mordomo-perguntar-layer-c10-${++seq}-`);
    try {
      const made: Record<string, string> = {};
      for (const natureza of ["plano", "hipotese", "opiniao", "fato", "relato", "nenhuma"]) {
        made[natureza] = own.note(
          path.join(own.memory, "notes", `${natureza}.md`),
          natureza === "nenhuma" ? {} : { natureza },
          "# Nota\n\n## Seção\n\nTexto.\n",
        );
      }
      await own.index();
      for (const natureza of ["plano", "hipotese", "opiniao"]) {
        const answer = accepted(check(one(made[natureza], "Seção"), { world: own }));
        expect(answer.paragraphs[0]!.citations[0], natureza).toEqual({
          path: made[natureza],
          section: "Seção",
          name: `${natureza}.md`,
          fileId: fileId(made[natureza]!, own),
          natureza,
        });
      }
      for (const natureza of ["fato", "relato", "nenhuma"]) {
        const answer = accepted(check(one(made[natureza], "Seção"), { world: own }));
        expect("natureza" in answer.paragraphs[0]!.citations[0]!, natureza).toBe(false);
      }
      const lying = {
        v: 1,
        paragraphs: [
          { text: "Um plano.", citations: [{ path: made.plano, section: "Seção", natureza: "fato" }] },
        ],
      };
      expect(accepted(check(lying, { world: own })).paragraphs[0]!.citations[0]!.natureza).toBe("plano");
    } finally {
      await own.close();
    }
  });
});

describe("C11 the answer's schema, one row at a time", () => {
  const sized = (n: number) => {
    const text = JSON.stringify(one());
    return Buffer.from(text + " ".repeat(n - Buffer.byteLength(text)));
  };
  const paragraphs = (n: number) => ({
    v: 1,
    paragraphs: Array.from({ length: n }, (_, i) =>
      paragraph(notes.onboarding, "Decisão", `Parágrafo ${i + 1}.`),
    ),
  });
  const withText = (n: number) => ({
    v: 1,
    paragraphs: [paragraph(notes.onboarding, "Decisão", "x".repeat(n))],
  });
  const withCitations = (n: number) => ({
    v: 1,
    paragraphs: [
      { text: "Texto.", citations: Array.from({ length: n }, () => cite(notes.onboarding, "Decisão")) },
    ],
  });

  it("C11 65 536 bytes accepted and 65 537 refused for the size", () => {
    expect(sized(65_536).length).toBe(65_536);
    accepted(check(sized(65_536)));
    expect(refused(check(sized(65_537)))).toBe("A resposta passa de 65536 bytes.");
  });
  it("C11 not JSON refused", () => {
    expect(refused(check("{ isto não é json"))).toBe("A resposta não é JSON.");
  });
  it("C11 v: 2 refused naming v", () => {
    expect(refused(check({ ...one(), v: 2 }))).toContain("v: v must be 1");
  });
  it("C11 0 paragraphs refused", () => {
    expect(refused(check({ v: 1, paragraphs: [] }))).toContain("paragraphs: 1 to 8 paragraphs");
  });
  it("C11 9 paragraphs refused and 8 accepted, in the file's order", () => {
    expect(refused(check(paragraphs(9)))).toContain("paragraphs: 1 to 8 paragraphs");
    expect(accepted(check(paragraphs(8))).paragraphs.map((p) => p.text)).toEqual(
      Array.from({ length: 8 }, (_, i) => `Parágrafo ${i + 1}.`),
    );
  });
  it("C11 a paragraph of 1 201 characters refused and 1 200 accepted", () => {
    expect(refused(check(withText(1201)))).toContain(
      "paragraphs.0.text: a paragraph's text has at most 1200 characters",
    );
    expect(accepted(check(withText(1200))).paragraphs[0]!.text).toHaveLength(1200);
  });
  it("C11 a paragraph with 0 citations refused", () => {
    expect(refused(check(withCitations(0)))).toContain(
      "paragraphs.0.citations: a paragraph cites 1 to 6 sections",
    );
  });
  it("C11 7 citations refused and 6 accepted", () => {
    expect(refused(check(withCitations(7)))).toContain(
      "paragraphs.0.citations: a paragraph cites 1 to 6 sections",
    );
    expect(accepted(check(withCitations(6))).paragraphs[0]!.citations).toHaveLength(6);
  });
  it("C11 a citation with no section refused", () => {
    const answer = { v: 1, paragraphs: [{ text: "Texto.", citations: [{ path: notes.onboarding }] }] };
    expect(refused(check(answer))).toContain(
      "paragraphs.0.citations.0.section: citation.section is required",
    );
  });
  it("C11 an unknown top-level key is accepted and dropped; the paragraphs come in the file's order", () => {
    const answer = accepted(
      check({
        v: 1,
        extra: "ignorado",
        paragraphs: [
          paragraph(notes.plano, "Próximos passos", "B."),
          paragraph(notes.onboarding, "Decisão", "A."),
        ],
      }),
    );
    expect(Object.keys(answer)).toEqual(["paragraphs"]);
    expect(answer.paragraphs.map((p) => p.text)).toEqual(["B.", "A."]);
  });
});

describe("C12 a cited path the index does not have", () => {
  it("C12 refused with A citação do parágrafo <n> nomeia <path>, que o índice não tem.", () => {
    const ghost = path.join(w.memory, "notes", "inventada.md");
    const answer = {
      v: 1,
      paragraphs: [paragraph(notes.onboarding, "Decisão"), paragraph(ghost, "Decisão")],
    };
    expect(refused(check(answer))).toBe(`A citação do parágrafo 2 nomeia ${ghost}, que o índice não tem.`);
    // a relative spelling of a real row is no row of the index either
    expect(refused(check(one("notes/onboarding.md")))).toBe(
      "A citação do parágrafo 1 nomeia notes/onboarding.md, que o índice não tem.",
    );
  });
});

describe("C13 a cited section must be a heading of the file by splitSections", () => {
  it("C13 § Decisões refused naming the file and the section; § Decisão accepted; the nested ### Prazo accepted by its own text", () => {
    expect(refused(check(one(notes.onboarding, "Decisões")))).toBe(
      `A citação do parágrafo 1 nomeia a seção "Decisões" de ${notes.onboarding}, que o arquivo não tem.`,
    );
    accepted(check(one(notes.onboarding, "Decisão")));
    accepted(check(one(notes.onboarding, "Prazo")));
    expect(refused(check(one(notes.onboarding, "Decisão > Prazo")))).toContain('"Decisão > Prazo"');
  });
  it("C13 a file with no heading accepts only the name splitSections gives its preamble", async () => {
    const own = await askWorld(`mordomo-perguntar-layer-c13-${++seq}-`);
    try {
      const flat = own.note(path.join(own.memory, "notes", "solta.md"), {}, "Só um parágrafo, sem título.\n");
      await own.index();
      // splitSections names the preamble of a Markdown file "(top)", the label the recall's sections carry
      accepted(check(one(flat, "(top)"), { world: own }));
      expect(refused(check(one(flat, "solta"), { world: own }))).toContain('"solta"');
      expect(refused(check(one(flat, "Decisão"), { world: own }))).toContain('"Decisão"');
    } finally {
      await own.close();
    }
  });
});

describe("C15 the policy and the folders at their own layer", () => {
  it("C15 a row storedRowFilter refuses is refused; a row in a folder at agents hide is refused; at agents read it is accepted", async () => {
    const own = await askWorld(`mordomo-perguntar-layer-c15-${++seq}-`);
    try {
      const excluded = own.note(path.join(own.memory, "notes", "fora", "a.md"), {}, "# A\n\n## S\n\nx\n");
      const hidden = own.note(path.join(own.memory, "notes", "privado", "b.md"), {}, "# B\n\n## S\n\nx\n");
      const readOnly = own.note(path.join(own.memory, "notes", "leitura", "c.md"), {}, "# C\n\n## S\n\nx\n");
      await own.index();
      accepted(check(one(excluded, "S"), { world: own }));
      accepted(check(one(hidden, "S"), { world: own }));
      own.update((s) => {
        s.excludes = [...s.excludes, "fora"];
        s.folderAccess = [
          { path: path.dirname(hidden), agents: "hide", devices: "write" },
          { path: path.dirname(readOnly), agents: "read", devices: "write" },
        ];
      });
      expect(refused(check(one(excluded, "S"), { world: own }))).toBe(
        `A citação do parágrafo 1 nomeia ${excluded}, que a política de hoje exclui.`,
      );
      expect(refused(check(one(hidden, "S"), { world: own }))).toBe(
        `A citação do parágrafo 1 nomeia ${hidden}, que está numa pasta escondida dos agentes.`,
      );
      accepted(check(one(readOnly, "S"), { world: own }));
    } finally {
      await own.close();
    }
  });
});

describe("C26 the scope's resolution at its own layer", () => {
  it("C26 one asserted case per kind: all, context, folder and notes", async () => {
    const own = await askWorld(`mordomo-perguntar-layer-c26-${++seq}-`);
    try {
      const env = envOf(own);
      const all = resolveAskScope(env, { kind: "all" });
      expect([all.input, all.within, all.contextId]).toEqual(["all", null, undefined]);

      const project = path.join(own.home, "projetos", "cliente-x");
      const inside = own.put(path.join(project, "a.md"), "# A\n\n## S\n\nx\n");
      const twin = own.put(path.join(own.home, "projetos", "cliente-x-old", "b.md"), "# B\n\n## S\n\nx\n");
      own.update((s) => {
        s.indexedFolders = [{ path: path.join(own.home, "projetos"), area: null, enabled: true }];
      });
      own.context("cliente-x", "Cliente X", [project]);
      const context = resolveAskScope(envOf(own), { kind: "context", id: "cliente-x" });
      expect([context.input, context.contextId]).toEqual(["context:cliente-x", "cliente-x"]);
      const root = path.join(own.home, "projetos");
      const rowOf = (file: string) => ({ root, rel: path.relative(root, file) });
      expect([context.within!(rowOf(inside)), context.within!(rowOf(twin))]).toEqual([true, false]);

      const folder = path.join(own.memory, "notes", "projetos");
      fs.mkdirSync(folder, { recursive: true });
      const viaLink = path.join(os.tmpdir(), `mordomo-perguntar-link-${process.pid}-${++seq}`);
      fs.symlinkSync(folder, viaLink);
      try {
        const byFolder = resolveAskScope(env, { kind: "folder", path: viaLink });
        expect(byFolder.input).toBe(`folder:${fs.realpathSync(folder)}`);
        expect(byFolder.scope).toEqual({ kind: "folder", path: fs.realpathSync(folder) });
        const mem = { root: own.memory, rel: "" };
        expect(byFolder.within!({ ...mem, rel: "notes/projetos/a.md" })).toBe(true);
        expect(byFolder.within!({ ...mem, rel: "notes/projetos-antigo/x.md" })).toBe(false);
      } finally {
        fs.rmSync(viaLink, { force: true });
      }

      const a = own.note(path.join(own.memory, "notes", "a.md"), {}, "# A\n");
      const b = own.note(path.join(own.memory, "notes", "b.md"), {}, "# B\n");
      const c = own.note(path.join(own.memory, "notes", "c.md"), {}, "# C\n");
      await own.index();
      const byNotes = resolveAskScope(envOf(own), { kind: "notes", paths: [a, b] });
      expect(byNotes.input).toBe(`notes:${a};${b}`);
      const memRow = (file: string) => ({ root: own.memory, rel: path.relative(own.memory, file) });
      expect([byNotes.within!(memRow(a)), byNotes.within!(memRow(b)), byNotes.within!(memRow(c))]).toEqual([
        true,
        true,
        false,
      ]);
    } finally {
      await own.close();
    }
  });
  it("C26 one asserted case per refusal: an unknown context, a folder outside, relative or hidden, a note unknown, excluded or hidden", async () => {
    const own = await askWorld(`mordomo-perguntar-layer-c26r-${++seq}-`);
    try {
      const refusal = (scope: Parameters<typeof resolveAskScope>[1]) => {
        try {
          resolveAskScope(envOf(own), scope);
        } catch (err) {
          const e = err as { statusCode: number; code: string; message: string };
          return [e.statusCode, e.code, e.message];
        }
        return null;
      };
      expect(refusal({ kind: "context", id: "nope" })).toEqual([
        404,
        "context_not_found",
        "No work context is called nope.",
      ]);
      const outside = (p: string) => [
        400,
        "folder_outside_index",
        `The folder ${p} is not inside memory/ or an indexed folder that agents may read.`,
      ];
      expect(refusal({ kind: "folder", path: "/tmp/x" })).toEqual(outside("/tmp/x"));
      expect(refusal({ kind: "folder", path: "notes/projetos" })).toEqual(outside("notes/projetos"));
      const privado = path.join(own.memory, "notes", "privado");
      fs.mkdirSync(path.join(privado, "sub"), { recursive: true });
      expect(refusal({ kind: "folder", path: path.join(privado, "sub") })).toBeNull();
      const hiddenNote = own.note(path.join(privado, "h.md"), {}, "# H\n");
      const excludedNote = own.note(path.join(own.memory, "notes", "fora", "e.md"), {}, "# E\n");
      const kept = own.note(path.join(own.memory, "notes", "k.md"), {}, "# K\n");
      await own.index();
      expect(refusal({ kind: "notes", paths: [kept, hiddenNote, excludedNote] })).toBeNull();
      own.update((s) => {
        s.excludes = [...s.excludes, "fora"];
        s.folderAccess = [{ path: privado, agents: "hide", devices: "write" }];
      });
      expect(refusal({ kind: "folder", path: path.join(privado, "sub") })).toEqual(
        outside(path.join(privado, "sub")),
      );
      const unknown = (p: string) => [
        400,
        "unknown_note",
        `The note ${p} is no file of the index that agents may read.`,
      ];
      const ghost = path.join(own.memory, "notes", "nada.md");
      expect(refusal({ kind: "notes", paths: [kept, ghost] })).toEqual(unknown(ghost));
      expect(refusal({ kind: "notes", paths: [kept, excludedNote] })).toEqual(unknown(excludedNote));
      expect(refusal({ kind: "notes", paths: [kept, hiddenNote] })).toEqual(unknown(hiddenNote));
      expect(refusal({ kind: "notes", paths: [kept] })).toBeNull();
    } finally {
      await own.close();
    }
  });
});

describe("C30 takeFeedback by mode", () => {
  const item = (text = "Falta o prazo.") => ({ text, citations: [cite(notes.onboarding, "Prazo")] });
  it("C30 reason_first with no takeFeedback refused", () => {
    expect(refused(check(one(), { mode: "reason_first" }))).toBe(
      'Uma resposta de "raciocine primeiro" precisa de takeFeedback.',
    );
  });
  it("C30 reason_first with three empty lists refused", () => {
    expect(
      refused(
        check(
          { ...one(), takeFeedback: { agrees: [], disagrees: [], missing: [] } },
          { mode: "reason_first" },
        ),
      ),
    ).toBe("O takeFeedback não tem nenhum item em agrees, disagrees ou missing.");
  });
  it("C30 direct with a takeFeedback refused", () => {
    expect(refused(check({ ...one(), takeFeedback: { missing: [item()] } }, { mode: "direct" }))).toBe(
      "Uma resposta direta não traz takeFeedback.",
    );
  });
  it("C30 reason_first with one item only in missing answered, agrees and disagrees []", () => {
    const answer = accepted(
      check({ ...one(), takeFeedback: { missing: [item()] } }, { mode: "reason_first" }),
    );
    expect(answer.takeFeedback!.agrees).toEqual([]);
    expect(answer.takeFeedback!.disagrees).toEqual([]);
    expect(answer.takeFeedback!.missing.map((i) => i.text)).toEqual(["Falta o prazo."]);
  });
});

describe("C31 each takeFeedback item is checked as a paragraph is", () => {
  const withItem = (it: Json, list = "disagrees") => ({ ...one(), takeFeedback: { [list]: [it] } });
  const reason = (
    content: unknown,
    within: ((row: { root: string; rel: string }) => boolean) | null = null,
  ) => check(content, { mode: "reason_first", within });
  const citing = (n: number) => ({
    text: "Item.",
    citations: Array.from({ length: n }, () => cite(notes.onboarding, "Decisão")),
  });
  it("C31 1 and 3 citations accepted, 0 and 4 refused", () => {
    expect(accepted(reason(withItem(citing(1)))).takeFeedback!.disagrees[0]!.citations).toHaveLength(1);
    expect(accepted(reason(withItem(citing(3)))).takeFeedback!.disagrees[0]!.citations).toHaveLength(3);
    expect(refused(reason(withItem(citing(0))))).toContain(
      "takeFeedback.disagrees.0.citations: an item cites 1 to 3 sections",
    );
    expect(refused(reason(withItem(citing(4))))).toContain(
      "takeFeedback.disagrees.0.citations: an item cites 1 to 3 sections",
    );
  });
  it("C31 a 400-character text accepted, 401 refused", () => {
    const text = (n: number) => ({ text: "x".repeat(n), citations: [cite(notes.onboarding, "Decisão")] });
    expect(accepted(reason(withItem(text(400), "agrees"))).takeFeedback!.agrees[0]!.text).toHaveLength(400);
    expect(refused(reason(withItem(text(401), "agrees")))).toContain(
      "takeFeedback.agrees.0.text: an item's text has at most 400 characters",
    );
  });
  it("C31 a citation outside the scope, one the index does not have and one whose section the file lacks each refused", () => {
    const onlyOnboarding = resolveAskScope(envOf(w), { kind: "notes", paths: [notes.onboarding] }).within;
    const of = (file: string, section: string) => ({ text: "Item.", citations: [cite(file, section)] });
    expect(refused(reason(withItem(of(notes.clientes, "Lista"), "missing"), onlyOnboarding))).toBe(
      `A citação do item 1 de missing nomeia ${notes.clientes}, que está fora do escopo da pergunta.`,
    );
    const ghost = path.join(w.memory, "notes", "nada.md");
    expect(refused(reason(withItem(of(ghost, "Lista"), "missing")))).toBe(
      `A citação do item 1 de missing nomeia ${ghost}, que o índice não tem.`,
    );
    expect(refused(reason(withItem(of(notes.clientes, "Listas"), "missing")))).toBe(
      `A citação do item 1 de missing nomeia a seção "Listas" de ${notes.clientes}, que o arquivo não tem.`,
    );
  });
  it("C31 every accepted citation carries fileId and, for a plano note, natureza", () => {
    const answer = accepted(
      reason(
        withItem({
          text: "Item.",
          citations: [cite(notes.onboarding, "Decisão"), cite(notes.plano, "Próximos passos")],
        }),
      ),
    );
    expect(answer.takeFeedback!.disagrees[0]!.citations).toEqual([
      { path: notes.onboarding, section: "Decisão", name: "onboarding.md", fileId: fileId(notes.onboarding) },
      {
        path: notes.plano,
        section: "Próximos passos",
        name: "plano.md",
        fileId: fileId(notes.plano),
        natureza: "plano",
      },
    ]);
  });
});

describe("C32 the provocation's shape", () => {
  const provoking = (provocation: Json) => ({ ...one(), provocation });
  const valid = (extra: Json = {}) => ({
    kind: "contradiz",
    text: "O plano diz abril.",
    citation: cite(notes.plano, "Próximos passos"),
    ...extra,
  });
  it("C32 kind contradiz, complica and falta each accepted, outro refused", () => {
    for (const kind of ["contradiz", "complica", "falta"]) {
      expect(accepted(check(provoking(valid({ kind })))).provocation!.kind).toBe(kind);
    }
    expect(refused(check(provoking(valid({ kind: "outro" }))))).toContain(
      "provocation.kind: provocation.kind is contradiz, complica or falta",
    );
  });
  it("C32 300 characters accepted, 301 refused", () => {
    expect(accepted(check(provoking(valid({ text: "x".repeat(300) })))).provocation!.text).toHaveLength(300);
    expect(refused(check(provoking(valid({ text: "x".repeat(301) }))))).toContain(
      "provocation.text: provocation.text has at most 300 characters",
    );
  });
  it("C32 a provocations list is dropped as an unknown key and never shown", () => {
    const answer = accepted(check({ ...one(), provocations: [valid(), valid({ kind: "falta" })] }));
    expect(Object.keys(answer)).toEqual(["paragraphs"]);
  });
  it("C32 a provocation with no citation refused, and with a citations list instead refused", () => {
    const { citation: _c, ...bare } = valid();
    expect(refused(check(provoking(bare)))).toContain("provocation.citation: Required");
    expect(
      refused(check(provoking({ ...bare, citations: [cite(notes.plano, "Próximos passos")] }))),
    ).toContain("provocation.citation: Required");
  });
});

describe("C33 the provocation's citation goes through the same rules", () => {
  it("C33 outside the scope, not in the index, excluded, hidden from agents and with a section the file lacks each refused; accepted it carries fileId and natureza", async () => {
    const own = await askWorld(`mordomo-perguntar-layer-c33-${++seq}-`);
    try {
      const mine = await threeNotes(own);
      const excluded = own.note(path.join(own.memory, "notes", "fora", "e.md"), {}, "# E\n\n## S\n\nx\n");
      const hidden = own.note(path.join(own.memory, "notes", "privado", "h.md"), {}, "# H\n\n## S\n\nx\n");
      await own.index();
      own.update((s) => {
        s.excludes = [...s.excludes, "fora"];
        s.folderAccess = [{ path: path.dirname(hidden), agents: "hide", devices: "write" }];
      });
      const provoking = (file: string, section: string) => ({
        ...one(mine.onboarding),
        provocation: { kind: "complica", text: "Uma nota complica.", citation: cite(file, section) },
      });
      const run = (
        content: unknown,
        within: ((row: { root: string; rel: string }) => boolean) | null = null,
      ) => check(content, { world: own, within });
      const noPlano = resolveAskScope(envOf(own), {
        kind: "notes",
        paths: [mine.onboarding, mine.clientes],
      }).within;
      expect(refused(run(provoking(mine.plano, "Próximos passos"), noPlano))).toBe(
        `A citação da provocação nomeia ${mine.plano}, que está fora do escopo da pergunta.`,
      );
      const ghost = path.join(own.memory, "notes", "nada.md");
      expect(refused(run(provoking(ghost, "S")))).toBe(
        `A citação da provocação nomeia ${ghost}, que o índice não tem.`,
      );
      expect(refused(run(provoking(excluded, "S")))).toBe(
        `A citação da provocação nomeia ${excluded}, que a política de hoje exclui.`,
      );
      expect(refused(run(provoking(hidden, "S")))).toBe(
        `A citação da provocação nomeia ${hidden}, que está numa pasta escondida dos agentes.`,
      );
      expect(refused(run(provoking(mine.plano, "Passos")))).toBe(
        `A citação da provocação nomeia a seção "Passos" de ${mine.plano}, que o arquivo não tem.`,
      );
      expect(accepted(run(provoking(mine.plano, "Próximos passos"))).provocation).toEqual({
        kind: "complica",
        text: "Uma nota complica.",
        citation: {
          path: mine.plano,
          section: "Próximos passos",
          name: "plano.md",
          fileId: fileId(mine.plano, own),
          natureza: "plano",
        },
      });
    } finally {
      await own.close();
    }
  });
});

describe("C34 sentences counted by . ! or ? followed by a space or the end", () => {
  it("C34 one case per row of countSentences", () => {
    expect(countSentences("A nota diz o contrário.")).toBe(1);
    expect(countSentences("Uma. Duas.")).toBe(2);
    expect(countSentences("Uma. Duas! Três?")).toBe(3);
    expect(countSentences("A versão 2.5 mudou.")).toBe(1);
    expect(countSentences("Ex.:o prazo.")).toBe(1);
    expect(countSentences("Por quê?Não.")).toBe(1);
    expect(countSentences("")).toBe(0);
  });
  it("C34 3 sentences refused and 2 accepted by the check; an empty text refused by the schema", () => {
    const provoking = (text: string) => ({
      ...one(),
      provocation: { kind: "falta", text, citation: cite(notes.plano, "Próximos passos") },
    });
    expect(refused(check(provoking("Uma. Duas! Três?")))).toBe("A provocação tem 3 frases; no máximo 2.");
    expect(accepted(check(provoking("Uma. Duas!"))).provocation!.text).toBe("Uma. Duas!");
    expect(accepted(check(provoking("A versão 2.5 mudou. Ex.:o prazo."))).provocation!.text).toBe(
      "A versão 2.5 mudou. Ex.:o prazo.",
    );
    expect(refused(check(provoking("")))).toContain("provocation.text: provocation.text is required");
  });
});

describe("C37 the client's name at its own layer (mcpClientName, batch B)", () => {
  it("C37 claude-code kept, Cursor lower-cased, codex_cli.v2 kept, 40 kept and 41 desconhecido, a space, empty, missing and a non-string desconhecido", () => {
    expect(mcpClientName({ name: "claude-code" })).toBe("claude-code");
    expect(mcpClientName({ name: "Cursor" })).toBe("cursor");
    expect(mcpClientName({ name: "codex_cli.v2" })).toBe("codex_cli.v2");
    expect(mcpClientName({ name: "a".repeat(40) })).toBe("a".repeat(40));
    expect(mcpClientName({ name: "a".repeat(41) })).toBe("desconhecido");
    expect(mcpClientName({ name: "a b" })).toBe("desconhecido");
    expect(mcpClientName({ name: "" })).toBe("desconhecido");
    expect(mcpClientName(undefined)).toBe("desconhecido");
    expect(mcpClientName({ name: 42 })).toBe("desconhecido");
  });
});

describe("C39 the principal at its own layer (principalFromHeaders, batch B)", () => {
  it("C39 one case per row: owner+mcp, owner, owner+owner, owner+MCP, device+mcp, run+mcp, broker+mcp", () => {
    const token = w.ctx.token();
    const from = (headers: Record<string, string>) => principalFromHeaders(w.ctx, headers);
    const owned = from({
      "x-mordomo-token": token,
      "x-mordomo-as": "mcp",
      "x-mordomo-client": "claude-code",
    });
    expect(owned).toEqual({ principal: { kind: "mcp", client: "claude-code" } });
    expect(audienceOf(owned && "principal" in owned ? owned.principal : null)).toBe("agents");
    const owner = from({ "x-mordomo-token": token });
    expect(owner).toEqual({ principal: { kind: "owner" } });
    expect(audienceOf(owner && "principal" in owner ? owner.principal : null)).toBeNull();
    for (const value of ["owner", "MCP"]) {
      const refused = from({ "x-mordomo-token": token, "x-mordomo-as": value });
      expect(
        refused && "refused" in refused ? [refused.refused.status, refused.refused.code] : null,
        value,
      ).toEqual([400, "validation"]);
    }
    const device = w.device(["content"])["x-mordomo-token"]!;
    const asDevice = from({ "x-mordomo-token": device, "x-mordomo-as": "mcp" });
    expect(asDevice && "principal" in asDevice ? asDevice.principal.kind : null).toBe("device");
    const held = w.ctx.runs.create({
      origin: "skill",
      provider: "claude",
      prompt: "held open",
      cwd: w.home,
      model: null,
      effort: "default",
      mode: "write",
      timeoutMs: 60_000,
      profile: "review_before_write",
      skillSlug: "organize-brain",
      startedBy: null,
    } as never);
    const rc = w.ctx.runApiAccessFor(held, "write")!.token;
    expect(rc).toMatch(/^rc_/);
    expect(from({ "x-mordomo-token": rc, "x-mordomo-as": "mcp" })).toEqual({
      principal: { kind: "run", runId: held.id },
      writable: true,
    });
    const brk = w.ctx.permissionBrokerFor({ id: held.id, permissionProfile: "review_before_write" } as never)!
      .env.MORDOMO_TOKEN!;
    expect(brk).toMatch(/^brk_/);
    expect(from({ "x-mordomo-token": brk, "x-mordomo-as": "mcp" })).toEqual({
      principal: { kind: "broker", runId: held.id },
    });
    // a client name the rule refuses reads desconhecido, and none at all too
    expect(from({ "x-mordomo-token": token, "x-mordomo-as": "mcp", "x-mordomo-client": "a b" })).toEqual({
      principal: { kind: "mcp", client: "desconhecido" },
    });
    expect(from({ "x-mordomo-token": token, "x-mordomo-as": "mcp" })).toEqual({
      principal: { kind: "mcp", client: "desconhecido" },
    });
  });
});
