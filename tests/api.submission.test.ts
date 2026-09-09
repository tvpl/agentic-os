import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";

it("deduplicates concurrent submissions, survives restart and rejects changed payload", async () => {
  const temp = makeTempHome();
  let ctx = new AppContext(temp.paths.home);
  const settings = ctx.settings();
  settings.providers.claude.enabled = true;
  ctx.settingsStore.save(settings);
  let execute = vi.spyOn(ctx.runs, "execute").mockImplementation(async (id) => ctx.runs.get(id)!);
  let app = await buildServer(ctx);
  const submissionId = randomUUID();
  const payload = { submissionId, prompt: "one deliberate action", mode: "read_only" };
  try {
    const send = () =>
      app.inject({ method: "POST", url: "/api/runs", headers: { "x-mordomo-token": ctx.token() }, payload });
    const [first, duplicate] = await Promise.all([send(), send()]);
    expect(first.statusCode).toBe(200);
    expect(duplicate.json()).toEqual(first.json());
    expect(execute).toHaveBeenCalledTimes(1);
    expect(ctx.runs.count({})).toBe(1);
    await app.close();
    ctx.close();
    ctx = new AppContext(temp.paths.home);
    execute = vi.spyOn(ctx.runs, "execute").mockImplementation(async (id) => ctx.runs.get(id)!);
    app = await buildServer(ctx);
    expect((await send()).json()).toEqual(first.json());
    expect(execute).not.toHaveBeenCalled();
    const changed = await app.inject({
      method: "POST",
      url: "/api/runs",
      headers: { "x-mordomo-token": ctx.token() },
      payload: { ...payload, prompt: "another action" },
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error.code).toBe("submission_conflict");
    ctx.db.prepare("UPDATE prompt_submissions SET response = NULL WHERE id = ?").run(submissionId);
    const uncertain = await send();
    expect(uncertain.statusCode).toBe(409);
    expect(uncertain.json().error.code).toBe("submission_uncertain");
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await app.close();
    ctx.close();
    temp.cleanup();
  }
});

it("two approval decisions after reloading pending state dispatch only the parked execution", async () => {
  const temp = makeTempHome();
  const ctx = new AppContext(temp.paths.home);
  const settings = ctx.settings();
  settings.providers.claude.enabled = true;
  settings.securityProfile = "review_before_write";
  ctx.settingsStore.save(settings);
  const execute = vi.spyOn(ctx.runs, "execute").mockImplementation(async (id) => ctx.runs.get(id)!);
  const app = await buildServer(ctx);
  const headers = { "x-mordomo-token": ctx.token() };
  try {
    const created = await app.inject({
      method: "POST",
      url: "/api/runs",
      headers,
      payload: { prompt: "review this write", mode: "write", submissionId: randomUUID() },
    });
    expect(created.statusCode).toBe(202);
    const { pendingApproval, runId } = created.json();
    const pending = await app.inject({ url: "/api/approvals", headers });
    expect(pending.json().some((item: { id: string }) => item.id === pendingApproval.id)).toBe(true);
    const responses = await Promise.all(
      [0, 1].map(() =>
        app.inject({
          method: "POST",
          url: `/api/approvals/${pendingApproval.id}/resolve`,
          headers,
          payload: { decision: "approved" },
        }),
      ),
    );
    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toBe(runId);
    expect(ctx.runs.count({})).toBe(1);
  } finally {
    await app.close();
    ctx.close();
    temp.cleanup();
  }
});
