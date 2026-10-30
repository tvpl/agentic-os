import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { movingClock } from "./helpers/movingClock.js";
import { notesViewWorld, sha, type Json, type NotesViewWorld } from "./helpers/notesViewWorld.js";

/**
 * .specs/features/cerebro-natureza, batch B, S3 (and S4's unclassified list): `GET /api/memory/reviews` through
 * `app.inject` against `buildServer` over a real home, with folders outside it indexed by real passes. "Now" is the
 * clock `NOW` (local noon of 2026-10-30, `movingClock`), frozen where a claim names an exact instant; an age of N days
 * is a header `last_reviewed` (or an `mtime`) N local days before today. The rules themselves, one case per row, are in `natureza.layer.test.ts`.
 */

const NOW = new Date(2026, 9, 30, 12, 0, 0).getTime();
const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
/** The local day `offset` days from today. */
const day = (offset: number) => {
  const d = new Date(2026, 9, 30 + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const TODAY = day(0);
/** Local noon `offset` days from today, in ms. */
const at = (offset: number) => new Date(2026, 9, 30 + offset, 12).getTime();

let w: NotesViewWorld;
let seq = 0;
let clock: ReturnType<typeof movingClock>;

beforeAll(async () => {
  clock = movingClock(NOW);
  w = await notesViewWorld("mordomo-natureza-reviews-");
});
afterEach(() => {
  vi.useRealTimers();
  clock.set(NOW);
});
afterAll(async () => {
  await w.close();
  clock.restore();
});

const header = (fields: Record<string, string>) =>
  Object.keys(fields).length === 0
    ? ""
    : `---\n${Object.entries(fields)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n")}\n---\n`;
/** A note with these header fields, whose `mtime` is `mtimeAgo` days before today. */
function note(
  world: NotesViewWorld,
  file: string,
  fields: Record<string, string>,
  body = "# Nota\n",
  mtimeAgo = 0,
) {
  world.put(file, header(fields) + body);
  const t = at(-mtimeAgo) / 1000;
  fs.utimesSync(file, t, t);
  return file;
}
/** A note of nature `natureza` last reviewed `ago` days before today. */
const aged = (
  world: NotesViewWorld,
  file: string,
  natureza: string,
  ago: number,
  extra: Record<string, string> = {},
) => note(world, file, { natureza, last_reviewed: day(-ago), ...extra });

async function list(world: NotesViewWorld, query = "") {
  const res = await world.call("GET", `/api/memory/reviews${query ? `?${query}` : ""}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { items: Json[]; total: number; nextDue: string | null };
}
const itemOf = async (file: string, query = "kind=due") =>
  (await list(w, query)).items.find((i) => i.path === file);
const notesDir = (name: string) => path.join(w.memory, "notes", `${name}-${++seq}`);

/** A fresh home for a claim about the whole list (its order, its length, its total). */
async function fresh<T>(fn: (world: NotesViewWorld) => Promise<T>): Promise<T> {
  const world = await notesViewWorld(`mordomo-natureza-reviews-${++seq}-`);
  try {
    return await fn(world);
  } finally {
    await world.close();
  }
}

describe("S3 what fell due", () => {
  it("C27 an opiniao note last reviewed 91 days ago is due since yesterday, at 90 days since today, and at 89 days it is not an item", async () => {
    const dir = notesDir("c27");
    const n91 = aged(w, path.join(dir, "n91.md"), "opiniao", 91);
    const n90 = aged(w, path.join(dir, "n90.md"), "opiniao", 90);
    const n89 = aged(w, path.join(dir, "n89.md"), "opiniao", 89);
    await w.index();
    const { items } = await list(w, "kind=due");
    expect(items.find((i) => i.path === n91)?.dueSince).toBe(day(-1));
    expect(items.find((i) => i.path === n90)?.dueSince).toBe(TODAY);
    expect(items.find((i) => i.path === n89)).toBeUndefined();
  });

  it("C28 the base: the mtime with no last_reviewed, the mtime under an unreadable last_reviewed, and a keep stored 10 days ago over a header 100 days old", async () => {
    const dir = notesDir("c28");
    const byMtime = note(w, path.join(dir, "mtime.md"), { natureza: "opiniao" }, "# M\n", 91);
    const unreadable = note(
      w,
      path.join(dir, "ontem.md"),
      { natureza: "opiniao", last_reviewed: "ontem" },
      "# O\n",
      91,
    );
    const root = w.indexedRoot(`c28-${seq}`);
    const kept = aged(w, path.join(root, "kept.md"), "opiniao", 100);
    await w.index();
    expect((await itemOf(byMtime))?.dueSince).toBe(day(-1));
    expect((await itemOf(unreadable))?.dueSince).toBe(day(-1));
    expect((await itemOf(kept))?.dueSince).toBe(day(-10));

    // The keep is stored by the route ten days ago (C46), never seeded.
    clock.set(at(-10));
    const keep = await w.call("POST", "/api/memory/reviews", { path: kept, action: "keep" });
    expect(keep.status, JSON.stringify(keep.body)).toBe(200);
    clock.set(NOW);
    expect(await itemOf(kept)).toBeUndefined();
    // Read back where the list shows it: once that later review falls due, its lastReviewed is that day.
    clock.set(at(80));
    expect((await itemOf(kept))?.lastReviewed).toBe(day(-10));
  });

  it("C31 a snooze of 14 days hides a due note until now + 14 days and shows it again 1 ms later, and hides an unclassified note under memory/notes too", async () => {
    const dir = notesDir("c31");
    const due = aged(w, path.join(dir, "due.md"), "opiniao", 120);
    const loose = note(w, path.join(dir, "loose.md"), {}, "# Solta\n");
    await w.index();
    expect(await itemOf(due)).toBeDefined();
    expect(await itemOf(loose, "kind=unclassified")).toBeDefined();
    // One decision instant for both: the clock stands still between them (no pass runs while it does).
    const until: number[] = [];
    for (const file of [due, loose]) {
      const res = await w.call("POST", "/api/memory/reviews", { path: file, action: "snooze", days: 14 });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const row = w.ctx.db
        .prepare("SELECT snooze_until, updated_at FROM review_state WHERE path = ?")
        .get(file) as {
        snooze_until: number;
        updated_at: number;
      };
      // the decision's own "now" is the row's updated_at
      expect(row.snooze_until).toBe(row.updated_at + 14 * DAY);
      until.push(row.snooze_until);
    }
    for (const [i, [file, query]] of (
      [
        [due, "kind=due"],
        [loose, "kind=unclassified"],
      ] as const
    ).entries()) {
      vi.useFakeTimers({ toFake: ["Date"], now: until[i]! });
      expect(await itemOf(file, query), `${query} at now + 14 days`).toBeUndefined();
      vi.setSystemTime(until[i]! + 1);
      expect(await itemOf(file, query), `${query} at now + 14 days + 1 ms`).toBeDefined();
      vi.useRealTimers();
    }
  });

  it("C32 a context lists its ok path and its notes folder, never app-antigo/ nor a row left under its missing path; all and none list every one; an unknown id is 404 context_not_found", async () => {
    const root = w.indexedRoot(`c32-${++seq}`);
    const app = path.join(root, "projetos", "app");
    const gone = path.join(root, "sumiu");
    const inApp = aged(w, path.join(app, "a.md"), "opiniao", 120);
    const inOld = aged(w, path.join(root, "projetos", "app-antigo", "b.md"), "opiniao", 120);
    const inGone = aged(w, path.join(gone, "c.md"), "opiniao", 120);
    const created = await w.call("POST", "/api/contexts", {
      name: `Revisões C32 ${seq}`,
      paths: [app, gone],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;
    const inNotes = aged(w, path.join(w.memory, "notes", id, "d.md"), "opiniao", 120);
    await w.index();
    fs.rmSync(gone, { recursive: true, force: true });
    const mine = [inApp, inNotes, inOld, inGone];
    const pathsOf = async (query: string) =>
      (await list(w, query)).items
        .map((i) => i.path as string)
        .filter((p) => mine.includes(p))
        .sort();
    expect(await pathsOf(`kind=due&context=${id}&limit=200`)).toEqual([inApp, inNotes].sort());
    expect(await pathsOf("kind=due&context=all&limit=200")).toEqual([...mine].sort());
    expect(await pathsOf("kind=due&limit=200")).toEqual([...mine].sort());
    const unknown = await w.call("GET", "/api/memory/reviews?context=nao-existe");
    expect([unknown.status, unknown.body.error?.code]).toEqual([404, "context_not_found"]);
  });

  it("C33 a note excluded by today's policy (an exclude added after the pass, a secret-named .env.md) is in neither list nor counted", async () => {
    await fresh(async (world) => {
      const dir = path.join(world.memory, "notes", "c33");
      aged(world, path.join(dir, "privado", "due.md"), "opiniao", 120);
      note(world, path.join(dir, "privado", "loose.md"), {}, "# Solta\n");
      await world.index();
      // A row a pass would not write: the secret-named file, due and unclassified.
      world.row(world.memory, "notes/c33/.env.md", {
        fields: { natureza: "opiniao", last_reviewed: day(-120) },
      });
      world.row(world.memory, "notes/c33/.env.notas.md", {});
      const before = { due: await list(world, "kind=due"), loose: await list(world, "kind=unclassified") };
      expect(before.due.items.map((i) => path.basename(i.path))).toEqual(["due.md"]);
      expect(before.due.total).toBe(1);
      expect(before.loose.items.map((i) => path.basename(i.path))).toEqual(["loose.md"]);
      expect(before.loose.total).toBe(1);
      world.update((s) => {
        s.excludes = [...s.excludes, "privado"];
      });
      for (const kind of ["due", "unclassified"]) {
        const after = await list(world, `kind=${kind}`);
        expect(after.items, kind).toEqual([]);
        expect(after.total, kind).toBe(0);
      }
    });
  });

  it("C34 the answer's keys, the order by dueSince then path, editable, the two filters on items and total, kind missing as due, and each refused query alone", async () => {
    await fresh(async (world) => {
      const root = world.indexedRoot("c34");
      const forty = aged(world, path.join(root, "quarenta.md"), "opiniao", 130);
      const b = aged(world, path.join(world.memory, "notes", "b.md"), "opiniao", 100);
      const a = aged(world, path.join(world.memory, "notes", "a.md"), "opiniao", 100);
      await world.index();
      const first = await list(world, "kind=due");
      expect(Object.keys(first).sort()).toEqual(["items", "nextDue", "total"]);
      expect(first.items.map((i) => i.path)).toEqual([forty, a, b]);
      expect(first.items.map((i) => i.dueSince)).toEqual([day(-40), day(-10), day(-10)]);
      for (const item of first.items)
        expect(Object.keys(item).sort()).toEqual(
          [
            "dueSince",
            "editable",
            "escopo",
            "lastReviewed",
            "mtime",
            "name",
            "natureza",
            "path",
            "type",
          ].sort(),
        );
      expect(first.items.find((i) => i.path === a)?.editable).toBe(true);
      expect(first.items.find((i) => i.path === forty)?.editable).toBe(false);

      const p = aged(world, path.join(world.memory, "notes", "p.md"), "plano", 40, { escopo: "equipe" });
      const q = aged(world, path.join(world.memory, "notes", "q.md"), "plano", 40, { escopo: "pessoal" });
      const r = aged(world, path.join(world.memory, "notes", "r.md"), "opiniao", 100, { escopo: "equipe" });
      const u = note(world, path.join(world.memory, "notes", "u.md"), {}, "# Sem natureza\n");
      // Due with no nature: `type: status` (30 days by default) reviewed 40 days ago, outside memory/notes (round 2).
      const st = note(world, path.join(root, "status.md"), { type: "status", last_reviewed: day(-40) });
      await world.index();
      const unfiltered = await list(world, "kind=due");
      expect(unfiltered.items.find((i) => i.path === st)).toMatchObject({
        natureza: null,
        type: "status",
        dueSince: day(-10),
      });
      const plano = await list(world, "kind=due&natureza=plano");
      expect([plano.items.map((i) => i.path), plano.total]).toEqual([[p, q], 2]);
      const equipe = await list(world, "kind=due&escopo=equipe");
      expect([equipe.items.map((i) => i.path), equipe.total]).toEqual([[p, r], 2]);
      const both = await list(world, "kind=due&natureza=plano&escopo=equipe");
      expect([both.items.map((i) => i.path), both.total]).toEqual([[p], 1]);
      expect(await list(world, "")).toEqual(await list(world, "kind=due"));

      const loose = await list(world, "kind=unclassified");
      expect(loose.items.map((i) => i.path)).toEqual([u]);
      for (const item of loose.items)
        expect(Object.keys(item).sort()).toEqual(
          [
            "dueSince",
            "editable",
            "escopo",
            "lastReviewed",
            "mtime",
            "name",
            "natureza",
            "path",
            "suggested",
            "type",
          ].sort(),
        );

      for (const bad of ["kind=other", "limit=0", "limit=201", "natureza=talvez", "escopo=publico"]) {
        const res = await world.call("GET", `/api/memory/reviews?${bad}`);
        expect([res.status, res.body.error?.code], bad).toEqual([400, "validation"]);
      }
    });
  });

  it("C35 the length and the cut: one due note is one item; 25 give the 20 oldest and total 25; limit=5 the 5 oldest; maxPerDay 3 gives 3", async () => {
    await fresh(async (world) => {
      const dir = path.join(world.memory, "notes", "c35");
      const files = [aged(world, path.join(dir, "n00.md"), "opiniao", 200)];
      await world.index();
      const one = await list(world, "kind=due");
      expect([one.items.map((i) => i.path), one.total]).toEqual([files, 1]);
      for (let i = 1; i < 25; i++)
        files.push(aged(world, path.join(dir, `n${pad(i)}.md`), "opiniao", 200 - i));
      await world.index();
      // n00 is the oldest (due 110 days ago), n24 the newest (86 days).
      const all = await list(world, "kind=due");
      expect(all.total).toBe(25);
      expect(all.items.map((i) => i.path)).toEqual(files.slice(0, 20));
      const five = await list(world, "kind=due&limit=5");
      expect([five.items.map((i) => i.path), five.total]).toEqual([files.slice(0, 5), 25]);
      const put = await world.call("PUT", "/api/settings", { memory: { reviews: { maxPerDay: 3 } } });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      const three = await list(world, "kind=due");
      expect([three.items.map((i) => i.path), three.total]).toEqual([files.slice(0, 3), 25]);
    });
  });

  it("C36 with nothing due, items is [] and nextDue the nearer of 12 and 30 days ahead; with no note that has a cadence, nextDue is null", async () => {
    await fresh(async (world) => {
      note(world, path.join(world.memory, "notes", "sem.md"), {}, "# Sem natureza\n", 400);
      await world.index();
      expect(await list(world, "kind=due")).toEqual({ items: [], total: 0, nextDue: null });
      aged(world, path.join(world.memory, "notes", "doze.md"), "opiniao", 78);
      aged(world, path.join(world.memory, "notes", "trinta.md"), "opiniao", 60);
      await world.index();
      expect(await list(world, "kind=due")).toEqual({ items: [], total: 0, nextDue: day(12) });
    });
  });
});

describe("S4 what has no nature", () => {
  it("C60 the notes under memory/notes/ with no nature, oldest mtime first, each with suggested; not a classified note, not memory/inbox/, not a folder outside; one such note is one item", async () => {
    await fresh(async (world) => {
      const notes = path.join(world.memory, "notes");
      const none = note(world, path.join(notes, "sem.md"), {}, "# Sem\nVamos lançar em março.\n", 50);
      await world.index();
      const one = await list(world, "kind=unclassified");
      expect(one.items.map((i) => [i.path, i.suggested])).toEqual([[none, "plano"]]);
      expect(one.total).toBe(1);

      const talvez = note(world, path.join(notes, "talvez.md"), { natureza: "talvez" }, "# Talvez\n", 40);
      const index = note(world, path.join(notes, "proj", "_index.md"), {}, "# Índice\n", 30);
      const resumo = note(
        world,
        path.join(notes, "proj", "_resumo.md"),
        {},
        "# Resumo\nAcho que deu certo.\n",
        20,
      );
      note(world, path.join(notes, "fato.md"), { natureza: "fato" }, "# Fato\n", 60);
      note(world, path.join(world.memory, "inbox", "i.md"), {}, "# Inbox\n", 60);
      const root = world.indexedRoot("c60");
      note(world, path.join(root, "fora.md"), {}, "# Fora\n", 60);
      await world.index();
      const all = await list(world, "kind=unclassified");
      expect(all.items.map((i) => [i.path, i.suggested])).toEqual([
        [none, "plano"],
        [talvez, null],
        [index, null],
        [resumo, "opiniao"],
      ]);
      expect(all.total).toBe(4);
      expect(all.items.every((i) => i.natureza === null)).toBe(true);
    });
  });

  it("C61 the suggestion through the route is read from the text the index stored, not from the disk", async () => {
    const dir = notesDir("c61");
    const plano = note(
      w,
      path.join(dir, "plano.md"),
      {},
      "# P\nVamos lançar em março; planejamos três turmas.\n",
    );
    const mudou = note(w, path.join(dir, "mudou.md"), {}, "# M\nAcho que o preço está alto.\n");
    await w.index();
    w.put(mudou, "# M\nVamos lançar em março; planejamos três turmas.\n");
    expect((await itemOf(plano, "kind=unclassified&limit=200"))?.suggested).toBe("plano");
    expect((await itemOf(mudou, "kind=unclassified&limit=200"))?.suggested).toBe("opiniao");
  });

  it("C62 GET /api/memory/reviews of both kinds writes nothing: every name under the home and the indexed folders, the notes' bytes and the review_state rows are the same", async () => {
    const dir = notesDir("c62");
    aged(w, path.join(dir, "due.md"), "opiniao", 200);
    note(w, path.join(dir, "loose.md"), {}, "# Vamos lançar\n");
    await w.index();
    await w.call("POST", "/api/memory/reviews", {
      path: path.join(dir, "loose.md"),
      action: "snooze",
      days: 1,
    });
    clock.set(NOW + 2 * DAY);
    const roots = [w.home, ...w.ctx.settings().indexedFolders.map((f) => f.path)];
    const fingerprint = () => {
      const hash = crypto.createHash("sha256");
      const walk = (p: string) => {
        for (const name of fs.readdirSync(p).sort()) {
          const full = path.join(p, name);
          hash.update(`${full}\n`);
          const st = fs.lstatSync(full);
          if (st.isDirectory()) walk(full);
          else if (full.startsWith(w.memory) || !full.startsWith(w.home))
            hash.update(sha(fs.readFileSync(full)));
        }
      };
      for (const root of roots) walk(root);
      return {
        names: hash.digest("hex"),
        rows: w.ctx.db.prepare("SELECT * FROM review_state ORDER BY path").all(),
      };
    };
    const before = fingerprint();
    expect(before.rows.length).toBeGreaterThan(0);
    for (const kind of ["due", "unclassified"]) await list(w, `kind=${kind}&limit=200`);
    expect(fingerprint()).toEqual(before);
  });
});
