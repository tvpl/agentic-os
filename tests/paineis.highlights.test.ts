import crypto from "node:crypto";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EVENT_ENVELOPES, EVENT_VERSIONS, NOTIFICATION_KINDS } from "@mordomo/contracts";
import { NotificationRecordSchema } from "../contracts/src/api/wire.js";
import { b64url, deliverPush } from "@mordomo/core/internal";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import type * as client from "../core/src/connectors/client.js";
import { deliverReminders } from "../core/src/dashboards/reminders.js";
import { makeTempHome } from "./helpers.js";
import {
  calendarItems,
  dayOf,
  fakeConnectorFetch,
  paineisWorld,
  type Json,
  type PaineisWorld,
} from "./helpers/paineisWorld.js";

/**
 * .specs/features/cerebro-paineis, batch B, S3 and S5: the highlights a `GET /api/dashboards/:id?since=` answers over the
 * stored snapshot (door 5, amendment 15), `maxPerDay: 0` and `settings.dashboards` through `PUT /api/settings`, and the
 * `reminder` kind of the inbox (amendment 16), through `app.inject` against `buildServer` over a real home. The rules at
 * their own layer are `paineis.layer.test.ts` C43; the reminders by the local day are `paineis.localday.test.ts` C44.
 */

vi.mock("../core/src/connectors/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof client>();
  return { ...actual, fetchConnectorData: vi.fn(actual.fetchConnectorData) };
});

const NOW = new Date(2026, 9, 30, 12, 0, 0).getTime();
const TODAY = dayOf(NOW);
let seq = 0;

beforeAll(() => {
  fakeConnectorFetch(calendarItems(NOW));
});
afterEach(() => {
  vi.useRealTimers();
  fakeConnectorFetch(calendarItems(NOW));
});
afterAll(() => {
  vi.restoreAllMocks();
});

async function fresh<T>(fn: (world: PaineisWorld) => Promise<T>): Promise<T> {
  const world = await paineisWorld(`mordomo-paineis-highlights-${++seq}-`);
  try {
    return await fn(world);
  } finally {
    await world.close();
  }
}

const widget = (id: string, kind: string, source: Json): Json => ({
  id,
  kind,
  title: id,
  source,
  options: { limit: 50 },
});
const ALL = [
  widget("t", "checklist", { kind: "tasks", window: "today" }),
  widget("d", "list", { kind: "decisions", window: "week" }),
  widget("p", "list", { kind: "projects", health: ["behind"] }),
  widget("r", "list", { kind: "reviews" }),
  widget("a", "agenda", { kind: "connector", id: "calendar-google", read: "list" }),
];

/** `visao-geral` with these widgets, refreshed at NOW; then the GET of `query`, at NOW. */
async function highlightsOf(world: PaineisWorld, widgets: Json[], query = ""): Promise<Json[]> {
  const created = await world.create({ template: "overview" });
  const put = await world.call("PUT", "/api/dashboards/visao-geral", {
    definition: { ...created.body.definition, refresh: "manual", widgets },
    baseVersion: created.body.version,
  });
  expect(put.status, JSON.stringify(put.body)).toBe(200);
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  try {
    expect((await world.refresh("visao-geral")).status).toBe(200);
    const res = await world.get("visao-geral", query);
    expect(res.status).toBe(200);
    return res.body.highlights as Json[];
  } finally {
    vi.useRealTimers();
  }
}

const notes = (world: PaineisWorld, name: string) => path.join(world.memory, "notes", name);
const idOf = (world: PaineisWorld, file: string) =>
  (world.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(file) as { id: number }).id;
/** A `since` after every file this test writes: no item is new. */
const LATER = () => Date.now() + 86_400_000;

