/**
 * The note panel's fourth section, "Histórico" (.specs/features/cerebro-memoria-confiavel, AC 39-43; design.md "Painel
 * da nota, seção Histórico"): the note's versions newest first as the route answers (`GET /api/memory/history?path=`,
 * up to 50), each with the relative time (the date and time in its `Tooltip`), the author and the origin, "Atual" on
 * the one that is the file now. Choosing one opens "Versão de <data e hora>" (a chunk of its own); restoring it reads
 * the note again and says "Versão restaurada." for 8 s. A note outside `memory/` has no history.
 */
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { timeAgo } from "../../components/ui";
import { useLocale, useT } from "../../i18n";
import { useInvalidate, useRouteQuery } from "../../queries";
import { Tooltip } from "../../ui";
import { errorMessage } from "../../views/shared";
import { Author, ORIGIN, authorText, whenText } from "../memoria";
import { RequestFailed } from "../RequestFailed";
import { useMemoryRoot, useNoteRead } from "./notesData";
import type { VersionRef } from "./VersionDialog";
import "./history.css";

const VersionDialog = lazy(() => import("./VersionDialog"));
const NOTICE_MS = 8_000;

/** One version as a row: the time, the author, the origin, "Atual"; the date and time are the row's `Tooltip`. */
export function HistoryRow({
  version,
  current,
  onOpen,
}: {
  version: VersionRef;
  current: boolean;
  onOpen: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const ago = timeAgo(version.at, locale);
  const origin = ORIGIN[version.origin] ? t(ORIGIN[version.origin]!) : version.origin;
  // The row's name is what it shows; the hint adds the date and time.
  const name = [ago, authorText(t, version.author), origin, ...(current ? [t("history.current")] : [])].join(
    " · ",
  );
  return (
    <li>
      <Tooltip label={whenText(version.at, locale)}>
        <button type="button" className="hf-pick" aria-label={name} onClick={onOpen}>
          <span className="hf-when">{ago}</span>
          <Author author={version.author} />
          <span className="hf-origin">{origin}</span>
          {current && <span className="badge meta">{t("history.current")}</span>}
        </button>
      </Tooltip>
    </li>
  );
}

export function HistoryFold({ path }: { path: string }) {
  const t = useT();
  const invalidate = useInvalidate();
  const memoryRoot = useMemoryRoot();
  const rel = memoryRoot && path.startsWith(`${memoryRoot}/`) ? path.slice(memoryRoot.length + 1) : null;
  const note = useNoteRead(path);
  const versions = useRouteQuery(
    ["memory", "history", rel],
    "GET /api/memory/history",
    { query: { path: rel ?? "", limit: 50 } },
    { enabled: rel !== null, retry: false },
  );
  const [open, setOpen] = useState<VersionRef | null>(null);
  const [restored, setRestored] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const version = note.data?.version ?? null;

  let body;
  if (memoryRoot !== null && rel === null) body = <p className="notes-panel-state">{t("history.empty")}</p>;
  else if (versions.isPending)
    body = (
      <p className="notes-panel-state">
        <span className="spinner sm" aria-hidden /> {t("common.loading")}
      </p>
    );
  else if (versions.isError)
    body = (
      <RequestFailed message={errorMessage(versions.error, t)} onRetry={() => void versions.refetch()} />
    );
  else if (versions.data.versions.length === 0)
    body = <p className="notes-panel-state">{t("history.empty")}</p>;
  else
    body = (
      <ul className="hf-list">
        {versions.data.versions.map((v) => (
          <HistoryRow
            key={v.id}
            version={v}
            current={v.sha256 !== null && v.sha256 === version}
            onOpen={() => setOpen(v)}
          />
        ))}
      </ul>
    );

  return (
    <>
      {body}
      {restored && (
        <p className="hf-notice" role="status">
          <Check aria-hidden />
          {t("history.restored")}
        </p>
      )}
      {open && (
        <Suspense fallback={null}>
          <VersionDialog
            version={open}
            baseVersion={version}
            current={open.sha256 !== null && open.sha256 === version}
            onClose={() => setOpen(null)}
            onReload={() => void note.refetch()}
            onRestored={() => {
              setOpen(null);
              void note.refetch();
              void invalidate(["memory", "history"]);
              window.clearTimeout(timer.current);
              setRestored(true);
              timer.current = window.setTimeout(() => setRestored(false), NOTICE_MS);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
