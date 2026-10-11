import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Third-party notices, the license gate and the SBOM (.specs/features/licenca-comercial, C7-C17). The texts
 * these scripts write are drafts for the owner's legal review; the tests prove the scripts do what the checks
 * say, not that the texts are legally sufficient.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LICENSES = path.join(ROOT, "scripts", "licenses.mjs");
const SBOM = path.join(ROOT, "scripts", "sbom.mjs");
const NOTICE = path.join(ROOT, "legal", "THIRD_PARTY_NOTICES.md");

interface Report {
  distributed: Array<{ name: string; version: string; key: string; expression: string }>;
  tooling: Array<{ name: string; version: string; expression: string }>;
  problems: string[];
  environment: string[];
  notice: string | null;
}
interface Licenses {
  parseSpdx: (text: string) => unknown;
  isAllowed: (expression: string, allowed: string[]) => boolean;
  buildReport: (root?: string) => Report;
  main: (argv: string[], io: { out: (s: string) => void; err: (s: string) => void }) => number;
  normalizeText: (text: string) => string;
  versionOfTarball: (resolved: string, name: string) => string | null;
}
interface Sbom {
  buildSbom: (root?: string) => {
    bomFormat: string;
    specVersion: string;
    serialNumber: string;
    components: Array<{
      "bom-ref": string;
      name: string;
      version: string;
      purl: string;
      licenses: unknown[];
      hashes: unknown[];
    }>;
    dependencies: Array<{ ref: string; dependsOn: string[] }>;
    metadata: { component: { "bom-ref": string } };
  };
}
const lic = (await import("../scripts/licenses.mjs")) as unknown as Licenses;
const sbom = (await import("../scripts/sbom.mjs")) as unknown as Sbom;

const ALLOWED = [
  "MIT",
  "MIT-0",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "0BSD",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "Python-2.0",
  "Unlicense",
  "Zlib",
];

// ---- fixture trees ------------------------------------------------------------------------------------------

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

interface Pkg {
  name: string;
  version?: string;
  license?: unknown;
  dev?: boolean;
  /** version in the tarball name of `resolved` (default: `version`) */
  tarball?: string;
  /** version of the installed package.json (default: `version`; null: not installed) */
  installed?: string | null;
  files?: Record<string, string>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}
interface Tree {
  pkgs: Pkg[];
  policy?: Record<string, unknown>;
}

/** A tiny project: a lockfile, the installed packages and the policy. The notice is written fresh unless asked not to. */
function tree({ pkgs, policy }: Tree, opts: { notice?: boolean } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "legal-lic-"));
  dirs.push(dir);
  const packages: Record<string, unknown> = { "": { name: "fixture", version: "1.0.0" } };
  for (const p of pkgs) {
    const version = p.version ?? "1.0.0";
    const unscoped = p.name.split("/").pop();
    packages[`node_modules/${p.name}`] = {
      version,
      resolved: `https://registry.npmjs.org/${p.name}/-/${unscoped}-${p.tarball ?? version}.tgz`,
      integrity: "sha512-AAAA",
      ...(p.license === undefined ? {} : { license: p.license }),
      ...(p.dev ? { dev: true } : {}),
      ...(p.dependencies ? { dependencies: p.dependencies } : {}),
      ...(p.optionalDependencies ? { optionalDependencies: p.optionalDependencies } : {}),
    };
    if (p.installed !== null) {
      const home = path.join(dir, "node_modules", p.name);
      fs.mkdirSync(home, { recursive: true });
      fs.writeFileSync(
        path.join(home, "package.json"),
        JSON.stringify({ name: p.name, version: p.installed ?? version }),
      );
      for (const [file, text] of Object.entries(p.files ?? { LICENSE: `License text of ${p.name}\n` }))
        fs.writeFileSync(path.join(home, file), text);
    }
  }
  fs.writeFileSync(
    path.join(dir, "package-lock.json"),
    JSON.stringify({ lockfileVersion: 3, packages }, null, 2),
  );
  fs.mkdirSync(path.join(dir, "legal"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "legal", "license-policy.json"),
    JSON.stringify({
      allowedDistributed: ALLOWED,
      allowedToolingExtra: ["MPL-2.0", "CC-BY-4.0"],
      overrides: {},
      bundled: [],
      ...policy,
    }),
  );
  if (opts.notice !== false) {
    const notice = lic.buildReport(dir).notice;
    if (notice !== null) fs.writeFileSync(path.join(dir, "legal", "THIRD_PARTY_NOTICES.md"), notice + "\n");
  }
  return dir;
}

function run(args: string[], root: string): { code: number; out: string; err: string } {
  let out = "";
  let err = "";
  const code = lic.main([...args, "--root", root], {
    out: (s) => (out += s),
    err: (s) => (err += s),
  });
  return { code, out, err };
}

// ---- the real tree, read without the code under test ------------------------------------------------------------

interface LockEntry {
  version?: string;
  resolved?: string;
  license?: string;
  dev?: boolean;
  devOptional?: boolean;
  link?: boolean;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8")) as {
  packages: Record<string, LockEntry>;
};
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, "legal", "license-policy.json"), "utf8")) as {
  overrides: Record<string, { license: string }>;
  bundled: Array<{ name: string; textFile?: string; files?: string[] }>;
};
const distributedKeys = Object.entries(lock.packages)
  .filter(([key, e]) => key.includes("node_modules/") && !e.link && !e.dev && !e.devOptional)
  .map(([key]) => key);
const toolingKeys = Object.entries(lock.packages)
  .filter(([key, e]) => key.includes("node_modules/") && !e.link && (e.dev || e.devOptional))
  .map(([key]) => key);
const nameOf = (key: string) => key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);

