import path from "node:path";
import { FOLDER_LEVELS, type FolderAudience, type FolderLevel } from "@mordomo/contracts";
import type { Settings } from "../config/schema.js";
import type { MordomoPaths } from "../paths.js";
import { realpathLenient, realpathStrict } from "../security/paths.js";
import {
  accessExclude,
  comparableSegments,
  decideLevel,
  stricterLevel,
  type AccessRule,
} from "./excludes.js";

/**
 * The access of folders for agents and devices (.specs/features/cerebro-memoria-confiavel, door 12). The owner writes
 * `settings.folderAccess`; this module reads it, gives a path its level for an audience, and makes the view of the
 * settings that every read on behalf of a device or a run's credential goes through. A level other than `write` only
 * narrows, and the owner's token is never bound by one: the owner's reads use the settings as they are.
 *
 * The decision table (door 12, AC 87 to 90, G17), one row each:
 * - no entry covers the path: `write` for both audiences;
 * - the entry whose real path is the longest prefix of the path, by whole segments (equal, or followed by the separator),
 *   decides; two as specific give the stricter level;
 * - an entry whose level is not one of the three: `hide` for both audiences;
 * - an entry whose path cannot be resolved (a link loop, a path that is not there): `hide` for both, covering its
 *   lexical absolute path (G17);
 * - a list that cannot be read (the settings store reads it as one entry `"*"`, `failClosed.ts`), or that holds a path
 *   that is not absolute: every path is `hide` for devices and `read` for agents.
 */

export type { FolderAudience, FolderLevel };

export interface FolderAccessEnv {
  paths: Pick<MordomoPaths, "artifacts" | "home">;
  settings: Settings;
  /** Platform whose file-name rules apply (tests only); defaults to this process's. */
  platform?: NodeJS.Platform;
}

/** One entry as the resolver reads it. */
export interface ResolvedFolderEntry extends Record<FolderAudience, FolderLevel> {
  /** The path as written. */
  path: string;
  /** Its real path, or null when it could not be resolved (G17). */
  real: string | null;
  /** The absolute spellings it covers: the real path and the path as written. Empty for `"*"`. */
  spellings: string[];
  /** The entry `"*"`: it covers every path. */
  all: boolean;
}

export interface FolderAccess {
  /** Whether the list could not be read (AC 90): every path is `hide` for devices and `read` for agents. */
  unreadable: boolean;
  entries: ResolvedFolderEntry[];
  /** The level of `absolute` for `audience`: the stricter of what its path as written and its real path get. */
  level(absolute: string, audience: FolderAudience): FolderLevel;
  /**
   * The folders strictly inside `dir` that an entry gives `level` for `audience` (their real paths, or the path as
   * written when it cannot be resolved), in the order of the settings. `dir` itself is not one of them.
   */
  inside(dir: string, audience: FolderAudience, level: FolderLevel): string[];
  /** The rules of `audience`, as the workspace filter applies them. */
  rules(audience: FolderAudience): AccessRule[];
  /** Whether any entry gives `audience` a level other than `write`. */
  restricts(audience: FolderAudience): boolean;
  /** Whether any entry gives `audience` the level `hide` (so that its search needs an index of its own, door 19). */
  hides(audience: FolderAudience): boolean;
}

const isLevel = (value: unknown): value is FolderLevel =>
  typeof value === "string" && (FOLDER_LEVELS as readonly string[]).includes(value);

