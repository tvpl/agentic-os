import { afterEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { ZodError } from "zod";
import {
  MordomoError,
  PathAccessError,
  type Engine,
  type RunEvent,
  type SecurityProfile,
} from "@mordomo/core";
import {
  buildEngine,
  closeAll,
  echoProvider,
  internals,
  rowCount,
  tempHome,
  writeSkill,
} from "./support/sdk.js";

/**
 * Running an agent from a program (.specs/features/sdk-core, S1 and S2): `engine.execution` starts, follows, cancels
 * and approves runs, and carries the rules of the engine - so a program that uses the core as a library cannot go
 * around them. The provider answers in this process; the names of the tests start with the number of the check.
 */

afterEach(closeAll);

const uuid = () => crypto.randomUUID();

async function until(condition: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const refusal = (fn: () => unknown): MordomoError => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(MordomoError);
    return error as MordomoError;
  }
  throw new Error("expected the call to be refused");
};

const skillFront = (slug: string, extra = "", providers = "echo") =>
  `name: ${slug}\nslug: ${slug}\ndescription: A skill for ${slug}\nproviders: [${providers}]\n${extra}`;

const parked = (engine: Engine, extra: Record<string, unknown> = {}) =>
  engine.execution.startPrompt({ prompt: "change it", mode: "write", startedBy: null, ...extra });

/** The members of `ApprovalKind`, read from the type itself, so a kind added to the union is not missed by a list typed here. */
function approvalKindsInContracts(): string[] {
  const file = path.resolve(import.meta.dirname, "../contracts/src/policy.ts");
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
  const alias = sf.statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === "ApprovalKind",
  );
  if (!alias || !ts.isUnionTypeNode(alias.type))
    throw new Error("ApprovalKind is no longer a union of literals");
  return alias.type.types.map((member) => {
    if (!ts.isLiteralTypeNode(member) || !ts.isStringLiteral(member.literal))
      throw new Error("ApprovalKind has a member that is not a string literal");
    return member.literal.text;
  });
}

function emptyOf(engine: Engine): void {
  expect(rowCount(engine, "sessions")).toBe(0);
  expect(rowCount(engine, "runs")).toBe(0);
}

