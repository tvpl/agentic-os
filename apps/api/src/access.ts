import os from "node:os";
import path from "node:path";
import {
  accessSettings,
  exportsDir,
  grantedReadScope,
  inspectPath,
  isInside,
  readScope,
  realpathLenient,
  resolveFolderAccess,
  storedRowFilter,
  type FolderAccess,
  type ReadScope,
} from "@mordomo/core/internal";
import type { Settings } from "@mordomo/core";
import type { AppContext } from "./context.js";
import type { Principal } from "./routes/common.js";

/**
 * What a request may read, by who made it (.specs/features/cerebro-memoria-confiavel, door 12): a paired device reads
 * as `devices`, a run's own credential as `agents`, and the owner (and the permission broker, which reads nothing) as
 * before. Every read route takes its settings, its stored-row filter and its read scopes from here, so a folder hidden
 * from the caller is left out by the same filter that leaves out the owner's excludes.
 */
export interface AccessView {
  /** `devices`, `agents`, or null for the owner. */
  audience: "devices" | "agents" | null;
  access: FolderAccess;
  /** The settings as the caller sees them (`accessSettings`); the owner's are the settings as they are. */
  settings: Settings;
  /** Whether `absolute` is hidden from the caller (always false for the owner). */
  hidden(absolute: string): boolean;
  /**
   * Whether the caller may be told of `absolute`: today's policy (the owner's excludes, the protected folders, the
   * secret names, the home's private folders) and, for a device or a run, the folders hidden from it. A path outside
   * every granted root is judged by the hidden folders alone (the owner is told of it, as before).
   */
  allowsPath(absolute: string): boolean;
  /** Today's policy over stored rows, for this caller. */
  rowFilter(): (row: { root: string; rel: string }) => boolean;
  /** The granted roots plus `extraRoots`, for this caller. */
  readScope(extraRoots?: readonly string[]): ReadScope;
  /** A scope limited to `roots`, for this caller. */
  scopeOf(roots: readonly string[]): ReadScope;
}

export function audienceOf(principal: Principal | null | undefined): "devices" | "agents" | null {
  if (principal?.kind === "device") return "devices";
  if (principal?.kind === "run") return "agents";
  return null;
}

export function accessView(ctx: AppContext, principal: Principal | null | undefined): AccessView {
  const base = ctx.settings();
  const env = { paths: ctx.paths, settings: base };
  const access = resolveFolderAccess(env);
  const audience = audienceOf(principal);
  const settings = audience === null ? base : accessSettings(env, audience, access);
  const denied =
    audience === "devices" ? [exportsDir(ctx.paths), realpathLenient(exportsDir(ctx.paths))] : [];
  return {
    audience,
    access,
    settings,
    hidden(absolute) {
      if (audience === null) return false;
      if (!path.isAbsolute(absolute)) return true;
      const real = realpathLenient(absolute);
      if (denied.some((d) => isInside(d, absolute) || isInside(d, real))) return true;
      return access.level(absolute, audience) === "hide";
    },
    allowsPath(absolute) {
      if (this.hidden(absolute)) return false;
      try {
        return (
          inspectPath(grantedReadScope(settings, ctx.paths.home, [ctx.paths.memory]), absolute)
            .blockedReason === null
        );
      } catch {
        return true;
      }
    },
    rowFilter: () => storedRowFilter(settings.excludes, { homeDir: ctx.paths.home }),
    readScope: (extraRoots = []) => grantedReadScope(settings, ctx.paths.home, extraRoots),
    scopeOf: (roots) => readScope({ homeDir: ctx.paths.home, roots, excludes: settings.excludes }),
  };
}

/**
 * `value` without the items that name a hidden file (cerebro-memoria-confiavel, G13): every element of a list, at any
 * depth, that is an object whose `path` or `sourcePath` is hidden is left out. Numbers, counts and every other field
 * stay as they were computed.
 */
export function withoutHiddenItems<T>(value: T, hidden: (absolute: string) => boolean): T {
  const names = (item: unknown): boolean => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return false;
    const o = item as Record<string, unknown>;
    return [o.path, o.sourcePath].some((p) => typeof p === "string" && p.length > 0 && hidden(p));
  };
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.filter((item) => !names(item)).map(walk);
    if (node !== null && typeof node === "object") {
      return Object.fromEntries(
        Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, walk(v)]),
      );
    }
    return node;
  };
  return walk(value) as T;
}

