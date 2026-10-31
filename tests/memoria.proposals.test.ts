import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { storeProposal } from "../core/src/memory/proposals.js";
import { unifiedDiff } from "../core/src/sync/diff.js";
import { code, memoriaWorld, sha, type Json, type MemoriaWorld } from "./helpers/memoriaWorld.js";

/**
 * cerebro-memoria-confiavel S3 over HTTP (C40-C47, C51-C53, C57, C59-C68): what an agent writes becomes a proposal, the
 * review inbox lists and shows proposals, and deciding one writes through the guarded writer, records the versions and
 * asserts the facts, or nothing. Each claim reads back what the route wrote. A consolidation proposal is stored by the
 * proposal writer (`storeProposal`), as the consolidation hook stores it (C48 proves the hook). The day of a new line of
 * MEMORY.md is the local day of the acceptance; this file runs on the real clock (an index pass waits for it to move)
 * and computes that day itself: `memoria.localday.test.ts` pins a zone where the local and the UTC day differ.
 */

let w: MemoriaWorld;

beforeAll(async () => {
  w = await memoriaWorld("mordomo-memoria-proposals-");
}, 60_000);
afterAll(async () => {
  await w.close();
});

const DAY = "2026-10-30";
/** A journal day of the owner: line 4 a decision of theirs, line 5 an agent's line, line 9 under `## Runs` (9 lines). */
const JOURNAL = [
  `# ${DAY}`,
  "## Decisions",
  "",
  "- Turmas de 20 alunos",
  "- O agente sugeriu turmas de 30 (autor:: agente)",
  "",
  "## Runs",
  "",
  "- run r-1 → done in 3s",
].join("\n");
/** A note of the owner: line 5 a line of theirs. */
const NOTE = ["# Cliente", "", "## Contrato", "", "- Renovação em março"].join("\n");
/** MEMORY.md as the owner keeps it: line 5 a fact, line 9 a decision, line 13 an open loop. */
const BASE = [
  "# Long-term memory",
  "",
  "## Facts",
  "",
  "- O curso custa 700",
  "",
  "## Decisions",
  "",
  "- Turmas de 15",
  "",
  "## Open loops",
  "",
  "- Lançar a turma de março",
  "",
  "## Reflections",
  "",
  "## Superseded",
  "",
].join("\n");

const memoryFile = () => path.join(w.memory, "MEMORY.md");
const journalRel = `journal/${DAY}.md`;
const pad = (n: number) => String(n).padStart(2, "0");
/** The local day of now, as a line of MEMORY.md names it (computed here, not by the code under test). */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const agentLine = (text: string, source: string, line?: number) =>
  `- ${text} (fonte:: ${source}${line !== undefined ? `:${line}` : ""}) (autor:: agente) (em:: ${today()})`;

const facts = () => (w.ctx.db.prepare("SELECT COUNT(*) c FROM facts").get() as { c: number }).c;
const versions = () => w.ctx.db.prepare("SELECT * FROM memory_versions ORDER BY id").all() as Json[];
const pending = () =>
  (
    w.ctx.db.prepare("SELECT COUNT(*) c FROM memory_proposals WHERE status = 'pending'").get() as {
      c: number;
    }
  ).c;
const listing = (dir = w.memory): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out[path.relative(dir, full)] = fs.readFileSync(full, "utf8");
    }
  };
  walk(dir);
  return out;
};

let runs = 0;
/** A consolidation proposal of a run, as the hook stores it. */
const consolidation = (ops: Json[], summary = "Consolidação de teste") => {
  const runId = `r-cons-${++runs}`;
  return storeProposal(
    w.ctx.db,
    { kind: "consolidation", author: `run:${runId}`, runId, summary, payload: { v: 1, summary, ops } },
    { capped: false },
  );
};
const read = (id: string) => w.call("GET", `/api/memory/proposals/${id}`);
const decide = (id: string, body: Json) => w.call("POST", `/api/memory/proposals/${id}/decide`, body);
const accept = async (id: string, extra: Json = {}) => {
  const shown = await read(id);
  expect(shown.status, JSON.stringify(shown.body)).toBe(200);
  const baseVersion = shown.body.baseVersion as string | null;
  return decide(id, { action: "accept", ...(baseVersion ? { baseVersion } : {}), ...extra });
};
const add = (text: string, line?: number, section = "Decisions", source = journalRel): Json => ({
  op: "add",
  section,
  text,
  source,
  ...(line !== undefined ? { line } : {}),
});

beforeEach(() => {
  w.ctx.db.prepare("DELETE FROM memory_proposals").run();
  fs.rmSync(memoryFile(), { force: true });
  fs.rmSync(path.join(w.memory, "topics"), { recursive: true, force: true });
  w.put(path.join(w.memory, "journal", `${DAY}.md`), `${JOURNAL}\n`);
  w.put(path.join(w.memory, "notes", "cliente.md"), `${NOTE}\n`);
});

