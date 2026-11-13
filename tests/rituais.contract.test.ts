import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  API,
  EVENT_ENVELOPES,
  EVENT_VERSIONS,
  SENTINEL_IDS,
  checkBody,
  declaredErrors,
  routeKey,
  type RouteDefinition,
} from "@mordomo/contracts";
import { eventsDocument } from "../apps/api/src/eventsDoc.js";

/**
 * The route table and the event contract of .specs/features/cerebro-rituais: what the feature leaves as it was (C29),
 * and the sentinel `weeklyReview` on `sentinel.fired` (C57).
 */

const entry = (id: string) => (API as unknown as Record<string, RouteDefinition>)[id]!;
const keysOf = (schema: unknown) => Object.keys((schema as { shape: Record<string, unknown> }).shape).sort();
const errorsOf = (e: RouteDefinition) => (e.errors ?? []).map((x) => `${x.status} ${x.code}`).sort();

describe("C29 PUT /api/memory/tasks is unchanged", () => {
  it("C29 memory.tasks.save is still PUT /api/memory/tasks, owner, with the same body keys and errors", () => {
    const save = entry("memory.tasks.save");
    expect(routeKey(save)).toBe("PUT /api/memory/tasks");
    expect(save.scope).toBe("owner");
    expect(keysOf(save.body)).toEqual(["baseVersion", "done", "line", "path"]);
    expect(errorsOf(save)).toEqual([
      "403 forbidden_path",
      "403 note_not_editable",
      "404 not_a_file",
      "404 note_missing",
      "409 edit_conflict",
      "413 note_too_large",
    ]);
    expect(declaredErrors(save).length).toBeGreaterThan(errorsOf(save).length);
  });

  it("C29 the new entry is another id with method POST on the same path", () => {
    const add = Object.entries(API as unknown as Record<string, RouteDefinition>).filter(
      ([, e]) => e.path === "/api/memory/tasks",
    );
    expect(add.map(([id, e]) => [id, e.method]).sort()).toEqual([
      ["memory.tasks.add", "POST"],
      ["memory.tasks.save", "PUT"],
    ]);
    expect(entry("memory.tasks.add").scope).toBe("owner");
  });
});

describe("C57 the sentinel weeklyReview in the event contract", () => {
  it("C57 SENTINEL_IDS holds weeklyReview (seven ids); the v1 schema of sentinel.fired takes it; its fixture parses; sentinel.fired stays at [1]; docs/events.md is the generated text", () => {
    expect([...SENTINEL_IDS]).toEqual([
      "fsWatch",
      "repeatedFailure",
      "silentRoutine",
      "connectorDelta",
      "reviewDue",
      "proposalsPending",
      "weeklyReview",
    ]);
    expect(EVENT_VERSIONS["sentinel.fired"]).toEqual([1]);
    const entry = EVENT_ENVELOPES.find((e) => e.type === "sentinel.fired" && e.v === 1)!;
    const fixture = JSON.parse(
      fs.readFileSync(
        path.join(import.meta.dirname, "fixtures", "events", "v1", "sentinel.fired.weeklyReview.json"),
        "utf8",
      ),
    ) as { payload: Record<string, unknown> };
    expect(fixture.payload.sentinel).toBe("weeklyReview");
    expect(checkBody(entry.schema, fixture)).toEqual([]);
    expect(
      checkBody(entry.schema, { ...fixture, payload: { ...fixture.payload, sentinel: "weeklyReviews" } }),
    ).not.toEqual([]);
    expect(fs.readFileSync(path.join(import.meta.dirname, "..", "docs", "events.md"), "utf8")).toBe(
      eventsDocument(),
    );
  });
});
