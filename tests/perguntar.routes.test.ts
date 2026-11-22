import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { askWorld, paragraph, threeNotes, type AskWorld, type Json } from "./helpers/perguntarWorld.js";

/**
 * .specs/features/cerebro-perguntar, batch A, S1, S3 and S4 at the boundary: `POST /api/memory/ask`, `GET
 * /api/memory/ask` and `GET /api/memory/ask/:id` through `app.inject` against `buildServer` over a real home whose
 * Claude provider is the fake CLI; the test writes what the run leaves in `artifacts/<run>/answer.json` (the C6b
 * precedent). The answer's rules at their own layer are `perguntar.layer.test.ts`.
 */

let seq = 0;
afterAll(() => {
  vi.restoreAllMocks();
});

async function fresh<T>(fn: (world: AskWorld) => Promise<T>): Promise<T> {
  const world = await askWorld(`mordomo-perguntar-routes-${++seq}-`);
  try {
    return await fn(world);
  } finally {
    await world.close();
  }
}

const QUESTION = "O que decidi sobre o onboarding?";
const direct = (extra: Json = {}): Json => ({
  question: QUESTION,
  mode: "direct",
  scope: { kind: "all" },
  ...extra,
});
const TAKE = "Acho que o onboarding deveria ser mais curto.";
const reasonFirst = (extra: Json = {}): Json => ({
  question: QUESTION,
  mode: "reason_first",
  take: TAKE,
  scope: { kind: "all" },
  ...extra,
});
const errorCode = (r: { body: Json }) => r.body?.error?.code as string | undefined;
const statusAndCode = (r: { status: number; body: Json }) => [r.status, errorCode(r)];
const uuid = () => crypto.randomUUID();

/** Ask, wait for the run, and read the ask back. */
async function askAndRead(w: AskWorld, body: Json, content: unknown): Promise<Json> {
  w.answer(content);
  const res = await w.ask(body);
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  await w.settle(res.body.id);
  const read = await w.read(res.body.id);
  expect(read.status, JSON.stringify(read.body)).toBe(200);
  return read.body;
}

describe("C1 an ask starts one read-only run of brain-ask", () => {
  it("C1 POST /api/memory/ask answers 202 with exactly { status: running, id }, id the runId of the one new run of brain-ask, read_only, started by the owner", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      const before = w.ctx.runs.list({ limit: 100 }).map((r) => r.id);
      const res = await w.ask(direct());
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      expect(Object.keys(res.body).sort()).toEqual(["id", "status"]);
      expect(res.body.status).toBe("running");
      const added = w.ctx.runs.list({ limit: 100 }).filter((r) => !before.includes(r.id));
      expect(added.map((r) => r.id)).toEqual([res.body.id]);
      const run = added[0]!;
      expect(run.skillSlug).toBe("brain-ask");
      expect(run.request?.kind).toBe("skill");
      expect(run.request?.kind === "skill" && run.request.skillSlug).toBe("brain-ask");
      expect(run.request?.mode).toBe("read_only");
      expect(run.startedBy).toBe("owner");
      await w.settle(res.body.id);
    });
  });
});

describe("C2 the run's five inputs", () => {
  it("C2 question (trimmed), mode, take empty, scope all and sources as `## <path> § <section>` then the excerpt, in the recall's order, holding onboarding.md § Decisão", async () => {
    await fresh(async (w) => {
      const { onboarding } = await threeNotes(w);
      const res = await w.ask(direct({ question: `  ${QUESTION}  ` }));
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      const run = w.ctx.runs.get(res.body.id)!;
      const inputs = run.request?.kind === "skill" ? run.request.inputs : {};
      expect(Object.keys(inputs).sort()).toEqual(["mode", "question", "scope", "sources", "take"]);
      expect(inputs.question).toBe(QUESTION);
      expect(inputs.mode).toBe("direct");
      expect(inputs.take).toBe("");
      expect(inputs.scope).toBe("all");
      // the recall's sections, in its order, each as its heading line and its excerpt
      const recall = (
        await w.call("GET", `/api/memory/recall?q=${encodeURIComponent(QUESTION)}&record=false`)
      ).body as Json;
      const expected = (recall.answerContext as Json[])
        .map((c) => `## ${c.path} § ${c.section}\n${c.excerpt}`)
        .join("\n\n");
      expect(expected).not.toBe("");
      expect(inputs.sources).toBe(expected);
      expect(inputs.sources).toContain(`## ${onboarding} § Decisão\n`);
      await w.settle(res.body.id);
    });
  });
});

