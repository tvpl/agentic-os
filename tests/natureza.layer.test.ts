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
import { decideReview } from "../core/src/memory/reviewDecisions.js";
import { dueDay, lastReviewedDay, reviewCadence, reviewsDue } from "../core/src/memory/reviews.js";
import { suggestNatureza } from "../core/src/memory/natureza.js";
import { checkReviewDue, reviewDueAlert } from "../core/src/sentinels/reviewDue.js";
import ts from "typescript";
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
    // Door 3's place rule (amendment 14, round 3): only <home>/memory/MEMORY.md and <home>/memory/journal/AAAA-MM-DD.md.
    [
      "memory/notes/MEMORY.md ## Facts (a user's note named MEMORY.md)",
      () => path.join(memory, "notes", "MEMORY.md"),
      "Facts",
      2,
      null,
    ],
    [
      "memory/journal/notas.md ## Today (not a dated journal file)",
      () => path.join(memory, "journal", "notas.md"),
      "Today",
      2,
      null,
    ],
    [
      "memory/journal/2026/2026-10-29.md ## Today (a dated file one folder down)",
      () => path.join(memory, "journal", "2026", "2026-10-29.md"),
      "Today",
      2,
      null,
    ],
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

// ---- S3 and S4 (batch B): the queue, the sentinel's rule, the decisions and the suggestion ---------------------------

/** "Now" of every claim below: local noon of 2026-10-30, passed to the code as its clock (no fake `Date`). */
const NOW = new Date(2026, 9, 30, 12, 0, 0).getTime();
const DAY = 86_400_000;
const two = (n: number) => String(n).padStart(2, "0");
/** The local day `offset` days from today. */
const dayAt = (offset: number) => {
  const d = new Date(2026, 9, 30 + offset);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
};
const TODAY = dayAt(0);
const envOf = () => ({ paths: ctx.paths, settings: ctx.settings() });
const queue = (q: Parameters<typeof reviewsDue>[2] = {}) =>
  reviewsDue(ctx.db, envOf(), { limit: 200, now: NOW, ...q });
const itemIn = (file: string, q: Parameters<typeof reviewsDue>[2] = {}) =>
  queue(q).items.find((i) => i.path === file);
/** A note with these header lines, its `mtime` `mtimeAgo` days before today. */
const headed = (file: string, head: string[], mtimeAgo = 0, body = "# Nota\n"): string => {
  put(file, head.length ? `---\n${head.join("\n")}\n---\n${body}` : body);
  const t = new Date(2026, 9, 30 - mtimeAgo, 12).getTime() / 1000;
  fs.utimesSync(file, t, t);
  return file;
};
const decide = (input: Parameters<typeof decideReview>[1], now = NOW) =>
  decideReview({ db: ctx.db, paths: ctx.paths, settings: ctx.settings() }, input, now);
const stateRowOf = (file: string) =>
  ctx.db.prepare("SELECT last_reviewed, snooze_until, never FROM review_state WHERE path = ?").get(file);

describe("C27 the due edges of an opiniao note", () => {
  it("C27 last reviewed 91 days ago is due since yesterday, 90 days ago since today, 89 days ago not due", () => {
    const dir = folder("c27");
    const files = [91, 90, 89].map((age) =>
      headed(path.join(dir, `n${age}.md`), ["natureza: opiniao", `last_reviewed: ${dayAt(-age)}`]),
    );
    ctx.indexer.indexAll();
    expect(files.map((f) => itemIn(f)?.dueSince ?? null)).toEqual([dayAt(-1), TODAY, null]);
  });
});

describe("C28 the base of the due date, one case per row", () => {
  it("C28 no last_reviewed and mtime 91 days ago is due by the mtime", () => {
    const file = headed(path.join(folder("c28"), "m.md"), ["natureza: opiniao"], 91);
    ctx.indexer.indexAll();
    expect(itemIn(file)).toMatchObject({ dueSince: dayAt(-1), lastReviewed: null });
  });
  it("C28 last_reviewed: ontem and mtime 91 days ago is due by the mtime", () => {
    const file = headed(path.join(folder("c28"), "o.md"), ["natureza: opiniao", "last_reviewed: ontem"], 91);
    ctx.indexer.indexAll();
    expect(itemIn(file)).toMatchObject({ dueSince: dayAt(-1), lastReviewed: null });
  });
  it("C28 last_reviewed 100 days ago and a keep stored 10 days ago is not due, and lastReviewed is the later day", () => {
    const file = headed(path.join(folder("c28"), "k.md"), [
      "natureza: opiniao",
      `last_reviewed: ${dayAt(-100)}`,
    ]);
    ctx.indexer.indexAll();
    expect(itemIn(file)?.dueSince).toBe(dayAt(-10));
    decide({ path: file, action: "keep" }, NOW - 10 * DAY);
    expect(itemIn(file)).toBeUndefined();
    expect(itemIn(file, { now: NOW + 80 * DAY })?.lastReviewed).toBe(dayAt(-10));
    expect(
      lastReviewedDay(
        { last_reviewed: dayAt(-100) },
        { lastReviewed: NOW - 10 * DAY, snoozeUntil: null, never: 0 },
      ),
    ).toBe(dayAt(-10));
  });
});

