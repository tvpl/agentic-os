import type { ProviderManifest } from "@mordomo/core";

/** Cursor Agent as the provider registry sees it (`apps/api/src/providers.ts`). */
export const cursorManifest: ProviderManifest = {
  id: "cursor",
  displayName: "Cursor Agent",
  binary: "cursor-agent",
  installHint: "curl https://cursor.com/install -fsS | bash",
  loginCommand: "cursor-agent login",
  capabilities: {
    enforcesReadOnly: false,
    supportsEffort: false,
    promptTransport: "argv",
    streaming: true,
    // No resume flag is documented for cursor-agent -p; runs always start fresh.
    resume: "none",
    writeConfinement: "none",
    readConfinement: "none",
    protectsDirs: false,
  },
  layout: {
    instructionsFile: "AGENTS.md",
    skillsDir: null,
    rulesFile: ".cursor/rules/mordomo.mdc",
    commandsDir: ".cursor/commands",
  },
  homeConfigFiles: [".cursor/mcp.json"],
  writeToolPattern: /^(write|edit|multiedit|create_file|str_replace)/i,
  // No `testedVersions`: there is no published schema or recording of cursor-agent to anchor a range on, so its status reads `unknown`.
};
