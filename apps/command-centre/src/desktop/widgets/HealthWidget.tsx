/**
 * The system's health (refino item 58): the doctor's checks with the bad
 * ones first, whether a newer version exists, and the one action each
 * needs — run the doctor again, restart the service, open the release.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { RefreshCw, RotateCcw } from "lucide-react";
import { type DoctorReport, type UpdateCheck } from "../../api";
import { apiCall } from "../../apiCall";
import { useLocale, useT } from "../../i18n";
import { qk, useApiQuery } from "../../queries";
import { timeAgo, useToast } from "../../components/ui";
import { WidgetGate } from "./WidgetGate";
import type { WidgetProps } from "../widgetTypes";
import { Tooltip } from "../../ui";

const ORDER = { fail: 0, warn: 1, ok: 2, skip: 3 } as const;

export default function HealthWidget(_props: WidgetProps) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const doctor = useApiQuery<DoctorReport>(qk.doctor, "/api/doctor?audit=0", { refetchInterval: 600_000 });
  const updates = useApiQuery<UpdateCheck>(["updates"], "/api/updates", { refetchInterval: 1_800_000 });
  const [restarting, setRestarting] = useState(false);
  const restart = useMutation({
    mutationFn: () => apiCall("POST /api/system/restart"),
    onSuccess: () => {
      setRestarting(true);
      toast(t("service.restarting"), "info");
      window.setTimeout(() => window.location.reload(), 4000);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const checks = [...(doctor.data?.checks ?? [])].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const status = updates.data?.status;
  const newer = status?.upToDate === false && status.latest;
  return (
    <WidgetGate queries={[doctor]} lines={3}>
      <div className="health">
        <div className="rw">
          <span className="tg o">{doctor.data?.ok ?? 0}</span>
          <span className="tg t">{doctor.data?.warn ?? 0}</span>
          <span className="tg f">{doctor.data?.fail ?? 0}</span>
          <span className="sp" />
          <Tooltip label={t("desktop.health.again")}>
            <button
              type="button"
              className="go icon"
              aria-label={t("desktop.health.again")}
              onClick={() => void doctor.refetch()}
            >
              <RefreshCw aria-hidden />
            </button>
          </Tooltip>
          <Tooltip label={t("desktop.health.restart")}>
            <button
              type="button"
              className="go icon quiet"
              aria-label={t("desktop.health.restart")}
              disabled={restart.isPending || restarting}
              onClick={() => restart.mutate()}
            >
              <RotateCcw aria-hidden />
            </button>
          </Tooltip>
        </div>
        {newer ? (
          <div className="rw health-update">
            <span className="tg t">{t("desktop.health.update")}</span>
            <span className="truncate">
              {updates.data?.current} → {status.latest}
            </span>
            <span className="sp" />
            <a className="go" href={status.url} target="_blank" rel="noreferrer noopener">
              {t("desktop.health.release")}
            </a>
          </div>
        ) : (
          <p className="dm-note">
            {t("desktop.health.version", { v: updates.data?.current ?? "—" })}
            {status?.checkedAt
              ? ` · ${t("desktop.health.checked", { ago: timeAgo(status.checkedAt, locale) })}`
              : ""}
          </p>
        )}
        {checks.slice(0, 8).map((c) => (
          <div key={c.id} className={`rw health-check ${c.status}`}>
            <span className={`tg ${c.status === "fail" ? "f" : c.status === "warn" ? "t" : "o"}`}>
              {c.status}
            </span>
            <span className="truncate" title={c.detail}>
              {c.label}
            </span>
          </div>
        ))}
      </div>
    </WidgetGate>
  );
}
