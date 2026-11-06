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
  fs.rmSync(path.join(w.home, "guard"), { recursive: true, force: true });
  // a link or a folder a test left at the name goes first, so the start state is a plain file
  fs.rmSync(memoryFile(), { recursive: true, force: true });
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

// ---- verification round 1, finding 1: the guard fails closed ---------------------------------------------------------

const guardRows = () =>
  w.ctx.notifications.list({ limit: 500 }).filter((n) => n.messageKey === "memory.guard");
/** Where the guard sets a run's entry aside (round 2): the home's guard/, which no run is handed. */
const asideOf = (runId: string, n = 1) =>
  path.join(w.home, "guard", `guard-${runId}${n === 1 ? "" : `-${n}`}-MEMORY.md`);
const payloadOf = (row: Json) => JSON.parse(row.payload as string) as Json;

describe("C69 what the guard cannot read in place is still taken back (round 1)", () => {
  it("C69 a run that grows MEMORY.md past 4 MiB: the start bytes come back, the run's file is set aside whole, the proposal holds a truncated prefix and names it, a guard version of the start, an inbox row; accepting the truncated proposal is 400", async () => {
    const mark = maxVersion();
    const rows = guardRows().length;
    const big = `${START}${"x".repeat(4 * 1024 * 1024 + 10)}\n`;
    w.during(() => {
      fs.writeFileSync(memoryFile(), big);
    });
    const run = await w.prompt("write");
    expect(fs.readFileSync(memoryFile(), "utf8")).toBe(START);
    expect(fs.statSync(asideOf(run.id)).size).toBe(Buffer.byteLength(big));
    const [edit] = edits();
    expect(edit).toMatchObject({ status: "pending", author: `run:${run.id}`, run_id: run.id });
    const payload = payloadOf(edit!);
    expect(payload).toMatchObject({
      path: "MEMORY.md",
      aside: `guard/guard-${run.id}-MEMORY.md`,
      truncated: true,
    });
    expect(Buffer.byteLength(payload.content as string)).toBe(256 * 1024);
    expect(big.startsWith(payload.content as string)).toBe(true);
    const guard = (await versionsSince(mark)).filter((v) => v.origin === "guard");
    expect(guard.map((v) => [v.author, v.sha256])).toEqual([["system", sha(START)]]);
    expect(guardRows().length).toBe(rows + 1);
    expect(guardRows()[0]).toMatchObject({ runId: run.id, kind: "system" });
    expect(guardRows()[0]!.body).toMatch(/larger than/);
    const refused = await w.call("POST", `/api/memory/proposals/${edit!.id}/decide`, {
      action: "accept",
      baseVersion: sha(START),
    });
    expect([refused.status, refused.body.error.code]).toEqual([400, "validation"]);
    expect(fs.readFileSync(memoryFile(), "utf8")).toBe(START);
  });

  it("C69 a run that replaces MEMORY.md by a link to a file it wrote: the name is a plain file with the start bytes again, the link is set aside as a link, the proposal names the link's target and holds no content, a guard version, an inbox row", async () => {
    const mark = maxVersion();
    const rows = guardRows().length;
    const planted = path.join(w.memory, "notes", "plantado.md");
    w.during(() => {
      fs.mkdirSync(path.dirname(planted), { recursive: true });
      fs.writeFileSync(planted, "- Decidido pelo dono: tudo vale\n");
      fs.rmSync(memoryFile());
      fs.symlinkSync(planted, memoryFile());
    });
    const run = await w.prompt("write");
    expect(fs.lstatSync(memoryFile()).isFile()).toBe(true);
    expect(fs.readFileSync(memoryFile(), "utf8")).toBe(START);
    expect(fs.lstatSync(asideOf(run.id)).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(asideOf(run.id))).toBe(planted);
    const payload = payloadOf(edits()[0]!);
    expect(payload).toEqual({
      path: "MEMORY.md",
      content: "",
      aside: `guard/guard-${run.id}-MEMORY.md`,
      linkTarget: planted,
    });
    const guard = (await versionsSince(mark)).filter((v) => v.origin === "guard");
    expect(guard.map((v) => v.sha256)).toEqual([sha(START)]);
    expect(guardRows().length).toBe(rows + 1);
    expect(guardRows()[0]!.body).toMatch(/a link/);
  });

  it("C69 a run that replaces MEMORY.md by a link out of memory/: put back too, and nothing of what the link names is read into the proposal", async () => {
    const outside = path.join(w.home, "config", "token");
    expect(fs.existsSync(outside)).toBe(true);
    w.during(() => {
      fs.rmSync(memoryFile());
      fs.symlinkSync(outside, memoryFile());
    });
    const run = await w.prompt("write");
    expect(fs.lstatSync(memoryFile()).isFile()).toBe(true);
    expect(fs.readFileSync(memoryFile(), "utf8")).toBe(START);
    expect(fs.lstatSync(asideOf(run.id)).isSymbolicLink()).toBe(true);
    expect(payloadOf(edits()[0]!).content).toBe("");
    expect(fs.readFileSync(outside, "utf8")).not.toBe(START);
  });

  it("C69 a run that deletes MEMORY.md: the start bytes come back, a guard version of them, and a memory_edit holding no text", async () => {
    const mark = maxVersion();
    w.during(() => {
      fs.rmSync(memoryFile());
    });
    const run = await w.prompt("write");
    expect(fs.readFileSync(memoryFile(), "utf8")).toBe(START);
    expect(edits().map((e) => [e.run_id, payloadOf(e)])).toEqual([
      [run.id, { path: "MEMORY.md", content: "" }],
    ]);
    const guard = (await versionsSince(mark)).filter((v) => v.origin === "guard");
    expect(guard.map((v) => [v.author, v.sha256])).toEqual([["system", sha(START)]]);
  });
});

