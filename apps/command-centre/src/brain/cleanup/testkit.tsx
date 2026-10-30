/**
 * What the guided cleanup's specs share (.specs/features/cerebro-faxina-guiada, S5): the six routes of door 5 answered
 * from a table over the notes-view stub of the network (`../notes/testnet`), findings and an inventory made to order,
 * and the wizard rendered with the providers the shells give it, in pt-BR. The `vi.mock` calls stay in the spec files.
 */
import type { ReactElement } from "react";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect } from "vitest";
import { renderWith } from "../../contexts/testkit";
import type { CommandRegistry } from "../../commands/registry";
import { MEM, NetError, net, type Asked } from "../notes/testnet";
import { CleanupHost } from "../CleanupHost";
import { openCleanup, type CleanupRequest } from "../cleanupEvents";
import type { ApplyResult, Finding, FindingKind, Inventory, Scan, UndoResult } from "./cleanupData";

export { MEM, NetError, net };
export const WORK = "/work/cliente";
export const DAY = 86_400_000;
const MTIME = Date.UTC(2026, 9, 1);

/** A context of `GET /api/contexts` with its brief note (or none). */
export function context(id: string, name: string, over: { brief?: string | null; files?: number } = {}) {
  const c = {
    id,
    name,
    paths: [{ path: `${WORK}/${id}`, state: "ok" }],
    notesDir: `${MEM}/notes/${id}`,
    brief: over.brief === undefined ? `${MEM}/notes/${id}/_resumo.md` : over.brief,
    map: `${MEM}/contexts/${id}.md`,
    files: over.files ?? 14,
  };
  net.contexts.push(c as (typeof net.contexts)[number]);
  return c;
}

/** The inventory of the fixture: 14 files, six kinds, four bands, `folders` largest folders and `groups` groups. */
export function inventory(folders = 10, groups = 4): Inventory {
  return {
    scope: { kind: "context", id: "alfa" },
    total: { count: 14, bytes: 5_120 },
    byKind: (["notes", "text", "pdf", "image", "code", "other"] as const).map((kind, i) => ({
      kind,
      count: 6 - i,
      bytes: 1000 - i * 100,
    })),
    bySize: [],
    byAge: [
      { from: 0, to: 30, count: 5 },
      { from: 31, to: 90, count: 4 },
      { from: 91, to: 365, count: 3 },
      { from: 366, to: null, count: 2 },
    ],
    topFolders: Array.from({ length: folders }, (_, i) => ({
      path: `${WORK}/pasta-${i}`,
      count: 10 - i,
      bytes: 10_000 - i * 500,
    })),
    clusters: Array.from({ length: groups }, (_, i) => ({
      kind: "folder" as const,
      name: `grupo-${i}`,
      path: `${WORK}/grupo-${i}`,
      count: 20 - i,
      terms: [],
    })),
  };
}

let ids = 0;
/** A finding of `kind` over `files` (paths), the newest last unless the mtimes say otherwise. */
export function finding(kind: FindingKind, paths: string[], over: Partial<Finding> = {}): Finding {
  const n = ++ids;
  return {
    key: `${kind}:${String(n).padStart(64, "0")}`,
    kind,
    files: paths.map((path, i) => ({
      id: n * 10 + i,
      path,
      size: 1024 * (i + 1),
      mtime: MTIME + i * DAY,
      sha256: "a".repeat(64),
    })),
    detail: {},
    suggested: "keep",
    ...over,
  };
}

/** The scans the table holds, by id; `POST /scans` hands out the ids of `starts` in order. */
export const cleanup = {
  inventory: inventory() as Inventory | Error,
  scans: {} as Record<string, Scan | Error>,
  starts: [] as Array<string | Error>,
  decisions: (_body: unknown): Promise<unknown> => Promise.resolve({ saved: 1 }),
  apply: (_body: unknown): Promise<ApplyResult> =>
    Promise.resolve({ manifest: null, moved: [], skipped: [], proposals: null }),
  undo: (_body: unknown): Promise<UndoResult> => Promise.resolve({ restored: [], skipped: [] }),
  folders: [] as string[],
};

