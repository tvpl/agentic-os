// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isValidMicroAppHref } from "./Settings";

describe("micro app href validation", () => {
  it("accepts internal routes and http(s) URLs only", () => {
    expect(isValidMicroAppHref("/pixel")).toBe(true);
    expect(isValidMicroAppHref("https://example.com/app")).toBe(true);
    expect(isValidMicroAppHref("http://localhost:3000")).toBe(true);
    expect(isValidMicroAppHref("//evil.example")).toBe(false);
    expect(isValidMicroAppHref("javascript:alert(1)")).toBe(false);
    expect(isValidMicroAppHref("pixel")).toBe(false);
    expect(isValidMicroAppHref("")).toBe(false);
  });
});
