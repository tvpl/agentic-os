import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedHome } from "@mordomo/core/internal";
import { AppContext } from "../apps/api/src/context.js";
import { FAKE_BIN, makeTempHome } from "./helpers.js";
import { notesViewWorld, type Json } from "./helpers/notesViewWorld.js";

/**
 * .specs/features/cerebro-natureza, batch A, S2: what the agents read about the nature of what they recall (AC 15 and
 * 16): the compiled `AGENTS.md` and `CLAUDE.md` of `mordomo sync --apply` (the BUILT cli, over a real home), the
 * prompt of a memory skill's run (`buildRunPrompt`), and the `consolidate-memory` guide with what recall reads from a
 * `MEMORY.md` written in its shape.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(repoRoot, "apps", "api", "dist", "cli.js");
const distReady = fs.existsSync(CLI);
if (!distReady)
  console.warn(`[natureza.agents] skipping the CLI proof: ${CLI} is missing, run npm run build:server`);

/** design.md, "Texto do bloco para os agentes", line for line. */
const BLOCK = [
  "## Natureza da informação",
  "- Cada nota ou trecho pode ter `natureza`: fato, relato, plano, hipotese ou opiniao (e `escopo`: pessoal, equipe, externo).",
  '- Plano, hipótese e opinião não são a realidade. Nunca os apresente como fato; diga "está planejado", "a hipótese é", "na opinião de".',
  '- Ao citar, diga a natureza do que cita. Trecho sem natureza é "não classificado": diga isso quando a resposta depender dele.',
  "- Para só fatos, use o recall com `natureza=fato`.",
  "- Uma nota com `status: archived` e `abandoned` é uma ideia abandonada: não a trate como intenção atual.",
];

