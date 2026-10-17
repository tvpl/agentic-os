import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
/* The scripts are plain ESM without declarations: what the tests use of them is checked by running it. */
const versionSync: any = await import("../scripts/version-sync.mjs");
const releaseNotes: any = await import("../scripts/release-notes.mjs");
const collect: any = await import("../scripts/release-collect.mjs");
const manifest: any = await import("../scripts/updater-manifest.mjs");
const updaterConfig: any = await import("../scripts/updater-config.mjs");
const desktopBuild: any = await import("../scripts/desktop-build.mjs");
const payloadGuard: any = await import("../scripts/payload-guard.mjs");
const minisign: any = await import("../scripts/minisign.mjs");
const staleAssets: any = await import("../scripts/release-stale-assets.mjs");

/**
 * distribuicao: the scripts the release leans on (.specs/features/distribuicao, AC 34-36, 39-41).
 * Each runs against a small tree built here, and the version script also against the real one.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temps: string[] = [];
const temp = (prefix: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

interface Io {
  out: string;
  err: string;
  io: { out: (s: string) => void; err: (s: string) => void };
}
const capture = (): Io => {
  const c: Io = { out: "", err: "", io: { out: (s) => (c.out += s), err: (s) => (c.err += s) } };
  return c;
};
const run = (main: (argv: string[], io: Io["io"]) => number, argv: string[]) => {
  const c = capture();
  return { code: main(argv, c.io), out: c.out, err: c.err };
};

// ---- version-sync ------------------------------------------------------------------------------------------

function versionTree(version = "1.2.3"): string {
  const root = temp("mordomo-vs-");
  const put = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
  put(
    "package.json",
    json({ name: "mordomo-os", version, workspaces: ["core", "apps/api", "apps/desktop"] }),
  );
  put("core/package.json", json({ name: "@mordomo/core", version }));
  put(
    "apps/api/package.json",
    json({ name: "@mordomo/api", version, dependencies: { "@mordomo/core": version, zod: "^3.25.0" } }),
  );
  put(
    "apps/desktop/package.json",
    json({ name: "@mordomo/desktop", version, devDependencies: { "@tauri-apps/cli": "2.12.2" } }),
  );
  put(
    "package-lock.json",
    json({
      lockfileVersion: 3,
      packages: {
        "": { name: "mordomo-os", version },
        core: { name: "@mordomo/core", version },
        "apps/api": {
          name: "@mordomo/api",
          version,
          dependencies: { "@mordomo/core": version, zod: "^3.25.0" },
        },
        "apps/desktop": { name: "@mordomo/desktop", version },
        "node_modules/zod": { version: "3.25.1" },
      },
    }),
  );
  put("apps/desktop/src-tauri/tauri.conf.json", json({ productName: "MordomoOS", version }));
  put(
    "apps/desktop/Cargo.toml",
    `[workspace]\nmembers = ["shell-core"]\n\n[workspace.package]\nversion = "${version}"\nedition = "2021"\n`,
  );
  put(
    "apps/desktop/Cargo.lock",
    `version = 4\n\n[[package]]\nname = "libc"\nversion = "0.2.1"\n\n[[package]]\nname = "mordomo-desktop"\nversion = "${version}"\ndependencies = [\n "libc",\n]\n\n[[package]]\nname = "mordomo-shell-core"\nversion = "${version}"\n`,
  );
  return root;
}

describe("C33 version-sync --check names every place whose version differs", () => {
  it("C33 a consistent tree passes, and the places counted are the ones of the plan", () => {
    const root = versionTree();
    const res = run(versionSync.main, ["--check", "--root", root]);
    expect(res.err).toBe("");
    expect(res.code).toBe(0);
    const places = versionSync
      .readVersions(root)
      .map((p: { file: string; what: string }) => `${p.file} ${p.what}`);
    expect(places).toEqual([
      "package.json version",
      "core/package.json version",
      "apps/api/package.json version",
      "apps/api/package.json dependencies.@mordomo/core",
      "apps/desktop/package.json version",
      'package-lock.json packages[""].version',
      'package-lock.json packages["apps/api"].version',
      'package-lock.json packages["apps/api"].dependencies.@mordomo/core',
      'package-lock.json packages["apps/desktop"].version',
      'package-lock.json packages["core"].version',
      "apps/desktop/src-tauri/tauri.conf.json version",
      "apps/desktop/Cargo.toml [workspace.package] version",
      "apps/desktop/Cargo.lock crate mordomo-desktop",
      "apps/desktop/Cargo.lock crate mordomo-shell-core",
    ]);
  });

  const mutations: Array<[string, string, (text: string) => string]> = [
    ["a workspace package.json", "core/package.json", (t) => t.replace('"1.2.3"', '"1.2.4"')],
    [
      "the desktop package.json",
      "apps/desktop/package.json",
      (t) => t.replace('"version": "1.2.3"', '"version": "9.9.9"'),
    ],
    [
      "an exact @mordomo pin",
      "apps/api/package.json",
      (t) => t.replace('"@mordomo/core": "1.2.3"', '"@mordomo/core": "1.2.2"'),
    ],
    [
      "the lockfile's workspace entry",
      "package-lock.json",
      (t) =>
        t.replace(
          '"name": "@mordomo/core",\n      "version": "1.2.3"',
          '"name": "@mordomo/core",\n      "version": "1.0.0"',
        ),
    ],
    ["tauri.conf.json", "apps/desktop/src-tauri/tauri.conf.json", (t) => t.replace("1.2.3", "1.2.0")],
    ["Cargo.toml", "apps/desktop/Cargo.toml", (t) => t.replace('version = "1.2.3"', 'version = "1.2.5"')],
    [
      "a crate of Cargo.lock",
      "apps/desktop/Cargo.lock",
      (t) =>
        t.replace(
          'name = "mordomo-shell-core"\nversion = "1.2.3"',
          'name = "mordomo-shell-core"\nversion = "0.0.1"',
        ),
    ],
  ];
  for (const [what, file, mutate] of mutations)
    it(`C33 ${what} that differs exits 1 and names ${file}`, () => {
      const root = versionTree();
      const target = path.join(root, file);
      const before = fs.readFileSync(target, "utf8");
      fs.writeFileSync(target, mutate(before));
      expect(fs.readFileSync(target, "utf8")).not.toBe(before);
      const res = run(versionSync.main, ["--check", "--root", root]);
      expect(res.code).toBe(1);
      expect(res.err).toContain(file);
      expect(res.err).toContain("expected 1.2.3");
    });

  it("C33 a root version that is not semantic, and a missing file, are reported, not guessed", () => {
    const root = versionTree();
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "x", version: "1.2", workspaces: [] }),
    );
    expect(run(versionSync.main, ["--check", "--root", root]).code).toBe(1);
    fs.rmSync(path.join(root, "apps/desktop/Cargo.lock"));
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "x", version: "1.2.3", workspaces: ["core"] }),
    );
    expect(run(versionSync.main, ["--check", "--root", root]).code).toBe(2);
  });

  it("C33 the real repository is in step (every place of the plan, one version)", () => {
    const res = run(versionSync.main, ["--check"]);
    expect(res.err).toBe("");
    expect(res.code).toBe(0);
    const rootVersion = (
      JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string }
    ).version;
    expect(new Set(versionSync.readVersions(ROOT).map((p: { version: string }) => p.version))).toEqual(
      new Set([rootVersion]),
    );
    expect(versionSync.packageFiles(ROOT)).toContain("apps/desktop/package.json");
  });
});

describe("C34 a tag has to be v<version>", () => {
  it("C34 v<version> passes; another tag, no v, a prefix and a longer version fail with exit 1", () => {
    const root = versionTree("1.2.3");
    expect(run(versionSync.main, ["--check", "--tag", "v1.2.3", "--root", root]).code).toBe(0);
    for (const tag of ["v1.2.4", "1.2.3", "v1.2", "v1.2.3.1", "release-1.2.3", "v1.2.3-rc.1", "V1.2.3"]) {
      const res = run(versionSync.main, ["--check", "--tag", tag, "--root", root]);
      expect(res.code, tag).toBe(1);
      expect(res.err, tag).toContain("is not v1.2.3");
    }
    expect(run(versionSync.main, ["--check", "--tag", "", "--root", root]).code).toBe(2);
    expect(run(versionSync.main, ["--tag", "v1.2.3", "--root", root]).code).toBe(2);
  });
});

describe("C35 version-sync --write sets every place and --check then passes", () => {
  it("C35 --write 2.0.0-rc.1 changes all 14 places, including the exact pins, and leaves the other dependencies alone", () => {
    const root = versionTree("1.2.3");
    expect(run(versionSync.main, ["--write", "2.0.0-rc.1", "--root", root]).code).toBe(0);
    expect(run(versionSync.main, ["--check", "--tag", "v2.0.0-rc.1", "--root", root]).code).toBe(0);
    const api = JSON.parse(fs.readFileSync(path.join(root, "apps/api/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(api.dependencies).toEqual({ "@mordomo/core": "2.0.0-rc.1", zod: "^3.25.0" });
    const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8")) as {
      packages: Record<string, { version: string }>;
    };
    expect(lock.packages["node_modules/zod"]!.version).toBe("3.25.1");
    expect(fs.readFileSync(path.join(root, "apps/desktop/Cargo.lock"), "utf8")).toContain(
      'name = "libc"\nversion = "0.2.1"',
    );
    expect(fs.readFileSync(path.join(root, "apps/desktop/Cargo.toml"), "utf8")).toContain('edition = "2021"');
  });

  it("C35 a version that is not semantic is refused with exit 2 and nothing is written", () => {
    const root = versionTree("1.2.3");
    for (const bad of ["1.2", "v1.2.3", "1.2.3.4", "latest", "01.2.3x", ""]) {
      expect(run(versionSync.main, ["--write", bad, "--root", root]).code, bad).toBe(2);
    }
    expect(run(versionSync.main, ["--check", "--root", root]).code).toBe(0);
  });
});

// ---- release notes -----------------------------------------------------------------------------------------

const CHANGELOG = `# Changelog

## Unreleased

- something new

## 1.2.3 — 2026-10-01

- the fix
- another line

## [1.2.2] - 2026-09-01

- older

## 1.2.1

## 1.2.0 — 2026-08-01

- oldest
`;

describe("C42 the notes of a release come from the CHANGELOG section of its version", () => {
  it("C42 the section is found under an em dash, a hyphen with brackets, and stops at the next ## heading", () => {
    expect(releaseNotes.changelogSection(CHANGELOG, "1.2.3")).toBe("- the fix\n- another line");
    expect(releaseNotes.changelogSection(CHANGELOG, "1.2.2")).toBe("- older");
    expect(releaseNotes.changelogSection(CHANGELOG.replace(/\n/g, "\r\n"), "1.2.3")).toBe(
      "- the fix\n- another line",
    );
  });

  it("C44 a version with no section, an empty section, a prefix of another version and `Unreleased` are all refused", () => {
    expect(releaseNotes.changelogSection(CHANGELOG, "9.9.9")).toBeNull();
    expect(releaseNotes.changelogSection(CHANGELOG, "1.2.1")).toBeNull();
    expect(releaseNotes.changelogSection(CHANGELOG, "1.2")).toBeNull();
    expect(releaseNotes.changelogSection(CHANGELOG, "1.2.30")).toBeNull();
    expect(releaseNotes.changelogSection(CHANGELOG, "Unreleased")).not.toBeNull(); // a heading is a heading: the CLI never passes it
    const root = temp("mordomo-notes-");
    fs.writeFileSync(path.join(root, "CHANGELOG.md"), CHANGELOG);
    const refused = run(releaseNotes.main, ["--version", "9.9.9", "--check", "--root", root]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('has no section "## 9.9.9"');
    expect(run(releaseNotes.main, ["--version", "1.2.3", "--check", "--root", root]).code).toBe(0);
    expect(run(releaseNotes.main, ["--check", "--root", root]).code).toBe(2);
  });

  const status = (
    platform: string,
    codeSigned: boolean | null,
    notarized: boolean | null,
    updaterSigned: boolean,
  ) => ({
    platform,
    codeSigned,
    notarized,
    updaterSigned,
  });

  it("C42 an unsigned platform is named in a banner at the top and in the table; Linux says it has no operating-system signature", () => {
    const text: string = releaseNotes.renderNotes("1.2.3", "- the fix", [
      status("windows-x64", false, null, false),
      status("macos-arm64", true, true, true),
      status("linux-x64", null, null, false),
      status("macos-x64", false, false, false),
    ]);
    expect(text.split("\n")[0]).toContain("UNSIGNED / NÃO ASSINADO: macos-x64, windows-x64");
    expect(text).toContain("- the fix");
    expect(text).toContain("| macos-arm64 | yes | yes | yes |");
    expect(text).toContain("| macos-x64 | NO | NO | no (no updater key) |");
    expect(text).toContain("| windows-x64 | NO | not applicable | no (no updater key) |");
    expect(text).toContain("| linux-x64 | not applicable | not applicable | no (no updater key) |");
    expect(text).toContain("Linux packages carry no operating-system signature");
    // a fully signed release has no banner
    const clean: string = releaseNotes.renderNotes("1.2.3", "- the fix", [
      status("macos-arm64", true, true, true),
      status("linux-x64", null, null, true),
    ]);
    expect(clean).not.toContain("UNSIGNED");
    expect(clean.startsWith("- the fix")).toBe(true);
  });

  it("C42 the status files are read from a folder tree, and the notes are written to --out", () => {
    const root = temp("mordomo-notes2-");
    fs.writeFileSync(path.join(root, "CHANGELOG.md"), CHANGELOG);
    fs.mkdirSync(path.join(root, "artifacts", "nested"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "artifacts", "status-windows-x64.json"),
      JSON.stringify(status("windows-x64", false, null, false)),
    );
    fs.writeFileSync(
      path.join(root, "artifacts", "nested", "status-linux-x64.json"),
      JSON.stringify(status("linux-x64", null, null, false)),
    );
    fs.writeFileSync(path.join(root, "artifacts", "other.json"), "{}");
    const res = run(releaseNotes.main, [
      "--version",
      "1.2.3",
      "--status",
      "artifacts",
      "--out",
      "notes.md",
      "--root",
      root,
    ]);
    expect(res.code).toBe(0);
    const notes = fs.readFileSync(path.join(root, "notes.md"), "utf8");
    expect(notes).toContain("UNSIGNED / NÃO ASSINADO: windows-x64");
    expect(notes).toContain("| linux-x64 |");
  });
});

// ---- release-collect and the updater manifest -----------------------------------------------------------------

/** What `tauri build` leaves: with `withSigs` as with the updater key (`createUpdaterArtifacts`), without as with no key. */
function bundleTree(platform: string, withSigs: boolean): string {
  const bundle = temp("mordomo-bundle-");
  const spec = (collect.PLATFORMS as Record<string, { os: string }>)[platform]!;
  const put = (rel: string) => {
    fs.mkdirSync(path.dirname(path.join(bundle, rel)), { recursive: true });
    fs.writeFileSync(path.join(bundle, rel), `bytes of ${rel}`);
  };
  const sig = (rel: string) => put(`${rel}.sig`);
  if (spec.os === "macos") {
    put("dmg/MordomoOS_1.2.3_aarch64.dmg");
    // The bundler writes the `.app` folder always and the `.app.tar.gz` (with its .sig) only under
    // `createUpdaterArtifacts`, i.e. with an updater key (tauri-bundler `bundle.rs`: `if let Some(updater)`).
    put("macos/MordomoOS.app/Contents/Info.plist");
    if (withSigs) {
      put("macos/MordomoOS.app.tar.gz");
      sig("macos/MordomoOS.app.tar.gz");
    }
  } else if (spec.os === "windows") {
    put("nsis/MordomoOS_1.2.3_x64-setup.exe");
    if (withSigs) sig("nsis/MordomoOS_1.2.3_x64-setup.exe");
  } else {
    put("deb/MordomoOS_1.2.3_amd64.deb");
    put("appimage/MordomoOS_1.2.3_amd64.AppImage");
    // the .deb is signed too when the key is there (seen in a real build)
    if (withSigs) {
      sig("deb/MordomoOS_1.2.3_amd64.deb");
      sig("appimage/MordomoOS_1.2.3_amd64.AppImage");
    }
  }
  return bundle;
}

