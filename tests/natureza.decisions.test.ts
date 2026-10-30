import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { movingClock } from "./helpers/movingClock.js";
import { notesViewWorld, sha, type Json, type NotesViewWorld } from "./helpers/notesViewWorld.js";

/**
 * .specs/features/cerebro-natureza, batch B, S4: `POST /api/memory/reviews` through `app.inject` against
 * `buildServer` over a real home, each decision read back from the file, the `review_state` table and the next
 * `GET /api/memory/reviews` (never a seeded row). "Now" is `movingClock(NOW)`: a decision's own instant is the
 * `updated_at` of the row it writes, and the dates it writes are the local day of `NOW`. The rules at their own layer
 * are in `natureza.layer.test.ts`.
 */

const NOW = new Date(2026, 9, 30, 12, 0, 0).getTime();
const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const day = (offset: number) => {
  const d = new Date(2026, 9, 30 + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const TODAY = day(0);

let w: NotesViewWorld;
let seq = 0;
let clock: ReturnType<typeof movingClock>;

beforeAll(async () => {
  clock = movingClock(NOW);
  w = await notesViewWorld("mordomo-natureza-decisions-");
});
afterEach(() => {
  vi.restoreAllMocks();
  clock = movingClock(NOW);
});
afterAll(async () => {
  await w.close();
  clock.restore();
});

const decide = (body: Json) => w.call("POST", "/api/memory/reviews", body);
const ok = async (body: Json) => {
  const res = await decide(body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};
const code = (res: { status: number; body: Json }) => [res.status, res.body?.error?.code];
const bytes = (file: string) => fs.readFileSync(file);
const stateRow = (file: string) =>
  w.ctx.db
    .prepare("SELECT last_reviewed, snooze_until, never, updated_at FROM review_state WHERE path = ?")
    .get(file) as
    | { last_reviewed: number | null; snooze_until: number | null; never: number; updated_at: number }
    | undefined;
const factCount = () => (w.ctx.db.prepare("SELECT COUNT(*) AS n FROM facts").get() as { n: number }).n;
async function dueList(query = "kind=due&limit=200") {
  const res = await w.call("GET", `/api/memory/reviews?${query}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.items as Json[]).map((i) => i.path as string);
}
const notesDir = (name: string) => path.join(w.memory, "notes", `${name}-${++seq}`);
/** A note with this front matter (the lines as written) and body. */
const put = (file: string, head: string[], body = "# Nota\n\nTexto.\n") =>
  w.put(file, head.length ? `---\n${head.join("\n")}\n---\n${body}` : body);
const indexed = async (...files: string[]) => {
  await w.index();
  for (const f of files)
    expect(w.ctx.db.prepare("SELECT 1 FROM files WHERE path = ?").get(f), f).toBeDefined();
};
const versionOf = (file: string) => sha(bytes(file));

describe("S4 still holds", () => {
  it("C45 keep on an editable due note writes only last_reviewed (changed, or added before the closing ---), answers its new version and previous null, and the note leaves the list", async () => {
    const dir = notesDir("c45");
    const changed = put(path.join(dir, "a.md"), [
      "natureza: opiniao",
      `last_reviewed: ${day(-120)}`,
      "tags: [x]",
    ]);
    const added = put(path.join(dir, "b.md"), ["natureza: opiniao", "tags: [y]"]);
    const t = (NOW - 120 * DAY) / 1000;
    fs.utimesSync(added, t, t);
    await indexed(changed, added);
    expect(await dueList()).toEqual(expect.arrayContaining([changed, added]));

    const before = bytes(changed).toString();
    const a = await ok({ path: changed, action: "keep", baseVersion: versionOf(changed) });
    const afterA = bytes(changed).toString();
    expect(afterA).toBe(before.replace(`last_reviewed: ${day(-120)}`, `last_reviewed: ${TODAY}`));
    expect(a).toEqual({ path: changed, version: sha(afterA), previous: null, state: null });

    const beforeB = bytes(added).toString();
    const b = await ok({ path: added, action: "keep", baseVersion: versionOf(added) });
    const afterB = bytes(added).toString();
    expect(afterB).toBe(beforeB.replace("tags: [y]\n---\n", `tags: [y]\nlast_reviewed: ${TODAY}\n---\n`));
    expect(b.version).toBe(sha(afterB));
    expect(b.previous).toBeNull();

    const list = await dueList();
    expect(list).not.toContain(changed);
    expect(list).not.toContain(added);
    expect(stateRow(changed)).toBeUndefined();
    expect(stateRow(added)).toBeUndefined();
  });

  it("C46 keep on a due file of an indexed folder stores review_state.last_reviewed = now, answers no version, leaves the file's bytes, mtime and inode, and the file leaves the list", async () => {
    const root = w.indexedRoot(`c46-${++seq}`);
    const file = put(path.join(root, "fora.md"), [
      "natureza: opiniao",
      "review_every: 30d",
      `last_reviewed: ${day(-40)}`,
    ]);
    await indexed(file);
    expect(await dueList()).toContain(file);
    const st = fs.statSync(file);
    const was = bytes(file);
    const t0 = Date.now();
    const res = await ok({ path: file, action: "keep" });
    const t1 = Date.now();
    expect(res).not.toHaveProperty("version");
    const row = stateRow(file)!;
    expect(row.last_reviewed).toBe(row.updated_at);
    expect(row.last_reviewed).toBeGreaterThanOrEqual(t0);
    expect(row.last_reviewed).toBeLessThanOrEqual(t1);
    expect(res.state).toEqual({ lastReviewed: row.last_reviewed, snoozeUntil: null, never: 0 });
    expect(bytes(file).equals(was)).toBe(true);
    const now = fs.statSync(file);
    expect([now.mtimeMs, now.ino]).toEqual([st.mtimeMs, st.ino]);
    expect(await dueList()).not.toContain(file);
    // Read back through the list once that review falls due: its lastReviewed is today.
    clock.set(NOW + 31 * DAY);
    const back = await w.call("GET", "/api/memory/reviews?kind=due&limit=200");
    expect((back.body.items as Json[]).find((i) => i.path === file)?.lastReviewed).toBe(TODAY);
  });

  it("C47 keep on the files of memory/ that are not editable goes to review_state and writes no file, one case per place", async () => {
    const places = [
      "journal/2026-10-01.md",
      "areas/vendas.md",
      "ROUTER.md",
      "contexts/x.md",
      "notes/b.markdown",
    ];
    const files = places.map((rel) =>
      put(path.join(w.memory, rel), ["natureza: opiniao", `last_reviewed: ${day(-200)}`], `# ${rel}\n`),
    );
    await indexed(...files);
    for (const file of files) {
      const was = bytes(file);
      const res = await ok({ path: file, action: "keep" });
      expect(res, file).not.toHaveProperty("version");
      const row = stateRow(file);
      expect(row?.last_reviewed, file).toBe(row?.updated_at);
      expect(bytes(file).equals(was), file).toBe(true);
    }
    const list = await dueList();
    for (const file of files) expect(list, file).not.toContain(file);
  });
});

