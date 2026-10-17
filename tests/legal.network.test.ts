import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { SettingsSchema } from "../contracts/src/index.js";
import { deliverPush } from "../core/src/channels/pushChannel.js";
import { sendTelegramMessage } from "../core/src/channels/telegram.js";
import { npmAuditCheck } from "../apps/api/src/doctor.js";
import { UpdateChecker } from "../apps/api/src/updates.js";
import { defaultFetcher } from "../core/src/skills/registry.js";
import {
  ConnectorSchema,
  EventBus,
  RoutineScheduler,
  RoutineStore,
  RunManager,
  SettingsStore,
  SkillCatalog,
  fetchConnectorData,
  openDb,
  type DataMapping,
} from "@mordomo/core/internal";
import { makeTempHome } from "./helpers.js";

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
  scanText: (text: string, fileName?: string) => { points: Map<string, number>; hosts: Set<string> };
  withoutRustTests: (text: string) => string;
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
  defaultState?: string;
  gate?: { setting?: string; seeds?: string };
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
    expect(read(`const a = "curly"; const b = "npm install"; const c = "curl -s";`).points).toEqual({});
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
const GOOD_SOURCE = `export const NS = "http://www.w3.org/2000/svg";\nexport const HOST = "api.example.net";\nexport const go = () => fetch("https://" + HOST + "/x");\n`;
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

  it("C24 the real code has the network points the research found (37, plus the 4 of the desktop shell: distribuicao, plus the 2 of cerebro-v2: the embeddings request and the local vector package) and the hosts the policy names", () => {
    const found = realScan;
    expect(found.sites).toHaveLength(43);
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
    const res = check({ "core/src/a.ts": GOOD_SOURCE });
    expect(res.code, res.err).toBe(0);
  });

  it("C24 a policy that cannot be read, and a flag that does not exist, exit 2", () => {
    const dir = project({ "core/src/a.ts": GOOD_SOURCE });
    let err = "";
    expect(scan.main(["--check", "--root", dir], { out: () => {}, err: (s) => (err += s) })).toBe(2);
    expect(err).toContain("network-scan:");
    expect(scan.main(["--nope"], { out: () => {}, err: () => {} })).toBe(2);
  });

  it("C44 as a process (what `npm run network:scan -- --check` is): exit 0 when they agree, 1 when they disagree, 2 when the policy or a flag is wrong", () => {
    const cli = (...args: string[]) =>
      spawnSync(process.execPath, [SCAN, ...args], { cwd: os.tmpdir(), encoding: "utf8" });
    const good = cli("--check", "--root", project({ "core/src/a.ts": GOOD_SOURCE }, GOOD_POLICY()));
    expect(good.status, good.stderr).toBe(0);
    const moved = cli(
      "--check",
      "--root",
      project({ "core/src/a.ts": GOOD_SOURCE + `export const two = () => fetch(HOST);\n` }, GOOD_POLICY()),
    );
    expect(moved.status).toBe(1);
    expect(moved.stderr).toContain("the policy says ×1, the code has ×2");
    const noPolicy = cli("--check", "--root", project({ "core/src/a.ts": GOOD_SOURCE }));
    expect(noPolicy.status).toBe(2);
    expect(noPolicy.stderr).toContain("network-scan:");
    expect(cli("--nope").status).toBe(2);
  });
});

// ---- C25 --------------------------------------------------------------------------------------------------------------

