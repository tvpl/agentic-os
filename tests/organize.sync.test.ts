import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTempHome } from "./helpers.js";
import { AppContext } from "../apps/api/src/context.js";
import { organizeWorld, type Json, type OrganizeWorld } from "./helpers/organizeWorld.js";

/**
 * .specs/features/cerebro-organizar, batch B, S4 at the HTTP boundary: the owner's goals and the agents' stance in the
 * compiled `AGENTS.md` and `CLAUDE.md` (`GET /api/sync/plan`, the compile of a work context, `POST /api/sync/apply`),
 * and `settings.memory.agentStance` as `PUT /api/settings` and `settings.json` read it. Each test is written from its
 * check in `checks.md`; the extraction itself is also proven at its own layer in `organize.layer.test.ts`.
 */

const POSIX = process.platform !== "win32";
const CONTEST =
  "- When a request conflicts with these goals, say so and propose the alternative that serves them before doing it.";
const LONG = `Dobrar a receita recorrente ${"com clientes que ficam ".repeat(8)}`.slice(0, 200);

let w: OrganizeWorld;
let goals: string;

beforeAll(async () => {
  w = await organizeWorld("mordomo-organize-sync-");
  goals = path.join(w.ctx.paths.memory, "notes", "negocio", "metas.md");
});
afterAll(async () => {
  await w.close();
});

/** A goals file with 12 first-level items (the third of 200 characters) and nested items under two of them. */
function twelveGoals(): string[] {
  const items = Array.from({ length: 12 }, (_, i) => (i === 2 ? LONG : `Meta ${i + 1}`));
  expect(LONG).toHaveLength(200);
  const lines = [
    "---",
    "type: goals",
    "natureza: plano",
    "---",
    "",
    "# Metas do negócio",
    "",
    "## Metas",
    "",
  ];
  items.forEach((item, i) => {
    lines.push(`- ${item}`);
    if (i === 0 || i === 5) lines.push(`  - detalhe aninhado de ${i + 1}`, `    - mais fundo ${i + 1}`);
  });
  lines.push("", "## Prazos", "", "- Isto não é uma meta da lista", "");
  w.put(goals, lines.join("\n"));
  return items;
}

