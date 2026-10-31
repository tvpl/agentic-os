import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SettingsSchema } from "@mordomo/contracts";
import { seedHome } from "@mordomo/core/internal";
import { SkillCatalog } from "../core/src/skills/catalog.js";
import { resolvePaths } from "../core/src/paths.js";
import type * as client from "../core/src/connectors/client.js";
import {
  calendarItems,
  fakeConnectorFetch,
  paineisWorld,
  questionWorld,
  type Json,
  type QuestionWorld,
} from "./helpers/paineisWorld.js";

/**
 * .specs/features/cerebro-paineis, batch B, S4: a question dashboard's refresh starts the `dashboard-answer` skill
 * (AC 51, door 7, amendment 19) and its answer becomes the snapshot only if the host accepts it (AC 52, AC 53), through
 * `app.inject` against `buildServer` over a real home whose Claude provider is the fake CLI; the test writes what the
 * run leaves in `artifacts/<run>/dashboard.json`. The rules at their own layer are `paineis.layer.test.ts` C54 and C55.
 */

vi.mock("../core/src/connectors/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof client>();
  return { ...actual, fetchConnectorData: vi.fn(actual.fetchConnectorData) };
});

const NOW = Date.now();
const repo = path.resolve(import.meta.dirname, "..");
let seq = 0;

beforeAll(() => {
  fakeConnectorFetch(calendarItems(NOW));
});
afterAll(() => {
  vi.restoreAllMocks();
});

async function fresh<T>(fn: (world: QuestionWorld) => Promise<T>): Promise<T> {
  const world = await questionWorld(`mordomo-paineis-question-${++seq}-`);
  try {
    return await fn(world);
  } finally {
    await world.close();
  }
}

const runCount = (w: QuestionWorld) =>
  (w.ctx.db.prepare("SELECT COUNT(*) c FROM runs").get() as { c: number }).c;
const errorCode = (r: { body: Json }) => r.body?.error?.code as string | undefined;

/** A note of `memory/notes/` the answers cite, indexed. */
async function cited(
  w: QuestionWorld,
  name = "onboarding",
  fields: Record<string, string> = {},
): Promise<string> {
  const file = w.note(
    path.join(w.memory, "notes", `${name}.md`),
    fields,
    `# ${name}\n\n## Métricas\n\n18 dias.\n`,
  );
  await w.index();
  return file;
}

/** A valid answer: a kpi and a list, each with one citation of `file`. */
const answer = (file: string): Json => ({
  v: 1,
  widgets: [
    {
      id: "dias",
      kind: "kpi",
      title: "Dias até o valor",
      data: { value: 18 },
      citations: [{ path: file, section: "Métricas" }],
    },
    {
      id: "causas",
      kind: "list",
      title: "Causas",
      data: { items: [{ title: "Contrato demora", path: file }] },
      citations: [{ path: file, section: "Métricas" }],
    },
  ],
});

describe("C52 refresh of a question dashboard starts its skill", () => {
  it("C52 answers 202 with runId; the run is dashboard-answer with the question; GET answers the previous snapshot until the answer is accepted; a second refresh while it runs is 409 refresh_in_progress and starts no run", async () => {
    await fresh(async (w) => {
      const file = await cited(w);
      const question = "Por que o onboarding demora? [[sleep:1]]";
      const created = await w.create({ template: "question", question });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      w.answer(answer(file));

      const first = await w.refresh("pergunta");
      expect(first.status, JSON.stringify(first.body)).toBe(202);
      expect(Object.keys(first.body)).toEqual(["runId"]);
      const run = w.ctx.runs.get(first.body.runId)!;
      expect(run.skillSlug).toBe("dashboard-answer");
      expect((run.request as Json).inputs).toEqual({ question });
      expect(run.contextId ?? null).toBeNull();

      const runs = runCount(w);
      const again = await w.refresh("pergunta");
      expect([again.status, errorCode(again)]).toEqual([409, "refresh_in_progress"]);
      expect(runCount(w)).toBe(runs);
      expect((await w.get("pergunta")).body.snapshot).toBeNull();
      await w.settle("pergunta", first.body.runId);
      const accepted = (await w.get("pergunta")).body.snapshot;
      expect(accepted.sources).toEqual([
        { id: "question", kind: "question", status: "ok", syncedAt: accepted.generatedAt },
      ]);

      const second = await w.refresh("pergunta");
      expect(second.status).toBe(202);
      const during = (await w.get("pergunta")).body.snapshot;
      expect(during.generatedAt).toBe(accepted.generatedAt);
      expect(during).toEqual(accepted);
      await w.settle("pergunta", second.body.runId);
      expect((await w.get("pergunta")).body.snapshot.generatedAt).toBeGreaterThan(accepted.generatedAt);
    });
  });
});

