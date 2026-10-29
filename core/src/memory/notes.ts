import crypto from "node:crypto";
import path from "node:path";
import type { Settings } from "../config/schema.js";
import { PathAccessError } from "../errors.js";
import type { MordomoPaths } from "../paths.js";
import { realpathLenient } from "../security/paths.js";
import { homeReadScope, openWorkspaceFile, statWorkspacePath, type ReadScope } from "../security/safeFs.js";
import { writeWorkspaceFile } from "../security/safeWrite.js";
import { workspaceScope } from "./preview.js";
import { areaSlug } from "./routers.js";

/**
 * Notes: the Markdown files the owner creates and edits under `memory/` (.specs/features/cerebro-v2).
 *
 * Every byte goes through the safe primitives: a note is READ with `openWorkspaceFile` and WRITTEN with
 * `writeWorkspaceFile` (`create` for a new one, a guarded `replace` for a save), so a link anywhere on the way, a
 * hard link of a private file and a path outside `memory/` are refused by the same code that guards everything else.
 * What this module adds are the rules of a note: which files are notes, how a title becomes a name, how big a note
 * may be, and the version a save has to name.
 */

/** Where a note made from a title goes, under `memory/`. */
export const NOTES_DIR = "notes";
/** The most a note may hold, whatever `limits.maxIndexedFileBytes` says: a note is read whole by the editor. */
export const MAX_NOTE_BYTES = 1024 * 1024;
export const MAX_TITLE_CHARS = 200;
export const MAX_TAGS = 20;
export const TAG_PATTERN = /^[\p{L}\d_-]{2,30}$/u;
/** `-2` to `-99`: how many notes may share one title. */
export const MAX_SAME_NAME = 99;
/** Folders of `memory/` the engine writes itself (the routers, the maps of the work contexts) or only appends to (the journal). */
const GENERATED_DIRS = new Set(["areas", "journal", "contexts"]);
const GENERATED_FILES = new Set(["router.md"]);
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
const VERSION_PATTERN = /^sha256:([0-9a-f]{64})$/;

/** Refusals of the rules of a note: each is one status and its stable code (what the API answers). */
export class NoteValidationError extends Error {
  readonly statusCode = 400;
  constructor(
    readonly code: "validation" | "unknown_area",
    message: string,
  ) {
    super(message);
    this.name = "NoteValidationError";
  }
}
export class NoteNotEditableError extends Error {
  readonly statusCode = 403;
  readonly code = "note_not_editable";
  constructor(message: string) {
    super(message);
    this.name = "NoteNotEditableError";
  }
}
export class NoteMissingError extends Error {
  readonly statusCode = 404;
  readonly code = "note_missing";
  constructor(message: string) {
    super(message);
    this.name = "NoteMissingError";
  }
}
export class NoteExistsError extends Error {
  readonly statusCode = 409;
  readonly code = "note_exists";
  constructor(message: string) {
    super(message);
    this.name = "NoteExistsError";
  }
}
export class NoteTooLargeError extends Error {
  readonly statusCode = 413;
  readonly code = "note_too_large";
  constructor(limit: number) {
    super(`The note is larger than the limit of ${limit} bytes.`);
    this.name = "NoteTooLargeError";
  }
}

export interface NoteContext {
  paths: MordomoPaths;
  settings: Settings;
}

export interface NoteWritten {
  /** The file as the index names it (under `paths.memory`, not by real path). */
  path: string;
  name: string;
  version: string;
  size: number;
  mtime: number;
}

export interface NoteRead extends NoteWritten {
  content: string;
  editable: boolean;
  /** Why it cannot be edited, when `editable` is false. */
  reason?: string;
}

export interface CreateNoteInput {
  title: string;
  area?: string | undefined;
  content?: string | undefined;
  frontMatter?: boolean | undefined;
  tags?: string[] | undefined;
}

export interface SaveNoteInput {
  path: string;
  content: string;
  baseVersion: string;
}

/** The most bytes a note may hold under these settings. */
export function noteLimitBytes(settings: Settings): number {
  return Math.min(settings.limits.maxIndexedFileBytes, MAX_NOTE_BYTES);
}

