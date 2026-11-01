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
