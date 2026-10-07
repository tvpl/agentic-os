import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ObjectiveStore,
  RunManager,
  SettingsStore,
  openDb,
  type AgentAdapter,
  type Db,
  type RunEvent,
} from "@mordomo/core";
import { claudeManifest } from "@mordomo/adapter-claude";
import { makeTempHome } from "./helpers.js";

describe("durable objectives", () => {
  let temp: ReturnType<typeof makeTempHome>;
  let db: Db;
  let runs: RunManager;
  let objectives: ObjectiveStore;

  beforeEach(() => {
    temp = makeTempHome("mordomo-objective-");
    db = openDb(temp.paths).db;
    const settings = new SettingsStore(temp.paths).load();
    settings.providers.claude.enabled = true;
    const adapter = {
      id: "claude",
      manifest: claudeManifest,
      async *execute(): AsyncIterable<RunEvent> {
        yield { type: "assistant", ts: Date.now(), text: "verified response" };
        yield { type: "result", ts: Date.now(), exitCode: 0, summary: "ok", durationMs: 1, timedOut: false };
      },
    } as AgentAdapter;
    runs = new RunManager(
      db,
      temp.paths,
      () => settings,
      () => adapter,
      { pruneOnBoot: false },
    );
    objectives = new ObjectiveStore(db, temp.paths);
  });

  afterEach(async () => {
    await runs.shutdown(100);
    db.close();
    temp.cleanup();
  });

  it("orders dependencies and verifies evidence separately from process completion", async () => {
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    const objective = objectives.create({
      title: "Ship durable work",
      context: { decisions: ["Use local evidence"] },
      steps: [
        {
          id: firstId,
          title: "Inspect",
          request: { version: 1, kind: "prompt", prompt: "inspect", mode: "read_only" },
          resourceKeys: ["workspace:a"],
        },
        {
          id: secondId,
          title: "Change",
          request: { version: 1, kind: "prompt", prompt: "change", mode: "read_only" },
          dependencies: [firstId],
        },
      ],
    });
    expect(objectives.ready(objective.id).map((step) => step.id)).toEqual([firstId]);
    const run = runs.create({
      origin: "manual",
      provider: "claude",
      prompt: "inspect",
      request: { version: 1, kind: "prompt", prompt: "inspect", mode: "read_only" },
      cwd: temp.paths.home,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 10_000,
      profile: "read_only",
    });
    objectives.markDispatched(firstId, run.id);
    const done = await runs.execute(run.id, "inspect", "read_only");
    objectives.syncRun(done, runs);
    const updated = objectives.get(objective.id)!;
    expect(updated.steps[0]?.status).toBe("verified");
    expect(updated.steps[0]?.evidence).toMatchObject({
      verified: true,
      processStatus: "done",
      replyPresent: true,
    });
    expect(objectives.ready(objective.id).map((step) => step.id)).toEqual([secondId]);
    expect(objectives.contextPacket(objective.id, secondId)).toMatchObject({
      decisions: ["Use local evidence"],
      dependencies: [{ id: firstId }],
    });
  });

  it("requeues only an unstarted orphan and blocks an uncertain started attempt", () => {
    const objective = objectives.create({
      title: "Recover",
      steps: [
        { title: "Safe", request: { version: 1, kind: "prompt", prompt: "safe", mode: "read_only" } },
        { title: "Uncertain", request: { version: 1, kind: "prompt", prompt: "write", mode: "write" } },
      ],
    });
    const make = (prompt: string, mode: "read_only" | "write") =>
      runs.create({
        origin: "manual",
        provider: "claude",
        prompt,
        cwd: temp.paths.home,
        model: null,
        effort: "default",
        mode,
        timeoutMs: 10_000,
        profile: mode === "write" ? "autonomous" : "read_only",
      });
    const queued = make("safe", "read_only");
    objectives.markDispatched(objective.steps[0]!.id, queued.id);
    const started = make("write", "write");
    db.prepare("UPDATE runs SET status = 'interrupted', started_at = ?, finished_at = ? WHERE id = ?").run(
      Date.now() - 10,
      Date.now(),
      started.id,
    );
    objectives.markDispatched(objective.steps[1]!.id, started.id);
    expect(objectives.recover(runs)).toEqual({ requeued: 1, uncertain: 1, synchronized: 0 });
    const recovered = objectives.get(objective.id)!;
    expect(recovered.steps[0]).toMatchObject({ status: "pending", runId: null });
    expect(recovered.steps[1]).toMatchObject({
      status: "blocked",
      effectsUncertain: true,
      nextAction: "Reconcile effects before retrying",
    });
    expect(() => objectives.retryStep(recovered.steps[1]!.id, false)).toThrow(/Reconcile uncertain effects/);
    expect(objectives.retryStep(recovered.steps[1]!.id, true).status).toBe("pending");
  });

  it("rejects dependency cycles and does not schedule conflicting resources in one wave", () => {
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    expect(() =>
      objectives.create({
        title: "Cycle",
        steps: [
          {
            id: firstId,
            title: "First",
            request: { version: 1, kind: "prompt", prompt: "first", mode: "read_only" },
            dependencies: [secondId],
          },
          {
            id: secondId,
            title: "Second",
            request: { version: 1, kind: "prompt", prompt: "second", mode: "read_only" },
            dependencies: [firstId],
          },
        ],
      }),
    ).toThrow(/cycle/);

    const objective = objectives.create({
      title: "Exclusive resource",
      steps: [
        {
          title: "Higher priority",
          request: { version: 1, kind: "prompt", prompt: "first", mode: "read_only" },
          resourceKeys: ["workspace:shared"],
          priority: 10,
        },
        {
          title: "Lower priority",
          request: { version: 1, kind: "prompt", prompt: "second", mode: "read_only" },
          resourceKeys: ["workspace:shared"],
        },
      ],
    });
    expect(objectives.ready(objective.id, 2).map((step) => step.title)).toEqual(["Higher priority"]);
  });
});
