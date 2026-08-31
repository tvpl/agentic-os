import { useContext } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BrainCircuit, Play, Star } from "lucide-react";
import {
  api,
  type ArtifactEntry,
  type Metrics,
  type ProviderId,
  type ProviderSnapshot,
  type RoutineStatus,
  type RunRecord,
  type Skill,
} from "../api";
import { I18nContext, useT } from "../i18n";
import { ErrorBox, Loading, StatusBadge, formatDuration, timeAgo, useApi, useToast } from "../components/ui";

interface DashData {
  providers: ProviderSnapshot[];
  skills: Skill[];
  routines: RoutineStatus[];
  artifacts: ArtifactEntry[];
  runs: RunRecord[];
  metrics: Metrics;
}

export default function Dashboard() {
  const t = useT();
  const { lang } = useContext(I18nContext);
  const toast = useToast();
  const navigate = useNavigate();
  const { data, error, offline, loading, reload } = useApi<DashData>(async () => {
    const [providers, skills, routines, artifacts, runs, metrics] = await Promise.all([
      api.get<ProviderSnapshot[]>("/api/providers"),
      api.get<Skill[]>("/api/skills"),
      api.get<RoutineStatus[]>("/api/routines"),
      api.get<ArtifactEntry[]>("/api/artifacts/recent?limit=8"),
      api.get<RunRecord[]>("/api/runs?limit=30"),
      api.get<Metrics>("/api/metrics"),
    ]);
    return { providers, skills, routines, artifacts, runs, metrics };
  });

  if (loading && !data) return <div className="page"><Loading /></div>;
  if (error && !data) return <div className="page"><ErrorBox message={error} offline={offline} onRetry={reload} /></div>;
  if (!data) return null;

  const active = data.providers.find((p) => p.isDefault);
  const favorites = data.skills.filter((s) => s.favorite && s.enabled);
  const running = data.runs.filter((r) => ["running", "queued"].includes(r.status));
  const failures = data.runs.filter((r) => r.status === "failed").slice(0, 5);
  const upcoming = data.routines
    .filter((r) => r.enabled && r.nextRunAt)
    .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))
    .slice(0, 4);

  const switchDefault = async (provider: ProviderId) => {
    try {
      await api.put("/api/providers/default", { provider });
      toast(`${t("dash.activeProvider")}: ${provider}`, "ok");
      reload();
    } catch (err) {
      toast((err as Error).message, "danger");
    }
  };

  const runSkill = async (slug: string) => {
    try {
      const res = await api.post<{ runId: string }>(`/api/skills/${slug}/run`, { inputs: {} });
      toast(`${t("common.run")}: ${slug}`, "ok");
      navigate(`/runs/${res.runId}`);
    } catch (err) {
      toast((err as Error).message, "danger");
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("nav.dashboard")}</h1>
          <p className="sub">
            {t("dash.activeProvider")}: <strong>{active?.id ?? "—"}</strong>
            {active?.health.version ? <span style={{ color: "var(--text-faint)" }}> · {active.health.version}</span> : null}
          </p>
        </div>
        <div className="segmented" role="group" aria-label={t("dash.providers")}>
          {data.providers.map((p) => (
            <button
              key={p.id}
              className={p.isDefault ? "active" : ""}
              disabled={!p.enabled}
              title={p.enabled ? (p.isDefault ? t("dash.default") : t("dash.makeDefault")) : t("common.disabled")}
              onClick={() => !p.isDefault && p.enabled && switchDefault(p.id)}
            >
              <span className={`dot ${p.enabled ? (p.health.ok ? "ok" : p.health.installed ? "warn" : "danger") : "dim"}`} style={{ marginRight: 6 }} />
              {p.id}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-3">
        <div className="card stat">
          <span className="value">{data.metrics.last7d}</span>
          <span className="label">{t("dash.metrics")} · {t("dash.metricRuns")}</span>
        </div>
        <div className="card stat">
          <span className="value">
            {data.metrics.successRate == null ? "—" : `${Math.round(data.metrics.successRate * 100)}%`}
          </span>
          <span className="label">{t("dash.metricSuccess")}</span>
        </div>
        <div className="card stat">
          <span className="value">{formatDuration(data.metrics.avgDurationMs)}</span>
          <span className="label">{t("dash.metricAvg")}</span>
        </div>
      </div>

      <div style={{ marginTop: 14 }} className="grid grid-2">
        <div>
          <Link
            to="/brain"
            className="card"
            style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 14, textDecoration: "none", color: "inherit" }}
          >
            <span className="brand-mark" style={{ width: 40, height: 40 }} aria-hidden>
              <BrainCircuit size={22} />
            </span>
            <span>
              <strong style={{ fontSize: 15 }}>{t("dash.brainCta")}</strong>
              <div style={{ color: "var(--text-dim)", fontSize: 13 }}>{t("dash.brainSub")}</div>
            </span>
          </Link>

          <div className="card">
            <h2><Star size={13} style={{ verticalAlign: -2 }} aria-hidden /> {t("dash.favorites")}</h2>
            {favorites.length === 0 ? (
              <p style={{ color: "var(--text-faint)", margin: 0 }}>{t("dash.noFavorites")}</p>
            ) : (
              favorites.map((s) => (
                <div className="list-row" key={s.slug}>
                  <div className="truncate">
                    <Link to={`/skills/${s.slug}`}>{s.name}</Link>
                    <div className="meta truncate">{s.description.split("\n")[0]}</div>
                  </div>
                  <button className="btn sm primary" onClick={() => runSkill(s.slug)}>
                    <Play aria-hidden /> {t("skills.runNow")}
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="card">
            <h2>{t("dash.routines")}</h2>
            {upcoming.length === 0 ? (
              <p style={{ color: "var(--text-faint)", margin: 0 }}>
                {data.routines.length} {t("dash.routines").toLowerCase()} · 0 {t("dash.nextRuns")} — <Link to="/routines">{t("nav.routines")} →</Link>
              </p>
            ) : (
              upcoming.map((r) => (
                <div className="list-row" key={r.id}>
                  <div className="truncate">
                    <Link to="/routines">{r.name}</Link>
                    <div className="meta">{r.schedule} · {r.timezone}</div>
                  </div>
                  <span className="badge info">{timeAgo(r.nextRunAt, lang)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <div className="card">
            <h2>{t("dash.running")}</h2>
            {running.length === 0 ? (
              <p style={{ color: "var(--text-faint)", margin: 0 }}>—</p>
            ) : (
              running.map((r) => (
                <div className="list-row" key={r.id}>
                  <div className="truncate">
                    <Link to={`/runs/${r.id}`}>{r.skillSlug ?? r.promptSummary.slice(0, 48)}</Link>
                    <div className="meta">{r.provider} · {timeAgo(r.createdAt, lang)}</div>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
              ))
            )}
          </div>

          <div className="card">
            <h2>{t("dash.attention")}</h2>
            {failures.length === 0 && data.routines.every((r) => r.healthy) ? (
              <p style={{ color: "var(--ok)", margin: 0 }}>{t("dash.allClear")}</p>
            ) : (
              <>
                {data.routines.filter((r) => !r.healthy).map((r) => (
                  <div className="list-row" key={r.id}>
                    <div className="truncate">
                      <Link to="/routines">{r.name}</Link>
                      <div className="meta">{t("routines.failing")}</div>
                    </div>
                    <span className="badge danger">{r.recentFailures}×</span>
                  </div>
                ))}
                {failures.map((r) => (
                  <div className="list-row" key={r.id}>
                    <div className="truncate">
                      <Link to={`/runs/${r.id}`}>{r.skillSlug ?? r.promptSummary.slice(0, 48)}</Link>
                      <div className="meta truncate">{r.error}</div>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="card">
            <h2>{t("dash.artifacts")}</h2>
            {data.artifacts.length === 0 ? (
              <p style={{ color: "var(--text-faint)", margin: 0 }}>{t("dash.noArtifacts")}</p>
            ) : (
              data.artifacts.map((a) => (
                <div className="list-row" key={`${a.runId}-${a.file}`}>
                  <div className="truncate">
                    <Link to={`/runs/${a.runId}`}>{a.file}</Link>
                    <div className="meta">{a.skillSlug ?? a.origin} · {a.provider} · {timeAgo(a.createdAt, lang)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
