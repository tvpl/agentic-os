/**
 * "Agentes (MCP)" in the gallery (.specs/features/cerebro-perguntar, C99; design.md "Aba - Agentes (MCP) das
 * Configurações"): the tab from fixture data (the gallery never talks to the API): Claude Code connected, Cursor not
 * connected, Codex with a config file that does not parse, the 13 tools and no usage; then the usage card with reads.
 * Fetched when the gallery opens, through the tab's own chunk.
 */
import { AgentsMcp, Usage, type McpOverview } from "../views/settings/AgentsMcp";

const ROOT = "/fixture/memory/";
const AT = Date.UTC(2026, 10, 22, 13, 0);
const KIND = { r: "read", p: "propose", o: "owner" } as const;
const TOOLS =
  "recall skills_list skills_run journal_append facts_assert facts_query note_create note_read note_save inbox_unread search links hygiene"
    .split(" ")
    .map((name, i) => ({ name, kind: KIND["rroppprprorrr"[i] as keyof typeof KIND] }));
const DATA: McpOverview = {
  clients: [
    {
      id: "claude",
      name: "Claude Code",
      connected: true,
      source: "/fixture/.claude.json",
      command: "claude mcp add mordomo -- mordomo mcp",
    },
    {
      id: "cursor",
      name: "Cursor",
      connected: false,
      command:
        '{\n  "mcpServers": {\n    "mordomo": {\n      "command": "mordomo",\n      "args": [\n        "mcp"\n      ]\n    }\n  }\n}',
    },
    {
      id: "codex",
      name: "Codex",
      connected: false,
      source: "/fixture/.codex/config.toml",
      unreadable: true,
      command: '[mcp_servers.mordomo]\ncommand = "mordomo"\nargs = ["mcp"]',
    },
  ],
  tools: TOOLS,
  usage: { since: null, calls: 0, byTool: [], byClient: [], paths: [] },
};
const count = (name: string, calls: number) => ({ name, calls, lastAt: AT });

export default function AgentsMcpStory() {
  return (
    <>
      <AgentsMcp data={DATA} root={ROOT} />
      <div className="am">
        <Usage
          usage={{
            since: AT - 7 * 86_400_000,
            calls: 12,
            byTool: [count("search", 7), count("recall", 4), count("note_read", 1)],
            byClient: [count("claude-code", 9), count("run:claude", 3)],
            paths: [
              { path: `${ROOT}notes/onboarding.md`, reads: 5, lastAt: AT, fileId: 1 },
              { path: `${ROOT}notes/plano.md`, reads: 3, lastAt: AT },
            ],
          }}
          root={ROOT}
        />
      </div>
    </>
  );
}
