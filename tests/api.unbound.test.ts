import { afterAll, describe, expect, it, vi } from "vitest";
import type * as Contracts from "@mordomo/contracts";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";

/**
 * AC 5 of contratos-rest, the half that `tests/api.contract.test.ts` cannot reach with the real table: an entry in the
 * route table that no route was bound to stops `buildServer` before it listens, and names the entry. The table is
 * frozen, so this file builds the server against a table with one entry more (the module is replaced for this file
 * alone) and asks for the rejection from `buildServer` itself, not from the function that finds the entry.
 */
const forgotten = vi.hoisted(() => ({ id: "zz.forgotten" }));

vi.mock("@mordomo/contracts", async (importOriginal) => {
  const actual = await importOriginal<typeof Contracts>();
  const { z: zod } = await import("zod");
  const entry = actual.route({
    method: "GET",
    path: "/api/zz-forgotten",
    scope: "monitor",
    summary: "An entry no route was bound to",
    tag: "test",
    responses: { 200: zod.object({}) },
  });
  return { ...actual, API: Object.freeze({ ...actual.API, [forgotten.id]: entry }) };
});

describe("S1 the route table and the router", () => {
  const tmp = makeTempHome("mordomo-unbound-");
  const ctx = new AppContext(tmp.paths.home);
  afterAll(() => {
    ctx.close();
    tmp.cleanup();
  });

  it("C54 buildServer stops, naming the entry, when a route of the table was never bound", async () => {
    // The 127 real entries are bound; the one this file added is not.
    await expect(buildServer(ctx)).rejects.toThrow(
      "GET /api/zz-forgotten (zz.forgotten) is in the route table but no route was bound to it",
    );
  });
});
