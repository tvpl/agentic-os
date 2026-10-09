import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type * as ChildProcess from "node:child_process";
import type { FastifyInstance } from "fastify";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer, isLoopbackAddress } from "../apps/api/src/server.js";
import { OPENABLE_EXTENSIONS, openerFor } from "../apps/api/src/routes/memory.js";
import { makeTempHome } from "./helpers.js";

/**
 * Security P0 (.specs/features/seguranca-p0): every /api route needs a
 * credential whatever its spelling, the page only carries the token to a
 * loopback socket, the permission broker cannot approve, and opening a file
 * never runs it.
 */

const OPENERS = new Set(["open", "xdg-open", "explorer.exe", "cmd", "cmd.exe"]);
const spawned: string[] = [];

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  const { EventEmitter } = await import("node:events");
  return {
    ...actual,
    spawn: (command: string, ...rest: unknown[]) => {
      if (OPENERS.has(command)) {
        spawned.push(command);
        const fake = new EventEmitter() as EventEmitter & { unref: () => void };
        fake.unref = () => undefined;
        return fake;
      }
      return (actual.spawn as (...a: unknown[]) => unknown)(command, ...rest);
    },
  };
});

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let ctx: AppContext;
let app: FastifyInstance;
let token: string;
let cleanup: () => void;
let uiDir: string;

beforeAll(async () => {
  const tmp = makeTempHome();
  cleanup = tmp.cleanup;
  ctx = new AppContext(tmp.paths.home);
  const settings = ctx.settings();
  settings.setupCompleted = true;
  settings.securityProfile = "review_before_write";
  settings.remote.enabled = true;
  ctx.settingsStore.save(settings);
  token = ctx.token();
  uiDir = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-ui-"));
  fs.writeFileSync(
    path.join(uiDir, "index.html"),
    '<!doctype html><html><head><meta name="mordomo-token" content="" /></head><body></body></html>',
  );
  app = await buildServer(ctx, { uiDist: uiDir });
});

afterAll(async () => {
  await ctx.runs.shutdown(2000);
  await app.close();
  ctx.close();
  fs.rmSync(uiDir, { recursive: true, force: true });
  cleanup();
});

/** What a browser (or a web view) sends when a person opens the page. */
const NAVIGATION = { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "none" };
const owner = () => ({ "x-mordomo-token": token, "content-type": "application/json" });
const as = (credential: string) => ({ "x-mordomo-token": credential, "content-type": "application/json" });

/** A queued write run with its broker credential, never executed. */
function brokeredRun(): { runId: string; credential: string } {
  const record = ctx.runs.create({
    origin: "manual",
    provider: "claude",
    prompt: "change something",
    cwd: ctx.paths.home,
    model: null,
    effort: "default",
    mode: "write",
    timeoutMs: 60_000,
    profile: "review_before_write",
  });
  const broker = ctx.permissionBrokerFor({ id: record.id, permissionProfile: "review_before_write" });
  expect(broker).not.toBeNull();
  return { runId: record.id, credential: broker!.env.MORDOMO_TOKEN! };
}

async function raise(credential: string, runId: string) {
  return app.inject({
    method: "POST",
    url: "/api/approvals/tool",
    headers: as(credential),
    payload: { runId, toolName: "Write", input: { file_path: "/tmp/x" } },
  });
}

