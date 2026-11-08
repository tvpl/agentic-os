/**
 * "Versão de <data e hora>" (.specs/features/cerebro-memoria-confiavel, AC 40-42; design.md "Diálogo - Versão de <data
 * e hora>"): a 720px `Modal` with the version's author and origin, the diff from the current text to it (or its whole
 * text in mono when the note is gone), and "Fechar" then "Restaurar esta versão", absent on the current version. The
 * restore is guarded by the version of the note the screen showed: a conflict keeps the dialog open with the editor's
 * text and "Recarregar". A chunk of its own (`lazy`), fetched the first time a version is opened.
 */
import { useState } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { ApiError } from "../../api";
import { apiCall } from "../../apiCall";
import { useLocale, useT } from "../../i18n";
import { useRouteQuery } from "../../queries";
import { Modal } from "../../ui";
import { errorMessage } from "../../views/shared";
import { Author, ORIGIN, whenText } from "../memoria";
import { DiffLines } from "../memoriaDiff";
import { RequestFailed } from "../RequestFailed";
import "./history.css";

export interface VersionRef {
  id: number;
  at: number;
  author: string;
  origin: string;
  sha256: string | null;
}

export default function VersionDialog({
  version,
  baseVersion,
  current,
  onClose,
  onRestored,
  onReload,
}: {
  version: VersionRef;
  /** The version of the note the screen shows; `undefined`: the file as the history reads it now. */
  baseVersion?: string | null;
  /** This version is the file as it is now: no restore. */
  current?: boolean;
  onClose: () => void;
  onRestored: () => void;
  /** "Recarregar" after a conflict: the screen reads the note again. */
  onReload?: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const detail = useRouteQuery(
    ["memory", "history", "version", version.id],
    "GET /api/memory/history/:id",
    { params: { id: version.id } },
    { retry: false },
  );
  const [failure, setFailure] = useState<{ conflict: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const base = baseVersion === undefined ? detail.data?.current : baseVersion;

  const restore = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await apiCall("POST /api/memory/history/restore", {
        body: { id: version.id, ...(base ? { baseVersion: base } : {}) },
      });
      onRestored();
    } catch (err) {
      setFailure({
        conflict: err instanceof ApiError && err.code === "edit_conflict",
        message: errorMessage(err, t),
      });
    } finally {
      setBusy(false);
    }
  };

  let body;
  if (detail.isPending)
    body = (
      <p className="hf-state">
        <span className="spinner sm" aria-hidden /> {t("common.loading")}
      </p>
    );
  else if (detail.isError)
    body = <RequestFailed message={errorMessage(detail.error, t)} onRetry={() => void detail.refetch()} />;
  else if (detail.data.current === null)
    body = (
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling region the keyboard must reach
      <pre className="vd-text" tabIndex={0}>
        {detail.data.content}
      </pre>
    );
  else
    body = (
      <>
        <h3 className="vd-title">{t("history.diffTitle")}</h3>
        <DiffLines diff={detail.data.diff} label={t("history.diffTitle")} />
      </>
    );

  return (
    <Modal
      title={t("history.version", { when: whenText(version.at, locale) })}
      onClose={onClose}
      className="mc-wide"
    >
      <div className="vd-body">
        <div className="mc-meta">
          <Author author={version.author} />
          <span>{ORIGIN[version.origin] ? t(ORIGIN[version.origin]!) : version.origin}</span>
        </div>
        {body}
        {failure && (
          <div className="vd-failure" role="alert">
            <AlertTriangle aria-hidden />
            <span>{failure.conflict ? t("history.conflict") : failure.message}</span>
            {failure.conflict && onReload && (
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  setFailure(null);
                  onReload();
                  void detail.refetch();
                }}
              >
                {t("reviews.reload")}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          {t("common.close")}
        </button>
        {!current && detail.data && (
          <button type="button" className="btn primary" disabled={busy} onClick={() => void restore()}>
            <RotateCcw aria-hidden />
            {t("history.restore")}
          </button>
        )}
      </div>
    </Modal>
  );
}
