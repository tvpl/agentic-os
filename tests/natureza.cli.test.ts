import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppContext } from "../apps/api/src/context.js";
import { FAKE_BIN, makeTempHome } from "./helpers.js";

/**
 * .specs/features/cerebro-natureza, batch A, S2: `mordomo recall` labels each excerpt by its nature and filters by it
 * (AC 13, AC 14, amendment 12): the BUILT cli, over a real home and a real index, as `contexts.cli.test.ts` runs it.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(repoRoot, "apps", "api", "dist", "cli.js");
const distReady = fs.existsSync(CLI);
if (!distReady)
  console.warn(`[natureza.cli] skipping the CLI proof: ${CLI} is missing, run npm run build:server`);

type Json = Record<string, any>;
const put = (file: string, text: string): string => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};
const note = (header: Record<string, string>, title: string, body: string): string => {
  const lines = Object.entries(header).map(([k, v]) => `${k}: ${v}`);
  return `${lines.length ? `---\n${lines.join("\n")}\n---\n` : ""}# ${title}\n\n## ${title}\n\n${body}\n`;
};

describe.skipIf(!distReady)("S2 mordomo recall by nature", () => {
  let home: ReturnType<typeof makeTempHome>;
  let work: string;
  const files: Record<string, string> = {};

  beforeAll(async () => {
    home = makeTempHome("mordomo-natureza-cli-");
    work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-natureza-cli-work-")));
    // One note per nature, each the only one holding its word.
    files.plano = put(
      path.join(work, "plano.md"),
      note({ natureza: "plano" }, "Bacuri", "O bacuri vai ser vendido."),
    );
    files.hipotese = put(
      path.join(work, "hipotese.md"),
      note({ natureza: "hipotese" }, "Buriti", "O buriti talvez venda."),
    );
    files.opiniao = put(
      path.join(work, "opiniao.md"),
      note({ natureza: "opiniao" }, "Mangaba", "Acho a mangaba cara."),
    );
    files.none = put(path.join(work, "nada.md"), note({}, "Umbu", "O umbu sem natureza."));
    files.fato = put(
      path.join(work, "fato.md"),
      note({ natureza: "fato", escopo: "pessoal" }, "Cajá", "O cajá custa 9."),
    );
    files.relato = put(
      path.join(work, "relato.md"),
      note({ natureza: "relato", escopo: "equipe" }, "Cajá relato", "Falamos do cajá ontem."),
    );
    files.abandoned = put(
      path.join(work, "abandonada.md"),
      note(
        { natureza: "plano", status: "archived", abandoned: "2026-09-01" },
        "Murici",
        "O murici ia ser plantado.",
      ),
    );
    const ctx = new AppContext(home.paths.home);
    const settings = ctx.settings();
    settings.setupCompleted = true;
    settings.indexedFolders = [{ path: work, area: null, enabled: true }];
    ctx.settingsStore.save(settings);
    files.memory = put(
      path.join(home.paths.memory, "MEMORY.md"),
      "# Long-term memory\n\n## Facts\n\n- nada aqui\n\n## Superseded\n\n- O araticum custava 7 valid_to:: 2026-10-01\n",
    );
    ctx.indexer.addImplicitRoot({ path: home.paths.memory, area: null, enabled: true });
    await ctx.indexer.indexAllAsync();
    ctx.close();
  });
  afterAll(() => {
    home.cleanup();
    fs.rmSync(work, { recursive: true, force: true });
  });

  const mordomo = (args: string[]) => {
    const res = spawnSync(process.execPath, [CLI, ...args], {
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
    return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  };
  const json = (question: string, flags: string[] = []): Json => {
    const res = mordomo(["recall", question, "--json", ...flags]);
    expect(res.status, res.stderr).toBe(0);
    return JSON.parse(res.stdout) as Json;
  };
  /** The header line of each excerpt the human output prints (the line that holds "●"). */
  const headers = (question: string, flags: string[] = []): string[] => {
    const res = mordomo(["recall", question, ...flags]);
    expect(res.status, res.stderr).toBe(0);
    return res.stdout.split("\n").filter((l) => l.includes(" ● ") || l.startsWith("● "));
  };
  const lineFor = (question: string, file: string): { line: string; item: Json } => {
    const item = (json(question).answerContext as Json[]).find((c) => c.path === file);
    expect(item, `${question} recalls ${file}`).toBeDefined();
    const line = headers(question).find((l) => l.includes(` ${file} § `) || l.startsWith(`● ${file} § `));
    expect(line, `${question} prints ${file}`).toBeDefined();
    return { line: line!, item: item! };
  };

  const LABELLED: Array<[string, string, string]> = [
    ["plano", "bacuri", "[Plano — ainda não é realidade] "],
    ["hipotese", "buriti", "[Hipótese] "],
    ["opiniao", "mangaba", "[Opinião] "],
    ["none", "umbu", "[Não classificado] "],
    ["fato", "cajá custa", ""],
    ["relato", "falamos ontem", ""],
  ];
  for (const [kind, question, label] of LABELLED) {
    it(`C21 a ${kind} excerpt's header line is ${label ? `"${label.trim()} ● …"` : '"● …" with no label'}`, () => {
      const { line, item } = lineFor(question, files[kind]!);
      expect(line).toBe(`${label}● ${item.path} § ${item.section} (score ${item.score})`);
    });
  }

  it("C22 an archived note with abandoned keeps its nature and ends its line with (abandonado em 2026-09-01); a Superseded excerpt ends with (substituído); --json carries natureza and escopo", () => {
    const { line, item } = lineFor("murici plantado", files.abandoned!);
    expect(item.natureza).toBe("plano");
    expect(line).toBe(
      `[Plano — ainda não é realidade] ● ${item.path} § ${item.section} (score ${item.score}) (abandonado em 2026-09-01)`,
    );
    const superseded = lineFor("araticum custava", files.memory!);
    expect(superseded.item.section).toBe("Superseded");
    expect(superseded.line).toBe(
      `● ${superseded.item.path} § Superseded (score ${superseded.item.score}) (substituído)`,
    );

    const ctx = new AppContext(home.paths.home);
    try {
      const row = ctx.db.prepare("SELECT fields FROM files WHERE path = ?").get(files.abandoned) as {
        fields: string;
      };
      expect(JSON.parse(row.fields)).toMatchObject({
        abandoned: "2026-09-01",
        status: "archived",
        natureza: "plano",
      });
    } finally {
      ctx.close();
    }
    const answer = json("cajá");
    expect((answer.answerContext as Json[]).length).toBeGreaterThan(0);
    for (const c of answer.answerContext as Json[]) {
      expect(c, c.path).toHaveProperty("natureza");
      expect(c, c.path).toHaveProperty("escopo");
    }
    expect((answer.answerContext as Json[]).find((c) => c.path === files.fato)).toMatchObject({
      natureza: "fato",
      escopo: "pessoal",
    });
  });

  it("C23 --natureza fato prints only fato excerpts, --escopo pessoal only pessoal ones, and --natureza talvez exits 2 with the accepted values and records nothing", () => {
    const all = json("cajá").answerContext as Json[];
    expect(all.map((c) => c.path).sort()).toEqual([files.fato, files.relato].sort());
    const facts = json("cajá", ["--natureza", "fato"]).answerContext as Json[];
    expect(facts.map((c) => [c.path, c.natureza])).toEqual([[files.fato, "fato"]]);
    const human = headers("cajá", ["--natureza", "fato"]);
    expect(human).toHaveLength(1);
    expect(human[0]).toContain(` ${files.fato} § `);
    const mine = json("cajá", ["--escopo", "pessoal"]).answerContext as Json[];
    expect(mine.map((c) => [c.path, c.escopo])).toEqual([[files.fato, "pessoal"]]);

    const stats = () => {
      const ctx = new AppContext(home.paths.home);
      try {
        return ctx.db.prepare("SELECT value FROM meta WHERE key = 'recall.stats'").get() as
          { value: string } | undefined;
      } finally {
        ctx.close();
      }
    };
    const before = stats();
    expect(before, "earlier recalls were recorded").toBeDefined();
    const refused = mordomo(["recall", "cajá", "--natureza", "talvez"]);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("fato, opiniao, plano, hipotese, relato");
    expect(refused.stdout).toBe("");
    expect(stats()).toEqual(before);
  });
});
