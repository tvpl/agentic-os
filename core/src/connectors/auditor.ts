import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Connector, ConnectorRegistry } from "./registry.js";

/**
 * Connector auditor (ARMS Applications L1).
 * - Discovers what is already configured on the machine — read-only.
 * - NEVER reads or reveals credential values: it looks only at server names,
 *   commands and URLs inside MCP config files and reports their presence.
 * - Recommends at most 3 additions, ranked; official/maintained first.
 * - Installs nothing: recommendations link to the approval-gated install flow.
 */

export interface DiscoveredMcpServer {
  source: string; // which config file it came from
  name: string;
  transport: string;
  target: string; // command or url (never credentials)
}

export interface AuditReport {
  discovered: DiscoveredMcpServer[];
  registry: Connector[];
  recommendations: Array<{
    connector: Connector;
    rank: number;
    unlocks: string;
    setupStep: string;
  }>;
  scannedFiles: string[];
  generatedAt: number;
}

const CREDENTIAL_KEYS = /token|secret|key|password|auth|bearer|cookie/i;

export function discoverMcpServers(homeOverride?: string): { servers: DiscoveredMcpServer[]; scannedFiles: string[] } {
  const home = homeOverride ?? os.homedir();
  const candidates = [
    path.join(home, ".claude.json"),
    path.join(home, ".claude", "settings.json"),
    path.join(home, ".cursor", "mcp.json"),
    path.join(home, ".codex", "config.toml"),
  ];
  const servers: DiscoveredMcpServer[] = [];
  const scannedFiles: string[] = [];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    scannedFiles.push(file);
    try {
      if (file.endsWith(".toml")) {
        servers.push(...parseTomlMcp(fs.readFileSync(file, "utf8"), file));
      } else {
        const json = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
        servers.push(...extractMcpFromJson(json, file));
      }
    } catch {
      // unreadable/invalid — report presence only
      servers.push({ source: file, name: "(unparseable config)", transport: "unknown", target: "" });
    }
  }
  return { servers, scannedFiles };
}

function extractMcpFromJson(json: Record<string, unknown>, source: string): DiscoveredMcpServer[] {
  const out: DiscoveredMcpServer[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const mcp = obj.mcpServers;
    if (mcp && typeof mcp === "object") {
      for (const [name, cfg] of Object.entries(mcp as Record<string, unknown>)) {
        const c = (cfg ?? {}) as Record<string, unknown>;
        out.push({
          source,
          name,
          transport: typeof c.type === "string" ? c.type : c.url ? "http/sse" : "stdio",
          target: sanitizeTarget(String(c.command ?? c.url ?? "")),
        });
      }
    }
    for (const value of Object.values(obj)) visit(value);
  };
  visit(json);
  return out;
}

function parseTomlMcp(content: string, source: string): DiscoveredMcpServer[] {
  const out: DiscoveredMcpServer[] = [];
  for (const match of content.matchAll(/\[mcp_servers\.([^\]]+)\]([\s\S]*?)(?=\n\[|$)/g)) {
    const body = match[2] ?? "";
    const command = body.match(/command\s*=\s*"([^"]+)"/)?.[1] ?? "";
    const url = body.match(/url\s*=\s*"([^"]+)"/)?.[1] ?? "";
    out.push({
      source,
      name: match[1]!,
      transport: url ? "http/sse" : "stdio",
      target: sanitizeTarget(command || url),
    });
  }
  return out;
}

/** Strip anything credential-shaped from a command/url before reporting it. */
function sanitizeTarget(target: string): string {
  return target
    .split(/\s+/)
    .map((part) => (CREDENTIAL_KEYS.test(part) && part.includes("=") ? part.split("=")[0] + "=[hidden]" : part))
    .join(" ")
    .replace(/\/\/[^@/]+@/, "//[hidden]@");
}

export function runAudit(registry: ConnectorRegistry, homeOverride?: string): AuditReport {
  const { servers, scannedFiles } = discoverMcpServers(homeOverride);
  const connectors = registry.list();

  const discoveredNames = new Set(servers.map((s) => s.name.toLowerCase()));
  const candidates = connectors.filter(
    (c) => c.status === "not_configured" && !discoveredNames.has(c.id) && !discoveredNames.has(c.name.toLowerCase()),
  );
  // Rank: official first, then fewer risks, then read-capable.
  const ranked = [...candidates].sort((a, b) => {
    if (a.official !== b.official) return a.official ? -1 : 1;
    if (a.risks.length !== b.risks.length) return a.risks.length - b.risks.length;
    return b.readOperations.length - a.readOperations.length;
  });

  return {
    discovered: servers,
    registry: connectors,
    recommendations: ranked.slice(0, 3).map((connector, i) => ({
      connector,
      rank: i + 1,
      unlocks: connector.notes || connector.readOperations.slice(0, 3).join(", "),
      setupStep: `Open Connectors → ${connector.name} → Configure (approval required; first call is read-only).`,
    })),
    scannedFiles,
    generatedAt: Date.now(),
  };
}
