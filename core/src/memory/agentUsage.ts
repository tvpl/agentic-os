import type { Db } from "../db/db.js";

/**
 * What the agents read of the second brain (.specs/features/cerebro-perguntar, door 7): one record in `meta`,
 * `agents.usage`, that every read of an agent (the principal `mcp`, or a run's own credential) adds to, by tool, by
 * client and by path. Bounded like `recordRecall`'s: 500 paths (the one with fewest reads leaves, on a tie the one read
 * longest ago) and 50 clients (the one seen longest ago leaves). A record that cannot be read starts again.
 */

export const AGENT_USAGE_KEY = "agents.usage";
export const AGENT_USAGE_MAX_PATHS = 500;
export const AGENT_USAGE_MAX_CLIENTS = 50;

interface Counter {
  calls: number;
  lastAt: number;
}

interface AgentUsageRecord {
  v: 1;
  since: number;
  calls: number;
  byTool: Record<string, Counter>;
  byClient: Record<string, Counter>;
  paths: Record<string, { reads: number; lastAt: number }>;
}

/** One read: the tool (or, for a run, the route's name), the client (`run:<provider>` for a run) and the paths read. */
export interface AgentRead {
  tool: string;
  client: string;
  paths: readonly string[];
}

export interface AgentUsageCount {
  name: string;
  calls: number;
  lastAt: number;
}

export interface AgentUsage {
  /** When the record was first written; null while there is none. */
  since: number | null;
  calls: number;
  byTool: AgentUsageCount[];
  byClient: AgentUsageCount[];
  /** The most read paths `allow` lets through, by reads, then the newest read, then the path. */
  paths: Array<{ path: string; reads: number; lastAt: number; fileId?: number }>;
}

const isMap = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** The stored record, or null when there is none or it is not one (not JSON, another `v`, a part of another shape). */
function load(db: Db): AgentUsageRecord | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(AGENT_USAGE_KEY) as { value: string } | undefined;
  if (!row) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    return null;
  }
  if (!isMap(parsed) || parsed.v !== 1) return null;
  if (typeof parsed.since !== "number" || typeof parsed.calls !== "number") return null;
  if (!isMap(parsed.byTool) || !isMap(parsed.byClient) || !isMap(parsed.paths)) return null;
  return parsed as unknown as AgentUsageRecord;
}

const bump = (map: Record<string, Counter>, key: string, now: number): void => {
  map[key] = { calls: (map[key]?.calls ?? 0) + 1, lastAt: now };
};

/** Add one read of an agent to `agents.usage`, read and written in one transaction. */
export function recordAgentUsage(db: Db, read: AgentRead, now = Date.now()): void {
  db.transaction(() => {
    const record = load(db) ?? { v: 1, since: now, calls: 0, byTool: {}, byClient: {}, paths: {} };
    record.calls += 1;
    bump(record.byTool, read.tool, now);
    bump(record.byClient, read.client, now);
    for (const p of new Set(read.paths)) {
      record.paths[p] = { reads: (record.paths[p]?.reads ?? 0) + 1, lastAt: now };
    }
    const paths = Object.entries(record.paths);
    if (paths.length > AGENT_USAGE_MAX_PATHS) {
      paths.sort((a, b) => b[1].reads - a[1].reads || b[1].lastAt - a[1].lastAt);
      record.paths = Object.fromEntries(paths.slice(0, AGENT_USAGE_MAX_PATHS));
    }
    const clients = Object.entries(record.byClient);
    if (clients.length > AGENT_USAGE_MAX_CLIENTS) {
      clients.sort((a, b) => b[1].lastAt - a[1].lastAt);
      record.byClient = Object.fromEntries(clients.slice(0, AGENT_USAGE_MAX_CLIENTS));
    }
    db.prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(AGENT_USAGE_KEY, JSON.stringify(record));
  })();
}

const counts = (map: Record<string, Counter>): AgentUsageCount[] =>
  Object.entries(map)
    .map(([name, c]) => ({ name, calls: c.calls, lastAt: c.lastAt }))
    .sort((a, b) => b.calls - a.calls || b.lastAt - a.lastAt || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

/**
 * What `GET /api/mcp` shows of the record: the totals, by tool and by client, and the `limit` most read paths that
 * `allow` lets through (today's policy, the folders hidden from agents), each with the id of its index row when it is
 * one. A path left out stays counted in `calls`.
 */
export function agentUsage(db: Db, allow: (absolute: string) => boolean = () => true, limit = 20): AgentUsage {
  const record = load(db);
  if (!record) return { since: null, calls: 0, byTool: [], byClient: [], paths: [] };
  const idOf = db.prepare("SELECT id FROM files WHERE path = ?");
  const paths = Object.entries(record.paths)
    .filter(([p]) => allow(p))
    .map(([p, s]) => ({ path: p, reads: s.reads, lastAt: s.lastAt }))
    .sort((a, b) => b.reads - a.reads || b.lastAt - a.lastAt || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, limit)
    .map((entry) => {
      const row = idOf.get(entry.path) as { id: number } | undefined;
      return row ? { ...entry, fileId: row.id } : entry;
    });
  return {
    since: record.since,
    calls: record.calls,
    byTool: counts(record.byTool),
    byClient: counts(record.byClient),
    paths,
  };
}