describe("C25 the privacy policy repeats the network policy", () => {
  const ROLES = ["local", "contact", "user-defined", "cli", "link", "build"];

  it("C25 there are 18 entries (15, plus the desktop updater and the signing timestamp: distribuicao, plus the embeddings endpoint: cerebro-v2), ids are unique, roles are the six, and no site names an id that is missing", () => {
    expect(policy.hosts).toHaveLength(18);
    const ids = policy.hosts.map((h) => h.id);
    expect(new Set(ids).size).toBe(18);
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

// ---- C52 --------------------------------------------------------------------------------------------------------------

describe("C52 the embeddings entry says what it sends", () => {
  const entry = policy.hosts.find((h) => h.id === "embeddings")!;

  it("C52 it names both kinds of text that leave the machine (the files it indexes and the question of each search), the header and the shape of the variable name, in the policy and in PRIVACY.md", () => {
    expect(entry).toBeDefined();
    for (const source of [entry.data, privacy]) {
      // the indexed files: every .md and .txt of the folders indexed, not only notes
      expect(source).toContain("o texto de cada arquivo `.md` e `.txt` indexado");
      expect(source).toContain("de qualquer pasta indexada e não só das notas do MordomoOS");
      // the question: the most personal string of the feature, one request per search, in the two modes that use vectors
      expect(source).toContain("a cada busca em modo `auto` ou `semantic`");
      expect(source).toContain("a pergunta digitada");
      expect(source).toContain("numa requisição por busca");
      expect(source).toContain("seja a busca da tela, do CLI, do MCP ou de um dispositivo pareado");
      // the key: the value of ANY variable the owner names goes to the endpoint, so the name is held to a shape
      expect(source).toContain(
        "`Authorization: Bearer` com o valor da variável de ambiente cujo nome o dono escreveu",
      );
      expect(source).toContain("qualquer que seja, vai a esse endereço em toda requisição");
      expect(source).toContain("letras maiúsculas, dígitos e `_` (até 64) e nunca começa com `MORDOMO_`");
      expect(source).toContain("sem nome nenhum (o padrão) não há cabeçalho");
    }
    // and it no longer says that only notes are sent
    expect(entry.data).not.toContain("o texto de cada nota indexada");
  });

  it("C52 the sentence about the question is true of the code: the request is made in the search path, once, with the typed text", () => {
    const semantic = fs.readFileSync(path.join(ROOT, "core/src/memory/semantic.ts"), "utf8");
    const embeds = semantic.match(/provider\.embed\(\[question\]/g) ?? [];
    expect(embeds).toHaveLength(1);
    // (the behaviour is proved in memory.semantic.test.ts: a search in auto and semantic sends the question, text does not)
    expect(semantic).toContain("const question = filters.query.trim();");
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
    for (const kind of [
      "beacon",
      "websocket",
      "xhr",
      "webtransport",
      "program:wget",
      "program:ssh",
      "program:scp",
    ])
      expect(kinds.has(kind), kind).toBe(false);
    // The one curl is an instruction to the agent, aimed at the local service.
    expect(realScan.sites.filter((s) => s.kind === "program:curl").map((s) => s.file)).toEqual([
      "skills/recall/SKILL.md",
    ]);
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

// ---- round 1 ------------------------------------------------------------------------------------------------------------

const defaultSettings = SettingsSchema.parse({}) as unknown as Record<string, unknown>;
const at = (obj: unknown, dotted: string): unknown =>
  dotted
    .split(".")
    .reduce<unknown>(
      (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
      obj,
    );

describe("C34 what the policy says about each destination is tied to the real defaults and to the code's own roles", () => {
  const WORD: Record<string, RegExp> = {
    on: /^ligado/,
    off: /^desligado/,
    none: /^nenhum/,
    never: /^nunca/,
    mixed: /^\(1\)/,
  };

  for (const entry of policy.hosts)
    it(`C34 ${entry.id}: the default it declares is the one the code has`, () => {
      expect(Object.keys(WORD), entry.id).toContain(entry.defaultState);
      expect(entry.default, entry.id).toMatch(WORD[entry.defaultState!]!);
      // A destination the product contacts on its own initiative may only be "on" if it is the product's own service,
      // a CLI the person chose, or the npm audit that only runs when the diagnostic is asked for.
      if (entry.role === "contact" || entry.role === "user-defined")
        expect(["off", "none"], entry.id).toContain(entry.defaultState);
      if (entry.role === "link" || entry.role === "build") expect(entry.defaultState, entry.id).toBe("never");
      if (entry.defaultState === "on") expect(["local", "cli"], entry.id).toContain(entry.role);
      if (entry.gate?.setting) {
        const value = at(defaultSettings, entry.gate.setting);
        expect(
          value === false || (Array.isArray(value) && value.length === 0),
          `${entry.id} ${entry.gate.setting} = ${JSON.stringify(value)}`,
        ).toBe(true);
      } else if (entry.defaultState === "off") {
        throw new Error(`${entry.id} is "off" and names no setting that turns it off`);
      }
    });

  it("C34 a destination that says 'ligado' on a gate the code has off would fail (self-test: the real values)", () => {
    expect(at(defaultSettings, "updates.check")).toBe(false);
    expect(at(defaultSettings, "channels.telegram.enabled")).toBe(false);
    expect(at(defaultSettings, "channels.push.enabled")).toBe(false);
    expect(at(defaultSettings, "routines.allowWebhooks")).toBe(false);
    expect(at(defaultSettings, "marketplace.registries")).toEqual([]);
    expect(at(defaultSettings, "connectors.allowedCommands")).toEqual([]);
    expect(at(defaultSettings, "no.such.setting")).toBeUndefined();
  });

  it("C34 the connectors the product ships are all 'not_configured' and none carries a URL, so 'nenhum conector vem configurado' is true", () => {
    const dir = path.join(ROOT, "connectors");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const f of files) {
      const c = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as {
        kind: string;
        status: string;
        dataMapping?: { url?: string | null } | null;
      };
      if (c.kind === "micro-app") continue; // Pixel Studio is a built-in screen, not a connector to a service
      expect(c.status, f).toBe("not_configured");
      expect(c.dataMapping?.url ?? null, f).toBeNull();
    }
    expect(
      policy.hosts
        .filter((h) => h.gate?.seeds)
        .map((h) => h.id)
        .sort(),
    ).toEqual(["connector-api", "mcp-connectors"]);
  });

  it("C34 a site that opens a connection points only at an entry the product contacts (not link, not cli, not an implicit entry with an address)", () => {
    const byId = new Map(policy.hosts.map((h) => [h.id, h]));
    for (const site of policy.sites) {
      const opens = /^(fetch|eventsource|module:(dns|https?|http2|net|tls)|dynamic)/.test(site.kind);
      for (const id of site.hosts) {
        const h = byId.get(id)!;
        if (opens && /^(fetch|eventsource)/.test(site.kind))
          expect(
            ["contact", "user-defined", "local", "build"],
            `${site.file} ${site.kind} -> ${id}`,
          ).toContain(h.role);
      }
    }
    for (const h of policy.hosts) {
      // "implicit" means "no address in the code": an entry that names an address cannot be implicit, whatever its role.
      if (h.implicit) expect(h.match, h.id).toEqual([]);
      if (h.role === "cli") expect(h.match, h.id).toEqual([]);
      if (h.role === "link")
        for (const site of policy.sites) expect(site.hosts, `${site.file} -> ${h.id}`).not.toContain(h.id);
    }
  });

  it("C34 the real fetch sites are not pointed at a 'link' entry: GitHub is two entries, the contacted one is 'contact' (Y01)", () => {
    const releases = policy.hosts.find((h) => h.id === "github-releases")!;
    expect(releases.role).toBe("contact");
    const site = policy.sites.find((s) => s.file === "apps/api/src/updates.ts" && s.kind === "fetch")!;
    expect(site.hosts).toEqual(["github-releases"]);
  });
});

describe("C35 the numbers and states in the privacy text are the code's, proved where the code does them", () => {
  const dirsToClean: Array<() => void> = [];
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    for (const c of dirsToClean.splice(0)) c();
  });

  it("C35 the version check keeps its answer six hours, not five and not seven (privacy text: seis horas)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T00:00:00Z"));
    const calls: string[] = [];
    const checker = new UpdateChecker("0.8.0", async (url) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ tag_name: "v0.8.0", html_url: "https://example.test/r" }),
      };
    });
    await checker.check();
    vi.setSystemTime(new Date("2026-10-11T05:59:00Z"));
    await checker.check();
    expect(calls).toHaveLength(1);
    vi.setSystemTime(new Date("2026-10-11T06:01:00Z"));
    await checker.check();
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe("https://api.github.com/repos/tvpl/agentic-os/releases/latest");
    expect(policy.hosts.find((h) => h.id === "github-releases")!.data).toContain("seis horas");
    expect(privacy).toContain("em cache por seis horas");
  });

  it("C35 the version check sends the user-agent 'mordomo-os' and nothing that names the installation", async () => {
    let init: { headers?: Record<string, string> } | undefined;
    await new UpdateChecker("0.8.0", async (_url, i) => {
      init = i;
      return { ok: true, status: 200, json: async () => ({ tag_name: "v0.8.0" }) };
    }).check(true);
    expect(init?.headers).toEqual({ accept: "application/vnd.github+json", "user-agent": "mordomo-os" });
    const data = policy.hosts.find((h) => h.id === "github-releases")!.data;
    expect(data).toContain("`user-agent: mordomo-os`");
    expect(data).not.toMatch(/nenhum identificador do produto/);
  });

  function scheduler() {
    const home = makeTempHome();
    dirsToClean.push(home.cleanup);
    const { db } = openDb(home.paths);
    dirsToClean.push(() => db.close());
    const bus = new EventBus();
    const settings = new SettingsStore(home.paths, bus);
    const runs = new RunManager(db, home.paths, () => settings.load(), (() => null) as never, { bus });
    const sched = new RoutineScheduler(
      db,
      home.paths,
      new RoutineStore(home.paths),
      runs,
      new SkillCatalog(home.paths),
      () => settings.load(),
      { bus },
    );
    dirsToClean.push(() => sched.stop());
    return { sched, settings };
  }
  const run = (id: string) => ({ id, status: "done", durationMs: 5, artifacts: [], createdAt: 1 });
  const hook = { id: "hook", name: "Hook", webhookUrl: "https://hooks.example.test/in", delivery: "webhook" };
  type Poster = { postWebhook: (r: unknown, f: unknown, l: unknown, summary: string) => Promise<void> };

  it("C35 with routines.allowWebhooks off the scheduler sends NOTHING, even to a routine that already has a webhook (the guard at the send)", async () => {
    const fetchSpy = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchSpy);
    const { sched } = scheduler();
    await (sched as unknown as Poster).postWebhook(hook, run("r1"), run("r1"), "a summary");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("C35 with it on, one POST goes to the routine's own URL and the summary is cut at 4000 characters (privacy text: 4000)", async () => {
    const fetchSpy = vi.fn(
      async (_url: string, _init: { body: string; method: string }) => new Response("ok"),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const { sched, settings } = scheduler();
    const cfg = settings.load();
    settings.save({ ...cfg, routines: { ...cfg.routines, allowWebhooks: true } });
    await (sched as unknown as Poster).postWebhook(hook, run("r1"), run("r1"), "x".repeat(40_000));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://hooks.example.test/in");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect((body.summary as string).length).toBe(4000);
    expect(Object.keys(body).sort()).toEqual([
      "artifacts",
      "durationMs",
      "firedAt",
      "name",
      "routineId",
      "runId",
      "status",
      "summary",
    ]);
    expect(policy.hosts.find((h) => h.id === "webhook")!.data).toContain("até 4000 caracteres");
    expect(privacy).not.toMatch(/40\.?000/);
  });

  it("C35 the skill registry and the connector API follow no redirect (privacy text: sem redirecionamento)", async () => {
    const seen: Array<{ redirect?: string; method?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: { redirect?: string }) => (seen.push(init), new Response("{}"))),
    );
    await defaultFetcher("https://registry.example.test/index.json");
    expect(seen[0]!.redirect).toBe("error");
    const mapping = {
      transport: "api",
      command: null,
      args: [],
      env: [],
      url: "https://api.example.test/items",
      headers: {},
      tools: {
        list: { name: "GET", args: {}, parse: "json", path: "items", fields: { id: "id", title: "name" } },
      },
      install: null,
      setup: [],
    } as unknown as DataMapping;
    const connector = ConnectorSchema.parse({
      id: "x",
      name: "X",
      kind: "api",
      origin: "t",
      maintainer: "t",
      dataMapping: mapping,
    });
    const fetchImpl = vi.fn(
      async (_u: string, init: { redirect?: string; method?: string }) => (
        seen.push(init),
        new Response(JSON.stringify({ items: [] }))
      ),
    );
    await fetchConnectorData(connector, { fetchImpl: fetchImpl as never });
    expect(seen[1]).toMatchObject({ redirect: "error", method: "GET" });
    for (const id of ["skill-registry", "connector-api"])
      expect(policy.hosts.find((h) => h.id === id)!.data, id).toContain("sem redirecionamento");
    expect(privacy).not.toMatch(/seguindo redirecionamento/);
  });

  it("C35 the push subject that reaches the push service is the default the policy names", () => {
    const subject = at(defaultSettings, "channels.push.subject");
    expect(subject).toBe("mailto:mordomo@localhost");
    expect(policy.hosts.find((h) => h.id === "push-browsers")!.data).toContain(`\`${String(subject)}\``);
  });

  it("C35 the Telegram token goes in the URL, as the privacy text says", () => {
    const telegram = fs.readFileSync(path.join(ROOT, "core/src/channels/telegram.ts"), "utf8");
    expect(telegram).toContain("`${TELEGRAM_API_ORIGIN}/bot${encodeURIComponent(token)}/sendMessage`");
    expect(policy.hosts.find((h) => h.id === "telegram")!.data).toContain("o token do bot vai na URL");
  });
});

