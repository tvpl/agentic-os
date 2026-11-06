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