describe("C53 the skill cannot run", () => {
  const unavailable = async (w: QuestionWorld) => {
    const before = runCount(w);
    const listed = (await w.call("GET", "/api/runs")).body;
    const res = await w.refresh("pergunta");
    expect([res.status, errorCode(res)], JSON.stringify(res.body)).toEqual([409, "skill_unavailable"]);
    expect(runCount(w)).toBe(before);
    expect((await w.call("GET", "/api/runs")).body).toEqual(listed);
  };
  const skillFile = (w: QuestionWorld) => path.join(w.ctx.paths.skills, "dashboard-answer", "SKILL.md");

  it("C53 no skills/dashboard-answer/ → 409 skill_unavailable, no run", async () => {
    await fresh(async (w) => {
      await w.create({ template: "question", question: "Quanto?" });
      fs.rmSync(path.dirname(skillFile(w)), { recursive: true, force: true });
      await unavailable(w);
    });
  });
  it("C53 the skill disabled → 409 skill_unavailable, no run", async () => {
    await fresh(async (w) => {
      await w.create({ template: "question", question: "Quanto?" });
      const text = fs.readFileSync(skillFile(w), "utf8");
      fs.writeFileSync(skillFile(w), text.replace("enabled: true", "enabled: false"));
      expect(w.ctx.skills.load("dashboard-answer")?.enabled).toBe(false);
      await unavailable(w);
    });
  });
  it("C53 settings.memorySkills without dashboard-answer → 409 skill_unavailable, no run", async () => {
    await fresh(async (w) => {
      await w.create({ template: "question", question: "Quanto?" });
      w.update((s) => {
        s.memorySkills = ["recall"];
      });
      await unavailable(w);
    });
  });
  it("C53 the skill's daily budget spent → 409 budget_exhausted, no run", async () => {
    await fresh(async (w) => {
      await w.create({ template: "question", question: "Quanto?" });
      const text = fs.readFileSync(skillFile(w), "utf8");
      fs.writeFileSync(skillFile(w), text.replace("mode: read_only", "mode: read_only\nbudgetUsd: 0.5"));
      w.ctx.db
        .prepare(
          "INSERT INTO runs (id, created_at, started_at, finished_at, origin, provider, status, duration_ms, skill_slug, cost_usd) VALUES ('gasto', ?, ?, ?, 'manual', 'claude', 'succeeded', 1, 'dashboard-answer', 0.6)",
        )
        .run(Date.now(), Date.now(), Date.now());
      const before = runCount(w);
      const res = await w.refresh("pergunta");
      expect([res.status, errorCode(res)], JSON.stringify(res.body)).toEqual([409, "budget_exhausted"]);
      expect(runCount(w)).toBe(before);
    });
  });
});