describe("C39 the scanner reads the evasions it can decide, and the text says what it cannot", () => {
  it("C39 a global fetch by a string key, a global object by a variable key, and process.binding are points", () => {
    expect(read(`globalThis["fetch"](u);`).points).toEqual({ fetch: 1 });
    expect(read(`window["WebSocket"];`).points).toEqual({ websocket: 1 });
    expect(read(`globalThis[name](u);`).points).toEqual({ "dynamic-global": 1 });
    expect(read(`process.binding("tcp_wrap");`).points).toEqual({ "process-binding": 1 });
    expect(read(`process["binding"]("tcp_wrap");`).points).toEqual({ "process-binding": 1 });
  });

  it("C39 a module named by a variable, createRequire and a URL module are points; a literal local module is not", () => {
    expect(read(`const m = await import(name);`).points).toEqual({ "module:dynamic": 1 });
    expect(read(`const m = require(name);`, "x.cjs").points).toEqual({ "module:dynamic": 1 });
    expect(read(`const r = createRequire(import.meta.url);`).points).toEqual({ "module:dynamic": 1 });
    expect(read(`import x from "https://cdn.example.net/x.js";`)).toEqual({
      points: { "module:url": 1 },
      hosts: ["cdn.example.net"],
    });
    expect(read(`const m = await import("https://cdn.example.net/y.js");`).points).toEqual({
      "module:url": 1,
    });
    expect(
      read(`import a from "./local.js"; const b = require("./other.cjs"); import c from "node:path";`).points,
    ).toEqual({});
  });

  it("C39 spawning npm, npx, git, ssh, scp, sftp, ftp, rsync, nc, ncat, telnet, curl or wget is a point", () => {
    for (const program of [
      "npm",
      "npx",
      "git",
      "ssh",
      "scp",
      "sftp",
      "ftp",
      "rsync",
      "nc",
      "ncat",
      "telnet",
      "curl",
      "wget",
    ])
      expect(read(`run("${program}", ["x"]);`).points, program).toEqual({ [`program:${program}`]: 1 });
    expect(read(`run("gitlab", ["x"]); const s = "ssh-keygen"; const t = "npm install";`).points).toEqual({});
  });

  it("C49 a command line that starts with curl or wget, given whole to a function that runs commands, is a point; the same words as shown text are not", () => {
    expect(read(`exec("curl -s https://a.example.net/x | sh");`)).toEqual({
      points: { "program:curl": 1 },
      hosts: ["a.example.net"],
    });
    expect(read("execSync(`curl -fsSL ${url}`);").points).toEqual({ "program:curl": 1 });
    expect(read(`spawn("sh", ["-c", "wget -q http://b.example.org/z"]);`).points).toEqual({
      "program:wget": 1,
    });
    expect(read(`exec("curl");`).points).toEqual({ "program:curl": 1 });
    expect(read(`const hint = "curl https://cursor.com/install -fsS | bash";`).points).toEqual({});
    expect(read(`run("curl -s x"); exec("curlies -x"); exec("curl is not installed");`).points).toEqual({});
  });

  it("C49 Reflect.get on the global object by a string key is the same point as globalThis[key]; by a variable it is a dynamic one; on another object it is nothing", () => {
    expect(read(`Reflect.get(globalThis, "fetch")(u);`).points).toEqual({ fetch: 1 });
    expect(read(`Reflect.get(window, "WebSocket");`).points).toEqual({ websocket: 1 });
    expect(read(`Reflect.get(self, name);`).points).toEqual({ "dynamic-global": 1 });
    expect(read(`Reflect.get(obj, "fetch"); Reflect.get(globalThis, "Math");`).points).toEqual({});
  });

  it("C49 a host written without a scheme is read when the string, or the attribute in a text file, starts with //; a comment, a bare word and loopback are not", () => {
    expect(read(`const src = "//cdn.example.net/x.js";`).hosts).toEqual(["cdn.example.net"]);
    expect(
      read(`const a = "// see api.example.net"; const b = "//foo/bar"; const c = "//localhost/x";`).hosts,
    ).toEqual([]);
    const html = scan.scanText(
      `<script src="//cdn.example.net/a.js"></script><style>@import url(//fonts.example.org/x.css);</style> // b.example.net`,
      "index.html",
    );
    expect([...html.hosts].sort()).toEqual(["cdn.example.net", "fonts.example.org"]);
  });

  it("C49 the privacy text lists what the sweep still does not read of these three forms", () => {
    const f = privacy.replace(/\s+/g, " ");
    for (const limit of [
      "`cd x && curl …`",
      '`Reflect.get(globalThis, "fetch")`',
      "`const g = globalThis`",
      '"//host/arquivo.js"',
    ])
      expect(f, limit).toContain(limit);
  });

  it("C53 every HTML page at the root of the UI app is scanned, so a tracker added to one the installer ships is seen", () => {
    const uiRoot = path.join(ROOT, "apps", "command-centre");
    const pages = fs.readdirSync(uiRoot).filter((f) => f.endsWith(".html"));
    expect(pages).toContain("index.html");
    expect(pages).toContain("gallery.html");
    for (const page of pages) expect(scan.SCAN_DIRS, page).toContain(`apps/command-centre/${page}`);
  });

  it("C39 an address as a bare IP is a host (public or private), a malformed one and a version string are not", () => {
    expect(read(`const a = "203.0.113.9"; const b = "10.1.2.3:8080";`).hosts).toEqual([
      "10.1.2.3",
      "203.0.113.9",
    ]);
    expect(read(`const a = "http://198.51.100.7:8080/x";`).hosts).toEqual(["198.51.100.7"]);
    expect(read(`const a = "256.1.1.1"; const b = "1.2.3"; const c = "0.8.0.1.5";`).hosts).toEqual([]);
  });

  it("C39 a dotted string named like an address is a host whatever it ends in; the same string unnamed, and an i18n key, are not", () => {
    expect(read(`const API_HOST = "relay.corp";`).hosts).toEqual(["relay.corp"]);
    expect(read(`const cfg = { origin: "svc.internal.zzz", server: "a.b.local" };`).hosts).toEqual([
      "a.b.local",
      "svc.internal.zzz",
    ]);
    expect(read(`const k = "svc.internal.zzz"; const key = "scene.routines.in";`).hosts).toEqual([]);
    expect(read(`const x = "api.example.xyz"; const y = "api.example.de";`).hosts).toEqual([
      "api.example.de",
      "api.example.xyz",
    ]);
  });

  it("C39 text files: curl and wget in prose or a script, and the command of a connector, are points; a URL is a host", () => {
    const md = scan.scanText(
      "Run `curl -s http://x.example.net/a` then\n  wget -q y\nbut curlies are not.",
      "SKILL.md",
    );
    expect(Object.fromEntries(md.points)).toEqual({ "program:curl": 1, "program:wget": 1 });
    expect([...md.hosts]).toEqual(["x.example.net"]);
    const json = scan.scanText('{ "dataMapping": { "command": "npx", "args": ["-y", "p"] } }', "c.json");
    expect(Object.fromEntries(json.points)).toEqual({ "program:npx": 1 });
    expect(Object.fromEntries(scan.scanText('{ "command": "/usr/bin/git" }', "c.json").points)).toEqual({
      "program:git": 1,
    });
    expect(Object.fromEntries(scan.scanText('{ "command": "node" }', "c.json").points)).toEqual({});
    expect(Object.fromEntries(scan.scanText("curl x", "notes.txt").points)).toEqual({});
  });

  it("C39 in the real tree the connectors' npx, the skill's curl and the doctor's npm are counted, and the policy knows them", () => {
    const kinds = realScan.sites.map((s) => `${s.file} ${s.kind}`);
    for (const k of [
      "connectors/calendar-google.json program:npx",
      "connectors/email-gmail.json program:npx",
      "skills/recall/SKILL.md program:curl",
      "apps/api/src/doctor.ts program:npm",
    ])
      expect(kinds, k).toContain(k);
    expect(scan.compare(realScan, policy)).toEqual([]);
  });

  it("C39 an ignored host is ignored only in the files its entry names, and an ignored host the code no longer has is stale", () => {
    const pol = GOOD_POLICY() as Policy & {
      ignored: Array<{ match: string; reason: string; files?: string[] }>;
    };
    pol.ignored = [{ match: "www.w3.org", reason: "namespace", files: ["core/src/b.ts"] }];
    const found = (files: string[]) => ({
      sites: [{ file: "core/src/a.ts", kind: "fetch", count: 1 }],
      hosts: [
        { host: "api.example.net", files: ["core/src/a.ts"] },
        { host: "www.w3.org", files },
      ],
    });
    expect(scan.compare(found(["core/src/b.ts"]), pol)).toEqual([]);
    expect(scan.compare(found(["core/src/c.ts"]), pol).join("\n")).toContain("new host: www.w3.org");
    expect(scan.compare({ sites: found([]).sites, hosts: [found([]).hosts[0]!] }, pol).join("\n")).toContain(
      "stale ignored host: www.w3.org",
    );
  });

  it("C46 an ignored host does not cover a look-alike: evil-www.w3.org and evilexample.com are new hosts while www.w3.org and example.com are ignored", () => {
    const pol = GOOD_POLICY();
    pol.ignored = [
      { match: "www.w3.org", reason: "namespace" },
      { match: "example.com", reason: "example" },
    ];
    const found = (hosts: string[]) => ({
      sites: [{ file: "core/src/a.ts", kind: "fetch", count: 1 }],
      hosts: [
        { host: "api.example.net", files: ["core/src/a.ts"] },
        ...hosts.map((host) => ({ host, files: ["core/src/a.ts"] })),
      ],
    });
    expect(scan.compare(found(["www.w3.org", "example.com"]), pol)).toEqual([]);
    const lookalikes = scan.compare(
      found(["www.w3.org", "example.com", "evil-www.w3.org", "evilexample.com"]),
      pol,
    );
    expect(lookalikes).toHaveLength(2);
    expect(lookalikes.join("\n")).toContain("new host: evil-www.w3.org");
    expect(lookalikes.join("\n")).toContain("new host: evilexample.com");
  });

  it("C39 the privacy text names the npx download from the npm registry and lists what the sweep cannot see; it no longer claims a test that catches every network point", () => {
    const f = privacy.replace(/\s+/g, " ");
    expect(f).toContain("`npx -y <pacote>`");
    expect(f).toContain("registry.npmjs.org");
    expect(f).toContain("O que a varredura não vê");
    for (const limit of [
      "endereço montado em tempo de execução",
      "`eval`",
      "texto em prosa",
      "código fora das pastas que ela lê",
    ])
      expect(f, limit).toContain(limit);
    expect(f).toContain("reconhecido pela varredura");
    expect(f).not.toContain("nenhum ponto de rede que não esteja na lista acima e");
    const mcp = policy.hosts.find((h) => h.id === "mcp-connectors")!;
    expect(mcp.trigger).toContain("npx -y");
    const npm = policy.hosts.find((h) => h.id === "npm-registry")!;
    expect(npm.trigger).toContain("npx -y <pacote>");
    expect(npm.data).toContain("o nome do pacote do conector");
  });
});

