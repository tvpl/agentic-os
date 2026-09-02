/**
 * The provider registry wired for the API: one manifest + factory per adapter
 * package. Adding a provider = add its id to `ProviderId` in the core schema,
 * ship an adapter package exporting `<id>Manifest` + `create<Name>Adapter`,
 * and register it here. Nothing else in core or in the API needs to change.
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
