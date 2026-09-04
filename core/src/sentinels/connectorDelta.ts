import crypto from "node:crypto";
import type { Db } from "../db/db.js";
import type { EventBus } from "../events.js";
import type { Settings } from "../config/schema.js";
import type { Connector } from "../connectors/registry.js";
import { fetchConnectorData, type ConnectorData, type FetchOptions } from "../connectors/client.js";
import { readMetaJson, writeMetaJson } from "./meta.js";
import { emitSentinel, type SentinelFiredPayload } from "./types.js";

/**
 * "Something new arrived." Once an hour every connector that has a read
 * mapping is read through the existing read-only data client (the same call
 * `GET /api/connectors/:id/data` makes) and its item ids are hashed. Ids that
 * were not in the previous check are new.
 *
 * Only ids are kept — never titles, never bodies — and they are kept hashed,
 * so the mark left in the `meta` table says "I have seen this item" without
 * saying what the item was.
 */

const META_PREFIX = "sentinel:connectorDelta:";
/** Ids remembered per connector (a page of items is far smaller than this). */
const MAX_REMEMBERED = 400;

export interface ConnectorDeltaMark {
  /** Fingerprint of the whole id set — a cheap "nothing moved" check. */
  hash: string;
  /** Short digests of the ids seen last time. */
  ids: string[];
  at: number;
}

export function connectorMetaKey(connectorId: string): string {
  return `${META_PREFIX}${connectorId}`;
}

/** Short, stable digest of one item id (the id itself is never stored). */
export function hashId(id: string): string {
  return crypto.createHash("sha256").update(id).digest("hex").slice(0, 16);
}

/** Fingerprint of a whole id set, order-insensitive. */
export function hashIds(ids: readonly string[]): string {
  return crypto
    .createHash("sha256")
    .update([...ids].sort().join("\n"))
    .digest("hex")
    .slice(0, 32);
}

export interface ConnectorDelta {
  hash: string;
  digests: string[];
  /** Digests that were not in the previous mark. */
  newIds: string[];
  /** True on the very first check: there is nothing to compare against. */
  first: boolean;
}

/** Pure diff between a fresh read and the mark left by the previous one. */
export function diffConnectorItems(
  items: ReadonlyArray<{ id: string }>,
  previous: ConnectorDeltaMark | null,
): ConnectorDelta {
  const digests = [...new Set(items.map((i) => hashId(i.id)))];
  const hash = hashIds(digests);
  if (!previous) return { hash, digests, newIds: [], first: true };
  const seen = new Set(previous.ids);
  return { hash, digests, newIds: digests.filter((d) => !seen.has(d)), first: false };
}

/** The mark to store after a check (bounded, newest ids win). */
export function nextMark(
  delta: ConnectorDelta,
  previous: ConnectorDeltaMark | null,
  at: number,
): ConnectorDeltaMark {
  const merged = [...delta.digests, ...(previous?.ids ?? [])];
  return { hash: delta.hash, ids: [...new Set(merged)].slice(0, MAX_REMEMBERED), at };
}

export function connectorDeltaPayload(
  connector: Pick<Connector, "id" | "name">,
  count: number,
): SentinelFiredPayload {
  return {
    sentinel: "connectorDelta",
    title: `${count} new item${count === 1 ? "" : "s"} in ${connector.name}`,
    body: `The read-only mapping of ${connector.name} returned ${count} item${
      count === 1 ? "" : "s"
    } that were not there an hour ago.`,
    severity: "info",
    href: `/connectors#${connector.id}`,
    dedupeKey: `sentinel:connectorDelta:${connector.id}:${Math.floor(Date.now() / 3_600_000)}`,
    triage: true,
  };
}

export interface ConnectorDeltaDeps {
  db: Db;
  bus: EventBus;
  /** `ConnectorRegistry` satisfies this. */
  connectors: { list(): Connector[] };
  getSettings: () => Settings;
  /** Working directory handed to the connector client (the MordomoOS home). */
  cwd: string;
  /** Injected in tests; defaults to the real read-only client. */
  fetchData?: (connector: Connector, opts: FetchOptions) => Promise<ConnectorData>;
  now?: () => number;
}

/**
 * Hourly pass over every connector with a read mapping. Never throws: a
 * connector that is not configured, or whose MCP server is down, is skipped.
 */
export async function checkConnectorDeltas(deps: ConnectorDeltaDeps): Promise<SentinelFiredPayload[]> {
  const settings = deps.getSettings();
  const now = deps.now?.() ?? Date.now();
  const fetchData = deps.fetchData ?? fetchConnectorData;
  const fired: SentinelFiredPayload[] = [];
  for (const connector of deps.connectors.list()) {
    if (!connector.dataMapping) continue;
    let data: ConnectorData;
    try {
      data = await fetchData(connector, {
        allowedCommands: settings.connectors.allowedCommands,
        timeoutMs: settings.connectors.dataTimeoutMs,
        cwd: deps.cwd,
        tz: settings.timezone,
        maxItems: settings.sentinels.connectorDelta.maxItems,
      });
    } catch {
      continue; // a broken connector is the connector page's problem, not an alert
    }
    if (data.status !== "ok" || data.items.length === 0) continue;
    const key = connectorMetaKey(connector.id);
    const previous = readMetaJson<ConnectorDeltaMark>(deps.db, key);
    const delta = diffConnectorItems(data.items, previous);
    try {
      writeMetaJson(deps.db, key, nextMark(delta, previous, now));
    } catch {
      /* the mark is a convenience; a write failure must not stop the sweep */
    }
    if (delta.first || delta.newIds.length === 0) continue;
    fired.push(emitSentinel(deps.bus, connectorDeltaPayload(connector, delta.newIds.length)));
  }
  return fired;
}
