import type {
  DashboardSnapshot,
  DashboardSpec,
  DashboardWidget,
  SnapshotSource,
  SnapshotWidget,
} from "@mordomo/contracts";
import type { Settings, WorkContext } from "../config/schema.js";
import type { MordomoPaths } from "../paths.js";
import { CleanupContextNotFoundError, resolveCleanupScope, type CleanupScope } from "../memory/cleanup.js";
import type { DashboardSourceMap, SourceCall, SourceOutput } from "./sources.js";

/**
 * Door 2 of .specs/features/cerebro-paineis: `evaluate(def, { now, since, context }) → Snapshot`, deterministic, with
 * no model and no network beyond the connector already configured. Each widget calls its own source, under a ceiling of
 * 5 s for a local source and the connector's `dataTimeoutMs`; a source that fails marks only its widgets (AC 8), a
 * kind the map has no entry for is "not in this build" (AC 25, amendment 11), and a context that no longer exists puts
 * every memory widget in error (AC 12).
 */

export const LOCAL_SOURCE_TIMEOUT_MS = 5_000;
export const CONTEXT_GONE = "O contexto deste painel não existe mais.";
export const SOURCE_UNAVAILABLE = "Esta fonte ainda não existe nesta versão.";
const DEFAULT_LIMIT = 8;

export interface EvaluateOptions {
  now: number;
  /** The last visit (ms), for the `new_since_visit` highlights of S5. */
  since?: number | undefined;
  /** The dashboard's context today: null when it has none, or when the one it names was deleted. */
  context: WorkContext | null;
  /** Pass over the connectors' cache ("Atualizar"); the clock reads through it. */
  fresh?: boolean;
}

export interface EvaluatorEnv {
  paths: MordomoPaths;
  settings: () => Settings;
}

/** The sources that read the index, and the context of an `area` dashboard (amendment 4). */
const MEMORY: ReadonlySet<string> = new Set([
  "notes",
  "tasks",
  "decisions",
  "openLoops",
  "projects",
  "reviews",
  "facts",
]);

/** `kind` for a local source, `connector:<id>` for a connector: the entry of `sources[]` a widget reports to. */
export function sourceId(widget: Pick<DashboardWidget, "source">): string {
  return widget.source.kind === "connector" ? `connector:${widget.source.id}` : widget.source.kind;
}

