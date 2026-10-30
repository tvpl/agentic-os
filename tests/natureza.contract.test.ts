import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_ENVELOPES, EVENT_SCHEMAS, EVENT_VERSIONS, SENTINEL_IDS, checkBody } from "@mordomo/contracts";

/**
 * .specs/features/cerebro-natureza, the contract (checks.md "Cross-cutting, API", and C44 of S3): what the route table,
 * the event registry and their documents say. Batch B holds C44; batch C adds C64-C69 here.
 */

const repoRoot = path.resolve(import.meta.dirname, "..");

describe("S3 the reviewDue sentinel in the event contract", () => {
  it("C44 SENTINEL_IDS holds reviewDue, the v1 schema takes it and refuses other, its v1 fixture parses, and sentinel.fired is still version 1 only", () => {
    expect(SENTINEL_IDS).toContain("reviewDue");
    const schema = EVENT_SCHEMAS["sentinel.fired"][1];
    const payload = {
      sentinel: "reviewDue",
      title: "3 items to review",
      body: "Notes are due.",
      severity: "info",
      href: "/brain/reviews",
      dedupeKey: "sentinel:reviewDue:2026-10-30:all",
      messageParams: { count: 3, display: "3" },
    };
    expect(schema.safeParse(payload).success).toBe(true);
    expect(schema.safeParse({ ...payload, sentinel: "other" }).success).toBe(false);
    const fixture = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "tests/fixtures/events/v1/sentinel.fired.reviewDue.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(fixture).toMatchObject({ type: "sentinel.fired", v: 1, payload: { sentinel: "reviewDue" } });
    const envelope = EVENT_ENVELOPES.find((e) => e.type === "sentinel.fired" && e.v === 1)!;
    expect(checkBody(envelope.schema, fixture)).toEqual([]);
    expect(EVENT_VERSIONS["sentinel.fired"]).toEqual([1]);
  });
});