describe("C40 a run's fact is a proposal", () => {
  it("C40 a write run's POST /api/memory/facts answers 202 with a pending fact proposal of run:<id>, adds no fact, is listed; the 101st call is 429 too_many_requests; a read-only run's is 403 forbidden", async () => {
    const run = w.run("write");
    const before = facts();
    const res = await w.call(
      "POST",
      "/api/memory/facts",
      { subject: "Cliente C40", predicate: "status", object: "ativo" },
      run.headers,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.proposal).toMatchObject({
      kind: "fact",
      status: "pending",
      author: `run:${run.runId}`,
      runId: run.runId,
    });
    expect(Object.keys(res.body)).toEqual(["proposal"]);
    expect(facts()).toBe(before);
    const listed = await w.call("GET", "/api/memory/proposals");
    expect((listed.body.items as Json[]).map((i) => i.id)).toEqual([res.body.proposal.id]);

    const statuses: number[] = [];
    for (let i = 2; i <= 100; i++) {
      statuses.push(
        (
          await w.call(
            "POST",
            "/api/memory/facts",
            { subject: `C40 ${i}`, predicate: "p", object: "o" },
            run.headers,
          )
        ).status,
      );
    }
    expect(new Set(statuses)).toEqual(new Set([202]));
    const last = await w.call(
      "POST",
      "/api/memory/facts",
      { subject: "C40 101", predicate: "p", object: "o" },
      run.headers,
    );
    expect(code(last)).toEqual([429, "too_many_requests"]);
    expect(pending()).toBe(100);
    expect(facts()).toBe(before);

    const reader = w.run("read_only");
    const refused = await w.call(
      "POST",
      "/api/memory/facts",
      { subject: "C40 ro", predicate: "p", object: "o" },
      reader.headers,
    );
    expect(code(refused)).toEqual([403, "forbidden"]);
    expect(pending()).toBe(100);
  });
});

describe("C41 the owner's fact is asserted as today", () => {
  it("C41 the owner token answers 201 { fact, invalidated: [], unchanged: false }, then 200 { fact: same id, invalidated: [], unchanged: true }, and stores no proposal", async () => {
    const body = { subject: "Cliente C41", predicate: "status", object: "ativo" };
    const first = await w.call("POST", "/api/memory/facts", body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body).toMatchObject({ invalidated: [], unchanged: false });
    expect(first.body.fact).toMatchObject({
      subject: "Cliente C41",
      predicate: "status",
      object: "ativo",
      author: "owner",
    });
    const again = await w.call("POST", "/api/memory/facts", body);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ invalidated: [], unchanged: true });
    expect(again.body.fact.id).toBe(first.body.fact.id);
    expect(Object.keys(first.body).sort()).toEqual(["fact", "invalidated", "unchanged"]);
    expect(pending()).toBe(0);
    expect((w.ctx.db.prepare("SELECT COUNT(*) c FROM memory_proposals").get() as { c: number }).c).toBe(0);
  });
});

describe("C42 the owner token stores an mcp proposal", () => {
  it("C42 kind fact, note_create and note_save answer 201 with a pending proposal of mcp, runId null and an mp_ id, and store no fact and no file; the four bodies refused answer 400 validation", async () => {
    const note = await w.call("POST", "/api/memory/notes", { title: "Nota C42", content: "um" });
    expect(note.status).toBe(201);
    const filesBefore = listing();
    const factsBefore = facts();
    const bodies: Json[] = [
      { kind: "fact", subject: "Cliente C42", predicate: "status", object: "ativo" },
      { kind: "note_create", title: "Nota nova C42", content: "texto" },
      { kind: "note_save", path: note.body.path, content: "dois", baseVersion: note.body.version },
    ];
    for (const body of bodies) {
      const res = await w.call("POST", "/api/memory/proposals", body);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.proposal).toMatchObject({
        kind: body.kind,
        status: "pending",
        author: "mcp",
        runId: null,
      });
      expect(res.body.proposal.id).toMatch(/^mp_[0-9a-f]{16}$/);
    }
    expect(facts()).toBe(factsBefore);
    expect(listing()).toEqual(filesBefore);
    for (const body of [
      { kind: "fact", subject: "s", predicate: "p" },
      { kind: "note_save", path: note.body.path, content: "x" },
      { kind: "consolidation", v: 1, summary: "s", ops: [] },
      { kind: "memory_edit", content: "x" },
    ]) {
      const res = await w.call("POST", "/api/memory/proposals", body);
      expect(code(res), JSON.stringify(body)).toEqual([400, "validation"]);
    }
    expect(pending()).toBe(3);
  });
});

describe("C43 the list", () => {
  it("C43 items newest first with exactly the eight fields and total; status=pending, status=decided, limit=1; status=open is 400 validation", async () => {
    const post = async (subject: string) =>
      (await w.call("POST", "/api/memory/proposals", { kind: "fact", subject, predicate: "p", object: "o" }))
        .body.proposal.id as string;
    const p1 = await post("C43 pendente");
    const p2 = await post("C43 aceita");
    expect((await decide(p2, { action: "accept" })).status).toBe(200);
    const p3 = await post("C43 recusada");
    expect((await decide(p3, { action: "reject" })).status).toBe(200);
    const p4 = consolidation([add("C43 a", 4), add("C43 b", 4)]).id;
    expect((await accept(p4, { ops: [0] })).body.proposal.status).toBe("partial");
    const p5 = consolidation([add("C43 c", 4)]).id;
    const p6 = consolidation([add("C43 d", 4)]).id;

    const all = await w.call("GET", "/api/memory/proposals");
    expect(all.status).toBe(200);
    expect((all.body.items as Json[]).map((i) => i.id)).toEqual([p6, p5, p4, p3, p2, p1]);
    expect(all.body.total).toBe(6);
    for (const item of all.body.items as Json[]) {
      expect(Object.keys(item).sort()).toEqual(
        ["id", "kind", "status", "author", "runId", "createdAt", "summary", "opCount"].sort(),
      );
    }
    expect((all.body.items as Json[]).map((i) => i.status)).toEqual([
      "pending",
      "superseded",
      "partial",
      "rejected",
      "accepted",
      "pending",
    ]);
    const open = await w.call("GET", "/api/memory/proposals?status=pending");
    expect((open.body.items as Json[]).map((i) => i.id)).toEqual([p6, p1]);
    expect(open.body.total).toBe(2);
    const decided = await w.call("GET", "/api/memory/proposals?status=decided");
    expect((decided.body.items as Json[]).map((i) => i.id)).toEqual([p5, p4, p3, p2]);
    const one = await w.call("GET", "/api/memory/proposals?limit=1");
    expect((one.body.items as Json[]).map((i) => i.id)).toEqual([p6]);
    expect(one.body.total).toBe(6);
    expect(code(await w.call("GET", "/api/memory/proposals?status=open"))).toEqual([400, "validation"]);
  });
});

