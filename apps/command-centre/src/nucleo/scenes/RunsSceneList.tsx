/**
 * The runs as a list (Runs scene): the accessible, scannable twin of the
 * river — one line per run, newest or oldest first, and "load older" past
 * the window. Type, not a table grid.
 */
import { useLocale, useT } from "../../i18n";
import type { RunRecord } from "../../api";
import { formatDuration } from "../../components/ui";
import { formatTokens, formatUsd, totalTokens } from "../../runs/usage";
import { laneOf, runLabel, runStart, toneOf } from "./runsRiver";
import { formatWhen } from "./runsFormat";

export default function RunsList({
  runs,
  now,
  selectedId,
  asc,
  onSort,
  onSelect,
  canLoadOlder,
  loadingOlder,
  onLoadOlder,
  statusText,
}: {
  runs: readonly RunRecord[];
  now: number;
  selectedId: string | null;
  asc: boolean;
  onSort: () => void;
  onSelect: (id: string) => void;
  canLoadOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  statusText: (status: string) => string;
}) {
  const t = useT();
  const locale = useLocale();
  const sorted = [...runs].sort((a, b) => (asc ? runStart(a) - runStart(b) : runStart(b) - runStart(a)));
  return (
    <section className="rs-listview" aria-label={t("scene.runs.list.label")}>
      <div className="rs-list-bar">
        <span className="rs-eyebrow">{t("scene.runs.list.count", { n: runs.length })}</span>
        <button type="button" className="rs-link" onClick={onSort}>
          {asc ? t("scene.runs.list.sortAsc") : t("scene.runs.list.sortDesc")} {asc ? "↑" : "↓"}
        </button>
      </div>
      <ol className="rs-list">
        {sorted.map((r) => {
          const tone = toneOf(r.status);
          const when = formatWhen(runStart(r), now, locale);
          const lane = t(`scene.runs.lane.short.${laneOf(r)}`);
          const title = runLabel(r, 70);
          const status = statusText(r.status);
          return (
            <li key={r.id}>
              <button
                type="button"
                className="rs-row"
                data-tone={tone}
                aria-current={r.id === selectedId || undefined}
                aria-label={t("scene.runs.list.row", { title, status, when, lane })}
                onClick={() => onSelect(r.id)}
              >
                <span className="rs-row-when mono">{when}</span>
                <span className="rs-row-dot" aria-hidden />
                <span className={`rs-row-title${r.skillSlug ? " mono" : ""}`}>{title}</span>
                <span className="rs-row-lane mono">{lane}</span>
                <span className="rs-row-status mono">{status}</span>
                <span className="rs-row-num mono">{formatDuration(r.durationMs, locale)}</span>
                <span className="rs-row-num mono">
                  {r.usage ? t("scene.runs.list.tokens", { n: formatTokens(totalTokens(r.usage)) }) : "—"}
                </span>
                <span className="rs-row-num mono">
                  {r.usage?.costUsd != null ? formatUsd(r.usage.costUsd) : "—"}
                </span>
                <span className="rs-row-prov mono">{r.provider}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {canLoadOlder && (
        <button type="button" className="rs-btn ghost rs-older" disabled={loadingOlder} onClick={onLoadOlder}>
          {t("scene.runs.list.older")}
        </button>
      )}
    </section>
  );
}
