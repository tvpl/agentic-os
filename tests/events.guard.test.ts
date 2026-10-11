import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The guard that checks every event of every test file (tests/helpers/eventGuard.ts) is itself checked: three files run
 * in a vitest of their own, with the guard of the root configuration in `setupFiles`, and what each one does is read
 * from its report. A guard that stopped failing on a late event, or on an event during a test, would pass every other
 * suite in silence.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface FileReport {
  name: string;
  status: string;
  message?: string;
  assertionResults: Array<{ status: string; failureMessages?: string[] }>;
}

describe("S4 the event guard", () => {
  it("C55 an invalid event fails the test that made it, and one made after the last test fails the file", () => {
    const run = spawnSync(
      path.join(repoRoot, "node_modules/.bin/vitest"),
      ["run", "--config", "tests/fixtures/event-guard/vitest.config.ts", "--reporter=json"],
      { cwd: repoRoot, encoding: "utf8", timeout: 120_000 },
    );
    const json = run.stdout.slice(run.stdout.indexOf("{"));
    const report = JSON.parse(json) as { testResults: FileReport[] };
    const byFile = Object.fromEntries(report.testResults.map((f) => [path.basename(f.name), f]));
    expect(Object.keys(byFile).sort()).toEqual(["clean.fixture.ts", "during.fixture.ts", "late.fixture.ts"]);

    // A matching event passes.
    expect(byFile["clean.fixture.ts"]!.status).toBe("passed");

    // During a test: the test fails, and says which event.
    const during = byFile["during.fixture.ts"]!;
    expect(during.assertionResults.map((a) => a.status)).toEqual(["failed"]);
    expect(during.assertionResults[0]!.failureMessages!.join(" ")).toMatch(
      /an event departs from its schema: index\.failed v1/,
    );

    // After the last test: the test passed, the file fails, and the message says it was late.
    const late = byFile["late.fixture.ts"]!;
    expect(late.assertionResults.map((a) => a.status)).toEqual(["passed"]);
    expect(late.status).toBe("failed");
    expect(`${late.message ?? ""} ${run.stdout}`).toMatch(
      /departs from its schema after the last test: index\.failed v1/,
    );
    expect(run.status).not.toBe(0);
  }, 150_000);
});