describe("C45 a journal line an agent wrote says so", () => {
  it("C45 a write run's line and the owner's line with author agent end with (autor:: agente); the owner's own line has none; author owner is 400; a run's 101st append is 429", async () => {
    const run = w.run("write");
    const day = "2026-10-29";
    const file = path.join(w.memory, "journal", `${day}.md`);
    const append = (text: string, headers?: Record<string, string>, extra: Json = {}) =>
      w.call("POST", "/api/memory/journal/append", { text, date: day, timestamp: false, ...extra }, headers);
    expect((await append("Linha da execução", run.headers)).status).toBe(200);
    expect((await append("Linha do MCP", undefined, { author: "agent" })).status).toBe(200);
    expect((await append("Linha do dono")).status).toBe(200);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    expect(lines).toContain("- Linha da execução (autor:: agente)");
    expect(lines).toContain("- Linha do MCP (autor:: agente)");
    expect(lines).toContain("- Linha do dono");
    expect(code(await append("Linha falsa", undefined, { author: "owner" }))).toEqual([400, "validation"]);
    expect(fs.readFileSync(file, "utf8")).not.toContain("Linha falsa");
    let last = 0;
    for (let i = 2; i <= 101; i++) last = (await append(`Linha ${i}`, run.headers)).status;
    expect(last).toBe(429);
    const refused = await append("Linha 102", run.headers);
    expect(code(refused)).toEqual([429, "too_many_requests"]);
  });
});

describe("C47 at most 200 pending", () => {
  const post = (i: number) =>
    w.call("POST", "/api/memory/proposals", {
      kind: "fact",
      subject: `C47 ${i}`,
      predicate: "p",
      object: "o",
    });
  it("C47 199 pending: the 200th is 201; 200: the next and a run's fact are 429 too_many_proposals and store nothing; one rejected: 201 again; the consolidation hook and the guard still store at 200", async () => {
    for (let i = 1; i <= 199; i++) {
      storeProposal(
        w.ctx.db,
        {
          kind: "fact",
          author: "mcp",
          summary: `C47 ${i}`,
          payload: { subject: `C47 ${i}`, predicate: "p", object: "o" },
        },
        { capped: true },
      );
    }
    expect(pending()).toBe(199);
    const twohundredth = await post(200);
    expect(twohundredth.status, JSON.stringify(twohundredth.body)).toBe(201);
    expect(pending()).toBe(200);
    expect(code(await post(201))).toEqual([429, "too_many_proposals"]);
    const run = w.run("write");
    const ran = await w.call(
      "POST",
      "/api/memory/facts",
      { subject: "C47 r", predicate: "p", object: "o" },
      run.headers,
    );
    expect(code(ran)).toEqual([429, "too_many_proposals"]);
    expect(pending()).toBe(200);
    expect((w.ctx.db.prepare("SELECT COUNT(*) c FROM memory_proposals").get() as { c: number }).c).toBe(200);

    expect((await decide(twohundredth.body.proposal.id, { action: "reject" })).status).toBe(200);
    expect((await post(202)).status).toBe(201);
    expect(pending()).toBe(200);

    // the hook: a run of consolidate-memory that finished done with a valid proposal.json
    const cons = w.ctx.runs.create({
      origin: "skill",
      provider: "claude",
      prompt: "c47",
      cwd: w.home,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 60_000,
      profile: "read_only",
      skillSlug: "consolidate-memory",
      startedBy: null,
    });
    w.put(
      path.join(w.ctx.paths.artifacts, cons.id, "proposal.json"),
      JSON.stringify({ v: 1, summary: "C47", ops: [add("C47 hook", 4)] }),
    );
    w.ctx.events.emit("run.finished", { runId: cons.id, status: "done", durationMs: 1 });
    expect(pending()).toBe(201);
    expect(
      (
        w.ctx.db
          .prepare("SELECT COUNT(*) c FROM memory_proposals WHERE kind = 'consolidation' AND run_id = ?")
          .get(cons.id) as {
          c: number;
        }
      ).c,
    ).toBe(1);

    // the guard: a write run that changed MEMORY.md
    w.put(memoryFile(), BASE);
    const writer = w.ctx.runs.create({
      origin: "manual",
      provider: "claude",
      prompt: "c47 write",
      cwd: w.home,
      model: null,
      effort: "default",
      mode: "write",
      timeoutMs: 60_000,
      profile: "controlled_write",
      request: { version: 1, kind: "prompt", prompt: "c47 write", mode: "write" },
      startedBy: null,
    });
    w.ctx.events.emit("run.started", { runId: writer.id, pid: null });
    fs.appendFileSync(memoryFile(), "- Linha da execução\n");
    w.ctx.events.emit("run.finished", { runId: writer.id, status: "done", durationMs: 1 });
    expect(pending()).toBe(202);
    expect(fs.readFileSync(memoryFile(), "utf8")).toBe(BASE);
    expect(
      (
        w.ctx.db
          .prepare("SELECT COUNT(*) c FROM memory_proposals WHERE kind = 'memory_edit' AND run_id = ?")
          .get(writer.id) as {
          c: number;
        }
      ).c,
    ).toBe(1);
  });
});

