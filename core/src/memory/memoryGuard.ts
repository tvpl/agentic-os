import crypto from "node:crypto";
import path from "node:path";
import type { Settings } from "../config/schema.js";
import type { Db } from "../db/db.js";
import { EditConflictError } from "../errors.js";
import type { EventBus, OsEvent } from "../events.js";
import type { NotificationInput } from "../notifications/store.js";
import type { MordomoPaths } from "../paths.js";
import {
  FileTooLargeError,
  homeReadScope,
  readScope,
  readWorkspaceFile,
  type ReadScope,
} from "../security/safeFs.js";
import {
  moveWorkspaceFile,
  setAsideAndWrite,
  workspaceEntryKind,
  workspaceLinkTarget,
  writeWorkspaceFile,
} from "../security/safeWrite.js";
import { GUARD_DIR, guardDir } from "./folderAccess.js";
import { historyMaxBytes, newestVersion, recordVersion } from "./historyStore.js";
import { MEMORY_FILE, storeProposal } from "./proposals.js";

/**
 * The guard of `MEMORY.md` (.specs/features/cerebro-memoria-confiavel, door 8). A run that may write can reach
 * `memory/MEMORY.md` on disk, whatever its skill says (a home keeps the old copy of `consolidate-memory`, which wrote
 * it). So at `run.started` of a write run its bytes are kept (and recorded as a `guard` version when they differ from
 * the newest one), and at `run.finished`, when they changed and no version by the owner of `MEMORY.md` was recorded in
 * between, the start state is put back (the start bytes, or a file the run created moved to
 * `memory/archive/guard-<runId>-MEMORY.md`) and what the run wrote waits as a `memory_edit` proposal. Only the file at
 * the root of `memory/`: a `notes/MEMORY.md` is a note like any other.
 *
 * It fails closed (verification rounds 1 and 2): what the run left that cannot be read whole (past the read limit), a
 * link at the name, anything that is not a regular file, or a put-back the guarded replace refuses, is set aside whole
 * (never followed, never lost) and the owner's bytes are written back. The set-aside lies in `<home>/guard/`, a folder
 * of the home that is no folder a run is handed (its working folder, `memory/` and its artifacts are), so a run cannot
 * shape it: `memory/archive/` is the run's to make a file or a link, and the take-back must not depend on it. A link is
 * detected by `lstat` and never read through (the guard holds the owner's scope, which sees what the run may not): the
 * proposal names the link's target as written and holds no content. The proposal holds what could be read of a file
 * (a prefix, marked `truncated`, when it was too large); and the owner is told in the inbox. A step that still fails
 * is told there too.
 *
 * The start states live on this instance (one per engine), never in module state.
 */

export interface MemoryGuardDeps {
  db: Db;
  paths: MordomoPaths;
  getSettings: () => Settings;
  runs: {
    get(id: string): { request: { mode: string } | null; permissionProfile: string | null } | null;
  };
  /** Where the owner is told what the guard did not do the ordinary way (the inbox). */
  notifications?: { add(input: NotificationInput): unknown };
}

interface StartState {
  bytes: Buffer | null;
  /** The newest version id of the history when the run started. */
  mark: number;
}

/** The most bytes of `MEMORY.md` the guard reads (the ceiling of door 7 is 25 000). */
export const GUARD_READ_LIMIT = 4 * 1024 * 1024;
/** The most bytes of an oversized file a `memory_edit` proposal holds (the rest stays in the file set aside). */
export const GUARD_PROPOSAL_PREFIX = 256 * 1024;

/** What a run left at the name: nothing, a regular file read whole, or something the guard does not put back in place. */
type Left =
  | { kind: "none" }
  | { kind: "file"; bytes: Buffer }
  | {
      kind: "odd";
      why: "too_large" | "link" | "not_a_file" | "unreadable";
      bytes: Buffer | null;
      truncated: boolean;
      /** A link's target, as written in the link (never followed). */
      target?: string | null;
    };