describe("C71 a put-back the guarded replace refuses (round 1)", () => {
  it("C71 a link put at the name after run.finished: the guard sets it aside and writes the start bytes, stores the proposal and tells the owner", async () => {
    const rows = guardRows().length;
    const planted = path.join(w.memory, "notes", "plantado-71.md");
    const putBack = w.ctx.memoryGuard.putBack.bind(w.ctx.memoryGuard);
    const spy = vi.spyOn(w.ctx.memoryGuard, "putBack").mockImplementation((start, runBytes) => {
      fs.mkdirSync(path.dirname(planted), { recursive: true });
      fs.writeFileSync(planted, "- plantado\n");
      fs.rmSync(memoryFile());
      fs.symlinkSync(planted, memoryFile());
      putBack(start, runBytes);
    });
    try {
      w.during(append("- Da execução"));
      const run = await w.prompt("write");
      expect(fs.lstatSync(memoryFile()).isFile()).toBe(true);
      expect(fs.readFileSync(memoryFile(), "utf8")).toBe(START);
      expect(fs.lstatSync(asideOf(run.id)).isSymbolicLink()).toBe(true);
      expect(edits().map((e) => e.run_id)).toEqual([run.id]);
      expect(guardRows().length).toBe(rows + 1);
    } finally {
      spy.mockRestore();
    }
  });

  it("C71 when nothing can be put back (the set-aside folder is unusable), the proposal is still stored with the run's bytes, a guard version of them, and the owner is told it failed", async () => {
    const mark = maxVersion();
    const rows = guardRows().length;
    // the set-aside folder is the owner's side of the disk (no run reaches it); here it is made unusable
    fs.writeFileSync(path.join(w.home, "guard"), "não sou uma pasta\n");
    const putBack = w.ctx.memoryGuard.putBack.bind(w.ctx.memoryGuard);
    const spy = vi.spyOn(w.ctx.memoryGuard, "putBack").mockImplementation((start, runBytes) => {
      fs.rmSync(memoryFile());
      fs.symlinkSync(path.join(w.memory, "notes", "x.md"), memoryFile());
      putBack(start, runBytes);
    });
    const runBytes = `${START}- Da execução\n`;
    try {
      w.during(append("- Da execução"));
      const run = await w.prompt("write");
      expect(edits().map((e) => e.run_id)).toEqual([run.id]);
      expect(guardRows().length).toBe(rows + 1);
      expect(guardRows()[0]).toMatchObject({ runId: run.id, tone: "danger" });
      expect(guardRows()[0]!.body).toMatch(/could not put MEMORY\.md back/);
      // the link was put by the mock after the run's bytes were read: the proposal holds none of a link's content
      expect(payloadOf(edits()[0]!).content).toBe(runBytes);
      const guard = (await versionsSince(mark)).filter((v) => v.origin === "guard");
      expect(guard.map((v) => v.sha256)).toEqual([sha(runBytes)]);
    } finally {
      spy.mockRestore();
    }
  });

  it("C71 a folder that took the name is set aside with what it holds, and the start bytes are written", async () => {
    w.during(() => {
      fs.rmSync(memoryFile());
      fs.mkdirSync(memoryFile());
      fs.writeFileSync(path.join(memoryFile(), "dentro.md"), "- dentro\n");
    });
    const run = await w.prompt("write");
    expect(fs.lstatSync(memoryFile()).isFile()).toBe(true);
    expect(fs.readFileSync(memoryFile(), "utf8")).toBe(START);
    expect(fs.readFileSync(path.join(asideOf(run.id), "dentro.md"), "utf8")).toBe("- dentro\n");
    expect(edits().map((e) => e.run_id)).toEqual([run.id]);
  });
});

