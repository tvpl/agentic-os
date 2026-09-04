import { describe, expect, it } from "vitest";
import { contextWindowFor } from "./models";

describe("contextWindowFor", () => {
  it("maps known families and aliases", () => {
    expect(contextWindowFor("claude-sonnet-5")).toBe(200_000);
    expect(contextWindowFor("sonnet")).toBe(200_000);
    expect(contextWindowFor("claude-sonnet-4-5[1m]")).toBe(1_000_000);
    expect(contextWindowFor("gpt-5.2-codex")).toBe(400_000);
    expect(contextWindowFor("o4-mini")).toBe(200_000);
    expect(contextWindowFor("gpt-4o")).toBe(128_000);
  });
  it("returns null for unknown or missing models", () => {
    expect(contextWindowFor(null)).toBeNull();
    expect(contextWindowFor("auto")).toBeNull();
    expect(contextWindowFor("")).toBeNull();
  });
});
