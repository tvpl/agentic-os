import path from "node:path";
import type { ProviderManifest } from "../agents/registry.js";
import { discoverMcpServers } from "./auditor.js";

/**
 * Whether Claude Code, Cursor and Codex have MordomoOS's MCP server configured (.specs/features/cerebro-perguntar,
 * door 7): their config files, the ones each provider's manifest names (`homeConfigFiles`), are read by the connector
 * auditor's `discoverMcpServers` (read-only, never a credential); a server named `mordomo`, or one whose command is the
 * file `mordomo`, `mordomo.cmd` or `mordomo.exe`, is the connection. Nothing here writes another program's config.
 */

export type McpClientId = "claude" | "cursor" | "codex";

export interface McpClient {
  id: McpClientId;
  name: string;
  connected: boolean;
  /** The file the server was found in; for a client not connected, a file that could not be parsed. */
  source?: string;
  /** A config file of the client that does not parse. */
  unreadable?: true;
  /** The server found, its command as the auditor reports it (a credential-shaped part reads `[hidden]`). */
  server?: { name: string; command: string };
  /** What connects it, to copy: a command for Claude Code, the block of its config file for Cursor and Codex. */
  command: string;
}

const CLIENTS: ReadonlyArray<{ id: McpClientId; name: string; command: string }> = [
  { id: "claude", name: "Claude Code", command: "claude mcp add mordomo -- mordomo mcp" },
  {
    id: "cursor",
    name: "Cursor",
    command: JSON.stringify({ mcpServers: { mordomo: { command: "mordomo", args: ["mcp"] } } }, null, 2),
  },
  { id: "codex", name: "Codex", command: ['[mcp_servers.mordomo]', 'command = "mordomo"', 'args = ["mcp"]'].join("\n") },
];

/** What `discoverMcpServers` reports for a file that does not parse. */
const UNPARSEABLE = "(unparseable config)";

const MORDOMO_FILES = new Set(["mordomo", "mordomo.cmd", "mordomo.exe"]);

/** Whether a command names the `mordomo` program, by its file name in either path spelling (`/` or `\`). */
function isMordomo(command: string): boolean {
  const first = command.trim().split(/\s+/)[0] ?? "";
  return [command.trim(), first].some((c) => MORDOMO_FILES.has(path.win32.basename(c).toLowerCase()));
}

/** The three clients in order, each judged over the config files of its manifest under `home` (the user's by default). */
export function mcpClients(manifests: readonly ProviderManifest[], home?: string): McpClient[] {
  return CLIENTS.map(({ id, name, command }) => {
    const files = manifests.find((m) => m.id === id)?.homeConfigFiles ?? [];
    const { servers } = discoverMcpServers(home, files);
    const found = servers.find((s) => s.name !== UNPARSEABLE && (s.name === "mordomo" || isMordomo(s.target)));
    if (found) {
      return { id, name, connected: true, source: found.source, server: { name: found.name, command: found.target }, command };
    }
    const broken = servers.find((s) => s.name === UNPARSEABLE);
    if (broken) return { id, name, connected: false, source: broken.source, unreadable: true, command };
    return { id, name, connected: false, command };
  });
}
