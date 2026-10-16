import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PathAccessError } from "@mordomo/core";
import crypto from "node:crypto";
import {
  DEFAULT_COPY_LIMITS,
  EditConflictError,
  atomicWrite,
  ensureJournal,
  copyTreeWithoutLinks,
  homeReadScope,
  openWorkspaceFile,
  readScope,
  readWorkspaceText,
  resolveWorkspaceCwd,
  tightenMode,
  writeWorkspaceFile,
} from "@mordomo/core/internal";
import { type AgentAdapter, type AgentRun } from "@mordomo/core";
import { RunManager } from "@mordomo/core/internal";
import { ClaudeAdapter } from "@mordomo/adapter-claude";
import { AppContext } from "../apps/api/src/context.js";
import { startSecureServer, type SecureServer } from "./helpers/securityHarness.js";
import { FAKE_BIN, makeTempHome } from "./helpers.js";

/**
 * Security P1, round 3 (.specs/features/seguranca-p1, C41-C46): what a MordomoOS file write does when the path
 * is a link or a second name for the owner token, what an agent can reach from the folder it is started in,
 * and what a folder import copies. The route proofs plant a REAL link (symbolic and hard) to
 * `<home>/config/token` and ask, as a paired device and as the owner, whether the token is still the token.
 */

const POSIX = process.platform !== "win32";
const real = (p: string) => fs.realpathSync(p);
const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// ---------------------------------------------------------------------------
describe.skipIf(!POSIX)("C42-C43 the write primitive, and the hard link", () => {
  let base: string;
  let home: string;
  const TOKEN = "OWNER-TOKEN-0123456789abcdef0123456789abcdef0123456789abcdef";
  const tokenFile = () => path.join(home, "config", "token");
  const narrow = () => homeReadScope(home, [path.join(home, "memory")]);
  const wide = () => readScope({ homeDir: home, roots: [home] });
  const intact = (label: string) => expect(fs.readFileSync(tokenFile(), "utf8"), label).toBe(TOKEN);

  beforeAll(() => {
    base = real(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-writes-")));
    home = path.join(base, "home");
    write(tokenFile(), TOKEN);
    write(path.join(home, "logs", "runs.jsonl"), "PROMPT-SECRET");
    write(path.join(home, "memory", "note.md"), "NOTE");
  });
  afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

  it("C42 replaces, appends and creates inside the scope, and makes the folders on the way", () => {
    const file = path.join(home, "memory", "deep", "er", "w.md");
    expect(writeWorkspaceFile(narrow(), file, "one")).toBe(file);
    expect(fs.readFileSync(file, "utf8")).toBe("one");
    writeWorkspaceFile(narrow(), file, "two-longer");
    writeWorkspaceFile(narrow(), file, "x");
    expect(fs.readFileSync(file, "utf8"), "replace shortens the file").toBe("x");
    writeWorkspaceFile(narrow(), file, "+y", { mode: "append" });
    writeWorkspaceFile(narrow(), file, "+z", { mode: "append" });
    expect(fs.readFileSync(file, "utf8")).toBe("x+y+z");
    expect(() => writeWorkspaceFile(narrow(), file, "again", { mode: "create" })).toThrow(
      expect.objectContaining({ code: "EEXIST" }),
    );
    expect(fs.readFileSync(file, "utf8"), "create over a file changes nothing").toBe("x+y+z");
    const created = path.join(home, "memory", "c.md");
    writeWorkspaceFile(narrow(), created, Buffer.from([0xe2, 0x82, 0xac]), {
      mode: "create",
      fileMode: 0o600,
    });
    expect(fs.readFileSync(created, "utf8")).toBe("€");
    expect(fs.statSync(created).mode & 0o777).toBe(0o600);
    // A path with no existing parent whose nearest existing ancestor is outside the scope is refused
    expect(() => writeWorkspaceFile(narrow(), path.join(base, "outside", "x"), "x")).toThrow(PathAccessError);
    expect(fs.existsSync(path.join(base, "outside"))).toBe(false);
  });

  it("C42 refuses config, logs, secret names and what lies outside, and writes nothing there", () => {
    for (const target of [
      tokenFile(),
      path.join(home, "config", "new.json"),
      path.join(home, "logs", "runs.jsonl"),
      path.join(home, "memory", ".env"),
      path.join(home, "memory", "key.pem"),
      path.join(home, "memory", "..", "config", "token"),
      path.join(base, "elsewhere.txt"),
    ]) {
      expect(() => writeWorkspaceFile(wide(), target, "X"), target).toThrow(PathAccessError);
    }
    intact("after the refusals");
    expect(fs.readFileSync(path.join(home, "logs", "runs.jsonl"), "utf8")).toBe("PROMPT-SECRET");
    expect(fs.existsSync(path.join(home, "config", "new.json"))).toBe(false);
    expect(fs.existsSync(path.join(home, "memory", ".env"))).toBe(false);
  });

  it("C42 refuses a link of any kind at the last component, dangling ones included, and a folder that is a link out", () => {
    const m = (name: string) => path.join(home, "memory", name);
    fs.symlinkSync(tokenFile(), m("to-token.md"));
    fs.symlinkSync(m("note.md"), m("to-note.md"));
    fs.symlinkSync(path.join(home, "config", "not-yet"), m("pending.md"));
    fs.symlinkSync(path.join(home, "config"), m("to-config"));
    for (const [name, target] of [
      ["to the token", m("to-token.md")],
      ["to a harmless note in the same scope", m("to-note.md")],
      ["dangling, into config/", m("pending.md")],
      ["through a folder that is a link to config/", path.join(m("to-config"), "token")],
    ] as const) {
      for (const mode of ["replace", "append", "create"] as const) {
        expect(() => writeWorkspaceFile(narrow(), target, "LINKED", { mode }), `${name} ${mode}`).toThrow(
          PathAccessError,
        );
      }
    }
    intact("after the links");
    expect(fs.readFileSync(m("note.md"), "utf8")).toBe("NOTE");
    expect(fs.existsSync(path.join(home, "config", "not-yet"))).toBe(false);
  });

  it("C42 the open itself refuses a link that appears after the check (O_NOFOLLOW, no truncation)", () => {
    const racy = path.join(home, "memory", "racy.md");
    write(racy, "PLAIN");
    const lstat = fs.lstatSync.bind(fs);
    let swapped = false;
    // The check sees a regular file; by the time the file is opened it is a link to the token.
    const spy = vi.spyOn(fs, "lstatSync").mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      const answer = (lstat as (...a: unknown[]) => fs.Stats)(p, ...rest);
      if (!swapped && String(p) === racy) {
        swapped = true;
        fs.rmSync(racy);
        fs.symlinkSync(tokenFile(), racy);
      }
      return answer;
    }) as typeof fs.lstatSync);
    try {
      expect(() => writeWorkspaceFile(narrow(), racy, "RACED")).toThrow(PathAccessError);
    } finally {
      spy.mockRestore();
    }
    expect(swapped).toBe(true);
    intact("after the race");
    fs.rmSync(racy);
  });

  it("C42 a folder on the way that becomes a link between the check and the open is not written through", () => {
    const folder = path.join(home, "memory", "swap");
    fs.mkdirSync(folder, { recursive: true });
    const target = path.join(folder, "token");
    const mkdir = fs.mkdirSync.bind(fs);
    let swapped = false;
    // The check has passed; the next raw call is the one that makes the folders: `memory/swap` becomes config/.
    const spy = vi.spyOn(fs, "mkdirSync").mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      if (!swapped && String(p) === folder) {
        swapped = true;
        fs.rmSync(folder, { recursive: true });
        fs.symlinkSync(path.join(home, "config"), folder);
      }
      return (mkdir as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof fs.mkdirSync);
    try {
      expect(() => writeWorkspaceFile(narrow(), target, "CORRUPTED-BY-RACE")).toThrow(PathAccessError);
    } finally {
      spy.mockRestore();
    }
    expect(swapped).toBe(true);
    intact("after the folder race");
    fs.rmSync(folder);
  });

  it("C51 a file the open created behind a folder that turned into a link is removed again,", () => {
    const folder = path.join(home, "memory", "swap2");
    fs.mkdirSync(folder, { recursive: true });
    const target = path.join(folder, "new-file.md");
    const behind = path.join(home, "config", "new-file.md");
    const lstat = fs.lstatSync.bind(fs);
    let swapped = false;
    let looks = 0;
    // the check and the folders are done; the next look at the name (is it there already?) is where the folder is swapped
    const spy = vi.spyOn(fs, "lstatSync").mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      try {
        return (lstat as (...a: unknown[]) => fs.Stats)(p, ...rest);
      } catch (err) {
        // the third look at the name: the two checks are behind us, "is it there already?" is next to the open
        if (String(p) === target && ++looks === 3) {
          swapped = true;
          fs.rmSync(folder, { recursive: true });
          fs.symlinkSync(path.join(home, "config"), folder);
        }
        throw err;
      }
    }) as typeof fs.lstatSync);
    try {
      expect(() => writeWorkspaceFile(narrow(), target, "BEHIND-THE-LINK")).toThrow(PathAccessError);
    } finally {
      spy.mockRestore();
    }
    expect(swapped).toBe(true);
    expect(fs.existsSync(behind), "the empty file the open made is gone").toBe(false);
    fs.rmSync(folder);
  });

  it("C51 a folder that becomes a link while the folders are being made is seen before the open", () => {
    const folder = path.join(home, "memory", "swap3");
    const target = path.join(folder, "late.md");
    const mkdir = fs.mkdirSync.bind(fs);
    let swapped = false;
    const spy = vi.spyOn(fs, "mkdirSync").mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      const answer = (mkdir as (...a: unknown[]) => unknown)(p, ...rest);
      if (!swapped && String(p) === folder) {
        swapped = true;
        fs.rmSync(folder, { recursive: true });
        fs.symlinkSync(path.join(home, "config"), folder);
      }
      return answer;
    }) as typeof fs.mkdirSync);
    const open = vi.spyOn(fs, "openSync");
    try {
      expect(() => writeWorkspaceFile(narrow(), target, "X")).toThrow(PathAccessError);
      expect(
        open.mock.calls.filter((c) => String(c[0]).endsWith("late.md")),
        "nothing was opened",
      ).toEqual([]);
    } finally {
      open.mockRestore();
      spy.mockRestore();
    }
    expect(swapped).toBe(true);
    expect(fs.existsSync(path.join(home, "config", "late.md"))).toBe(false);
    fs.rmSync(folder);
  });

  it("C42 a dangling link that appears at the target after the check creates nothing behind it (O_NOFOLLOW)", () => {
    const target = path.join(home, "memory", "dangling-late.md");
    const behind = path.join(home, "config", "created-through-the-link");
    const mkdir = fs.mkdirSync.bind(fs);
    let planted = false;
    const spy = vi.spyOn(fs, "mkdirSync").mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      if (!planted && String(p) === path.dirname(target)) {
        planted = true;
        fs.symlinkSync(behind, target);
      }
      return (mkdir as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof fs.mkdirSync);
    try {
      expect(() => writeWorkspaceFile(narrow(), target, "X", { mode: "replace" })).toThrow(PathAccessError);
    } finally {
      spy.mockRestore();
    }
    expect(planted).toBe(true);
    expect(fs.existsSync(behind), "nothing was made behind the link").toBe(false);
    fs.rmSync(target);
  });

  it("C42 a file replaced by another between the open and the check is refused, not written", () => {
    const target = path.join(home, "memory", "replaced-late.md");
    write(target, "FIRST");
    const fstat = fs.fstatSync.bind(fs);
    let replaced = false;
    const spy = vi.spyOn(fs, "fstatSync").mockImplementation(((fd: number, ...rest: unknown[]) => {
      const answer = (fstat as (...a: unknown[]) => fs.Stats)(fd, ...rest);
      if (!replaced) {
        replaced = true;
        fs.rmSync(target);
        fs.writeFileSync(target, "SECOND");
      }
      return answer;
    }) as typeof fs.fstatSync);
    try {
      expect(() => writeWorkspaceFile(narrow(), target, "OVERWRITE")).toThrow(PathAccessError);
    } finally {
      spy.mockRestore();
    }
    expect(fs.readFileSync(target, "utf8")).toBe("SECOND");
    fs.rmSync(target);
  });

  it("C42 refuses a pipe or a directory without blocking", () => {
    const fifo = path.join(home, "memory", "pipe");
    execFileSync("mkfifo", [fifo]);
    expect(() => writeWorkspaceFile(narrow(), fifo, "x")).toThrow();
    fs.mkdirSync(path.join(home, "memory", "adir"));
    expect(() => writeWorkspaceFile(narrow(), path.join(home, "memory", "adir"), "x")).toThrow();
    fs.rmSync(fifo);
  });

  it("C43 a hard link to the token is refused wherever it lies, for a read and for a write", () => {
    const places = [
      path.join(home, "memory", "hard.md"),
      path.join(home, "skills", "s", "NOTES.md"),
      path.join(home, "artifacts", "r1", "hard.png"),
    ];
    // Outside the home too: the check is the file's identity, not where its name is.
    const outsideHome = path.join(base, "user", "hard.txt");
    for (const at of [...places, outsideHome]) {
      fs.mkdirSync(path.dirname(at), { recursive: true });
      fs.linkSync(tokenFile(), at);
      const scope = readScope({ homeDir: home, roots: [home, path.join(base, "user")] });
      expect(() => openWorkspaceFile(scope, at), `read ${at}`).toThrow(PathAccessError);
      expect(() => readWorkspaceText(scope, at, { maxBytes: 1000 }), `read text ${at}`).toThrow(
        PathAccessError,
      );
      for (const mode of ["replace", "append"] as const) {
        expect(() => writeWorkspaceFile(scope, at, "HARD", { mode }), `${mode} ${at}`).toThrow(
          PathAccessError,
        );
      }
      intact(at);
      fs.rmSync(at);
    }
    // ... and a hard link to a file under logs/ (prompts and outputs) is refused the same way
    const logCopy = path.join(home, "memory", "log-copy.md");
    fs.linkSync(path.join(home, "logs", "runs.jsonl"), logCopy);
    expect(() => readWorkspaceText(wide(), logCopy, { maxBytes: 1000 })).toThrow(PathAccessError);
    fs.rmSync(logCopy);
    expect(fs.statSync(tokenFile()).nlink).toBe(1);
  });

  it("C43 two names for an ordinary file stay readable and writable (the check is identity, not a link count)", () => {
    const a = path.join(home, "memory", "twin-a.md");
    const b = path.join(home, "memory", "twin-b.md");
    write(a, "TWIN");
    fs.linkSync(a, b);
    expect(readWorkspaceText(narrow(), b, { maxBytes: 100 }).text).toBe("TWIN");
    writeWorkspaceFile(narrow(), b, "TWIN-2");
    expect(fs.readFileSync(a, "utf8")).toBe("TWIN-2");
    fs.rmSync(a);
    fs.rmSync(b);
  });

  it("C43 a private folder too large to walk is answered with a refusal, not a read", () => {
    const hard = path.join(home, "memory", "hard-huge.md");
    fs.linkSync(path.join(home, "logs", "runs.jsonl"), hard);
    const many = path.join(home, "logs", "many");
    fs.mkdirSync(many);
    // not 20 000 files: the walk counts directory entries it lists, so one big listing is enough through a spy
    const list = fs.readdirSync.bind(fs);
    const spy = vi.spyOn(fs, "readdirSync").mockImplementation(((dir: fs.PathLike, ...rest: unknown[]) => {
      if (String(dir) === many) {
        return Array.from({ length: 21_000 }, (_, i) => ({
          name: `f${i}`,
          isDirectory: () => false,
          isFile: () => false,
        }));
      }
      return (list as (...a: unknown[]) => unknown)(dir, ...rest);
    }) as typeof fs.readdirSync);
    try {
      expect(() => readWorkspaceText(wide(), hard, { maxBytes: 100 })).toThrow(PathAccessError);
    } finally {
      spy.mockRestore();
    }
    fs.rmSync(hard);
    fs.rmSync(many, { recursive: true });
  });

  // ---- C44: the copy of a folder ------------------------------------------------------------------------
  it("C44 copies files only: no link, no device, no secret name, nothing from config, at any depth", () => {
    const src = path.join(base, "user", "skill-src");
    write(path.join(src, "SKILL.md"), "SKILL");
    write(path.join(src, "refs", "a.md"), "A");
    write(path.join(src, "sub", "deep", "b.md"), "B");
    write(path.join(src, ".env"), "SECRET=1");
    write(path.join(src, "sub", ".env"), "SECRET=2");
    write(path.join(src, "sub", "deep", "server.pem"), "PEM");
    write(path.join(src, ".git", "config"), "GIT");
    write(path.join(src, "node_modules", "x", "i.js"), "JS");
    fs.symlinkSync(tokenFile(), path.join(src, "leak.md"));
    fs.symlinkSync(path.join(home, "config"), path.join(src, "linkdir"));
    fs.symlinkSync(path.join(src, "refs"), path.join(src, "sub", "refs-link"));
    fs.linkSync(tokenFile(), path.join(src, "hard.md"));
    execFileSync("mkfifo", [path.join(src, "pipe")]);
    const target = path.join(home, "skills", "copied");
    const from = readScope({ homeDir: home, roots: [src] });
    // `hard.md` is a second name for the token: it is left behind like a link, not copied.
    const result = copyTreeWithoutLinks(from, src, homeReadScope(home, [path.join(home, "skills")]), target);
    const copied: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else copied.push(path.relative(target, full));
      }
    };
    walk(target);
    expect(copied.sort()).toEqual(
      ["SKILL.md", path.join("refs", "a.md"), path.join("sub", "deep", "b.md")].sort(),
    );
    expect(result.files).toBe(3);
    for (const file of copied) expect(fs.readFileSync(path.join(target, file), "utf8")).not.toContain(TOKEN);
    expect(fs.readdirSync(target)).not.toContain("linkdir");
    fs.rmSync(src, { recursive: true });
    fs.rmSync(target, { recursive: true });
  });

  it("C44 does not write through a link that is already in the target folder", () => {
    const src = path.join(base, "user", "into-link-src");
    write(path.join(src, "SKILL.md"), "NEW-CONTENT");
    const target = path.join(home, "skills", "pre-linked");
    fs.mkdirSync(target, { recursive: true });
    fs.symlinkSync(tokenFile(), path.join(target, "SKILL.md"));
    const from = readScope({ homeDir: home, roots: [src] });
    expect(() =>
      copyTreeWithoutLinks(from, src, homeReadScope(home, [path.join(home, "skills")]), target),
    ).toThrow(PathAccessError);
    intact("after the copy into a folder with a link");
    fs.rmSync(target, { recursive: true });
    fs.rmSync(src, { recursive: true });
  });

  it("C44 refuses the home itself and a folder above it, and never copies the target into itself", () => {
    write(path.join(home, "SKILL.md"), "HOME-SKILL");
    const target = path.join(home, "skills", "homeskill");
    const skills = homeReadScope(home, [path.join(home, "skills")]);
    expect(() => copyTreeWithoutLinks(wide(), home, skills, target)).toThrow(PathAccessError);
    const above = readScope({ homeDir: home, roots: [base] });
    expect(() => copyTreeWithoutLinks(above, base, skills, target)).toThrow(PathAccessError);
    expect(fs.existsSync(target), "nothing was created").toBe(false);
    fs.rmSync(path.join(home, "SKILL.md"));

    // A source that holds its own target: the target is left out of the copy instead of recursing into itself.
    const src = path.join(base, "self");
    write(path.join(src, "SKILL.md"), "S");
    write(path.join(src, "keep", "k.md"), "K");
    const inside = path.join(src, "keep", "out");
    const scope = readScope({ homeDir: home, roots: [src] });
    const done = copyTreeWithoutLinks(scope, src, scope, inside);
    expect(done.files).toBe(2);
    expect(fs.readdirSync(inside).sort()).toEqual(["SKILL.md", "keep"]);
    expect(fs.readdirSync(path.join(inside, "keep"))).toEqual(["k.md"]);
    fs.rmSync(src, { recursive: true });
  });

  it("C44 is bounded in files, bytes per file, bytes in all and depth", () => {
    const src = path.join(base, "bounded");
    write(path.join(src, "a.md"), "12345");
    write(path.join(src, "b.md"), "12345");
    write(path.join(src, "c", "d", "e", "f.md"), "1");
    const scope = readScope({ homeDir: home, roots: [src] });
    const out = readScope({ homeDir: home, roots: [path.join(base, "bounded-out")] });
    const into = (name: string) => path.join(base, "bounded-out", name);
    const limits = (over: Partial<typeof DEFAULT_COPY_LIMITS>) => ({ ...DEFAULT_COPY_LIMITS, ...over });
    expect(() => copyTreeWithoutLinks(scope, src, out, into("files"), limits({ maxFiles: 2 }))).toThrow(
      /too large/,
    );
    expect(() => copyTreeWithoutLinks(scope, src, out, into("each"), limits({ maxFileBytes: 4 }))).toThrow(
      /too large/,
    );
    expect(() => copyTreeWithoutLinks(scope, src, out, into("all"), limits({ maxTotalBytes: 10 }))).toThrow(
      /too large/,
    );
    expect(() => copyTreeWithoutLinks(scope, src, out, into("depth"), limits({ maxDepth: 2 }))).toThrow(
      /too large/,
    );
    expect(() => copyTreeWithoutLinks(scope, src, out, into("folders"), limits({ maxFolders: 2 }))).toThrow(
      /too large/,
    );
    expect(
      copyTreeWithoutLinks(scope, src, out, into("fits"), limits({ maxDepth: 3, maxFolders: 3 })).files,
    ).toBe(3);
    fs.rmSync(src, { recursive: true });
    fs.rmSync(path.join(base, "bounded-out"), { recursive: true });
  });

  it("C44 resolveWorkspaceCwd refuses a folder that holds config/ (the home, a folder above it)", () => {
    const above = readScope({ homeDir: home, roots: [base] });
    expect(() => resolveWorkspaceCwd(above, home)).toThrow(PathAccessError);
    expect(() => resolveWorkspaceCwd(above, base)).toThrow(PathAccessError);
    expect(resolveWorkspaceCwd(above, path.join(home, "memory"))).toBe(path.join(home, "memory"));
  });

  it("C46 tightening a mode never follows a link", () => {
    const aim = path.join(base, "aim.txt");
    write(aim, "x");
    fs.chmodSync(aim, 0o644);
    const link = path.join(base, "tighten-link");
    fs.symlinkSync(aim, link);
    expect(tightenMode(link, 0o600)).toBe(false);
    expect(fs.statSync(aim).mode & 0o777, "the file behind the link keeps its mode").toBe(0o644);
    expect(tightenMode(aim, 0o600)).toBe(true);
    expect(fs.statSync(aim).mode & 0o777).toBe(0o600);
    expect(tightenMode(aim, 0o600), "already right: nothing to do").toBe(false);
    const dir = path.join(base, "tighten-dir");
    fs.mkdirSync(dir, { mode: 0o755 });
    expect(tightenMode(dir, 0o700)).toBe(true);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    expect(tightenMode(path.join(base, "missing"), 0o600)).toBe(false);
    // a dangling link and a link to a folder
    fs.symlinkSync(path.join(base, "nowhere"), path.join(base, "dangling"));
    expect(tightenMode(path.join(base, "dangling"), 0o600)).toBe(false);
    fs.chmodSync(dir, 0o755);
    fs.symlinkSync(dir, path.join(base, "dir-link"));
    expect(tightenMode(path.join(base, "dir-link"), 0o700)).toBe(false);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o755);
  });
});

