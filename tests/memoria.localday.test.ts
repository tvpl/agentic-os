// The local day of a new line of MEMORY.md and of the sentinel of proposals (AD-043 b, L-053): a zone away from UTC, at
// an hour where the local day and the UTC day differ, tells one from the other. Set before any date is built.
process.env.TZ = "America/Sao_Paulo";

import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OsEvent } from "../core/src/events.js";
import { storeProposal } from "../core/src/memory/proposals.js";
import { readMetaJson } from "../core/src/sentinels/meta.js";
import { memoriaWorld, type Json, type MemoriaWorld } from "./helpers/memoriaWorld.js";
import { movingClock } from "./helpers/movingClock.js";

/**
 * cerebro-memoria-confiavel S3, the claims that name a local day, in São Paulo: 23:30 of 2026-10-31 there is 02:30 of
 * 2026-11-01 in UTC. The lines an accepted consolidation writes (C54-C56, C58), through `POST
 * /api/memory/proposals/:id/decide`, and the day of the `proposalsPending` sentinel (C75), with `Date.now` set to that
 * instant and still moving (`movingClock`: an index pass waits for the clock to move, so it is never frozen).
 */

const NOW = Date.UTC(2026, 10, 1, 2, 30, 0);
const LOCAL = "2026-10-31";
const DAY = "2026-10-30";
const journalRel = `journal/${DAY}.md`;

let w: MemoriaWorld;
let clock: ReturnType<typeof movingClock> | null = null;
/** Run `fn` with `Date.now()` at `at` and moving. */
const at = async <T>(when: number, fn: () => Promise<T>): Promise<T> => {
  clock = movingClock(when);
  try {
    return await fn();
  } finally {
    clock.restore();
    clock = null;
  }
};
beforeAll(async () => {
  w = await memoriaWorld("mordomo-memoria-localday-");
}, 60_000);
afterAll(async () => {
  await w.close();
});
afterEach(() => {
  clock?.restore();
  clock = null;
  vi.useRealTimers();
});

const memoryFile = () => path.join(w.memory, "MEMORY.md");
const BASE = [
  "# Long-term memory",
  "",
  "## Facts",
  "",
  "- O curso custa 700",
  "",
  "## Decisions",
  "",
  "- Turmas de 15",
  "",
  "## Open loops",
  "",
  "- Lançar a turma de março",
  "",
  "## Reflections",
  "",
  "## Superseded",
  "",
  "- O curso custava 500 (valid_to:: 2026-09-01)",
  "",
].join("\n");

beforeEach(() => {
  w.ctx.db.prepare("DELETE FROM memory_proposals").run();
  fs.rmSync(memoryFile(), { force: true });
  fs.rmSync(path.join(w.memory, "topics"), { recursive: true, force: true });
  w.put(path.join(w.memory, "journal", `${DAY}.md`), `# ${DAY}\n## Decisions\n\n- Turmas de 20 alunos\n`);
  w.put(path.join(w.memory, "notes", "cliente.md"), "# Cliente\n\n## Contrato\n\n- Renovação em março\n");
});