describe("S4 snooze and never", () => {
  it("C48 snooze 14 stores snooze_until = now + 14 days for an editable note and an outside file, writing neither; 1 and 365 are stored; 0, 366, 1.5 and missing are 400 validation and store nothing", async () => {
    const dir = notesDir("c48");
    const root = w.indexedRoot(`c48-${seq}`);
    const files = [
      put(path.join(dir, "nota.md"), ["natureza: opiniao", `last_reviewed: ${day(-200)}`]),
      put(path.join(root, "fora.md"), ["natureza: opiniao", `last_reviewed: ${day(-200)}`]),
    ];
    const one = put(path.join(root, "um.md"), ["natureza: plano"]);
    const year = put(path.join(root, "ano.md"), ["natureza: plano"]);
    const refused = put(path.join(root, "recusa.md"), ["natureza: plano"]);
    await indexed(...files, one, year, refused);
    for (const file of files) {
      const was = bytes(file);
      const mtime = fs.statSync(file).mtimeMs;
      const res = await ok({ path: file, action: "snooze", days: 14 });
      const row = stateRow(file)!;
      expect(row.snooze_until, file).toBe(row.updated_at + 14 * 86_400_000);
      expect(res.state.snoozeUntil, file).toBe(row.snooze_until);
      expect(res, file).not.toHaveProperty("version");
      expect(bytes(file).equals(was), file).toBe(true);
      expect(fs.statSync(file).mtimeMs, file).toBe(mtime);
    }
    for (const [file, days] of [
      [one, 1],
      [year, 365],
    ] as const) {
      await ok({ path: file, action: "snooze", days });
      const row = stateRow(file)!;
      expect(row.snooze_until, String(days)).toBe(row.updated_at + days * DAY);
    }
    for (const days of [0, 366, 1.5, undefined]) {
      const res = await decide({ path: refused, action: "snooze", ...(days !== undefined ? { days } : {}) });
      expect(code(res), String(days)).toEqual([400, "validation"]);
      expect(stateRow(refused), String(days)).toBeUndefined();
    }
  });

  it("C49 never gives an editable note the line review_every: never and no row, and an outside file review_state.never = 1 with the file unchanged; each leaves the list", async () => {
    const dir = notesDir("c49");
    const root = w.indexedRoot(`c49-${seq}`);
    const editable = put(path.join(dir, "nota.md"), ["natureza: opiniao", `last_reviewed: ${day(-200)}`]);
    const outside = put(path.join(root, "fora.md"), ["natureza: opiniao", `last_reviewed: ${day(-200)}`]);
    await indexed(editable, outside);
    expect(await dueList()).toEqual(expect.arrayContaining([editable, outside]));
    const text = bytes(editable).toString();
    await ok({ path: editable, action: "never", baseVersion: versionOf(editable) });
    expect(bytes(editable).toString()).toBe(text.replace("\n---\n", "\nreview_every: never\n---\n"));
    expect(stateRow(editable)).toBeUndefined();
    const was = bytes(outside);
    const res = await ok({ path: outside, action: "never" });
    expect(stateRow(outside)?.never).toBe(1);
    expect(res.state).toEqual({ lastReviewed: null, snoozeUntil: null, never: 1 });
    expect(bytes(outside).equals(was)).toBe(true);
    const list = await dueList();
    expect(list).not.toContain(editable);
    expect(list).not.toContain(outside);
  });
});