describe("C29 never due, whatever the nature and age", () => {
  it("C29 review_every: never on an opiniao note last reviewed 400 days ago", () => {
    const file = headed(path.join(folder("c29"), "n.md"), [
      "natureza: opiniao",
      "review_every: never",
      `last_reviewed: ${dayAt(-400)}`,
    ]);
    ctx.indexer.indexAll();
    expect(itemIn(file)).toBeUndefined();
  });
  it("C29 review_state.never = 1 stored by action never on a copy outside memory/", () => {
    const file = headed(path.join(folder("c29"), "copia.md"), [
      "natureza: opiniao",
      `last_reviewed: ${dayAt(-400)}`,
    ]);
    ctx.indexer.indexAll();
    expect(itemIn(file)).toBeDefined();
    decide({ path: file, action: "never" });
    expect(stateRowOf(file)).toMatchObject({ never: 1 });
    expect(itemIn(file)).toBeUndefined();
  });
  for (const natureza of ["fato", "opiniao", "plano", "hipotese", "relato"]) {
    it(`C29 ${natureza} with review_every: never at 400 days`, () => {
      const file = headed(path.join(folder("c29"), `${natureza}.md`), [
        `natureza: ${natureza}`,
        "review_every: never",
        `last_reviewed: ${dayAt(-400)}`,
      ]);
      ctx.indexer.indexAll();
      expect(itemIn(file)).toBeUndefined();
    });
  }
});

