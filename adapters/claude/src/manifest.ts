import type { ProviderManifest } from "@mordomo/core";

/** Claude Code as the provider registry sees it (`apps/api/src/providers.ts`). */
export const claudeManifest: ProviderManifest = {
  id: "claude",
  displayName: "Claude Code",
  binary: "claude",
  installHint: "npm install -g @anthropic-ai/claude-code",
  loginCommand: "claude auth login",
  capabilities: {
    enforcesReadOnly: true,
    supportsEffort: true,
    promptTransport: "stdin",
    streaming: true,
    resume: "flag",
    writeConfinement: "broker",
  },
  layout: {
    instructionsFile: "CLAUDE.md",
    skillsDir: ".claude/skills",
    rulesFile: null,
    commandsDir: null,
  },
  homeConfigFiles: [".claude.json", ".claude/settings.json"],
  writeToolPattern: /^(write|edit|multiedit|notebookedit|create_file)/i,
};
