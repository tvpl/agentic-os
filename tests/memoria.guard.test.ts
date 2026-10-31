import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { storeProposal } from "../core/src/memory/proposals.js";
import { unifiedDiff } from "../core/src/sync/diff.js";
import { runWorld, sha, type Json, type RunWorld } from "./helpers/memoriaWorld.js";

/**
 * cerebro-memoria-confiavel S3, the guard of MEMORY.md (C69-C71, door 8): write runs of the fake Claude CLI that change
 * `memory/MEMORY.md` once they have started (after `run.started`), read back through the file, the history (`GET
 * /api/memory/history`) and the review inbox (`GET /api/memory/proposals`). Real clock (index passes run here).
 */

let w: RunWorld;
beforeAll(async () => {
  w = await runWorld("mordomo-memoria-guard-");
}, 60_000);
afterAll(async () => {
  await w.close();
});

const START = "# Long-term memory\n\n## Decisions\n\n- Turmas de 15\n";
const memoryFile = () => path.join(w.memory, "MEMORY.md");
const edits = () =>
  w.ctx.db
    .prepare("SELECT * FROM memory_proposals WHERE kind = 'memory_edit' ORDER BY rowid")
    .all() as Json[];
const maxVersion = () =>
  (w.ctx.db.prepare("SELECT COALESCE(MAX(id), 0) m FROM memory_versions").get() as Json).m as number;
/** The versions of MEMORY.md recorded after `since`, oldest first, through the history route. */
const versionsSince = async (since: number): Promise<Json[]> => {
  const res = await w.call("GET", "/api/memory/history?path=MEMORY.md&limit=100");
  expect(res.status).toBe(200);
  return (res.body.versions as Json[]).filter((v) => v.id > since).reverse();
};
const append = (line: string) => () => {
  fs.appendFileSync(memoryFile(), `${line}\n`);
};

beforeEach(async () => {
  w.during(null);
  w.ctx.db.prepare("DELETE FROM memory_proposals").run();
  fs.rmSync(path.join(w.memory, "archive"), { recursive: true, force: true });
  w.put(memoryFile(), START);
  // the start state has its version (the index pass's), so run.started records none
  await w.index();
});

describe("C69 a write run's change to MEMORY.md is put back and proposed", () => {
  it("C69 the file has its start bytes again, a pending memory_edit of run:<id> reaches the run's bytes, and two guard versions by system: the run's bytes, then the start bytes", async () => {
    const mark = maxVersion();
    w.during(append("- O agente acrescentou isto"));
    const run = await w.prompt("write");
    expect(run.status).toBe("done");
    const runBytes = `${START}- O agente acrescentou isto\n`;
    expect(fs.readFileSync(memoryFile(), "utf8")).toBe(START);
    const proposals = edits();
    expect(proposals.map((p) => [p.status, p.author, p.run_id])).toEqual([
      ["pending", `run:${run.id}`, run.id],
    ]);
    const shown = await w.call("GET", `/api/memory/proposals/${proposals[0]!.id}`);
    expect(shown.body.diff).toBe(unifiedDiff(START, runBytes));
    const guard = (await versionsSince(mark)).filter((v) => v.origin === "guard");
    expect(guard.map((v) => [v.author, v.sha256])).toEqual([
      ["system", sha(runBytes)],
      ["system", sha(START)],
    ]);
  });

  it("C69 a write run that creates MEMORY.md where none was leaves none, its file at memory/archive/guard-<runId>-MEMORY.md, and the proposal", async () => {
    fs.rmSync(memoryFile());
    await w.index();
    w.during(() => {
      fs.writeFileSync(memoryFile(), "- Criado pelo agente\n");
    });
    const run = await w.prompt("write");
    expect(fs.existsSync(memoryFile())).toBe(false);
    expect(fs.readFileSync(path.join(w.memory, "archive", `guard-${run.id}-MEMORY.md`), "utf8")).toBe(
      "- Criado pelo agente\n",
    );
    expect(edits().map((p) => [p.author, JSON.parse(p.payload).content])).toEqual([
      [`run:${run.id}`, "- Criado pelo agente\n"],
    ]);
  });

  it("C69 a run that changes memory/notes/MEMORY.md and a read-only run that changes MEMORY.md trigger no guard", async () => {
    const lookAlike = w.put(path.join(w.memory, "notes", "MEMORY.md"), "# Uma nota\n");
    w.during(() => {
      fs.appendFileSync(lookAlike, "- mudou\n");
    });
    await w.prompt("write");
    expect(fs.readFileSync(lookAlike, "utf8")).toBe("# Uma nota\n- mudou\n");
    expect(fs.readFileSync(memoryFile(), "utf8")).toBe(START);
    w.during(append("- Uma execução de leitura escreveu"));
    await w.prompt("read_only");
    expect(fs.readFileSync(memoryFile(), "utf8")).toBe(`${START}- Uma execução de leitura escreveu\n`);
    expect(edits()).toEqual([]);
  });
});