/** `sha256:` plus the hex digest of the exact bytes: the version a save names. */
export function versionOf(bytes: Uint8Array | string): string {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

/** A file name (without extension) from a title. */
export function slugify(title: string): string {
  let slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  if (slug === "") slug = "nota";
  return WINDOWS_DEVICE.test(slug) ? `${slug}-nota` : slug;
}

const memoryScope = (ctx: NoteContext): ReadScope =>
  homeReadScope(ctx.paths.home, [ctx.paths.memory], ctx.settings.excludes);

interface Classified {
  /** The path as the caller named it, made absolute under `memory/` when it was relative. */
  logical: string;
  editable: boolean;
  reason?: string;
}

/**
 * May this path be edited as a note? Only a `.md` file under `memory/` that the engine does not generate. The home's
 * `config/` and `logs/` are not "not editable", they are not there at all: they throw `PathAccessError` (403).
 */
export function classifyNotePath(ctx: NoteContext, candidate: string): Classified {
  return unnameableIsForbidden(candidate, () => classify(ctx, candidate));
}

/** Errors of the file system for a path that cannot be a name at all (`GET /api/memory/preview` answers them 403 too). */
const UNNAMEABLE = new Set(["ENAMETOOLONG", "ERR_INVALID_ARG_VALUE", "EINVAL", "ELOOP"]);

/**
 * Run `work` for a path the caller named: one with a NUL byte, a component past the file system's limit or a loop of
 * links is no file anyone could have (`403 forbidden_path`, like the preview), not an internal error. `ENOENT` and the
 * like pass through for the route to call "missing".
 */
function unnameableIsForbidden<T>(candidate: string, work: () => T): T {
  if (candidate.includes("\0")) throw new PathAccessError(candidate, "The path cannot name a file: it holds a NUL byte.");
  try {
    return work();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== undefined && UNNAMEABLE.has(code)) {
      throw new PathAccessError(candidate, "The path cannot name a file: a name in it is too long or it loops.");
    }
    throw err;
  }
}

function classify(ctx: NoteContext, candidate: string): Classified {
  const logical = path.resolve(ctx.paths.memory, candidate);
  const real = realpathLenient(logical);
  const probe = homeReadScope(ctx.paths.home, [ctx.paths.home]);
  const homePrivate = probe.filter.homePrivateReason(real);
  if (homePrivate) throw new PathAccessError(candidate, homePrivate);

  const memoryReal = realpathLenient(path.resolve(ctx.paths.memory));
  const asNamed = path.relative(path.resolve(ctx.paths.memory), logical);
  if (asNamed === "" || asNamed.startsWith("..") || path.isAbsolute(asNamed)) {
    return { logical, editable: false, reason: "Only notes under memory/ can be edited." };
  }
  // Named under memory/ but reached through a link (the file, or a folder on the way): a write would follow it.
  if (real !== path.join(memoryReal, asNamed)) {
    throw new PathAccessError(candidate, `Refusing a link: ${candidate}`);
  }
  const rel = asNamed;
  const parts = rel.split(path.sep);
  if (parts.length === 1 && GENERATED_FILES.has(parts[0]!.toLowerCase())) {
    return { logical, editable: false, reason: "ROUTER.md is generated; regenerate it instead of editing it." };
  }
  if (GENERATED_DIRS.has(parts[0]!.toLowerCase()) && parts.length > 1) {
    return {
      logical,
      editable: false,
      reason:
        parts[0]!.toLowerCase() === "journal"
          ? "The journal only grows; add a line to it instead of editing it."
          : parts[0]!.toLowerCase() === "contexts"
            ? "The context maps are generated; change the context or regenerate the routers instead of editing them."
            : "The area indexes are generated; regenerate them instead of editing them.",
    };
  }
  const ext = path.extname(real).toLowerCase();
  if (ext !== ".md") return { logical, editable: false, reason: "Only Markdown (.md) notes can be edited." };
  return { logical, editable: true };
}

function assertText(bytes: Buffer): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Read a note for editing: the whole text, the version a save must name, and whether it can be edited. A file past the
 * limit is `413 note_too_large` (the preview still shows its head); a file that is not UTF-8 text is read-only.
 */
export function readNote(ctx: NoteContext, candidate: string): NoteRead {
  return unnameableIsForbidden(candidate, () => readClassified(ctx, candidate));
}

function readClassified(ctx: NoteContext, candidate: string): NoteRead {
  const classified = classifyNotePath(ctx, candidate);
  const limit = noteLimitBytes(ctx.settings);
  const scope = workspaceScope(ctx.settings, [ctx.paths.home], { homeDir: ctx.paths.home });
  const file = openWorkspaceFile(scope, classified.logical);
  try {
    if (file.stat.size > limit) {
      throw new NoteTooLargeError(limit);
    }
    const { bytes } = file.readBytes(limit);
    const text = assertText(bytes);
    const base: NoteWritten = {
      path: classified.logical,
      name: path.basename(classified.logical),
      version: versionOf(bytes),
      size: bytes.length,
      mtime: Math.floor(file.stat.mtimeMs),
    };
    if (text === null) {
      return { ...base, content: "", editable: false, reason: "The file is not UTF-8 text." };
    }
    return {
      ...base,
      content: text,
      editable: classified.editable,
      ...(classified.reason ? { reason: classified.reason } : {}),
    };
  } finally {
    file.close();
  }
}