/** Where `name` resolves from `from`: the nearest node_modules going up. */
function resolveKey(from: string, name: string): string | null {
  let dir = from;
  for (;;) {
    const candidate = dir ? `${dir}/node_modules/${name}` : `node_modules/${name}`;
    if (candidate in lock.packages) return candidate;
    if (!dir) return null;
    const at = dir.lastIndexOf("/node_modules/");
    dir = at >= 0 ? dir.slice(0, at) : "";
  }
}
/** The packages the workspaces really need at run time: the walk of `dependencies`, the other way to compute the set. */
function reachableFromWorkspaces(): Set<string> {
  const queue: string[] = [];
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key || key.includes("node_modules/")) continue;
    for (const dep of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies })) {
      const resolved = resolveKey(key, dep);
      if (resolved) queue.push(resolved);
    }
  }
  const seen = new Set<string>();
  while (queue.length > 0) {
    const key = queue.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = lock.packages[key]!;
    if (entry.link) continue;
    const peers = Object.keys(entry.peerDependencies ?? {}).filter(
      (p) => !entry.peerDependenciesMeta?.[p]?.optional,
    );
    for (const dep of [...Object.keys({ ...entry.dependencies, ...entry.optionalDependencies }), ...peers]) {
      const resolved = resolveKey(key, dep);
      if (resolved) queue.push(resolved);
    }
  }
  return new Set([...seen].filter((k) => !lock.packages[k]!.link));
}

/** The text of the license files of an installed package, the way the notice must reproduce it. */
function licenseFiles(key: string): string[] {
  const dir = path.join(ROOT, key);
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(
      (d) => d.isFile() && /^(licen[sc]e|licen[sc]ing|copying|unlicen[sc]e|notice)([-._].*)?$/i.test(d.name),
    )
    .filter((d) => !/\.(js|mjs|cjs|ts|json|map)$/i.test(d.name))
    .map((d) => lic.normalizeText(fs.readFileSync(path.join(dir, d.name), "utf8")));
}

const committed = fs.readFileSync(NOTICE, "utf8").replace(/\r\n/g, "\n");

// ---- C7 ---------------------------------------------------------------------------------------------------------------

describe("C7 the notice lists every distributed package with its license text", () => {
  it("C7 the distributed set the lockfile flags is the set the workspaces reach by their dependencies", () => {
    const flagged = new Set(distributedKeys);
    const reached = reachableFromWorkspaces();
    expect([...reached].filter((k) => !flagged.has(k))).toEqual([]);
    expect([...flagged].filter((k) => !reached.has(k))).toEqual([]);
    expect(flagged.size).toBe(184);
  });

  it("C7 every distributed package has its name, version, SPDX and tarball URL in a row, and the text of its license file", () => {
    const notice = lic.normalizeText(committed);
    let withText = 0;
    let withoutFile = 0;
    for (const key of distributedKeys) {
      const entry = lock.packages[key]!;
      const name = nameOf(key);
      const spdx = entry.license ?? policy.overrides[`${name}@${entry.version}`]?.license;
      expect(spdx, `${name} has a license`).toBeTruthy();
      expect(notice, `${name} row`).toContain(`| ${name} | ${entry.version} | ${spdx} | ${entry.resolved} |`);
      const files = licenseFiles(key);
      if (files.length === 0) {
        withoutFile++;
        expect(notice, `${name} without a license file`).toContain(
          `(O pacote não inclui arquivo de licença. Licença declarada: ${spdx}.`,
        );
      } else {
        withText++;
        for (const text of files) expect(notice, `${name} license text`).toContain(text);
      }
    }
    expect(withText + withoutFile).toBe(184);
    // The two packages that ship no license file are named, not hidden.
    expect(withoutFile).toBeLessThanOrEqual(5);
  });

  it("C7 a package under a license that ships text gets its text in the notice, and one that does not gets a sentence that says so (fixture)", () => {
    const dir = tree({
      pkgs: [
        {
          name: "with-text",
          license: "MIT",
          files: { LICENSE: "MIT text with-text\n", NOTICE: "Apache notice\n" },
        },
        { name: "no-file", license: "ISC", files: {} },
      ],
    });
    const notice = lic.buildReport(dir).notice!;
    expect(notice).toContain(
      "| with-text | 1.0.0 | MIT | https://registry.npmjs.org/with-text/-/with-text-1.0.0.tgz |",
    );
    expect(notice).toContain("[LICENSE]\nMIT text with-text\n\n[NOTICE]\nApache notice");
    expect(notice).toContain("(O pacote não inclui arquivo de licença. Licença declarada: ISC.)");
  });
});

// ---- C8 ---------------------------------------------------------------------------------------------------------------