/** Read `settings.folderAccess` as the decision table of door 12 says. */
export function resolveFolderAccess(env: FolderAccessEnv): FolderAccess {
  const platform = env.platform ?? process.platform;
  const raw: unknown = env.settings.folderAccess;
  const unreadable = !Array.isArray(raw);
  // An entry whose path is not a string, or is relative, names no folder: it could have covered any of them, so every
  // path reads `hide` for both audiences (AC 89, fail closed; verification round 1, finding 7)
  let unplaced = false;
  const entries: ResolvedFolderEntry[] = [];
  if (!unreadable) {
    for (const entry of raw as unknown[]) {
      const e = (entry ?? {}) as { path?: unknown; agents?: unknown; devices?: unknown };
      if (typeof e.path !== "string") {
        unplaced = true;
        break;
      }
      if (e.path === "*") {
        entries.push({
          path: "*",
          real: null,
          spellings: [],
          agents: isLevel(e.agents) && isLevel(e.devices) ? e.agents : "hide",
          devices: isLevel(e.agents) && isLevel(e.devices) ? e.devices : "hide",
          all: true,
        });
        continue;
      }
      if (!path.isAbsolute(e.path)) {
        unplaced = true;
        break;
      }
      const lexical = path.resolve(e.path);
      const real = realpathStrict(lexical);
      const known = isLevel(e.agents) && isLevel(e.devices);
      const levels: Record<FolderAudience, FolderLevel> =
        known && real !== null ? { agents: e.agents as FolderLevel, devices: e.devices as FolderLevel } : { agents: "hide", devices: "hide" };
      entries.push({
        path: e.path,
        real,
        spellings: [...new Set(real !== null ? [real, lexical] : [lexical])],
        ...levels,
        all: false,
      });
    }
  }
  if (unreadable) {
    // a field that is not a list (AC 90): every root `hide` for devices and `read` for agents
    entries.length = 0;
    entries.push({ path: "*", real: null, spellings: [], agents: "read", devices: "hide", all: true });
  } else if (unplaced) {
    entries.length = 0;
    entries.push({ path: "*", real: null, spellings: [], agents: "hide", devices: "hide", all: true });
  }
  const compiled = entries.map((entry) => ({
    entry,
    segs: entry.spellings.map((s) => comparableSegments(s, platform)),
  }));
  const decide = (absolute: string, audience: FolderAudience): FolderLevel => {
    const rules = compiled.map((c) => ({ segs: c.segs, level: c.entry[audience], all: c.entry.all }));
    return decideLevel(rules, comparableSegments(path.resolve(absolute), platform));
  };
  return {
    unreadable,
    entries,
    level(absolute, audience) {
      if (!path.isAbsolute(absolute)) return "hide";
      const lexical = decide(absolute, audience);
      return stricterLevel(lexical, decide(realpathLenient(absolute), audience));
    },
    inside(dir, audience, level) {
      const spellings = [...new Set([path.resolve(dir), realpathLenient(dir)])].map((s) => comparableSegments(s, platform));
      const out: string[] = [];
      for (const { entry, segs } of compiled) {
        if (entry.all || entry[audience] !== level) continue;
        const strictlyInside = segs.some((s) =>
          spellings.some((d) => s.length > d.length && d.every((seg, i) => s[i] === seg)),
        );
        if (strictlyInside) out.push(entry.real ?? entry.spellings[0]!);
      }
      return [...new Set(out)];
    },
    rules(audience) {
      return entries.map((e) => ({ spellings: e.spellings, level: e[audience], ...(e.all ? { all: true } : {}) }));
    },
    restricts(audience) {
      return entries.some((e) => e[audience] !== "write");
    },
    hides(audience) {
      return entries.some((e) => e[audience] === "hide");
    },
  };
}

/** The folder a device is never served, whatever the levels say (G11): where the exports land (door 14). */
export function exportsDir(paths: Pick<MordomoPaths, "artifacts">): string {
  return path.join(paths.artifacts, "exports");
}

/** Where the guard of `MEMORY.md` sets aside what a run left at its name, in the home (plan amendments 9 and 13). */
export const GUARD_DIR = "guard";

/** The guard's folder: no one but the owner reads it, and no one but the owner asks to work in it. */
export function guardDir(paths: Pick<MordomoPaths, "home">): string {
  return path.join(paths.home, GUARD_DIR);
}

/**
 * The folders `audience` is never served, whatever the levels say: for a device the exports (G11) and the guard's
 * folder, for an agent the guard's folder. Each by its name and by its real path.
 */
export function deniedDirs(paths: Pick<MordomoPaths, "home" | "artifacts">, audience: FolderAudience): string[] {
  const dirs = audience === "devices" ? [exportsDir(paths), guardDir(paths)] : [guardDir(paths)];
  return [...new Set(dirs.flatMap((d) => [d, realpathLenient(d)]))];
}

/**
 * The settings as a read on behalf of `audience` sees them: an access mark added to `excludes` (every read scope and
 * stored-row filter made from them refuses what is hidden), and the indexed folders and the context paths that are
 * hidden left out. For a device, `artifacts/exports/` is hidden too. The owner's reads never use this.
 */
export function accessSettings(env: FolderAccessEnv, audience: FolderAudience, access = resolveFolderAccess(env)): Settings {
  const { settings, paths } = env;
  const deny = deniedDirs(paths, audience);
  if (!access.restricts(audience) && deny.length === 0) return settings;
  const visible = (p: string) => access.level(p, audience) !== "hide";
  const contexts = settings.contexts
    .map((c) => ({ ...c, paths: c.paths.filter(visible) }))
    .filter((c) => c.paths.length > 0);
  return {
    ...settings,
    excludes: [...settings.excludes, accessExclude({ rules: access.rules(audience), deny })],
    indexedFolders: settings.indexedFolders.filter((f) => visible(f.path)),
    contexts,
  };
}