describe("S4 became real, changed my mind", () => {
  /** The header lines of a note, and its body. */
  const parts = (text: string) => {
    const end = text.indexOf("\n---\n", 4);
    return { head: text.slice(4, end).split("\n"), body: text.slice(end + 5) };
  };

  it("C50 became_fact writes natureza: fato, was, became_fact and last_reviewed bare, keeps every other byte, and asserts the fact given with the note as its source", async () => {
    const dir = notesDir("c50");
    const make = (name: string, natureza: string) =>
      put(
        path.join(dir, name),
        [`natureza: ${natureza}`, `last_reviewed: ${day(-60)}`, "tags: [curso]", "owner: Ana"],
        "# Curso\n\nLançar em março.\n",
      );
    const plano = make("plano.md", "plano");
    const comFato = make("com-fato.md", "plano");
    const semData = make("sem-data.md", "plano");
    const hipotese = make("hipotese.md", "hipotese");
    await indexed(plano, comFato, semData, hipotese);

    // No fact: the header, line by line, and the body byte for byte; no new fact.
    const facts = factCount();
    const old = parts(bytes(plano).toString());
    const res = await ok({ path: plano, action: "became_fact", baseVersion: versionOf(plano) });
    const now = parts(bytes(plano).toString());
    expect(now.body).toBe(old.body);
    expect([...now.head].sort()).toEqual(
      [
        ...old.head.filter((l) => !l.startsWith("natureza:") && !l.startsWith("last_reviewed:")),
        "natureza: fato",
        "was: plano",
        `became_fact: ${TODAY}`,
        `last_reviewed: ${TODAY}`,
      ].sort(),
    );
    expect(res).not.toHaveProperty("fact");
    expect(factCount()).toBe(facts);
    const listed = await w.call("GET", "/api/memory/facts?subject=curso");
    expect(listed.body.facts).toEqual([]);

    // With a fact and its validFrom.
    const validFrom = new Date(2026, 9, 1).getTime();
    const given = await ok({
      path: comFato,
      action: "became_fact",
      baseVersion: versionOf(comFato),
      fact: { subject: "curso", predicate: "lançamento", object: "março", validFrom },
    });
    const read = await w.call("GET", "/api/memory/facts?subject=curso");
    expect(read.body.facts).toHaveLength(1);
    expect(read.body.facts[0]).toMatchObject({
      subject: "curso",
      predicate: "lançamento",
      object: "março",
      sourcePath: comFato,
      validFrom,
    });
    expect(given.fact).toEqual(read.body.facts[0]);

    // With no validFrom: the decision's now.
    const t0 = Date.now();
    const plain = await ok({
      path: semData,
      action: "became_fact",
      baseVersion: versionOf(semData),
      fact: { subject: "turma", predicate: "vagas", object: "30" },
    });
    expect(plain.fact.validFrom).toBeGreaterThanOrEqual(t0);
    expect(plain.fact.validFrom).toBeLessThanOrEqual(Date.now());
    expect(plain.fact.sourcePath).toBe(semData);

    await ok({ path: hipotese, action: "became_fact", baseVersion: versionOf(hipotese) });
    expect(parts(bytes(hipotese).toString()).head).toContain("was: hipotese");
  });

  it("C51 the order of the two writes: a stale baseVersion is 409 with no fact, an empty subject is 400 before anything, and a fact that fails after the note was written is 500 with the note written", async () => {
    const dir = notesDir("c51");
    const file = put(path.join(dir, "p.md"), ["natureza: plano", `last_reviewed: ${day(-60)}`]);
    await indexed(file);
    const fact = { subject: "c51", predicate: "estado", object: "feito" };
    const facts = factCount();
    const was = bytes(file);

    const stale = await decide({ path: file, action: "became_fact", baseVersion: sha("outra"), fact });
    expect(code(stale)).toEqual([409, "edit_conflict"]);
    expect(factCount()).toBe(facts);
    expect(bytes(file).equals(was)).toBe(true);

    const empty = await decide({
      path: file,
      action: "became_fact",
      baseVersion: versionOf(file),
      fact: { ...fact, subject: "" },
    });
    expect(code(empty)).toEqual([400, "validation"]);
    expect(factCount()).toBe(facts);
    expect(bytes(file).equals(was)).toBe(true);

    w.ctx.db.exec("CREATE TRIGGER c51_no_fact BEFORE INSERT ON facts BEGIN SELECT RAISE(ABORT, 'c51'); END");
    try {
      const failed = await decide({ path: file, action: "became_fact", baseVersion: versionOf(file), fact });
      expect(failed.status).toBe(500);
    } finally {
      w.ctx.db.exec("DROP TRIGGER c51_no_fact");
    }
    expect(factCount()).toBe(facts);
    const text = bytes(file).toString();
    expect(text).toContain("natureza: fato\n");
    expect(text).toContain(`became_fact: ${TODAY}\n`);
  });

  // C52 is open: its claim says the same inode, and the guarded properties write door 4 names (saveProperties ->
  // writeWorkspaceFile replace) replaces the file by a temporary file and a rename, so the inode always changes. This
  // test holds the rest of C52's claim and is not its proof (its title does not carry the id).
  it("abandon writes status: archived and abandoned bare, keeps natureza: plano and the path, creates or removes nothing under the home, and the note leaves the list (the rest of C52: its inode clause is open)", async () => {
    const dir = notesDir("c52");
    const file = put(path.join(dir, "p.md"), ["natureza: plano", `last_reviewed: ${day(-60)}`]);
    await indexed(file);
    expect(await dueList()).toContain(file);
    const names = () => {
      const out: string[] = [];
      const walk = (p: string) => {
        for (const e of fs.readdirSync(p, { withFileTypes: true })) {
          out.push(path.join(p, e.name));
          if (e.isDirectory()) walk(path.join(p, e.name));
        }
      };
      walk(w.home);
      return out.sort();
    };
    const before = names();
    await ok({ path: file, action: "abandon", baseVersion: versionOf(file) });
    expect(names()).toEqual(before);
    expect(fs.statSync(file).isFile()).toBe(true);
    const head = bytes(file).toString().split("\n---\n")[0]!.split("\n");
    expect(head).toEqual(
      expect.arrayContaining(["natureza: plano", "status: archived", `abandoned: ${TODAY}`]),
    );
    expect(await dueList()).not.toContain(file);
  });
});

