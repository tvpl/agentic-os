/**
 * The permission prompt tool (plan Onda 1 §3). Claude Code spawns this
 * server for a write run (`--permission-prompt-tool mcp__mordomo__approve`)
 * and calls `approve` whenever a tool needs a human decision. The tool turns
 * the request into a MordomoOS approval (`POST /api/approvals/tool`), which
 * shows up in the Console, the run page and the inbox, and waits for the
 * answer (`GET /api/approvals/:id`) — denying on timeout so a forgotten
 * prompt never leaves the CLI hanging.
 *
 * Environment (set by the API when it builds the MCP config for the run):
 *   MORDOMO_URL, MORDOMO_TOKEN, MORDOMO_RUN_ID, MORDOMO_APPROVAL_TIMEOUT_MS.
 */
import { serveMcpStdio, type McpTool } from "./stdio.js";

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const POLL_MS = 1000;

interface ApprovalRow {
  id: string;
  status: "pending" | "approved" | "denied" | "expired";
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${env("MORDOMO_URL")}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-mordomo-token": env("MORDOMO_TOKEN") },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return (await res.json()) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ask MordomoOS; resolves to allow/deny as the JSON string Claude Code expects. */
export async function decide(
  args: Record<string, unknown>,
  deps = { call, sleep, now: Date.now },
): Promise<string> {
  const toolName = typeof args.tool_name === "string" ? args.tool_name : "tool";
  const input = (args.input ?? {}) as Record<string, unknown>;
  const toolUseId = typeof args.tool_use_id === "string" ? args.tool_use_id : undefined;
  const timeoutMs = Number(process.env.MORDOMO_APPROVAL_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const created = await deps.call<ApprovalRow>("POST", "/api/approvals/tool", {
    runId: env("MORDOMO_RUN_ID"),
    toolName,
    input,
    ...(toolUseId ? { toolUseId } : {}),
  });
  const started = deps.now();
  let status = created.status;
  while (status === "pending") {
    if (deps.now() - started > timeoutMs) {
      await deps
        .call("POST", `/api/approvals/${created.id}/resolve`, { decision: "denied" })
        .catch(() => undefined);
      return JSON.stringify({
        behavior: "deny",
        message: "MordomoOS: nobody answered the approval in time.",
      });
    }
    await deps.sleep(POLL_MS);
    status = (await deps.call<ApprovalRow>("GET", `/api/approvals/${created.id}`)).status;
  }
  if (status === "approved") return JSON.stringify({ behavior: "allow", updatedInput: input });
  return JSON.stringify({ behavior: "deny", message: `MordomoOS: ${toolName} was ${status} by the user.` });
}

export const approveTool: McpTool = {
  name: "approve",
  description: "Ask the MordomoOS user whether this tool call may run. Returns {behavior: allow|deny}.",
  inputSchema: {
    type: "object",
    properties: {
      tool_name: { type: "string" },
      input: { type: "object" },
      tool_use_id: { type: "string" },
    },
    required: ["tool_name", "input"],
  },
  handler: (args) => decide(args),
};

export function servePermissionTool(version: string): Promise<void> {
  return serveMcpStdio({ name: "mordomo-permissions", version, tools: [approveTool] });
}
