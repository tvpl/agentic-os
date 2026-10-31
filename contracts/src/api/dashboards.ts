/**
 * The dashboards (.specs/features/cerebro-paineis): a definition is the file `memory/dashboards/<id>.json` (door 1),
 * what a screen shows is its last snapshot (door 4), and the routes of door 6 read, write, refresh and archive them.
 */
import { z } from "zod";
import { isAbsolutePath } from "../workContext.js";
import { err } from "./common.js";
import { contextNotFound } from "./contexts.js";
import { route } from "./route.js";

// ---- door 1: the definition ------------------------------------------------------------------------------------

/** The id of a dashboard is the name of its file, and never changes. */
export const DASHBOARD_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** A definition file holds at most this many bytes. */
export const DASHBOARD_MAX_BYTES = 65_536;
export const DASHBOARD_MAX_WIDGETS = 12;
export const DASHBOARD_TITLE_MAX = 120;
export const DASHBOARD_QUESTION_MAX = 500;

export const DASHBOARD_KINDS = ["overview", "area", "question"] as const;
export const WIDGET_KINDS = [
  "kpi",
  "checklist",
  "list",
  "table",
  "bars",
  "agenda",
  "highlights",
  "note",
] as const;
export const SOURCE_KINDS = [
  "notes",
  "tasks",
  "decisions",
  "openLoops",
  "projects",
  "reviews",
  "facts",
  "runs",
  "approvals",
  "metrics",
  "connector",
] as const;
/** The series of `metrics/history.ts` a `metrics` source may name (amendment 9). */
export const METRIC_SERIES = [
  "runs24h",
  "failed24h",
  "costTodayUsd",
  "tokensToday",
  "inboxUnread",
  "approvalsPending",
] as const;
export const PROJECT_HEALTHS = ["done", "paused", "behind", "due_today", "in_review", "on_track"] as const;
export const KPI_MEASURES = ["count", "done_of_due", "open", "on_track_of_active", "latest"] as const;
/** Which sources a measure other than `count` reads (amendment 5); `count` reads any. */
export const MEASURE_SOURCES: Readonly<Record<(typeof KPI_MEASURES)[number], readonly string[] | null>> = {
  count: null,
  done_of_due: ["tasks"],
  open: ["tasks"],
  on_track_of_active: ["projects"],
  latest: ["metrics"],
};
/** `15m`, `1h`, `6h`, `daily@HH:MM` (00:00 to 23:59) or `manual`. */
export const DASHBOARD_REFRESH = /^(?:15m|1h|6h|manual|daily@(?:[01]\d|2[0-3]):[0-5]\d)$/;

const NATUREZA_VALUES = ["fato", "opiniao", "plano", "hipotese", "relato"] as const;
const ESCOPO_VALUES = ["pessoal", "equipe", "externo"] as const;
const textList = z.array(z.string().min(1).max(200)).min(1);

/** `source` is `{ kind, ...filter }` with these keys and no other (amendment 5). */
export const DashboardSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("notes"),
    type: textList.optional(),
    status: textList.optional(),
    tags: textList.optional(),
    natureza: z.array(z.enum(NATUREZA_VALUES)).min(1).optional(),
    escopo: z.array(z.enum(ESCOPO_VALUES)).min(1).optional(),
    folder: z.string().min(1).max(4096).refine(isAbsolutePath, "folder: an absolute path").optional(),
    changed: z.literal("week").optional(),
    groupBy: z.enum(["status", "type"]).optional(),
  }),
  z.object({ kind: z.literal("tasks"), window: z.enum(["today", "week"]) }),
  z.object({
    kind: z.literal("decisions"),
    window: z.literal("week"),
    state: z.enum(["open", "decided"]).optional(),
  }),
  z.object({ kind: z.literal("openLoops"), window: z.literal("week") }),
  z.object({ kind: z.literal("projects"), health: z.array(z.enum(PROJECT_HEALTHS)).min(1).optional() }),
  z.object({ kind: z.literal("reviews") }),
  z.object({ kind: z.literal("facts") }),
  z.object({ kind: z.literal("runs"), window: z.literal("24h").optional() }),
  z.object({ kind: z.literal("approvals") }),
  z.object({ kind: z.literal("metrics"), series: z.enum(METRIC_SERIES) }),
  z.object({
    kind: z.literal("connector"),
    id: z.string().min(1).max(80),
    read: z.enum(["list", "flagged", "summary"]),
    key: z.string().min(1).max(80).optional(),
  }),
]);
export type DashboardSource = z.infer<typeof DashboardSourceSchema>;

