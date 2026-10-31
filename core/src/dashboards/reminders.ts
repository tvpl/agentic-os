import type { DashboardSnapshot, DashboardSpec } from "@mordomo/contracts";
import type { Settings } from "../config/schema.js";
import type { Db } from "../db/db.js";
import { localDay } from "../memory/reviews.js";
import type { NotificationInput, NotificationRecord } from "../notifications/store.js";
import { readMetaJson, writeMetaJson } from "../sentinels/meta.js";

/**
 * The reminders of door 5 (.specs/features/cerebro-paineis, AC 46, AC 47, amendments 16 and 30): from
 * `settings.dashboards.reminders.at` local time on, a refresh turns an overdue or due-today task, or a project
 * behind, into a `reminder` row of the inbox, once per item per local day and at most `maxPerDay` a day. What was
 * given on a day is kept in `meta` under `dashboards.reminders.<AAAA-MM-DD>` (the `dedupeKey`s of that day), not read
 * from the inbox: a row the owner deletes neither frees the day's cap nor lets its item come again (amendment 30).
 * The title is English like the sentinels'; the screen reads `messageKey` and `messageParams.text`.
 */

export const REMINDER_RULES = ["overdue", "due_today", "project_behind"] as const;
export type ReminderRule = (typeof REMINDER_RULES)[number];

export interface ReminderCandidate {
  rule: ReminderRule;
  /** `task:<path>:<line>` or `project:<path>`. */
  item: string;
  text: string;
  fileId: number;
}

const TITLES: Readonly<Record<ReminderRule, string>> = {
  overdue: "Overdue",
  due_today: "Due today",
  project_behind: "Project behind",
};

type Row = Record<string, unknown>;

/** The reminders a snapshot asks for, in the order of the rules, each item once. */
export function reminderCandidates(
  definition: Pick<DashboardSpec, "widgets">,
  snapshot: DashboardSnapshot,
  now: number,
): ReminderCandidate[] {
  const today = localDay(now);
  const byRule: Record<ReminderRule, ReminderCandidate[]> = {
    overdue: [],
    due_today: [],
    project_behind: [],
  };
  const seen = new Set<string>();
  definition.widgets.forEach((widget, i) => {
    const result = snapshot.widgets[i];
    if (!result || result.id !== widget.id || result.status !== "ok") return;
    const items = (result.data as { items?: unknown } | undefined)?.items;
    if (!Array.isArray(items)) return;
    for (const raw of items) {
      if (typeof raw !== "object" || raw === null) continue;
      const item = raw as Row;
      if (typeof item.path !== "string" || typeof item.fileId !== "number") continue;
      let candidate: ReminderCandidate | null = null;
      if (widget.source.kind === "tasks" && typeof item.due === "string" && item.done !== true) {
        const rule = item.due < today ? "overdue" : item.due === today ? "due_today" : null;
        if (rule !== null) {
          candidate = {
            rule,
            item: `task:${item.path}:${String(item.line)}`,
            text: typeof item.text === "string" ? item.text : "",
            fileId: item.fileId,
          };
        }
      } else if (widget.source.kind === "projects" && item.health === "behind") {
        candidate = {
          rule: "project_behind",
          item: `project:${item.path}`,
          text: typeof item.title === "string" ? item.title : "",
          fileId: item.fileId,
        };
      }
      if (candidate === null || seen.has(`${candidate.rule}\u0000${candidate.item}`)) continue;
      seen.add(`${candidate.rule}\u0000${candidate.item}`);
      byRule[candidate.rule].push(candidate);
    }
  });
  return REMINDER_RULES.flatMap((rule) => byRule[rule]);
}

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

export interface ReminderSink {
  add(input: NotificationInput): NotificationRecord;
}

/** The `meta` key that holds the `dedupeKey`s given on a local day (amendment 30). */
export const REMINDER_DAY_PREFIX = "dashboards.reminders.";
export const reminderDayKey = (day: string): string => `${REMINDER_DAY_PREFIX}${day}`;

/** The `dedupeKey`s of the reminders given on `day`, whatever became of their rows. */
export function remindersGiven(db: Db, day: string): string[] {
  const stored = readMetaJson<unknown>(db, reminderDayKey(day));
  return Array.isArray(stored) ? stored.filter((k): k is string => typeof k === "string") : [];
}

/** Write the reminders `candidates` ask for, as far as the settings and the day's cap allow; answers what it wrote. */
export function deliverReminders(
  deps: { db: Db; notifications: ReminderSink; settings: Settings },
  candidates: readonly ReminderCandidate[],
  now: number,
): NotificationRecord[] {
  const { maxPerDay, at } = deps.settings.dashboards.reminders;
  if (maxPerDay <= 0 || candidates.length === 0) return [];
  const local = new Date(now);
  if (local.getHours() * 60 + local.getMinutes() < minutesOf(at)) return [];
  const day = localDay(now);
  return deps.db.transaction(() => {
    const given = remindersGiven(deps.db, day);
    const out: NotificationRecord[] = [];
    for (const c of candidates) {
      if (given.length >= maxPerDay) break;
      const dedupeKey = `reminder:${c.rule}:${c.item}:${day}`;
      if (given.includes(dedupeKey)) continue;
      out.push(
        deps.notifications.add({
          kind: "reminder",
          tone: c.rule === "due_today" ? "info" : "warn",
          title: `${TITLES[c.rule]}: ${c.text}`,
          messageKey: `reminder.${c.rule}`,
          messageParams: { text: c.text },
          href: `/brain?sel=${c.fileId}`,
          dedupeKey,
          ts: now,
        }),
      );
      given.push(dedupeKey);
    }
    if (out.length > 0) {
      writeMetaJson(deps.db, reminderDayKey(day), given);
      // Only the day that can still be asked about is kept: the records of earlier days go.
      deps.db
        .prepare("DELETE FROM meta WHERE key LIKE ? AND key < ?")
        .run(`${REMINDER_DAY_PREFIX}%`, reminderDayKey(day));
    }
    return out;
  })();
}
