import { describe, expect, it } from "vitest";
import { API, declaredErrors, routeKey, type RouteDefinition } from "@mordomo/contracts";

/** The route table of .specs/features/cerebro-rituais: what the feature leaves as it was (C29). */

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