describe("C40 an installer the operating system will not trust says so in its name", () => {
  const base = { version: "1.2.3", notarized: false };
  it("C40 macOS and Windows built without a certificate carry _UNSIGNED, and their status says so", () => {
    for (const [platform, files] of [
      // no secrets at all (AC 39): the bundle has the .dmg and the .app folder, no updater archive
      ["macos-arm64", ["MordomoOS_1.2.3_macos-arm64_UNSIGNED.dmg"]],
      ["windows-x64", ["MordomoOS_1.2.3_windows-x64_UNSIGNED-setup.exe"]],
    ] as const) {
      const out = temp("mordomo-out-");
      const res = collect.collect({
        ...base,
        platform,
        bundle: bundleTree(platform, false),
        out,
        codeSigned: false,
        updaterSigned: false,
      });
      expect(res.written).toEqual(files);
      expect(fs.readdirSync(out).sort()).toEqual([...files, `status-${platform}.json`].sort());
      const status = JSON.parse(fs.readFileSync(path.join(out, `status-${platform}.json`), "utf8")) as Record<
        string,
        unknown
      >;
      expect(status).toMatchObject({ platform, codeSigned: false, updaterSigned: false });
    }
  });

  it("C40 signed builds carry no label; with an updater key the file that is signed is uploaded with its .sig", () => {
    const out = temp("mordomo-out-");
    const res = collect.collect({
      ...base,
      platform: "macos-x64",
      bundle: bundleTree("macos-x64", true),
      out,
      codeSigned: true,
      notarized: true,
      updaterSigned: true,
    });
    expect(res.written).toEqual([
      "MordomoOS_1.2.3_macos-x64.dmg",
      "MordomoOS_1.2.3_macos-x64.app.tar.gz",
      "MordomoOS_1.2.3_macos-x64.app.tar.gz.sig",
    ]);
    expect(res.status).toEqual({
      platform: "macos-x64",
      codeSigned: true,
      notarized: true,
      updaterSigned: true,
    });
  });

  it("C40 with the updater key Linux uploads the .sig of the AppImage and of the .deb, which Tauri signs too", () => {
    const out = temp("mordomo-out-");
    const res = collect.collect({
      ...base,
      platform: "linux-x64",
      bundle: bundleTree("linux-x64", true),
      out,
      codeSigned: false,
      updaterSigned: true,
    });
    expect(res.written).toEqual([
      "MordomoOS_1.2.3_linux-x64.deb",
      "MordomoOS_1.2.3_linux-x64.deb.sig",
      "MordomoOS_1.2.3_linux-x64.AppImage",
      "MordomoOS_1.2.3_linux-x64.AppImage.sig",
    ]);
  });

  it("C40 Linux never says UNSIGNED (it has no operating-system signature) and its status says null", () => {
    const out = temp("mordomo-out-");
    const res = collect.collect({
      ...base,
      platform: "linux-x64",
      bundle: bundleTree("linux-x64", false),
      out,
      codeSigned: false,
      updaterSigned: false,
    });
    expect(res.written).toEqual(["MordomoOS_1.2.3_linux-x64.deb", "MordomoOS_1.2.3_linux-x64.AppImage"]);
    expect(res.status).toEqual({
      platform: "linux-x64",
      codeSigned: null,
      notarized: null,
      updaterSigned: false,
    });
  });

  it("C40 with the updater key a Linux bundle whose .deb has no .sig fails (the manifest needs it for the .deb entry)", () => {
    const bundle = bundleTree("linux-x64", true);
    fs.rmSync(path.join(bundle, "deb", "MordomoOS_1.2.3_amd64.deb.sig"));
    expect(() =>
      collect.collect({
        ...base,
        platform: "linux-x64",
        bundle,
        out: temp("o-"),
        codeSigned: false,
        updaterSigned: true,
      }),
    ).toThrow(/deb.*\.sig is missing though the updater key/);
  });

  it("C40 AC 39: with no secret at all the four platforms still collect (macOS has the .dmg and no updater archive), and the draft says everything is unsigned", () => {
    const out = temp("mordomo-out-");
    const files: string[] = [];
    for (const platform of Object.keys(collect.PLATFORMS)) {
      const os = (collect.PLATFORMS as Record<string, { os: string }>)[platform]!.os;
      const res = collect.collect({
        ...base,
        platform,
        bundle: bundleTree(platform, false),
        out,
        codeSigned: false,
        updaterSigned: false,
      });
      // no updater archive and no .sig anywhere: nothing the bundler does not write without a key
      expect(res.written.some((n: string) => n.endsWith(".sig") || n.endsWith(".app.tar.gz"))).toBe(false);
      if (os === "macos") expect(res.written).toEqual([`MordomoOS_1.2.3_${platform}_UNSIGNED.dmg`]);
      files.push(...res.written);
    }
    expect(files).toEqual([
      "MordomoOS_1.2.3_macos-arm64_UNSIGNED.dmg",
      "MordomoOS_1.2.3_macos-x64_UNSIGNED.dmg",
      "MordomoOS_1.2.3_windows-x64_UNSIGNED-setup.exe",
      "MordomoOS_1.2.3_linux-x64.deb",
      "MordomoOS_1.2.3_linux-x64.AppImage",
    ]);
    // what the publish job does next with that folder: notes with the banner, and no latest.json (exit 3)
    const root = temp("mordomo-notes3-");
    fs.writeFileSync(path.join(root, "CHANGELOG.md"), "## 1.2.3\n\n- the fix\n");
    const notes = run(releaseNotes.main, [
      "--version",
      "1.2.3",
      "--status",
      out,
      "--out",
      "notes.md",
      "--root",
      root,
    ]);
    expect(notes.code, notes.err).toBe(0);
    expect(fs.readFileSync(path.join(root, "notes.md"), "utf8")).toContain(
      "UNSIGNED / NÃO ASSINADO: macos-arm64, macos-x64, windows-x64",
    );
    const latest = path.join(out, "latest.json");
    const m = run(manifest.main, ["--dir", out, "--version", "1.2.3", "--tag", "v1.2.3", "--out", latest]);
    expect(m.code).toBe(3);
    expect(fs.existsSync(latest)).toBe(false);
  });

  it("C40 macOS signed by the operating system but with no updater key: the .dmg alone, no label; with the key the archive is required and shipped with its .sig", () => {
    const out = temp("mordomo-out-");
    const noKey = collect.collect({
      ...base,
      platform: "macos-arm64",
      bundle: bundleTree("macos-arm64", false),
      out,
      codeSigned: true,
      notarized: true,
      updaterSigned: false,
    });
    expect(noKey.written).toEqual(["MordomoOS_1.2.3_macos-arm64.dmg"]);
    // updater on but the archive was not written (the key was not really used): fail, naming the folder
    const archiveless = bundleTree("macos-arm64", false);
    expect(() =>
      collect.collect({
        ...base,
        platform: "macos-arm64",
        bundle: archiveless,
        out: temp("o-"),
        codeSigned: true,
        updaterSigned: true,
      }),
    ).toThrow(/macos: expected one file matching .*tar.*found 0/);
    // an archive that no key asked for is refused rather than shipped unsigned
    expect(() =>
      collect.collect({
        ...base,
        platform: "macos-arm64",
        bundle: bundleTree("macos-arm64", true),
        out: temp("o-"),
        codeSigned: true,
        updaterSigned: false,
      }),
    ).toThrow(/exists though no updater key/);
  });

  it("C40 a missing installer, a missing .sig when the key was configured, and a .sig when it was not, all fail", () => {
    const args = { ...base, platform: "windows-x64", codeSigned: true };
    expect(() =>
      collect.collect({ ...args, bundle: temp("mordomo-empty-"), out: temp("o-"), updaterSigned: false }),
    ).toThrow(/expected one file/);
    expect(() =>
      collect.collect({
        ...args,
        bundle: bundleTree("windows-x64", false),
        out: temp("o-"),
        updaterSigned: true,
      }),
    ).toThrow(/is missing though the updater key/);
    expect(() =>
      collect.collect({
        ...args,
        bundle: bundleTree("windows-x64", true),
        out: temp("o-"),
        updaterSigned: false,
      }),
    ).toThrow(/exists though no updater key/);
    expect(() =>
      collect.collect({
        ...args,
        platform: "plan9-x64",
        bundle: temp("b-"),
        out: temp("o-"),
        updaterSigned: false,
      }),
    ).toThrow(/unknown platform/);
    const cli = run(collect.main, ["--platform", "windows-x64"]);
    expect(cli.code).toBe(1);
    expect(cli.err).toContain("--bundle is required");
  });
});