describe("S4 what is refused", () => {
  it("C53 became_fact, abandon and classify answer 403 note_not_editable outside what is editable, writing nothing and leaving review_state as it was, one case per place and action", async () => {
    const root = w.indexedRoot(`c53-${++seq}`);
    const files = [
      put(path.join(root, "fora.md"), ["natureza: plano"]),
      put(path.join(w.memory, "ROUTER.md"), ["natureza: plano"]),
      put(path.join(w.memory, "areas", "vendas.md"), ["natureza: plano"]),
      put(path.join(w.memory, "journal", "2026-10-01.md"), ["natureza: plano"]),
      put(path.join(w.memory, "contexts", "x.md"), ["natureza: plano"]),
    ];
    await indexed(...files);
    const facts = factCount();
    for (const file of files) {
      await ok({ path: file, action: "snooze", days: 3 });
      for (const body of [
        { action: "became_fact", fact: { subject: "s", predicate: "p", object: "o" } },
        { action: "abandon" },
        { action: "classify", natureza: "fato" },
      ]) {
        const was = bytes(file);
        const row = stateRow(file);
        const res = await decide({ path: file, baseVersion: versionOf(file), ...body });
        expect(code(res), `${file} ${body.action}`).toEqual([403, "note_not_editable"]);
        expect(bytes(file).equals(was), `${file} ${body.action}`).toBe(true);
        expect(stateRow(file), `${file} ${body.action}`).toEqual(row);
      }
    }
    expect(factCount()).toBe(facts);
  });

  it("C54 with a baseVersion that is not the file's, keep, never, became_fact, abandon and classify each answer 409 edit_conflict, write nothing, store no row and assert no fact", async () => {
    const dir = notesDir("c54");
    const file = put(path.join(dir, "p.md"), ["natureza: plano", `last_reviewed: ${day(-60)}`]);
    await indexed(file);
    const facts = factCount();
    const was = bytes(file);
    for (const body of [
      { action: "keep" },
      { action: "never" },
      { action: "became_fact", fact: { subject: "s54", predicate: "p", object: "o" } },
      { action: "abandon" },
      { action: "classify", natureza: "fato" },
    ]) {
      const res = await decide({ path: file, baseVersion: sha("not the note"), ...body });
      expect(code(res), body.action).toEqual([409, "edit_conflict"]);
      expect(bytes(file).equals(was), body.action).toBe(true);
      expect(stateRow(file), body.action).toBeUndefined();
    }
    expect(factCount()).toBe(facts);
  });

  it("C55 the other refusals, each alone and writing nothing", async () => {
    const dir = notesDir("c55");
    // 404: no indexed file at the path; and a file today's policy excludes.
    const nowhere = path.join(dir, "nao-existe.md");
    expect(code(await decide({ path: nowhere, action: "snooze", days: 3 }))).toEqual([404, "not_found"]);
    expect(stateRow(nowhere)).toBeUndefined();
    const hidden = put(path.join(dir, "escondido", "h.md"), ["natureza: plano"]);
    const link = put(path.join(dir, "real", "l.md"), ["natureza: plano"]);
    const open = put(path.join(dir, "aberto.md"), [], "---\nnatureza: plano\n# sem fim do cabeçalho\n");
    const big = put(
      path.join(dir, "grande.md"),
      ["natureza: plano"],
      `# Grande\n${"x".repeat(1024 * 1024 + 10)}\n`,
    );
    const fine = put(path.join(dir, "bom.md"), ["natureza: plano"]);
    await indexed(hidden, link, open, big, fine);
    w.update((s) => {
      s.excludes = [...s.excludes, "escondido"];
    });
    try {
      expect(code(await decide({ path: hidden, action: "snooze", days: 3 }))).toEqual([404, "not_found"]);
      expect(stateRow(hidden)).toBeUndefined();
    } finally {
      w.update((s) => {
        s.excludes = s.excludes.filter((e) => e !== "escondido");
      });
    }

    // 403 forbidden_path: the folder on the way is now a link to where the note went.
    const away = w.outside(`c55-away-${seq}`);
    fs.renameSync(path.join(dir, "real"), path.join(away, "real"));
    fs.symlinkSync(path.join(away, "real"), path.join(dir, "real"));
    const linked = bytes(link);
    expect(code(await decide({ path: link, action: "keep", baseVersion: sha(linked) }))).toEqual([
      403,
      "forbidden_path",
    ]);
    expect(bytes(link).equals(linked)).toBe(true);
    expect(stateRow(link)).toBeUndefined();

    // 409 front_matter_unreadable, 413 note_too_large.
    const openWas = bytes(open);
    expect(code(await decide({ path: open, action: "keep", baseVersion: sha(openWas) }))).toEqual([
      409,
      "front_matter_unreadable",
    ]);
    expect(bytes(open).equals(openWas)).toBe(true);
    const bigWas = bytes(big);
    expect(code(await decide({ path: big, action: "keep", baseVersion: sha(bigWas) }))).toEqual([
      413,
      "note_too_large",
    ]);
    expect(bytes(big).equals(bigWas)).toBe(true);

    // 400 validation, each alone.
    const fineWas = bytes(fine);
    for (const body of [
      { action: "delete", baseVersion: sha(fineWas) },
      { action: "classify", baseVersion: sha(fineWas) },
      { action: "classify", natureza: "talvez", baseVersion: sha(fineWas) },
      { action: "keep" },
    ]) {
      const res = await decide({ path: fine, ...body });
      expect(code(res), JSON.stringify(body)).toEqual([400, "validation"]);
      expect(bytes(fine).equals(fineWas), JSON.stringify(body)).toBe(true);
      expect(stateRow(fine), JSON.stringify(body)).toBeUndefined();
    }
    for (const f of [open, big]) expect(stateRow(f), f).toBeUndefined();
  });
});

