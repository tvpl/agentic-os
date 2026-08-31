import { useContext, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Play, Square } from "lucide-react";
import { api, type ArtifactEntry, type RunRecord } from "../api";
import { I18nContext, useT } from "../i18n";
import { Empty, ErrorBox, Loading, StatusBadge, formatDuration, timeAgo, useApi, useToast } from "../components/ui";

export default function Runs() {
  const { id } = useParams();
  if (id) return <RunDetail id={id} />;
  return <RunList />;
}

function RunList() {
  const t = useT();
  const { lang } = useContext(I18nContext);
  const toast = useToast();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const { data, error, offline, loading, reload } = useApi<RunRecord[]>(() => api.get("/api/runs?limit=60"));

  useEffect(() => {
    const timer = setInterval(reload, 5000);
    return () => clearInterval(timer);
  }, [reload]);

  const quickRun = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    try {
      const res = await api.post<{ runId: string }>("/api/runs", { prompt, mode: "read_only" });
      setPrompt("");
      navigate(`/runs/${res.runId}`);
    } catch (err) {
      toast((err as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("runs.title")}</h1>
          <p className="sub">{t("runs.sub")}</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>{t("runs.quick")}</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="input"
            placeholder={t("runs.quickPh")}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && quickRun()}
          />
          <button className="btn primary" onClick={quickRun} disabled={busy || !prompt.trim()}>
            <Play aria-hidden /> {t("common.run")}
          </button>
        </div>
      </div>

      {loading && !data ? (
        <Loading />
      ) : error && !data ? (
        <ErrorBox message={error} offline={offline} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <Empty>{t("common.empty")}</Empty>
      ) : (
        <div className="card table-scroll" style={{ padding: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>{t("runs.title")}</th>
                <th>Provider</th>
                <th>Origin</th>
                <th>Status</th>
                <th>Duration</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => navigate(`/runs/${r.id}`)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && navigate(`/runs/${r.id}`)}>
                  <td className="truncate" style={{ maxWidth: 320 }}>
                    {r.skillSlug ? <span className="mono">/{r.skillSlug}</span> : r.promptSummary.slice(0, 60)}
                  </td>
                  <td>{r.provider}</td>
                  <td><span className="badge dim">{r.origin}</span></td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>{formatDuration(r.durationMs)}</td>
                  <td style={{ color: "var(--text-faint)" }}>{timeAgo(r.createdAt, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface RunEventView {
  type: string;
  ts: number;
  [key: string]: unknown;
}

function RunDetail({ id }: { id: string }) {
  const t = useT();
  const toast = useToast();
  const [events, setEvents] = useState<RunEventView[]>([]);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [artifact, setArtifact] = useState<{ path: string; content: string | null } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef(false);

  const refreshRun = () =>
    api.get<{ run: RunRecord; events: RunEventView[] }>(`/api/runs/${id}`).then((res) => {
      setRun(res.run);
      if (!liveRef.current) setEvents(res.events);
    });

  useEffect(() => {
    setEvents([]);
    setArtifact(null);
    liveRef.current = false;
    void refreshRun().then(() => {
      liveRef.current = true;
      setEvents([]);
      const stop = api.streamRun(id, (event) => {
        if (event.type === "run_state") {
          void refreshRun();
          return;
        }
        setEvents((prev) => [...prev, event as RunEventView]);
      });
      return stop;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events]);

  const artifacts = useApi<ArtifactEntry[]>(() => api.get("/api/artifacts/recent?limit=50"), [run?.status]);
  const myArtifacts = (artifacts.data ?? []).filter((a) => a.runId === id);

  const cancel = async () => {
    try {
      await api.post(`/api/runs/${id}/cancel`);
      toast(t("runs.cancel"), "ok");
      void refreshRun();
    } catch (err) {
      toast((err as Error).message, "danger");
    }
  };

  const openArtifact = async (p: string) => {
    try {
      const res = await api.get<{ path: string; content: string | null }>(`/api/artifacts/file?p=${encodeURIComponent(p)}`);
      setArtifact(res);
    } catch (err) {
      toast((err as Error).message, "danger");
    }
  };

  if (!run) return <div className="page"><Loading /></div>;

  const active = ["queued", "running", "waiting_approval"].includes(run.status);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p style={{ margin: 0 }}><Link to="/runs">← {t("runs.title")}</Link></p>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {run.skillSlug ? `/${run.skillSlug}` : t("runs.title")}
            <StatusBadge status={run.status} />
          </h1>
          <p className="sub mono" style={{ fontSize: 12 }}>
            {run.id} · {run.provider}{run.model ? ` · ${run.model}` : ""} · {formatDuration(run.durationMs)}
          </p>
        </div>
        {active && (
          <button className="btn danger" onClick={cancel}>
            <Square aria-hidden /> {t("runs.cancel")}
          </button>
        )}
      </div>

      {run.error && <div className="error-box" style={{ marginBottom: 14 }}>{run.error}</div>}

      <div className="card">
        <h2>{t("runs.prompt")}</h2>
        <pre className="preview-pre" style={{ maxHeight: 120 }}>{run.promptSummary}</pre>
      </div>

      <div className="card">
        <h2>{t("runs.events")} {active && <span className="spinner" style={{ verticalAlign: -3, marginLeft: 6 }} aria-hidden />}</h2>
        <div className="event-log" ref={logRef} aria-live="polite">
          {events.map((e, i) => (
            <div key={i} className={`event-line ${e.type}`}>
              <span className="tag">{e.type}</span>
              <span className="body">{describeEvent(e)}</span>
            </div>
          ))}
          {events.length === 0 && <span style={{ color: "var(--text-faint)" }}>…</span>}
        </div>
      </div>

      <div className="card">
        <h2>{t("runs.artifacts")}</h2>
        {myArtifacts.length === 0 ? (
          <p style={{ color: "var(--text-faint)", margin: 0 }}>—</p>
        ) : (
          myArtifacts.map((a) => (
            <div className="list-row" key={a.file}>
              <button className="btn ghost sm mono" onClick={() => openArtifact(a.path)}>{a.file}</button>
              <span className="meta mono">{a.path}</span>
            </div>
          ))
        )}
        {artifact && (
          <pre className="preview-pre" style={{ marginTop: 10, maxHeight: 380 }}>{artifact.content ?? "(binary or too large)"}</pre>
        )}
      </div>
    </div>
  );
}

function describeEvent(e: RunEventView): string {
  switch (e.type) {
    case "started":
      return `pid ${String(e.pid ?? "?")}`;
    case "assistant":
      return String(e.text ?? "");
    case "tool_use":
      return `${String(e.tool)} ${String(e.detail ?? "")}`;
    case "text":
      return String(e.text ?? "");
    case "permission":
      return String(e.detail ?? "");
    case "result":
      return `exit=${String(e.exitCode)} · ${String(e.summary ?? "")}`;
    case "error":
      return String(e.message ?? "");
    default:
      return JSON.stringify(e);
  }
}
