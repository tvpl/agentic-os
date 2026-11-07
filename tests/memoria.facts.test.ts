import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { code, memoriaWorld, type Json, type MemoriaWorld } from "./helpers/memoriaWorld.js";

/**
 * cerebro-memoria-confiavel S1 over HTTP (C1-C4, C7-C16, C18-C20): the keys facts are compared by, the overlap rule
 * of door 2, the two time lines, provenance and today's policy on a fact's source. Each claim reads back what the
 * route wrote. "Now" is a fixed clock (only `Date` is faked).
 */

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 31, 15, 0, 0);
const JAN = Date.UTC(2026, 0, 1);
const JUN = Date.UTC(2026, 5, 1);

let w: MemoriaWorld;
let serial = 0;
/** A subject no other test uses. */
const fresh = (base: string) => `${base} ${++serial}`;

beforeAll(async () => {
  w = await memoriaWorld("mordomo-memoria-facts-");
}, 60_000);
afterAll(async () => {
  await w.close();
});
afterEach(() => {
  vi.useRealTimers();
});

const at = (now: number) => vi.useFakeTimers({ toFake: ["Date"], now });
const assert = (body: Json) => w.call("POST", "/api/memory/facts", body);
const list = async (query = ""): Promise<Json[]> => {
  const res = await w.call("GET", `/api/memory/facts${query ? `?${query}` : ""}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.facts as Json[];
};
const all = (subject: string) =>
  list(`subject=${encodeURIComponent(subject)}&includeExpired=true&includeRetracted=true&limit=2000`);
const rows = () => w.ctx.db.prepare("SELECT * FROM facts ORDER BY id").all();
const row = (id: number) => w.ctx.db.prepare("SELECT * FROM facts WHERE id = ?").get(id) as Json;
const created = async (body: Json): Promise<Json> => {
  const res = await assert(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.fact as Json;
};

describe("C1 the route compares facts by factKey", () => {
  it("C1 asserting CLIENTE SÃO PAULO · Status · a then cliente sao paulo · status · b closes the first (it is in invalidated)", async () => {
    at(NOW);
    const first = await created({
      subject: "CLIENTE SÃO PAULO",
      predicate: "Status",
      object: "a",
      validFrom: JAN,
    });
    const second = await assert({
      subject: "cliente sao paulo",
      predicate: "status",
      object: "b",
      validFrom: JUN,
    });
    expect(second.status).toBe(201);
    expect((second.body.invalidated as Json[]).map((f) => f.id)).toEqual([first.id]);
    expect(second.body.invalidated[0].validTo).toBe(JUN);
  });
});

describe("C2 a later fact closes the open one at its own start", () => {
  it("C2 cliente x · STATUS · prospect from 2026-06-01 over Cliente X · status · ativo from 2026-01-01: 201, invalidated holds the first with validTo 2026-06-01, read back so with retractedAt null", async () => {
    at(NOW);
    const subject = fresh("Cliente X");
    const first = await created({ subject, predicate: "status", object: "ativo", validFrom: JAN });
    const res = await assert({
      subject: subject.toLowerCase(),
      predicate: "STATUS",
      object: "prospect",
      validFrom: JUN,
    });
    expect(res.status).toBe(201);
    expect(res.body.invalidated).toEqual([{ ...first, validTo: JUN }]);
    const back = (await list("includeExpired=true&limit=2000")).find((f) => f.id === first.id)!;
    expect(back.validTo).toBe(JUN);
    expect(back.retractedAt).toBeNull();
  });
});

describe("C3 the same fact twice writes nothing", () => {
  it("C3 whitespace collapsed is unchanged (200, same id, no row); another case of the object is a new fact; a fact retracted as wrong is not open", async () => {
    at(NOW);
    const subject = fresh("Cliente X");
    const first = await created({ subject, predicate: "status", object: "ativo  agora", validFrom: JAN });
    const count = rows().length;
    const same = await assert({
      subject: subject.toLowerCase(),
      predicate: "status",
      object: "ativo agora",
      validFrom: JUN,
    });
    expect(same.status).toBe(200);
    expect(same.body.unchanged).toBe(true);
    expect(same.body.invalidated).toEqual([]);
    expect(same.body.fact.id).toBe(first.id);
    expect(rows()).toHaveLength(count);

    const cased = await assert({
      subject: subject.toLowerCase(),
      predicate: "status",
      object: "Ativo agora",
      validFrom: JUN,
    });
    expect(cased.status).toBe(201);
    expect((cased.body.invalidated as Json[]).map((f) => f.id)).toEqual([first.id]);
    expect(row(first.id).valid_to).toBe(JUN);

    const wrong = await w.call("POST", `/api/memory/facts/${cased.body.fact.id}/retract`, {
      reason: "wrong",
    });
    expect(wrong.status).toBe(200);
    const again = await assert({ subject, predicate: "status", object: "Ativo agora", validFrom: JUN });
    expect(again.status).toBe(201);
    expect(again.body.unchanged).toBe(false);
    expect(again.body.fact.id).not.toBe(cased.body.fact.id);
  });
});

describe("C4 the text is kept as written, the filter compares keys", () => {
  it("C4 '  Cliente X  ' is stored and returned as 'Cliente X'; subject=cliente x and predicate=STATUS find it, subject=Cliente Y does not", async () => {
    at(NOW);
    const res = await assert({
      subject: "  Cliente X  ",
      predicate: "status",
      object: "ativo",
      validFrom: JAN,
    });
    expect(res.status).toBe(201);
    expect(res.body.fact.subject).toBe("Cliente X");
    expect(res.body.fact.predicate).toBe("status");
    const id = res.body.fact.id as number;
    expect(row(id).subject).toBe("Cliente X");
    const bySubject = await list("subject=cliente%20x");
    expect(bySubject.map((f) => f.id)).toEqual([id]);
    expect(bySubject[0]!.subject).toBe("Cliente X");
    expect((await list("predicate=STATUS&limit=2000")).map((f) => f.id)).toContain(id);
    expect(await list("subject=Cliente%20Y")).toEqual([]);
  });
});

describe("C7 validTo is after validFrom", () => {
  it("C7 validTo equal to validFrom, or 1 ms before it, is 400 validation at validTo and writes nothing; validFrom + 1 is 201 and reads back", async () => {
    at(NOW);
    const subject = fresh("Prazo");
    const before = rows();
    for (const validTo of [JAN, JAN - 1]) {
      const res = await assert({ subject, predicate: "fim", object: "x", validFrom: JAN, validTo });
      expect(code(res)).toEqual([400, "validation"]);
      expect((res.body.error.issues as Json[]).map((i) => i.path)).toContainEqual(["validTo"]);
      expect(rows()).toEqual(before);
    }
    const ok = await assert({ subject, predicate: "fim", object: "x", validFrom: JAN, validTo: JAN + 1 });
    expect(ok.status).toBe(201);
    const back = (await all(subject)).find((f) => f.id === ok.body.fact.id)!;
    expect(back.validTo).toBe(JAN + 1);
    expect(row(back.id).valid_to).toBe(JAN + 1);
  });
});

describe("C8 a fact that begins before T and overlaps is closed at T", () => {
  for (const [label, offset] of [
    ["T − 1 day", DAY],
    ["T − 1 ms", 1],
  ] as const) {
    it(`C8 asserting [T, ∞) over an open fact from ${label}: its valid_to is T, retracted_at null`, async () => {
      at(NOW);
      const subject = fresh("Antes");
      const old = await created({ subject, predicate: "p", object: "velho", validFrom: JUN - offset });
      const res = await assert({ subject, predicate: "p", object: "novo", validFrom: JUN });
      expect(res.status).toBe(201);
      expect(row(old.id).valid_to).toBe(JUN);
      expect(row(old.id).retracted_at).toBeNull();
      const back = (await all(subject)).find((f) => f.id === old.id)!;
      expect([back.validTo, back.retractedAt]).toEqual([JUN, null]);
    });
  }
});

describe("C9 a fact that begins at or after U is left alone", () => {
  const T = Date.UTC(2025, 5, 1);
  const U = Date.UTC(2025, 11, 1);
  for (const [label, from] of [
    ["exactly U", U],
    ["U + 1 day", U + DAY],
  ] as const) {
    it(`C9 asserting [T, U) leaves unchanged a fact of the same keys and another object from ${label}`, async () => {
      at(NOW);
      const subject = fresh("Cliente X");
      const old = await created({ subject, predicate: "status", object: "ativo", validFrom: from });
      const before = row(old.id);
      const res = await assert({
        subject: subject.toLowerCase(),
        predicate: "STATUS",
        object: "prospect",
        validFrom: T,
        validTo: U,
      });
      expect(res.status).toBe(201);
      expect(res.body.invalidated).toEqual([]);
      expect(row(old.id)).toEqual(before);
      // the old fact is still open and still answers the default list (the bug of facts.ts:91 closed it at its start)
      expect((await list(`subject=${encodeURIComponent(subject)}`)).map((f) => f.id)).toEqual([old.id]);
    });
  }
});

describe("C10 a fact that begins at or after T, under a new fact that never ends, is retracted", () => {
  for (const [label, offset] of [
    ["exactly T", 0],
    ["T + 1 day", DAY],
  ] as const) {
    it(`C10 asserting [T, ∞) over a fact from ${label}: retracted_at is now, valid_from and valid_to as they were`, async () => {
      at(NOW);
      const subject = fresh("Depois");
      const old = await created({ subject, predicate: "p", object: "velho", validFrom: JUN + offset });
      const before = row(old.id);
      const res = await assert({ subject, predicate: "p", object: "novo", validFrom: JUN });
      expect(res.status).toBe(201);
      const after = row(old.id);
      expect(after.retracted_at).toBe(NOW);
      expect([after.valid_from, after.valid_to]).toEqual([before.valid_from, before.valid_to]);
      expect(res.body.invalidated).toEqual([{ ...old, retractedAt: NOW }]);
    });
  }

  it("C10 a third from T − 1 ms is closed at T instead, so the boundary sits at T", async () => {
    at(NOW);
    const subject = fresh("Depois");
    const old = await created({ subject, predicate: "p", object: "velho", validFrom: JUN - 1 });
    await created({ subject, predicate: "p", object: "novo", validFrom: JUN });
    expect([row(old.id).valid_to, row(old.id).retracted_at]).toEqual([JUN, null]);
  });
});

describe("C11 a new closed fact strictly inside an old one is refused", () => {
  const T = JUN;
  const U = JUN + 30 * DAY;
  it("C11 over a fact from before T that never ends, and one that ends at U + 1: 409 fact_overlap, the rows as they were", async () => {
    at(NOW);
    for (const validTo of [undefined, U + 1]) {
      const subject = fresh("Dentro");
      await created({
        subject,
        predicate: "p",
        object: "velho",
        validFrom: T - DAY,
        ...(validTo ? { validTo } : {}),
      });
      const before = rows();
      const res = await assert({ subject, predicate: "p", object: "novo", validFrom: T, validTo: U });
      expect(code(res)).toEqual([409, "fact_overlap"]);
      expect(rows()).toEqual(before);
    }
  });

  it("C11 the refusal says which it is: a fact that covers the new period, or one that starts inside it", async () => {
    at(NOW);
    // Row 1: it began before T and lasts beyond U, so it holds over the whole new period.
    const covering = fresh("Cobre");
    const wide = await created({ subject: covering, predicate: "p", object: "velho", validFrom: T - DAY });
    const coversRes = await assert({
      subject: covering,
      predicate: "p",
      object: "novo",
      validFrom: T,
      validTo: U,
    });
    expect(code(coversRes)).toEqual([409, "fact_overlap"]);
    expect(coversRes.body.error.message).toBe(
      `The fact ${wide.id} (velho) already covers the whole new period (it began before it and lasts beyond it); retract or close it first.`,
    );
    // Row 2: it begins inside [T, U), so it does not hold over the whole period, and saying so would be false.
    const starting = fresh("Comeca");
    const late = await created({
      subject: starting,
      predicate: "p",
      object: "velho",
      validFrom: T + 5 * DAY,
    });
    const startsRes = await assert({
      subject: starting,
      predicate: "p",
      object: "novo",
      validFrom: T,
      validTo: U,
    });
    expect(code(startsRes)).toEqual([409, "fact_overlap"]);
    expect(startsRes.body.error.message).toBe(
      `The fact ${late.id} (velho) starts inside the new period; retract it as wrong first, or give the new fact a period that ends before it starts.`,
    );
    expect(startsRes.body.error.message).not.toContain("whole");
    // Closing the late fact is not the way out, as the message says; retracting it as wrong is.
    expect((await w.call("POST", `/api/memory/facts/${late.id}/retract`, { reason: "ended" })).status).toBe(
      200,
    );
    expect(
      code(await assert({ subject: starting, predicate: "p", object: "novo", validFrom: T, validTo: U })),
    ).toEqual([409, "fact_overlap"]);
    expect((await w.call("POST", `/api/memory/facts/${late.id}/retract`, { reason: "wrong" })).status).toBe(
      200,
    );
    expect(
      (await assert({ subject: starting, predicate: "p", object: "novo", validFrom: T, validTo: U })).status,
    ).toBe(201);
  });

  it("C11 over one from before T that ends exactly at U: 201, and it is closed at T", async () => {
    at(NOW);
    const subject = fresh("Dentro");
    const old = await created({ subject, predicate: "p", object: "velho", validFrom: T - DAY, validTo: U });
    const res = await assert({ subject, predicate: "p", object: "novo", validFrom: T, validTo: U });
    expect(res.status).toBe(201);
    expect(row(old.id).valid_to).toBe(T);
  });
});

describe("C12 the default list is the open, unretracted facts", () => {
  it("C12 open; closed; retracted as wrong; closed then retracted: each flag adds its own, asOf leaves the retracted out unless includeRetracted", async () => {
    at(NOW - 20 * DAY);
    const s = fresh("Quatro");
    const open = await created({ subject: `${s} a`, predicate: "p", object: "x", validFrom: NOW - 10 * DAY });
    const closed = await created({
      subject: `${s} b`,
      predicate: "p",
      object: "x",
      validFrom: NOW - 10 * DAY,
    });
    const wrong = await created({
      subject: `${s} c`,
      predicate: "p",
      object: "x",
      validFrom: NOW - 10 * DAY,
    });
    const both = await created({ subject: `${s} d`, predicate: "p", object: "x", validFrom: NOW - 10 * DAY });
    at(NOW);
    expect((await w.call("POST", `/api/memory/facts/${closed.id}/retract`)).status).toBe(200);
    expect((await w.call("POST", `/api/memory/facts/${wrong.id}/retract`, { reason: "wrong" })).status).toBe(
      200,
    );
    expect((await w.call("POST", `/api/memory/facts/${both.id}/retract`)).status).toBe(200);
    expect((await w.call("POST", `/api/memory/facts/${both.id}/retract`, { reason: "wrong" })).status).toBe(
      200,
    );
    const mine = (facts: Json[]) =>
      facts
        .filter((f) => String(f.subject).startsWith(s))
        .map((f) => f.id)
        .sort((a, b) => a - b);
    expect(mine(await list("limit=2000"))).toEqual([open.id]);
    expect(mine(await list("includeRetracted=true&limit=2000"))).toEqual([open.id, wrong.id]);
    expect(mine(await list("includeExpired=true&includeRetracted=true&limit=2000"))).toEqual([
      open.id,
      closed.id,
      wrong.id,
      both.id,
    ]);
    const asOf = NOW - 5 * DAY;
    expect(mine(await list(`asOf=${asOf}&limit=2000`))).toEqual([open.id, closed.id]);
    expect(mine(await list(`asOf=${asOf}&includeRetracted=true&limit=2000`))).toEqual([
      open.id,
      closed.id,
      wrong.id,
      both.id,
    ]);
  });
});

describe("C13 knownAt is what was recorded by then and not yet retracted", () => {
  it("C13 recorded at K and K − 1 in, K + 1 out; retracted at K + 1 in, at exactly K out; knownAt abc and 1.5 are 400 validation", async () => {
    const K = NOW - DAY;
    const s = fresh("Sabido");
    at(K);
    const atK = await created({ subject: `${s} k`, predicate: "p", object: "x", validFrom: JAN });
    at(K - 1);
    const beforeK = await created({ subject: `${s} k-1`, predicate: "p", object: "x", validFrom: JAN });
    at(K + 1);
    const afterK = await created({ subject: `${s} k+1`, predicate: "p", object: "x", validFrom: JAN });
    at(K - 10);
    const laterWrong = await created({ subject: `${s} r+1`, predicate: "p", object: "x", validFrom: JAN });
    const wrongAtK = await created({ subject: `${s} r`, predicate: "p", object: "x", validFrom: JAN });
    at(K + 1);
    expect(
      (await w.call("POST", `/api/memory/facts/${laterWrong.id}/retract`, { reason: "wrong" })).status,
    ).toBe(200);
    at(K);
    expect(
      (await w.call("POST", `/api/memory/facts/${wrongAtK.id}/retract`, { reason: "wrong" })).status,
    ).toBe(200);
    at(NOW);
    const ids = (await list(`knownAt=${K}&limit=2000`))
      .filter((f) => String(f.subject).startsWith(s))
      .map((f) => f.id)
      .sort((a, b) => a - b);
    expect(ids).toEqual([atK.id, beforeK.id, laterWrong.id].sort((a, b) => a - b));
    expect(ids).not.toContain(afterK.id);
    expect(ids).not.toContain(wrongAtK.id);
    for (const bad of ["abc", "1.5"]) {
      expect(code(await w.call("GET", `/api/memory/facts?knownAt=${bad}`))).toEqual([400, "validation"]);
    }
  });
});

describe("C13 knownAt and a fact closed after K (round 1, finding 10, settled)", () => {
  it("C13 a fact recorded before K and closed (valid_to) after K is in knownAt=K, with the valid_to it has now: transaction time is creation and retraction only (AC 12, door 2)", async () => {
    const K = NOW - DAY;
    const s = fresh("Fechado depois");
    at(K - 10);
    const open = await created({ subject: s, predicate: "p", object: "x", validFrom: JAN });
    at(K + 10);
    const closed = await w.call("POST", `/api/memory/facts/${open.id}/retract`, { reason: "ended" });
    expect(closed.status).toBe(200);
    expect(closed.body.validTo).toBe(K + 10);
    at(NOW);
    const known = (await list(`knownAt=${K}&limit=2000`)).filter((f) => f.subject === s);
    expect(known.map((f) => [f.id, f.validTo, f.retractedAt])).toEqual([[open.id, K + 10, null]]);
    // while the default list (nothing asked) no longer shows it: it is closed now
    expect((await list(`limit=2000`)).filter((f) => f.subject === s)).toEqual([]);
  });
});

describe("C14 retract as wrong", () => {
  it("C14 reason wrong on an open fact: 200, retractedAt now, validTo null; on a closed one validTo stays; both read back so; reason oops is 400 and changes no row", async () => {
    at(NOW - DAY);
    const s = fresh("Errado");
    const open = await created({ subject: `${s} a`, predicate: "p", object: "x", validFrom: JAN });
    const closed = await created({
      subject: `${s} b`,
      predicate: "p",
      object: "x",
      validFrom: JAN,
      validTo: JUN,
    });
    at(NOW);
    const a = await w.call("POST", `/api/memory/facts/${open.id}/retract`, { reason: "wrong" });
    expect(a.status).toBe(200);
    expect([a.body.retractedAt, a.body.validTo]).toEqual([NOW, null]);
    const b = await w.call("POST", `/api/memory/facts/${closed.id}/retract`, { reason: "wrong" });
    expect(b.status).toBe(200);
    expect([b.body.retractedAt, b.body.validTo]).toEqual([NOW, JUN]);
    const back = await list(
      `subject=${encodeURIComponent(`${s} a`)}&includeExpired=true&includeRetracted=true`,
    );
    expect([back[0]!.retractedAt, back[0]!.validTo]).toEqual([NOW, null]);
    const backB = await list(
      `subject=${encodeURIComponent(`${s} b`)}&includeExpired=true&includeRetracted=true`,
    );
    expect([backB[0]!.retractedAt, backB[0]!.validTo]).toEqual([NOW, JUN]);

    const third = await created({ subject: `${s} c`, predicate: "p", object: "x", validFrom: JAN });
    const before = rows();
    const oops = await w.call("POST", `/api/memory/facts/${third.id}/retract`, { reason: "oops" });
    expect(code(oops)).toEqual([400, "validation"]);
    expect(rows()).toEqual(before);
  });
});

describe("C15 retract with no reason, or ended, closes the fact as today", () => {
  it("C15 no body and reason ended each set validTo to Math.max(now, validFrom) and leave retractedAt null; a closed fact answers 200 unchanged; an unknown id is 404 not_found", async () => {
    at(NOW - DAY);
    const s = fresh("Fim");
    const a = await created({ subject: `${s} a`, predicate: "p", object: "x", validFrom: JAN });
    const b = await created({ subject: `${s} b`, predicate: "p", object: "x", validFrom: JAN });
    const future = await created({ subject: `${s} c`, predicate: "p", object: "x", validFrom: NOW + DAY });
    at(NOW);
    const none = await w.call("POST", `/api/memory/facts/${a.id}/retract`);
    expect(none.status).toBe(200);
    expect([none.body.validTo, none.body.retractedAt]).toEqual([NOW, null]);
    const ended = await w.call("POST", `/api/memory/facts/${b.id}/retract`, { reason: "ended" });
    expect(ended.status).toBe(200);
    expect([ended.body.validTo, ended.body.retractedAt]).toEqual([NOW, null]);
    const later = await w.call("POST", `/api/memory/facts/${future.id}/retract`);
    expect([later.body.validTo, later.body.retractedAt]).toEqual([NOW + DAY, null]);
    expect([row(a.id).valid_to, row(a.id).retracted_at]).toEqual([NOW, null]);
    expect([row(b.id).valid_to, row(b.id).retracted_at]).toEqual([NOW, null]);

    at(NOW + 5 * DAY);
    const again = await w.call("POST", `/api/memory/facts/${a.id}/retract`);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(none.body);
    expect(code(await w.call("POST", "/api/memory/facts/999999/retract"))).toEqual([404, "not_found"]);
  });
});

describe("C16 every fact carries its two time lines and its provenance", () => {
  it("C16 exactly the sixteen keys; recordedAt equals createdAt; sourceFileId is the files row of sourcePath, null with no row, null with no sourcePath", async () => {
    const s = fresh("Chaves");
    const indexed = w.put(path.join(w.memory, "notes", "c16", "fonte.md"), "# Fonte\n\nTexto da fonte.\n");
    // an index pass waits for the clock to move on: this test keeps the real one
    await w.index();
    const fileId = (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(indexed) as { id: number })
      .id;
    const withRow = await created({
      subject: `${s} a`,
      predicate: "p",
      object: "x",
      validFrom: JAN,
      sourcePath: indexed,
    });
    const noRow = await created({
      subject: `${s} b`,
      predicate: "p",
      object: "x",
      validFrom: JAN,
      sourcePath: path.join(w.memory, "notes", "c16", "nunca.md"),
    });
    const noSource = await created({ subject: `${s} c`, predicate: "p", object: "x", validFrom: JAN });
    const facts = (await list("limit=2000")).filter((f) => String(f.subject).startsWith(s));
    expect(facts).toHaveLength(3);
    for (const f of facts) {
      expect(Object.keys(f).sort()).toEqual(
        [
          "id",
          "subject",
          "predicate",
          "object",
          "validFrom",
          "validTo",
          "sourceRunId",
          "sourcePath",
          "createdAt",
          "recordedAt",
          "retractedAt",
          "sourceLine",
          "author",
          "trust",
          "proposalId",
          "sourceFileId",
        ].sort(),
      );
      expect(f.recordedAt).toBe(f.createdAt);
    }
    const byId = new Map(facts.map((f) => [f.id, f]));
    expect(byId.get(withRow.id)!.sourceFileId).toBe(fileId);
    expect(byId.get(noRow.id)!.sourceFileId).toBeNull();
    expect(byId.get(noSource.id)!.sourceFileId).toBeNull();
  });
});

describe("C18 sourceLine names a line of sourcePath", () => {
  it("C18 sourceLine 3 with no sourcePath and sourceLine 0 with one are 400 validation; sourceLine 1 with sourcePath is 201 and reads back 1", async () => {
    at(NOW);
    const s = fresh("Linha");
    const source = path.join(w.memory, "notes", "c18.md");
    const before = rows();
    expect(code(await assert({ subject: s, predicate: "p", object: "x", sourceLine: 3 }))).toEqual([
      400,
      "validation",
    ]);
    expect(
      code(await assert({ subject: s, predicate: "p", object: "x", sourcePath: source, sourceLine: 0 })),
    ).toEqual([400, "validation"]);
    expect(rows()).toEqual(before);
    const ok = await assert({ subject: s, predicate: "p", object: "x", sourcePath: source, sourceLine: 1 });
    expect(ok.status).toBe(201);
    expect((await list(`subject=${encodeURIComponent(s)}`))[0]!.sourceLine).toBe(1);
  });
});

describe("C19 the owner's fact", () => {
  it("C19 with no source and with sourcePath both read back author owner and trust usuario", async () => {
    at(NOW);
    const s = fresh("Dono");
    await created({ subject: `${s} a`, predicate: "p", object: "x" });
    await created({
      subject: `${s} b`,
      predicate: "p",
      object: "x",
      sourcePath: path.join(w.memory, "notes", "c19.md"),
    });
    const facts = (await list("limit=2000")).filter((f) => String(f.subject).startsWith(s));
    expect(facts.map((f) => [f.author, f.trust])).toEqual([
      ["owner", "usuario"],
      ["owner", "usuario"],
    ]);
  });
});

describe("C20 a fact whose source today's policy refuses is not listed", () => {
  it("C20 out: under an excluded folder, a secret name, a relative path; in: no sourcePath, memory/journal/; stats keep their shape", async () => {
    at(NOW);
    const s = fresh("Política");
    w.update((settings) => {
      settings.excludes = [...settings.excludes, "privado-c20"];
    });
    const made = {
      excluded: await created({
        subject: `${s} excluded`,
        predicate: "p",
        object: "x",
        sourcePath: path.join(w.memory, "notes", "privado-c20", "a.md"),
      }),
      secret: await created({
        subject: `${s} secret`,
        predicate: "p",
        object: "x",
        sourcePath: path.join(w.memory, "notes", ".env"),
      }),
      relative: await created({
        subject: `${s} relative`,
        predicate: "p",
        object: "x",
        sourcePath: "journal/2026-01-01.md",
      }),
      none: await created({ subject: `${s} none`, predicate: "p", object: "x" }),
      journal: await created({
        subject: `${s} journal`,
        predicate: "p",
        object: "x",
        sourcePath: path.join(w.memory, "journal", "2026-01-01.md"),
      }),
    };
    const res = await w.call("GET", "/api/memory/facts?limit=2000");
    expect(res.status).toBe(200);
    const shown = (res.body.facts as Json[]).filter((f) => String(f.subject).startsWith(s)).map((f) => f.id);
    expect(shown.sort((a, b) => a - b)).toEqual([made.none.id, made.journal.id].sort((a, b) => a - b));
    expect(Object.keys(res.body.stats).sort()).toEqual(["expired", "open", "subjects"]);
    // the facts are there; only the listing leaves them out
    for (const f of [made.excluded, made.secret, made.relative]) expect(row(f.id)).toBeTruthy();
    expect(fs.existsSync(w.memory)).toBe(true);
  });
});
