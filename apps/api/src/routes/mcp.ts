import type { FastifyInstance } from "fastify";
import { agentUsage, mcpClients } from "@mordomo/core/internal";
import { audienceView } from "../access.js";
import type { AppContext } from "../context.js";
import { bind } from "../contract.js";
import { MCP_TOOL_KINDS, mordomoTools, type McpApi } from "../mcp/mordomo.js";

/**
 * `GET /api/mcp` (.specs/features/cerebro-perguntar, door 7): whether each of Claude Code, Cursor and Codex has
 * `mordomo` configured (their config files, read and never written), what connects it, the 13 tools by kind, and what
 * the agents read, the most read paths judged by today's policy and the folders hidden from agents.
 */

/** No call is made: the tools are listed by name. */
const NO_CALLS: McpApi = {
  get: () => Promise.reject(new Error("not called")),
  post: () => Promise.reject(new Error("not called")),
  put: () => Promise.reject(new Error("not called")),
};

export function registerMcpRoutes(app: FastifyInstance, ctx: AppContext): void {
  bind(app, "mcp.overview", async () => {
    const view = audienceView(ctx, "agents");
    return {
      clients: mcpClients(ctx.providers.manifests()),
      tools: mordomoTools(NO_CALLS).map((tool) => ({ name: tool.name, kind: MCP_TOOL_KINDS[tool.name]! })),
      usage: agentUsage(ctx.db, (p) => view.allowsPath(p)),
    };
  });
}