function frontMatterBlock(title: string, tags: readonly string[], now: Date): string {
  const lines = ["---", `title: ${JSON.stringify(title)}`];
  if (tags.length > 0) lines.push(`tags: [${tags.join(", ")}]`);
  lines.push(`created: ${now.toISOString()}`, "---", "");
  return lines.join("\n");
}

const hasControlCharacter = (text: string): boolean =>
  [...text].some((ch) => {
    const code = ch.codePointAt(0)!;
    return code < 32 || code === 127;
  });

function validateTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed === "" || [...trimmed].length > MAX_TITLE_CHARS || hasControlCharacter(trimmed)) {
    throw new NoteValidationError("validation", `title: expected 1 to ${MAX_TITLE_CHARS} characters on one line, with no control characters`,
    );
  }
  return trimmed;
}

function validateTags(tags: readonly string[]): void {
  if (tags.length > MAX_TAGS || tags.some((tag) => !TAG_PATTERN.test(tag))) {
    throw new NoteValidationError("validation", `tags: at most ${MAX_TAGS}, each 2 to 30 letters, digits, "_" or "-"`);
  }
}

/** The text of a new note: optional front matter, the heading, then the body the caller gave. */
export function newNoteText(input: CreateNoteInput, title: string, now: Date = new Date()): string {
  const body = input.content === undefined || input.content.trim() === "" ? "" : `${input.content.replace(/\s+$/, "")}\n`;
  return `${input.frontMatter ? frontMatterBlock(title, input.tags ?? [], now) : ""}# ${title}\n\n${body}`;
}

/**
 * Create `memory/notes/[<area>/]<slug>.md`. The file is made in `create` mode, so nothing that exists is touched;
 * a name taken gets `-2`, `-3` … up to `-99`.
 */
export function createNote(ctx: NoteContext, input: CreateNoteInput, now: Date = new Date()): NoteWritten {
  const title = validateTitle(input.title);
  validateTags(input.tags ?? []);
  if (input.area !== undefined && !ctx.settings.areas.includes(input.area)) {
    throw new NoteValidationError("unknown_area", `Unknown area "${input.area}": use one of the areas in the settings.`);
  }
  const text = newNoteText(input, title, now);
  const limit = noteLimitBytes(ctx.settings);
  if (Buffer.byteLength(text, "utf8") > limit) throw new NoteTooLargeError(limit);

  const dir = path.join(ctx.paths.memory, NOTES_DIR, ...(input.area ? [areaSlug(input.area) || "area"] : []));
  const slug = slugify(title);
  const scope = memoryScope(ctx);
  for (let n = 1; n <= MAX_SAME_NAME; n++) {
    const name = `${n === 1 ? slug : `${slug}-${n}`}.md`;
    const target = path.join(dir, name);
    try {
      writeWorkspaceFile(scope, target, text, { mode: "create" });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw err;
    }
    const stat = statWorkspacePath(scope, target).stat;
    return { path: target, name, version: versionOf(text), size: Buffer.byteLength(text, "utf8"), mtime: Math.floor(stat.mtimeMs) };
  }
  throw new NoteExistsError(`There are already ${MAX_SAME_NAME} notes named "${slug}".`);
}

/**
 * Replace a note, only if it is still the version the caller read. The hash is checked on the descriptor that is then
 * truncated (`writeWorkspaceFile`'s `expectSha256`), so a file that changed in between is `409 edit_conflict` and keeps
 * its bytes.
 */
export function saveNote(ctx: NoteContext, input: SaveNoteInput): NoteWritten {
  const match = VERSION_PATTERN.exec(input.baseVersion);
  if (!match) throw new NoteValidationError("validation", "baseVersion: expected sha256: and 64 hex digits");
  const classified = classifyNotePath(ctx, input.path);
  if (!classified.editable) throw new NoteNotEditableError(classified.reason ?? "This file cannot be edited.");
  const limit = noteLimitBytes(ctx.settings);
  const bytes = Buffer.from(input.content, "utf8");
  if (bytes.length > limit) throw new NoteTooLargeError(limit);
  try {
    unnameableIsForbidden(input.path, () =>
      writeWorkspaceFile(memoryScope(ctx), classified.logical, bytes, { mode: "replace", expectSha256: match[1]! }),
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NoteMissingError("The note does not exist any more; it was not created.");
    }
    throw err;
  }
  const stat = statWorkspacePath(memoryScope(ctx), classified.logical).stat;
  return {
    path: classified.logical,
    name: path.basename(classified.logical),
    version: versionOf(bytes),
    size: bytes.length,
    mtime: Math.floor(stat.mtimeMs),
  };
}
