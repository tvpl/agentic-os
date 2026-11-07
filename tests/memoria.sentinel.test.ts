import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { EVENT_ENVELOPES, EVENT_VERSIONS, SENTINEL_IDS, checkBody } from "@mordomo/contracts";
import { AppContext } from "../apps/api/src/context.js";
import { eventsDocument } from "../apps/api/src/eventsDoc.js";
import { CURRENT_SETTINGS_VERSION } from "../core/src/config/schema.js";
import type { OsEvent } from "../core/src/events.js";
import { storeProposal } from "../core/src/memory/proposals.js";
import { readMetaJson } from "../core/src/sentinels/meta.js";
import { makeTempHome } from "./helpers.js";
import { memoriaWorld, type Json, type MemoriaWorld } from "./helpers/memoriaWorld.js";
import { movingClock } from "./helpers/movingClock.js";

/**
 * cerebro-memoria-confiavel S3, the sentinel of the agent's proposals (C75-C78, door 11): `SentinelRunner.hourly()` over
 * a real home, its database, its bus and its inbox. "Today" is the local day of `movingClock(NOW)` (it keeps moving: an
 * index pass waits for it). The day of the local zone that differs from UTC is in `memoria.localday.test.ts`.
 */

const NOW = new Date(2026, 9, 31, 12, 0, 0).getTime();
const HOUR = 3_600_000;
const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (at: number) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const BODY =
  "What agents proposed to write to the memory waits in Reviews › From the agent: accept all, part or none.";

let clock: ReturnType<typeof movingClock>;
let w: MemoriaWorld;
beforeAll(async () => {
  clock = movingClock(NOW);
  w = await memoriaWorld("mordomo-memoria-sentinel-");
}, 60_000);
afterEach(() => {
  clock.set(NOW);
  w.ctx.db.prepare("DELETE FROM memory_proposals").run();
  w.ctx.db.prepare("DELETE FROM meta WHERE key = 'sentinel.proposalsPending.day'").run();
  w.ctx.db.prepare("DELETE FROM notifications WHERE message_key = 'sentinel.proposalsPending'").run();
  w.update((s) => {
    s.sentinels.proposalsPending.enabled = true;
  });
});
afterAll(async () => {
  await w.close();
  clock.restore();
});

const propose = (n: number) => {
  for (let i = 0; i < n; i++) {
    storeProposal(
      w.ctx.db,
      {
        kind: "fact",
        author: "mcp",
        summary: `fato ${i}`,
        payload: { subject: `s ${i}`, predicate: "p", object: "o" },
      },
      { capped: true },
    );
  }
};
/** The `sentinel.fired` events of one sentinel an hourly pass emits on the bus. */
const pass = async (sentinel = "proposalsPending"): Promise<Json[]> => {
  const seen: Json[] = [];
  const off = w.ctx.events.subscribe((e: OsEvent) => {
    const payload = e.payload as Json;
    if (e.type === "sentinel.fired" && payload.sentinel === sentinel) seen.push(payload);
  });
  try {
    await w.ctx.sentinels.hourly();
  } finally {
    off();
  }
  return seen;
};
const rows = () =>
  w.ctx.notifications.list({ limit: 500 }).filter((n) => n.messageKey === "sentinel.proposalsPending");

describe("C75 once a local day with a proposal pending", () => {
  it("C75 3 pending and no day recorded: exactly one sentinel.fired with count 3 and the href, and the day in meta; again that day none; the next day one", async () => {
    propose(3);
    expect(await pass()).toEqual([
      {
        sentinel: "proposalsPending",
        title: "3 agent proposals to review",
        body: BODY,
        severity: "info",
        href: "/brain/reviews?tab=agent",
        count: 3,
        messageParams: { count: 3 },
      },
    ]);
    expect(readMetaJson(w.ctx.db, "sentinel.proposalsPending.day")).toBe(localDay(NOW));
    clock.set(NOW + 3 * HOUR);
    expect(await pass()).toEqual([]);
    clock.set(NOW + 24 * HOUR);
    expect((await pass()).map((p) => p.count)).toEqual([3]);
  });

  it("C75 exactly 1 pending is count 1; 0 pending is none", async () => {
    propose(1);
    expect((await pass()).map((p) => p.count)).toEqual([1]);
    w.ctx.db.prepare("DELETE FROM memory_proposals").run();
    w.ctx.db.prepare("DELETE FROM meta WHERE key = 'sentinel.proposalsPending.day'").run();
    expect(await pass()).toEqual([]);
    expect(readMetaJson(w.ctx.db, "sentinel.proposalsPending.day")).toBeNull();
  });
});

