import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { recordSuggestionBatch, batchOutcome } from "@mordomo/core/internal";
import type { RunStatus } from "@mordomo/contracts";
import { autoSuggestionBatch } from "../apps/api/src/routes/suggestions.js";
import { extractMentions } from "../core/src/memory/entityMentions.js";
import {
  checkSuggestions,
  suggestionBatchFiles,
  type SuggestionBatch,
  type SuggestionCheckEnv,
} from "../core/src/memory/suggestions.js";
import {
  HOUR,
  MINUTE,
  NOW,
  suggestion,
  sugestoesWorld,
  type Json,
  type SugestoesWorld,
} from "./helpers/sugestoesWorld.js";

/**
 * .specs/features/cerebro-entidades-resumos, batch D, S8 at its own layer (doors 9 and 10): the files of a batch
 * (`suggestionBatchFiles`), the check of `entities.json` suggestion by suggestion and whole (`checkSuggestions`), and the
 * `nome` rule of the extraction (`extractMentions` with the accepted names), each called with no HTTP; the whole-batch
 * refusals also as `GET /api/memory/entities/suggestions` reads them.
 */

let seq = 0;
afterAll(() => {
  vi.restoreAllMocks();
});

async function fresh<T>(fn: (w: SugestoesWorld) => Promise<T>): Promise<T> {
  const w = await sugestoesWorld(`mordomo-sugestoes-layer-${++seq}-`);
  try {
    return await fn(w);
  } finally {
    await w.close();
  }
}

// ---- C75: the files of a batch ---------------------------------------------------------------------------------------

describe("C75 the files of a batch", () => {
  it("C75 25 changed notes give the 20 newest by mtime; a note the policy excludes, one hidden from agents and a non-Markdown file are never in it; only files with mtime after the last batch's start", async () => {
    await fresh(async (w) => {
      const since = NOW - 24 * HOUR;
      const changed: string[] = [];
      for (let i = 0; i < 25; i++) {
        changed.push(
          w.note(
            path.join(w.notas, `n${String(i).padStart(2, "0")}.md`),
            `# N${i}\n`,
            NOW - (i + 10) * MINUTE,
          ),
        );
      }
      // newer than every changed note, each left out for its own reason
      const excluded = w.note(path.join(w.notas, "privado", "segredo.md"), "# Segredo\n", NOW - 1 * MINUTE);
      const hidden = w.note(path.join(w.notas, "escondida", "oculta.md"), "# Oculta\n", NOW - 2 * MINUTE);
      const text = w.note(path.join(w.notas, "lista.txt"), "Ana e Bruno\n", NOW - 3 * MINUTE);
      // before the last batch's start
      const before = w.note(path.join(w.notas, "antiga.md"), "# Antiga\n", since - MINUTE);
      const atStart = w.note(path.join(w.notas, "no-inicio.md"), "# No início\n", since);
      await w.index();
      const indexed = (w.ctx.db.prepare("SELECT path FROM files").all() as Json[]).map((r) => r.path);
      expect(indexed).toEqual(expect.arrayContaining([excluded, hidden, text, before, atStart, ...changed]));

      const settings = w.ctx.settings();
      const env = {
        db: w.ctx.db,
        paths: w.ctx.paths,
        settings: { ...settings, excludes: [...settings.excludes, "privado"] },
        hidden: (p: string) => p === hidden,
      };
      const files = suggestionBatchFiles(env, since).map((f) => f.path);
      expect(files).toEqual(changed.slice(0, 20));

      // each exclusion alone: without it, its file is the first of the batch
      expect(suggestionBatchFiles({ ...env, settings }, since)[0]!.path).toBe(excluded);
      expect(suggestionBatchFiles({ ...env, hidden: () => false }, since)[0]!.path).toBe(hidden);
      // the text file is never in it, even when the notes are few
      expect(
        suggestionBatchFiles({ ...env, settings, hidden: () => false }, NOW - 5 * MINUTE).map((f) => f.path),
      ).toEqual([excluded, hidden]);
      // only files with mtime after the last batch's start: one at it is not, one a millisecond after is
      expect(suggestionBatchFiles(env, NOW - 11 * MINUTE).map((f) => f.path)).toEqual([changed[0]]);
      expect(suggestionBatchFiles(env, NOW - 11 * MINUTE - 1).map((f) => f.path)).toEqual(
        changed.slice(0, 2),
      );
      // a note of before the last batch's start, and one at it, are not in it
      expect(suggestionBatchFiles(env, since).map((f) => f.path)).not.toContain(atStart);
      expect(suggestionBatchFiles(env, since).map((f) => f.path)).not.toContain(before);
    });
  });
});

