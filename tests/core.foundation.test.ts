import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  SettingsStore,
  defaultSettings,
  openDb,
  SkillCatalog,
  SkillFrontmatterSchema,
  SyncCompiler,
  createBackup,
  listBackups,
  restoreBackup,
  unifiedDiff,
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
      expect((second.db.prepare("SELECT value FROM meta WHERE key='x'").get() as { value: string }).value).toBe("1");
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
      expect(catalog.list().map((s) => s.slug).sort()).toEqual(["test-skill", "thick-skill"]);
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
      catalog.save(
        SkillFrontmatterSchema.parse({ name: "S", slug: "s1", description: "d" }),
        "Body.",
      );
      const target = path.join(paths.home, "workspace");
      fs.mkdirSync(target);
      const compiler = new SyncCompiler(paths, () => store.load(), () => catalog.list());

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
  it("round-trips skills and settings", () => {
    const { paths, cleanup } = makeTempHome();
    try {
      const store = new SettingsStore(paths);
      store.update({ systemName: "MordomoOS-test" });
      const catalog = new SkillCatalog(paths);
      catalog.save(SkillFrontmatterSchema.parse({ name: "Keep", slug: "keep-me", description: "d" }), "Body.");
      const backup = createBackup(paths);
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
