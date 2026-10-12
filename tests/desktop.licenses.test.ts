import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * distribuicao, S7: the licenses of the Rust crates, their notice and their SBOM (.specs/features/distribuicao, AC 43-44).
 * The graph rules run on a small `cargo metadata` document written here; the real tree is checked with the real policy.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rust: any = await import("../scripts/licenses-rust.mjs");
const sbomRust: any = await import("../scripts/sbom-rust.mjs");
const stage: any = await import("../scripts/legal-stage.mjs");

const temps: string[] = [];
const temp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-rust-"));
  temps.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const capture = () => {
  const c = { out: "", err: "", io: { out: (_: string) => {}, err: (_: string) => {} } };
  c.io = { out: (s) => (c.out += s), err: (s) => (c.err += s) };
  return c;
};

// ---- the graph ----------------------------------------------------------------------------------------------

type Kind = null | "build" | "dev";
function metadata(
  edges: Record<string, Array<[string, Kind[]]>>,
  licenses: Record<string, string | null> = {},
) {
  const ids = [
    ...new Set([...Object.keys(edges), ...Object.values(edges).flatMap((d) => d.map(([to]) => to))]),
  ];
  const idOf = (n: string) => `registry+x#${n}@1.0.0`;
  return {
    packages: ids.map((n) => ({
      id: idOf(n),
      name: n,
      version: "1.0.0",
      license: n in licenses ? licenses[n] : "MIT",
      manifest_path: `/nowhere/${n}/Cargo.toml`,
    })),
    workspace_members: [idOf("app")],
    resolve: {
      nodes: ids.map((n) => ({
        id: idOf(n),
        deps: (edges[n] ?? []).map(([to, kinds]) => ({
          pkg: idOf(to),
          dep_kinds: kinds.map((kind) => ({ kind })),
        })),
      })),
    },
  };
}

describe("C46 the crates of the runtime are the ones reached through normal dependencies", () => {
  it("C46 build and dev edges are not followed; a crate that is both normal and build is in; workspace members are not crates", () => {
    const m = metadata({
      app: [
        ["normal", [null]],
        ["buildonly", ["build"]],
        ["devonly", ["dev"]],
        ["both", [null, "build"]],
        ["member-like", [null]],
      ],
      normal: [
        ["deep", [null]],
        ["deep-dev", ["dev"]],
      ],
      buildonly: [["via-build", [null]]],
      deep: [["normal", [null]]], // a cycle
      both: [],
      "member-like": [],
      devonly: [],
      "via-build": [],
      "deep-dev": [],
    });
    expect(rust.runtimeCrates(m).map((c: { name: string }) => c.name)).toEqual([
      "both",
      "deep",
      "member-like",
      "normal",
    ]);
  });
});