describe("C9 an answered ask", () => {
  it("C9 a done run with a valid answer of 2 paragraphs reads answered, with question, mode, scope, run and each citation as { path, section, name, fileId }, natureza plano on plano.md only", async () => {
    await fresh(async (w) => {
      const { onboarding, plano } = await threeNotes(w);
      const body = await askAndRead(w, direct(), {
        v: 1,
        paragraphs: [
          paragraph(onboarding, "Decisão"),
          {
            text: "E vai ser revisto em abril.",
            citations: [
              { path: onboarding, section: "Decisão" },
              { path: plano, section: "Próximos passos" },
            ],
          },
        ],
      });
      const id = (p: string) =>
        (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(p) as { id: number }).id;
      expect(body.status).toBe("answered");
      expect(body.question).toBe(QUESTION);
      expect(body.mode).toBe("direct");
      expect(body.scope).toEqual({ kind: "all" });
      expect("take" in body).toBe(false);
      expect(body.run.provider).toBe("claude");
      expect(typeof body.run.startedAt).toBe("number");
      expect(typeof body.run.finishedAt).toBe("number");
      expect(body.answer.paragraphs).toEqual([
        {
          text: "O onboarding dura duas semanas.",
          citations: [
            { path: onboarding, section: "Decisão", name: "onboarding.md", fileId: id(onboarding) },
          ],
        },
        {
          text: "E vai ser revisto em abril.",
          citations: [
            { path: onboarding, section: "Decisão", name: "onboarding.md", fileId: id(onboarding) },
            {
              path: plano,
              section: "Próximos passos",
              name: "plano.md",
              fileId: id(plano),
              natureza: "plano",
            },
          ],
        },
      ]);
      expect("natureza" in body.answer.paragraphs[0].citations[0]).toBe(false);
      expect("provocation" in body.answer).toBe(false);
    });
  });
});

/** Hide `folder` from agents as the owner does (`PUT /api/settings`), and let the pass it starts end. */
async function hideFromAgents(w: AskWorld, folder: string): Promise<void> {
  const res = await w.call("PUT", "/api/settings", {
    folderAccess: [{ path: folder, agents: "hide", devices: "write" }],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  await w.index();
}

describe("C3 the recall abstains: no run", () => {
  it("C3 a question with no word of the index answers 200 abstained no_match, consulted 3, and no run is added", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      const before = w.runCount();
      const res = await w.ask(direct({ question: "xyzzy plugh" }));
      expect([res.status, res.body]).toEqual([
        200,
        { status: "abstained", abstainReason: "no_match", consulted: 3 },
      ]);
      expect(w.runCount()).toBe(before);
    });
  });
  it("C3 keywords that match no section by half, with no vector near enough, answer 200 abstained weak, consulted 3, no run", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      const before = w.runCount();
      const res = await w.ask(direct({ question: "onboarding girafa elefante tucano" }));
      expect([res.status, res.body]).toEqual([
        200,
        { status: "abstained", abstainReason: "weak", consulted: 3 },
      ]);
      expect(w.runCount()).toBe(before);
    });
  });
  it("C3 consulted counts the rows agents may read: 2 after one note's folder is hidden from agents", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      fs.mkdirSync(path.join(w.memory, "notes", "privado"), { recursive: true });
      fs.renameSync(
        path.join(w.memory, "notes", "clientes.md"),
        path.join(w.memory, "notes", "privado", "clientes.md"),
      );
      await w.index();
      expect((await w.ask(direct({ question: "xyzzy plugh" }))).body.consulted).toBe(3);
      await hideFromAgents(w, path.join(w.memory, "notes", "privado"));
      const before = w.runCount();
      const res = await w.ask(direct({ question: "xyzzy plugh" }));
      expect([res.status, res.body]).toEqual([
        200,
        { status: "abstained", abstainReason: "no_match", consulted: 2 },
      ]);
      expect(w.runCount()).toBe(before);
    });
  });
});

