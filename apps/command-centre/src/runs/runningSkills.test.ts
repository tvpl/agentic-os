import { describe, expect, it } from "vitest";
import type { RunRecord } from "../api";
import { runningSkillMap } from "./runningSkills";

const run = (id: string, skillSlug: string | null, status: string, createdAt: number): RunRecord =>
  ({
    id,
    createdAt,
    finishedAt: null,
    origin: "skill",
    provider: "claude",
    model: null,
    status,
    durationMs: null,
    promptSummary: "",
    skillSlug,
    routineId: null,
    error: null,
    artifacts: [],
    exitCode: null,
  }) as RunRecord;

describe("runningSkillMap", () => {
  it("maps active skill runs, newest first, ignoring finished ones", () => {
    const map = runningSkillMap([
      run("old", "tidy", "running", 1),
      run("new", "tidy", "queued", 2),
      run("done", "report", "done", 3),
      run("wait", "brief", "waiting_approval", 4),
      run("noskill", null, "running", 5),
    ]);
    expect(map.get("tidy")).toBe("new");
    expect(map.get("brief")).toBe("wait");
    expect(map.has("report")).toBe(false);
    expect(map.size).toBe(2);
  });

  it("copes with no data", () => {
    expect(runningSkillMap(undefined).size).toBe(0);
    expect(runningSkillMap([]).size).toBe(0);
  });
});
