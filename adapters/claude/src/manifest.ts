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
    readConfinement: "workdir",
  },
  layout: {
    instructionsFile: "CLAUDE.md",
    skillsDir: ".claude/skills",
    rulesFile: null,
    commandsDir: null,
  },
  homeConfigFiles: [".claude.json", ".claude/settings.json"],
  writeToolPattern: /^(write|edit|multiedit|notebookedit|create_file)/i,
  // The range this release was developed against: the top is the CLI bundled with @anthropic-ai/claude-agent-sdk 0.3.291,
  // whose types the stream fixtures follow; the base is the first 2.x. No real CLI was run to certify it.
  testedVersions: { min: "2.0.0", max: "2.1.291" },
};
