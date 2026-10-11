/**
 * The public surface of the SDK (.specs/features/sdk-core, C40): what a program may write against `@mordomo/core`
 * compiles, and what would let it around the rules of the engine does not.
 */
import { createEngine } from "@mordomo/core";
import type { Engine, Execution, ProviderRegistry, RunRecord, StartedRun } from "@mordomo/core";

declare const providers: ProviderRegistry;

const engine: Engine = createEngine({ providers });

// The minimal calls of the README.
engine.updateSettings({ defaultProvider: "echo", providers: { echo: { enabled: true } } });
const started: StartedRun = engine.execution.startPrompt({ prompt: "say hi", startedBy: null });
const finished: Promise<RunRecord> = engine.execution.wait(started.runId);
engine.execution.subscribe(started.runId, (event) => {
  if (event.type === "text") event.text.toUpperCase();
});
void finished;

// `startedBy` is not optional: a caller that forgets it does not compile instead of running as nobody.
// @ts-expect-error startedBy is required
engine.execution.startPrompt({ prompt: "x" });
// @ts-expect-error startedBy is required
engine.execution.startSkill({ slug: "s" });
// @ts-expect-error startedBy is required
engine.execution.retry("run", { submissionId: "0b3a2c6e-0000-4000-8000-000000000000" });

// A decision is one of two words.
// @ts-expect-error not a decision
engine.execution.resolveApproval("id", "maybe", null);
engine.execution.resolveApproval("id", "approved", "owner");
engine.execution.resolveApproval("id", "denied", null);

// The engine is not its stores: nothing here reaches the database, the run manager or the approval store.
// @ts-expect-error not part of Engine
void engine.db;
// @ts-expect-error not part of Engine
void engine.runs;
// @ts-expect-error not part of Engine
void engine.approvals;
// @ts-expect-error not part of Engine
void engine.gateWrite;

// The options of the app's service are not the library's.
// @ts-expect-error not an option of createEngine
createEngine({ providers, applyPendingRestore: true });
// @ts-expect-error not an option of createEngine
createEngine({ providers, permissionBroker: () => null });

// The status of a started run is one of two.
const status: StartedRun["status"] = started.status;
// @ts-expect-error not a status of a start
const impossible: StartedRun["status"] = "running";

// `Execution` is the interface, not the class that implements it.
const execution: Execution = engine.execution;
// @ts-expect-error internal to the implementation
void execution.gateAndLaunchSkill;

export { status, impossible };
