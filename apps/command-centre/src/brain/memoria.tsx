/**
 * What the screens of trustworthy memory share (.specs/features/cerebro-memoria-confiavel, design.md "Rótulos de autor,
 * origem e confiança"): the author's icon and label, the origin's label, the trust badge and the state of an op (an
 * icon and a text, always both: the colour only helps) and the link that opens a file of `memory/` in the notes view at
 * a line. The facts widget of the desktop uses it, so it stays small; the diff is `memoriaDiff.tsx`, in the screens' chunks.
 */
import {
  type LucideIcon,
  AlertTriangle,
  Bot,
  CircleHelp,
  CircleSlash,
  Cpu,
  FileEdit,
  Plug,
  Sparkles,
  User,
  UserCheck,
  Wrench,
} from "lucide-react";
import { useT, type TKey } from "../i18n";
import "./memoria.css";

type T = ReturnType<typeof useT>;
type Icon = LucideIcon;

export type Trust = "usuario" | "ferramenta" | "inferido";
const TRUST: Record<Trust, [Icon, TKey, string]> = {
  usuario: [UserCheck, "trust.usuario", "tone-ok"],
  ferramenta: [Wrench, "trust.ferramenta", "tone-warn"],
  inferido: [Sparkles, "trust.inferido", "tone-info"],
};

const AUTHOR: Record<string, [Icon, TKey]> = {
  owner: [User, "author.owner"],
  run: [Bot, "author.run"],
  mcp: [Plug, "author.mcp"],
  external: [FileEdit, "author.external"],
  system: [Cpu, "author.system"],
  unknown: [CircleHelp, "author.unknown"],
};

/** The run of an author `run:<id>`, or null. */
export const runOf = (author: string) => (author.startsWith("run:") ? author.slice(4) : null);

/** The label of an author (`owner`, `run:<id>`, `mcp`, `external`, `system`, `unknown`). */
export function authorText(t: T, author: string): string {
  const run = runOf(author);
  if (run !== null) return t("author.run", { id: run.slice(0, 8) });
  return t((AUTHOR[author] ?? AUTHOR.unknown!)[1]);
}

/** The author's icon and label; a run's links to it when `link` is set. */
export function Author({ author, link = false }: { author: string; link?: boolean }) {
  const t = useT();
  const run = runOf(author);
  const [Glyph] = run !== null ? AUTHOR.run! : (AUTHOR[author] ?? AUTHOR.unknown!);
  const text = authorText(t, author);
  return (
    <span className="mc-author">
      <Glyph aria-hidden />
      {link && run !== null ? <a href={`#/runs/${encodeURIComponent(run)}`}>{text}</a> : text}
    </span>
  );
}

export function TrustBadge({ trust }: { trust: Trust }) {
  const t = useT();
  const [Glyph, key, tone] = TRUST[trust];
  return (
    <span className={`badge meta mc-trust ${tone}`}>
      <Glyph aria-hidden />
      {t(key)}
    </span>
  );
}

/** Why an op cannot be applied: the state's icon and name, then the reason (12px). */
export function OpState({ state, reason }: { state: "invalid" | "conflict"; reason?: string }) {
  const t = useT();
  const Glyph = state === "invalid" ? CircleSlash : AlertTriangle;
  return (
    <span className="mc-opstate">
      <Glyph aria-hidden />
      <span>{t(state === "invalid" ? "opState.invalid" : "opState.conflict")}</span>
      {reason && <span>{reason}</span>}
    </span>
  );
}

/** The notes view (`NOTES_PATH`) with `path` open, scrolled to `line` when given. */
export function notesHref(path: string, line?: number | null): string {
  const q = new URLSearchParams({ open: path });
  if (line) q.set("line", String(line));
  return `#/brain/notes?${q}`;
}
