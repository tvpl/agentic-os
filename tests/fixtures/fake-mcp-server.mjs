#!/usr/bin/env node
/**
 * Faithful-enough fake MCP stdio server for the connector data-client tests.
 * Newline-delimited JSON-RPC 2.0 on stdin/stdout. Never used in production.
 *
 * Modes (argv[2]):
 *   ok         initialize → tools/list → tools/call all answer normally
 *   noisy      prints non-JSON log lines to stdout before every answer
 *   malformed  answers tools/call with text that is not JSON at all
 *   badjson    emits a broken JSON-RPC frame (unparsable line) and nothing else
 *   slow       answers initialize and tools/list, then never answers tools/call
 *   crash      exits with a message on stderr right after initialize
 *   notools    tools/list answers with an empty tool list
 *   toolerror  tools/call answers with isError: true
 */
const MODE = process.argv[2] ?? "ok";

const TOOLS = [
  { name: "list_events", description: "List calendar events in a window (read-only)." },
  { name: "search_events", description: "Search events (read-only)." },
  { name: "delete_event", description: "Delete an event (write)." },
];

const EVENTS = {
  events: [
    { id: "e1", summary: "Standup", start: { dateTime: "2026-09-03T09:00:00Z" }, status: "confirmed", calendar: "work" },
    { id: "e2", summary: "Design review", start: { dateTime: "2026-09-03T14:00:00Z" }, status: "tentative", calendar: "work" },
    { id: "e3", summary: "Dentist", start: { dateTime: "2026-09-03T18:30:00Z" }, status: "confirmed", calendar: "personal" },
  ],
};

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function noise() {
  if (MODE === "noisy") process.stdout.write("[fake-mcp] serving a request\n");
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) handle(line);
  }
});

function handle(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (typeof msg.id !== "number") return; // notification (e.g. notifications/initialized)
  noise();
  switch (msg.method) {
    case "initialize":
      if (MODE === "badjson") {
        process.stdout.write("{not json at all\n");
        return;
      }
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "fake-mcp", version: "1.0.0" },
        },
      });
      if (MODE === "crash") {
        process.stderr.write("fake-mcp: credentials file not found\n");
        process.exit(3);
      }
      return;
    case "tools/list":
      send({ jsonrpc: "2.0", id: msg.id, result: { tools: MODE === "notools" ? [] : TOOLS } });
      return;
    case "tools/call": {
      const name = msg.params?.name;
      if (MODE === "slow") return; // never answers: the client must time out
      if (MODE === "toolerror") {
        send({ jsonrpc: "2.0", id: msg.id, result: { isError: true, content: [{ type: "text", text: "upstream refused" }] } });
        return;
      }
      if (name === "delete_event") {
        // A correct client never reaches this; if it does, make the test loud.
        send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "DELETED" }] } });
        return;
      }
      if (MODE === "malformed") {
        send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "Standup at 9\nDesign review at 14\nDentist at 18:30" }] } });
        return;
      }
      const args = msg.params?.arguments ?? {};
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: JSON.stringify({ ...EVENTS, args }) }] },
      });
      return;
    }
    default:
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
  }
}

process.stdin.on("end", () => process.exit(0));
