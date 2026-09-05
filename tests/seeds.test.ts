import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SkillCatalog,
  RoutineStore,
  ConnectorRegistry,
  RoutineScheduler,
  SettingsStore,
  MemoryIndexer,
  RunManager,
  openDb,
  resolvePaths,
  runAudit,
  nextRunAt,
} from "@mordomo/core";
import { FAKE_BIN, makeTempHome, withFakeBinPath } from "./helpers.js";
import { ClaudeAdapter } from "@mordomo/adapter-claude";
import fs from "node:fs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoPaths = resolvePaths(repoRoot);

describe("seed data validity (repo source of truth)", () => {
  it("all seed skills load, validate and stay under the thick threshold", () => {
    const catalog = new SkillCatalog(repoPaths);
    const skills = catalog.list();
    const slugs = skills.map((s) => s.slug);
    expect(slugs).toEqual(
      expect.arrayContaining([
        "workspace-digest",
        "daily-tech-news",
        "claude-optimize",
        "agent-usage-report",
        "single-html-explainer",
        "sdd-plan",
        "harness-analysis",
        "code-review",
        "brainstorm",
      ]),
    );
    for (const skill of skills) {
      expect(skill.thick, `${skill.slug} should not be thick`).toBe(false);
      expect(skill.guardrails.length, `${skill.slug} needs guardrails`).toBeGreaterThan(0);
      expect(skill.successCriteria.length, `${skill.slug} needs success criteria`).toBeGreaterThan(0);
      expect(skill.enabled).toBe(true);
    }
    // Progressive disclosure: at least some skills carry resource trees.
    expect(skills.filter((s) => s.resources.length > 0).length).toBeGreaterThanOrEqual(3);
  });

  it("seed routine is valid, PAUSED by default, and schedulable", () => {
    const store = new RoutineStore(repoPaths);
    const routine = store.get("daily-workspace-digest");
    expect(routine).not.toBeNull();
    expect(routine!.enabled).toBe(false); // approval-gated: user enables it explicitly
    expect(routine!.skillSlug).toBe("workspace-digest");
    expect(nextRunAt(routine!)).toBeNull(); // disabled → no next run
    expect(nextRunAt({ ...routine!, enabled: true })).toBeGreaterThan(Date.now());
  });

  it("seed connectors validate and are not pre-configured", () => {
    const registry = new ConnectorRegistry(repoPaths);
    const connectors = registry.list();
    expect(connectors.map((c) => c.id)).toEqual(
      expect.arrayContaining(["email-gmail", "calendar-google", "playwright"]),
    );
    for (const c of connectors) {
      expect(c.writeEnabled).toBe(false);
      if (c.kind === "micro-app" && c.official) {
        // Built-in micro-apps (e.g. Pixel Studio) ship ready to use.
        expect(["healthy", "configured"]).toContain(c.status);
      } else {
        expect(c.status).toBe("not_configured");
        expect(c.risks.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("connector auditor", () => {
  it("discovers MCP servers without leaking credentials and recommends max 3", () => {
    const { paths, cleanup } = makeTempHome();
    try {
      // Fake a user home with an MCP config containing a credential-shaped value
      const fakeHome = path.join(paths.home, "fakehome");
      fs.mkdirSync(fakeHome, { recursive: true });
      fs.writeFileSync(
        path.join(fakeHome, ".claude.json"),
        JSON.stringify({
          mcpServers: {
            "my-server": { command: "npx some-server --token=sk-secret123456789012345", type: "stdio" },
          },
        }),
      );
      // Copy seed connectors into the temp registry
      for (const f of fs.readdirSync(repoPaths.connectors)) {
        fs.copyFileSync(path.join(repoPaths.connectors, f), path.join(paths.connectors, f));
      }
      const registry = new ConnectorRegistry(paths);
      const report = runAudit(registry, fakeHome);
      expect(report.discovered.length).toBe(1);
      expect(report.discovered[0]!.name).toBe("my-server");
      expect(JSON.stringify(report)).not.toContain("sk-secret123456789012345");
      expect(report.recommendations.length).toBeLessThanOrEqual(3);
      // Official connector (playwright) ranks first
      expect(report.recommendations[0]!.connector.id).toBe("playwright");
    } finally {
      cleanup();
    }
  });
});

describe("routine scheduler (manual fire, against fake CLI)", () => {
  it("fires a routine's skill run and records history", async () => {
    const restore = withFakeBinPath();
    const { paths, cleanup } = makeTempHome();
    try {
      // seed a skill + routine into temp home
      fs.cpSync(
        path.join(repoPaths.skills, "workspace-digest"),
        path.join(paths.skills, "workspace-digest"),
        { recursive: true },
      );
      fs.copyFileSync(
        path.join(repoPaths.routines, "daily-workspace-digest.json"),
        path.join(paths.routines, "daily-workspace-digest.json"),
      );
      const db = openDb(paths).db;
      const settingsStore = new SettingsStore(paths);
      const skills = new SkillCatalog(paths);
      const routines = new RoutineStore(paths);
      const runs = new RunManager(
        db,
        paths,
        () => settingsStore.load(),
        () => new ClaudeAdapter({ binaryPath: path.join(FAKE_BIN, "claude") }),
      );
      const scheduler = new RoutineScheduler(db, paths, routines, runs, skills, () => settingsStore.load());

      const { runId } = await scheduler.fire("daily-workspace-digest", { reason: "manual" });
      await scheduler.drain();
      const record = runs.get(runId);
      expect(record).not.toBeNull();
      expect(record!.status).toBe("done");
      expect(record!.origin).toBe("routine");
      expect(record!.skillSlug).toBe("workspace-digest");

      const history = scheduler.history("daily-workspace-digest");
      expect(history.length).toBe(1);
      expect(history[0]!.runId).toBe(record!.id);

      const status = scheduler.status().find((s) => s.id === "daily-workspace-digest")!;
      expect(status.lastStatus).toBe("done");
      expect(status.healthy).toBe(true);
      db.close();
    } finally {
      restore();
      cleanup();
    }
  });

  it("indexes this repository and finds a seed skill file via search", () => {
    const { paths, cleanup } = makeTempHome();
    try {
      const db = openDb(paths).db;
      const store = new SettingsStore(paths);
      store.update({ indexedFolders: [{ path: repoPaths.skills, area: "Projetos", enabled: true }] });
      const stats = new MemoryIndexer(db, () => store.load()).indexAll();
      expect(stats.added).toBeGreaterThan(5);
      db.close();
    } finally {
      cleanup();
    }
  });
});
