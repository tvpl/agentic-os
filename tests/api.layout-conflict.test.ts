import { it, expect } from "vitest";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";

it("accepts one layout writer and rejects a stale second writer without overwriting", async () => {
  const temp = makeTempHome();
  const ctx = new AppContext(temp.paths.home);
  const app = await buildServer(ctx);
  const headers = { "x-mordomo-token": ctx.token() };
  const base = ctx.uiPreferences.load().dashboardLayout;
  // Pixels of the stage, not grid units (redesign F4).
  const box = { x: 40, y: 40, w: 420, h: 300, z: 1, visible: true };
  try {
    const responses = await Promise.all(
      [true, false].map((visible) =>
        app.inject({
          method: "PUT",
          url: "/api/ui-preferences",
          headers,
          payload: { dashboardLayoutBase: base, dashboardLayout: { now: { ...box, visible } } },
        }),
      ),
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const saved = responses.find((r) => r.statusCode === 200)!.json().dashboardLayout;
    expect(ctx.uiPreferences.load().dashboardLayout).toEqual(saved);
    expect(responses.find((r) => r.statusCode === 409)!.json().error.code).toBe("layout_conflict");
    // Explicit retry with the latest base remains possible.
    const retry = await app.inject({
      method: "PUT",
      url: "/api/ui-preferences",
      headers,
      payload: { dashboardLayoutBase: saved, dashboardLayout: { now: { ...box, x: 120 } } },
    });
    expect(retry.statusCode).toBe(200);
    expect(ctx.uiPreferences.load().dashboardLayout.now?.x).toBe(120);
  } finally {
    await app.close();
    ctx.close();
    temp.cleanup();
  }
});
