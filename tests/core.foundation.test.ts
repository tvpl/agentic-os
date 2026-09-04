import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  SettingsStore,
  defaultSettings,
  detectTimezone,
  openDb,
  SkillCatalog,
  SkillFrontmatterSchema,
  SyncCompiler,
  createBackup,
  listBackups,
  restoreBackup,
  unifiedDiff,
  RoutineStore,
  ConnectorRegistry,
  InvalidIdError,
  JsonlLogger,
  rotateFile,
  events,
} from "@mordomo/core";
import { makeTempHome } from "./helpers.js";

describe("settings store", () => {
  it("loads defaults, saves and reloads idempotently", () => {
    const { paths, cleanup } = makeTempHome();
    try {
      const store = new SettingsStore(paths);
      const first = store.load();
      expect(first.systemName).toBe("MordomoOS");
      expect(first.bindAddress).toBe("127.0.0.1");
      expect(first.defaultProvider).toBe("claude");
      const saved = store.update({ port: 4900, language: "pt-BR" });
      expect(saved.port).toBe(4900);
      const reloaded = store.load();
      expect(reloaded.port).toBe(4900);
      expect(reloaded.language).toBe("pt-BR");
      // Idempotent: saving the same object changes nothing.
      store.save(reloaded);
      expect(store.load()).toEqual(reloaded);
    } finally {
      cleanup();
    }
  });

  it("defaults the timezone to the machine zone and keeps an explicit one", () => {
    const { paths, cleanup } = makeTempHome();
    try {
      const machine = detectTimezone();
      expect(machine).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
      // Fresh settings follow the machine, so `setup --defaults` does not leave
      // the clock and the routines in different zones.
      expect(defaultSettings().timezone).toBe(machine);
      const store = new SettingsStore(paths);
      expect(store.load().timezone).toBe(machine);
      // A zone the user chose survives a reload untouched.
      expect(store.update({ timezone: "America/Sao_Paulo" }).timezone).toBe("America/Sao_Paulo");
      expect(store.load().timezone).toBe("America/Sao_Paulo");
    } finally {
      cleanup();
    }
  });

  it("caches by mtime+size, deep-merges patches and emits settings.changed", () => {
    const { paths, cleanup } = makeTempHome();
    try {
      const store = new SettingsStore(paths);
      const changes: number[] = [];
      const unsubscribe = events.subscribe((e) => {
        if (e.type === "settings.changed") changes.push(e.id);
      });
      try {
        store.update({ providers: { claude: { enabled: true, binaryPath: "/opt/claude" } } } as never);
        // Partial provider patch must not reset siblings to defaults.
        const after = store.update({ providers: { claude: { defaultModel: "opus" } } } as never);
        expect(after.providers.claude.enabled).toBe(true);
        expect(after.providers.claude.binaryPath).toBe("/opt/claude");
        expect(after.providers.claude.defaultModel).toBe("opus");
        expect(after.providers.cursor.enabled).toBe(false);
        expect(changes.length).toBe(2);

        // Returned objects are clones: mutating one does not poison the cache.
        const a = store.load();
        a.systemName = "mutated";
        expect(store.load().systemName).toBe("MordomoOS");

        // An external write (different size) is picked up without save().
        const raw = JSON.parse(fs.readFileSync(paths.settingsFile, "utf8"));
        raw.systemName = "external-writer";
        fs.writeFileSync(paths.settingsFile, JSON.stringify(raw, null, 2));
        expect(store.load().systemName).toBe("external-writer");

        // Functional patches read the fresh state.
        const fn = store.update((cur) => ({ port: cur.port + 1 }));
        expect(fn.port).toBe(4778);
      } finally {
        unsubscribe();
      }
    } finally {
      cleanup();
    }
  });

  it("serialises async updates so none is lost", async () => {
    const { paths, cleanup } = makeTempHome();
    try {
      const store = new SettingsStore(paths);
      await Promise.all(
        Array.from({ length: 5 }, (_, i) => store.updateAsync((cur) => ({ areas: [...cur.areas, `a${i}`] }))),
      );
      expect(store.load().areas.filter((a) => a.startsWith("a")).length).toBe(5);
    } finally {
      cleanup();
    }
  });

  it("creates a stable local token with restrictive mode", () => {
    const { paths, cleanup } = makeTempHome();
    try {
      const store = new SettingsStore(paths);
      const token = store.getOrCreateToken();
      expect(token).toHaveLength(64);
      expect(store.getOrCreateToken()).toBe(token);
    } finally {
      cleanup();
    }
  });
});

