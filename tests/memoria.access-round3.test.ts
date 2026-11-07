import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeAdapter } from "@mordomo/adapter-claude";
import type { AgentRun } from "@mordomo/core";
import {
  checkRunFolders,
  FolderHideUnsupportedError,
  FolderHiddenFromDeviceError,
} from "../core/src/runs/folderLevels.js";
import { FAKE_BIN } from "./helpers.js";
import { code, runWorld, type Json, type RunWorld } from "./helpers/memoriaWorld.js";

/**
 * .specs/features/cerebro-memoria-confiavel, round 3 of the verification, part 2: the access layer (C179 to C185).
 * Over a real home with the fake CLIs (`runWorld`).
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
  const outra = path.join(w.memory, "notes", "outra");
  w.put(path.join(fin, "segredo.md"), "# Segredo\n\nOrçamento sigiloso do trimestre.\n");
  w.put(path.join(outra, "visivel.md"), "# Visível\n\nOrçamento público do trimestre.\n");
  await w.index();
  return { w, fin, outra };
}

const setAccess = async (w: RunWorld, folderAccess: Json[]) => {
  const res = await w.call("PUT", "/api/settings", { folderAccess });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  while (w.ctx.indexer.isIndexing()) await new Promise((resolve) => setTimeout(resolve, 5));
};

const runCount = (w: RunWorld): number =>
  (w.ctx.db.prepare("SELECT COUNT(*) c FROM runs").get() as { c: number }).c;

/** What every launch of the Claude adapter from now on was given, with the `--disallowedTools` rules it built. */
function captureInvocations(): { runs: AgentRun[]; denied: string[][] } {
  const seen = { runs: [] as AgentRun[], denied: [] as string[][] };
  const build = ClaudeAdapter.prototype.buildInvocation;
  vi.spyOn(ClaudeAdapter.prototype, "buildInvocation").mockImplementation(async function (
    this: ClaudeAdapter,
    run: AgentRun,
    id?: string,
  ) {
    const inv = await build.call(this, run, id);
    seen.runs.push(run);
    seen.denied.push(
      inv.args.flatMap((arg, i) => (inv.args[i - 1] === "--disallowedTools" ? arg.split(",") : [])),
    );
    return inv;
  });
  return seen;
}

const rulesFor = (dir: string): string[] =>
  ["Read", "Grep", "Glob", "Edit", "Write"].map((tool) => `${tool}(/${fs.realpathSync(dir)}/**)`);

// ---- C179: a run a device asks for, in a folder that holds a hidden one --------------------------------------------------