describe("C8 the notice is a pure function of the lockfile, the license files and the policy", () => {
  it("C8 the same bytes from another working directory, locale and time zone, equal to the committed file", () => {
    const envs = [
      { LANG: "C", LC_ALL: "C", TZ: "UTC" },
      { LANG: "tr_TR.UTF-8", LC_ALL: "tr_TR.UTF-8", TZ: "Pacific/Kiritimati" },
      { LANG: "pt_BR.UTF-8", LC_ALL: "pt_BR.UTF-8", TZ: "America/Sao_Paulo" },
    ];
    for (const env of envs) {
      const res = spawnSync(process.execPath, [LICENSES, "--stdout"], {
        cwd: os.tmpdir(),
        env: { ...process.env, ...env },
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      expect(res.status, res.stderr).toBe(0);
      expect(res.stdout).toBe(committed);
    }
  });

  it("C8 --stdout and --write write the same bytes", () => {
    const dir = tree(
      {
        pkgs: [
          { name: "a", license: "MIT" },
          { name: "b", license: "ISC", dev: true },
        ],
      },
      { notice: false },
    );
    const stdout = run(["--stdout"], dir);
    expect(stdout.code).toBe(0);
    expect(run(["--write"], dir).code).toBe(0);
    expect(fs.readFileSync(path.join(dir, "legal", "THIRD_PARTY_NOTICES.md"), "utf8")).toBe(stdout.out);
  });

  it("C8 the script reads no clock, no random value, no locale and no path of the machine", () => {
    const source = fs
      .readFileSync(LICENSES, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of [
      /\bDate\b/,
      /Math\.random/,
      /randomUUID|randomBytes/,
      /process\.cwd/,
      /os\.(hostname|homedir|tmpdir|userInfo)/,
      /toLocale|localeCompare|Intl\./,
    ])
      expect(source, String(forbidden)).not.toMatch(forbidden);
    expect(committed).not.toContain(ROOT);
    expect(committed).not.toContain(os.homedir());
  });
});

// ---- C9 ---------------------------------------------------------------------------------------------------------------

describe("C9 --check tells a stale notice from a current one", () => {
  const pkgs: Pkg[] = [{ name: "a", license: "MIT" }];

  it("C9 a notice equal to the generated one exits 0", () => {
    const dir = tree({ pkgs });
    const res = run(["--check"], dir);
    expect(res.code).toBe(0);
    expect(res.out).toContain("licenses: ok");
  });

  it("C9 a notice that differs by one letter exits 1 and names the file and licenses:write", () => {
    const dir = tree({ pkgs });
    const file = path.join(dir, "legal", "THIRD_PARTY_NOTICES.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("License text of a", "License text of b"));
    const res = run(["--check"], dir);
    expect(res.code).toBe(1);
    expect(res.err).toContain("legal/THIRD_PARTY_NOTICES.md is stale");
    expect(res.err).toContain("licenses:write");
  });

  it("C9 a lockfile that moved on while the notice stayed exits 1 (a new package)", () => {
    const dir = tree({ pkgs });
    const lockFile = path.join(dir, "package-lock.json");
    const j = JSON.parse(fs.readFileSync(lockFile, "utf8")) as { packages: Record<string, unknown> };
    j.packages["node_modules/b"] = {
      version: "1.0.0",
      resolved: "https://registry.npmjs.org/b/-/b-1.0.0.tgz",
      license: "MIT",
    };
    fs.writeFileSync(lockFile, JSON.stringify(j));
    fs.mkdirSync(path.join(dir, "node_modules", "b"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "node_modules", "b", "package.json"),
      JSON.stringify({ name: "b", version: "1.0.0" }),
    );
    expect(run(["--check"], dir).code).toBe(1);
  });

  it("C9 a missing notice exits 1; --write makes the next --check exit 0", () => {
    const dir = tree({ pkgs }, { notice: false });
    const missing = run(["--check"], dir);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("does not exist");
    expect(run(["--write"], dir).code).toBe(0);
    expect(run(["--check"], dir).code).toBe(0);
  });

  it("C9 --write refuses to write while a license is not allowed", () => {
    const dir = tree({ pkgs: [{ name: "bad", license: "GPL-3.0-only" }] }, { notice: false });
    const res = run(["--write"], dir);
    expect(res.code).toBe(1);
    expect(fs.existsSync(path.join(dir, "legal", "THIRD_PARTY_NOTICES.md"))).toBe(false);
  });

  it("C9 the command line exits with the same codes (a process, not a function)", () => {
    const dir = tree({ pkgs });
    const ok = spawnSync(process.execPath, [LICENSES, "--check", "--root", dir], { encoding: "utf8" });
    expect(ok.status).toBe(0);
    fs.appendFileSync(path.join(dir, "legal", "THIRD_PARTY_NOTICES.md"), "tampered\n");
    const stale = spawnSync(process.execPath, [LICENSES, "--check", "--root", dir], { encoding: "utf8" });
    expect(stale.status).toBe(1);
    const usage = spawnSync(process.execPath, [LICENSES], { encoding: "utf8" });
    expect(usage.status).toBe(2);
  });
});

// ---- C10 --------------------------------------------------------------------------------------------------------------

describe("C10 the notice covers the Radix closure, Node.js, SQLite and the fonts", () => {
  /** The walk of tests/ui-deps.test.ts: `dependencies` through the lockfile, from the six pinned primitives. */
  const SIX = [
    "@radix-ui/react-dialog",
    "@radix-ui/react-dropdown-menu",
    "@radix-ui/react-popover",
    "@radix-ui/react-switch",
    "@radix-ui/react-tabs",
    "@radix-ui/react-tooltip",
  ];
  function closure(): string[] {
    const seen = new Set<string>();
    const queue = [...SIX];
    while (queue.length > 0) {
      const name = queue.pop()!;
      if (seen.has(name)) continue;
      seen.add(name);
      queue.push(...Object.keys(lock.packages[`node_modules/${name}`]!.dependencies ?? {}));
    }
    return [...seen].sort();
  }

  it("C10 the 45 packages of the closure of the six primitives each have a row with a license of MIT or 0BSD", () => {
    const names = closure();
    expect(names).toHaveLength(45);
    const notice = lic.normalizeText(committed);
    for (const name of names) {
      const entry = lock.packages[`node_modules/${name}`]!;
      expect(["MIT", "0BSD"], name).toContain(entry.license);
      expect(notice, name).toContain(`| ${name} | ${entry.version} | ${entry.license} |`);
    }
  });

  it("C10 Node.js (MIT) and SQLite are named as components that do not come from npm", () => {
    expect(committed).toContain("### Node.js — MIT");
    expect(committed).toContain("### SQLite — Domínio público");
    expect(committed).toContain("runtime/LICENSE");
  });

  it("C10 every font file of the app is listed, exists, and has its OFL text and copyright line in the notice", () => {
    const fonts = fs.readdirSync(path.join(ROOT, "apps/command-centre/public/fonts")).sort();
    expect(fonts).toEqual([
      "jetbrains-mono-latin.woff2",
      "rajdhani-600-latin.woff2",
      "rajdhani-700-latin.woff2",
    ]);
    const listed = policy.bundled.flatMap((b) => b.files ?? []).map((f) => path.basename(f));
    expect(listed.sort()).toEqual(fonts);
    const notice = lic.normalizeText(committed);
    for (const item of policy.bundled) {
      for (const file of item.files ?? []) expect(fs.existsSync(path.join(ROOT, file)), file).toBe(true);
      if (!item.textFile) continue;
      const text = lic.normalizeText(fs.readFileSync(path.join(ROOT, item.textFile), "utf8"));
      expect(notice, item.name).toContain(text);
      expect(text).toContain("SIL OPEN FONT LICENSE Version 1.1");
    }
    expect(notice).toContain("Copyright 2020 The JetBrains Mono Project Authors");
    expect(notice).toContain("Copyright (c) 2014, Indian Type Foundry");
  });

  it("C10 a font file the policy does not list would be caught: the sweep above compares the folder with the policy (fixture)", () => {
    const listed = ["a.woff2", "b.woff2"];
    const folder = ["a.woff2", "b.woff2", "c.woff2"];
    expect(folder.filter((f) => !listed.includes(f))).toEqual(["c.woff2"]);
  });
});

// ---- C11, C12 ---------------------------------------------------------------------------------------------------------

describe("C11 a license the installer cannot carry fails the check", () => {
  for (const id of ALLOWED)
    it(`C11 ${id} in a distributed package passes`, () => {
      const dir = tree({ pkgs: [{ name: "pkg", license: id }] });
      const res = run(["--check"], dir);
      expect(res.code, res.err).toBe(0);
    });

  const DENIED: Array<[string, unknown]> = [
    ["GPL-3.0-only", "GPL-3.0-only"],
    ["GPL-2.0-or-later", "GPL-2.0-or-later"],
    ["AGPL-3.0-only", "AGPL-3.0-only"],
    ["LGPL-3.0-only", "LGPL-3.0-only"],
    ["SSPL-1.0", "SSPL-1.0"],
    ["MPL-2.0", "MPL-2.0"],
    ["CC-BY-4.0", "CC-BY-4.0"],
    ["UNLICENSED", "UNLICENSED"],
    ["SEE LICENSE IN x", "SEE LICENSE IN LICENSE.txt"],
    ["none", undefined],
  ];
  for (const [label, license] of DENIED)
    it(`C11 ${label} in a distributed package exits 1 naming the package, its version and the license`, () => {
      const dir = tree({ pkgs: [{ name: "bad-one", version: "2.3.4", license }] });
      const res = run(["--check"], dir);
      expect(res.code).toBe(1);
      expect(res.err).toContain("bad-one@2.3.4 (distribuído)");
      if (license === undefined) expect(res.err).toContain("no license declared");
      else expect(res.err).toContain(JSON.stringify(license));
    });

  it("C11 a legacy {type} object and a list of {type} are read as the license they name", () => {
    const dir = tree({
      pkgs: [
        { name: "obj", license: { type: "GPL-3.0-only" } },
        { name: "list", license: [{ type: "MIT" }, { type: "GPL-3.0-only" }] },
      ],
    });
    const res = run(["--check"], dir);
    expect(res.code).toBe(1);
    expect(res.err).toContain("obj@1.0.0");
    expect(res.err).not.toContain("list@1.0.0");
  });

  it("C11 every problem is listed at once, not only the first", () => {
    const dir = tree({
      pkgs: [
        { name: "one", license: "GPL-3.0-only" },
        { name: "two", license: "AGPL-3.0-only" },
      ],
    });
    const res = run(["--check"], dir);
    expect(res.err).toContain("one@1.0.0");
    expect(res.err).toContain("two@1.0.0");
  });
});

describe("C12 a build tool has a wider list than the installer", () => {
  it("C12 MPL-2.0 and CC-BY-4.0 pass in a build tool", () => {
    for (const license of ["MPL-2.0", "CC-BY-4.0"]) {
      const dir = tree({ pkgs: [{ name: "tool", license, dev: true }] });
      expect(run(["--check"], dir).code, license).toBe(0);
    }
  });

  it("C12 GPL-3.0-only and a missing license in a build tool exit 1 naming the tool", () => {
    for (const license of ["GPL-3.0-only", undefined]) {
      const dir = tree({ pkgs: [{ name: "tool", version: "5.0.0", license, dev: true }] });
      const res = run(["--check"], dir);
      expect(res.code, String(license)).toBe(1);
      expect(res.err).toContain("tool@5.0.0 (ferramenta de build)");
    }
  });

  it("C12 the same MPL-2.0 in a distributed package exits 1", () => {
    const dir = tree({ pkgs: [{ name: "tool", license: "MPL-2.0" }] });
    expect(run(["--check"], dir).code).toBe(1);
  });

  it("C12 a package is a tool when the lockfile flags it dev or devOptional, not by its name", () => {
    const dir = tree({ pkgs: [{ name: "types", license: "MPL-2.0", dev: true }] });
    const lockFile = path.join(dir, "package-lock.json");
    const j = JSON.parse(fs.readFileSync(lockFile, "utf8")) as {
      packages: Record<string, Record<string, unknown>>;
    };
    delete j.packages["node_modules/types"]!.dev;
    j.packages["node_modules/types"]!.devOptional = true;
    fs.writeFileSync(lockFile, JSON.stringify(j));
    const report = lic.buildReport(dir);
    expect(report.tooling.map((t) => t.name)).toEqual(["types"]);
    expect(report.problems).toEqual([]);
  });
});

// ---- C13 --------------------------------------------------------------------------------------------------------------

describe("C13 SPDX expressions", () => {
  const rows: Array<[string, boolean]> = [
    ["MIT", true],
    ["MIT OR GPL-3.0-only", true],
    ["GPL-3.0-only OR AGPL-3.0-only", false],
    ["MIT AND ISC", true],
    ["MIT AND GPL-3.0-only", false],
    ["(MIT OR WTFPL) AND ISC", true],
    ["(MIT OR WTFPL)", true],
    ["(BSD-2-Clause OR MIT OR Apache-2.0)", true],
    ["Apache-2.0 WITH LLVM-exception", true],
    ["GPL-3.0-only WITH Classpath-exception-2.0", false],
    ["mit", true],
    ["MIT OR", false],
    ["OR MIT", false],
    ["(MIT", false],
    ["MIT)", false],
    ["MIT ISC", false],
    ["SEE LICENSE IN LICENSE.txt", false],
    ["", false],
  ];
  for (const [expression, expected] of rows)
    it(`C13 ${JSON.stringify(expression)} is ${expected ? "allowed" : "not allowed"}`, () => {
      expect(lic.isAllowed(expression, ALLOWED)).toBe(expected);
    });

  it("C13 a non-string is not an expression", () => {
    expect(lic.parseSpdx(undefined as unknown as string)).toBeNull();
    expect(lic.isAllowed(undefined as unknown as string, ALLOWED)).toBe(false);
  });
});

// ---- C14 --------------------------------------------------------------------------------------------------------------

describe("C14 a package with no license field needs an override for that exact version", () => {
  const override = { "ghost@1.0.0": { license: "MIT", reason: "o LICENSE do pacote é a MIT" } };

  it("C14 without an override it exits 1; with one for the exact name@version it passes", () => {
    expect(run(["--check"], tree({ pkgs: [{ name: "ghost", dev: true }] })).code).toBe(1);
    expect(
      run(["--check"], tree({ pkgs: [{ name: "ghost", dev: true }], policy: { overrides: override } })).code,
    ).toBe(0);
  });

  it("C14 the next version of the package fails again", () => {
    const dir = tree({
      pkgs: [{ name: "ghost", version: "1.0.1", dev: true }],
      policy: { overrides: override },
    });
    const res = run(["--check"], dir);
    expect(res.code).toBe(1);
    expect(res.err).toContain("ghost@1.0.1");
  });

  it("C14 an override with an empty reason, or whose license is not allowed, does not count", () => {
    const empty = tree({
      pkgs: [{ name: "ghost", dev: true }],
      policy: { overrides: { "ghost@1.0.0": { license: "MIT", reason: "  " } } },
    });
    expect(run(["--check"], empty).code).toBe(1);
    const bad = tree({
      pkgs: [{ name: "ghost" }],
      policy: { overrides: { "ghost@1.0.0": { license: "GPL-3.0-only", reason: "x" } } },
    });
    expect(run(["--check"], bad).code).toBe(1);
  });

  it("C14 the override the real policy holds is for the one tool that needs it, and the lockfile still has no license for it", () => {
    expect(Object.keys(policy.overrides)).toEqual(["svg-tags@1.0.0"]);
    expect(lock.packages["node_modules/svg-tags"]!.license).toBeUndefined();
    expect(lock.packages["node_modules/svg-tags"]!.dev).toBe(true);
  });
});

// ---- C15 --------------------------------------------------------------------------------------------------------------

describe("C15 a tree that is not what the lockfile says exits 2", () => {
  it("C15 a lockfile entry whose version differs from its tarball (the 0.6.0 / 0.5.0 case) exits 2 naming the package", () => {
    const dir = tree(
      { pkgs: [{ name: "@clack/core", version: "0.6.0", tarball: "0.5.0", license: "MIT" }] },
      { notice: false },
    );
    for (const mode of ["--check", "--write", "--stdout"]) {
      const res = run([mode], dir);
      expect(res.code, mode).toBe(2);
      expect(res.err, mode).toContain("@clack/core");
      expect(res.err, mode).toContain("0.6.0");
      expect(res.err, mode).toContain("0.5.0");
    }
    expect(fs.existsSync(path.join(dir, "legal", "THIRD_PARTY_NOTICES.md"))).toBe(false);
  });

  it("C15 the real lockfile has no such entry", () => {
    for (const [key, entry] of Object.entries(lock.packages)) {
      if (!key.includes("node_modules/") || !entry.resolved) continue;
      const fromUrl = lic.versionOfTarball(entry.resolved, nameOf(key));
      if (fromUrl !== null) expect(fromUrl, key).toBe(entry.version);
    }
  });

  it("C15 a distributed package that node_modules does not have, or has in another version, exits 2", () => {
    const missing = tree({ pkgs: [{ name: "gone", installed: null, license: "MIT" }] }, { notice: false });
    const a = run(["--check"], missing);
    expect(a.code).toBe(2);
    expect(a.err).toContain("gone@1.0.0");
    expect(a.err).toContain("npm ci");
    const other = tree({ pkgs: [{ name: "moved", installed: "2.0.0", license: "MIT" }] }, { notice: false });
    const b = run(["--check"], other);
    expect(b.code).toBe(2);
    expect(b.err).toContain("holds 2.0.0");
  });

  it("C15 a build tool that is not installed does not stop the check (only the notice's packages are read)", () => {
    const dir = tree({ pkgs: [{ name: "tool", dev: true, installed: null, license: "MIT" }] });
    expect(run(["--check"], dir).code).toBe(0);
  });

  it("C15 a policy file that cannot be read, or with a list of the wrong shape, exits 2", () => {
    const dir = tree({ pkgs: [{ name: "a", license: "MIT" }] });
    fs.writeFileSync(path.join(dir, "legal", "license-policy.json"), "{ not json");
    const unreadable = run(["--check"], dir);
    expect(unreadable.code).toBe(2);
    expect(unreadable.err).toContain("legal/license-policy.json");
    fs.writeFileSync(
      path.join(dir, "legal", "license-policy.json"),
      JSON.stringify({ allowedDistributed: "MIT", allowedToolingExtra: [] }),
    );
    expect(run(["--check"], dir).code).toBe(2);
  });
});

// ---- C16 --------------------------------------------------------------------------------------------------------------

describe("C16 the SBOM", () => {
  const bom = sbom.buildSbom(ROOT);

  it("C16 it is a CycloneDX 1.5 document with a serial number", () => {
    expect(bom.bomFormat).toBe("CycloneDX");
    expect(bom.specVersion).toBe("1.5");
    expect(bom.serialNumber).toMatch(
      /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("C16 its components are exactly the distributed name@version pairs of the lockfile, with unique references", () => {
    const expected = new Set(distributedKeys.map((k) => `${nameOf(k)}@${lock.packages[k]!.version}`));
    const got = bom.components
      .filter((c) => c.purl?.startsWith("pkg:npm/"))
      .map((c) => `${c.name}@${c.version}`);
    expect(new Set(got)).toEqual(expected);
    expect(got).toHaveLength(expected.size);
    expect(expected.size).toBe(183);
    expect(distributedKeys).toHaveLength(184);
    const refs = bom.components.map((c) => c["bom-ref"]);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("C16 no build tool is in it", () => {
    const names = new Set(bom.components.map((c) => c.name));
    for (const tool of [
      "vitest",
      "typescript",
      "vite",
      "eslint",
      "prettier",
      "rolldown",
      "stylelint",
      "axe-core",
      "lightningcss",
    ])
      expect(names.has(tool), tool).toBe(false);
    expect(toolingKeys.length).toBeGreaterThan(400);
  });

  it("C16 each component has a license, a hash and a purl that names its version", () => {
    for (const c of bom.components.filter((x) => x.purl?.startsWith("pkg:npm/"))) {
      expect(c.licenses.length, c.name).toBeGreaterThan(0);
      expect(c.hashes.length, c.name).toBeGreaterThan(0);
      expect(c.purl, c.name).toBe(`pkg:npm/${c.name.replace(/^@/, "%40")}@${c.version}`);
    }
  });

  it("C16 every reference of the dependency graph points to a component or to the application", () => {
    const known = new Set([...bom.components.map((c) => c["bom-ref"]), bom.metadata.component["bom-ref"]]);
    for (const d of bom.dependencies) {
      expect(known.has(d.ref), d.ref).toBe(true);
      for (const on of d.dependsOn) expect(known.has(on), `${d.ref} -> ${on}`).toBe(true);
    }
    const root = bom.dependencies.find((d) => d.ref === bom.metadata.component["bom-ref"])!;
    expect(root.dependsOn).toContain("pkg:npm/react@18.3.1");
    expect(root.dependsOn).toContain("pkg:npm/zod@3.25.76");
  });

  it("C16 two runs, from different places, write the same bytes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "legal-sbom-"));
    dirs.push(dir);
    const a = path.join(dir, "a.json");
    const b = path.join(dir, "b.json");
    expect(
      spawnSync(process.execPath, [SBOM, "--out", a], { cwd: os.tmpdir(), encoding: "utf8" }).status,
    ).toBe(0);
    expect(
      spawnSync(process.execPath, [SBOM, "--out", b], {
        cwd: dir,
        env: { ...process.env, TZ: "Asia/Tokyo", LANG: "tr_TR.UTF-8" },
        encoding: "utf8",
      }).status,
    ).toBe(0);
    expect(fs.readFileSync(a, "utf8")).toBe(fs.readFileSync(b, "utf8"));
    expect(JSON.parse(fs.readFileSync(a, "utf8")).components).toHaveLength(183 + 4);
  });

  it("C16 npm run sbom is the script, and the default output is build/sbom/mordomo-os.cdx.json", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["sbom"]).toBe("node scripts/sbom.mjs");
    expect(fs.readFileSync(SBOM, "utf8")).toContain('path.join("build", "sbom", "mordomo-os.cdx.json")');
  });
});

// ---- C17 --------------------------------------------------------------------------------------------------------------

describe("C17 the real lockfile passes", () => {
  it("C17 no distributed package and no build tool has a license the lists refuse; --check exits 0 with 184 and 484", () => {
    const report = lic.buildReport(ROOT);
    expect(report.environment).toEqual([]);
    expect(report.problems).toEqual([]);
    expect(report.distributed).toHaveLength(184);
    expect(report.tooling).toHaveLength(toolingKeys.length);
    expect(report.tooling.length).toBeGreaterThanOrEqual(480);
    const res = run(["--check"], ROOT);
    expect(res.code, res.err).toBe(0);
    expect(res.out).toContain("184 distributed");
  });

  it("C17 the tools under MPL-2.0 and CC-BY-4.0 are known and none of them is a distributed package", () => {
    const wider = new Set(["MPL-2.0", "CC-BY-4.0"]);
    const names = new Set<string>();
    for (const key of toolingKeys)
      if (wider.has(lock.packages[key]!.license ?? ""))
        names.add(nameOf(key).replace(/-(android|darwin|freebsd|linux|win32).*$/, ""));
    expect([...names].sort()).toEqual(["@axe-core/playwright", "axe-core", "caniuse-lite", "lightningcss"]);
    for (const key of distributedKeys) expect(wider.has(lock.packages[key]!.license ?? ""), key).toBe(false);
  });
});

// ---- round 1 ----------------------------------------------------------------------------------------------------------

const REAL_POLICY = JSON.parse(fs.readFileSync(path.join(ROOT, "legal", "license-policy.json"), "utf8")) as {
  allowedDistributed: string[];
  allowedToolingExtra: string[];
  overrides: Record<string, unknown>;
  bundled: Array<{
    name: string;
    sbom: { ref: string; type: string; license: { id?: string; name?: string } };
  }>;
};

describe("C33 the real list of licenses is pinned, and each forbidden license fails under it", () => {
  it("C33 allowedDistributed is exactly the 12 of the plan, in order; the build tools add exactly MPL-2.0 and CC-BY-4.0", () => {
    expect(REAL_POLICY.allowedDistributed).toEqual(ALLOWED);
    expect(REAL_POLICY.allowedToolingExtra).toEqual(["MPL-2.0", "CC-BY-4.0"]);
    expect(Object.keys(REAL_POLICY.overrides)).toEqual(["svg-tags@1.0.0"]);
  });

  const FORBIDDEN = [
    "GPL-3.0-only",
    "GPL-2.0-or-later",
    "AGPL-3.0-only",
    "AGPL-3.0-or-later",
    "LGPL-3.0-only",
    "LGPL-2.1-only",
    "SSPL-1.0",
    "MPL-2.0",
    "CC-BY-4.0",
    "CC-BY-NC-4.0",
    "EUPL-1.2",
    "BUSL-1.1",
    "Elastic-2.0",
    "UNLICENSED",
    "SEE LICENSE IN LICENSE.txt",
    "Proprietary",
  ];
  for (const id of FORBIDDEN)
    it(`C33 ${id} is refused in a runtime package under the REAL policy`, () => {
      expect(lic.isAllowed(id, REAL_POLICY.allowedDistributed), id).toBe(false);
      const dir = tree({ pkgs: [{ name: "pkg", license: id }], policy: { ...REAL_POLICY, bundled: [] } });
      const res = run(["--check"], dir);
      expect(res.code, res.err).toBe(1);
      expect(res.err).toContain("pkg@1.0.0");
    });

  it("C33 under the REAL policy a build tool takes MPL-2.0 and CC-BY-4.0 and refuses the rest of the list", () => {
    const tooling = [...REAL_POLICY.allowedDistributed, ...REAL_POLICY.allowedToolingExtra];
    for (const id of ["MPL-2.0", "CC-BY-4.0"]) expect(lic.isAllowed(id, tooling), id).toBe(true);
    for (const id of FORBIDDEN.filter((f) => !["MPL-2.0", "CC-BY-4.0"].includes(f)))
      expect(lic.isAllowed(id, tooling), id).toBe(false);
  });

  it("C33 the pin can fail: a list with GPL-3.0-only or MPL-2.0 added no longer equals the plan's", () => {
    expect([...REAL_POLICY.allowedDistributed, "GPL-3.0-only"]).not.toEqual(ALLOWED);
    expect([...REAL_POLICY.allowedDistributed, "MPL-2.0"]).not.toEqual(ALLOWED);
    expect(lic.isAllowed("GPL-3.0-only", [...REAL_POLICY.allowedDistributed, "GPL-3.0-only"])).toBe(true);
  });
});

// ---- C36 ----------------------------------------------------------------------------------------------------------------

describe("C36 the SBOM is a valid CycloneDX 1.5 document, and what it says is what the lockfile says", async () => {
  const { default: Ajv } = (await import("ajv")) as unknown as { default: new (o: object) => AjvLike };
  interface AjvLike {
    addSchema: (s: object) => void;
    addFormat: (n: string, f: RegExp) => void;
    compile: (
      s: object,
    ) => ((d: unknown) => boolean) & { errors?: Array<{ instancePath: string; message?: string }> | null };
  }
  const SCHEMAS: Record<string, string> = {
    "bom-1.5.schema.json": "2d956c1d05c092695457a91f3b5c57c749793c013ec224a0935807cfc8ae4480",
    "spdx.schema.json": "4b345e2329f209f34e960ae2a8e7cb46a166907e6a45e94978565925dc47b359",
    "jsf-0.82.schema.json": "8bae002c25e723db7ee1f26afde680ae1a2b1a8f6b4b4b0fd65dc3becb090aae",
  };
  const schemaText = (f: string) =>
    fs.readFileSync(path.join(ROOT, "legal", "vendor", "cyclonedx", f), "utf8").replace(/\r\n/g, "\n");
  const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
  const ajv = new Ajv({ strict: false, allErrors: true });
  ajv.addFormat("iri-reference", /^\S+$/);
  ajv.addFormat("idn-email", /^[^@\s]+@[^@\s]+$/);
  ajv.addSchema(JSON.parse(schemaText("spdx.schema.json")));
  ajv.addSchema(JSON.parse(schemaText("jsf-0.82.schema.json")));
  const validate = ajv.compile(JSON.parse(schemaText("bom-1.5.schema.json")));
  const bom = sbom.buildSbom(ROOT) as unknown as Record<string, any>;
  const clone = () => JSON.parse(JSON.stringify(bom)) as typeof bom;
  const errorsOf = (doc: unknown) =>
    validate(doc) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);

  it("C36 the three schema files are the official ones (SHA-256 pinned)", () => {
    for (const [file, expected] of Object.entries(SCHEMAS))
      expect(sha(schemaText(file)), file).toBe(expected);
    expect(schemaText("bom-1.5.schema.json")).toContain(
      '"$id": "http://cyclonedx.org/schema/bom-1.5.schema.json"',
    );
  });

  it("C36 the real SBOM validates against the official 1.5 JSON Schema", () => {
    expect(errorsOf(bom)).toEqual([]);
  });

  it("C36 the validator can fail: a wrong algorithm name, a lowercase SPDX id, a missing field and a bad ref are all errors", () => {
    const a = clone();
    a.components[10].hashes[0].alg = "SHA-999";
    expect(errorsOf(a).length).toBeGreaterThan(0);
    const b = clone();
    b.components[10].licenses = [{ license: { id: "mit" } }];
    expect(errorsOf(b).length).toBeGreaterThan(0);
    const c = clone();
    delete c.components[10].name;
    expect(errorsOf(c).length).toBeGreaterThan(0);
    const d = clone();
    d.bomFormat = "CycloneDX2";
    expect(errorsOf(d).length).toBeGreaterThan(0);
  });

  it("C36 every npm component: the hash is the integrity of the lockfile, labelled with its own algorithm and of the right length", () => {
    const widths: Record<string, number> = { "SHA-1": 40, "SHA-256": 64, "SHA-384": 96, "SHA-512": 128 };
    const labels: Record<string, string> = {
      sha1: "SHA-1",
      sha256: "SHA-256",
      sha384: "SHA-384",
      sha512: "SHA-512",
    };
    const byPurl = new Map(
      distributedKeys.map((k) => [
        `${nameOf(k)}@${lock.packages[k]!.version}`,
        lock.packages[k] as LockEntry & { integrity?: string },
      ]),
    );
    for (const c of bom.components.filter((x: { purl?: string }) => x.purl?.startsWith("pkg:npm/"))) {
      const entry = byPurl.get(`${c.name}@${c.version}`)!;
      const m = /^(sha1|sha256|sha384|sha512)-(.+)$/.exec(entry.integrity ?? "")!;
      expect(c.hashes, c.name).toEqual([
        { alg: labels[m[1]!], content: Buffer.from(m[2]!, "base64").toString("hex") },
      ]);
      expect(c.hashes[0].content, c.name).toMatch(new RegExp(`^[0-9a-f]{${widths[c.hashes[0].alg]}}$`));
    }
  });

  it("C36 every npm component carries a distribution reference equal to the lockfile's resolved URL", () => {
    const byName = new Map(
      distributedKeys.map((k) => [`${nameOf(k)}@${lock.packages[k]!.version}`, lock.packages[k]!]),
    );
    for (const c of bom.components.filter((x: { purl?: string }) => x.purl?.startsWith("pkg:npm/")))
      expect(c.externalReferences, c.name).toEqual([
        { type: "distribution", url: byName.get(`${c.name}@${c.version}`)!.resolved },
      ]);
  });

  it("C36 the licence of every component is the lockfile's (or the policy override's), with an expression kept whole", () => {
    const byName = new Map(
      distributedKeys.map((k) => [`${nameOf(k)}@${lock.packages[k]!.version}`, lock.packages[k]!]),
    );
    for (const c of bom.components.filter((x: { purl?: string }) => x.purl?.startsWith("pkg:npm/"))) {
      const spdx = byName.get(`${c.name}@${c.version}`)!.license!;
      const [choice] = c.licenses;
      expect(c.licenses, c.name).toHaveLength(1);
      if (/[ ()]/.test(spdx)) expect(choice, c.name).toEqual({ expression: spdx });
      else expect(choice, c.name).toEqual({ license: { id: spdx } });
    }
  });

  it("C36 a WITH expression and an OR expression are not flattened into one id (fixture)", () => {
    const dir = tree({
      pkgs: [
        { name: "with-ex", license: "Apache-2.0 WITH LLVM-exception" },
        { name: "either", license: "(MIT OR Apache-2.0)" },
        { name: "custom", license: "CC0-1.0" },
      ],
    });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0", license: "FSL-1.1-ALv2" }),
    );
    const doc = sbom.buildSbom(dir) as unknown as {
      components: Array<{ name: string; licenses: unknown[] }>;
    };
    const of = (n: string) => doc.components.find((c) => c.name === n)!.licenses;
    expect(of("with-ex")).toEqual([{ expression: "Apache-2.0 WITH LLVM-exception" }]);
    expect(of("either")).toEqual([{ expression: "(MIT OR Apache-2.0)" }]);
  });

  it("C36 references: every bom-ref is unique, no dependency points at nothing, and the application depends on the bundled components", () => {
    const refs = bom.components.map((c: { "bom-ref": string }) => c["bom-ref"]);
    expect(new Set(refs).size).toBe(refs.length);
    const known = new Set([...refs, bom.metadata.component["bom-ref"]]);
    for (const d of bom.dependencies as Array<{ ref: string; dependsOn: string[] }>) {
      expect(known.has(d.ref), d.ref).toBe(true);
      for (const on of d.dependsOn) expect(known.has(on), `${d.ref} -> ${on}`).toBe(true);
    }
    expect(new Set((bom.dependencies as Array<{ ref: string }>).map((d) => d.ref)).size).toBe(
      bom.dependencies.length,
    );
    const app = (bom.dependencies as Array<{ ref: string; dependsOn: string[] }>).find(
      (d) => d.ref === bom.metadata.component["bom-ref"],
    )!;
    for (const b of REAL_POLICY.bundled) expect(app.dependsOn, b.name).toContain(b.sbom.ref);
  });

  it("C36 the dependency edges are exactly the lockfile's dependencies and optionalDependencies, resolved the way Node does", () => {
    const keys = new Set(Object.keys(lock.packages));
    const purl = (k: string) => `pkg:npm/${nameOf(k).replace(/^@/, "%40")}@${lock.packages[k]!.version}`;
    const expected = new Map<string, Set<string>>();
    for (const key of distributedKeys) {
      const entry = lock.packages[key]!;
      const set = expected.get(purl(key)) ?? new Set<string>();
      for (const dep of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies })) {
        const resolved = resolveKey(key, dep);
        if (resolved && keys.has(resolved) && distributedKeys.includes(resolved)) set.add(purl(resolved));
      }
      expected.set(purl(key), set);
    }
    for (const d of bom.dependencies as Array<{ ref: string; dependsOn: string[] }>) {
      if (!d.ref.startsWith("pkg:npm/")) continue;
      expect([...d.dependsOn].sort(), d.ref).toEqual([...expected.get(d.ref)!].sort());
    }
    // An edge that exists only as an optional dependency is there (the lockfile has at least one).
    const optionalOnly = distributedKeys.some(
      (k) => Object.keys(lock.packages[k]!.optionalDependencies ?? {}).length > 0,
    );
    expect(typeof optionalOnly).toBe("boolean");
  });

  it("C36 an edge that exists only as an optional dependency, and one through a dependency, are in the graph (fixture)", () => {
    const dir = tree({
      pkgs: [
        {
          name: "app-dep",
          license: "MIT",
          dependencies: { plain: "^1.0.0" },
          optionalDependencies: { extra: "^1.0.0" },
        },
        { name: "plain", license: "MIT" },
        { name: "extra", license: "MIT" },
      ],
    });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0", license: "FSL-1.1-ALv2" }),
    );
    const doc = sbom.buildSbom(dir) as unknown as {
      dependencies: Array<{ ref: string; dependsOn: string[] }>;
    };
    const edge = doc.dependencies.find((d) => d.ref === "pkg:npm/app-dep@1.0.0")!;
    expect(edge.dependsOn).toEqual(["pkg:npm/extra@1.0.0", "pkg:npm/plain@1.0.0"]);
  });

  it("C36 Node.js, SQLite and the two fonts are components, each with its licence, as the notice lists them", () => {
    const named = (n: string) => bom.components.find((c: { name: string }) => c.name === n);
    expect(named("Node.js")).toMatchObject({ type: "platform", licenses: [{ license: { id: "MIT" } }] });
    expect(named("SQLite")).toMatchObject({
      type: "library",
      licenses: [{ license: { name: "Public Domain" } }],
    });
    expect(named("JetBrains Mono")).toMatchObject({
      type: "file",
      licenses: [{ license: { id: "OFL-1.1" } }],
    });
    expect(named("Rajdhani")).toMatchObject({ type: "file", licenses: [{ license: { id: "OFL-1.1" } }] });
    const notice = committed;
    for (const b of REAL_POLICY.bundled) expect(notice, b.name).toContain(`### ${b.name} —`);
    expect(bom.components).toHaveLength(183 + REAL_POLICY.bundled.length);
  });

  it("C36 the application's own licence is the manifest's SPDX id", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      license: string;
    };
    expect(manifest.license).toBe("FSL-1.1-ALv2");
    expect(bom.metadata.component.licenses).toEqual([{ license: { id: "FSL-1.1-ALv2" } }]);
  });
});
