/**
 * The provider registry wired for the API: one manifest + factory per adapter
 * package, in the order every provider list shows them. Adding a provider =
 * ship an adapter package exporting `<id>Manifest` (declared in its own
 * `src/manifest.ts`) + `create<Name>Adapter`, and register it here. Its id only
 * has to be well formed (`ProviderId`); nothing in core, in the API or in the
 * Command Centre lists providers by name (docs/adapters-guide.md).
 */
import { ProviderRegistry } from "@mordomo/core";
import { claudeManifest, createClaudeAdapter } from "@mordomo/adapter-claude";
import { cursorManifest, createCursorAdapter } from "@mordomo/adapter-cursor";
import { codexManifest, createCodexAdapter } from "@mordomo/adapter-codex";

export function buildProviderRegistry(): ProviderRegistry {
  return new ProviderRegistry()
    .register(claudeManifest, createClaudeAdapter)
    .register(cursorManifest, createCursorAdapter)
    .register(codexManifest, createCodexAdapter);
}
