/**
 * The ids a run's panels answer to. Small, but the console, the dock and a
 * reopened desktop all read them, so the shape is pinned.
 */
import { describe, expect, it } from "vitest";
import {
  formPanelId,
  formSlugOf,
  isFormPanelId,
  isRunPanelId,
  runIdOf,
  runPanelId,
  runPanelTitle,
} from "./runPanels";

describe("run and form panel ids", () => {
  it("round-trip a run id and a skill slug", () => {
    expect(runIdOf(runPanelId("a1b2c3"))).toBe("a1b2c3");
    expect(formSlugOf(formPanelId("code-review"))).toBe("code-review");
  });

  it("tell the two apart from each other and from everything else", () => {
    expect(isRunPanelId("run:x")).toBe(true);
    expect(isFormPanelId("run:x")).toBe(false);
    expect(isFormPanelId("form:x")).toBe(true);
    expect(isRunPanelId("app:runs")).toBe(false);
    expect(isRunPanelId("doc:/runs/x.md")).toBe(false);
  });

  it("title a trace the way the prototype does: run-<short> · /skill", () => {
    expect(runPanelTitle("0123456789abcdef", "smoke-test")).toBe("run-01234567 · /smoke-test");
    expect(runPanelTitle("41", null)).toBe("run-41");
  });
});
