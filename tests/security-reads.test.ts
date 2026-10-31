import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import type { FastifyInstance } from "fastify";
import ts from "typescript";
import { PathAccessError, type AgentAdapter } from "@mordomo/core";
import {
  FileTooLargeError,
  MemoryIndexer,
  NotRegularFileError,
  RoutineSchema,
  RunManager,
  SettingsStore,
  assertWritablePath,
  findOnPath,
  homeReadScope,
  inspectPath,
  listWorkspaceDir,
  makeWorkspaceFilter,
  openWorkspaceFile,
  readScope,
  readWorkspaceFile,
  readWorkspaceText,
  resolveWorkspaceCwd,
  statWorkspacePath,
} from "@mordomo/core/internal";
import { ClaudeAdapter } from "@mordomo/adapter-claude";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { FAKE_BIN, makeTempHome, withFakeBinPath } from "./helpers.js";
import { EXPECTED_ROUTE_SCOPES } from "./helpers/routeScopes.js";
import {
  NEUTRAL_APIS,
  RAW_APIS,
  READ_APIS,
  WRITE_APIS,
  auditProgram,
  fsPathApis,
  unclassifiedFsPathApis,
  auditVirtual,
  createAuditProgram,
  sourceFilesUnder,
  type RawRead,
} from "./fsReadAudit.js";

