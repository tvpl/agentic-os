import crypto from "node:crypto";
import type { Principal } from "./routes/common.js";
import { principalName } from "./routes/common.js";

/**
 * Stream tickets (.specs/features/escopos-dispositivo, door 5): an `EventSource` cannot send a header, and the
 * credential in the URL lands in proxy logs and browser history. A principal that already holds a credential asks
 * for a ticket instead (`POST /api/stream-tickets`) and puts only that in the URL: `tk_` + 24 random bytes, good for
 * one presentation within 30 seconds, tied to the principal that asked and to the one stream it was asked for.
 * The state lives in this process and starts empty on every restart, like the attempt limits.
 */
export const TICKET_TTL_MS = 30_000;
/** Live tickets one principal may hold at once; the next ask is `429`. */
export const TICKETS_PER_PRINCIPAL = 32;

interface Held {
  key: string;
  principal: Principal;
  holder: string;
  expiresAt: number;
}

/**
 * What a ticket is good for: the route as the router matched it (`/api/runs/:id/stream`) and the values of its path
 * parameters, so a ticket for run X never opens run Y and a ticket for the event feed never opens a run stream.
 */
export function ticketKey(route: string, params: Record<string, unknown> | undefined): string {
  const pairs = Object.entries(params ?? {})
    .map(([k, v]) => [k, String(v)] as [string, string])
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `${route}?${new URLSearchParams(pairs).toString()}`;
}

export class TicketStore {
  private readonly held = new Map<string, Held>();

  /** A ticket for `principal` to open the stream `key` names, or null while the principal already holds the limit. */
  mint(principal: Principal, key: string): { ticket: string; expiresAt: number } | null {
    const now = Date.now();
    this.sweep(now);
    const holder = principalName(principal);
    let live = 0;
    for (const entry of this.held.values()) if (entry.holder === holder) live += 1;
    if (live >= TICKETS_PER_PRINCIPAL) return null;
    const ticket = `tk_${crypto.randomBytes(24).toString("base64url")}`;
    const expiresAt = now + TICKET_TTL_MS;
    this.held.set(ticket, { key, principal, holder, expiresAt });
    return { ticket, expiresAt };
  }

  /**
   * The principal a ticket was minted for, if it is presented for the stream it was minted for within its life. The
   * first presentation consumes it whatever the outcome, so a ticket that reaches the wrong route is dead.
   */
  redeem(ticket: string, key: string): Principal | null {
    const entry = this.held.get(ticket);
    if (!entry) return null;
    this.held.delete(ticket);
    if (entry.expiresAt <= Date.now() || entry.key !== key) return null;
    return entry.principal;
  }

  private sweep(now: number): void {
    for (const [ticket, entry] of this.held) if (entry.expiresAt <= now) this.held.delete(ticket);
  }
}
