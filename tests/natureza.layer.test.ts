import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { AppContext } from "../apps/api/src/context.js";
import { MIGRATIONS } from "../core/src/db/migrations.js";
import { openDb } from "../core/src/db/db.js";
import { resolvePaths, ensureDirs } from "../core/src/paths.js";
import { parsePassages, readEscopo, readNatureza, readReviewEvery } from "../core/src/memory/natureza.js";
import {
  excerptNature,
  generatedFileKind,
  recall,
  splitSections,
  type NatureSource,
} from "../core/src/memory/recall.js";
import { makeTempHome } from "./helpers.js";

/**
 * .specs/features/cerebro-natureza, batch A (S1 and S2), the deciding code at its own layer (checks.md, Test policy
 * rows 1 and 2), with no HTTP: the nature reader (`readNatureza`, `readEscopo`, `readReviewEvery`), the passage parser
 * (`parsePassages`), migration 25, the recall's labelling (`excerptNature`, door 3's table) and `recall` itself. The
 * HTTP side of each claim is in `natureza.index.test.ts` and `natureza.search.test.ts`.
 */

type Json = Record<string, any>;

let temp: ReturnType<typeof makeTempHome>;
let ctx: AppContext;
let work: string;
let memory: string;
let seq = 0;

beforeAll(() => {
  temp = makeTempHome("mordomo-natureza-layer-");
  ctx = new AppContext(temp.paths.home);
  memory = temp.paths.memory;
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-natureza-layer-work-")));
  const s = ctx.settings();
  s.indexedFolders = [{ path: work, area: null, enabled: true }];
  ctx.settingsStore.save(s);
  ctx.indexer.addImplicitRoot({ path: memory, area: null, enabled: true });
});
afterAll(() => {
  ctx.close();
  temp.cleanup();
  fs.rmSync(work, { recursive: true, force: true });
});