/**
 * Security P1, round 2 (.specs/features/seguranca-p1, C19+): the guard sits where a file is READ, not where a
 * call is written. Round 1 closed `preview`; the verifier then read the owner token through the journal, the
 * sync plan and recall, and started an agent in `config/` through a routine. The proofs here plant a REAL link
 * to `<home>/config/token` and ask each reader, as a paired device and as the owner, whether the token comes
 * back; and `fsReadAudit.ts` fails the build when any reader bypasses the safe-read primitive.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POSIX = process.platform !== "win32";
const real = (p: string) => fs.realpathSync(p);
const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

// ---------------------------------------------------------------------------
describe.skipIf(!POSIX)("C19 the safe-read primitive", () => {
  let base: string;
  let home: string;
  let outside: string;
  const TOKEN = "OWNER-TOKEN-0123456789abcdef0123456789abcdef0123456789abcdef";

  beforeAll(() => {
    base = real(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-reads-prim-")));
    home = path.join(base, "home");
    outside = path.join(base, "outside");
    write(path.join(home, "config", "token"), TOKEN);
    write(path.join(home, "config", "file.txt"), TOKEN);
    write(path.join(home, "logs", "runs.jsonl"), "PROMPT");
    write(path.join(home, "memory", "note.md"), "NOTE");
    write(path.join(home, "memory", "sub", "file.txt"), "PUBLIC");
    write(path.join(outside, "elsewhere.txt"), "ELSEWHERE");
    fs.mkdirSync(path.join(home, "memory", "dir"), { recursive: true });
    fs.symlinkSync(path.join(home, "config", "token"), path.join(home, "memory", "to-token"));
    fs.symlinkSync(path.join(home, "config"), path.join(home, "memory", "to-config"));
    fs.symlinkSync(path.join(home, "memory", "note.md"), path.join(home, "memory", "to-note"));
    fs.symlinkSync(path.join(home, "memory", "gone"), path.join(home, "memory", "dangling"));
    fs.symlinkSync(path.join(outside, "elsewhere.txt"), path.join(home, "memory", "to-outside"));
    fs.symlinkSync(path.join(home, "config", "token"), path.join(home, "memory", "id_rsa"));
    write(path.join(home, "memory", ".env"), "SECRET=1");
    fs.symlinkSync(path.join(home, "memory", ".env"), path.join(home, "memory", "innocent.md"));
  });
  afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

  const wide = () => readScope({ homeDir: home, roots: [home] });
  const narrow = () => homeReadScope(home, [path.join(home, "memory")]);

  it("reads a file inside the scope, with its size and a byte cap", () => {
    const read = readWorkspaceFile(wide(), path.join(home, "memory", "note.md"), { maxBytes: 100 });
    expect(read.bytes.toString()).toBe("NOTE");
    expect(read.truncated).toBe(false);
    expect(readWorkspaceFile(wide(), path.join(home, "memory", "note.md"), { maxBytes: 2 })).toMatchObject({
      truncated: true,
      size: 4,
    });
    expect(readWorkspaceText(wide(), path.join(home, "memory", "note.md"), { maxBytes: 2 }).text).toBe("NO");
    expect(() =>
      readWorkspaceFile(wide(), path.join(home, "memory", "note.md"), { maxBytes: 2, strict: true }),
    ).toThrow(FileTooLargeError);
    // A link that stays inside the scope and is not private is still a file.
    expect(readWorkspaceText(wide(), path.join(home, "memory", "to-note"), { maxBytes: 100 }).text).toBe(
      "NOTE",
    );
  });

  it("refuses the home's config and logs, directly and by every way of reaching them", () => {
    const refused: Record<string, string> = {
      "config/token": path.join(home, "config", "token"),
      logs: path.join(home, "logs", "runs.jsonl"),
      "dot-dot": `${home}/memory/../config/token`,
      "link to the file": path.join(home, "memory", "to-token"),
      "link to the folder": path.join(home, "memory", "to-config", "token"),
      "trailing slash": `${home}/config/`,
    };
    for (const [name, p] of Object.entries(refused)) {
      for (const scope of [wide(), narrow()]) {
        expect(() => readWorkspaceText(scope, p, { maxBytes: 1000 }), name).toThrow(PathAccessError);
      }
    }
  });

  it("refuses what lies outside the roots, what the filter names, and a link that dangles", () => {
    expect(() => readWorkspaceText(narrow(), path.join(outside, "elsewhere.txt"), { maxBytes: 10 })).toThrow(
      PathAccessError,
    );
    // A link inside memory/ to a file outside every root.
    expect(() =>
      readWorkspaceText(narrow(), path.join(home, "memory", "to-outside"), { maxBytes: 10 }),
    ).toThrow(PathAccessError);
    // The filter judges the REAL path: a harmless name pointing at .env, a secret name pointing at the token.
    for (const name of ["innocent.md", "id_rsa", ".env"]) {
      expect(
        () => readWorkspaceText(wide(), path.join(home, "memory", name), { maxBytes: 100 }),
        name,
      ).toThrow(PathAccessError);
    }
    // A dangling link is no file: not followed, not created through.
    expect(() =>
      readWorkspaceText(wide(), path.join(home, "memory", "dangling"), { maxBytes: 10 }),
    ).toThrow();
    // Not there at all: the plain ENOENT, so a route can answer 404.
    expect(() => readWorkspaceText(wide(), path.join(home, "memory", "nope.md"), { maxBytes: 10 })).toThrow(
      expect.objectContaining({ code: "ENOENT" }),
    );
  });

  it("answers a directory and a pipe with NotRegularFileError, without blocking", () => {
    expect(() => openWorkspaceFile(wide(), path.join(home, "memory", "dir"))).toThrow(NotRegularFileError);
    const fifo = path.join(home, "memory", "pipe");
    execFileSync("mkfifo", [fifo]);
    const started = Date.now();
    expect(() => openWorkspaceFile(wide(), fifo)).toThrow(NotRegularFileError);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("streams from the descriptor it verified", async () => {
    const file = openWorkspaceFile(wide(), path.join(home, "memory", "note.md"));
    expect(file.stat.size).toBe(4);
    expect(file.sha256()).toMatch(/^[0-9a-f]{64}$/);
    const chunks: Buffer[] = [];
    for await (const chunk of file.createReadStream()) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe("NOTE");
    file.close(); // the stream owns the descriptor now: closing again is harmless
  });

  it("lists a folder without links and without what the filter refuses", () => {
    const names = listWorkspaceDir(wide(), path.join(home, "memory")).map((e) => e.name);
    expect(names).toContain("note.md");
    expect(names).toContain("sub");
    for (const hidden of ["to-token", "to-config", "to-note", "dangling", ".env", "id_rsa", "innocent.md"]) {
      expect(names, hidden).not.toContain(hidden);
    }
    expect(() => listWorkspaceDir(wide(), path.join(home, "config"))).toThrow(PathAccessError);
    expect(() => listWorkspaceDir(narrow(), path.join(home, "memory", "to-config"))).toThrow(PathAccessError);
  });

  it("stat answers for a granted path only", () => {
    expect(statWorkspacePath(wide(), path.join(home, "memory", "note.md")).stat.size).toBe(4);
    expect(() => statWorkspacePath(wide(), path.join(home, "memory", "to-token"))).toThrow(PathAccessError);
  });

  it("closes the window between the check and the open (the last component becomes a link)", () => {
    const target = path.join(home, "memory", "swapme.md");
    write(target, "HARMLESS");
    const open = fs.openSync.bind(fs);
    let swapped = false;
    const spy = vi.spyOn(fs, "openSync").mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      if (!swapped && p === target) {
        swapped = true;
        fs.rmSync(target);
        fs.symlinkSync(path.join(home, "config", "token"), target);
      }
      return (open as (...a: unknown[]) => number)(p, ...rest);
    }) as typeof fs.openSync);
    try {
      expect(() => readWorkspaceText(wide(), target, { maxBytes: 1000 })).toThrow(PathAccessError);
      expect(swapped).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("closes the window between the check and the open (a folder on the way becomes a link)", () => {
    const folder = path.join(home, "memory", "sub");
    const aside = path.join(home, "memory", "sub-aside");
    const candidate = path.join(folder, "file.txt");
    const open = fs.openSync.bind(fs);
    let swapped = false;
    const spy = vi.spyOn(fs, "openSync").mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      if (!swapped && p === candidate) {
        swapped = true;
        fs.renameSync(folder, aside);
        fs.symlinkSync(path.join(home, "config"), folder); // sub/file.txt is now config/file.txt: the token
      }
      return (open as (...a: unknown[]) => number)(p, ...rest);
    }) as typeof fs.openSync);
    try {
      // The open itself succeeds on the token; what comes back to the caller must not.
      let leaked: string | null = null;
      try {
        leaked = readWorkspaceText(wide(), candidate, { maxBytes: 1000 }).text;
      } catch (err) {
        expect(err).toBeInstanceOf(PathAccessError);
      }
      expect(swapped).toBe(true);
      expect(leaked).toBeNull();
    } finally {
      spy.mockRestore();
      fs.rmSync(folder, { force: true });
      if (fs.existsSync(aside)) fs.renameSync(aside, folder);
    }
  });

  it("closes the window between the check and the open (a folder on the way becomes a link to a harmless place)", () => {
    const folder = path.join(home, "memory", "sub");
    const aside = path.join(home, "memory", "sub-aside2");
    const other = path.join(home, "memory", "sub2");
    write(path.join(other, "file.txt"), "OTHER-PLACE");
    const candidate = path.join(folder, "file.txt");
    const open = fs.openSync.bind(fs);
    let swapped = false;
    const spy = vi.spyOn(fs, "openSync").mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      if (!swapped && p === candidate) {
        swapped = true;
        fs.renameSync(folder, aside);
        fs.symlinkSync(other, folder);
      }
      return (open as (...a: unknown[]) => number)(p, ...rest);
    }) as typeof fs.openSync);
    try {
      // Nothing private here, but the path no longer means what was checked: refused, not read.
      expect(() => readWorkspaceText(wide(), candidate, { maxBytes: 1000 })).toThrow(PathAccessError);
      expect(swapped).toBe(true);
    } finally {
      spy.mockRestore();
      fs.rmSync(folder, { force: true });
      if (fs.existsSync(aside)) fs.renameSync(aside, folder);
    }
  });

  it("closes the window between the check and the open (the file is replaced once it is open)", () => {
    const target = path.join(home, "memory", "replaced.md");
    write(target, "FIRST");
    const stat = fs.fstatSync.bind(fs);
    let swapped = false;
    const spy = vi.spyOn(fs, "fstatSync").mockImplementation(((fd: number, ...rest: unknown[]) => {
      const result = (stat as (...a: unknown[]) => fs.Stats)(fd, ...rest);
      if (!swapped) {
        swapped = true; // the descriptor is on the first file; the name now belongs to another
        write(`${target}.new`, "SECOND");
        fs.renameSync(`${target}.new`, target);
      }
      return result;
    }) as typeof fs.fstatSync);
    try {
      expect(() => readWorkspaceText(wide(), target, { maxBytes: 1000 })).toThrow(PathAccessError);
      expect(swapped).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("refuses to write through a link, a dangling one included", () => {
    expect(() => assertWritablePath(wide(), path.join(home, "memory", "to-note"))).toThrow(PathAccessError);
    expect(() => assertWritablePath(wide(), path.join(home, "memory", "dangling"))).toThrow(PathAccessError);
    expect(assertWritablePath(wide(), path.join(home, "memory", "new-file.md"))).toBe(
      path.join(home, "memory", "new-file.md"),
    );
  });

  it("applies the one working-directory rule: inside a root, outside config and logs", () => {
    expect(resolveWorkspaceCwd(wide(), path.join(home, "memory"))).toBe(path.join(home, "memory"));
    for (const p of [
      path.join(home, "config"),
      path.join(home, "config", "db"),
      path.join(home, "logs"),
      path.join(home, "memory", "to-config"),
      `${home}/memory/../config`,
      outside,
    ]) {
      expect(() => resolveWorkspaceCwd(wide(), p), p).toThrow(PathAccessError);
    }
  });
});

// ---------------------------------------------------------------------------
describe.skipIf(!POSIX)("a paired device and the owner cannot read the owner token through any route", () => {
  let ctx: AppContext;
  let app: FastifyInstance;
  let home: string;
  let userFolder: string;
  let ownerToken: string;
  let deviceToken: string;
  let cleanup: () => void;
  let restorePath: () => void;

  const asOwner = () => ({ "x-mordomo-token": ownerToken, "content-type": "application/json" });
  const asDevice = () => ({
    "x-mordomo-token": deviceToken,
    "content-type": "application/json",
    host: "mordomo.local:4777",
  });
  const principals = () =>
    [
      ["device", asDevice()],
      ["owner", asOwner()],
    ] as const;
  const tokenFile = () => path.join(home, "config", "token");
  const link = (target: string, at: string) => {
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.rmSync(at, { force: true });
    fs.symlinkSync(target, at);
  };
  const noToken = (res: { body: string }, label: string) => expect(res.body, label).not.toContain(ownerToken);
  const runCount = () => (ctx.db.prepare("SELECT COUNT(*) c FROM runs").get() as { c: number }).c;

  beforeAll(async () => {
    restorePath = withFakeBinPath();
    const tmp = makeTempHome("mordomo-reads-");
    cleanup = tmp.cleanup;
    home = real(tmp.paths.home);
    ctx = new AppContext(tmp.paths.home);
    userFolder = real(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-reads-user-")));
    const settings = ctx.settings();
    settings.setupCompleted = true;
    settings.remote.enabled = true;
    settings.remote.allowedHosts = ["mordomo.local"];
    settings.indexedFolders = [{ path: userFolder, area: null, enabled: true }];
    settings.providers.claude.enabled = true;
    settings.providers.claude.binaryPath = path.join(FAKE_BIN, "claude");
    ctx.settingsStore.save(settings);
    ctx.reloadAdapters();
    ownerToken = ctx.token();
    app = await buildServer(ctx);
    const start = await app.inject({
      method: "POST",
      url: "/api/pair/start",
      headers: asOwner(),
      payload: {},
    });
    const claim = await app.inject({
      method: "POST",
      url: "/api/pair/claim",
      payload: { code: (start.json() as { code: string }).code, name: "lost phone" },
    });
    deviceToken = (claim.json() as { token: string }).token;
    // A skill to run, and a harmless note in every readable corner.
    write(
      path.join(home, "skills", "runme", "SKILL.md"),
      ["---", "name: Run me", "slug: runme", "description: a skill", "mode: read_only", "---", "Do it."].join(
        "\n",
      ),
    );
    write(path.join(home, "memory", "other.md"), "# other\nOTHER-NOTE\n");
  });

  afterAll(async () => {
    await ctx.runs.shutdown(2000);
    await app.close();
    ctx.close();
    fs.rmSync(userFolder, { recursive: true, force: true });
    restorePath();
    cleanup();
  });

  // ---- A2: the journal ----------------------------------------------------------------------------------
  it("C20 a journal day that is a link to the token is not served, not written through, not listed", async () => {
    const journal = path.join(home, "memory", "journal");
    link(tokenFile(), path.join(journal, "2026-01-02.md"));
    link(path.join(home, "memory", "other.md"), path.join(journal, "2026-01-04.md"));
    link(path.join(home, "memory", "not-there.md"), path.join(journal, "2026-01-06.md"));
    fs.mkdirSync(path.join(journal, "2026-01-05.md"), { recursive: true }); // a folder with a date's name is no day
    const before = fs.readFileSync(tokenFile(), "utf8");
    for (const [who, headers] of principals()) {
      const day = await app.inject({ method: "GET", url: "/api/memory/journal?date=2026-01-02", headers });
      expect(day.statusCode, who).toBe(403);
      expect(day.json().error.code, who).toBe("forbidden_path");
      noToken(day, who);

      // The window view leaves the bad day out instead of failing, and still never shows it.
      const window = await app.inject({
        method: "GET",
        url: "/api/memory/journal?date=2026-01-03&days=3",
        headers,
      });
      expect(window.statusCode, who).toBe(200);
      noToken(window, who);
      expect(
        window.json().days.map((d: { date: string }) => d.date),
        who,
      ).not.toContain("2026-01-02");

      // Appending to that day is refused and writes nothing into the token file.
      const append = await app.inject({
        method: "POST",
        url: "/api/memory/journal/append",
        headers,
        payload: { date: "2026-01-02", text: "pwned" },
      });
      expect(append.statusCode, who).toBe(403);
      noToken(append, who);

      // A dangling link is not created through.
      const dangling = await app.inject({
        method: "GET",
        url: "/api/memory/journal?date=2026-01-06",
        headers,
      });
      expect(dangling.statusCode, who).toBe(403);
      // ... and appending to it creates nothing through it, nor does appending to a link to another note
      for (const date of ["2026-01-06", "2026-01-04"]) {
        const refused = await app.inject({
          method: "POST",
          url: "/api/memory/journal/append",
          headers,
          payload: { date, text: "must not land" },
        });
        expect(refused.statusCode, `${who} append ${date}`).toBe(403);
      }

      // A link that stays inside memory/ is an ordinary note, and the listing hides links.
      const inside = await app.inject({ method: "GET", url: "/api/memory/journal?date=2026-01-04", headers });
      expect(inside.statusCode, who).toBe(200);
      expect(inside.json().content, who).toContain("OTHER-NOTE");
      expect(inside.json().dates, who).not.toContain("2026-01-02");
      expect(inside.json().dates, `${who} a folder named like a day`).not.toContain("2026-01-05");
    }
    expect(
      fs.readFileSync(path.join(home, "memory", "other.md"), "utf8"),
      "the linked note is unchanged",
    ).toBe("# other\nOTHER-NOTE\n");
    expect(fs.readFileSync(tokenFile(), "utf8")).toBe(before);
    expect(
      fs.lstatSync(path.join(home, "memory", "not-there.md"), { throwIfNoEntry: false }),
    ).toBeUndefined();
  });

  // ---- A3: the sync plan ---------------------------------------------------------------------------------
  it("C21 a sync target whose instruction files are links to the token shows no token and is not written through", async () => {
    const withCodex = ctx.settings();
    withCodex.providers.codex.enabled = true;
    ctx.settingsStore.save(withCodex);
    const target = path.join(userFolder, "proj");
    fs.mkdirSync(target, { recursive: true });
    link(tokenFile(), path.join(target, "CLAUDE.md"));
    link(tokenFile(), path.join(target, "AGENTS.md"));
    const before = fs.readFileSync(tokenFile(), "utf8");
    for (const [who, headers] of principals()) {
      const plan = await app.inject({
        method: "GET",
        url: `/api/sync/plan?target=${encodeURIComponent(target)}`,
        headers,
      });
      if (who === "device") {
        // escopos-dispositivo (AD-015): the plan is the owner's, so a device is turned away before the target is read.
        expect(plan.statusCode, who).toBe(403);
        expect(plan.json().error.code, who).toBe("owner_only");
        noToken(plan, who);
        continue;
      }
      expect(plan.statusCode, who).toBe(200);
      noToken(plan, who);
      const actions = plan.json().actions as Array<{ filePath: string; kind: string; diff: string | null }>;
      for (const name of ["CLAUDE.md", "AGENTS.md"]) {
        const action = actions.find((a) => a.filePath === path.join(target, name));
        expect(action?.kind, `${who} ${name}`).toBe("conflict");
        expect(action?.diff, `${who} ${name}`).toBeNull();
      }
      expect(
        actions.some((a) => a.kind === "create"),
        who,
      ).toBe(true);
    }
    // Even approved, an overwrite does not follow the link: the token and the links stay.
    const apply = await app.inject({
      method: "POST",
      url: "/api/sync/apply",
      headers: asOwner(),
      payload: {
        target,
        approvedConflicts: [path.join(target, "CLAUDE.md"), path.join(target, "AGENTS.md")],
      },
    });
    expect(apply.statusCode).toBe(200);
    expect(apply.json().skippedConflicts).toEqual(
      expect.arrayContaining([path.join(target, "CLAUDE.md"), path.join(target, "AGENTS.md")]),
    );
    expect(fs.readFileSync(tokenFile(), "utf8")).toBe(before);
    expect(fs.lstatSync(path.join(target, "CLAUDE.md")).isSymbolicLink()).toBe(true);

    // A target that is a link to ANOTHER readable file of the folder is read like any file, but a write
    // does not follow it: approved or not, the file behind the link stays as it was.
    const second = path.join(userFolder, "proj2");
    write(path.join(second, "real-claude.md"), "# hand-written, do not touch\n");
    link(path.join(second, "real-claude.md"), path.join(second, "CLAUDE.md"));
    const applyLinked = await app.inject({
      method: "POST",
      url: "/api/sync/apply",
      headers: asOwner(),
      payload: { target: second, approvedConflicts: [path.join(second, "CLAUDE.md")] },
    });
    expect(applyLinked.statusCode, applyLinked.body).toBe(200);
    expect(applyLinked.json().skippedConflicts).toContain(path.join(second, "CLAUDE.md"));
    expect(applyLinked.json().backupDir, "no copy is kept of a file that will not be written").toBeNull();
    expect(fs.readFileSync(path.join(second, "real-claude.md"), "utf8")).toBe(
      "# hand-written, do not touch\n",
    );
    expect(fs.lstatSync(path.join(second, "CLAUDE.md")).isSymbolicLink()).toBe(true);

    // A target that becomes a link AFTER it was read (while the copy is being kept) is skipped, not an error.
    const fourth = path.join(userFolder, "proj4");
    write(path.join(fourth, "CLAUDE.md"), "# plain when read\n");
    write(path.join(fourth, "other.md"), "# somebody else's file\n");
    const mkdirRaw = fs.mkdirSync.bind(fs);
    let raced = false;
    const racing = vi.spyOn(fs, "mkdirSync").mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      // the backup folder is made after the target was read and before it is written
      if (!raced && String(p).includes(`${path.sep}backups${path.sep}sync-`)) {
        raced = true;
        fs.rmSync(path.join(fourth, "CLAUDE.md"));
        fs.symlinkSync(path.join(fourth, "other.md"), path.join(fourth, "CLAUDE.md"));
      }
      return (mkdirRaw as (...a: unknown[]) => unknown)(p, ...rest);
    }) as typeof fs.mkdirSync);
    let applyRaced;
    try {
      applyRaced = await app.inject({
        method: "POST",
        url: "/api/sync/apply",
        headers: asOwner(),
        payload: { target: fourth, approvedConflicts: [path.join(fourth, "CLAUDE.md")] },
      });
    } finally {
      racing.mockRestore();
    }
    expect(raced).toBe(true);
    expect(applyRaced.statusCode, applyRaced.body).toBe(200);
    expect(applyRaced.json().skippedConflicts).toContain(path.join(fourth, "CLAUDE.md"));
    expect(fs.readFileSync(path.join(fourth, "other.md"), "utf8")).toBe("# somebody else's file\n");

    // The copy kept before an overwrite is the owner's alone (0600) in a folder of its own (0700).
    const third = path.join(userFolder, "proj3");
    write(path.join(third, "CLAUDE.md"), "# the owner's file, about to be replaced\n");
    const applyBacked = await app.inject({
      method: "POST",
      url: "/api/sync/apply",
      headers: asOwner(),
      payload: { target: third, approvedConflicts: [path.join(third, "CLAUDE.md")] },
    });
    expect(applyBacked.statusCode, applyBacked.body).toBe(200);
    const backupDir = applyBacked.json().backupDir as string;
    expect(backupDir).toBeTruthy();
    const kept: string[] = [];
    const walkBackup = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walkBackup(path.join(dir, e.name));
        else kept.push(path.join(dir, e.name));
      }
    };
    walkBackup(backupDir);
    expect(kept.length).toBeGreaterThan(0);
    for (const file of kept) expect(fs.statSync(file).mode & 0o777, file).toBe(0o600);
    expect(fs.statSync(path.dirname(backupDir)).mode & 0o777, "config/backups").toBe(0o700);
    expect(fs.readFileSync(kept[0]!, "utf8")).toContain("the owner's file");

    // A target inside the home's private folders is no target at all.
    for (const [who, headers] of principals()) {
      for (const rel of ["config", "logs"]) {
        fs.mkdirSync(path.join(home, rel), { recursive: true });
        const res = await app.inject({
          method: "GET",
          url: `/api/sync/plan?target=${encodeURIComponent(path.join(home, rel))}`,
          headers,
        });
        expect(res.statusCode, `${who} ${rel}`).toBe(403);
        // The plan is the owner's (AD-015): a device is turned away before the target is looked at.
        expect(res.json().error.code).toBe(who === "device" ? "owner_only" : "forbidden_path");
      }
    }
  });

  // ---- A4: recall, and the old index ----------------------------------------------------------------------
  it("C22 recall and search never return a file that is, or became, private", async () => {
    // (a) a plain indexed note that is later swapped for a link to the token
    const note = path.join(userFolder, "notes", "plain.md");
    write(note, "# zebra mango\nzebra mango plain content\n");
    ctx.indexer.indexAll();
    for (const [who, headers] of principals()) {
      const ok = await app.inject({
        method: "GET",
        url: "/api/memory/recall?q=zebra%20mango&record=false",
        headers,
      });
      expect(ok.json().answerContext.length, who).toBeGreaterThan(0);
    }
    fs.rmSync(note);
    fs.symlinkSync(tokenFile(), note);
    for (const [who, headers] of principals()) {
      const res = await app.inject({
        method: "GET",
        url: "/api/memory/recall?q=zebra%20mango&record=false",
        headers,
      });
      expect(res.statusCode, who).toBe(200);
      noToken(res, who);
      expect(res.json().answerContext, who).toEqual([]);
      expect(res.json().candidates, who).toEqual([]);
    }
    fs.rmSync(note);

    // (b) an index written before config/ was private: rows for the home's config/ files, content included
    const insert = ctx.db.prepare(
      "INSERT INTO files (root, path, rel, name, ext, dir, area, size, mtime, indexed_at, title, tags, fields) VALUES (?, ?, ?, ?, ?, ?, NULL, 1, 1, 1, NULL, '[]', '{}')",
    );
    const fts = ctx.db.prepare("INSERT INTO files_fts (rowid, name, rel, content) VALUES (?, ?, ?, ?)");
    const old = ctx.db.transaction(() => {
      const id = Number(
        insert.run(home, tokenFile(), "config/token", "token", "", path.join(home, "config")).lastInsertRowid,
      );
      fts.run(id, "token", "config/token", `oldsecret ${ownerToken}`);
    });
    old();
    for (const [who, headers] of principals()) {
      const recall = await app.inject({
        method: "GET",
        url: "/api/memory/recall?q=oldsecret&record=false",
        headers,
      });
      expect(recall.statusCode, who).toBe(200);
      noToken(recall, who);
      expect(recall.json().answerContext, who).toEqual([]);
      const search = await app.inject({ method: "GET", url: "/api/memory/search?q=oldsecret", headers });
      expect(search.statusCode, who).toBe(200);
      noToken(search, who);
      expect(search.json(), who).toEqual([]);
      // ... and a search with no words at all (a filter only) judges the row too
      const bare = await app.inject({
        method: "GET",
        url: `/api/memory/search?dir=${encodeURIComponent(path.join(home, "config"))}`,
        headers,
      });
      expect(bare.statusCode, who).toBe(200);
      noToken(bare, who);
      expect(bare.json(), `${who} filter-only search`).toEqual([]);
    }
    // Rows the policy no longer allows go at start (and at the next pass).
    expect(ctx.indexer.purgeExcluded()).toBe(1);
    expect(ctx.db.prepare("SELECT COUNT(*) c FROM files WHERE path = ?").get(tokenFile())).toEqual({ c: 0 });
    expect(ctx.indexer.purgeExcluded()).toBe(0);

    // (c) the window between the row check and the open: the note is a plain file when recall judges the
    //     row, and a link to the token by the time it is opened.
    const racy = path.join(userFolder, "notes", "racy.md");
    write(racy, "# quokka\nquokka plain content\n");
    ctx.indexer.indexAll();
    const resolve = fs.realpathSync.bind(fs);
    let swapped = false;
    const spy = vi.spyOn(fs, "realpathSync").mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      const answer = (resolve as (...a: unknown[]) => string)(p, ...rest);
      if (!swapped && String(p).endsWith("racy.md")) {
        swapped = true;
        fs.rmSync(racy);
        fs.symlinkSync(tokenFile(), racy);
      }
      return answer;
    }) as typeof fs.realpathSync);
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/memory/recall?q=quokka&record=false",
        headers: asOwner(),
      });
      expect(swapped).toBe(true);
      expect(res.statusCode).toBe(200);
      noToken(res, "swap during recall");
      expect(res.json().answerContext).toEqual([]);
    } finally {
      spy.mockRestore();
      fs.rmSync(racy, { force: true });
      ctx.indexer.indexAll();
    }
  });

  // ---- A1 and the other ways an agent starts --------------------------------------------------------------
  const routineBody = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: id,
    prompt: "say hi",
    kind: "every",
    every: { value: 60, unit: "minutes" },
    enabled: false,
    ...extra,
  });
  const baseRoutine = (id: string, extra: Record<string, unknown> = {}) =>
    RoutineSchema.parse(routineBody(id, extra));
  const configDirs = () => ["config", "config/db", "config/tls", "logs"].map((r) => path.join(home, r));

  it("C23 a routine cannot be pointed at config or logs: refused at create, at edit and at every fire", async () => {
    for (const dir of configDirs()) fs.mkdirSync(dir, { recursive: true });
    const runsBefore = runCount();
    for (const [who, headers] of principals()) {
      for (const dir of configDirs()) {
        const create = await app.inject({
          method: "POST",
          url: "/api/routines",
          headers,
          payload: routineBody(`r-${who}`, { workingDir: dir }),
        });
        expect(create.statusCode, `${who} create ${dir}`).toBe(403);
        // A device is turned away before the folder is looked at (routines are the owner's, AD-015).
        expect(create.json().error.code).toBe(who === "device" ? "owner_only" : "forbidden_path");
      }
      expect(ctx.routines.get(`r-${who}`), `${who} stored nothing`).toBeNull();
    }
    // Edit: a fine routine, then an edit that moves it into config/.
    const ok = await app.inject({
      method: "POST",
      url: "/api/routines",
      headers: asOwner(),
      payload: routineBody("moves", { workingDir: userFolder }),
    });
    expect(ok.statusCode).toBe(200);
    for (const [who, headers] of principals()) {
      const edit = await app.inject({
        method: "PUT",
        url: "/api/routines/moves",
        headers,
        payload: routineBody("moves", { workingDir: path.join(home, "config") }),
      });
      expect(edit.statusCode, who).toBe(403);
    }
    expect(ctx.routines.get("moves")?.workingDir).toBe(userFolder);

    // Fire: a stored routine whose folder is private now (written straight to the file, as an old home might have it).
    ctx.routines.save(baseRoutine("stored-private", { workingDir: path.join(home, "config") }));
    // ... or revoked: it was fine when saved, then the folder left the settings.
    ctx.routines.save(baseRoutine("stored-revoked", { workingDir: userFolder }));
    const folders = ctx.settings().indexedFolders;
    ctx.settingsStore.update({ indexedFolders: [] });
    try {
      for (const id of ["stored-private", "stored-revoked"]) {
        for (const [who, headers] of principals()) {
          const fire = await app.inject({
            method: "POST",
            url: `/api/routines/${id}/run`,
            headers,
            payload: {},
          });
          expect(fire.statusCode, `${who} ${id}: ${fire.body}`).toBe(403);
          // Running a routine is the owner's (AD-015): a device never reaches the fire, so only the owner's is recorded.
          expect(fire.json().error.code).toBe(who === "device" ? "owner_only" : "forbidden_path");
        }
        const history = ctx.scheduler.history(id);
        expect(history.length, id).toBe(1);
        expect(
          history.every(
            (h) => h.status === "failed_to_fire" && h.note?.startsWith("Working directory refused:"),
          ),
          id,
        ).toBe(true);
      }
    } finally {
      ctx.settingsStore.update({ indexedFolders: folders });
    }
    expect(runCount()).toBe(runsBefore);

    // The timers (a one-shot or "every" timer, a cron tick) reach the same refusal and record it once, not twice.
    ctx.routines.save(baseRoutine("timer-private", { workingDir: path.join(home, "config"), enabled: true }));
    ctx.routines.save(baseRoutine("cron-private", { workingDir: path.join(home, "config"), enabled: true }));
    const scheduler = ctx.scheduler as unknown as {
      onTimerTick(id: string, scheduledFor: number): Promise<void>;
      onTick(id: string, job: { currentRun(): Date }): Promise<void>;
    };
    await scheduler.onTimerTick("timer-private", Date.now());
    await scheduler.onTick("cron-private", { currentRun: () => new Date() });
    for (const id of ["timer-private", "cron-private"]) {
      const rows = ctx.scheduler.history(id);
      expect(rows.length, `${id}: one row for one refusal`).toBe(1);
      expect(rows[0]?.status, id).toBe("failed_to_fire");
      expect(rows[0]?.note?.startsWith("Working directory refused:"), id).toBe(true);
    }
    expect(runCount()).toBe(runsBefore);

    // The throwaway directory of an isolated routine is still allowed, and it runs.
    ctx.routines.save(baseRoutine("isolated", { context: "isolated" }));
    const isolated = await app.inject({
      method: "POST",
      url: "/api/routines/isolated/run",
      headers: asOwner(),
      payload: {},
    });
    expect(isolated.statusCode).toBe(200);
    await ctx.scheduler.drain();
    expect(ctx.runs.get(isolated.json().runId)?.cwd).toContain(`mordomo-isolated-`);
  });

  it("C24 every entry that takes or keeps a working directory refuses config and logs", async () => {
    const config = path.join(home, "config");
    // Records a request left behind: a parked run per shape, and a session, all pointing into config/ now.
    const parked = (request: object, cwd = home) => {
      const run = ctx.runs.create({
        origin: "manual",
        provider: "claude",
        prompt: "stored",
        request: request as never,
        cwd,
        model: null,
        effort: "default",
        mode: "read_only",
        timeoutMs: 30_000,
        profile: "read_only",
        status: "waiting_approval",
      });
      ctx.db.prepare("UPDATE runs SET cwd = ? WHERE id = ?").run(config, run.id);
      return run.id;
    };
    const promptRun = parked({ version: 1, kind: "prompt", prompt: "again", mode: "read_only" });
    const skillRun = parked({ version: 1, kind: "skill", skillSlug: "runme", inputs: {}, mode: "read_only" });
    const session = ctx.runs.sessions.create({
      provider: "claude",
      cwd: config,
      profile: null,
      title: "old",
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/objectives",
      headers: asOwner(),
      payload: {
        project: "p",
        title: "o",
        description: "d",
        context: {},
        steps: [
          {
            title: "s",
            request: { version: 1, kind: "prompt", prompt: "x", mode: "read_only" },
            priority: 1,
          },
        ],
      },
    });
    const objective = created.json().id as string;
    const withSkill = await app.inject({
      method: "POST",
      url: "/api/objectives",
      headers: asOwner(),
      payload: {
        project: "p",
        title: "o2",
        description: "d",
        context: {},
        steps: [
          {
            title: "s",
            request: { version: 1, kind: "skill", skillSlug: "runme", inputs: {}, mode: "read_only" },
            priority: 1,
          },
        ],
      },
    });
    const skillObjective = withSkill.json().id as string;
    ctx.routines.save(baseRoutine("entry-stored", { workingDir: config }));
    ctx.routines.save(baseRoutine("moves", { workingDir: userFolder }));

    interface Entry {
      name: string;
      /** The route checks the folder itself, before anything is created. */
      route: boolean;
      /** The request ends in `RunManager.create` (a route-level check only is not enough for these). */
      manager: boolean;
      request: () => { method: "POST" | "PUT"; url: string; payload: object };
    }
    const entries: Entry[] = [
      {
        name: "POST /api/runs",
        route: true,
        manager: true,
        request: () => ({ method: "POST", url: "/api/runs", payload: { prompt: "x", cwd: config } }),
      },
      {
        name: "POST /api/skills/:slug/run",
        route: true,
        manager: true,
        request: () => ({ method: "POST", url: "/api/skills/runme/run", payload: { cwd: config } }),
      },
      {
        name: "POST /api/objectives/:id/dispatch (prompt step)",
        route: true,
        manager: true,
        request: () => ({
          method: "POST",
          url: `/api/objectives/${objective}/dispatch`,
          payload: { cwd: config },
        }),
      },
      {
        name: "POST /api/objectives/:id/dispatch (skill step)",
        route: true,
        manager: true,
        request: () => ({
          method: "POST",
          url: `/api/objectives/${skillObjective}/dispatch`,
          payload: { cwd: config },
        }),
      },
      {
        name: "POST /api/routines (workingDir)",
        route: true,
        manager: false,
        request: () => ({
          method: "POST",
          url: "/api/routines",
          payload: routineBody("entry-new", { workingDir: config }),
        }),
      },
      {
        name: "PUT /api/routines/:id (workingDir)",
        route: true,
        manager: false,
        request: () => ({
          method: "PUT",
          url: "/api/routines/moves",
          payload: routineBody("moves", { workingDir: config }),
        }),
      },
      {
        name: "POST /api/sessions/:id/continue (session cwd)",
        route: true,
        manager: true,
        request: () => ({
          method: "POST",
          url: `/api/sessions/${session.id}/continue`,
          payload: { prompt: "more" },
        }),
      },
      {
        name: "POST /api/runs/:id/children (parent cwd)",
        route: true,
        manager: true,
        request: () => ({
          method: "POST",
          url: `/api/runs/${promptRun}/children`,
          payload: { prompts: ["child"] },
        }),
      },
      {
        name: "POST /api/routines/:id/run (stored workingDir)",
        route: false,
        manager: true,
        request: () => ({ method: "POST", url: "/api/routines/entry-stored/run", payload: {} }),
      },
      {
        name: "POST /api/runs/:id/retry (stored cwd, prompt)",
        route: false,
        manager: true,
        request: () => ({
          method: "POST",
          url: `/api/runs/${promptRun}/retry`,
          payload: { submissionId: crypto.randomUUID() },
        }),
      },
      {
        name: "POST /api/runs/:id/retry (stored cwd, skill)",
        route: false,
        manager: true,
        request: () => ({
          method: "POST",
          url: `/api/runs/${skillRun}/retry`,
          payload: { submissionId: crypto.randomUUID() },
        }),
      },
    ];
    const refused = async (entry: Entry, label: string) => {
      for (const [who, headers] of principals()) {
        const { method, url, payload } = entry.request();
        const res = await app.inject({ method, url, headers, payload });
        expect(res.statusCode, `${label}: ${entry.name} as ${who}: ${res.body}`).toBe(403);
        // An entry that is the owner's turns a device away before the folder is looked at (AD-015); the others
        // (a device with `run` may start runs) reach the folder check and are refused there.
        const scope = EXPECTED_ROUTE_SCOPES[entry.name.split(" ").slice(0, 2).join(" ")];
        expect(res.json().error.code, `${label}: ${entry.name} as ${who}`).toBe(
          who === "device" && scope === "owner" ? "owner_only" : "forbidden_path",
        );
      }
    };
    const before = runCount();

    // 1. The whole stack.
    for (const entry of entries) await refused(entry, "whole stack");
    expect(runCount()).toBe(before);

    // 2. Each layer on its own, so removing one of them is seen even though the other still refuses.
    //    The route's own check: nothing is allowed to reach RunManager.create.
    const create = vi.spyOn(ctx.runs, "create").mockImplementation(() => {
      throw new Error("reached RunManager.create");
    });
    try {
      for (const entry of entries.filter((e) => e.route)) await refused(entry, "route layer");
    } finally {
      create.mockRestore();
    }
    //    RunManager's own check: the routes' `resolveCwd` is switched off.
    const resolve = vi.spyOn(ctx, "resolveCwd").mockImplementation((cwd: string) => cwd);
    try {
      for (const entry of entries.filter((e) => e.manager)) await refused(entry, "RunManager layer");
    } finally {
      resolve.mockRestore();
    }
    expect(runCount()).toBe(before);
  });

  // ---- RunManager decides, whoever asks ------------------------------------------------------------------
  it("C25 RunManager refuses a bad working directory itself: at create and at launch", async () => {
    const input = (cwd: string) => ({
      origin: "manual" as const,
      provider: "claude" as const,
      prompt: "x",
      cwd,
      model: null,
      effort: "default" as const,
      mode: "read_only" as const,
      timeoutMs: 30_000,
      profile: "read_only" as const,
    });
    link(path.join(home, "config"), path.join(home, "memory", "to-config"));
    for (const cwd of [
      path.join(home, "config"),
      path.join(home, "config", "db"),
      path.join(home, "logs"),
      path.join(home, "memory", "to-config"),
      `${home}/memory/../config`,
      os.tmpdir(),
    ]) {
      expect(() => ctx.runs.create(input(cwd)), cwd).toThrow(PathAccessError);
    }
    // Allowed ones are stored as their real path.
    expect(ctx.runs.create({ ...input(path.join(home, "memory")), status: "waiting_approval" }).cwd).toBe(
      path.join(home, "memory"),
    );
    expect(ctx.runs.create({ ...input(userFolder), status: "waiting_approval" }).cwd).toBe(userFolder);

    // Launch: a queued run whose folder turned private (or was revoked) never reaches the adapter.
    const executed: string[] = [];
    const real = new ClaudeAdapter({ binaryPath: path.join(FAKE_BIN, "claude") });
    const spy = new Proxy(real, {
      get(target, prop) {
        if (prop === "execute") {
          return (run: { cwd: string }) => {
            executed.push(run.cwd);
            return target.execute(run as never);
          };
        }
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
    const finished = (id: string) => manager.execute(id, "prompt", "read_only");
    const turnedPrivate = manager.create(input(userFolder));
    ctx.db.prepare("UPDATE runs SET cwd = ? WHERE id = ?").run(path.join(home, "config"), turnedPrivate.id);
    const refusedPrivate = await finished(turnedPrivate.id);
    expect(refusedPrivate.status).toBe("failed");
    expect(refusedPrivate.error).toMatch(/granted folders|credentials/);

    const revoked = manager.create(input(userFolder));
    const folders = ctx.settings().indexedFolders;
    ctx.settingsStore.update({ indexedFolders: [] });
    try {
      expect((await finished(revoked.id)).status).toBe("failed");
    } finally {
      ctx.settingsStore.update({ indexedFolders: folders });
    }
    expect(executed).toEqual([]);

    // Control: a good folder does reach the adapter.
    const good = manager.create(input(userFolder));
    expect((await finished(good.id)).status).toBe("done");
    expect(executed).toEqual([userFolder]);
  });

  // ---- S2: the diff prefilter ----------------------------------------------------------------------------
  it("C26 the diff of a tracked secret file is refused before git runs; a tracked config of the home is a 403", async () => {
    const gitPath = findOnPath("git");
    expect(gitPath, "git must be installed to prove C26").not.toBeNull();
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
    const git = (cwd: string, ...args: string[]) =>
      execFileSync(gitPath!, ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      }).toString();
    const repo = path.join(userFolder, "secrets-repo");
    fs.mkdirSync(repo);
    git(repo, "init", "-q");
    const files: Record<string, string> = {
      ".env": "API_KEY=first-secret\n",
      "server.pem": "-----BEGIN PRIVATE KEY-----\nfirst\n",
      "ok.txt": "one\n",
    };
    for (const [name, text] of Object.entries(files)) write(path.join(repo, name), text);
    git(repo, "add", "-f", ".");
    git(repo, "commit", "-q", "-m", "init");
    write(path.join(repo, ".env"), "API_KEY=second-secret\n");
    write(path.join(repo, "server.pem"), "-----BEGIN PRIVATE KEY-----\nsecond\n");
    write(path.join(repo, "ok.txt"), "two\n");
    const run = ctx.runs.create({
      origin: "manual",
      provider: "claude",
      prompt: "diff",
      cwd: repo,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 30_000,
      profile: "read_only",
      status: "waiting_approval",
    });
    for (const [who, headers] of principals()) {
      for (const secret of [".env", "server.pem"]) {
        const res = await app.inject({
          method: "GET",
          url: `/api/runs/${run.id}/diff?file=${secret}`,
          headers,
        });
        expect(res.statusCode, `${who} ${secret}`).toBe(200);
        expect(res.json().kind, `${who} ${secret}`).toBe("unavailable");
        expect(res.body, `${who} ${secret}`).not.toMatch(/first-secret|second-secret|BEGIN PRIVATE KEY/);
      }
      const fine = await app.inject({ method: "GET", url: `/api/runs/${run.id}/diff?file=ok.txt`, headers });
      expect(fine.json().kind, who).toBe("git");
      expect(fine.json().diff, who).toContain("+two");
    }

    // The home itself checked out as a repository (a source checkout): its tracked config/ is not diffable.
    git(home, "init", "-q");
    write(path.join(home, "config", "tracked.txt"), "tracked-secret\n");
    git(home, "add", "-f", "config/tracked.txt");
    git(home, "commit", "-q", "-m", "init");
    write(path.join(home, "config", "tracked.txt"), "changed-secret\n");
    const homeRun = ctx.runs.create({
      origin: "manual",
      provider: "claude",
      prompt: "diff",
      cwd: path.join(home, "memory"),
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 30_000,
      profile: "read_only",
      status: "waiting_approval",
    });
    for (const [who, headers] of principals()) {
      const res = await app.inject({
        method: "GET",
        url: `/api/runs/${homeRun.id}/diff?file=${encodeURIComponent(path.join(home, "config", "tracked.txt"))}`,
        headers,
      });
      expect(res.statusCode, who).toBe(403);
      expect(res.body, who).not.toContain("changed-secret");
    }
    fs.rmSync(path.join(home, ".git"), { recursive: true, force: true });
  });

  // ---- S3: a symlinked home, a symlinked indexed root ------------------------------------------------------
  it("C27 a home reached through a symlink, and an indexed root that is a symlink, stay private", () => {
    const aliasDir = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-reads-alias-"));
    try {
      const homeLink = path.join(aliasDir, "home-link");
      const configLink = path.join(aliasDir, "config-link");
      fs.symlinkSync(home, homeLink);
      fs.symlinkSync(path.join(home, "config"), configLink);
      write(path.join(home, "config", "alias-note.md"), "# ALIAS-CONFIG-NOTE zebra\n");
      write(path.join(home, "memory", "alias-ok.md"), "# alias ok zebra\n");

      // The filter, with the home spelled through the link: both spellings of a private file are refused.
      const filter = makeWorkspaceFilter([], { homeDir: homeLink });
      for (const p of [
        path.join(home, "config", "token"),
        path.join(homeLink, "config", "token"),
        path.join(home, "logs", "x"),
        path.join(homeLink, "logs", "x"),
      ]) {
        expect(filter.isExcluded(path.relative(home, p), p), p).toBe(true);
      }
      expect(filter.isExcluded("memory/alias-ok.md", path.join(home, "memory", "alias-ok.md"))).toBe(false);
      // ... and the scope built on that spelling refuses the real path of a private file.
      const scope = readScope({ homeDir: homeLink, roots: [homeLink] });
      expect(() => inspectPath(scope, path.join(home, "config", "token"))).toThrow(PathAccessError);
      expect(() => inspectPath(scope, path.join(homeLink, "config", "token"))).toThrow(PathAccessError);

      // The indexer: the home as an indexed root through the link, and a root that IS config/ through a link.
      // Two layers keep config/ out: the scan never lists it (judged on the real path) and the read refuses it.
      // Listing is watched so that each layer is proven alone.
      const listed: string[] = [];
      const listDir = fs.readdirSync.bind(fs);
      const watch = vi.spyOn(fs, "readdirSync").mockImplementation(((
        dir: fs.PathLike,
        ...rest: unknown[]
      ) => {
        listed.push(String(dir));
        return (listDir as (...a: unknown[]) => unknown)(dir, ...rest);
      }) as typeof fs.readdirSync);
      const indexed = (roots: string[], homeDir: string) => {
        listed.length = 0;
        const indexer = new MemoryIndexer(
          ctx.db,
          () => ({
            ...ctx.settings(),
            indexedFolders: roots.map((r) => ({ path: r, area: null, enabled: true })),
          }),
          { homeDir },
        );
        const stats = indexer.indexAll();
        const paths = (ctx.db.prepare("SELECT path FROM files").all() as Array<{ path: string }>).map(
          (r) => r.path,
        );
        const listedPrivate = listed.filter((dir) => {
          const resolved = fs.realpathSync(dir);
          return [path.join(home, "config"), path.join(home, "logs")].some(
            (priv) => resolved === priv || resolved.startsWith(priv + path.sep),
          );
        });
        return { stats, paths, listedPrivate };
      };
      try {
        for (const homeDir of [home, homeLink]) {
          const viaHomeLink = indexed([homeLink], homeDir);
          expect(
            viaHomeLink.paths.some((p) => p.endsWith("alias-ok.md")),
            `home ${homeDir}`,
          ).toBe(true);
          expect(
            viaHomeLink.paths.filter((p) => /[\\/](config|logs)[\\/]/.test(p)),
            `home ${homeDir}`,
          ).toEqual([]);
          expect(viaHomeLink.listedPrivate, `home ${homeDir}: the scan never lists config/ or logs/`).toEqual(
            [],
          );
          const viaConfigLink = indexed([configLink], homeDir);
          expect(viaConfigLink.paths, `config root ${homeDir}`).toEqual([]);
          expect(viaConfigLink.stats.skippedExcluded, `config root ${homeDir}`).toBeGreaterThan(0);
          expect(viaConfigLink.listedPrivate, `config root ${homeDir}: the scan never lists it`).toEqual([]);
        }
      } finally {
        watch.mockRestore();
      }
    } finally {
      indexedCleanup();
      fs.rmSync(aliasDir, { recursive: true, force: true });
    }
  });
  const indexedCleanup = () => {
    // Put the shared index back to what the settings say.
    ctx.indexer.indexAll();
  };

  it("C35 the indexer reads through the primitive: a file swapped for a link after the scan never reaches the index", () => {
    const note = path.join(userFolder, "swap", "note.md");
    write(note, "# swap zebra\nHARMLESS\n");
    ctx.indexer.indexAll();
    const rowFor = () =>
      ctx.db.prepare("SELECT COUNT(*) c FROM files WHERE path = ?").get(note) as { c: number };
    expect(rowFor().c).toBe(1);
    write(note, "# swap zebra\nHARMLESS-AND-LONGER-SO-THE-PASS-READS-IT-AGAIN\n");
    const listDir = fs.readdirSync.bind(fs);
    let swapped = false;
    const spy = vi.spyOn(fs, "readdirSync").mockImplementation(((dir: fs.PathLike, ...rest: unknown[]) => {
      const entries = (listDir as (...a: unknown[]) => unknown)(dir, ...rest);
      if (!swapped && String(dir) === path.dirname(note)) {
        swapped = true; // the scan has its list: a regular file. Now the file becomes a link to the token.
        fs.rmSync(note);
        fs.symlinkSync(tokenFile(), note);
      }
      return entries;
    }) as typeof fs.readdirSync);
    try {
      const stats = ctx.indexer.indexAll();
      expect(swapped).toBe(true);
      expect(stats.skippedExcluded).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
    expect(rowFor().c).toBe(0);
    const indexedText = (ctx.db.prepare("SELECT content FROM files_fts").all() as Array<{ content: string }>)
      .map((r) => r.content)
      .join("\n");
    expect(indexedText).not.toContain(ownerToken);
    fs.rmSync(path.dirname(note), { recursive: true, force: true });
    ctx.indexer.indexAll();
  });

  it("C35 a file that becomes a link between the scan's check and its read is refused, not indexed as empty", () => {
    const note = path.join(userFolder, "swap2", "late.md");
    write(note, "# late quokka\nHARMLESS\n");
    const rowFor = () =>
      ctx.db.prepare("SELECT COUNT(*) c FROM files WHERE path = ?").get(note) as { c: number };
    expect(rowFor().c).toBe(0);
    const lstat = fs.lstatSync.bind(fs);
    let swapped = false;
    // The pass has judged the file (its metadata came back from the primitive); the next thing it does is open it.
    const spy = vi.spyOn(fs, "lstatSync").mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => {
      const answer = (lstat as (...a: unknown[]) => fs.Stats)(p, ...rest);
      if (!swapped && String(p) === note) {
        swapped = true;
        fs.rmSync(note);
        fs.symlinkSync(tokenFile(), note);
      }
      return answer;
    }) as typeof fs.lstatSync);
    try {
      const stats = ctx.indexer.indexAll();
      expect(swapped).toBe(true);
      expect(stats.skippedExcluded).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
    expect(rowFor().c, "no row, not even an empty one").toBe(0);
    const indexedText = (ctx.db.prepare("SELECT content FROM files_fts").all() as Array<{ content: string }>)
      .map((r) => r.content)
      .join("\n");
    expect(indexedText).not.toContain(ownerToken);
    fs.rmSync(path.dirname(note), { recursive: true, force: true });
    ctx.indexer.indexAll();
  });

  it("C36 the objective evidence hashes only artifacts that stay inside artifacts/", () => {
    write(path.join(home, "artifacts", "run-e", "real.txt"), "REAL-EVIDENCE");
    link(tokenFile(), path.join(home, "artifacts", "run-e", "leak.txt"));
    const objective = ctx.objectives.create({
      title: "evidence",
      steps: [
        {
          title: "produce",
          request: { version: 1, kind: "prompt", prompt: "x", mode: "read_only" },
          expectedArtifacts: ["real.txt", "leak.txt"],
        },
      ],
    });
    const run = ctx.runs.create({
      origin: "manual",
      provider: "claude",
      prompt: "x",
      cwd: home,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 10_000,
      profile: "read_only",
      status: "waiting_approval",
    });
    ctx.db
      .prepare("UPDATE runs SET status = 'done', artifacts_json = ? WHERE id = ?")
      .run(JSON.stringify(["run-e/real.txt", "run-e/leak.txt"]), run.id);
    ctx.objectives.markDispatched(objective.steps[0]!.id, run.id);
    ctx.objectives.syncRun(ctx.runs.get(run.id)!, ctx.runs);
    const evidence = ctx.objectives.get(objective.id)!.steps[0]!.evidence!;
    expect(evidence.artifacts.map((a) => a.path)).toEqual(["run-e/real.txt"]);
    expect(evidence.artifacts[0]).toMatchObject({ bytes: 13 });
    expect(evidence.missingExpected).toEqual(["leak.txt"]);
    expect(JSON.stringify(evidence)).not.toContain(
      crypto.createHash("sha256").update(fs.readFileSync(tokenFile())).digest("hex"),
    );
  });

  // ---- the readers that are not routes of their own -----------------------------------------------------------
  it("C30 skills, notes, artifacts, routers and the engine's stores do not follow a link to the token", async () => {
    const skills = path.join(home, "skills");
    // SKILL.md itself a link
    link(tokenFile(), path.join(skills, "linked", "SKILL.md"));
    // a resource and the notes of a good skill
    link(tokenFile(), path.join(skills, "runme", "res.md"));
    link(tokenFile(), path.join(skills, "runme", "NOTES.md"));
    // artifacts: a text file and an image
    write(path.join(home, "artifacts", "run-x", "real.txt"), "REAL-ARTIFACT");
    link(tokenFile(), path.join(home, "artifacts", "run-x", "leak.txt"));
    link(tokenFile(), path.join(home, "artifacts", "run-x", "leak.png"));
    // a link to a harmless note that lies outside artifacts/: not an artifact either
    link(path.join(home, "memory", "other.md"), path.join(home, "artifacts", "run-x", "outside.txt"));
    link(path.join(home, "memory", "other.md"), path.join(home, "artifacts", "run-x", "outside.png"));
    // a router and the two stores
    write(path.join(home, "memory", "ROUTER.md"), "# router\n");
    link(tokenFile(), path.join(home, "memory", "areas", "evil.md"));
    link(tokenFile(), path.join(home, "routines", "evil.json"));
    link(tokenFile(), path.join(home, "connectors", "evil.json"));
    // the diff route: a file the run touched that is a link to the token
    link(tokenFile(), path.join(home, "memory", "diff-link.md"));
    const diffRun = ctx.runs.create({
      origin: "manual",
      provider: "claude",
      prompt: "diff",
      cwd: home,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 30_000,
      profile: "read_only",
      status: "waiting_approval",
    }).id;
    const get = (headers: Record<string, string>, url: string) => app.inject({ method: "GET", url, headers });
    for (const [who, headers] of principals()) {
      const probes: Array<[string, string, number[]]> = [
        ["a skill whose SKILL.md is a link", "/api/skills/linked", [403]],
        ["the skill catalog", "/api/skills", [200]],
        ["a resource that is a link", "/api/skills/runme/resource?rel=res.md", [404]],
        ["notes that are a link", "/api/skills/runme/notes", [403]],
        [
          "an artifact that is a link",
          `/api/artifacts/file?p=${encodeURIComponent(path.join(home, "artifacts", "run-x", "leak.txt"))}`,
          [403],
        ],
        [
          "an artifact link to a note outside artifacts/",
          `/api/artifacts/file?p=${encodeURIComponent(path.join(home, "artifacts", "run-x", "outside.txt"))}`,
          [403],
        ],
        [
          "a raw image link to a note outside artifacts/",
          `/api/artifacts/raw?p=${encodeURIComponent(path.join(home, "artifacts", "run-x", "outside.png"))}`,
          [403],
        ],
        [
          "a raw image that is a link",
          `/api/artifacts/raw?p=${encodeURIComponent(path.join(home, "artifacts", "run-x", "leak.png"))}`,
          [403],
        ],
        [
          "the diff of a file that is a link",
          `/api/runs/${diffRun}/diff?file=${encodeURIComponent(path.join(home, "memory", "diff-link.md"))}`,
          [403],
        ],
        ["the artifact gallery", "/api/artifacts/list", [200]],
        ["the recent artifacts", "/api/artifacts/recent", [200]],
        ["the router check", "/api/memory/routers/check", [200]],
        ["the routines list", "/api/routines", [200]],
        ["the connectors list", "/api/connectors", [200]],
      ];
      for (const [name, url, statuses] of probes) {
        const res = await get(headers, url);
        expect(statuses, `${who}: ${name} -> ${res.statusCode}`).toContain(res.statusCode);
        noToken(res, `${who}: ${name}`);
      }
      // The gallery shows the real artifact and neither link.
      const gallery = (await get(headers, "/api/artifacts/list")).json().items as Array<{ file: string }>;
      expect(
        gallery.map((i) => i.file),
        who,
      ).toContain("run-x/real.txt");
      expect(
        gallery.map((i) => i.file),
        who,
      ).not.toContain("run-x/leak.txt");
      expect(
        gallery.map((i) => i.file),
        who,
      ).not.toContain("run-x/outside.txt");
    }
    // A skill folder or a source directory that is, or sits in, config/ cannot be imported either.
    for (const sourceDir of [path.join(home, "config"), path.join(home, "skills", "linked")]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/skills/import",
        headers: asOwner(),
        payload: { sourceDir },
      });
      expect([400, 403], sourceDir).toContain(res.statusCode);
      noToken(res, sourceDir);
    }
    expect(fs.readFileSync(tokenFile(), "utf8").trim()).toBe(ownerToken);
  });
});