describe("C43 latest.json exists only when it can be complete, and names the four platforms", () => {
  /** A folder as the publish job finds it after the four package jobs. */
  function releaseDir(
    overrides: Partial<Record<string, { codeSigned?: boolean | null; updaterSigned?: boolean }>> = {},
  ): string {
    const dir = temp("mordomo-release-");
    for (const platform of Object.keys(collect.PLATFORMS)) {
      const o = overrides[platform] ?? {};
      const os = (collect.PLATFORMS as Record<string, { os: string }>)[platform]!.os;
      const codeSigned = o.codeSigned ?? (os === "linux" ? null : true);
      const updaterSigned = o.updaterSigned ?? true;
      fs.writeFileSync(
        path.join(dir, `status-${platform}.json`),
        JSON.stringify({ platform, codeSigned, notarized: null, updaterSigned }),
      );
      const file = `MordomoOS_1.2.3_${platform}${os === "macos" ? ".app.tar.gz" : os === "windows" ? "-setup.exe" : ".AppImage"}`;
      fs.writeFileSync(path.join(dir, file), "installer");
      if (updaterSigned) fs.writeFileSync(path.join(dir, `${file}.sig`), `signature of ${platform}\n`);
      if (os === "linux") {
        fs.writeFileSync(path.join(dir, `MordomoOS_1.2.3_${platform}.deb`), "deb");
        if (updaterSigned)
          fs.writeFileSync(path.join(dir, `MordomoOS_1.2.3_${platform}.deb.sig`), `signature of the deb\n`);
      }
    }
    return dir;
  }
  const args = {
    version: "1.2.3",
    tag: "v1.2.3",
    notes: "the notes",
    date: "2026-10-12T00:00:00.000Z",
    repo: "tvpl/agentic-os",
  };

  it("C43 four signed platforms give the Tauri static manifest: version, notes, pub_date and a signature and url per target", () => {
    const result = manifest.buildManifest({ ...args, dir: releaseDir() });
    expect(result.missing).toBeUndefined();
    expect(result.manifest).toEqual({
      version: "1.2.3",
      notes: "the notes",
      pub_date: "2026-10-12T00:00:00.000Z",
      platforms: {
        "darwin-aarch64": {
          signature: "signature of macos-arm64",
          url: "https://github.com/tvpl/agentic-os/releases/download/v1.2.3/MordomoOS_1.2.3_macos-arm64.app.tar.gz",
        },
        "darwin-x86_64": {
          signature: "signature of macos-x64",
          url: "https://github.com/tvpl/agentic-os/releases/download/v1.2.3/MordomoOS_1.2.3_macos-x64.app.tar.gz",
        },
        "windows-x86_64": {
          signature: "signature of windows-x64",
          url: "https://github.com/tvpl/agentic-os/releases/download/v1.2.3/MordomoOS_1.2.3_windows-x64-setup.exe",
        },
        "linux-x86_64": {
          signature: "signature of linux-x64",
          url: "https://github.com/tvpl/agentic-os/releases/download/v1.2.3/MordomoOS_1.2.3_linux-x64.AppImage",
        },
        // an installed .deb asks for `linux-x86_64-deb` first (tauri-plugin-updater get_urls) and cannot install an AppImage
        "linux-x86_64-deb": {
          signature: "signature of the deb",
          url: "https://github.com/tvpl/agentic-os/releases/download/v1.2.3/MordomoOS_1.2.3_linux-x64.deb",
        },
      },
    });
  });

  it("C43 a .deb that is missing, or whose .sig is, leaves the manifest out (a .deb install would be told to fetch an AppImage)", () => {
    const noSig = releaseDir();
    fs.rmSync(path.join(noSig, "MordomoOS_1.2.3_linux-x64.deb.sig"));
    expect(manifest.buildManifest({ ...args, dir: noSig }).missing.join("\n")).toContain(
      "linux-x64: MordomoOS_1.2.3_linux-x64.deb or its .sig is not in",
    );
    const noDeb = releaseDir();
    fs.rmSync(path.join(noDeb, "MordomoOS_1.2.3_linux-x64.deb"));
    expect(manifest.buildManifest({ ...args, dir: noDeb }).missing.join("\n")).toContain(
      "a .deb install could not update",
    );
  });

  const gaps: Array<[string, Parameters<typeof releaseDir>[0], RegExp]> = [
    [
      "a platform with no updater signature",
      { "linux-x64": { updaterSigned: false } },
      /linux-x64: no updater signature/,
    ],
    [
      "a macOS build the system will not trust",
      { "macos-arm64": { codeSigned: false } },
      /macos-arm64: not signed by the operating system/,
    ],
    [
      "a Windows build the system will not trust",
      { "windows-x64": { codeSigned: false } },
      /windows-x64: not signed by the operating system/,
    ],
  ];
  for (const [what, overrides, message] of gaps)
    it(`C43 ${what}: no manifest, exit 3 and the reason`, () => {
      const dir = releaseDir(overrides);
      expect(manifest.buildManifest({ ...args, dir }).missing.join("\n")).toMatch(message);
      const out = path.join(dir, "latest.json");
      const res = run(manifest.main, ["--dir", dir, "--version", "1.2.3", "--tag", "v1.2.3", "--out", out]);
      expect(res.code).toBe(3);
      expect(res.err).toMatch(message);
      expect(fs.existsSync(out)).toBe(false);
    });

  it("C43 a platform whose job never finished, and a file that is not there, leave the manifest out; a tag that is not v<version> is a usage error", () => {
    const dir = releaseDir();
    fs.rmSync(path.join(dir, "status-windows-x64.json"));
    expect(manifest.buildManifest({ ...args, dir }).missing.join("\n")).toContain(
      "windows-x64: no status-windows-x64.json",
    );
    const dir2 = releaseDir();
    fs.rmSync(path.join(dir2, "MordomoOS_1.2.3_macos-x64.app.tar.gz.sig"));
    expect(manifest.buildManifest({ ...args, dir: dir2 }).missing.join("\n")).toContain(
      "macos-x64: MordomoOS_1.2.3_macos-x64.app.tar.gz or its .sig",
    );
    const bad = run(manifest.main, [
      "--dir",
      dir,
      "--version",
      "1.2.3",
      "--tag",
      "v1.2.4",
      "--out",
      path.join(dir, "latest.json"),
    ]);
    expect(bad.code).toBe(2);
  });

  it("C43 the CLI writes latest.json when everything is there (exit 0)", () => {
    const dir = releaseDir();
    const notes = path.join(dir, "notes.md");
    fs.writeFileSync(notes, "  Notes of 1.2.3\n");
    const out = path.join(dir, "latest.json");
    const res = run(manifest.main, [
      "--dir",
      dir,
      "--version",
      "1.2.3",
      "--tag",
      "v1.2.3",
      "--notes",
      notes,
      "--out",
      out,
      "--date",
      "2026-10-12T00:00:00.000Z",
    ]);
    expect(res.code, res.err).toBe(0);
    const written = JSON.parse(fs.readFileSync(out, "utf8")) as {
      notes: string;
      platforms: Record<string, unknown>;
    };
    expect(written.notes).toBe("Notes of 1.2.3");
    expect(Object.keys(written.platforms).sort()).toEqual([
      "darwin-aarch64",
      "darwin-x86_64",
      "linux-x86_64",
      "linux-x86_64-deb",
      "windows-x86_64",
    ]);
  });
});

