import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Copy, RefreshCw, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { api, type ProviderId, type ProviderSnapshot } from "../api";
import { useT } from "../i18n";
import { useOsProviders } from "../queries";
import { copyText, errorMessage } from "../views/shared";
import { DialogPortal, useDialog } from "./dialog";
import { Button } from "./primitives";
import { useToast } from "./ui";
import {
  PROVIDER_GATE_EVENT,
  gateReason,
  providerGateSkipped,
  providerProblem,
  skipProviderGate,
} from "./providerReadiness";

/**
 * "Configure your AI first." Shown over the OS when no enabled provider can
 * run (nothing installed, or the CLI refuses its login), so the first thing a
 * person sees is how to fix it — not a failed run. Dismissable per session.
 */
export function ProviderGate() {
  const t = useT();
  const toast = useToast();
  const providers = useOsProviders({ staleTime: 30_000 });
  const [skipped, setSkipped] = useState(providerGateSkipped);
  const reason = skipped ? null : gateReason(providers.data);
  const open = reason !== null;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) document.documentElement.dataset.providerGate = "1";
    else delete document.documentElement.dataset.providerGate;
    window.dispatchEvent(new CustomEvent(PROVIDER_GATE_EVENT, { detail: { open } }));
    return () => {
      delete document.documentElement.dataset.providerGate;
    };
  }, [open]);

  const redetect = useMutation({
    mutationFn: (id: ProviderId) => api.post(`/api/providers/${id}/detect`),
    onSettled: () => void providers.refetch(),
    onError: (err: Error) => toast(errorMessage(err, t), "danger"),
  });
  const recheck = useMutation({
    mutationFn: async () => {
      await api.get("/api/providers?force=1");
      await providers.refetch();
    },
    onError: (err: Error) => toast(errorMessage(err, t), "danger"),
  });
  const skip = () => {
    skipProviderGate();
    setSkipped(true);
  };
  // The gate stays mounted while closed: the dialog follows `open`.
  useDialog(ref, skip, { open });
  if (!open) return null;

  const list = (providers.data ?? []).filter((p) => p.enabled);
  return (
    <DialogPortal>
      <div className="modal-backdrop provider-gate-backdrop">
        <div
          ref={ref}
          className="modal provider-gate"
          role="dialog"
          aria-modal="true"
          aria-labelledby="provider-gate-title"
          tabIndex={-1}
          data-testid="provider-gate"
        >
          <div className="provider-gate-head">
            <ShieldAlert aria-hidden />
            <div>
              <h2 id="provider-gate-title">{t("gate.title")}</h2>
              <p className="sub">{t(reason === "no_provider" ? "gate.noProvider" : "gate.body")}</p>
            </div>
          </div>
          {reason === "not_ready" && (
            <ul className="provider-gate-list">
              {list.map((prov) => (
                <GateRow
                  key={prov.id}
                  prov={prov}
                  busy={redetect.isPending && redetect.variables === prov.id}
                  disabled={redetect.isPending}
                  onDetect={() => redetect.mutate(prov.id)}
                  onCopy={(command) =>
                    void copyText(command).then((ok) =>
                      toast(t(ok ? "common.copied" : "skills.copyFailed"), ok ? "ok" : "danger"),
                    )
                  }
                />
              ))}
            </ul>
          )}
          <div className="modal-actions provider-gate-actions">
            <Link className="btn secondary" to="/settings?tab=providers" onClick={skip}>
              {t("gate.openSettings")}
            </Link>
            <Button variant="ghost" onClick={skip}>
              {t("gate.skip")}
            </Button>
            <Button
              variant="primary"
              icon={<RefreshCw aria-hidden />}
              onClick={() => recheck.mutate()}
              loading={recheck.isPending}
            >
              {t("gate.recheck")}
            </Button>
          </div>
        </div>
      </div>
    </DialogPortal>
  );
}

function GateRow({
  prov,
  busy,
  disabled,
  onDetect,
  onCopy,
}: {
  prov: ProviderSnapshot;
  busy: boolean;
  disabled: boolean;
  onDetect: () => void;
  onCopy: (command: string) => void;
}) {
  const t = useT();
  const problem = providerProblem(prov);
  const command =
    problem === "not_installed"
      ? prov.installHint
      : problem === "login_required"
        ? (prov.loginCommand ?? null)
        : null;
  return (
    <li className="provider-gate-row" data-testid={`gate-provider-${prov.id}`}>
      <div className="provider-gate-row-head">
        <span
          className={`dot ${problem === null ? "ok" : problem === "unverified" ? "warn" : "danger"}`}
          aria-hidden
        />
        <strong>{prov.displayName ?? prov.id}</strong>
        <span className="meta">
          {problem === "not_installed"
            ? t("setup.notInstalled")
            : problem === "login_required"
              ? `${prov.health.version ?? ""} · ${t("settings.authRequired")}`
              : problem === "unverified"
                ? `${prov.health.version ?? ""} · ${t("settings.authUnknown")}`
                : `${prov.health.version ?? ""} · ${t("settings.authOk")}`}
        </span>
      </div>
      {command && (
        <>
          <p className="hint">{t(problem === "not_installed" ? "gate.installHint" : "gate.loginHint")}</p>
          <div className="setup-cmd">
            <pre className="preview-pre tight">{command}</pre>
            <Button
              size="sm"
              variant="ghost"
              icon={<Copy aria-hidden />}
              aria-label={t("common.copy")}
              title={t("common.copy")}
              onClick={() => onCopy(command)}
            />
            <Button size="sm" variant="secondary" loading={busy} disabled={disabled} onClick={onDetect}>
              {t("setup.detectAgain")}
            </Button>
          </div>
        </>
      )}
    </li>
  );
}