// ---------------------------------------------------------------------------
describe.skipIf(!POSIX)("C34 the token is created without blocking the process", () => {
  it("never waits when it loses the race, and falls back where hard links do not exist", () => {
    const tmp = makeTempHome("mordomo-reads-token-");
    try {
      const store = new SettingsStore(tmp.paths);
      const wait = vi.spyOn(Atomics, "wait");
      // Winner: the file is complete when it appears; no temporary file is left behind.
      const first = store.getOrCreateToken();
      expect(first).toMatch(/^[0-9a-f]{64}$/);
      expect(fs.readdirSync(tmp.paths.config).filter((f) => f.endsWith(".tmp"))).toEqual([]);
      expect(fs.statSync(tmp.paths.tokenFile).mode & 0o777).toBe(0o600);
      // Loser: reads what is there.
      expect(new SettingsStore(tmp.paths).getOrCreateToken()).toBe(first);
      // A token file left empty by a crash is replaced at once, not waited for.
      fs.writeFileSync(tmp.paths.tokenFile, "");
      const replaced = new SettingsStore(tmp.paths).getOrCreateToken();
      expect(replaced).toMatch(/^[0-9a-f]{64}$/);
      expect(fs.readFileSync(tmp.paths.tokenFile, "utf8")).toBe(`${replaced}\n`);
      expect(wait).not.toHaveBeenCalled();

      // A file system without hard links: exclusive create instead.
      fs.rmSync(tmp.paths.tokenFile);
      const link = vi.spyOn(fs, "linkSync").mockImplementation(() => {
        throw Object.assign(new Error("not permitted"), { code: "EPERM" });
      });
      const fallback = new SettingsStore(tmp.paths).getOrCreateToken();
      link.mockRestore();
      expect(fs.readFileSync(tmp.paths.tokenFile, "utf8")).toBe(`${fallback}\n`);
      expect(fs.readdirSync(tmp.paths.config).filter((f) => f.endsWith(".tmp"))).toEqual([]);
      wait.mockRestore();
    } finally {
      tmp.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// The rule, made mechanical.
// ---------------------------------------------------------------------------

/**
 * Raw fs reads AND writes (writeFile, appendFile, createWriteStream, truncate, chmod, chown, utimes and their
 * Sync forms) with a non-literal path that are allowed, each with the reason it cannot serve a path somebody
 * else chose. `count` is exact: a new reader in an allowed file is a new row to review, a removed one a row to
 * delete. Everything else in `core/src` and `apps/api/src` reads through `core/src/security/safeFs.ts`.
 *
 *  fixed  - a file or folder the engine names itself (its settings, token, keys, lock, pid, database, logs,
 *           backups, build files); no request, record or link chooses the path
 *  names  - returns file names only, never bytes; every file it finds is then opened through the primitive
 *  owner  - the path is something the owner typed or configured (an owner-only route, the CLI, a settings value)
 *  path   - turns a path into a path; reads no bytes
 *  fresh  - writes into a folder this very call created (a temporary directory), under names it checked
 */
const ALLOWED: Array<{ file: string; api: string; count: number; kind: string; why: string }> = [
  {
    file: "core/src/security/safeFs.ts",
    api: "*",
    count: 0,
    kind: "the primitive",
    why: "this is the one place that opens, lists, stats and resolves a path after the checks",
  },
  {
    file: "core/src/security/safeWrite.ts",
    api: "*",
    count: 0,
    kind: "the primitive",
    why: "the write side of the same door: writeWorkspaceFile and the copy of a folder, after the same checks",
  },
  {
    file: "core/src/security/paths.ts",
    api: "realpathSync",
    count: 1,
    kind: "path",
    why: "realpathLenient, the engine's one realpath helper",
  },
  {
    file: "apps/api/src/routes/git.ts",
    api: "lstatSync",
    count: 1,
    kind: "fixed",
    why: "inspectRepo: is `.git`, `objects/info/alternates` or `commondir` there, and is `.git` a link (metadata of three fixed names under a work tree the caller found)",
  },
  {
    file: "apps/api/src/cli.ts",
    api: "openSync",
    count: 1,
    kind: "fixed",
    why: "opens the service log (append, 0600)",
  },
  {
    file: "apps/api/src/cli.ts",
    api: "statSync",
    count: 1,
    kind: "fixed",
    why: "size of the service log, for rotation",
  },
  {
    file: "apps/api/src/cli.ts",
    api: "readFileSync",
    count: 2,
    kind: "fixed",
    why: "/proc/<pid>/cmdline of a pid the pid file names, and the pid file itself",
  },
  {
    file: "apps/api/src/instances.ts",
    api: "statSync",
    count: 1,
    kind: "fixed",
    why: "mtime of the installed build files",
  },
  {
    file: "apps/api/src/routes/system.ts",
    api: "readFileSync",
    count: 1,
    kind: "fixed",
    why: "package.json candidates next to the install",
  },
  {
    file: "apps/api/src/routes/system.ts",
    api: "statSync",
    count: 1,
    kind: "owner",
    why: "assertIndexableFolder: the folder the owner is about to grant in PUT /api/settings (owner-only), metadata only",
  },
  {
    file: "apps/api/src/server.ts",
    api: "readFileSync",
    count: 1,
    kind: "fixed",
    why: "the UI's index.html from the installed bundle",
  },
  {
    file: "core/src/backup.ts",
    api: "lstatSync",
    count: 4,
    kind: "fixed",
    why: "restore refuses a backup folder that is a link (name matches full-…); the size walk counts a link as itself; recovery acts only on a .restore-* that is a real folder of the home, and deletes a .removing-* only when it is one",
  },
  {
    file: "core/src/backup.ts",
    api: "readFileSync",
    count: 2,
    kind: "fixed",
    why: "the restore-pending marker in config/restore-pending, and the journal of a restore in the engine's own .restore-* folder of the home",
  },
  {
    file: "core/src/backup.ts",
    api: "readdirSync",
    count: 7,
    kind: "names",
    why: "backup list, size walk, the .restore-* / .removing-* folders of the home (to look for them, to undo them and to look at them without touching), and the names inside a staging folder (to see whether it holds old-N, and to delete all but the journal first) (names only; the journal inside is read by name)",
  },
  {
    file: "core/src/backup.ts",
    api: "statSync",
    count: 1,
    kind: "fixed",
    why: "mtime of the engine's own backup folders",
  },
  {
    file: "core/src/backup.ts",
    api: "copyFileSync",
    count: 5,
    kind: "fixed",
    why: "copies the engine's own database and settings files into a backup / back (names are fixed)",
  },
  {
    file: "core/src/backup.ts",
    api: "cpSync",
    count: 5,
    kind: "fixed",
    why: "copies the engine's own folders; cpSync keeps a link a link (no dereference)",
  },
  {
    file: "core/src/config/preferences.ts",
    api: "readFileSync",
    count: 1,
    kind: "fixed",
    why: "config/ui-preferences.json",
  },
  {
    file: "core/src/config/preferences.ts",
    api: "statSync",
    count: 1,
    kind: "fixed",
    why: "mtime of config/ui-preferences.json",
  },
  {
    file: "core/src/config/store.ts",
    api: "readFileSync",
    count: 7,
    kind: "fixed",
    why: "config/settings.json (load, after a migration, before a save), config/token, the settings.json.invalid copy it compares with, and the settings.json.corrupt.* copies it compares with and keeps",
  },
  {
    file: "core/src/config/store.ts",
    api: "statSync",
    count: 3,
    kind: "fixed",
    why: "mtime of config/settings.json",
  },
  {
    file: "core/src/connectors/auditor.ts",
    api: "readFileSync",
    count: 2,
    kind: "fixed",
    why: "the fixed list of provider config files under the OS user's home, parsed into server names and targets (credential-looking keys masked)",
  },
  {
    file: "core/src/db/db.ts",
    api: "openSync",
    count: 2,
    kind: "fixed",
    why: "creates the database file with mode 0600, and reads the 64-byte header of an existing one for its version (read-only)",
  },
  {
    file: "core/src/config/store.ts",
    api: "lstatSync",
    count: 2,
    kind: "fixed",
    why: "is a settings.json.invalid candidate or a settings.json.corrupt.* name a regular file (never trust a link, never touch a folder or a note) before it is compared, listed or pruned",
  },
  {
    file: "core/src/config/store.ts",
    api: "readdirSync",
    count: 1,
    kind: "names",
    why: "the settings.json.corrupt.* copies in config/, to keep the newest few",
  },
  {
    file: "core/src/db/db.ts",
    api: "statSync",
    count: 2,
    kind: "fixed",
    why: "size of the database file and of its -wal, to tell a missing or empty one, and one with a WAL waiting, from one whose header says the version",
  },
  {
    file: "core/src/restoreLock.ts",
    api: "openSync",
    count: 3,
    kind: "fixed",
    why: "creates config/run/restore.lock owner-only, only when it is absent (a descriptor opened and closed on a file this process holds a lock on would release it), and again if it was removed while waiting for it; and the read of its first 16 bytes by `inspectLockFile` (read-only, for the commands that must work when it is broken)",
  },
  {
    file: "core/src/restoreLock.ts",
    api: "lstatSync",
    count: 2,
    kind: "fixed",
    why: "config/run/restore.lock must be a regular file, never a link or a folder (when taking it, and when only looking at it)",
  },
  {
    file: "core/src/restoreLock.ts",
    api: "statSync",
    count: 2,
    kind: "fixed",
    why: "the identity (device and inode) of config/run/restore.lock before and after it is locked, to know it is still the file that was locked",
  },
  {
    file: "core/src/ownerLock.ts",
    api: "readdirSync",
    count: 1,
    kind: "names",
    why: "config/run, to sweep the temporary files of a process that died while taking the lock",
  },
  {
    file: "core/src/ownerLock.ts",
    api: "readFileSync",
    count: 1,
    kind: "fixed",
    why: "config/run/engine.lock",
  },
  {
    file: "core/src/ownerLock.ts",
    api: "statSync",
    count: 1,
    kind: "fixed",
    why: "the identity (device and inode) of config/run/engine.lock, which names the lock in the registry of this process, so that a home reached by another name is the same lock",
  },
  {
    file: "core/src/processIdentity.ts",
    api: "readFileSync",
    count: 1,
    kind: "fixed",
    why: "procfs: /proc/<pid>/stat of a pid and /proc/sys/kernel/random/boot_id (fixed names, the start of a process)",
  },
  {
    file: "core/src/paths.ts",
    api: "lstatSync",
    count: 1,
    kind: "fixed",
    why: "tightenMode looks at the mode (and at whether it is a link) before it opens anything: no descriptor on a file that already has its mode",
  },
  {
    file: "core/src/backupManifest.ts",
    api: "readFileSync",
    count: 1,
    kind: "fixed",
    why: "manifest.json at the root of the engine's own backup folder",
  },
  {
    file: "core/src/backupManifest.ts",
    api: "openSync",
    count: 1,
    kind: "fixed",
    why: "hashes a file of the engine's own backup folder (or its staged copy), read-only, in pieces",
  },
  {
    file: "core/src/backupManifest.ts",
    api: "readdirSync",
    count: 1,
    kind: "names",
    why: "lists the engine's own backup folder (or its staged copy) to compare it with the manifest; every file is then hashed by name",
  },
  {
    file: "core/src/backupManifest.ts",
    api: "lstatSync",
    count: 1,
    kind: "fixed",
    why: "what a part of the backup is now (file, folder or link), without following a link",
  },
  {
    file: "core/src/backupManifest.ts",
    api: "readlinkSync",
    count: 2,
    kind: "fixed",
    why: "the target of a link inside the engine's own backup folder, compared with the manifest and never followed",
  },
  {
    file: "core/src/logs/jsonl.ts",
    api: "readdirSync",
    count: 1,
    kind: "names",
    why: "rotation of the logs folder",
  },
  {
    file: "core/src/logs/jsonl.ts",
    api: "statSync",
    count: 3,
    kind: "fixed",
    why: "size and age of the engine's own log files",
  },
  {
    file: "core/src/memory/indexer.ts",
    api: "readdirSync",
    count: 1,
    kind: "names",
    why: "the index walk lists names under a root; symlinks are skipped and every file is opened through the primitive",
  },
  {
    file: "core/src/notifications/pushStore.ts",
    api: "readFileSync",
    count: 1,
    kind: "fixed",
    why: "config/vapid.json",
  },
  {
    file: "core/src/paths.ts",
    api: "cpSync",
    count: 1,
    kind: "fixed",
    why: "seeds the home from the packaged seed folder",
  },
  {
    file: "core/src/paths.ts",
    api: "readFileSync",
    count: 1,
    kind: "fixed",
    why: "package.json while locating the install root",
  },
  {
    file: "core/src/paths.ts",
    api: "readdirSync",
    count: 2,
    kind: "names",
    why: "tightening modes and listing the seed folder",
  },
  {
    file: "core/src/paths.ts",
    api: "openSync",
    count: 1,
    kind: "fixed",
    why: "tightenMode opens the engine's own folder or file without following a link, then fstat/fchmod on the descriptor",
  },
  {
    file: "core/src/routines/osIntegration.ts",
    api: "readFileSync",
    count: 1,
    kind: "fixed",
    why: "the startup-service unit file this home generated",
  },
  {
    file: "core/src/runs/runManager.ts",
    api: "readdirSync",
    count: 1,
    kind: "names",
    why: "lists the files a run left in its artifacts folder (names only)",
  },
  {
    file: "core/src/security/tls.ts",
    api: "readFileSync",
    count: 3,
    kind: "fixed",
    why: "config/tls/* the engine generated",
  },
  {
    file: "core/src/skills/publish.ts",
    api: "readdirSync",
    count: 2,
    kind: "owner",
    why: "`mordomo skills publish`, run by the owner on a folder they name; the walk skips links",
  },
  {
    file: "core/src/skills/publish.ts",
    api: "readFileSync",
    count: 3,
    kind: "owner",
    why: "signing keys in config/ and the skill files of that owner-run command",
  },
  {
    file: "core/src/skills/registry.ts",
    api: "readFileSync",
    count: 1,
    kind: "owner",
    why: "a file:// registry the owner configured (settings are owner-only)",
  },
  { file: "core/src/spawn/which.ts", api: "readdirSync", count: 1, kind: "names", why: "PATH search" },
  { file: "core/src/spawn/which.ts", api: "statSync", count: 2, kind: "fixed", why: "PATH search" },
  {
    file: "core/src/sync/compiler.ts",
    api: "readFileSync",
    count: 1,
    kind: "fixed",
    why: "config/sync-manifest.json",
  },
  {
    file: "apps/api/src/cli.ts",
    api: "writeFileSync",
    count: 2,
    kind: "fixed",
    why: "the pid file, and the service files `mordomo service install` shows the owner and asks to create",
  },
  {
    file: "apps/api/src/server.ts",
    api: "writeFileSync",
    count: 1,
    kind: "fixed",
    why: "the pid file in config/run",
  },
  {
    file: "core/src/backup.ts",
    api: "writeFileSync",
    count: 1,
    kind: "fixed",
    why: "the restore-pending marker in config/restore-pending",
  },
  {
    file: "core/src/backupManifest.ts",
    api: "writeFileSync",
    count: 1,
    kind: "fixed",
    why: "manifest.json at the root of a backup folder this call is making (0600)",
  },
  {
    file: "core/src/config/atomicWrite.ts",
    api: "openSync",
    count: 1,
    kind: "fresh",
    why: "the writer of settings, ui preferences, routines and connectors: a temporary file with a random name made exclusively (wx, which follows no link) beside the target, then rename, which replaces the name and follows nothing",
  },
  {
    file: "core/src/config/migrations.ts",
    api: "writeFileSync",
    count: 1,
    kind: "fixed",
    why: "the one-time .bak of a settings file, in config/",
  },
  {
    file: "core/src/config/store.ts",
    api: "writeFileSync",
    count: 5,
    kind: "fixed",
    why: "the token: a temporary file published by link(2), and the exclusive fallbacks (flag wx); settings.json.invalid and settings.json.corrupt.*, created with wx so they never overwrite",
  },
  {
    file: "core/src/ownerLock.ts",
    api: "writeFileSync",
    count: 1,
    kind: "fixed",
    why: "the temporary file that holds the full lock record before link(2) publishes it as config/run/engine.lock",
  },
  {
    file: "core/src/logs/jsonl.ts",
    api: "appendFileSync",
    count: 1,
    kind: "fixed",
    why: "the log file of a logger the engine made, in logs/",
  },
  {
    file: "core/src/notifications/pushStore.ts",
    api: "writeFileSync",
    count: 1,
    kind: "fixed",
    why: "config/vapid.json (0600)",
  },
  {
    file: "core/src/security/tls.ts",
    api: "writeFileSync",
    count: 3,
    kind: "fixed",
    why: "config/tls key, certificate and fingerprint",
  },
  {
    file: "core/src/skills/publish.ts",
    api: "writeFileSync",
    count: 3,
    kind: "owner",
    why: "`mordomo skills publish`: the owner's signing keys, the files of a registry folder the owner named, its index",
  },
  {
    file: "core/src/skills/registry.ts",
    api: "writeFileSync",
    count: 1,
    kind: "fresh",
    why: "a file of a verified registry skill, in a mkdtemp folder, under a name checked to stay inside it",
  },
  {
    file: "core/src/sync/compiler.ts",
    api: "writeFileSync",
    count: 2,
    kind: "fixed",
    why: "the sync manifest, and the backup copy under config/backups/sync-<time>/ (a folder this call makes)",
  },
];

const repoSources = () =>
  sourceFilesUnder([path.join(repoRoot, "core", "src"), path.join(repoRoot, "apps", "api", "src")]);
let repoProgram: ts.Program | null = null;
function theRepoProgram(): ts.Program {
  // The detector resolves `@mordomo/core` through its built declarations: without them every call into the core
  // is "unresolved" and the audit would judge by name alone. Say so instead of failing in some other way.
  if (!fs.existsSync(path.join(repoRoot, "core", "dist", "index.d.ts"))) {
    throw new Error("C31/C32 need the built core: run `npm run build:server` first");
  }
  repoProgram ??= createAuditProgram(repoRoot, repoSources());
  return repoProgram;
}

describe("C31 the raw-read detector sees every way of calling fs", () => {
  const FIXTURE = "core/src/__fixture__/case.ts";
  const audit = (source: string): RawRead[] => auditVirtual(repoRoot, { [FIXTURE]: source });
  const apis = (reads: RawRead[]) => reads.map((r) => `${r.api}:${r.how}`).sort();

  const flagged: Array<[string, string, string[]]> = [
    [
      "default import",
      'import fs from "node:fs"; export const f = (p: string) => fs.readFileSync(p, "utf8");',
      ["readFileSync:call"],
    ],
    [
      "bare module name",
      'import fs from "fs"; export const f = (p: string) => fs.readFileSync(p);',
      ["readFileSync:call"],
    ],
    [
      "namespace import",
      'import * as ns from "node:fs"; export const f = (p: string) => ns.readFileSync(p);',
      ["readFileSync:call"],
    ],
    [
      "aliased named import",
      'import { readFileSync as r } from "node:fs"; export const f = (p: string) => r(p);',
      ["readFileSync:call"],
    ],
    [
      "fs/promises default",
      'import fsp from "node:fs/promises"; export const f = (p: string) => fsp.readFile(p);',
      ["readFile:call"],
    ],
    [
      "fs/promises named",
      'import { readFile, stat } from "node:fs/promises"; export const f = (p: string) => [readFile(p), stat(p)];',
      ["readFile:call", "stat:call"],
    ],
    [
      "fs.promises",
      'import fs from "node:fs"; export const f = (p: string) => fs.promises.readFile(p);',
      ["readFile:call"],
    ],
    [
      "createReadStream, aliased",
      'import { createReadStream as open } from "node:fs"; export const f = (p: string) => open(p);',
      ["createReadStream:call"],
    ],
    [
      "destructured",
      'import fs from "node:fs"; const { readFileSync } = fs; export const f = (p: string) => readFileSync(p);',
      ["readFileSync:call", "readFileSync:destructured"],
    ],
    [
      "held in a variable",
      'import fs from "node:fs"; const read = fs.readFileSync; export const f = (p: string) => read(p);',
      ["readFileSync:call", "readFileSync:value"],
    ],
    [
      "handed to promisify",
      'import fs from "node:fs"; import { promisify } from "node:util"; export const f = promisify(fs.readFile);',
      ["readFile:value"],
    ],
    [
      "bare function as an argument",
      'import { statSync } from "node:fs"; export const f = (xs: string[]) => xs.map(statSync);',
      ["statSync:value"],
    ],
    [
      "dynamic import",
      'export async function f(p: string) { const { readFileSync } = await import("node:fs"); return readFileSync(p); }',
      ["readFileSync:call", "readFileSync:destructured"],
    ],
    [
      "require through createRequire",
      'import { createRequire } from "node:module"; const req = createRequire(import.meta.url); export const f = (p: string) => req("node:fs").readFileSync(p);',
      ["readFileSync:unresolved"],
    ],
    [
      "every other read api",
      'import fs from "node:fs"; export const f = (p: string) => [fs.readdirSync(p), fs.statSync(p), fs.lstatSync(p), fs.realpathSync(p), fs.openSync(p, "r"), fs.opendirSync(p), fs.readlinkSync(p), fs.copyFileSync(p, "/x"), fs.cpSync(p, "/x")];',
      [
        "copyFileSync:call",
        "cpSync:call",
        "lstatSync:call",
        "openSync:call",
        "opendirSync:call",
        "readdirSync:call",
        "readlinkSync:call",
        "realpathSync:call",
        "statSync:call",
      ],
    ],
    [
      "template with a substitution",
      'import fs from "node:fs"; export const f = (n: string) => fs.readFileSync(`/etc/${n}`);',
      ["readFileSync:call"],
    ],
    [
      "opendir, asynchronous and promised",
      'import fs from "node:fs"; import fsp from "node:fs/promises"; export const f = (p: string) => [fs.opendir(p, () => undefined), fsp.opendir(p)];',
      ["opendir:call", "opendir:call"],
    ],
    [
      "glob, in all three forms",
      'import fs from "node:fs"; import fsp from "node:fs/promises"; export const f = (p: string) => [fs.globSync(p), fsp.glob(p), fs.glob(p, () => undefined)];',
      ["glob:call", "glob:call", "globSync:call"],
    ],
    [
      "openAsBlob",
      'import fs from "node:fs"; export const f = (p: string) => fs.openAsBlob(p);',
      ["openAsBlob:call"],
    ],
    [
      "every way of writing a file",
      'import fs from "node:fs"; import fsp from "node:fs/promises"; import { writeFileSync as w } from "node:fs"; export const f = (p: string) => [fs.writeFileSync(p, "x"), fs.appendFileSync(p, "x"), fs.createWriteStream(p), fs.truncateSync(p), fsp.writeFile(p, "x"), fsp.appendFile(p, "x"), fsp.truncate(p), w(p, "x")];',
      [
        "appendFile:call",
        "appendFileSync:call",
        "createWriteStream:call",
        "truncate:call",
        "truncateSync:call",
        "writeFile:call",
        "writeFileSync:call",
        "writeFileSync:call",
      ],
    ],
    [
      "mode, owner and time changes (they follow a link)",
      'import fs from "node:fs"; export const f = (p: string) => [fs.chmodSync(p, 0o600), fs.chownSync(p, 1, 1), fs.utimesSync(p, 1, 1), fs.lchmod, fs.lutimesSync(p, 1, 1)];',
      ["chmodSync:call", "chownSync:call", "lchmod:value", "lutimesSync:call", "utimesSync:call"],
    ],
    [
      "a write function held in a variable",
      'import fs from "node:fs"; const w = fs.writeFileSync; export const f = (p: string) => w(p, "x");',
      ["writeFileSync:call", "writeFileSync:value"],
    ],
  ];
  it.each(flagged)("flags %s", (_name, source, expected) => {
    expect(apis(audit(source))).toEqual([...expected].sort());
  });

  const clean: Array<[string, string]> = [
    [
      "a literal path",
      'import fs from "node:fs"; export const a = fs.readFileSync("/etc/hostname"); export const b = fs.statSync(`/etc`);',
    ],
    [
      "a descriptor",
      'import fs from "node:fs"; export const f = (fd: number) => [fs.fstatSync(fd), fs.readFileSync(fd), fs.readSync(fd, Buffer.alloc(1), 0, 1, 0)];',
    ],
    [
      "creation, renaming, existence and removal (they act on a name, not on the file behind it)",
      'import fs from "node:fs"; export const f = (p: string) => { fs.mkdirSync(p); fs.mkdtempSync(p); fs.rmSync(p); fs.unlinkSync(p); fs.renameSync(p, p + "x"); fs.symlinkSync(p, p + "y"); fs.linkSync(p, p + "z"); return [fs.existsSync(p), fs.accessSync(p), fs.statfsSync(p)]; };',
    ],
    [
      "an object with the same method name",
      "export const f = (p: string) => { const store = { readFileSync(x: string) { return x; }, stat(x: string) { return x; } }; return [store.readFileSync(p), store.stat(p)]; };",
    ],
    [
      "a class with the same method name",
      "class Store { readFile(p: string) { return p; } } export const f = (p: string) => new Store().readFile(p);",
    ],
    [
      "a local shadowing fs",
      "export const f = (p: string) => { const fs = { readFileSync: (x: string) => x }; return fs.readFileSync(p); };",
    ],
    [
      "a file handle already open",
      'import fsp from "node:fs/promises"; export async function f() { const h = await fsp.open("/etc/hostname", "r"); return h.readFile(); }',
    ],
    [
      "a type that mentions it",
      'import type fs from "node:fs"; export type Reader = typeof fs.readFileSync; export const x = 1;',
    ],
    [
      "text that mentions it",
      'export const note = "fs.readFileSync(p)"; // fs.readFileSync(p)\nexport const y = 2;',
    ],
  ];
  it.each(clean)("does not flag %s", (_name, source) => {
    expect(audit(source)).toEqual([]);
  });

  it("knows the read apis it is about (a rename in @types/node would show here)", () => {
    for (const api of [
      "readFile",
      "readFileSync",
      "createReadStream",
      "readdir",
      "readdirSync",
      "stat",
      "statSync",
      "lstat",
      "lstatSync",
      "realpath",
      "realpathSync",
      "open",
      "openSync",
      "copyFile",
      "cp",
      "cpSync",
      "readlink",
    ]) {
      expect(READ_APIS.has(api), api).toBe(true);
    }
    expect(READ_APIS.has("existsSync")).toBe(false);
    expect(READ_APIS.has("writeFileSync")).toBe(false);
  });

  // Written out in full, not derived from the sets: dropping a member from the detector changes this list.
  const EVERY_READ = [
    "readFile",
    "createReadStream",
    "open",
    "opendir",
    "readdir",
    "stat",
    "lstat",
    "realpath",
    "readlink",
    "copyFile",
    "cp",
    "glob",
    "openAsBlob",
  ];
  const EVERY_WRITE = [
    "writeFile",
    "appendFile",
    "createWriteStream",
    "truncate",
    "chmod",
    "lchmod",
    "chown",
    "lchown",
    "utimes",
    "lutimes",
  ];
  it("lists, member by member, every read and every write api, synchronous forms included", () => {
    const sync = (names: string[]) => names.flatMap((n) => [n, `${n}Sync`]);
    expect([...READ_APIS].sort()).toEqual(sync(EVERY_READ).sort());
    expect([...WRITE_APIS].sort()).toEqual(sync(EVERY_WRITE).sort());
    for (const api of NEUTRAL_APIS) expect(RAW_APIS.has(api), api).toBe(false);
  });

  it("sees every one of them through fs and fs/promises, as @types/node declares them", () => {
    const { fs: inFs, promises: inPromises } = fsPathApis(repoRoot);
    const wanted = (names: string[]) => names.filter((n) => RAW_APIS.has(n));
    const calls = [
      ...wanted(inFs).map((n) => `fs.${n}(p as never)`),
      ...wanted(inPromises).map((n) => `fsp.${n}(p as never)`),
    ];
    const reads = audit(
      `import fs from "node:fs"; import fsp from "node:fs/promises"; export const f = (p: string) => [${calls.join(", ")}];`,
    );
    expect(reads.map((r) => r.how)).toEqual(calls.map(() => "call"));
    expect(reads.map((r) => r.api).sort()).toEqual([...wanted(inFs), ...wanted(inPromises)].sort());
    // Every api the lists name is declared by @types/node, so a rename there shows here and not as a silent gap.
    const declared = new Set([...inFs, ...inPromises]);
    for (const api of RAW_APIS)
      expect(declared.has(api) || declared.has(api.replace(/Sync$/, "")), api).toBe(true);
  });

  it("classifies every function of fs and fs/promises that takes a path (a new Node api must be judged)", () => {
    expect(unclassifiedFsPathApis(repoRoot)).toEqual([]);
  });
});

describe("C55 the raw-fs list did not grow for the second brain", () => {
  it("C55 the list holds 70 rows, and the only one under core/src/memory is the scan of the indexer; the new modules read through the primitives", () => {
    expect(ALLOWED).toHaveLength(70);
    const memory = ALLOWED.filter(
      (a) => a.file.startsWith("core/src/memory/") || a.file.includes("routes/memory"),
    );
    expect(memory.map((a) => `${a.file} ${a.api} ${a.count}`)).toEqual([
      "core/src/memory/indexer.ts readdirSync 1",
    ]);
    for (const file of [
      "core/src/memory/notes.ts",
      "core/src/memory/links.ts",
      "core/src/memory/linkParser.ts",
      "core/src/memory/indexHost.ts",
      "core/src/memory/indexWorker.ts",
      "core/src/memory/indexProtocol.ts",
      "core/src/memory/semantic.ts",
      "core/src/memory/embeddings.ts",
      "core/src/memory/vectors.ts",
      "apps/api/src/routes/memory.ts",
    ])
      expect(
        ALLOWED.map((a) => a.file),
        file,
      ).not.toContain(file);
    // the one primitive that gained a mode (the guarded replace) is already a primitive row, not a new one
    expect(ALLOWED.filter((a) => a.file === "core/src/security/safeWrite.ts")).toHaveLength(1);
  });
});

describe("C61 the dashboards read and write through the primitives (cerebro-paineis)", () => {
  /** The modules of the feature: the dashboards, their route, the task parser and the notes' module that writes a box. */
  const DASHBOARDS = [
    "evaluator.ts",
    "export.ts",
    "highlights.ts",
    "kpi.ts",
    "question.ts",
    "reminders.ts",
    "schedule.ts",
    "service.ts",
    "sources.ts",
    "store.ts",
    "templates.ts",
  ];
  const FILES = [
    ...DASHBOARDS.map((f) => `core/src/dashboards/${f}`),
    "apps/api/src/routes/dashboards.ts",
    "core/src/memory/tasks.ts",
    "core/src/memory/notes.ts",
  ];
  /** The spellings the walker does not resolve to an fs function (L-048): said here, and looked for by text below. */
  const UNCOVERED: Array<[string, string]> = [
    [
      "a require built at run time, with a computed name",
      'export const f = (p: string) => { const req = new Function("m", "return require(m)") as (m: string) => Record<string, (x: string) => unknown>; return req("node:fs")["read" + "FileSync"]!(p); };',
    ],
    [
      "a call through Reflect",
      'import fs from "node:fs"; export const f = (p: string) => (Reflect.get(fs, "readFileSync") as (x: string) => string)(p);',
    ],
  ];

  it("C61 the walker finds no raw fs read or write in core/src/dashboards/, the route or the task writer, sees one planted there, the list gained no entry, and none of the spellings it does not cover is in those files", () => {
    // The folder holds these modules and no other (a new one would be outside this proof).
    expect(
      fs
        .readdirSync(path.join(repoRoot, "core", "src", "dashboards"))
        .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
        .sort(),
    ).toEqual(DASHBOARDS);
    expect(fs.readFileSync(path.join(repoRoot, "core/src/memory/notes.ts"), "utf8")).toContain(
      "export function saveTask",
    );

    // The walker over the whole program, as C32 runs it: nothing in these files.
    const reads = auditProgram(theRepoProgram(), repoRoot, repoSources());
    expect(reads.length).toBeGreaterThan(50);
    expect(
      reads.filter((r) => FILES.includes(r.file)).map((r) => `${r.file}:${r.line} ${r.api} ${r.text}`),
    ).toEqual([]);
    // It is awake there: a read and a write planted in the folder, each through an aliased binding, are found.
    const planted = auditVirtual(repoRoot, {
      "core/src/dashboards/__planted__.ts":
        'import { readFileSync as r, writeFileSync as w } from "node:fs"; export const f = (p: string) => { w(p, r(p)); };',
    });
    expect(planted.map((r) => `${r.file} ${r.api}:${r.how}`).sort()).toEqual([
      "core/src/dashboards/__planted__.ts readFileSync:call",
      "core/src/dashboards/__planted__.ts writeFileSync:call",
    ]);

    // The list: no row for these files, and the same rows as at the feature's base.
    expect(
      ALLOWED.filter((a) => FILES.includes(a.file) || a.file.startsWith("core/src/dashboards/")),
    ).toEqual([]);
    const rowsOf = (source: string) => {
      const block = /const ALLOWED: Array<[^=]*= \[([\s\S]*?)\n\];/.exec(source)?.[1] ?? "";
      return [...block.matchAll(/file: "([^"]+)",\s*api: "([^"]+)",\s*count: (\d+)/g)]
        .map((m) => `${m[1]} ${m[2]} ${m[3]}`)
        .sort();
    };
    const base = execFileSync("git", ["show", "16e6976:tests/security-reads.test.ts"], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const now = rowsOf(fs.readFileSync(path.join(repoRoot, "tests", "security-reads.test.ts"), "utf8"));
    expect(now).toHaveLength(ALLOWED.length);
    expect(now).toEqual(rowsOf(base));

    // What the walker does not cover, it does not see (so the claim names it) ...
    for (const [name, source] of UNCOVERED)
      expect(auditVirtual(repoRoot, { "core/src/dashboards/__uncovered__.ts": source }), name).toEqual([]);
    // ... and none of those spellings is written in the feature's files: read from the syntax tree, so a method of
    // the store called `require` is not a call of the global one.
    const spellings = (text: string): string[] => {
      const found: string[] = [];
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
          if (["require", "eval"].includes(node.expression.text)) found.push(node.expression.text);
        }
        if (
          ts.isNewExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "Function"
        )
          found.push("new Function");
        if (ts.isIdentifier(node) && ["Reflect", "createRequire", "getBuiltinModule"].includes(node.text))
          found.push(node.text);
        ts.forEachChild(node, visit);
      };
      visit(ts.createSourceFile("scan.ts", text, ts.ScriptTarget.ES2022, true));
      return found;
    };
    // the scan sees each spelling the walker does not
    for (const [name, source] of UNCOVERED) expect(spellings(source).length, name).toBeGreaterThan(0);
    for (const file of FILES)
      expect(spellings(fs.readFileSync(path.join(repoRoot, file), "utf8")), file).toEqual([]);
  }, 180_000);
});

describe("C32 every raw fs read in core/src and apps/api/src is on the reviewed list", () => {
  let reads: RawRead[] = [];
  beforeAll(() => {
    reads = auditProgram(theRepoProgram(), repoRoot, repoSources());
  }, 120_000);

  it("finds nothing outside the list, and nothing on the list that is no longer there", () => {
    const counted = new Map<string, number>();
    for (const r of reads) counted.set(`${r.file}|${r.api}`, (counted.get(`${r.file}|${r.api}`) ?? 0) + 1);
    const allowed = new Map(ALLOWED.filter((a) => a.api !== "*").map((a) => [`${a.file}|${a.api}`, a.count]));
    const primitive = ALLOWED.filter((a) => a.api === "*").map((a) => a.file);

    const unexpected = reads
      .filter((r) => !primitive.includes(r.file))
      .filter((r) => (counted.get(`${r.file}|${r.api}`) ?? 0) !== allowed.get(`${r.file}|${r.api}`))
      .map((r) => `${r.file}:${r.line} ${r.api} (${r.how}) ${r.text}`);
    expect(
      unexpected,
      "a raw fs read with a non-literal path: use core/src/security/safeFs.ts, or review it onto ALLOWED",
    ).toEqual([]);

    const stale = [...allowed]
      .filter(([key, count]) => (counted.get(key) ?? 0) !== count)
      .map(([key]) => key);
    expect(stale, "ALLOWED rows that no longer match the code").toEqual([]);

    for (const file of primitive) expect(fs.existsSync(path.join(repoRoot, file)), file).toBe(true);
    expect(reads.length).toBeGreaterThan(50);
  });

  it("has one realpath helper, and the readers that leaked hold no raw read", () => {
    expect(reads.filter((r) => r.api === "realpathSync" || r.api === "realpath").map((r) => r.file)).toEqual([
      "core/src/security/paths.ts",
    ]);
    const text = repoSources()
      .map((f) => fs.readFileSync(f, "utf8"))
      .join("\n");
    expect(text).not.toMatch(/function (realOrResolved|realpathOr)\b/);
    expect(text.match(/export function realpathLenient/g)).toHaveLength(1);
    // The readers the round-1 verification (and the review after it) found: none keeps a raw read,
    // except the sync compiler's one fixed file, the manifest in config/.
    const migrated = [
      "core/src/memory/journal.ts",
      "core/src/memory/recall.ts",
      "core/src/memory/preview.ts",
      "core/src/memory/routers.ts",
      "core/src/sync/compiler.ts",
      "core/src/skills/catalog.ts",
      "core/src/routines/store.ts",
      "core/src/connectors/registry.ts",
      "core/src/objectives/objectiveStore.ts",
      "apps/api/src/routes/memory.ts",
      "apps/api/src/routes/runs.ts",
      "apps/api/src/routes/skills.ts",
    ];
    for (const file of migrated) {
      expect(
        reads.filter((r) => r.file === file && READ_APIS.has(r.api)),
        file,
      ).toHaveLength(file === "core/src/sync/compiler.ts" ? 1 : 0);
    }
  });

  it("starts an agent only through RunManager.execute, so the working-directory rule cannot be skipped", () => {
    const files = repoSources();
    const program = theRepoProgram();
    const checker = program.getTypeChecker();
    const callers: string[] = [];
    for (const source of program.getSourceFiles()) {
      if (!files.includes(path.resolve(source.fileName))) continue;
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "execute"
        ) {
          const decl = checker.getResolvedSignature(node)?.declaration;
          const owner = decl?.parent;
          if (owner && ts.isInterfaceDeclaration(owner) && owner.name.text === "AgentAdapter") {
            callers.push(path.relative(repoRoot, source.fileName).split(path.sep).join("/"));
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(callers).toEqual(["core/src/runs/runManager.ts"]);
  }, 120_000);
});

// ---------------------------------------------------------------------------
describe("C33 the security doc says what the code guarantees, and what it does not", () => {
  it("states the primitive, the working-directory rule and each caveat", () => {
    const doc = fs.readFileSync(path.join(repoRoot, "docs", "security.md"), "utf8");
    const required: Record<string, string[]> = {
      "the guard sits where the file is read": [
        "core/src/security/safeFs.ts",
        "`O_NOFOLLOW`",
        "tests/security-reads.test.ts",
      ],
      "every reader": ["journal", "sync plan", "recall", "artifacts", "the indexer"],
      "working directory": [
        "RunManager.resolveCwd",
        "`<home>/workspace`",
        "is never a folder that holds them",
        "a routine's `workingDir`",
        "at every fire",
        "the repeat of a stored run",
      ],
      "old index rows": ["rows an older index holds"],
      "an agent with a shell": [
        "An agent with a shell, or a provider sandbox that reads the whole disk, reads whatever its operating-system user can",
        "`escopos-dispositivo`",
        "Codex's `--sandbox read-only` limits writes, not reads",
        ".specs/STATE.md",
      ],
      "hard link": ["A hard link", "inode", "refused for a read, a write and a listing"],
      "git reads what the filter judged": [
        "--literal-pathspecs",
        "GIT_LITERAL_PATHSPECS=1",
        "--git-dir=<work tree>/.git",
        "`core.worktree`",
        "diff --name-only -z",
      ],
      windows: ["Windows", "no `O_NOFOLLOW`"],
      writes: ["writeWorkspaceFile", "Writes the engine does to its own fixed files", "`tightenMode`"],
      "files the engine reads itself": ["Fixed files the engine reads itself"],
    };
    for (const [what, phrases] of Object.entries(required)) {
      for (const phrase of phrases) expect(doc, `${what}: ${phrase}`).toContain(phrase);
    }
    // The claims that were false before this round must no longer be hedged away or contradicted.
    expect(doc).toContain("this holds for *every* reader");
    expect(doc).not.toMatch(/run `cwd`, skill import/);
    // The verifier found these two to be false: a write run is not the only one that reaches the token, and a
    // write through a link is not harmless.
    expect(doc).not.toContain("can start a **write** run can therefore reach the token");
    expect(doc).not.toContain("they do not expose bytes");
    // Round 3: claims no code or test backs.
    expect(doc).not.toContain("the descriptor's own path on Linux");
    expect(doc).not.toMatch(/token` is created exclusively \(`wx`\), so two/);
    expect(doc).not.toContain("confined to the working directory, `--add-dir` folders and nothing else");
    expect(doc).toContain("not verified here");
    expect(doc).toContain("MORDOMO_RUN_TOKEN");
    // Round 4: the limits are said, and nothing claims the token is out of reach.
    for (const phrase of [
      "parseSkillFile",
      "`settings.memorySkills`",
      "looksLikeBrowserNavigation",
      "a reduction, not a boundary",
      "/proc/<pid>/environ",
      "`protectedDirs`",
      "was not verified here",
    ]) {
      expect(doc, phrase).toContain(phrase);
    }
    expect(doc).not.toContain("never sees the owner token");
    expect(doc).not.toContain("`memoryAccess: true` in the catalog");
  });
});