/** Whether a screen link (`/brain/reviews?path=…`, `#/brain/notes?open=…`) points at a hidden file. */
export function targetsHidden(target: string, hidden: (absolute: string) => boolean): boolean {
  const query = target.includes("?") ? target.slice(target.indexOf("?") + 1) : "";
  const params = new URLSearchParams(query);
  return ["path", "open"].some((key) => {
    const value = params.get(key);
    return value !== null && path.isAbsolute(value) && hidden(value);
  });
}

/**
 * The settings as a paired device is told of them (cerebro-memoria-confiavel, AC 93), in `GET /api/settings` and in the
 * `settings.changed` events of its stream: no `folderAccess`, and no indexed folder or context path hidden from devices.
 */
export function settingsForDevice(view: AccessView, settings: Settings): Omit<Settings, "folderAccess"> {
  const { folderAccess: _hidden, ...rest } = settings;
  const shown = (p: string) => !view.hidden(p);
  return {
    ...rest,
    indexedFolders: settings.indexedFolders.filter((f) => shown(f.path)),
    contexts: settings.contexts
      .map((c) => ({ ...c, paths: c.paths.filter(shown) }))
      .filter((c) => c.paths.length > 0),
  };
}

// ---- batch B1b: what a device is told of beyond the files themselves (plan amendments 4 and 5) ---------------------

/**
 * The scores of a list as a caller that is not the owner sees them (cerebro-memoria-confiavel, amendment 4): `1 /
 * position` in the list returned. The full-text score (FTS5's bm25) is worked out over every row of the index, hidden
 * ones included, so it would change with a hidden folder and let a caller infer what it holds.
 */
export function rankScored<T extends { score: number }>(list: readonly T[]): T[] {
  return list.map((item, i) => ({ ...item, score: 1 / (i + 1) }));
}

/** The id of a run (`crypto.randomUUID()`): the name of its folder in `artifacts/`. */
const RUN_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** What a hidden path is written as in free text a device reads (amendment 5). */
export const HIDDEN_PATH_TEXT = "(pasta oculta)";

/** The keys whose value names the place an item lives in: an item whose such value is hidden is no item for a device. */
const PLACE_KEYS = ["path", "sourcePath", "cwd", "workingDir"] as const;

