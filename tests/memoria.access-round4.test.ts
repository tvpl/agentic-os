import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeAdapter } from "@mordomo/adapter-claude";
import type { AgentRun } from "@mordomo/core";
import { citationRedactor } from "../core/src/memory/citations.js";
import { resolveFolderAccess } from "../core/src/memory/folderAccess.js";
import { isInside, leavesBase } from "../core/src/security/paths.js";
import { stream, ticket } from "./helpers/sse.js";
import { code, runWorld, type Json, type RunWorld } from "./helpers/memoriaWorld.js";

/**
 * .specs/features/cerebro-memoria-confiavel, round 4 of the verification, part 2: the access layer (C193 to C195).
 */

const opened: RunWorld[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (opened.length) await opened.pop()!.close();
});

async function seeded(prefix: string) {
  const w = await runWorld(prefix);
  opened.push(w);
  const fin = path.join(w.memory, "notes", "fin");
  w.put(path.join(fin, "segredo.md"), "# Segredo\n\nOrçamento sigiloso do trimestre.\n");
  w.put(path.join(w.memory, "notes", "outra", "visivel.md"), "# Visível\n\nOrçamento público.\n");
  await w.index();
  const res = await w.call("PUT", "/api/settings", {
    folderAccess: [{ path: fin, agents: "write", devices: "hide" }],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  while (w.ctx.indexer.isIndexing()) await new Promise((resolve) => setTimeout(resolve, 5));
  return { w, fin };
}

const runCount = (w: RunWorld): number =>
  (w.ctx.db.prepare("SELECT COUNT(*) c FROM runs").get() as { c: number }).c;

// ---- C193: a folder whose name starts with two dots ----------------------------------------------------------------------

describe("C193 the segment test of 'inside'", () => {
  it("C193 a relative path leaves its base only when its first segment is exactly '..': '..z', '...' and '..a/b' are inside; '..', '../x' and an absolute path are not", () => {
    for (const rel of ["..", "../x", "../..", "..\\x"]) expect(leavesBase(rel), rel).toBe(true);
    for (const rel of ["", ".", "..z", "...", "..a/b", "a/..", "a/../b", ".hidden", "x..", "..․"])
      expect(leavesBase(rel), rel).toBe(false);
    const base = path.join(os.tmpdir(), "base");
    expect(isInside(base, base)).toBe(true);
    expect(isInside(base, path.join(base, "..z"))).toBe(true);
    expect(isInside(base, path.join(base, "..z", "deep", "file"))).toBe(true);
    expect(isInside(base, path.join(base, "...", "x"))).toBe(true);
    expect(isInside(base, path.join(base, "ok"))).toBe(true);
    expect(isInside(base, path.join(base, ".."))).toBe(false);
    expect(isInside(base, path.join(base, "..", "base2"))).toBe(false);
    expect(isInside(base, path.join(base, "..", "x"))).toBe(false);
    expect(isInside(base, base + "2")).toBe(false);
    expect(isInside(base, path.resolve("/"))).toBe(false);
  });
});

describe("C193 a device's run in a folder named with two dots under the exports or the guard", () => {
  it("C193 exports/..z, exports/ok, exports/..., guard/..g and guard/sub are refused as the exports and the guard are; exports/.. and exports/../x are the folders they name; at the request, at create, at assertFolderAccess and at the launch", async () => {
    const { w } = await seeded("mordomo-round4-c186-");
    const artifacts = w.ctx.paths.artifacts;
    const exp = path.join(artifacts, "exports");
    const guard = path.join(w.home, "guard");
    const mk = (...parts: string[]) => {
      const dir = path.join(...parts);
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    };
    const refused = {
      "exports/..z": [mk(exp, "..z"), 404, "not_found"],
      "exports/ok": [mk(exp, "ok"), 404, "not_found"],
      "exports/...": [mk(exp, "..."), 404, "not_found"],
      "exports/..z/deep": [mk(exp, "..z", "deep"), 404, "not_found"],
      "guard/..g": [mk(guard, "..g"), 403, "forbidden_path"],
      "guard/sub": [mk(guard, "sub"), 403, "forbidden_path"],
      "guard/..g/deep": [mk(guard, "..g", "deep"), 403, "forbidden_path"],
    } as const;
    const device = w.device(["run", "content", "monitor"]);

    // the request
    const before = runCount(w);
    for (const [name, [cwd, status, errorCode]] of Object.entries(refused)) {
      const res = await w.call("POST", "/api/runs", { prompt: "olhe", mode: "read_only", cwd }, device);
      expect(code(res), `${name} ${JSON.stringify(res.body)}`).toEqual([status, errorCode]);
    }
    expect(runCount(w), "no run for a refusal").toBe(before);

    // create(), assertFolderAccess() and the launch
    const input = (cwd: string, startedBy: string | null) => ({
      origin: "manual" as const,
      provider: "claude" as const,
      prompt: "olhe",
      cwd,
      model: null,
      effort: "default" as const,
      mode: "read_only" as const,
      timeoutMs: 60_000,
      profile: "read_only" as const,
      startedBy,
    });
    for (const [name, [cwd]] of Object.entries(refused)) {
      expect(() => w.ctx.runs.create(input(cwd, "device:d1")), `create ${name}`).toThrow();
      expect(
        () =>
          w.ctx.runs.assertFolderAccess({
            cwd,
            mode: "read_only",
            provider: "claude",
            startedBy: "device:d1",
          }),
        `assertFolderAccess ${name}`,
      ).toThrow();
      const record = w.ctx.runs.create(input(cwd, "owner"));
      w.ctx.db.prepare("UPDATE runs SET started_by = 'device:d1' WHERE id = ?").run(record.id);
      const ended = await w.ctx.runs.execute(record.id, "olhe", "read_only");
      expect(ended.status, `launch ${name}`).toBe("failed");
    }
    // the owner's, and what the owner set up, are accepted in all of them
    for (const [name, [cwd]] of Object.entries(refused)) {
      expect(() => w.ctx.runs.create(input(cwd, "owner")), `owner ${name}`).not.toThrow();
      expect(() => w.ctx.runs.create(input(cwd, null)), `routine ${name}`).not.toThrow();
    }

    // the folders the names reach: exports/.. is artifacts/ (which holds the exports, so the rule for them is in the launch)
    // and exports/../x is a folder of artifacts/ that holds nothing denied
    const x = mk(artifacts, "x");
    const seen: AgentRun[] = [];
    const build = ClaudeAdapter.prototype.buildInvocation;
    vi.spyOn(ClaudeAdapter.prototype, "buildInvocation").mockImplementation(async function (
      this: ClaudeAdapter,
      run: AgentRun,
      id?: string,
    ) {
      seen.push(run);
      return build.call(this, run, id);
    });
    for (const [cwd, hidden] of [
      [path.join(exp, ".."), [fs.realpathSync(exp)]],
      [path.join(exp, "..", "x"), undefined],
    ] as const) {
      seen.length = 0;
      const res = await w.call("POST", "/api/runs", { prompt: "leia", mode: "read_only", cwd }, device);
      expect(res.status, `${cwd} ${JSON.stringify(res.body)}`).toBe(200);
      await w.ctx.execution.wait(res.body.runId);
      expect(seen[0]!.hiddenDirs, cwd).toEqual(hidden);
    }
    expect(x).toBeTruthy();
  });

  it("C193 a run in exports/..z is no run for a device (not listed, 404), and a file under exports/..z or guard/..g is not served to it; the owner reads both", async () => {
    const { w } = await seeded("mordomo-round4-c186v-");
    const exp = path.join(w.ctx.paths.artifacts, "exports", "..z");
    const guard = path.join(w.home, "guard", "..g");
    w.put(path.join(exp, "a.md"), "# Export\n\nTEXTO-EXPORT\n");
    w.put(path.join(guard, "g.md"), "# Guarda\n\nTEXTO-GUARDA\n");
    const device = w.device(["run", "content", "monitor"]);
    const owned = await w.call("POST", "/api/runs", { prompt: "dono", mode: "read_only", cwd: exp });
    expect(owned.status, JSON.stringify(owned.body)).toBe(200);
    await w.ctx.execution.wait(owned.body.runId);
    expect(code(await w.call("GET", `/api/runs/${owned.body.runId}`, undefined, device))).toEqual([
      404,
      "not_found",
    ]);
    const listed = (await w.call("GET", "/api/runs", undefined, device)).body as Json;
    expect(JSON.stringify(listed)).not.toContain(owned.body.runId);
    expect((await w.call("GET", `/api/runs/${owned.body.runId}`)).status).toBe(200);
    for (const file of [path.join(exp, "a.md"), path.join(guard, "g.md")]) {
      const url = `/api/memory/preview?p=${encodeURIComponent(file)}`;
      const asDevice = await w.call("GET", url, undefined, device);
      expect(JSON.stringify(asDevice.body), file).not.toMatch(/TEXTO-/);
      expect([200, 404], file).toContain((await w.call("GET", url)).status);
    }
  });
});

describe("C193 a hidden folder whose name starts with two dots, written in a citation", () => {
  it("C193 'memory/..fin' is hidden from devices: its spelling relative to memory/ ('..fin/x.md') is written (pasta oculta) as every other spelling is", async () => {
    const { w } = await seeded("mordomo-round4-c186c-");
    const dots = path.join(w.memory, "..fin");
    fs.mkdirSync(dots, { recursive: true });
    w.update((s) => {
      s.folderAccess = [{ path: dots, agents: "write", devices: "hide" }];
    });
    const env = { paths: w.ctx.paths, settings: w.ctx.settings() };
    const redactor = citationRedactor(w.ctx.paths, resolveFolderAccess(env), "devices");
    expect(redactor.text(`veja ${dots}/x.md`)).toBe("veja (pasta oculta)");
    expect(redactor.text("veja memory/..fin/x.md")).toBe("veja (pasta oculta)");
    expect(redactor.text("veja ..fin/x.md")).toBe("veja (pasta oculta)");
    expect(redactor.text("veja ..fin2/x.md e outro/..fin/x.md"), "look-alikes stay").toBe(
      "veja ..fin2/x.md e outro/..fin/x.md",
    );
  });
});

// ---- C195: the counts of a device that is hidden nothing but is never served the exports --------------------------------

describe("C195 the counts a device is given when a root holds the exports and nothing is hidden", () => {
  it("C195 with no level set and the artifacts folder indexed (export copies under it), a device reads no pass count and only the vectors of the files it sees; the owner reads all; with no root holding the exports the counts are the whole index's", async () => {
    const w = await runWorld("mordomo-round4-c195-");
    opened.push(w);
    w.update((s) => {
      s.memory.embeddings = {
        ...s.memory.embeddings,
        enabled: true,
        provider: "hash",
      } as typeof s.memory.embeddings;
    });
    const outra = path.join(w.memory, "notes", "outra");
    w.put(path.join(outra, "a.md"), "# A\n\numa nota visível com texto bastante\n");
    w.put(path.join(outra, "b.md"), "# B\n\noutra nota visível com texto bastante\n");
    await w.index();
    const device = w.device(["monitor", "content"]);
    const status = async (headers?: Record<string, string>) =>
      (await w.call("GET", "/api/memory/status", undefined, headers)).body;
    const doctor = async (headers?: Record<string, string>) =>
      ((await w.call("GET", "/api/doctor?audit=0", undefined, headers)).body.checks as Json[]).find(
        (c) => c.id === "memory-index",
      )!.detail as string;

    // no root holds the exports: the device's index is the owner's and so are its counts
    expect(w.ctx.indexer.audienceTable("devices")).toBe("files_fts");
    const plain = await status(device);
    expect(plain.semantic.vectors).toBe(2);
    expect(plain.lastIndex.stats.scanned).toBeGreaterThan(0);
    expect(await doctor(device)).toMatch(/\d+ files scanned/);

    // the artifacts folder indexed, export copies under it, no level set
    w.update((s) => {
      s.indexedFolders = [...s.indexedFolders, { path: w.ctx.paths.artifacts, area: null, enabled: true }];
    });
    const exported = path.join(w.ctx.paths.artifacts, "exports", "copia-1");
    for (let i = 0; i < 5; i++)
      w.put(path.join(exported, `c${i}.md`), `# Cópia ${i}\n\ncópia de nota oculta número ${i} com texto\n`);
    await w.index();
    expect(w.ctx.indexer.audienceTable("devices"), "the device's own index").toBe("files_fts_devices");
    const owner = await status();
    expect(owner.semantic.vectors, "the owner's vectors hold the copies").toBeGreaterThanOrEqual(7);
    const seen = await status(device);
    expect(seen.semantic.vectors, "the device's vectors are the files it sees").toBe(2);
    expect(Object.values(seen.lastIndex.stats as Record<string, number>).every((n) => n === 0)).toBe(true);
    expect(seen.indexing.scanned).toBe(0);
    expect(await doctor(device)).not.toMatch(/scanned|files/);
    expect(await doctor()).toMatch(/\d+ files scanned/);
    const inbox = JSON.stringify((await w.call("GET", "/api/notifications", undefined, device)).body);
    expect(inbox).not.toMatch(/scanned/);
    // the stream: the counts of a pass that ends while the device listens
    const emit = async () => {
      w.ctx.events.emit("index.finished", {
        stats: {
          scanned: 26,
          added: 26,
          updated: 0,
          removed: 0,
          skippedExcluded: 0,
          skippedBinary: 0,
          related: 0,
          durationMs: 40,
        },
      });
      w.ctx.events.emit("notification.read", { all: true });
    };
    const url = async (headers: Record<string, string>) =>
      `/api/events?ticket=${await ticket(w, headers, { target: "events" })}`;
    const told = await stream(w, await url(device), /notification\.read/, emit);
    expect(told).toContain("index.finished");
    expect(told).not.toContain('"scanned":26');
    expect(await stream(w, await url(w.owner()), /notification\.read/, emit)).toContain('"scanned":26');
    // more copies: the device's answers do not move
    for (let i = 5; i < 12; i++)
      w.put(path.join(exported, `c${i}.md`), `# Cópia ${i}\n\ncópia de nota oculta número ${i} com texto\n`);
    await w.index();
    expect((await status(device)).semantic.vectors).toBe(2);
    expect((await status()).semantic.vectors).toBeGreaterThan(owner.semantic.vectors);
  });
});