describe("C46 a crate outside the policy fails, an exception must be named, used and explained", () => {
  const policy = (extra: Record<string, unknown> = {}) => ({
    rust: { allowed: ["MIT", "Apache-2.0", "Unicode-3.0"], exceptions: [], ...extra },
  });
  const crate = (name: string, license: string | null) => ({ name, version: "1.0.0", license });

  it("C46 legacy slashes mean OR; OR needs one allowed, AND needs both; WITH is read as its license", () => {
    expect(rust.normalizeExpression("MIT/Apache-2.0")).toBe("MIT OR Apache-2.0");
    expect(rust.normalizeExpression("Apache-2.0 / MIT")).toBe("Apache-2.0 OR MIT");
    const ok = (license: string) => rust.judge([crate("a", license)], policy()).problems;
    expect(ok("MIT")).toEqual([]);
    expect(ok("MIT/Apache-2.0")).toEqual([]);
    expect(ok("GPL-3.0-only OR MIT")).toEqual([]);
    expect(ok("(MIT OR Apache-2.0) AND Unicode-3.0")).toEqual([]);
    expect(ok("Apache-2.0 WITH LLVM-exception OR GPL-2.0-only")).toEqual([]);
    expect(ok("MIT AND GPL-3.0-only")).toEqual(['a 1.0.0: MIT AND GPL-3.0-only is not in the "rust" policy']);
    for (const bad of [
      "GPL-3.0-only",
      "AGPL-3.0-or-later",
      "SSPL-1.0",
      "MPL-2.0",
      "LGPL-2.1-only",
      "BUSL-1.1",
    ])
      expect(ok(bad), bad).toEqual([`a 1.0.0: ${bad} is not in the "rust" policy`]);
  });

  it("C46 no license, an unreadable one and a missing rust section are problems, not passes", () => {
    expect(rust.judge([crate("a", null)], policy()).problems[0]).toMatch(/not an SPDX expression/);
    expect(rust.judge([crate("a", "SEE LICENSE IN x")], policy()).problems[0]).toMatch(
      /not an SPDX expression/,
    );
    expect(rust.judge([crate("a", "MIT")], {}).problems[0]).toMatch(/"rust" section .* is missing/);
  });

  it("C46 an exception passes only for that crate and that license with a reason; an unused one is reported as stale", () => {
    const exception = { crate: "selectors", license: "MPL-2.0", reason: "unmodified, source on crates.io" };
    const withException = policy({ exceptions: [exception] });
    expect(rust.judge([crate("selectors", "MPL-2.0")], withException).problems).toEqual([]);
    expect(rust.judge([crate("other", "MPL-2.0")], withException).problems).toEqual([
      'other 1.0.0: MPL-2.0 is not in the "rust" policy',
      "stale exception: selectors (MPL-2.0) is no longer needed",
    ]);
    expect(rust.judge([crate("selectors", "MPL-2.0 OR GPL-3.0-only")], withException).problems).toContain(
      'selectors 1.0.0: MPL-2.0 OR GPL-3.0-only is not in the "rust" policy',
    );
    expect(rust.judge([crate("selectors", "MIT")], withException).problems).toEqual([
      "stale exception: selectors (MPL-2.0) is no longer needed",
    ]);
    const noReason = policy({ exceptions: [{ ...exception, reason: "  " }] });
    expect(rust.judge([crate("selectors", "MPL-2.0")], noReason).problems[0]).toMatch(
      /not in the "rust" policy/,
    );
  });
});

describe("C46 the notice is deterministic, writes each license text once and says which crates have none", () => {
  function source(files: Record<string, string>) {
    const dir = temp();
    for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), text);
    return path.join(dir, "Cargo.toml");
  }
  const MIT = "MIT License\r\n\r\nCopyright (c) someone  \r\n";
  it("C46 two crates with the same text share one block (CRLF and trailing blanks do not make a second); a crate without a file is in section 4", () => {
    const crates = [
      { name: "a", version: "1.0.0", license: "MIT", manifest_path: source({ "LICENSE-MIT": MIT }) },
      {
        name: "b",
        version: "2.0.0",
        license: "MIT",
        manifest_path: source({ LICENSE: MIT.replace(/\r\n/g, "\n") }),
      },
      {
        name: "c",
        version: "3.0.0",
        license: "Apache-2.0",
        manifest_path: source({ "LICENSE-APACHE": "Apache text" }),
      },
      {
        name: "d",
        version: "4.0.0",
        license: "MIT",
        manifest_path: source({ "README.md": "no license here" }),
      },
    ];
    const policy = { rust: { allowed: ["MIT", "Apache-2.0"], exceptions: [] } };
    const text = rust.renderNotice(crates, policy);
    expect(text).toBe(rust.renderNotice(crates, policy));
    expect(text).toContain("Crates de runtime: 4.");
    expect(text).toContain("### 3.1. Usado por: a 1.0.0, b 2.0.0");
    expect(text).toContain("### 3.2. Usado por: c 3.0.0");
    expect((text.match(/Copyright \(c\) someone/g) ?? []).length).toBe(1);
    expect(text).toMatch(/## 4\. Crates sem arquivo de licença[\s\S]*d 4\.0\.0/);
    expect(text).not.toContain("## 2.");
    const withException = rust.renderNotice(crates, {
      rust: { allowed: [], exceptions: [{ crate: "a", license: "MPL-2.0", reason: "named" }] },
    });
    expect(withException).toContain("## 2. Crates sob `MPL-2.0`");
    expect(withException).toContain("- **a** (MPL-2.0): named");
  });
});