// ---- the updater's configuration --------------------------------------------------------------------------------

describe("C32 the updater's public key is the owner's, a placeholder, or refused", () => {
  const minisign = (comment: string, key: Buffer) =>
    Buffer.from(`untrusted comment: ${comment}\n${key.toString("base64")}\n`).toString("base64");
  const realKey = Buffer.concat([Buffer.from("Ed"), Buffer.alloc(8, 7), Buffer.alloc(32, 9)]);

  it("C32 a minisign public key as `tauri signer generate` writes it is valid; the placeholder is a placeholder; the rest is invalid", () => {
    expect(updaterConfig.keyState(minisign("minisign public key: ABCD", realKey))).toBe("valid");
    expect(updaterConfig.keyState("[A PREENCHER PELO DONO: chave publica minisign]")).toBe("placeholder");
    for (const bad of [
      "",
      undefined,
      null,
      42,
      "not base64 at all !!",
      minisign("something else", realKey),
      minisign("minisign public key: ABCD", Buffer.concat([Buffer.from("Ed"), Buffer.alloc(39)])), // 41 bytes
      minisign("minisign public key: ABCD", Buffer.concat([Buffer.from("XX"), Buffer.alloc(40)])), // not Ed25519
      Buffer.from("untrusted comment: minisign public key: ABCD\n").toString("base64"), // no key line
    ])
      expect(updaterConfig.keyState(bad), String(bad)).toBe("invalid");
  });

  it("C32 the committed file is well formed with exactly the one GitHub endpoint, and a key that is a placeholder or valid", () => {
    const res = updaterConfig.inspect(ROOT);
    expect(res.problems).toEqual([]);
    expect(["placeholder", "valid"]).toContain(res.state);
    expect(updaterConfig.ENDPOINT).toBe(
      "https://github.com/tvpl/agentic-os/releases/latest/download/latest.json",
    );
    expect(run(updaterConfig.main, ["--check"]).code).toBe(0);
  });

  it("C32 another endpoint, a second endpoint, plain http, a missing flag and a bad key each fail --check", () => {
    const file = "apps/desktop/src-tauri/tauri.updater.conf.json";
    const good = JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8")) as Record<string, any>;
    const cases: Array<[string, (c: Record<string, any>) => void, RegExp]> = [
      [
        "another endpoint",
        (c) => (c.plugins.updater.endpoints = ["https://example.com/latest.json"]),
        /endpoints must be exactly/,
      ],
      [
        "two endpoints",
        (c) => c.plugins.updater.endpoints.push("https://example.com/x.json"),
        /endpoints must be exactly/,
      ],
      ["no endpoint", (c) => delete c.plugins.updater.endpoints, /endpoints must be exactly/],
      ["no artifacts flag", (c) => delete c.bundle.createUpdaterArtifacts, /createUpdaterArtifacts/],
      [
        "insecure transport",
        (c) => (c.plugins.updater.dangerousInsecureTransportProtocol = true),
        /dangerousInsecureTransportProtocol/,
      ],
      ["a bad key", (c) => (c.plugins.updater.pubkey = "garbage"), /not a minisign public key/],
    ];
    for (const [name, mutate, message] of cases) {
      const root = temp("mordomo-uc-");
      const conf = structuredClone(good);
      mutate(conf);
      fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), JSON.stringify(conf));
      const res = run(updaterConfig.main, ["--check", "--root", root]);
      expect(res.code, name).toBe(1);
      expect(res.err, name).toMatch(message);
      expect(run(updaterConfig.main, ["--state", "--root", root]).out.trim(), name).toBe("invalid");
    }
  });
});

