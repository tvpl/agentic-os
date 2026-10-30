import path from "node:path";
import type { Db } from "../db/db.js";
import type { Settings } from "../config/schema.js";
import type { MordomoPaths } from "../paths.js";
import { NotRegularFileError } from "../security/safeFs.js";
import { assertFact, type Fact } from "./facts.js";
import type { PropertyValue } from "./frontMatter.js";
import { storedRowFilter } from "./indexer.js";
import { NATUREZAS, readNatureza, type Natureza } from "./natureza.js";
import {
  NoteMissingError,
  NoteNotEditableError,
  classifyNotePath,
  readNote,
  saveProperties,
  type NoteContext,
} from "./notes.js";
import { localDay, readReviewState, type ReviewStateView } from "./reviews.js";

/**
 * The owner's decision on a review (.specs/features/cerebro-natureza, doors 4 and 6, amendments 4 and 7). A note of
 * `memory/` that may be edited (`classifyNotePath`, and UTF-8 text) is written through the guarded properties write
 * (`saveProperties`, with `baseVersion`); every other file keeps "still holds", "snooze" and "never" in `review_state`
 * and is never written. A snooze is never written to a header. `restore` puts a `review_state` row back to the
 * `previous` a decision answered.
 */

export const REVIEW_ACTIONS = ["keep", "snooze", "never", "abandon", "became_fact", "classify", "restore"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export interface ReviewDecisionInput {
  path: string;
  action: ReviewAction;
  days?: number | undefined;
  natureza?: Natureza | undefined;
  baseVersion?: string | undefined;
  fact?: { subject: string; predicate: string; object: string; validFrom?: number | undefined } | undefined;
  /** `restore`: the row to put back, or null to remove it. Absent is a refusal. */
  state?: ReviewStateView | null | undefined;
}

export interface ReviewDecisionResult {
  /** The file as the index names it. */
  path: string;
  state: ReviewStateView | null;
  previous: ReviewStateView | null;
  version?: string;
  fact?: Fact;
}

export interface ReviewDecisionDeps {
  db: Db;
  paths: MordomoPaths;
  settings: Settings;
}

/** `400 validation`: a decision this route does not take. Nothing is written. */
export class ReviewValidationError extends Error {
  readonly statusCode = 400;
  readonly code = "validation";
  constructor(message: string) {
    super(message);
    this.name = "ReviewValidationError";
  }
}

/** `404 not_found`: the path names no indexed file today's policy shows. Nothing is written. */
export class ReviewNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = "not_found";
  constructor(file: string) {
    super(`No indexed file is at ${file}.`);
    this.name = "ReviewNotFoundError";
  }
}

const DAY_MS = 86_400_000;
const NOTE_ONLY: ReadonlySet<ReviewAction> = new Set(["abandon", "became_fact", "classify"]);
const isMs = (value: unknown): boolean => value === null || (typeof value === "number" && Number.isSafeInteger(value));

/** The refusals that need no file (door 4): each answers `400 validation` before anything is read. */
function validate(input: ReviewDecisionInput): void {
  if (!(REVIEW_ACTIONS as readonly string[]).includes(input.action)) {
    throw new ReviewValidationError(`action: one of ${REVIEW_ACTIONS.join(", ")}`);
  }
  if (input.action === "snooze") {
    if (input.days === undefined || !Number.isInteger(input.days) || input.days < 1 || input.days > 365) {
      throw new ReviewValidationError("days: a whole number of days from 1 to 365");
    }
  }
  if (input.action === "classify") {
    if (input.natureza === undefined || !(NATUREZAS as readonly string[]).includes(input.natureza)) {
      throw new ReviewValidationError(`natureza: one of ${NATUREZAS.join(", ")}`);
    }
  }
  if (input.action === "restore") {
    const state = input.state;
    if (state === undefined) throw new ReviewValidationError("state: the previous a decision answered, or null");
    if (
      state !== null &&
      (!isMs(state.lastReviewed) || !isMs(state.snoozeUntil) || (state.never !== 0 && state.never !== 1))
    ) {
      throw new ReviewValidationError("state: { lastReviewed, snoozeUntil } in ms or null, and never 0 or 1");
    }
  }
  if (input.action === "became_fact" && input.fact) {
    for (const key of ["subject", "predicate", "object"] as const) {
      if (input.fact[key].trim() === "") throw new ReviewValidationError(`fact.${key}: not empty`);
    }
  }
}