describe("C76 the day survives the deleted row", () => {
  it("C76 after the owner deletes the day's row, a later pass the same day emits none and the inbox has no new row", async () => {
    propose(2);
    expect(await pass()).toHaveLength(1);
    const [row] = rows();
    expect(row).toBeDefined();
    const deleted = await w.call("DELETE", `/api/notifications/${row!.id}`);
    expect(deleted.status).toBe(200);
    expect(rows()).toEqual([]);
    clock.set(NOW + 2 * HOUR);
    expect(await pass()).toEqual([]);
    expect(rows()).toEqual([]);
  });
});

describe("C77 the switch", () => {
  it("C77 enabled false with 3 pending emits no proposalsPending while reviewDue still runs; the settings of a fresh home emit one", async () => {
    w.put(
      path.join(w.memory, "notes", "vencida.md"),
      `---\nnatureza: opiniao\nlast_reviewed: ${localDay(NOW - 200 * 24 * HOUR)}\n---\n# Vencida\n`,
    );
    await w.index();
    propose(3);
    w.update((s) => {
      s.sentinels.proposalsPending.enabled = false;
    });
    const seen: Json[] = [];
    const off = w.ctx.events.subscribe((e: OsEvent) => {
      if (e.type === "sentinel.fired") seen.push(e.payload as Json);
    });
    try {
      await w.ctx.sentinels.hourly();
    } finally {
      off();
    }
    expect(seen.map((p) => p.sentinel)).toEqual(["reviewDue"]);

    const fresh = makeTempHome("mordomo-memoria-sentinel-fresh-");
    try {
      const ctx = new AppContext(fresh.paths.home);
      try {
        expect(ctx.settings().sentinels.proposalsPending).toEqual({ enabled: true });
        w.update((s) => {
          s.sentinels.proposalsPending = ctx.settings().sentinels.proposalsPending;
        });
      } finally {
        ctx.close();
      }
    } finally {
      fresh.cleanup();
    }
    expect((await pass()).map((p) => p.count)).toEqual([3]);
  });

  it("C77 an unreadable value reads false", () => {
    for (const bad of ["sim", 1, null, {}]) {
      const home = makeTempHome("mordomo-memoria-sentinel-bad-");
      try {
        fs.writeFileSync(
          home.paths.settingsFile,
          JSON.stringify({
            version: CURRENT_SETTINGS_VERSION,
            sentinels: { proposalsPending: { enabled: bad } },
          }),
        );
        const ctx = new AppContext(home.paths.home);
        try {
          expect(ctx.settings().sentinels.proposalsPending.enabled, JSON.stringify(bad)).toBe(false);
        } finally {
          ctx.close();
        }
      } finally {
        home.cleanup();
      }
    }
  });
});

describe("C78 the event and the inbox row", () => {
  it("C78 SENTINEL_IDS holds proposalsPending; the v1 schema takes it and refuses other; the fixture parses; sentinel.fired stays at [1]; docs/events.md is the generated text", () => {
    expect(SENTINEL_IDS).toContain("proposalsPending");
    expect(EVENT_VERSIONS["sentinel.fired"]).toEqual([1]);
    const entry = EVENT_ENVELOPES.find((e) => e.type === "sentinel.fired" && e.v === 1)!;
    const fixture = JSON.parse(
      fs.readFileSync(
        path.join(import.meta.dirname, "fixtures", "events", "v1", "sentinel.fired.proposalsPending.json"),
        "utf8",
      ),
    ) as Json;
    expect(fixture.payload.sentinel).toBe("proposalsPending");
    expect(checkBody(entry.schema, fixture)).toEqual([]);
    expect(
      checkBody(entry.schema, { ...fixture, payload: { ...fixture.payload, sentinel: "other" } }),
    ).not.toEqual([]);
    expect(fs.readFileSync(path.join(import.meta.dirname, "..", "docs", "events.md"), "utf8")).toBe(
      eventsDocument(),
    );
  });

  it("C78 the inbox row has href /brain/reviews?tab=agent, messageKey sentinel.proposalsPending and messageParams.count", async () => {
    propose(4);
    expect(await pass()).toHaveLength(1);
    const [row] = rows();
    expect(row).toMatchObject({ href: "/brain/reviews?tab=agent", messageKey: "sentinel.proposalsPending" });
    expect(row!.messageParams).toMatchObject({ count: 4 });
  });
});
