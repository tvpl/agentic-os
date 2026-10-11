import type { FastifyRequest } from "fastify";
import { MordomoError, type AgentAdapter, type ProviderId, type Settings } from "@mordomo/core";
import type { ProviderSettings } from "@mordomo/core/internal";
import type { AppContext } from "../context.js";

export { clipForLabel } from "@mordomo/core/internal";

/**
 * Who made a request (docs/security.md, "Scopes"): the local token is the
 * owner at the machine, a paired device token is a `device`, and a run's
 * permission-broker credential is a `broker` bound to that run, and the credential of a memory skill's run is a
 * `run` bound to it.
 */
export type Principal =
  | { kind: "owner" }
  | { kind: "device"; deviceId: string }
  | { kind: "broker"; runId: string }
  | { kind: "run"; runId: string };

/** How an approval records its decider (`Approval.resolvedBy`). */
export function principalName(principal: Principal): string {
  if (principal.kind === "device") return `device:${principal.deviceId}`;
  if (principal.kind === "broker") return `broker:${principal.runId}`;
  if (principal.kind === "run") return `run:${principal.runId}`;
  return "owner";
}

/**
 * Who asked, by the name runs and approvals record (`RunRecord.startedBy`, `Approval.requestedBy`). The gate sets a
 * principal on every route that is not public, so a handler that reaches this without one is a route the gate did not
 * guard: it fails closed (500) instead of starting work in the name of nobody, which no rule about devices would see.
 */
export function startedByOf(req: FastifyRequest): string {
  if (!req.principal) {
    throw httpError(500, "No principal on a request that starts work", "principal_missing");
  }
  return principalName(req.principal);
}

/** Error carrying an HTTP status — the global error handler maps it 1:1. */
export function httpError(
  statusCode: number,
  message: string,
  code?: string,
): Error & { statusCode: number; code?: string } {
  return Object.assign(new Error(message), { statusCode, ...(code ? { code } : {}) });
}

/**
 * A provider id is only a format: refuse one no adapter is registered for
 * (`400 unknown_provider`) before anything is created, and hand back its
 * settings (the defaults when `settings.json` has no entry for it).
 */
export function requireProvider(
  ctx: AppContext,
  id: ProviderId,
  settings: Settings = ctx.settings(),
): ProviderSettings {
  return ctx.requireProvider(id, settings);
}

/** The live adapter of a registered provider (`400 unknown_provider` otherwise). */
export function requireAdapter(ctx: AppContext, id: ProviderId): AgentAdapter {
  const adapter = ctx.adapters[id];
  if (!adapter) throw unknownProvider(id);
  return adapter;
}

function unknownProvider(id: ProviderId): Error {
  return new MordomoError(
    400,
    `Unknown provider "${id}": no adapter is registered for it`,
    "unknown_provider",
  );
}

/** Roots a user-supplied path may resolve into: the home plus enabled indexed folders (the engine's rule). */
export function grantedRoots(ctx: AppContext): string[] {
  return ctx.grantedRoots();
}