const sha = (bytes: Uint8Array) => crypto.createHash("sha256").update(bytes).digest("hex");
const same = (a: Buffer | null, b: Buffer | null) => (a === null ? b === null : b !== null && a.equals(b));

const WHY: Record<Extract<Left, { kind: "odd" }>["why"], string> = {
  too_large: `larger than ${GUARD_READ_LIMIT} bytes`,
  link: "a link",
  not_a_file: "not a regular file",
  unreadable: "unreadable",
};

export class MemoryGuard {
  private readonly started = new Map<string, StartState>();

  constructor(private readonly deps: MemoryGuardDeps) {}

  private get file(): string {
    return path.join(this.deps.paths.memory, MEMORY_FILE);
  }

  private scope(): ReadScope {
    return homeReadScope(this.deps.paths.home, [this.deps.paths.memory], this.deps.getSettings().excludes);
  }

  /** The folder of the set-asides (judged by its own scope: it is no part of `memory/`). */
  private guardScope(): ReadScope {
    return readScope({ homeDir: this.deps.paths.home, roots: [guardDir(this.deps.paths)] });
  }

  private read(): Buffer | null {
    try {
      return readWorkspaceFile(this.scope(), this.file, { maxBytes: GUARD_READ_LIMIT, strict: true }).bytes;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  /** What is at the name now, never thrown about: a link is never read through, a file too large is read in part. */
  private look(): Left {
    let kind: ReturnType<typeof workspaceEntryKind>;
    try {
      kind = workspaceEntryKind(this.scope(), this.file);
    } catch {
      return { kind: "odd", why: "unreadable", bytes: null, truncated: false };
    }
    if (kind === "none") return { kind: "none" };
    if (kind === "other") return { kind: "odd", why: "not_a_file", bytes: null, truncated: false };
    if (kind === "link") {
      let target: string | null = null;
      try {
        target = workspaceLinkTarget(this.scope(), this.file);
      } catch {
        /* the name is all that is lost */
      }
      return { kind: "odd", why: "link", bytes: null, truncated: false, target };
    }
    let bytes: Buffer | null = null;
    let tooLarge = false;
    try {
      bytes = this.read();
    } catch (err) {
      tooLarge = err instanceof FileTooLargeError || (err as NodeJS.ErrnoException).code === "file_too_large";
      if (tooLarge) {
        try {
          bytes = readWorkspaceFile(this.scope(), this.file, { maxBytes: GUARD_PROPOSAL_PREFIX }).bytes;
        } catch {
          bytes = null;
        }
      }
    }
    // a link put at the name while it was read is not a file read: what was read is not kept
    try {
      if (workspaceEntryKind(this.scope(), this.file) !== "file") {
        return { kind: "odd", why: "link", bytes: null, truncated: false, target: workspaceLinkTarget(this.scope(), this.file) };
      }
    } catch {
      return { kind: "odd", why: "unreadable", bytes: null, truncated: false };
    }
    if (tooLarge) return { kind: "odd", why: "too_large", bytes, truncated: true };
    if (bytes === null) return { kind: "odd", why: "unreadable", bytes: null, truncated: false };
    return { kind: "file", bytes };
  }

  private record(bytes: Buffer | null, origin: "guard" | "removed"): void {
    recordVersion(
      this.deps.db,
      { rel: MEMORY_FILE, bytes, author: "system", origin },
      historyMaxBytes(this.deps.getSettings()),
    );
  }

  /** Tell the owner, in the inbox, what the guard did not do the ordinary way (never only in a log). */
  private tell(runId: string | null, body: string, tone: "warn" | "danger" = "warn"): void {
    try {
      this.deps.notifications?.add({
        kind: "system",
        tone,
        messageKey: "memory.guard",
        messageParams: {},
        title: "A guarda do MEMORY.md precisou de atenção",
        body,
        href: "/brain/reviews?tab=agent",
        ...(runId ? { runId } : {}),
      });
    } catch (err) {
      console.error("[memory] the guard of MEMORY.md could not write to the inbox", err);
    }
  }

  /** Whether the run writes: its request says so; a run with none is taken to write unless its profile only reads. */
  private writes(runId: string): boolean {
    const run = this.deps.runs.get(runId);
    if (!run) return false;
    if (run.request) return run.request.mode === "write";
    return run.permissionProfile !== "read_only";
  }

  /** Runs whose start state is kept (what a test or a caller can look at). */
  watching(): string[] {
    return [...this.started.keys()];
  }

  onStarted(runId: string): void {
    if (this.started.has(runId) || !this.writes(runId)) return;
    const left = this.look();
    if (left.kind === "odd") {
      // the owner's own MEMORY.md cannot be kept whole: nothing would be put back, and the owner is told so
      this.tell(runId, `At the start of the run ${runId} MEMORY.md is ${WHY[left.why]}: the guard cannot keep it.`);
      return;
    }
    const bytes = left.kind === "file" ? left.bytes : null;
    if (bytes !== null) {
      const newest = newestVersion(this.deps.db, MEMORY_FILE);
      if (!newest || newest.sha256 !== `sha256:${sha(bytes)}`) this.record(bytes, "guard");
    }
    const mark = (this.deps.db.prepare("SELECT COALESCE(MAX(id), 0) m FROM memory_versions").get() as { m: number }).m;
    this.started.set(runId, { bytes, mark });
  }

  /** Put the start bytes back over the run's (`expectSha256` of the run's bytes). Its own method, so it can be watched. */
  putBack(start: Buffer, runBytes: Buffer): void {
    writeWorkspaceFile(this.scope(), this.file, start, { mode: "replace", expectSha256: sha(runBytes) });
  }

  /**
   * Set the run's entry aside whole in `<home>/guard/` and write the start state back (no file: nothing is written).
   * The name is `guard-<runId>-MEMORY.md`, then `-2` ... `-99`: an earlier set-aside is never overwritten (the
   * safe writer refuses a `to` that exists, `EEXIST`, and the next name is tried). Answers the path from the home.
   */
  private takeBack(runId: string, start: Buffer | null): string {
    const dir = guardDir(this.deps.paths);
    // `guard-<runId>`, `-2` ... `-99` are names the owner can find; after them the names are made of random digits, so a
    // run that can write the home (a provider with no sandbox) cannot fill them beforehand and make the guard give up
    // (round 3, finding 7): the restore of the owner's bytes never waits on a free readable name. A name that exists is
    // never overwritten (`EEXIST`, and the next is tried).
    const names: string[] = [];
    for (let n = 1; n <= 99; n++) names.push(`guard-${runId}${n === 1 ? "" : `-${n}`}-${MEMORY_FILE}`);
    for (let i = 0; i < 8; i++) {
      names.push(`guard-${runId}-x${crypto.randomBytes(6).toString("hex")}-${MEMORY_FILE}`);
    }
    for (const [i, name] of names.entries()) {
      try {
        setAsideAndWrite(this.scope(), this.file, path.join(dir, name), start, this.guardScope());
        return `${GUARD_DIR}/${name}`;
      } catch (err) {
        // only a name that is taken moves on to the next; the run's entry is still at the name when it was
        const taken =
          (err as NodeJS.ErrnoException).code === "EEXIST" && workspaceEntryKind(this.scope(), this.file) !== "none";
        if (!taken || i === names.length - 1) throw err;
      }
    }
    throw new Error("unreachable");
  }

  onFinished(runId: string): void {
    const start = this.started.get(runId);
    if (!start) return;
    this.started.delete(runId);
    let left = this.look();
    if (left.kind === "none" ? start.bytes === null : left.kind === "file" && same(start.bytes, left.bytes)) return;
    if (left.kind !== "odd") {
      const owner = this.deps.db
        .prepare("SELECT 1 FROM memory_versions WHERE path = ? AND author = 'owner' AND id > ? LIMIT 1")
        .get(MEMORY_FILE, start.mark);
      if (owner) return; // the owner wrote MEMORY.md during the run: what is there is theirs (AC 73)
    }
    const runBytes = left.kind === "none" ? null : left.bytes;
    if (left.kind === "file") this.record(left.bytes, "guard");
    let aside: string | null = null;
    let restored = false;
    const failed: string[] = [];
    const forced = () => {
      try {
        aside = this.takeBack(runId, start.bytes);
        restored = true;
      } catch (err) {
        failed.push(`the guard could not put MEMORY.md back: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    if (left.kind === "odd") forced();
    else {
      try {
        if (start.bytes !== null && left.kind === "file") this.putBack(start.bytes, left.bytes);
        else if (start.bytes === null && left.kind === "file") {
          aside = `archive/guard-${runId}-${MEMORY_FILE}`;
          moveWorkspaceFile(this.scope(), this.file, path.join(this.deps.paths.memory, ...aside.split("/")), {
            expectSha256: sha(left.bytes),
          });
        } else if (start.bytes !== null) {
          // the run removed MEMORY.md: its bytes come back
          writeWorkspaceFile(this.scope(), this.file, start.bytes, { mode: "create" });
        }
        restored = true;
      } catch (err) {
        aside = null;
        const again = this.look();
        if (err instanceof EditConflictError && again.kind === "file") {
          // the file changed again after the run (G7): it stays as it is, and the run's bytes still wait for review
        } else {
          // anything else the ordinary put-back refuses (a link put there, a file grown past the limit, a name taken
          // since): the name is taken back by setting what is there aside (finding 1)
          left = again;
          forced();
        }
      }
    }
    if (restored) {
      if (start.bytes !== null) this.record(start.bytes, "guard");
      else this.record(null, "removed");
    }
    const odd = left.kind === "odd" ? left : null;
    storeProposal(
      this.deps.db,
      {
        kind: "memory_edit",
        author: `run:${runId}`,
        runId,
        summary: odd
          ? `The run ${runId} left MEMORY.md ${odd.why === "link" ? "replaced by a link" : WHY[odd.why]}; the guard set it aside${aside ? ` at ${aside}` : ""}.`
          : `The run ${runId} changed MEMORY.md; the guard put the file back.`,
        payload: {
          path: MEMORY_FILE,
          content: runBytes === null ? "" : runBytes.toString("utf8"),
          ...(aside ? { aside } : {}),
          ...(odd?.target !== undefined && odd.target !== null ? { linkTarget: odd.target } : {}),
          ...(odd?.truncated ? { truncated: true } : {}),
        },
      },
      // the guard has no caller to answer a 429 to: it always stores (G8)
      { capped: false },
    );
    if (odd || failed.length > 0) {
      const what = odd ? `The run ${runId} left MEMORY.md ${WHY[odd.why]}.` : `The run ${runId} changed MEMORY.md.`;
      const done = restored
        ? ` The guard put the owner's MEMORY.md back${aside ? ` and set the run's entry aside at ${aside}` : ""}.`
        : "";
      this.tell(runId, `${what}${done}${failed.length > 0 ? ` ${failed.join("; ")}.` : ""}`, restored ? "warn" : "danger");
    }
  }

  /** Subscribe to the bus; returns the unsubscribe function. */
  install(bus: EventBus): () => void {
    return bus.subscribe((event: OsEvent) => {
      if (event.type !== "run.started" && event.type !== "run.finished") return;
      const runId = (event.payload as { runId?: unknown } | undefined)?.runId;
      if (typeof runId !== "string") return;
      try {
        if (event.type === "run.started") this.onStarted(runId);
        else this.onFinished(runId);
      } catch (err) {
        console.error(`[memory] the guard of MEMORY.md failed at ${event.type}`, err);
        this.tell(
          runId,
          `The guard of MEMORY.md failed at ${event.type} of the run ${runId}: ${err instanceof Error ? err.message : String(err)}`,
          "danger",
        );
      }
    });
  }
}
