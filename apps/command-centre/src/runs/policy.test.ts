import { describe, expect, it } from "vitest";
import { cwdSuggestions, followUpPrompt, writePolicyFor } from "./policy";

describe("writePolicyFor", () => {
  it("mirrors the core write decision for manual runs", () => {
    expect(writePolicyFor("read_only")).toBe("refused");
    expect(writePolicyFor(undefined)).toBe("refused");
    expect(writePolicyFor("review_before_write")).toBe("approval");
    expect(writePolicyFor("controlled_write")).toBe("allowed");
    expect(writePolicyFor("approved_automation")).toBe("allowed");
  });
});

describe("followUpPrompt", () => {
  it("keeps the previous request as context", () => {
    expect(followUpPrompt("  do a thing  ", " now do the next one ")).toBe("Previous request:\ndo a thing\n\nFollow-up:\nnow do the next one");
  });
});

describe("cwdSuggestions", () => {
  it("lists enabled folders first, then distinct run directories", () => {
    const out = cwdSuggestions(
      [
        { path: "/a", enabled: true },
        { path: "/off", enabled: false },
      ],
      [{ cwd: "/a" }, { cwd: "/b" }, { cwd: null }, { cwd: "/b" }],
    );
    expect(out).toEqual(["/a", "/b"]);
    expect(cwdSuggestions(undefined, undefined)).toEqual([]);
    expect(cwdSuggestions([], [{ cwd: "/x" }, { cwd: "/y" }], 1)).toEqual(["/x"]);
  });
});
