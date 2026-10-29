import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentRun } from "@mordomo/core";
import { seedHome } from "@mordomo/core/internal";
import { ClaudeAdapter } from "@mordomo/adapter-claude";
import { AppContext } from "../apps/api/src/context.js";
import { defaultSettings, type Settings } from "../core/src/config/schema.js";
import { FolderNotIndexedError, folderVerdict } from "../core/src/runs/protectedFolder.js";
import { FAKE_BIN, makeTempHome, withFakeBinPath } from "./helpers.js";
import { repoRoot } from "./helpers/organizeWorld.js";

/**
 * .specs/features/cerebro-organizar, the decisions at their own layer (checks.md, Test policy rows 1 and 2), with no
 * HTTP. Batch A: the folder verdict of door 5 (`folderVerdict`), the folders the `RunManager` hands a run with a
 * protected folder (door 9), and where a run of a work context gets its folder (`Execution.startSkill`). The HTTP side
 * of each claim is in `organize.runs.test.ts`.
 */

const POSIX = process.platform !== "win32";
const SLUG = "organize-brain";
const real = (p: string) => fs.realpathSync(p);

let temp: ReturnType<typeof makeTempHome>;
let work: string;
let outside: string;
let seq = 0;
const dir = (name: string, base = work): string => {
  const full = path.join(base, `${name}-${++seq}`);
  fs.mkdirSync(full, { recursive: true });
  return full;
};

/** The error a call throws, so its class, code and status can each be asserted. */
function thrown(fn: () => unknown): Error & { code?: string; statusCode?: number } {
  try {
    fn();
  } catch (err) {
    return err as Error & { code?: string; statusCode?: number };
  }
  throw new Error("expected the call to throw");
}

