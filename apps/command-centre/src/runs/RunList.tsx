/**
 * Run history: a prompt box (⌘/Ctrl+Enter to submit) with provider, effort,
 * write toggle and working-directory picker, pending approvals inline, a
 * tokens sparkline from `/api/metrics`, filter chips, a paginated table with
 * cost per run, and empty/skeleton states.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Pencil, Play } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ProviderId, type RunRecord } from "../api";
import { useLocale, useT } from "../i18n";
import { qk, useApiQuery, useOsMetrics, useOsProviders, useOsSettings } from "../queries";
import { ErrorBox, Skeleton, StatusBadge, formatDuration, timeAgo, useToast } from "../components/ui";
import { Badge, Button, EmptyState, Field, Segmented } from "../components/primitives";
import { EFFORTS, useEffortLabels, type Effort } from "../desktop/SkillMatrixModal";
import { ApprovalsCard, useApprovals } from "./Approvals";
import { cwdSuggestions, writePolicyFor } from "./policy";
import { sparkline } from "./sparkline";
import { formatTokens, formatUsd, totalTokens } from "./usage";

const STATUS_FILTERS = ["all", "running", "done", "failed", "cancelled"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const PAGE_SIZE = 50;

function matchesStatus(run: RunRecord, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "running")
    return run.status === "running" || run.status === "queued" || run.status === "waiting_approval";
  if (filter === "failed")
    return run.status === "failed" || run.status === "timed_out" || run.status === "interrupted";
  return run.status === filter;
}

/** Settings fields this view reads (the shared hook types them loosely). */
interface RunsSettings {
  securityProfile?: string;
  indexedFolders?: Array<{ path: string; enabled: boolean }>;
}

