import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ENGINE_ERROR_CODES } from "@mordomo/core";
import { exportsOf, type ExportInfo } from "./support/exportsOf.js";

/**
 * The public surface of `@mordomo/core` is a closed list (.specs/features/sdk-core, door 2): what is exported, what
 * moved to `@mordomo/core/internal`, what was dropped, and that every public name is documented.
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const json = <T>(file: string) => JSON.parse(read(file)) as T;

const publicList = json<{ values: string[]; types: string[] }>("tests/fixtures/sdk-public.json");
const before = json<{
  removed: Record<string, string>;
  sharedByBoth: string[];
  names: Record<string, { value: boolean; type: boolean }>;
}>("tests/fixtures/core-exports-before.json");

let publicExports: Record<string, ExportInfo> | null = null;
let internalExports: Record<string, ExportInfo> | null = null;
const publicOf = () => (publicExports ??= exportsOf("core/src/index.ts"));
const internalOf = () => (internalExports ??= exportsOf("core/src/internal.ts"));

describe("S5 the surface is a closed list", () => {
  it("C37 the public values and types are exactly the list, and the internal entry drops what was removed", async () => {
    const runtime = Object.keys(await import("@mordomo/core")).sort();
    expect(runtime).toEqual(publicList.values);

    const exported = publicOf();
    const values = Object.keys(exported)
      .filter((name) => exported[name]!.value)
      .sort();
    const types = Object.keys(exported)
      .filter((name) => !exported[name]!.value)
      .sort();
    expect(values).toEqual(publicList.values);
    expect(types).toEqual(publicList.types);

    const internal = Object.keys(await import("@mordomo/core/internal")).sort();
    for (const gone of Object.keys(before.removed)) expect(internal, gone).not.toContain(gone);
    expect(internal, "setProbeEnvDrop never was a barrel name, and must not be one now").not.toContain(
      "setProbeEnvDrop",
    );
    expect(internal.filter((name) => runtime.includes(name))).toEqual([]);
  });

  it("C38 every name of the old barrel is in exactly one entry point, or was removed on purpose", () => {
    const pub = publicOf();
    const internal = internalOf();
    const sharedByBoth = new Set(before.sharedByBoth);
    const problems: string[] = [];
    for (const [name, was] of Object.entries(before.names)) {
      const inPublic = name in pub;
      const inInternal = name in internal;
      if (name in before.removed) {
        if (inPublic || inInternal) problems.push(`${name}: removed, but still exported`);
        if (before.removed[name]!.length < 20) problems.push(`${name}: no reason written`);
        continue;
      }
      if (sharedByBoth.has(name)) {
        if (!(inPublic && inInternal)) problems.push(`${name}: should be in both`);
        else if (pub[name]!.value || !internal[name]!.value || !internal[name]!.type)
          problems.push(`${name}: public as a type only, internal as the schema`);
        continue;
      }
      if (inPublic === inInternal) {
        problems.push(`${name}: ${inPublic ? "in both" : "in neither"}`);
        continue;
      }
      const now = inPublic ? pub[name]! : internal[name]!;
      if (was.value && !now.value) problems.push(`${name}: was a value, now only a type`);
      if (was.type && !now.type) problems.push(`${name}: lost its type`);
    }
    expect(problems).toEqual([]);
    expect(Object.keys(before.removed).sort()).toEqual(["events", "probe", "setProviderBinaries"]);
    expect(Object.keys(before.names)).toHaveLength(603);
  });

  it("C38 the old barrel moved, it did not grow: only the new names are new", () => {
    const pub = publicOf();
    const internal = internalOf();
    const fresh = [...Object.keys(pub), ...Object.keys(internal)]
      .filter((name) => !(name in before.names))
      .sort();
    expect(fresh).toEqual(
      [
        "Engine",
        "ENGINE_ERROR_CODES",
        "EngineErrorCode",
        "ExecutionService",
        "Execution",
        "MordomoEngineOptions",
        "MordomoError",
        "ReadonlyProviders",
        "ResolveApprovalOptions",
        "ResolvedApproval",
        "RetryInput",
        "RUN_LIMITS",
        "RunFilter",
        "SettingsUpdate",
        "SmokeResult",
        "SpawnPolicy",
        "StartOptions",
        "StartPromptInput",
        "StartSkillInput",
        "StartedRun",
        "WaitOptions",
        "DropEnv",
        "EventFeed",
        "clipForLabel",
      ].sort(),
    );
  });

  it("C39 every public name has a doc comment and a heading in docs/sdk.md, and every heading names an export", () => {
    const pub = publicOf();
    const names = Object.keys(pub).sort();
    const undocumented = names.filter((name) => pub[name]!.doc.length < 10);
    expect(undocumented).toEqual([]);

    const headings = [...read("docs/sdk.md").matchAll(/^### `([A-Za-z_][\w]*)`/gm)].map((m) => m[1]!).sort();
    expect(headings).toEqual(names);
  });

  it("C50 the error codes are the list of the Landing and each is documented", () => {
    expect([...ENGINE_ERROR_CODES]).toEqual([
      "profile_refused",
      "unknown_provider",
      "device_provider_refused",
      "self_approval",
      "owner_only",
      "submission_conflict",
      "submission_uncertain",
      "budget_exhausted",
      "request_unavailable",
      "skill_unavailable",
      "workspace_unavailable",
      "engine_locked",
    ]);
    const docs = read("docs/sdk.md");
    for (const code of ENGINE_ERROR_CODES) expect(docs, code).toContain(`\`${code}\``);
  });
});