describe("S1 every spelling of an /api route needs a credential", () => {
  it("C1 encoded GET without a token is 401", async () => {
    const res = await app.inject({ method: "GET", url: "/%61pi/settings" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("unauthorized");
  });

  it("C2 encoded PUT without a token is 401 and changes nothing", async () => {
    const before = ctx.settings().securityProfile;
    const res = await app.inject({
      method: "PUT",
      url: "/%61pi/settings",
      headers: { "content-type": "application/json" },
      payload: { securityProfile: "approved_automation" },
    });
    expect(res.statusCode).toBe(401);
    expect(ctx.settings().securityProfile).toBe(before);
    expect(ctx.settings().securityProfile).not.toBe("approved_automation");
  });

  it("C3 encoded pair start without a token is 401", async () => {
    const res = await app.inject({ method: "POST", url: "/%61pi/pair/start", payload: {} });
    expect(res.statusCode).toBe(401);
    expect(ctx.devices.pairingOpen()).toBeNull();
  });

  it("C4 other spellings of a protected route never reach it", async () => {
    const backupsBefore = fs.existsSync(ctx.paths.backups) ? fs.readdirSync(ctx.paths.backups).length : 0;
    for (const url of ["/%2Fapi/backups", "/%61%70%69/backups", "/API/backups"]) {
      const res = await app.inject({ method: "POST", url, payload: {} });
      expect([401, 404], url).toContain(res.statusCode);
    }
    const backupsAfter = fs.existsSync(ctx.paths.backups) ? fs.readdirSync(ctx.paths.backups).length : 0;
    expect(backupsAfter).toBe(backupsBefore);
  });

  it("C5 meta stays public", async () => {
    const res = await app.inject({ method: "GET", url: "/api/meta" });
    expect(res.statusCode).toBe(200);
  });

  it("C6 pair claim stays public", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/pair/claim",
      headers: { "content-type": "application/json" },
      payload: { code: "000000", name: "phone" },
    });
    expect(res.json().error.code).toBe("pair_failed");
    expect(res.json().error.code).not.toBe("unauthorized");
  });
});

describe("S2 the page carries the token only to a loopback socket", () => {
  const meta = (html: string) => /<meta name="mordomo-token" content="([^"]*)"/.exec(html)?.[1];

  it("C7 a remote socket never gets the token in the page", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/",
      remoteAddress: "203.0.113.9",
      headers: { host: "localhost:4777" },
    });
    expect(res.statusCode).toBe(200);
    expect(meta(res.body)).toBe("");
    expect(res.body).not.toContain(token);
  });

  it("C8 a loopback page gets the token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/",
      remoteAddress: "127.0.0.1",
      headers: { host: "127.0.0.1:4777", ...NAVIGATION },
    });
    expect(res.statusCode).toBe(200);
    expect(meta(res.body)).toBe(token);
  });
});