describe("C51 an op whose source cannot be cited is invalid", () => {
  it("C51 a missing file, a line past the end (the last line is valid), an excluded folder and ../fora.md are each invalid with a reason; accepting every valid op leaves them unapplied", async () => {
    w.update((s) => {
      s.excludes = [...s.excludes, "privado-c51"];
    });
    w.put(path.join(w.memory, "privado-c51", "segredo.md"), "- segredo\n");
    w.put(path.join(w.home, "fora.md"), "- fora\n");
    w.put(memoryFile(), BASE);
    try {
      const p = consolidation([
        add("C51 sem arquivo", 1, "Decisions", "notes/nao-existe.md"),
        add("C51 depois do fim", 10),
        add("C51 última linha", 9),
        add("C51 excluída", 1, "Decisions", "privado-c51/segredo.md"),
        add("C51 fora", 1, "Decisions", "../fora.md"),
      ]);
      const shown = await read(p.id);
      expect(shown.status).toBe(200);
      const ops = shown.body.ops as Json[];
      expect(ops.map((o) => o.state)).toEqual(["invalid", "invalid", "valid", "invalid", "invalid"]);
      for (const i of [0, 1, 3, 4]) expect(typeof ops[i]!.reason, String(i)).toBe("string");
      expect(ops[0]!.reason).toMatch(/does not exist/);
      expect(ops[1]!.reason).toMatch(/9 lines; line 10/);
      expect(ops[3]!.reason).toMatch(/policy/);
      expect(ops[4]!.reason).toMatch(/not a file under memory/);
      const done = await accept(p.id);
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      expect(done.body.proposal.status).toBe("accepted");
      const text = fs.readFileSync(memoryFile(), "utf8");
      expect(text).toContain(agentLine("C51 última linha", journalRel, 9));
      for (const gone of ["C51 sem arquivo", "C51 depois do fim", "C51 excluída", "C51 fora"]) {
        expect(text).not.toContain(gone);
      }
    } finally {
      w.update((s) => {
        s.excludes = s.excludes.filter((e) => e !== "privado-c51");
      });
    }
  });
});

describe("C52 the trust of an op, on the route", () => {
  it("C52 a Decisions line of the owner and a note line are usuario, a ## Runs line ferramenta, an agent's line, no line and a line of MEMORY.md inferido; a trust in the op is ignored", async () => {
    w.put(memoryFile(), BASE);
    const p = consolidation([
      add("dono", 4),
      add("nota", 5, "Facts", "notes/cliente.md#Contrato"),
      add("ferramenta", 9),
      add("agente", 5),
      add("sem linha"),
      add("memória", 5, "Facts", "MEMORY.md"),
      { ...add("declarada", 5), trust: "usuario" },
    ]);
    const ops = (await read(p.id)).body.ops as Json[];
    expect(ops.map((o) => o.trust)).toEqual([
      "usuario",
      "usuario",
      "ferramenta",
      "inferido",
      "inferido",
      "inferido",
      "inferido",
    ]);
    expect(ops.map((o) => o.state)).toEqual(Array(7).fill("valid"));
  });
});

describe("C53 the diff and the base version", () => {
  it("C53 a consolidation's diff is unifiedDiff(current, current with its valid ops) and baseVersion the version read; a memory_edit's diff reaches the run's bytes; a note_save's the proposed content; an unknown id is 404", async () => {
    w.put(memoryFile(), BASE);
    const p = consolidation([
      add("C53 nova decisão", 4),
      add("C53 inválida", 1, "Decisions", "notes/nao.md"),
    ]);
    const expected = BASE.replace(
      "- Turmas de 15\n",
      `- Turmas de 15\n${agentLine("C53 nova decisão", journalRel, 4)}\n`,
    );
    const shown = await read(p.id);
    expect(shown.status).toBe(200);
    expect(shown.body.diff).toBe(unifiedDiff(BASE, expected));
    expect(shown.body.baseVersion).toBe(sha(BASE));

    const runBytes = `${BASE}- O agente escreveu isto\n`;
    const edit = storeProposal(
      w.ctx.db,
      {
        kind: "memory_edit",
        author: "run:r-c53",
        runId: "r-c53",
        summary: "edit",
        payload: { path: "MEMORY.md", content: runBytes },
      },
      { capped: false },
    );
    const editShown = await read(edit.id);
    expect(editShown.body.diff).toBe(unifiedDiff(BASE, runBytes));
    expect(editShown.body.baseVersion).toBe(sha(BASE));

    const note = await w.call("POST", "/api/memory/notes", { title: "Nota C53", content: "antes" });
    const before = fs.readFileSync(note.body.path, "utf8");
    const save = await w.call("POST", "/api/memory/proposals", {
      kind: "note_save",
      path: note.body.path,
      content: "# Nota C53\n\ndepois\n",
      baseVersion: note.body.version,
    });
    const saveShown = await read(save.body.proposal.id);
    expect(saveShown.body.diff).toBe(unifiedDiff(before, "# Nota C53\n\ndepois\n"));
    expect(code(await read("mp_0000000000000000"))).toEqual([404, "not_found"]);
  });
});

describe("C57 an op whose line is gone is a conflict", () => {
  it("C57 a supersede (with a trailing space), a close_loop and a move_to_topic naming a line that is not in MEMORY.md carry state conflict, and an accept applies none of them", async () => {
    w.put(memoryFile(), BASE);
    const p = consolidation([
      add("C57 válida", 4),
      { op: "supersede", old: "- Turmas de 15 ", text: "Turmas de 20", source: journalRel, line: 4 },
      { op: "close_loop", old: "- Lançar a turma de abril", on: "2026-10-30", source: journalRel, line: 4 },
      { op: "move_to_topic", lines: ["- Nada disso"], topic: "clientes" },
    ]);
    const ops = (await read(p.id)).body.ops as Json[];
    expect(ops.map((o) => o.state)).toEqual(["valid", "conflict", "conflict", "conflict"]);
    const done = await accept(p.id);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(fs.readFileSync(memoryFile(), "utf8")).toBe(
      BASE.replace("- Turmas de 15\n", `- Turmas de 15\n${agentLine("C57 válida", journalRel, 4)}\n`),
    );
    expect(fs.existsSync(path.join(w.memory, "topics"))).toBe(false);
  });
});