describe.skipIf(!distReady)("C24 the compiled instructions end with the block", () => {
  let home: ReturnType<typeof makeTempHome>;
  let target: string;
  beforeAll(() => {
    home = makeTempHome("mordomo-natureza-agents-");
    // `mordomo sync` with no folder compiles into the home
    target = home.paths.home;
    const ctx = new AppContext(home.paths.home);
    const settings = ctx.settings();
    settings.setupCompleted = true;
    settings.providers.claude.enabled = true;
    settings.providers.claude.binaryPath = path.join(FAKE_BIN, "claude");
    settings.providers.codex.enabled = true;
    settings.providers.codex.binaryPath = path.join(FAKE_BIN, "codex");
    ctx.settingsStore.save(settings);
    ctx.close();
    const res = spawnSync(process.execPath, [CLI, "sync", "--apply"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 60_000,
      env: {
        ...process.env,
        MORDOMO_HOME: home.paths.home,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        PATH: `${FAKE_BIN}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });
    expect(res.status, `${res.stdout}\n${res.stderr}`).toBe(0);
    expect(res.stdout, res.stdout).toContain("Wrote ");
  });
  afterAll(() => {
    home.cleanup();
  });

  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    it(`C24 ${name} ends with the six lines of the block, as its last section, after ## Ground rules`, () => {
      const text = fs.readFileSync(path.join(target, name), "utf8");
      const lines = text.split("\n");
      while (lines.at(-1) === "") lines.pop();
      const heading = lines.indexOf(BLOCK[0]!);
      const ground = lines.indexOf("## Ground rules");
      expect(ground, "## Ground rules").toBeGreaterThan(0);
      expect(heading, "the block's heading").toBeGreaterThan(ground);
      // nothing but the block follows its heading: the last six lines of the file are the block, exactly
      expect(lines.slice(heading)).toEqual(BLOCK);
      expect(lines.filter((l) => l === BLOCK[0])).toHaveLength(1);
      expect(lines.slice(ground + 1, heading).some((l) => l.startsWith("## "))).toBe(false);
    });
  }
});

describe("C25 the prompt of a memory skill's run holds the block after the locations", () => {
  let temp: ReturnType<typeof makeTempHome>;
  let ctx: AppContext;
  beforeAll(() => {
    temp = makeTempHome("mordomo-natureza-prompt-");
    seedHome(temp.paths, repoRoot);
    ctx = new AppContext(temp.paths.home);
  });
  afterAll(() => {
    ctx.close();
    temp.cleanup();
  });

  const promptOf = (slug: string, contextBlock?: string): string => {
    const skill = ctx.skills.load(slug);
    expect(skill, slug).not.toBeNull();
    return ctx.skills.buildRunPrompt(skill!, {}, path.join(temp.paths.artifacts, "run-c25"), contextBlock);
  };

  it("C25 a skill of settings.memorySkills: the six lines right after the memory folder and the API lines, before the resources line", () => {
    expect(ctx.settings().memorySkills).toContain("consolidate-memory");
    const prompt = promptOf("consolidate-memory");
    const block = BLOCK.join("\n");
    expect(prompt).toContain(`\n\n${block}\n\n`);
    const at = prompt.indexOf(block);
    const api = prompt.indexOf("Local API for the memory routes only");
    const folder = prompt.indexOf(`Memory folder (an added folder of this run): ${temp.paths.memory}`);
    expect(folder).toBeGreaterThan(0);
    expect(api).toBeGreaterThan(folder);
    // right after the locations block: what separates them is the end of the API line and the blank line
    const apiLineEnd = prompt.indexOf("\n", api);
    expect(prompt.slice(apiLineEnd, at)).toBe("\n\n");
    const resources = prompt.indexOf("The skill folder contains extra resource files");
    expect(resources, "consolidate-memory has resource files").toBeGreaterThan(0);
    expect(resources).toBeGreaterThan(at + block.length);
  });

  it("C25 with a work context, the context block is still first", () => {
    const contextBlock = "Work context: Projeto C25\nPaths: /tmp/c25";
    const prompt = promptOf("consolidate-memory", contextBlock);
    expect(prompt.startsWith(`${contextBlock}\n\n`)).toBe(true);
    expect(prompt.indexOf(BLOCK.join("\n"))).toBeGreaterThan(
      prompt.indexOf("Local API for the memory routes only"),
    );
  });

  it("C25 a skill not in settings.memorySkills has no block", () => {
    const other = ctx.skills
      .list()
      .map((s) => s.slug)
      .find((slug) => !ctx.settings().memorySkills.includes(slug));
    expect(other, "a seeded skill that is not a memory skill").toBeDefined();
    const prompt = promptOf(other!);
    expect(prompt).not.toContain(BLOCK[0]);
    expect(prompt).not.toContain("Local API for the memory routes only");
  });
});

describe("C26 the consolidation keeps door 3's titles, and recall reads them", () => {
  it("C26 skills/consolidate-memory/SKILL.md names the five titles as written, and a Reflections excerpt of a MEMORY.md in that shape is opiniao", async () => {
    const guide = fs.readFileSync(path.join(repoRoot, "skills", "consolidate-memory", "SKILL.md"), "utf8");
    for (const title of ["## Facts", "## Decisions", "## Open loops", "## Reflections", "## Superseded"]) {
      expect(guide, title).toContain(`\`${title}\``);
    }
    const w = await notesViewWorld("mordomo-natureza-c26-");
    try {
      const memoryMd = w.put(
        path.join(w.memory, "MEMORY.md"),
        [
          "# Long-term memory",
          "",
          "## Facts",
          "",
          "- O curso custa 900 (journal 2026-10-01)",
          "",
          "## Decisions",
          "",
          "- Turmas de 20 (journal 2026-10-02)",
          "",
          "## Open loops",
          "",
          "- Lançar a turma de março (journal 2026-10-03)",
          "",
          "## Reflections",
          "",
          "A recorrência da turma de jaboticabeira mostra que o preço pesa menos que o horário.",
          "",
          "## Superseded",
          "",
          "- O curso custava 700 valid_to:: 2026-10-01",
          "",
        ].join("\n"),
      );
      await w.index();
      const res = await w.call(
        "GET",
        `/api/memory/recall?q=${encodeURIComponent("jaboticabeira horário")}&record=false`,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const excerpt = (res.body.answerContext as Json[]).find((c) => c.path === memoryMd);
      expect(excerpt).toMatchObject({ section: "Reflections", natureza: "opiniao" });
    } finally {
      await w.close();
    }
  });
});
