import type { DashboardSnapshot, DashboardSpec, Highlight, HighlightRule } from "@mordomo/contracts";
import { HIGHLIGHT_RULES } from "@mordomo/contracts";
import { localDay } from "../memory/reviews.js";
import { weekDays } from "./sources.js";

/**
 * The highlights of door 5 (.specs/features/cerebro-paineis, AC 44, amendment 15): fixed rules over a stored snapshot,
 * computed when it is read (no source is evaluated, AC 11), at most eight, in the order of the rules. An item that
 * matches several rules appears once, under the first; a task "claims" its note, so the note's project or its
 * `new_since_visit` does not come again after it.
 */

export const HIGHLIGHTS_MAX = 8;

const TONES: Readonly<Record<HighlightRule, Highlight["tone"]>> = {
  overdue: "danger",
  due_today: "warn",
  decided_this_week: "ok",
  open_decision_7d: "warn",
  project_behind: "danger",
  review_due: "info",
  connector_flagged: "info",
  new_since_visit: "info",
};

interface Candidate {
  rule: HighlightRule;
  title: string;
  target: string;
  /** What this item is; a candidate one of these was already given is not given again. */
  own: string[];
  /** What giving it claims (its own keys and, for a task, its note). */
  claims: string[];
  /** The item's time: the connector item's `ts`, or the note's `mtime`; none is never new. */
  time: number | null;
}

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Whole local days from `day` to `today` (both `AAAA-MM-DD`). */
function daysBetween(day: string, today: string): number {
  const at = (d: string) =>
    Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((at(today) - at(day)) / 86_400_000);
}

const noteTarget = (item: Row): string | null =>
  num(item.fileId) !== null ? `/brain?sel=${item.fileId as number}` : null;

/** The candidates of one widget's items, by the kind of its source. */
function candidatesOf(
  kind: string,
  connectorId: string | null,
  items: Row[],
  today: string,
  week: readonly string[],
): Candidate[] {
  const out: Candidate[] = [];
  for (const item of items) {
    const path = str(item.path);
    const pathKey = path !== null ? [`path:${path}`] : [];
    const mtime = num(item.mtime);
    if (kind === "tasks") {
      const target = noteTarget(item);
      const due = str(item.due);
      if (target === null || path === null || due === null || item.done === true) continue;
      const own = [`task:${path}:${String(item.line)}`];
      const base = { title: str(item.text) ?? "", target, own, claims: [...own, ...pathKey], time: mtime };
      if (due < today) out.push({ rule: "overdue", ...base });
      else if (due === today) out.push({ rule: "due_today", ...base });
      out.push({ rule: "new_since_visit", ...base });
    } else if (kind === "decisions") {
      const target = noteTarget(item);
      const day = str(item.day);
      if (target === null || path === null) continue;
      const own = num(item.line) !== null ? [`decision:${path}:${item.line as number}`] : pathKey;
      const base = { title: str(item.text) ?? "", target, own, claims: own, time: mtime };
      if (item.state === "decided" && day !== null && week.includes(day))
        out.push({ rule: "decided_this_week", ...base });
      if (item.state === "open" && day !== null && daysBetween(day, today) > 7)
        out.push({ rule: "open_decision_7d", ...base });
      out.push({ rule: "new_since_visit", ...base });
    } else if (kind === "projects" || kind === "notes") {
      const target = noteTarget(item);
      if (target === null) continue;
      const base = { title: str(item.title) ?? "", target, own: pathKey, claims: pathKey, time: mtime };
      if (kind === "projects" && item.health === "behind") out.push({ rule: "project_behind", ...base });
      out.push({ rule: "new_since_visit", ...base });
    } else if (kind === "reviews") {
      if (path === null) continue;
      const base = {
        title: str(item.name) ?? path,
        target: `/brain/reviews?path=${encodeURIComponent(path)}`,
        own: pathKey,
        claims: pathKey,
        time: mtime,
      };
      out.push({ rule: "review_due", ...base }, { rule: "new_since_visit", ...base });
    } else if (kind === "connector" && connectorId !== null) {
      const id = str(item.id);
      if (id === null) continue;
      const own = [`connector:${connectorId}:${id}`];
      const base = {
        title: str(item.title) ?? id,
        target: str(item.href) ?? `/connectors#${connectorId}`,
        own,
        claims: own,
        time: num(item.ts),
      };
      if (item.flagged === true) out.push({ rule: "connector_flagged", ...base });
      out.push({ rule: "new_since_visit", ...base });
    }
  }
  return out;
}

/** The highlights of a stored snapshot (door 5), at `now`; `since` is the last visit (ms), none without it. */
export function dashboardHighlights(
  definition: Pick<DashboardSpec, "widgets">,
  snapshot: DashboardSnapshot | null,
  options: { now: number; since?: number | undefined },
): Highlight[] {
  if (snapshot === null) return [];
  const today = localDay(options.now);
  const week = weekDays(options.now);
  const all: Candidate[] = [];
  definition.widgets.forEach((widget, i) => {
    const result = snapshot.widgets[i];
    if (!result || result.id !== widget.id || result.status !== "ok") return;
    const items = (result.data as { items?: unknown } | undefined)?.items;
    if (!Array.isArray(items)) return;
    const connectorId = widget.source.kind === "connector" ? widget.source.id : null;
    const rows = items.filter((x): x is Row => typeof x === "object" && x !== null);
    all.push(...candidatesOf(widget.source.kind, connectorId, rows, today, week));
  });
  const since = options.since;
  const claimed = new Set<string>();
  const out: Highlight[] = [];
  for (const rule of HIGHLIGHT_RULES) {
    for (const c of all) {
      if (c.rule !== rule) continue;
      if (rule === "new_since_visit" && (since === undefined || c.time === null || !(c.time > since)))
        continue;
      if (c.own.some((k) => claimed.has(k))) continue;
      c.claims.forEach((k) => claimed.add(k));
      out.push({ rule, title: c.title, tone: TONES[rule], target: c.target });
    }
  }
  return out.slice(0, HIGHLIGHTS_MAX);
}