describe("C59 the ceiling through decide", () => {
  /** A MEMORY.md of `lines` lines and `bytes` bytes, its last section `## Decisions`. */
  const sized = (lines: number, bytes: number): string => {
    const head = ["## Decisions", ""];
    const body = Array.from({ length: lines - head.length }, (_, i) => `- d${i}`);
    const text = (rows: string[]) => `${rows.join("\n")}\n`;
    const short = text([...head, ...body]);
    const missing = bytes - Buffer.byteLength(short);
    expect(missing).toBeGreaterThanOrEqual(0);
    body[body.length - 1] = `${body.at(-1)!}${"x".repeat(missing)}`;
    const out = text([...head, ...body]);
    expect([out.split("\n").length - 1, Buffer.byteLength(out)]).toEqual([lines, bytes]);
    return out;
  };
  const lineBytes = (text: string, line = 4) => Buffer.byteLength(agentLine(text, journalRel, line)) + 1;

  it("C59 201 lines and 24 000 bytes over 150 lines is 409 memory_over_budget and writes nothing", async () => {
    const texts = Array.from({ length: 51 }, (_, i) => `C59a ${String(i).padStart(2, "0")}`);
    const added = texts.reduce((n, t) => n + lineBytes(t), 0);
    const current = sized(150, 24_000 - added);
    w.put(memoryFile(), current);
    const p = consolidation(texts.map((t) => add(t, 4)));
    expect(code(await accept(p.id))).toEqual([409, "memory_over_budget"]);
    expect(fs.readFileSync(memoryFile(), "utf8")).toBe(current);
    expect((await read(p.id)).body.status).toBe("pending");
  });

  it("C59 180 lines and 25 001 bytes is 409 memory_over_budget", async () => {
    const current = sized(179, 25_001 - lineBytes("C59b"));
    w.put(memoryFile(), current);
    const p = consolidation([add("C59b", 4)]);
    expect(code(await accept(p.id))).toEqual([409, "memory_over_budget"]);
    expect(fs.readFileSync(memoryFile(), "utf8")).toBe(current);
  });

  it("C59 exactly 200 lines and 25 000 bytes is 200", async () => {
    const current = sized(199, 25_000 - lineBytes("C59c"));
    w.put(memoryFile(), current);
    const p = consolidation([add("C59c", 4)]);
    const done = await accept(p.id);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const text = fs.readFileSync(memoryFile(), "utf8");
    expect([text.split("\n").length - 1, Buffer.byteLength(text)]).toEqual([200, 25_000]);
  });

  it("C59 220 lines over a file of 230 is 200 (smaller than now)", async () => {
    // the eleven lines moved are long, so the result has fewer lines and fewer bytes than the file now
    const head = ["## Decisions", ""];
    const lines = Array.from({ length: 11 }, (_, i) => `- d${i} ${"m".repeat(200)}`);
    const rest = Array.from(
      { length: 230 - head.length - lines.length },
      (_, i) => `- r${i} ${"r".repeat(120)}`,
    );
    const current = `${[...head, ...lines, ...rest].join("\n")}\n`;
    expect([current.split("\n").length - 1, Buffer.byteLength(current) > 25_000]).toEqual([230, true]);
    w.put(memoryFile(), current);
    const p = consolidation([{ op: "move_to_topic", lines, topic: "antigas" }]);
    const done = await accept(p.id);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(fs.readFileSync(memoryFile(), "utf8").split("\n").length - 1).toBe(220);
  });
});

describe("C60 accepting some or all", () => {
  it("C60 ops [0] of two valid is partial, writes only op 0, answers written [{ MEMORY.md, version }] and records a proposal version of the proposal's author with its id; [0, 1] is accepted; [0] of one valid and one invalid is accepted; [5] and an invalid index are 400 and write nothing", async () => {
    w.put(memoryFile(), BASE);
    const p = consolidation([add("C60 a", 4), add("C60 b", 4)]);
    const done = await accept(p.id, { ops: [0] });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.proposal.status).toBe("partial");
    const text = fs.readFileSync(memoryFile(), "utf8");
    expect(text).toContain(agentLine("C60 a", journalRel, 4));
    expect(text).not.toContain("C60 b");
    expect(done.body.written).toEqual([{ path: "MEMORY.md", version: sha(text) }]);
    const history = await w.call("GET", "/api/memory/history?path=MEMORY.md");
    const newest = (history.body.versions as Json[])[0]!;
    expect(newest).toMatchObject({ origin: "proposal", author: p.author, sha256: sha(text) });
    expect(
      (w.ctx.db.prepare("SELECT proposal_id FROM memory_versions WHERE id = ?").get(newest.id) as Json)
        .proposal_id,
    ).toBe(p.id);

    const both = consolidation([add("C60 c", 4), add("C60 d", 4)]);
    expect((await accept(both.id, { ops: [0, 1] })).body.proposal.status).toBe("accepted");

    const mixed = consolidation([add("C60 e", 4), add("C60 f", 1, "Decisions", "notes/nao.md")]);
    expect((await accept(mixed.id, { ops: [0] })).body.proposal.status).toBe("accepted");

    const refused = consolidation([add("C60 g", 4), add("C60 h", 1, "Decisions", "notes/nao.md")]);
    const before = fs.readFileSync(memoryFile(), "utf8");
    expect(code(await accept(refused.id, { ops: [5] }))).toEqual([400, "validation"]);
    expect(code(await accept(refused.id, { ops: [1] }))).toEqual([400, "validation"]);
    expect(fs.readFileSync(memoryFile(), "utf8")).toBe(before);
    expect((await read(refused.id)).body.status).toBe("pending");
  });
});

