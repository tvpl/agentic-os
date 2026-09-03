import fs from "node:fs";
import path from "node:path";
import type { MordomoPaths } from "../paths.js";
import type { EventBus, OsEvent } from "../events.js";
import type { MemoryIndexer } from "./indexer.js";

/**
 * Daily journal (Logseq / OpenClaw pattern): `memory/journal/YYYY-MM-DD.md`,
 * created on first access each day from a fixed template. Runs append their
 * outcome under "Runs" through the event bus; skills and the API append
 * under any section. Today's and yesterday's journal are injected into the
 * master router (`routers.ts`) under a token budget.
 */

export const JOURNAL_SECTIONS = ["Today", "Decisions", "Open loops", "Runs"] as const;
export type JournalSection = (typeof JOURNAL_SECTIONS)[number];

export interface JournalEntry {
  text: string;
  section?: JournalSection;
  /** Defaults to today (local time). */
  date?: string;
  /** Prefix the line with a HH:MM stamp (default true). */
  timestamp?: boolean;
}

export interface JournalDay {
  date: string;
  path: string;
  content: string;
  /** True when the file was created by this call. */
  created: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LINE_CHARS = 2000;

export function journalDir(paths: MordomoPaths): string {
  return path.join(paths.memory, "journal");
}

/** Local calendar date as YYYY-MM-DD. */
export function localDateString(at: Date = new Date()): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isJournalDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return localDateString(new Date(y, m - 1, d + days));
}

export function journalPath(paths: MordomoPaths, date: string): string {
  if (!isJournalDate(date)) throw new Error(`Invalid journal date "${date}" (expected YYYY-MM-DD).`);
  return path.join(journalDir(paths), `${date}.md`);
}

export function journalTemplate(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const weekday = new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long" });
  return [
    `# ${date} — ${weekday}`,
    "",
    "<!-- daily journal: append, never rewrite history. Promote lasting notes with the consolidate-memory skill. -->",
    "",
    ...JOURNAL_SECTIONS.flatMap((s) => [`## ${s}`, ""]),
  ].join("\n");
}

/** Read (creating from the template when missing) the journal for a day. */
export function ensureJournal(paths: MordomoPaths, date: string = localDateString()): JournalDay {
  const file = journalPath(paths, date);
  if (fs.existsSync(file)) {
    return { date, path: file, content: fs.readFileSync(file, "utf8"), created: false };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const content = journalTemplate(date);
  fs.writeFileSync(file, content, "utf8");
  return { date, path: file, content, created: true };
}

/** Read without creating; null when the day has no journal. */
export function readJournal(paths: MordomoPaths, date: string): JournalDay | null {
  const file = journalPath(paths, date);
  if (!fs.existsSync(file)) return null;
  return { date, path: file, content: fs.readFileSync(file, "utf8"), created: false };
}

/** Dates that have a journal file, newest first. */
export function listJournalDates(paths: MordomoPaths, limit = 60): string[] {
  const dir = journalDir(paths);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .map((f) => f.slice(0, 10))
    .filter(isJournalDate)
    .sort()
    .reverse()
    .slice(0, limit);
}

/** The last `days` days that have a journal (today included when it exists). */
export function recentJournals(paths: MordomoPaths, days = 7, today: string = localDateString()): JournalDay[] {
  const out: JournalDay[] = [];
  for (let i = 0; i < days; i++) {
    const day = readJournal(paths, shiftDate(today, -i));
    if (day) out.push(day);
  }
  return out;
}

function sanitizeLine(text: string): string {
  return text.replace(/\r?\n/g, " ").trim().slice(0, MAX_LINE_CHARS);
}

/**
 * Append one bullet under a section of the day's journal (today by default).
 * The file is created from the template on first access; a missing section
 * is appended at the end; existing text is never rewritten.
 */
export function appendJournal(paths: MordomoPaths, entry: JournalEntry): JournalDay {
  const date = entry.date ?? localDateString();
  const section: JournalSection = entry.section ?? "Today";
  const line = sanitizeLine(entry.text);
  if (!line) throw new Error("Journal entry text must not be empty.");
  const stamp =
    entry.timestamp === false
      ? ""
      : `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")} `;
  const bullet = `- ${stamp}${line}`;

  const day = ensureJournal(paths, date);
  const lines = day.content.split("\n");
  const heading = `## ${section}`;
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) {
    const tail = day.content.endsWith("\n") ? "" : "\n";
    const content = `${day.content}${tail}\n${heading}\n\n${bullet}\n`;
    fs.writeFileSync(day.path, content, "utf8");
    return { ...day, content };
  }
  // Insert before the next heading (or at the end), after the section's last non-empty line.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  let insertAt = end;
  while (insertAt > start + 1 && lines[insertAt - 1]!.trim() === "") insertAt--;
  const block = insertAt === start + 1 ? ["", bullet] : [bullet];
  lines.splice(insertAt, 0, ...block);
  // Keep one blank line before the next heading.
  if (end < lines.length && lines[insertAt + block.length]?.trim() !== "") lines.splice(insertAt + block.length, 0, "");
  const content = lines.join("\n");
  fs.writeFileSync(day.path, content, "utf8");
  return { ...day, content };
}

/** Sections of a journal as `{ name, lines }` (bullets only, headings stripped). */
export function journalSections(content: string): Array<{ name: string; lines: string[] }> {
  const out: Array<{ name: string; lines: string[] }> = [];
  let current: { name: string; lines: string[] } | null = null;
  for (const raw of content.split("\n")) {
    const h = /^##\s+(.+)$/.exec(raw);
    if (h) {
      current = { name: h[1]!.trim(), lines: [] };
      out.push(current);
      continue;
    }
    if (current && raw.trim() !== "" && !raw.startsWith("<!--")) current.lines.push(raw);
  }
  return out;
}

export interface JournalHookOptions {
  /** Register `memory/` as an implicit index root so journal notes are searchable and recallable. */
  indexer?: MemoryIndexer;
  /** Area label for memory/ files in the index (null = unassigned). */
  area?: string | null;
}

interface RunFinishedPayload {
  runId: string;
  status: string;
  durationMs?: number | null;
}

/**
 * Subscribe the journal to the event bus: every finished run leaves one line
 * under "Runs". Also registers `memory/` on the indexer when given. Returns
 * the unsubscribe function. Registration (apps/api/src/context.ts):
 *   `installJournalHooks(events, this.paths, { indexer: this.indexer });`
 */
export function installJournalHooks(bus: EventBus, paths: MordomoPaths, opts: JournalHookOptions = {}): () => void {
  if (opts.indexer) opts.indexer.addImplicitRoot({ path: paths.memory, area: opts.area ?? null, enabled: true });
  return bus.subscribe((event: OsEvent) => {
    if (event.type !== "run.finished") return;
    const p = event.payload as Partial<RunFinishedPayload> | undefined;
    if (!p || typeof p.runId !== "string") return;
    const secs = typeof p.durationMs === "number" ? ` in ${Math.round(p.durationMs / 1000)}s` : "";
    try {
      appendJournal(paths, { section: "Runs", text: `run ${p.runId} → ${p.status ?? "finished"}${secs}` });
    } catch {
      /* the journal must never break a run */
    }
  });
}
