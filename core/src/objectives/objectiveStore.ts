import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db/db.js";
import type { MordomoPaths } from "../paths.js";
import type { RunManager, RunRecord, RunRequestSpec } from "../runs/runManager.js";
import { events } from "../events.js";

export type ObjectiveStatus = "active" | "blocked" | "completed" | "cancelled";
export type ObjectiveStepStatus =
  "pending" | "dispatched" | "waiting_approval" | "verifying" | "verified" | "blocked" | "cancelled";

export interface ObjectiveContext {
  sources?: Array<{ label: string; path?: string; version?: string }>;
  decisions?: string[];
  budgetUsd?: number | null;
  retention?: string;
}

export interface ObjectiveStep {
  id: string;
  objectiveId: string;
  position: number;
  title: string;
  request: RunRequestSpec;
  dependencies: string[];
  resourceKeys: string[];
  expectedArtifacts: string[];
  priority: number;
  status: ObjectiveStepStatus;
  runId: string | null;
  attempt: number;
  effectsUncertain: boolean;
  blockedReason: string | null;
  nextAction: string | null;
  evidence: StepEvidence | null;
  createdAt: number;
  updatedAt: number;
}

export interface StepEvidence {
  verified: boolean;
  checkedAt: number;
  runId: string;
  processStatus: string;
  artifacts: Array<{ path: string; bytes: number; sha256: string }>;
  filesChanged: string[];
  missingExpected: string[];
  replyPresent: boolean;
}

export interface Objective {
  id: string;
  project: string | null;
  title: string;
  description: string;
  status: ObjectiveStatus;
  context: ObjectiveContext;
  createdAt: number;
  updatedAt: number;
  steps: ObjectiveStep[];
}

export interface CreateObjectiveInput {
  project?: string | null;
  title: string;
  description?: string;
  context?: ObjectiveContext;
  steps: Array<{
    id?: string;
    title: string;
    request: RunRequestSpec;
    dependencies?: string[];
    resourceKeys?: string[];
    expectedArtifacts?: string[];
    priority?: number;
  }>;
}

interface ObjectiveRow {
  id: string;
  project: string | null;
  title: string;
  description: string;
  status: ObjectiveStatus;
  context_json: string;
  created_at: number;
  updated_at: number;
}
interface StepRow {
  id: string;
  objective_id: string;
  position: number;
  title: string;
  request_json: string;
  dependencies_json: string;
  resource_keys_json: string;
  expected_artifacts_json: string;
  priority: number;
  status: ObjectiveStepStatus;
  run_id: string | null;
  attempt: number;
  effects_uncertain: number;
  blocked_reason: string | null;
  next_action: string | null;
  evidence_json: string | null;
  created_at: number;
  updated_at: number;
}

export class ObjectiveStore {
  constructor(
    private readonly db: Db,
    private readonly paths: MordomoPaths,
  ) {}