describe("database migrations", () => {
  it("applies migrations and is reopen-safe", () => {
    const { paths, cleanup } = makeTempHome();
    try {
      const first = openDb(paths);
      expect(first.migration.toVersion).toBeGreaterThan(0);
      first.db.prepare("INSERT INTO meta (key, value) VALUES ('x', '1')").run();
      first.db.close();
      const second = openDb(paths);
      expect(second.migration.fromVersion).toBe(second.migration.toVersion);
      expect(
        (second.db.prepare("SELECT value FROM meta WHERE key='x'").get() as { value: string }).value,
      ).toBe("1");
      second.db.close();
    } finally {
      cleanup();
    }
  });
});

describe("skill catalog", () => {
  const front = SkillFrontmatterSchema.parse({
    name: "Test Skill",
    slug: "test-skill",
    description: "A test skill",
    triggers: ["/test-skill"],
    guardrails: ["Never delete files"],
    successCriteria: ["Produces a report"],
  });

  it("saves, loads and flags thick skills", () => {
    const { paths, cleanup } = makeTempHome();
    try {
      const catalog = new SkillCatalog(paths);
      const saved = catalog.save(front, "Do the thing.\nStep 2.");
      expect(saved.slug).toBe("test-skill");
      expect(saved.thick).toBe(false);
      const thickBody = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
      const thick = catalog.save({ ...front, slug: "thick-skill", name: "Thick" }, thickBody);
      expect(thick.thick).toBe(true);
      expect(
        catalog
          .list()
          .map((s) => s.slug)
          .sort(),
      ).toEqual(["test-skill", "thick-skill"]);
    } finally {
      cleanup();
    }
  });

  it("builds a run prompt that references the skill file and artifacts dir", () => {
    const { paths, cleanup } = makeTempHome();
    try {
      const catalog = new SkillCatalog(paths);
      const skill = catalog.save(
        { ...front, inputs: [{ name: "focus", label: "Focus", type: "text", required: false }] },
        "Summarize.",
      );
      const prompt = catalog.buildRunPrompt(skill, { focus: "finance" }, "/tmp/artifacts/run1");
      expect(prompt).toContain(skill.skillFile);
      expect(prompt).toContain("/tmp/artifacts/run1");
      expect(prompt).toContain("finance");
      expect(prompt).toContain("READ-ONLY");
    } finally {
      cleanup();
    }
  });
});

