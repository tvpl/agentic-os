import { describe, expect, it } from "vitest";
import { isStaleChunkError } from "./lazyRoute";

describe("lazyRoute", () => {
  it("recognises the browser messages for a chunk that no longer exists", () => {
    expect(
      isStaleChunkError(
        new TypeError(
          "Failed to fetch dynamically imported module: http://127.0.0.1:4777/assets/Settings-x.js",
        ),
      ),
    ).toBe(true);
    expect(isStaleChunkError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isStaleChunkError(new Error("Loading CSS chunk 12 failed"))).toBe(true);
    expect(isStaleChunkError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isStaleChunkError("plain string")).toBe(false);
  });
});