beforeAll(() => {
  temp = makeTempHome("mordomo-organize-layer-");
  work = real(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-organize-layer-work-")));
  outside = real(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-organize-layer-outside-")));
});
afterAll(() => {
  temp.cleanup();
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

function settingsWith(change: (s: Settings) => void = () => undefined): Settings {
  const s = defaultSettings();
  s.indexedFolders = [{ path: work, area: null, enabled: true }];
  change(s);
  return s;
}

describe.skipIf(!POSIX)("door 5 at its own layer: the folder verdict", () => {
  it("C15 own layer: folderVerdict refuses each of the 7 kinds with folder_not_indexed naming the folder, and gives the real path of an accepted one", () => {
    const off = dir("desligada", outside);
    const inOff = dir("dentro", off);
    const excluded = dir("excluida");
    const secret = path.join(work, ".ssh");
    fs.mkdirSync(secret, { recursive: true });
    const linked = dir("com-link");
    fs.symlinkSync(path.join(temp.paths.home, "config"), path.join(linked, "cfg"));
    const settings = settingsWith((s) => {
      s.indexedFolders.push({ path: off, area: null, enabled: false });
      s.excludes = [...s.excludes, path.basename(excluded)];
    });
    const env = { paths: temp.paths, settings };
    const refused: Array<[string, string]> = [
      ["outside every indexed folder", dir("longe", outside)],
      ["inside a disabled indexed folder", inOff],
      ["the home's config/", path.join(temp.paths.home, "config")],
      ["the home's logs/", path.join(temp.paths.home, "logs")],
      ["a user exclude", excluded],
      ["a secret name", secret],
      ["a link into config/", linked],
    ];
    for (const [what, folder] of refused) {
      const err = thrown(() => folderVerdict(env, folder));
      expect(err, what).toBeInstanceOf(FolderNotIndexedError);
      expect(err.code, what).toBe("folder_not_indexed");
      expect(err.statusCode, what).toBe(400);
      expect(err.message, what).toContain(folder);
    }
    // accepted: a folder of an enabled indexed folder (by its real path, through a link) and one under memory/
    const clientes = dir("clientes");
    const alias = path.join(outside, `alias-${++seq}`);
    fs.symlinkSync(clientes, alias);
    expect(folderVerdict(env, clientes)).toBe(real(clientes));
    expect(folderVerdict(env, alias)).toBe(real(clientes));
    const notes = path.join(temp.paths.memory, "notes", "projetos");
    fs.mkdirSync(notes, { recursive: true });
    expect(folderVerdict(env, notes)).toBe(real(notes));
  });
});

describe.skipIf(!POSIX)("doors 5 and 9 at their own layer: the run's folders, with no HTTP", () => {
  let ctx: AppContext;
  let restorePath: () => void;
  const handed = new Map<string, AgentRun>();
  let skillDir: string;
  let workspace: string;

  beforeAll(() => {
    restorePath = withFakeBinPath();
    seedHome(temp.paths, repoRoot);
    ctx = new AppContext(temp.paths.home);
    const s = ctx.settings();
    s.setupCompleted = true;
    s.securityProfile = "controlled_write";
    s.indexedFolders = [{ path: work, area: null, enabled: true }];
    s.providers.claude.enabled = true;
    s.providers.claude.binaryPath = path.join(FAKE_BIN, "claude");
    ctx.settingsStore.save(s);
    ctx.reloadAdapters();
    const execute = ClaudeAdapter.prototype.execute;
    vi.spyOn(ClaudeAdapter.prototype, "execute").mockImplementation(function (
      this: ClaudeAdapter,
      run: AgentRun,
    ) {
      handed.set(run.runId, run);
      return execute.call(this, run);
    });
    skillDir = real(path.join(temp.paths.skills, SLUG));
    workspace = real(ctx.runs.defaultCwd());
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await ctx.runs.shutdown(2000);
    ctx.close();
    restorePath();
  });

  /** A skill run created and executed on the RunManager itself, as a routine or an approval would. */
  async function launched(
    inputs: Record<string, string>,
    extra: Record<string, unknown> = {},
  ): Promise<AgentRun> {
    const record = ctx.runs.create({
      origin: "skill",
      provider: "claude",
      prompt: "go",
      request: { version: 1, kind: "skill", skillSlug: SLUG, inputs, mode: "write" },
      model: null,
      effort: "default",
      mode: "write",
      timeoutMs: 30_000,
      profile: "controlled_write",
      skillSlug: SLUG,
      startedBy: null,
      ...extra,
    } as never);
    await ctx.runs.execute(record.id, "go", "write");
    const agent = handed.get(record.id);
    expect(agent, "the agent was handed the run").toBeDefined();
    return agent!;
  }

  it("C13 own layer: the RunManager starts a run with a folder in <home>/workspace, hands skill, memory and folder, and protects skill and folder", async () => {
    const clientes = dir("clientes");
    const agent = await launched({ folder: clientes }, { cwd: clientes });
    expect(agent.cwd).toBe(workspace);
    expect(agent.readDirs).toEqual([skillDir, real(temp.paths.memory), real(clientes)]);
    expect(agent.protectedDirs).toEqual([skillDir, real(clientes)]);
    // a folder under memory/ is already in memory/: handed once, never protected
    const notes = path.join(temp.paths.memory, "notes", "c13");
    fs.mkdirSync(notes, { recursive: true });
    const inMemory = await launched({ folder: notes });
    expect(inMemory.readDirs).toEqual([skillDir, real(temp.paths.memory)]);
    expect(inMemory.protectedDirs).toEqual([skillDir]);
    // without a folder: what a memory skill always had
    const bare = await launched({});
    expect(bare.readDirs).toEqual([skillDir, real(temp.paths.memory)]);
    expect(bare.protectedDirs).toEqual([skillDir]);
  });

  it("C44 own layer: startSkill with contextId and no folder takes the first ok path as the folder; the RunManager protects every ok path, not the notes", async () => {
    const gone = dir("sumiu");
    const second = dir("segunda");
    const third = dir("terceira");
    const id = `camada-c44-${++seq}`;
    const s = ctx.settings();
    s.contexts = [...s.contexts, { id, name: "Camada C44", paths: [gone, second, third] }];
    ctx.settingsStore.save(s);
    fs.rmSync(gone, { recursive: true, force: true });
    const notes = path.join(temp.paths.memory, "notes", id);
    fs.mkdirSync(notes, { recursive: true });

    const started = ctx.execution.startSkill({
      slug: SLUG,
      inputs: { etapa: "indexar" },
      contextId: id,
      startedBy: null,
    });
    expect(started.status).toBe("queued");
    const record = await ctx.execution.wait(started.runId);
    expect(record.contextId).toBe(id);
    expect(record.cwd).toBe(workspace);
    expect(record.request).toMatchObject({ kind: "skill", inputs: { etapa: "indexar", folder: second } });
    const agent = handed.get(started.runId)!;
    expect(agent.cwd).toBe(workspace);
    expect(agent.readDirs).toEqual([
      skillDir,
      real(temp.paths.memory),
      real(second),
      real(third),
      real(notes),
    ]);
    expect(agent.protectedDirs).toEqual([skillDir, real(second), real(third)]);
    expect(agent.prompt.split("\n")).toContain(`Folder to organize (read-only): ${real(second)}`);
  });
});