// ---- verification round 2, findings 1 and 2: the guard does not depend on what the run can shape --------------------------

describe("C69 and C71 the run shapes memory/archive first (round 2, finding 1)", () => {
  const shapes: Array<[string, () => void]> = [
    [
      "a regular file",
      () => {
        fs.rmSync(path.join(w.memory, "archive"), { recursive: true, force: true });
        fs.writeFileSync(path.join(w.memory, "archive"), "não sou uma pasta\n");
      },
    ],
    [
      "a link to a folder",
      () => {
        const elsewhere = path.join(w.home, "workspace", "outro");
        fs.mkdirSync(elsewhere, { recursive: true });
        fs.rmSync(path.join(w.memory, "archive"), { recursive: true, force: true });
        fs.symlinkSync(elsewhere, path.join(w.memory, "archive"));
      },
    ],
    [
      "a dangling link",
      () => {
        fs.rmSync(path.join(w.memory, "archive"), { recursive: true, force: true });
        fs.symlinkSync(path.join(w.home, "nada", "aqui"), path.join(w.memory, "archive"));
      },
    ],
  ];
  const big = `${START}${"x".repeat(4 * 1024 * 1024 + 10)}\n`;
  const triggers: Array<[string, (planted: string) => void]> = [
    ["grows MEMORY.md past 4 MiB", () => fs.writeFileSync(memoryFile(), big)],
    [
      "replaces MEMORY.md by a link to a file it wrote",
      (planted) => {
        fs.mkdirSync(path.dirname(planted), { recursive: true });
        fs.writeFileSync(planted, "- INJECTED\n");
        fs.rmSync(memoryFile());
        fs.symlinkSync(planted, memoryFile());
      },
    ],
    ["deletes MEMORY.md", () => fs.rmSync(memoryFile())],
  ];

  for (const [shape, make] of shapes) {
    for (const [trigger, act] of triggers) {
      it(`C69 the run makes memory/archive ${shape}, then ${trigger}: the owner's bytes are at the name, the run's entry is set aside in guard/, the proposal is stored`, async () => {
        const rows = guardRows().length;
        const planted = path.join(w.memory, "notes", "plantado-archive.md");
        w.during(() => {
          make();
          act(planted);
        });
        const run = await w.prompt("write");
        expect(fs.lstatSync(memoryFile()).isFile()).toBe(true);
        expect(fs.readFileSync(memoryFile(), "utf8")).toBe(START);
        expect(fs.readFileSync(memoryFile(), "utf8")).not.toContain("INJECTED");
        expect(edits().map((e) => e.run_id)).toEqual([run.id]);
        if (trigger !== "deletes MEMORY.md") {
          expect(
            fs.lstatSync(asideOf(run.id)).isSymbolicLink() || fs.statSync(asideOf(run.id)).size > 0,
          ).toBe(true);
          expect(guardRows().length).toBe(rows + 1);
          expect(guardRows()[0]!.tone).toBe("warn");
        }
      });
    }
    it(`C69 the run makes memory/archive ${shape}, then creates MEMORY.md where there was none: no MEMORY.md, the run's file set aside in guard/, the proposal stored`, async () => {
      fs.rmSync(memoryFile());
      await w.index();
      w.during(() => {
        make();
        fs.writeFileSync(memoryFile(), "- INJECTED\n");
      });
      const run = await w.prompt("write");
      expect(fs.existsSync(memoryFile())).toBe(false);
      expect(fs.readFileSync(asideOf(run.id), "utf8")).toBe("- INJECTED\n");
      expect(edits().map((e) => [e.run_id, payloadOf(e).content])).toEqual([[run.id, "- INJECTED\n"]]);
    });
  }

  it("C69 a run that makes guard/<runId> names taken beforehand is not needed: an earlier set-aside is never overwritten, the second one is -2 and the first is as it was", async () => {
    const first = asideOf("r-antes");
    fs.mkdirSync(path.dirname(first), { recursive: true });
    fs.writeFileSync(first, "- ANTIGO\n");
    w.during((run) => {
      // the name of this run's set-aside is taken (by an earlier set-aside of the same run id)
      fs.writeFileSync(asideOf(run.runId), "- ANTIGO DESTA EXECUCAO\n");
      fs.writeFileSync(memoryFile(), big);
    });
    const run = await w.prompt("write");
    expect(fs.readFileSync(first, "utf8")).toBe("- ANTIGO\n");
    expect(fs.readFileSync(asideOf(run.id), "utf8")).toBe("- ANTIGO DESTA EXECUCAO\n");
    expect(fs.statSync(asideOf(run.id, 2)).size).toBe(Buffer.byteLength(big));
    expect(payloadOf(edits()[0]!).aside).toBe(`guard/guard-${run.id}-2-MEMORY.md`);
    expect(fs.readFileSync(memoryFile(), "utf8")).toBe(START);
  });
});

