import fs from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import * as client from "../../core/src/connectors/client.js";
import type { ConnectorData } from "../../core/src/connectors/client.js";
import type { OsEvent } from "../../core/src/events.js";
import { notesViewWorld, type Json, type NotesViewWorld } from "./notesViewWorld.js";

/**
 * The world of `.specs/features/cerebro-paineis` batch A: a real home and a server over it (`notesViewWorld`), the
 * seeded `calendar-google` connector, and a fake read of it. A test file that uses `fakeCalendar` mocks
 * `core/src/connectors/client.js` with `fetchConnectorData` as a `vi.fn` (vitest hoists the mock to the file), so the
 * connector route, the evaluator and this helper all see the same fake.
 */

export type { Json };

const repo = path.resolve(import.meta.dirname, "..", "..");

export interface PaineisWorld extends NotesViewWorld {
  /** Every `dashboard.refreshed` the bus carried, in order. */
  refreshed: Array<{ id: string; generatedAt: number; status: string }>;
  /** The next `dashboard.refreshed` of `id`. */
  nextRefresh: (id: string) => Promise<{ id: string; generatedAt: number; status: string }>;
  /** A note with these header fields and body, its `mtime` at `mtime` (ms) when given. */
  note: (file: string, fields: Record<string, string>, body?: string, mtime?: number) => string;
  refresh: (id: string) => Promise<{ status: number; body: Json }>;
  get: (id: string, query?: string) => Promise<{ status: number; body: Json }>;
  create: (body: Json) => Promise<{ status: number; body: Json }>;
  /** A work context of `paths`, written to the settings as `POST /api/contexts` would. */
  context: (id: string, name: string, paths: string[]) => void;
}

export function header(fields: Record<string, string>): string {
  const keys = Object.entries(fields);
  return keys.length === 0 ? "" : `---\n${keys.map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n`;
}

export async function paineisWorld(prefix: string): Promise<PaineisWorld> {
  const w = await notesViewWorld(prefix);
  fs.copyFileSync(
    path.join(repo, "connectors", "calendar-google.json"),
    path.join(w.ctx.paths.connectors, "calendar-google.json"),
  );
  const refreshed: PaineisWorld["refreshed"] = [];
  const waiting: Array<{ id: string; resolve: (e: PaineisWorld["refreshed"][number]) => void }> = [];
  w.ctx.events.subscribe((e: OsEvent) => {
    if (e.type !== "dashboard.refreshed") return;
    const payload = e.payload as PaineisWorld["refreshed"][number];
    refreshed.push(payload);
    const i = waiting.findIndex((x) => x.id === payload.id);
    if (i >= 0) waiting.splice(i, 1)[0]!.resolve(payload);
  });
  return Object.assign(w, {
    refreshed,
    nextRefresh: (id: string) =>
      new Promise<PaineisWorld["refreshed"][number]>((resolve) => waiting.push({ id, resolve })),
    note(file: string, fields: Record<string, string>, body = "# Nota\n", mtime?: number) {
      w.put(file, header(fields) + body);
      if (mtime !== undefined) fs.utimesSync(file, mtime / 1000, mtime / 1000);
      return file;
    },
    refresh: (id: string) => w.call("POST", `/api/dashboards/${id}/refresh`),
    get: (id: string, query = "") => w.call("GET", `/api/dashboards/${id}${query ? `?${query}` : ""}`),
    create: (body: Json) => w.call("POST", "/api/dashboards", body),
    context(id: string, name: string, paths: string[]) {
      w.update((s) => {
        s.contexts = [...s.contexts.filter((c) => c.id !== id), { id, name, paths }];
      });
    },
  });
}

/** Two events of today, as the calendar connector maps them (with a field the snapshot must not keep). */
export function calendarItems(now: number): ConnectorData {
  return {
    status: "ok",
    syncedAt: now,
    items: [
      {
        id: "e1",
        title: "Reunião de pauta",
        subtitle: "Sala 2",
        ts: now + 3_600_000,
        href: "https://cal/e1",
      },
      { id: "e2", title: "Almoço com cliente", subtitle: "Centro", ts: now + 7_200_000, flagged: true },
    ],
    summary: { items: 2 },
  };
}

/** What the fake `fetchConnectorData` answers: a value, a function of the connector, or a rejection. */
export function fakeConnectorFetch(
  answer: ConnectorData | ((connector: { id: string }) => Promise<ConnectorData> | ConnectorData),
): ReturnType<typeof vi.mocked<typeof client.fetchConnectorData>> {
  const fake = vi.mocked(client.fetchConnectorData);
  fake.mockReset();
  fake.mockImplementation(async (connector) => (typeof answer === "function" ? answer(connector) : answer));
  return fake;
}

/** A row of `runs` as the run manager leaves it (its state and times are what a claim about the list needs). */
export function runRow(
  world: Pick<NotesViewWorld, "ctx">,
  run: {
    id: string;
    status: string;
    skill?: string | null;
    createdAt: number;
    startedAt?: number | null;
    finishedAt?: number | null;
    durationMs?: number | null;
  },
): void {
  world.ctx.db
    .prepare(
      "INSERT INTO runs (id, created_at, started_at, finished_at, origin, provider, status, duration_ms, skill_slug) VALUES (?, ?, ?, ?, 'manual', 'claude', ?, ?, ?)",
    )
    .run(
      run.id,
      run.createdAt,
      run.startedAt ?? null,
      run.finishedAt ?? null,
      run.status,
      run.durationMs ?? null,
      run.skill ?? null,
    );
}

/** The local day `offset` days from the local day of `now`, as `AAAA-MM-DD`. */
export function dayOf(now: number, offset = 0): string {
  const d = new Date(now);
  const at = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}
