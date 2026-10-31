import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import ts from "typescript";
import * as contracts from "@mordomo/contracts";
import * as policy from "@mordomo/contracts/policy";
import * as core from "@mordomo/core/internal";
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

  it("C16 the contracts package publishes exactly three entry points", () => {
    const pkg = JSON.parse(read("contracts/package.json")) as {
      exports: Record<string, { types: string; default: string }>;
    };
    expect(pkg.exports).toEqual({
      ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
      "./policy": { types: "./dist/policy.d.ts", default: "./dist/policy.js" },
      "./events": { types: "./dist/eventRegistry.d.ts", default: "./dist/eventRegistry.js" },
    });
    // The subpaths exist so a browser can take the policy and the event registry without zod: follow every
    // value import and re-export from their entry files (type-only ones are erased) and check none of them
    // reaches zod, or anything else outside contracts/src.
    const reachFrom = (entry: string) => {
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
      walk(entry);
      return [...reached];
    };
    for (const entry of ["contracts/src/policy.ts", "contracts/src/eventRegistry.ts"]) {
      expect(
        reachFrom(entry).filter((m) => !m.startsWith("contracts/src/")),
        entry,
      ).toEqual([]);
    }
    // The walker does see a value import of zod: the root entry reaches it.
    expect(reachFrom("contracts/src/settings.ts")).toContain("zod");
  });

  it("C41 the device pieces are the only new exports", () => {
    // The whole runtime surface of the package, pinned: a name added or removed is a change to a door (contratos-rest
    // adds the route table, its checks, the event registry and schemas, and the shapes that moved here from the core).
    expect(Object.keys(contracts).sort()).toEqual(
      [
        "API",
        "ActiveHoursSchema",
        "AuditReportSchema",
        "BUILTIN_PROVIDER_IDS",
        "BrainSettingsSchema",
        "COMMON_ERRORS",
        "CONTEXT_ID",
        "CONTEXT_LIMITS",
        "CURRENT_SETTINGS_VERSION",
        "ChannelSettingsSchema",
        "ClaudeStreamMessage",
        "CodexStreamEvent",
        "ConnectorDataSchema",
        "ConnectorItemSchema",
        "ConnectorSchema",
        "DASHBOARD_ID",
        "DASHBOARD_MAX_BYTES",
        "DEFAULT_DEVICE_SCOPES",
        "DEFAULT_EXCLUDES",
        "DEFAULT_HUD",
        "DEVICE_SCOPES",
        // cerebro-paineis: door 1's definition and door 4's snapshot, which the engine reads a file and a row by
        "DashboardSnapshotSchema",
        "DashboardSpecSchema",
        "DataMappingSchema",
        "EMBEDDINGS_KEY_ENV",
        "EVENT_ENVELOPES",
        "EVENT_SCHEMAS",
        "EVENT_VERSIONS",
        "EffortLevel",
        "ErrorEnvelope",
        "EverySchema",
        "FieldSpecSchema",
        "HeartbeatSchema",
        "INDEX_PHASES",
        "IndexedFolderSchema",
        "ItemFieldsSchema",
        "KnownStreamTypes",
        "MicroAppSchema",
        "NAMED_SCHEMAS",
        "NOTIFICATION_KINDS",
        "OS_EVENT_TYPES",
        "OS_EVENT_VERSION",
        "OnExitSchema",
        "OsEventSchema",
        "PROFILES",
        "ProviderId",
        "ProviderSettingsSchema",
        "QUERY_FLAG_TEXTS",
        "QueryFlag",
        "RUN_FRAME_SCHEMAS",
        "RUN_FRAME_TYPES",
        "RUN_FRAME_VERSIONS",
        "RUN_LIMITS",
        "RoutineContext",
        "RoutineDelivery",
        "RoutineHistoryEntrySchema",
        "RoutineRunner",
        "RoutineSchema",
        "RoutineStatusSchema",
        "RoutineSummarySchema",
        "RunFrameSchema",
        "SENTINEL_IDS",
        "ScheduleKind",
        "SecurityProfile",
        "SentinelSettingsSchema",
        "SessionId",
        "SettingsPatchSchema",
        "SettingsSchema",
        "SilentRoutineSchema",
        "SkillFrontmatterSchema",
        "SkillI18nSchema",
        "SkillInputSchema",
        "SkillResourceSchema",
        "SkillSchema",
        "TERMINAL_STATUSES",
        "ToolMappingSchema",
        "UI_PREFERENCE_KEYS",
        "UI_SHELLS",
        "UiPreferencesPatchSchema",
        "UiPreferencesSchema",
        "UiShellSchema",
        "binary",
        "checkBody",
        "checkResponse",
        "classifyEvent",
        "classifyRunFrame",
        "closeDeviceScopes",
        "commonErrorsFor",
        "currentEventVersion",
        "currentRunFrameVersion",
        "declaredErrors",
        "defaultSettings",
        "defaultUiPreferences",
        "detectTimezone",
        "isDeviceActor",
        "isJournalDate",
        "isRawResponse",
        "normalizeLangTag",
        "readOsEvent",
        "route",
        "routeKey",
        "serializeDashboard",
        "stream",
        "toWire",
        "wireSchema",
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
        ctx.events.emit("routine.changed", { id: "x", action: "test" });
        ctx.events.emit("approval.expired", { count: 2 });
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

  it("C11 the UI has no profile table: no source file of the interface keys anything by a security profile", () => {
    // The helper that once asked the contract (`writeDecision`) for the UI left with the box it served
    // (.specs/features/limpeza-legado, C9): what is left to hold is that nobody wrote the table instead.
    const profiles = new Set(Object.keys(contracts.PROFILES));
    const keyed = (code: string): string[] => {
      const found: string[] = [];
      const visit = (n: ts.Node) => {
        const named =
          ts.isPropertyAssignment(n) ||
          ts.isShorthandPropertyAssignment(n) ||
          ts.isPropertySignature(n) ||
          ts.isPropertyDeclaration(n) ||
          ts.isEnumMember(n);
        if (named) {
          const name = n.name;
          const text =
            ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)
              ? name.text
              : ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)
                ? name.expression.text
                : null;
          if (text !== null && profiles.has(text)) found.push(text);
        }
        n.forEachChild(visit);
      };
      visit(ts.createSourceFile("x.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
      return found;
    };
    // The reader sees a key in every spelling and not a profile used as a value.
    expect(
      keyed("const a = { read_only: 1, 'review_before_write': 2, ['controlled_write']: 3, other: 4 };"),
    ).toEqual(["read_only", "review_before_write", "controlled_write"]);
    expect(keyed("interface I { approved_automation: string } enum E { read_only = 1 }")).toEqual([
      "approved_automation",
      "read_only",
    ]);
    expect(
      keyed('const mode: Mode = "read_only"; const list = ["controlled_write"]; f({ mode: "read_only" });'),
    ).toEqual([]);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(abs);
        else if (/\.tsx?$/.test(entry.name) && !/\.(test|typetest)\.tsx?$/.test(entry.name)) files.push(abs);
      }
    };
    walk(path.join(repoRoot, "apps/command-centre/src"));
    expect(files.length).toBeGreaterThan(300);
    const offenders = files.flatMap((f) =>
      keyed(fs.readFileSync(f, "utf8")).map((k) => `${path.relative(repoRoot, f)}: ${k}`),
    );
    expect(offenders).toEqual([]);
  });
});
