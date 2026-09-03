import { describe, expect, it } from "vitest";
import { diffStats, diffToView, displayPath, parseUnifiedDiff, snapshotToLines } from "./diff";

const SAMPLE = `diff --git a/a.txt b/a.txt
index 1..2 100644
--- a/a.txt
+++ b/a.txt
@@ -1,3 +1,4 @@
 one
-two
+2
 three
+four
`;

describe("parseUnifiedDiff", () => {
  it("classifies lines and numbers them", () => {
    const lines = parseUnifiedDiff(SAMPLE);
    expect(lines.slice(0, 4).every((l) => l.kind === "meta")).toBe(true);
    expect(lines[4]).toMatchObject({ kind: "hunk" });
    expect(lines[5]).toEqual({ kind: "ctx", text: "one", oldNo: 1, newNo: 1 });
    expect(lines[6]).toEqual({ kind: "del", text: "two", oldNo: 2, newNo: null });
    expect(lines[7]).toEqual({ kind: "add", text: "2", oldNo: null, newNo: 2 });
    expect(lines[8]).toEqual({ kind: "ctx", text: "three", oldNo: 3, newNo: 3 });
    expect(lines[9]).toEqual({ kind: "add", text: "four", oldNo: null, newNo: 4 });
    expect(lines).toHaveLength(10);
    expect(diffStats(lines)).toEqual({ added: 2, removed: 1 });
  });

  it("handles the no-newline marker and empty input", () => {
    const lines = parseUnifiedDiff("@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file\n");
    expect(lines.map((l) => l.kind)).toEqual(["hunk", "del", "add", "meta"]);
    expect(parseUnifiedDiff("")).toEqual([{ kind: "meta", text: "", oldNo: null, newNo: null }]);
  });
});

describe("snapshotToLines / displayPath", () => {
  it("renders a snapshot as all additions without a trailing empty line", () => {
    const lines = snapshotToLines("a\nb\n");
    expect(lines).toEqual([
      { kind: "add", text: "a", oldNo: null, newNo: 1 },
      { kind: "add", text: "b", oldNo: null, newNo: 2 },
    ]);
    expect(diffStats(lines)).toEqual({ added: 2, removed: 0 });
  });
  it("strips the base directory", () => {
    expect(displayPath("/home/u/proj/src/a.ts", "/home/u/proj")).toBe("src/a.ts");
    expect(displayPath("/home/u/proj/src/a.ts", "/home/u/proj/")).toBe("src/a.ts");
    expect(displayPath("/etc/x", "/home/u/proj")).toBe("/etc/x");
    expect(displayPath("/etc/x", null)).toBe("/etc/x");
  });
});

describe("diffToView", () => {
  it("normalizes the three backend shapes", () => {
    const git = diffToView({ kind: "git", file: "/r/a.txt", repoRoot: "/r", diff: SAMPLE, truncated: false, unchanged: false });
    expect(git).toMatchObject({ added: 2, removed: 1, source: "git", note: null, truncated: false });
    expect(git.lines).toHaveLength(10);

    const snap = diffToView({ kind: "snapshot", file: "/r/n.txt", content: "a\nb\n", truncated: true, untracked: true, message: "new file" });
    expect(snap).toMatchObject({ added: 2, removed: 0, source: "snapshot", note: "new file", truncated: true });

    expect(diffToView({ kind: "unavailable", file: "/r/x", message: "gone" })).toEqual({ lines: [], added: 0, removed: 0, note: "gone", truncated: false, source: "none" });
  });

  it("shows an unchanged file as an empty git view", () => {
    expect(diffToView({ kind: "git", file: "/r/a", repoRoot: "/r", diff: "", truncated: false, unchanged: true })).toEqual({ lines: [], added: 0, removed: 0, note: null, truncated: false, source: "git" });
  });
});
