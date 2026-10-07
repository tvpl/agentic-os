// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { apiUrl } from "./api";

describe("API version prefix", () => {
  it("C6 the UI prefixes v1 once", () => {
    expect(apiUrl("/api/runs")).toBe("/api/v1/runs");
    expect(apiUrl("/api/v1/runs")).toBe("/api/v1/runs");
    expect(apiUrl("/api/runs/abc/stream?token=t")).toBe("/api/v1/runs/abc/stream?token=t");
    expect(apiUrl("/assets/logo.svg")).toBe("/assets/logo.svg");
  });
});
