import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { SettingsSchema } from "../contracts/src/index.js";
import { deliverPush } from "../core/src/channels/pushChannel.js";
import { sendTelegramMessage } from "../core/src/channels/telegram.js";
import { npmAuditCheck } from "../apps/api/src/doctor.js";

/**
 * The sweep of every network point of the code, the privacy policy that has to name them, and "no telemetry"
 * (.specs/features/licenca-comercial, C23-C27). The privacy text is a draft for the owner's legal review; these
 * tests prove it agrees with the code, not that it is legally sufficient.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN = path.join(ROOT, "scripts", "network-scan.mjs");

interface Point {
  file: string;
  kind: string;
  count: number;
}
interface Scan {
  scanSource: (source: string, fileName?: string) => { points: Map<string, number>; hosts: Set<string> };
  scanTree: (root?: string) => { sites: Point[]; hosts: Array<{ host: string; files: string[] }> };
  compare: (found: ReturnType<Scan["scanTree"]>, policy: Policy) => string[];
  covers: (pattern: string, host: string) => boolean;
  main: (argv: string[], io: { out: (s: string) => void; err: (s: string) => void }) => number;
}
interface HostEntry {
  id: string;
  label: string;
  role: string;
  match: string[];
  implicit?: boolean;
  trigger: string;
  default: string;
  data: string;
}
interface Policy {
  note: string;
  hosts: HostEntry[];
  ignored: Array<{ match: string; reason: string }>;
  sites: Array<Point & { hosts: string[]; note?: string }>;
}
const scan = (await import("../scripts/network-scan.mjs")) as unknown as Scan;
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, "legal", "network-policy.json"), "utf8")) as Policy;
const privacy = fs.readFileSync(path.join(ROOT, "legal", "PRIVACY.md"), "utf8");
/** The scan of the real tree, once: it parses the whole product. */
const realScan = scan.scanTree(ROOT);

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

const read = (source: string, file = "x.ts") => {
  const r = scan.scanSource(source, file);
  return { points: Object.fromEntries(r.points), hosts: [...r.hosts].sort() };
};

// ---- C23 ------------------------------------------------------------------------------------------------------------

