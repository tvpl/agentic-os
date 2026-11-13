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
import { EXPECTED_ROUTE_SCOPES } from "./helpers/routeScopes.js";
import { ENTRIES, edgesOf, loadTree, reachable } from "../apps/command-centre/src/testing/sourceGraph.js";

/**
 * The route table and the event contract of .specs/features/cerebro-rituais: what the feature leaves as it was (C29),
 * the sentinel `weeklyReview` on `sentinel.fired` (C57), the seven routes as the Surface and the doors say (C71), and
 * the weight of the screens (C100).
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

describe("C71 the seven routes in the API table", () => {
  /** The seven routes, by method and path, with their scope (Surface, doors 2, 3, 6 and 7). */
  const SEVEN: Array<[string, string, string]> = [
    ["GET", "/api/memory/weekly-review", "owner"],
    ["POST", "/api/memory/weekly-review/loops", "owner"],
    ["POST", "/api/memory/weekly-review/archive", "owner"],
    ["POST", "/api/memory/weekly-review/finish", "owner"],
    ["POST", "/api/memory/tasks", "owner"],
    ["POST", "/api/memory/mentions/link", "owner"],
    ["GET", "/api/memory/mentions", "content"],
  ];
  /**
   * The (status, code) pairs of `Coverage` for each route, the 200 aside. Plan amendment 5 adds three to the finish (the
   * hostile journal of today).
   */
  const COVERAGE: Record<string, string[]> = {
    "GET /api/memory/weekly-review": ["400 validation", "403 owner_only", "403 forbidden"],
    "POST /api/memory/weekly-review/loops": [
      "400 validation",
      "403 note_not_editable",
      "403 owner_only",
      "403 forbidden",
      "404 loop_not_found",
      "409 edit_conflict",
    ],
    "POST /api/memory/weekly-review/archive": [
      "400 validation",
      "403 owner_only",
      "403 forbidden",
      "409 week_mismatch",
      "409 restore_in_progress",
    ],
    "POST /api/memory/weekly-review/finish": [
      "400 validation",
      "403 owner_only",
      "403 forbidden",
      "409 week_mismatch",
      "403 forbidden_path",
      "404 not_a_file",
      "413 file_too_large",
    ],
    "POST /api/memory/tasks": [
      "400 validation",
      "403 note_not_editable",
      "403 forbidden_path",
      "403 owner_only",
      "403 forbidden",
      "404 note_missing",
      "409 edit_conflict",
      "413 note_too_large",
    ],
    "GET /api/memory/mentions": ["400 validation", "403 scope_required", "403 forbidden", "404 not_found"],
    "POST /api/memory/mentions/link": [
      "400 validation",
      "403 note_not_editable",
      "403 owner_only",
      "403 forbidden",
      "404 note_missing",
      "404 not_found",
      "409 edit_conflict",
      "409 mention_gone",
      "413 note_too_large",
    ],
  };
  /** The refusals of the gate and the parser `Coverage` names: every other common error is the transport's. */
  const GATE = new Set(["400 validation", "403 owner_only", "403 scope_required", "403 forbidden"]);
  const table = Object.values(API as unknown as Record<string, RouteDefinition>);

  it("C71 the seven routes are in the table with method, path and scope", () => {
    const found = SEVEN.map(([method, path]) => table.find((e) => e.method === method && e.path === path));
    expect(found.map((e) => (e ? [e.method, e.path, e.scope] : null))).toEqual(SEVEN);
  });

  for (const [method, path] of SEVEN)
    it(`C71 ${method} ${path} declares exactly the (status, code) pairs of Coverage`, () => {
      const e = table.find((x) => x.method === method && x.path === path)!;
      const key = `${method} ${path}`;
      const want = COVERAGE[key]!;
      expect(errorsOf(e), key).toEqual(want.filter((pair) => !GATE.has(pair)).sort());
      const declared = new Set(declaredErrors(e).map((x) => `${x.status} ${x.code}`));
      for (const pair of want.filter((p) => GATE.has(p)))
        expect(declared.has(pair), `${key} ${pair}`).toBe(true);
      // the 200 is its one success
      expect(Object.keys(e.responses), key).toEqual(["200"]);
    });

  it("C71 each is in EXPECTED_ROUTE_SCOPES and has its row in docs/security.md", () => {
    const security = fs.readFileSync(path.join(import.meta.dirname, "..", "docs", "security.md"), "utf8");
    const rowOf = (scope: string) => security.split("\n").find((l) => l.startsWith(`| \`${scope}\` (`)) ?? "";
    for (const [method, route, scope] of SEVEN) {
      const key = `${method} ${route}`;
      expect(EXPECTED_ROUTE_SCOPES[key], key).toBe(scope);
      expect(rowOf(scope), key).toContain(`\`${key}\``);
      for (const other of ["monitor", "content", "run", "approve", "owner"].filter((s) => s !== scope))
        expect(rowOf(other), `${key} ${other}`).not.toContain(`\`${key}\``);
    }
  });
});