describe("C61 an accepted fact op keeps its provenance", () => {
  it("C61 the fact reads back with sourcePath, sourceLine 4, author run:<runId>, the op's trust and proposalId, and is in the answer's facts", async () => {
    const p = consolidation([
      { op: "fact", subject: "Turma C61", predicate: "tamanho", object: "20", source: journalRel, line: 4 },
    ]);
    const trust = ((await read(p.id)).body.ops as Json[])[0]!.trust;
    expect(trust).toBe("usuario");
    const done = await accept(p.id);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const listed = await w.call("GET", "/api/memory/facts?subject=turma%20c61");
    const fact = (listed.body.facts as Json[])[0]!;
    expect(fact).toMatchObject({
      sourcePath: path.join(w.memory, "journal", `${DAY}.md`),
      sourceLine: 4,
      author: p.author,
      trust,
      proposalId: p.id,
    });
    expect(p.author).toBe(`run:${p.runId}`);
    expect((done.body.facts as Json[]).map((f) => f.id)).toEqual([fact.id]);
  });
});

describe("C62 a decision over a changed MEMORY.md", () => {
  it("C62 a baseVersion other than the file's is 409 edit_conflict: the bytes and mtime unchanged, no fact asserted, the proposal pending", async () => {
    w.put(memoryFile(), BASE);
    const p = consolidation([
      add("C62 a", 4),
      { op: "fact", subject: "C62", predicate: "p", object: "o", source: journalRel, line: 4 },
    ]);
    const mtime = fs.statSync(memoryFile()).mtimeMs;
    const before = facts();
    const res = await decide(p.id, { action: "accept", baseVersion: sha("outra coisa") });
    expect(code(res)).toEqual([409, "edit_conflict"]);
    expect(fs.readFileSync(memoryFile(), "utf8")).toBe(BASE);
    expect(fs.statSync(memoryFile()).mtimeMs).toBe(mtime);
    expect(facts()).toBe(before);
    expect((await read(p.id)).body.status).toBe("pending");
  });
});

describe("C63 a file that cannot be written", () => {
  it("C63 a topic that cannot be written is 500 internal: no fact, no version, MEMORY.md put back, pending; once the obstacle is gone the same decision is 200 and writes both files and the fact", async () => {
    w.put(memoryFile(), BASE);
    w.put(path.join(w.memory, "topics"), "não sou uma pasta\n");
    const p = consolidation([
      add("C63 a", 4),
      { op: "move_to_topic", lines: ["- Turmas de 15"], topic: "turmas" },
      { op: "fact", subject: "C63", predicate: "p", object: "o", source: journalRel, line: 4 },
    ]);
    const body = { action: "accept", baseVersion: sha(BASE) };
    const factsBefore = facts();
    const versionsBefore = versions().length;
    const failed = await decide(p.id, body);
    expect(code(failed)).toEqual([500, "internal"]);
    expect(facts()).toBe(factsBefore);
    expect(versions().length).toBe(versionsBefore);
    expect(fs.readFileSync(memoryFile(), "utf8")).toBe(BASE);
    expect((await read(p.id)).body.status).toBe("pending");

    fs.rmSync(path.join(w.memory, "topics"));
    const done = await decide(p.id, body);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(fs.readFileSync(memoryFile(), "utf8")).toContain(agentLine("C63 a", journalRel, 4));
    expect(fs.readFileSync(path.join(w.memory, "topics", "turmas.md"), "utf8")).toContain("- Turmas de 15");
    expect(facts()).toBe(factsBefore + 1);
    expect((done.body.written as Json[]).map((x) => x.path).sort()).toEqual([
      "MEMORY.md",
      "topics/turmas.md",
    ]);
  });
});

describe("C64 reject", () => {
  it("C64 reject answers 200 with status rejected and decidedAt now; memory/, facts and memory_versions are as before", async () => {
    w.put(memoryFile(), BASE);
    const p = consolidation([
      add("C64", 4),
      { op: "fact", subject: "C64", predicate: "p", object: "o", source: journalRel, line: 4 },
    ]);
    // the index passes earlier decisions asked for are done before the state is read (on the real clock)
    await w.index();
    const files = listing();
    const factRows = w.ctx.db.prepare("SELECT * FROM facts ORDER BY id").all();
    const versionRows = versions();
    // "now" on the real clock (a frozen Date would hang an index pass): the instant between the call and its answer
    const before = Date.now();
    const res = await decide(p.id, { action: "reject" });
    const after = Date.now();
    expect(res.status).toBe(200);
    expect(res.body.proposal.status).toBe("rejected");
    expect(res.body.proposal.decidedAt).toBeGreaterThanOrEqual(before);
    expect(res.body.proposal.decidedAt).toBeLessThanOrEqual(after);
    expect(res.body.written).toEqual([]);
    expect(res.body.facts).toEqual([]);
    expect(listing()).toEqual(files);
    expect(w.ctx.db.prepare("SELECT * FROM facts ORDER BY id").all()).toEqual(factRows);
    expect(versions()).toEqual(versionRows);
  });
});

