import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * `.specs/features/cerebro-perguntar` batch B: a loopback server that records the method, path and headers of every
 * request `mordomo mcp` sends it, and answers each route of the 13 tools with a body of the shape the tool reads, so
 * every tool finishes its call.
 */

export interface Recorded {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
}

export interface McpRecorder {
  url: string;
  seen: Recorded[];
  close: () => Promise<void>;
}

function answer(method: string, path: string): unknown {
  const p = path.replace(/\?.*$/, "");
  if (p === "/api/v1/memory/recall") return { answerContext: [] };
  if (p === "/api/v1/skills") return [];
  if (/^\/api\/v1\/skills\/[^/]+\/run$/.test(p)) return { runId: "r1", status: "queued" };
  if (p === "/api/v1/memory/journal/append") return {};
  if (p === "/api/v1/memory/proposals") return { proposal: { id: "mp_0123456789abcdef" } };
  if (p === "/api/v1/memory/facts") return { facts: [], stats: {} };
  if (p === "/api/v1/memory/note") return { path: "/n.md", version: "sha256:0", editable: true, content: "" };
  if (p === "/api/v1/notifications") return { items: [] };
  if (p === "/api/v1/memory/search") return [];
  if (p === "/api/v1/memory/links") return { file: { path: "/n.md" }, backlinks: [], outgoing: [] };
  if (p === "/api/v1/memory/hygiene") {
    return {
      counts: { orphan: 0, "dangling-link": 0, stale: 0 },
      items: [],
      brokenLinks: { count: 0, items: [] },
    };
  }
  return { method };
}

export async function mcpRecorder(): Promise<McpRecorder> {
  const seen: Recorded[] = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      seen.push({ method: req.method ?? "", path: req.url ?? "", headers: req.headers });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(answer(req.method ?? "", req.url ?? "")));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