describe("C57 the scan of the desktop shell's Rust and Cargo files has no blind spot of its own", () => {
  const kinds = (text: string, file: string) => Object.fromEntries(scan.scanText(text, file).points);

  it("C57 production code after a #[cfg(test)] module is read; the test module itself, with braces in strings and comments, is not", () => {
    const source = [
      "fn first() {}",
      "#[cfg(test)]",
      "mod tests {",
      "    fn t<'a>(x: &'a str) { let s = \"}\"; let c = '}'; let r = r#\"} \"#; /* } */ // }",
      '        std::net::TcpStream::connect("test.example.com:1").unwrap();',
      "    }",
      "}",
      "fn production() {",
      '    std::net::UdpSocket::bind("0.0.0.0:0").unwrap();',
      "}",
      "#[cfg(test)]",
      "use std::net::TcpStream;",
      "#[cfg(test)]",
      "fn only_in_tests() { TcpStream::connect_timeout(todo!(), todo!()); }",
      "",
    ].join("\n");
    expect(kinds(source, "apps/desktop/shell-core/src/x.rs")).toEqual({ "rust:net": 1 });
    expect(scan.scanText(source, "x.rs").hosts.has("test.example.com")).toBe(false);
    // braces that never balance are not cut: the scan reads more, never less
    expect(kinds("#[cfg(test)]\nmod t { fn a() {\nfn b() { UdpSocket::bind(x); }", "x.rs")).toEqual({
      "rust:net": 1,
    });
  });

  it("C57 #[cfg(test)] named in a comment marks nothing: the function after it is production code and is read", () => {
    const call = 'std::net::TcpStream::connect("1.2.3.4:80").unwrap();';
    for (const comment of [
      "/// Only reached outside #[cfg(test)] builds.",
      "//! see #[cfg(test)] below",
      "// #[cfg(test)]",
      "    /// #[cfg(test)] mod tests { is another file",
    ])
      expect(kinds(`${comment}\nfn real() { ${call} }\n`, "x.rs"), comment).toEqual({ "rust:net": 1 });
    // control: the attribute as code, indented or on the same line as its item, still hides what it marks
    expect(kinds(`    #[cfg(test)]\n    fn only_in_tests() { ${call} }\n`, "x.rs")).toEqual({});
    expect(kinds(`#[cfg(test)] mod tests { fn t() { ${call} } }\nfn real() { ${call} }\n`, "x.rs")).toEqual({
      "rust:net": 1,
    });
  });

  it("C57 a network crate is seen as a table, in a target table and under another name", () => {
    expect(kinds('reqwest = "0.12"\n', "apps/desktop/Cargo.toml")).toEqual({ "rust:crate:reqwest": 1 });
    expect(kinds('[dependencies.reqwest]\nversion = "0.12"\n', "apps/desktop/src-tauri/Cargo.toml")).toEqual({
      "rust:crate:reqwest": 1,
    });
    expect(kinds("[target.'cfg(unix)'.dependencies.ureq]\nversion = \"2\"\n", "Cargo.toml")).toEqual({
      "rust:crate:ureq": 1,
    });
    expect(kinds('http-client = { package = "hyper", version = "1" }\n', "Cargo.toml")).toEqual({
      "rust:crate:hyper": 1,
    });
    expect(kinds("[dependencies.tauri-plugin-updater]\noptional = true\n", "Cargo.toml")).toEqual({
      "rust:crate:tauri-plugin-updater": 1,
    });
    // the dotted form is one dependency however many keys spell it, once per section
    expect(kinds("[dependencies]\nreqwest.workspace = true\n", "apps/desktop/Cargo.toml")).toEqual({
      "rust:crate:reqwest": 1,
    });
    expect(
      kinds(
        '[dependencies]\nreqwest.version = "1"\nreqwest.features = ["json"]\nureq.version = "2"\n',
        "Cargo.toml",
      ),
    ).toEqual({ "rust:crate:reqwest": 1, "rust:crate:ureq": 1 });
    expect(kinds('tauri-plugin-updater.version = "2"\n', "Cargo.toml")).toEqual({
      "rust:crate:tauri-plugin-updater": 1,
    });
    expect(
      kinds('serde.version = "1"\nreqwest-like.workspace = true\n# reqwest.workspace = true\n', "Cargo.toml"),
    ).toEqual({});
    // once per section, not once per file: the same crate spelled dotted in two sections is two dependencies
    const twice = '[dependencies]\nreqwest.version = "1"\n[dev-dependencies]\nreqwest.version = "1"\n';
    expect(kinds(twice, "apps/desktop/Cargo.toml")).toEqual({ "rust:crate:reqwest": 2 });
    expect(
      kinds(`${twice}[target.'cfg(unix)'.dependencies]\nreqwest.features = ["json"]\n`, "Cargo.toml"),
    ).toEqual({ "rust:crate:reqwest": 3 });
    // a crate that is not a client, and a comment about one, are not points
    expect(
      kinds('serde = "1"\n# reqwest = "0.12"\n[dependencies.serde_json]\nversion = "1"\n', "Cargo.toml"),
    ).toEqual({});
  });

  it("C57 a network program started by name is a point, whatever its path or suffix; other programs are not", () => {
    expect(
      kinds('fn f() { Command::new("curl"); std::process::Command::new( "/usr/bin/wget.exe" ); }', "a.rs"),
    ).toEqual({ "program:curl": 1, "program:wget": 1 });
    expect(kinds('fn f() { Command::new("node"); Command::new(&payload.node); }', "a.rs")).toEqual({});
  });

  it("C57 a shell given a command that starts with curl or wget is a point; a shell running something else is not", () => {
    expect(
      kinds(
        'fn f() { Command::new("sh").arg("-c").arg("curl -s https://x.example.com/a").spawn(); }',
        "a.rs",
      ),
    ).toEqual({ "program:curl": 1 });
    expect(
      kinds(
        'fn f() { Command::new("/bin/bash").args(["-c", "wget -q http://y.example.com"]).output(); }',
        "a.rs",
      ),
    ).toMatchObject({ "program:wget": 1 });
    expect(
      kinds('fn f() { Command::new("cmd.exe").args(["/C", "curl -L https://z.example.com"]); }', "a.rs"),
    ).toMatchObject({
      "program:curl": 1,
    });
    expect(kinds('fn f() { Command::new("sh").arg("-c").arg("echo hello").spawn(); }', "a.rs")).toEqual({});
    // the statement ends at its `;`: a curl in the next one is not this shell's
    expect(
      kinds('fn f() { Command::new("sh").arg("-c").arg("true"); log("curl -s http://q"); }', "a.rs"),
    ).toEqual({});
  });

  it("C57 the statement of a shell ends at its own `;` or at the end of the block it closes, not at the next `;` of the file", () => {
    // a function whose last expression is the shell, with no `;`: what follows is another function's
    expect(
      kinds(
        'fn shell() -> Command { Command::new("sh") }\nfn other() { log("curl -s http://q"); }\n',
        "a.rs",
      ),
    ).toEqual({});
    expect(
      kinds(
        'fn shell() -> Command {\n    let mut c = Command::new("bash");\n    c\n}\nstatic HINT: &str = "wget -q http://q";\n',
        "a.rs",
      ),
    ).toEqual({});
    expect(
      kinds(
        'fn shell(c: &mut Cmd) { c.run(Command::new("sh")) }\nconst HINT: &str = "curl -s http://q";\n',
        "a.rs",
      ),
    ).toEqual({});
    // a `;` or a bracket inside a string or a comment, and a `;` inside a block argument, end nothing
    expect(
      kinds(
        'fn f() { Command::new("sh").arg("-c; )").arg("curl -s https://x.example.com").spawn(); }',
        "a.rs",
      ),
    ).toEqual({ "program:curl": 1 });
    expect(
      kinds(
        'fn f() { Command::new("sh").arg(/* a; b) */ "-c").arg("curl -s https://x.example.com").spawn(); }',
        "a.rs",
      ),
    ).toEqual({ "program:curl": 1 });
    expect(
      kinds(
        'fn f() { Command::new("sh").arg({ let c = "-c"; c }).arg("curl -s https://x.example.com").spawn(); }',
        "a.rs",
      ),
    ).toEqual({ "program:curl": 1 });
    expect(
      kinds(
        'fn f() {\n    Command::new("sh").arg("-c") // done)\n        .arg("curl -s https://x.example.com")\n        .spawn();\n}\n',
        "a.rs",
      ),
    ).toEqual({ "program:curl": 1 });
    // a statement that never ends is read to the end of the file: more, never less
    expect(kinds('fn f() { Command::new("sh").arg("curl -s https://x.example.com")', "a.rs")).toEqual({
      "program:curl": 1,
    });
  });

  it("C57 the privacy text lists what is left: a program or a macro the scan cannot name in the Rust of the shell", () => {
    const f = privacy.replace(/\s+/g, " ");
    expect(f).toContain("No que é Rust");
    expect(f).toContain("`Command::new` só é lido com o nome do programa escrito na chamada");
    // the shell form that is read, and the ones that are not
    expect(f).toContain('`Command::new("sh")` com o `curl`');
    expect(f).toContain("a dependência escrita em chave com ponto");
    // and the limits of that rule, which C57 states as "one statement": the builder in a variable, the command built at
    // run time, and the dotted key spelled another way
    expect(f).toContain("na mesma instrução");
    expect(f).toContain('`let mut c = Command::new("sh"); c.arg("-c").arg("curl …");`');
    expect(f).toContain('`"curl $URL"`, `format!("curl {}", u)`');
    expect(f).toContain('`reqwest . workspace = true`, `"reqwest".workspace = true`');
  });
});