// ---- C140: the batch conditions and the batch's files at their own layer ---------------------------------------------------

describe("C140 the automatic batch decision over a fixed clock", () => {
  /** Three notes changed in the last hours and one before every batch; the index is current. */
  async function notes(w: SugestoesWorld) {
    w.llm(true);
    w.note(path.join(w.notas, "a.md"), "# A\n\nReunião com Ana.\n", NOW - 3 * HOUR);
    w.note(path.join(w.notas, "c.md"), "# C\n\nVisita ao Banco Central.\n", NOW - 1 * HOUR);
    w.note(path.join(w.notas, "old.md"), "# Velha\n\nAntiga.\n", NOW - 30 * HOUR);
    await w.index();
  }
  const decide = async (w: SugestoesWorld): Promise<boolean> => {
    const id = autoSuggestionBatch(w.ctx, NOW);
    if (id !== null) await w.settle(id);
    return id !== null;
  };

  it("C140 the last batch started 24 h 1 min before now: a batch starts", async () => {
    await fresh(async (w) => {
      await notes(w);
      recordSuggestionBatch(w.ctx.db, { runId: "anterior", startedAt: NOW - 24 * HOUR - MINUTE, files: [] });
      expect(await decide(w)).toBe(true);
    });
  });

  it("C140 the last batch started 23 h 59 min before now: none starts", async () => {
    await fresh(async (w) => {
      await notes(w);
      recordSuggestionBatch(w.ctx.db, {
        runId: "anterior",
        startedAt: NOW - 23 * HOUR - 59 * MINUTE,
        files: [],
      });
      expect(await decide(w)).toBe(false);
    });
  });

  it("C140 a run is open (queued): none starts", async () => {
    await fresh(async (w) => {
      await notes(w);
      recordSuggestionBatch(w.ctx.db, { runId: "anterior", startedAt: NOW - 25 * HOUR, files: [] });
      expect(w.ctx.runs.get(w.run("read_only").runId)?.status).toBe("queued");
      expect(await decide(w)).toBe(false);
    });
  });

  it("C140 nothing changed since the last batch: none starts", async () => {
    await fresh(async (w) => {
      w.llm(true);
      w.note(path.join(w.notas, "old.md"), "# Velha\n\nAntiga.\n", NOW - 26 * HOUR);
      await w.index();
      recordSuggestionBatch(w.ctx.db, { runId: "anterior", startedAt: NOW - 25 * HOUR, files: [] });
      expect(await decide(w)).toBe(false);
    });
  });

  it("C140 no batch ever: a batch starts; with the extraction off none ever does", async () => {
    await fresh(async (w) => {
      await notes(w);
      w.llm(false);
      expect(await decide(w)).toBe(false);
      w.llm(true);
      expect(await decide(w)).toBe(true);
    });
  });
});