describe("C23 the reader finds every kind of network point and every source of a host, and ignores what is not one", () => {
  it("C23 fetch: a call, a default value, a global-object call and a function argument count", () => {
    expect(read(`fetch("https://a.example.net/x");`).points).toEqual({ fetch: 1 });
    expect(read(`const f = opts.fetchImpl ?? fetch;`).points).toEqual({ fetch: 1 });
    expect(read(`globalThis.fetch(u); window.fetch(u);`).points).toEqual({ fetch: 2 });
    expect(read(`run(fetch);`).points).toEqual({ fetch: 1 });
    expect(read(`const go = (url, init) => fetch(url, init);`).points).toEqual({ fetch: 1 });
  });

  it("C23 fetch: a type, a property, a parameter name, a string and a comment do not count", () => {
    expect(read(`function f(g: typeof fetch) {} let h: typeof fetch;`).points).toEqual({});
    expect(read(`type T = typeof fetch;`).points).toEqual({});
    expect(read(`req.fetch(); obj.fetch = 1;`).points).toEqual({});
    expect(read(`function f(fetch) { return 1 } `).points).toEqual({});
    expect(read(`el.addEventListener("fetch", h); const s = "fetch"; const t = \`fetch\`;`).points).toEqual(
      {},
    );
    expect(read(`// fetch("https://a.example.net")\n/* fetch(x) */ const a = 1;`)).toEqual({
      points: {},
      hosts: [],
    });
  });

  it("C23 modules: import, side-effect import, require, dynamic import and re-export of a network module count", () => {
    expect(read(`import https from "node:https";`).points).toEqual({ "module:https": 1 });
    expect(read(`import { request } from "http";`).points).toEqual({ "module:http": 1 });
    expect(read(`import "node:net";`).points).toEqual({ "module:net": 1 });
    expect(read(`const n = require("node:tls");`, "x.cjs").points).toEqual({ "module:tls": 1 });
    expect(read(`const u = await import("undici");`).points).toEqual({ "module:undici": 1 });
    expect(read(`export * from "ws";`).points).toEqual({ "module:ws": 1 });
    expect(read(`import dns from "node:dns/promises";`).points).toEqual({ "module:dns/promises": 1 });
    expect(read(`import dns from "node:dns";`).points).toEqual({ "module:dns": 1 });
    expect(
      read(`import fs from "node:fs"; import cp from "node:child_process"; import x from "undici-like";`)
        .points,
    ).toEqual({});
  });

  it("C23 browser objects: EventSource, WebSocket, XMLHttpRequest, WebTransport and sendBeacon count; their types do not", () => {
    expect(read(`new EventSource(u);`).points).toEqual({ eventsource: 1 });
    expect(read(`new WebSocket(u);`).points).toEqual({ websocket: 1 });
    expect(read(`new XMLHttpRequest();`).points).toEqual({ xhr: 1 });
    expect(read(`new WebTransport(u);`).points).toEqual({ webtransport: 1 });
    expect(read(`navigator.sendBeacon(u, d);`).points).toEqual({ beacon: 1 });
    expect(read(`navigator["sendBeacon"](u, d);`).points).toEqual({ beacon: 1 });
    expect(read(`let source: EventSource | null = null; function f(w: WebSocket) {}`).points).toEqual({});
  });

  it("C23 programs: the npm CLI script, curl and wget count; a longer word does not", () => {
    expect(read(`spawn(node, [path.join("bin", "npm-cli.js"), "audit"]);`).points).toEqual({
      "program:npm-cli": 1,
    });
    expect(read(`run("curl", [url]);`).points).toEqual({ "program:curl": 1 });
    expect(read(`run("wget", [url]);`).points).toEqual({ "program:wget": 1 });
    expect(read(`const a = "curly"; const b = "npm"; const c = "curl -s";`).points).toEqual({});
  });

  it("C23 hosts: a URL literal, a template, a bare constant and a regular expression give their host", () => {
    expect(read(`const a = "https://api.telegram.org/bot";`).hosts).toEqual(["api.telegram.org"]);
    expect(read("const a = `https://api.example.net/${x}`;").hosts).toEqual(["api.example.net"]);
    expect(read("const a = `https://${host}/x`;").hosts).toEqual([]);
    expect(read(`export const HOST = "relay.example.net";`).hosts).toEqual(["relay.example.net"]);
    expect(read(`const re = /^fcm\\.googleapis\\.com$/;`).hosts).toEqual(["fcm.googleapis.com"]);
    expect(read(`const re = /^[a-z0-9-]+\\.push\\.apple\\.com$/;`).hosts).toEqual(["push.apple.com"]);
    expect(read(`const re = /^[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.notify\\.windows\\.com$/;`).hosts).toEqual([
      "notify.windows.com",
    ]);
    expect(read(`const a = "wss://realtime.example.net/socket";`).hosts).toEqual(["realtime.example.net"]);
    expect(read(`const a = "http://user:pw@creds.example.net:8080/p";`).hosts).toEqual(["creds.example.net"]);
    expect(read(`const a = "HTTPS://Upper.Example.NET/x";`).hosts).toEqual(["upper.example.net"]);
  });

  it("C23 hosts: a file name, a key, a path and a comment are not hosts", () => {
    expect(
      read(
        `const a = ["index.json", "README.md", "setup.sh", "app.ts", "foo.bar", "scene.routines.in", "a.b.local"];`,
      ).hosts,
    ).toEqual([]);
    expect(read(`// https://commented.example.net/x\nconst a = 1;`).hosts).toEqual([]);
    expect(read(`const a = "api.example.net/path";`).hosts).toEqual([]);
  });

  it("C23 a text file (CSS, HTML, JSON) gives the host of a URL, loopback and ignored hosts aside (scanTree)", () => {
    const dir = project({
      "core/src/a.ts": `const l = "http://127.0.0.1:4777/api"; const m = "http://localhost:3000"; const n = "http://[::1]:4777/";`,
      "apps/command-centre/src/x.css": `@import url("https://fonts.example.net/css");`,
      "apps/command-centre/index.html": `<svg xmlns='http://www.w3.org/2000/svg'></svg>`,
      "connectors/c.json": `{"origin": "https://github.com/x/y"}`,
    });
    const found = scan.scanTree(dir);
    expect(found.hosts.map((h) => h.host)).toEqual(["fonts.example.net", "github.com", "www.w3.org"]);
    expect(found.sites).toEqual([]);
  });

  it("C23 a test file, a declaration file, node_modules and dist are not the product", () => {
    const dir = project({
      "core/src/a.test.ts": `fetch("https://tests.example.net");`,
      "core/src/a.d.ts": `declare const x: "https://types.example.net";`,
      "core/src/node_modules/p/i.js": `fetch("https://dep.example.net");`,
      "core/src/dist/o.js": `fetch("https://built.example.net");`,
      "core/src/real.ts": `fetch("https://real.example.net");`,
    });
    const found = scan.scanTree(dir);
    expect(found.sites).toEqual([{ file: "core/src/real.ts", kind: "fetch", count: 1 }]);
    expect(found.hosts.map((h) => h.host)).toEqual(["real.example.net"]);
  });

  it("C23 the wildcard of a policy entry covers the host itself and its subdomains, not a look-alike", () => {
    expect(scan.covers("*.push.apple.com", "push.apple.com")).toBe(true);
    expect(scan.covers("*.push.apple.com", "web.push.apple.com")).toBe(true);
    expect(scan.covers("*.push.apple.com", "evilpush.apple.com")).toBe(false);
    expect(scan.covers("*.push.apple.com", "push.apple.com.evil.net")).toBe(false);
    expect(scan.covers("api.github.com", "github.com")).toBe(false);
    expect(scan.covers("github.com", "api.github.com")).toBe(false);
  });
});