// ---- desktop-build ------------------------------------------------------------------------------------------------

describe("C41 the build passes only the signing material this machine has, never an empty variable", () => {
  const apple = {
    APPLE_SIGNING_IDENTITY: "Developer ID Application: X (T)",
    APPLE_ID: "a@b",
    APPLE_PASSWORD: "pw",
    APPLE_TEAM_ID: "T",
  };
  it("C41 nothing registered: no signing variable reaches tauri, installers are still built, no --features and no --config", () => {
    for (const [platform, bundles] of [
      ["macos-arm64", "app,dmg"],
      ["windows-x64", "nsis"],
      ["linux-x64", "deb,appimage"],
    ] as const) {
      const built = desktopBuild.plan(platform, {
        PATH: "/bin",
        APPLE_SIGNING_IDENTITY: "",
        APPLE_ID: "",
        TAURI_SIGNING_PRIVATE_KEY: "",
        MAC_SIGNED: "false",
        UPDATER_ENABLED: "false",
      });
      expect(built.args).toEqual(["build", "--ci", "--bundles", bundles]);
      expect(
        Object.keys(built.env).filter((k) => k.startsWith("APPLE_") || k.startsWith("TAURI_SIGNING")),
      ).toEqual([]);
    }
  });

  it("C41 macOS: the identity only with MAC_SIGNED; the notary credentials only with MAC_NOTARIZE too; none of it off macOS", () => {
    expect(
      Object.keys(
        desktopBuild.plan("macos-x64", { ...apple, MAC_SIGNED: "false", MAC_NOTARIZE: "true" }).env,
      ).filter((k) => k.startsWith("APPLE_")),
    ).toEqual([]);
    expect(
      Object.keys(
        desktopBuild.plan("macos-x64", { ...apple, MAC_SIGNED: "true", MAC_NOTARIZE: "false" }).env,
      ).filter((k) => k.startsWith("APPLE_")),
    ).toEqual(["APPLE_SIGNING_IDENTITY"]);
    expect(
      Object.keys(desktopBuild.plan("macos-x64", { ...apple, MAC_SIGNED: "true", MAC_NOTARIZE: "true" }).env)
        .filter((k) => k.startsWith("APPLE_"))
        .sort(),
    ).toEqual(["APPLE_ID", "APPLE_PASSWORD", "APPLE_SIGNING_IDENTITY", "APPLE_TEAM_ID"]);
    expect(
      Object.keys(
        desktopBuild.plan("linux-x64", { ...apple, MAC_SIGNED: "true", MAC_NOTARIZE: "true" }).env,
      ).filter((k) => k.startsWith("APPLE_")),
    ).toEqual([]);
    expect(
      Object.keys(desktopBuild.plan("windows-x64", { ...apple, MAC_SIGNED: "true" }).env).filter((k) =>
        k.startsWith("APPLE_"),
      ),
    ).toEqual([]);
  });

  it("C41 a signing variable that is set and empty is dropped even when its group is on (an unregistered secret reaches tauri as nothing)", () => {
    const env = desktopBuild.plan("macos-arm64", {
      MAC_SIGNED: "true",
      MAC_NOTARIZE: "true",
      APPLE_SIGNING_IDENTITY: "Developer ID Application: X (T)",
      APPLE_ID: "",
      APPLE_PASSWORD: "",
      APPLE_TEAM_ID: "T",
      APPLE_CERTIFICATE: "",
    }).env;
    expect(
      Object.keys(env)
        .filter((k) => k.startsWith("APPLE_"))
        .sort(),
    ).toEqual(["APPLE_SIGNING_IDENTITY", "APPLE_TEAM_ID"]);
  });

  it("C41 Windows: a certificate thumbprint becomes a --config with SHA-256 and a timestamp; without one there is none", () => {
    const signed = desktopBuild.plan("windows-x64", { WINDOWS_CERT_THUMBPRINT: "AB12CD" });
    const config = JSON.parse(signed.args[signed.args.indexOf("--config") + 1]) as {
      bundle: { windows: Record<string, string> };
    };
    expect(config.bundle.windows).toEqual({
      certificateThumbprint: "AB12CD",
      digestAlgorithm: "sha256",
      timestampUrl: "http://timestamp.digicert.com",
    });
    expect(desktopBuild.plan("windows-x64", { WINDOWS_CERT_THUMBPRINT: "" }).args).not.toContain("--config");
    expect(desktopBuild.plan("linux-x64", { WINDOWS_CERT_THUMBPRINT: "AB12CD" }).args).not.toContain(
      "--config",
    );
  });

  it("C41 the updater: the feature and its config only when enabled and the private key is there; enabled without a key is an error, and the key never reaches a build without the updater", () => {
    const on = desktopBuild.plan("linux-x64", {
      UPDATER_ENABLED: "true",
      TAURI_SIGNING_PRIVATE_KEY: "k",
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
    });
    expect(on.args).toEqual([
      "build",
      "--ci",
      "--bundles",
      "deb,appimage",
      "--features",
      "updater",
      "--config",
      "src-tauri/tauri.updater.conf.json",
    ]);
    expect(on.env.TAURI_SIGNING_PRIVATE_KEY).toBe("k");
    expect(on.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD).toBe(""); // a key with no password is a key with an empty one
    expect(() =>
      desktopBuild.plan("linux-x64", { UPDATER_ENABLED: "true", TAURI_SIGNING_PRIVATE_KEY: "" }),
    ).toThrow(/TAURI_SIGNING_PRIVATE_KEY is not set/);
    const off = desktopBuild.plan("linux-x64", { UPDATER_ENABLED: "false", TAURI_SIGNING_PRIVATE_KEY: "k" });
    expect(off.args).not.toContain("--features");
    expect(off.env.TAURI_SIGNING_PRIVATE_KEY).toBeUndefined();
    expect(() => desktopBuild.plan("amiga", {})).toThrow(/unknown platform/);
  });
});

