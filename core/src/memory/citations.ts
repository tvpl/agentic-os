import os from "node:os";
import path from "node:path";
import type { FolderAudience } from "@mordomo/contracts";
import type { MordomoPaths } from "../paths.js";
import { leavesBase, realpathLenient } from "../security/paths.js";
import { deniedDirs, type FolderAccess } from "./folderAccess.js";

/** What a hidden folder is written as in free text a device or an agent reads (plan amendment 5). */
export const HIDDEN_PATH_TEXT = "(pasta oculta)";

/** What may follow a hidden folder's name in a citation: a `/` and the rest of the path, up to a delimiter. */
const PATH_TAIL = "(?:\\/[^\\s\"'`<>()\\[\\]{},;|]*)?";

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface CitationRedactor {
  /** Every spelling of every hidden folder this redactor looks for (none: it changes nothing). */
  readonly spellings: readonly string[];
  /** `input` with each citation of a hidden folder (and the path below it) written as `(pasta oculta)`. */
  text(input: string): string;
  /** Whether the whole of `input` is such a citation (a path given by itself). */
  whole(input: string): boolean;
}

/**
 * The ways a folder hidden from `audience` is written in a citation, from the configured entries themselves (round 1,
 * finding 5): its absolute path (its real path and as written), relative to the home, relative to `memory/`, and `~/…`
 * from the user's own home; for devices also `artifacts/exports/`. A folder whose name holds a space is matched as it is
 * spelled, not cut at the space; a folder that only starts like one (`fin2`, `fin-old`) or a path that merely ends like
 * one (`outro/notes/fin`) is not matched.
 */
export function citationRedactor(
  paths: Pick<MordomoPaths, "home" | "memory" | "artifacts">,
  access: FolderAccess,
  audience: FolderAudience,
  userHome: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): CitationRedactor {
  const spellings = new Set<string>();
  const hidden = access.entries.filter((e) => !e.all && e[audience] === "hide").flatMap((e) => e.spellings);
  const exported = [
    ...deniedDirs(paths, audience),
    ...(audience === "devices" ? [path.join(realpathLenient(paths.artifacts), "exports")] : []),
  ];
  for (const abs of [...hidden, ...exported]) {
    const relTo = (base: string): string | null => {
      for (const b of new Set([path.resolve(base), realpathLenient(base)])) {
        const rel = path.relative(b, abs);
        if (rel !== "" && !leavesBase(rel) && !path.isAbsolute(rel)) return rel.split(path.sep).join("/");
      }
      return null;
    };
    spellings.add(abs.split(path.sep).join("/"));
    const fromHome = relTo(paths.home);
    if (fromHome) spellings.add(fromHome);
    const fromMemory = relTo(paths.memory);
    if (fromMemory) spellings.add(fromMemory);
    const fromUser = relTo(userHome);
    if (fromUser) spellings.add(`~/${fromUser}`);
  }
  const flags = platform === "darwin" || platform === "win32" ? "i" : "";
  const alternatives = [...spellings].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");
  const cited = alternatives ? new RegExp(`(?<![\\w~./-])(?:${alternatives})(?![\\w-])(${PATH_TAIL})`, `g${flags}`) : null;
  const whole = alternatives ? new RegExp(`^(?:${alternatives})(?![\\w-])${PATH_TAIL}$`, flags) : null;
  return {
    spellings: [...spellings],
    text(input) {
      if (!cited) return input;
      return input.replace(cited, (_match, tail: string) => HIDDEN_PATH_TEXT + (/[.:]+$/.exec(tail)?.[0] ?? ""));
    },
    whole: (input) => Boolean(whole?.test(input)),
  };
}