/** The compiled instructions files of a plan, by name. */
async function compiled(query = ""): Promise<Record<string, string>> {
  const res = await w.call("GET", `/api/sync/plan${query}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const out: Record<string, string> = {};
  for (const action of res.body.actions as Json[]) {
    const name = path.basename(action.filePath as string);
    if (name === "AGENTS.md" || name === "CLAUDE.md") out[name] = action.newContent as string;
  }
  expect(Object.keys(out).sort()).toEqual(["AGENTS.md", "CLAUDE.md"]);
  return out;
}

/** The lines of the goals section: from its heading to the next `##` heading, blank lines at the end left out. */
function goalsLines(text: string): string[] | null {
  const lines = text.split("\n");
  const start = lines.indexOf("## Goals and priorities");
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  const body = lines.slice(start, end === -1 ? undefined : end);
  while (body.at(-1) === "") body.pop();
  return body;
}

function setStance(stance: string): void {
  w.update((s) => {
    s.memory.agentStance = stance as never;
  });
}

describe.skipIf(!POSIX)("S4 the goals in the map of the agents", () => {
  it("C35 with 12 goals (one of 200 characters, nested items) the compiled AGENTS.md and CLAUDE.md open with Goals and priorities: the first 10, the long one cut at 160, no nested item, then Full goals", async () => {
    setStance("neutral");
    const items = twelveGoals();
    const files = await compiled();
    for (const [name, text] of Object.entries(files)) {
      const lines = text.split("\n");
      const title = lines.findIndex((l) => l === `# ${w.ctx.settings().systemName}`);
      expect(title, name).toBeGreaterThanOrEqual(0);
      const firstH2 = lines.findIndex((l, i) => i > title && l.startsWith("## "));
      expect(lines[firstH2], name).toBe("## Goals and priorities");
      const section = goalsLines(text)!;
      const listed = section.filter((l) => l.startsWith("- "));
      expect(listed, name).toEqual(
        items.slice(0, 10).map((item, i) => `- ${i === 2 ? item.slice(0, 160) : item}`),
      );
      expect(listed[2]!.length, name).toBe(2 + 160);
      expect(
        section.some((l) => l.includes("aninhado") || l.includes("mais fundo")),
        name,
      ).toBe(false);
      expect(
        section.some((l) => l.includes("Meta 11") || l.includes("Prazos")),
        name,
      ).toBe(false);
      expect(section.at(-1), name).toBe(`Full goals: ${w.home}/memory/notes/negocio/metas.md`);
    }
  });

  it("C36 the compile into a work context's first ok path holds the same Goals and priorities in its AGENTS.md and CLAUDE.md", async () => {
    setStance("neutral");
    twelveGoals();
    const home = await compiled();
    const folder = w.dir("c36-contexto");
    w.put(path.join(folder, "leia.md"), "# Leia\n");
    const created = await w.call("POST", "/api/contexts", { name: "Contexto C36", paths: [folder] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;
    const res = await w.call("GET", `/api/sync/plan?context=${id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.targetDir).toBe(folder);
    const inContext = (res.body.actions as Json[]).filter((a) =>
      ["AGENTS.md", "CLAUDE.md"].includes(path.basename(a.filePath as string)),
    );
    expect(inContext.map((a) => path.basename(a.filePath as string)).sort()).toEqual([
      "AGENTS.md",
      "CLAUDE.md",
    ]);
    for (const action of inContext) {
      const name = path.basename(action.filePath as string);
      const section = goalsLines(action.newContent as string);
      expect(section, name).not.toBeNull();
      expect(section, name).toEqual(goalsLines(home[name]!));
    }
  });

  it("C37 with metas.md missing, with no ## Metas, and as a link out of memory/, the compiled files have no goals section and POST /api/sync/apply answers 200 and writes them", async () => {
    setStance("contest-conflicts");
    const outsideGoals = w.put(path.join(w.outside, "metas-fora.md"), "## Metas\n\n- Fora da memória\n");
    const cases: Array<[string, () => void]> = [
      ["missing", () => fs.rmSync(goals, { force: true })],
      ["no ## Metas", () => w.put(goals, "# Metas\n\n## Outra seção\n\n- Não é meta\n")],
      [
        "a link out of memory/",
        () => {
          fs.rmSync(goals, { force: true });
          fs.symlinkSync(outsideGoals, goals);
        },
      ],
    ];
    for (const [what, arrange] of cases) {
      arrange();
      const files = await compiled();
      for (const [name, text] of Object.entries(files)) {
        expect(text.includes("## Goals and priorities"), `${what} ${name}`).toBe(false);
        expect(text.includes("Fora da memória"), `${what} ${name}`).toBe(false);
        expect(text.includes(CONTEST), `${what} ${name}`).toBe(false);
      }
      const applied = await w.call("POST", "/api/sync/apply", { approvedConflicts: [] });
      expect(applied.status, `${what} ${JSON.stringify(applied.body)}`).toBe(200);
      const written = (applied.body.written as string[]).map((f) => path.basename(f));
      // The first apply writes both files; a later one writes them again only if they changed, which they do not.
      for (const name of ["AGENTS.md", "CLAUDE.md"]) {
        const file = path.join(w.home, name);
        expect(fs.readFileSync(file, "utf8"), `${what} ${name}`).toBe(files[name]);
        if (what === "missing") expect(written, what).toContain(name);
      }
    }
    fs.rmSync(goals, { force: true });
  });

  it("C38 with contest-conflicts the goals section ends with the line that asks to contest; with neutral the line is in neither file", async () => {
    twelveGoals();
    setStance("contest-conflicts");
    for (const [name, text] of Object.entries(await compiled())) {
      const section = goalsLines(text)!;
      expect(section.at(-1), name).toBe(CONTEST);
      expect(section.at(-2), name).toBe(`Full goals: ${goals}`);
    }
    setStance("neutral");
    for (const [name, text] of Object.entries(await compiled())) {
      expect(text.includes(CONTEST), name).toBe(false);
      expect(goalsLines(text)!.at(-1), name).toBe(`Full goals: ${goals}`);
    }
  });
});

describe("S4 the stance setting", () => {
  it("C39 a new home reads neutral, a settings.json with loud reads neutral, PUT loud is 400 validation and changes nothing, PUT contest-conflicts is 200 and stored", async () => {
    const temp = makeTempHome("mordomo-organize-stance-");
    try {
      const fresh = new AppContext(temp.paths.home);
      expect(fresh.settings().memory.agentStance).toBe("neutral");
      fresh.settingsStore.save(fresh.settings());
      fresh.close();
      const file = temp.paths.settingsFile;
      const stored = JSON.parse(fs.readFileSync(file, "utf8")) as Json;
      stored.memory = { ...(stored.memory ?? {}), agentStance: "loud", journalBudgetTokens: 900 };
      fs.writeFileSync(file, JSON.stringify(stored));
      const reread = new AppContext(temp.paths.home);
      expect(reread.settings().memory.agentStance).toBe("neutral");
      expect(reread.settings().memory.journalBudgetTokens).toBe(900);
      reread.close();
    } finally {
      temp.cleanup();
    }

    w.update((s) => {
      s.memory.agentStance = "neutral";
      s.memory.journalBudgetTokens = 1500;
    });
    const loud = await w.call("PUT", "/api/settings", { memory: { agentStance: "loud" } });
    expect(loud.status).toBe(400);
    expect(loud.body.error.code).toBe("validation");
    expect(w.ctx.settings().memory.agentStance).toBe("neutral");
    const ok = await w.call("PUT", "/api/settings", { memory: { agentStance: "contest-conflicts" } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(w.ctx.settings().memory.agentStance).toBe("contest-conflicts");
    const onDisk = JSON.parse(fs.readFileSync(w.ctx.paths.settingsFile, "utf8")) as Json;
    expect(onDisk.memory.agentStance).toBe("contest-conflicts");
    // The patch names one field of memory: the others stay as they were.
    expect(w.ctx.settings().memory.journalBudgetTokens).toBe(1500);
    expect((await w.call("GET", "/api/settings")).body.memory.agentStance).toBe("contest-conflicts");
  });
});