describe("C47 without cargo the check says so and passes; with --require-cargo it fails", () => {
  const noCargo = () => {
    throw new rust.NoCargo("cargo was not found on PATH");
  };
  it("C47 the skip is loud: it names what was not checked and the flag that requires it, and exits 0", () => {
    const c = capture();
    expect(rust.main(["--check"], c.io, noCargo)).toBe(0);
    expect(c.out).toMatch(/skipped \(cargo was not found on PATH\)/);
    expect(c.out).toContain("were NOT checked on this machine");
    expect(c.out).toContain("--require-cargo");
    const required = capture();
    expect(rust.main(["--check", "--require-cargo"], required.io, noCargo)).toBe(2);
    expect(required.err).toContain("cargo was not found");
    expect(rust.main(["--check", "--bogus"], capture().io, noCargo)).toBe(2);
    expect(rust.main([], capture().io, noCargo)).toBe(2);
  });

  it("C47 `npm run licenses:check` runs the npm check and then this one", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["licenses:check"]).toBe(
      "node scripts/licenses.mjs --check && node scripts/licenses-rust.mjs --check",
    );
  });

  it("C46 over a small tree: a violation exits 1, a stale or missing notice exits 1, a written notice then checks clean", () => {
    const root = temp();
    fs.mkdirSync(path.join(root, "legal"));
    const crateDir = temp();
    fs.writeFileSync(path.join(crateDir, "LICENSE"), "text");
    const meta = () => {
      const m = metadata({ app: [["dep", [null]]] }, { dep: "MIT" });
      m.packages.find((p: any) => p.name === "dep")!.manifest_path = path.join(crateDir, "Cargo.toml");
      return m;
    };
    const writePolicy = (allowed: string[]) =>
      fs.writeFileSync(
        path.join(root, "legal", "license-policy.json"),
        JSON.stringify({ rust: { allowed, exceptions: [] } }),
      );
    writePolicy(["MIT"]);
    const run = (flag: string) => {
      const c = capture();
      return { code: rust.main([flag, "--root", root], c.io, meta), ...c };
    };
    expect(run("--check").err).toContain("legal/THIRD_PARTY_NOTICES.desktop.md does not exist");
    expect(run("--write").code).toBe(0);
    const check = run("--check");
    expect(check.code, check.err).toBe(0);
    expect(check.out).toContain("ok (1 crates)");
    fs.appendFileSync(path.join(root, "legal", "THIRD_PARTY_NOTICES.desktop.md"), "edited by hand\n");
    const stale = run("--check");
    expect(stale.code).toBe(1);
    expect(stale.err).toContain("is stale");
    writePolicy(["Apache-2.0"]);
    const bad = run("--check");
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('dep 1.0.0: MIT is not in the "rust" policy');
    expect(run("--write").code).toBe(1);
  });
});

// ---- the real tree ---------------------------------------------------------------------------------------------

describe("C46 the policy of the real repository", () => {
  const policy = JSON.parse(fs.readFileSync(path.join(ROOT, "legal", "license-policy.json"), "utf8")) as any;
  it("C46 `rust.allowed` is the 12 of the runtime list plus Unicode-3.0 and CDLA-Permissive-2.0, and nothing copyleft", () => {
    expect(policy.rust.allowed).toEqual([...policy.allowedDistributed, "Unicode-3.0", "CDLA-Permissive-2.0"]);
    for (const id of policy.rust.allowed) expect(id).not.toMatch(/GPL|MPL|SSPL|EUPL|CC-BY|BUSL|Commons/);
  });

  it("C46 the exceptions are the five MPL-2.0 crates of the Tauri tree, each with a reason, and the tooling list keeps its own MPL", () => {
    expect(policy.rust.exceptions.map((e: any) => [e.crate, e.license])).toEqual([
      ["cssparser", "MPL-2.0"],
      ["cssparser-macros", "MPL-2.0"],
      ["dtoa-short", "MPL-2.0"],
      ["option-ext", "MPL-2.0"],
      ["selectors", "MPL-2.0"],
    ]);
    for (const e of policy.rust.exceptions) expect(e.reason.length, e.crate).toBeGreaterThan(80);
    expect(policy.allowedDistributed).not.toContain("MPL-2.0");
    expect(policy.allowedToolingExtra).toEqual(["MPL-2.0", "CC-BY-4.0"]);
  });

  const cargo = spawnSync("cargo", ["--version"], { encoding: "utf8" });
  it.runIf(cargo.status === 0)(
    "C46 the real graph, as cargo reports it, meets the policy and the committed notice is current (needs cargo)",
    () => {
      const res = spawnSync(
        process.execPath,
        [path.join(ROOT, "scripts", "licenses-rust.mjs"), "--check", "--require-cargo"],
        { encoding: "utf8", timeout: 300_000 },
      );
      expect(res.stderr, res.stderr).toBe("");
      expect(res.status).toBe(0);
      expect(res.stdout).toMatch(/licenses-rust: ok \(\d+ crates\)/);
    },
    320_000,
  );

  it("C46 the committed notice lists the crates in a table and the MPL exceptions", () => {
    const text = fs.readFileSync(path.join(ROOT, "legal", "THIRD_PARTY_NOTICES.desktop.md"), "utf8");
    const crates = sbomRust.noticeCrates(text);
    expect(crates.length).toBeGreaterThan(400);
    for (const name of ["tauri", "tauri-plugin-updater", "minisign-verify", "cssparser", "unicode-ident"])
      expect(
        crates.map((c: any) => c.name),
        name,
      ).toContain(name);
    expect(text).toContain("## 2. Crates sob `MPL-2.0`");
    expect(text.split("\n")[0]).toBe("# Avisos das crates Rust do app desktop — MordomoOS");
  });
});

