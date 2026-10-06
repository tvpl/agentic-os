import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SettingsStore, openDb, resolvePaths, type SecurityProfile } from "@mordomo/core";
import { FAKE_BIN, FAKE_CLIS_RUNNABLE } from "./helpers.js";

/**
 * `mordomo run` applies the same write policy as the Command Centre
 * (.specs/features/capacidades-aplicadas, round 2). Runs the BUILT CLI, like
 * tests/cli.test.ts: build with `npm run build:server` first.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(repoRoot, "apps", "api", "dist", "cli.js");
const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

function homeWithWriteSkill(profile: SecurityProfile): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-cli-gate-"));
  homes.push(home);
  const paths = resolvePaths(home);
  const skillDir = path.join(paths.skills, "tidy-notes");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    "---\nname: Tidy notes\ndescription: Rename notes to the house style.\nmode: write\nproviders: [claude, cursor]\n---\n\n# Tidy notes\n\nRename the notes.\n",
  );
  fs.mkdirSync(paths.config, { recursive: true });
  const store = new SettingsStore(paths);
  const settings = store.load();
  settings.securityProfile = profile;
  settings.setupCompleted = true;
  for (const id of ["claude", "cursor"] as const) {
    settings.providers[id].enabled = true;
    settings.providers[id].binaryPath = path.join(FAKE_BIN, id === "claude" ? "claude" : "cursor-agent");
  }
  store.save(settings);
  return home;
}

function runCli(home: string, provider: string): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [CLI, "run", "tidy-notes", "--provider", provider, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      MORDOMO_HOME: home,
      NO_COLOR: "1",
      PATH: `${FAKE_BIN}${path.delimiter}${process.env.PATH}`,
    },
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function runStatuses(home: string): string[] {
  const { db } = openDb(resolvePaths(home));
  try {
    return (db.prepare("SELECT status FROM runs").all() as Array<{ status: string }>).map((r) => r.status);
  } finally {
    db.close();
  }
}

describe.skipIf(!FAKE_CLIS_RUNNABLE || !fs.existsSync(CLI))("mordomo run applies the write policy", () => {
  it("C16 a cursor write skill under controlled_write is parked, not run", () => {
    const home = homeWithWriteSkill("controlled_write");
    const res = runCli(home, "cursor");
    expect(res.status, res.stderr).toBe(0);
    const out = JSON.parse(res.stdout.trim().split("\n").pop()!) as {
      status: string;
      pendingApproval: { kind: string };
    };
    expect(out.status).toBe("waiting_approval");
    expect(out.pendingApproval.kind).toBe("write_run");
    expect(runStatuses(home)).toEqual(["waiting_approval"]);
  });

  it("C17 a write skill under review_before_write is parked, not run", () => {
    const home = homeWithWriteSkill("review_before_write");
    const res = runCli(home, "claude");
    expect(res.status, res.stderr).toBe(0);
    expect(JSON.parse(res.stdout.trim().split("\n").pop()!).status).toBe("waiting_approval");
    expect(runStatuses(home)).toEqual(["waiting_approval"]);
  });

  it("C18 a write skill under read_only is refused with exit 1", () => {
    const home = homeWithWriteSkill("read_only");
    const res = runCli(home, "claude");
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("security profile does not allow write runs");
    expect(runStatuses(home)).toEqual([]);
  });
});