describe("C4 the question's bounds after trim", () => {
  const refused = async (w: AskWorld, body: Json) => {
    const before = w.runCount();
    const res = await w.ask(body);
    expect(statusAndCode(res), JSON.stringify(res.body)).toEqual([400, "validation"]);
    expect(w.runCount()).toBe(before);
  };
  const accepted = async (w: AskWorld, question: string) => {
    const res = await w.ask(direct({ question }));
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    await w.settle(res.body.id);
  };
  it("C4 3 characters 202 and 500 characters 202", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      w.note(path.join(w.memory, "notes", "bob.md"), {}, "# Bob\n\n## Bob\n\nBob decidiu.\n");
      await w.index();
      await accepted(w, "Bob");
      const long = "onboarding ".repeat(50).slice(0, 499) + "?";
      expect(long.trim()).toHaveLength(500);
      await accepted(w, long);
    });
  });
  it("C4 2 characters, 501 characters, '  ab  ' and a missing question are each 400 validation, with no run", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      await refused(w, direct({ question: "ab" }));
      await refused(w, direct({ question: "onboarding ".repeat(50).slice(0, 500) + "?" }));
      await refused(w, direct({ question: "  ab  " }));
      const { question: _q, ...missing } = direct();
      await refused(w, missing);
    });
  });
});

describe("C5 one ask at a time", () => {
  for (const status of ["queued", "running", "waiting_approval"]) {
    it(`C5 a brain-ask run in ${status} makes a second POST 409 ask_in_progress, with no run`, async () => {
      await fresh(async (w) => {
        await threeNotes(w);
        w.askRow({ id: uuid(), status, createdAt: Date.now() });
        const before = w.runCount();
        const res = await w.ask(direct());
        expect(statusAndCode(res), JSON.stringify(res.body)).toEqual([409, "ask_in_progress"]);
        expect(w.runCount()).toBe(before);
      });
    });
  }
  for (const status of ["done", "failed", "cancelled"]) {
    it(`C5 with the earlier brain-ask run ${status}, the POST is 202`, async () => {
      await fresh(async (w) => {
        await threeNotes(w);
        w.askRow({ id: uuid(), status, createdAt: Date.now() - 1000, finishedAt: Date.now() });
        const res = await w.ask(direct());
        expect(res.status, JSON.stringify(res.body)).toBe(202);
        await w.settle(res.body.id);
      });
    });
  }
  it("C5 a run of another skill in running does not block: 202", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      w.askRow({ id: uuid(), status: "running", createdAt: Date.now(), skill: "dashboard-answer" });
      const res = await w.ask(direct());
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      await w.settle(res.body.id);
    });
  });
});

describe("C6 the lock survives a restart", () => {
  it("C6 a brain-ask row left running by a closed AppContext makes the POST of a new AppContext over the same home 409 ask_in_progress", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      const first = new AppContext(w.home);
      first.db
        .prepare(
          "INSERT INTO runs (id, created_at, started_at, origin, provider, status, skill_slug) VALUES (?, ?, ?, 'skill', 'claude', 'running', 'brain-ask')",
        )
        .run(uuid(), Date.now(), Date.now());
      first.close();
      const second = new AppContext(w.home);
      const app = await buildServer(second);
      try {
        const before = (second.db.prepare("SELECT COUNT(*) c FROM runs").get() as { c: number }).c;
        const res = await app.inject({
          method: "POST",
          url: "/api/memory/ask",
          headers: { "x-mordomo-token": second.token(), "content-type": "application/json" },
          payload: direct(),
        });
        expect([res.statusCode, res.json().error?.code], res.body).toEqual([409, "ask_in_progress"]);
        expect((second.db.prepare("SELECT COUNT(*) c FROM runs").get() as { c: number }).c).toBe(before);
      } finally {
        await app.close();
        second.close();
      }
    });
  });
});