describe("C42 the highlights of GET /api/dashboards/:id?since=", () => {
  it("C42 11 candidates over six rules give 8 items, the first rules' first, each with exactly rule, title, tone and target", async () => {
    await fresh(async (world) => {
      world.note(
        notes(world, "atrasadas.md"),
        {},
        `# Atrasadas\n\n- [ ] Atrasada A 📅 ${dayOf(NOW, -2)}\n- [ ] Atrasada B 📅 ${dayOf(NOW, -1)}\n`,
      );
      world.note(
        notes(world, "hoje.md"),
        {},
        `# Hoje\n\n- [ ] Hoje A ⏫ 📅 ${TODAY}\n- [ ] Hoje B 📅 ${TODAY}\n`,
      );
      world.note(notes(world, "d1.md"), { type: "decision", updated: TODAY }, "# Decisão A\n");
      world.note(notes(world, "d2.md"), { type: "decision", updated: TODAY }, "# Decisão B\n");
      world.note(
        notes(world, "p1.md"),
        { type: "project", status: "active", due: dayOf(NOW, -3) },
        "# Projeto A\n",
      );
      world.note(
        notes(world, "p2.md"),
        { type: "project", status: "active", due: dayOf(NOW, -2) },
        "# Projeto B\n",
      );
      world.note(notes(world, "r1.md"), { natureza: "opiniao", last_reviewed: dayOf(NOW, -100) }, "# R1\n");
      world.note(notes(world, "r2.md"), { natureza: "opiniao", last_reviewed: dayOf(NOW, -100) }, "# R2\n");
      await world.index();
      const got = await highlightsOf(world, ALL, `since=${LATER()}`);
      expect(got).toHaveLength(8);
      for (const h of got) expect(Object.keys(h).sort()).toEqual(["rule", "target", "title", "tone"]);
      expect(got.map((h) => [h.rule, h.title])).toEqual([
        ["overdue", "Atrasada A"],
        ["overdue", "Atrasada B"],
        ["due_today", "Hoje A"],
        ["due_today", "Hoje B"],
        ["decided_this_week", "Decisão A"],
        ["decided_this_week", "Decisão B"],
        ["project_behind", "Projeto A"],
        ["project_behind", "Projeto B"],
      ]);
    });
  });

  it("C42 a task both overdue and in a project behind appears once, under overdue", async () => {
    await fresh(async (world) => {
      const project = world.note(
        notes(world, "site.md"),
        { type: "project", status: "active", due: dayOf(NOW, -3) },
        `# Site novo\n\n- [ ] Publicar o site 📅 ${dayOf(NOW, -1)}\n`,
      );
      await world.index();
      const got = await highlightsOf(world, ALL.slice(0, 3), `since=${LATER()}`);
      expect(got).toEqual([
        {
          rule: "overdue",
          title: "Publicar o site",
          tone: "danger",
          target: `/brain?sel=${idOf(world, project)}`,
        },
      ]);
    });
  });

  it("C42 new_since_visit holds only the items whose ts or mtime is after since (1 ms after → in, equal → out); no since, none", async () => {
    await fresh(async (world) => {
      const since = Math.floor(Date.now() / 1000) * 1000 - 3_600_000;
      fakeConnectorFetch({
        status: "ok",
        syncedAt: NOW,
        items: [
          { id: "x1", title: "Depois", ts: since + 1 },
          { id: "x2", title: "Igual", ts: since },
        ],
        summary: {},
      });
      world.note(notes(world, "nova.md"), {}, "# Nova\n", since + 1000);
      world.note(notes(world, "velha.md"), {}, "# Velha\n", since);
      await world.index();
      const widgets = [ALL[4]!, widget("n", "list", { kind: "notes" })];
      const got = await highlightsOf(world, widgets, `since=${since}`);
      expect(got.map((h) => [h.rule, h.title])).toEqual([
        ["new_since_visit", "Depois"],
        ["new_since_visit", "Nova"],
      ]);
      const none = await world.get("visao-geral");
      expect(none.body.highlights).toEqual([]);
    });
  });

  it("C42 with one candidate, a one-item list", async () => {
    await fresh(async (world) => {
      world.note(notes(world, "uma.md"), {}, `# Uma\n\n- [ ] Só esta 📅 ${TODAY}\n`);
      await world.index();
      const got = await highlightsOf(world, ALL.slice(0, 1), `since=${LATER()}`);
      expect(got.map((h) => [h.rule, h.title])).toEqual([["due_today", "Só esta"]]);
    });
  });

  it("C42 tones and targets: overdue danger /brain?sel=<id>, connector_flagged info the item's href, review_due info /brain/reviews?path=<path>", async () => {
    await fresh(async (world) => {
      fakeConnectorFetch({
        status: "ok",
        syncedAt: NOW,
        items: [{ id: "m1", title: "Contrato", flagged: true, href: "https://mail.example/m1", ts: NOW }],
        summary: {},
      });
      const late = world.note(notes(world, "late.md"), {}, `# Late\n\n- [ ] Ligar 📅 ${dayOf(NOW, -1)}\n`);
      const review = world.note(
        notes(world, "rever.md"),
        { natureza: "opiniao", last_reviewed: dayOf(NOW, -100) },
        "# R\n",
      );
      await world.index();
      const got = await highlightsOf(world, ALL, `since=${LATER()}`);
      expect(got).toEqual([
        { rule: "overdue", title: "Ligar", tone: "danger", target: `/brain?sel=${idOf(world, late)}` },
        {
          rule: "review_due",
          title: "rever.md",
          tone: "info",
          target: `/brain/reviews?path=${encodeURIComponent(review)}`,
        },
        { rule: "connector_flagged", title: "Contrato", tone: "info", target: "https://mail.example/m1" },
      ]);
    });
  });
});