export const WidgetOptionsSchema = z.object({
  size: z.enum(["s", "m", "l", "xl"]).optional(),
  hidden: z.boolean().optional(),
  limit: z.number().int().min(1).max(50).optional(),
  measure: z.enum(KPI_MEASURES).optional(),
  period: z.enum(["day", "week"]).optional(),
  upIsGood: z.boolean().optional(),
  chip: z.enum(["remaining", "open", "behind"]).optional(),
  ordered: z.boolean().optional(),
  funnel: z.boolean().optional(),
});
export type WidgetOptions = z.infer<typeof WidgetOptionsSchema>;

const DashboardWidgetObject = z.object({
  id: z.string().regex(DASHBOARD_ID, "id: lower-case letters, digits and -"),
  kind: z.enum(WIDGET_KINDS),
  title: z.string().min(1).max(DASHBOARD_TITLE_MAX),
  source: DashboardSourceSchema,
  options: WidgetOptionsSchema.optional(),
});
export const DashboardWidgetSchema = DashboardWidgetObject.superRefine((w, ctx) => {
  if (w.source.kind === "connector" && w.source.key !== undefined && w.source.read !== "summary") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["source", "key"],
      message: "key: only with read summary",
    });
  }
  const measure = w.options?.measure;
  if (measure === undefined) return;
  if (w.kind !== "kpi") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["options", "measure"],
      message: "measure: only on a kpi",
    });
    return;
  }
  const sources = MEASURE_SOURCES[measure];
  if (sources !== null && !sources.includes(w.source.kind)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["options", "measure"],
      message: `measure ${measure}: only on a ${sources.join(" or ")} source`,
    });
  }
});
export type DashboardWidget = z.infer<typeof DashboardWidgetSchema>;

/** The bytes a definition is stored as: two-space JSON and a final newline. */
export function serializeDashboard(definition: unknown): string {
  return `${JSON.stringify(definition, null, 2)}\n`;
}

const utf8Length = (text: string): number => new TextEncoder().encode(text).length;

/** Door 1, without the size: what a definition holds. */
const DashboardShapeObject = z.object({
  v: z.literal(1),
  title: z.string().min(1).max(DASHBOARD_TITLE_MAX),
  kind: z.enum(DASHBOARD_KINDS),
  contextId: z.string().min(1).max(64).optional(),
  question: z.string().min(1).max(DASHBOARD_QUESTION_MAX).optional(),
  refresh: z.string().regex(DASHBOARD_REFRESH, "refresh: 15m, 1h, 6h, daily@HH:MM or manual"),
  widgets: z.array(DashboardWidgetSchema).max(DASHBOARD_MAX_WIDGETS),
});
const DashboardShape = DashboardShapeObject.superRefine((d, ctx) => {
  const seen = new Set<string>();
  d.widgets.forEach((w, i) => {
    if (seen.has(w.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["widgets", i, "id"],
        message: `id ${w.id}: used twice`,
      });
    }
    seen.add(w.id);
  });
  // A question dashboard runs only when asked (amendment 12): a paid skill every 15 minutes is what this closes.
  if (d.kind === "question" && d.refresh !== "manual") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["refresh"],
      message: "refresh: a question dashboard is manual",
    });
  }
  if (d.kind !== "area" && d.contextId !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contextId"],
      message: "contextId: only on an area dashboard",
    });
  }
  if (d.kind === "area" && d.contextId === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contextId"],
      message: "contextId: required on an area dashboard",
    });
  }
  if (d.kind === "question" && d.question === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["question"],
      message: "question: required on a question dashboard",
    });
  }
  if (d.kind !== "question" && d.question !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["question"],
      message: "question: only on a question dashboard",
    });
  }
});

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Door 1's "unknown field = `400 validation`" over the raw input. The objects themselves stay tolerant (the route
 * document never closes an object, so a generated client does not break on an additive field); the closed lists of
 * keys are checked here, at every level of a definition, with zod's own `unrecognized_keys` at the object's path.
 */