describe("C61 the destination the Windows installer contacts is named, though it is not the product's code", () => {
  it("C61 the policy lists the WebView2 bootstrapper under `installers`, the privacy text repeats it in 4.3, and tauri.conf.json chooses that mode on purpose", () => {
    const installers = (policy as unknown as { installers: Array<Record<string, any>> }).installers;
    expect(installers.map((i) => i.id)).toEqual(["webview2-bootstrapper"]);
    const entry = installers[0]!;
    for (const field of ["label", "trigger", "default", "data"])
      expect(privacy, field).toContain(entry[field]);
    expect(privacy).toContain("### 4.3. Destinos de instaladores de terceiros");
    for (const host of entry.match as string[]) expect(privacy).toContain(host);
    // the host is in the Tauri CLI's NSIS template, not in a file the scan reads: that is why it is not in `hosts`
    expect(policy.hosts.some((h) => h.match.includes("go.microsoft.com"))).toBe(false);
    const conf = JSON.parse(
      fs.readFileSync(path.join(ROOT, "apps", "desktop", "src-tauri", "tauri.conf.json"), "utf8"),
    ) as { bundle: { windows: { webviewInstallMode: { type: string } } } };
    expect(conf.bundle.windows.webviewInstallMode).toEqual({ type: "downloadBootstrapper" });
  });

  it("C61 the privacy text says the webview keeps its own storage beside desktop-state.json, and where that was seen", () => {
    const f = privacy.replace(/\s+/g, " ");
    expect(f).not.toContain("O app guarda uma coisa a mais");
    for (const part of [
      "`localStorage`",
      "service worker",
      "`hsts-storage.sqlite`",
      "Linux (WebKitGTK)",
      "não foi inventariado",
    ])
      expect(f, part).toContain(part);
  });
});
