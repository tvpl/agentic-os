/**
 * Run history (refino item 12): pending approvals inline, a tokens sparkline
 * from `/api/metrics`, filter chips, and a paginated list that is a table
 * when the plate is wide and cards when it is narrow. Prompts are typed in
 * the console, not here.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { RunRecord } from "../api";
import { useLocale, useT } from "../i18n";
import { qk, useApiQuery, useOsMetrics, useOsProviders } from "../queries";
import { ErrorBox, Skeleton, StatusBadge, formatDuration, timeAgo } from "../components/ui";
import { Badge, Button, EmptyState, Segmented } from "../components/primitives";
import { ApprovalsCard, useApprovals } from "./ApprovalCards";
import { sparkline } from "./sparkline";
import { formatTokens, formatUsd, totalTokens } from "./usage";

const STATUS_FILTERS = ["all", "running", "done", "failed", "cancelled"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const PAGE_SIZE = 50;

export default function RunList() {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const providers = useOsProviders();
  const metrics = useOsMetrics({ refetchInterval: 300_000 });
  const approvals = useApprovals();

  const [status, setStatus] = useState<StatusFilter>("all");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [sortAsc, setSortAsc] = useState(false);
  const filters = {
    limit: PAGE_SIZE + 1,
    offset,
    ...(providerFilter !== "all" ? { provider: providerFilter } : {}),
    ...(status === "running"
      ? { statusGroup: "active" }
      : status === "failed"
        ? { statusGroup: "failed" }
        : status !== "all"
          ? { status }
          : {}),
    order: sortAsc ? "asc" : "desc",
  };
  const query = new URLSearchParams(Object.entries(filters).map(([key, value]) => [key, String(value)]));
  const runs = useApiQuery<RunRecord[]>(qk.runs(filters), `/api/runs?${query}`, { refetchInterval: 300_000 });

  const rows = (runs.data ?? []).slice(0, PAGE_SIZE);

  const hasNext = (runs.data ?? []).length > PAGE_SIZE;
  const page = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="page runs-page">
      <div className="page-head">
        <div>
          <h1>{t("runs.title")}</h1>
          <p className="sub">{t("runs.sub")}</p>
        </div>
        <TokensSpark series={metrics.data?.usageSeries} todayUsd={metrics.data?.cost?.todayUsd ?? null} />
      </div>

      <ApprovalsCard approvals={approvals.data} onLaunched={(runId) => runId && navigate(`/runs/${runId}`)} />

      <div className="filter-bar" role="group" aria-label={t("runs.filters")}>
        <Segmented
          ariaLabel={t("runs.status")}
          size="sm"
          value={status}
          onChange={(v) => {
            setStatus(v as StatusFilter);
            setOffset(0);
          }}
          options={STATUS_FILTERS.map((s) => ({
            value: s,
            label: s === "all" ? t("brain.all") : t(`status.${s}` as "status.running"),
          }))}
        />
        <select
          className="input sm"
          value={providerFilter}
          onChange={(e) => {
            setProviderFilter(e.target.value);
            setOffset(0);
          }}
          aria-label={t("runs.provider")}
        >
          <option value="all">{t("brain.all")}</option>
          {(providers.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.id}
            </option>
          ))}
        </select>
        <span className="filter-count">{t("runs.count", { n: rows.length })}</span>
      </div>

      {runs.isPending && !runs.data ? (
        <Skeleton lines={6} />
      ) : runs.error && !runs.data ? (
        <ErrorBox message={runs.error.message} onRetry={() => void runs.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t("runs.emptyTitle")} body={t("runs.emptyBody")} />
      ) : (
        <div className="card table-scroll" style={{ padding: 0 }}>
          <table className="table runs-table">
            <thead>
              <tr>
                <th>{t("runs.title")}</th>
                <th>{t("runs.provider")}</th>
                <th>{t("runs.origin")}</th>
                <th>{t("runs.status")}</th>
                <th className="num">{t("runs.cost")}</th>
                <th className="num">{t("runs.tokens")}</th>
                <th>{t("runs.duration")}</th>
                <th aria-sort={sortAsc ? "ascending" : "descending"}>
                  <button
                    type="button"
                    className="th-sort"
                    onClick={() => {
                      setSortAsc((v) => !v);
                      setOffset(0);
                    }}
                  >
                    {t("runs.when")} {sortAsc ? "↑" : "↓"}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="clickable"
                  role="link"
                  aria-label={r.skillSlug ? `/${r.skillSlug}` : r.promptSummary}
                  onClick={() => navigate(`/runs/${r.id}`)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && navigate(`/runs/${r.id}`)}
                >
                  <td className="truncate run-cell-title" style={{ maxWidth: 320 }}>
                    {r.skillSlug ? (
                      <span className="mono">/{r.skillSlug}</span>
                    ) : (
                      r.promptSummary.slice(0, 60)
                    )}
                  </td>
                  <td data-label={t("runs.provider")}>{r.provider}</td>
                  <td data-label={t("runs.origin")}>
                    <Badge kind="meta">{r.origin}</Badge>
                  </td>
                  <td data-label={t("runs.status")} className="run-cell-status">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="num tabular" data-label={t("runs.cost")}>
                    {r.usage?.costUsd != null ? formatUsd(r.usage.costUsd) : "—"}
                  </td>
                  <td className="num tabular" data-label={t("runs.tokens")}>
                    {r.usage ? formatTokens(totalTokens(r.usage)) : "—"}
                  </td>
                  <td className="tabular" data-label={t("runs.duration")}>
                    {formatDuration(r.durationMs, locale)}
                  </td>
                  <td className="dim" data-label={t("runs.when")}>
                    {timeAgo(r.createdAt, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(offset > 0 || hasNext) && (
        <div className="pager" role="group" aria-label={t("runs.pagination")}>
          <Button
            size="sm"
            variant="outline"
            icon={<ChevronLeft aria-hidden />}
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          >
            {t("runs.prevPage")}
          </Button>
          <span className="pager-label mono">{t("runs.page", { n: page })}</span>
          <Button
            size="sm"
            variant="outline"
            icon={<ChevronRight aria-hidden />}
            disabled={!hasNext}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
          >
            {t("runs.nextPage")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** 24 hourly token buckets as an inline sparkline (no layout work per frame). */
function TokensSpark({
  series,
  todayUsd,
}: {
  series: Array<{ ts: number; tokens: number; usd: number }> | undefined;
  todayUsd: number | null;
}) {
  const t = useT();
  const values = (series ?? []).map((p) => p.tokens);
  const total = values.reduce((a, b) => a + b, 0);
  if (values.length === 0) return null;
  const geo = sparkline(values, 120, 28);
  return (
    <div className="tokens-spark" title={t("runs.spark.title")}>
      <svg
        viewBox="0 0 120 28"
        width="120"
        height="28"
        role="img"
        aria-label={t("runs.spark.aria", { n: formatTokens(total) })}
        preserveAspectRatio="none"
      >
        <path d={geo.area} className="spark-area" />
        <path d={geo.line} className="spark-line" />
        {geo.last && <circle cx={geo.last.x} cy={geo.last.y} r={2} className="spark-dot" />}
      </svg>
      <div className="tokens-spark-meta">
        <span className="mono tnum">{formatTokens(total)}</span>
        <span className="hud-label">{t("runs.spark.label")}</span>
        {todayUsd != null && <span className="mono tnum accent-text">{formatUsd(todayUsd)}</span>}
      </div>
    </div>
  );
}