let runs = 0;
const consolidation = (ops: Json[]) => {
  const runId = `r-local-${++runs}`;
  return storeProposal(
    w.ctx.db,
    {
      kind: "consolidation",
      author: `run:${runId}`,
      runId,
      summary: "s",
      payload: { v: 1, summary: "s", ops },
    },
    { capped: false },
  );
};
/** Accept every valid op of the proposal at 23:30 local of 2026-10-31. */
const acceptAtNight = async (id: string): Promise<Json> => {
  const shown = await w.call("GET", `/api/memory/proposals/${id}`);
  const baseVersion = shown.body.baseVersion as string | null;
  const res = await at(NOW, () =>
    w.call("POST", `/api/memory/proposals/${id}/decide`, {
      action: "accept",
      ...(baseVersion ? { baseVersion } : {}),
    }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};
/** The non-blank lines of a section of MEMORY.md. */
const section = (name: string) => {
  const lines = fs.readFileSync(memoryFile(), "utf8").split("\n");
  const start = lines.indexOf(`## ${name}`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    if (line.trim() !== "") out.push(line);
  }
  return out;
};
const headings = () =>
  fs
    .readFileSync(memoryFile(), "utf8")
    .split("\n")
    .filter((l) => l.startsWith("## "));

describe("the local day and the UTC day differ here", () => {
  it("C54 C55 C56 C58 C75 the zone is pinned: 23:30 of 2026-10-31 local is 2026-11-01 in UTC", () => {
    expect(process.env.TZ).toBe("America/Sao_Paulo");
    expect(new Date(NOW).getDate()).toBe(31);
    expect(new Date(NOW).getHours()).toBe(23);
    expect(new Date(NOW).toISOString().slice(0, 10)).toBe("2026-11-01");
  });
});

describe("C54 an add op", () => {
  it("C54 the line is the last of its section: - <text> (fonte:: <source>:<line>) (autor:: agente) (em:: <local day>); with no line, the source alone; with #section, kept", async () => {
    w.put(memoryFile(), BASE);
    const p = consolidation([
      { op: "add", section: "Decisions", text: "Turmas de 20 alunos", source: journalRel, line: 4 },
      { op: "add", section: "Decisions", text: "Sem linha", source: journalRel },
      { op: "add", section: "Facts", text: "Renova em março", source: "notes/cliente.md#Contrato" },
    ]);
    await acceptAtNight(p.id);
    expect(section("Decisions")).toEqual([
      "- Turmas de 15",
      `- Turmas de 20 alunos (fonte:: ${journalRel}:4) (autor:: agente) (em:: ${LOCAL})`,
      `- Sem linha (fonte:: ${journalRel}) (autor:: agente) (em:: ${LOCAL})`,
    ]);
    expect(section("Facts")).toEqual([
      "- O curso custa 700",
      `- Renova em março (fonte:: notes/cliente.md#Contrato) (autor:: agente) (em:: ${LOCAL})`,
    ]);
  });
});

describe("C55 a supersede op", () => {
  it("C55 the exact old line goes to the end of ## Superseded with (valid_to:: <local day>), the new one to the old line's section", async () => {
    w.put(memoryFile(), BASE);
    const p = consolidation([
      { op: "supersede", old: "- Turmas de 15", text: "Turmas de 20 alunos", source: journalRel, line: 4 },
    ]);
    await acceptAtNight(p.id);
    expect(section("Superseded")).toEqual([
      "- O curso custava 500 (valid_to:: 2026-09-01)",
      `- Turmas de 15 (valid_to:: ${LOCAL})`,
    ]);
    expect(section("Decisions")).toEqual([
      `- Turmas de 20 alunos (fonte:: ${journalRel}:4) (autor:: agente) (em:: ${LOCAL})`,
    ]);
  });
});

describe("C56 a close_loop op and the sections that are missing", () => {
  it("C56 → closed <on> is appended to the exact line, which stays in ## Open loops", async () => {
    w.put(memoryFile(), BASE);
    const p = consolidation([
      { op: "close_loop", old: "- Lançar a turma de março", on: "2026-10-31", source: journalRel, line: 4 },
    ]);
    await acceptAtNight(p.id);
    expect(section("Open loops")).toEqual(["- Lançar a turma de março → closed 2026-10-31"]);
  });

  it("C56 sections an op needs are appended at the end in the order Facts, Decisions, Open loops, Reflections, Superseded", async () => {
    w.put(memoryFile(), "# Long-term memory\n\n## Facts\n\n- O curso custa 700\n");
    const p = consolidation([
      { op: "add", section: "Reflections", text: "Uma reflexão", source: journalRel, line: 4 },
      { op: "supersede", old: "- O curso custa 700", text: "O curso custa 900", source: journalRel, line: 4 },
      { op: "add", section: "Decisions", text: "Uma decisão", source: journalRel, line: 4 },
    ]);
    await acceptAtNight(p.id);
    expect(headings()).toEqual(["## Facts", "## Decisions", "## Reflections", "## Superseded"]);
    expect(section("Superseded")).toEqual([`- O curso custa 700 (valid_to:: ${LOCAL})`]);
  });

  it("C56 a missing MEMORY.md is created holding only the sections the ops need", async () => {
    const p = consolidation([
      { op: "add", section: "Decisions", text: "Uma decisão", source: journalRel, line: 4 },
    ]);
    await acceptAtNight(p.id);
    expect(fs.readFileSync(memoryFile(), "utf8")).toBe(
      `## Decisions\n\n- Uma decisão (fonte:: ${journalRel}:4) (autor:: agente) (em:: ${LOCAL})\n`,
    );
  });
});

describe("C58 a move_to_topic op", () => {
  const MOVED = ["- Cliente A paga em dia", "- Cliente B atrasa"];
  const withClients = BASE.replace("- O curso custa 700\n", `- O curso custa 700\n${MOVED.join("\n")}\n`);

  it("C58 the lines go to topics/clientes.md, created with type: memoria-topico; one pointer line takes the first's place; the topic gets a proposal version", async () => {
    w.put(memoryFile(), withClients);
    const p = consolidation([{ op: "move_to_topic", lines: MOVED, topic: "clientes" }]);
    const done = await acceptAtNight(p.id);
    const topic = path.join(w.memory, "topics", "clientes.md");
    expect(fs.readFileSync(topic, "utf8")).toBe(`---\ntype: memoria-topico\n---\n\n${MOVED.join("\n")}\n`);
    expect(section("Facts")).toEqual([
      "- O curso custa 700",
      `- Clientes → [[topics/clientes]] (autor:: agente) (em:: ${LOCAL})`,
    ]);
    expect((done.written as Json[]).map((x) => x.path).sort()).toEqual(["MEMORY.md", "topics/clientes.md"]);
    const history = await w.call("GET", "/api/memory/history?path=topics/clientes.md");
    expect((history.body.versions as Json[])[0]).toMatchObject({ origin: "proposal", author: p.author });
  });

  it("C58 an existing topic is appended to, its header unchanged", async () => {
    const header = "---\ntype: memoria-topico\n---\n\n- Cliente Z\n";
    w.put(path.join(w.memory, "topics", "clientes.md"), header);
    w.put(memoryFile(), withClients);
    const p = consolidation([{ op: "move_to_topic", lines: MOVED, topic: "clientes" }]);
    await acceptAtNight(p.id);
    expect(fs.readFileSync(path.join(w.memory, "topics", "clientes.md"), "utf8")).toBe(
      `${header}${MOVED.join("\n")}\n`,
    );
  });
});

describe("C75 the sentinel's local day", () => {
  const fired = async (when: number): Promise<Json[]> => {
    const seen: Json[] = [];
    const off = w.ctx.events.subscribe((e: OsEvent) => {
      const payload = e.payload as Json;
      if (e.type === "sentinel.fired" && payload.sentinel === "proposalsPending") seen.push(payload);
    });
    try {
      await at(when, () => w.ctx.sentinels.hourly());
    } finally {
      off();
    }
    return seen;
  };
  const propose = (n: number) => {
    for (let i = 0; i < n; i++) {
      storeProposal(
        w.ctx.db,
        {
          kind: "fact",
          author: "mcp",
          summary: `C75 ${i}`,
          payload: { subject: `C75 ${i}`, predicate: "p", object: "o" },
        },
        { capped: true },
      );
    }
  };
  const forget = () => w.ctx.db.prepare("DELETE FROM meta WHERE key = 'sentinel.proposalsPending.day'").run();

  it("C75 3 pending at 23:30 local: one event with count 3 and the href, the day 2026-10-31 in meta; again that day none; at 00:30 of 11-01 one", async () => {
    forget();
    propose(3);
    const first = await fired(NOW);
    expect(first).toEqual([
      {
        sentinel: "proposalsPending",
        title: "3 agent proposals to review",
        body: "What agents proposed to write to the memory waits in Reviews › From the agent: accept all, part or none.",
        severity: "info",
        href: "/brain/reviews?tab=agent",
        count: 3,
        messageParams: { count: 3 },
      },
    ]);
    expect(readMetaJson(w.ctx.db, "sentinel.proposalsPending.day")).toBe(LOCAL);
    expect(await fired(NOW + 20 * 60_000)).toEqual([]);
    const next = await fired(NOW + 60 * 60_000);
    expect(next.map((p) => p.count)).toEqual([3]);
    expect(readMetaJson(w.ctx.db, "sentinel.proposalsPending.day")).toBe("2026-11-01");
  });

  it("C75 exactly 1 pending: count 1; 0 pending: none", async () => {
    forget();
    propose(1);
    expect((await fired(NOW)).map((p) => p.count)).toEqual([1]);
    forget();
    w.ctx.db.prepare("DELETE FROM memory_proposals").run();
    expect(await fired(NOW)).toEqual([]);
  });
});

describe("C132 the export folder's local minute", () => {
  it("C132 at 23:30 local of 2026-10-31 (02:30 of 11-01 in UTC) notes/projetos exports to artifacts/exports/projetos-2026-10-31-2330, and again that minute to …-2330-2", async () => {
    expect(process.env.TZ).toBe("America/Sao_Paulo");
    expect(new Date(NOW).toISOString().slice(0, 16)).toBe("2026-11-01T02:30");
    const folder = path.join(w.memory, "notes", "projetos");
    w.put(path.join(folder, "plano.md"), "# Plano\n");
    let window: [number, number] = [0, 0];
    const exportAt = (when: number) =>
      at(when, async () => {
        const from = Date.now();
        const res = await w.call("POST", "/api/memory/export", { folder });
        window = [from, Date.now()];
        return res;
      });
    const out = path.join(fs.realpathSync(w.home), "artifacts", "exports", "projetos-2026-10-31-2330");
    const first = await exportAt(NOW);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toEqual({ path: out, files: 1, bytes: 8 });
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "mordomo-export.json"), "utf8")) as Json;
    expect(manifest.exportedAt).toBeGreaterThanOrEqual(window[0]);
    expect(manifest.exportedAt).toBeLessThanOrEqual(window[1]);
    expect(new Date(manifest.exportedAt as number).getMinutes()).toBe(30);
    const second = await exportAt(NOW + 25_000);
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.path).toBe(`${out}-2`);
  });
});