// ---- the payload ---------------------------------------------------------------------------------------------------

describe("C45 the payload is lib, ui, seed, LICENSE and the manifest, and nothing else", () => {
  const built =
    fs.existsSync(path.join(ROOT, "apps", "api", "dist", "cli.js")) &&
    fs.existsSync(path.join(ROOT, "apps", "command-centre", "dist", "index.html"));
  it.runIf(built)(
    "C45 `package.mjs --payload <dir> --node none` writes those and no launcher, README or archive",
    async () => {
      const { spawnSync } = await import("node:child_process");
      const out = path.join(temp("mordomo-payload-"), "payload");
      const res = spawnSync(
        process.execPath,
        [path.join(ROOT, "scripts", "package.mjs"), "--payload", out, "--skip-build", "--node", "none"],
        {
          encoding: "utf8",
          timeout: 120_000,
        },
      );
      expect(res.status, res.stderr).toBe(0);
      // no `runtime/` here: --node none; the desktop build always has it (the CI step lists it)
      expect(fs.readdirSync(out).sort()).toEqual(["LICENSE", "lib", "package.json", "seed", "ui"]);
      for (const file of [
        "LICENSE",
        "lib/mordomo.mjs",
        "ui/index.html",
      ])
        expect(fs.existsSync(path.join(out, file)), file).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(path.join(out, "package.json"), "utf8")) as {
        name: string;
        version: string;
      };
      expect(manifest).toMatchObject({
        name: "mordomo-os",
        version: versionSync.readVersions(ROOT)[0].version,
      });
    },
    180_000,
  );
});

describe("C56 `package.mjs --payload <dir>` empties only a folder that is empty, missing or a payload it wrote", () => {
  const ownPayload = () => {
    const dir = temp("mordomo-own-payload-");
    fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
    fs.writeFileSync(path.join(dir, "lib", "mordomo.mjs"), "// bundle");
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "mordomo-os", private: true, packagedAt: "2026-10-16T00:00:00.000Z" }),
    );
    return dir;
  };
  const guard = (dir: string) => payloadGuard.assertEmptiablePayloadDir(dir, { root: ROOT });

  it("C56 a folder with something else in it is refused, and nothing in it is touched", () => {
    const dir = temp("mordomo-sentinel-");
    fs.mkdirSync(path.join(dir, "docs"));
    fs.writeFileSync(path.join(dir, "docs", "important.txt"), "keep me");
    expect(() => guard(dir)).toThrow(/is not empty and is not a payload/);
    expect(fs.readFileSync(path.join(dir, "docs", "important.txt"), "utf8")).toBe("keep me");
    // a package.json is not enough: this repository's has the same name
    const lookalike = temp("mordomo-lookalike-");
    fs.writeFileSync(
      path.join(lookalike, "package.json"),
      fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
    );
    expect(() => guard(lookalike)).toThrow(/is not a payload/);
    // nor is a payload manifest without the bundle beside it
    const half = temp("mordomo-half-");
    fs.writeFileSync(
      path.join(half, "package.json"),
      JSON.stringify({ name: "mordomo-os", private: true, packagedAt: "2026-10-16T00:00:00.000Z" }),
    );
    expect(() => guard(half)).toThrow(/is not a payload/);
    // nor is the bundle with a manifest that was never stamped by the packager (no `packagedAt`, or not a string)
    for (const packagedAt of [undefined, 1760572800000, null]) {
      const unstamped = ownPayload();
      fs.writeFileSync(
        path.join(unstamped, "package.json"),
        JSON.stringify({ name: "mordomo-os", private: true, packagedAt }),
      );
      expect(() => guard(unstamped), String(packagedAt)).toThrow(/is not a payload/);
    }
  });

  it("C56 the repository, its parents, the working directory, the home folder, the file system root and a file are refused", () => {
    expect(() => guard(ROOT)).toThrow(/repository or one of its parent folders/);
    expect(() => guard(path.dirname(ROOT))).toThrow(/repository or one of its parent folders/);
    expect(() => guard(path.join(ROOT, "apps", "..", "."))).toThrow(/repository/);
    const cwd = temp("mordomo-cwd-");
    expect(() =>
      payloadGuard.assertEmptiablePayloadDir(cwd, { root: ROOT, cwd: path.join(cwd, "sub") }),
    ).toThrow(/working directory/);
    const home = temp("mordomo-home-");
    expect(() => payloadGuard.assertEmptiablePayloadDir(home, { root: ROOT, home })).toThrow(/home folder/);
    expect(() => guard(path.parse(ROOT).root)).toThrow(/root of the file system/);
    const file = path.join(temp("mordomo-file-"), "f");
    fs.writeFileSync(file, "x");
    expect(() => guard(file)).toThrow(/not a folder/);
  });

  it("C56 a missing folder, an empty one and a payload written before are allowed", () => {
    expect(() => guard(path.join(temp("mordomo-missing-"), "payload"))).not.toThrow();
    expect(() => guard(temp("mordomo-empty-"))).not.toThrow();
    expect(() => guard(ownPayload())).not.toThrow();
    // the folder the workflows use sits in the repository and is not the repository
    expect(() => guard(path.join(ROOT, "apps", "desktop", "payload"))).not.toThrow();
  });

  it("C56 the script itself stops before it deletes: exit 1, the folder as it was", async () => {
    const { spawnSync } = await import("node:child_process");
    const dir = temp("mordomo-sentinel-");
    fs.mkdirSync(path.join(dir, "docs"));
    fs.writeFileSync(path.join(dir, "docs", "important.txt"), "keep me");
    const res = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts", "package.mjs"), "--payload", dir, "--skip-build", "--node", "none"],
      { encoding: "utf8", timeout: 60_000 },
    );
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("refusing to empty");
    expect(fs.readFileSync(path.join(dir, "docs", "important.txt"), "utf8")).toBe("keep me");
    const repo = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts", "package.mjs"), "--payload", ".", "--skip-build", "--node", "none"],
      { encoding: "utf8", timeout: 60_000, cwd: ROOT },
    );
    expect(repo.status).toBe(1);
    expect(repo.stderr).toContain("repository or one of its parent folders");
    expect(fs.existsSync(path.join(ROOT, "package.json"))).toBe(true);
  });
});

