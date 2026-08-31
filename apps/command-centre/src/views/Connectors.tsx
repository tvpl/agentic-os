import { useState } from "react";
import { ShieldCheck, Search } from "lucide-react";
import { api, type Connector } from "../api";
import { useT } from "../i18n";
import { Empty, ErrorBox, Loading, useApi, useToast } from "../components/ui";

interface AuditReport {
  discovered: Array<{ source: string; name: string; transport: string; target: string }>;
  recommendations: Array<{ connector: Connector; rank: number; unlocks: string; setupStep: string }>;
  scannedFiles: string[];
}

export default function Connectors() {
  const t = useT();
  const toast = useToast();
  const [audit, setAudit] = useState<AuditReport | null>(null);
  const [auditing, setAuditing] = useState(false);
  const { data, error, offline, loading, reload } = useApi<Connector[]>(() => api.get("/api/connectors"));

  if (loading && !data) return <div className="page"><Loading /></div>;
  if (error && !data) return <div className="page"><ErrorBox message={error} offline={offline} onRetry={reload} /></div>;
  if (!data) return null;

  const runAudit = async () => {
    setAuditing(true);
    try {
      setAudit(await api.get<AuditReport>("/api/connectors/audit"));
    } catch (err) {
      toast((err as Error).message, "danger");
    } finally {
      setAuditing(false);
    }
  };

  const requestWrite = async (c: Connector) => {
    const res = await api.put<{ pendingApproval: { id: string } | null }>(`/api/connectors/${c.id}`, {
      ...c,
      writeEnabled: true,
    });
    if (res.pendingApproval) toast(t("conn.writeGate"), "info");
    reload();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("conn.title")}</h1>
          <p className="sub">{t("conn.sub")}</p>
        </div>
        <button className="btn primary" onClick={runAudit} disabled={auditing}>
          {auditing ? <span className="spinner" aria-hidden /> : <Search aria-hidden />} {t("conn.audit")}
        </button>
      </div>

      {audit && (
        <>
          <div className="card">
            <h2>{t("conn.discovered")}</h2>
            {audit.discovered.length === 0 ? (
              <p style={{ color: "var(--text-faint)", margin: 0 }}>
                — <span style={{ fontSize: 12 }}>({audit.scannedFiles.length} config files scanned; credentials are never read)</span>
              </p>
            ) : (
              audit.discovered.map((d, i) => (
                <div className="list-row" key={i}>
                  <div>
                    <strong className="mono">{d.name}</strong>
                    <div className="meta mono">{d.transport} · {d.target || "—"}</div>
                  </div>
                  <span className="meta mono truncate" style={{ maxWidth: 260 }}>{d.source}</span>
                </div>
              ))
            )}
          </div>
          <div className="card">
            <h2>{t("conn.recommend")}</h2>
            {audit.recommendations.map((r) => (
              <div className="list-row" key={r.connector.id}>
                <div>
                  <strong>#{r.rank} {r.connector.name}</strong>
                  <div className="meta">{r.unlocks}</div>
                </div>
                <span className="meta" style={{ maxWidth: 280, textAlign: "right" }}>{r.setupStep}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {data.length === 0 ? (
        <Empty>{t("common.empty")}</Empty>
      ) : (
        <div className="grid grid-2" style={{ marginTop: 14 }}>
          {data.map((c) => (
            <div className="card" key={c.id} style={{ margin: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <h3>{c.name}</h3>
                <span className={`badge ${c.status === "healthy" ? "ok" : c.status === "not_configured" ? "dim" : "warn"}`}>
                  {c.status === "not_configured" ? t("conn.notConfigured") : c.status}
                </span>
              </div>
              <p style={{ color: "var(--text-dim)", margin: "0 0 8px" }}>{c.notes}</p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                <span className="badge dim">{c.kind}</span>
                <span className={`badge ${c.official ? "ok" : "warn"}`}>
                  {c.official ? t("conn.official") : t("conn.community")}
                </span>
                <span className="badge dim">auth: {c.authMethod}</span>
                {c.writeEnabled ? <span className="badge warn">write</span> : <span className="badge info">read-only</span>}
              </div>
              <details>
                <summary style={{ cursor: "pointer", color: "var(--text-dim)", fontSize: 13 }}>
                  {t("conn.risks")} ({c.risks.length}) · ops
                </summary>
                <ul style={{ margin: "6px 0", paddingLeft: 18, color: "var(--text-dim)", fontSize: 13 }}>
                  {c.risks.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
                <p className="meta">read: {c.readOperations.join(", ") || "—"}</p>
                <p className="meta">write: {c.writeOperations.join(", ") || "—"}</p>
                <p className="meta mono" style={{ wordBreak: "break-all" }}>{c.origin}</p>
              </details>
              {!c.writeEnabled && c.writeOperations.length > 0 && (
                <button className="btn sm" style={{ marginTop: 8 }} onClick={() => requestWrite(c)}>
                  <ShieldCheck aria-hidden /> {t("conn.writeGate")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
