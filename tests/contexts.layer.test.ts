import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentAdapter, AgentRun } from "@mordomo/core";
import { ClaudeAdapter } from "@mordomo/adapter-claude";
import { AppContext } from "../apps/api/src/context.js";
import { defaultSettings, type Settings, type WorkContext } from "../core/src/config/schema.js";
import {
  ContextNotFoundError,
  ContextUnavailableError,
  ContextValidationError,
  changedContext,
  contextMembership,
  contextPathStates,
  contextPromptBlock,
  insideContext,
  newContext,
  type ContextEnv,
} from "../core/src/memory/contexts.js";
import { RunManager } from "../core/src/runs/runManager.js";
import { FAKE_BIN, makeTempHome, withFakeBinPath } from "./helpers.js";

/**
 * .specs/features/cerebro-contextos, the decisions at their own layer (checks.md, Test policy row 1 and row 2): the
 * path rules, the path states and the membership of door 6 called on `core/src/memory/contexts.ts` itself; where a run
 * of a context starts, called on the execution service (`Execution.startPrompt` / `startSkill`, no HTTP); the folders
 * a run is handed, read where the `RunManager` hands them to the adapter; and the prompt block, built by
 * `contextPromptBlock` and `SkillCatalog.buildRunPrompt`. The HTTP side of each claim is in `contexts.test.ts` and
 * `contexts.runs.test.ts`. Each case is written from the check and the decision table of the plan, one row each.
 */

let temp: ReturnType<typeof makeTempHome>;
/** An indexed folder outside the home. */
let work: string;
/** A folder outside every indexed folder and outside memory/. */
let outside: string;
const cleanups: Array<() => void> = [];

let seq = 0;
const dir = (name: string, base = work): string => {
  const full = path.join(base, `${name}-${++seq}`);
  fs.mkdirSync(full, { recursive: true });
  return full;
};
const put = (file: string, text: string): string => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};
const real = (p: string) => fs.realpathSync(p);

/** Settings with `work` indexed, changed for one case. */
function settingsWith(change: (s: Settings) => void = () => undefined): Settings {
  const s = defaultSettings();
  s.indexedFolders = [{ path: work, area: null, enabled: true }];
  change(s);
  return s;
}
const envOf = (settings: Settings, platform?: NodeJS.Platform): ContextEnv => ({
  paths: temp.paths,
  settings,
  ...(platform ? { platform } : {}),
});
const ctxOf = (paths: string[], id = `ctx-${++seq}`, name = `Contexto ${seq}`): WorkContext => ({
  id,
  name,
  paths,
});

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
  temp = makeTempHome("mordomo-contexts-layer-");
  work = real(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-contexts-layer-work-")));
  outside = real(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-contexts-layer-outside-")));
  cleanups.push(() => fs.rmSync(work, { recursive: true, force: true }));
  cleanups.push(() => fs.rmSync(outside, { recursive: true, force: true }));
});