const folder = (name: string): string => {
  const dir = path.join(work, `${name}-${++seq}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const put = (file: string, text: string): string => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};
const fieldsOf = (file: string): Record<string, string> =>
  JSON.parse(
    (ctx.db.prepare("SELECT fields FROM files WHERE path = ?").get(file) as { fields: string }).fields,
  ) as Record<string, string>;
const recallOf = (question: string, opts: Parameters<typeof recall>[4] = {}) =>
  recall(ctx.db, ctx.paths, ctx.settings(), question, { k: 10, ...opts });

// ---- S1: the nature reader ------------------------------------------------------------------------------------------

describe("C2 the nature is read through the closed lists", () => {
  const CASES: Array<[string, Record<string, string>, "natureza" | "escopo", string | null]> = [
    ["natureza: talvez reads null", { natureza: "talvez" }, "natureza", null],
    ["escopo: publico reads null", { escopo: "publico" }, "escopo", null],
    ["natureza: Opinião reads opiniao", { natureza: "Opinião" }, "natureza", "opiniao"],
    ["natureza: PLANO reads plano", { natureza: "PLANO" }, "natureza", "plano"],
    ['natureza: " plano " reads plano', { natureza: " plano " }, "natureza", "plano"],
  ];
  for (const [name, fields, key, want] of CASES) {
    it(`C2 ${name}`, () => {
      expect(key === "natureza" ? readNatureza(fields) : readEscopo(fields)).toBe(want);
    });
  }

  it("C2 a body line wins over the header before the lists are applied: natureza:: fato reads fato, natureza:: talvez reads null", () => {
    const dir = folder("c2-inline");
    const wins = put(path.join(dir, "vence.md"), "---\nnatureza: plano\n---\n\n# Vence\n\nnatureza:: fato\n");
    const absent = put(
      path.join(dir, "ausente.md"),
      "---\nnatureza: plano\n---\n\n# Ausente\n\nnatureza:: talvez\n",
    );
    ctx.indexer.indexAll();
    expect(fieldsOf(wins).natureza).toBe("fato");
    expect(readNatureza(fieldsOf(wins))).toBe("fato");
    // the header is not consulted: the inline value that won is outside the list, so the file has no nature
    expect(fieldsOf(absent).natureza).toBe("talvez");
    expect(readNatureza(fieldsOf(absent))).toBeNull();
  });

  it("C2 a natureza: talvez row stored by a pass before this feature reads null with no new pass", () => {
    const fields = { natureza: "talvez", escopo: "equipe" };
    const id = Number(
      ctx.db
        .prepare(
          "INSERT INTO files (root, path, rel, name, ext, dir, area, size, mtime, indexed_at, title, tags, fields) VALUES (?, ?, 'antiga.md', 'antiga.md', '.md', ?, NULL, 1, 1, 1, NULL, '[]', ?)",
        )
        .run(work, path.join(work, "antiga.md"), work, JSON.stringify(fields)).lastInsertRowid,
    );
    try {
      const row = ctx.db.prepare("SELECT fields FROM files WHERE id = ?").get(id) as { fields: string };
      const stored = JSON.parse(row.fields) as Record<string, string>;
      expect(stored.natureza).toBe("talvez");
      expect(readNatureza(stored)).toBeNull();
      expect(readEscopo(stored)).toBe("equipe");
    } finally {
      ctx.db.prepare("DELETE FROM files WHERE id = ?").run(id);
    }
  });
});

describe("C3 the cadence read from review_every", () => {
  const CASES: Array<[string, number | "never" | null]> = [
    ["45d", 45],
    ["1d", 1],
    ["3650d", 3650],
    ["never", "never"],
    ["45D", 45],
    ["0d", null],
    ["3651d", null],
    ["5000d", null],
    ["semana", null],
    ["30", null],
  ];
  for (const [value, want] of CASES) {
    it(`C3 review_every: ${value} reads ${String(want)}`, () => {
      expect(readReviewEvery({ review_every: value })).toBe(want);
    });
  }
  it("C3 a file with no review_every has no cadence of its own", () => {
    expect(readReviewEvery({})).toBeNull();
  });
});

// ---- S1: the passage parser -----------------------------------------------------------------------------------------

describe("C4 the passages of a Markdown file", () => {
  it("C4 lines 5-7 > [!plano] Lançamento, > em março, > com 3 turmas, then a blank line, are one plano passage 5-7", () => {
    const text = [
      "# Curso",
      "",
      "Texto antes.",
      "",
      "> [!plano] Lançamento",
      "> em março",
      "> com 3 turmas",
      "",
      "Depois.",
    ].join("\n");
    expect(parsePassages(text)).toEqual([{ natureza: "plano", startLine: 5, endLine: 7 }]);
  });
  it("C4 > [!FATO] on its own line opens a fato passage", () => {
    expect(parsePassages("intro\n\n> [!FATO]\n> o preço é 900\n")).toEqual([
      { natureza: "fato", startLine: 3, endLine: 4 },
    ]);
  });
  it("C4 a block with no title after the marker is a passage", () => {
    expect(parsePassages("> [!hipotese]\n> talvez dobre\n")).toEqual([
      { natureza: "hipotese", startLine: 1, endLine: 2 },
    ]);
  });
  it("C4 a > line right after a passage's last line extends it", () => {
    expect(parsePassages("> [!relato] Reunião\n> falamos de preço\n>\n> e de prazo\nfim\n")).toEqual([
      { natureza: "relato", startLine: 1, endLine: 4 },
    ]);
  });
  it("C4 the front matter counts in the line numbers", () => {
    expect(parsePassages("---\nnatureza: fato\n---\n> [!opiniao]\n> acho caro\n")).toEqual([
      { natureza: "opiniao", startLine: 4, endLine: 5 },
    ]);
  });
});

describe("C5 no passage is stored, one case per form", () => {
  // Each case is refused for its own reason alone: the same lines without that reason give a passage (L-039).
  const CASES: Array<[string, string, string]> = [
    [
      "a > [!plano] block inside a ``` fence",
      "```\n> [!plano] Dentro\n> x\n```\n",
      "> [!plano] Dentro\n> x\n",
    ],
    [
      "a > [!plano] block inside a ~~~ fence",
      "~~~md\n> [!plano] Dentro\n> x\n~~~\n",
      "> [!plano] Dentro\n> x\n",
    ],
    [
      "a > [!plano] line inside the front matter",
      "---\ntitle: x\n> [!plano] Dentro\n---\ncorpo\n",
      "---\ntitle: x\n---\n> [!plano] Dentro\ncorpo\n",
    ],
    ["> [!note]", "> [!note] Nota\n> x\n", "> [!plano] Nota\n> x\n"],
    ["> [!planos]", "> [!planos] Nota\n> x\n", "> [!plano] Nota\n> x\n"],
    ["[!plano] on a line that does not start with >", "texto [!plano] Nota\n> x\n", "> [!plano] Nota\n> x\n"],
  ];
  for (const [name, refused, twin] of CASES) {
    it(`C5 ${name}`, () => {
      expect(parsePassages(refused)).toEqual([]);
      expect(parsePassages(twin)).toHaveLength(1);
    });
  }
  it("C5 the table is the whole set of six forms", () => expect(CASES).toHaveLength(6));
});

