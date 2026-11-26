import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { recordSuggestionBatch } from "@mordomo/core/internal";
import { scheduleSuggestionBatches } from "../apps/api/src/routes/suggestions.js";
import * as safeFs from "../core/src/security/safeFs.js";
import { FAKE_BIN } from "./helpers.js";
import { code } from "./helpers/memoriaWorld.js";
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
 * .specs/features/cerebro-entidades-resumos, batch D, S8 at the boundary (doors 9 and 10): the automatic batch at the end
 * of a real index pass (the service's schedule with a fixed clock), `POST` and `GET /api/memory/entities/suggestions`,
 * and `accept` and `reject` through `POST /api/memory/entities/corrections`, through `app.inject` against `buildServer`
 * over a real home whose Claude provider is the fake CLI; the test writes what a batch leaves in
 * `artifacts/<run>/entities.json`. The rules at their own layer are `sugestoes.layer.test.ts`.
 */

vi.mock("../core/src/security/safeFs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof safeFs>();
  return { ...actual, readWorkspaceText: vi.fn(actual.readWorkspaceText) };
});

let seq = 0;
afterAll(() => {
  vi.restoreAllMocks();
});

async function fresh<T>(fn: (w: SugestoesWorld) => Promise<T>): Promise<T> {
  const w = await sugestoesWorld(`mordomo-sugestoes-routes-${++seq}-`);
  try {
    return await fn(w);
  } finally {
    await w.close();
  }
}

const enc = encodeURIComponent;
const mcpOf = (w: SugestoesWorld) => ({
  ...w.owner(),
  "x-mordomo-as": "mcp",
  "x-mordomo-client": "claude-code",
});
const entityKeys = async (w: SugestoesWorld): Promise<string[]> => {
  const res = await w.call("GET", "/api/memory/entities?limit=200");
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.items.map((e: Json) => e.key);
};
/** The note changed again, so a later batch reads it (its `mtime` after the last batch's start, in the index). */
const touched = async (w: SugestoesWorld, file: string, text: string) => {
  w.note(file, text, Date.now() + MINUTE);
  await w.index();
};
const overrides = (w: SugestoesWorld) =>
  w.ctx.db.prepare("SELECT action, a, b, name, undone_at FROM entity_overrides ORDER BY id").all() as Json[];
/** Wait for every open run of the world to end. */
const settleAll = async (w: SugestoesWorld) => {
  for (const run of w.ctx.runs.list({ limit: 200 })) await w.ctx.execution.wait(run.id);
};

// ---- C73, C74: the automatic batch --------------------------------------------------------------------------------

/** Three notes changed in the last hours, newest first: c (1 h), b (2 h), a (3 h); and one before every batch. */
function changedNotes(w: SugestoesWorld): { a: string; b: string; c: string; old: string } {
  const a = w.note(path.join(w.notas, "a.md"), "# A\n\nReunião com Ana.\n", NOW - 3 * HOUR);
  const c = w.note(path.join(w.notas, "c.md"), "# C\n\nVisita ao Banco Central.\n", NOW - 1 * HOUR);
  const b = w.note(path.join(w.notas, "b.md"), "# B\n\nPlano do Projeto Atlas.\n", NOW - 2 * HOUR);
  const old = w.note(path.join(w.notas, "old.md"), "# Velha\n\nAntiga.\n", NOW - 30 * HOUR);
  return { a, b, c, old };
}

/** A pass of the index with the service's schedule on, its clock at NOW; answers the batches it started. */
async function passWithSchedule(
  w: SugestoesWorld,
): Promise<Array<{ id: string; inputs: Record<string, string> }>> {
  const before = new Set(w.batchRuns().map((r) => r.id));
  const stop = scheduleSuggestionBatches(w.ctx, () => NOW);
  try {
    await w.index();
  } finally {
    stop();
  }
  const started = w.batchRuns().filter((r) => !before.has(r.id));
  for (const r of started) await w.settle(r.id);
  return started;
}

describe("C73 the extraction off starts no batch", () => {
  it("C73 memory.entities.llm.enabled false: a finished pass with 3 changed notes and no batch ever starts no brain-entities run (runs count unchanged)", async () => {
    await fresh(async (w) => {
      expect(w.ctx.settings().memory.entities.llm.enabled).toBe(false);
      changedNotes(w);
      const runs = w.runCount();
      expect(await passWithSchedule(w)).toEqual([]);
      expect(w.runCount()).toBe(runs);
    });
  });
});