/** An absolute path inside free text: from a `/` not inside a word, up to a space or a delimiter. Only for a list that cannot be read. */
const PATH_IN_TEXT = /(?<![\w/.~%-])\/[^\s"'`<>()[\]{},;|]+/g;

/** What may follow a hidden folder's name in a citation: a `/` and the rest of the path, up to a delimiter. */
const PATH_TAIL = "(?:\\/[^\\s\"'`<>()\\[\\]{},;|]*)?";

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface DeviceRedactor {
  /** Nothing is hidden from devices but `artifacts/exports/` (no entry gives devices `hide`). */
  readonly restricts: boolean;
  /** Whether an absolute path is one a device is never told of. */
  hiddenPath(absolute: string): boolean;
  /** `text` with every hidden path in it written as `(pasta oculta)`, and a link to a hidden file as a whole. */
  text(text: string): string;
  /**
   * `value`, deep: a list element whose place (`path`, `sourcePath`, `cwd`, `workingDir`), or that is a string naming a
   * hidden path, is left out; every other string has its hidden paths written as `(pasta oculta)`.
   */
  value<T>(value: T): T;
  /** Whether a run is one a device is never told of: it ran in a hidden folder, or was handed one; a run that is not there counts as hidden while devices have hidden folders (fail closed, L-061). */
  hiddenRun(runId: string | null | undefined): boolean;
  /** Whether an approval is one a device is never told of: its run is hidden, or the run it would start is in a hidden folder. */
  hiddenApproval(approval: { payload?: unknown } | null | undefined): boolean;
  /**
   * Whether a file under `artifacts/` is one a device is never served (round 1, findings 2 and 3): an artifact of a run
   * a device is told does not exist (`hiddenRun`, a run that is gone included), and, while devices have a hidden
   * folder, a run's `proposal.json`, which quotes the notes its ops are sourced in whatever their folder.
   */
  hiddenArtifact(absolute: string): boolean;
  /** Whether a notification is one a device is never told of: its run or its approval is hidden, or its link points at a hidden file. */
  hiddenNotification(n: { runId?: string | null; approvalId?: string | null; href?: string | null }): boolean;
  /** Whether an event of the stream is one a device is never told of (the run, notification or approval it is about). */
  hiddenEvent(event: { type: string; payload?: unknown }): boolean;
}

export function deviceRedactor(ctx: AppContext, view: AccessView): DeviceRedactor {
  const settings = ctx.settings();
  const restricts = view.access.restricts("devices");
  // With a list that could not be read every path is hidden from devices; free text is judged inside the places a file
  // of the owner can be (the home, the indexed folders), so `/api/…` or `/brain/…` stay as they are.
  const everywhere = view.access.entries.some((e) => e.all && e.devices === "hide");
  const places = [ctx.paths.home, ...settings.indexedFolders.map((f) => f.path)].flatMap((p) => [
    path.resolve(p),
    realpathLenient(p),
  ]);
  const hiddenPath = (absolute: string): boolean => {
    if (!path.isAbsolute(absolute)) return false;
    if (everywhere && !places.some((p) => isInside(p, absolute))) return false;
    return view.hidden(absolute);
  };
  // The ways a hidden folder is written in a citation (round 1, finding 5), from the configured entries themselves: its
  // absolute path (its real path and as written), relative to the home, relative to `memory/`, and `~/…` from the user's
  // own home. A folder whose name holds a space is matched as it is spelled, not cut at the space; a folder that only
  // starts like one (`fin2`, `fin-old`) or a path that merely ends like one (`outro/notes/fin`) is not matched.
  const platform = process.platform;
  const insensitive = platform === "darwin" || platform === "win32";
  const spellings = new Set<string>();
  const hiddenEntries = view.access.entries
    .filter((e) => !e.all && e.devices === "hide")
    .flatMap((e) => e.spellings);
  for (const abs of [
    ...hiddenEntries,
    ...[ctx.paths.artifacts, realpathLenient(ctx.paths.artifacts)].map((a) => path.join(a, "exports")),
  ]) {
    const relTo = (base: string): string | null => {
      for (const b of new Set([path.resolve(base), realpathLenient(base)])) {
        const rel = path.relative(b, abs);
        if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel))
          return rel.split(path.sep).join("/");
      }
      return null;
    };
    spellings.add(abs.split(path.sep).join("/"));
    const fromHome = relTo(ctx.paths.home);
    if (fromHome) spellings.add(fromHome);
    const fromMemory = relTo(ctx.paths.memory);
    if (fromMemory) spellings.add(fromMemory);
    const fromUser = relTo(os.homedir());
    if (fromUser) spellings.add(`~/${fromUser}`);
  }
  const flags = insensitive ? "i" : "";
  const alternatives = [...spellings]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  const cited = alternatives
    ? new RegExp(`(?<![\\w~./-])(?:${alternatives})(?![\\w-])(${PATH_TAIL})`, `g${flags}`)
    : null;
  const citedWhole = alternatives ? new RegExp(`^(?:${alternatives})(?![\\w-])${PATH_TAIL}$`, flags) : null;
  /** A link of the screens (`#/brain/notes?open=…`, `/brain/reviews?path=…`) that opens a hidden file. */
  const linkHidden = (input: string): boolean => {
    const query = input.includes("?") ? input.slice(input.indexOf("?") + 1) : "";
    const params = new URLSearchParams(query);
    return ["path", "open"].some((key) => {
      const v = params.get(key);
      return v !== null && ((path.isAbsolute(v) && hiddenPath(v)) || Boolean(citedWhole?.test(v)));
    });
  };
  const text = (input: string): string => {
    if (linkHidden(input)) return HIDDEN_PATH_TEXT;
    let out = input;
    if (cited) {
      out = out.replace(cited, (match, tail: string) => {
        const trailing = /[.:]+$/.exec(tail)?.[0] ?? "";
        return HIDDEN_PATH_TEXT + trailing;
      });
    }
    // A list that cannot be read hides every path of the home and the indexed folders: judged one by one.
    if (everywhere) {
      out = out.replace(PATH_IN_TEXT, (token) => {
        const bare = token.replace(/[.:]+$/, "");
        return hiddenPath(bare) ? HIDDEN_PATH_TEXT + token.slice(bare.length) : token;
      });
    }
    return out;
  };
  const placeHidden = (item: unknown): boolean => {
    if (typeof item === "string")
      return (path.isAbsolute(item) && hiddenPath(item)) || Boolean(citedWhole?.test(item));
    if (item === null || typeof item !== "object" || Array.isArray(item)) return false;
    const o = item as Record<string, unknown>;
    return PLACE_KEYS.some((k) => typeof o[k] === "string" && hiddenPath(o[k] as string));
  };
  const value = <T>(input: T): T => {
    const walk = (node: unknown): unknown => {
      if (typeof node === "string") return text(node);
      if (Array.isArray(node)) return node.filter((item) => !placeHidden(item)).map(walk);
      if (node !== null && typeof node === "object") {
        return Object.fromEntries(
          Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, walk(v)]),
        );
      }
      return node;
    };
    return walk(input) as T;
  };
  const runHidden = new Map<string, boolean>();
  const hiddenRun = (runId: string | null | undefined): boolean => {
    if (!runId) return false;
    const known = runHidden.get(runId);
    if (known !== undefined) return known;
    const run = ctx.runs.get(runId);
    let hidden: boolean;
    if (!run) hidden = restricts;
    else {
      const inputs = run.request?.kind === "skill" ? run.request.inputs : {};
      hidden =
        (run.cwd !== null && hiddenPath(run.cwd)) ||
        Object.values(inputs).some(
          (v) => typeof v === "string" && path.isAbsolute(v.trim()) && hiddenPath(v.trim()),
        );
    }
    runHidden.set(runId, hidden);
    return hidden;
  };
  const hiddenApproval = (approval: { payload?: unknown } | null | undefined): boolean => {
    const payload = (approval?.payload ?? {}) as { runId?: unknown; input?: { cwd?: unknown } };
    if (typeof payload.runId === "string" && hiddenRun(payload.runId)) return true;
    return typeof payload.input?.cwd === "string" && hiddenPath(payload.input.cwd);
  };
  const hiddenNotification = (n: {
    runId?: string | null;
    approvalId?: string | null;
    href?: string | null;
  }): boolean => {
    if (n.runId && hiddenRun(n.runId)) return true;
    if (n.approvalId) {
      const approval = ctx.approvals.get(n.approvalId);
      if (approval ? hiddenApproval(approval) : restricts) return true;
    }
    return typeof n.href === "string" && linkHidden(n.href);
  };
  const hiddenEvent = (event: { type: string; payload?: unknown }): boolean => {
    const p = (event.payload ?? {}) as Record<string, unknown>;
    // An index pass names its own pass as `runId`, not a run of an agent.
    if (!event.type.startsWith("index.") && typeof p.runId === "string" && hiddenRun(p.runId)) return true;
    if (event.type.startsWith("notification.") && typeof p.id === "string" && "title" in p) {
      return hiddenNotification(
        p as { runId?: string | null; approvalId?: string | null; href?: string | null },
      );
    }
    if (event.type.startsWith("approval.") && typeof p.id === "string") {
      const approval = ctx.approvals.get(p.id);
      return approval ? hiddenApproval(approval) : restricts;
    }
    return false;
  };
  const artifactsDir = [path.resolve(ctx.paths.artifacts), realpathLenient(ctx.paths.artifacts)];
  const hiddenArtifact = (absolute: string): boolean => {
    for (const spelling of new Set([path.resolve(absolute), realpathLenient(absolute)])) {
      const dir = artifactsDir.find((d) => isInside(d, spelling));
      if (!dir) continue;
      const parts = path.relative(dir, spelling).split(path.sep);
      // Only a run's own folder (`artifacts/<run id>/`) belongs to a run: any other folder of artifacts/ is no run's.
      if (parts.length < 2 || !RUN_ID.test(parts[0]!)) continue;
      if (hiddenRun(parts[0])) return true;
      if (restricts && parts[parts.length - 1] === "proposal.json") return true;
    }
    return false;
  };
  return {
    restricts,
    hiddenPath,
    text,
    value,
    hiddenRun,
    hiddenApproval,
    hiddenArtifact,
    hiddenNotification,
    hiddenEvent,
  };
}

/** The redactor of a paired device's request, or null for any other caller. */
export function redactorFor(ctx: AppContext, principal: Principal | null | undefined): DeviceRedactor | null {
  return principal?.kind === "device" ? deviceRedactor(ctx, accessView(ctx, principal)) : null;
}