describe("C65 a decided proposal", () => {
  it("C65 accepted, partial, rejected and superseded are each 409 proposal_decided and change nothing; an unknown id is 404", async () => {
    w.put(memoryFile(), BASE);
    const fact = (
      await w.call("POST", "/api/memory/proposals", {
        kind: "fact",
        subject: "C65",
        predicate: "p",
        object: "o",
      })
    ).body.proposal.id as string;
    expect((await decide(fact, { action: "accept" })).body.proposal.status).toBe("accepted");
    const partial = consolidation([add("C65 a", 4), add("C65 b", 4)]).id;
    expect((await accept(partial, { ops: [0] })).body.proposal.status).toBe("partial");
    const rejected = consolidation([add("C65 c", 4)]).id;
    expect((await decide(rejected, { action: "reject" })).body.proposal.status).toBe("rejected");
    const superseded = consolidation([add("C65 d", 4)]).id;
    consolidation([add("C65 e", 4)]);
    expect((await read(superseded)).body.status).toBe("superseded");
    const text = fs.readFileSync(memoryFile(), "utf8");
    const factCount = facts();
    for (const [id, status] of [
      [fact, "accepted"],
      [partial, "partial"],
      [rejected, "rejected"],
      [superseded, "superseded"],
    ] as const) {
      const res = await decide(id, { action: "accept", baseVersion: sha(text) });
      expect(code(res), status).toEqual([409, "proposal_decided"]);
      expect(code(await decide(id, { action: "reject" })), status).toEqual([409, "proposal_decided"]);
      expect((await read(id)).body.status).toBe(status);
    }
    expect(fs.readFileSync(memoryFile(), "utf8")).toBe(text);
    expect(facts()).toBe(factCount);
    expect(code(await decide("mp_ffffffffffffffff", { action: "reject" }))).toEqual([404, "not_found"]);
  });
});

describe("C66 accepting a note's new text", () => {
  it("C66 saves through the guarded replace with the proposal's baseVersion and records a proposal version; a note changed since is 409 edit_conflict and pending; past the size limit is 413 note_too_large and pending", async () => {
    const note = await w.call("POST", "/api/memory/notes", { title: "Nota C66", content: "antes" });
    const rel = path.relative(w.memory, note.body.path).split(path.sep).join("/");
    const propose = async (content: string, baseVersion: string) =>
      (
        await w.call("POST", "/api/memory/proposals", {
          kind: "note_save",
          path: note.body.path,
          content,
          baseVersion,
        })
      ).body.proposal.id as string;
    const ok = await propose("# Nota C66\n\ndepois\n", note.body.version);
    const done = await decide(ok, { action: "accept" });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(fs.readFileSync(note.body.path, "utf8")).toBe("# Nota C66\n\ndepois\n");
    expect(done.body.written).toEqual([{ path: rel, version: sha("# Nota C66\n\ndepois\n") }]);
    const newest = ((await w.call("GET", `/api/memory/history?path=${rel}`)).body.versions as Json[])[0]!;
    expect(newest).toMatchObject({ origin: "proposal", author: "mcp" });

    const stale = await propose("# Nota C66\n\nperdida\n", sha("# Nota C66\n\ndepois\n"));
    const saved = await w.call("PUT", "/api/memory/notes", {
      path: note.body.path,
      content: "# Nota C66\n\ndo dono\n",
      baseVersion: sha("# Nota C66\n\ndepois\n"),
    });
    expect(saved.status).toBe(200);
    expect(code(await decide(stale, { action: "accept" }))).toEqual([409, "edit_conflict"]);
    expect(fs.readFileSync(note.body.path, "utf8")).toBe("# Nota C66\n\ndo dono\n");
    expect((await read(stale)).body.status).toBe("pending");

    const big = await propose("x".repeat(1024 * 1024 + 1), sha("# Nota C66\n\ndo dono\n"));
    expect(code(await decide(big, { action: "accept" }))).toEqual([413, "note_too_large"]);
    expect(fs.readFileSync(note.body.path, "utf8")).toBe("# Nota C66\n\ndo dono\n");
    expect((await read(big)).body.status).toBe("pending");
  });
});

describe("C67 accepting a new note", () => {
  it("C67 creates the note at the path and with the bytes POST /api/memory/notes gives on a twin home, and records a proposal version by mcp", async () => {
    const twin = await memoriaWorld("mordomo-memoria-proposals-twin-");
    try {
      const area = w.ctx.settings().areas[0]!;
      expect(twin.ctx.settings().areas[0]).toBe(area);
      const body = { title: "Nota C67", area, content: "o corpo" };
      const made = await twin.call("POST", "/api/memory/notes", body);
      expect(made.status).toBe(201);
      const id = (await w.call("POST", "/api/memory/proposals", { kind: "note_create", ...body })).body
        .proposal.id;
      const done = await decide(id, { action: "accept" });
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      const rel = (done.body.written as Json[])[0]!.path as string;
      const file = path.join(w.memory, ...rel.split("/"));
      expect({ path: rel, bytes: fs.readFileSync(file, "utf8") }).toEqual({
        path: path.relative(twin.memory, made.body.path).split(path.sep).join("/"),
        bytes: fs.readFileSync(made.body.path, "utf8"),
      });
      const newest = ((await w.call("GET", `/api/memory/history?path=${rel}`)).body.versions as Json[])[0]!;
      expect(newest).toMatchObject({ origin: "proposal", author: "mcp" });
    } finally {
      await twin.close();
    }
  });
});