afterAll(() => {
  temp.cleanup();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("contexts.ts at its own layer: the paths a context may have (door 1, AC 3)", () => {
  it("C3 own layer: newContext and changedContext refuse each kind of path with context_path_not_indexed naming it, and take a folder of an indexed folder or of memory/", () => {
    const home = temp.paths.home;
    fs.mkdirSync(path.join(home, "logs"), { recursive: true });
    const excluded = dir("escondida");
    // A folder (not a file) whose name the secret-file rule refuses.
    const secretFolder = path.join(dir("chaves"), "cofre.pem");
    fs.mkdirSync(secretFolder);
    const linky = dir("linky");
    fs.symlinkSync(path.join(home, "config"), path.join(linky, "cfg"));
    // The home is an indexed folder too, so its config/ and logs/ are refused by the policy, not for being outside.
    const settings = settingsWith((s) => {
      s.indexedFolders.push({ path: home, area: null, enabled: true });
      s.excludes = [...s.excludes, path.basename(excluded)];
    });
    const env = envOf(settings);
    const refused: Array<[string, string, RegExp]> = [
      ["outside every folder", dir("fora", outside), /Not inside an enabled indexed folder or memory/],
      ["the home's config/", path.join(home, "config"), /config/],
      ["the home's logs/", path.join(home, "logs"), /logs/],
      ["a user exclude", excluded, /exclusion list/],
      ["a folder with a secret name", secretFolder, /secret-file blocklist/],
      ["a folder holding a link into config/", linky, /link into the MordomoOS config\/ or logs\//],
    ];
    const current = ctxOf([dir("atual")], "atual");
    settings.contexts = [current];
    for (const [kind, p, why] of refused) {
      for (const call of [
        () => newContext(env, { name: `Recusado ${kind}`, paths: [p] }),
        () => changedContext(env, current.id, { paths: [p] }),
      ]) {
        const err = thrown(call);
        expect(err, kind).toBeInstanceOf(ContextValidationError);
        expect(err.code, kind).toBe("context_path_not_indexed");
        expect(err.statusCode, kind).toBe(400);
        expect(err.message, kind).toContain(p);
        expect(err.message, kind).toMatch(why);
      }
    }
    // ...and the case each refusal sits beside: a subfolder of an indexed folder, and a folder of memory/.
    const ok = dir("aceita");
    const notes = dir("notas", temp.paths.memory);
    expect(newContext(env, { name: "Aceita", paths: [ok, notes] })).toEqual({
      id: "aceita",
      name: "Aceita",
      paths: [ok, notes],
    });
    expect(changedContext(env, current.id, { paths: [notes] })).toEqual({ ...current, paths: [notes] });
  });
});

describe("contexts.ts at its own layer: the state of each path (AC 7)", () => {
  it("C7 own layer: contextPathStates says ok, missing for a folder gone, and not_indexed for a disabled folder, an exclude and a folder outside", () => {
    const okWork = dir("ok");
    const okMemory = dir("ok", temp.paths.memory);
    const gone = dir("sumiu");
    fs.rmSync(gone, { recursive: true });
    const otherRoot = real(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-contexts-layer-other-")));
    cleanups.push(() => fs.rmSync(otherRoot, { recursive: true, force: true }));
    const disabled = dir("desligada", otherRoot);
    const excluded = dir("escondida");
    const away = dir("longe", outside);
    const env = envOf(
      settingsWith((s) => {
        s.indexedFolders.push({ path: otherRoot, area: null, enabled: false });
        s.excludes = [...s.excludes, path.basename(excluded)];
      }),
    );
    expect(contextPathStates(env, ctxOf([okWork, okMemory, gone, disabled, excluded, away]))).toEqual([
      { path: okWork, state: "ok" },
      { path: okMemory, state: "ok" },
      { path: gone, state: "missing" },
      { path: disabled, state: "not_indexed" },
      { path: excluded, state: "not_indexed" },
      { path: away, state: "not_indexed" },
    ]);
  });
});

describe("contexts.ts at its own layer: who belongs to a context (door 6, AC 10)", () => {
  it("C10 own layer: a file belongs when its real path is a context path or starts with one and the separator; a sibling with the same prefix does not", () => {
    const app = dir("app");
    const sibling = `${app}-antigo`;
    fs.mkdirSync(sibling);
    put(path.join(app, "a.md"), "# a\n");
    put(path.join(app, "sub", "b.md"), "# b\n");
    put(path.join(sibling, "c.md"), "# c\n");
    put(`${app}.md`, "# next to it\n");
    const env = envOf(settingsWith());
    const context = ctxOf([app]);
    const member = contextMembership(env, context);
    const rel = (p: string) => path.relative(work, p);
    // equal: the context path itself
    expect(member({ root: work, rel: rel(app) })).toBe(true);
    expect(insideContext(env, context, app)).toBe(true);
    // a child, followed by the separator, at any depth
    expect(member({ root: work, rel: rel(path.join(app, "a.md")) })).toBe(true);
    expect(member({ root: app, rel: path.join("sub", "b.md") })).toBe(true);
    expect(insideContext(env, context, path.join(app, "sub"))).toBe(true);
    // a sibling whose name starts like it, and a file next to it with the same prefix: not the context's
    expect(member({ root: work, rel: rel(path.join(sibling, "c.md")) })).toBe(false);
    expect(member({ root: work, rel: `${path.basename(app)}.md` })).toBe(false);
    expect(insideContext(env, context, sibling)).toBe(false);
    // by real path: a folder reached through a link into the context is the context's
    const alias = path.join(work, `alias-${++seq}`);
    fs.symlinkSync(app, alias);
    expect(member({ root: alias, rel: "a.md" })).toBe(true);
    expect(insideContext(env, context, path.join(alias, "sub"))).toBe(true);
    // (the last name of a row is never a link: the indexer skips links, and the callers of insideContext resolve it)
    // a path that is not ok contributes nothing (AC 16)
    const gone = dir("sumiu");
    put(path.join(gone, "d.md"), "# d\n");
    const withGone = ctxOf([gone, app]);
    fs.rmSync(gone, { recursive: true });
    expect(contextMembership(env, withGone)({ root: gone, rel: "d.md" })).toBe(false);
    expect(contextMembership(env, withGone)({ root: app, rel: "a.md" })).toBe(true);
    // no ok path at all: nothing belongs
    expect(contextMembership(env, ctxOf([gone]))({ root: app, rel: "a.md" })).toBe(false);
  });

  it("C10 own layer: names are compared as the platform compares them, case-folded on macOS and Windows and exact on Linux", () => {
    const app = dir("projeto");
    put(path.join(app, "a.md"), "# a\n");
    const shouted = path.join(work, path.basename(app).toUpperCase());
    expect(shouted).not.toBe(app);
    const context = ctxOf([app]);
    const row = { root: shouted, rel: "a.md" };
    for (const platform of ["darwin", "win32"] as const) {
      expect(contextMembership(envOf(settingsWith(), platform), context)(row), platform).toBe(true);
      expect(insideContext(envOf(settingsWith(), platform), context, shouted), platform).toBe(true);
    }
    expect(contextMembership(envOf(settingsWith(), "linux"), context)(row)).toBe(false);
    expect(insideContext(envOf(settingsWith(), "linux"), context, shouted)).toBe(false);
    // the same rule never joins a sibling, in any case
    const sibling = `${app}-ANTIGO`;
    expect(contextMembership(envOf(settingsWith(), "darwin"), context)({ root: sibling, rel: "a.md" })).toBe(
      false,
    );
  });
});

describe("contexts.ts at its own layer: the block a run of a context begins with (AC 21)", () => {
  it("C21 own layer: contextPromptBlock names the context, each path with (main), (missing) and (not indexed), the map, the brief's first 2 000 characters and the router", () => {
    const main = dir("principal");
    const gone = dir("sumiu");
    fs.rmSync(gone, { recursive: true });
    const away = dir("longe", outside);
    const env = envOf(settingsWith());
    const context = ctxOf([main, gone, away], `bloco-${++seq}`, "Projeto do bloco");
    const map = path.join(temp.paths.memory, "contexts", `${context.id}.md`);
    const router = path.join(temp.paths.memory, "ROUTER.md");

    const bare = contextPromptBlock(env, context).split("\n");
    expect(bare[0]).toBe("Work context: Projeto do bloco");
    expect(bare).toContain(`- ${main} (main)`);
    expect(bare).toContain(`- ${gone} (missing)`);
    expect(bare).toContain(`- ${away} (not indexed)`);
    expect(bare.some((l) => l.includes(map))).toBe(true);
    expect(bare.some((l) => l.includes("Brief of the context"))).toBe(false);
    expect(bare[bare.length - 1]).toContain(router);

    const brief = put(
      path.join(temp.paths.memory, "notes", context.id, "_resumo.md"),
      `${"a".repeat(1999)}Z${"b".repeat(500)}`,
    );
    const block = contextPromptBlock(env, context);
    expect(block).toContain(brief);
    expect(block).toContain(`${"a".repeat(1999)}Z`);
    expect(block).not.toContain(`Zb`);
  });

  it("C21 own layer: SkillCatalog.buildRunPrompt puts the context block before everything else, and without one starts as before", () => {
    const ctx = new AppContext(temp.paths.home);
    try {
      put(
        path.join(temp.paths.skills, "bloco-teste", "SKILL.md"),
        "---\nname: Bloco teste\ndescription: Say what is there.\nmode: read_only\nproviders: [claude]\n---\n\n# Bloco teste\n\nSay it.\n",
      );
      const skill = ctx.skills.load("bloco-teste")!;
      expect(skill).toBeTruthy();
      const block = contextPromptBlock(envOf(settingsWith()), ctxOf([dir("bloco")], "bloco-skill", "Bloco"));
      const artifacts = path.join(temp.paths.home, "artifacts-test");
      const withBlock = ctx.skills.buildRunPrompt(skill, {}, artifacts, block);
      const without = ctx.skills.buildRunPrompt(skill, {}, artifacts);
      expect(withBlock.startsWith(`${block}\n`)).toBe(true);
      expect(withBlock.endsWith(without)).toBe(true);
      expect(without.startsWith('You are executing the "Bloco teste" skill')).toBe(true);
      expect(without).not.toContain("Work context:");
    } finally {
      ctx.close();
    }
  });
});

describe("the run of a context at its own layer: where it starts and what it is handed (AC 17-20, AC 23)", () => {
  let ctx: AppContext;
  let restorePath: () => void;
  const SKILL = "contexto-camada";
  const runCount = () => (ctx.db.prepare("SELECT COUNT(*) c FROM runs").get() as { c: number }).c;
  const setContexts = (contexts: WorkContext[]) => ctx.settingsStore.update({ contexts });
  const prompt = (body: Record<string, unknown>) =>
    ctx.execution.startPrompt({ prompt: "o que há aqui?", startedBy: null, ...body } as never);
  const skill = (body: Record<string, unknown>) =>
    ctx.execution.startSkill({ slug: SKILL, startedBy: null, ...body } as never);
  const cwdOf = async (runId: string) => {
    await ctx.execution.wait(runId);
    return ctx.runs.get(runId)!;
  };

  beforeAll(() => {
    restorePath = withFakeBinPath();
    ctx = new AppContext(temp.paths.home);
    const settings = ctx.settings();
    settings.setupCompleted = true;
    settings.indexedFolders = [{ path: work, area: null, enabled: true }];
    settings.providers.claude.enabled = true;
    settings.providers.claude.binaryPath = path.join(FAKE_BIN, "claude");
    ctx.settingsStore.save(settings);
    ctx.reloadAdapters();
    put(
      path.join(temp.paths.skills, SKILL, "SKILL.md"),
      "---\nname: Contexto camada\ndescription: Read the folder.\nmode: read_only\nproviders: [claude]\n---\n\n# Contexto camada\n\nSay what is there.\n",
    );
  });
  afterAll(async () => {
    await ctx.runs.shutdown(2000);
    ctx.close();
    restorePath();
  });

  it("C17 own layer: with a contextId and no cwd, the prompt and the skill start in the real path of the first ok path and record the id", async () => {
    const gone = dir("sumiu");
    const first = dir("principal");
    const second = dir("segunda");
    setContexts([ctxOf([gone, first, second], "camada-c17")]);
    fs.rmSync(gone, { recursive: true });
    for (const start of [prompt, skill]) {
      const run = await cwdOf(start({ contextId: "camada-c17" }).runId);
      expect(run.cwd).toBe(real(first));
      expect(run.contextId).toBe("camada-c17");
    }
  });

  it("C19 own layer: a given cwd inside a context path wins over the first ok path; one outside every context path is 400 validation and records nothing", async () => {
    const first = dir("principal");
    const second = dir("segunda");
    const inside = dir("dentro", second);
    const elsewhere = dir("fora-do-contexto");
    setContexts([ctxOf([first, second], "camada-c19")]);
    for (const start of [prompt, skill]) {
      expect((await cwdOf(start({ contextId: "camada-c19", cwd: inside }).runId)).cwd).toBe(real(inside));
      expect((await cwdOf(start({ contextId: "camada-c19", cwd: second }).runId)).cwd).toBe(real(second));
      const before = runCount();
      const err = thrown(() => start({ contextId: "camada-c19", cwd: elsewhere }));
      expect(err).toBeInstanceOf(ContextValidationError);
      expect(err.code).toBe("validation");
      expect(err.statusCode).toBe(400);
      expect(runCount()).toBe(before);
    }
  });

  it("C20 own layer: an id that names no context is 404 context_not_found and a context with no ok path 409 context_unavailable, recording nothing", () => {
    const gone = dir("sumiu");
    const away = dir("longe", outside);
    setContexts([ctxOf([gone, away], "camada-c20")]);
    fs.rmSync(gone, { recursive: true });
    for (const start of [prompt, skill]) {
      const before = runCount();
      const unknown = thrown(() => start({ contextId: "nao-existe" }));
      expect(unknown).toBeInstanceOf(ContextNotFoundError);
      expect(unknown.code).toBe("context_not_found");
      expect(unknown.statusCode).toBe(404);
      const none = thrown(() => start({ contextId: "camada-c20" }));
      expect(none).toBeInstanceOf(ContextUnavailableError);
      expect(none.code).toBe("context_unavailable");
      expect(none.statusCode).toBe(409);
      // ...even with a cwd given: there is nowhere in the context it could be
      expect(thrown(() => start({ contextId: "camada-c20", cwd: work }))).toBeInstanceOf(
        ContextUnavailableError,
      );
      expect(runCount()).toBe(before);
    }
  });

  it("C23 own layer: a continued conversation keeps its folder while it is inside the context, else starts in the first ok path, and keeps the context's id", async () => {
    const first = dir("principal");
    const second = dir("segunda");
    setContexts([ctxOf([first, second], "camada-c23")]);
    const opened = prompt({ contextId: "camada-c23", cwd: second });
    expect((await cwdOf(opened.runId)).cwd).toBe(real(second));
    const sessionId = opened.sessionId!;
    const kept = await cwdOf(prompt({ sessionId }).runId);
    expect(kept.cwd).toBe(real(second));
    expect(kept.contextId).toBe("camada-c23");
    // the folder of the conversation is no longer a path of the context: the first ok path
    setContexts([ctxOf([first], "camada-c23")]);
    const moved = await cwdOf(prompt({ sessionId }).runId);
    expect(moved.cwd).toBe(real(first));
    expect(moved.contextId).toBe("camada-c23");
  });

  it("C18 own layer: the RunManager hands the skill's folder, then the other ok paths in their order, then the notes folder when it exists", async () => {
    const seen: AgentRun[] = [];
    const adapter = new ClaudeAdapter({ binaryPath: path.join(FAKE_BIN, "claude") });
    const spy = new Proxy(adapter, {
      get(target, prop) {
        if (prop === "execute")
          return (run: AgentRun) => {
            seen.push(run);
            return target.execute(run);
          };
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as unknown as AgentAdapter;
    const manager = new RunManager(
      ctx.db,
      ctx.paths,
      () => ctx.settings(),
      () => spy,
      { pruneOnBoot: false },
    );
    const handed = async (extra: Record<string, unknown>) => {
      const record = manager.create({
        origin: "manual",
        provider: "claude",
        prompt: "go",
        model: null,
        effort: "default",
        mode: "read_only",
        timeoutMs: 30_000,
        profile: "read_only",
        startedBy: null,
        ...extra,
      } as never);
      await manager.execute(record.id, "go", "read_only");
      return seen[seen.length - 1]!;
    };

    const a = dir("a");
    const gone = dir("sumiu");
    const b = dir("b");
    const c = dir("c");
    const away = dir("longe", outside);
    const id = "camada-c18";
    setContexts([ctxOf([a, gone, b, away, c], id)]);
    fs.rmSync(gone, { recursive: true });

    // No notes folder yet: the ok paths other than the working one, in the context's order.
    expect((await handed({ cwd: a, contextId: id })).readDirs).toEqual([real(b), real(c)]);
    expect((await handed({ cwd: b, contextId: id })).readDirs).toEqual([real(a), real(c)]);
    // With memory/notes/<id>/: it comes last.
    const notes = path.join(temp.paths.memory, "notes", id);
    fs.mkdirSync(notes, { recursive: true });
    expect((await handed({ cwd: a, contextId: id })).readDirs).toEqual([real(b), real(c), real(notes)]);
    // A skill run: the skill's own folder first.
    const run = await handed({ cwd: c, contextId: id, origin: "skill", skillSlug: SKILL });
    expect(run.readDirs).toEqual([real(path.join(temp.paths.skills, SKILL)), real(a), real(b), real(notes)]);
    // No context, or a context deleted since: nothing added.
    expect((await handed({ cwd: a })).readDirs).toBeUndefined();
    setContexts([]);
    expect((await handed({ cwd: a, contextId: id })).readDirs).toBeUndefined();
  });
});