export default function RunList() {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const effortLabels = useEffortLabels();
  const [offset, setOffset] = useState(0);
  const runs = useApiQuery<RunRecord[]>(
    qk.runs({ limit: PAGE_SIZE, offset }),
    `/api/runs?limit=${PAGE_SIZE}&offset=${offset}`,
    { refetchInterval: 30_000 },
  );
  const providers = useOsProviders();
  const metrics = useOsMetrics({ refetchInterval: 60_000 });
  const settings = useOsSettings();
  const approvals = useApprovals();

  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState<ProviderId | "">("");
  const [effort, setEffort] = useState<Effort>("default");
  const [writeMode, setWriteMode] = useState(false);
  const [cwd, setCwd] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [sortAsc, setSortAsc] = useState(false);

  const enabledProviders = (providers.data ?? []).filter((p) => p.enabled);
  const conf = (settings.data ?? {}) as RunsSettings;
  const policy = writePolicyFor(conf.securityProfile);
  const write = writeMode && policy !== "refused";

  const cwdOptions = useMemo(
    () => cwdSuggestions(conf.indexedFolders, runs.data),
    [conf.indexedFolders, runs.data],
  );

  const quickRun = useMutation({
    mutationFn: () =>
      api.post<{ runId: string | null; pendingApproval?: { id: string } | null }>("/api/runs", {
        prompt: prompt.trim(),
        mode: write ? "write" : "read_only",
        ...(provider ? { provider } : {}),
        ...(effort !== "default" ? { effort } : {}),
        ...(cwd ? { cwd } : {}),
      }),
    onSuccess: (res) => {
      setPrompt("");
      qc.invalidateQueries({ queryKey: ["runs"] }).catch(() => undefined);
      if (!res.runId) {
        // The profile asked for a human decision: the card below now shows it.
        qc.invalidateQueries({ queryKey: qk.approvals }).catch(() => undefined);
        toast(t("runs.approve.queued"), "info");
        return;
      }
      navigate(`/runs/${res.runId}`);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const rows = useMemo(() => {
    const list = (runs.data ?? []).filter(
      (r) => matchesStatus(r, status) && (providerFilter === "all" || r.provider === providerFilter),
    );
    return list.sort((a, b) => (sortAsc ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));
  }, [runs.data, status, providerFilter, sortAsc]);

  const canRun = prompt.trim().length > 0 && !quickRun.isPending && enabledProviders.length > 0;
  const hasNext = (runs.data ?? []).length === PAGE_SIZE;
  const page = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("runs.title")}</h1>
          <p className="sub">{t("runs.sub")}</p>
        </div>
        <TokensSpark series={metrics.data?.usageSeries} todayUsd={metrics.data?.cost?.todayUsd ?? null} />
      </div>

      <div className="card" style={{ marginBottom: "var(--s-4)" }}>
        <h2>{t("runs.quick")}</h2>
        <div className="stack-sm">
          <div className="quick-row">
            <textarea
              className="input quick-prompt"
              rows={2}
              placeholder={t("runs.quickPh")}
              value={prompt}
              aria-label={t("runs.prompt")}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canRun) {
                  e.preventDefault();
                  quickRun.mutate();
                }
              }}
            />
            <Button
              variant="primary"
              icon={<Play aria-hidden />}
              disabled={!canRun}
              loading={quickRun.isPending}
              onClick={() => quickRun.mutate()}
            >
              {t("common.run")}
            </Button>
          </div>
          <p className="hint quick-hint">{t("runs.submitHint")}</p>
          <div className="quick-options">
            <Field label={t("runs.provider")} htmlFor="qr-provider">
              <select
                id="qr-provider"
                className="input"
                value={provider}
                onChange={(e) => setProvider(e.target.value as ProviderId | "")}
              >
                <option value="">{t("runs.defaultProvider")}</option>
                {enabledProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("skills.effort")} htmlFor="qr-effort">
              <Segmented
                ariaLabel={t("skills.effort")}
                size="sm"
                value={effort}
                onChange={(v) => setEffort(v as Effort)}
                options={EFFORTS.map((e) => ({ value: e, label: effortLabels[e] }))}
              />
            </Field>
            <Field label={t("runs.cwdLabel")} htmlFor="qr-cwd" hint={t("runs.cwdHint")}>
              <input
                id="qr-cwd"
                className="input"
                list="qr-cwd-options"
                value={cwd}
                placeholder={t("runs.cwdDefault")}
                onChange={(e) => setCwd(e.target.value)}
              />
              <datalist id="qr-cwd-options">
                {cwdOptions.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </Field>
            <Field label={t("runs.mode")} htmlFor="qr-write">
              <div className="write-toggle">
                <Button
                  id="qr-write"
                  size="sm"
                  variant={write ? "primary" : "outline"}
                  icon={<Pencil aria-hidden />}
                  aria-pressed={write}
                  disabled={policy === "refused"}
                  title={policy === "refused" ? t("runs.write.refused") : undefined}
                  onClick={() => setWriteMode((v) => !v)}
                >
                  {t("runs.write.toggle")}
                </Button>
                <span className={`hint ${policy === "refused" ? "warn" : ""}`}>
                  {policy === "refused"
                    ? t("runs.write.refused")
                    : policy === "approval"
                      ? t("runs.write.approval")
                      : t("runs.write.allowed")}
                </span>
              </div>
            </Field>
            {enabledProviders.length === 0 && providers.data && (
              <p className="hint warn">{t("skills.noProviderBody")}</p>
            )}
          </div>
        </div>
      </div>

      <ApprovalsCard approvals={approvals.data} onLaunched={(runId) => runId && navigate(`/runs/${runId}`)} />

      <div className="filter-bar" role="group" aria-label={t("runs.filters")}>
        <Segmented
          ariaLabel={t("runs.status")}
          size="sm"
          value={status}
          onChange={(v) => setStatus(v as StatusFilter)}
          options={STATUS_FILTERS.map((s) => ({
            value: s,
            label: s === "all" ? t("brain.all") : t(`status.${s}` as "status.running"),
          }))}
        />
        <select
          className="input sm"
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
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
                  <button type="button" className="th-sort" onClick={() => setSortAsc((v) => !v)}>
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
                  <td className="truncate" style={{ maxWidth: 320 }}>
                    {r.skillSlug ? (
                      <span className="mono">/{r.skillSlug}</span>
                    ) : (
                      r.promptSummary.slice(0, 60)
                    )}
                  </td>
                  <td>{r.provider}</td>
                  <td>
                    <Badge kind="meta">{r.origin}</Badge>
                  </td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="num tabular">
                    {r.usage?.costUsd != null ? formatUsd(r.usage.costUsd) : "—"}
                  </td>
                  <td className="num tabular">{r.usage ? formatTokens(totalTokens(r.usage)) : "—"}</td>
                  <td className="tabular">{formatDuration(r.durationMs)}</td>
                  <td className="dim">{timeAgo(r.createdAt, locale)}</td>
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
