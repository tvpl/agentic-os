import { SessionId } from "@mordomo/contracts";
import type { AgentRun } from "./types.js";

/**
 * The provider conversation a run asks to continue, only when its id is safe to
 * hand back to the CLI (`--resume <id>`, `exec resume <id>`): an id stored by an
 * earlier version, or by another provider build, that is not a plain token (it
 * could start with `-` and read as a flag) means a fresh conversation instead.
 */
export function resumableSessionId(run: AgentRun): string | undefined {
  const parsed = SessionId.safeParse(run.resume?.providerSessionId);
  return parsed.success ? parsed.data : undefined;
}