describe("C179 a device's run whose folder holds a folder hidden from devices", () => {
  it("C179 every way a device starts a run launches with the deny rules for the hidden folder (and the exports); a folder handed that is hidden is 404; a run at the exports is 404", async () => {
    const { w, fin, outra } = await seeded("mordomo-round3-c179-");
    await setAccess(w, [{ path: fin, agents: "write", devices: "hide" }]);
    const exportsDir = path.join(w.ctx.paths.artifacts, "exports");
    fs.mkdirSync(exportsDir, { recursive: true });
    const device = w.device(["run", "content", "monitor"]);
    const seen = captureInvocations();

    // 1. POST /api/runs with each folder that holds the hidden one (the claim: the launch arguments, since the fake CLI
    //    reads no file)
    const holds: Array<[string, string]> = [
      [path.join(w.memory, "notes"), fin],
      [w.memory, fin],
      [w.ctx.paths.artifacts, exportsDir],
    ];
    for (const [cwd, hidden] of holds) {
      seen.runs.length = 0;
      seen.denied.length = 0;
      const res = await w.call("POST", "/api/runs", { prompt: "leia tudo", mode: "read_only", cwd }, device);
      expect(res.status, `${cwd} ${JSON.stringify(res.body)}`).toBe(200);
      await w.ctx.execution.wait(res.body.runId);
      expect(seen.runs.length, cwd).toBe(1);
      expect(seen.runs[0]!.hiddenDirs, cwd).toEqual([fs.realpathSync(hidden)]);
      expect(seen.denied[0], cwd).toEqual(expect.arrayContaining(rulesFor(hidden)));
    }

    // 2. the owner's same request is not given the device's rules (agents write the folder)
    seen.runs.length = 0;
    const owner = await w.call("POST", "/api/runs", { prompt: "dono", mode: "read_only", cwd: w.memory });
    expect(owner.status, JSON.stringify(owner.body)).toBe(200);
    await w.ctx.execution.wait(owner.body.runId);
    expect(seen.runs[0]!.hiddenDirs).toBeUndefined();

    // 3. a folder with nothing hidden inside: no rule of the folder
    seen.runs.length = 0;
    const open = await w.call("POST", "/api/runs", { prompt: "leia", mode: "read_only", cwd: outra }, device);
    expect(open.status, JSON.stringify(open.body)).toBe(200);
    await w.ctx.execution.wait(open.body.runId);
    expect(seen.runs[0]!.hiddenDirs).toBeUndefined();

    // 4. the exports and the hidden folder as the folder of the run: 404, and no run
    const before = runCount(w);
    for (const cwd of [exportsDir, fin]) {
      const res = await w.call("POST", "/api/runs", { prompt: "olhe", mode: "read_only", cwd }, device);
      expect(code(res), cwd).toEqual([404, "not_found"]);
    }
    expect(runCount(w)).toBe(before);

    // 5. a memory skill a device starts is handed memory/, which holds the hidden folder: denied; its folder input
    //    naming the hidden folder is 404
    seen.runs.length = 0;
    const skill = await w.call(
      "POST",
      "/api/skills/recall/run",
      { inputs: { question: "o que há?" } },
      device,
    );
    expect([200, 202], JSON.stringify(skill.body)).toContain(skill.status);
    await w.ctx.execution.wait(skill.body.runId);
    expect(seen.runs.length, "the skill's run").toBe(1);
    expect(seen.runs[0]!.hiddenDirs, "the skill's run").toEqual(
      expect.arrayContaining([fs.realpathSync(fin)]),
    );
    const named = await w.call(
      "POST",
      "/api/skills/organize-brain/run",
      { inputs: { folder: fin, etapa: "indexar" } },
      device,
    );
    expect(code(named), JSON.stringify(named.body)).toEqual([404, "not_found"]);
    expect(JSON.stringify(named.body)).not.toContain("fin");

    // 6. retry, children and a conversation continued, asked by the device for a run it started, launch with the rules
    const first = await w.call(
      "POST",
      "/api/runs",
      { prompt: "leia", mode: "read_only", cwd: w.memory },
      device,
    );
    await w.ctx.execution.wait(first.body.runId);
    seen.runs.length = 0;
    const source = first.body.runId as string;
    const session = w.ctx.runs.get(source)!.sessionId!;
    const asked: Array<[string, string, Json]> = [
      ["retry", `/api/runs/${source}/retry`, { submissionId: crypto.randomUUID() }],
      ["children", `/api/runs/${source}/children`, { prompts: ["filho"] }],
      ["a conversation continued", `/api/sessions/${session}/continue`, { prompt: "continue" }],
    ];
    for (const [why, url, body] of asked) {
      const res = await w.call("POST", url, body, device);
      expect(res.status, `${why} ${JSON.stringify(res.body)}`).toBeLessThan(300);
    }
    await vi.waitFor(
      () =>
        expect(
          w.ctx.runs.list({ limit: 100 }).every((r) => ["done", "failed", "cancelled"].includes(r.status)),
        ).toBe(true),
      { timeout: 20_000 },
    );
    expect(seen.runs.length, "three more launches").toBeGreaterThanOrEqual(3);
    for (const run of seen.runs)
      expect(run.hiddenDirs).toEqual(expect.arrayContaining([fs.realpathSync(fin)]));

    // 7. the level read again at launch: a run recorded while the folder was open is launched with the rule
    await setAccess(w, []);
    seen.runs.length = 0;
    const record = w.ctx.runs.create({
      origin: "manual",
      provider: "claude",
      prompt: "x",
      request: { version: 1, kind: "prompt", prompt: "x", mode: "read_only" },
      cwd: w.memory,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 60_000,
      profile: "read_only",
      startedBy: "device:abc",
    });
    await setAccess(w, [{ path: fin, agents: "write", devices: "hide" }]);
    await w.ctx.runs.execute(record.id, "x", "read_only");
    expect(seen.runs[0]!.hiddenDirs).toEqual(expect.arrayContaining([fs.realpathSync(fin)]));

    // 8. with no level set at all the exports are still no device's: denied under a folder that holds them, 404 as the folder
    await setAccess(w, []);
    seen.runs.length = 0;
    const plain = await w.call(
      "POST",
      "/api/runs",
      { prompt: "leia", mode: "read_only", cwd: w.ctx.paths.artifacts },
      device,
    );
    expect(plain.status, JSON.stringify(plain.body)).toBe(200);
    await w.ctx.execution.wait(plain.body.runId);
    expect(seen.runs[0]!.hiddenDirs).toEqual([fs.realpathSync(exportsDir)]);
    expect(
      code(await w.call("POST", "/api/runs", { prompt: "olhe", mode: "read_only", cwd: exportsDir }, device)),
    ).toEqual([404, "not_found"]);
  });
});