// ---- the signatures verify against the committed public key ----------------------------------------------------------

/**
 * A throwaway minisign key pair made in memory (nothing is stored), signing the way `tauri signer sign` does: `ED`, the
 * BLAKE2b-512 of the file, and a trusted comment signed over the signature. The interoperability with the real signer
 * was run by hand against `tauri signer generate` and `tauri signer sign` (checks.md, "Correções da rodada 1").
 */
function minisignPair(legacy = false) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const raw = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  const id = crypto.randomBytes(8);
  const pubText = `untrusted comment: minisign public key: ${id.toString("hex").toUpperCase()}\n${Buffer.concat([Buffer.from("Ed"), id, raw]).toString("base64")}\n`;
  return {
    pubkey: Buffer.from(pubText).toString("base64"),
    sign(data: Buffer, trusted = "timestamp:1 file:x"): string {
      const signed = legacy ? data : crypto.createHash("blake2b512").update(data).digest();
      const sig = crypto.sign(null, signed, privateKey);
      const header = Buffer.concat([Buffer.from(legacy ? "Ed" : "ED"), id, sig]).toString("base64");
      const global = crypto
        .sign(null, Buffer.concat([sig, Buffer.from(trusted)]), privateKey)
        .toString("base64");
      const text = `untrusted comment: signature from tauri secret key\n${header}\ntrusted comment: ${trusted}\n${global}\n`;
      return Buffer.from(text).toString("base64");
    },
  };
}

