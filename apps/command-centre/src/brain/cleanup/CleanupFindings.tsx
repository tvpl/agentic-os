/**
 * Step 3 of the guided cleanup (design.md "Etapa 3"): one tab per kind that has findings, in the design's order, each
 * named with its count; inside, a card per finding (the kind's icon and the reason, the files, the answers in one
 * row), the unanswered first; "Aplicar a todos deste tipo" on top; and below the tabs, "O que importa aqui?", which
 * writes into the context's brief note. An answer is stored (`PUT /api/memory/cleanup/decisions`) before its card moves.
 */
import { useState } from "react";
import {
  Ban,
  CalendarClock,
  Check,
  Copy,
  FileText,
  FolderOpen,
  Repeat,
  Server,
  Unlink,
  type LucideIcon,
} from "lucide-react";
import { apiCall } from "../../apiCall";
import { ApiError } from "../../api";
import { useLocale, useT } from "../../i18n";
import { formatBytes, timeAgo } from "../../components/ui";
import { Tabs } from "../../ui";
import { Band } from "./CleanupInventory";
import {
  KINDS,
  SNOOZE_MS,
  answersFor,
  baseName,
  folderOf,
  mergeable,
  withMatters,
  type Answer,
  type Answers,
  type Decision,
  type Finding,
  type FindingKind,
} from "./cleanupData";

/** The kind's icon on its card; every icon here is one the app already draws elsewhere. */
const KIND_ICON: Record<FindingKind, LucideIcon> = {
  duplicate: Copy,
  "near-duplicate": Repeat,
  stale: CalendarClock,
  orphan: Unlink,
  "broken-link": Ban,
  "empty-folder": FolderOpen,
  "large-file": Server,
  untitled: FileText,
};

type Entry = { key: string; decision: Decision; keepFileId?: number; until?: number };

/** The newest member: the one "Juntar" keeps unless the person picks another (AC 19). */
const newest = (f: Finding) => f.files.reduce((a, b) => (b.mtime > a.mtime ? b : a), f.files[0]!).id;

function useReason() {
  const t = useT();
  return (f: Finding): string => {
    const other = f.files[1] ? baseName(f.files[1].path) : "";
    const d = f.detail;
    switch (f.kind) {
      case "duplicate":
        return t("cleanup.why.duplicate", { name: other });
      case "near-duplicate":
        return t("cleanup.why.near", { pct: Math.round((d.similarity ?? 0) * 100), name: other });
      case "stale":
        return t(d.since === "last_reviewed" ? "cleanup.why.reviewed" : "cleanup.why.stale", {
          n: d.ageDays ?? 0,
        });
      case "orphan":
        return t("cleanup.why.orphan");
      case "broken-link":
        return t("cleanup.why.broken", { target: d.target ?? "", line: d.line ?? 0 });
      case "empty-folder":
        return t("cleanup.why.empty");
      case "large-file":
        return t("cleanup.why.large", { size: formatBytes(d.bytes ?? 0), limit: formatBytes(d.limit ?? 0) });
      default:
        return t("cleanup.why.untitled");
    }
  };
}

export interface CleanupFindingsProps {
  scanId: string;
  findings: Finding[];
  answered: Answers;
  onAnswered: (entries: Answers) => void;
  /** The context's brief note; null for a folder, or a context without one (AC 24). */
  brief: string | null;
}

export function CleanupFindings(p: CleanupFindingsProps) {
  const t = useT();
  const present = KINDS.filter(([kind]) => p.findings.some((f) => f.kind === kind));
  const [tab, setTab] = useState<string>(present[0]?.[0] ?? "");
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<Record<string, Entry[]>>({});

  const send = async (entries: Entry[], slot: string) => {
    setPending((s) => new Set([...s, slot]));
    setFailed(({ [slot]: _gone, ...rest }) => rest);
    try {
      await apiCall("PUT /api/memory/cleanup/decisions", { body: { scanId: p.scanId, decisions: entries } });
      const map: Answers = {};
      for (const e of entries)
        map[e.key] = {
          decision: e.decision,
          ...(e.keepFileId !== undefined ? { keepFileId: e.keepFileId } : {}),
        };
      p.onAnswered(map);
    } catch {
      setFailed((f) => ({ ...f, [slot]: entries }));
    } finally {
      setPending((s) => new Set([...s].filter((x) => x !== slot)));
    }
  };
  const entryOf = (f: Finding, decision: Decision, keepFileId?: number): Entry =>
    decision === "merge"
      ? { key: f.key, decision, keepFileId: keepFileId ?? newest(f) }
      : decision === "snooze"
        ? { key: f.key, decision, until: Date.now() + SNOOZE_MS }
        : { key: f.key, decision };

  const group = p.findings.filter((f) => f.kind === tab);
  const ordered = [...group.filter((f) => !p.answered[f.key]), ...group.filter((f) => p.answered[f.key])];
  const done = group.filter((f) => p.answered[f.key]).length;
  const all = `all:${tab}`;

  return (
    <div className="cln-findings">
      <Tabs
        tabs={present.map(([kind, label]) => ({
          id: kind,
          label: `${t(label)} (${p.findings.filter((f) => f.kind === kind).length})`,
        }))}
        active={tab}
        onChange={setTab}
        ariaLabel={t("cleanup.step.findings")}
      >
        <div className="cln-all">
          <span className="cln-label">{t("cleanup.applyAll")}</span>
          <div className="cln-answers">
            {answersFor(tab as FindingKind).map(([decision, label]) => (
              <button
                key={decision}
                type="button"
                className="btn sm"
                disabled={pending.has(all)}
                onClick={() =>
                  void send(
                    group.map((f) => entryOf(f, decision)),
                    all,
                  )
                }
              >
                {t(label)}
              </button>
            ))}
          </div>
          <span className="cln-count">{t("cleanup.answeredOf", { n: done, total: group.length })}</span>
          {failed[all] && <SaveFailed onRetry={() => void send(failed[all]!, all)} />}
        </div>
        <ul className="cln-cards">
          {ordered.map((f) => (
            <FindingCard
              key={f.key}
              finding={f}
              answer={p.answered[f.key]}
              busy={pending.has(f.key)}
              failed={failed[f.key] !== undefined}
              onAnswer={(decision, keepFileId) => void send([entryOf(f, decision, keepFileId)], f.key)}
              onRetry={() => void send(failed[f.key]!, f.key)}
            />
          ))}
        </ul>
      </Tabs>
      <Matters brief={p.brief} />
    </div>
  );
}