describe("C179 per provider", () => {
  it("C179 Codex and Cursor are refused for a device (403 device_provider_refused at the request, 409 folder_hide_unsupported at the check); Claude and nothing hidden are not", async () => {
    const { w, fin } = await seeded("mordomo-round3-c179p-");
    for (const id of ["codex", "cursor"] as const)
      w.update((s) => {
        s.providers[id] = {
          ...s.providers[id]!,
          enabled: true,
          binaryPath: path.join(FAKE_BIN, id === "codex" ? "codex" : "cursor-agent"),
        };
      });
    w.ctx.reloadAdapters();
    await setAccess(w, [{ path: fin, agents: "write", devices: "hide" }]);
    const device = w.device(["run"]);
    const before = runCount(w);
    for (const provider of ["codex", "cursor"]) {
      const res = await w.call(
        "POST",
        "/api/runs",
        { prompt: "leia", mode: "read_only", cwd: w.memory, provider },
        device,
      );
      expect(code(res), provider).toEqual([403, "device_provider_refused"]);
    }
    expect(runCount(w)).toBe(before);

    // the check itself, for each confinement a manifest can declare
    const env = { paths: w.ctx.paths, settings: w.ctx.settings() };
    const plan = (confinement: "workdir" | "none" | undefined, device: boolean) => ({
      cwd: w.memory,
      readDirs: [],
      mode: "read_only" as const,
      device,
      provider: () => ({ readConfinement: confinement, name: "P" }),
    });
    for (const confinement of ["none", undefined] as const) {
      expect(() => checkRunFolders(env, plan(confinement, true))).toThrow(FolderHideUnsupportedError);
    }
    expect(checkRunFolders(env, plan("workdir", true)).hiddenDirs).toEqual([fs.realpathSync(fin)]);
    // not asked by a device: hidden from devices only, nothing to deny (the owner's own run)
    expect(checkRunFolders(env, plan("none", false)).hiddenDirs).toEqual([]);
    // a folder handed that is hidden is a 404 and names nothing
    expect(() => checkRunFolders(env, { ...plan("workdir", true), cwd: w.home, readDirs: [fin] })).toThrow(
      FolderHiddenFromDeviceError,
    );
    expect(() => checkRunFolders(env, { ...plan("workdir", true), cwd: w.home, readDirs: [fin] })).toThrow(
      /^No folder this run may be handed is there\.$/,
    );
  });
});

// ---- C180: the history of a note that left its path -----------------------------------------------------------------------