describe("C7 the skill cannot run", () => {
  const unavailable = async (w: AskWorld) => {
    const before = w.runCount();
    const res = await w.ask(direct());
    expect(statusAndCode(res), JSON.stringify(res.body)).toEqual([409, "skill_unavailable"]);
    expect(w.runCount()).toBe(before);
  };
  it("C7 skills/brain-ask/ removed (enabled and in memorySkills) → 409 skill_unavailable, no run", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      expect(w.ctx.settings().memorySkills).toContain("brain-ask");
      fs.rmSync(path.dirname(w.skillFile()), { recursive: true, force: true });
      await unavailable(w);
    });
  });
  it("C7 the skill with enabled: false (present and in memorySkills) → 409 skill_unavailable, no run", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      const text = fs.readFileSync(w.skillFile(), "utf8");
      fs.writeFileSync(w.skillFile(), text.replace("enabled: true", "enabled: false"));
      expect(w.ctx.skills.load("brain-ask")?.enabled).toBe(false);
      await unavailable(w);
    });
  });
  it("C7 memorySkills without brain-ask (present and enabled) → 409 skill_unavailable, no run", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      w.update((s) => {
        s.memorySkills = ["recall", "consolidate-memory", "organize-brain", "dashboard-answer"];
      });
      expect(w.ctx.skills.load("brain-ask")?.enabled).toBe(true);
      await unavailable(w);
    });
  });
  it("C7 with all three true the same request is 202", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      const res = await w.ask(direct());
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      await w.settle(res.body.id);
    });
  });
  it("C7 the skill's daily budget spent → 409 budget_exhausted, no run", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      const text = fs.readFileSync(w.skillFile(), "utf8");
      fs.writeFileSync(w.skillFile(), text.replace("mode: read_only", "mode: read_only\nbudgetUsd: 0.5"));
      w.ctx.db
        .prepare(
          "INSERT INTO runs (id, created_at, started_at, finished_at, origin, provider, status, duration_ms, skill_slug, cost_usd) VALUES (?, ?, ?, ?, 'skill', 'claude', 'done', 1, 'brain-ask', 0.6)",
        )
        .run(uuid(), Date.now(), Date.now(), Date.now());
      const before = w.runCount();
      const res = await w.ask(direct());
      expect(statusAndCode(res), JSON.stringify(res.body)).toEqual([409, "budget_exhausted"]);
      expect(w.runCount()).toBe(before);
    });
  });
});

describe("C8 who may call the three routes", () => {
  it("C8 through /api and /api/v1: the owner passes; a device with every scope 403 owner_only; a run's rc_ 403 forbidden; no token 401", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      const device = w.device(["content", "monitor", "run", "approve"]);
      const record = w.ctx.runs.create({
        origin: "skill",
        provider: "claude",
        prompt: "held open",
        model: null,
        effort: "default",
        mode: "write",
        timeoutMs: 60_000,
        profile: "controlled_write",
        skillSlug: "organize-brain",
        startedBy: null,
      } as never);
      const token = w.ctx.runApiAccessFor(record, "write")!.token;
      expect(token).toMatch(/^rc_/);
      const run = { "x-mordomo-token": token, "content-type": "application/json" };
      const known = uuid();
      w.askRow({ id: known, status: "done", createdAt: Date.now(), finishedAt: Date.now() });
      for (const prefix of ["/api", "/api/v1"]) {
        const calls: Array<[string, string, unknown]> = [
          ["POST", `${prefix}/memory/ask`, direct({ question: "xyzzy plugh" })],
          ["GET", `${prefix}/memory/ask`, undefined],
          ["GET", `${prefix}/memory/ask/${known}`, undefined],
        ];
        for (const [method, url, body] of calls) {
          const owner = await w.call(method, url, body);
          expect(owner.status, `${method} ${url} ${JSON.stringify(owner.body)}`).toBe(200);
          expect(statusAndCode(await w.call(method, url, body, device)), `${method} ${url}`).toEqual([
            403,
            "owner_only",
          ]);
          expect(statusAndCode(await w.call(method, url, body, run)), `${method} ${url}`).toEqual([
            403,
            "forbidden",
          ]);
          const anonymous = await w.call(method, url, body, { "content-type": "application/json" });
          expect(anonymous.status, `${method} ${url}`).toBe(401);
        }
      }
    });
  });
});

describe("C12 a cited path the index does not have, at the boundary", () => {
  it("C12 GET /api/memory/ask/:id reads refused, with no answer key and the reason naming the paragraph and the path", async () => {
    await fresh(async (w) => {
      const { onboarding } = await threeNotes(w);
      const ghost = path.join(w.memory, "notes", "inventada.md");
      const body = await askAndRead(w, direct(), {
        v: 1,
        paragraphs: [paragraph(onboarding, "Decisão"), paragraph(ghost, "Decisão")],
      });
      expect(body.status).toBe("refused");
      expect("answer" in body).toBe(false);
      expect(body.reason).toBe(`A citação do parágrafo 2 nomeia ${ghost}, que o índice não tem.`);
    });
  });
});