function SaveFailed({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return <Band text={t("cleanup.saveFailed")} onRetry={onRetry} />;
}

export function FindingCard(p: {
  finding: Finding;
  answer: Answer | undefined;
  busy: boolean;
  failed: boolean;
  onAnswer: (decision: Decision, keepFileId?: number) => void;
  onRetry: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const reason = useReason();
  const f = p.finding;
  const [merging, setMerging] = useState(false);
  const [keep, setKeep] = useState(() => (f.files.length ? newest(f) : 0));
  const Icon = KIND_ICON[f.kind];
  if (p.answer) {
    const label = answersFor(f.kind).find(([d]) => d === p.answer!.decision)?.[1] ?? "cleanup.answer.keep";
    return (
      <li className="cln-finding" data-answered="">
        <Check aria-hidden />
        <span className="cln-answer-now">{t(label)}</span>
        <span className="cln-dim">{t("cleanup.answered")}</span>
        <span className="cln-mono">{f.files[0] ? baseName(f.files[0].path) : (f.detail.folder ?? "")}</span>
      </li>
    );
  }
  return (
    <li className="cln-finding">
      <p className="cln-why">
        <Icon aria-hidden />
        {reason(f)}
      </p>
      <ul className="cln-files">
        {f.files.length === 0 && <li className="cln-mono">{f.detail.folder}</li>}
        {f.files.map((file) => (
          <li key={file.id}>
            {merging && (
              <label className="cln-keep">
                <input
                  type="radio"
                  name={`keep-${f.key}`}
                  checked={keep === file.id}
                  onChange={() => setKeep(file.id)}
                />
                {t("cleanup.keepThis")}
              </label>
            )}
            <span className="cln-file-name">{baseName(file.path)}</span>
            <span className="cln-mono">{folderOf(file.path)}</span>
            <span className="cln-dim">{timeAgo(file.mtime, locale)}</span>
            <span className="cln-dim">{formatBytes(file.size)}</span>
          </li>
        ))}
      </ul>
      <div className="cln-answers">
        {answersFor(f.kind).map(([decision, label]) => (
          <button
            key={decision}
            type="button"
            className="btn sm"
            aria-pressed={merging && decision === "merge" ? true : undefined}
            disabled={p.busy}
            onClick={() => (decision === "merge" ? setMerging(true) : p.onAnswer(decision))}
          >
            {t(label)}
          </button>
        ))}
        {merging && mergeable(f.kind) && (
          <button
            type="button"
            className="btn sm primary"
            disabled={p.busy}
            onClick={() => p.onAnswer("merge", keep)}
          >
            {t("common.confirm")}
          </button>
        )}
      </div>
      {p.failed && <SaveFailed onRetry={p.onRetry} />}
    </li>
  );
}

/** "O que importa aqui?" (AC 23, AC 24): appended to the brief's section with its version; a conflict keeps the text. */
function Matters({ brief }: { brief: string | null }) {
  const t = useT();
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "conflict" | "failed">("idle");
  const save = async () => {
    if (!brief || !text.trim()) return;
    setState("saving");
    try {
      const note = await apiCall("GET /api/memory/note", { query: { p: brief } });
      await apiCall("PUT /api/memory/notes", {
        body: { path: brief, content: withMatters(note.content, text), baseVersion: note.version },
      });
      setText("");
      setState("saved");
    } catch (err) {
      setState(err instanceof ApiError && err.code === "edit_conflict" ? "conflict" : "failed");
    }
  };
  return (
    <section className="cln-matters" aria-labelledby="cln-matters">
      <label id="cln-matters" htmlFor="cln-matters-text" className="cln-matters-label">
        {t("cleanup.matters")}
      </label>
      <textarea
        id="cln-matters-text"
        className="input cln-prose"
        rows={3}
        value={text}
        disabled={!brief}
        aria-describedby="cln-matters-help"
        onChange={(e) => setText(e.target.value)}
      />
      <p id="cln-matters-help" className="cln-help">
        {t(brief ? "cleanup.matters.help" : "cleanup.matters.none")}
      </p>
      {state === "saved" && <p className="cln-help">{t("note.state.saved")}</p>}
      {state === "failed" && <SaveFailed onRetry={() => void save()} />}
      <div className="cln-answers">
        {state === "conflict" && (
          <button type="button" className="btn sm" onClick={() => setState("idle")}>
            {t("cleanup.reload")}
          </button>
        )}
        <button
          type="button"
          className="btn sm"
          disabled={!brief || state === "saving" || state === "conflict" || !text.trim()}
          onClick={() => void save()}
        >
          {t("cleanup.matters.save")}
        </button>
      </div>
    </section>
  );
}
