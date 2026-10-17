/** Settings › backups (split out of Settings.tsx, refino item 17). */
import { Download } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiCall } from "../../apiCall";

import { useLocale, useT } from "../../i18n";
import { qk, useApiQuery } from "../../queries";
import { Skeleton, formatBytes, timeAgo, useToast } from "../../components/ui";
import { Button, EmptyState } from "../../components/primitives";
import { useConfirm } from "../../hooks/useConfirm";
import type { BackupInfo } from "./shared";

export function BackupsTab() {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const backups = useApiQuery<BackupInfo[]>(qk.backups, "/api/backups");
  const create = useMutation({
    mutationFn: () => apiCall("POST /api/backups", { body: {} }),
    onSuccess: (b) => {
      toast(`${b.name} (${formatBytes(b.sizeBytes)})`, "ok");
      qc.invalidateQueries({ queryKey: qk.backups }).catch(() => undefined);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const restore = useMutation({
    mutationFn: (name: string) => apiCall("POST /api/backups/:name/restore", { params: { name } }),
    onSuccess: (res) => toast(res.message, "info"),
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const onRestore = async (b: BackupInfo) => {
    if (
      await confirm({
        title: `${t("settings.restore")} ${b.name}?`,
        body: t("settings.restoreBody"),
        danger: true,
        confirmLabel: t("settings.restore"),
      })
    )
      restore.mutate(b.name);
  };
  return (
    <div className="card stack">
      <div>
        <Button
          variant="primary"
          icon={<Download aria-hidden />}
          onClick={() => create.mutate()}
          loading={create.isPending}
        >
          {t("settings.newBackup")}
        </Button>
      </div>
      {backups.isPending ? (
        <Skeleton lines={3} />
      ) : (backups.data ?? []).length === 0 ? (
        <EmptyState title={t("settings.noBackups")} body={t("settings.noBackupsBody")} />
      ) : (
        (backups.data ?? []).slice(0, 8).map((b) => (
          <div className="list-row" key={b.name}>
            <div className="truncate">
              <span className="mono small">{b.name}</span>
              <div className="meta">
                {timeAgo(b.createdAt, locale)} · {formatBytes(b.sizeBytes)}
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void onRestore(b)}
              loading={restore.isPending && restore.variables === b.name}
            >
              {t("settings.restore")}
            </Button>
          </div>
        ))
      )}
    </div>
  );
}
