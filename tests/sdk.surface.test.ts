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
        "classifyNotePath",
        "clipForLabel",
        "createNote",
        "linksOf",
        "readNote",
        "saveNote",
        // cerebro-contextos: the work contexts the routes define and read by
        "changedContext",
        "contextMembership",
        // cerebro-contextos, batch B: what a run's credential reads (door 8)
        "contextOkPaths",
        "contextSyncTarget",
        "describeContexts",
        // cerebro-contextos, batch C: "Edit brief" makes the brief from the template (door 9)
        "ensureContextBrief",
        "findContext",
        "newContext",
        "removeContextMap",
        // cerebro-organizar: the folder map the route answers, and what a run's credential sees on it (doors 4, 10)
        "folderDigests",
        "runMapReach",
        // cerebro-vista-notas: the notes tree and the properties route (doors 1 and 2)
        "memoryTree",
        "saveProperties",
        // cerebro-paineis, batch B: a task's box checked from a dashboard (amendment 17)
        "saveTask",
        // cerebro-faxina-guiada: the scope of a cleanup and its inventory (door 5)
        "cleanupInventory",
        "resolveCleanupScope",
        // cerebro-faxina-guiada, batch B: the decisions, the apply and the undo (doors 1, 3, 4 and 5)
        "applyCleanup",
        "cleanupScanFor",
        "saveCleanupDecisions",
        "undoCleanup",
        // cerebro-natureza: the closed lists of door 1 the search, the recall and the CLI read their filters by
        "ESCOPOS",
        "NATUREZAS",
        "parseEscopoList",
        "parseNaturezaList",
        // cerebro-natureza, batch B: the review queue and the decisions on it (doors 4 to 6)
        "decideReview",
        "reviewsDue",
        // cerebro-paineis: the dashboards of a service, their store and the eleven sources (doors 1, 2 and 4)
        "DashboardService",
        "DashboardStore",
        "dashboardSources",
        // cerebro-memoria-confiavel, batch A1: who wrote a fact and today's policy on its source (doors 2, 3, AC 20),
        // and the history of memory/ the routes read, restore and record (doors 4 and 10)
        "FactAuthor",
        "factSourcePolicy",
        "getVersion",
        "listVersions",
        "recordFileVersion",
        "recordMove",
        "restoreVersion",
        // cerebro-memoria-confiavel, batch A2: the review inbox the routes store, list, read and decide (doors 5 to 7
        // and 10), and the checks a new note's proposal is refused by when it is made (AC 47)
        "ProposalValidationError",
        "decideProposal",
        "listProposals",
        "planNewNote",
        // cerebro-memoria-confiavel, round 3 part 1: the folders no audience is served (the guard's, the exports)
        "deniedDirs",
        "guardDir",
        "readProposal",
        "storeProposal",
        // cerebro-memoria-confiavel, batch B1: the access of folders the routes read every request through (door 12),
        // the stored-row filter of a caller's view, and the files a proposal names (G14)
        "FolderAccess",
        "accessSettings",
        "exportsDir",
        "proposalPaths",
        "resolveFolderAccess",
        // a finished cleanup scan, worked out again over a device's view (C115)
        "scanCleanupScope",
        // cerebro-memoria-confiavel, round 1 part 2: how a hidden folder is written in a citation, for a device's answer
        // and for the triage prompt (finding 5, finding 10)
        "HIDDEN_PATH_TEXT",
        "CitationRedactor",
        "citationRedactor",
        "storedRowFilter",
        // cerebro-memoria-confiavel, round 2 part B: the history paths a device may read (finding 6)
        "visibleHistoryPaths",
        // cerebro-memoria-confiavel batch B2: export and import a folder (doors 14 and 15)
        "exportFolder",
        "importFolder",
        // cerebro-rituais, batch A: the weekly review's list, a loop's decision and a project's next action (doors 1 to 3)
        "appendTask",
        "decideLoop",
        "weeklyReview",
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
      "approval_expired",
      "approval_resolved",
    ]);
    const docs = read("docs/sdk.md");
    for (const code of ENGINE_ERROR_CODES) expect(docs, code).toContain(`\`${code}\``);
  });
});
