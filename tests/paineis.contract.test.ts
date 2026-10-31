import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_ENVELOPES, EVENT_SCHEMAS, EVENT_VERSIONS, checkBody } from "@mordomo/contracts";

/**
 * .specs/features/cerebro-paineis, the contract: what the event registry and its document say. Batch A holds C18; the
 * route table, the scopes and the documents of the routes (C58-C64) are batch C's.
 */

const repoRoot = path.resolve(import.meta.dirname, "..");

/** The 28 event types before this feature, each at version 1 (the registry at `4537fb2`). */
const BEFORE = [
  "run.created",
  "run.started",
  "run.event",
  "run.finished",
  "routine.fired",
  "routine.alert",
  "routine.changed",
  "index.started",
  "index.progress",
  "index.finished",
  "index.failed",
  "index.cancelled",
  "cleanup.progress",
  "cleanup.finished",
  "cleanup.failed",
  "approval.requested",
  "approval.resolved",
  "approval.expired",
  "session.created",
  "session.updated",
  "objective.changed",
  "settings.changed",
  "backup.created",
  "notification.created",
  "notification.read",
  "budget.crossed",
  "sentinel.fired",
  "stream.reset",
];

describe("C18 dashboard.refreshed in the event contract", () => {
  it("C18 is version 1 only, its v1 schema takes ok, partial and error and refuses done and a missing id, its fixture parses, the document lists it, and the 28 of before keep [1]", () => {
    expect(EVENT_VERSIONS["dashboard.refreshed"]).toEqual([1]);
    const schema = EVENT_SCHEMAS["dashboard.refreshed"][1]!;
    const payload = { id: "visao-geral", generatedAt: 1_793_400_000_000, status: "ok" };
    for (const status of ["ok", "partial", "error"])
      expect(schema.safeParse({ ...payload, status }).success, status).toBe(true);
    expect(schema.safeParse({ ...payload, status: "done" }).success).toBe(false);
    const { id: _id, ...noId } = payload;
    expect(schema.safeParse(noId).success).toBe(false);

    const fixture = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "tests/fixtures/events/v1/dashboard.refreshed.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(fixture).toMatchObject({ type: "dashboard.refreshed", v: 1 });
    const envelope = EVENT_ENVELOPES.find((e) => e.type === "dashboard.refreshed" && e.v === 1)!;
    expect(checkBody(envelope.schema, fixture)).toEqual([]);

    const doc = fs.readFileSync(path.join(repoRoot, "docs/events.md"), "utf8");
    expect(doc).toContain("### `dashboard.refreshed`");

    expect({ ...EVENT_VERSIONS }).toEqual({
      ...Object.fromEntries(BEFORE.map((type) => [type, [1]])),
      "dashboard.refreshed": [1],
    });
  });
});
