/**
 * Run history: quick prompt box with provider/model/effort, filter chips,
 * a sortable table, empty/skeleton states. Live updates come from the
 * `/api/events` stream through the query cache (30 s fallback interval).
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Play } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { api, type ProviderId, type RunRecord } from "../api";
import { useLocale, useT } from "../i18n";
import { useOsProviders, useOsRuns } from "../queries";
import { ErrorBox, Skeleton, StatusBadge, formatDuration, timeAgo, useToast } from "../components/ui";
import { Badge, Button, EmptyState, Field, Segmented } from "../components/primitives";
import { EFFORTS, useEffortLabels, type Effort } from "../desktop/SkillMatrixModal";

const STATUS_FILTERS = ["all", "running", "done", "failed", "cancelled"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

function matchesStatus(run: RunRecord, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "running") return run.status === "running" || run.status === "queued" || run.status === "waiting_approval";
  if (filter === "failed") return run.status === "failed" || run.status === "timed_out" || run.status === "interrupted";
  return run.status === filter;
}

export default function RunList() {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const effortLabels = useEffortLabels();
  const runs = useOsRuns({ limit: 100 }, { refetchInterval: 30_000 });
  const providers = useOsProviders();

  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState<ProviderId | "">("");
  const [effort, setEffort] = useState<Effort>("default");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [sortAsc, setSortAsc] = useState(false);

  const enabledProviders = (providers.data ?? []).filter((p) => p.enabled);

  const quickRun = useMutation({
    mutationFn: () =>
      api.post<{ runId: string }>("/api/runs", {
        prompt: prompt.trim(),
        mode: "read_only",
        ...(provider ? { provider } : {}),
        ...(effort !== "default" ? { effort } : {}),
      }),
    onSuccess: (res) => {
      setPrompt("");
      navigate(`/runs/${res.runId}`);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const rows = useMemo(() => {
    const list = (runs.data ?? []).filter((r) => matchesStatus(r, status) && (providerFilter === "all" || r.provider === providerFilter));
    return list.sort((a, b) => (sortAsc ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));
  }, [runs.data, status, providerFilter, sortAsc]);

  const canRun = prompt.trim().length > 0 && !quickRun.isPending && enabledProviders.length > 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("runs.title")}</h1>
          <p className="sub">{t("runs.sub")}</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "var(--s-4)" }}>
        <h2>{t("runs.quick")}</h2>
        <div className="stack-sm">
          <div className="quick-row">
            <input
              className="input"
              placeholder={t("runs.quickPh")}
              value={prompt}
              aria-label={t("runs.prompt")}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canRun && quickRun.mutate()}
            />
            <Button variant="primary" icon={<Play aria-hidden />} disabled={!canRun} loading={quickRun.isPending} onClick={() => quickRun.mutate()}>
              {t("common.run")}
            </Button>
          </div>
          <div className="quick-options">
            <Field label={t("runs.provider")} htmlFor="qr-provider">
              <select id="qr-provider" className="input" value={provider} onChange={(e) => setProvider(e.target.value as ProviderId | "")}>
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
            {enabledProviders.length === 0 && providers.data && <p className="hint warn">{t("skills.noProviderBody")}</p>}
          </div>
        </div>
      </div>

      <div className="filter-bar" role="group" aria-label={t("runs.filters")}>
        <Segmented
          ariaLabel={t("runs.status")}
          size="sm"
          value={status}
          onChange={(v) => setStatus(v as StatusFilter)}
          options={STATUS_FILTERS.map((s) => ({ value: s, label: s === "all" ? t("brain.all") : t(`status.${s}` as "status.running") }))}
        />
        <select className="input sm" value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} aria-label={t("runs.provider")}>
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
          <table className="table">
            <thead>
              <tr>
                <th>{t("runs.title")}</th>
                <th>{t("runs.provider")}</th>
                <th>{t("runs.origin")}</th>
                <th>{t("runs.status")}</th>
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
                    {r.skillSlug ? <span className="mono">/{r.skillSlug}</span> : r.promptSummary.slice(0, 60)}
                  </td>
                  <td>{r.provider}</td>
                  <td>
                    <Badge kind="meta">{r.origin}</Badge>
                  </td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="tabular">{formatDuration(r.durationMs)}</td>
                  <td className="dim">{timeAgo(r.createdAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