describe("C30 the cadence precedence, one case per row", () => {
  const reviews = () => ctx.settings().memory.reviews;
  /** Due today when last reviewed `age` days ago with these fields (the rule itself, no index). */
  const isDue = (fields: Record<string, string>, age: number) =>
    (dueDay({ ...fields, last_reviewed: dayAt(-age) }, null, NOW, reviewCadence(fields, reviews())) ??
      "9999") <= TODAY;
  const CASES: Array<[string, Record<string, string>, number, boolean]> = [
    [
      "type status + fato at 31 is due (byType.status over cadence.fato)",
      { type: "status", natureza: "fato" },
      31,
      true,
    ],
    ["type status + fato at 29 is not", { type: "status", natureza: "fato" }, 29, false],
    ["type Status reads as status", { type: "Status", natureza: "fato" }, 31, true],
    [
      "type status + review_every 10d at 11 is due (the note over byType)",
      { type: "status", review_every: "10d" },
      11,
      true,
    ],
    [
      "type conceito + opiniao at 179 is not (byType over cadence)",
      { type: "conceito", natureza: "opiniao" },
      179,
      false,
    ],
    ["type conceito + opiniao at 181 is due", { type: "conceito", natureza: "opiniao" }, 181, true],
    ["plano at 31 is due", { natureza: "plano" }, 31, true],
    ["plano at 29 is not", { natureza: "plano" }, 29, false],
    ["hipotese at 61 is due", { natureza: "hipotese" }, 61, true],
    ["hipotese at 59 is not", { natureza: "hipotese" }, 59, false],
    ["opiniao at 91 is due", { natureza: "opiniao" }, 91, true],
    ["relato at 4000 is not", { natureza: "relato" }, 4000, false],
    ["fato at 4000 is not", { natureza: "fato" }, 4000, false],
    ["none of natureza, type, review_every at 4000 is not", {}, 4000, false],
  ];
  for (const [name, fields, age, want] of CASES)
    it(`C30 ${name}`, () => expect(isDue(fields, age)).toBe(want));
  it("C30 the same table through the queue, over indexed notes", () => {
    const dir = folder("c30");
    const files = CASES.map(([, fields, age], i) =>
      headed(path.join(dir, `n${i}.md`), [
        ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`),
        `last_reviewed: ${dayAt(-age)}`,
      ]),
    );
    ctx.indexer.indexAll();
    const listed = new Set(queue().items.map((i) => i.path));
    expect(files.map((f) => listed.has(f))).toEqual(CASES.map(([, , , want]) => want));
  });
});

describe("C32 the context of the queue", () => {
  it("C32 a context's ok path and its notes folder, never app-antigo/ nor a row under its missing path; none lists all", () => {
    const root = folder("c32");
    const app = path.join(root, "projetos", "app");
    const gone = path.join(root, "sumiu");
    const head = ["natureza: opiniao", `last_reviewed: ${dayAt(-200)}`];
    const inApp = headed(path.join(app, "a.md"), head);
    const inOld = headed(path.join(root, "projetos", "app-antigo", "b.md"), head);
    const inGone = headed(path.join(gone, "c.md"), head);
    const id = `ctx-c32-${seq}`;
    const inNotes = headed(path.join(memory, "notes", id, "d.md"), head);
    ctx.indexer.indexAll();
    fs.rmSync(gone, { recursive: true, force: true });
    const mine = [inApp, inNotes, inOld, inGone];
    const listed = (context: Parameters<typeof reviewsDue>[2]["context"]) =>
      queue({ context })
        .items.map((i) => i.path)
        .filter((p) => mine.includes(p))
        .sort();
    const context = { id, name: "C32", paths: [app, gone] };
    expect(listed(context)).toEqual([inApp, inNotes].sort());
    expect(listed(null)).toEqual([...mine].sort());
  });
});

describe("C37 what is never listed, one case per place", () => {
  it("C37 an opiniao note aged 400 days under memory/archive/ is in neither kind", () => {
    const file = headed(path.join(memory, "archive", "2026-10-01-ab12cd34", "velha.md"), [
      "natureza: opiniao",
      `last_reviewed: ${dayAt(-400)}`,
    ]);
    const loose = headed(path.join(memory, "archive", "2026-10-01-ab12cd34", "solta.md"), [], 400);
    ctx.indexer.indexAll();
    expect(itemIn(file)).toBeUndefined();
    expect(itemIn(loose, { kind: "unclassified" })).toBeUndefined();
  });
  it("C37 a plano note with status: archived aged 400 days is not due", () => {
    const file = headed(path.join(folder("c37"), "a.md"), [
      "natureza: plano",
      "status: archived",
      `last_reviewed: ${dayAt(-400)}`,
    ]);
    ctx.indexer.indexAll();
    expect(itemIn(file)).toBeUndefined();
  });
  it("C37 a plano note with status: active aged 400 days is due", () => {
    const file = headed(path.join(folder("c37"), "b.md"), [
      "natureza: plano",
      "status: active",
      `last_reviewed: ${dayAt(-400)}`,
    ]);
    ctx.indexer.indexAll();
    expect(itemIn(file)).toBeDefined();
  });
});

describe("C40 the sentinel's emit rule", () => {
  const bus = () => {
    const seen: Array<Record<string, unknown>> = [];
    return {
      seen,
      emit: (type: string, payload: Record<string, unknown>) => seen.push({ type, ...payload }),
    };
  };
  it("C40 the payload of 3 due, of 1, and none for 0", () => {
    expect(reviewDueAlert(3, 20, NOW)).toEqual({
      sentinel: "reviewDue",
      title: "3 items to review",
      body: expect.stringMatching(/\S/),
      severity: "info",
      href: "/brain/reviews",
      dedupeKey: `sentinel:reviewDue:${TODAY}:all`,
      messageParams: { count: 3, display: "3" },
    });
    expect(reviewDueAlert(1, 20, NOW)?.messageParams).toEqual({ count: 1, display: "1" });
    expect(reviewDueAlert(0, 20, NOW)).toBeNull();
  });
  it("C40 checkReviewDue emits once a day: one for a home with due notes, none when today's key is there, one the next day with its key, none with nothing due", () => {
    const own = makeTempHome("mordomo-natureza-layer-c40-");
    const home = new AppContext(own.paths.home);
    try {
      const deps = (b: ReturnType<typeof bus>, keys: Set<string>, now: number) => ({
        db: home.db,
        paths: home.paths,
        getSettings: () => home.settings(),
        bus: b as never,
        dedupe: { hasDedupeKey: (key: string) => keys.has(key) },
        now: () => now,
      });
      const empty = bus();
      expect(checkReviewDue(deps(empty, new Set(), NOW))).toEqual([]);
      for (let i = 0; i < 3; i++)
        put(
          path.join(home.paths.memory, "notes", `n${i}.md`),
          `---\nnatureza: opiniao\nlast_reviewed: ${dayAt(-200)}\n---\n# N\n`,
        );
      home.indexer.addImplicitRoot({ path: home.paths.memory, area: null, enabled: true });
      home.indexer.indexAll();
      const first = bus();
      const keys = new Set<string>();
      expect(checkReviewDue(deps(first, keys, NOW)).map((p) => p.messageParams)).toEqual([
        { count: 3, display: "3" },
      ]);
      expect(first.seen).toHaveLength(1);
      keys.add(`sentinel:reviewDue:${TODAY}:all`);
      expect(checkReviewDue(deps(bus(), keys, NOW))).toEqual([]);
      expect(checkReviewDue(deps(bus(), keys, NOW + DAY)).map((p) => p.dedupeKey)).toEqual([
        `sentinel:reviewDue:${dayAt(1)}:all`,
      ]);
    } finally {
      home.close();
      own.cleanup();
    }
  });
});

describe("C48 snooze at its own layer", () => {
  it("C48 snooze 14 stores snooze_until = now + 14 days on an editable note and an outside file, and writes neither", () => {
    const editable = headed(path.join(memory, "notes", `c48-${++seq}`, "n.md"), ["natureza: opiniao"]);
    const outside = headed(path.join(folder("c48"), "f.md"), ["natureza: opiniao"]);
    ctx.indexer.indexAll();
    for (const file of [editable, outside]) {
      const bytes = fs.readFileSync(file);
      expect(decide({ path: file, action: "snooze", days: 14 }).state).toEqual({
        lastReviewed: null,
        snoozeUntil: NOW + 14 * 86_400_000,
        never: 0,
      });
      expect(stateRowOf(file), file).toEqual({ last_reviewed: null, snooze_until: NOW + 14 * DAY, never: 0 });
      expect(fs.readFileSync(file).equals(bytes), file).toBe(true);
    }
  });
  it("C48 days 1 and 365 are stored; 0, 366, 1.5 and missing are refused with 400 validation and store nothing", () => {
    const dir = folder("c48");
    const [one, year, refused] = ["um.md", "ano.md", "recusa.md"].map((n) =>
      headed(path.join(dir, n), ["natureza: plano"]),
    );
    ctx.indexer.indexAll();
    expect(decide({ path: one!, action: "snooze", days: 1 }).state?.snoozeUntil).toBe(NOW + DAY);
    expect(decide({ path: year!, action: "snooze", days: 365 }).state?.snoozeUntil).toBe(NOW + 365 * DAY);
    for (const days of [0, 366, 1.5, undefined]) {
      const refusal = (() => {
        try {
          decide({ path: refused!, action: "snooze", days });
          return null;
        } catch (err) {
          return err as { statusCode?: number; code?: string };
        }
      })();
      expect([refusal?.statusCode, refusal?.code], String(days)).toEqual([400, "validation"]);
      expect(stateRowOf(refused!), String(days)).toBeUndefined();
    }
  });
});

describe("C56 previous and restore at their own layer", () => {
  it("C56 previous is null with no row and the row as it was with one; restore puts it back, restore null removes it, on an editable note too, and no file is written", () => {
    const outside = headed(path.join(folder("c56"), "f.md"), [
      "natureza: opiniao",
      `last_reviewed: ${dayAt(-200)}`,
    ]);
    const editable = headed(path.join(memory, "notes", `c56-${++seq}`, "n.md"), [
      "natureza: opiniao",
      `last_reviewed: ${dayAt(-200)}`,
    ]);
    ctx.indexer.indexAll();
    const keep = decide({ path: outside, action: "keep" }, NOW - DAY);
    expect(keep.previous).toBeNull();
    const snooze = decide({ path: outside, action: "snooze", days: 30 });
    expect(snooze.previous).toEqual({ lastReviewed: NOW - DAY, snoozeUntil: null, never: 0 });
    const bytes = fs.readFileSync(outside);
    const restored = decide({ path: outside, action: "restore", state: snooze.previous });
    expect(restored.state).toEqual({ lastReviewed: NOW - DAY, snoozeUntil: null, never: 0 });
    expect(stateRowOf(outside)).toEqual({ last_reviewed: NOW - DAY, snooze_until: null, never: 0 });
    expect(fs.readFileSync(outside).equals(bytes)).toBe(true);
    expect(itemIn(outside)).toBeUndefined();

    const text = fs.readFileSync(editable);
    expect(itemIn(editable)).toBeDefined();
    const hide = decide({ path: editable, action: "snooze", days: 7 });
    expect(itemIn(editable)).toBeUndefined();
    expect(decide({ path: editable, action: "restore", state: hide.previous }).state).toBeNull();
    expect(stateRowOf(editable)).toBeUndefined();
    expect(fs.readFileSync(editable).equals(text)).toBe(true);
    expect(itemIn(editable)).toBeDefined();
  });
});

describe("C61 the suggestion, one case per row", () => {
  const CASES: Array<[string, string | null]> = [
    ["Vamos lançar em março; planejamos três turmas.", "plano"],
    ["We will ship it. We plan to grow.", "plano"],
    ["Acho que o preço está alto.", "opiniao"],
    ["In my view this is wrong.", "opiniao"],
    ["Vamos tentar. Lançamos a primeira e lançamos a segunda.", null],
    ["Vamos tentar. Fizemos a primeira.", null],
    ["Vamos lançar. Acho que vai dar certo.", "plano"],
    ["PLANEJAMOS três turmas.", "plano"],
    ["planejamos três turmas.", "plano"],
    ["O curso tem três turmas.", null],
  ];
  for (const [text, want] of CASES)
    it(`C61 ${JSON.stringify(text)} suggests ${want}`, () => expect(suggestNatureza(text)).toBe(want));
  it("C61 the queue reads the text the index stored: a file changed on disk after its pass keeps the suggestion of the stored text", () => {
    const dir = path.join(memory, "notes", `c61-${++seq}`);
    const file = headed(path.join(dir, "n.md"), [], 0, "# N\nAcho que o preço está alto.\n");
    ctx.indexer.indexAll();
    put(file, "# N\nVamos lançar em março; planejamos três turmas.\n");
    expect(itemIn(file, { kind: "unclassified" })?.suggested).toBe("opiniao");
  });
});

describe("C62 the queue and the suggestion write nothing", () => {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const FS = new Set(["node:fs", "fs", "node:fs/promises", "fs/promises"]);
  const WRITERS = new Set(["setProperties", "saveProperties", "writeWorkspaceFile"]);
  const OWN = ["core/src/security/safeWrite", "core/src/memory/notes"];
  /** A module the queue may not import: `node:fs` in any spelling, or (resolved from `file`) safeWrite.ts or notes.ts. */
  const forbiddenModule = (spec: string, file: string): string | null => {
    if (FS.has(spec)) return spec;
    if (!spec.startsWith(".")) return null;
    const resolved = path
      .relative(repoRoot, path.resolve(path.dirname(path.join(repoRoot, file)), spec))
      .replace(/\.(js|ts)$/, "");
    return OWN.includes(resolved) ? `${resolved}.ts` : null;
  };
  /**
   * What a module imports of the forbidden ones and which writers it calls, read on the syntax tree: a default, a
   * namespace, a named or a renamed import, an `export … from`, an `import x = require()` and a `require()`; a call by
   * the name, by a renamed binding, through a namespace or a property, or by `obj["name"]`. Not covered: a dynamic
   * `import()`, a writer received as a parameter, `Reflect`, `eval`, `Function`.
   */
  function forbiddenUses(file: string, source: string): string[] {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const out: string[] = [];
    const aliases = new Map<string, string>();
    const learn = (name: ts.BindingName | ts.Identifier, imported: string) => {
      if (ts.isIdentifier(name) && WRITERS.has(imported)) aliases.set(name.text, imported);
    };
    const collect = (node: ts.Node): void => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const bad = forbiddenModule(node.moduleSpecifier.text, file);
        if (bad) out.push(`import ${bad}`);
        const bindings = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : undefined;
        if (bindings && ts.isNamedImports(bindings))
          for (const el of bindings.elements) learn(el.name, (el.propertyName ?? el.name).text);
      }
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        const spec = node.moduleReference.expression;
        if (ts.isStringLiteral(spec)) {
          const bad = forbiddenModule(spec.text, file);
          if (bad) out.push(`import ${bad}`);
        }
      }
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require"
      ) {
        const spec = node.arguments[0];
        if (spec && ts.isStringLiteral(spec)) {
          const bad = forbiddenModule(spec.text, file);
          if (bad) out.push(`require ${bad}`);
        }
        const decl = node.parent;
        if (ts.isVariableDeclaration(decl) && ts.isObjectBindingPattern(decl.name))
          for (const el of decl.name.elements) {
            const key = el.propertyName ?? el.name;
            if (ts.isIdentifier(key)) learn(el.name, key.text);
          }
      }
      ts.forEachChild(node, collect);
    };
    collect(sf);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const name = ts.isIdentifier(callee)
          ? (aliases.get(callee.text) ?? callee.text)
          : ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : ts.isElementAccessExpression(callee) && ts.isStringLiteral(callee.argumentExpression)
              ? callee.argumentExpression.text
              : null;
        if (name !== null && WRITERS.has(name)) out.push(`call ${name}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
  }

  const SELF: Array<[string, string, string[]]> = [
    ["a default import of node:fs", 'import fs from "node:fs";', ["import node:fs"]],
    ["a namespace import of fs", 'import * as nfs from "fs";', ["import fs"]],
    [
      "a named import of node:fs/promises",
      'import { readFile } from "node:fs/promises";',
      ["import node:fs/promises"],
    ],
    [
      "a renamed import of fs/promises",
      'import { writeFile as wf } from "fs/promises";',
      ["import fs/promises"],
    ],
    [
      "an import of safeWrite.ts by its relative path",
      'import { writeWorkspaceFile } from "../security/safeWrite.js";',
      ["import core/src/security/safeWrite.ts"],
    ],
    [
      "an import of notes.ts by its relative path",
      'import * as notes from "./notes.js";',
      ["import core/src/memory/notes.ts"],
    ],
    [
      "a re-export from notes.ts",
      'export { saveProperties } from "./notes.js";',
      ["import core/src/memory/notes.ts"],
    ],
    ["an import = require of node:fs", 'import fs = require("node:fs");', ["import node:fs"]],
    ["a require of notes.ts", 'const n = require("./notes.js");', ["require core/src/memory/notes.ts"]],
    [
      "a call by the name",
      'import { setProperties } from "./frontMatter.js";\nsetProperties("", {});',
      ["call setProperties"],
    ],
    [
      "a call by a renamed import",
      'import { setProperties as sp } from "./frontMatter.js";\nsp("", {});',
      ["call setProperties"],
    ],
    [
      "a call by a renamed require",
      'const { saveProperties: s } = require("./x.js");\ns();',
      ["call saveProperties"],
    ],
    [
      "a call through a namespace",
      'import * as fm from "./frontMatter.js";\nfm.setProperties("", {});',
      ["call setProperties"],
    ],
    [
      'a call by obj["name"]',
      'import * as fm from "./frontMatter.js";\nfm["setProperties"]("", {});',
      ["call setProperties"],
    ],
    [
      "the names in a comment or a string",
      '// import fs from "node:fs"; saveProperties()\nconst s = "writeWorkspaceFile(x)";',
      [],
    ],
    [
      "an allowed module and an allowed call",
      'import { parsePassages } from "./natureza.js";\nparsePassages("");',
      [],
    ],
  ];
  for (const [name, source, want] of SELF)
    it(`C62 the walker sees ${name}`, () =>
      expect(forbiddenUses("core/src/memory/sample.ts", source)).toEqual(want));

  it("C62 core/src/memory/reviews.ts and the suggestion's module (natureza.ts) import no file writer and call none", () => {
    for (const rel of ["core/src/memory/reviews.ts", "core/src/memory/natureza.ts"]) {
      expect(forbiddenUses(rel, fs.readFileSync(path.join(repoRoot, rel), "utf8")), rel).toEqual([]);
    }
  });

  it("C62 the queue of both kinds leaves every file and the review_state rows as they were", () => {
    headed(path.join(memory, "notes", `c62-${++seq}`, "n.md"), [
      "natureza: opiniao",
      `last_reviewed: ${dayAt(-200)}`,
    ]);
    ctx.indexer.indexAll();
    const snapshot = () => {
      const files: Record<string, string> = {};
      const walk = (p: string) => {
        for (const e of fs.readdirSync(p, { withFileTypes: true })) {
          const full = path.join(p, e.name);
          if (e.isDirectory()) walk(full);
          else files[full] = fs.readFileSync(full).toString("base64");
        }
      };
      walk(memory);
      walk(work);
      return { files, rows: ctx.db.prepare("SELECT * FROM review_state ORDER BY path").all() };
    };
    const before = snapshot();
    queue({ kind: "due" });
    queue({ kind: "unclassified" });
    expect(snapshot()).toEqual(before);
  });
});