describe("C140 the files of a batch at their own layer", () => {
  it("C140 a note the policy excludes, one hidden from agents and a non-Markdown file are never in the files, each alone", async () => {
    await fresh(async (w) => {
      const open = w.note(path.join(w.notas, "aberta.md"), "# Aberta\n", NOW - 10 * MINUTE);
      const excluded = w.note(path.join(w.notas, "privado", "segredo.md"), "# S\n", NOW - 1 * MINUTE);
      const hidden = w.note(path.join(w.notas, "escondida", "oculta.md"), "# O\n", NOW - 2 * MINUTE);
      const text = w.note(path.join(w.notas, "lista.txt"), "Ana e Bruno\n", NOW - 3 * MINUTE);
      await w.index();
      const settings = w.ctx.settings();
      const withPolicy = { ...settings, excludes: [...settings.excludes, "privado"] };
      const files = (excludes: boolean, hide: boolean) =>
        suggestionBatchFiles(
          {
            db: w.ctx.db,
            paths: w.ctx.paths,
            settings: excludes ? withPolicy : settings,
            hidden: (p: string) => hide && p === hidden,
          },
          0,
        ).map((f) => f.path);
      // each exclusion alone: the files are the markdown ones, newest first, minus what that rule takes out
      expect(files(false, false)).toEqual([excluded, hidden, open]);
      expect(files(true, false)).toEqual([hidden, open]);
      expect(files(false, true)).toEqual([excluded, open]);
      expect(files(true, true)).toEqual([open]);
      expect(files(false, false)).not.toContain(text);
    });
  });
});

// ---- C141: what each status of a batch's run means ---------------------------------------------------------------------------

describe("C141 a batch's run status, one case per member of RunStatus", () => {
  it("C141 queued, running and waiting_approval are still reading; done with a valid file is accepted; done with no file, and each other end, are refused with their reason", async () => {
    await fresh(async (w) => {
      const a = w.note(path.join(w.notas, "a.md"), "# A\n\nFalei com Ana Clara ontem.\n", Date.now() - HOUR);
      await w.index();
      const env = (runId: string): SuggestionCheckEnv => ({
        db: w.ctx.db,
        paths: w.ctx.paths,
        settings: w.ctx.settings(),
        hidden: () => false,
        batch: { runId, startedAt: NOW - 2 * HOUR, files: [a] },
        keyExists: () => false,
      });
      // every member of the type is a case below: a new status fails to compile here
      const cases: Record<RunStatus, unknown> = {
        queued: { kind: "running" },
        running: { kind: "running" },
        waiting_approval: { kind: "running" },
        done: "accepted",
        failed: { kind: "refused", reason: "A execução terminou em failed." },
        cancelled: { kind: "refused", reason: "A execução terminou em cancelled." },
        timed_out: { kind: "refused", reason: "A execução terminou em timed_out." },
        interrupted: { kind: "refused", reason: "A execução terminou em interrupted." },
      };
      expect(Object.keys(cases)).toHaveLength(8);
      const dir = path.join(w.ctx.paths.artifacts, "lote-valido");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "entities.json"),
        JSON.stringify({ v: 1, suggestions: [suggestion("perfil", "Ana Clara", [[a, 3]])] }),
      );
      for (const [status, want] of Object.entries(cases) as Array<[RunStatus, unknown]>) {
        const outcome = batchOutcome(env("lote-valido"), status);
        if (want === "accepted") {
          expect(outcome, status).toMatchObject({ kind: "accepted" });
          expect(outcome.kind === "accepted" && outcome.suggestions.map((s) => s.name), status).toEqual([
            "Ana Clara",
          ]);
        } else expect(outcome, status).toEqual(want);
      }
      // done with no entities.json
      expect(batchOutcome(env("lote-sem-arquivo"), "done")).toEqual({
        kind: "refused",
        reason: "A execução não escreveu entities.json.",
      });
    });
  });
});

// ---- C80: the per-suggestion check --------------------------------------------------------------------------------------

