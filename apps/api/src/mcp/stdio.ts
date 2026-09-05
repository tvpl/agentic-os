/**
 * A minimal MCP server over stdio (newline-delimited JSON-RPC 2.0): the subset
 * Claude Code and Cursor need to call tools — `initialize`, `ping`,
 * `tools/list`, `tools/call` — with no SDK dependency, mirroring the
 * hand-rolled client in core/src/connectors/client.ts. Tool handlers return
 * plain text; errors become `isError` results so the caller sees the message
 * instead of a protocol failure.
 */
import readline from "node:readline";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

interface Request {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

export const MCP_PROTOCOL_VERSION = "2024-11-05";

/** Handle one request; returns the JSON-RPC response object or null for notifications. */
export async function handleMcpRequest(
  req: Request,
  server: { name: string; version: string; tools: McpTool[] },
): Promise<Record<string, unknown> | null> {
  const { id, method, params } = req;
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
  const fail = (code: number, message: string) => ({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  });
  if (typeof method !== "string") return fail(-32600, "Invalid request");
  if (method.startsWith("notifications/")) return null;
  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: server.name, version: server.version },
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({
        tools: server.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
    case "tools/call": {
      const name = typeof params?.name === "string" ? params.name : "";
      const tool = server.tools.find((t) => t.name === name);
      if (!tool) return fail(-32602, `Unknown tool: ${name}`);
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const text = await tool.handler(args);
        return reply({ content: [{ type: "text", text }] });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply({ content: [{ type: "text", text: message }], isError: true });
      }
    }
    default:
      return fail(-32601, `Method not found: ${method}`);
  }
}

/** Serve `tools` on stdin/stdout until stdin closes. */
export function serveMcpStdio(server: { name: string; version: string; tools: McpTool[] }): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    const queue: Promise<void>[] = [];
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let req: Request;
      try {
        req = JSON.parse(trimmed) as Request;
      } catch {
        process.stdout.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`,
        );
        return;
      }
      const job = handleMcpRequest(req, server).then((res) => {
        if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
      });
      queue.push(job);
    });
    rl.on("close", () => {
      void Promise.allSettled(queue).then(() => resolve());
    });
  });
}
