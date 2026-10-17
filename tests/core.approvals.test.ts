import { afterEach, describe, expect, it } from "vitest";
import { ApprovalStore, openDb } from "../core/src/internal.js";
import { makeTempHome } from "./helpers.js";

describe("approval store", () => {
  let cleanup = () => undefined as void;
  afterEach(() => cleanup());

  it("keeps the answers to a question the agent asked with the decision", () => {
    const home = makeTempHome();
    cleanup = home.cleanup;
    const { db } = openDb(home.paths);
    const store = new ApprovalStore(db);
    const a = store.request("tool_use", "AskUserQuestion: Por onde?", {
      runId: "r1",
      toolName: "AskUserQuestion",
      input: { questions: [{ question: "Por onde?" }] },
    });
    const resolved = store.resolve(a.id, "approved", { answers: { "Por onde?": "Testes" } });
    expect(resolved?.status).toBe("approved");
    expect(resolved?.payload).toMatchObject({ runId: "r1", answers: { "Por onde?": "Testes" } });
    db.close();
  });

  it("resolves without touching the payload when there is nothing to add", () => {
    const home = makeTempHome();
    cleanup = home.cleanup;
    const { db } = openDb(home.paths);
    const store = new ApprovalStore(db);
    const a = store.request("tool_use", "Bash: ls", { runId: "r2" });
    expect(store.resolve(a.id, "denied")?.payload).toEqual({ runId: "r2" });
    db.close();
  });
});
