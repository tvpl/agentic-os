/**
 * "Menções sem link (N)" of the note panel (.specs/features/cerebro-rituais, AC 70; design.md "Painel da nota - dobra
 * Menções sem link"): the lines of other notes that name this one without a link (`GET /api/memory/mentions`, in the
 * active context), each with the source's name, the line with the term marked and, when the source can be written,
 * "Linkar" (`POST /api/memory/mentions/link`). Folded when there is none. Choosing a source opens it in the notes view
 * at its line (`?open=<path>&line=<n>`).
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Link2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api";
import { apiCall } from "../../apiCall";
import { usePanelSearchParams } from "../../desktop/appRoute";
import { useT } from "../../i18n";
import { RequestFailed } from "../RequestFailed";
import { Fold } from "./Fold";
import { mentionsKey, useMentions, withoutExt, type Mentions } from "./notesData";
import "./mentions.css";

export type Mention = Mentions["items"][number];
type Trouble = "gone" | "failed";

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const WORD = /[\p{L}\p{N}_]/u;

/**
 * Where `term` sits in `text` as a whole word, compared without case or accents (the matcher's rule, door 6): the
 * start and the end in `text`, or null.
 */
export function termSpan(text: string, term: string): [number, number] | null {
  let folded = "";
  const from: number[] = [];
  const to: number[] = [];
  let i = 0;
  for (const ch of text) {
    for (const unit of fold(ch)) {
      folded += unit;
      from.push(i);
      to.push(i + ch.length);
    }
    i += ch.length;
  }
  const needle = fold(term);
  if (!needle) return null;
  for (let k = folded.indexOf(needle); k >= 0; k = folded.indexOf(needle, k + 1)) {
    const before = folded[k - 1];
    const after = folded[k + needle.length];
    if ((before && WORD.test(before)) || (after && WORD.test(after))) continue;
    let end = to[k + needle.length - 1]!;
    while (end < text.length && /\p{M}/u.test(text[end]!)) end++;
    return [from[k]!, end];
  }
  return null;
}

function Excerpt({ text, term }: { text: string; term: string }) {
  const span = termSpan(text, term);
  if (!span) return <span className="mf-excerpt">{text}</span>;
  return (
    <span className="mf-excerpt">
      {text.slice(0, span[0])}
      <mark>{text.slice(span[0], span[1])}</mark>
      {text.slice(span[1])}
    </span>
  );
}

const nameOf = (m: Mention) => m.file.title ?? withoutExt(m.file.name);
const keyOf = (m: Mention) => `${m.file.path}:${m.line}`;

export function MentionsFold({ id, context }: { id: number | null; context?: string }) {
  const t = useT();
  const mentions = useMentions(id, context);
  const total = mentions.data?.total;
  // Folded when the note has none when it is shown; a fold the person emptied with "Linkar" stays open on its notice.
  const [shut, setShut] = useState<boolean | null>(null);
  useEffect(() => {
    if (shut === null && total !== undefined) setShut(total === 0);
  }, [shut, total]);
  return (
    <Fold title={t("mentions.title", { n: total ?? "…" })} shut={shut === true}>
      {id === null || mentions.isPending ? (
        <p className="notes-panel-state">
          <span className="spinner sm" aria-hidden /> {t("common.loading")}
        </p>
      ) : mentions.isError ? (
        <RequestFailed message={mentions.error.message} onRetry={() => void mentions.refetch()} />
      ) : (
        <MentionList
          id={id}
          context={context}
          data={mentions.data}
          onReload={() => void mentions.refetch()}
        />
      )}
    </Fold>
  );
}

function MentionList({
  id,
  context,
  data,
  onReload,
}: {
  id: number;
  context?: string;
  data: Mentions;
  onReload: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [, setParams] = usePanelSearchParams();
  const [trouble, setTrouble] = useState<ReadonlyMap<string, Trouble>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (data.terms.length === 0) return <p className="notes-panel-state">{t("mentions.short")}</p>;

  const mark = (key: string, value: Trouble | null) =>
    setTrouble((cur) => {
      const next = new Map(cur);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  const link = async (m: Mention) => {
    const key = keyOf(m);
    setBusy(key);
    mark(key, null);
    try {
      await apiCall("POST /api/memory/mentions/link", {
        body: { source: m.file.path, line: m.line, term: m.term, target: id, baseVersion: m.version ?? "" },
      });
      // The item leaves at once; the source now links here, so its backlinks change too.
      qc.setQueryData<Mentions>(
        mentionsKey(id, context),
        (cur) =>
          cur && {
            ...cur,
            items: cur.items.filter((x) => keyOf(x) !== key),
            total: Math.max(0, cur.total - 1),
          },
      );
      void qc.invalidateQueries({ queryKey: ["memory", "links", id] });
      setNotice(t("mentions.linked", { note: nameOf(m) }));
    } catch (err) {
      const gone = err instanceof ApiError && (err.code === "mention_gone" || err.code === "edit_conflict");
      mark(key, gone ? "gone" : "failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mf">
      {data.items.length === 0 ? (
        <p className="notes-panel-state">{t("mentions.none")}</p>
      ) : (
        <ul className="mf-list">
          {data.items.map((m) => (
            <MentionItem
              key={keyOf(m)}
              mention={m}
              busy={busy === keyOf(m)}
              trouble={trouble.get(keyOf(m))}
              onOpen={() => setParams({ open: m.file.path, line: String(m.line) })}
              onLink={() => void link(m)}
              onReload={() => {
                setTrouble(new Map());
                onReload();
              }}
            />
          ))}
        </ul>
      )}
      {notice && (
        <p className="mf-notice" role="status">
          {notice}
        </p>
      )}
      <p className="mf-dim">{t("mentions.terms", { terms: data.terms.join(", ") })}</p>
      {data.items.length < data.total && (
        <p className="mf-dim">{t("weekly.showing", { shown: data.items.length, total: data.total })}</p>
      )}
    </div>
  );
}

/** One mention: the source's name (it opens the source at the line), the line with the term marked, "Linkar". */
export function MentionItem(p: {
  mention: Mention;
  busy: boolean;
  trouble: Trouble | undefined;
  onOpen: () => void;
  onLink: () => void;
  onReload: () => void;
}) {
  const t = useT();
  const m = p.mention;
  return (
    <li className="mf-item">
      <button type="button" className="brain-md-link mf-name" onClick={p.onOpen}>
        {nameOf(m)}
      </button>
      <Excerpt text={m.excerpt} term={m.term} />
      {m.editable && (
        <button type="button" className="btn sm" disabled={p.busy} onClick={p.onLink}>
          <Link2 aria-hidden />
          {t("mentions.link")}
        </button>
      )}
      {p.trouble && (
        <p className="mf-trouble">
          <AlertTriangle aria-hidden />
          {p.trouble === "gone" ? t("mentions.gone") : t("weekly.saveFailed")}
          <button type="button" className="btn sm" onClick={p.trouble === "gone" ? p.onReload : p.onLink}>
            {p.trouble === "gone" ? t("weekly.reload") : t("weekly.retry")}
          </button>
        </p>
      )}
    </li>
  );
}
