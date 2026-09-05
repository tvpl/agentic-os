import type { Db } from "../db/db.js";

/**
 * Metrics history (plan follow-up 8): one snapshot per hour of what the
 * dashboards show live, so trends exist — runs and failures per day, spend,
 * tokens, how much waits in the inbox, how long approvals wait. Sampling
 * rides the hourly sweep; a restart inside the same hour overwrites the
 * bucket instead of adding a second row.
 */
export interface MetricsSample {
  /** Hour bucket (ms since epoch, floored to the hour). */
  ts: number;
  runsTotal: number;
  runs24h: number;
  failed24h: number;
  costTodayUsd: number;
  tokensToday: number;
  spendWeekUsd: number;
  inboxUnread: number;
  approvalsPending: number;
  /** Mean time pending → resolved over the last 24 h; null when nothing resolved. */
  approvalWaitAvgMs: number | null;
}

export const HOUR_MS = 3_600_000;
const RETENTION_DAYS = 90;

export interface SampleSource {
  runs: {
    total: number;
    last24h: number;
    failed24h: number;
    costTodayUsd: number;
    tokensToday: number;
    spendWeekUsd: number;
  };
  inboxUnread: number;
  approvalsPending: number;
  approvalWaitAvgMs: number | null;
}

export class MetricsHistory {
  constructor(private readonly db: Db) {}

  /** Write (or overwrite) the bucket for `now`. Returns the stored row. */
  sample(src: SampleSource, now = Date.now()): MetricsSample {
    const ts = Math.floor(now / HOUR_MS) * HOUR_MS;
    this.db
      .prepare(
        `INSERT INTO metrics_samples (ts, runs_total, runs_24h, failed_24h, cost_today_usd, tokens_today, spend_week_usd, inbox_unread, approvals_pending, approval_wait_avg_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(ts) DO UPDATE SET runs_total = excluded.runs_total, runs_24h = excluded.runs_24h, failed_24h = excluded.failed_24h,
           cost_today_usd = excluded.cost_today_usd, tokens_today = excluded.tokens_today, spend_week_usd = excluded.spend_week_usd,
           inbox_unread = excluded.inbox_unread, approvals_pending = excluded.approvals_pending, approval_wait_avg_ms = excluded.approval_wait_avg_ms`,
      )
      .run(
        ts,
        src.runs.total,
        src.runs.last24h,
        src.runs.failed24h,
        src.runs.costTodayUsd,
        src.runs.tokensToday,
        src.runs.spendWeekUsd,
        src.inboxUnread,
        src.approvalsPending,
        src.approvalWaitAvgMs,
      );
    this.db.prepare("DELETE FROM metrics_samples WHERE ts < ?").run(now - RETENTION_DAYS * 86_400_000);
    return this.get(ts)!;
  }

  get(ts: number): MetricsSample | null {
    const row = this.db.prepare("SELECT * FROM metrics_samples WHERE ts = ?").get(ts) as
      Record<string, unknown> | undefined;
    return row ? fromRow(row) : null;
  }

  /** Samples of the last `days`, oldest first. */
  series(days = 14, now = Date.now()): MetricsSample[] {
    const since = now - days * 86_400_000;
    return (
      this.db.prepare("SELECT * FROM metrics_samples WHERE ts >= ? ORDER BY ts ASC").all(since) as Array<
        Record<string, unknown>
      >
    ).map(fromRow);
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) c FROM metrics_samples").get() as { c: number }).c;
  }
}

function fromRow(r: Record<string, unknown>): MetricsSample {
  return {
    ts: Number(r.ts),
    runsTotal: Number(r.runs_total),
    runs24h: Number(r.runs_24h),
    failed24h: Number(r.failed_24h),
    costTodayUsd: Number(r.cost_today_usd),
    tokensToday: Number(r.tokens_today),
    spendWeekUsd: Number(r.spend_week_usd),
    inboxUnread: Number(r.inbox_unread),
    approvalsPending: Number(r.approvals_pending),
    approvalWaitAvgMs: r.approval_wait_avg_ms == null ? null : Number(r.approval_wait_avg_ms),
  };
}

/**
 * Fold hourly samples into one point per local day, the shape the Trends tab
 * charts: spend and tokens are "today so far" counters (take the day's max),
 * runs and failures come from the rolling 24 h window at the day's last
 * sample, unread and pending are the day's last value, wait is the mean.
 */
export interface DailyPoint {
  /** YYYY-MM-DD in the local timezone. */
  day: string;
  spendUsd: number;
  tokens: number;
  runs: number;
  failed: number;
  inboxUnread: number;
  approvalsPending: number;
  approvalWaitAvgMs: number | null;
  samples: number;
}

export function dailyPoints(
  samples: ReadonlyArray<MetricsSample>,
  dayOf: (ts: number) => string = localDay,
): DailyPoint[] {
  const byDay = new Map<string, MetricsSample[]>();
  for (const s of samples) {
    const d = dayOf(s.ts);
    const list = byDay.get(d) ?? [];
    list.push(s);
    byDay.set(d, list);
  }
  return [...byDay.entries()].map(([day, list]) => {
    const last = list[list.length - 1]!;
    const waits = list.map((s) => s.approvalWaitAvgMs).filter((v): v is number => v != null);
    return {
      day,
      spendUsd: Math.max(...list.map((s) => s.costTodayUsd)),
      tokens: Math.max(...list.map((s) => s.tokensToday)),
      runs: last.runs24h,
      failed: last.failed24h,
      inboxUnread: last.inboxUnread,
      approvalsPending: last.approvalsPending,
      approvalWaitAvgMs: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null,
      samples: list.length,
    };
  });
}

export function localDay(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
