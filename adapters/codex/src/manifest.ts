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
  },
  layout: {
    instructionsFile: "AGENTS.md",
    skillsDir: ".agents/skills",
    rulesFile: null,
    commandsDir: null,
  },
  homeConfigFiles: [".codex/config.toml"],
  writeToolPattern: /^(apply_patch|write|edit|create_file)/i,
};
