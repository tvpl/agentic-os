import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentRun } from "@mordomo/core";
import { seedHome } from "@mordomo/core/internal";
import { ClaudeAdapter } from "@mordomo/adapter-claude";
import { AppContext } from "../apps/api/src/context.js";
import { defaultSettings, type Settings } from "../core/src/config/schema.js";
import { claudeManifest } from "@mordomo/adapter-claude";
import { codexManifest } from "@mordomo/adapter-codex";
import { cursorManifest } from "@mordomo/adapter-cursor";
import {
  FolderNotIndexedError,
  FolderProtectionUnsupportedError,
  assertProtectsDirs,
  folderVerdict,
  takesFolder,
} from "../core/src/runs/protectedFolder.js";
import { childrenDigest, folderDigests, rootSlug } from "../core/src/memory/maps.js";
import { parseFrontMatter } from "../core/src/memory/frontMatter.js";
import { fileRowFromDb } from "../core/src/memory/indexer.js";
import { extractGoals } from "../core/src/sync/compiler.js";
import { FAKE_BIN, makeTempHome, withFakeBinPath } from "./helpers.js";
import { repoRoot } from "./helpers/organizeWorld.js";

/**
 * .specs/features/cerebro-organizar, the decisions at their own layer (checks.md, Test policy rows 1 and 2), with no
 * HTTP. Batch A: the folder verdict of door 5 (`folderVerdict`), the folders the `RunManager` hands a run with a
 * protected folder (door 9), and where a run of a work context gets its folder (`Execution.startSkill`). The HTTP side
 * of each claim is in `organize.runs.test.ts`. Batch B: the digest of door 4 (`childrenDigest`), the state of an index
 * note (`folderDigests`), the root slug of door 8 (`rootSlug`), the front matter of door 6 (`parseFrontMatter` and the
 * indexer's `fields`) and the goals of door 7; their HTTP side is in `organize.maps.test.ts` and `organize.sync.test.ts`.
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

describe("door 5 at its own layer: the provider capability and the memory-skill test", () => {
  it("C16 own layer: assertProtectsDirs lets only a manifest declaring protectsDirs true through, and refuses false, absent and an unknown provider with folder_protection_unsupported", () => {
    expect(() => assertProtectsDirs(claudeManifest, "claude")).not.toThrow();
    const refused: Array<[string, Parameters<typeof assertProtectsDirs>[0], string, string]> = [
      ["codex, protectsDirs false", codexManifest, "codex", codexManifest.displayName],
      ["cursor, protectsDirs false", cursorManifest, "cursor", cursorManifest.displayName],
      [
        "a manifest without the field",
        { displayName: "Sem campo", capabilities: {} },
        "sem-campo",
        "Sem campo",
      ],
      ["no manifest at all", undefined, "fantasma", "fantasma"],
    ];
    for (const [what, manifest, provider, named] of refused) {
      const err = thrown(() => assertProtectsDirs(manifest, provider));
      expect(err, what).toBeInstanceOf(FolderProtectionUnsupportedError);
      expect(err.code, what).toBe("folder_protection_unsupported");
      expect(err.statusCode, what).toBe(409);
      expect(err.message, what).toContain(named);
    }
  });

  it("C18 own layer: takesFolder is true only for a memory skill that declares the input folder", () => {
    const folder = { name: "folder" };
    const etapa = { name: "etapa" };
    const rows: Array<[string, { memoryAccess: boolean; inputs: Array<{ name: string }> }, boolean]> = [
      ["memory skill with folder", { memoryAccess: true, inputs: [etapa, folder] }, true],
      ["memory skill without folder", { memoryAccess: true, inputs: [etapa] }, false],
      ["not a memory skill, with folder", { memoryAccess: false, inputs: [etapa, folder] }, false],
      ["not a memory skill, without folder", { memoryAccess: false, inputs: [] }, false],
    ];
    for (const [what, skill, expected] of rows) expect(takesFolder(skill), what).toBe(expected);
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

const sha256 = (text: string) => crypto.createHash("sha256").update(text).digest("hex");

describe("door 4 at its own layer: the digest of a folder's children", () => {
  it("C25 own layer: childrenDigest is sha256: of the sorted d:/f: names, whatever order they come in", () => {
    const want = `sha256:${sha256("d:sub\nf:a.md\nf:b.md")}`;
    expect(childrenDigest(["sub"], ["b.md", "a.md"])).toBe(want);
    expect(childrenDigest(new Set(["sub"]), new Set(["a.md", "b.md"]))).toBe(want);
    // A folder and a file of the same name are two children, the folder first.
    expect(childrenDigest(["x"], ["x"])).toBe(`sha256:${sha256("d:x\nf:x")}`);
    expect(childrenDigest([], [])).toBe(`sha256:${sha256("")}`);
  });
});

describe("door 8 at its own layer: the slug of a root", () => {
  it("C32 own layer: rootSlug is the folded name, cut at 40, or pasta, then the first 8 hex of the root's SHA-256", () => {
    const cliente = "/srv/dono/Projetos Cliente";
    expect(rootSlug(cliente)).toBe(`projetos-cliente-${sha256(cliente).slice(0, 8)}`);
    const one = "/srv/a/Projetos";
    const two = "/srv/b/Projetos";
    expect(rootSlug(one)).toBe(`projetos-${sha256(one).slice(0, 8)}`);
    expect(rootSlug(two)).toBe(`projetos-${sha256(two).slice(0, 8)}`);
    expect(rootSlug(one)).not.toBe(rootSlug(two));
    const hashes = "/srv/###";
    expect(rootSlug(hashes)).toBe(`pasta-${sha256(hashes).slice(0, 8)}`);
    const long = `/srv/${"a".repeat(60)}`;
    expect(rootSlug(long)).toBe(`${"a".repeat(40)}-${sha256(long).slice(0, 8)}`);
    const accents = "/srv/Organização Útil";
    expect(rootSlug(accents)).toBe(`organizacao-util-${sha256(accents).slice(0, 8)}`);
  });
});

describe.skipIf(!POSIX)(
  "doors 3, 4 and 6 at their own layer: the state of an index note, and the fields",
  () => {
    let home: ReturnType<typeof makeTempHome>;
    let ctx: AppContext;
    let root: string;
    beforeAll(() => {
      home = makeTempHome("mordomo-organize-layer-maps-");
      root = real(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-organize-layer-root-")));
      ctx = new AppContext(home.paths.home);
      const s = ctx.settings();
      s.indexedFolders = [{ path: root, area: null, enabled: true }];
      ctx.settingsStore.save(s);
    });
    afterAll(() => {
      ctx.close();
      home.cleanup();
      fs.rmSync(root, { recursive: true, force: true });
    });
    const insert = (base: string, rel: string) => {
      const full = path.join(base, rel);
      ctx.db
        .prepare(
          "INSERT OR IGNORE INTO files (root, path, rel, name, ext, dir, area, size, mtime, indexed_at, title, tags, fields) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          base,
          full,
          rel,
          path.basename(full),
          path.extname(full),
          path.dirname(full),
          null,
          1,
          1,
          1,
          null,
          "[]",
          "{}",
        );
    };
    const note = (file: string, header: string[]) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, ["---", ...header, "---", "", "# Índice", ""].join("\n"));
    };

    it("C27 own layer: folderDigests says missing with no note, fresh when children-digest is the digest, stale with another or none", () => {
      for (const folder of ["sem-nota", "certa", "errada", "vazia-de-digest"])
        insert(root, path.join(folder, "a.md"));
      const memory = path.resolve(ctx.paths.memory);
      insert(memory, path.join("notes", "projeto", "n.md"));
      const env = { paths: ctx.paths, settings: ctx.settings() };
      const digest = childrenDigest([], ["a.md"]);
      const slugDir = path.join(ctx.paths.memory, "maps", rootSlug(root));
      note(path.join(slugDir, "certa", "_index.md"), ["type: index", `children-digest: ${digest}`]);
      note(path.join(slugDir, "errada", "_index.md"), [
        "type: index",
        `children-digest: sha256:${"1".repeat(64)}`,
      ]);
      note(path.join(slugDir, "vazia-de-digest", "_index.md"), ["type: index"]);
      note(path.join(memory, "notes", "projeto", "_index.md"), [
        `children-digest: ${childrenDigest([], ["n.md"])}`,
      ]);

      const map = folderDigests(ctx.db, env)!;
      const at = (p: string) => map.find((f) => f.path === p)!;
      expect(at(path.join(root, "sem-nota"))).toMatchObject({
        state: "missing",
        index: null,
        indexDigest: null,
      });
      expect(at(path.join(root, "certa"))).toMatchObject({
        state: "fresh",
        index: path.join(slugDir, "certa", "_index.md"),
        indexDigest: digest,
        digest,
      });
      expect(at(path.join(root, "errada"))).toMatchObject({
        state: "stale",
        indexDigest: `sha256:${"1".repeat(64)}`,
      });
      expect(at(path.join(root, "vazia-de-digest"))).toMatchObject({ state: "stale", indexDigest: null });
      expect(at(path.join(memory, "notes", "projeto"))).toMatchObject({
        state: "fresh",
        indexPath: path.join(memory, "notes", "projeto", "_index.md"),
      });
      // The root itself: four folders, no file of its own; its note would be at the top of its slug folder.
      expect(at(root)).toMatchObject({
        rel: "",
        children: 4,
        state: "missing",
        indexPath: path.join(slugDir, "_index.md"),
      });
      // memory/notes/ itself is no entry (nothing is written at its top, door 2), nor anything outside notes/.
      expect(map.some((f) => f.path === path.join(memory, "notes") || f.path === memory)).toBe(false);
      // A root nobody may ask for is null.
      expect(folderDigests(ctx.db, env, { root: path.join(root, "certa") })).toBeNull();
      expect(
        folderDigests(ctx.db, env, {
          root: path.join(root, "certa"),
          reach: [path.join(root, "certa")],
        })!.map((f) => f.path),
      ).toEqual([path.join(root, "certa")]);
    });

    it("C33 own layer: parseFrontMatter reads the seven keys up to 64 characters, and the indexer stores them in fields with the inline value winning", async () => {
      const v64 = "x".repeat(64);
      const header = parseFrontMatter(
        [
          "---",
          "title: Nota",
          "type: index",
          "status: active",
          "updated: 2026-10-29",
          "last_reviewed: '2026-10-29'",
          'natureza: "plano"',
          "escopo: equipe",
          `review_every: ${v64}y`,
          "children-digest: sha256:abc",
          "outra: coisa",
          "---",
          "",
        ].join("\n"),
      )!;
      expect(header.fields).toEqual({
        type: "index",
        status: "active",
        updated: "2026-10-29",
        last_reviewed: "2026-10-29",
        natureza: "plano",
        escopo: "equipe",
      });
      expect(header.childrenDigest).toBe("sha256:abc");
      expect(header.title).toBe("Nota");
      expect(parseFrontMatter(`---\nescopo: ${v64}\n---\n`)!.fields).toEqual({ escopo: v64 });

      const file = path.join(root, "campos", "n.md");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        "---\ntype: guide\nstatus: active\nnatureza: fato\n---\n\n# N\n\nstatus:: draft\ndono:: Ana\n",
      );
      await ctx.indexer.indexAllAsync();
      const row = ctx.db.prepare("SELECT * FROM files WHERE path = ?").get(file) as Record<string, unknown>;
      expect(fileRowFromDb(row).fields).toEqual({
        type: "guide",
        status: "draft",
        natureza: "fato",
        dono: "Ana",
      });
    });
  },
);

describe("door 7 at its own layer: the goals of metas.md", () => {
  it("C35 own layer: extractGoals takes the first 10 first-level items of ## Metas, each cut at 160, and leaves out nested items and what follows the section", () => {
    const long = "L".repeat(200);
    const items = Array.from({ length: 12 }, (_, i) => (i === 3 ? long : `Meta ${i + 1}`));
    const text = [
      "# Metas",
      "",
      "- antes da seção, não conta",
      "",
      "## Metas",
      "",
      ...items.flatMap((item, i) => (i === 1 ? [`- ${item}`, "  - aninhada", "\t- com tab"] : [`- ${item}`])),
      "",
      "### Uma subseção ainda dentro",
      "",
      "## Depois",
      "- fora",
    ].join("\n");
    expect(extractGoals(text)).toEqual(
      items.slice(0, 10).map((item, i) => (i === 3 ? long.slice(0, 160) : item)),
    );
    // Fewer than ten, numbered or starred, and the section ends at the next level-1 or level-2 heading.
    expect(extractGoals("## Metas\n\n1. Um\n* Dois\n+ Três\n\n# Fim\n- fora\n")).toEqual([
      "Um",
      "Dois",
      "Três",
    ]);
    // No ## Metas: no goals at all; an empty section: none listed.
    expect(extractGoals("# Metas\n\n- um\n")).toBeNull();
    expect(extractGoals("## Metas\n\nTexto corrido.\n")).toEqual([]);
  });
});
