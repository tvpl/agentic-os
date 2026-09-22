/**
 * A connector in three steps (refino item 28): what it does and asks for,
 * how to set it up, and a test that proves it — all inside the card, in the
 * order a person needs them. A passed test marks the connector configured;
 * the header then says "connected · last read N min ago".
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { api, type Connector, type ConnectorData } from "../api";
import { useT } from "../i18n";
import { qk } from "../queries";
import { Badge, Button } from "../components/primitives";
import { timeAgo, useToast } from "../components/ui";

type Step = 1 | 2 | 3;

export function connectorStateLabel(
  c: Pick<Connector, "status" | "lastUsedAt">,
  t: (
    key: "conn.notConfigured" | "conn.healthy" | "backend.conn.connectedAgo",
    vars?: Record<string, string>,
  ) => string,
  locale: string,
): string {
  if (c.status === "not_configured") return t("conn.notConfigured");
  if (c.lastUsedAt) return t("backend.conn.connectedAgo", { ago: timeAgo(c.lastUsedAt, locale) });
  return t("conn.healthy");
}

export function ConnectorWizard({ connector }: { connector: Connector }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>(connector.status === "not_configured" ? 1 : 3);
  const base = `/api/connectors/${encodeURIComponent(connector.id)}`;
  const setup = useQuery<{ steps: string[] }>({
    queryKey: [...qk.connectors, connector.id, "setup"],
    queryFn: ({ signal }) => api.get<{ steps: string[] }>(`${base}/setup`, { signal }),
    enabled: Boolean(connector.dataMapping) && step >= 2,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const test = useMutation({
    mutationFn: () => api.get<ConnectorData>(`${base}/data?refresh=1`),
    onSuccess: async (d) => {
      if (d.status === "ok" && connector.status === "not_configured") {
        await api.put(base, { ...connector, status: "configured" }).catch(() => undefined);
      }
      qc.invalidateQueries({ queryKey: qk.connectors }).catch(() => undefined);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const copy = (text: string) =>
    void navigator.clipboard
      .writeText(text)
      .then(() => toast(t("common.copied"), "ok"))
      .catch(() => undefined);
  const result = test.data;

  return (
    <div className="conn-wizard" data-step={step}>
      <ol className="conn-steps" aria-label={t("backend.conn.wizard")}>
        {([1, 2, 3] as Step[]).map((n) => (
          <li key={n} className={n === step ? "on" : n < step ? "done" : ""}>
            <button type="button" onClick={() => setStep(n)}>
              <span className="conn-step-n">{n < step ? <Check aria-hidden /> : n}</span>
              {t(n === 1 ? "backend.conn.step1" : n === 2 ? "backend.conn.step2" : "backend.conn.step3")}
            </button>
          </li>
        ))}
      </ol>
      {step === 1 && (
        <div className="conn-step-body">
          <p className="meta">
            {t("backend.conn.reads")}: {connector.readOperations.join(", ") || "—"}
          </p>
          {connector.writeOperations.length > 0 && (
            <p className="meta">
              {t("backend.conn.writes")}: {connector.writeOperations.join(", ")} ·{" "}
              {connector.writeEnabled ? t("conn.write") : t("skills.readOnly")}
            </p>
          )}
          {connector.risks.length > 0 && (
            <ul className="conn-risks">
              {connector.risks.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
          <p className="meta mono break-all">{connector.origin}</p>
          <Button size="sm" variant="primary" onClick={() => setStep(2)}>
            {t("backend.conn.next")}
          </Button>
        </div>
      )}
      {step === 2 && (
        <div className="conn-step-body">
          {!connector.dataMapping && <p className="meta">{t("backend.conn.noMapping")}</p>}
          {(setup.data?.steps ?? []).length === 0 && connector.dataMapping && (
            <p className="meta">{setup.isFetching ? t("common.loading") : t("backend.conn.noSteps")}</p>
          )}
          <ol className="conn-setup">
            {(setup.data?.steps ?? []).map((line, i) => {
              const code = /`([^`]+)`/.exec(line)?.[1] ?? null;
              return (
                <li key={i}>
                  <span>{line}</span>
                  {code && (
                    <button
                      type="button"
                      className="go icon quiet"
                      aria-label={t("common.copy")}
                      title={t("common.copy")}
                      onClick={() => copy(code)}
                    >
                      <Copy aria-hidden />
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="row">
            <Button size="sm" variant="ghost" onClick={() => setStep(1)}>
              {t("backend.conn.back")}
            </Button>
            <Button size="sm" variant="primary" onClick={() => setStep(3)}>
              {t("backend.conn.next")}
            </Button>
          </div>
        </div>
      )}
      {step === 3 && (
        <div className="conn-step-body">
          <p className="meta">{t("backend.conn.readOnly")}</p>
          <div className="row">
            <Button size="sm" variant="primary" loading={test.isPending} onClick={() => test.mutate()}>
              {t("backend.conn.testRead")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setStep(2)}>
              {t("backend.conn.back")}
            </Button>
          </div>
          {result && (
            <div className="conn-result">
              <Badge
                kind="state"
                tone={result.status === "ok" ? "ok" : result.status === "error" ? "danger" : "dim"}
              >
                {result.status === "ok"
                  ? t("backend.conn.dataOk")
                  : result.status === "error"
                    ? t("backend.conn.dataError")
                    : t("backend.conn.dataNotConfigured")}
              </Badge>
              {result.message && <p className="meta">{result.message}</p>}
              {result.status === "ok" && (
                <ul className="conn-items">
                  {result.items.slice(0, 3).map((it) => (
                    <li key={it.id}>
                      <strong>{it.title}</strong>
                      {it.subtitle && <span className="meta"> · {it.subtitle}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