describe("S3 the permission broker cannot approve", () => {
  it("C9 the broker carries its own credential", () => {
    const { credential } = brokeredRun();
    expect(credential).not.toBe(token);
    expect(credential.startsWith("brk_")).toBe(true);
  });

  it("C13 the broker cannot approve", async () => {
    const { runId, credential } = brokeredRun();
    const raised = await raise(credential, runId);
    const id = raised.json().id as string;
    const res = await app.inject({
      method: "POST",
      url: `/api/approvals/${id}/resolve`,
      headers: as(credential),
      payload: { decision: "approved" },
    });
    expect(res.statusCode).toBe(403);
    expect(ctx.approvals.get(id)!.status).toBe("pending");
  });

  it("C14 the broker can deny its own approval", async () => {
    const { runId, credential } = brokeredRun();
    const id = (await raise(credential, runId)).json().id as string;
    const res = await app.inject({
      method: "POST",
      url: `/api/approvals/${id}/resolve`,
      headers: as(credential),
      payload: { decision: "denied" },
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.approvals.get(id)!.status).toBe("denied");
  });

  it("C15 the broker raises and reads its own approval", async () => {
    const { runId, credential } = brokeredRun();
    const raised = await raise(credential, runId);
    expect(raised.statusCode).toBe(200);
    expect(raised.json().status).toBe("pending");
    const read = await app.inject({
      method: "GET",
      url: `/api/approvals/${raised.json().id}`,
      headers: as(credential),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().id).toBe(raised.json().id);
  });

  it("C16 the broker cannot touch another run", async () => {
    const mine = brokeredRun();
    const theirs = brokeredRun();
    const theirApproval = (await raise(theirs.credential, theirs.runId)).json().id as string;

    const foreignRaise = await raise(mine.credential, theirs.runId);
    expect(foreignRaise.statusCode).toBe(403);
    const foreignRead = await app.inject({
      method: "GET",
      url: `/api/approvals/${theirApproval}`,
      headers: as(mine.credential),
    });
    expect(foreignRead.statusCode).toBe(403);
    const foreignDeny = await app.inject({
      method: "POST",
      url: `/api/approvals/${theirApproval}/resolve`,
      headers: as(mine.credential),
      payload: { decision: "denied" },
    });
    expect(foreignDeny.statusCode).toBe(403);
    expect(ctx.approvals.get(theirApproval)!.status).toBe("pending");
  });

  it("C17 the broker credential opens no other route", async () => {
    const { credential } = brokeredRun();
    const settings = await app.inject({ method: "GET", url: "/api/settings", headers: as(credential) });
    expect(settings.statusCode).toBe(403);
    const run = await app.inject({
      method: "POST",
      url: "/api/runs",
      headers: as(credential),
      payload: { prompt: "x", mode: "read_only" },
    });
    expect(run.statusCode).toBe(403);
    const pair = await app.inject({
      method: "POST",
      url: "/api/pair/start",
      headers: as(credential),
      payload: {},
    });
    expect(pair.statusCode).toBe(403);
    expect(ctx.devices.pairingOpen()).toBeNull();
  });

  it("C18 the broker credential dies with its run", async () => {
    const { runId, credential } = brokeredRun();
    expect(await ctx.runs.cancel(runId)).toBe(true);
    expect(ctx.runs.get(runId)!.status).toBe("cancelled");
    const res = await raise(credential, runId);
    expect(res.statusCode).toBe(401);
  });
});

describe("S4 opening a file never runs it", () => {
  const notesDir = () => {
    const dir = path.join(ctx.paths.home, "notes");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };

  it("C19 executables are never opened", async () => {
    const dir = notesDir();
    for (const name of ["run.command", "x.sh", "setup.exe"])
      fs.writeFileSync(path.join(dir, name), "echo hi\n");
    fs.mkdirSync(path.join(dir, "Tool.app"), { recursive: true });
    spawned.length = 0;
    for (const name of ["run.command", "Tool.app", "x.sh", "setup.exe"]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/memory/open",
        headers: owner(),
        payload: { p: path.join(dir, name) },
      });
      expect(res.statusCode, name).toBe(415);
      expect(res.json().error.code, name).toBe("unsupported_type");
    }
    expect(spawned).toEqual([]);
  });

  it("C20 a markdown note opens", async () => {
    const file = path.join(notesDir(), "plan.md");
    fs.writeFileSync(file, "# plan\n");
    const res = await app.inject({
      method: "POST",
      url: "/api/memory/open",
      headers: owner(),
      payload: { p: file },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().opened).toBe(fs.realpathSync(file));
  });

  it("C21 the opener per platform never goes through cmd", () => {
    const p = "/notes/a & b.md";
    expect(openerFor("darwin", p)).toEqual(["open", [p]]);
    expect(openerFor("linux", p)).toEqual(["xdg-open", [p]]);
    expect(openerFor("win32", p)).toEqual(["explorer.exe", [p]]);
    for (const platform of ["darwin", "linux", "win32"] as const) {
      expect(openerFor(platform, p)[0]).not.toMatch(/^cmd/i);
    }
  });

  it("C25 a path outside the roots is refused", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-outside-"));
    const file = path.join(outside, "x.md");
    fs.writeFileSync(file, "x");
    const res = await app.inject({
      method: "POST",
      url: "/api/memory/open",
      headers: owner(),
      payload: { p: file },
    });
    expect(res.statusCode).toBe(403);
    fs.rmSync(outside, { recursive: true, force: true });
  });
});