function writeState(db: Db, file: string, state: ReviewStateView | null, now: number): void {
  if (state === null) {
    db.prepare("DELETE FROM review_state WHERE path = ?").run(file);
    return;
  }
  db.prepare(
    `INSERT INTO review_state (path, last_reviewed, snooze_until, never, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET last_reviewed = excluded.last_reviewed, snooze_until = excluded.snooze_until,
       never = excluded.never, updated_at = excluded.updated_at`,
  ).run(file, state.lastReviewed, state.snoozeUntil, state.never, now);
}

const EMPTY: ReviewStateView = { lastReviewed: null, snoozeUntil: null, never: 0 };

/**
 * Decide a review (door 4). Checked in this order, writing nothing on a refusal: the decision itself (`400`), the
 * indexed row (`404 not_found`), the path (`403 forbidden_path`), what may be edited (`403 note_not_editable` for
 * `became_fact`, `abandon` and `classify` outside it), then, for a note, `baseVersion` (`400` without it), its size
 * (`413`), its version (`409 edit_conflict`) and its header (`409 front_matter_unreadable`). `became_fact` writes the
 * note first and then asserts the fact: a fact that fails leaves the note written.
 */
export function decideReview(
  deps: ReviewDecisionDeps,
  input: ReviewDecisionInput,
  now: number = Date.now(),
): ReviewDecisionResult {
  validate(input);
  const ctx: NoteContext = { paths: deps.paths, settings: deps.settings };
  const logical = path.resolve(deps.paths.memory, input.path);
  const row = deps.db.prepare("SELECT root, rel FROM files WHERE path = ?").get(logical) as
    | { root: string; rel: string }
    | undefined;
  if (!row || !storedRowFilter(deps.settings.excludes, { homeDir: deps.paths.home })(row)) {
    throw new ReviewNotFoundError(input.path);
  }
  const classified = classifyNotePath(ctx, logical);
  const previous = readReviewState(deps.db, logical);
  const today = localDay(now);

  let note: ReturnType<typeof readNote> | null = null;
  if (classified.editable && input.action !== "snooze" && input.action !== "restore") {
    try {
      note = readNote(ctx, logical);
    } catch (err) {
      // Gone since the pass, or a folder where the file was: no indexed file is there any more.
      if ((err as NodeJS.ErrnoException).code === "ENOENT" || err instanceof NotRegularFileError) {
        throw new ReviewNotFoundError(input.path);
      }
      throw err;
    }
    if (!note.editable) note = null;
  }
  if (NOTE_ONLY.has(input.action) && note === null) {
    throw new NoteNotEditableError(
      classified.reason ?? "Only a Markdown note of memory/ that is UTF-8 text can take this decision.",
    );
  }

  let version: string | undefined;
  let fact: Fact | undefined;
  if (note !== null) {
    if (input.baseVersion === undefined) throw new ReviewValidationError("baseVersion: the version of the note read");
    const set: Record<string, PropertyValue> = {};
    if (input.action === "keep") set.last_reviewed = today;
    if (input.action === "never") set.review_every = "never";
    if (input.action === "classify") set.natureza = input.natureza!;
    if (input.action === "abandon") Object.assign(set, { status: "archived", abandoned: today });
    if (input.action === "became_fact") {
      const raw = note.properties.find((p) => p.key === "natureza")?.value;
      const was = typeof raw === "string" ? readNatureza({ natureza: raw }) : null;
      Object.assign(set, { natureza: "fato", ...(was ? { was } : {}), became_fact: today, last_reviewed: today });
    }
    try {
      version = saveProperties(ctx, { path: logical, baseVersion: input.baseVersion, set }).version;
    } catch (err) {
      if (err instanceof NoteMissingError || err instanceof NotRegularFileError) throw new ReviewNotFoundError(input.path);
      throw err;
    }
    if (input.action === "became_fact" && input.fact) {
      fact = assertFact(deps.db, {
        subject: input.fact.subject,
        predicate: input.fact.predicate,
        object: input.fact.object,
        validFrom: input.fact.validFrom ?? now,
        sourcePath: logical,
      }).fact;
    }
  } else {
    const base = previous ?? EMPTY;
    if (input.action === "keep") writeState(deps.db, logical, { ...base, lastReviewed: now }, now);
    if (input.action === "snooze") writeState(deps.db, logical, { ...base, snoozeUntil: now + input.days! * DAY_MS }, now);
    if (input.action === "never") writeState(deps.db, logical, { ...base, never: 1 }, now);
    if (input.action === "restore") writeState(deps.db, logical, input.state ?? null, now);
  }
  return {
    path: logical,
    state: readReviewState(deps.db, logical),
    previous,
    ...(version !== undefined ? { version } : {}),
    ...(fact !== undefined ? { fact } : {}),
  };
}
