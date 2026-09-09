import { randomUUID } from "node:crypto";
import { it, expect } from "vitest";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";

it("filters and orders ten thousand historical runs before pagination", async () => {
  const home = makeTempHome();
  const ctx = new AppContext(home.paths.home);
  const app = await buildServer(ctx);
  try {
    const insert = ctx.db.prepare(
      "INSERT INTO runs(id,created_at,origin,provider,status,cwd,prompt_summary) VALUES(?,?,?,?,?,?,?)",
    );
    ctx.db.transaction(() => {
      for (let i = 0; i < 10000; i++)
        insert.run(
          randomUUID(),
          i,
          "manual",
          i % 2 ? "claude" : "cursor",
          i < 500 ? "interrupted" : "done",
          ctx.paths.home,
          `Fixture ${i}`,
        );
    })();
    const headers = { "x-mordomo-token": ctx.token() };
    const query = "/api/runs?statusGroup=failed&provider=claude&order=asc&limit=50";
    const first = await app.inject({ method: "GET", url: query, headers });
    const next = await app.inject({ method: "GET", url: query + "&offset=50", headers });
    expect(first.statusCode).toBe(200);
    expect(first.headers["x-total-count"]).toBe("250");
    expect(first.json()).toHaveLength(50);
    expect(first.json()[0].createdAt).toBe(1);
    expect(next.json()[0].createdAt).toBe(101);
    const ids = new Set(first.json().map((row: { id: string }) => row.id));
    expect(next.json().some((row: { id: string }) => ids.has(row.id))).toBe(false);
    expect(
      first
        .json()
        .every(
          (row: { status: string; provider: string }) =>
            row.status === "interrupted" && row.provider === "claude",
        ),
    ).toBe(true);
  } finally {
    await app.close();
    ctx.close();
    home.cleanup();
  }
});