describe("C80 the per-suggestion check at its own layer", () => {
  it("C80 each refusal alone drops only its suggestion, with its reason in the batch record; each accepted edge", async () => {
    await fresh(async (w) => {
      const t = NOW - HOUR;
      const a = w.note(
        path.join(w.notas, "a.md"),
        "# A\n\nFalei com Ana Clara ontem.\nA Anabela chegou.\nO Bo veio.\n",
        t,
      );
      const b = w.note(path.join(w.notas, "b.md"), "# B\n\nAna Clara e a Aninha.\n", t);
      const outside = w.note(path.join(w.notas, "fora.md"), "# Fora\n\nAna Clara aqui também.\n", t);
      const excluded = w.note(path.join(w.notas, "privado", "c.md"), "# C\n\nAna Clara no privado.\n", t);
      const long = "Ab".repeat(40);
      const longer = `${long}c`;
      const d = w.note(path.join(w.notas, "d.md"), `# D\n\n${long} e ${longer}.\n`, t);
      await w.index();
      const settings = w.ctx.settings();
      const batch: SuggestionBatch = { runId: "lote", startedAt: NOW - 2 * HOUR, files: [a, b, excluded, d] };
      const base: SuggestionCheckEnv = {
        db: w.ctx.db,
        paths: w.ctx.paths,
        settings,
        hidden: () => false,
        batch,
        keyExists: (key) => key === "perfil:ana souza",
      };
      const valid = suggestion("perfil", "Ana Clara", [[a, 3]]);
      /** The valid suggestion, then `item`: what is accepted and what is dropped. */
      const check = (item: Json, env: Partial<SuggestionCheckEnv> = {}) => {
        const verdict = checkSuggestions(Buffer.from(JSON.stringify({ v: 1, suggestions: [valid, item] })), {
          ...base,
          ...env,
        });
        if (!verdict.ok) throw new Error(verdict.reason);
        return { kept: verdict.suggestions.map((s) => s.id), dropped: verdict.dropped };
      };
      const dropped = (item: Json, reason: string, env: Partial<SuggestionCheckEnv> = {}) =>
        expect(check(item, env)).toEqual({ kept: ["lote:0"], dropped: [{ index: 1, reason }] });
      const accepted = (item: Json, env: Partial<SuggestionCheckEnv> = {}) =>
        expect(check(item, env)).toEqual({ kept: ["lote:0", "lote:1"], dropped: [] });

      // the base suggestion is kept with its evidence
      const only = checkSuggestions(Buffer.from(JSON.stringify({ v: 1, suggestions: [valid] })), base);
      expect(only).toEqual({
        ok: true,
        suggestions: [
          {
            id: "lote:0",
            kind: "perfil",
            name: "Ana Clara",
            norm: "ana clara",
            aliases: [],
            evidence: [
              {
                fileId: (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(a) as Json).id,
                path: a,
                line: 3,
                excerpt: "Falei com Ana Clara ontem.",
              },
            ],
          },
        ],
        dropped: [],
      });

      // the cited line does not hold the name as a whole word after the fold: Ana against Anabela
      dropped(
        suggestion("perfil", "Ana", [[a, 4]]),
        "A sugestão 2: a linha 4 de " + a + " não contém o nome nem um apelido.",
      );
      accepted(suggestion("perfil", "Ana", [[a, 3]]));
      // a file not in the batch (indexed, shown, its line holds the name)
      dropped(
        suggestion("perfil", "Ana Clara", [[outside, 3]]),
        `A sugestão 2 cita ${outside}, que não é um arquivo do lote.`,
      );
      // a file the policy excludes today
      accepted(suggestion("perfil", "Ana Clara", [[excluded, 3]]));
      dropped(
        suggestion("perfil", "Ana Clara", [[excluded, 3]]),
        `A sugestão 2 cita ${excluded}, que a política de hoje exclui.`,
        { settings: { ...settings, excludes: [...settings.excludes, "privado"] } },
      );
      // a folder hidden from agents
      dropped(
        suggestion("perfil", "Ana Clara", [[b, 3]]),
        `A sugestão 2 cita ${b}, que está numa pasta escondida dos agentes.`,
        { hidden: (p) => p === b },
      );
      // a line beyond the file's end (b has 3 lines)
      accepted(suggestion("perfil", "Ana Clara", [[b, 3]]));
      dropped(
        suggestion("perfil", "Ana Clara", [[b, 4]]),
        `A sugestão 2 cita a linha 4 de ${b}, que o arquivo não tem.`,
      );
      // mergeWith that names no key today
      accepted(suggestion("perfil", "Ana Clara", [[b, 3]], { mergeWith: "perfil:ana souza" }));
      dropped(
        suggestion("perfil", "Ana Clara", [[b, 3]], { mergeWith: "perfil:ana sousa" }),
        "A sugestão 2 junta com perfil:ana sousa, que não é uma entidade hoje.",
      );
      // kind: tag is not allowed; each of the three kinds is
      for (const kind of ["perfil", "projeto", "termo"]) accepted(suggestion(kind, "Ana Clara", [[b, 3]]));
      dropped(
        suggestion("tag", "Ana Clara", [[b, 3]]),
        "A sugestão 2 não segue o formato: kind: kind is perfil, projeto or termo",
      );
      // a name of 1 and of 81 characters refused, 2 and 80 accepted
      accepted(suggestion("perfil", "Bo", [[a, 5]]));
      dropped(
        suggestion("perfil", "B", [[a, 5]]),
        "A sugestão 2 não segue o formato: name: a name has 2 to 80 characters",
      );
      expect(long).toHaveLength(80);
      accepted(suggestion("perfil", long, [[d, 3]]));
      dropped(
        suggestion("perfil", longer, [[d, 3]]),
        "A sugestão 2 não segue o formato: name: a name has 2 to 80 characters",
      );
      // 4 evidence lines refused, 3 accepted
      accepted(
        suggestion("perfil", "Ana Clara", [
          [a, 3],
          [b, 3],
          [a, 3],
        ]),
      );
      dropped(
        suggestion("perfil", "Ana Clara", [
          [a, 3],
          [b, 3],
          [a, 3],
          [b, 3],
        ]),
        "A sugestão 2 não segue o formato: evidence: 1 to 3 evidence lines",
      );
      // 6 aliases refused, 5 accepted
      const aliases = (n: number) => Array.from({ length: n }, (_, i) => `Apelido ${i}`);
      accepted(suggestion("perfil", "Ana Clara", [[a, 3]], { aliases: aliases(5) }));
      dropped(
        suggestion("perfil", "Ana Clara", [[a, 3]], { aliases: aliases(6) }),
        "A sugestão 2 não segue o formato: aliases: at most 5 aliases",
      );
      // a name proven by an alias: the line holds Aninha, not Ana Souza
      accepted(suggestion("perfil", "Ana Souza", [[b, 3]], { aliases: ["Aninha"] }));
      dropped(
        suggestion("perfil", "Ana Souza", [[b, 3]]),
        `A sugestão 2: a linha 3 de ${b} não contém o nome nem um apelido.`,
      );
    });
  });
});

