/**
 * "Histórico da memória" (.specs/features/cerebro-memoria-confiavel, AC 44; design.md "Diálogo - Histórico da
 * memória"): a 720px `Modal` with the newest 100 changes of `memory/` (`GET /api/memory/history?limit=100`), each
 * with its path in mono, the time, the author and the origin; a path that no longer exists carries "Apagada" and
 * "Restaurar", which opens the version dialog on the newest version of that path that holds bytes. Opened by the
 * NOTAS menu and by the command of the same name (`MemoryHistoryHost`); a chunk of its own.
 */
import { Suspense, lazy, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { apiCall } from "../../apiCall";
import { timeAgo } from "../../components/ui";
import { useLocale, useT } from "../../i18n";
import { useInvalidate, useRouteQuery } from "../../queries";
import { Modal } from "../../ui";
import { errorMessage } from "../../views/shared";
import { Author, ORIGIN } from "../memoria";
import { RequestFailed } from "../RequestFailed";
import type { VersionRef } from "./VersionDialog";
import "./history.css";

const VersionDialog = lazy(() => import("./VersionDialog"));

export default function MemoryHistoryDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const invalidate = useInvalidate();
  const list = useRouteQuery(
    ["memory", "history", "all"],
    "GET /api/memory/history",
    { query: { limit: 100 } },
    { retry: false },
  );
  const [open, setOpen] = useState<VersionRef | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  const restoreOf = async (path: string) => {
    setFailed(null);
    try {
      const { versions } = await apiCall("GET /api/memory/history", { query: { path } });
      const newest = versions.find((v) => v.sha256 !== null);
      if (newest) setOpen(newest);
    } catch (err) {
      setFailed(errorMessage(err, t));
    }
  };

  let body;
  if (list.isPending)
    body = (
      <p className="hf-state">
        <span className="spinner sm" aria-hidden /> {t("common.loading")}
      </p>
    );
  else if (list.isError)
    body = <RequestFailed message={errorMessage(list.error, t)} onRetry={() => void list.refetch()} />;
  else if (list.data.versions.length === 0) body = <p className="hf-state">{t("history.memory.empty")}</p>;
  else
    body = (
      <ul className="hf-list">
        {list.data.versions.map((v) => (
          <li key={v.id} className="mh-row">
            <span className="hf-path">{v.path}</span>
            <span>{timeAgo(v.at, locale)}</span>
            <Author author={v.author} />
            <span className="hf-origin">{ORIGIN[v.origin] ? t(ORIGIN[v.origin]!) : v.origin}</span>
            {v.exists ? (
              <span />
            ) : (
              <span className="mh-gone">
                <span className="mh-deleted">
                  <Trash2 aria-hidden />
                  {t("history.deleted")}
                </span>
                <button type="button" className="btn sm" onClick={() => void restoreOf(v.path)}>
                  {t("history.restoreShort")}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    );

  return (
    <>
      <Modal title={t("history.memory")} onClose={onClose} className="mc-wide" open={open === null}>
        <div className="vd-body">
          {body}
          {failed && (
            <p className="vd-failure" role="alert">
              {failed}
            </p>
          )}
          {restored && (
            <p className="hf-notice" role="status">
              <Check aria-hidden />
              {t("history.restored")}
            </p>
          )}
        </div>
      </Modal>
      {open && (
        <Suspense fallback={null}>
          <VersionDialog
            version={open}
            onClose={() => setOpen(null)}
            onRestored={() => {
              setOpen(null);
              setRestored(true);
              void invalidate(["memory"]);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