describe("C74 the automatic start, one case per condition", () => {
  it("C74 after a pass, no open run, last batch 24 h 1 min ago, 3 changed notes: one run starts with files = those 3, newest first", async () => {
    await fresh(async (w) => {
      w.llm(true);
      recordSuggestionBatch(w.ctx.db, { runId: "anterior", startedAt: NOW - 24 * HOUR - MINUTE, files: [] });
      const n = changedNotes(w);
      const started = await passWithSchedule(w);
      expect(started).toHaveLength(1);
      expect(started[0]!.inputs.files).toBe([n.c, n.b, n.a].join("\n"));
      expect(w.batchRuns().find((r) => r.id === started[0]!.id)?.startedBy).toBeNull();
    });
  });

  it("C74 last batch 23 h 59 min ago: no run starts", async () => {
    await fresh(async (w) => {
      w.llm(true);
      recordSuggestionBatch(w.ctx.db, {
        runId: "anterior",
        startedAt: NOW - 23 * HOUR - 59 * MINUTE,
        files: [],
      });
      changedNotes(w);
      const runs = w.runCount();
      expect(await passWithSchedule(w)).toEqual([]);
      expect(w.runCount()).toBe(runs);
    });
  });

  it("C74 another run open: no run starts", async () => {
    await fresh(async (w) => {
      w.llm(true);
      recordSuggestionBatch(w.ctx.db, { runId: "anterior", startedAt: NOW - 25 * HOUR, files: [] });
      changedNotes(w);
      const open = w.run("read_only");
      expect(w.ctx.runs.get(open.runId)?.status).toBe("queued");
      const runs = w.runCount();
      expect(await passWithSchedule(w)).toEqual([]);
      expect(w.runCount()).toBe(runs);
    });
  });

  it("C74 no changed note since the last batch: no run starts", async () => {
    await fresh(async (w) => {
      w.llm(true);
      recordSuggestionBatch(w.ctx.db, { runId: "anterior", startedAt: NOW - 25 * HOUR, files: [] });
      w.note(path.join(w.notas, "old.md"), "# Velha\n\nReunião com Ana.\n", NOW - 26 * HOUR);
      const runs = w.runCount();
      expect(await passWithSchedule(w)).toEqual([]);
      expect(w.runCount()).toBe(runs);
    });
  });

  it("C74 no batch ever: one run starts, over the changed notes", async () => {
    await fresh(async (w) => {
      w.llm(true);
      const n = changedNotes(w);
      const started = await passWithSchedule(w);
      expect(started).toHaveLength(1);
      // with no batch ever, every note is new: the old one comes last
      expect(started[0]!.inputs.files).toBe([n.c, n.b, n.a, n.old].join("\n"));
    });
  });
});

// ---- C76, C77: POST /api/memory/entities/suggestions ----------------------------------------------------------------

describe("C76 POST /api/memory/entities/suggestions by the owner", () => {
  it("C76 202 { id, status: running } with the extraction off and on; one run of brain-entities, read_only, by the owner", async () => {
    await fresh(async (w) => {
      changedNotes(w);
      await w.index();
      for (const on of [false, true]) {
        w.llm(on);
        // a note changed after the last batch, so each request has something to read
        w.note(path.join(w.notas, `novo-${on}.md`), "# Novo\n\nTexto.\n", Date.now() + 1000);
        await w.index();
        const res = await w.start();
        expect(res.status, JSON.stringify(res.body)).toBe(202);
        expect(Object.keys(res.body).sort()).toEqual(["id", "status"]);
        expect(res.body.status).toBe("running");
        const run = w.ctx.runs.get(res.body.id)!;
        expect(run.skillSlug).toBe("brain-entities");
        expect(run.request?.mode).toBe("read_only");
        expect(run.startedBy).toBe("owner");
        await w.settle(res.body.id);
      }
    });
  });

  it("C76 409 nothing_to_read with no note changed since the last batch; no run", async () => {
    await fresh(async (w) => {
      changedNotes(w);
      await w.index();
      await w.batch({ v: 1, suggestions: [] });
      const runs = w.runCount();
      expect(code(await w.start())).toEqual([409, "nothing_to_read"]);
      expect(w.runCount()).toBe(runs);
    });
  });

  it("C76 409 suggestions_in_progress with a batch open; no run", async () => {
    await fresh(async (w) => {
      changedNotes(w);
      await w.index();
      const open = w.run("read_only");
      recordSuggestionBatch(w.ctx.db, { runId: open.runId, startedAt: Date.now() - HOUR, files: [] });
      w.note(path.join(w.notas, "novo.md"), "# Novo\n\nTexto.\n", Date.now() + 1000);
      await w.index();
      const runs = w.runCount();
      expect(code(await w.start())).toEqual([409, "suggestions_in_progress"]);
      expect(w.runCount()).toBe(runs);
    });
  });

  it("C76 409 skill_unavailable: no skills/brain-entities/; no run", async () => {
    await fresh(async (w) => {
      changedNotes(w);
      await w.index();
      fs.rmSync(path.dirname(w.skillFile()), { recursive: true, force: true });
      const runs = w.runCount();
      expect(code(await w.start())).toEqual([409, "skill_unavailable"]);
      expect(w.runCount()).toBe(runs);
    });
  });

  it("C76 409 skill_unavailable: the skill with enabled: false (present and in memorySkills); no run", async () => {
    await fresh(async (w) => {
      changedNotes(w);
      await w.index();
      const text = fs.readFileSync(w.skillFile(), "utf8");
      fs.writeFileSync(w.skillFile(), text.replace("enabled: true", "enabled: false"));
      expect(w.ctx.settings().memorySkills).toContain("brain-entities");
      const runs = w.runCount();
      expect(code(await w.start())).toEqual([409, "skill_unavailable"]);
      expect(w.runCount()).toBe(runs);
    });
  });

  it("C76 409 skill_unavailable: the skill absent from memorySkills (present and enabled); no run", async () => {
    await fresh(async (w) => {
      changedNotes(w);
      await w.index();
      w.update((s) => {
        s.memorySkills = s.memorySkills.filter((k) => k !== "brain-entities");
      });
      expect(fs.readFileSync(w.skillFile(), "utf8")).toContain("enabled: true");
      const runs = w.runCount();
      expect(code(await w.start())).toEqual([409, "skill_unavailable"]);
      expect(w.runCount()).toBe(runs);
    });
  });

  it("C76 409 entities_disabled with memory.entities.enabled false; no run", async () => {
    await fresh(async (w) => {
      changedNotes(w);
      await w.index();
      w.update((s) => {
        s.memory.entities.enabled = false;
      });
      const runs = w.runCount();
      expect(code(await w.start())).toEqual([409, "entities_disabled"]);
      expect(w.runCount()).toBe(runs);
    });
  });
});