describe("S6 the threat model names the new rules", () => {
  it("C24 the threat model names the new rules", () => {
    const doc = fs.readFileSync(path.join(repoRoot, "docs", "security.md"), "utf8");
    expect(doc).toContain("config: { public: true }");
    expect(doc).toContain("brk_");
    expect(doc).toMatch(/socket/i);
    expect(doc).toContain("req.socket.remoteAddress");
    expect(doc).toContain("OPENABLE_EXTENSIONS");
  });
});

describe("existing approval contract", () => {
  it("C26 approvals tool keeps 404 and 409 for the owner", async () => {
    const missing = await raise(token, "00000000-0000-4000-8000-000000000000");
    expect(missing.statusCode).toBe(404);
    const { runId } = brokeredRun();
    await ctx.runs.cancel(runId);
    const finished = await raise(token, runId);
    expect(finished.statusCode).toBe(409);
  });

  it("C27 unknown approvals are 404 for the owner", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    const read = await app.inject({ method: "GET", url: `/api/approvals/${id}`, headers: owner() });
    expect(read.statusCode).toBe(404);
    const resolve = await app.inject({
      method: "POST",
      url: `/api/approvals/${id}/resolve`,
      headers: owner(),
      payload: { decision: "denied" },
    });
    expect(resolve.statusCode).toBe(404);
  });

  it("C28 the owner still approves", async () => {
    const { runId, credential } = brokeredRun();
    const id = (await raise(credential, runId)).json().id as string;
    const res = await app.inject({
      method: "POST",
      url: `/api/approvals/${id}/resolve`,
      headers: owner(),
      payload: { decision: "approved" },
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.approvals.get(id)!.status).toBe("approved");
  });
});