describe("C59 a signature is checked against the public key before a file or a manifest ships", () => {
  const data = Buffer.from("the installer");

  it("C59 a minisign signature (prehashed or legacy) of the file by the key verifies; another file, another key, another comment do not", () => {
    for (const legacy of [false, true]) {
      const key = minisignPair(legacy);
      const sig = key.sign(data);
      expect(() => minisign.verifyMinisign({ pubkey: key.pubkey, signature: sig, data })).not.toThrow();
      // the plain four lines are accepted as well as their base64
      expect(() =>
        minisign.verifyMinisign({
          pubkey: key.pubkey,
          signature: Buffer.from(sig, "base64").toString("utf8"),
          data,
        }),
      ).not.toThrow();
      expect(() =>
        minisign.verifyMinisign({ pubkey: key.pubkey, signature: sig, data: Buffer.from("another file") }),
      ).toThrow(/does not verify/);
    }
    const key = minisignPair();
    const other = minisignPair();
    expect(() => minisign.verifyMinisign({ pubkey: other.pubkey, signature: key.sign(data), data })).toThrow(
      /another key/,
    );
    const text = Buffer.from(key.sign(data), "base64").toString("utf8").replace("timestamp:1", "timestamp:2");
    expect(() => minisign.verifyMinisign({ pubkey: key.pubkey, signature: text, data })).toThrow(
      /trusted comment/,
    );
    expect(() => minisign.verifyMinisign({ pubkey: key.pubkey, signature: "garbage", data })).toThrow(
      /not a minisign signature/,
    );
    expect(() => minisign.verifyMinisign({ pubkey: "garbage", signature: key.sign(data), data })).toThrow(
      /not a minisign public key/,
    );
  });

  it("C59 the version recorded in the signed trusted comment is the one the endpoint announces, as tauri-plugin-updater compares it; a signature with no version is accepted", () => {
    const key = minisignPair();
    const signedFor = (v: string) => key.sign(data, `timestamp:1\tfile:x\tversion:${v}`);
    const check = (signature: string, version?: string) =>
      minisign.verifyMinisign({ pubkey: key.pubkey, signature, data, version });
    // equal as semver, a leading `v` on either side included
    for (const [signed, announced] of [
      ["1.2.3", "1.2.3"],
      ["v1.2.3", "1.2.3"],
      ["1.2.3", "v1.2.3"],
      ["vv1.2.3", "1.2.3"], // every leading `v`, as the plugin's `trim_start_matches('v')` drops them
      ["1.2.3", "vvv1.2.3"],
      ["1.2.3-rc.1", "1.2.3-rc.1"],
      ["nightly", "nightly"], // not semver on either side: the two strings as written
    ])
      expect(() => check(signedFor(signed!), announced), `${signed} / ${announced}`).not.toThrow();
    // another version, another prerelease, build metadata, or a non-semver spelling that differs
    for (const [signed, announced] of [
      ["1.2.2", "1.2.3"],
      ["1.2.3", "1.2.3-rc.1"],
      ["1.2.3+a", "1.2.3"],
      ["nightly", "Nightly"],
      ["nightly", "1.2.3"],
    ])
      expect(() => check(signedFor(signed!), announced), `${signed} / ${announced}`).toThrow(
        /signed version differs/,
      );
    expect(() => check(signedFor("1.2.2"), "1.2.3")).toThrow(/for version 1\.2\.2, not 1\.2\.3/);
    // no `version:` in the comment (older signatures): accepted, as the plugin does with its default; and no
    // announced version: nothing to compare
    expect(() => check(key.sign(data), "1.2.3")).not.toThrow();
    expect(() => check(signedFor("1.2.2"))).not.toThrow();
    // the field is read from the tab-separated pairs only
    expect(() => check(key.sign(data, "timestamp:1\tfile:version:9.9.9"), "1.2.3")).not.toThrow();
    // a version edited into the comment after signing is the global signature's refusal, not a version match
    const text = Buffer.from(signedFor("1.2.2"), "base64").toString("utf8").replace("1.2.2", "1.2.3");
    expect(() => check(text, "1.2.3")).toThrow(/trusted comment/);
  });

  /** A repository tree with only the updater configuration, carrying `pubkey`. */
  function rootWithKey(pubkey: string): string {
    const root = temp("mordomo-root-");
    const file = "apps/desktop/src-tauri/tauri.updater.conf.json";
    const conf = JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8")) as Record<string, any>;
    conf.plugins.updater.pubkey = pubkey;
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), JSON.stringify(conf));
    return root;
  }
  /** `bundleTree` with real signatures by `key` over the bytes `bundleTree` wrote. */
  function signedBundle(platform: string, key: ReturnType<typeof minisignPair>, trusted?: string): string {
    const bundle = bundleTree(platform, true);
    const walk = (dir: string): string[] =>
      fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
    for (const file of walk(bundle).filter((f) => f.endsWith(".sig")))
      fs.writeFileSync(file, key.sign(fs.readFileSync(file.slice(0, -4)), trusted));
    return bundle;
  }

  it("C59 release-collect with the key copies a .sig that verifies and refuses one that does not (signed file changed, other key)", () => {
    const key = minisignPair();
    const ok = collect.collect({
      version: "1.2.3",
      platform: "linux-x64",
      bundle: signedBundle("linux-x64", key),
      out: temp("o-"),
      codeSigned: false,
      updaterSigned: true,
      publicKey: key.pubkey,
    });
    expect(ok.written).toContain("MordomoOS_1.2.3_linux-x64.AppImage.sig");
    const changed = signedBundle("linux-x64", key);
    fs.appendFileSync(path.join(changed, "appimage", "MordomoOS_1.2.3_amd64.AppImage"), "tampered");
    const args = { version: "1.2.3", platform: "linux-x64", codeSigned: false, updaterSigned: true };
    expect(() =>
      collect.collect({ ...args, bundle: changed, out: temp("o-"), publicKey: key.pubkey }),
    ).toThrow(/AppImage\.sig: the signature does not verify/);
    expect(() =>
      collect.collect({
        ...args,
        bundle: signedBundle("linux-x64", key),
        out: temp("o-"),
        publicKey: minisignPair().pubkey,
      }),
    ).toThrow(/another key.*tauri\.updater\.conf\.json/);
  });

  it("C59 release-collect and the manifest refuse a signature made for another version than the one being released", () => {
    const key = minisignPair();
    const old = "timestamp:1\tfile:x\tversion:1.2.2";
    expect(() =>
      collect.collect({
        version: "1.2.3",
        platform: "linux-x64",
        bundle: signedBundle("linux-x64", key, old),
        out: temp("o-"),
        codeSigned: false,
        updaterSigned: true,
        publicKey: key.pubkey,
      }),
    ).toThrow(/\.sig: the signature is for version 1\.2\.2, not 1\.2\.3/);
    // the manifest: the files are this release's, one signature is an older release's
    const dir = temp("mordomo-release-");
    for (const platform of Object.keys(collect.PLATFORMS))
      collect.collect({
        version: "1.2.3",
        platform,
        bundle: signedBundle(platform, key, "timestamp:1\tfile:x\tversion:1.2.3"),
        out: dir,
        codeSigned: !platform.startsWith("linux"),
        updaterSigned: true,
        publicKey: key.pubkey,
      });
    const args = {
      version: "1.2.3",
      tag: "v1.2.3",
      notes: "n",
      date: "2026-10-12T00:00:00.000Z",
      repo: "o/r",
    };
    expect(manifest.buildManifest({ ...args, dir, publicKey: key.pubkey }).missing).toBeUndefined();
    const winSig = path.join(dir, "MordomoOS_1.2.3_windows-x64-setup.exe.sig");
    fs.writeFileSync(winSig, key.sign(fs.readFileSync(winSig.slice(0, -4)), old));
    const stale = manifest.buildManifest({ ...args, dir, publicKey: key.pubkey });
    expect(stale.missing).toHaveLength(1);
    expect(stale.missing[0]).toMatch(/^windows-x64: .*for version 1\.2\.2, not 1\.2\.3/);
  });

  it("C59 release-collect's command line reads the committed key: a placeholder with the updater on is an error, a matching pair passes", () => {
    const key = minisignPair();
    const argv = (bundle: string, root: string) => [
      "--platform",
      "windows-x64",
      "--bundle",
      bundle,
      "--out",
      temp("o-"),
      "--version",
      "1.2.3",
      "--code-signed",
      "true",
      "--updater-signed",
      "true",
      "--root",
      root,
    ];
    const good = run(collect.main, argv(signedBundle("windows-x64", key), rootWithKey(key.pubkey)));
    expect(good.code, good.err).toBe(0);
    const mismatch = run(
      collect.main,
      argv(signedBundle("windows-x64", key), rootWithKey(minisignPair().pubkey)),
    );
    expect(mismatch.code).toBe(1);
    expect(mismatch.err).toMatch(/another key/);
    const placeholder = run(
      collect.main,
      argv(signedBundle("windows-x64", key), rootWithKey("[A PREENCHER PELO DONO: chave]")),
    );
    expect(placeholder.code).toBe(1);
    expect(placeholder.err).toMatch(/is placeholder, not a minisign key/);
  });

  it("C59 the manifest with the key lists a platform only when its signature verifies; the command line reads the committed key", () => {
    const key = minisignPair();
    const dir = temp("mordomo-release-");
    for (const platform of Object.keys(collect.PLATFORMS)) {
      const out = dir;
      collect.collect({
        version: "1.2.3",
        platform,
        bundle: signedBundle(platform, key),
        out,
        codeSigned: platform.startsWith("linux") ? false : true,
        updaterSigned: true,
        publicKey: key.pubkey,
      });
    }
    const args = {
      version: "1.2.3",
      tag: "v1.2.3",
      notes: "n",
      date: "2026-10-12T00:00:00.000Z",
      repo: "o/r",
    };
    const built = manifest.buildManifest({ ...args, dir, publicKey: key.pubkey });
    expect(built.missing).toBeUndefined();
    expect(Object.keys(built.manifest.platforms).sort()).toEqual([
      "darwin-aarch64",
      "darwin-x86_64",
      "linux-x86_64",
      "linux-x86_64-deb",
      "windows-x86_64",
    ]);
    const wrong = manifest.buildManifest({ ...args, dir, publicKey: minisignPair().pubkey });
    expect(wrong.missing).toHaveLength(4);
    expect(wrong.missing.join("\n")).toMatch(/linux-x64: .*another key/);
    // one signature that is not the file's
    fs.appendFileSync(path.join(dir, "MordomoOS_1.2.3_windows-x64-setup.exe"), "x");
    const one = manifest.buildManifest({ ...args, dir, publicKey: key.pubkey });
    expect(one.missing).toHaveLength(1);
    expect(one.missing[0]).toMatch(/^windows-x64: the signature does not verify/);
    // the command line: the committed key decides
    fs.appendFileSync(path.join(dir, "MordomoOS_1.2.3_windows-x64-setup.exe"), "");
    const cli = (root: string) =>
      run(manifest.main, [
        "--dir",
        dir,
        "--version",
        "1.2.3",
        "--tag",
        "v1.2.3",
        "--out",
        path.join(dir, "latest.json"),
        "--root",
        root,
      ]);
    expect(cli(rootWithKey(key.pubkey)).code).toBe(3); // the tampered installer above is still there
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("C59 a re-run of a tag leaves the draft with this run's files only", () => {
  it("C59 the assets of the draft that this run does not produce are the ones to delete, and an empty folder deletes nothing", () => {
    const dir = temp("mordomo-artifacts-");
    for (const name of ["MordomoOS_1.2.3_macos-arm64_UNSIGNED.dmg", "SHA256SUMS.txt"])
      fs.writeFileSync(path.join(dir, name), "x");
    const existing = path.join(temp("mordomo-existing-"), "existing.txt");
    fs.writeFileSync(
      existing,
      [
        "MordomoOS_1.2.3_macos-arm64.dmg", // signed, by the earlier run
        "MordomoOS_1.2.3_macos-arm64_UNSIGNED.dmg", // this run's
        "latest.json", // this run could not write one
        "SHA256SUMS.txt",
        "",
      ].join("\n"),
    );
    expect(staleAssets.staleAssets(fs.readFileSync(existing, "utf8").split("\n"), dir)).toEqual([
      "MordomoOS_1.2.3_macos-arm64.dmg",
      "latest.json",
    ]);
    const res = run(staleAssets.main, ["--existing", existing, "--dir", dir]);
    expect(res.code).toBe(0);
    expect(res.out).toBe("MordomoOS_1.2.3_macos-arm64.dmg\nlatest.json\n");
    const empty = run(staleAssets.main, ["--existing", existing, "--dir", temp("mordomo-empty-")]);
    expect(empty.code).toBe(1);
    expect(empty.out).toBe("");
    expect(run(staleAssets.main, ["--dir", dir]).code).toBe(2);
  });
});
