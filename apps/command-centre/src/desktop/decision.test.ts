import { describe, expect, it } from "vitest";
import type { ApprovalRecord } from "../api";
import { tf, type TKey, type TVars } from "../i18n";
import { describeDecision, editPreview, pendingDecisions, previewLines } from "./decision";

const pt = (k: TKey, v?: TVars) => tf("pt-BR", k, v);
const rec = (over: Partial<ApprovalRecord>): ApprovalRecord => ({
  id: "a",
  createdAt: 1,
  kind: "write_run",
  description: "d",
  payload: {},
  status: "pending",
  resolvedAt: null,
  ...over,
});

describe("pendingDecisions", () => {
  it("keeps only pending, the paused agent first, oldest first", () => {
    const rows = [
      rec({ id: "w2", kind: "write_run", createdAt: 5 }),
      rec({ id: "t1", kind: "tool_use", createdAt: 9 }),
      rec({ id: "w1", kind: "write_run", createdAt: 2 }),
      rec({ id: "x", status: "approved" }),
    ];
    expect(pendingDecisions(rows).map((r) => r.id)).toEqual(["t1", "w1", "w2"]);
  });
});

describe("editPreview", () => {
  it("reads an Edit call as a before/after pair with a short path", () => {
    const p = editPreview(
      rec({
        kind: "tool_use",
        payload: {
          toolName: "Edit",
          input: { file_path: "/h/p/src/a.ts", old_string: "x = 1", new_string: "x = 2" },
        },
      }),
      "/h/p",
    );
    expect(p).toEqual({ file: "src/a.ts", kind: "edit", before: "x = 1", after: "x = 2" });
    expect(previewLines(p!)).toEqual([
      { kind: "del", text: "x = 1" },
      { kind: "add", text: "x = 2" },
    ]);
  });

  it("reads a Write call as a new file and cuts long content", () => {
    const content = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const p = editPreview(
      rec({ kind: "tool_use", payload: { toolName: "Write", input: { file_path: "/x/y.md", content } } }),
    );
    expect(p).toMatchObject({ kind: "write", before: "", file: "x/y.md" });
    const lines = previewLines(p!, 5);
    expect(lines).toHaveLength(5);
    expect(lines[4]!.text).toBe("… +26");
  });

  it("is null for tools that do not touch a file", () => {
    expect(
      editPreview(rec({ kind: "tool_use", payload: { toolName: "Bash", input: { command: "ls" } } })),
    ).toBeNull();
    expect(editPreview(rec({ kind: "write_run" }))).toBeNull();
  });
});

describe("describeDecision", () => {
  it("says what the paused agent wants in plain words", () => {
    const d = describeDecision(
      rec({
        kind: "tool_use",
        payload: { toolName: "Bash", input: { command: "rm -rf dist" }, runId: "r1" },
      }),
      pt,
      "?",
    );
    expect(d).toEqual({ headline: "executei", subject: "rm -rf dist", where: null, runId: "r1" });
  });

  it("labels a held write run by its skill and directory", () => {
    const d = describeDecision(
      rec({ kind: "write_run", payload: { kind: "skill", input: { slug: "digest", cwd: "/h/p" } } }),
      pt,
      "?",
    );
    expect(d).toEqual({ headline: "/digest", subject: null, where: "/h/p", runId: null });
  });
});