// ---- C100: the weekly page's chunk and the weight of the screens --------------------------------------------------

describe("C100 the weekly page's chunk and the bundle ceiling", () => {
  const repoRoot = path.resolve(__dirname, "..");

  it("C100 the weekly page is reached from both entries only by a dynamic import(); the baseline's cerebro-rituais entry follows cerebro-memoria-confiavel with a reason of more than 40 characters and the four numbers, at most 16 384 B of JS gzip and 2 048 B of CSS gzip above it (591 435 B and 81 852 B)", () => {
    const tree = loadTree(path.join(repoRoot, "apps", "command-centre", "src"));
    const page = "brain/weekly/WeeklyReview.tsx";
    // What each page loads without anyone asking: its entry and what that imports statically.
    expect([...ENTRIES].sort()).toEqual(["gallery/main.tsx", "main.tsx"]);
    for (const entry of ENTRIES) {
      const seen = new Set<string>([entry]);
      const queue = [entry];
      while (queue.length > 0)
        for (const edge of edgesOf(tree, queue.pop()!)) {
          if (edge.how === "dynamic" || edge.how === "url" || seen.has(edge.to)) continue;
          seen.add(edge.to);
          queue.push(edge.to);
        }
      expect(seen.has(page), entry).toBe(false);
    }
    expect(reachable(tree).has(page)).toBe(true);
    // its ways in: the brain's lazy route and the gallery's story, each through an import()
    const importers = (to: string) =>
      [...tree.keys()]
        // the tests and their kits are not shipped
        .filter((f) => !/\.test\.|(^|\/)testkit\./.test(f) && edgesOf(tree, f).some((e) => e.to === to))
        .sort();
    const how = (from: string, to: string) => edgesOf(tree, from).find((e) => e.to === to)?.how;
    expect(how("brain/BrainViewSwitch.tsx", page)).toBe("dynamic");
    expect(how("gallery/main.tsx", "gallery/weeklyStory.tsx")).toBe("dynamic");
    for (const from of importers(page).filter((f) => f !== "gallery/weeklyStory.tsx"))
      expect(how(from, page), from).toBe("dynamic");

    type Entry = {
      feature: string;
      reason: string;
      jsRaw: number;
      jsGzip: number;
      cssRaw: number;
      cssGzip: number;
    };
    const baseline = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "scripts", "bundle-baseline.json"), "utf8"),
    ) as { after: Entry[] };
    const i = baseline.after.findIndex((e) => e.feature === "cerebro-rituais");
    expect(i, "the entry exists").toBeGreaterThan(0);
    const entry = baseline.after[i]!;
    const before = baseline.after[i - 1]!;
    expect(before.feature).toBe("cerebro-memoria-confiavel");
    expect([before.jsGzip, before.cssGzip]).toEqual([591_435, 81_852]);
    expect(entry.reason.length).toBeGreaterThan(40);
    for (const k of ["jsRaw", "jsGzip", "cssRaw", "cssGzip"] as const)
      expect(Number.isInteger(entry[k]) && entry[k] > 0, k).toBe(true);
    // the ceiling of the plan's Assumptions ("Teto de peso", AD-047 h)
    expect(entry.jsGzip - before.jsGzip).toBeLessThanOrEqual(16_384);
    expect(entry.cssGzip - before.cssGzip).toBeLessThanOrEqual(2_048);
  });
});