  create(input: CreateObjectiveInput): Objective {
    const id = crypto.randomUUID();
    const now = Date.now();
    const ids = input.steps.map((step) => step.id ?? crypto.randomUUID());
    if (new Set(ids).size !== ids.length) throw new Error("Objective step ids must be unique");
    const known = new Set(ids);
    input.steps.forEach((step, index) => {
      for (const dependency of step.dependencies ?? []) {
        if (!known.has(dependency) || dependency === ids[index])
          throw new Error(`Invalid dependency ${dependency} for objective step`);
      }
    });
    const dependencies = new Map(
      ids.map((stepId, index) => [stepId, input.steps[index]!.dependencies ?? []]),
    );
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (stepId: string): void => {
      if (visiting.has(stepId)) throw new Error("Objective dependencies must not contain a cycle");
      if (visited.has(stepId)) return;
      visiting.add(stepId);
      for (const dependency of dependencies.get(stepId) ?? []) visit(dependency);
      visiting.delete(stepId);
      visited.add(stepId);
    };
    for (const stepId of ids) visit(stepId);
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO objectives(id, project, title, description, status, context_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)",
        )
        .run(
          id,
          input.project ?? null,
          input.title,
          input.description ?? "",
          JSON.stringify(input.context ?? {}),
          now,
          now,
        );
      const insert = this.db.prepare(`INSERT INTO objective_steps
        (id, objective_id, position, title, request_json, dependencies_json, resource_keys_json, expected_artifacts_json, priority, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`);
      input.steps.forEach((step, index) =>
        insert.run(
          ids[index],
          id,
          index,
          step.title,
          JSON.stringify(step.request),
          JSON.stringify(step.dependencies ?? []),
          JSON.stringify(step.resourceKeys ?? []),
          JSON.stringify(step.expectedArtifacts ?? []),
          step.priority ?? 0,
          now,
          now,
        ),
      );
    })();
    const objective = this.get(id)!;
    events.emit("objective.changed", { objectiveId: id, status: objective.status });
    return objective;
  }

  list(): Objective[] {
    return (this.db.prepare("SELECT * FROM objectives ORDER BY updated_at DESC").all() as ObjectiveRow[]).map(
      (row) => this.inflate(row),
    );
  }

  get(id: string): Objective | null {
    const row = this.db.prepare("SELECT * FROM objectives WHERE id = ?").get(id) as ObjectiveRow | undefined;
    return row ? this.inflate(row) : null;
  }

  delete(id: string): boolean {
    const changed = this.db.prepare("DELETE FROM objectives WHERE id = ?").run(id).changes > 0;
    if (changed) events.emit("objective.changed", { objectiveId: id, deleted: true });
    return changed;
  }

  ready(id: string, limit = 4): ObjectiveStep[] {
    const objective = this.get(id);
    if (!objective || objective.status !== "active") return [];
    const verified = new Set(
      objective.steps.filter((step) => step.status === "verified").map((step) => step.id),
    );
    const busyRows = this.db
      .prepare(
        "SELECT resource_keys_json FROM objective_steps WHERE status IN ('dispatched','waiting_approval','verifying')",
      )
      .all() as Array<{ resource_keys_json: string }>;
    const busy = new Set(busyRows.flatMap((row) => parseJson<string[]>(row.resource_keys_json, [])));
    const candidates = objective.steps
      .filter(
        (step) =>
          step.status === "pending" &&
          step.dependencies.every((dependency) => verified.has(dependency)) &&
          step.resourceKeys.every((key) => !busy.has(key)),
      )
      .sort(
        (a, b) =>
          b.priority +
            Math.floor((Date.now() - b.createdAt) / 3_600_000) -
            (a.priority + Math.floor((Date.now() - a.createdAt) / 3_600_000)) || a.position - b.position,
      );
    const selected: ObjectiveStep[] = [];
    for (const step of candidates) {
      if (step.resourceKeys.some((key) => busy.has(key))) continue;
      selected.push(step);
      for (const key of step.resourceKeys) busy.add(key);
      if (selected.length >= limit) break;
    }
    return selected;
  }

  markDispatched(stepId: string, runId: string, waitingApproval = false): void {
    const changed = this.db
      .prepare(
        "UPDATE objective_steps SET status = ?, run_id = ?, attempt = attempt + 1, effects_uncertain = 0, blocked_reason = NULL, next_action = NULL, updated_at = ? WHERE id = ? AND status = 'pending'",
      )
      .run(waitingApproval ? "waiting_approval" : "dispatched", runId, Date.now(), stepId).changes;
    if (changed !== 1) throw new Error("Objective step is no longer ready for dispatch");
    this.touchByStep(stepId);
    events.emit("objective.changed", { objectiveId: this.stepById(stepId)?.objectiveId, stepId });
  }

  retryStep(stepId: string, effectsReconciled: boolean): ObjectiveStep {
    const row = this.db.prepare("SELECT * FROM objective_steps WHERE id = ?").get(stepId) as
      StepRow | undefined;
    if (!row) throw new Error("Objective step not found");
    if (row.status !== "blocked") throw new Error("Only a blocked step can be retried");
    if (row.effects_uncertain === 1 && !effectsReconciled)
      throw new Error("Reconcile uncertain effects before retrying this step");
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE objective_steps SET status = 'pending', run_id = NULL, effects_uncertain = 0, blocked_reason = NULL, next_action = 'Dispatch retry', updated_at = ? WHERE id = ?",
        )
        .run(Date.now(), stepId);
      this.db
        .prepare("UPDATE objectives SET status = 'active', updated_at = ? WHERE id = ?")
        .run(Date.now(), row.objective_id);
    })();
    return this.stepById(stepId)!;
  }

  syncRun(run: RunRecord, runs: RunManager): void {
    const step = this.stepForRun(run.id);
    if (!step) return;
    if (["queued", "running"].includes(run.status)) return;
    if (run.status === "waiting_approval") {
      this.setStep(step.id, "waiting_approval", null, "Approve or cancel this execution", false);
      return;
    }
    if (run.status === "done") {
      this.setStep(step.id, "verifying", null, "Verify produced evidence", false);
      const evidence = this.buildEvidence(step, run, runs);
      this.db
        .prepare(
          "UPDATE objective_steps SET status = ?, evidence_json = ?, blocked_reason = ?, next_action = ?, updated_at = ? WHERE id = ?",
        )
        .run(
          evidence.verified ? "verified" : "blocked",
          JSON.stringify(evidence),
          evidence.verified ? null : `Missing expected artifacts: ${evidence.missingExpected.join(", ")}`,
          evidence.verified ? null : "Inspect the run and produce the missing evidence",
          Date.now(),
          step.id,
        );
    } else {
      const uncertain = Boolean(
        run.startedAt &&
        (run.failure?.effectsUncertain || ["interrupted", "timed_out", "cancelled"].includes(run.status)),
      );
      this.setStep(
        step.id,
        "blocked",
        run.failure?.message ?? run.error ?? `Run ${run.status}`,
        uncertain ? "Reconcile workspace effects before retrying" : "Fix the failure and retry the step",
        uncertain,
      );
    }
    this.recomputeObjective(step.objectiveId);
    events.emit("objective.changed", {
      objectiveId: step.objectiveId,
      stepId: step.id,
      status: this.get(step.objectiveId)?.status,
    });
  }

  recover(runs: RunManager): { requeued: number; uncertain: number; synchronized: number } {
    const rows = this.db
      .prepare("SELECT * FROM objective_steps WHERE status IN ('dispatched','waiting_approval','verifying')")
      .all() as StepRow[];
    let requeued = 0,
      uncertain = 0,
      synchronized = 0;
    for (const row of rows) {
      const run = row.run_id ? runs.get(row.run_id) : null;
      if (
        !run ||
        (run.status === "queued" && run.startedAt == null && !runs.activeRunIds().includes(run.id))
      ) {
        this.db
          .prepare(
            "UPDATE objective_steps SET status = 'pending', run_id = NULL, next_action = 'Dispatch recovered step', updated_at = ? WHERE id = ?",
          )
          .run(Date.now(), row.id);
        requeued++;
      } else if (
        run.status === "running" ||
        (run.startedAt != null && ["interrupted", "cancelled", "timed_out"].includes(run.status))
      ) {
        this.setStep(
          row.id,
          "blocked",
          "Previous attempt may have changed external state",
          "Reconcile effects before retrying",
          true,
        );
        uncertain++;
      } else {
        this.syncRun(run, runs);
        synchronized++;
      }
    }
    return { requeued, uncertain, synchronized };
  }

  contextPacket(id: string, stepId: string): Record<string, unknown> {
    const objective = this.get(id);
    const step = objective?.steps.find((candidate) => candidate.id === stepId);
    if (!objective || !step) throw new Error("Objective step not found");
    return {
      version: 1,
      objective: {
        id: objective.id,
        project: objective.project,
        title: objective.title,
        description: objective.description,
      },
      step: {
        id: step.id,
        title: step.title,
        attempt: step.attempt + 1,
        expectedArtifacts: step.expectedArtifacts,
      },
      sources: objective.context.sources ?? [],
      decisions: objective.context.decisions ?? [],
      budgetUsd: objective.context.budgetUsd ?? null,
      dependencies: objective.steps
        .filter((candidate) => step.dependencies.includes(candidate.id))
        .map((candidate) => ({ id: candidate.id, title: candidate.title, evidence: candidate.evidence })),
      pending: objective.steps
        .filter((candidate) => !["verified", "cancelled"].includes(candidate.status))
        .map((candidate) => ({ id: candidate.id, title: candidate.title, status: candidate.status })),
      retention: objective.context.retention ?? "Stored locally with the objective",
    };
  }

  private buildEvidence(step: ObjectiveStep, run: RunRecord, runs: RunManager): StepEvidence {
    const artifactRoot = path.resolve(this.paths.artifacts);
    const artifacts = run.artifacts.flatMap((relative) => {
      const absolute = path.resolve(artifactRoot, relative);
      if (absolute !== artifactRoot && !absolute.startsWith(`${artifactRoot}${path.sep}`)) return [];
      try {
        const body = fs.readFileSync(absolute);
        return [
          {
            path: relative,
            bytes: body.byteLength,
            sha256: crypto.createHash("sha256").update(body).digest("hex"),
          },
        ];
      } catch {
        return [];
      }
    });
    const missingExpected = step.expectedArtifacts.filter((expected) => {
      const normalized = expected.replaceAll("\\", "/").replace(/^\.\//, "");
      return !artifacts.some(
        (artifact) =>
          artifact.path === normalized || artifact.path.replaceAll("\\", "/").endsWith(`/${normalized}`),
      );
    });
    const replyPresent = (runs.lastAssistantText(run.id) ?? "").trim().length > 0;
    return {
      verified:
        run.status === "done" && missingExpected.length === 0 && (artifacts.length > 0 || replyPresent),
      checkedAt: Date.now(),
      runId: run.id,
      processStatus: run.status,
      artifacts,
      filesChanged: run.filesChanged,
      missingExpected,
      replyPresent,
    };
  }

  private stepForRun(runId: string): ObjectiveStep | null {
    const row = this.db.prepare("SELECT * FROM objective_steps WHERE run_id = ?").get(runId) as
      StepRow | undefined;
    return row ? stepFromRow(row) : null;
  }

  private stepById(id: string): ObjectiveStep | null {
    const row = this.db.prepare("SELECT * FROM objective_steps WHERE id = ?").get(id) as StepRow | undefined;
    return row ? stepFromRow(row) : null;
  }

  private setStep(
    id: string,
    status: ObjectiveStepStatus,
    reason: string | null,
    next: string | null,
    uncertain: boolean,
  ): void {
    this.db
      .prepare(
        "UPDATE objective_steps SET status = ?, blocked_reason = ?, next_action = ?, effects_uncertain = ?, updated_at = ? WHERE id = ?",
      )
      .run(status, reason, next, uncertain ? 1 : 0, Date.now(), id);
    this.touchByStep(id);
  }

  private recomputeObjective(id: string): void {
    const steps = (
      this.db.prepare("SELECT status FROM objective_steps WHERE objective_id = ?").all(id) as Array<{
        status: ObjectiveStepStatus;
      }>
    ).map((row) => row.status);
    const status: ObjectiveStatus =
      steps.length > 0 && steps.every((value) => value === "verified")
        ? "completed"
        : steps.some((value) => value === "blocked")
          ? "blocked"
          : "active";
    this.db
      .prepare("UPDATE objectives SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, Date.now(), id);
  }

  private touchByStep(stepId: string): void {
    this.db
      .prepare(
        "UPDATE objectives SET updated_at = ? WHERE id = (SELECT objective_id FROM objective_steps WHERE id = ?)",
      )
      .run(Date.now(), stepId);
  }

  private inflate(row: ObjectiveRow): Objective {
    const steps = (
      this.db
        .prepare("SELECT * FROM objective_steps WHERE objective_id = ? ORDER BY position")
        .all(row.id) as StepRow[]
    ).map(stepFromRow);
    return {
      id: row.id,
      project: row.project,
      title: row.title,
      description: row.description,
      status: row.status,
      context: parseJson(row.context_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      steps,
    };
  }
}

function stepFromRow(row: StepRow): ObjectiveStep {
  return {
    id: row.id,
    objectiveId: row.objective_id,
    position: row.position,
    title: row.title,
    request: parseJson(row.request_json, null)!,
    dependencies: parseJson(row.dependencies_json, []),
    resourceKeys: parseJson(row.resource_keys_json, []),
    expectedArtifacts: parseJson(row.expected_artifacts_json, []),
    priority: row.priority,
    status: row.status,
    runId: row.run_id,
    attempt: row.attempt,
    effectsUncertain: row.effects_uncertain === 1,
    blockedReason: row.blocked_reason,
    nextAction: row.next_action,
    evidence: parseJson(row.evidence_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