function refuseUnknownKeys(raw: unknown, ctx: z.RefinementCtx): void {
  const check = (value: unknown, allowed: readonly string[], at: Array<string | number>) => {
    if (!isRecord(value)) return;
    const keys = Object.keys(value).filter((k) => !allowed.includes(k));
    if (keys.length > 0) ctx.addIssue({ code: z.ZodIssueCode.unrecognized_keys, keys, path: at });
  };
  if (!isRecord(raw)) return;
  check(raw, Object.keys(DashboardShapeObject.shape), []);
  if (!Array.isArray(raw.widgets)) return;
  raw.widgets.forEach((widget: unknown, i: number) => {
    check(widget, Object.keys(DashboardWidgetObject.shape), ["widgets", i]);
    if (!isRecord(widget)) return;
    check(widget.options, Object.keys(WidgetOptionsSchema.shape), ["widgets", i, "options"]);
    const source = widget.source;
    const kind = isRecord(source) && typeof source.kind === "string" ? source.kind : undefined;
    const member = kind !== undefined ? DashboardSourceSchema.optionsMap.get(kind) : undefined;
    if (member) check(source, Object.keys(member.shape), ["widgets", i, "source"]);
  });
}

/** Door 1: a definition, as a file holds it and as `PUT` takes it; more than 65 536 bytes stored is refused. */
export const DashboardSpecSchema = z
  .preprocess((raw, ctx) => {
    refuseUnknownKeys(raw, ctx);
    return raw;
  }, DashboardShape)
  .superRefine((d, ctx) => {
    const bytes = utf8Length(serializeDashboard(d));
    if (bytes > DASHBOARD_MAX_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: `the definition takes ${bytes} bytes; at most ${DASHBOARD_MAX_BYTES}`,
      });
    }
  });
export type DashboardSpec = z.infer<typeof DashboardShape>;
export type DashboardKind = (typeof DASHBOARD_KINDS)[number];
export type WidgetKind = (typeof WIDGET_KINDS)[number];
export type SourceKind = (typeof SOURCE_KINDS)[number];

// ---- door 4: the snapshot --------------------------------------------------------------------------------------

export const SOURCE_STATUSES = ["ok", "error", "not_configured", "unavailable"] as const;
export const WIDGET_STATUSES = ["ok", "empty", "error"] as const;

export const SnapshotSourceSchema = z.object({
  /** The kind of a local source; `connector:<id>` for a connector. */
  id: z.string(),
  kind: z.string(),
  status: z.enum(SOURCE_STATUSES),
  syncedAt: z.number().nullable(),
  message: z.string().optional(),
});
export const SnapshotWidgetSchema = z.object({
  id: z.string(),
  kind: z.enum(WIDGET_KINDS),
  status: z.enum(WIDGET_STATUSES),
  /** What the widget draws; its shape is the source's (and the measure's, for a `kpi`). */
  data: z.unknown().optional(),
  error: z.string().optional(),
});
export const DashboardSnapshotSchema = z.object({
  v: z.literal(1),
  dashboardId: z.string(),
  generatedAt: z.number(),
  sources: z.array(SnapshotSourceSchema),
  widgets: z.array(SnapshotWidgetSchema),
});
export type DashboardSnapshot = z.infer<typeof DashboardSnapshotSchema>;
export type SnapshotSource = z.infer<typeof SnapshotSourceSchema>;
export type SnapshotWidget = z.infer<typeof SnapshotWidgetSchema>;

/** A highlight of door 5 (filled by the rules of S5). */
export const HighlightSchema = z.object({
  rule: z.string(),
  title: z.string(),
  tone: z.enum(["ok", "warn", "danger", "info"]),
  target: z.string(),
});

// ---- door 6: the routes ----------------------------------------------------------------------------------------

const VersionSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/, "expected sha256: and 64 hex digits");
const DashboardParams = z.object({ id: z.string().regex(DASHBOARD_ID, "a dashboard id") });

const dashboardNotFound = err(
  404,
  "dashboard_not_found",
  "No dashboard has this id, or its file is not one door 1 reads",
);
const refreshInProgress = err(409, "refresh_in_progress", "A refresh of this dashboard is running");

export const DashboardListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(DASHBOARD_KINDS),
  contextId: z.string().nullable(),
  refresh: z.string(),
  generatedAt: z.number().nullable(),
  stale: z.boolean(),
});