describe("C70 the owner's own write during the run", () => {
  it("C70 the owner saves MEMORY.md through PUT /api/memory/notes while the run is held open, then the run changes it too: the run's bytes stay and no proposal is stored", async () => {
    w.during(async () => {
      const saved = await w.call("PUT", "/api/memory/notes", {
        path: memoryFile(),
        content: `${START}- Do dono\n`,
        baseVersion: sha(START),
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      fs.appendFileSync(memoryFile(), "- Da execução\n");
    });
    await w.prompt("write");
    expect(fs.readFileSync(memoryFile(), "utf8")).toBe(`${START}- Do dono\n- Da execução\n`);
    expect(edits()).toEqual([]);
  });

  it("C70 accepting a proposal during the run is not an owner version: the file is put back and the run's bytes proposed", async () => {
    w.put(path.join(w.memory, "journal", "2026-10-30.md"), "# 2026-10-30\n## Decisions\n\n- Turmas de 20\n");
    const p = storeProposal(
      w.ctx.db,
      {
        kind: "consolidation",
        author: "run:r-c70",
        runId: "r-c70",
        summary: "s",
        payload: {
          v: 1,
          summary: "s",
          ops: [
            { op: "add", section: "Decisions", text: "Aceita", source: "journal/2026-10-30.md", line: 4 },
          ],
        },
      },
      { capped: false },
    );
    w.during(async () => {
      const done = await w.call("POST", `/api/memory/proposals/${p.id}/decide`, {
        action: "accept",
        baseVersion: sha(START),
      });
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      fs.appendFileSync(memoryFile(), "- Da execução\n");
    });
    const run = await w.prompt("write");
    expect(fs.readFileSync(memoryFile(), "utf8")).toBe(START);
    expect(edits().map((e) => e.run_id)).toEqual([run.id]);
  });

  it("C70 at run.started a guard version is recorded only when the file differs from its newest version", async () => {
    let mark = maxVersion();
    await w.prompt("write");
    expect((await versionsSince(mark)).filter((v) => v.origin === "guard")).toEqual([]);
    fs.writeFileSync(memoryFile(), `${START}- Mudou fora\n`);
    mark = maxVersion();
    await w.prompt("write");
    const guard = (await versionsSince(mark)).filter((v) => v.origin === "guard");
    expect(guard.map((v) => [v.author, v.sha256])).toEqual([["system", sha(`${START}- Mudou fora\n`)]]);
    expect(edits()).toEqual([]);
  });
});

describe("C71 the file changed again after the run", () => {
  it("C71 the put-back's expectSha256 no longer matches: the file stays as it is, the memory_edit is stored with the run's bytes and one guard version of them; a second write run is guarded as in C69", async () => {
    const mark = maxVersion();
    const putBack = w.ctx.memoryGuard.putBack.bind(w.ctx.memoryGuard);
    const spy = vi.spyOn(w.ctx.memoryGuard, "putBack").mockImplementation((start, runBytes) => {
      fs.appendFileSync(memoryFile(), "- Outra mudança\n");
      putBack(start, runBytes);
    });
    const runBytes = `${START}- Da execução\n`;
    try {
      w.during(append("- Da execução"));
      const run = await w.prompt("write");
      expect(fs.readFileSync(memoryFile(), "utf8")).toBe(`${runBytes}- Outra mudança\n`);
      expect(edits().map((e) => [e.run_id, JSON.parse(e.payload).content])).toEqual([[run.id, runBytes]]);
      const guard = (await versionsSince(mark)).filter((v) => v.origin === "guard");
      expect(guard.map((v) => v.sha256)).toEqual([sha(runBytes)]);
    } finally {
      spy.mockRestore();
    }

    const now = fs.readFileSync(memoryFile(), "utf8");
    await w.index();
    w.during(append("- Segunda execução"));
    const second = await w.prompt("write");
    expect(fs.readFileSync(memoryFile(), "utf8")).toBe(now);
    expect(edits().map((e) => e.run_id)).toContain(second.id);
  });
});