describe("C180 the history of a path whose note left", () => {
  it("C180 while a folder is hidden from devices, a device reads no version of a path that predates a removal, whatever became of the note; the new note at the path, and the restore, are read; with nothing hidden all is read", async () => {
    const { w, fin } = await seeded("mordomo-round3-c180-");
    const inbox = path.join(w.memory, "notes", "inbox");
    const areas = path.join(w.memory, "areas", "financeiro");
    const vault = w.indexedRoot("c180-cofre");
    fs.mkdirSync(areas, { recursive: true });
    const rel = (file: string) => path.relative(w.memory, file).split(path.sep).join("/");
    const note = (name: string, text: string) => w.put(path.join(inbox, name), `# ${name}\n\n${text}\n`);

    // five visible notes with two versions each (the file as the pass found it, then as it was edited), and a sixth that stays
    const stays = note("fica.md", "TEXTO-FICA original");
    const names = ["versionada", "areas", "cofre", "editada", "apagada"];
    const files = Object.fromEntries(
      names.map((n) => [n, note(`${n}.md`, `TEXTO-${n.toUpperCase()} sigiloso original`)]),
    );
    await w.index();
    for (const file of [stays, ...Object.values(files)]) {
      fs.writeFileSync(file, fs.readFileSync(file, "utf8") + "segunda versão\n");
    }
    await w.index();

    const owner = (await w.call("GET", "/api/memory/history?limit=100")).body.versions as Json[];
    const idsOf = (file: string) =>
      owner.filter((v) => v.path === rel(file) && v.size !== null).map((v) => v.id as number);
    for (const file of [stays, ...Object.values(files)])
      expect(idsOf(file).length, rel(file)).toBeGreaterThanOrEqual(2);

    const device = w.device(["content"]);
    const readsId = async (id: number, as: "device" | "owner" = "device") =>
      (await w.call("GET", `/api/memory/history/${id}`, undefined, as === "device" ? device : undefined))
        .status;

    await setAccess(w, [
      { path: fin, agents: "write", devices: "hide" },
      { path: areas, agents: "write", devices: "hide" },
      { path: vault, agents: "write", devices: "hide" },
    ]);
    // the moves: into a hidden versioned folder, into a hidden folder under memory/ that is not versioned, into a hidden
    // indexed folder outside memory/, one edited on the way, and one deleted
    fs.renameSync(files.versionada!, path.join(fin, "versionada.md"));
    fs.renameSync(files.areas!, path.join(areas, "areas.md"));
    fs.renameSync(files.cofre!, path.join(vault, "cofre.md"));
    fs.writeFileSync(
      path.join(vault, "editada.md"),
      fs.readFileSync(files.editada!, "utf8") + "editada ao mudar\n",
    );
    fs.rmSync(files.editada!);
    fs.rmSync(files.apagada!);
    // before the pass that records any of it: the files are not there, and a device is told of none of their versions
    for (const name of names)
      for (const id of idsOf(files[name]!)) expect(await readsId(id), `${name} before the pass`).toBe(404);
    await w.index();

    const missing = await w.call("GET", "/api/memory/history/99999", undefined, device);
    for (const name of names) {
      for (const id of idsOf(files[name]!)) {
        const res = await w.call("GET", `/api/memory/history/${id}`, undefined, device);
        expect(code(res), `${name} ${id}`).toEqual([404, "not_found"]);
        expect(res.body.error.message.replace(String(id), "N")).toBe(
          missing.body.error.message.replace("99999", "N"),
        );
        expect(await readsId(id, "owner"), `the owner reads ${name} ${id}`).toBe(200);
      }
    }
    const listed = (await w.call("GET", "/api/memory/history?limit=100", undefined, device)).body
      .versions as Json[];
    expect(JSON.stringify(listed)).not.toMatch(/SIGILOSO|versionada|areas\.md|cofre|editada|apagada/i);
    for (const name of names)
      expect(
        (
          await w.call(
            "GET",
            `/api/memory/history?path=${encodeURIComponent(rel(files[name]!))}`,
            undefined,
            device,
          )
        ).body.versions,
        name,
      ).toEqual([]);
    // a note that did not move keeps every version
    for (const id of idsOf(stays)) expect(await readsId(id), "the note that stayed").toBe(200);

    // a new note at the old path: its versions are read, the moved note's still are not
    const again = note("areas.md", "TEXTO-NOVA nota no mesmo nome");
    await w.index();
    const after = (
      await w.call("GET", `/api/memory/history?path=${encodeURIComponent(rel(again))}`, undefined, device)
    ).body.versions as Json[];
    expect(after.length).toBeGreaterThanOrEqual(1);
    for (const v of after) {
      const res = await w.call("GET", `/api/memory/history/${v.id}`, undefined, device);
      if (v.size !== null) expect(res.body.content, `version ${v.id}`).not.toMatch(/SIGILOSO/);
    }
    for (const id of idsOf(files.areas!))
      expect(await readsId(id), "the moved note's version, the old path used again").toBe(404);

    // the new note is removed in its turn: its versions are the second removal's, hidden as well
    fs.rmSync(again);
    await w.index();
    for (const v of after.filter((x) => x.size !== null))
      expect(await readsId(v.id as number), `the second note's version ${v.id}`).toBe(404);
    // and a third one at the same name: its versions are read, the second's still are not
    const third = note("areas.md", "TEXTO-TERCEIRA nota no mesmo nome");
    await w.index();
    for (const v of after.filter((x) => x.size !== null))
      expect(await readsId(v.id as number), `the second note's version ${v.id}, a third at the name`).toBe(
        404,
      );
    const thirdList = (
      await w.call("GET", `/api/memory/history?path=${encodeURIComponent(rel(third))}`, undefined, device)
    ).body.versions as Json[];
    expect(
      thirdList.some((v) => v.size !== null && !after.some((x) => x.id === v.id)),
      "the third note's version is read",
    ).toBe(true);

    // the owner restores the deleted note: the restore is a version after the removal and is read; the older ones are not
    const gone = idsOf(files.apagada!).at(0)!;
    const restored = await w.call("POST", "/api/memory/history/restore", { id: gone });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    await w.index();
    const back = (
      await w.call(
        "GET",
        `/api/memory/history?path=${encodeURIComponent(rel(files.apagada!))}`,
        undefined,
        device,
      )
    ).body.versions as Json[];
    expect(back.length).toBeGreaterThanOrEqual(1);
    for (const id of idsOf(files.apagada!))
      expect(await readsId(id), "the version from before the removal").toBe(404);

    // nothing hidden any more: all of it is read again
    await setAccess(w, []);
    for (const name of names)
      for (const id of idsOf(files[name]!)) expect(await readsId(id), `${name} shown`).toBe(200);
  });
});