describe("C54 the host checks the answer", () => {
  it("C54 each refusal for its own reason keeps the snapshot, puts the reason in the question source and says error; a valid answer of two widgets becomes the snapshot", async () => {
    await fresh(async (w) => {
      const file = await cited(w);
      const plano = await cited(w, "metas", { natureza: "plano" });
      const hidden = w.note(
        path.join(w.memory, "notes", "privado", "segredo.md"),
        {},
        "# Segredo\n\n## A\n\nx\n",
      );
      await w.index();
      w.update((s) => {
        s.excludes = [...s.excludes, "privado"];
      });
      expect(w.ctx.db.prepare("SELECT COUNT(*) c FROM files WHERE path = ?").get(hidden)).toEqual({ c: 1 });
      await w.create({ template: "question", question: "Por que o onboarding demora?" });

      const ask = async (content: unknown, fail = false) => {
        w.answer(content);
        w.failing(fail);
        try {
          const res = await w.refresh("pergunta");
          expect(res.status, JSON.stringify(res.body)).toBe(202);
          const event = await w.settle("pergunta", res.body.runId);
          return { event, snapshot: (await w.get("pergunta")).body.snapshot as Json };
        } finally {
          w.failing(false);
        }
      };

      const ok = await ask(answer(file));
      expect(ok.event.status).toBe("ok");
      const accepted = ok.snapshot;
      expect(accepted.widgets.map((x: Json) => [x.id, x.kind, x.status])).toEqual([
        ["dias", "kpi", "ok"],
        ["causas", "list", "ok"],
        ["como-foi-feita", "note", "ok"],
      ]);
      const fileId = (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(file) as { id: number }).id;
      expect(accepted.widgets[0].data).toEqual({
        value: 18,
        title: "Dias até o valor",
        citations: [{ path: file, section: "Métricas", name: "onboarding.md", fileId }],
      });

      const withItem = (item: Json): Json => {
        const a = answer(file);
        a.widgets[1].data.items = [item];
        return a;
      };
      const cases: Array<[string, unknown, RegExp, boolean?]> = [
        [
          "it does not validate against the snapshot schema",
          { v: 1, widgets: [{ id: "x", kind: "pie", title: "X", data: {}, citations: [] }] },
          /schema/,
        ],
        [
          "a widget has no citation",
          { ...answer(file), widgets: [{ ...answer(file).widgets[0], citations: [] }] },
          /no citation/,
        ],
        [
          "a citation names a path the index does not have",
          {
            ...answer(file),
            widgets: [
              {
                ...answer(file).widgets[0],
                citations: [{ path: path.join(w.memory, "notes", "nao.md"), section: "A" }],
              },
            ],
          },
          /index does not have/,
        ],
        [
          "a path today's policy excludes",
          {
            ...answer(file),
            widgets: [{ ...answer(file).widgets[0], citations: [{ path: hidden, section: "A" }] }],
          },
          /policy excludes/,
        ],
        [
          "an item of natureza plano without its label",
          withItem({ title: "Meta", path: plano }),
          /natureza plano and lacks its label/,
        ],
        [
          "7 widgets",
          {
            v: 1,
            widgets: Array.from({ length: 7 }, (_, i) => ({ ...answer(file).widgets[0], id: `w${i}` })),
          },
          /7 widgets; at most 6/,
        ],
        ["256 KB + 1 byte", Buffer.alloc(262_145, " "), /larger than 262144 bytes/],
        ["the run finishing failed", answer(file), /finished failed/, true],
      ];
      for (const [name, content, reason, fail] of cases) {
        const { event, snapshot } = await ask(content, fail);
        expect(event.status, name).toBe("error");
        expect(snapshot.generatedAt, name).toBe(accepted.generatedAt);
        expect(snapshot.widgets, name).toEqual(accepted.widgets);
        const source = snapshot.sources.find((x: Json) => x.id === "question");
        expect(source, name).toMatchObject({ id: "question", kind: "question", status: "error" });
        expect(source.message, name).toMatch(reason);
      }
      // the plano item with its label passes
      const labelled = await ask(withItem({ title: "Meta", path: plano, natureza: "plano" }));
      expect(labelled.event.status).toBe("ok");
    });
  });
});

describe("C56 the skill and the memory skills", () => {
  it("C56 skills/dashboard-answer/SKILL.md parses read_only with the inputs question (required) and context_id (optional)", () => {
    const skill = new SkillCatalog(resolvePaths(repo)).load("dashboard-answer");
    expect(skill).not.toBeNull();
    expect(skill!.mode).toBe("read_only");
    expect(skill!.inputs.map((i) => [i.name, i.required])).toEqual([
      ["question", true],
      ["context_id", false],
    ]);
  });
  it("C56 the default memorySkills are recall, consolidate-memory, organize-brain and dashboard-answer", () => {
    expect(SettingsSchema.parse({}).memorySkills).toEqual([
      "recall",
      "consolidate-memory",
      "organize-brain",
      "dashboard-answer",
    ]);
  });
  it("C56 a home whose stored memorySkills is [recall] keeps [recall]; GET /api/skills shows dashboard-answer with memoryAccess on a fresh home", async () => {
    const w = await paineisWorld(`mordomo-paineis-question-c56-${++seq}-`);
    // a fresh home of the product: seeded from the bundle, as a first run does
    seedHome(w.ctx.paths, repo);
    try {
      const skills = (await w.call("GET", "/api/skills")).body as Json[];
      expect(skills.find((s) => s.slug === "dashboard-answer")).toMatchObject({
        memoryAccess: true,
        mode: "read_only",
      });
      w.update((s) => {
        s.memorySkills = ["recall"];
      });
      const settingsFile = path.join(w.ctx.paths.config, "settings.json");
      expect(JSON.parse(fs.readFileSync(settingsFile, "utf8")).memorySkills).toEqual(["recall"]);
      expect(w.ctx.settingsStore.load().memorySkills).toEqual(["recall"]);
      const after = (await w.call("GET", "/api/skills")).body as Json[];
      expect(after.find((s) => s.slug === "dashboard-answer")).toMatchObject({ memoryAccess: false });
    } finally {
      await w.close();
    }
  });
});