describe("S1 a program with only @mordomo/core runs an agent", () => {
  it("C1 startPrompt queues a run and wait resolves it done", async () => {
    const echo = echoProvider();
    const engine = buildEngine([echo]);
    engine.start();
    const started = engine.execution.startPrompt({ prompt: "hi", provider: "echo", startedBy: null });
    expect(started.status).toBe("queued");
    expect(started.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(started.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    const record = await engine.execution.wait(started.runId);
    expect(record.status).toBe("done");
    expect(record.id).toBe(started.runId);
    expect(echo.state.calls).toBe(1);
  });

  it("C2 events are the persisted ones, in order, and afterId narrows them", async () => {
    const engine = buildEngine([echoProvider()]);
    const { runId } = engine.execution.startPrompt({ prompt: "hi", startedBy: null });
    await engine.execution.wait(runId);
    const all = engine.execution.events(runId);
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all.map((e) => e.id)).toEqual([...all.map((e) => e.id)].sort((a, b) => a - b));
    expect(all.at(-1)?.event.type).toBe("result");
    const second = all[1]!.id;
    expect(engine.execution.events(runId, second).map((e) => e.id)).toEqual(
      all.filter((e) => e.id > second).map((e) => e.id),
    );
  });

  it("C3 subscribe delivers the live events in order and stops after the returned function", async () => {
    const echo = echoProvider();
    echo.state.hold = true;
    const engine = buildEngine([echo]);
    const { runId } = engine.execution.startPrompt({ prompt: "hi", startedBy: null });
    const kept: RunEvent[] = [];
    const dropped: RunEvent[] = [];
    engine.execution.subscribe(runId, (event) => kept.push(event));
    const off = engine.execution.subscribe(runId, (event) => {
      dropped.push(event);
      off();
    });
    await until(() => kept.length >= 1, "the first event");
    echo.state.release();
    await engine.execution.wait(runId);
    expect(kept.slice(0, 3).map((e) => e.type)).toEqual(["text", "text", "result"]);
    expect(dropped.map((e) => e.type)).toEqual(["text"]);
  });

  it("C4 cancel resolves true for a run in progress and false for an unknown id", async () => {
    const echo = echoProvider();
    echo.state.hold = true;
    const engine = buildEngine([echo]);
    const { runId } = engine.execution.startPrompt({ prompt: "hi", startedBy: null });
    await until(() => echo.state.calls === 1, "the provider to start");
    expect(await engine.execution.cancel(runId)).toBe(true);
    expect((await engine.execution.wait(runId)).status).toBe("cancelled");
    expect(await engine.execution.cancel(uuid())).toBe(false);
  });

  it("C5 get answers null for an unknown run and list filters by provider, newest first, up to limit", async () => {
    const one = echoProvider();
    const two = echoProvider({ id: "echo2" });
    const engine = buildEngine([one, two]);
    expect(engine.execution.get(uuid())).toBeNull();
    const ids: string[] = [];
    for (const provider of ["echo", "echo2", "echo"]) {
      const { runId } = engine.execution.startPrompt({ prompt: "hi", provider, startedBy: null });
      await engine.execution.wait(runId);
      ids.push(runId);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const listed = engine.execution.list({ provider: "echo", limit: 1 });
    expect(listed.map((r) => r.id)).toEqual([ids[2]]);
    expect(engine.execution.list({ provider: "echo2" }).map((r) => r.id)).toEqual([ids[1]]);
  });

  it("C6 wait rejects with the signal's reason and leaves the run alone", async () => {
    const echo = echoProvider();
    echo.state.hold = true;
    const engine = buildEngine([echo]);
    const { runId } = engine.execution.startPrompt({ prompt: "hi", startedBy: null });
    await until(() => echo.state.calls === 1, "the provider to start");
    const abort = new AbortController();
    const waiting = engine.execution.wait(runId, { signal: abort.signal });
    const reason = new Error("stop waiting");
    abort.abort(reason);
    await expect(waiting).rejects.toBe(reason);
    // A signal that is already aborted rejects at once, without waiting for the run.
    const early = new AbortController();
    early.abort(new Error("aborted before waiting"));
    await expect(engine.execution.wait(runId, { signal: early.signal })).rejects.toThrow(
      "aborted before waiting",
    );
    echo.state.release();
    expect((await engine.execution.wait(runId)).status).toBe("done");
  });

  it("C7 the bounds of a prompt run are enforced and leave nothing behind", async () => {
    const engine = buildEngine([echoProvider()]);
    const refused: Array<Record<string, unknown>> = [
      { prompt: "" },
      { prompt: "x".repeat(20_001) },
      { prompt: "hi", timeoutMs: 9_999 },
      { prompt: "hi", timeoutMs: 3_600_001 },
    ];
    for (const body of refused) {
      expect(
        () => engine.execution.startPrompt({ startedBy: null, ...body } as never),
        JSON.stringify(body).slice(0, 40),
      ).toThrow(ZodError);
    }
    emptyOf(engine);
    for (const body of [
      { prompt: "x".repeat(20_000) },
      { prompt: "hi", timeoutMs: 10_000 },
      { prompt: "hi", timeoutMs: 3_600_000 },
    ]) {
      const { runId } = engine.execution.startPrompt({ startedBy: null, ...body });
      expect((await engine.execution.wait(runId)).status).toBe("done");
    }
  });
});

describe("S2 the rules of the engine hold for a library caller", () => {
  it("C8 under review_before_write a write is parked for approval and the provider is not called", () => {
    const echo = echoProvider();
    const engine = buildEngine([echo], { profile: "review_before_write" });
    const started = parked(engine);
    expect(started.status).toBe("waiting_approval");
    expect(started.pendingApproval?.kind).toBe("write_run");
    expect(engine.execution.get(started.runId)?.status).toBe("waiting_approval");
    expect(echo.state.calls).toBe(0);
  });

  it("C9 approving launches the very run that was parked", async () => {
    const echo = echoProvider();
    const engine = buildEngine([echo], { profile: "review_before_write" });
    const started = parked(engine);
    const resolved = await engine.execution.resolveApproval(started.pendingApproval!.id, "approved", "owner");
    expect(resolved.runId).toBe(started.runId);
    expect((await engine.execution.wait(started.runId)).status).toBe("done");
    expect(rowCount(engine, "runs")).toBe(1);
    expect(echo.state.calls).toBe(1);
  });

  it("C10 denying cancels the parked run and the provider is not called", async () => {
    const echo = echoProvider();
    const engine = buildEngine([echo], { profile: "review_before_write" });
    const started = parked(engine);
    const resolved = await engine.execution.resolveApproval(started.pendingApproval!.id, "denied", "owner");
    expect(resolved.runId).toBeNull();
    expect(engine.execution.get(started.runId)?.status).toBe("cancelled");
    expect(echo.state.calls).toBe(0);
  });

  it("C11 under read_only a write is refused 403 profile_refused and creates nothing", () => {
    const engine = buildEngine([echoProvider()], { profile: "read_only" });
    const error = refusal(() => parked(engine));
    expect([error.statusCode, error.code]).toEqual([403, "profile_refused"]);
    emptyOf(engine);
  });

  it("C12 a working folder outside the granted ones is refused, and the default is <home>/workspace", async () => {
    const home = tempHome();
    const outside = tempHome("mordomo-sdk-outside-");
    const engine = buildEngine([echoProvider()], { home });
    writeSkill(home, "say-hi", skillFront("say-hi"));
    fs.mkdirSync(path.join(home, "workspace"), { recursive: true });
    fs.symlinkSync(path.join(home, "config"), path.join(home, "workspace", "to-config"));
    const refuseAll = (cwd: string) => {
      expect(() => engine.execution.startPrompt({ prompt: "hi", cwd, startedBy: null }), cwd).toThrow(
        PathAccessError,
      );
      expect(() => engine.execution.startSkill({ slug: "say-hi", cwd, startedBy: null }), cwd).toThrow(
        PathAccessError,
      );
    };
    // Outside every granted folder, and inside the home but in config/ (also through a link).
    for (const cwd of [outside, path.join(home, "workspace", "to-config"), path.join(home, "config")])
      refuseAll(cwd);
    // A granted folder that contains the home is refused too.
    const parent = path.dirname(home);
    engine.updateSettings({ indexedFolders: [{ path: parent, enabled: true, area: null }] });
    refuseAll(parent);
    emptyOf(engine);
    const workspace = fs.realpathSync(path.join(home, "workspace"));
    for (const body of [{}, { cwd: home }]) {
      const { runId } = engine.execution.startPrompt({ prompt: "hi", startedBy: null, ...body });
      expect(engine.execution.get(runId)?.cwd, JSON.stringify(body)).toBe(workspace);
      await engine.execution.wait(runId);
    }
  });

  it("C13 a device only starts a run on a provider whose reads stay in the working folder", async () => {
    const home = tempHome();
    writeSkill(home, "say-hi", skillFront("say-hi", "", "echo, open"));
    const closed = echoProvider({ id: "echo", readConfinement: "workdir" });
    const open = echoProvider({ id: "open", readConfinement: "none" });
    const engine = buildEngine([closed, open], { home });
    const device = "device:abc";
    const start = (provider: string) => () =>
      engine.execution.startPrompt({ prompt: "hi", provider, startedBy: device });
    const startSkill = (provider: string) => () =>
      engine.execution.startSkill({ slug: "say-hi", provider, startedBy: device });
    for (const call of [start("open"), startSkill("open")]) {
      const error = refusal(call);
      expect([error.statusCode, error.code]).toEqual([403, "device_provider_refused"]);
    }
    emptyOf(engine);
    const ok = start("echo")();
    expect(ok.status).toBe("queued");
    await engine.execution.wait(ok.runId);
  });

  it("C14 profile by asker decides a write: refuse, park or run", async () => {
    const table: Array<[SecurityProfile, string, "refused" | "waiting_approval" | "queued"]> = [
      ["read_only", "owner", "refused"],
      ["read_only", "device:abc", "refused"],
      ["review_before_write", "owner", "waiting_approval"],
      ["review_before_write", "device:abc", "waiting_approval"],
      ["controlled_write", "owner", "queued"],
      ["controlled_write", "device:abc", "waiting_approval"],
      ["approved_automation", "owner", "queued"],
      ["approved_automation", "device:abc", "waiting_approval"],
    ];
    for (const [profile, asker, expected] of table) {
      const engine = buildEngine([echoProvider()], { profile });
      const label = `${profile} / ${asker}`;
      if (expected === "refused") {
        expect(refusal(() => parked(engine, { startedBy: asker })).code, label).toBe("profile_refused");
        continue;
      }
      const started = parked(engine, { startedBy: asker });
      expect(started.status, label).toBe(expected);
      if (expected === "queued") await engine.execution.wait(started.runId);
    }
  });

  it("C15 a device never approves what it asked for, nor a kind that is the owner's", async () => {
    const engine = buildEngine([echoProvider()], { profile: "review_before_write" });
    const requests = internals(engine).approvals;
    // What it asked for itself.
    const own = parked(engine, { startedBy: "device:abc" });
    const self = await engine.execution
      .resolveApproval(own.pendingApproval!.id, "approved", "device:abc")
      .catch((e) => e);
    expect([self.statusCode, self.code]).toEqual([403, "self_approval"]);
    expect(engine.execution.pendingApprovals().map((a) => a.id)).toContain(own.pendingApproval!.id);
    // Every kind of approval, asked for by someone else.
    const kinds = [
      "write_run",
      "tool_use",
      "install_software",
      "change_global_config",
      "destructive_command",
      "access_new_folder",
      "connector_write",
      "create_startup_service",
      "expose_port",
      "send_external_data",
      "overwrite_existing_config",
    ] as const;
    // The list above is the whole of `ApprovalKind`: a new kind has to be given a row here (and a rule in the engine).
    expect([...kinds].sort()).toEqual(approvalKindsInContracts().sort());
    const deviceMayApprove = new Set(["write_run", "tool_use"]);
    for (const kind of kinds) {
      const approval = requests.request(kind, `a ${kind}`, {}, "device:other");
      const outcome = await engine.execution.resolveApproval(approval.id, "approved", "device:abc").then(
        () => "approved",
        (e: MordomoError) => `${e.statusCode} ${e.code}`,
      );
      expect(outcome, kind).toBe(deviceMayApprove.has(kind) ? "approved" : "403 owner_only");
      const stillPending = engine.execution.pendingApprovals().some((a) => a.id === approval.id);
      expect(stillPending, kind).toBe(!deviceMayApprove.has(kind));
    }
  });

  it("C16 an unregistered or disabled provider is refused and creates nothing", () => {
    const home = tempHome();
    writeSkill(home, "say-hi", skillFront("say-hi", "", "echo, ghost, echo2"));
    const engine = buildEngine([echoProvider(), echoProvider({ id: "echo2" })], { home });
    engine.updateSettings({ providers: { echo2: { enabled: false } } });
    const attempts: Array<[string, () => unknown]> = [
      ["prompt", () => engine.execution.startPrompt({ prompt: "hi", provider: "ghost", startedBy: null })],
      ["skill", () => engine.execution.startSkill({ slug: "say-hi", provider: "ghost", startedBy: null })],
    ];
    for (const [label, call] of attempts) {
      const error = refusal(call);
      expect([error.statusCode, error.code], label).toEqual([400, "unknown_provider"]);
    }
    const disabled: Array<[string, () => unknown]> = [
      ["prompt", () => engine.execution.startPrompt({ prompt: "hi", provider: "echo2", startedBy: null })],
      ["skill", () => engine.execution.startSkill({ slug: "say-hi", provider: "echo2", startedBy: null })],
    ];
    for (const [label, call] of disabled) {
      const error = refusal(call);
      expect([error.statusCode, error.code], label).toEqual([400, undefined]);
    }
    emptyOf(engine);
  });

  it("C17 a submissionId makes a call idempotent per body and asker", async () => {
    const engine = buildEngine([echoProvider()]);
    const submissionId = uuid();
    const body = { prompt: "once", submissionId, startedBy: "owner" };
    const first = engine.execution.startPrompt(body);
    const again = engine.execution.startPrompt(body);
    expect(again).toEqual(first);
    await engine.execution.wait(first.runId);
    expect(rowCount(engine, "runs")).toBe(1);
    expect(refusal(() => engine.execution.startPrompt({ ...body, prompt: "other" })).code).toBe(
      "submission_conflict",
    );
    expect(refusal(() => engine.execution.startPrompt({ ...body, startedBy: "device:abc" })).code).toBe(
      "submission_conflict",
    );
    internals(engine)
      .db.prepare("UPDATE prompt_submissions SET response = NULL WHERE id = ?")
      .run(submissionId);
    const uncertain = refusal(() => engine.execution.startPrompt(body));
    expect([uncertain.statusCode, uncertain.code]).toEqual([409, "submission_uncertain"]);
    expect(rowCount(engine, "runs")).toBe(1);
  });

  it("C18 a refusal after the reservation releases the submissionId", async () => {
    const engine = buildEngine([echoProvider()], { profile: "read_only" });
    const submissionId = uuid();
    expect(refusal(() => parked(engine, { submissionId })).code).toBe("profile_refused");
    expect(rowCount(engine, "prompt_submissions")).toBe(0);
    const { runId } = engine.execution.startPrompt({ prompt: "now read", submissionId, startedBy: null });
    expect((await engine.execution.wait(runId)).status).toBe("done");
  });

  it("C19 startSkill refuses a missing, disabled, unlisted, incomplete or over-budget skill", () => {
    const home = tempHome();
    writeSkill(home, "off", skillFront("off", "enabled: false"));
    writeSkill(
      home,
      "needs-input",
      skillFront("needs-input", "inputs:\n  - name: topic\n    label: Topic\n    required: true"),
    );
    writeSkill(home, "echo-only", skillFront("echo-only"));
    writeSkill(home, "budgeted", skillFront("budgeted", "budgetUsd: 1"));
    const engine = buildEngine([echoProvider(), echoProvider({ id: "echo2" })], { home });
    const spent = internals(engine).runs.create({
      origin: "skill",
      provider: "echo",
      prompt: "(skill: budgeted)",
      cwd: internals(engine).runs.defaultCwd(),
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 60_000,
      profile: "read_only",
      skillSlug: "budgeted",
      startedBy: null,
    });
    internals(engine)
      .db.prepare("UPDATE runs SET status = 'done', cost_usd = 1.5 WHERE id = ?")
      .run(spent.id);
    const before = rowCount(engine, "runs");
    const table: Array<[string, Record<string, unknown>, number, string | undefined]> = [
      ["missing", { slug: "nope" }, 404, undefined],
      ["disabled", { slug: "off" }, 400, undefined],
      ["unlisted provider", { slug: "echo-only", provider: "echo2" }, 400, undefined],
      ["blank input", { slug: "needs-input", inputs: { topic: "  " } }, 400, undefined],
      ["budget", { slug: "budgeted" }, 409, "budget_exhausted"],
    ];
    for (const [label, input, statusCode, code] of table) {
      const error = refusal(() => engine.execution.startSkill({ startedBy: null, ...input } as never));
      expect([error.statusCode, error.code], label).toEqual([statusCode, code]);
    }
    expect(rowCount(engine, "runs")).toBe(before);
  });

  it("C20 a write skill is parked under review_before_write, a read skill runs with the engine's prompt", async () => {
    const home = tempHome();
    writeSkill(home, "writer", skillFront("writer", "mode: write"));
    writeSkill(home, "reader", skillFront("reader"), "# Reader\n\nRead {{topic}}.\n");
    const echo = echoProvider();
    const engine = buildEngine([echo], { home, profile: "review_before_write" });
    const writer = engine.execution.startSkill({ slug: "writer", startedBy: null });
    expect(writer.status).toBe("waiting_approval");
    expect(writer.pendingApproval?.kind).toBe("write_run");
    const reader = engine.execution.startSkill({
      slug: "reader",
      inputs: { topic: "tides" },
      startedBy: null,
    });
    expect(reader.status).toBe("queued");
    await engine.execution.wait(reader.runId);
    const skill = internals(engine).skills.load("reader")!;
    const expected = internals(engine).skills.buildRunPrompt(
      skill,
      { topic: "tides" },
      path.join(internals(engine).paths.artifacts, reader.runId),
    );
    expect(echo.state.runs[0]?.prompt).toBe(expected);
  });

  it("C21 retry repeats the retained request once per submissionId and asker", async () => {
    const home = tempHome();
    writeSkill(home, "say-hi", skillFront("say-hi"));
    const echo = echoProvider();
    const engine = buildEngine([echo], { home });
    const first = engine.execution.startPrompt({ prompt: "again please", model: "m-1", startedBy: "owner" });
    await engine.execution.wait(first.runId);
    const submissionId = uuid();
    const repeated = engine.execution.retry(first.runId, { submissionId, startedBy: "owner" });
    await engine.execution.wait(repeated.runId);
    const a = engine.execution.get(first.runId)!;
    const b = engine.execution.get(repeated.runId)!;
    expect(b.id).not.toBe(a.id);
    expect(b.parentRunId).toBe(a.id);
    expect([b.promptSummary, b.provider, b.model, b.effort, b.cwd, b.timeoutMs]).toEqual([
      a.promptSummary,
      a.provider,
      a.model,
      a.effort,
      a.cwd,
      a.timeoutMs,
    ]);
    expect(engine.execution.retry(first.runId, { submissionId, startedBy: "owner" })).toEqual(repeated);
    expect(
      refusal(() => engine.execution.retry(first.runId, { submissionId, startedBy: "device:abc" })).code,
    ).toBe("submission_conflict");
    // Without a retained request, and with the skill gone.
    internals(engine).db.prepare("UPDATE runs SET request_json = NULL WHERE id = ?").run(first.runId);
    const noRequest = refusal(() =>
      engine.execution.retry(first.runId, { submissionId: uuid(), startedBy: "owner" }),
    );
    expect([noRequest.statusCode, noRequest.code]).toEqual([409, "request_unavailable"]);
    const skillRun = engine.execution.startSkill({ slug: "say-hi", startedBy: "owner" });
    await engine.execution.wait(skillRun.runId);
    fs.rmSync(path.join(home, "skills", "say-hi"), { recursive: true });
    const gone = refusal(() =>
      engine.execution.retry(skillRun.runId, { submissionId: uuid(), startedBy: "owner" }),
    );
    expect([gone.statusCode, gone.code]).toEqual([409, "skill_unavailable"]);
  });

  it("C22 an approval past its time is expired, refused 409, and the run it gated is cancelled", async () => {
    const engine = buildEngine([echoProvider()], { profile: "review_before_write" });
    engine.updateSettings({ limits: { approvalTtlDays: 1 } });
    const started = parked(engine);
    internals(engine)
      .db.prepare("UPDATE approvals SET created_at = created_at - ? WHERE id = ?")
      .run(2 * 86_400_000, started.pendingApproval!.id);
    const error = await engine.execution
      .resolveApproval(started.pendingApproval!.id, "approved", "owner")
      .catch((e: MordomoError) => e);
    expect((error as MordomoError).statusCode).toBe(409);
    await until(
      () => engine.execution.get(started.runId)?.status === "cancelled",
      "the gated run to be cancelled",
    );
  });

  it("C23 smokeTest passes only when the run is done and the provider said MORDOMO_OK", async () => {
    const home = tempHome();
    const good = buildEngine([echoProvider()], { home });
    const result = await good.execution.smokeTest("echo", null);
    expect(result.passed).toBe(true);
    expect(result.run.status).toBe("done");
    expect(result.run.cwd).toBe(fs.realpathSync(path.join(home, "workspace")));
    const odd = buildEngine([echoProvider({ reply: "something else" })]);
    const other = await odd.execution.smokeTest("echo", null);
    expect([other.run.status, other.passed]).toEqual(["done", false]);
  });

  it("C24 a continued conversation keeps its provider and working folder, and an unknown one is refused 404", async () => {
    const home = tempHome();
    const folder = tempHome("mordomo-sdk-granted-");
    const engine = buildEngine([echoProvider(), echoProvider({ id: "echo2" })], { home });
    engine.updateSettings({ indexedFolders: [{ path: folder, enabled: true, area: null }] });
    const first = engine.execution.startPrompt({
      prompt: "one",
      provider: "echo2",
      cwd: folder,
      startedBy: null,
    });
    await engine.execution.wait(first.runId);
    const next = engine.execution.startPrompt({
      prompt: "two",
      sessionId: first.sessionId!,
      startedBy: null,
    });
    expect(next.sessionId).toBe(first.sessionId);
    await engine.execution.wait(next.runId);
    const run = engine.execution.get(next.runId)!;
    expect([run.provider, run.cwd]).toEqual(["echo2", fs.realpathSync(folder)]);
    const runs = rowCount(engine, "runs");
    const error = refusal(() =>
      engine.execution.startPrompt({ prompt: "three", sessionId: uuid(), startedBy: null }),
    );
    expect(error.statusCode).toBe(404);
    expect(rowCount(engine, "runs")).toBe(runs);
  });

  it("C25 parentRunId is recorded on the new run", async () => {
    const engine = buildEngine([echoProvider()]);
    const parent = engine.execution.startPrompt({ prompt: "parent", startedBy: null });
    await engine.execution.wait(parent.runId);
    const child = engine.execution.startPrompt({
      prompt: "child",
      parentRunId: parent.runId,
      startedBy: null,
    });
    await engine.execution.wait(child.runId);
    expect(engine.execution.get(child.runId)?.parentRunId).toBe(parent.runId);
  });

  it("C26 a workspace that is a file is refused 409 workspace_unavailable and creates nothing", () => {
    const home = tempHome();
    const engine = buildEngine([echoProvider()], { home });
    fs.rmSync(path.join(home, "workspace"), { recursive: true, force: true });
    fs.writeFileSync(path.join(home, "workspace"), "in the way");
    const error = refusal(() => engine.execution.startPrompt({ prompt: "hi", startedBy: null }));
    expect([error.statusCode, error.code]).toEqual([409, "workspace_unavailable"]);
    emptyOf(engine);
  });

  it("C27 pendingApprovals lists only the approvals that wait", async () => {
    const engine = buildEngine([echoProvider()], { profile: "review_before_write" });
    engine.updateSettings({ limits: { approvalTtlDays: 1 } });
    const [approved, denied, expired, waiting] = [1, 2, 3, 4].map((n) =>
      parked(engine, { prompt: `change ${n}` }),
    );
    await engine.execution.resolveApproval(approved!.pendingApproval!.id, "approved", "owner");
    await engine.execution.resolveApproval(denied!.pendingApproval!.id, "denied", "owner");
    internals(engine)
      .db.prepare("UPDATE approvals SET created_at = created_at - ? WHERE id = ?")
      .run(2 * 86_400_000, expired!.pendingApproval!.id);
    // Resolving anything sweeps the expired ones first.
    await engine.execution
      .resolveApproval(approved!.pendingApproval!.id, "approved", "owner")
      .catch(() => undefined);
    expect(engine.execution.pendingApprovals().map((a) => a.id)).toEqual([waiting!.pendingApproval!.id]);
  });

  it("C51 a provider that throws leaves the run failed and wait resolves it", async () => {
    const echo = echoProvider();
    echo.state.failWith = "boom";
    const engine = buildEngine([echo]);
    let reported = 0;
    const { runId } = engine.execution.startPrompt(
      { prompt: "hi", startedBy: null },
      { onError: () => reported++ },
    );
    const record = await engine.execution.wait(runId);
    expect(record.status).toBe("failed");
    expect(record.error).toContain("boom");
    expect(reported).toBe(0);
  });
});

describe("S6 the facade holds where the first verification attacked it", () => {
  /** Count the listeners an engine's bus has from now on (the engine's own were installed when it was built). */
  function countListeners(engine: Engine): () => number {
    const bus = internals(engine).events;
    const subscribe = bus.subscribe.bind(bus);
    let live = 0;
    bus.subscribe = (listener) => {
      live += 1;
      const off = subscribe(listener);
      let once = true;
      return () => {
        if (once) live -= 1;
        once = false;
        return off();
      };
    };
    return () => live;
  }

  const orphanRun = (engine: Engine) => {
    const inner = internals(engine);
    const run = inner.runs.create({
      origin: "manual",
      provider: "echo",
      prompt: "left behind",
      cwd: inner.runs.defaultCwd(),
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 60_000,
      profile: "read_only",
      startedBy: null,
    });
    inner.db
      .prepare("UPDATE runs SET status = 'running', started_at = ? WHERE id = ?")
      .run(Date.now(), run.id);
    return run.id;
  };

  it("C52 wait resolves a run that has already ended, refuses an unknown one, and leaves no listener behind", async () => {
    const echo = echoProvider();
    const engine = buildEngine([echo]);
    const listeners = countListeners(engine);
    const { runId } = engine.execution.startPrompt({ prompt: "hi", startedBy: null });
    const during = await engine.execution.wait(runId);
    expect(during.status).toBe("done");
    expect(listeners()).toBe(0);
    // Asked again after the end: the run is already terminal, and nothing will announce it a second time.
    const after = await Promise.race([
      engine.execution.wait(runId),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("wait never resolved")), 1500)),
    ]);
    expect(after).toEqual(during);
    expect(listeners()).toBe(0);
    const unknown = await engine.execution.wait(uuid()).catch((e: MordomoError) => e);
    expect([(unknown as MordomoError).statusCode]).toEqual([404]);
    expect(listeners()).toBe(0);
    // Ended by the signal while the run goes on.
    echo.state.hold = true;
    const held = engine.execution.startPrompt({ prompt: "slow", startedBy: null });
    await until(() => echo.state.calls === 2, "the provider to start");
    const abort = new AbortController();
    const waiting = engine.execution.wait(held.runId, { signal: abort.signal });
    expect(listeners()).toBe(1);
    abort.abort(new Error("enough"));
    await expect(waiting).rejects.toThrow("enough");
    expect(listeners()).toBe(0);
    echo.state.release();
    await engine.execution.wait(held.runId);
  });

  it("C53 wait ends for a run that the recovery of a restart marks interrupted", async () => {
    const engine = buildEngine([echoProvider()]);
    const orphan = orphanRun(engine);
    const waiting = engine.execution.wait(orphan);
    const announced: Array<{ runId: string; status: string }> = [];
    engine.events.subscribe((event) => {
      if (event.type === "run.finished") announced.push(event.payload as never);
    });
    expect(internals(engine).runs.recoverInterrupted()).toBe(1);
    const record = await Promise.race([
      waiting,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("wait never resolved")), 1500)),
    ]);
    expect(record.status).toBe("interrupted");
    expect(announced).toEqual([expect.objectContaining({ runId: orphan, status: "interrupted" })]);
  });

  it("C54 a retry of a retry stays in the first run's lineage and keeps what the run was asked to do", async () => {
    const home = tempHome();
    writeSkill(home, "say-hi", skillFront("say-hi"));
    const echo = echoProvider();
    const engine = buildEngine([echo], { home, profile: "controlled_write" });
    const retry = async (of: string, by: string | null = "owner") => {
      const again = engine.execution.retry(of, { submissionId: uuid(), startedBy: by });
      await engine.execution.wait(again.runId);
      return again.runId;
    };
    const first = engine.execution.startPrompt({
      prompt: "edit the file",
      mode: "write",
      startedBy: "owner",
    });
    await engine.execution.wait(first.runId);
    const second = await retry(first.runId);
    const third = await retry(second);
    expect(engine.execution.get(second)?.parentRunId).toBe(first.runId);
    expect(engine.execution.get(third)?.parentRunId).toBe(first.runId);
    // The mode is the retained request's: a write stays a write (the provider is handed it, and so is the record).
    for (const id of [first.runId, second, third]) {
      expect(engine.execution.get(id)?.request, id).toMatchObject({ kind: "prompt", mode: "write" });
    }
    expect(echo.state.runs.map((run) => run.mode)).toEqual(["write", "write", "write"]);

    const skill = engine.execution.startSkill({ slug: "say-hi", startedBy: "owner" });
    await engine.execution.wait(skill.runId);
    const skillSecond = await retry(skill.runId);
    const skillThird = await retry(skillSecond);
    expect(engine.execution.get(skillSecond)?.parentRunId).toBe(skill.runId);
    expect(engine.execution.get(skillThird)?.parentRunId).toBe(skill.runId);
  });

  it("C55 a retry by the program is recorded as the program's, and a failed retry gives its submissionId back", async () => {
    const engine = buildEngine([echoProvider()], { profile: "controlled_write" });
    const first = engine.execution.startPrompt({ prompt: "edit", mode: "write", startedBy: "owner" });
    await engine.execution.wait(first.runId);
    const receipt = (id: string) =>
      internals(engine).db.prepare("SELECT requested_by FROM run_action_receipts WHERE id = ?").get(id) as
        { requested_by: string | null } | undefined;
    const byProgram = uuid();
    const repeated = engine.execution.retry(first.runId, { submissionId: byProgram, startedBy: null });
    await engine.execution.wait(repeated.runId);
    expect(receipt(byProgram)?.requested_by).toBe("program");
    expect(engine.execution.retry(first.runId, { submissionId: byProgram, startedBy: null })).toEqual(
      repeated,
    );
    expect(
      refusal(() => engine.execution.retry(first.runId, { submissionId: byProgram, startedBy: "owner" }))
        .code,
    ).toBe("submission_conflict");
    const byOwner = uuid();
    const owned = engine.execution.retry(first.runId, { submissionId: byOwner, startedBy: "owner" });
    await engine.execution.wait(owned.runId);
    expect(receipt(byOwner)?.requested_by).toBe("owner");

    // A retry the rules refuse leaves no receipt: the same submissionId is free for the retry that works.
    const refusedId = uuid();
    engine.updateSettings({ securityProfile: "read_only" });
    const before = rowCount(engine, "run_action_receipts");
    expect(
      refusal(() => engine.execution.retry(first.runId, { submissionId: refusedId, startedBy: "owner" }))
        .code,
    ).toBe("profile_refused");
    expect(receipt(refusedId)).toBeUndefined();
    expect(rowCount(engine, "run_action_receipts")).toBe(before);
    engine.updateSettings({ securityProfile: "controlled_write" });
    const later = engine.execution.retry(first.runId, { submissionId: refusedId, startedBy: "owner" });
    await engine.execution.wait(later.runId);
    expect(receipt(refusedId)?.requested_by).toBe("owner");
  });

  it("C56 who asked cannot be left out at run time, and the names of the program are not names of anyone", () => {
    const home = tempHome();
    writeSkill(home, "say-hi", skillFront("say-hi"));
    const engine = buildEngine([echoProvider()], { home });
    const id = uuid();
    const attempts: Array<[string, () => unknown]> = [
      ["prompt without startedBy", () => engine.execution.startPrompt({ prompt: "hi" } as never)],
      ["skill without startedBy", () => engine.execution.startSkill({ slug: "say-hi" } as never)],
      ["retry without startedBy", () => engine.execution.retry(id, { submissionId: uuid() } as never)],
      [
        "prompt as undefined",
        () => engine.execution.startPrompt({ prompt: "hi", startedBy: undefined } as never),
      ],
      ["prompt as an empty name", () => engine.execution.startPrompt({ prompt: "hi", startedBy: "" })],
      ["prompt as 'null'", () => engine.execution.startPrompt({ prompt: "hi", startedBy: "null" })],
      ["prompt as 'program'", () => engine.execution.startPrompt({ prompt: "hi", startedBy: "program" })],
      ["skill as 'program'", () => engine.execution.startSkill({ slug: "say-hi", startedBy: "program" })],
      ["retry as 'null'", () => engine.execution.retry(id, { submissionId: uuid(), startedBy: "null" })],
    ];
    for (const [label, call] of attempts) expect(call, label).toThrow(ZodError);
    emptyOf(engine);
  });

  it("C57 a provider that confines no write is parked unless the profile is approved_automation", async () => {
    const table: Array<[SecurityProfile, "broker" | "none", "waiting_approval" | "queued"]> = [
      ["controlled_write", "broker", "queued"],
      ["controlled_write", "none", "waiting_approval"],
      ["approved_automation", "none", "queued"],
      ["review_before_write", "none", "waiting_approval"],
    ];
    for (const [profile, writeConfinement, expected] of table) {
      const echo = echoProvider({ writeConfinement });
      const engine = buildEngine([echo], { profile });
      const started = parked(engine, { startedBy: "owner" });
      expect(started.status, `${profile} / ${writeConfinement}`).toBe(expected);
      if (expected === "queued") await engine.execution.wait(started.runId);
      else expect(echo.state.calls, `${profile} / ${writeConfinement}`).toBe(0);
    }
  });

  it("C58 the daily budget of a skill refuses when it is spent to the cent, and caps the run with what is left", async () => {
    const home = tempHome();
    writeSkill(home, "budgeted", skillFront("budgeted", "budgetUsd: 1"));
    const engine = buildEngine([echoProvider()], { home });
    const inner = internals(engine);
    const spend = (usd: number) => {
      const run = inner.runs.create({
        origin: "skill",
        provider: "echo",
        prompt: "(skill: budgeted)",
        cwd: inner.runs.defaultCwd(),
        model: null,
        effort: "default",
        mode: "read_only",
        timeoutMs: 60_000,
        profile: "read_only",
        skillSlug: "budgeted",
        startedBy: null,
      });
      inner.db.prepare("UPDATE runs SET status = 'done', cost_usd = ? WHERE id = ?").run(usd, run.id);
    };
    spend(0.75);
    const started = engine.execution.startSkill({ slug: "budgeted", startedBy: null });
    await engine.execution.wait(started.runId);
    expect(engine.execution.get(started.runId)?.maxCostUsd).toBeCloseTo(0.25, 5);
    // Spent to the cent: 0.75 and the 0.25 of the run just made.
    inner.db.prepare("UPDATE runs SET cost_usd = 0.25 WHERE id = ?").run(started.runId);
    const error = refusal(() => engine.execution.startSkill({ slug: "budgeted", startedBy: null }));
    expect([error.statusCode, error.code]).toEqual([409, "budget_exhausted"]);
    inner.db.prepare("UPDATE runs SET cost_usd = 0.2 WHERE id = ?").run(started.runId);
    const left = engine.execution.startSkill({ slug: "budgeted", startedBy: null });
    await engine.execution.wait(left.runId);
    expect(engine.execution.get(left.runId)?.maxCostUsd).toBeCloseTo(0.05, 5);
  });

  it("C59 resolveApproval announces the decision on the bus, with the run it launched", async () => {
    const engine = buildEngine([echoProvider()], { profile: "review_before_write" });
    const heard: Array<Record<string, unknown>> = [];
    engine.events.subscribe((event) => {
      if (event.type === "approval.resolved") heard.push(event.payload as never);
    });
    const approved = parked(engine, { prompt: "change one" });
    const denied = parked(engine, { prompt: "change two" });
    await engine.execution.resolveApproval(approved.pendingApproval!.id, "approved", "owner");
    await engine.execution.resolveApproval(denied.pendingApproval!.id, "denied", "owner");
    await engine.execution.wait(approved.runId);
    expect(heard).toEqual([
      { id: approved.pendingApproval!.id, kind: "write_run", status: "approved", runId: approved.runId },
      { id: denied.pendingApproval!.id, kind: "write_run", status: "denied", runId: null },
    ]);
  });

  it("C60 an approval that was decided or that expired is refused with a MordomoError and a stable code", async () => {
    const engine = buildEngine([echoProvider()], { profile: "review_before_write" });
    engine.updateSettings({ limits: { approvalTtlDays: 1 } });
    const decided = parked(engine, { prompt: "change one" });
    await engine.execution.resolveApproval(decided.pendingApproval!.id, "approved", "owner");
    const again = await engine.execution
      .resolveApproval(decided.pendingApproval!.id, "approved", "owner")
      .catch((e: unknown) => e);
    expect(again).toBeInstanceOf(MordomoError);
    expect([(again as MordomoError).statusCode, (again as MordomoError).code]).toEqual([
      409,
      "approval_resolved",
    ]);

    const age = (id: string) =>
      internals(engine)
        .db.prepare("UPDATE approvals SET created_at = created_at - ? WHERE id = ?")
        .run(2 * 86_400_000, id);
    // Past its time and swept by the call: it is expired, and said so.
    const late = parked(engine, { prompt: "change two" });
    age(late.pendingApproval!.id);
    const expired = await engine.execution
      .resolveApproval(late.pendingApproval!.id, "approved", "owner")
      .catch((e: unknown) => e);
    expect(expired).toBeInstanceOf(MordomoError);
    expect([(expired as MordomoError).statusCode, (expired as MordomoError).code]).toEqual([
      409,
      "approval_expired",
    ]);
    // Past its time and not yet swept: the store itself refuses the same way.
    const unswept = parked(engine, { prompt: "change three" });
    age(unswept.pendingApproval!.id);
    const direct = refusal(() =>
      internals(engine).approvals.resolve(unswept.pendingApproval!.id, "approved"),
    );
    expect([direct.statusCode, direct.code]).toEqual([409, "approval_expired"]);
  });
  it("C65 cancel keeps the reason it was given, for a parked run and for one in progress", async () => {
    const echo = echoProvider();
    echo.state.hold = true;
    const engine = buildEngine([echo], { profile: "controlled_write" });
    const waiting = parked(engine, { startedBy: "device:abc" });
    expect(waiting.status).toBe("waiting_approval");
    expect(await engine.execution.cancel(waiting.runId, "the owner changed their mind")).toBe(true);
    const record = engine.execution.get(waiting.runId)!;
    expect([record.status, record.error]).toEqual(["cancelled", "the owner changed their mind"]);

    const running = engine.execution.startPrompt({ prompt: "slow", startedBy: null });
    await until(() => echo.state.calls === 1, "the provider to start");
    expect(await engine.execution.cancel(running.runId, "taking too long")).toBe(true);
    await engine.execution.wait(running.runId);
    const noted = engine.execution
      .events(running.runId)
      .some(({ event }) => event.type === "permission" && event.detail === "taking too long");
    expect(noted).toBe(true);
  });
  it("C69 every way the library starts a run takes the setting's default timeout as it is, above the cap on a request", async () => {
    // `limits.defaultTimeoutMs` has a floor only, so two hours is a value the owner may have chosen; the cap of
    // 3 600 000 belongs to the `timeoutMs` a caller asks for. A clamp in any one of these paths brings the round 1
    // regression back in a sibling of the route that was fixed.
    const home = tempHome();
    writeSkill(home, "say-hi", skillFront("say-hi"));
    const engine = buildEngine([echoProvider()], { home });
    engine.updateSettings({ limits: { defaultTimeoutMs: 7_200_000 } });
    const timeoutOf = async (runId: string) => {
      await engine.execution.wait(runId);
      return engine.execution.get(runId)?.timeoutMs;
    };
    const prompt = engine.execution.startPrompt({ prompt: "hi", startedBy: null });
    const skill = engine.execution.startSkill({ slug: "say-hi", startedBy: null });
    expect(await timeoutOf(prompt.runId)).toBe(7_200_000);
    expect(await timeoutOf(skill.runId)).toBe(7_200_000);
    // The retry copies what the source recorded...
    const retryOf = (source: string) =>
      engine.execution.retry(source, { submissionId: uuid(), startedBy: null }).runId;
    expect(await timeoutOf(retryOf(prompt.runId))).toBe(7_200_000);
    expect(await timeoutOf(retryOf(skill.runId))).toBe(7_200_000);
    // ...and takes the default for a source that recorded none.
    internals(engine).db.prepare("UPDATE runs SET timeout_ms = NULL").run();
    expect(await timeoutOf(retryOf(prompt.runId))).toBe(7_200_000);
    expect(await timeoutOf(retryOf(skill.runId))).toBe(7_200_000);
    // What a caller asks for stays held to the range.
    expect(() =>
      engine.execution.startSkill({ slug: "say-hi", timeoutMs: 3_600_001, startedBy: null }),
    ).toThrow(ZodError);
  });
  it("C72 a step whose run was running when the process died is blocked with the effects still uncertain, and the restart says so with the run's own words", () => {
    // AD-022 e: the recovery now settles the run like any other end, so the step is synchronized from the run
    // (`Interrupted by service restart`) after `objectives.recover` marked it; the base left the first words.
    const engine = buildEngine([echoProvider()]);
    const inner = internals(engine);
    const objective = inner.objectives.create({
      title: "Interrupted",
      steps: [{ title: "Step", request: { version: 1, kind: "prompt", prompt: "do it", mode: "read_only" } }],
    });
    const runId = orphanRun(engine);
    const stepId = objective.steps[0]!.id;
    inner.objectives.markDispatched(stepId, runId);
    const announced: string[] = [];
    engine.events.subscribe((event) => {
      if (event.type === "objective.changed") announced.push(String(event.payload.status));
    });
    engine.start();
    const row = inner.db
      .prepare(
        "SELECT status, blocked_reason, next_action, effects_uncertain FROM objective_steps WHERE id = ?",
      )
      .get(stepId);
    expect(row).toEqual({
      status: "blocked",
      blocked_reason: "Interrupted by service restart",
      next_action: "Reconcile workspace effects before retrying",
      effects_uncertain: 1,
    });
    // One `objective.changed`, from the synchronization of the run that ended; the recovery of the step announced none.
    expect(announced).toEqual(["blocked"]);
  });
});
