import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openDb, resolvePaths } from "@mordomo/core/internal";
import { FAKE_BIN, FAKE_CLIS_RUNNABLE } from "./helpers.js";
import { buildEngine, closeAll, echoProvider, internals, tempHome, writeSkill } from "./support/sdk.js";

/**
 * `mordomo run` is a client of `engine.execution.startSkill` (.specs/features/sdk-core, S3), so it meets the rules of
 * a skill that the Command Centre meets: a skill that is off, a provider that is off or not listed, an input left
 * blank, a daily budget that is spent - and, new for the CLI, the cap that the rest of the budget puts on the run.
 * Runs the BUILT CLI like tests/cli.write-gate.test.ts: build with `npm run build:server` first.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(repoRoot, "apps", "api", "dist", "cli.js");

afterEach(closeAll);

const front = (slug: string, extra = "", providers = "claude") =>
  `name: ${slug}\nslug: ${slug}\ndescription: A skill for ${slug}\nproviders: [${providers}]\n${extra}`;

/** A home with the fake `claude` enabled, the skills below, and 0.4 US$ already spent on `budgeted` today. */
function prepare(): string {
  const home = tempHome("mordomo-sdk-cli-");
  writeSkill(home, "off", front("off", "enabled: false"));
  writeSkill(home, "cursor-only", front("cursor-only", "", "cursor"));
  writeSkill(
    home,
    "needs-input",
    front("needs-input", "inputs:\n  - name: topic\n    label: Topic\n    required: true"),
  );
  writeSkill(home, "budgeted", front("budgeted", "budgetUsd: 1"));
  writeSkill(home, "spent", front("spent", "budgetUsd: 1"));
  const engine = buildEngine([echoProvider({ id: "claude" })], { home });
  engine.updateSettings({
    setupCompleted: true,
    providers: { claude: { enabled: true, binaryPath: path.join(FAKE_BIN, "claude") } },
  });
  const inner = internals(engine);
  const spend = (slug: string, usd: number) => {
    const run = inner.runs.create({
      origin: "skill",
      provider: "claude",
      prompt: `(skill: ${slug})`,
      cwd: inner.runs.defaultCwd(),
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 60_000,
      profile: "read_only",
      skillSlug: slug,
      startedBy: null,
    });
    inner.db.prepare("UPDATE runs SET status = 'done', cost_usd = ? WHERE id = ?").run(usd, run.id);
  };
  spend("budgeted", 0.4);
  spend("spent", 1);
  engine.close();
  return home;
}

function runCli(home: string, ...args: string[]) {
  const res = spawnSync(process.execPath, [CLI, "run", ...args], {
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

function runs(
  home: string,
): Array<{ skill_slug: string | null; status: string; max_cost_usd: number | null }> {
  const { db } = openDb(resolvePaths(home));
  try {
    return db.prepare("SELECT skill_slug, status, max_cost_usd FROM runs ORDER BY created_at").all() as never;
  } finally {
    db.close();
  }
}

describe.skipIf(!FAKE_CLIS_RUNNABLE || !fs.existsSync(CLI))("mordomo run meets the rules of a skill", () => {
  it("C67 a skill that is off, a provider that is off or not listed, a blank input and a spent budget are refused with exit 1", () => {
    const home = prepare();
    const before = runs(home).length;
    const refusals: Array<[string[], RegExp]> = [
      [["off", "--provider", "claude"], /Skill is disabled/],
      [["cursor-only", "--provider", "claude"], /does not support provider claude/],
      [["budgeted", "--provider", "cursor"], /Provider cursor is not enabled/],
      [["needs-input", "--provider", "claude"], /Missing required input: Topic/],
      [["needs-input", "--provider", "claude", "--input", "topic=   "], /Missing required input: Topic/],
      [["spent", "--provider", "claude"], /Daily budget of US\$ 1\.00 for \/spent exhausted/],
    ];
    for (const [args, message] of refusals) {
      const res = runCli(home, ...args);
      expect(res.status, args.join(" ")).toBe(1);
      expect(res.stderr, args.join(" ")).toMatch(message);
    }
    expect(runs(home)).toHaveLength(before);
  });

  it("C67 what is left of the daily budget of a skill caps the run that the CLI starts", () => {
    const home = prepare();
    const res = runCli(home, "budgeted", "--provider", "claude", "--json");
    expect(res.status, res.stderr).toBe(0);
    const started = runs(home).filter((run) => run.skill_slug === "budgeted" && run.max_cost_usd !== null);
    expect(started).toHaveLength(1);
    expect(started[0]?.max_cost_usd).toBeCloseTo(0.6, 5);
  });
});