// ---------------------------------------------------------------------------
describe.skipIf(!POSIX)(
  "C41-C43 the routes: an agent's folder, writes and hard links, with the real token",
  () => {
    let s: SecureServer;
    let tokenBefore: string;
    const m = (...parts: string[]) => path.join(s.home, ...parts);
    const intact = (label: string) => expect(fs.readFileSync(s.tokenFile(), "utf8"), label).toBe(tokenBefore);
    const noToken = (res: { body: string }, label: string) =>
      expect(res.body, label).not.toContain(s.ownerToken);
    const planted: string[] = [];
    const plant = (kind: "symlink" | "hard", at: string, target = s.tokenFile()) => {
      fs.mkdirSync(path.dirname(at), { recursive: true });
      fs.rmSync(at, { force: true });
      if (kind === "symlink") fs.symlinkSync(target, at);
      else fs.linkSync(target, at);
      planted.push(at);
    };
    const unplant = () => {
      for (const at of planted.splice(0)) fs.rmSync(at, { force: true });
    };

    beforeAll(async () => {
      s = await startSecureServer("mordomo-writes-");
      tokenBefore = fs.readFileSync(s.tokenFile(), "utf8");
      write(
        m("skills", "runme", "SKILL.md"),
        [
          "---",
          "name: Run me",
          "slug: runme",
          "description: a skill",
          "mode: read_only",
          "---",
          "Do it.",
        ].join("\n"),
      );
    });
    afterAll(async () => {
      await s.close();
    });

    // ---- C41: where an agent starts ----------------------------------------------------------------------
    it("C41 a run with no cwd, or with the home as cwd, starts in <home>/workspace, not in the folder that holds config/", async () => {
      const workspace = m("workspace");
      expect(s.ctx.runs.resolveCwd(null)).toBe(workspace);
      expect(s.ctx.runs.resolveCwd(undefined)).toBe(workspace);
      for (const asked of [s.home, `${s.home}/`, `${s.home}/memory/..`, path.join(s.home, ".")]) {
        expect(s.ctx.runs.resolveCwd(asked), asked).toBe(workspace);
      }
      expect(fs.statSync(workspace).isDirectory()).toBe(true);
      // the home's other folders stay valid, and so does anything the user granted
      expect(s.ctx.runs.resolveCwd(m("memory"))).toBe(m("memory"));
      expect(s.ctx.runs.resolveCwd(s.userFolder)).toBe(s.userFolder);

      for (const [who, headers] of s.principals()) {
        for (const cwd of [undefined, s.home]) {
          const res = await s.app.inject({
            method: "POST",
            url: "/api/runs",
            headers,
            payload: { prompt: "ls", provider: "claude", mode: "read_only", ...(cwd ? { cwd } : {}) },
          });
          expect(res.statusCode, `${who} ${cwd}: ${res.body}`).toBe(200);
          const run = s.ctx.runs.get((res.json() as { runId: string }).runId);
          expect(run?.cwd, `${who} ${cwd ?? "no cwd"}`).toBe(workspace);
        }
      }
      // a record from before the rule (cwd = the home) is run, and recorded, in the workspace
      const legacy = s.ctx.runs.create({
        origin: "manual",
        provider: "claude",
        prompt: "legacy",
        cwd: s.home,
        model: null,
        effort: "default",
        mode: "read_only",
        timeoutMs: 30_000,
        profile: "read_only",
        status: "waiting_approval",
      });
      expect(legacy.cwd).toBe(workspace);
    });

    it("C41 a skill run still reads its own folder from the new working directory; a prompt run is given no extra folder", async () => {
      const seen: AgentRun[] = [];
      const real = new ClaudeAdapter({ binaryPath: path.join(FAKE_BIN, "claude") });
      const spy = new Proxy(real, {
        get(target, prop) {
          if (prop === "execute") {
            return (run: AgentRun) => {
              seen.push(run);
              return target.execute(run);
            };
          }
          const value = Reflect.get(target, prop, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as unknown as AgentAdapter;
      const manager = new RunManager(
        s.ctx.db,
        s.ctx.paths,
        () => s.ctx.settings(),
        () => spy,
        {
          pruneOnBoot: false,
        },
      );
      const make = (extra: Record<string, unknown>) =>
        manager.create({
          origin: "manual",
          provider: "claude",
          prompt: "go",
          cwd: s.home,
          model: null,
          effort: "default",
          mode: "read_only",
          timeoutMs: 30_000,
          profile: "read_only",
          ...extra,
        } as never);
      const skillRun = make({ origin: "skill", skillSlug: "runme" });
      expect((await manager.execute(skillRun.id, "go", "read_only")).status).toBe("done");
      const promptRun = make({});
      expect((await manager.execute(promptRun.id, "go", "read_only")).status).toBe("done");
      expect(seen).toHaveLength(2);
      expect(seen[0]!.cwd).toBe(m("workspace"));
      expect(seen[0]!.readDirs).toEqual([m("skills", "runme")]);
      expect(seen[1]!.cwd).toBe(m("workspace"));
      expect(seen[1]!.readDirs).toBeUndefined();
      // The Claude adapter lets exactly those folders in (and the artifacts folder, as before).
      const invocation = await real.buildInvocation(seen[0]!);
      const added = invocation.args.flatMap((a, i) => (a === "--add-dir" ? [invocation.args[i + 1]] : []));
      expect(added).toEqual([seen[0]!.artifactsDir, m("skills", "runme")]);
      expect((await real.buildInvocation(seen[1]!)).args.filter((a) => a === "--add-dir")).toHaveLength(1);
    });

    it("C41 a granted folder that holds the home is refused, by every entry that takes a cwd", async () => {
      const above = path.dirname(s.home);
      const folders = s.ctx.settings().indexedFolders;
      s.ctx.settingsStore.update({
        indexedFolders: [...folders, { path: above, area: null, enabled: true }],
      });
      try {
        expect(() => s.ctx.runs.resolveCwd(above)).toThrow(PathAccessError);
        for (const [who, headers] of s.principals()) {
          for (const [url, payload] of [
            ["/api/runs", { prompt: "ls", provider: "claude", mode: "read_only", cwd: above }],
            ["/api/skills/runme/run", { cwd: above, inputs: {} }],
          ] as const) {
            const res = await s.app.inject({ method: "POST", url, headers, payload });
            expect(res.statusCode, `${who} ${url}: ${res.body}`).toBe(403);
            expect(res.json().error.code).toBe("forbidden_path");
          }
        }
      } finally {
        s.ctx.settingsStore.update({ indexedFolders: folders });
      }
    });

    it("C41 on a file system that ignores case, the home and config/ are the home and config/ in any spelling", () => {
      // The distribution is for macOS: names are compared as darwin compares them, as the filter already does.
      const above = path.dirname(s.home);
      const folders = s.ctx.settings().indexedFolders;
      s.ctx.settingsStore.update({
        indexedFolders: [...folders, { path: above, area: null, enabled: true }],
      });
      try {
        const manager = new RunManager(
          s.ctx.db,
          s.ctx.paths,
          () => s.ctx.settings(),
          () => undefined,
          {
            pruneOnBoot: false,
            platform: "darwin",
          },
        );
        const shouted = path.join(above, path.basename(s.home).toUpperCase());
        expect(shouted).not.toBe(s.home);
        expect(manager.resolveCwd(shouted), "the home in capitals is the home").toBe(m("workspace"));
        expect(manager.resolveCwd(`${shouted}/`), "... with a trailing slash").toBe(m("workspace"));
        for (const private_ of ["CONFIG", "Config/db", "LOGS", "config/TLS"]) {
          expect(() => manager.resolveCwd(path.join(shouted, private_)), private_).toThrow(PathAccessError);
        }
        // a folder above the home is refused in any spelling too (it holds config/)
        expect(() => manager.resolveCwd(above.toUpperCase()), "above, in capitals").toThrow(PathAccessError);
        // the same names on a case-sensitive file system are other folders (they do not exist: nothing private there)
        const exact = new RunManager(
          s.ctx.db,
          s.ctx.paths,
          () => s.ctx.settings(),
          () => undefined,
          {
            pruneOnBoot: false,
            platform: "linux",
          },
        );
        expect(exact.resolveCwd(s.home)).toBe(m("workspace"));
        expect(exact.resolveCwd(path.join(shouted, "config"))).toBe(path.join(shouted, "config"));
        // the scope-level rule, for the import and the working directory alike
        const scope = readScope({ homeDir: s.home, roots: [above], platform: "darwin" });
        expect(() => resolveWorkspaceCwd(scope, shouted)).toThrow(PathAccessError);
        expect(() => resolveWorkspaceCwd(scope, above)).toThrow(PathAccessError);
      } finally {
        s.ctx.settingsStore.update({ indexedFolders: folders });
      }
    });

    it("C41 on macOS a name written with a combining accent is the same name as the composed one", () => {
      const above = path.dirname(s.home);
      // the home's own name has no accent: the point is the private folders and a folder in a made-up home
      const base = path.join(above, "mordomo-café-home");
      const scope = (form: "NFC" | "NFD", platform: NodeJS.Platform) =>
        readScope({ homeDir: base.normalize(form), roots: [above], platform });
      const composed = base.normalize("NFC");
      const decomposed = base.normalize("NFD");
      expect(composed).not.toBe(decomposed);
      // the home is known by one spelling, the agent's folder is asked for by the other
      expect(() => resolveWorkspaceCwd(scope("NFC", "darwin"), path.join(decomposed, "config"))).toThrow(
        PathAccessError,
      );
      expect(() => resolveWorkspaceCwd(scope("NFD", "darwin"), path.join(composed, "LOGS"))).toThrow(
        PathAccessError,
      );
      expect(scope("NFC", "darwin").filter.isHomeDir(decomposed)).toBe(true);
      // a file system that tells the two apart does not
      expect(scope("NFC", "linux").filter.isHomeDir(decomposed)).toBe(false);
      expect(resolveWorkspaceCwd(scope("NFC", "linux"), path.join(decomposed, "config"))).toBe(
        path.join(decomposed, "config"),
      );
    });

    it("C41 a default working directory that is a file or a dangling link is a clear 409, not a crash", async () => {
      const workspace = m("workspace");
      fs.rmSync(workspace, { recursive: true, force: true });
      try {
        for (const plant of [
          () => fs.writeFileSync(workspace, "i am a file"),
          () => fs.symlinkSync(m("nowhere"), workspace),
        ]) {
          plant();
          expect(() => s.ctx.runs.resolveCwd(null)).toThrow(expect.objectContaining({ statusCode: 409 }));
          for (const [who, headers] of s.principals()) {
            const res = await s.app.inject({
              method: "POST",
              url: "/api/runs",
              headers,
              payload: { prompt: "ls", provider: "claude", mode: "read_only" },
            });
            expect(res.statusCode, `${who}: ${res.body}`).toBe(409);
            expect(res.json().error.message).toContain("remove or rename it");
          }
          fs.rmSync(workspace);
        }
      } finally {
        fs.rmSync(workspace, { force: true });
      }
      expect(s.ctx.runs.resolveCwd(null)).toBe(workspace);
    });

    it("C41 a workspace folder that is a link into config/ is refused, not used", () => {
      const workspace = m("workspace");
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.symlinkSync(m("config"), workspace);
      try {
        expect(() => s.ctx.runs.resolveCwd(null)).toThrow(PathAccessError);
        expect(() => s.ctx.runs.resolveCwd(s.home)).toThrow(PathAccessError);
      } finally {
        fs.rmSync(workspace);
      }
      expect(s.ctx.runs.resolveCwd(null)).toBe(workspace);
    });

    // ---- C42: writes through a link, with the real routes -----------------------------------------------------
    it("C42 the routers, a skill note, a skill file and a drawing are not written through a link to the token", async () => {
      const png = { name: "draw", dataUrl: PNG };
      // one of the area indexes the routers write next to ROUTER.md
      const first = await s.app.inject({
        method: "POST",
        url: "/api/memory/routers",
        headers: s.asOwner(),
        payload: {},
      });
      const areaFile = (first.json().written as string[]).find((f) =>
        f.includes(`${path.sep}areas${path.sep}`),
      )!;
      expect(areaFile, "the routers write at least one area index").toBeTruthy();
      for (const kind of ["symlink", "hard"] as const) {
        for (const [who, headers] of s.principals()) {
          plant(kind, m("memory", "ROUTER.md"));
          const routers = await s.app.inject({
            method: "POST",
            url: "/api/memory/routers",
            headers,
            payload: {},
          });
          expect(routers.statusCode, `${kind} ${who} routers`).toBe(403);
          noToken(routers, `${kind} ${who} routers`);
          intact(`${kind} ${who} routers`);
          unplant();

          plant(kind, areaFile);
          const areas = await s.app.inject({
            method: "POST",
            url: "/api/memory/routers",
            headers,
            payload: {},
          });
          expect(areas.statusCode, `${kind} ${who} area router`).toBe(403);
          noToken(areas, `${kind} ${who} area router`);
          intact(`${kind} ${who} area router`);
          unplant();

          plant(kind, m("skills", "runme", "NOTES.md"));
          const notes = await s.app.inject({
            method: "POST",
            url: "/api/skills/runme/notes",
            headers,
            payload: { text: "a lesson that must not become the token" },
          });
          expect([403, 404], `${kind} ${who} notes: ${notes.statusCode}`).toContain(notes.statusCode);
          noToken(notes, `${kind} ${who} notes`);
          intact(`${kind} ${who} notes`);
          unplant();

          plant(kind, m("artifacts", "pixel-studio", "draw.png"));
          const drawing = await s.app.inject({
            method: "POST",
            url: "/api/microapps/pixel/save",
            headers,
            payload: png,
          });
          expect(drawing.statusCode, `${kind} ${who} drawing`).toBe(403);
          intact(`${kind} ${who} drawing`);
          unplant();

          plant(kind, m("artifacts", "pixel-studio", "draw.sheet.png"));
          const sheet = await s.app.inject({
            method: "POST",
            url: "/api/microapps/pixel/save",
            headers,
            payload: { ...png, spriteSheetDataUrl: PNG, frames: 1 },
          });
          expect(sheet.statusCode, `${kind} ${who} sprite sheet`).toBe(403);
          intact(`${kind} ${who} sprite sheet`);
          unplant();

          plant(kind, m("skills", "runme", "SKILL.md"));
          expect(
            () =>
              s.ctx.skills.save(
                { name: "Run me", slug: "runme", description: "x", mode: "read_only" } as never,
                "BODY",
              ),
            `${kind} ${who} SKILL.md`,
          ).toThrow(PathAccessError);
          intact(`${kind} ${who} SKILL.md`);
          unplant();
          // put the skill back for the next round
          write(
            m("skills", "runme", "SKILL.md"),
            [
              "---",
              "name: Run me",
              "slug: runme",
              "description: a skill",
              "mode: read_only",
              "---",
              "Do it.",
            ].join("\n"),
          );
        }
      }
      // The same routes still work when nothing is in the way.
      const ok = await s.app.inject({
        method: "POST",
        url: "/api/memory/routers",
        headers: s.asOwner(),
        payload: {},
      });
      expect(ok.statusCode).toBe(200);
      const note = await s.app.inject({
        method: "POST",
        url: "/api/skills/runme/notes",
        headers: s.asOwner(),
        payload: { text: "a lesson" },
      });
      expect(note.statusCode).toBe(200);
      expect(fs.readFileSync(m("skills", "runme", "NOTES.md"), "utf8")).toContain("a lesson");
      const drawing = await s.app.inject({
        method: "POST",
        url: "/api/microapps/pixel/save",
        headers: s.asOwner(),
        payload: png,
      });
      expect(drawing.statusCode).toBe(200);
      expect(fs.existsSync(m("artifacts", "pixel-studio", "draw.png"))).toBe(true);
    });

    it("C42 pruning the notes archives first: an archive that is a link stops it before any note moves", () => {
      const entries = [1, 2, 3].map((n) => `\n- **2026-01-0${n} 10:00**: lesson ${n}\n`).join("");
      const notes = `# Notes for Run me\n\nHeader.\n${entries}`;
      for (const kind of ["symlink", "hard"] as const) {
        write(m("skills", "runme", "NOTES.md"), notes);
        plant(kind, m("skills", "runme", "NOTES.archive.md"));
        expect(() => s.ctx.skills.pruneNotes("runme", 1), kind).toThrow(PathAccessError);
        intact(`${kind} prune`);
        expect(fs.readFileSync(m("skills", "runme", "NOTES.md"), "utf8"), `${kind}: no note was lost`).toBe(
          notes,
        );
        unplant();
      }
      // Without a link the oldest move to the archive and the newest stay.
      expect(s.ctx.skills.pruneNotes("runme", 1)).toBe(2);
      expect(fs.readFileSync(m("skills", "runme", "NOTES.archive.md"), "utf8")).toMatch(
        /lesson 1[\s\S]*lesson 2/,
      );
      expect(fs.readFileSync(m("skills", "runme", "NOTES.md"), "utf8")).toContain("lesson 3");
      expect(fs.readFileSync(m("skills", "runme", "NOTES.md"), "utf8")).not.toContain("lesson 1");
      fs.rmSync(m("skills", "runme", "NOTES.md"));
      fs.rmSync(m("skills", "runme", "NOTES.archive.md"));
    });

    // ---- C43: hard links, with the real routes -----------------------------------------------------------------
    it("C43 a hard link to the token is not served by the preview, the gallery or the raw route", async () => {
      plant("hard", m("memory", "hard.md"));
      plant("hard", m("artifacts", "r1", "hard.txt"));
      plant("hard", m("artifacts", "r1", "hard.png"));
      plant("hard", path.join(s.userFolder, "hard.txt"));
      write(m("memory", "twin-a.md"), "TWIN-NOTE");
      fs.linkSync(m("memory", "twin-a.md"), m("memory", "twin-b.md"));
      try {
        const q = (p: string) => encodeURIComponent(p);
        for (const [who, headers] of s.principals()) {
          for (const url of [
            `/api/memory/preview?p=${q(m("memory", "hard.md"))}`,
            `/api/memory/preview?p=${q(path.join(s.userFolder, "hard.txt"))}`,
            `/api/artifacts/file?p=${q(m("artifacts", "r1", "hard.txt"))}`,
            `/api/artifacts/raw?p=${q(m("artifacts", "r1", "hard.png"))}`,
          ]) {
            const res = await s.app.inject({ method: "GET", url, headers });
            expect(res.statusCode, `${who} ${url}`).toBe(403);
            noToken(res, `${who} ${url}`);
          }
          const gallery = await s.app.inject({ method: "GET", url: "/api/artifacts/list", headers });
          noToken(gallery, `${who} gallery`);
          expect(
            (gallery.json().items as Array<{ file: string }>).map((i) => i.file),
            who,
          ).not.toContain("r1/hard.txt");
          const twin = await s.app.inject({
            method: "GET",
            url: `/api/memory/preview?p=${q(m("memory", "twin-b.md"))}`,
            headers,
          });
          expect(twin.statusCode, `${who} an ordinary second name`).toBe(200);
          expect(twin.body).toContain("TWIN-NOTE");
        }
        intact("hard links read");
      } finally {
        unplant();
        fs.rmSync(m("memory", "twin-a.md"));
        fs.rmSync(m("memory", "twin-b.md"));
      }
    });

    // ---- C44: the import route ------------------------------------------------------------------------------
    it("C44 a failed import leaves no folder behind, whether it fails while copying or after", async () => {
      const owner = s.asOwner();
      // after the copy: the SKILL.md does not validate (a name that is not text)
      const bad = path.join(s.userFolder, "bad-frontmatter");
      write(path.join(bad, "SKILL.md"), ["---", "name:", "  - not", "  - text", "---", "Body"].join("\n"));
      write(path.join(bad, "refs", "a.md"), "A");
      const afterCopy = await s.app.inject({
        method: "POST",
        url: "/api/skills/import",
        headers: owner,
        payload: { sourceDir: bad, slug: "bad-frontmatter" },
      });
      expect(afterCopy.statusCode, afterCopy.body).toBeGreaterThanOrEqual(400);
      expect(
        fs.existsSync(m("skills", "bad-frontmatter")),
        "nothing left after a failure after the copy",
      ).toBe(false);
      // while copying: more files than the limit, so the copy stops half way
      const big = path.join(s.userFolder, "too-many-files");
      write(path.join(big, "SKILL.md"), ["---", "name: Big", "description: d", "---", "Body"].join("\n"));
      for (let i = 0; i < 2001; i++) write(path.join(big, "files", `f${String(i).padStart(4, "0")}.md`), "x");
      const midCopy = await s.app.inject({
        method: "POST",
        url: "/api/skills/import",
        headers: owner,
        payload: { sourceDir: big, slug: "too-many-files" },
      });
      expect(midCopy.statusCode, midCopy.body).toBe(413);
      expect(fs.existsSync(m("skills", "too-many-files")), "nothing left after a failure while copying").toBe(
        false,
      );
    }, 60_000);

    it("C44 the import honours the exclusions the user set in Settings, at any depth", async () => {
      const before = s.ctx.settings().excludes;
      s.ctx.settingsStore.update({ excludes: ["*.private.md", "drafts"] });
      try {
        const src = path.join(s.userFolder, "with-excludes");
        write(path.join(src, "SKILL.md"), ["---", "name: Ex", "description: d", "---", "Body"].join("\n"));
        write(path.join(src, "refs", "ok.md"), "OK");
        write(path.join(src, "refs", "notes.private.md"), "PRIVATE-NOTES");
        write(path.join(src, "drafts", "d.md"), "DRAFT");
        const res = await s.app.inject({
          method: "POST",
          url: "/api/skills/import",
          headers: s.asOwner(),
          payload: { sourceDir: src, slug: "with-excludes" },
        });
        expect(res.statusCode, res.body).toBe(200);
        expect(fs.readdirSync(m("skills", "with-excludes", "refs"))).toEqual(["ok.md"]);
        expect(fs.existsSync(m("skills", "with-excludes", "drafts", "d.md"))).toBe(false);
      } finally {
        s.ctx.settingsStore.update({ excludes: before });
      }
    });

    it("C44 importing a folder copies its files, not its links, its secrets or the home's config", async () => {
      const src = path.join(s.userFolder, "to-import");
      write(path.join(src, "SKILL.md"), ["---", "name: Imp", "description: d", "---", "Body"].join("\n"));
      write(path.join(src, "refs", "ok.md"), "OK-REF");
      write(path.join(src, ".env"), "API_KEY=IMPORT-SECRET");
      write(path.join(src, "refs", "id_rsa"), "IMPORT-SECRET-KEY");
      write(path.join(src, ".git", "config"), "IMPORT-SECRET-GIT");
      fs.symlinkSync(s.tokenFile(), path.join(src, "leak.md"));
      fs.symlinkSync(m("config"), path.join(src, "cfg"));
      fs.linkSync(s.tokenFile(), path.join(src, "refs", "hard.md"));
      const owner = s.asOwner();
      // the second name for the token is left behind like a link
      const done = await s.app.inject({
        method: "POST",
        url: "/api/skills/import",
        headers: owner,
        payload: { sourceDir: src, slug: "imported" },
      });
      expect(done.statusCode, done.body).toBe(200);
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) walk(path.join(dir, e.name));
          else files.push(path.relative(m("skills", "imported"), path.join(dir, e.name)));
        }
      };
      walk(m("skills", "imported"));
      expect(files.sort()).toEqual(["SKILL.md", path.join("refs", "ok.md")].sort());
      for (const file of files) {
        const text = fs.readFileSync(m("skills", "imported", file), "utf8");
        expect(text).not.toContain(s.ownerToken);
        expect(text).not.toMatch(/IMPORT-SECRET/);
      }
      noToken(done, "import");

      // The home as the source, with a SKILL.md at its root, is refused, not copied into itself.
      write(m("SKILL.md"), ["---", "name: Home", "description: d", "---", "Body"].join("\n"));
      try {
        const res = await s.app.inject({
          method: "POST",
          url: "/api/skills/import",
          headers: owner,
          payload: { sourceDir: s.home, slug: "homeskill" },
        });
        expect(res.statusCode, res.body).toBe(403);
        noToken(res, "home import");
        expect(fs.existsSync(m("skills", "homeskill"))).toBe(false);
      } finally {
        fs.rmSync(m("SKILL.md"));
      }
      intact("imports");
    });
  },
);

// ---------------------------------------------------------------------------
describe.skipIf(!POSIX)("C45 the index is cleaned when the engine starts (AC 17)", () => {
  it("drops the rows of a path the policy no longer allows at construction, without anyone asking", () => {
    const tmp = makeTempHome("mordomo-purge-");
    try {
      const first = new AppContext(tmp.paths.home);
      const token = path.join(fs.realpathSync(tmp.paths.home), "config", "token");
      const insert = first.db.prepare(
        "INSERT INTO files (root, path, rel, name, ext, dir, area, size, mtime, indexed_at, title, tags, fields) VALUES (?, ?, ?, ?, ?, ?, NULL, 1, 1, 1, NULL, '[]', '{}')",
      );
      const fts = first.db.prepare("INSERT INTO files_fts (rowid, name, rel, content) VALUES (?, ?, ?, ?)");
      first.db.transaction(() => {
        const id = Number(
          insert.run(
            path.dirname(path.dirname(token)),
            token,
            "config/token",
            "token",
            "",
            path.dirname(token),
          ).lastInsertRowid,
        );
        fts.run(id, "token", "config/token", "old secret content");
        // a row the policy still allows
        const kept = Number(
          insert.run(
            path.dirname(path.dirname(token)),
            path.join(path.dirname(path.dirname(token)), "memory", "ok.md"),
            "memory/ok.md",
            "ok.md",
            ".md",
            "memory",
          ).lastInsertRowid,
        );
        fts.run(kept, "ok.md", "memory/ok.md", "fine");
      })();
      const count = () => first.db.prepare("SELECT COUNT(*) c FROM files").get() as { c: number };
      expect(count().c).toBe(2);
      first.close();

      const second = new AppContext(tmp.paths.home); // nobody calls purgeExcluded: the start does
      try {
        const rows = second.db.prepare("SELECT path FROM files").all() as Array<{ path: string }>;
        expect(rows.map((r) => r.path.endsWith("config/token"))).toEqual([false]);
        expect(rows).toHaveLength(1);
        const content = (
          second.db.prepare("SELECT content FROM files_fts").all() as Array<{ content: string }>
        )
          .map((r) => r.content)
          .join("|");
        expect(content).not.toContain("old secret content");
      } finally {
        second.close();
      }
    } finally {
      tmp.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
describe.skipIf(!POSIX)(
  "C45 the journal day is created exclusively, whatever appears while it is created",
  () => {
    /** Run `act` with `plant` firing right before the first exclusive open of `<date>.md`. */
    const withPlantBeforeCreate = <T>(date: string, plant: (file: string) => void, act: () => T): T => {
      const open = fs.openSync.bind(fs);
      let planted = false;
      const spy = vi.spyOn(fs, "openSync").mockImplementation(((
        p: fs.PathLike,
        flags: number,
        ...rest: unknown[]
      ) => {
        if (!planted && String(p).endsWith(`${date}.md`) && (flags & fs.constants.O_EXCL) !== 0) {
          planted = true;
          plant(String(p));
        }
        return (open as (...a: unknown[]) => number)(p, flags, ...rest);
      }) as typeof fs.openSync);
      try {
        const result = act();
        expect(planted, "the exclusive open was reached").toBe(true);
        return result;
      } finally {
        spy.mockRestore();
      }
    };

    it("takes the day another writer created in between, and keeps what that writer wrote", () => {
      const tmp = makeTempHome("mordomo-journal-race-");
      try {
        const day = withPlantBeforeCreate(
          "2026-02-01",
          (file) => fs.writeFileSync(file, "WRITTEN-BY-THE-OTHER-CALL\n"),
          () => ensureJournal(tmp.paths, "2026-02-01"),
        );
        expect(day.created).toBe(false);
        expect(day.content).toBe("WRITTEN-BY-THE-OTHER-CALL\n");
        expect(fs.readFileSync(day.path, "utf8")).toBe("WRITTEN-BY-THE-OTHER-CALL\n");
      } finally {
        tmp.cleanup();
      }
    });

    it("does not create through a link that appears in between: the target is not made, the call is refused", () => {
      const tmp = makeTempHome("mordomo-journal-race-");
      try {
        const target = path.join(tmp.paths.config, "created-through-the-link");
        expect(() =>
          withPlantBeforeCreate(
            "2026-02-02",
            (file) => fs.symlinkSync(target, file),
            () => ensureJournal(tmp.paths, "2026-02-02"),
          ),
        ).toThrow(PathAccessError);
        expect(fs.existsSync(target)).toBe(false);
      } finally {
        tmp.cleanup();
      }
    });
  },
);

// ---------------------------------------------------------------------------
describe.skipIf(!POSIX)(
  "C48 the atomic write of routines, connectors and settings follows no planted name",
  () => {
    it("writes through a random exclusive temporary name: a link planted at a guessed name is never written through", () => {
      const tmp = makeTempHome("mordomo-atomic-");
      try {
        const token = path.join(tmp.paths.config, "token");
        fs.writeFileSync(token, "THE-OWNER-TOKEN");
        const target = path.join(tmp.paths.routines, "plant.json");
        // Every name the old scheme could take (pid, millisecond) is a link to the token.
        const now = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
        for (const name of [`${target}.${process.pid}.1700000000000.tmp`]) fs.symlinkSync(token, name);
        try {
          atomicWrite(target, '{"id":"plant"}\n');
        } finally {
          now.mockRestore();
        }
        expect(fs.readFileSync(token, "utf8")).toBe("THE-OWNER-TOKEN");
        expect(fs.readFileSync(target, "utf8")).toBe('{"id":"plant"}\n');
        // the name is random and nothing is left behind
        const left = fs
          .readdirSync(tmp.paths.routines)
          .filter(
            (f) => f.endsWith(".tmp") && !fs.lstatSync(path.join(tmp.paths.routines, f)).isSymbolicLink(),
          );
        expect(left).toEqual([]);
        const names = new Set<string>();
        const spy = vi.spyOn(fs, "openSync");
        try {
          for (let i = 0; i < 5; i++) atomicWrite(target, `{"n":${i}}\n`);
          for (const call of spy.mock.calls) if (String(call[0]).endsWith(".tmp")) names.add(String(call[0]));
        } finally {
          spy.mockRestore();
        }
        expect(names.size, "a fresh name every time").toBe(5);
      } finally {
        tmp.cleanup();
      }
    });

    it("a failed write leaves no temporary file and the target as it was", () => {
      const tmp = makeTempHome("mordomo-atomic-");
      try {
        const target = path.join(tmp.paths.connectors, "c.json");
        atomicWrite(target, "OLD\n");
        const rename = vi.spyOn(fs, "renameSync").mockImplementation(() => {
          throw new Error("disk full");
        });
        try {
          expect(() => atomicWrite(target, "NEW\n")).toThrow("disk full");
        } finally {
          rename.mockRestore();
        }
        expect(fs.readFileSync(target, "utf8")).toBe("OLD\n");
        expect(fs.readdirSync(tmp.paths.connectors).filter((f) => f.endsWith(".tmp"))).toEqual([]);
      } finally {
        tmp.cleanup();
      }
    });
  },
);

// ---------------------------------------------------------------------------
describe.skipIf(!POSIX)("C57 the guarded replace of the write primitive (cerebro-v2, door 5)", () => {
  let base: string;
  let home: string;
  const TOKEN = "OWNER-TOKEN-0123456789abcdef0123456789abcdef0123456789abcdef";
  const sha = (bytes: string | Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
  const scope = () => homeReadScope(home, [path.join(home, "memory")]);
  const note = () => path.join(home, "memory", "nota.md");

  beforeAll(() => {
    base = real(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-guarded-")));
    home = path.join(base, "home");
    write(path.join(home, "config", "token"), TOKEN);
    write(note(), "versão um\n");
  });
  afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

  it("C57 replaces only when the bytes hash to the expected digest, and never truncates before the check", () => {
    const first = fs.readFileSync(note());
    writeWorkspaceFile(scope(), note(), "versão dois\n", { mode: "replace", expectSha256: sha(first) });
    expect(fs.readFileSync(note(), "utf8")).toBe("versão dois\n");
    // a mismatch: bytes and mtime stay, and the error is the conflict
    const info = fs.statSync(note());
    expect(() =>
      writeWorkspaceFile(scope(), note(), "x", { mode: "replace", expectSha256: sha(first) }),
    ).toThrow(EditConflictError);
    expect(fs.readFileSync(note(), "utf8")).toBe("versão dois\n");
    expect(fs.statSync(note()).mtimeMs).toBe(info.mtimeMs);
    // a larger file than one read block is hashed whole
    const big = Buffer.alloc(200_000, "a");
    fs.writeFileSync(note(), big);
    writeWorkspaceFile(scope(), note(), "pequeno", { mode: "replace", expectSha256: sha(big) });
    expect(fs.readFileSync(note(), "utf8")).toBe("pequeno");
    // an empty file has the digest of nothing
    fs.writeFileSync(note(), "");
    writeWorkspaceFile(scope(), note(), "de novo", { mode: "replace", expectSha256: sha("") });
    expect(fs.readFileSync(note(), "utf8")).toBe("de novo");
  });

  const strays = () => fs.readdirSync(path.dirname(note())).filter((f) => f.endsWith(".tmp"));
  const failing = (code: string) => Object.assign(new Error(`${code}: injected`), { code });

  it.each([
    ["the write of the new bytes runs out of space", "writeSync", "ENOSPC"],
    ["the flush to the disk fails", "fsyncSync", "EIO"],
    ["the rename fails", "renameSync", "EXDEV"],
  ] as const)(
    "C57 when %s the old text is still the file's, whole, and no temporary file is left",
    (_why, call, code) => {
      const before = "versão antiga, inteira\n".repeat(50);
      fs.writeFileSync(note(), before);
      const info = fs.statSync(note());
      const spy = vi.spyOn(fs, call).mockImplementationOnce(() => {
        throw failing(code);
      });
      try {
        expect(() =>
          writeWorkspaceFile(scope(), note(), "texto novo\n", { mode: "replace", expectSha256: sha(before) }),
        ).toThrow(expect.objectContaining({ code }));
      } finally {
        spy.mockRestore();
      }
      expect(fs.readFileSync(note(), "utf8")).toBe(before);
      expect(fs.statSync(note()).mtimeMs).toBe(info.mtimeMs);
      expect(strays()).toEqual([]);
      // and the next save, with the failure gone, goes through
      writeWorkspaceFile(scope(), note(), "texto novo\n", { mode: "replace", expectSha256: sha(before) });
      expect(fs.readFileSync(note(), "utf8")).toBe("texto novo\n");
    },
  );

  it("C57 an edit that lands while the new bytes are being written is a conflict, not overwritten", () => {
    fs.writeFileSync(note(), "base\n");
    const spy = vi.spyOn(fs, "fsyncSync").mockImplementationOnce(() => {
      fs.writeFileSync(note(), "alguém escreveu aqui\n"); // between the first check and the rename
    });
    try {
      expect(() =>
        writeWorkspaceFile(scope(), note(), "meu texto\n", { mode: "replace", expectSha256: sha("base\n") }),
      ).toThrow(EditConflictError);
    } finally {
      spy.mockRestore();
    }
    expect(fs.readFileSync(note(), "utf8")).toBe("alguém escreveu aqui\n");
    expect(strays()).toEqual([]);
  });

  it("C57 the replacement keeps the permission bits of the file it replaces", () => {
    fs.writeFileSync(note(), "um\n");
    fs.chmodSync(note(), 0o640);
    writeWorkspaceFile(scope(), note(), "dois\n", { mode: "replace", expectSha256: sha("um\n") });
    expect(fs.statSync(note()).mode & 0o777).toBe(0o640);
    expect(fs.readFileSync(note(), "utf8")).toBe("dois\n");
    fs.chmodSync(note(), 0o644);
  });

  it("C57 never creates: a missing file is ENOENT and no folder is made", () => {
    const missing = path.join(home, "memory", "nova-pasta", "nada.md");
    expect(() =>
      writeWorkspaceFile(scope(), missing, "x", { mode: "replace", expectSha256: sha("") }),
    ).toThrow(expect.objectContaining({ code: "ENOENT" }));
    expect(fs.existsSync(path.dirname(missing))).toBe(false);
  });

  it("C57 still refuses a link, a hard link of a private file, a private folder and a folder, with the file untouched", () => {
    const token = path.join(home, "config", "token");
    const link = path.join(home, "memory", "ligada.md");
    fs.symlinkSync(token, link);
    expect(() =>
      writeWorkspaceFile(scope(), link, "x", { mode: "replace", expectSha256: sha(TOKEN) }),
    ).toThrow(PathAccessError);
    const hard = path.join(home, "memory", "dura.md");
    fs.linkSync(token, hard);
    expect(() =>
      writeWorkspaceFile(scope(), hard, "x", { mode: "replace", expectSha256: sha(TOKEN) }),
    ).toThrow(PathAccessError);
    expect(() =>
      writeWorkspaceFile(scope(), token, "x", { mode: "replace", expectSha256: sha(TOKEN) }),
    ).toThrow(PathAccessError);
    expect(() =>
      writeWorkspaceFile(scope(), path.join(home, "memory"), "x", { mode: "replace", expectSha256: sha("") }),
    ).toThrow();
    expect(fs.readFileSync(token, "utf8")).toBe(TOKEN);
  });

  it("C57 the guard is a property of replace: append and create refuse it", () => {
    for (const mode of ["append", "create"] as const) {
      expect(() => writeWorkspaceFile(scope(), note(), "x", { mode, expectSha256: sha("") })).toThrow(
        TypeError,
      );
    }
  });
});
