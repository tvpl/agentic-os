import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { augmentedPath, findExecutable, findOnPath, providerSearchDirs } from "../core/src/spawn/which.js";
import { defaultUserDataDir, resolvePaths, seedHome } from "../core/src/paths.js";
import { planStartupService } from "../core/src/routines/osIntegration.js";
import { makeTempHome } from "./helpers.js";

const temps: string[] = [];
function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const posix = process.platform !== "win32";

describe("executable discovery beyond PATH", () => {
  it.skipIf(!posix)("finds a provider CLI installed by the native installer when PATH is minimal", () => {
    const home = tempDir("mordomo-home-");
    const bin = path.join(home, ".local", "bin");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "codex"), "#!/bin/sh\necho fake\n", { mode: 0o755 });
    const env = { HOME: home, PATH: "/usr/bin:/bin" };
    expect(findExecutable("codex", env)).toBe(path.join(bin, "codex"));
    expect(findExecutable("definitely-missing-cli", env)).toBeNull();
    expect(augmentedPath(env).split(path.delimiter)).toEqual(
      expect.arrayContaining(["/usr/bin", "/bin", bin, path.dirname(process.execPath)]),
    );
  });
  it.skipIf(!posix)("prefers PATH and newest version-manager folders", () => {
    const home = tempDir("mordomo-home-");
    const onPath = path.join(home, "on-path");
    const fnm = path.join(home, ".local", "share", "fnm", "node-versions");
    for (const [dir, body] of [
      [onPath, "path"],
      [path.join(fnm, "v20.1.0", "installation", "bin"), "old"],
      [path.join(fnm, "v22.10.0", "installation", "bin"), "new"],
    ] as const) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "codex"), `#!/bin/sh\necho ${body}\n`, { mode: 0o755 });
    }
    expect(findExecutable("codex", { HOME: home, PATH: onPath })).toBe(path.join(onPath, "codex"));
    expect(findExecutable("codex", { HOME: home, PATH: "/nonexistent" })).toBe(
      path.join(fnm, "v22.10.0", "installation", "bin", "codex"),
    );
    const dirs = providerSearchDirs({ HOME: home, PATH: "" }, "linux", home);
    expect(dirs.every((d) => fs.statSync(d).isDirectory())).toBe(true);
    expect(new Set(dirs).size).toBe(dirs.length);
  });
  it("keeps findOnPath strictly on PATH", () => {
    expect(findOnPath("definitely-missing-cli")).toBeNull();
  });
  it("lists platform folders without touching the file system for other platforms", () => {
    const home = tempDir("mordomo-home-");
    fs.mkdirSync(path.join(home, "AppData", "Roaming", "npm"), { recursive: true });
    const dirs = providerSearchDirs({ HOME: home, PATH: "" }, "win32", home);
    expect(dirs).toContain(path.join(home, "AppData", "Roaming", "npm"));
  });
});

describe("packaged install: home and seeds", () => {
  it("computes the per-user data folder per platform", () => {
    const home = "/Users/ada";
    expect(defaultUserDataDir("darwin", {}, home)).toBe("/Users/ada/Library/Application Support/MordomoOS");
    expect(defaultUserDataDir("linux", {}, home)).toBe("/Users/ada/.local/share/mordomo-os");
    expect(defaultUserDataDir("linux", { XDG_DATA_HOME: "/data" }, home)).toBe("/data/mordomo-os");
    expect(
      defaultUserDataDir("win32", { LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local" }, "C:\\Users\\ada"),
    ).toBe(path.join("C:\\Users\\ada\\AppData\\Local", "MordomoOS"));
  });
  it("seeds skills, routines and connectors once and never overwrites user files", () => {
    const temp = makeTempHome("mordomo-seed-");
    try {
      const seed = tempDir("mordomo-seeds-");
      fs.mkdirSync(path.join(seed, "skills", "hello"), { recursive: true });
      fs.writeFileSync(path.join(seed, "skills", "hello", "SKILL.md"), "# hello\n");
      fs.mkdirSync(path.join(seed, "routines"), { recursive: true });
      fs.writeFileSync(path.join(seed, "routines", "daily.json"), "{}");
      fs.writeFileSync(path.join(temp.paths.routines, "daily.json"), '{"mine":true}');
      expect(seedHome(temp.paths, seed)).toEqual([path.join("skills", "hello")]);
      expect(fs.readFileSync(path.join(temp.paths.routines, "daily.json"), "utf8")).toBe('{"mine":true}');
      expect(seedHome(temp.paths, seed)).toEqual([]);
      expect(seedHome(temp.paths, path.join(seed, "missing"))).toEqual([]);
    } finally {
      temp.cleanup();
    }
  });
  it("resolves an explicit home unchanged", () => {
    const home = tempDir("mordomo-explicit-");
    expect(resolvePaths(home).home).toBe(path.resolve(home));
  });
});

describe("startup service entry", () => {
  it("uses the packaged CLI entry when one is given", () => {
    const temp = makeTempHome("mordomo-svc-");
    try {
      const entry = "/Applications/MordomoOS.app/Contents/Resources/lib/mordomo.mjs";
      for (const platform of ["darwin", "linux", "win32"] as const) {
        const plan = planStartupService(temp.paths, "/opt/node/bin/node", platform, "/Users/ada", entry);
        expect(plan.files[0]!.content).toContain(entry);
        expect(plan.files[0]!.content).not.toContain("apps/api/dist/cli.js");
      }
      const legacy = planStartupService(temp.paths, "/opt/node/bin/node", "linux", "/Users/ada");
      expect(legacy.files[0]!.content).toContain(path.join(temp.paths.home, "apps", "api", "dist", "cli.js"));
    } finally {
      temp.cleanup();
    }
  });
});