describe("C13 a cited section that is not a heading of the file, at the boundary", () => {
  it("C13 onboarding.md § Decisões is refused naming the file and the section; § Decisão is answered", async () => {
    await fresh(async (w) => {
      const { onboarding } = await threeNotes(w);
      const wrong = await askAndRead(w, direct(), { v: 1, paragraphs: [paragraph(onboarding, "Decisões")] });
      expect(wrong.status).toBe("refused");
      expect("answer" in wrong).toBe(false);
      expect(wrong.reason).toContain(onboarding);
      expect(wrong.reason).toContain('"Decisões"');
      const right = await askAndRead(w, direct(), { v: 1, paragraphs: [paragraph(onboarding, "Decisão")] });
      expect(right.status).toBe("answered");
    });
  });
});

describe("C14 judged on read by today's rules", () => {
  it("C14 an excludes entry added after the answer was written turns an answered ask into refused", async () => {
    await fresh(async (w) => {
      const { onboarding } = await threeNotes(w);
      const body = await askAndRead(w, direct(), { v: 1, paragraphs: [paragraph(onboarding, "Decisão")] });
      expect(body.status).toBe("answered");
      w.update((s) => {
        s.excludes = [...s.excludes, "onboarding.md"];
      });
      const after = (await w.read(body.id)).body;
      expect(after.status).toBe("refused");
      expect(after.reason).toBe(
        `A citação do parágrafo 1 nomeia ${onboarding}, que a política de hoje exclui.`,
      );
      expect("answer" in after).toBe(false);
    });
  });
  it("C14 a folder marked hidden from agents after the answer was written turns an answered ask into refused", async () => {
    await fresh(async (w) => {
      const { onboarding } = await threeNotes(w);
      const body = await askAndRead(w, direct(), { v: 1, paragraphs: [paragraph(onboarding, "Decisão")] });
      expect(body.status).toBe("answered");
      await hideFromAgents(w, path.join(w.memory, "notes"));
      const after = (await w.read(body.id)).body;
      expect(after.status).toBe("refused");
      expect(after.reason).toBe(
        `A citação do parágrafo 1 nomeia ${onboarding}, que está numa pasta escondida dos agentes.`,
      );
      expect("answer" in after).toBe(false);
    });
  });
});

describe("C16 the ends of the run", () => {
  it("C16 a failed run reads failed, A execução terminou em failed., no answer", async () => {
    await fresh(async (w) => {
      const { onboarding } = await threeNotes(w);
      w.failing(true);
      const body = await askAndRead(w, direct(), { v: 1, paragraphs: [paragraph(onboarding, "Decisão")] });
      expect(w.ctx.runs.get(body.id)!.status).toBe("failed");
      expect([body.status, body.reason]).toEqual(["failed", "A execução terminou em failed."]);
      expect("answer" in body).toBe(false);
    });
  });
  it("C16 a cancelled run reads failed, A execução terminou em cancelled., no answer", async () => {
    await fresh(async (w) => {
      const { onboarding } = await threeNotes(w);
      const id = uuid();
      w.askRow({ id, status: "cancelled", createdAt: Date.now() - 1000, finishedAt: Date.now() });
      w.writeAnswer(id, { v: 1, paragraphs: [paragraph(onboarding, "Decisão")] });
      const body = (await w.read(id)).body;
      expect([body.status, body.reason]).toEqual(["failed", "A execução terminou em cancelled."]);
      expect("answer" in body).toBe(false);
    });
  });
  it("C16 a done run with no answer.json reads failed, A execução não escreveu answer.json., no answer", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      const body = await askAndRead(w, direct(), null);
      expect(w.ctx.runs.get(body.id)!.status).toBe("done");
      expect([body.status, body.reason]).toEqual(["failed", "A execução não escreveu answer.json."]);
      expect("answer" in body).toBe(false);
    });
  });
});

