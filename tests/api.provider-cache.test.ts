import { describe, it, expect, vi } from "vitest";
import { AppContext } from "../apps/api/src/context.js";
import type { HealthStatus } from "@mordomo/core";
import { makeTempHome } from "./helpers.js";

const status = (detail: string): HealthStatus => ({
  ok: false,
  installed: true,
  authenticated: "unknown",
  version: "fixture",
  detail,
  checkedAt: Date.now(),
});
function deferred() {
  let resolve!: (value: HealthStatus) => void;
  const promise = new Promise<HealthStatus>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("provider diagnostic concurrency", () => {
  it("shares probes between simultaneous clients, including forced refresh", async () => {
    const tmp = makeTempHome();
    const ctx = new AppContext(tmp.paths.home);
    try {
      const hold = deferred();
      const probes = ctx.providers
        .ids()
        .map((id) =>
          vi
            .spyOn(ctx.adapters[id], "healthCheck")
            .mockImplementation(() => (id === "claude" ? hold.promise : Promise.resolve(status(id)))),
        );
      const first = ctx.providerSnapshot();
      const second = ctx.providerSnapshot(true);
      hold.resolve(status("claude"));
      await Promise.all([first, second]);
      for (const probe of probes) expect(probe).toHaveBeenCalledTimes(1);
    } finally {
      ctx.close();
      tmp.cleanup();
    }
  });

  it("does not cache a stale probe after settings invalidate the adapters", async () => {
    const tmp = makeTempHome();
    const ctx = new AppContext(tmp.paths.home);
    try {
      const hold = deferred();
      for (const id of ctx.providers.ids())
        vi.spyOn(ctx.adapters[id], "healthCheck").mockResolvedValue(status("other"));
      vi.spyOn(ctx.adapters.claude, "healthCheck")
        .mockReturnValueOnce(hold.promise)
        .mockResolvedValue(status("new"));
      const old = ctx.providerSnapshot();
      ctx.invalidateProviderCache();
      const fresh = await ctx.providerSnapshot();
      expect(fresh.find((p) => p.id === "claude")!.health.detail).toBe("new");
      hold.resolve(status("old"));
      await old;
      expect((await ctx.providerSnapshot()).find((p) => p.id === "claude")!.health.detail).toBe("new");
    } finally {
      ctx.close();
      tmp.cleanup();
    }
  });
});