describe("C77 who may call the suggestion routes", () => {
  it("C77 through /api and /api/v1: the owner passes; a device 403 owner_only; a run's rc_ and the principal mcp 403 forbidden", async () => {
    await fresh(async (w) => {
      changedNotes(w);
      await w.index();
      const device = w.device(["content", "monitor", "run", "approve"]);
      const runCredential = w.run("read_only").headers;
      for (const prefix of ["/api", "/api/v1"]) {
        const url = `${prefix}/memory/entities/suggestions`;
        for (const method of ["GET", "POST"]) {
          expect(code(await w.call(method, url, undefined, device)), `${method} ${url} device`).toEqual([
            403,
            "owner_only",
          ]);
          expect(code(await w.call(method, url, undefined, runCredential)), `${method} ${url} rc_`).toEqual([
            403,
            "forbidden",
          ]);
          expect(code(await w.call(method, url, undefined, mcpOf(w))), `${method} ${url} mcp`).toEqual([
            403,
            "forbidden",
          ]);
        }
        expect((await w.call("GET", url)).status).toBe(200);
      }
      // the owner's POST, through each prefix (the queued run of the rc_ credential is not a batch)
      for (const prefix of ["/api", "/api/v1"]) {
        w.note(path.join(w.notas, `novo${prefix.length}.md`), "# Novo\n\nTexto.\n", Date.now() + 1000);
        await w.index();
        const res = await w.call("POST", `${prefix}/memory/entities/suggestions`);
        expect(res.status, JSON.stringify(res.body)).toBe(202);
        await w.settle(res.body.id);
      }
    });
  });
});

// ---- C78: the run's known input ------------------------------------------------------------------------------------

describe("C78 the run's known input", () => {
  it("C78 known holds the names and aliases of the entities the agents see and every rejected norm, and no name only of a folder hidden from agents", async () => {
    await fresh(async (w) => {
      const hiddenDir = w.outside("escondida");
      w.update((s) => {
        s.indexedFolders = [...s.indexedFolders, { path: hiddenDir, area: null, enabled: true }];
        s.folderAccess = [{ path: hiddenDir, agents: "hide", devices: "read" }];
      });
      const t = Date.now() - HOUR;
      w.note(
        path.join(w.notas, "ana.md"),
        "---\ntype: profile\ntitle: Ana Souza\naliases: [Ana]\n---\ncontato.\n",
        t,
      );
      w.note(path.join(w.notas, "n1.md"), "# N1\n\nVisita ao Banco Central.\n", t);
      const n2 = w.note(
        path.join(w.notas, "n2.md"),
        "# N2\n\nReunião no Banco Central com o Mercado Livre.\n",
        t,
      );
      w.note(
        path.join(hiddenDir, "zeca.md"),
        "---\ntype: profile\ntitle: Zeca Pagodinho\n---\nsegredo.\n",
        t,
      );
      await w.index();
      // the owner sees Zeca; the agents do not
      expect(await entityKeys(w)).toContain("perfil:zeca pagodinho");

      // a first batch, whose one suggestion the owner rejects
      const first = await w.batch({ v: 1, suggestions: [suggestion("projeto", "Mercado Livre", [[n2, 3]])] });
      const listed = (await w.list()).body.items as Json[];
      expect(listed.map((s) => s.name)).toEqual(["Mercado Livre"]);
      expect((await w.correct({ action: "reject", suggestion: listed[0]!.id })).status).toBe(200);
      expect(first).toBeTruthy();

      // the next batch is handed the names the agents see and the rejected norm
      w.note(path.join(w.notas, "n3.md"), "# N3\n\nNada.\n", Date.now() + 1000);
      await w.index();
      const res = await w.start();
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      await w.settle(res.body.id);
      const known = w.ctx.runs.get(res.body.id)!.request;
      const lines = (known?.kind === "skill" ? known.inputs.known : "")!.split("\n");
      expect(lines).toEqual(expect.arrayContaining(["Ana Souza", "Ana", "Banco Central", "mercado livre"]));
      expect(lines).not.toContain("Zeca Pagodinho");
      expect(lines.filter((l) => /zeca/i.test(l))).toEqual([]);
    });
  });
});

// ---- C135: the privacy claim of AC 105 at the boundary ----------------------------------------------------------------

