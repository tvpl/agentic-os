import { it, expect } from "vitest";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";

it("accepts one layout writer and rejects a stale second writer without overwriting", async () => {
  const temp = makeTempHome();
  const ctx = new AppContext(temp.paths.home);
  const app = await buildServer(ctx);
  const headers = { "x-mordomo-token": ctx.token() };
  const base = ctx.settings().dashboardLayout;
  const box = { x: 1, y: 1, w: 6, h: 4, visible: true };
  try {
    const responses = await Promise.all(
      [true, false].map((visible) =>
        app.inject({
          method: "PUT",
          url: "/api/settings",
          headers,
          payload: { dashboardLayoutBase: base, dashboardLayout: { now: { ...box, visible } } },
        }),
      ),
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const saved = responses.find((r) => r.statusCode === 200)!.json().settings.dashboardLayout;
    expect(ctx.settings().dashboardLayout).toEqual(saved);
    expect(responses.find((r) => r.statusCode === 409)!.json().error.code).toBe("layout_conflict");
    // Explicit retry with the latest base remains possible.
    const retry = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers,
      payload: { dashboardLayoutBase: saved, dashboardLayout: { now: { ...box, x: 2 } } },
    });
    expect(retry.statusCode).toBe(200);
    expect(ctx.settings().dashboardLayout.now?.x).toBe(2);
  } finally {
    await app.close();
    ctx.close();
    temp.cleanup();
  }
});