// ---- C181: a change of the access between the steps of the pass that builds the devices' edges ----------------------------

type EdgeSteps = { refreshDevicesRelatedSteps(changed: ReadonlySet<number>): Generator<void, void> };

describe("C181 the devices' related edges and a change of the access between the steps of the pass", () => {
  it("C181 a pass that worked its edges out for the old view writes none of them after a device's read rebuilt the table for the new one, wherever the change falls; edges of another view found at a read are emptied", async () => {
    const { w, fin } = await seeded("mordomo-round3-c181-");
    const outra = path.join(w.memory, "notes", "outra");
    const zz = path.join(w.memory, "notes", "zz");
    const a = w.put(
      path.join(outra, "a.md"),
      "# A\n\nestrela galaxia nebulosa zeta planeta orbita zeta planeta orbita zeta planeta orbita\n",
    );
    const b = w.put(
      path.join(outra, "b.md"),
      "# B\n\nestrela galaxia cometa zeta planeta orbita zeta planeta orbita zeta planeta orbita\n",
    );
    w.put(path.join(zz, "z.md"), "# Z\n\numa nota qualquer de outra pasta\n");
    for (let i = 0; i < 6; i++)
      w.put(path.join(outra, `cheio-${i}.md`), `# Cheio ${i}\n\n${"palavra ".repeat(20)} unico${i}x\n`);
    for (let i = 0; i < 40; i++)
      w.put(
        path.join(fin, `h${i}.md`),
        `# H${i}\n\nplaneta orbita zeta ruido${i}a ruido${i}b ruido${i}c ruido${i}d ruido${i}e\n`,
      );
    await w.index();
    const idOf = (file: string) =>
      (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(file) as { id: number }).id;
    const finIds = new Set(
      (w.ctx.db.prepare("SELECT id, path FROM files").all() as Array<{ id: number; path: string }>)
        .filter((r) => r.path.startsWith(fin + path.sep))
        .map((r) => r.id),
    );
    const device = w.device(["content"]);
    const similar = async () =>
      ((await w.call("GET", `/api/memory/related?id=${idOf(a)}`, undefined, device)).body as Json[]).find(
        (r) => r.file.path === b,
      )?.why as string | undefined;
    const meta = (key: string) =>
      (w.ctx.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined)
        ?.value ?? null;
    const edges = () =>
      w.ctx.db.prepare("SELECT src_id, dst_id FROM file_related_devices").all() as Array<{
        src_id: number;
        dst_id: number;
      }>;
    const steps = (w.ctx.indexer as unknown as EdgeSteps).refreshDevicesRelatedSteps.bind(w.ctx.indexer);

    // the twin: the access as it will be, edges worked out from nothing
    await setAccess(w, [{ path: fin, agents: "write", devices: "hide" }]);
    await w.index();
    const twin = await similar();
    expect(twin, "the view without the hidden folder reads its three words").toMatch(/zeta|planeta|orbita/);

    const cases = [1, 2, 3, 4].flatMap((n) =>
      [false, true].flatMap((b) => [false, true].map((whole) => ({ stop: n, built: b, whole }))),
    );
    for (const { stop, built, whole } of cases) {
      const label = `stop ${stop}, ${built ? "new pass ran" : "no new pass"}, ${whole ? "whole" : "incremental"}`;
      // view A: another folder hidden, so the hidden folder's notes are in the edges; "whole": the table is not built yet
      if (whole) {
        w.update((s) => {
          s.folderAccess = [{ path: zz, agents: "write", devices: "hide" }];
        });
        w.ctx.indexer.relatedTable("devices");
      } else {
        await setAccess(w, [{ path: zz, agents: "write", devices: "hide" }]);
        await w.index();
        expect(await similar(), `${label}: in view A the pair reads the words it shares there`).toMatch(
          /estrela, galaxia/,
        );
      }
      // a pass over the two changed notes, under view A, stopped after `stop` steps
      const pass = steps(new Set([idOf(a), idOf(b)]));
      for (let i = 0; i < stop; i++) pass.next();
      // the access changes (no pass of its own: the settings are saved), and a device reads
      w.update((s) => {
        s.folderAccess = [{ path: fin, agents: "write", devices: "hide" }];
      });
      expect(w.ctx.indexer.relatedTable("devices")).toBe("file_related_devices");
      // the new view's own pass may have run in between: what it wrote stays
      if (built) await w.index();
      const written = JSON.stringify(edges());
      // the stopped pass goes on
      for (let i = 0; i < 50 && !pass.next().done; i++);
      if (built)
        expect(JSON.stringify(edges()), `${label}: the new view's edges as its pass left them`).toBe(written);
      const view = meta("fts.devices");
      expect([null, view], `${label}: the edges are named for no other view than the index's`).toContain(
        meta("rel.devices"),
      );
      for (const e of edges())
        expect(finIds.has(e.src_id) || finIds.has(e.dst_id), `${label}: an edge of the hidden folder`).toBe(
          false,
        );
      const read = await similar();
      expect(read === undefined || read === twin, `${label}: ${read}`).toBe(true);
      await w.index();
      expect(await similar(), `${label}: after the pass`).toBe(twin);
    }

    // a pass that writes in several slices (500 rows each): stopped between two of them, the rest is not written
    for (let i = 0; i < 700; i++) {
      const g = i % 20;
      w.put(
        path.join(outra, "bulk", `n${i}.md`),
        `# N${i}\n\ngrupo${g}a grupo${g}b grupo${g}c grupo${g}d grupo${g}e unico${i}a unico${i}b unico${i}c\n`,
      );
    }
    await w.index();
    w.update((s) => {
      s.folderAccess = [{ path: zz, agents: "write", devices: "hide" }];
    });
    w.ctx.indexer.relatedTable("devices");
    const many = steps(new Set());
    for (let i = 0; i < 3; i++) many.next();
    expect(edges().length, "the first slices of the old view are written").toBeGreaterThan(0);
    w.update((s) => {
      s.folderAccess = [{ path: fin, agents: "write", devices: "hide" }];
    });
    w.ctx.indexer.relatedTable("devices");
    for (let i = 0; i < 20 && !many.next().done; i++);
    expect(edges(), "the slices after the change are not written").toEqual([]);
    expect(meta("rel.devices")).toBeNull();

    // defence at the read: edges named for another view than the index's are emptied when a device is about to read them
    await setAccess(w, [{ path: zz, agents: "write", devices: "hide" }]);
    await w.index();
    expect(edges().length).toBeGreaterThan(0);
    w.update((s) => {
      s.folderAccess = [{ path: fin, agents: "write", devices: "hide" }];
    });
    w.ctx.indexer.relatedTable("devices");
    expect(edges()).toEqual([]);
    w.ctx.db
      .prepare(
        "INSERT OR REPLACE INTO file_related_devices (src_id, dst_id, score, terms, updated_at) VALUES (?, ?, 0.9, '[\"estrela\"]', 1)",
      )
      .run(idOf(a), idOf(b));
    w.ctx.db
      .prepare(
        "INSERT INTO meta(key, value) VALUES ('rel.devices', 'outra') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run();
    w.ctx.indexer.relatedTable("devices");
    expect(edges()).toEqual([]);
    expect(meta("rel.devices")).toBeNull();
  });
});

// ---- C182: the two counts over every file ---------------------------------------------------------------------------------

describe("C182 the counts a device is given of the index", () => {
  it("C182 the doctor prints no 'files scanned' for a device with a hidden folder and the status counts the vectors of the files it sees; the owner's grow with the hidden notes", async () => {
    const { w, fin, outra } = await seeded("mordomo-round3-c182-");
    w.update((s) => {
      s.memory.embeddings = {
        ...s.memory.embeddings,
        enabled: true,
        provider: "hash",
      } as typeof s.memory.embeddings;
    });
    w.put(path.join(outra, "v2.md"), "# V2\n\noutra nota visível com texto bastante\n");
    await w.index();
    await setAccess(w, [{ path: fin, agents: "write", devices: "hide" }]);
    await w.index();
    const device = w.device(["monitor", "content"]);
    const vectors = async (headers?: Record<string, string>) =>
      (await w.call("GET", "/api/memory/status", undefined, headers)).body.semantic.vectors as number;
    const doctor = async (headers?: Record<string, string>) =>
      ((await w.call("GET", "/api/doctor?audit=0", undefined, headers)).body.checks as Json[]).find(
        (c) => c.id === "memory-index",
      )!.detail as string;
    const seen = { device: await vectors(device), owner: await vectors() };
    expect(seen.device, "only the vectors of the visible notes").toBe(2);
    expect(seen.owner).toBe(3);
    expect(await doctor(device)).not.toMatch(/scanned|files/);
    expect(await doctor()).toMatch(/\d+ files scanned/);
    for (let i = 0; i < 7; i++)
      w.put(path.join(fin, `extra-${i}.md`), `# Extra ${i}\n\nnota escondida ${i} com texto bastante\n`);
    await w.index();
    expect(await vectors(device)).toBe(seen.device);
    expect(await vectors()).toBe(seen.owner + 7);
    // nothing hidden: the counts are the whole index's
    await setAccess(w, []);
    expect(await vectors(device)).toBe(seen.owner + 7);
    expect(await doctor(device)).toMatch(/\d+ files scanned/);
  });
});

// ---- C183: a change of the access starts an index pass --------------------------------------------------------------------

const idle = async (w: RunWorld) => {
  while (w.ctx.indexer.isIndexing()) await new Promise((resolve) => setTimeout(resolve, 5));
};

describe("C183 a change of folderAccess starts an index pass", () => {
  it("C183 a PUT that changes folderAccess builds the devices' edges with no other pass; one that does not change it starts none", async () => {
    const { w, fin } = await seeded("mordomo-round3-c183-");
    const outra = path.join(w.memory, "notes", "outra");
    w.put(path.join(outra, "a.md"), "# A\n\nestrela galaxia nebulosa cometa orbita lunar\n");
    w.put(path.join(outra, "b.md"), "# B\n\nestrela galaxia nebulosa cometa orbita solar\n");
    for (let i = 0; i < 6; i++)
      w.put(path.join(outra, `cheio-${i}.md`), `# Cheio ${i}\n\n${"palavra ".repeat(20)} unico${i}x\n`);
    await w.index();
    const finished: unknown[] = [];
    const off = w.ctx.events.subscribe((e: { type: string }) => {
      if (e.type === "index.finished") finished.push(e);
    });
    const meta = (key: string) =>
      (w.ctx.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined)
        ?.value ?? null;
    const edges = () =>
      (w.ctx.db.prepare("SELECT COUNT(*) c FROM file_related_devices").get() as { c: number }).c;

    // a change of the levels: the pass starts by itself and builds the table named for the new view
    expect(
      (
        await w.call("PUT", "/api/settings", {
          folderAccess: [{ path: fin, agents: "write", devices: "hide" }],
        })
      ).status,
    ).toBe(200);
    await idle(w);
    expect(finished.length, "one pass for the change").toBe(1);
    expect(meta("rel.devices"), "the edges are named for the view").not.toBeNull();
    expect(meta("rel.devices")).toBe(meta("fts.devices"));
    expect(edges()).toBeGreaterThan(0);

    // the same levels again, and another setting: no pass
    expect(
      (
        await w.call("PUT", "/api/settings", {
          folderAccess: [{ path: fin, agents: "write", devices: "hide" }],
        })
      ).status,
    ).toBe(200);
    expect((await w.call("PUT", "/api/settings", { language: "pt-BR" })).status).toBeLessThan(300);
    await idle(w);
    expect(finished.length, "no pass for what did not change the levels").toBe(1);

    // shown again: a pass, and the copy is emptied
    expect((await w.call("PUT", "/api/settings", { folderAccess: [] })).status).toBe(200);
    await idle(w);
    expect(finished.length).toBe(2);
    expect(meta("rel.devices")).toBeNull();
    expect(edges()).toBe(0);
    off();
  });
});

// ---- C184: the cleanup inventory's groups ---------------------------------------------------------------------------------

describe("C184 the groups of the cleanup inventory a device is given", () => {
  it("C184 a device's inventory groups notes by the edges of its own view: the twin's, and not the owner's whole-corpus edges", async () => {
    const { w, fin } = await seeded("mordomo-round3-c184-");
    const outra = path.join(w.memory, "notes", "outra");
    // two notes that share three words that the hidden notes hold too: over the whole corpus those weigh nothing and the
    // pair is not joined; without the hidden notes it is
    w.put(
      path.join(outra, "a.md"),
      "# A\n\nzeta planeta orbita zeta planeta orbita zeta planeta orbita aaa1 aaa2 aaa3\n",
    );
    w.put(
      path.join(outra, "b.md"),
      "# B\n\nzeta planeta orbita zeta planeta orbita zeta planeta orbita bbb1 bbb2 bbb3\n",
    );
    for (let i = 0; i < 6; i++)
      w.put(path.join(outra, `cheio-${i}.md`), `# Cheio ${i}\n\n${"palavra ".repeat(20)} unico${i}x\n`);
    for (let i = 0; i < 40; i++)
      w.put(
        path.join(fin, `h${i}.md`),
        `# H${i}\n\nplaneta orbita zeta ruido${i}a ruido${i}b ruido${i}c ruido${i}d ruido${i}e\n`,
      );
    await w.index();
    const url = `/api/memory/cleanup/inventory?dir=${encodeURIComponent(outra)}`;
    const groups = (body: Json) =>
      (body.clusters as Json[]).filter((c) => c.kind === "related").map((c) => [c.count, c.terms]);
    const whole = groups((await w.call("GET", url)).body);
    await setAccess(w, [{ path: fin, agents: "write", devices: "hide" }]);
    await w.index();
    const device = w.device(["content"]);
    const seen = groups((await w.call("GET", url, undefined, device)).body);
    // the twin: the owner with the folder excluded and the edges worked out from nothing
    await setAccess(w, []);
    w.update((s) => {
      s.excludes = [...s.excludes, "fin"];
    });
    await w.index();
    w.ctx.indexer.refreshRelated(
      new Set((w.ctx.db.prepare("SELECT id FROM files").all() as Array<{ id: number }>).map((r) => r.id)),
    );
    const twin = groups((await w.call("GET", url)).body);
    expect(twin.length, "without the hidden notes the pair is a group").toBeGreaterThan(0);
    expect(whole, "over the whole corpus it is not").not.toEqual(twin);
    expect(seen).toEqual(twin);
  });
});