describe("C135 what a batch is handed, and who runs it", () => {
  /** A note in a folder hidden from agents and one the policy excludes today, newer than the open note and with every word a changed note has. */
  async function secretWorld(w: SugestoesWorld) {
    const hiddenDir = w.outside("escondida");
    w.update((s) => {
      s.indexedFolders = [...s.indexedFolders, { path: hiddenDir, area: null, enabled: true }];
      s.folderAccess = [{ path: hiddenDir, agents: "hide", devices: "read" }];
    });
    const t = Date.now() - HOUR;
    const open = w.note(path.join(w.notas, "aberta.md"), "# Aberta\n\nReunião com Banco Central.\n", t);
    const hidden = w.note(
      path.join(hiddenDir, "oculta.md"),
      "---\ntype: profile\ntitle: Zeca Pagodinho\naliases: [Zeca]\n---\nFalei com Yolanda Reservada.\n",
      t + MINUTE,
    );
    const excluded = w.note(
      path.join(w.notas, "privado", "segredo.md"),
      "---\ntype: profile\ntitle: Quincas Borba\n---\nVisita ao Projeto Sigiloso.\n",
      t + 2 * MINUTE,
    );
    await w.index();
    // the policy changes after the index: today's policy decides (AC 105)
    w.update((s) => {
      s.excludes = [...s.excludes, "privado"];
    });
    const secret = /zeca|pagodinho|yolanda|quincas|borba|sigiloso|oculta|segredo|privado|escondida/i;
    return { open, hidden, excluded, secret };
  }

  const inputsOf = (w: SugestoesWorld, runId: string): Record<string, string> => {
    const request = w.ctx.runs.get(runId)?.request;
    return request?.kind === "skill" ? request.inputs : {};
  };

  it("C135 the owner's batch: neither the hidden note nor the excluded one is in files, and no name or text of either is in known", async () => {
    await fresh(async (w) => {
      const n = await secretWorld(w);
      // the owner sees both notes' entities: the filter has something to hide (L-072)
      expect(await entityKeys(w)).toEqual(expect.arrayContaining(["perfil:zeca pagodinho"]));
      const res = await w.start();
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      await w.settle(res.body.id);
      const inputs = inputsOf(w, res.body.id);
      expect(inputs.files.split("\n")).toEqual([n.open]);
      expect(inputs.known ?? "").not.toMatch(n.secret);
      expect(JSON.stringify(inputs)).not.toMatch(n.secret);
    });
  });

  it("C135 the batch the index pass starts on its own: the same files and known", async () => {
    await fresh(async (w) => {
      w.llm(true);
      const n = await secretWorld(w);
      const started = await passWithSchedule(w);
      expect(started).toHaveLength(1);
      expect(started[0]!.inputs.files.split("\n")).toEqual([n.open]);
      expect(JSON.stringify(started[0]!.inputs)).not.toMatch(n.secret);
    });
  });

  it("C135 the run's provider is the settings' default provider: claude, then codex after the default changes", async () => {
    await fresh(async (w) => {
      await secretWorld(w);
      const first = await w.start();
      expect(first.status, JSON.stringify(first.body)).toBe(202);
      expect(w.ctx.runs.get(first.body.id)?.provider).toBe("claude");
      await w.settle(first.body.id);

      w.update((s) => {
        s.providers.codex.enabled = true;
        s.providers.codex.binaryPath = path.join(FAKE_BIN, "codex");
        s.defaultProvider = "codex";
      });
      w.ctx.reloadAdapters();
      w.note(path.join(w.notas, "nova.md"), "# Nova\n\nTexto.\n", Date.now() + MINUTE);
      await w.index();
      const second = await w.start();
      expect(second.status, JSON.stringify(second.body)).toBe(202);
      expect(w.ctx.runs.get(second.body.id)?.provider).toBe("codex");
      await w.settle(second.body.id);
    });
  });
});

// ---- C79: the list ---------------------------------------------------------------------------------------------------

/** A profile (Ana Souza, home note), a term in two files (Ana Sousa), and notes citing new names. */
async function people(w: SugestoesWorld) {
  const t = Date.now() - HOUR;
  const ana = w.note(
    path.join(w.notas, "ana.md"),
    "---\ntype: profile\ntitle: Ana Souza\n---\ncontato.\n",
    t,
  );
  const r1 = w.note(path.join(w.notas, "r1.md"), "# R1\n\nFalei com Bruno Lima sobre a Ana Sousa.\n", t);
  const r2 = w.note(
    path.join(w.notas, "r2.md"),
    "# R2\n\nA Ana Sousa e a Carla Dias vieram.\nCarla trouxe o plano.\n",
    t,
  );
  const r3 = w.note(path.join(w.notas, "r3.md"), "# R3\n\nO Bruno pediu o relatório.\n", t);
  await w.index();
  const fileId = (file: string) =>
    (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(file) as { id: number }).id;
  return { ana, r1, r2, r3, fileId };
}

describe("C79 GET /api/memory/entities/suggestions lists an accepted batch", () => {
  it("C79 two valid suggestions listed, each { id, kind, name, aliases, mergeWith?, evidence[{ fileId, path, line, excerpt }], state: pending }, and lastBatch { id, status: done, startedAt, finishedAt }", async () => {
    await fresh(async (w) => {
      const n = await people(w);
      const before = Date.now();
      const id = await w.batch({
        v: 1,
        suggestions: [
          suggestion(
            "perfil",
            "Bruno Lima",
            [
              [n.r1, 3],
              [n.r3, 3],
            ],
            { aliases: ["Bruno"] },
          ),
          suggestion("perfil", "Ana Sousa", [[n.r2, 3]], { mergeWith: "perfil:ana souza" }),
        ],
      });
      const res = await w.list();
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.items).toEqual([
        {
          id: `${id}:0`,
          kind: "perfil",
          name: "Bruno Lima",
          aliases: ["Bruno"],
          evidence: [
            {
              fileId: n.fileId(n.r1),
              path: n.r1,
              line: 3,
              excerpt: "Falei com Bruno Lima sobre a Ana Sousa.",
            },
            { fileId: n.fileId(n.r3), path: n.r3, line: 3, excerpt: "O Bruno pediu o relatório." },
          ],
          state: "pending",
        },
        {
          id: `${id}:1`,
          kind: "perfil",
          name: "Ana Sousa",
          aliases: [],
          mergeWith: "perfil:ana souza",
          evidence: [
            { fileId: n.fileId(n.r2), path: n.r2, line: 3, excerpt: "A Ana Sousa e a Carla Dias vieram." },
          ],
          state: "pending",
        },
      ]);
      const run = w.ctx.runs.get(id)!;
      expect(Object.keys(res.body.lastBatch).sort()).toEqual(["finishedAt", "id", "startedAt", "status"]);
      expect(res.body.lastBatch).toEqual({
        id,
        status: "done",
        startedAt: expect.any(Number),
        finishedAt: run.finishedAt,
      });
      expect(res.body.lastBatch.startedAt).toBeGreaterThanOrEqual(before);
      expect(res.body.lastBatch.startedAt).toBeLessThanOrEqual(run.finishedAt!);
    });
  });
});

