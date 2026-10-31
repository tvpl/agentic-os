import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as SafeWrite from "../core/src/security/safeWrite.js";
import { storeProposal } from "../core/src/memory/proposals.js";
import { code, memoriaWorld, sha, type Json, type MemoriaWorld } from "./helpers/memoriaWorld.js";

/**
 * A defect found in batch A3 (cerebro-memoria-confiavel G6, C63's claim "a file written earlier in the same decision is
 * put back"): when a decision creates two topic files and the second create fails, the first stays on disk with no
 * version, and a second decision appends the same lines to it again. This file is red on purpose until the decision
 * puts back what it created; it is not part of the suite of the batch that found it.
 *
 * The fault is injected where a disk error would come from: the guarded writer's create of `topics/b.md` throws EIO.
 */
const fault = vi.hoisted(() => ({ on: null as null | string }));
vi.mock("../core/src/security/safeWrite.js", async (importOriginal) => {
  const actual = await importOriginal<typeof SafeWrite>();
  const writeWorkspaceFile: typeof actual.writeWorkspaceFile = (scope, candidate, data, options) => {
    if (fault.on && candidate.endsWith(fault.on) && options?.mode === "create")
      throw Object.assign(new Error("EIO: i/o error, open"), { code: "EIO" });
    return actual.writeWorkspaceFile(scope, candidate, data, options);
  };
  return { ...actual, writeWorkspaceFile };
});

let w: MemoriaWorld;
beforeAll(async () => {
  w = await memoriaWorld("mordomo-memoria-g6-");
}, 60_000);
afterAll(async () => {
  await w.close();
});

const BASE = [
  "# Long-term memory",
  "",
  "## Facts",
  "",
  "- Um",
  "",
  "## Decisions",
  "",
  "- Dois",
  "",
  "## Open loops",
  "",
  "## Reflections",
  "",
  "## Superseded",
  "",
].join("\n");

describe("G6 a file the failed decision created", () => {
  it("G6 a decision whose second topic cannot be created is 500 internal and leaves no topic behind; once the fault is gone the same decision writes each topic's lines once", async () => {
    const memory = path.join(w.memory, "MEMORY.md");
    const topic = (slug: string) => path.join(w.memory, "topics", `${slug}.md`);
    w.put(memory, BASE);
    const p = storeProposal(
      w.ctx.db,
      {
        kind: "consolidation",
        author: "run:g6",
        runId: "g6",
        summary: "G6",
        payload: {
          v: 1,
          summary: "G6",
          ops: [
            { op: "move_to_topic", lines: ["- Um"], topic: "a" },
            { op: "move_to_topic", lines: ["- Dois"], topic: "b" },
          ],
        },
      },
      { capped: false },
    );
    const versions = () =>
      (w.ctx.db.prepare("SELECT COUNT(*) c FROM memory_versions").get() as { c: number }).c;
    const before = versions();
    const body: Json = { action: "accept", baseVersion: sha(BASE) };

    fault.on = path.join("topics", "b.md");
    const failed = await w.call("POST", `/api/memory/proposals/${p.id}/decide`, body);
    fault.on = null;
    expect(code(failed)).toEqual([500, "internal"]);
    expect(fs.readFileSync(memory, "utf8")).toBe(BASE);
    expect(versions()).toBe(before);
    expect((await w.call("GET", `/api/memory/proposals/${p.id}`)).body.status).toBe("pending");
    // G6: "the earlier files are put back" - a file this decision created is one of them
    expect(fs.existsSync(topic("a"))).toBe(false);

    // G6: "a second decide works" - and writes each line once
    const done = await w.call("POST", `/api/memory/proposals/${p.id}/decide`, body);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(fs.readFileSync(topic("a"), "utf8")).toBe("---\ntype: memoria-topico\n---\n\n- Um\n");
    expect(fs.readFileSync(topic("b"), "utf8")).toBe("---\ntype: memoria-topico\n---\n\n- Dois\n");
  });
});