export function scan(id: string, findings: Finding[], over: Partial<Scan> = {}): Scan {
  const s: Scan = {
    scanId: id,
    scope: { kind: "context", id: "alfa" },
    status: "finished",
    phase: "findings",
    code: null,
    startedAt: MTIME,
    finishedAt: MTIME,
    findings,
    decided: 0,
    ...over,
  };
  cleanup.scans[id] = s;
  return s;
}

const answer = (value: unknown) => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value));

/** Reset the table and put the cleanup routes in front of the notes-view stub. Call in `beforeEach`. */
export function resetCleanup(): void {
  cleanup.inventory = inventory();
  cleanup.scans = {};
  cleanup.starts = [];
  cleanup.decisions = () => Promise.resolve({ saved: 1 });
  cleanup.apply = () => Promise.resolve({ manifest: null, moved: [], skipped: [], proposals: null });
  cleanup.undo = () => Promise.resolve({ restored: [], skipped: [] });
  cleanup.folders = [];
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
  net.overrides.push((u: Asked) => {
    if (u.pathname === "/api/memory/cleanup/inventory") return answer(cleanup.inventory);
    const id = /^\/api\/memory\/cleanup\/scans\/(.+)$/.exec(u.pathname)?.[1];
    if (id) return answer(cleanup.scans[id] ?? new NetError(404, "not_found"));
    if (u.pathname === "/api/memory/search")
      return Promise.resolve([{ id: 1, mtime: Date.now() - 3 * DAY, path: `${WORK}/x.md` }]);
    if (u.pathname === "/api/settings")
      return Promise.resolve({
        areas: [],
        indexedFolders: cleanup.folders.map((path) => ({ path, area: null, enabled: true })),
        memory: { notes: { fixedStructure: false } },
      });
    return undefined;
  });
  net.writes.set("POST /api/memory/cleanup/scans", () => {
    const next = cleanup.starts.shift() ?? new NetError(409, "scan_running");
    return answer(next instanceof Error ? next : { scanId: next });
  });
  net.writes.set("PUT /api/memory/cleanup/decisions", (b) => cleanup.decisions(b));
  net.writes.set("POST /api/memory/cleanup/apply", (b) => cleanup.apply(b));
  net.writes.set("POST /api/memory/cleanup/undo", (b) => cleanup.undo(b));
}

/** The requests of one method and path, with their bodies, in order. */
export const sent = (method: string, path: string) =>
  net.calls.filter((c) => c.method === method && c.url.split("?")[0] === path).map((c) => c.body);

/** Render `ui` with the host beside it, as `OsShell` mounts it. */
export function mountHost(ui: ReactElement, lang: "pt-BR" | "en" = "pt-BR", registry?: CommandRegistry) {
  return renderWith(
    <>
      {ui}
      <CleanupHost />
    </>,
    { lang, ...(registry ? { registry } : {}) },
  );
}

/** Render `ui` with the host and open the wizard with `request`; resolves once its dialog is up. */
export async function openWizard(
  request: CleanupRequest = {},
  ui: ReactElement | null = null,
  lang: "pt-BR" | "en" = "pt-BR",
) {
  const r = renderWith(
    <>
      {ui}
      <CleanupHost />
    </>,
    { lang },
  );
  act(() => openCleanup(request));
  const dialog = await screen.findByRole("dialog", undefined, { timeout: 5000 });
  return { ...r, dialog };
}

/** The wizard's line "Etapa n de 5 · …", once it reads `text`. */
export async function atStep(text: string) {
  await waitFor(() => expect(document.querySelector(".cln-now")?.textContent).toBe(text));
}

/** The footer's buttons, left to right. */
export const footer = () => [...document.querySelectorAll<HTMLButtonElement>(".cln-foot button")];

/** Open at step 2 on context `alfa`, scan with `findings`, and arrive at "Achados" (or stay on step 2 with none). */
export async function toFindings(
  findings: Finding[],
  request: CleanupRequest = { context: "alfa", step: 2 },
) {
  if (!net.contexts.some((c) => c.id === "alfa")) context("alfa", "Alfa");
  cleanup.starts.push("scan-1");
  scan("scan-1", findings);
  const r = await openWizard(request);
  await atStep("Etapa 2 de 5 · O que tem aqui");
  const go = await within(r.dialog).findByRole("button", { name: "Procurar o que decidir" });
  await waitFor(() => expect((go as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(go);
  if (findings.length) await atStep("Etapa 3 de 5 · Achados");
  return r;
}