describe("round 2: members the first verification found unproven", () => {
  const meta = (html: string) => /<meta name="mordomo-token" content="([^"]*)"/.exec(html)?.[1];

  it("C29 the broker credential works while its run is running and dies when it ends", async () => {
    const { runId, credential } = brokeredRun();
    ctx.db.prepare("UPDATE runs SET status = 'running', started_at = ? WHERE id = ?").run(Date.now(), runId);
    const raised = await raise(credential, runId);
    expect(raised.statusCode).toBe(200);
    const id = raised.json().id as string;
    const read = await app.inject({ method: "GET", url: `/api/approvals/${id}`, headers: as(credential) });
    expect(read.statusCode).toBe(200);
    const deny = await app.inject({
      method: "POST",
      url: `/api/approvals/${id}/resolve`,
      headers: as(credential),
      payload: { decision: "denied" },
    });
    expect(deny.statusCode).toBe(200);
    ctx.db.prepare("UPDATE runs SET status = 'done', finished_at = ? WHERE id = ?").run(Date.now(), runId);
    expect((await raise(credential, runId)).statusCode).toBe(401);
  });

  it("C30 a folder opens, an extensionless file does not", async () => {
    const dir = path.join(ctx.paths.home, "notes", "Projects");
    fs.mkdirSync(dir, { recursive: true });
    const folder = await app.inject({
      method: "POST",
      url: "/api/memory/open",
      headers: owner(),
      payload: { p: dir },
    });
    expect(folder.statusCode).toBe(200);
    const bare = path.join(ctx.paths.home, "notes", "runme");
    fs.writeFileSync(bare, "#!/bin/sh\necho hi\n");
    spawned.length = 0;
    const file = await app.inject({
      method: "POST",
      url: "/api/memory/open",
      headers: owner(),
      payload: { p: bare },
    });
    expect(file.statusCode).toBe(415);
    expect(file.json().error.code).toBe("unsupported_type");
    expect(spawned).toEqual([]);
  });

  it("C31 every allow-listed type opens", async () => {
    // The list approved in the plan's Landing (door 3), written out here on purpose.
    const allowed =
      "md txt pdf png jpg jpeg gif webp svg mp4 mov webm mp3 wav m4a csv json html htm docx xlsx pptx odt ods odp rtf".split(
        " ",
      );
    expect(allowed).toHaveLength(26);
    // …and nothing else: a type added to the code without a plan row fails here.
    expect([...OPENABLE_EXTENSIONS].sort()).toEqual([...allowed].sort());
    const dir = path.join(ctx.paths.home, "notes", "types");
    fs.mkdirSync(dir, { recursive: true });
    for (const ext of allowed) {
      for (const name of [`a.${ext}`, `B.${ext.toUpperCase()}`]) {
        const file = path.join(dir, name);
        fs.writeFileSync(file, "x");
        const res = await app.inject({
          method: "POST",
          url: "/api/memory/open",
          headers: owner(),
          payload: { p: file },
        });
        expect(res.statusCode, name).toBe(200);
      }
    }
  });

  it("C32 every page route keeps the token from a remote socket", async () => {
    for (const url of ["/", "/index.html", "/runs/abc", "/brain"]) {
      const res = await app.inject({
        method: "GET",
        url,
        remoteAddress: "203.0.113.9",
        headers: { host: "localhost:4777" },
      });
      expect(res.statusCode, url).toBe(200);
      expect(meta(res.body), url).toBe("");
      expect(res.body, url).not.toContain(token);
    }
  });

  it("C33 every loopback socket form gets the token", async () => {
    for (const remoteAddress of ["127.0.0.1", "127.0.0.2", "::1", "::ffff:127.0.0.1"]) {
      const res = await app.inject({
        method: "GET",
        url: "/index.html",
        remoteAddress,
        headers: { host: "localhost:4777", ...NAVIGATION },
      });
      expect(meta(res.body), remoteAddress).toBe(token);
    }
    for (const address of ["10.0.0.5", "::ffff:10.0.0.5", "fe80::1", "", undefined]) {
      expect(isLoopbackAddress(address), String(address)).toBe(false);
    }
  });

  it("C53 only a browser opening the page gets the token: not a program fetching it, not another origin", async () => {
    const page = (headers: Record<string, string>) =>
      app.inject({
        method: "GET",
        url: "/",
        remoteAddress: "127.0.0.1",
        headers: { host: "127.0.0.1:4777", ...headers },
      });
    // a program: curl and the like send no Fetch Metadata and no browser user agent
    for (const [who, headers] of [
      ["no headers", {}],
      ["curl", { "user-agent": "curl/8.5.0", accept: "*/*" }],
      ["node fetch", { "user-agent": "node" }],
      [
        "a script's fetch()",
        { "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin" },
      ],
      [
        "an iframe",
        { "sec-fetch-dest": "iframe", "sec-fetch-mode": "navigate", "sec-fetch-site": "cross-site" },
      ],
      ["a navigation that is not a document", { "sec-fetch-dest": "document", "sec-fetch-mode": "cors" }],
      ["a page from another origin", { ...NAVIGATION, origin: "http://evil.example" }],
      ["an origin that does not parse", { ...NAVIGATION, origin: "::::" }],
    ] as const) {
      const res = await page(headers);
      expect(res.statusCode, who).toBe(200);
      expect(meta(res.body), who).toBe("");
      expect(res.body, who).not.toContain(token);
    }
    // a person: a navigation, from this origin or none, and a browser that predates Fetch Metadata
    for (const [who, headers] of [
      ["navigation", NAVIGATION],
      ["navigation with this origin", { ...NAVIGATION, origin: "http://127.0.0.1:4777" }],
      ["opaque origin", { ...NAVIGATION, origin: "null" }],
      ["a web view before Fetch Metadata", { "user-agent": "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15" }],
    ] as const) {
      expect(meta((await page(headers)).body), who).toBe(token);
    }
    // the fallback page of the SPA answers the same way
    const deep = await app.inject({
      method: "GET",
      url: "/runs/abc",
      remoteAddress: "127.0.0.1",
      headers: { host: "127.0.0.1:4777", "user-agent": "curl/8.5.0" },
    });
    expect(meta(deep.body)).toBe("");
  });
});