describe("C17 an open run reads running", () => {
  for (const status of ["queued", "running", "waiting_approval"]) {
    it(`C17 a run in ${status} reads 200 running with no answer, even with an answer.json already written`, async () => {
      await fresh(async (w) => {
        const { onboarding } = await threeNotes(w);
        const id = uuid();
        w.askRow({ id, status, createdAt: Date.now() });
        w.writeAnswer(id, { v: 1, paragraphs: [paragraph(onboarding, "Decisão")] });
        const res = await w.read(id);
        expect([res.status, res.body.status]).toEqual([200, "running"]);
        expect("answer" in res.body).toBe(false);
        expect("reason" in res.body).toBe(false);
      });
    });
  }
});

describe("C18 an id that is no ask", () => {
  it("C18 404 not_found for an id that is no run and for the runId of a dashboard-answer run", async () => {
    await fresh(async (w) => {
      expect(statusAndCode(await w.read(uuid()))).toEqual([404, "not_found"]);
      const other = uuid();
      w.askRow({
        id: other,
        status: "done",
        createdAt: Date.now(),
        finishedAt: Date.now(),
        skill: "dashboard-answer",
      });
      expect(statusAndCode(await w.read(other))).toEqual([404, "not_found"]);
    });
  });
});

describe("C19 the recent asks", () => {
  const at = (h: number, m: number) => new Date(2026, 10, 22, h, m).getTime();
  it("C19 four brain-ask runs and a recall run: the four, newest first, each with its status as judged today; limit 2 the two newest", async () => {
    await fresh(async (w) => {
      const { onboarding } = await threeNotes(w);
      const inputs = (question: string) => ({
        question,
        mode: "direct",
        take: "",
        scope: "all",
        sources: "",
      });
      w.askRow({
        id: "a0900000-0000-4000-8000-000000000001",
        status: "done",
        createdAt: at(9, 0),
        finishedAt: at(9, 1),
        inputs: inputs("Primeira?"),
      });
      w.writeAnswer("a0900000-0000-4000-8000-000000000001", {
        v: 1,
        paragraphs: [paragraph(onboarding, "Decisão")],
      });
      w.askRow({
        id: "a0910000-0000-4000-8000-000000000002",
        status: "done",
        createdAt: at(9, 10),
        finishedAt: at(9, 11),
        inputs: inputs("Segunda?"),
      });
      w.writeAnswer("a0910000-0000-4000-8000-000000000002", {
        v: 1,
        paragraphs: [paragraph(onboarding, "Decisões")],
      });
      w.askRow({
        id: "a0920000-0000-4000-8000-000000000003",
        status: "failed",
        createdAt: at(9, 20),
        finishedAt: at(9, 21),
        inputs: inputs("Terceira?"),
      });
      w.askRow({
        id: "a0930000-0000-4000-8000-000000000004",
        status: "running",
        createdAt: at(9, 30),
        inputs: inputs("Quarta?"),
      });
      w.askRow({
        id: "a0925000-0000-4000-8000-000000000005",
        status: "done",
        createdAt: at(9, 25),
        finishedAt: at(9, 26),
        skill: "recall",
      });
      const res = await w.list();
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([
        {
          id: "a0930000-0000-4000-8000-000000000004",
          question: "Quarta?",
          mode: "direct",
          scope: { kind: "all" },
          status: "running",
          startedAt: at(9, 30),
        },
        {
          id: "a0920000-0000-4000-8000-000000000003",
          question: "Terceira?",
          mode: "direct",
          scope: { kind: "all" },
          status: "failed",
          startedAt: at(9, 20),
          finishedAt: at(9, 21),
        },
        {
          id: "a0910000-0000-4000-8000-000000000002",
          question: "Segunda?",
          mode: "direct",
          scope: { kind: "all" },
          status: "refused",
          startedAt: at(9, 10),
          finishedAt: at(9, 11),
        },
        {
          id: "a0900000-0000-4000-8000-000000000001",
          question: "Primeira?",
          mode: "direct",
          scope: { kind: "all" },
          status: "answered",
          startedAt: at(9, 0),
          finishedAt: at(9, 1),
        },
      ]);
      const two = await w.list("limit=2");
      expect(two.body.items.map((i: Json) => i.id)).toEqual([
        "a0930000-0000-4000-8000-000000000004",
        "a0920000-0000-4000-8000-000000000003",
      ]);
    });
  });
  it("C19 limit 1 and 100 accepted, 0 and 101 400 validation", async () => {
    await fresh(async (w) => {
      w.askRow({ id: uuid(), status: "failed", createdAt: at(9, 0), finishedAt: at(9, 1) });
      w.askRow({ id: uuid(), status: "failed", createdAt: at(9, 10), finishedAt: at(9, 11) });
      const one = await w.list("limit=1");
      expect([one.status, one.body.items.length]).toEqual([200, 1]);
      const hundred = await w.list("limit=100");
      expect([hundred.status, hundred.body.items.length]).toEqual([200, 2]);
      expect(statusAndCode(await w.list("limit=0"))).toEqual([400, "validation"]);
      expect(statusAndCode(await w.list("limit=101"))).toEqual([400, "validation"]);
    });
  });
  it("C19 with no limit and 31 runs, 30 items; an abstention is not in the list", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      for (let i = 0; i < 31; i++)
        w.askRow({ id: uuid(), status: "failed", createdAt: at(8, i), finishedAt: at(8, i) + 1 });
      expect((await w.list()).body.items).toHaveLength(30);
      expect((await w.list("limit=100")).body.items).toHaveLength(31);
      const abstained = await w.ask(direct({ question: "xyzzy plugh" }));
      expect(abstained.body.status).toBe("abstained");
      expect((await w.list("limit=100")).body.items).toHaveLength(31);
    });
  });
});