// ---- fixtures for C24 -------------------------------------------------------------------------------------------------

function project(files: Record<string, string>, policyJson?: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "legal-net-"));
  dirs.push(dir);
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
  if (policyJson !== undefined) {
    fs.mkdirSync(path.join(dir, "legal"), { recursive: true });
    fs.writeFileSync(path.join(dir, "legal", "network-policy.json"), JSON.stringify(policyJson));
  }
  return dir;
}
const GOOD_SOURCE = `export const HOST = "api.example.net";\nexport const go = () => fetch("https://" + HOST + "/x");\n`;
const GOOD_POLICY = (): Policy => ({
  note: "fixture",
  hosts: [
    {
      id: "api",
      label: "Api",
      role: "contact",
      match: ["api.example.net"],
      trigger: "t",
      default: "d",
      data: "x",
    },
    {
      id: "gone",
      label: "Gone",
      role: "link",
      match: [],
      implicit: true,
      trigger: "t",
      default: "d",
      data: "x",
    },
  ],
  ignored: [{ match: "www.w3.org", reason: "namespace" }],
  sites: [{ file: "core/src/a.ts", kind: "fetch", count: 1, hosts: ["api"] }],
});
function check(
  files: Record<string, string>,
  pol: unknown = GOOD_POLICY(),
): { code: number; out: string; err: string } {
  const dir = project(files, pol);
  let out = "";
  let err = "";
  const code = scan.main(["--check", "--root", dir], { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}

describe("C24 the code and the policy agree, in both directions", () => {
  it("C24 in the real code every network point and host is in legal/network-policy.json and the policy has nothing the code lacks", () => {
    expect(scan.compare(realScan, policy)).toEqual([]);
    let err = "";
    let out = "";
    expect(scan.main(["--check"], { out: (s) => (out += s), err: (s) => (err += s) }), err).toBe(0);
    expect(out).toContain("all in the policy");
    const cli = spawnSync(process.execPath, [SCAN, "--check"], { cwd: os.tmpdir(), encoding: "utf8" });
    expect(cli.status, cli.stderr).toBe(0);
  });

  it("C24 the real code has the network points the research found (26) and the hosts the policy names", () => {
    const found = realScan;
    expect(found.sites).toHaveLength(26);
    const fetchFiles = found.sites.filter((s) => s.kind === "fetch").map((s) => s.file);
    for (const file of [
      "apps/api/src/updates.ts",
      "core/src/channels/telegram.ts",
      "core/src/channels/telegramInbound.ts",
      "core/src/channels/webpush.ts",
      "core/src/routines/scheduler.ts",
      "core/src/skills/registry.ts",
      "core/src/connectors/client.ts",
    ])
      expect(fetchFiles, file).toContain(file);
    const hosts = found.hosts.map((h) => h.host);
    for (const host of [
      "api.github.com",
      "api.telegram.org",
      "fcm.googleapis.com",
      "push.apple.com",
      "nodejs.org",
    ])
      expect(hosts, host).toContain(host);
  });

  it("C24 the fixture's own good case passes (so the failures below are the mutation, not the fixture)", () => {
    const res = check({ "core/src/a.ts": GOOD_SOURCE });
    expect(res.code, res.err).toBe(0);
  });

  it("C24 a new file with a fetch to a new host exits 1 naming file, kind and host", () => {
    const res = check({
      "core/src/a.ts": GOOD_SOURCE,
      "core/src/tracker.ts": `export const t = () => fetch("https://tracker.example.net/x");\n`,
    });
    expect(res.code).toBe(1);
    expect(res.err).toContain("core/src/tracker.ts · fetch ×1");
    expect(res.err).toContain("tracker.example.net");
  });

  it("C24 a second fetch in an approved file exits 1 saying where the count moved", () => {
    const res = check({ "core/src/a.ts": GOOD_SOURCE + `export const two = () => fetch(HOST);\n` });
    expect(res.code).toBe(1);
    expect(res.err).toContain("core/src/a.ts · fetch: the policy says ×1, the code has ×2");
  });

  it("C24 a new host literal in an approved file exits 1 naming the host", () => {
    const res = check({
      "core/src/a.ts": GOOD_SOURCE + `export const other = "https://other.example.net/p";\n`,
    });
    expect(res.code).toBe(1);
    expect(res.err).toContain("new host: other.example.net (core/src/a.ts)");
  });

  it("C24 a policy site that the code no longer has, and a policy host that the code no longer names, exit 1", () => {
    const site = check({ "core/src/a.ts": `export const HOST = "api.example.net";\n` });
    expect(site.code).toBe(1);
    expect(site.err).toContain("stale policy site: core/src/a.ts · fetch");
    const host = check({ "core/src/a.ts": `export const go = () => fetch(u);\n` });
    expect(host.code).toBe(1);
    expect(host.err).toContain("stale policy host: api · api.example.net");
  });

  it("C24 a site that names a host entry that does not exist exits 1", () => {
    const pol = GOOD_POLICY();
    pol.sites[0]!.hosts = ["api", "nope"];
    const res = check({ "core/src/a.ts": GOOD_SOURCE }, pol);
    expect(res.code).toBe(1);
    expect(res.err).toContain('the host entry "nope", which does not exist');
  });

  it("C24 an ignored host is accepted, and an implicit entry may have no match in the code", () => {
    const res = check({ "core/src/a.ts": GOOD_SOURCE + `export const ns = "http://www.w3.org/2000/svg";\n` });
    expect(res.code, res.err).toBe(0);
  });

  it("C24 a policy that cannot be read, and a flag that does not exist, exit 2", () => {
    const dir = project({ "core/src/a.ts": GOOD_SOURCE });
    let err = "";
    expect(scan.main(["--check", "--root", dir], { out: () => {}, err: (s) => (err += s) })).toBe(2);
    expect(err).toContain("network-scan:");
    expect(scan.main(["--nope"], { out: () => {}, err: () => {} })).toBe(2);
  });
});

// ---- C25 --------------------------------------------------------------------------------------------------------------

describe("C25 the privacy policy repeats the network policy", () => {
  const ROLES = ["local", "contact", "user-defined", "cli", "link", "build"];

  it("C25 there are 15 entries, ids are unique, roles are the six, and no site names an id that is missing", () => {
    expect(policy.hosts).toHaveLength(15);
    const ids = policy.hosts.map((h) => h.id);
    expect(new Set(ids).size).toBe(15);
    expect([...new Set(policy.hosts.map((h) => h.role))].sort()).toEqual([...ROLES].sort());
    for (const site of policy.sites)
      for (const id of site.hosts) expect(ids, `${site.file} ${site.kind}`).toContain(id);
    const matches = policy.hosts.flatMap((h) => h.match);
    expect(new Set(matches).size).toBe(matches.length);
  });

  for (const entry of policy.hosts)
    it(`C25 ${entry.id}: label, every address, and the trigger, the default and the data word for word are in legal/PRIVACY.md`, () => {
      for (const field of ["label", "trigger", "default", "data"] as const) {
        expect(typeof entry[field], `${entry.id}.${field}`).toBe("string");
        expect(entry[field].trim().length, `${entry.id}.${field}`).toBeGreaterThan(
          10 * Number(field !== "default"),
        );
        expect(privacy, `${entry.id}.${field}`).toContain(entry[field]);
      }
      for (const match of entry.match) expect(privacy, `${entry.id} ${match}`).toContain(match);
      expect(ROLES).toContain(entry.role);
      if (entry.role === "contact")
        expect(entry.match.length, `${entry.id} has an address`).toBeGreaterThan(0);
      // Only a role that has no address of its own may be implicit: a contacted host cannot hide there.
      if (entry.implicit) expect(["local", "cli"]).toContain(entry.role);
    });

  it("C25 every host the scan finds (outside the ignored ones) is written in the privacy policy", () => {
    for (const { host } of realScan.hosts) {
      if (policy.ignored.some((i) => scan.covers(i.match, host))) continue;
      const entry = policy.hosts.find((h) => h.match.some((m) => scan.covers(m, host)));
      expect(entry, host).toBeDefined();
      expect(
        entry!.match.some((m) => privacy.includes(m)),
        host,
      ).toBe(true);
    }
  });

  it("C25 every ignored host has a reason", () => {
    for (const item of policy.ignored) expect(item.reason.trim().length, item.match).toBeGreaterThan(5);
  });
});

// ---- C26 --------------------------------------------------------------------------------------------------------------

describe("C26 a conditional destination is off, or empty, until the owner turns it on", () => {
  const defaults = SettingsSchema.parse({}) as unknown as {
    updates: { check: boolean };
    channels: { telegram: { enabled: boolean; inbound: boolean }; push: { enabled: boolean } };
    routines: { allowWebhooks: boolean };
    marketplace: { registries: string[] };
    connectors: { allowedCommands: string[] };
  };

  it("C26 the default settings: version check, Telegram, Telegram polling, push, webhooks off; registries and connector commands empty", () => {
    expect(defaults.updates.check).toBe(false);
    expect(defaults.channels.telegram.enabled).toBe(false);
    expect(defaults.channels.telegram.inbound).toBe(false);
    expect(defaults.channels.push.enabled).toBe(false);
    expect(defaults.routines.allowWebhooks).toBe(false);
    expect(defaults.marketplace.registries).toEqual([]);
    expect(defaults.connectors.allowedCommands).toEqual([]);
  });

  it("C26 push with the channel on and no subscription calls nothing; with the channel off, nothing either", async () => {
    const fetchSpy = vi.fn();
    const store = { targets: () => [] } as never;
    const row = { id: "n1", title: "t", body: "b", tone: "warn", createdAt: 1 } as never;
    const on = SettingsSchema.parse({ channels: { push: { enabled: true } } });
    expect(
      await deliverPush({ getSettings: () => on, store, fetchImpl: fetchSpy as never }, row),
    ).toMatchObject({ sent: 0, skipped: "none" });
    const off = SettingsSchema.parse({});
    expect(
      await deliverPush({ getSettings: () => off, store, fetchImpl: fetchSpy as never }, row),
    ).toMatchObject({ sent: 0, skipped: "disabled" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("C26 Telegram without a token, or without a chat, sends nothing", async () => {
    const fetchSpy = vi.fn();
    const noToken = await sendTelegramMessage({
      token: "",
      chatId: "1",
      text: "x",
      fetchImpl: fetchSpy as never,
    });
    const noChat = await sendTelegramMessage({
      token: "t",
      chatId: "",
      text: "x",
      fetchImpl: fetchSpy as never,
    });
    expect(noToken.ok).toBe(false);
    expect(noChat.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("C26 the dependency audit of the doctor does not run npm when MORDOMO_SKIP_NPM_AUDIT=1, even where a lockfile is present", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "legal-audit-"));
    dirs.push(home);
    fs.writeFileSync(path.join(home, "package-lock.json"), "{}");
    const before = process.env.MORDOMO_SKIP_NPM_AUDIT;
    process.env.MORDOMO_SKIP_NPM_AUDIT = "1";
    try {
      const check = await npmAuditCheck(home);
      expect(check.status).toBe("skip");
      expect(check.detail).toBe("Skipped (MORDOMO_SKIP_NPM_AUDIT=1)");
    } finally {
      if (before === undefined) delete process.env.MORDOMO_SKIP_NPM_AUDIT;
      else process.env.MORDOMO_SKIP_NPM_AUDIT = before;
    }
  });

  it("C26 the privacy policy says each of these is off by default and names the setting", () => {
    for (const setting of [
      "updates.check",
      "channels.telegram.enabled",
      "channels.push.enabled",
      "routines.allowWebhooks",
      "marketplace.registries",
      "settings.connectors.allowedCommands",
      "MORDOMO_SKIP_NPM_AUDIT",
    ])
      expect(privacy, setting).toContain(setting);
  });
});

// ---- C27 --------------------------------------------------------------------------------------------------------------

/** Packages whose job is to report what users do or what fails: any of them in the lockfile is telemetry on its way in. */
const TELEMETRY_PACKAGES: RegExp[] = [
  /^@?sentry([-/]|$)/,
  /^posthog/,
  /^mixpanel/,
  /^@segment\//,
  /^analytics-node$/,
  /^@amplitude\//,
  /^amplitude/,
  /^dd-trace$/,
  /^datadog/,
  /^newrelic$/,
  /^@bugsnag\//,
  /^bugsnag/,
  /^rollbar/,
  /^logrocket/,
  /^(react-)?ga4?$|^react-ga|^universal-analytics$|^gtag/,
  /^applicationinsights$/,
  /^@opentelemetry\/exporter/,
  /^matomo/,
  /^plausible/,
  /^fullstory|^@fullstory\//,
  /^hotjar|^react-hotjar/,
  /^raygun/,
  /^honeybadger|^@honeybadger-io\//,
  /^appsignal|^@appsignal\//,
  /^elastic-apm-node$|^@elastic\/apm/,
  /^statsig|^@statsig\//,
  /^rudder|^@rudderstack\//,
  /^countly/,
  /^snowplow|^@snowplow\//,
  /^@vercel\/analytics$/,
  /^heap-/,
];

describe("C27 the product has no telemetry", () => {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8")) as {
    packages: Record<string, unknown>;
  };
  const names = Object.keys(lock.packages)
    .filter((k) => k.includes("node_modules/"))
    .map((k) => k.slice(k.lastIndexOf("node_modules/") + "node_modules/".length));

  it("C27 the detector knows the packages it is about (self-test), at least 24 patterns", () => {
    expect(TELEMETRY_PACKAGES.length).toBeGreaterThanOrEqual(24);
    for (const name of [
      "@sentry/node",
      "posthog-js",
      "mixpanel-browser",
      "@segment/analytics-next",
      "@amplitude/analytics-browser",
      "dd-trace",
      "react-ga4",
      "@opentelemetry/exporter-trace-otlp-http",
      "@bugsnag/js",
      "logrocket",
    ])
      expect(
        TELEMETRY_PACKAGES.some((re) => re.test(name)),
        name,
      ).toBe(true);
    for (const name of [
      "react",
      "fastify",
      "better-sqlite3",
      "@radix-ui/react-dialog",
      "analytics-free-thing",
    ])
      expect(
        TELEMETRY_PACKAGES.some((re) => re.test(name)),
        name,
      ).toBe(false);
  });

  it("C27 no package of the lockfile, distributed or build tool, is an analytics, error-reporting or tracking package", () => {
    expect(names.length).toBeGreaterThan(600);
    expect(names.filter((n) => TELEMETRY_PACKAGES.some((re) => re.test(n)))).toEqual([]);
  });

  it("C27 the sweep finds no beacon, no WebSocket, no XMLHttpRequest, no curl and no wget in the product", () => {
    const kinds = new Set(realScan.sites.map((s) => s.kind));
    for (const kind of ["beacon", "websocket", "xhr", "webtransport", "program:curl", "program:wget"])
      expect(kinds.has(kind), kind).toBe(false);
  });

  it("C27 no setting, default or schema, has a name with telemetry, analytics or crash in it", () => {
    const keys: string[] = [];
    const walk = (value: unknown, prefix: string) => {
      if (value && typeof value === "object" && !Array.isArray(value))
        for (const [k, v] of Object.entries(value)) {
          keys.push(`${prefix}${k}`);
          walk(v, `${prefix}${k}.`);
        }
    };
    walk(SettingsSchema.parse({}), "");
    expect(keys.length).toBeGreaterThan(50);
    expect(keys.filter((k) => /telemetry|analytics|crash/i.test(k))).toEqual([]);
    const schema = fs
      .readFileSync(path.join(ROOT, "contracts", "src", "settings.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(schema).not.toMatch(/telemetry|analytics|crash/i);
  });

  it("C27 no file of the product speaks of a license key, an activation code or a product key", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) {
          if (!["node_modules", "dist"].includes(d.name)) walk(p);
        } else if (/\.(ts|tsx|mjs|js)$/.test(d.name) && !/\.test\./.test(d.name)) {
          const text = fs.readFileSync(p, "utf8");
          if (/licen[sc]e[-_ ]?key|activation[-_ ]?(key|code)|product[-_ ]?key/i.test(text))
            hits.push(path.relative(ROOT, p));
        }
      }
    };
    for (const dir of ["core/src", "apps/api/src", "apps/command-centre/src", "contracts/src", "adapters"])
      walk(path.join(ROOT, dir));
    expect(hits).toEqual([]);
  });
});
