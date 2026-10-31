import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { storeProposal } from "../core/src/memory/proposals.js";
import { runWorld, type Json, type RunWorld } from "./helpers/memoriaWorld.js";

/**
 * cerebro-memoria-confiavel S3, the consolidation's proposal (C48-C50, door 6): runs of `consolidate-memory` through the
 * fake Claude CLI, each leaving an `artifacts/<runId>/proposal.json`; what the hook stored is read back through `GET
 * /api/memory/proposals` and `GET /api/memory/proposals/:id`, and what it refused through the inbox.
 */

let w: RunWorld;
beforeAll(async () => {
  w = await runWorld("mordomo-memoria-consolidation-");
  w.put(
    path.join(w.memory, "journal", "2026-10-30.md"),
    "# 2026-10-30\n## Decisions\n\n- Turmas de 20 alunos\n",
  );
}, 60_000);
afterAll(async () => {
  await w.close();
});
beforeEach(() => {
  w.ctx.db.prepare("DELETE FROM memory_proposals").run();
  w.leave(null);
  w.failing(false);
});

const op = (text: string): Json => ({
  op: "add",
  section: "Decisions",
  text,
  source: "journal/2026-10-30.md",
  line: 4,
});
const file = (ops: Json[], summary = "Uma consolidação"): Json => ({ v: 1, summary, ops });
const stored = () => w.ctx.db.prepare("SELECT * FROM memory_proposals ORDER BY rowid").all() as Json[];
const notices = () =>
  w.ctx.notifications.list({ limit: 500 }).filter((n) => n.messageKey === "proposals.invalidNotice");
/** A JSON text of exactly `bytes` bytes holding `value` (white space added at the end). */
const exactly = (value: Json, bytes: number): string => {
  const text = JSON.stringify(value);
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(bytes);
  return text + " ".repeat(bytes - Buffer.byteLength(text));
};

const consolidate = async (content: unknown) => {
  w.leave(content);
  const run = await w.skill("consolidate-memory");
  return run;
};

describe("C48 a valid proposal.json is one pending consolidation", () => {
  it("C48 a run that finishes done stores exactly one pending consolidation with its runId, its summary and its ops", async () => {
    const ops = [
      op("Turmas de 20 alunos"),
      {
        op: "supersede",
        old: "- Turmas de 15",
        text: "Turmas de 20",
        source: "journal/2026-10-30.md",
        line: 4,
      },
      { op: "close_loop", old: "- Lançar a turma", on: "2026-10-30", source: "journal/2026-10-30.md" },
      { op: "move_to_topic", lines: ["- Cliente A"], topic: "clientes" },
      {
        op: "fact",
        subject: "turma",
        predicate: "tamanho",
        object: "20",
        source: "journal/2026-10-30.md#Decisions",
        line: 4,
      },
    ];
    const run = await consolidate(file(ops, "Cinco operações"));
    expect(run.status).toBe("done");
    const listed = await w.call("GET", "/api/memory/proposals?status=pending");
    expect(listed.body.items).toHaveLength(1);
    const item = (listed.body.items as Json[])[0]!;
    expect(item).toMatchObject({
      kind: "consolidation",
      status: "pending",
      runId: run.id,
      author: `run:${run.id}`,
      summary: "Cinco operações",
      opCount: 5,
    });
    const shown = await w.call("GET", `/api/memory/proposals/${item.id}`);
    expect(shown.body.payload).toEqual({ v: 1, summary: "Cinco operações", ops });
    expect(notices()).toEqual([]);
  });

  it("C48 the accepted edges each store one: 262 144 bytes, 200 ops, a summary of 2 000 characters, a text of 500, one op", async () => {
    const cases: Array<[string, unknown]> = [
      ["262 144 bytes", exactly(file([op("no limite")]), 262_144)],
      ["200 ops", file(Array.from({ length: 200 }, (_, i) => op(`op ${i}`)))],
      ["a summary of 2 000", file([op("s")], "s".repeat(2000))],
      ["a text of 500", file([op("t".repeat(500))])],
      ["one op", file([op("só uma")])],
    ];
    for (const [what, content] of cases) {
      w.ctx.db.prepare("DELETE FROM memory_proposals").run();
      const run = await consolidate(content);
      expect(run.status, what).toBe("done");
      const rows = stored();
      expect(
        rows.map((r) => [r.kind, r.status, r.run_id]),
        what,
      ).toEqual([["consolidation", "pending", run.id]]);
    }
    expect(notices()).toEqual([]);
  });
});

