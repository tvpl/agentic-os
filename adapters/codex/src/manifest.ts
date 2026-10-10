import type { ProviderManifest } from "@mordomo/core";

/** OpenAI Codex as the provider registry sees it (`apps/api/src/providers.ts`). */
export const codexManifest: ProviderManifest = {
  id: "codex",
  displayName: "OpenAI Codex",
  binary: "codex",
  installHint: "npm install -g @openai/codex",
  loginCommand: "codex login",
  capabilities: {
    enforcesReadOnly: true,
    supportsEffort: true,
    promptTransport: "argv",
    streaming: true,
    resume: "subcommand",
    writeConfinement: "sandbox",
    readConfinement: "none",
  },
  layout: {
    instructionsFile: "AGENTS.md",
    skillsDir: ".agents/skills",
    rulesFile: null,
    commandsDir: null,
  },
  homeConfigFiles: [".codex/config.toml"],
  writeToolPattern: /^(apply_patch|write|edit|create_file|file_change)/i,
  // The range this release was developed against: the base is where the `item.*` event format starts, the top is the CLI
  // @openai/codex-sdk 0.160.1 drives (whose types the fixtures follow). No real CLI was run to certify it.
  testedVersions: { min: "0.100.0", max: "0.160.1" },
};