// ---- C82: filtering against today -----------------------------------------------------------------------------------

describe("C82 the suggestions are filtered against today", () => {
  it("C82 a norm already an entity's (no mergeWith) is not listed; a rejected norm is not listed; a later batch proposing a norm the owner rejected lists nothing for it", async () => {
    await fresh(async (w) => {
      const n = await people(w);
      // the stored rejection of `carla dias`, written by refusing it in a first batch
      await w.batch({ v: 1, suggestions: [suggestion("perfil", "Carla Dias", [[n.r2, 3]])] });
      const first = (await w.list()).body.items as Json[];
      expect(first.map((s) => s.name)).toEqual(["Carla Dias"]);
      expect((await w.correct({ action: "reject", suggestion: first[0]!.id })).status).toBe(200);
      expect((await w.list()).body.items).toEqual([]);

      const r4 = w.note(
        path.join(w.notas, "r4.md"),
        // in lower case: a term of its own in a second file would make Carla and Bruno entities already
        "# R4\n\nA Ana Sousa voltou.\na carla dias ligou.\no bruno lima também.\n",
        Date.now() + 1000,
      );
      await w.index();
      await w.batch({
        v: 1,
        suggestions: [
          // a norm of an entity today (the term Ana Sousa, in three files), without mergeWith
          suggestion("perfil", "Ana Sousa", [[r4, 3]]),
          // the rejected norm, proposed again
          suggestion("perfil", "Carla Dias", [[r4, 4]]),
          // a new one, listed
          suggestion("perfil", "Bruno Lima", [[r4, 5]]),
        ],
      });
      expect(((await w.list()).body.items as Json[]).map((s) => s.name)).toEqual(["Bruno Lima"]);
    });
  });
});

// ---- C83: accept without mergeWith -----------------------------------------------------------------------------------

describe("C83 accept of a suggestion without mergeWith", () => {
  it("C83 one entity_overrides row add (a = the norm, name, b = { kind, aliases } as JSON); the entity is listed with that kind; accept twice 409 correction_conflict; an unknown suggestion 404 not_found", async () => {
    await fresh(async (w) => {
      const n = await people(w);
      const id = await w.batch({
        v: 1,
        suggestions: [suggestion("projeto", "Bruno Lima", [[n.r1, 3]], { aliases: ["Bruno"] })],
      });
      const before = overrides(w).length;
      const res = await w.correct({ action: "accept", suggestion: `${id}:0` });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.correction).toMatchObject({ action: "add", names: ["bruno lima"] });
      const rows = overrides(w);
      expect(rows).toHaveLength(before + 1);
      expect(rows[rows.length - 1]).toEqual({
        action: "add",
        a: "bruno lima",
        b: JSON.stringify({ kind: "projeto", aliases: ["Bruno"] }),
        name: "Bruno Lima",
        undone_at: null,
      });
      const listed = (await w.call("GET", "/api/memory/entities?limit=200")).body.items as Json[];
      expect(listed.find((e) => e.key === "projeto:bruno lima")).toMatchObject({
        kind: "projeto",
        name: "Bruno Lima",
      });
      expect(res.body.entity).toMatchObject({ key: "projeto:bruno lima", kind: "projeto" });

      expect(code(await w.correct({ action: "accept", suggestion: `${id}:0` }))).toEqual([
        409,
        "correction_conflict",
      ]);
      expect(overrides(w)).toHaveLength(before + 1);
      expect(code(await w.correct({ action: "accept", suggestion: `${id}:7` }))).toEqual([404, "not_found"]);
      expect(code(await w.correct({ action: "accept", suggestion: "nenhum" }))).toEqual([404, "not_found"]);
      expect(overrides(w)).toHaveLength(before + 1);
    });
  });
});

// ---- C85: the re-extraction after an add and its undo ------------------------------------------------------------

