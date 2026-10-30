/**
 * What the guided cleanup's screens share (.specs/features/cerebro-faxina-guiada, S5): the shapes of the six routes,
 * the scope a wizard is about, the record that lets a person resume within a day, where the text of "O que importa
 * aqui?" goes in a brief note, and the plan the "Conferir" step lists. No component and no request here.
 */
import type { ApiCallResult } from "@mordomo/contracts";
import type { TKey } from "../../i18n";

export type Inventory = ApiCallResult<"GET /api/memory/cleanup/inventory">;
export type Scan = ApiCallResult<"GET /api/memory/cleanup/scans/:id">;
export type Finding = Scan["findings"][number];
export type FindingKind = Finding["kind"];
export type Decision = Finding["suggested"];
export type ApplyResult = ApiCallResult<"POST /api/memory/cleanup/apply">;
export type UndoResult = ApiCallResult<"POST /api/memory/cleanup/undo">;
export type Phase = Scan["phase"];

/** A context (its name, and its brief note when it has one) or a folder. */
export type Scope =
  { kind: "context"; id: string; name: string; brief: string | null } | { kind: "dir"; path: string };

export interface Answer {
  decision: Decision;
  keepFileId?: number;
}
export type Answers = Record<string, Answer>;

/** The order of the tabs (design.md "Etapa 3"), with the name of each. */
export const KINDS: Array<[FindingKind, TKey]> = [
  ["duplicate", "cleanup.kind.duplicate"],
  ["near-duplicate", "cleanup.kind.near"],
  ["stale", "cleanup.kind.stale"],
  ["orphan", "cleanup.kind.orphan"],
  ["broken-link", "cleanup.kind.broken"],
  ["empty-folder", "cleanup.kind.empty"],
  ["large-file", "cleanup.kind.large"],
  ["untitled", "cleanup.kind.untitled"],
];

/** The answers in the order of a card's row; "Juntar" only on the two kinds of duplicate. */
export const ANSWERS: Array<[Decision, TKey]> = [
  ["keep", "cleanup.answer.keep"],
  ["archive", "cleanup.answer.archive"],
  ["merge", "cleanup.answer.merge"],
  ["snooze", "cleanup.answer.snooze"],
  ["unsure", "cleanup.answer.unsure"],
];
export const mergeable = (kind: FindingKind) => kind === "duplicate" || kind === "near-duplicate";
export const answersFor = (kind: FindingKind) => ANSWERS.filter(([d]) => d !== "merge" || mergeable(kind));

export const PHASES: Record<Phase, TKey> = {
  inventory: "cleanup.phase.inventory",
  signatures: "cleanup.phase.signatures",
  links: "cleanup.phase.links",
  findings: "cleanup.phase.findings",
};

export const DAY = 86_400_000;
/** "Revisar depois" asks again 30 days later (AC 21). */
export const SNOOZE_MS = 30 * DAY;

export const scopeKey = (s: Scope) => (s.kind === "context" ? `context:${s.id}` : `dir:${s.path}`);
export const scopeQuery = (s: Scope) => (s.kind === "context" ? { context: s.id } : { dir: s.path });

/* ---- resuming the same scope within 24 hours (AC 40) ---------------------------------------------------------- */

const STORE = "mordomo.cleanup.v1";
interface Saved {
  scanId: string;
  at: number;
  answered: Answers;
}
const readAll = (): Record<string, Saved> => {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}") as Record<string, Saved>;
  } catch {
    return {};
  }
};

/** The scan of this scope and the answers given to it, when the scan finished less than a day ago. */
export function resumable(key: string, now = Date.now()): Saved | null {
  const saved = readAll()[key];
  return saved && now - saved.at < DAY ? saved : null;
}

export function remember(key: string, scanId: string, answered: Answers, at?: number): void {
  try {
    const all = readAll();
    all[key] = { scanId, at: at ?? all[key]?.at ?? Date.now(), answered };
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    /* storage disabled: the answers are on the server anyway */
  }
}

/* ---- "O que importa aqui?" into the brief note (AC 23, amendment 7) ------------------------------------------- */

const HEADING = "## O que importa";

/**
 * The note with `text` as the last paragraph of its `## O que importa` section (before the next `## `), after a blank
 * line, in the note's own line ends; every other byte stays. A note without the section gets it, and the text, at the end.
 */
export function withMatters(content: string, text: string): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const body = text.trim().replace(/\r?\n/g, eol);
  const lines = content.split(eol);
  const at = lines.findIndex((l) => l.trimEnd() === HEADING);
  if (at < 0) {
    const sep = content === "" ? "" : content.endsWith(eol) ? eol : eol + eol;
    return `${content}${sep}${HEADING}${eol}${eol}${body}${eol}`;
  }
  let end = lines.findIndex((l, i) => i > at && /^#{1,2} /.test(l));
  if (end < 0) end = lines.length;
  let last = end - 1;
  while (last > at && lines[last]!.trim() === "") last--;
  // The offset where the last line of the section ends (before its line end).
  const offset = lines.slice(0, last + 1).join(eol).length;
  return content.slice(0, offset) + eol + eol + body + content.slice(offset);
}

/* ---- what an apply would do (AC 26) ----------------------------------------------------------------------------- */

export interface PlanLine {
  from: string;
  /** Where it goes under `memory/archive/`; null for a proposal. */
  to: string | null;
  decision: Decision;
}

/**
 * One line per file the answers move: every member of an `archive`, the members a `merge` does not keep. A file under
 * `memory/` (and not already in its archive) goes to `memory/archive/<today>-…/<its path under memory/>`; anything else,
 * an empty folder included, is a proposal. The first finding that asks for a file gives the reason.
 */
export function planOf(findings: Finding[], answered: Answers, memoryDir: string, today: string): PlanLine[] {
  const out: PlanLine[] = [];
  const seen = new Set<string>();
  const add = (path: string, decision: Decision, folder = false) => {
    if (seen.has(path)) return;
    seen.add(path);
    const inside = !folder && path.startsWith(`${memoryDir}/`) && !path.startsWith(`${memoryDir}/archive/`);
    out.push({
      from: path,
      to: inside ? `memory/archive/${today}-…/${path.slice(memoryDir.length + 1)}` : null,
      decision,
    });
  };
  for (const f of findings) {
    const a = answered[f.key];
    if (a?.decision === "archive") {
      if (f.kind === "empty-folder" && f.detail.folder) add(`${f.detail.folder}/`, "archive", true);
      for (const file of f.files) add(file.path, "archive");
    } else if (a?.decision === "merge")
      for (const file of f.files) if (file.id !== a.keepFileId) add(file.path, "merge");
  }
  return out;
}

/** The owner's local day, as the archive folder names it (`AAAA-MM-DD`: the Swedish locale writes dates that way). */
export const localDay = () => new Date().toLocaleDateString("sv-SE");

export const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);
export const folderOf = (p: string) => p.slice(0, p.lastIndexOf("/"));