describe("C45 maxPerDay 0 and settings.dashboards", () => {
  it("C45 with maxPerDay 0 no refresh of the day creates a reminder row (four candidates)", async () => {
    await fresh(async (world) => {
      world.update((s) => {
        s.dashboards = { reminders: { maxPerDay: 0, at: "08:30" } };
      });
      world.note(
        notes(world, "projeto.md"),
        { type: "project", status: "active", due: dayOf(NOW, -1) },
        `# Projeto\n\n- [ ] Atrasada 📅 ${dayOf(NOW, -1)}\n- [ ] Hoje A 📅 ${TODAY}\n- [ ] Hoje B 📅 ${TODAY}\n`,
      );
      await world.index();
      await world.create({ template: "overview" });
      for (const hour of [9, 12, 18, 23]) {
        vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 30, hour, 0).getTime() });
        expect((await world.refresh("visao-geral")).status).toBe(200);
        vi.useRealTimers();
      }
      const highlights = (await world.get("visao-geral")).body.highlights as Json[];
      expect(highlights.length).toBeGreaterThanOrEqual(3);
      expect(
        world.ctx.db.prepare("SELECT COUNT(*) c FROM notifications WHERE kind = 'reminder'").get(),
      ).toEqual({ c: 0 });
      const listed = (await world.call("GET", "/api/notifications")).body.items as Json[];
      expect(listed.filter((n) => n.kind === "reminder")).toEqual([]);
    });
  });

  it("C45 PUT /api/settings refuses maxPerDay 21, -1 and 2.5 and at 8:30 and 24:00, storing nothing; the object is replaced whole", async () => {
    await fresh(async (world) => {
      const stored = async () => (await world.call("GET", "/api/settings")).body as Json;
      const before = await stored();
      expect(before.dashboards).toEqual({ reminders: { maxPerDay: 3, at: "08:30" } });
      for (const bad of [
        { maxPerDay: 21 },
        { maxPerDay: -1 },
        { maxPerDay: 2.5 },
        { at: "8:30" },
        { at: "24:00" },
      ]) {
        const res = await world.call("PUT", "/api/settings", { dashboards: { reminders: bad } });
        expect(res.status, JSON.stringify(bad)).toBe(400);
        expect(res.body.error.code, JSON.stringify(bad)).toBe("validation");
        expect(await stored()).toEqual(before);
      }
      const seven = await world.call("PUT", "/api/settings", {
        dashboards: { reminders: { maxPerDay: 3, at: "07:00" } },
      });
      expect(seven.status, JSON.stringify(seven.body)).toBe(200);
      expect((await stored()).dashboards).toEqual({ reminders: { maxPerDay: 3, at: "07:00" } });
      const mid = await stored();
      const off = await world.call("PUT", "/api/settings", { dashboards: { reminders: { maxPerDay: 0 } } });
      expect(off.status, JSON.stringify(off.body)).toBe(200);
      const after = await stored();
      expect(after.dashboards).toEqual({ reminders: { maxPerDay: 0, at: "08:30" } });
      const { dashboards: _a, ...rest } = after;
      const { dashboards: _b, ...restMid } = mid;
      expect(Object.keys(rest).sort()).toEqual(Object.keys(restMid).sort());
      for (const key of Object.keys(restMid)) expect(rest[key], key).toEqual(restMid[key]);
    });
  });
});