// ---- the SBOM of the crates --------------------------------------------------------------------------------------------

describe("C48 the SBOM of the Rust crates is a valid CycloneDX 1.5 document with the crates of the notice", async () => {
  const { default: Ajv } = (await import("ajv")) as any;
  const schema = (f: string) =>
    JSON.parse(fs.readFileSync(path.join(ROOT, "legal", "vendor", "cyclonedx", f), "utf8"));
  const ajv = new Ajv({ strict: false, allErrors: true });
  ajv.addFormat("iri-reference", /^\S+$/);
  ajv.addFormat("idn-email", /^[^@\s]+@[^@\s]+$/);
  ajv.addSchema(schema("spdx.schema.json"));
  ajv.addSchema(schema("jsf-0.82.schema.json"));
  const validate = ajv.compile(schema("bom-1.5.schema.json"));
  const bom = sbomRust.buildRustSbom(ROOT);

  it("C48 it validates against the official schema, with a unique reference per crate and no dependency on nothing", () => {
    expect(validate(bom), JSON.stringify(validate.errors)).toBe(true);
    const refs = bom.components.map((c: any) => c["bom-ref"]);
    expect(new Set(refs).size).toBe(refs.length);
    expect(bom.dependencies[0].dependsOn).toEqual(refs);
    expect(bom.metadata.component["bom-ref"]).toBe(
      `pkg:cargo/mordomo-desktop@${(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as any).version}`,
    );
  });

  it("C48 its components are the crates of the notice, each with its purl, its declared license and the SHA-256 of Cargo.lock", () => {
    const notice = sbomRust.noticeCrates(
      fs.readFileSync(path.join(ROOT, "legal", "THIRD_PARTY_NOTICES.desktop.md"), "utf8"),
    );
    expect(bom.components.map((c: any) => `${c.name}@${c.version}`).sort()).toEqual(
      notice.map((c: any) => `${c.name}@${c.version}`).sort(),
    );
    const lock = sbomRust.lockChecksums(
      fs.readFileSync(path.join(ROOT, "apps", "desktop", "Cargo.lock"), "utf8"),
    );
    for (const c of bom.components) {
      expect(c.purl).toBe(`pkg:cargo/${c.name}@${c.version}`);
      expect(c.hashes, c.name).toEqual([{ alg: "SHA-256", content: lock.get(`${c.name}@${c.version}`) }]);
      expect(c.licenses.length, c.name).toBeGreaterThan(0);
    }
    const tauri = bom.components.find((c: any) => c.name === "tauri");
    expect(tauri.licenses).toEqual([{ expression: "Apache-2.0 OR MIT" }]);
    expect(bom.components.find((c: any) => c.name === "cssparser").licenses).toEqual([
      { license: { id: "MPL-2.0" } },
    ]);
  });

  it("C48 it is the same bytes twice, and the desktop payload carries it as legal/sbom.desktop.cdx.json beside the notice", () => {
    expect(JSON.stringify(sbomRust.buildRustSbom(ROOT))).toBe(JSON.stringify(bom));
    const payload = temp();
    fs.mkdirSync(path.join(payload, "legal"));
    stage.stageDesktopLegal(ROOT, payload);
    expect(JSON.parse(fs.readFileSync(path.join(payload, "legal", "sbom.desktop.cdx.json"), "utf8"))).toEqual(
      bom,
    );
  });
});
