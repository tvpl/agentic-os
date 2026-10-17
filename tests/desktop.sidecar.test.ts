import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer, cookieValue, safeUrl, takeLaunchSecret } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";

/**
 * distribuicao, S1: the service knows how to be a desktop shell's child (.specs/features/distribuicao, AC 1-13).
 * The CLI cases run the BUILT artifact (`apps/api/dist/cli.js`), as tests/cli.test.ts does.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(repoRoot, "apps", "api", "dist", "cli.js");
const rootVersion = (
  JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { version: string }
).version;
const SECRET = "s".repeat(43);

const cli = (args: string[], env: NodeJS.ProcessEnv = {}) =>
  spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      MORDOMO_HOME: os.tmpdir(),
      ...env,
      MORDOMO_LAUNCH_TOKEN: env.MORDOMO_LAUNCH_TOKEN ?? "",
    },
  });

describe("C1 mordomo --version prints the root package version", () => {
  it("C1 the built CLI exists (the tests below run it)", () => {
    expect(fs.existsSync(CLI), `${CLI} is missing: run npm run build:server`).toBe(true);
  });
  for (const args of [["--version"], ["-v"], ["version"]])
    it(`C1 mordomo ${args.join(" ")} prints "mordomo ${rootVersion}" and exits 0`, () => {
      const res = cli(args);
      expect(res.stdout).toBe(`mordomo ${rootVersion}\n`);
      expect(res.status).toBe(0);
    });
  it("C2 mordomo --help lists --version and exits 0", () => {
    const res = cli(["--help"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("mordomo version");
    expect(res.stdout).toContain("--version");
    expect(res.stdout).toContain("--sidecar");
  });
});

describe("C3 usage errors of --sidecar and --port exit 2 and start nothing", () => {
  const cases: Array<[string, string[], NodeJS.ProcessEnv, RegExp]> = [
    ["no secret", ["start", "--foreground", "--sidecar"], {}, /MORDOMO_LAUNCH_TOKEN/],
    [
      "a 31-character secret",
      ["start", "--foreground", "--sidecar"],
      { MORDOMO_LAUNCH_TOKEN: "x".repeat(31) },
      /MORDOMO_LAUNCH_TOKEN/,
    ],
    [
      "port 65536",
      ["start", "--foreground", "--sidecar", "--port", "65536"],
      { MORDOMO_LAUNCH_TOKEN: SECRET },
      /--port/,
    ],
    [
      "port -1",
      ["start", "--foreground", "--sidecar", "--port=-1"],
      { MORDOMO_LAUNCH_TOKEN: SECRET },
      /--port/,
    ],
    [
      "port abc",
      ["start", "--foreground", "--sidecar", "--port", "abc"],
      { MORDOMO_LAUNCH_TOKEN: SECRET },
      /--port/,
    ],
    [
      "--port without --sidecar",
      ["start", "--foreground", "--port", "4000"],
      { MORDOMO_LAUNCH_TOKEN: SECRET },
      /--sidecar/,
    ],
    ["--sidecar on stop", ["stop", "--sidecar"], { MORDOMO_LAUNCH_TOKEN: SECRET }, /not valid/],
    ["--port on status", ["status", "--port", "1"], { MORDOMO_LAUNCH_TOKEN: SECRET }, /not valid/],
    [
      "--sidecar without --foreground",
      ["start", "--sidecar"],
      { MORDOMO_LAUNCH_TOKEN: SECRET },
      /--foreground/,
    ],
  ];
  for (const [name, args, env, message] of cases)
    it(`C3 ${name}`, () => {
      const res = cli(args, env);
      expect(res.status).toBe(2);
      expect(res.stderr).toMatch(message);
      expect(res.stdout).not.toContain("MORDOMO_READY");
    });
});

// ---- the running sidecar ------------------------------------------------------------------------------------

interface Sidecar {
  child: ChildProcessWithoutNullStreams;
  ready: { v: number; pid: number; port: number; version: string; updatesCheck: boolean } | null;
  stdout: () => string;
  stderr: () => string;
  exited: Promise<number | null>;
}

function startSidecar(home: string, port: number | string, secret = SECRET): Promise<Sidecar> {
  const child = spawn(process.execPath, [CLI, "start", "--foreground", "--sidecar", "--port", String(port)], {
    env: { ...process.env, MORDOMO_HOME: home, MORDOMO_LAUNCH_TOKEN: secret, MORDOMO_SKIP_NPM_AUDIT: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr.on("data", (d: Buffer) => (err += d.toString()));
  const exited = new Promise<number | null>((resolve) => child.once("close", (code) => resolve(code)));
  return new Promise((resolve) => {
    const finish = () => {
      clearInterval(poll);
      const line = out.split("\n").find((l) => l.startsWith("MORDOMO_READY "));
      resolve({
        child,
        ready: line ? (JSON.parse(line.slice("MORDOMO_READY ".length)) as Sidecar["ready"]) : null,
        stdout: () => out,
        stderr: () => err,
        exited,
      });
    };
    const poll = setInterval(() => out.includes("MORDOMO_READY ") && out.endsWith("\n") && finish(), 50);
    void exited.then(finish);
  });
}

describe("C4 a sidecar says when it listens, and goes when its stdin closes", () => {
  const first = makeTempHome("mordomo-sidecar-");
  let sidecar: Sidecar;
  beforeAll(async () => {
    fs.mkdirSync(path.dirname(first.paths.settingsFile), { recursive: true });
    fs.writeFileSync(first.paths.settingsFile, JSON.stringify({ version: 1, updates: { check: true } }));
    sidecar = await startSidecar(first.paths.home, 0);
  }, 60_000);
  afterAll(async () => {
    sidecar.child.stdin.end();
    await sidecar.exited;
    first.cleanup();
  }, 30_000);

  it("C4 one MORDOMO_READY line: v 1, the bound port, the pid, the version and updatesCheck as the setting has it", () => {
    expect(sidecar.ready, sidecar.stderr()).not.toBeNull();
    const { ready } = sidecar;
    expect(Object.keys(ready!).sort()).toEqual(["pid", "port", "updatesCheck", "v", "version"]);
    expect(ready!.v).toBe(1);
    expect(ready!.pid).toBe(sidecar.child.pid);
    expect(ready!.version).toBe(rootVersion);
    expect(ready!.updatesCheck).toBe(true);
    expect(ready!.port).toBeGreaterThan(0);
    expect(
      sidecar
        .stdout()
        .split("\n")
        .filter((l) => l.startsWith("MORDOMO_READY ")),
    ).toHaveLength(1);
  });

  it("C4 it listens on 127.0.0.1 at that port, and the line came after the listener was up", async () => {
    const res = await fetch(`http://127.0.0.1:${sidecar.ready!.port}/`);
    expect(res.status).toBe(200);
    const pidFile = JSON.parse(fs.readFileSync(path.join(first.paths.run, "server.pid"), "utf8")) as {
      port: number;
    };
    expect(pidFile.port).toBe(sidecar.ready!.port);
  });

  it("C5 a second sidecar over the same home does not stop the first and exits 4 naming its pid", async () => {
    const second = await startSidecar(first.paths.home, 0);
    expect(await second.exited).toBe(4);
    expect(second.stderr()).toContain(`(pid ${sidecar.child.pid})`);
    expect(second.ready).toBeNull();
    expect(sidecar.child.exitCode).toBeNull();
    expect((await fetch(`http://127.0.0.1:${sidecar.ready!.port}/`)).status).toBe(200);
  }, 60_000);

  it("C6 a requested port that is taken exits 5 and the process holding it is left alone", async () => {
    const other = makeTempHome("mordomo-sidecar-busy-");
    const holder = net.createServer();
    await new Promise<void>((resolve) => holder.listen(0, "127.0.0.1", resolve));
    try {
      const port = (holder.address() as net.AddressInfo).port;
      const busy = await startSidecar(other.paths.home, port);
      expect(await busy.exited, busy.stderr()).toBe(5);
      expect(busy.ready).toBeNull();
      expect(holder.listening).toBe(true);
    } finally {
      holder.close();
      other.cleanup();
    }
  }, 60_000);

  // The secret has to reach `buildServer` through the CLI too (the other assembly of the same service): needs the built UI.
  const uiBuilt = fs.existsSync(path.join(repoRoot, "apps", "command-centre", "dist", "index.html"));
  it.runIf(uiBuilt)(
    "C9 through the real sidecar: ?launch= is traded for the cookie (302) and a request without it gets an empty meta",
    async () => {
      const base = `http://127.0.0.1:${sidecar.ready!.port}`;
      const browser = {
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "user-agent": "Mozilla/5.0 test",
      };
      const traded = await fetch(`${base}/?launch=${SECRET}`, { redirect: "manual", headers: browser });
      expect(traded.status).toBe(302);
      expect(traded.headers.get("set-cookie")).toBe(
        `mordomo_launch=${SECRET}; HttpOnly; SameSite=Lax; Path=/`,
      );
      const without = await fetch(`${base}/`, { headers: browser });
      expect(/<meta name="mordomo-token" content="([^"]*)"/.exec(await without.text())?.[1]).toBe("");
      const wrong = await fetch(`${base}/?launch=${"x".repeat(43)}`, {
        redirect: "manual",
        headers: browser,
      });
      expect(wrong.status).toBe(200);
      expect(wrong.headers.get("set-cookie")).toBeNull();
    },
  );

  it("C7 closing stdin shuts the service down through the SIGTERM path: exit 0 and the pid file is gone", async () => {
    sidecar.child.stdin.end();
    expect(await sidecar.exited).toBe(0);
    expect(fs.existsSync(path.join(first.paths.run, "server.pid"))).toBe(false);
  }, 30_000);
});

// ---- GET / and the launch secret ------------------------------------------------------------------------------

const BROWSER = { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" } as const;
const meta = (html: string) => /<meta name="mordomo-token" content="([^"]*)"/.exec(html)?.[1];

describe("C8 while a launch secret is set GET / hands the owner's token only to the shell that has it", () => {
  const temp = makeTempHome("mordomo-launch-");
  const uiDist = path.join(temp.paths.home, "ui");
  let ctx: AppContext;
  let app: FastifyInstance;
  let plain: FastifyInstance;
  beforeAll(async () => {
    fs.mkdirSync(uiDist, { recursive: true });
    fs.writeFileSync(
      path.join(uiDist, "index.html"),
      '<!doctype html><meta name="mordomo-token" content=""><div id="root"></div>',
    );
    ctx = new AppContext(temp.paths.home);
    app = await buildServer(ctx, { uiDist, launchSecret: SECRET });
    plain = await buildServer(ctx, { uiDist });
    await Promise.all([app.ready(), plain.ready()]);
  });
  afterAll(async () => {
    await Promise.all([app.close(), plain.close()]);
    ctx.close();
    temp.cleanup();
  });

  it("C8 a browser-looking request without the secret gets 200 and an empty meta, on / and /index.html and a deep link", async () => {
    for (const url of ["/", "/index.html", "/settings"]) {
      const res = await app.inject({ url, headers: BROWSER });
      expect(res.statusCode, url).toBe(200);
      expect(meta(res.body), url).toBe("");
      expect(res.body).not.toContain(ctx.token());
    }
  });

  it("C9 the right ?launch= is answered 302 to the same path with the HttpOnly SameSite=Lax cookie, and no token in the body", async () => {
    const res = await app.inject({ url: `/?launch=${SECRET}`, headers: BROWSER });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/");
    expect(res.headers["set-cookie"]).toBe(`mordomo_launch=${SECRET}; HttpOnly; SameSite=Lax; Path=/`);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).not.toContain(ctx.token());
    const deep = await app.inject({ url: `/settings?launch=${SECRET}`, headers: BROWSER });
    expect(deep.statusCode).toBe(302);
    expect(deep.headers.location).toBe("/settings");
    // The redirect target stays on this origin however the path starts.
    const sneaky = await app.inject({ url: `//evil.example/?launch=${SECRET}`, headers: BROWSER });
    expect(sneaky.headers.location ?? "/").toMatch(/^\/(?!\/)/);
  });

  it("C9 the next GET / that carries the cookie and looks like a browser gets the owner's token; the cookie without browser headers does not", async () => {
    const cookie = { cookie: `other=1; mordomo_launch=${SECRET}` };
    const withCookie = await app.inject({ url: "/", headers: { ...BROWSER, ...cookie } });
    expect(withCookie.statusCode).toBe(200);
    expect(meta(withCookie.body)).toBe(ctx.token());
    const noBrowser = await app.inject({ url: "/", headers: { ...cookie, "user-agent": "curl/8" } });
    expect(meta(noBrowser.body)).toBe("");
  });

  it("C10 a wrong or truncated ?launch= and a wrong cookie get 200, an empty meta and no cookie", async () => {
    for (const bad of ["nope", SECRET.slice(0, -1), `${SECRET}x`, ""]) {
      const res = await app.inject({ url: `/?launch=${bad}`, headers: BROWSER });
      expect(res.statusCode, bad).toBe(200);
      expect(meta(res.body), bad).toBe("");
      expect(res.headers["set-cookie"], bad).toBeUndefined();
    }
    const badCookie = await app.inject({
      url: "/",
      headers: { ...BROWSER, cookie: `mordomo_launch=${SECRET}x` },
    });
    expect(meta(badCookie.body)).toBe("");
  });

  it("C10 the secret is no use from a forged Host or through a proxy header", async () => {
    const proxied = await app.inject({
      url: `/?launch=${SECRET}`,
      headers: { ...BROWSER, "x-forwarded-for": "10.0.0.1" },
    });
    expect(proxied.statusCode).toBe(200);
    expect(proxied.headers["set-cookie"]).toBeUndefined();
    expect(meta(proxied.body)).toBe("");
  });

  it("C10 the right secret from a TLS socket that is not this machine's is no use: 200, no cookie, an empty meta; from loopback it is traded", async () => {
    // Over plain http another machine is refused by the global guard before `GET /` is reached (403 tls_required). The
    // launch trade has to hold on its own for the other way in, a TLS connection from another machine: make the mock
    // sockets of `inject` TLS ones for this test (`encrypted`), and give them a far address.
    const probe = Fastify();
    let socketPrototype: object | null = null;
    probe.get("/", (req) => {
      socketPrototype = Object.getPrototypeOf(req.raw.socket) as object;
      return "";
    });
    await probe.inject("/");
    await probe.close();
    expect(socketPrototype).not.toBeNull();
    Object.defineProperty(socketPrototype!, "encrypted", { value: true, configurable: true });
    try {
      const far = await app.inject({
        url: `/?launch=${SECRET}`,
        headers: BROWSER,
        remoteAddress: "203.0.113.9",
      });
      expect(far.statusCode).toBe(200);
      expect(far.headers["set-cookie"]).toBeUndefined();
      expect(meta(far.body)).toBe("");
      const farWithCookie = await app.inject({
        url: "/",
        headers: { ...BROWSER, cookie: `mordomo_launch=${SECRET}` },
        remoteAddress: "203.0.113.9",
      });
      expect(farWithCookie.statusCode).toBe(200);
      expect(meta(farWithCookie.body)).toBe("");
      // the control that gives the two above their meaning: the same requests from loopback are traded and served the token
      const near = await app.inject({
        url: `/?launch=${SECRET}`,
        headers: BROWSER,
        remoteAddress: "127.0.0.1",
      });
      expect(near.statusCode).toBe(302);
      const nearWithCookie = await app.inject({
        url: "/",
        headers: { ...BROWSER, cookie: `mordomo_launch=${SECRET}` },
        remoteAddress: "127.0.0.1",
      });
      expect(meta(nearWithCookie.body)).toBe(ctx.token());
    } finally {
      delete (socketPrototype as { encrypted?: boolean }).encrypted;
    }
    // a forged Host is the global guard's (403) and sets no cookie either
    const forged = await app.inject({
      url: `/?launch=${SECRET}`,
      headers: { ...BROWSER, host: "evil.example" },
    });
    expect(forged.statusCode).toBe(403);
    expect(forged.headers["set-cookie"]).toBeUndefined();
  });

  it("C58 the launch secret is taken out of the environment the service hands to what it starts, and cmdSidecar uses that", () => {
    const env: NodeJS.ProcessEnv = { MORDOMO_LAUNCH_TOKEN: SECRET, PATH: "/usr/bin" };
    expect(takeLaunchSecret(env)).toBe(SECRET);
    expect(env.MORDOMO_LAUNCH_TOKEN).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
    expect(takeLaunchSecret(env)).toBe(""); // already taken
    expect(takeLaunchSecret({})).toBe("");
    const cliSource = fs.readFileSync(path.join(repoRoot, "apps", "api", "src", "cli.ts"), "utf8");
    expect(cliSource).toContain("launchSecret: takeLaunchSecret(process.env)");
    expect(cliSource).not.toMatch(/launchSecret:\s*process\.env/);
  });

  it("C11 the request log never holds the secret: safeUrl redacts launch, and cookieValue reads one cookie of many", () => {
    expect(safeUrl(`/?launch=${SECRET}&x=1`)).toBe("/?launch=[REDACTED]&x=1");
    expect(safeUrl(`/?a=1&launch=${SECRET}`)).toBe("/?a=1&launch=[REDACTED]");
    expect(safeUrl("/api/x?token=abc&ticket=def")).toBe("/api/x?token=[REDACTED]&ticket=[REDACTED]");
    expect(cookieValue("a=1; mordomo_launch=zzz; b=2", "mordomo_launch")).toBe("zzz");
    expect(cookieValue("xmordomo_launch=zzz", "mordomo_launch")).toBeUndefined();
    expect(cookieValue(undefined, "mordomo_launch")).toBeUndefined();
  });

  it("C12 without a launch secret nothing changed: a browser-looking request gets the token, ?launch= is ignored, no cookie is set", async () => {
    const res = await plain.inject({ url: "/", headers: BROWSER });
    expect(meta(res.body)).toBe(ctx.token());
    const withQuery = await plain.inject({ url: `/?launch=${SECRET}`, headers: BROWSER });
    expect(withQuery.statusCode).toBe(200);
    expect(withQuery.headers["set-cookie"]).toBeUndefined();
    expect(meta(withQuery.body)).toBe(ctx.token());
  });
});
