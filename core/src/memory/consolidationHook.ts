import path from "node:path";
import { PROPOSAL_FILE_MAX_BYTES, ProposalFileSchema } from "@mordomo/contracts";
import type { Settings } from "../config/schema.js";
import type { Db } from "../db/db.js";
import type { EventBus, OsEvent } from "../events.js";
import type { NotificationInput } from "../notifications/store.js";
import type { MordomoPaths } from "../paths.js";
import { homeReadScope, readWorkspaceFile } from "../security/safeFs.js";
import { storeProposal } from "./proposals.js";

/**
 * The consolidation leaves a proposal, never a write (.specs/features/cerebro-memoria-confiavel, door 6): when a run of
 * `consolidate-memory` finishes `done`, its `artifacts/<runId>/proposal.json` is read through the safe reader (at most
 * 256 KiB), checked against the schema, and stored as one pending `consolidation` proposal (which supersedes the one
 * pending before it). A file that is missing, too large, not JSON or outside the schema stores nothing and leaves one
 * inbox row that says why (AC 53, G23). A run that did not finish `done`, or of another skill, is not read.
 */

export const CONSOLIDATION_SKILL = "consolidate-memory";
export const PROPOSAL_FILE = "proposal.json";
/** The title of the inbox row a consolidation that left nothing usable writes (AC 53). */
export const INVALID_NOTICE_TITLE = "A consolidação não deixou uma proposta válida";

export interface ConsolidationHookDeps {
  db: Db;
  paths: MordomoPaths;
  getSettings: () => Settings;
  runs: { get(id: string): { skillSlug: string | null } | null };
  notifications: { add(input: NotificationInput): unknown };
}

/** Why `proposal.json` cannot be a proposal, or the file as the schema reads it. */
export function readProposalFile(
  deps: Pick<ConsolidationHookDeps, "paths" | "getSettings">,
  runId: string,
): { ok: true; file: ReturnType<typeof ProposalFileSchema.parse> } | { ok: false; reason: string } {
  const { paths } = deps;
  const file = path.join(paths.artifacts, runId, PROPOSAL_FILE);
  let bytes: Buffer;
  try {
    bytes = readWorkspaceFile(homeReadScope(paths.home, [paths.artifacts], deps.getSettings().excludes), file, {
      maxBytes: PROPOSAL_FILE_MAX_BYTES,
      strict: true,
    }).bytes;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { ok: false, reason: `The run left no ${PROPOSAL_FILE} (missing).` };
    if (code === "file_too_large") return { ok: false, reason: `${PROPOSAL_FILE} is larger than 256 KiB.` };
    return { ok: false, reason: `${PROPOSAL_FILE} cannot be read: ${err instanceof Error ? err.message : String(err)}` };
  }
  let json: unknown;
  try {
    json = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { ok: false, reason: `${PROPOSAL_FILE} is not JSON.` };
  }
  const parsed = ProposalFileSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return { ok: false, reason: `${PROPOSAL_FILE} is outside the schema: ${issue.path.join(".") || "(root)"}: ${issue.message}` };
  }
  return { ok: true, file: parsed.data };
}

/** React to one finished run. Returns the proposal's id, the reason nothing was stored, or null when it is not one. */
export function consolidationFinished(
  deps: ConsolidationHookDeps,
  payload: { runId?: unknown; status?: unknown },
): { proposalId: string } | { refused: string } | null {
  if (typeof payload.runId !== "string" || payload.status !== "done") return null;
  const runId = payload.runId;
  if (deps.runs.get(runId)?.skillSlug !== CONSOLIDATION_SKILL) return null;
  const read = readProposalFile(deps, runId);
  if (!read.ok) {
    deps.notifications.add({
      kind: "system",
      tone: "warn",
      messageKey: "proposals.invalidNotice",
      messageParams: {},
      title: INVALID_NOTICE_TITLE,
      body: read.reason,
      href: `/runs/${runId}`,
      runId,
    });
    return { refused: read.reason };
  }
  const { v, summary, ops } = read.file;
  const proposal = storeProposal(
    deps.db,
    { kind: "consolidation", author: `run:${runId}`, runId, summary, payload: { v, summary, ops } },
    // the hook has no caller to answer a 429 to: it always stores (G8)
    { capped: false },
  );
  return { proposalId: proposal.id };
}

/** Subscribe the hook to the bus; returns the unsubscribe function. */
export function installConsolidationHook(bus: EventBus, deps: ConsolidationHookDeps): () => void {
  return bus.subscribe((event: OsEvent) => {
    if (event.type !== "run.finished") return;
    try {
      consolidationFinished(deps, (event.payload ?? {}) as { runId?: unknown; status?: unknown });
    } catch (err) {
      console.error("[memory] the consolidation's proposal could not be stored", err);
    }
  });
}
