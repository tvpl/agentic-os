/** Settings › diagnostics (split out of Settings.tsx, refino item 17). */
import { Download, Stethoscope } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { api, type DoctorReport } from "../../api";

import { useT } from "../../i18n";
import { useToast } from "../../components/ui";
import { Button } from "../../components/primitives";

export function DiagnosticsTab() {
  const t = useT();
  const toast = useToast();
  const doctor = useMutation({
    mutationFn: () => api.get<DoctorReport>("/api/doctor"),
    onError: (err: Error) => toast(err.message, "danger"),
  });
  // A redacted JSON (settings without secrets, doctor, metrics, recent runs) to attach to a bug report.
  const exportDiag = useMutation({
    mutationFn: async () => {
      const bundle = await api.get<Record<string, unknown>>("/api/diagnostics/export");
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mordomo-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    onSuccess: () => toast(t("settings.exportDiagnosticsDone"), "ok"),
    onError: (err: Error) => toast(err.message, "danger"),
  });
  return (
    <div className="card stack">
      <div className="row-actions">
        <Button
          variant="primary"
          icon={<Stethoscope aria-hidden />}
          onClick={() => doctor.mutate()}
          loading={doctor.isPending}
        >
          {t("settings.runDoctor")}
        </Button>
        <Button
          variant="secondary"
          icon={<Download aria-hidden />}
          onClick={() => exportDiag.mutate()}
          loading={exportDiag.isPending}
        >
          {t("settings.exportDiagnostics")}
        </Button>
      </div>
      <p className="hint">{t("settings.exportDiagnosticsHint")}</p>
      {doctor.data && (
        <div>
          {doctor.data.checks.map((c) => (
            <div className="list-row" key={c.id}>
              <div className="truncate">
                <span
                  className={`dot ${c.status === "ok" ? "ok" : c.status === "warn" ? "warn" : c.status === "fail" ? "danger" : "dim"}`}
                  style={{ marginRight: 8 }}
                />
                {c.label} <span className="meta mono">{c.status}</span>
                <div className="meta truncate" title={c.detail}>
                  {c.detail}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