const DashboardWritten = z.object({ id: z.string(), definition: DashboardShape, version: VersionSchema });

export const dashboardRoutes = {
  "dashboards.list": route({
    method: "GET",
    path: "/api/dashboards",
    summary:
      "The dashboards of memory/dashboards/, by kind, title and id, with when each was last refreshed; a file door 1 refuses is a problem, not a dashboard",
    tag: "dashboards",
    scope: "content",
    responses: {
      200: z.object({
        dashboards: z.array(DashboardListItemSchema),
        problems: z.array(z.object({ id: z.string(), message: z.string() })),
      }),
    },
  }),
  "dashboards.create": route({
    method: "POST",
    path: "/api/dashboards",
    summary:
      "Create a dashboard from a template (overview, area of a context, question); its id is derived, with -2 to -99 when it is taken",
    tag: "dashboards",
    scope: "owner",
    body: z
      .object({
        template: z.enum(DASHBOARD_KINDS),
        title: z.string().trim().min(1).max(DASHBOARD_TITLE_MAX).optional(),
        contextId: z.string().min(1).max(64).optional(),
        question: z.string().optional(),
      })

      .superRefine((b, ctx) => {
        if (b.template === "area" && b.contextId === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["contextId"],
            message: "contextId: required for an area",
          });
        }
        if (b.template !== "area" && b.contextId !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["contextId"],
            message: "contextId: only for an area",
          });
        }
        if (b.template === "question") {
          const text = b.question?.trim() ?? "";
          if (text.length < 1 || text.length > DASHBOARD_QUESTION_MAX) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["question"],
              message: `question: 1 to ${DASHBOARD_QUESTION_MAX} characters`,
            });
          }
        } else if (b.question !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["question"],
            message: "question: only for a question",
          });
        }
      }),
    responses: { 201: DashboardWritten },
    errors: [contextNotFound, err(409, "dashboard_exists", "The derived id and its -2 to -99 are all taken")],
  }),
  "dashboards.get": route({
    method: "GET",
    path: "/api/dashboards/:id",
    summary:
      "A dashboard's definition, its version and its stored snapshot (no source is read); a stale snapshot is refreshed after the answer",
    tag: "dashboards",
    scope: "content",
    params: DashboardParams,
    query: z.object({ since: z.coerce.number().int().min(0).optional() }),
    responses: {
      200: z.object({
        definition: DashboardShape,
        version: VersionSchema,
        snapshot: DashboardSnapshotSchema.nullable(),
        stale: z.boolean(),
        highlights: z.array(HighlightSchema),
      }),
    },
    errors: [dashboardNotFound],
  }),
  "dashboards.update": route({
    method: "PUT",
    path: "/api/dashboards/:id",
    summary: "Replace a dashboard's definition, guarded by the version the caller read",
    tag: "dashboards",
    scope: "owner",
    params: DashboardParams,
    body: z.object({ definition: DashboardSpecSchema, baseVersion: VersionSchema }),
    responses: { 200: z.object({ definition: DashboardShape, version: VersionSchema }) },
    errors: [
      dashboardNotFound,
      err(409, "edit_conflict", "The file changed after it was read; nothing was written"),
    ],
  }),
  "dashboards.delete": route({
    method: "DELETE",
    path: "/api/dashboards/:id",
    summary:
      "Archive a dashboard to memory/archive/dashboards/<id>-<day>.json and delete its snapshot and its series",
    tag: "dashboards",
    scope: "owner",
    params: DashboardParams,
    responses: { 200: z.object({ archived: z.string() }) },
    errors: [dashboardNotFound],
  }),
  "dashboards.refresh": route({
    method: "POST",
    path: "/api/dashboards/:id/refresh",
    summary:
      "Evaluate every widget now (passing over the connectors' cache) and store the snapshot; a question dashboard starts its skill instead",
    tag: "dashboards",
    scope: "owner",
    params: DashboardParams,
    responses: {
      200: z.object({ snapshot: DashboardSnapshotSchema }),
      202: z.object({ runId: z.string() }),
    },
    errors: [
      dashboardNotFound,
      refreshInProgress,
      err(409, "skill_unavailable", "The dashboard-answer skill is missing, disabled or not a memory skill"),
      err(409, "budget_exhausted", "The skill's daily budget is exhausted"),
    ],
  }),
} as const;