type Outcome =
  | { kind: "ok"; output: Extract<SourceOutput, { status: "ok" }> }
  | { kind: "not_configured"; output: Extract<SourceOutput, { status: "not_configured" }> }
  | { kind: "error"; message: string }
  | { kind: "unavailable" };

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const ceiling = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms} ms.`)), ms);
    timer.unref?.();
  });
  return Promise.race([work, ceiling]).finally(() => clearTimeout(timer));
}

/** The value (and denominator) a `kpi` shows, by its measure (amendment 5); null when the source has no value. */
export function kpiValue(
  widget: DashboardWidget,
  data: Record<string, unknown>,
): { value: number; of?: number } | null {
  const num = (key: string): number | null => (typeof data[key] === "number" ? (data[key] as number) : null);
  switch (widget.options?.measure ?? "count") {
    case "done_of_due": {
      const of = num("dueToday");
      const value = num("doneDueToday");
      return of === null || value === null ? null : { value, of };
    }
    case "on_track_of_active": {
      const of = num("active");
      const value = num("onTrack");
      return of === null || value === null ? null : { value, of };
    }
    case "open": {
      const value = num("total");
      return value === null ? null : { value };
    }
    case "latest": {
      const value = num("value");
      return value === null ? null : { value };
    }
    default: {
      const value = num("total") ?? num("value");
      return value === null ? null : { value };
    }
  }
}

/** A widget's status from what its source gave: `empty` for a list with no item or a value that is missing. */
function widgetFrom(widget: DashboardWidget, data: Record<string, unknown>): SnapshotWidget {
  const base = { id: widget.id, kind: widget.kind };
  if (widget.kind === "kpi") {
    const value = kpiValue(widget, data);
    return value === null ? { ...base, status: "empty", data: {} } : { ...base, status: "ok", data: value };
  }
  const items = Array.isArray(data.items) ? data.items : null;
  const categories = Array.isArray(data.categories) ? data.categories : null;
  const empty =
    widget.kind === "bars" && categories !== null
      ? categories.length === 0
      : items !== null
        ? items.length === 0
        : data.value === null || data.value === undefined;
  return { ...base, status: empty ? "empty" : "ok", data };
}

export class DashboardEvaluator {
  constructor(
    private readonly sources: DashboardSourceMap,
    private readonly env: EvaluatorEnv,
  ) {}

  async evaluate(def: DashboardSpec & { id: string }, options: EvaluateOptions): Promise<DashboardSnapshot> {
    const { now } = options;
    const settings = this.env.settings();
    let scope: CleanupScope | null = null;
    let contextGone = false;
    if (def.contextId !== undefined) {
      if (options.context === null) contextGone = true;
      else {
        try {
          scope = resolveCleanupScope({ paths: this.env.paths, settings }, { context: options.context.id });
        } catch (err) {
          if (!(err instanceof CleanupContextNotFoundError)) throw err;
          contextGone = true;
        }
      }
    }
    const outcomes: Outcome[] = [];
    for (const widget of def.widgets) {
      const kind = widget.source.kind;
      const fn = this.sources[kind];
      if (!fn) {
        outcomes.push({ kind: "unavailable" });
        continue;
      }
      if (contextGone && MEMORY.has(kind)) {
        outcomes.push({ kind: "error", message: CONTEXT_GONE });
        continue;
      }
      const call: SourceCall = {
        now,
        limit: widget.options?.limit ?? DEFAULT_LIMIT,
        scope: MEMORY.has(kind) ? scope : null,
        context: MEMORY.has(kind) ? options.context : null,
        fresh: options.fresh === true,
      };
      const ceiling =
        kind === "connector" ? settings.connectors.dataTimeoutMs + 1_000 : LOCAL_SOURCE_TIMEOUT_MS;
      try {
        const output = await withTimeout(
          Promise.resolve().then(() => fn(widget.source, call)),
          ceiling,
          `The source ${kind}`,
        );
        if (output.status === "ok") outcomes.push({ kind: "ok", output });
        else if (output.status === "not_configured") outcomes.push({ kind: "not_configured", output });
        else outcomes.push({ kind: "error", message: output.message });
      } catch (err) {
        outcomes.push({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    }

    const widgets: SnapshotWidget[] = def.widgets.map((widget, i) => {
      const outcome = outcomes[i]!;
      const base = { id: widget.id, kind: widget.kind };
      if (outcome.kind === "ok") return widgetFrom(widget, outcome.output.data);
      if (outcome.kind === "unavailable") return { ...base, status: "error", error: SOURCE_UNAVAILABLE };
      if (outcome.kind === "not_configured") {
        return { ...base, status: "error", error: outcome.output.message, data: outcome.output.data };
      }
      return { ...base, status: "error", error: outcome.message };
    });

    // One entry per distinct source, in the order its first widget comes; an error in any of its widgets is its error.
    const sources = new Map<string, SnapshotSource>();
    def.widgets.forEach((widget, i) => {
      const id = sourceId(widget);
      const outcome = outcomes[i]!;
      const entry: SnapshotSource =
        outcome.kind === "ok"
          ? { id, kind: widget.source.kind, status: "ok", syncedAt: outcome.output.syncedAt ?? now }
          : outcome.kind === "unavailable"
            ? {
                id,
                kind: widget.source.kind,
                status: "unavailable",
                syncedAt: null,
                message: SOURCE_UNAVAILABLE,
              }
            : outcome.kind === "not_configured"
              ? {
                  id,
                  kind: widget.source.kind,
                  status: "not_configured",
                  syncedAt: null,
                  message: outcome.output.message,
                }
              : { id, kind: widget.source.kind, status: "error", syncedAt: null, message: outcome.message };
      const seen = sources.get(id);
      if (!seen || (seen.status === "ok" && entry.status !== "ok")) sources.set(id, entry);
    });

    return { v: 1, dashboardId: def.id, generatedAt: now, sources: [...sources.values()], widgets };
  }
}

/** What `dashboard.refreshed` says of a snapshot: every widget failed, some did, or none. */
export function snapshotStatus(snapshot: DashboardSnapshot): "ok" | "partial" | "error" {
  const failed = snapshot.widgets.filter((w) => w.status === "error").length;
  if (failed === 0) return "ok";
  return failed === snapshot.widgets.length ? "error" : "partial";
}
