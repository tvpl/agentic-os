/**
 * "The service you are looking at is not the one you installed": a banner at
 * the top of the shell when the build on disk is newer than the running
 * process, or when leftover service processes are still alive. Each case has
 * one explicit action (restart / stop the leftovers) and can be dismissed for
 * the session; nothing is killed without the click.
 */
import { useEffect, useState } from "react";
import { RefreshCw, Skull, X } from "lucide-react";
import { apiUrl, type SystemInfo } from "../api";
import { apiCall } from "../apiCall";
import { useT } from "../i18n";
import { useApiQuery } from "../queries";
import { Button } from "./primitives";
import { useToast } from "./ui";
import { Tooltip } from "../ui";

const DISMISS_KEY = "mordomo.serviceBanner.dismissed";

export default function ServiceHealthBanner({ name }: { name: string }) {
  const t = useT();
  const toast = useToast();
  const info = useApiQuery<SystemInfo>(["system", "info"], "/api/system/info", {
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: false,
  });
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY);
    } catch {
      return null;
    }
  });
  const [restarting, setRestarting] = useState(false);
  const [busy, setBusy] = useState(false);

  // Once a restart is requested, wait for the service to come back and reload.
  useEffect(() => {
    if (!restarting) return;
    let alive = true;
    let gone = false;
    const probe = async () => {
      try {
        // A raw GET on purpose: no token, no timeout, no error envelope while the service restarts.
        // eslint-disable-next-line no-restricted-globals
        const res = await fetch(apiUrl("/api/meta"), { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const meta = (await res.json()) as { build?: { startedAt?: number } };
        // Reload only after a *new* process answers (its startedAt moved) or the old one was seen down.
        const restarted = gone || (meta.build?.startedAt ?? 0) > (info.data?.startedAt ?? 0);
        if (restarted && alive) window.location.reload();
      } catch {
        gone = true;
      }
    };
    const id = window.setInterval(() => void probe(), 1200);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [restarting, info.data?.startedAt]);

  const data = info.data;
  const stale = Boolean(data?.build?.stale);
  const siblings = data?.siblings ?? [];
  const signature = `${data?.startedAt ?? 0}:${stale ? "s" : ""}:${siblings.map((s) => s.pid).join(",")}`;
  if (!data || (!stale && siblings.length === 0) || dismissed === signature) return null;

  const dismiss = () => {
    setDismissed(signature);
    try {
      sessionStorage.setItem(DISMISS_KEY, signature);
    } catch {
      /* ignore */
    }
  };
  const restart = async () => {
    setBusy(true);
    try {
      await apiCall("POST /api/system/restart");
      setRestarting(true);
    } catch (err) {
      toast((err as Error).message, "danger");
      setBusy(false);
    }
  };
  const reap = async () => {
    setBusy(true);
    try {
      const res = await apiCall("POST /api/system/reap");
      toast(t("service.reaped", { n: res.stopped.length }), "ok");
      await info.refetch();
    } catch (err) {
      toast((err as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="service-banner" role="alert" data-testid="service-banner">
      <div className="service-banner-text">
        {stale ? (
          <>
            <strong>{t("service.staleTitle", { name })}</strong>
            <span>{restarting ? t("service.restarting") : t("service.staleBody")}</span>
          </>
        ) : (
          <>
            <strong>{t("service.siblingsTitle", { n: siblings.length })}</strong>
            <span>{t("service.siblingsBody", { pids: siblings.map((s) => s.pid).join(", ") })}</span>
          </>
        )}
      </div>
      <div className="service-banner-actions">
        {stale && (
          <Button
            size="sm"
            variant="primary"
            icon={<RefreshCw aria-hidden />}
            loading={busy || restarting}
            onClick={() => void restart()}
          >
            {t("service.restart")}
          </Button>
        )}
        {siblings.length > 0 && !restarting && (
          <Button
            size="sm"
            variant="secondary"
            icon={<Skull aria-hidden />}
            loading={busy}
            onClick={() => void reap()}
          >
            {t("service.reap")}
          </Button>
        )}
        {!restarting && (
          <Tooltip label={t("service.later")}>
            <button type="button" className="os-tool" aria-label={t("service.later")} onClick={dismiss}>
              <X aria-hidden />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
