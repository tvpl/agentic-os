/**
 * @vitest-environment jsdom
 * The reference helpers decide what the agent is actually pointed at, so the
 * boundary between "typing a name" and "sending a path" is pinned here.
 */
import { describe, expect, it } from "vitest";
import { completeReference, docSuggestions, resolveReferences } from "./refs";

const docs = [
  { id: "doc:/runs/1/plan.md", ref: "plan.md", path: "/runs/1/plan.md" },
  { id: "doc:/runs/2/report.md", ref: "report.md", path: "/runs/2/report.md" },
  { id: "doc:/notes.txt", ref: "notes.txt", path: "/notes.txt" },
];

describe("docSuggestions", () => {
  it("tells 'not referencing' apart from 'no matches'", () => {
    expect(docSuggestions("just typing", docs)).toBeNull();
    expect(docSuggestions("look at @zzz", docs)).toEqual([]);
  });

  it("offers everything right after the @ and narrows as you type", () => {
    expect(docSuggestions("@", docs)!).toHaveLength(3);
    expect(docSuggestions("check @plan", docs)!.map((d) => d.ref)).toEqual(["plan.md"]);
    // Substring, not prefix: "@md" and "@.md" both mean "the markdown ones".
    expect(docSuggestions("@md", docs)!.map((d) => d.ref)).toEqual(["plan.md", "report.md"]);
    expect(docSuggestions("@.md", docs)!.map((d) => d.ref)).toEqual(["plan.md", "report.md"]);
  });

  it("only reads the reference the caret is in", () => {
    expect(docSuggestions("@plan.md and @rep", docs)!.map((d) => d.ref)).toEqual(["report.md"]);
    // A completed reference followed by a space is no longer being typed.
    expect(docSuggestions("@plan.md ", docs)).toBeNull();
  });
});

describe("completeReference", () => {
  it("replaces the partial reference at the caret, keeping the rest", () => {
    const out = completeReference("check @pl and more", 9, "plan.md");
    expect(out.text).toBe("check @plan.md  and more");
    expect(out.caret).toBe(15);
  });

  it("appends when the caret is not in a reference (a context chip click)", () => {
    expect(completeReference("", 0, "plan.md")).toEqual({ text: "@plan.md ", caret: 9 });
    const out = completeReference("look at this", 12, "plan.md");
    expect(out.text).toBe("look at this @plan.md ");
    expect(out.caret).toBe(out.text.length);
  });

  it("does not double the space when the draft already ends in one", () => {
    expect(completeReference("summarise ", 10, "plan.md").text).toBe("summarise @plan.md ");
  });
});

describe("resolveReferences", () => {
  it("leaves a prompt with no references untouched", () => {
    expect(resolveReferences("just do it", docs)).toEqual({ text: "just do it", used: [] });
  });

  it("appends the paths behind the names the user typed", () => {
    const out = resolveReferences("summarise @plan.md", docs);
    expect(out.used).toEqual(["doc:/runs/1/plan.md"]);
    expect(out.text).toContain("summarise @plan.md");
    expect(out.text).toContain('- "/runs/1/plan.md"');
  });

  it("resolves several references and keeps the user's own words first", () => {
    const out = resolveReferences("compare @plan.md with @report.md", docs);
    expect(out.used).toEqual(["doc:/runs/1/plan.md", "doc:/runs/2/report.md"]);
    expect(out.text.startsWith("compare @plan.md with @report.md")).toBe(true);
  });

  it("does not match a name that is only a prefix of what was typed", () => {
    // "@plan.markdown" is not a reference to "plan.md".
    expect(resolveReferences("@plan.markdown", docs).used).toEqual([]);
  });

  it("treats a name with regex characters as literal text", () => {
    const odd = [{ id: "doc:/odd/a+b(c).md", ref: "a+b(c).md", path: "/odd/a+b(c).md" }];
    expect(resolveReferences("open @a+b(c).md", odd).used).toEqual(["doc:/odd/a+b(c).md"]);
    expect(resolveReferences("open @axbxcx.md", odd).used).toEqual([]);
  });

  it("names a panel that has no file, so the agent still knows what was meant", () => {
    const panels = [...docs, { id: "pulse", ref: "pulse", title: "Pulse" }];
    const out = resolveReferences("why is @pulse low? see @plan.md", panels);
    expect(out.used).toEqual(["doc:/runs/1/plan.md", "pulse"]);
    expect(out.text).toContain('Referenced files:\n- "/runs/1/plan.md"');
    expect(out.text).toContain("Referenced panels open on the desktop:\n- pulse (Pulse)");
  });
});
