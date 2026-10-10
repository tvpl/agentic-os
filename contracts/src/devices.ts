/**
 * What a paired device may do (.specs/features/escopos-dispositivo, door 1). The owner is not a scope: it is the
 * local token, which reaches every route. A device holds a set of these four, always closed (see
 * `closeDeviceScopes`), and a route names the one scope it needs (`config.scope`).
 *
 * - `monitor`: see runs, approvals, notifications and status. It does not clear the inbox (read marks and deletes are the owner's).
 * - `content`: read what the owner's folders, notes and memory hold (files, previews, search, diffs, artifacts), and
 *   register a push subscription at a browser's push service (a push carries the inbox's titles and bodies).
 * - `run`: ask for runs (read-only on a provider that keeps reads in the working folder; a write waits for a human).
 * - `approve`: decide what other people or devices asked for (never what the device asked for itself).
 */
export const DEVICE_SCOPES = ["monitor", "content", "run", "approve"] as const;
export type DeviceScope = (typeof DEVICE_SCOPES)[number];

/** What a device gets when the owner does not choose, and what a device paired before scopes existed reads as. */
export const DEFAULT_DEVICE_SCOPES: readonly DeviceScope[] = ["monitor", "content", "run"];

/**
 * The closure of a set of scopes, in the order of `DEVICE_SCOPES`: `run` brings `content`, `content` and `approve`
 * bring `monitor`. Starting a run lets the agent read what the device could read through `content`, and every other
 * scope is useless without seeing runs and approvals. Anything that is not a scope is dropped.
 */
export function closeDeviceScopes(scopes: Iterable<string>): DeviceScope[] {
  const has = new Set<string>(scopes);
  if (has.has("run")) has.add("content");
  if (has.has("content") || has.has("approve")) has.add("monitor");
  return DEVICE_SCOPES.filter((scope) => has.has(scope));
}

/** A paired device as the API shows it (`GET /api/devices`, `POST /api/pair/claim`). */
export interface DeviceRecord {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
  /** What it may do, always closed. */
  scopes: DeviceScope[];
}

/**
 * Whether a principal name (`Approval.resolvedBy`, `Approval.requestedBy`, `RunRecord.startedBy`) is a paired
 * device: `device:<id>`. The owner is `owner`; a routine, a sentinel and the CLI are `null`.
 */
export function isDeviceActor(by: string | null | undefined): by is `device:${string}` {
  return typeof by === "string" && by.startsWith("device:") && by.length > "device:".length;
}
