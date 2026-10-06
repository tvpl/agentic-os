import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import * as contracts from "@mordomo/contracts";
import * as core from "@mordomo/core";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";

/** Shared contracts (.specs/features/contratos). */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

describe("S1 the contracts package", () => {
  it("C1 the contracts package exports the runtime pieces", () => {
    expect(contracts.SettingsSchema.parse({}).version).toBe(1);
    expect(typeof contracts.writeDecision).toBe("function");
    expect(Object.keys(contracts.PROFILES).sort()).toEqual(
      ["approved_automation", "controlled_write", "read_only", "review_before_write"].sort(),
    );
  });

  it("C3 the contracts package depends on zod only", () => {
    const pkg = JSON.parse(read("contracts/package.json")) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(["zod"]);
  });

  it("C4 core re-exports the very same contract objects", () => {
    expect(core.writeDecision).toBe(contracts.writeDecision);
    expect(core.PROFILES).toBe(contracts.PROFILES);
    expect(core.SettingsSchema).toBe(contracts.SettingsSchema);
  });
});

describe("S2 typed, versioned events", () => {
  it("C6 every emitted event carries v 1", () => {
    const bus = new core.EventBus();
    const before = bus.lastId;
    const a = bus.emit("run.finished", { runId: "r", status: "done", durationMs: 1 });
    const b = bus.emit("settings.changed", { settings: contracts.SettingsSchema.parse({}) });
    const c = bus.emit("notification.read", { all: true });
    for (const e of [a, b, c]) expect(e.v).toBe(1);
    expect(bus.since(before).map((e) => e.v)).toEqual([1, 1, 1]);
  });

  describe("over SSE", () => {
    let app: FastifyInstance;
    let ctx: AppContext;
    let cleanup: () => void;
    let base = "";
    beforeAll(async () => {
      const tmp = makeTempHome();
      cleanup = tmp.cleanup;
      ctx = new AppContext(tmp.paths.home);
      app = await buildServer(ctx);
      await app.listen({ port: 0, host: "127.0.0.1" });
      const addr = app.server.address();
      base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    });
    afterAll(async () => {
      await app.close();
      ctx.close();
      cleanup();
    });

    it("C7 the SSE feed carries the event version", async () => {
      const ac = new AbortController();
      const res = await fetch(`${base}/api/events?token=${ctx.token()}`, { signal: ac.signal });
      const reader = res.body!.getReader();
      setTimeout(() => {
        core.events.emit("routine.changed", { id: "x", action: "test" });
        core.events.emit("approval.expired", { count: 2 });
      }, 100);
      let text = "";
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline && !text.includes("approval.expired")) {
        const { value, done } = await reader.read();
        if (done) break;
        text += Buffer.from(value).toString("utf8");
      }
      ac.abort();
      const dataLines = text
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => JSON.parse(l.slice(6)) as { type: string; v?: number });
      const ours = dataLines.filter((d) => d.type === "routine.changed" || d.type === "approval.expired");
      expect(ours).toHaveLength(2);
      for (const d of ours) expect(d.v).toBe(1);
    });
  });
});

describe("S3 the UI uses the contract", () => {
  it("C10 the UI api types are contract aliases", () => {
    const api = read("apps/command-centre/src/api.ts");
    expect(api).toContain('import type * as Contracts from "@mordomo/contracts";');
    for (const name of [
      "RunRecord",
      "RunUsage",
      "RunUsageEvent",
      "ApprovalRecord",
      "NotificationItem",
      "NotificationKind",
      "SessionRecord",
      "SettingsDoc",
      "ProviderId",
      "ProviderCapabilities",
      "OsEvent",
    ]) {
      expect(api, name).toMatch(new RegExp(`export type ${name} =\\s*(\\|\\s*)?Contracts\\.`));
      expect(api, name).not.toMatch(new RegExp(`export interface ${name}\\b`));
    }
    expect(api.match(/mirrors core/g) ?? []).toEqual([]);
  });

  it("C11 the UI write policy comes from the contract", () => {
    const policy = read("apps/command-centre/src/runs/policy.ts");
    expect(policy).toMatch(/import \{[^}]*\bwriteDecision\b[^}]*\} from "@mordomo\/contracts(\/policy)?";/);
    expect(policy).not.toMatch(/\b(read_only|review_before_write|controlled_write|approved_automation)\s*:/);
  });
});