describe("C69 the guard never follows a link at MEMORY.md (round 2, finding 2)", () => {
  const SECRET = "SEGREDO-CONFIDENCIAL-9f3a";

  it("C69 a link to a note hidden from agents and devices: the proposal names the link's target and holds no content, and no byte of the note is in the proposal, the inbox, or any answer a device gets", async () => {
    const secret = w.put(path.join(w.memory, "notes", "fin", "segredo.md"), `# Segredo\n\n${SECRET}\n`);
    const saved = await w.call("PUT", "/api/settings", {
      folderAccess: [{ path: path.join(w.memory, "notes", "fin"), agents: "hide", devices: "hide" }],
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    await w.index();
    try {
      w.during(() => {
        fs.rmSync(memoryFile());
        fs.symlinkSync(secret, memoryFile());
      });
      const run = await w.prompt("write");
      expect(fs.lstatSync(memoryFile()).isFile()).toBe(true);
      expect(fs.readFileSync(memoryFile(), "utf8")).toBe(START);
      const [edit] = edits();
      expect(payloadOf(edit!)).toEqual({
        path: "MEMORY.md",
        content: "",
        aside: `guard/guard-${run.id}-MEMORY.md`,
        linkTarget: secret,
      });
      expect(JSON.stringify(edit)).not.toContain(SECRET);
      expect(JSON.stringify(guardRows())).not.toContain(SECRET);
      expect(JSON.stringify(w.ctx.db.prepare("SELECT * FROM memory_versions").all())).not.toContain(SECRET);
      // the owner reads the proposal and sees the name, no text
      const owner = await w.call("GET", `/api/memory/proposals/${edit!.id}`);
      expect(owner.status).toBe(200);
      expect(JSON.stringify(owner.body)).not.toContain(SECRET);
      // a device holding every scope reads nothing of the note, whichever route it asks
      const device = w.device(["content", "monitor", "run", "approve"]);
      const answers = [
        await w.call("GET", `/api/memory/proposals/${edit!.id}`, undefined, device),
        await w.call("GET", "/api/memory/proposals", undefined, device),
        await w.call("GET", "/api/notifications?limit=100", undefined, device),
        await w.call("GET", "/api/memory/history?path=MEMORY.md&limit=100", undefined, device),
        await w.call("GET", "/api/memory/search?q=SEGREDO", undefined, device),
        await w.call("GET", `/api/artifacts/list`, undefined, device),
      ];
      for (const a of answers)
        expect(JSON.stringify(a.body), JSON.stringify(a.body).slice(0, 80)).not.toContain(SECRET);
      expect(answers[0]!.status).toBe(404);
      expect((answers[1]!.body.items as Json[]).map((i) => i.id)).not.toContain(edit!.id);
      // the inbox row does not name the target either
      expect(JSON.stringify(answers[2]!.body)).not.toContain("segredo.md");
      // accepting a proposal that holds no content is refused, never a blanked MEMORY.md
      const refused = await w.call("POST", `/api/memory/proposals/${edit!.id}/decide`, {
        action: "accept",
        baseVersion: sha(START),
      });
      expect([refused.status, refused.body.error.code]).toEqual([400, "validation"]);
      expect(fs.readFileSync(memoryFile(), "utf8")).toBe(START);
    } finally {
      await w.call("PUT", "/api/settings", { folderAccess: [] });
    }
  });

  it("C69 a link to a note the run owns is not followed either: no content, the target's name", async () => {
    const planted = path.join(w.memory, "notes", "do-agente.md");
    w.during(() => {
      fs.mkdirSync(path.dirname(planted), { recursive: true });
      fs.writeFileSync(planted, "- INJECTED\n");
      fs.rmSync(memoryFile());
      fs.symlinkSync(planted, memoryFile());
    });
    await w.prompt("write");
    const payload = payloadOf(edits()[0]!);
    expect(payload.content).toBe("");
    expect(payload.linkTarget).toBe(planted);
  });
});

// ---- verification round 3, finding 7 and the survivors F2 and F3 (part 1) ---------------------------------------------

describe("C69 the guard's folder is the owner's alone (round 3, finding 7)", () => {
  const SECRET = "O-QUE-A-EXECUCAO-DEIXOU-7c1e";

  it("C69 a device holding every scope gets 404 from preview and note of what lies in guard/, as it does for artifacts/exports/; the owner reads it", async () => {
    const aside = w.put(path.join(w.home, "guard", "guard-r-1-MEMORY.md"), `${SECRET}\n`);
    const exported = w.put(path.join(w.home, "artifacts", "exports", "x", "a.md"), `${SECRET}\n`);
    const device = w.device(["content", "monitor", "run", "approve"]);
    const ask = async (route: "preview" | "note", file: string) =>
      w.call("GET", `/api/memory/${route}?p=${encodeURIComponent(file)}`, undefined, device);
    for (const route of ["preview", "note"] as const) {
      const guarded = await ask(route, aside);
      const control = await ask(route, exported);
      expect([guarded.status, guarded.body?.error?.code], route).toEqual([
        control.status,
        control.body?.error?.code,
      ]);
      expect(guarded.status, route).toBe(404);
      expect(JSON.stringify(guarded.body)).not.toContain(SECRET);
    }
    const owner = await w.call("GET", `/api/memory/preview?p=${encodeURIComponent(aside)}`);
    expect(owner.status).toBe(200);
    expect(JSON.stringify(owner.body)).toContain(SECRET);
  });

  it("C69 only the owner starts a run whose working folder is guard/ or a folder in it: a device with run scope is 403 forbidden_path and no run is made", async () => {
    fs.mkdirSync(path.join(w.home, "guard", "dentro"), { recursive: true });
    const device = w.device(["run", "monitor"]);
    const runs = () => (w.ctx.db.prepare("SELECT COUNT(*) c FROM runs").get() as { c: number }).c;
    const before = runs();
    for (const cwd of [path.join(w.home, "guard"), path.join(w.home, "guard", "dentro")]) {
      const res = await w.call("POST", "/api/runs", { prompt: "olhe", mode: "read_only", cwd }, device);
      expect([res.status, res.body.error?.code], cwd).toEqual([403, "forbidden_path"]);
    }
    expect(runs()).toBe(before);
    const owner = await w.call("POST", "/api/runs", {
      prompt: "dono",
      mode: "read_only",
      cwd: path.join(w.home, "guard"),
    });
    expect([200, 202], JSON.stringify(owner.body)).toContain(owner.status);
    expect(runs()).toBe(before + 1);
    // the owner's run in guard/ is let finish, so the next case finds the world quiet
    await w.ctx.execution.wait(owner.body.runId);
  });
});

describe("C69 the run manager refuses guard/ as a device's working folder at each of its three gates (round 3, finding 7)", () => {
  const input = (startedBy: string | null) => ({
    origin: "manual" as const,
    provider: "claude" as const,
    prompt: "olhe",
    cwd: path.join(w.home, "guard"),
    model: null,
    effort: "default" as const,
    mode: "read_only" as const,
    timeoutMs: 60_000,
    profile: "read_only" as const,
    startedBy,
  });

  it("C69 create() itself refuses a device's run (not only the route's check before it), and accepts the owner's and a routine's", () => {
    expect(() => w.ctx.runs.create(input("device:d1"))).toThrow(
      /Only the owner may start a run in the guard/,
    );
    expect(w.ctx.runs.create(input("owner")).cwd).toBe(path.join(w.home, "guard"));
    expect(w.ctx.runs.create(input(null)).cwd).toBe(path.join(w.home, "guard"));
  });

  it("C69 assertFolderAccess refuses it before anything is made, and the launch refuses a stored run whose asker is a device", async () => {
    expect(() =>
      w.ctx.runs.assertFolderAccess({
        cwd: path.join(w.home, "guard"),
        mode: "read_only",
        provider: "claude",
        startedBy: "device:d1",
      }),
    ).toThrow(/Only the owner may start a run in the guard/);
    const record = w.ctx.runs.create(input("owner"));
    w.ctx.db.prepare("UPDATE runs SET started_by = 'device:d1' WHERE id = ?").run(record.id);
    const ended = await w.ctx.runs.execute(record.id, "olhe", "read_only");
    expect(ended.status).toBe("failed");
    expect(ended.error ?? "").toMatch(/Only the owner may start a run in the guard/);
  });
});

describe("C69 the guard restores the owner's bytes whatever names are taken (round 3, finding 7 and F2)", () => {
  const big = `${START}${"x".repeat(4 * 1024 * 1024 + 10)}\n`;
  const fill = (runId: string, count: number) => {
    fs.mkdirSync(path.join(w.home, "guard"), { recursive: true });
    for (let n = 1; n <= count; n++) fs.writeFileSync(asideOf(runId, n), `- ANTIGO ${n}\n`);
  };

  it("C69 98 names are taken: the run's entry goes to the 99th name, -99 (the bound is 99, not 98), the 98 as they were", async () => {
    w.during((run) => {
      fill(run.runId, 98);
      fs.writeFileSync(memoryFile(), big);
    });
    const run = await w.prompt("write");
    expect(fs.readFileSync(memoryFile(), "utf8")).toBe(START);
    expect(fs.statSync(asideOf(run.id, 99)).size).toBe(Buffer.byteLength(big));
    for (const n of [1, 2, 50, 98])
      expect(fs.readFileSync(asideOf(run.id, n), "utf8")).toBe(`- ANTIGO ${n}\n`);
    expect(payloadOf(edits()[0]!).aside).toBe(`guard/guard-${run.id}-99-MEMORY.md`);
  });

  it("C69 all 99 names are taken (a run that can write the home filled them): the owner's bytes are still at the name, the run's entry is at a name made of random digits, the 99 untouched, the proposal names it", async () => {
    w.during((run) => {
      fill(run.runId, 99);
      fs.writeFileSync(memoryFile(), big);
    });
    const run = await w.prompt("write");
    expect(fs.readFileSync(memoryFile(), "utf8")).toBe(START);
    expect(fs.readFileSync(memoryFile(), "utf8")).not.toContain("x".repeat(100));
    for (const n of [1, 2, 99]) expect(fs.readFileSync(asideOf(run.id, n), "utf8")).toBe(`- ANTIGO ${n}\n`);
    const aside = payloadOf(edits()[0]!).aside as string;
    expect(aside).toMatch(new RegExp(`^guard/guard-${run.id}-x[0-9a-f]{12}-MEMORY\\.md$`));
    expect(fs.statSync(path.join(w.home, aside)).size).toBe(Buffer.byteLength(big));
    expect(guardRows()[0]!.tone).toBe("warn");
  });

  it("C69 a link replacing MEMORY.md with all 99 names taken is put back too", async () => {
    const planted = path.join(w.memory, "notes", "plantado-cheio.md");
    w.during((run) => {
      fill(run.runId, 99);
      fs.mkdirSync(path.dirname(planted), { recursive: true });
      fs.writeFileSync(planted, "- INJECTED\n");
      fs.rmSync(memoryFile());
      fs.symlinkSync(planted, memoryFile());
    });
    const run = await w.prompt("write");
    expect(fs.lstatSync(memoryFile()).isFile()).toBe(true);
    expect(fs.readFileSync(memoryFile(), "utf8")).toBe(START);
    const aside = payloadOf(edits()[0]!).aside as string;
    expect(fs.lstatSync(path.join(w.home, aside)).isSymbolicLink()).toBe(true);
    expect(aside).not.toBe(`guard/guard-${run.id}-MEMORY.md`);
  });
});

describe("C69 a link planted between the guard's read and its write-back (round 3, F3)", () => {
  it("C69 the guard read the file, a link took the name, and the bytes it read through it are not kept: the proposal holds the link's target and none of the text", async () => {
    const hidden = w.put(path.join(w.memory, "notes", "fin", "segredo-swap.md"), "SEGREDO-DO-SWAP-31ab\n");
    const guard = w.ctx.memoryGuard as unknown as { read(): Buffer | null };
    const real = guard.read.bind(w.ctx.memoryGuard);
    let swapped = false;
    const spy = vi.spyOn(guard, "read").mockImplementation(() => {
      // the first look found a plain file; before this read reaches the disk a link takes the name
      if (
        !swapped &&
        fs.lstatSync(memoryFile()).isFile() &&
        fs.readFileSync(memoryFile(), "utf8") !== START
      ) {
        swapped = true;
        fs.rmSync(memoryFile());
        fs.symlinkSync(hidden, memoryFile());
      }
      return real();
    });
    try {
      w.during(append("- Da execução"));
      const run = await w.prompt("write");
      expect(swapped).toBe(true);
      expect(fs.lstatSync(memoryFile()).isFile()).toBe(true);
      expect(fs.readFileSync(memoryFile(), "utf8")).toBe(START);
      const payload = payloadOf(edits()[0]!);
      expect(payload).toMatchObject({ content: "", linkTarget: hidden });
      expect(JSON.stringify(edits())).not.toContain("SEGREDO-DO-SWAP");
      expect(fs.lstatSync(asideOf(run.id)).isSymbolicLink()).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