// ---- C81: the whole-batch refusals ---------------------------------------------------------------------------------------

describe("C81 the whole-batch refusals", () => {
  it("C81 65 537 bytes, not JSON, v: 2, 51 suggestions (50 accepted): no suggestion, the reason names the rule, at the layer and as lastBatch.reason", async () => {
    await fresh(async (w) => {
      const a = w.note(path.join(w.notas, "a.md"), "# A\n\nFalei com Ana Clara ontem.\n", Date.now() - HOUR);
      await w.index();
      const batch: SuggestionBatch = { runId: "lote", startedAt: NOW - 2 * HOUR, files: [a] };
      const env: SuggestionCheckEnv = {
        db: w.ctx.db,
        paths: w.ctx.paths,
        settings: w.ctx.settings(),
        hidden: () => false,
        batch,
        keyExists: () => false,
      };
      const one = suggestion("perfil", "Ana Clara", [[a, 3]]);
      const many = (n: number) => ({ v: 1, suggestions: Array.from({ length: n }, () => one) });
      const body = JSON.stringify(many(1));
      const padded = (size: number) => body + " ".repeat(size - Buffer.byteLength(body));
      const cases: Array<[string | Json, string]> = [
        [padded(65_537), "O lote passa de 65536 bytes."],
        ["{ não é json", "O lote não é JSON."],
        [{ v: 2, suggestions: [one] }, "O lote não segue o formato de entities.json: v: v must be 1"],
        [many(51), "O lote não segue o formato de entities.json: suggestions: at most 50 suggestions"],
      ];
      const verdictOf = (content: string | Json) =>
        checkSuggestions(Buffer.from(typeof content === "string" ? content : JSON.stringify(content)), env);
      // the accepted edges
      expect(Buffer.byteLength(padded(65_536))).toBe(65_536);
      expect(verdictOf(padded(65_536))).toMatchObject({ ok: true });
      const fifty = verdictOf(many(50));
      expect(fifty.ok && fifty.suggestions).toHaveLength(50);
      for (const [content, reason] of cases) expect(verdictOf(content)).toEqual({ ok: false, reason });

      // through a real batch each: no suggestion listed, lastBatch.reason the rule's
      for (const [i, [content, reason]] of cases.entries()) {
        w.note(path.join(w.notas, `n${i}.md`), "# N\n\nAna Clara.\n", Date.now() + 1000);
        await w.index();
        const id = await w.batch(content);
        const res = await w.list();
        expect(res.status).toBe(200);
        expect(res.body.items).toEqual([]);
        expect(res.body.lastBatch).toMatchObject({ id, status: "done", reason });
      }
      expect(fs.existsSync(a)).toBe(true);
    });
  });
});

