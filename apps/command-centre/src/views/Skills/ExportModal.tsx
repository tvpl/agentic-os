import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../api";
import { useT } from "../../i18n";
import { Modal, useToast } from "../../components/ui";
import { Badge, Button, Field, type BadgeTone } from "../../components/primitives";
import { errorMessage } from "../shared";

interface SyncPlanResp {
  targetDir: string;
  actions: Array<{ filePath: string; kind: string; reason: string; diff: string | null }>;
  conflicts: number;
}

const KIND_TONE: Record<string, BadgeTone> = { conflict: "danger", unchanged: "dim", create: "ok", update: "info" };

export default function ExportModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const [target, setTarget] = useState("");
  const [plan, setPlan] = useState<SyncPlanResp | null>(null);
  const [approved, setApproved] = useState<string[]>([]);

  const preview = useMutation({
    mutationFn: () => api.get<SyncPlanResp>(`/api/sync/plan${target.trim() ? `?target=${encodeURIComponent(target.trim())}` : ""}`),
    onSuccess: (p) => {
      setPlan(p);
      setApproved([]);
    },
    onError: (err) => toast(errorMessage(err), "danger"),
  });

  const apply = useMutation({
    mutationFn: () =>
      api.post<{ written: string[]; skippedConflicts: string[]; backupDir: string | null }>("/api/sync/apply", {
        target: target.trim() || undefined,
        approvedConflicts: approved,
      }),
    onSuccess: (res) => {
      toast(`${t("skills.written", { n: res.written.length })}${res.backupDir ? ` ${t("skills.backupCreated")}` : ""}`, "ok");
      preview.mutate();
    },
    onError: (err) => toast(errorMessage(err), "danger"),
  });

  const busy = preview.isPending || apply.isPending;

  return (
    <Modal title={t("skills.export")} onClose={onClose}>
      <p className="modal-intro">{t("skills.exportHint")}</p>
      <Field label={t("settings.syncTarget")} htmlFor="ex-target" hint={t("skills.exportTargetHint")}>
        <input id="ex-target" className="input mono" placeholder={t("skills.exportTargetPh")} value={target} onChange={(e) => setTarget(e.target.value)} />
      </Field>
      <div className="row-actions">
        <Button loading={preview.isPending} disabled={busy} onClick={() => preview.mutate()}>
          {t("settings.syncPlan")}
        </Button>
        {plan && (
          <Button variant="primary" loading={apply.isPending} disabled={busy} onClick={() => apply.mutate()}>
            {t("settings.syncApply")}
          </Button>
        )}
      </div>
      {plan && (
        <div className="stack-sm">
          <p className="hint">
            <span className="mono">{plan.targetDir}</span> · {t("skills.planSummary", { n: plan.actions.length, conflicts: plan.conflicts })}
          </p>
          <p className="hint">{t("settings.conflicts")}</p>
          <div className="table-scroll scroll-y-300">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("table.status")}</th>
                  <th>{t("skills.file")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {plan.actions.map((a) => (
                  <tr key={a.filePath}>
                    <td>
                      <Badge kind="state" tone={KIND_TONE[a.kind] ?? "dim"}>
                        {a.kind}
                      </Badge>
                    </td>
                    <td className="mono break-all small">{a.filePath}</td>
                    <td>
                      {a.kind === "conflict" && (
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={approved.includes(a.filePath)}
                            onChange={(e) => setApproved(e.target.checked ? [...approved, a.filePath] : approved.filter((f) => f !== a.filePath))}
                          />
                          {t("skills.overwrite")}
                        </label>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
