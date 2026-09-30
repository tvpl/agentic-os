import { useState, type CSSProperties } from "react";
import { ChevronDown, MessageCircleQuestion, Plug, Search, ShieldCheck } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ConnectorWizard, connectorStateLabel } from "./ConnectorWizard";
import { api, type Connector } from "../api";
import { useLocale, useT } from "../i18n";
import { qk, useOsConnectors } from "../queries";
import { ErrorBox, Skeleton, useToast } from "../components/ui";
import { Button, EmptyState } from "../components/primitives";
import { useConfirm } from "../hooks/useConfirm";
import { errorMessage, isOffline } from "./shared";
import { askAbout, refWord } from "../nucleo/subject";
import "./backend.css";

interface AuditReport {
  discovered: Array<{ source: string; name: string; transport: string; target: string }>;
  recommendations: Array<{ connector: Connector; rank: number; unlocks: string; setupStep: string }>;
  scannedFiles: string[];
}

export default function Connectors() {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [audit, setAudit] = useState<AuditReport | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const connectors = useOsConnectors();

  const runAudit = useMutation({
    mutationFn: () => api.get<AuditReport>("/api/connectors/audit"),
    onSuccess: (report) => setAudit(report),
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const requestWrite = useMutation({
    mutationFn: (c: Connector) =>
      api.put<{ pendingApproval: { id: string } | null }>(`/api/connectors/${encodeURIComponent(c.id)}`, {
        ...c,
        writeEnabled: true,
      }),
    onSuccess: (res) => {
      toast(
        res.pendingApproval ? t("conn.writeRequested") : t("conn.writeEnabled"),
        res.pendingApproval ? "info" : "ok",
      );
      qc.invalidateQueries({ queryKey: qk.connectors }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: qk.approvals }).catch(() => undefined);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const onRequestWrite = async (c: Connector) => {
    if (
      await confirm({
        title: t("conn.writeGate"),
        body: t("conn.writeGateBody", { name: c.name }),
        confirmLabel: t("conn.requestWrite"),
      })
    )
      requestWrite.mutate(c);
  };

  if (connectors.isPending && !connectors.data)
    return (
      <div className="page">
        <Skeleton lines={6} />
      </div>
    );
  if (connectors.error && !connectors.data)
    return (
      <div className="page">
        <ErrorBox
          message={errorMessage(connectors.error)}
          offline={isOffline(connectors.error)}
          onRetry={() => void connectors.refetch()}
        />
      </div>
    );
  const list = connectors.data ?? [];

  return (
    <div className="page cx">
      {/* The shell names the scene; the header keeps only its action. */}
      <header className="cx-head">
        <Button
          variant="primary"
          className="cx-pill"
          data-testid="connectors-audit"
          icon={<Search aria-hidden />}
          onClick={() => runAudit.mutate()}
          loading={runAudit.isPending}
        >
          {t("conn.audit")}
        </Button>
      </header>

      {audit && (
        <section className="cx-audit">
          <div className="cx-glass">
            <h2>{t("concept.conn.discovered")}</h2>
            {audit.discovered.length === 0 ? (
              <p className="meta">{t("conn.nothingDiscovered", { n: audit.scannedFiles.length })}</p>
            ) : (
              audit.discovered.map((d, i) => (
                <div className="cx-row" key={i}>
                  <strong className="mono">{d.name}</strong>
                  <span className="meta mono">
                    {d.transport} · {d.target || "—"}
                  </span>
                  <span className="meta mono truncate">{d.source}</span>
                </div>
              ))
            )}
          </div>
          <div className="cx-glass">
            <h2>{t("concept.conn.recommend")}</h2>
            {audit.recommendations.length === 0 && <p className="meta">{t("conn.noRecommendations")}</p>}
            {audit.recommendations.map((r) => (
              <div className="cx-row" key={r.connector.id}>
                <strong>
                  #{r.rank} {r.connector.name}
                </strong>
                <span className="meta">{r.unlocks}</span>
                <span className="meta">{r.setupStep}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {list.length === 0 ? (
        <EmptyState
          icon={<Plug aria-hidden />}
          title={t("conn.emptyTitle")}
          body={t("conn.emptyBody")}
          action={
            <Button variant="primary" onClick={() => runAudit.mutate()}>
              {t("conn.audit")}
            </Button>
          }
        />
      ) : (
        <ul className="cx-list">
          {list.map((c, i) => {
            const isOpen = open === c.id;
            const state =
              c.status === "not_configured"
                ? "off"
                : c.status === "unhealthy"
                  ? "danger"
                  : c.lastUsedAt || c.status === "healthy"
                    ? "ok"
                    : "warn";
            return (
              <li
                key={c.id}
                className="cx-card"
                data-testid="connector-card"
                data-id={c.id}
                data-open={isOpen ? "" : undefined}
                style={{ "--i": i } as CSSProperties}
              >
                <button
                  type="button"
                  className="cx-card-head"
                  aria-expanded={isOpen}
                  aria-label={t(isOpen ? "concept.conn.close" : "concept.conn.open", { name: c.name })}
                  onClick={() => setOpen(isOpen ? null : c.id)}
                >
                  <span className="cx-orb" data-state={state} aria-hidden />
                  <span className="cx-id">
                    <span className="cx-name">{c.name}</span>
                    <span className="cx-purpose">{c.notes || c.kind}</span>
                  </span>
                  <span className="cx-state mono">{connectorStateLabel(c, t, locale)}</span>
                  <ChevronDown className="cx-chev" aria-hidden />
                </button>
                {isOpen && (
                  <div className="cx-body">
                    <div className="cx-chips">
                      <span className="cx-chip">{c.kind}</span>
                      <span className="cx-chip" data-tone={c.official ? "ok" : "warn"}>
                        {c.official ? t("conn.official") : t("conn.community")}
                      </span>
                      <span className="cx-chip">
                        {t("conn.auth")}: {c.authMethod}
                      </span>
                      <span className="cx-chip" data-tone={c.writeEnabled ? "warn" : "info"}>
                        {c.writeEnabled ? t("conn.write") : t("skills.readOnly")}
                      </span>
                    </div>
                    <ConnectorWizard connector={c} />
                    <div className="cx-acts">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="cx-pill"
                        icon={<MessageCircleQuestion aria-hidden />}
                        onClick={() =>
                          askAbout({
                            id: `subject:connector:${c.id}`,
                            kind: "surface",
                            ref: refWord("conector", c.id),
                            title: `${c.name} (connector ${c.id}, ${connectorStateLabel(c, t, locale)})`,
                          })
                        }
                      >
                        {t("concept.runs.ask")}
                      </Button>
                      {!c.writeEnabled && c.writeOperations.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="cx-pill"
                          icon={<ShieldCheck aria-hidden />}
                          onClick={() => void onRequestWrite(c)}
                          loading={requestWrite.isPending && requestWrite.variables?.id === c.id}
                        >
                          {t("conn.requestWrite")}
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