describe("C85 an add makes the next pass re-extract every file from the stored text", () => {
  it("C85 after the add, a pass with no file opened writes nome rows and the marker 1:<sha256 of the sorted kind:name>; the next recomputes none; undoing the add re-extracts and the nome rows are gone", async () => {
    await fresh(async (w) => {
      const n = await people(w);
      const id = await w.batch({
        v: 1,
        suggestions: [suggestion("perfil", "Bruno Lima", [[n.r1, 3]], { aliases: ["Bruno"] })],
      });
      // what the batch's run left in memory/ (its journal line) is indexed before the add, so the next pass changes no file
      await w.index();
      const accepted = await w.correct({ action: "accept", suggestion: `${id}:0` });
      expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
      const nomeRows = () =>
        w.ctx.db
          .prepare(
            "SELECT f.path, m.line, m.kind, m.name, m.norm FROM entity_mentions m JOIN files f ON f.id = m.src_id WHERE m.proof = 'nome' ORDER BY f.path, m.line, m.norm",
          )
          .all() as Json[];
      const marker = () =>
        (
          w.ctx.db.prepare("SELECT value FROM meta WHERE key = 'index.entity_mentions'").get() as {
            value: string;
          }
        ).value;
      expect(nomeRows()).toEqual([]);
      expect(marker()).toBe("1");

      /** A pass, counting the files of the notes opened and the DELETEs of mentions. */
      const pass = async () => {
        const opened: string[] = [];
        const realOpen = fs.openSync;
        const openSpy = vi.spyOn(fs, "openSync").mockImplementation(((
          target: fs.PathLike,
          ...rest: unknown[]
        ) => {
          if (String(target).startsWith(w.notas)) opened.push(String(target));
          return (realOpen as (...a: unknown[]) => number)(target, ...rest);
        }) as typeof fs.openSync);
        const textReads = vi.mocked(safeFs.readWorkspaceText);
        textReads.mockClear();
        const realPrepare = w.ctx.db.prepare.bind(w.ctx.db);
        let deletes = 0;
        const prepareSpy = vi.spyOn(w.ctx.db, "prepare").mockImplementation(((sql: string) => {
          if (sql.startsWith("DELETE FROM entity_mentions")) deletes++;
          return realPrepare(sql);
        }) as typeof w.ctx.db.prepare);
        try {
          await w.index();
        } finally {
          openSpy.mockRestore();
          prepareSpy.mockRestore();
        }
        const reads = textReads.mock.calls.filter((c) => String(c[1]).startsWith(w.notas)).length;
        return { opened: opened.length, reads, deletes };
      };

      const files = (
        w.ctx.db.prepare("SELECT COUNT(*) AS n FROM files WHERE ext = '.md'").get() as { n: number }
      ).n;
      const afterAdd = await pass();
      expect(afterAdd.opened).toBe(0);
      expect(afterAdd.reads).toBe(0);
      // every Markdown file read again from the stored text: its rows replaced
      expect(afterAdd.deletes).toBe(files);
      const sha = crypto
        .createHash("sha256")
        .update(["perfil:Bruno", "perfil:Bruno Lima"].sort().join("\n"))
        .digest("hex");
      expect(marker()).toBe(`1:${sha}`);
      expect(nomeRows()).toEqual(
        [
          { path: n.r1, line: 3, kind: "perfil", name: "Bruno Lima", norm: "bruno lima" },
          { path: n.r1, line: 3, kind: "perfil", name: "Bruno", norm: "bruno" },
          { path: n.r3, line: 3, kind: "perfil", name: "Bruno", norm: "bruno" },
        ].sort((x, y) =>
          x.path < y.path ? -1 : x.path > y.path ? 1 : x.line - y.line || (x.norm < y.norm ? -1 : 1),
        ),
      );

      const again = await pass();
      expect(again).toEqual({ opened: 0, reads: 0, deletes: 0 });

      // undo of the add: the next pass re-extracts again, and the nome rows are gone
      const undo = await w.correct({ action: "undo", id: accepted.body.correction.id });
      expect(undo.status, JSON.stringify(undo.body)).toBe(200);
      const afterUndo = await pass();
      expect(afterUndo.opened).toBe(0);
      expect(afterUndo.reads).toBe(0);
      expect(afterUndo.deletes).toBe(files);
      expect(marker()).toBe("1");
      expect(nomeRows()).toEqual([]);
      expect(await entityKeys(w)).not.toContain("perfil:bruno lima");
    });
  });

  it("C85 undoing the add and accepting the same names with another kind moves the marker, and after the next pass the nome rows carry the new kind", async () => {
    await fresh(async (w) => {
      const n = await people(w);
      const id = await w.batch({
        v: 1,
        suggestions: [suggestion("perfil", "Bruno Lima", [[n.r1, 3]], { aliases: ["Bruno"] })],
      });
      await w.index();
      const accepted = await w.correct({ action: "accept", suggestion: `${id}:0` });
      expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
      await w.index();
      const marker = () =>
        (
          w.ctx.db.prepare("SELECT value FROM meta WHERE key = 'index.entity_mentions'").get() as {
            value: string;
          }
        ).value;
      const nomeRows = () =>
        w.ctx.db
          .prepare(
            "SELECT f.path, m.name, m.kind FROM entity_mentions m JOIN files f ON f.id = m.src_id WHERE m.proof = 'nome' ORDER BY f.path, m.name",
          )
          .all() as Json[];
      const sha = (names: string[]) =>
        crypto
          .createHash("sha256")
          .update([...names].sort().join("\n"))
          .digest("hex");
      expect(marker()).toBe(`1:${sha(["perfil:Bruno", "perfil:Bruno Lima"])}`);
      expect(nomeRows()).toEqual([
        { path: n.r1, name: "Bruno", kind: "perfil" },
        { path: n.r1, name: "Bruno Lima", kind: "perfil" },
        { path: n.r3, name: "Bruno", kind: "perfil" },
      ]);

      // the note changes again (a pass), so the next batch reads it; then undo, and with no pass in between the same
      // names accepted again as a project, through the route (C133)
      await touched(w, n.r1, "# R1\n\nFalei com Bruno Lima sobre a Ana Sousa.\n");
      const undo = await w.correct({ action: "undo", id: accepted.body.correction.id });
      expect(undo.status, JSON.stringify(undo.body)).toBe(200);
      const again = await w.batch({
        v: 1,
        suggestions: [suggestion("projeto", "Bruno Lima", [[n.r1, 3]], { aliases: ["Bruno"] })],
      });
      const second = await w.correct({ action: "accept", suggestion: `${again}:0` });
      expect(second.status, JSON.stringify(second.body)).toBe(200);
      await w.index();
      expect(marker()).toBe(`1:${sha(["projeto:Bruno", "projeto:Bruno Lima"])}`);
      expect(nomeRows()).toEqual([
        { path: n.r1, name: "Bruno", kind: "projeto" },
        { path: n.r1, name: "Bruno Lima", kind: "projeto" },
        { path: n.r3, name: "Bruno", kind: "projeto" },
      ]);
    });
  });
});

