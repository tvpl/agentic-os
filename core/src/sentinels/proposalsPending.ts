import type { Db } from "../db/db.js";
import type { EventBus } from "../events.js";
import { pendingCount } from "../memory/proposals.js";
import { readMetaJson, writeMetaJson } from "./meta.js";
import { emitSentinel, sentinelDay, type SentinelFiredPayload } from "./types.js";

/**
 * "The agent's proposals wait for review." (.specs/features/cerebro-memoria-confiavel, door 11.) Once a local day, from
 * the hourly pass, one notification when at least one proposal is pending; no model, no network. The day it fired is
 * kept in `meta` (`sentinel.proposalsPending.day`), not read back from the inbox: the owner deleting the row does not
 * make another one that day (L-060).
 */

export const PROPOSALS_PENDING_DAY_KEY = "sentinel.proposalsPending.day";
export const PROPOSALS_PENDING_HREF = "/brain/reviews?tab=agent";

/** The payload for `count` pending proposals, or null when there is none. */
export function proposalsPendingAlert(count: number): SentinelFiredPayload | null {
  if (count <= 0) return null;
  return {
    sentinel: "proposalsPending",
    title: `${count} agent proposals to review`,
    body: "What agents proposed to write to the memory waits in Reviews › From the agent: accept all, part or none.",
    severity: "info",
    href: PROPOSALS_PENDING_HREF,
    count,
    messageParams: { count },
  };
}

export interface ProposalsPendingDeps {
  db: Db;
  bus: EventBus;
  now?: () => number;
}

/** The hourly check: emits at most one `sentinel.fired` a local day. Returns what it emitted. */
export function checkProposalsPending(deps: ProposalsPendingDeps): SentinelFiredPayload[] {
  const day = sentinelDay(deps.now?.() ?? Date.now());
  if (readMetaJson<string>(deps.db, PROPOSALS_PENDING_DAY_KEY) === day) return [];
  const payload = proposalsPendingAlert(pendingCount(deps.db));
  if (!payload) return [];
  writeMetaJson(deps.db, PROPOSALS_PENDING_DAY_KEY, day);
  return [emitSentinel(deps.bus, payload)];
}
