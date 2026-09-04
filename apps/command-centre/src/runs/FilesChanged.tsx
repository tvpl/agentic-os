/**
 * "Files changed" card: the paths the run's write tools touched (produced by
 * the RunManager and never rendered until now), each expanding into a diff —
 * `git diff HEAD` when the run's cwd is a work tree, a containment-checked
 * snapshot otherwise.
 */
import { useState } from "react";
import { ChevronRight, Copy, FileDiff } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { useT } from "../i18n";
import { useToast } from "../components/ui";
import { Badge, Button } from "../components/primitives";
import { diffToView, displayPath, type DiffLine, type RunDiff } from "./diff";

export interface FilesChangedProps {
  runId: string;
  files: readonly string[];
  cwd: string | null | undefined;
}

export default function FilesChanged({ runId, files, cwd }: FilesChangedProps) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  if (files.length === 0) return null;
  return (
    <div className="card files-changed">
      <h2>
        <FileDiff aria-hidden /> {t("runs.files.title")} <span className="files-count">{files.length}</span>
      </h2>
      <ul className="plain-list file-list">
        {files.map((file) => (
          <li key={file}>
            <FileRow
              runId={runId}
              file={file}
              cwd={cwd}
              open={open === file}
              onToggle={() => setOpen((cur) => (cur === file ? null : file))}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function FileRow({
  runId,
  file,
  cwd,
  open,
  onToggle,
}: {
  runId: string;
  file: string;
  cwd: string | null | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const id = `diff-${hash(file)}`;
  const diff = useQuery<RunDiff, Error>({
    queryKey: ["run", runId, "diff", file],
    queryFn: ({ signal }) =>
      api.get<RunDiff>(`/api/runs/${encodeURIComponent(runId)}/diff?file=${encodeURIComponent(file)}`, {
        signal,
      }),
    enabled: open,
    staleTime: 30_000,
    retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 1,
  });
  const view = diff.data ? diffToView(diff.data) : null;

  const copy = async () => {
    if (!diff.data) return;
    const text =
      diff.data.kind === "git"
        ? diff.data.diff
        : diff.data.kind === "snapshot"
          ? (diff.data.content ?? "")
          : "";
    try {
      await navigator.clipboard.writeText(text);
      toast(t("common.copied"), "ok");
    } catch (err) {
      toast((err as Error).message, "danger");
    }
  };

  return (
    <div className={`file-row ${open ? "open" : ""}`}>
      <button
        type="button"
        className="file-row-head"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
      >
        <ChevronRight className="file-chevron" aria-hidden />
        <span className="mono truncate" title={file}>
          {displayPath(file, cwd)}
        </span>
        {view && (
          <span
            className="file-stats mono"
            aria-label={t("runs.files.stats", { added: view.added, removed: view.removed })}
          >
            <span className="add">+{view.added}</span>
            <span className="del">−{view.removed}</span>
          </span>
        )}
      </button>
      {open && (
        <div className="file-diff" id={id}>
          {diff.isPending ? (
            <p className="widget-muted">{t("runs.files.loading")}</p>
          ) : diff.error ? (
            <p className="hint warn">{diff.error.message}</p>
          ) : view ? (
            <>
              <div className="file-diff-bar">
                <Badge kind="meta">
                  {view.source === "git"
                    ? t("runs.files.git")
                    : view.source === "snapshot"
                      ? t("runs.files.snapshot")
                      : t("runs.files.none")}
                </Badge>
                {view.truncated && <span className="hint warn">{t("runs.files.truncated")}</span>}
                <Button size="sm" variant="ghost" icon={<Copy aria-hidden />} onClick={() => void copy()}>
                  {t("common.copy")}
                </Button>
              </div>
              {view.note && <p className="hint">{view.note}</p>}
              {view.lines.length === 0 && !view.note ? (
                <p className="widget-muted">{t("runs.files.unchanged")}</p>
              ) : (
                <DiffBody lines={view.lines} />
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

const MAX_RENDERED_LINES = 1200;

function DiffBody({ lines }: { lines: readonly DiffLine[] }) {
  const t = useT();
  const shown = lines.slice(0, MAX_RENDERED_LINES);
  return (
    <div className="diff-view" role="group" aria-label={t("runs.files.diff")}>
      <table className="diff-table">
        <tbody>
          {shown.map((line, i) => (
            <tr key={i} className={`diff-line ${line.kind}`}>
              <td className="diff-no" aria-hidden>
                {line.oldNo ?? ""}
              </td>
              <td className="diff-no" aria-hidden>
                {line.newNo ?? ""}
              </td>
              <td className="diff-sign" aria-hidden>
                {line.kind === "add" ? "+" : line.kind === "del" ? "−" : ""}
              </td>
              <td className="diff-text">{line.text || " "}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {lines.length > shown.length && (
        <p className="hint">{t("runs.files.more", { n: lines.length - shown.length })}</p>
      )}
    </div>
  );
}

/** Stable id fragment for aria-controls (no crypto needed). */
function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