// ---- C133: an add that is undone stops showing at once ---------------------------------------------------------------

describe("C133 an add that is undone takes its entity out at once", () => {
  const nomeRows = (w: SugestoesWorld) =>
    w.ctx.db.prepare("SELECT COUNT(*) AS n FROM entity_mentions WHERE proof = 'nome'").get() as { n: number };

  it("C133 undo of the add: the list and the one entity (404) stop showing perfil:bruno lima with no pass between; after the next pass the nome rows are gone", async () => {
    await fresh(async (w) => {
      const n = await people(w);
      const id = await w.batch({
        v: 1,
        suggestions: [suggestion("perfil", "Bruno Lima", [[n.r1, 3]], { aliases: ["Bruno"] })],
      });
      await w.index();
      const accepted = await w.correct({ action: "accept", suggestion: `${id}:0` });
      expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
      await w.index();
      expect(nomeRows(w).n).toBeGreaterThan(0);
      expect(await entityKeys(w)).toContain("perfil:bruno lima");
      expect((await w.call("GET", `/api/memory/entities/${enc("perfil:bruno lima")}`)).status).toBe(200);

      const undo = await w.correct({ action: "undo", id: accepted.body.correction.id });
      expect(undo.status, JSON.stringify(undo.body)).toBe(200);
      // the nome rows are still stored, and read as nothing
      expect(nomeRows(w).n).toBeGreaterThan(0);
      expect(await entityKeys(w)).not.toContain("perfil:bruno lima");
      expect((await w.call("GET", `/api/memory/entities/${enc("perfil:bruno lima")}`)).status).toBe(404);

      await w.index();
      expect(nomeRows(w).n).toBe(0);
      expect(await entityKeys(w)).not.toContain("perfil:bruno lima");
    });
  });

  it("C133 an entity that has a nota row stays listed with only that row after the undo", async () => {
    await fresh(async (w) => {
      const n = await people(w);
      w.note(
        path.join(w.notas, "bruno.md"),
        "---\ntype: profile\ntitle: Bruno\n---\ncontato.\n",
        Date.now() - HOUR,
      );
      await w.index();
      const id = await w.batch({
        v: 1,
        suggestions: [suggestion("perfil", "Bruno Lima", [[n.r1, 3]], { aliases: ["Bruno"] })],
      });
      await w.index();
      const accepted = await w.correct({ action: "accept", suggestion: `${id}:0` });
      expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
      await w.index();
      const detail = async () => (await w.call("GET", `/api/memory/entities/${enc("perfil:bruno")}`)).body;
      const before = await detail();
      expect(before.mentions.length).toBeGreaterThan(1);

      const undo = await w.correct({ action: "undo", id: accepted.body.correction.id });
      expect(undo.status, JSON.stringify(undo.body)).toBe(200);
      const after = await detail();
      expect(after.key).toBe("perfil:bruno");
      expect(after.mentions.map((m: Json) => m.proof)).toEqual(["nota"]);
      const listed = (await w.call("GET", "/api/memory/entities?limit=200")).body.items.find(
        (e: Json) => e.key === "perfil:bruno",
      );
      expect(listed).toMatchObject({ files: 1, mentions: 1 });
    });
  });

  it("C133 undo and accept of the same name with another kind is 200, not 409 correction_conflict, with no pass between", async () => {
    await fresh(async (w) => {
      const n = await people(w);
      const id = await w.batch({
        v: 1,
        suggestions: [suggestion("perfil", "Bruno Lima", [[n.r1, 3]], { aliases: ["Bruno"] })],
      });
      await w.index();
      const accepted = await w.correct({ action: "accept", suggestion: `${id}:0` });
      expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
      await w.index();
      await touched(w, n.r1, "# R1\n\nFalei com Bruno Lima sobre a Ana Sousa.\n");
      const undo = await w.correct({ action: "undo", id: accepted.body.correction.id });
      expect(undo.status, JSON.stringify(undo.body)).toBe(200);

      const again = await w.batch({
        v: 1,
        suggestions: [suggestion("projeto", "Bruno Lima", [[n.r1, 3]], { aliases: ["Bruno"] })],
      });
      const second = await w.correct({ action: "accept", suggestion: `${again}:0` });
      expect(second.status, JSON.stringify(second.body)).toBe(200);
      const keys = await entityKeys(w);
      expect(keys).toContain("projeto:bruno lima");
      expect(keys).not.toContain("perfil:bruno lima");
    });
  });
});

// ---- C86, C87: accept with mergeWith, and reject -------------------------------------------------------------------

