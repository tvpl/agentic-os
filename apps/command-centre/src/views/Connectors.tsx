import { useState } from "react";
import { Plug, Search, ShieldCheck } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Connector } from "../api";
import { useT } from "../i18n";
import { qk, useOsConnectors } from "../queries";
import { ErrorBox, Skeleton, useToast } from "../components/ui";
import { Badge, Button, EmptyState } from "../components/primitives";
import { useConfirm } from "../hooks/useConfirm";
import { errorMessage, isOffline } from "./shared";

interface AuditReport {
  discovered: Array<{ source: string; name: string; transport: string; target: string }>;
  recommendations: Array<{ connector: Connector; rank: number; unlocks: string; setupStep: string }>;
  scannedFiles: string[];
}

export default function Connectors() {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [audit, setAudit] = useState<AuditReport | null>(null);
  const connectors = useOsConnectors();

  const runAudit = useMutation({
    mutationFn: () => api.get<AuditReport>("/api/connectors/audit"),
    onSuccess: (report) => setAudit(report),
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const requestWrite = useMutation({
    mutationFn: (c: Connector) => api.put<{ pendingApproval: { id: string } | null }>(`/api/connectors/${encodeURIComponent(c.id)}`, { ...c, writeEnabled: true }),
    onSuccess: (res) => {
      toast(res.pendingApproval ? t("conn.writeRequested") : t("conn.writeEnabled"), res.pendingApproval ? "info" : "ok");
      qc.invalidateQueries({ queryKey: qk.connectors }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: qk.approvals }).catch(() => undefined);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const onRequestWrite = async (c: Connector) => {
    if (await confirm({ title: t("conn.writeGate"), body: t("conn.writeGateBody", { name: c.name }), confirmLabel: t("conn.requestWrite") })) requestWrite.mutate(c);
  };

  if (connectors.isPending && !connectors.data) return <div className="page"><Skeleton lines={6} /></div>;
  if (connectors.error && !connectors.data) return <div className="page"><ErrorBox message={errorMessage(connectors.error)} offline={isOffline(connectors.error)} onRetry={() => void connectors.refetch()} /></div>;
  const list = connectors.data ?? [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("conn.title")}</h1>
          <p className="sub">{t("conn.sub")}</p>
        </div>
        <Button variant="primary" icon={<Search aria-hidden />} onClick={() => runAudit.mutate()} loading={runAudit.isPending}>
          {t("conn.audit")}
        </Button>
      </div>

      {audit && (
        <>
          <div className="card">
            <h2>{t("conn.discovered")}</h2>
            {audit.discovered.length === 0 ? (
              <p className="widget-muted">{t("conn.nothingDiscovered", { n: audit.scannedFiles.length })}</p>
            ) : (
              audit.discovered.map((d, i) => (
                <div className="list-row" key={i}>
                  <div>
                    <strong className="mono">{d.name}</strong>
                    <div className="meta mono">
                      {d.transport} · {d.target || "—"}
                    </div>
                  </div>
                  <span className="meta mono truncate" style={{ maxWidth: 260 }}>
                    {d.source}
                  </span>
                </div>
              ))
            )}
          </div>
          <div className="card">
            <h2>{t("conn.recommend")}</h2>
            {audit.recommendations.length === 0 && <p className="widget-muted">{t("conn.noRecommendations")}</p>}
            {audit.recommendations.map((r) => (
              <div className="list-row" key={r.connector.id}>
                <div>
                  <strong>
                    #{r.rank} {r.connector.name}
                  </strong>
                  <div className="meta">{r.unlocks}</div>
                </div>
                <span className="meta" style={{ maxWidth: 280, textAlign: "right" }}>
                  {r.setupStep}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {list.length === 0 ? (
        <EmptyState icon={<Plug aria-hidden />} title={t("conn.emptyTitle")} body={t("conn.emptyBody")} action={<Button variant="primary" onClick={() => runAudit.mutate()}>{t("conn.audit")}</Button>} />
      ) : (
        <div className="grid grid-2" style={{ marginTop: 14 }}>
          {list.map((c) => (
            <div className="card" key={c.id} style={{ margin: 0 }}>
              <div className="card-head-row">
                <h3 className="tight">{c.name}</h3>
                <Badge kind="state" tone={c.status === "healthy" ? "ok" : c.status === "not_configured" ? "dim" : "warn"}>
                  {c.status === "not_configured" ? t("conn.notConfigured") : c.status === "healthy" ? t("conn.healthy") : c.status}
                </Badge>
              </div>
              <p className="skill-desc">{c.notes}</p>
              <div className="badge-row">
                <Badge kind="meta">{c.kind}</Badge>
                <Badge kind="state" tone={c.official ? "ok" : "warn"}>
                  {c.official ? t("conn.official") : t("conn.community")}
                </Badge>
                <Badge kind="meta">
                  {t("conn.auth")}: {c.authMethod}
                </Badge>
                {c.writeEnabled ? (
                  <Badge kind="state" tone="warn">
                    {t("conn.write")}
                  </Badge>
                ) : (
                  <Badge kind="state" tone="info">
                    {t("skills.readOnly")}
                  </Badge>
                )}
              </div>
              <details>
                <summary className="conn-summary">
                  {t("conn.risks")} ({c.risks.length}) · {t("conn.ops")}
                </summary>
                <ul className="conn-risks">
                  {c.risks.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                <p className="meta">
                  {t("conn.readOps")}: {c.readOperations.join(", ") || "—"}
                </p>
                <p className="meta">
                  {t("conn.writeOps")}: {c.writeOperations.join(", ") || "—"}
                </p>
                <p className="meta mono break-all">{c.origin}</p>
              </details>
              {!c.writeEnabled && c.writeOperations.length > 0 && (
                <Button size="sm" variant="outline" icon={<ShieldCheck aria-hidden />} style={{ marginTop: 8 }} onClick={() => void onRequestWrite(c)} loading={requestWrite.isPending && requestWrite.variables?.id === c.id}>
                  {t("conn.requestWrite")}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