describe("C68 who may store, read and decide", () => {
  it("C68 a device with every scope is 403 owner_only on the two writes; content reads both, monitor alone is 403 scope_required; a write run's credential is 403 forbidden on all four", async () => {
    w.put(memoryFile(), BASE);
    const p = consolidation([add("C68", 4)]);
    const all = w.device(["content", "monitor", "run", "approve"]);
    const before = listing();
    expect(
      code(
        await w.call(
          "POST",
          "/api/memory/proposals",
          { kind: "fact", subject: "s", predicate: "p", object: "o" },
          all,
        ),
      ),
    ).toEqual([403, "owner_only"]);
    expect(
      code(
        await w.call(
          "POST",
          `/api/memory/proposals/${p.id}/decide`,
          { action: "accept", baseVersion: sha(BASE) },
          all,
        ),
      ),
    ).toEqual([403, "owner_only"]);
    expect(listing()).toEqual(before);
    expect(pending()).toBe(1);
    const content = w.device(["content"]);
    expect((await w.call("GET", "/api/memory/proposals", undefined, content)).status).toBe(200);
    expect((await w.call("GET", `/api/memory/proposals/${p.id}`, undefined, content)).status).toBe(200);
    const monitor = w.device(["monitor"]);
    expect(code(await w.call("GET", "/api/memory/proposals", undefined, monitor))).toEqual([
      403,
      "scope_required",
    ]);
    expect(code(await w.call("GET", `/api/memory/proposals/${p.id}`, undefined, monitor))).toEqual([
      403,
      "scope_required",
    ]);
    const run = w.run("write");
    for (const [method, url, body] of [
      ["GET", "/api/memory/proposals", undefined],
      ["GET", `/api/memory/proposals/${p.id}`, undefined],
      ["POST", "/api/memory/proposals", { kind: "fact", subject: "s", predicate: "p", object: "o" }],
      ["POST", `/api/memory/proposals/${p.id}/decide`, { action: "reject" }],
    ] as const) {
      expect(code(await w.call(method, url, body, run.headers)), `${method} ${url}`).toEqual([
        403,
        "forbidden",
      ]);
    }
    expect(pending()).toBe(1);
    expect(listing()).toEqual(before);
  });
});

describe("C148 the payload and the result a proposal stores", () => {
  it("C148 read back through GET /api/memory/proposals/:id: each kind's payload, and the result of an accept and of a reject", async () => {
    w.put(memoryFile(), BASE);
    const run = w.run("write");
    const fact = await w.call(
      "POST",
      "/api/memory/facts",
      {
        subject: "C148",
        predicate: "p",
        object: "o",
        sourcePath: path.join(w.memory, journalRel),
        sourceLine: 4,
      },
      run.headers,
    );
    const mcpFact = await w.call("POST", "/api/memory/proposals", {
      kind: "fact",
      subject: "C148 mcp",
      predicate: "p",
      object: "o",
    });
    const note = await w.call("POST", "/api/memory/notes", { title: "Nota C148", content: "um" });
    const create = await w.call("POST", "/api/memory/proposals", {
      kind: "note_create",
      title: "Nota nova C148",
      content: "x",
      tags: ["ab"],
    });
    const save = await w.call("POST", "/api/memory/proposals", {
      kind: "note_save",
      path: note.body.path,
      content: "dois",
      baseVersion: note.body.version,
    });
    const ops = [add("C148 a", 4), add("C148 b", 4)];
    const cons = consolidation(ops, "Resumo C148");
    const payload = async (id: string) => (await read(id)).body.payload as Json;
    expect(await payload(fact.body.proposal.id)).toEqual({
      subject: "C148",
      predicate: "p",
      object: "o",
      sourcePath: path.join(w.memory, journalRel),
      sourceLine: 4,
      sourceRunId: run.runId,
    });
    expect(await payload(mcpFact.body.proposal.id)).toEqual({
      subject: "C148 mcp",
      predicate: "p",
      object: "o",
    });
    expect(await payload(create.body.proposal.id)).toEqual({
      title: "Nota nova C148",
      content: "x",
      tags: ["ab"],
    });
    expect(await payload(save.body.proposal.id)).toEqual({
      path: note.body.path,
      content: "dois",
      baseVersion: note.body.version,
    });
    expect(await payload(cons.id)).toEqual({ v: 1, summary: "Resumo C148", ops });
    // the guard's memory_edit: a write run that changed MEMORY.md
    const writer = w.ctx.runs.create({
      origin: "manual",
      provider: "claude",
      prompt: "c148",
      cwd: w.home,
      model: null,
      effort: "default",
      mode: "write",
      timeoutMs: 60_000,
      profile: "controlled_write",
      request: { version: 1, kind: "prompt", prompt: "c148", mode: "write" },
      startedBy: null,
    });
    w.ctx.events.emit("run.started", { runId: writer.id, pid: null });
    fs.appendFileSync(memoryFile(), "- Da execução C148\n");
    w.ctx.events.emit("run.finished", { runId: writer.id, status: "done", durationMs: 1 });
    const edit = (w.ctx.db.prepare("SELECT id FROM memory_proposals WHERE run_id = ?").get(writer.id) as Json)
      .id;
    expect(await payload(edit)).toEqual({ path: "MEMORY.md", content: `${BASE}- Da execução C148\n` });
    expect(fs.readFileSync(memoryFile(), "utf8")).toBe(BASE);

    const done = await accept(cons.id, { ops: [0] });
    const after = fs.readFileSync(memoryFile(), "utf8");
    expect((await read(cons.id)).body.result).toEqual({
      action: "accept",
      ops: [0],
      written: [{ path: "MEMORY.md", version: sha(after) }],
      facts: [],
    });
    expect(done.body.proposal.result).toEqual((await read(cons.id)).body.result);
    expect((await decide(mcpFact.body.proposal.id, { action: "reject" })).status).toBe(200);
    expect((await read(mcpFact.body.proposal.id)).body.result).toEqual({ action: "reject" });
    expect((await read(create.body.proposal.id)).body.result).toBeNull();
  });
});