// ---- C84: the nome rule ------------------------------------------------------------------------------------------------

describe("C84 the nome rule at its own layer", () => {
  const accepted = [
    { name: "Ana", kind: "perfil" as const },
    { name: "A. S.", kind: "perfil" as const },
  ];
  const nome = (content: string) =>
    extractMentions(content, "/notas/n.md", undefined, accepted)
      .filter((m) => m.proof === "nome")
      .map((m) => ({ line: m.line, name: m.name, norm: m.norm, kind: m.kind }));

  it("C84 after an add of Ana with alias A. S.: Falei com Ana ontem gives a nome row at that line", () => {
    expect(nome("# Nota\n\nFalei com Ana ontem\n")).toEqual([
      { line: 3, name: "Ana", norm: "ana", kind: "perfil" },
    ]);
    // and the alias, where it is written
    expect(nome("# Nota\n\nO A. S. ligou.\n")).toEqual([
      { line: 3, name: "A. S.", norm: "a s", kind: "perfil" },
    ]);
    // with nothing accepted, no nome row
    expect(extractMentions("Falei com Ana ontem\n", "/notas/n.md").filter((m) => m.proof === "nome")).toEqual(
      [],
    );
  });
  it("C84 Anabela gives none (a whole word)", () => {
    expect(nome("# Nota\n\nFalei com Anabela ontem\n")).toEqual([]);
  });
  it("C84 ANA gives a row (folded)", () => {
    expect(nome("# Nota\n\nFalei com ANA ontem\n")).toEqual([
      { line: 3, name: "Ana", norm: "ana", kind: "perfil" },
    ]);
  });
  it("C84 inside the front matter gives none", () => {
    expect(nome("---\ntitle: Ana\n---\n# Nota\n")).toEqual([]);
  });
  it("C84 inside a fenced block gives none", () => {
    expect(nome("# Nota\n\n```\nFalei com Ana\n```\n")).toEqual([]);
    expect(nome("# Nota\n\n~~~\nFalei com Ana\n~~~\n")).toEqual([]);
  });
  it("C84 inside an inline code span gives none", () => {
    expect(nome("# Nota\n\nO campo `Ana` do formulário.\n")).toEqual([]);
  });
});
