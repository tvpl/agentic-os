import path from "node:path";
import {
  QUESTION_MAX_WIDGETS,
  QUESTION_RESULT_MAX_BYTES,
  QuestionResultSchema,
  type SnapshotWidget,
} from "@mordomo/contracts";
import type { Settings } from "../config/schema.js";
import type { Db } from "../db/db.js";
import type { MordomoPaths } from "../paths.js";
import type { CleanupScope } from "../memory/cleanup.js";
import { fieldsFromDb } from "../memory/fields.js";
import { storedRowFilter } from "../memory/indexer.js";
import { readNatureza, type Natureza } from "../memory/natureza.js";

/**
 * The host's check of a question dashboard's answer (.specs/features/cerebro-paineis, door 7, AC 52, amendment 19):
 * `artifacts/<run>/dashboard.json` becomes the snapshot only if it is at most 256 KB, validates against the answer's
 * schema, has at most 6 widgets each with at least one citation, every file it names - a citation, a `list` item's
 * `path`, a `table` row's `path` (L-055) - is a row of the index that today's policy shows (and inside the context's
 * scope when there is one), and no item from a note of nature `plano`, `hipotese` or `opiniao` lacks that label.
 */

/** The id of the card the host adds after the answer's widgets: "Como esta resposta foi feita" (`design.md`). */
export const QUESTION_RUN_CARD = "como-foi-feita";
const LABELLED: ReadonlySet<Natureza> = new Set(["plano", "hipotese", "opiniao"]);

export interface QuestionCheckEnv {
  db: Db;
  paths: MordomoPaths;
  settings: Settings;
  /** The context's scope, or null for the whole brain. */
  scope: CleanupScope | null;
}

export type QuestionVerdict = { ok: true; widgets: SnapshotWidget[] } | { ok: false; reason: string };

interface FileRow {
  id: number;
  root: string;
  rel: string;
  path: string;
  name: string;
  fields: string | null;
}

type Row = Record<string, unknown>;
const rowsOf = (data: Row, key: "items" | "rows"): Row[] =>
  Array.isArray(data[key])
    ? (data[key] as unknown[]).filter((x): x is Row => typeof x === "object" && x !== null)
    : [];

/** Accept or refuse an answer, with the reason a refusal is shown with. */
export function checkQuestionResult(bytes: Buffer, env: QuestionCheckEnv): QuestionVerdict {
  if (bytes.length > QUESTION_RESULT_MAX_BYTES) {
    return { ok: false, reason: `The answer is larger than ${QUESTION_RESULT_MAX_BYTES} bytes.` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { ok: false, reason: "The answer is not JSON." };
  }
  const parsed = QuestionResultSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    return { ok: false, reason: `The answer does not match the snapshot's schema: ${issues}` };
  }
  const { widgets } = parsed.data;
  if (widgets.length > QUESTION_MAX_WIDGETS) {
    return {
      ok: false,
      reason: `The answer has ${widgets.length} widgets; at most ${QUESTION_MAX_WIDGETS}.`,
    };
  }
  const ids = new Set<string>([QUESTION_RUN_CARD]);
  for (const w of widgets) {
    if (ids.has(w.id)) return { ok: false, reason: `The widget id ${w.id} is used twice or is the host's.` };
    ids.add(w.id);
    if (w.citations.length === 0) return { ok: false, reason: `The widget ${w.id} has no citation.` };
  }

  const policy = storedRowFilter(env.settings.excludes, { homeDir: env.paths.home });
  const lookup = env.db.prepare("SELECT id, root, rel, path, name, fields FROM files WHERE path = ?");
  const files = new Map<string, FileRow>();
  /** The index row of a file the answer names, or the reason it may not be named. */
  const allowed = (file: string, where: string): FileRow | string => {
    const row = lookup.get(path.resolve(file)) as FileRow | undefined;
    if (!row) return `${where} names ${file}, which the index does not have.`;
    if (!policy(row)) return `${where} names ${file}, which today's policy excludes.`;
    if (env.scope !== null && !env.scope.within(row)) {
      return `${where} names ${file}, which is outside the dashboard's context.`;
    }
    files.set(file, row);
    return row;
  };

  for (const w of widgets) {
    for (const c of w.citations) {
      const found = allowed(c.path, `A citation of ${w.id}`);
      if (typeof found === "string") return { ok: false, reason: found };
    }
    for (const key of ["items", "rows"] as const) {
      for (const [i, item] of rowsOf(w.data, key).entries()) {
        if (typeof item.path !== "string") continue;
        const where = `${key === "items" ? "Item" : "Row"} ${i + 1} of ${w.id}`;
        const found = allowed(item.path, where);
        if (typeof found === "string") return { ok: false, reason: found };
        const natureza = readNatureza(fieldsFromDb(found.fields));
        if (natureza !== null && LABELLED.has(natureza) && item.natureza !== natureza) {
          return {
            ok: false,
            reason: `${where} comes from a note of natureza ${natureza} and lacks its label.`,
          };
        }
      }
    }
  }

  return {
    ok: true,
    widgets: widgets.map((w) => ({
      id: w.id,
      kind: w.kind,
      status: w.status ?? "ok",
      data: {
        ...w.data,
        title: w.title,
        // each citation with the index id it opens (`/brain?sel=<id>`, amendment 18) and the name it is shown by
        citations: w.citations.map((c) => {
          const row = files.get(c.path)!;
          return { path: row.path, section: c.section, name: row.name, fileId: row.id };
        }),
      },
    })),
  };
}