describe("C86 accept with mergeWith", () => {
  it("C86 accept with mergeWith perfil:ana souza stores merge of the two norms and the list shows one entity", async () => {
    await fresh(async (w) => {
      const n = await people(w);
      expect(await entityKeys(w)).toEqual(expect.arrayContaining(["perfil:ana souza", "termo:ana sousa"]));
      const id = await w.batch({
        v: 1,
        suggestions: [suggestion("perfil", "Ana Sousa", [[n.r2, 3]], { mergeWith: "perfil:ana souza" })],
      });
      const before = overrides(w).length;
      const res = await w.correct({ action: "accept", suggestion: `${id}:0` });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rows = overrides(w);
      expect(rows).toHaveLength(before + 1);
      expect(rows[rows.length - 1]).toEqual({
        action: "merge",
        a: "ana souza",
        b: "ana sousa",
        name: null,
        undone_at: null,
      });
      const keys = await entityKeys(w);
      expect(keys).toContain("perfil:ana souza");
      expect(keys).not.toContain("termo:ana sousa");
      const one = (await w.call("GET", `/api/memory/entities/${enc("perfil:ana souza")}`)).body;
      expect(one.aliases).toContain("Ana Sousa");
      // the merge is done: the suggestion is no longer listed
      expect((await w.list()).body.items).toEqual([]);
    });
  });
});

describe("C87 reject", () => {
  it("C87 reject stores reject with the norm; the suggestion leaves the list; undo of the reject lets a later batch list it again", async () => {
    await fresh(async (w) => {
      const n = await people(w);
      const first = await w.batch({ v: 1, suggestions: [suggestion("perfil", "Carla Dias", [[n.r2, 3]])] });
      expect(((await w.list()).body.items as Json[]).map((s) => s.id)).toEqual([`${first}:0`]);
      const res = await w.correct({ action: "reject", suggestion: `${first}:0` });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.correction).toMatchObject({ action: "reject", names: ["carla dias"] });
      expect(overrides(w).at(-1)).toEqual({
        action: "reject",
        a: "carla dias",
        b: null,
        name: null,
        undone_at: null,
      });
      expect((await w.list()).body.items).toEqual([]);
      // no entity changed: Carla Dias is in one file, no entity before or after
      expect(await entityKeys(w)).not.toContain("termo:carla dias");

      const proposeAgain = async (name: string) => {
        const file = w.note(
          path.join(w.notas, `${name}.md`),
          `# ${name}\n\ncarla dias de novo.\n`,
          Date.now() + 1000,
        );
        await w.index();
        return w.batch({ v: 1, suggestions: [suggestion("perfil", "Carla Dias", [[file, 3]])] });
      };
      await proposeAgain("x1");
      expect((await w.list()).body.items).toEqual([]);

      expect((await w.correct({ action: "undo", id: res.body.correction.id })).status).toBe(200);
      const later = await proposeAgain("x2");
      expect(((await w.list()).body.items as Json[]).map((s) => [s.id, s.name])).toEqual([
        [`${later}:0`, "Carla Dias"],
      ]);
    });
  });
});

// ---- C88: the plan's independent test -------------------------------------------------------------------------------

describe("C88 the plan's independent test of S8", () => {
  it("C88 three suggestions (right, wrong line, merge) list two; accepting the first makes the entity appear and, after the next pass, the notes citing it carry a nome mention; rejecting the merge keeps it from coming back", async () => {
    await fresh(async (w) => {
      w.llm(true);
      const n = await people(w);
      const id = await w.batch({
        v: 1,
        suggestions: [
          suggestion("perfil", "Bruno Lima", [[n.r1, 3]]),
          // the wrong line: line 1 of r2 is its title
          suggestion("perfil", "Carla Dias", [[n.r2, 1]]),
          suggestion("perfil", "Ana Sousa", [[n.r1, 3]], { mergeWith: "perfil:ana souza" }),
        ],
      });
      const items = (await w.list()).body.items as Json[];
      expect(items.map((s) => [s.id, s.name])).toEqual([
        [`${id}:0`, "Bruno Lima"],
        [`${id}:2`, "Ana Sousa"],
      ]);

      expect((await w.correct({ action: "accept", suggestion: `${id}:0` })).status).toBe(200);
      expect(await entityKeys(w)).toContain("perfil:bruno lima");
      await w.index();
      const nome = w.ctx.db
        .prepare(
          "SELECT f.path, m.line FROM entity_mentions m JOIN files f ON f.id = m.src_id WHERE m.proof = 'nome' AND m.norm = 'bruno lima' ORDER BY f.path",
        )
        .all() as Json[];
      expect(nome).toEqual([{ path: n.r1, line: 3 }]);

      expect((await w.correct({ action: "reject", suggestion: `${id}:2` })).status).toBe(200);
      expect((await w.list()).body.items).toEqual([]);
      const depois = w.note(
        path.join(w.notas, "depois.md"),
        "# Depois\n\nA Ana Sousa de novo.\n",
        Date.now() + 1000,
      );
      await w.index();
      const later = await w.batch({
        v: 1,
        suggestions: [suggestion("perfil", "Ana Sousa", [[depois, 3]], { mergeWith: "perfil:ana souza" })],
      });
      // the batch was accepted and its suggestion passed the check: it is the rejection that keeps it off the list
      expect((await w.list()).body.lastBatch).toMatchObject({ id: later, status: "done" });
      expect((await w.list()).body.lastBatch.reason).toBeUndefined();
      expect((await w.list()).body.items).toEqual([]);
      expect((await w.correct({ action: "accept", suggestion: `${later}:0` })).status).toBe(409);
      await settleAll(w);
    });
  });
});
