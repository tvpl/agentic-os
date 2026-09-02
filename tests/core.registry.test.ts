import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  BUILTIN_MANIFESTS,
  ProviderId,
  ProviderRegistry,
  ProviderRegistryError,
  SettingsStore,
  SkillCatalog,
  SyncCompiler,
  builtinManifests,
  discoverMcpServers,
  type AgentAdapter,
  type ProviderManifest,
} from "@mordomo/core";
import { ClaudeAdapter, claudeManifest, createClaudeAdapter } from "@mordomo/adapter-claude";
import { cursorManifest, createCursorAdapter } from "@mordomo/adapter-cursor";
import { codexManifest, createCodexAdapter } from "@mordomo/adapter-codex";
import { FAKE_BIN, makeTempHome } from "./helpers.js";

/** Provider registry (audit item 36): manifests as data, factories as code, consumers generic. */
describe("provider registry", () => {
  it("every declared ProviderId has a built-in manifest with a consistent id", () => {
    for (const id of ProviderId.options) {
      expect(BUILTIN_MANIFESTS[id].id).toBe(id);
      expect(builtinManifests().map((m) => m.id)).toContain(id);
    }
  });

  it("registers factories and creates adapters carrying their manifest", () => {
    const registry = new ProviderRegistry().register(claudeManifest, createClaudeAdapter).register(cursorManifest, createCursorAdapter).register(codexManifest, createCodexAdapter);
    expect(registry.ids()).toEqual(["claude", "cursor", "codex"]);
    const adapters = registry.createAll((id) => (id === "claude" ? path.join(FAKE_BIN, "claude") : null));
    expect(adapters.claude).toBeInstanceOf(ClaudeAdapter);
    expect(adapters.claude.manifest).toBe(claudeManifest);
    expect(adapters.cursor.manifest.capabilities.enforcesReadOnly).toBe(false);
    expect(adapters.codex.manifest.capabilities.enforcesReadOnly).toBe(true);
  });

  it("rejects duplicate and undeclared ids", () => {
    const registry = new ProviderRegistry().register(claudeManifest, createClaudeAdapter);
    expect(() => registry.register(claudeManifest, createClaudeAdapter)).toThrow(ProviderRegistryError);
    const bogus = { ...claudeManifest, id: "gemini" as ProviderManifest["id"] };
    expect(() => registry.register(bogus, createClaudeAdapter)).toThrow(/not declared in ProviderId/);
    expect(() => registry.manifest("codex")).toThrow(ProviderRegistryError);
  });

  it("the sync compiler emits files from manifests, sharing AGENTS.md between Cursor and Codex", () => {
    const { paths, cleanup } = makeTempHome("mordomo-registry-");
    try {
      const repoSkills = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "skills");
      fs.cpSync(repoSkills, paths.skills, { recursive: true });
      const store = new SettingsStore(paths);
      const settings = store.load();
      settings.providers.claude.enabled = true;
      settings.providers.cursor.enabled = true;
      settings.providers.codex.enabled = true;
      store.save(settings);
      const catalog = new SkillCatalog(paths);
      const target = path.join(paths.home, "project");
      fs.mkdirSync(target);

      const withManifests = new SyncCompiler(paths, () => store.load(), () => catalog.list(), builtinManifests);
      const plan = withManifests.plan(target);
      const rel = plan.actions.map((a) => ({ file: path.relative(target, a.filePath), provider: a.provider }));
      expect(rel).toContainEqual({ file: "CLAUDE.md", provider: "claude" });
      expect(rel).toContainEqual({ file: "AGENTS.md", provider: "shared" });
      expect(rel.filter((r) => r.file === "AGENTS.md")).toHaveLength(1);
      expect(rel.some((r) => r.file === path.join(".cursor", "rules", "mordomo.mdc") && r.provider === "cursor")).toBe(true);
      expect(rel.some((r) => r.file.startsWith(path.join(".agents", "skills")) && r.provider === "codex")).toBe(true);
      expect(rel.some((r) => r.file.startsWith(path.join(".claude", "skills")) && r.provider === "claude")).toBe(true);

      // A custom manifest with a different layout is honoured without touching the compiler.
      const custom: ProviderManifest = {
        ...codexManifest,
        id: "codex",
        displayName: "Custom Codex",
        layout: { instructionsFile: "CUSTOM.md", skillsDir: ".custom/skills", rulesFile: null, commandsDir: ".custom/commands" },
      };
      const withCustom = new SyncCompiler(paths, () => store.load(), () => catalog.list(), () => [BUILTIN_MANIFESTS.claude, custom]);
      const files = withCustom.plan(target).actions.map((a) => path.relative(target, a.filePath));
      expect(files).toContain("CUSTOM.md");
      expect(files.some((f) => f.startsWith(path.join(".custom", "commands")))).toBe(true);
      expect(files).not.toContain("AGENTS.md");
    } finally {
      cleanup();
    }
  });

  it("the connector auditor scans the config files the manifests declare", () => {
    const { paths, cleanup } = makeTempHome("mordomo-audit-");
    try {
      fs.mkdirSync(path.join(paths.home, ".custom"), { recursive: true });
      fs.writeFileSync(path.join(paths.home, ".custom", "mcp.json"), JSON.stringify({ mcpServers: { demo: { command: "demo-mcp --token=abc" } } }));
      const viaDefault = discoverMcpServers(paths.home);
      expect(viaDefault.scannedFiles).toEqual([]);
      const viaManifest = discoverMcpServers(paths.home, [".custom/mcp.json"]);
      expect(viaManifest.servers.map((s) => s.name)).toEqual(["demo"]);
      expect(viaManifest.servers[0]!.target).toContain("[hidden]");
    } finally {
      cleanup();
    }
  });

  it("adapters created by the registry satisfy the AgentAdapter contract", () => {
    const adapter: AgentAdapter = createCodexAdapter({ binaryPath: path.join(FAKE_BIN, "codex") });
    expect(adapter.id).toBe("codex");
    expect(adapter.manifest.binary).toBe("codex");
    expect(typeof adapter.execute).toBe("function");
  });
});