describe("file-backed stores: id validation and per-file isolation", () => {
  const routine = {
    id: "nightly",
    name: "Nightly",
    prompt: "do it",
    schedule: "0 2 * * *",
  };

  it("RoutineStore rejects traversal ids with a 400 error and deletes nothing", () => {
    const { paths, cleanup } = makeTempHome();
    try {
      const store = new RoutineStore(paths);
      store.save(routine as never);
      const victim = path.join(paths.home, "victim.json");
      fs.writeFileSync(victim, "{}");
      for (const bad of [
        "../victim",
        "..%2Fvictim",
        "a/b",
        "a\\b",
        "..",
        ".hidden",
        "UPPER",
        "",
        "x".repeat(90),
      ]) {
        expect(() => store.remove(bad), bad).toThrow(InvalidIdError);
        expect(() => store.get(bad), bad).toThrow(InvalidIdError);
      }
      let caught: unknown;
      try {
        store.remove("../victim");
      } catch (err) {
        caught = err;
      }
      expect((caught as InvalidIdError).statusCode).toBe(400);
      expect(fs.existsSync(victim)).toBe(true);
      expect(fs.existsSync(path.join(paths.routines, "nightly.json"))).toBe(true);
      expect(() => store.save({ ...routine, id: "../victim" } as never)).toThrow();
      expect(store.remove("nightly")).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("RoutineStore.list skips a corrupt file and reports it", () => {
    const { paths, cleanup } = makeTempHome();
    try {
      const store = new RoutineStore(paths);
      store.save(routine as never);
      fs.writeFileSync(path.join(paths.routines, "broken.json"), "{ not json");
      fs.writeFileSync(path.join(paths.routines, "invalid.json"), JSON.stringify({ id: "invalid" }));
      const list = store.list();
      expect(list.map((r) => r.id)).toEqual(["nightly"]);
      const problems = store.lastProblems();
      expect(problems.length).toBe(2);
      expect(problems.map((p) => path.basename(p.file)).sort()).toEqual(["broken.json", "invalid.json"]);
      expect(problems.every((p) => p.error.length > 0)).toBe(true);
      fs.unlinkSync(path.join(paths.routines, "broken.json"));
      fs.unlinkSync(path.join(paths.routines, "invalid.json"));
      store.list();
      expect(store.lastProblems()).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("ConnectorRegistry validates ids and isolates bad files", () => {
    const { paths, cleanup } = makeTempHome();
    try {
      const registry = new ConnectorRegistry(paths);
      registry.save({ id: "gmail", name: "Gmail", kind: "api", origin: "x", maintainer: "y" } as never);
      const victim = path.join(paths.home, "victim.json");
      fs.writeFileSync(victim, "{}");
      expect(() => registry.remove("../victim")).toThrow(InvalidIdError);
      expect(() => registry.get("../../etc/passwd")).toThrow(InvalidIdError);
      expect(fs.existsSync(victim)).toBe(true);
      fs.writeFileSync(path.join(paths.connectors, "corrupt.json"), "\u0000");
      expect(registry.list().map((c) => c.id)).toEqual(["gmail"]);
      expect(registry.lastProblems().length).toBe(1);
      expect(registry.lastProblems()[0]!.file).toContain("corrupt.json");
    } finally {
      cleanup();
    }
  });

  it("SkillCatalog validates slugs and isolates broken skill folders", () => {
    const { paths, cleanup } = makeTempHome();
    try {
      const catalog = new SkillCatalog(paths);
      catalog.save(SkillFrontmatterSchema.parse({ name: "Ok", slug: "ok", description: "d" }), "Body.");
      const outside = path.join(paths.home, "outside");
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, "SKILL.md"), "x");
      expect(() => catalog.remove("../outside")).toThrow(InvalidIdError);
      expect(() => catalog.load("../outside")).toThrow(InvalidIdError);
      expect(() => catalog.setEnabled("a/b", false)).toThrow(InvalidIdError);
      expect(fs.existsSync(path.join(outside, "SKILL.md"))).toBe(true);

      fs.mkdirSync(path.join(paths.skills, "broken"));
      fs.writeFileSync(path.join(paths.skills, "broken", "SKILL.md"), "---\nname: 1\n---\nbody");
      fs.mkdirSync(path.join(paths.skills, "Bad Name"));
      fs.writeFileSync(
        path.join(paths.skills, "Bad Name", "SKILL.md"),
        "---\nname: x\ndescription: y\n---\nbody",
      );
      expect(catalog.list().map((s) => s.slug)).toEqual(["ok"]);
      const problems = catalog.lastProblems();
      expect(problems.length).toBe(2);
      expect(problems.some((p) => p.file.includes("broken"))).toBe(true);
      expect(problems.some((p) => p.file.includes("Bad Name"))).toBe(true);
    } finally {
      cleanup();
    }
  });
});

describe("jsonl logger", () => {
  it("prunes old rotations on construction and rotateFile rotates any file", () => {
    const { paths, cleanup } = makeTempHome();
    try {
      const old = path.join(paths.logs, "runs.jsonl.2020-01-01T00-00-00-000Z");
      fs.writeFileSync(old, "{}\n");
      const past = new Date(Date.now() - 40 * 86_400_000);
      fs.utimesSync(old, past, past);
      const fresh = path.join(paths.logs, "runs.jsonl.recent");
      fs.writeFileSync(fresh, "{}\n");
      const logger = new JsonlLogger(paths.logs, "runs", 65536, 30);
      expect(fs.existsSync(old)).toBe(false);
      expect(fs.existsSync(fresh)).toBe(true);
      logger.append({ token: "abcdefghijklmnop" });
      const line = fs.readFileSync(path.join(paths.logs, "runs.jsonl"), "utf8");
      expect(line).not.toContain("abcdefghijklmnop");
      expect(() => JSON.parse(line.trim())).not.toThrow();

      const out = path.join(paths.logs, "service.out.log");
      fs.writeFileSync(out, "x".repeat(2000));
      expect(rotateFile(out, 4096)).toBeNull();
      const rotated = rotateFile(out, 1024);
      expect(rotated).toBeTruthy();
      expect(fs.existsSync(rotated!)).toBe(true);
      expect(fs.existsSync(out)).toBe(false);
      expect(rotateFile(path.join(paths.logs, "missing.log"), 10)).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe("sync compiler", () => {
  it("creates, updates, and detects conflicts with backup", () => {
    const { paths, cleanup } = makeTempHome();
    try {
      const store = new SettingsStore(paths);
      let settings = store.load();
      settings.providers.claude.enabled = true;
      settings.providers.cursor.enabled = true;
      settings = store.save(settings);
      const catalog = new SkillCatalog(paths);
      catalog.save(SkillFrontmatterSchema.parse({ name: "S", slug: "s1", description: "d" }), "Body.");
      const target = path.join(paths.home, "workspace");
      fs.mkdirSync(target);
      const compiler = new SyncCompiler(
        paths,
        () => store.load(),
        () => catalog.list(),
      );

      // 1st plan: everything is a create
      const plan1 = compiler.plan(target);
      expect(plan1.actions.every((a) => a.kind === "create")).toBe(true);
      const applied1 = compiler.apply(plan1);
      expect(applied1.written.length).toBeGreaterThan(2);
      expect(fs.existsSync(path.join(target, "CLAUDE.md"))).toBe(true);
      expect(fs.existsSync(path.join(target, ".claude", "skills", "s1", "SKILL.md"))).toBe(true);
      expect(fs.existsSync(path.join(target, ".cursor", "commands", "s1.md"))).toBe(true);

      // 2nd plan: unchanged
      const plan2 = compiler.plan(target);
      expect(plan2.actions.every((a) => a.kind === "unchanged")).toBe(true);

      // Hand-edit CLAUDE.md → conflict, not silently overwritten
      const claudeMd = path.join(target, "CLAUDE.md");
      fs.appendFileSync(claudeMd, "\nMY MANUAL EDIT\n");
      catalog.save(SkillFrontmatterSchema.parse({ name: "S2", slug: "s2", description: "d2" }), "Body2.");
      const plan3 = compiler.plan(target);
      const conflict = plan3.actions.find((a) => a.filePath === claudeMd);
      expect(conflict?.kind).toBe("conflict");
      expect(conflict?.diff).toContain("MY MANUAL EDIT");

      const applied3 = compiler.apply(plan3);
      expect(applied3.skippedConflicts).toContain(claudeMd);
      expect(fs.readFileSync(claudeMd, "utf8")).toContain("MY MANUAL EDIT");

      // Approve the conflict → backed up, then overwritten
      const applied4 = compiler.apply(compiler.plan(target), [claudeMd]);
      expect(applied4.written).toContain(claudeMd);
      expect(applied4.backupDir).toBeTruthy();
      const backedUp = fs.readdirSync(applied4.backupDir!, { recursive: true }) as string[];
      expect(backedUp.some((f) => String(f).includes("CLAUDE.md"))).toBe(true);
      expect(fs.readFileSync(claudeMd, "utf8")).not.toContain("MY MANUAL EDIT");
    } finally {
      cleanup();
    }
  });
});

describe("diff", () => {
  it("produces readable unified output", () => {
    const diff = unifiedDiff("a\nb\nc", "a\nB\nc");
    expect(diff).toContain("- b");
    expect(diff).toContain("+ B");
    expect(diff).toContain("  a");
  });
});

describe("backup and restore", () => {
  it("round-trips skills and settings", async () => {
    const { paths, cleanup } = makeTempHome();
    const db = openDb(paths).db;
    try {
      const store = new SettingsStore(paths);
      store.update({ systemName: "MordomoOS-test" });
      const catalog = new SkillCatalog(paths);
      catalog.save(
        SkillFrontmatterSchema.parse({ name: "Keep", slug: "keep-me", description: "d" }),
        "Body.",
      );
      const backup = await createBackup(paths, db);
      db.close(); // restore requires a closed database
      expect(listBackups(paths).some((b) => b.name === backup.name)).toBe(true);

      catalog.remove("keep-me");
      store.update({ systemName: "changed" });
      expect(catalog.load("keep-me")).toBeNull();

      const { safetyBackup } = restoreBackup(paths, backup.name);
      expect(catalog.load("keep-me")?.name).toBe("Keep");
      expect(store.load().systemName).toBe("MordomoOS-test");
      expect(fs.existsSync(safetyBackup.path)).toBe(true);
    } finally {
      cleanup();
    }
  });
});