describe("C49 an invalid proposal.json stores nothing and says why", () => {
  const valid = () => file([op("válida")]);
  it("C49 each invalid file, refused for its own reason alone, stores no proposal and adds exactly one inbox row whose body names the reason", async () => {
    const cases: Array<[string, unknown, RegExp]> = [
      ["missing", null, /missing/],
      ["262 145 bytes", exactly(valid(), 262_145), /256 KiB/],
      ["not JSON", "{ isto não é json", /JSON/],
      ["v: 2", { ...valid(), v: 2 }, /\bv\b/],
      ["op rename", file([{ ...op("x"), op: "rename" }]), /ops\.0\.op/],
      ["section Notes", file([{ ...op("x"), section: "Notes" }]), /ops\.0\.section/],
      ["text of 501", file([op("t".repeat(501))]), /ops\.0\.text/],
      ["summary of 2 001", file([op("x")], "s".repeat(2001)), /summary/],
      ["absolute source", file([{ ...op("x"), source: "/etc/passwd" }]), /ops\.0\.source/],
      [
        "on not a day",
        file([{ op: "close_loop", old: "- x", on: "31/10/2026", source: "journal/2026-10-30.md" }]),
        /ops\.0\.on/,
      ],
      ["201 ops", file(Array.from({ length: 201 }, (_, i) => op(`op ${i}`))), /200/],
    ];
    for (const [what, content, reason] of cases) {
      const before = notices().length;
      const run = await consolidate(content);
      expect(run.status, what).toBe("done");
      expect(stored(), what).toEqual([]);
      const added = notices().slice(0, notices().length - before);
      expect(added, what).toHaveLength(1);
      expect(added[0]!.title, what).toBe("A consolidação não deixou uma proposta válida");
      expect(added[0]!.body ?? "", what).toMatch(reason);
      expect(added[0]!.kind, what).toBe("system");
    }
  });

  it("C49 a run that ends failed, and a run of another skill that leaves a proposal.json, store no proposal and add no such row", async () => {
    const before = notices().length;
    w.failing(true);
    const failed = await consolidate(valid());
    expect(failed.status).toBe("failed");
    w.failing(false);
    w.leave(valid());
    const other = await w.skill("recall", { question: "turmas" });
    expect(other.status).toBe("done");
    expect(fs.existsSync(path.join(w.ctx.paths.artifacts, other.id, "proposal.json"))).toBe(true);
    expect(stored()).toEqual([]);
    expect(notices()).toHaveLength(before);
  });
});

describe("C50 a new consolidation supersedes the pending ones", () => {
  it("C50 both older pending consolidations become superseded; an accepted consolidation, a pending fact and a pending memory_edit stay as they were", async () => {
    const make = (kind: "consolidation" | "fact" | "memory_edit", summary: string) =>
      storeProposal(
        w.ctx.db,
        {
          kind,
          author: "run:r-c50",
          runId: "r-c50",
          summary,
          payload: kind === "consolidation" ? file([op(summary)], summary) : { content: summary },
        },
        { capped: false },
      ).id;
    const accepted = make("consolidation", "aceita");
    w.ctx.db
      .prepare("UPDATE memory_proposals SET status = 'accepted', decided_at = 1 WHERE id = ?")
      .run(accepted);
    const older = make("consolidation", "mais velha");
    const old = make("consolidation", "velha");
    const fact = make("fact", "um fato");
    const edit = make("memory_edit", "uma edição");
    const run = await consolidate(file([op("nova")], "nova"));
    expect(run.status).toBe("done");
    const status = (id: string) =>
      (w.ctx.db.prepare("SELECT status FROM memory_proposals WHERE id = ?").get(id) as Json).status;
    expect([older, old].map(status)).toEqual(["superseded", "superseded"]);
    expect([accepted, fact, edit].map(status)).toEqual(["accepted", "pending", "pending"]);
    const fresh = w.ctx.db
      .prepare("SELECT status FROM memory_proposals WHERE run_id = ?")
      .all(run.id) as Json[];
    expect(fresh).toEqual([{ status: "pending" }]);
  });
});