// ---- S1: migration 25 -----------------------------------------------------------------------------------------------

describe("C7 migration 25", () => {
  const columns = (db: Database.Database, table: string) =>
    (db.pragma(`table_info(${table})`) as Json[]).map(({ name, type, notnull, dflt_value, pk }) => ({
      name,
      type,
      notnull,
      dflt_value,
      pk,
    }));
  const NOTE_PASSAGES = [
    { name: "file_id", type: "INTEGER", notnull: 1, dflt_value: null, pk: 1 },
    { name: "natureza", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    { name: "start_line", type: "INTEGER", notnull: 1, dflt_value: null, pk: 2 },
    { name: "end_line", type: "INTEGER", notnull: 1, dflt_value: null, pk: 0 },
  ];
  const REVIEW_STATE = [
    { name: "path", type: "TEXT", notnull: 0, dflt_value: null, pk: 1 },
    { name: "last_reviewed", type: "INTEGER", notnull: 0, dflt_value: null, pk: 0 },
    { name: "snooze_until", type: "INTEGER", notnull: 0, dflt_value: null, pk: 0 },
    { name: "never", type: "INTEGER", notnull: 1, dflt_value: "0", pk: 0 },
    { name: "updated_at", type: "INTEGER", notnull: 1, dflt_value: null, pk: 0 },
  ];

  it("C7 makes note_passages and review_state with doors 2 and 6's columns, again leaves them so, and keeps 22-24", () => {
    expect(columns(ctx.db, "note_passages")).toEqual(NOTE_PASSAGES);
    expect(columns(ctx.db, "review_state")).toEqual(REVIEW_STATE);
    const m25 = MIGRATIONS.find((m) => m.version === 25)!;
    expect(m25.up).toBeUndefined();
    ctx.db.exec(m25.sql!);
    expect(columns(ctx.db, "note_passages")).toEqual(NOTE_PASSAGES);
    expect(columns(ctx.db, "review_state")).toEqual(REVIEW_STATE);
    expect(
      MIGRATIONS.filter((m) => m.version >= 22 && m.version <= 24).map((m) => [m.version, m.name]),
    ).toEqual([
      [22, "drop-file-links"],
      [23, "run-context"],
      [24, "cleanup"],
    ]);
    expect(MIGRATIONS.at(-1)!.version).toBe(25);
  });

  it("C7 a database migrated from 24 keeps its files, note_links and cleanup_decisions rows byte for byte", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-natureza-m25-"));
    const paths = resolvePaths(home);
    ensureDirs(paths);
    try {
      const old = openDb(
        paths,
        MIGRATIONS.filter((m) => m.version <= 24),
      ).db;
      expect(old.pragma("user_version", { simple: true })).toBe(24);
      const fileId = Number(
        old
          .prepare(
            "INSERT INTO files (root, path, rel, name, ext, dir, area, size, mtime, indexed_at, title, tags, fields) VALUES ('/r', '/r/a.md', 'a.md', 'a.md', '.md', '/r', NULL, 3, 5, 7, 'A', '[\"x\"]', '{\"natureza\":\"plano\"}')",
          )
          .run().lastInsertRowid,
      );
      old
        .prepare(
          "INSERT INTO note_links (src_id, kind, target, label, line) VALUES (?, 'wikilink', 'b', NULL, 2)",
        )
        .run(fileId);
      old
        .prepare(
          "INSERT INTO cleanup_decisions (scope, key, decision, keep_file_id, until, decided_at) VALUES ('ctx:a', 'k1', 'keep', NULL, NULL, 9)",
        )
        .run();
      const snapshot = (db: Database.Database) => ({
        files: db.prepare("SELECT * FROM files ORDER BY id").all(),
        links: db.prepare("SELECT * FROM note_links ORDER BY src_id, line").all(),
        decisions: db.prepare("SELECT * FROM cleanup_decisions ORDER BY scope, key").all(),
      });
      const before = snapshot(old);
      old.close();

      const { db, migration } = openDb(paths);
      try {
        expect(migration).toMatchObject({ fromVersion: 24, toVersion: 25 });
        expect(snapshot(db)).toEqual(before);
        expect(columns(db, "note_passages")).toEqual(NOTE_PASSAGES);
        expect(columns(db, "review_state")).toEqual(REVIEW_STATE);
        expect(db.prepare("SELECT COUNT(*) AS n FROM note_passages").get()).toEqual({ n: 0 });
        expect(db.prepare("SELECT COUNT(*) AS n FROM review_state").get()).toEqual({ n: 0 });
      } finally {
        db.close();
      }
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

// ---- S2: the recall's labelling -------------------------------------------------------------------------------------

describe("C15 the nature of a recall excerpt, one case per row of AC 11", () => {
  const NOTE = [
    "---",
    "natureza: fato",
    "---",
    "",
    "## Preço",
    "",
    "O plano anual custa R$ 900.",
    "",
    "## Proposta",
    "",
    "> [!plano] Subir",
    "> Vamos subir para R$ 1 200.",
    "",
  ].join("\n");
  const sections = splitSections(NOTE, true);
  const section = (heading: string) => sections.find((s) => s.heading === heading)!;
  const source = (over: Partial<NatureSource>): NatureSource => ({
    passages: parsePassages(NOTE),
    natureza: "fato",
    generated: null,
    ...over,
  });

  it("C15 an excerpt whose lines lie within a > [!plano] passage of a natureza: fato note is plano", () => {
    expect(section("Proposta")).toMatchObject({ startLine: 11, endLine: 12 });
    expect(excerptNature(source({}), section("Proposta"))).toBe("plano");
  });
  it("C15 an excerpt of that note outside every passage is fato", () => {
    expect(excerptNature(source({}), section("Preço"))).toBe("fato");
  });
  it("C15 an excerpt of <home>/memory/MEMORY.md under ## Open loops is plano (door 3)", () => {
    const text = "# Memory\n\n## Facts\n\n- x\n\n## Open loops\n\n- lançar o curso\n";
    const open = splitSections(text, true).find((s) => s.heading === "Open loops")!;
    const kind = generatedFileKind(ctx.paths, path.join(memory, "MEMORY.md"));
    expect(kind).toBe("memory");
    expect(excerptNature({ passages: [], natureza: null, generated: kind }, open)).toBe("plano");
  });
  it("C15 an excerpt of a note with no nature and no passage is null", () => {
    expect(excerptNature(source({ passages: [], natureza: null }), section("Preço"))).toBeNull();
  });

  it("C15 recall labels each row the same way over a real index, with no HTTP", () => {
    const dir = folder("c15");
    const fato = put(
      path.join(dir, "jabuticaba-fato.md"),
      NOTE.replace(/Preço/g, "Jabuticaba preço").replace("## Proposta", "## Jabuticaba proposta"),
    );
    const plain = put(
      path.join(dir, "jabuticaba-nada.md"),
      "# Jabuticaba\n\n## Jabuticaba solta\n\nJabuticaba sem natureza.\n",
    );
    put(
      path.join(memory, "MEMORY.md"),
      "# Memory\n\n## Facts\n\n- nada\n\n## Open loops\n\n- jabuticaba no quintal\n",
    );
    ctx.indexer.indexAll();
    const answer = recallOf("jabuticaba").answerContext;
    const of = (file: string) => answer.find((c) => c.path === file)!;
    expect(of(plain).natureza).toBeNull();
    expect(of(path.join(memory, "MEMORY.md"))).toMatchObject({ section: "Open loops", natureza: "plano" });
    // the best section of the fato note, and then the passage section when only plano is asked
    expect(of(fato).natureza).toBe("fato");
    expect(
      recallOf("jabuticaba", { natureza: ["plano"] }).answerContext.find((c) => c.path === fato),
    ).toMatchObject({
      section: "Jabuticaba proposta",
      natureza: "plano",
    });
  });
});

describe("C16 door 3's table, one case per heading", () => {
  const MEMORY_MD = () => path.join(memory, "MEMORY.md");
  const JOURNAL = () => path.join(memory, "journal", "2026-10-29.md");
  const NOTE_X = () => path.join(memory, "notes", "x.md");
  const natureOf = (file: string, markdown: string, heading: string) => {
    const section = splitSections(markdown, true).find((s) => s.heading === heading)!;
    expect(section, heading).toBeDefined();
    return excerptNature(
      { passages: [], natureza: null, generated: generatedFileKind(ctx.paths, file) },
      section,
    );
  };
  const doc = (heading: string, level = 2) => `# Doc\n\n${"#".repeat(level)} ${heading}\n\n- uma linha\n`;
  const CASES: Array<[string, () => string, string, number, string | null]> = [
    ["MEMORY.md ## Facts", MEMORY_MD, "Facts", 2, "fato"],
    ["MEMORY.md ## Decisions", MEMORY_MD, "Decisions", 2, "fato"],
    ["MEMORY.md ## Open loops", MEMORY_MD, "Open loops", 2, "plano"],
    ["MEMORY.md ## Reflections", MEMORY_MD, "Reflections", 2, "opiniao"],
    ["MEMORY.md ## Superseded", MEMORY_MD, "Superseded", 2, "fato"],
    ["journal ## Decisions", JOURNAL, "Decisions", 2, "fato"],
    ["journal ## Open loops", JOURNAL, "Open loops", 2, "plano"],
    ["journal ## Today", JOURNAL, "Today", 2, "relato"],
    ["journal ## Runs", JOURNAL, "Runs", 2, "relato"],
    ["MEMORY.md ## Notas", MEMORY_MD, "Notas", 2, null],
    ["memory/notes/x.md ## Facts (not a generated file)", NOTE_X, "Facts", 2, null],
    ["MEMORY.md ### Facts (level 3)", MEMORY_MD, "Facts", 3, null],
  ];
  for (const [name, file, heading, level, want] of CASES) {
    it(`C16 ${name} reads ${String(want)}`, () => {
      expect(natureOf(file(), doc(heading, level), heading)).toBe(want);
    });
  }
});

describe("C17 an excerpt that holds a passage without lying within it", () => {
  it("C17 a natureza: fato note whose best section ## Preço holds a > [!plano] block is recalled as fato", () => {
    const dir = folder("c17");
    const file = put(
      path.join(dir, "caju.md"),
      [
        "---",
        "natureza: fato",
        "---",
        "",
        "# Caju",
        "",
        "## Preço",
        "",
        "O plano anual do caju custa R$ 900.",
        "",
        "> [!plano]",
        "> Vamos subir o caju para R$ 1 200.",
        "",
      ].join("\n"),
    );
    ctx.indexer.indexAll();
    const id = (ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(file) as { id: number }).id;
    expect(
      ctx.db.prepare("SELECT natureza, start_line, end_line FROM note_passages WHERE file_id = ?").all(id),
    ).toEqual([{ natureza: "plano", start_line: 11, end_line: 12 }]);
    const excerpt = recallOf("caju preço anual").answerContext.find((c) => c.path === file)!;
    expect(excerpt.section).toBe("Preço");
    expect(excerpt.excerpt).toContain("> Vamos subir o caju");
    expect(excerpt.natureza).toBe("fato");
  });
});
