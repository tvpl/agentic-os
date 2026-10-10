import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import * as contracts from "@mordomo/contracts";
import * as policy from "@mordomo/contracts/policy";
import * as core from "@mordomo/core";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";

/** Shared contracts (.specs/features/contratos). */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

describe("S1 the contracts package", () => {
  it("C1 the contracts package exports the runtime pieces", () => {
    expect(contracts.SettingsSchema.parse({}).version).toBe(contracts.CURRENT_SETTINGS_VERSION);
    expect(typeof contracts.writeDecision).toBe("function");
    expect(Object.keys(contracts.PROFILES).sort()).toEqual(
      ["approved_automation", "controlled_write", "read_only", "review_before_write"].sort(),
    );
  });

  it("C3 the contracts package depends on zod only", () => {
    const pkg = JSON.parse(read("contracts/package.json")) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(["zod"]);
  });

  it("C16 the contracts package publishes exactly two entry points", () => {
    const pkg = JSON.parse(read("contracts/package.json")) as {
      exports: Record<string, { types: string; default: string }>;
    };
    expect(pkg.exports).toEqual({
      ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
      "./policy": { types: "./dist/policy.d.ts", default: "./dist/policy.js" },
    });
    // The subpath exists so a browser can take the policy without zod: follow every
    // value import and re-export from policy.ts (type-only ones are erased) and
    // check none of them reaches zod.
    const reached = new Set<string>();
    const walk = (rel: string) => {
      if (reached.has(rel)) return;
      reached.add(rel);
      const src = read(rel);
      const specifiers = [
        ...src.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+(["'])([^"']+)\1/gms),
        ...src.matchAll(/^\s*import\s+(["'])([^"']+)\1/gm),
        ...src.matchAll(/\bimport\(\s*(["'])([^"']+)\1\s*\)/g),
      ].map((m) => m[2]!);
      for (const spec of specifiers) {
        if (spec.startsWith("."))
          walk(path.posix.join(path.posix.dirname(rel), spec.replace(/\.js$/, ".ts")));
        else reached.add(spec);
      }
    };
    walk("contracts/src/policy.ts");
    expect([...reached].filter((m) => !m.startsWith("contracts/src/"))).toEqual([]);
  });

  it("C41 the device pieces are the only new exports", () => {
    // The whole runtime surface of the package, pinned: a name added or removed is a change to a door.
    expect(Object.keys(contracts).sort()).toEqual(
      [
        "BUILTIN_PROVIDER_IDS",
        "BrainSettingsSchema",
        "CURRENT_SETTINGS_VERSION",
        "ChannelSettingsSchema",
        "ClaudeStreamMessage",
        "CodexStreamEvent",
        "DEFAULT_DEVICE_SCOPES",
        "DEFAULT_EXCLUDES",
        "DEFAULT_HUD",
        "DEVICE_SCOPES",
        "EffortLevel",
        "IndexedFolderSchema",
        "KnownStreamTypes",
        "MicroAppSchema",
        "NOTIFICATION_KINDS",
        "OS_EVENT_VERSION",
        "PROFILES",
        "ProviderId",
        "ProviderSettingsSchema",
        "SENTINEL_IDS",
        "SecurityProfile",
        "SentinelSettingsSchema",
        "SessionId",
        "SettingsSchema",
        "TERMINAL_STATUSES",
        "UI_PREFERENCE_KEYS",
        "UI_SHELLS",
        "UiPreferencesSchema",
        "UiShellSchema",
        "closeDeviceScopes",
        "defaultSettings",
        "defaultUiPreferences",
        "detectTimezone",
        "isDeviceActor",
        "writeDecision",
      ].sort(),
    );
    // The browser takes the scopes from the entry point that carries no zod.
    expect(Object.keys(policy).sort()).toEqual(
      [
        "DEFAULT_DEVICE_SCOPES",
        "DEVICE_SCOPES",
        "PROFILES",
        "closeDeviceScopes",
        "isDeviceActor",
        "writeDecision",
      ].sort(),
    );
    expect(core.DEVICE_SCOPES).toBe(contracts.DEVICE_SCOPES);
    expect(core.DEFAULT_DEVICE_SCOPES).toBe(contracts.DEFAULT_DEVICE_SCOPES);
    expect(core.closeDeviceScopes).toBe(contracts.closeDeviceScopes);
    expect(core.isDeviceActor).toBe(contracts.isDeviceActor);
    expect(contracts.isDeviceActor("device:abc")).toBe(true);
    for (const by of ["owner", "device:", "telegram:1", "broker:r", "", null, undefined]) {
      expect(contracts.isDeviceActor(by as string | null | undefined), String(by)).toBe(false);
    }
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