describe("C20 what the skill is given is only what agents may read", () => {
  it("C20 a note hidden from agents with every word of the question and a note the policy excludes are in no line of sources; the owner's recall reaches the hidden one", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      const secret = w.note(
        path.join(w.memory, "notes", "privado", "segredo.md"),
        {},
        "# Segredo\n\n## Decidi\n\nO que decidi sobre o onboarding: decidi onboarding onboarding.\n",
      );
      const excluded = w.note(
        path.join(w.memory, "notes", "fora", "excluida.md"),
        {},
        "# Excluída\n\n## Decidi\n\nO que decidi sobre o onboarding: decidi onboarding onboarding.\n",
      );
      await w.index();
      await hideFromAgents(w, path.join(w.memory, "notes", "privado"));
      // the owner's own recall reads the hidden note: what removes it from sources is the audience
      const owner = (await w.call("GET", `/api/memory/recall?q=${encodeURIComponent(QUESTION)}&record=false`))
        .body;
      expect((owner.answerContext as Json[]).map((c) => c.path)).toContain(secret);
      w.update((s) => {
        s.excludes = [...s.excludes, "fora"];
      });
      const res = await w.ask(direct());
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      const run = w.ctx.runs.get(res.body.id)!;
      const sources = run.request?.kind === "skill" ? run.request.inputs.sources! : "";
      expect(sources).toContain("onboarding.md § Decisão");
      for (const line of sources.split("\n")) {
        expect(line).not.toContain(secret);
        expect(line).not.toContain(excluded);
        expect(line).not.toContain("privado");
      }
      await w.settle(res.body.id);
    });
  });
});

describe("C28 the take's bounds", () => {
  const take = (n: number) => "a".repeat(n);
  it("C28 reason_first: 20 and 4000 characters after trim 202", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      for (const n of [20, 4000]) {
        const res = await w.ask(reasonFirst({ take: `  ${take(n)}  ` }));
        expect(res.status, `${n} ${JSON.stringify(res.body)}`).toBe(202);
        await w.settle(res.body.id);
      }
    });
  });
  it("C28 reason_first: 19, 4001 and a missing take each 400 validation; direct: a take of 1 character 400 validation", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      const before = w.runCount();
      for (const body of [
        reasonFirst({ take: take(19) }),
        reasonFirst({ take: `  ${take(19)}  ` }),
        reasonFirst({ take: take(4001) }),
        (({ take: _t, ...rest }) => rest)(reasonFirst()),
        direct({ take: "a" }),
      ]) {
        expect(statusAndCode(await w.ask(body)), JSON.stringify(body).slice(0, 80)).toEqual([
          400,
          "validation",
        ]);
      }
      expect(w.runCount()).toBe(before);
    });
  });
  it("C28 direct: an empty take is accepted as absent (202)", async () => {
    await fresh(async (w) => {
      await threeNotes(w);
      const res = await w.ask(direct({ take: "" }));
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      await w.settle(res.body.id);
    });
  });
});