describe("S4 undo and what each decision leaves", () => {
  it("C56 every answer carries previous; restore puts back the row a snooze replaced, restore null removes it, writes no file and works on an editable note, and the list is as before the decision", async () => {
    const root = w.indexedRoot(`c56-${++seq}`);
    const dir = notesDir("c56");
    const outside = put(path.join(root, "fora.md"), ["natureza: opiniao", `last_reviewed: ${day(-200)}`]);
    const editable = put(path.join(dir, "nota.md"), ["natureza: opiniao", `last_reviewed: ${day(-200)}`]);
    await indexed(outside, editable);

    const keep = await ok({ path: outside, action: "keep" });
    expect(keep.previous).toBeNull();
    const kept = stateRow(outside)!;
    expect(await dueList()).not.toContain(outside);
    const snooze = await ok({ path: outside, action: "snooze", days: 30 });
    expect(snooze.previous).toEqual({ lastReviewed: kept.last_reviewed, snoozeUntil: null, never: 0 });
    const was = bytes(outside);
    const restored = await ok({ path: outside, action: "restore", state: snooze.previous });
    expect(restored.previous).toEqual(snooze.state);
    const row = stateRow(outside)!;
    expect([row.last_reviewed, row.snooze_until, row.never]).toEqual([kept.last_reviewed, null, 0]);
    expect(bytes(outside).equals(was)).toBe(true);
    expect(await dueList()).not.toContain(outside);

    expect(await dueList()).toContain(editable);
    const text = bytes(editable);
    const hide = await ok({ path: editable, action: "snooze", days: 7 });
    expect(hide.previous).toBeNull();
    expect(await dueList()).not.toContain(editable);
    const undo = await ok({ path: editable, action: "restore", state: hide.previous });
    expect(undo.state).toBeNull();
    expect(stateRow(editable)).toBeUndefined();
    expect(bytes(editable).equals(text)).toBe(true);
    expect(await dueList()).toContain(editable);
  });

  it("C57 restore without state, with state.never 2, and with state.snoozeUntil amanhã each answer 400 validation and leave the row", async () => {
    const root = w.indexedRoot(`c57-${++seq}`);
    const file = put(path.join(root, "f.md"), ["natureza: opiniao"]);
    await indexed(file);
    await ok({ path: file, action: "snooze", days: 5 });
    const row = stateRow(file);
    for (const extra of [
      {},
      { state: { lastReviewed: null, snoozeUntil: null, never: 2 } },
      { state: { lastReviewed: null, snoozeUntil: "amanhã", never: 0 } },
    ]) {
      const res = await decide({ path: file, action: "restore", ...extra });
      expect(code(res), JSON.stringify(extra)).toEqual([400, "validation"]);
      expect(stateRow(file), JSON.stringify(extra)).toEqual(row);
    }
  });

  it("C58 after each decision the next GET reflects it, and requestIndexPaths was called once with that path only", async () => {
    const dir = notesDir("c58");
    const root = w.indexedRoot(`c58-${seq}`);
    const due = (name: string, natureza = "plano") =>
      put(path.join(dir, name), [`natureza: ${natureza}`, `last_reviewed: ${day(-200)}`]);
    const files = {
      keep: due("keep.md"),
      snooze: due("snooze.md"),
      never: due("never.md"),
      abandon: due("abandon.md"),
      became_fact: due("became.md"),
      classify: put(path.join(dir, "classify.md"), []),
      restore: put(path.join(root, "restore.md"), ["natureza: plano", `last_reviewed: ${day(-200)}`]),
    };
    await indexed(...Object.values(files));
    await ok({ path: files.restore, action: "snooze", days: 9 });
    const spy = vi.spyOn(w.ctx.indexer, "requestIndexPaths");
    const cases: Array<[keyof typeof files, Json, () => Promise<boolean>]> = [
      ["keep", {}, async () => !(await dueList()).includes(files.keep)],
      ["snooze", { days: 3 }, async () => !(await dueList()).includes(files.snooze)],
      ["never", {}, async () => !(await dueList()).includes(files.never)],
      ["abandon", {}, async () => !(await dueList()).includes(files.abandon)],
      ["became_fact", {}, async () => !(await dueList()).includes(files.became_fact)],
      [
        "classify",
        { natureza: "relato" },
        async () => !(await dueList("kind=unclassified&limit=200")).includes(files.classify),
      ],
      ["restore", { state: null }, async () => (await dueList()).includes(files.restore)],
    ];
    for (const [action, extra, reflected] of cases) {
      const file = files[action];
      const before = await reflected();
      expect(before, `${action} before`).toBe(false);
      spy.mockClear();
      await ok({
        path: file,
        action,
        ...(action === "snooze" || action === "restore" ? {} : { baseVersion: versionOf(file) }),
        ...extra,
      });
      expect(spy.mock.calls, action).toEqual([[[file]]]);
      expect(await reflected(), action).toBe(true);
    }
  });

  it("C59 classify plano on an unclassified note writes only natureza: plano, and the note leaves kind=unclassified", async () => {
    const dir = notesDir("c59");
    const file = put(path.join(dir, "n.md"), ["tags: [a]", "owner: Ana"], "# N\n\nVamos ver.\n");
    await indexed(file);
    expect(await dueList("kind=unclassified&limit=200")).toContain(file);
    const text = bytes(file).toString();
    await ok({ path: file, action: "classify", natureza: "plano", baseVersion: versionOf(file) });
    expect(bytes(file).toString()).toBe(
      text.replace("owner: Ana\n---\n", "owner: Ana\nnatureza: plano\n---\n"),
    );
    expect(await dueList("kind=unclassified&limit=200")).not.toContain(file);
  });

  it("C63 two keeps on one note with one baseVersion, sent together, give one 200 and one 409 edit_conflict, and the note holds one last_reviewed line", async () => {
    const dir = notesDir("c63");
    const file = put(path.join(dir, "n.md"), ["natureza: opiniao", `last_reviewed: ${day(-200)}`]);
    await indexed(file);
    const body = { path: file, action: "keep", baseVersion: versionOf(file) };
    const answers = await Promise.all([decide(body), decide(body)]);
    expect(answers.map((a) => a.status).sort()).toEqual([200, 409]);
    expect(answers.find((a) => a.status === 409)?.body.error?.code).toBe("edit_conflict");
    expect(
      bytes(file)
        .toString()
        .match(/^last_reviewed:/gm),
    ).toHaveLength(1);
  });
});