describe("C46 the reminder kind of the inbox", () => {
  it("C46 NOTIFICATION_KINDS is the five of before then reminder; the wire and notification.created v1 take reminder and refuse lembrete; notification.created is still [1]", () => {
    expect(NOTIFICATION_KINDS).toEqual(["approval", "run", "routine", "index", "system", "reminder"]);
    const record = {
      id: "n_1",
      kind: "reminder",
      tone: "warn",
      messageKey: "reminder.overdue",
      messageParams: { text: "Mandar a proposta" },
      title: "Overdue: Mandar a proposta",
      body: null,
      href: "/brain?sel=1",
      approvalId: null,
      runId: null,
      ts: NOW,
      read: false,
      dedupeKey: "reminder:overdue:task:/m/a.md:3:2026-10-30",
    };
    expect(NotificationRecordSchema.safeParse(record).success).toBe(true);
    expect(NotificationRecordSchema.safeParse({ ...record, kind: "lembrete" }).success).toBe(false);
    const envelope = EVENT_ENVELOPES.find((e) => e.type === "notification.created" && e.v === 1)!;
    const event = { id: 1, type: "notification.created", ts: NOW, v: 1, payload: record };
    expect(envelope.schema.safeParse(event).success).toBe(true);
    expect(envelope.schema.safeParse({ ...event, payload: { ...record, kind: "lembrete" } }).success).toBe(
      false,
    );
    expect(EVENT_VERSIONS["notification.created"]).toEqual([1]);
  });

  it("C46 a reminder's title is Overdue: <text>, Due today: <text> or Project behind: <title>", () => {
    const temp = makeTempHome("mordomo-paineis-c46-");
    const ctx = new AppContext(temp.paths.home);
    try {
      const written = deliverReminders(
        {
          db: ctx.db,
          notifications: ctx.notifications,
          settings: { ...ctx.settings(), dashboards: { reminders: { maxPerDay: 3, at: "08:30" } } },
        },
        [
          { rule: "overdue", item: "task:/m/a.md:3", text: "Mandar a proposta", fileId: 1 },
          { rule: "due_today", item: "task:/m/b.md:4", text: "Ligar", fileId: 2 },
          { rule: "project_behind", item: "project:/m/p.md", text: "Site novo", fileId: 3 },
        ],
        NOW,
      );
      expect(written.map((n) => [n.kind, n.title, n.tone])).toEqual([
        ["reminder", "Overdue: Mandar a proposta", "warn"],
        ["reminder", "Due today: Ligar", "info"],
        ["reminder", "Project behind: Site novo", "warn"],
      ]);
    } finally {
      ctx.close();
      temp.cleanup();
    }
  });

  it("C46 the push channel sends a reminder of tone warn when minTone is warn and skips one of tone info (the tone gate, as before)", async () => {
    const temp = makeTempHome("mordomo-paineis-c46-push-");
    const ctx = new AppContext(temp.paths.home, { pushResolver: async () => ["93.184.216.34"] });
    const settings = ctx.settings();
    settings.setupCompleted = true;
    settings.channels.push.enabled = true;
    settings.channels.push.minTone = "warn";
    ctx.settingsStore.save(settings);
    const app = await buildServer(ctx);
    try {
      const ua = crypto.createECDH("prime256v1");
      ua.generateKeys();
      const subscription = {
        endpoint: "https://push.example.net/sub/reminder",
        keys: { p256dh: b64url.encode(ua.getPublicKey()), auth: b64url.encode(crypto.randomBytes(16)) },
      };
      const sub = await app.inject({
        method: "POST",
        url: "/api/push/subscribe",
        headers: { "x-mordomo-token": ctx.token() },
        payload: { subscription, label: "Telefone" },
      });
      expect(sub.statusCode).toBe(200);
      const sent: string[] = [];
      const fetchImpl = (async (url: string | URL | Request) => {
        sent.push(String(url));
        return new Response(null, { status: 201 });
      }) as unknown as typeof fetch;
      const [warn, info] = deliverReminders(
        {
          db: ctx.db,
          notifications: ctx.notifications,
          settings: { ...ctx.settings(), dashboards: { reminders: { maxPerDay: 3, at: "08:30" } } },
        },
        [
          { rule: "overdue", item: "task:/m/a.md:3", text: "Mandar a proposta", fileId: 1 },
          { rule: "due_today", item: "task:/m/b.md:4", text: "Ligar", fileId: 2 },
        ],
        NOW,
      );
      const deps = {
        getSettings: () => ctx.settings(),
        store: ctx.push,
        fetchImpl,
        resolveHost: ctx.pushResolver,
      };
      expect(await deliverPush(deps, warn!)).toEqual({ sent: 1, failed: 0, dropped: 0 });
      expect(sent).toEqual([subscription.endpoint]);
      expect((await deliverPush(deps, info!)).skipped).toBe("tone");
      expect(sent).toHaveLength(1);
    } finally {
      await app.close();
      ctx.close();
      temp.cleanup();
    }
  });
});