describe("C29 the take reaches the run and comes back", () => {
  it("C29 a reason_first ask passes the trimmed take and mode reason_first; GET returns the same take; a direct ask has no take key", async () => {
    await fresh(async (w) => {
      const { onboarding } = await threeNotes(w);
      const body = await askAndRead(w, reasonFirst({ take: `  ${TAKE}  ` }), {
        v: 1,
        paragraphs: [paragraph(onboarding, "Decisão")],
        takeFeedback: {
          agrees: [],
          disagrees: [
            { text: "As notas dizem duas semanas.", citations: [{ path: onboarding, section: "Decisão" }] },
          ],
          missing: [],
        },
      });
      const run = w.ctx.runs.get(body.id)!;
      const inputs = run.request?.kind === "skill" ? run.request.inputs : {};
      expect([inputs.take, inputs.mode]).toEqual([TAKE, "reason_first"]);
      expect([body.mode, body.take]).toEqual(["reason_first", TAKE]);
      const plain = await askAndRead(w, direct(), { v: 1, paragraphs: [paragraph(onboarding, "Decisão")] });
      expect(plain.mode).toBe("direct");
      expect("take" in plain).toBe(false);
    });
  });
});

describe("C30 takeFeedback by mode, at the boundary", () => {
  it("C30 reason_first with no takeFeedback reads refused; with one item only in missing reads answered with agrees and disagrees []", async () => {
    await fresh(async (w) => {
      const { onboarding } = await threeNotes(w);
      const none = await askAndRead(w, reasonFirst(), {
        v: 1,
        paragraphs: [paragraph(onboarding, "Decisão")],
      });
      expect(none.status).toBe("refused");
      expect(none.reason).toContain("takeFeedback");
      const item = { text: "Falta o prazo.", citations: [{ path: onboarding, section: "Prazo" }] };
      const one = await askAndRead(w, reasonFirst(), {
        v: 1,
        paragraphs: [paragraph(onboarding, "Decisão")],
        takeFeedback: { missing: [item] },
      });
      expect(one.status, one.reason).toBe("answered");
      expect(one.answer.takeFeedback.agrees).toEqual([]);
      expect(one.answer.takeFeedback.disagrees).toEqual([]);
      expect(one.answer.takeFeedback.missing.map((i: Json) => i.text)).toEqual(["Falta o prazo."]);
    });
  });
  it("C30 direct with a takeFeedback reads refused", async () => {
    await fresh(async (w) => {
      const { onboarding } = await threeNotes(w);
      const item = { text: "Falta o prazo.", citations: [{ path: onboarding, section: "Prazo" }] };
      const body = await askAndRead(w, direct(), {
        v: 1,
        paragraphs: [paragraph(onboarding, "Decisão")],
        takeFeedback: { agrees: [], disagrees: [], missing: [item] },
      });
      expect(body.status).toBe("refused");
      expect(body.reason).toContain("takeFeedback");
    });
  });
});

describe("C34 the provocation's sentences, at the boundary", () => {
  it("C34 a provocation of 2 sentences is answered and one of 3 refused", async () => {
    await fresh(async (w) => {
      const { onboarding, plano } = await threeNotes(w);
      const withProvocation = (text: string) => ({
        v: 1,
        paragraphs: [paragraph(onboarding, "Decisão")],
        provocation: { kind: "complica", text, citation: { path: plano, section: "Próximos passos" } },
      });
      const two = await askAndRead(
        w,
        direct(),
        withProvocation("O plano revisa em abril. Isso muda o prazo."),
      );
      expect(two.status, two.reason).toBe("answered");
      expect(two.answer.provocation.text).toBe("O plano revisa em abril. Isso muda o prazo.");
      const three = await askAndRead(w, direct(), withProvocation("Uma. Duas! Três?"));
      expect(three.status).toBe("refused");
      expect(three.reason).toBe("A provocação tem 3 frases; no máximo 2.");
    });
  });
});

describe("C35 no provocation", () => {
  it("C35 an answer with no provocation is answered and has no answer.provocation key", async () => {
    await fresh(async (w) => {
      const { onboarding } = await threeNotes(w);
      const body = await askAndRead(w, direct(), { v: 1, paragraphs: [paragraph(onboarding, "Decisão")] });
      expect(body.status).toBe("answered");
      expect("provocation" in body.answer).toBe(false);
    });
  });
});
