/**
 * Marketplace (plan Onda 3 §6): skills offered by the configured registries,
 * installed after every file's digest is verified server-side. Registries
 * are plain https index URLs kept in Settings › Memory & folders.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, RefreshCw } from "lucide-react";
import { api } from "../../api";
import { qk, useApiQuery, useInvalidate } from "../../queries";
import { useT } from "../../i18n";
import { Modal, useToast } from "../../components/ui";
import { Button, EmptyState } from "../../components/primitives";
import { errorMessage } from "../shared";

interface RegistrySkillRow {
  slug: string;
  name: string;
  description: string;
  version: string;
  files: string[];
  author?: string;
  homepage?: string;
  registry: string;
  registryName: string;
  installed: boolean;
}
interface RegistryResponse {
  registries: string[];
  errors: Array<{ registry: string; error: string }>;
  skills: RegistrySkillRow[];
}

export default function MarketplaceModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [q, setQ] = useState("");
  const catalog = useApiQuery<RegistryResponse>(qk.skillRegistry, "/api/skills/registry", { staleTime: 60_000, retry: false });
  const qc = useQueryClient();
  // Refresh bypasses the server-side index cache, not only the client one.
  const refresh = useMutation({
    mutationFn: () => api.get<RegistryResponse>("/api/skills/registry?refresh=1"),
    onSuccess: (data) => qc.setQueryData(qk.skillRegistry, data),
  });
  const install = useMutation({
    mutationFn: (row: RegistrySkillRow) => api.post("/api/skills/install", { slug: row.slug, registry: row.registry, force: row.installed }),
    onSuccess: async (_r, row) => {
      toast(t("skills.market.installed", { name: row.name }), "ok");
      await invalidate(qk.skills);
      await catalog.refetch();
    },
    onError: (err) => toast(errorMessage(err), "danger"),
  });
  const rows = (catalog.data?.skills ?? []).filter((s) => {
    const needle = q.trim().toLowerCase();
    return !needle || `${s.slug} ${s.name} ${s.description}`.toLowerCase().includes(needle);
  });
  return (
    <Modal title={t("skills.market.title")} onClose={onClose}>
      <div className="market">
        <div className="market-head">
          <input className="input" value={q} placeholder={t("skills.market.search")} aria-label={t("skills.market.search")} onChange={(e) => setQ(e.target.value)} />
          <Button size="sm" variant="ghost" icon={<RefreshCw aria-hidden />} loading={catalog.isFetching || refresh.isPending} onClick={() => refresh.mutate()}>
            {t("skills.market.refresh")}
          </Button>
        </div>
        {catalog.data && catalog.data.registries.length === 0 && (
          <EmptyState title={t("skills.market.noRegistry")} body={t("skills.market.noRegistryBody")} action={<Link to="/settings?tab=memory" className="btn sm primary">{t("nav.settings")}</Link>} />
        )}
        {catalog.data?.errors.map((e) => (
          <p key={e.registry} className="hint warn">
            {e.registry}: {e.error}
          </p>
        ))}
        {rows.length > 0 && (
          <ul className="plain-list market-list">
            {rows.map((s) => (
              <li key={`${s.registry}:${s.slug}`}>
                <div className="min0">
                  <strong>
                    {s.name} <span className="mono meta">/{s.slug} · v{s.version}</span>
                  </strong>
                  <p className="hint">{s.description}</p>
                  <span className="meta">
                    {s.registryName}
                    {s.author ? ` · ${s.author}` : ""} · {t("skills.market.files", { n: s.files.length })}
                  </span>
                </div>
                <Button size="sm" variant={s.installed ? "outline" : "primary"} icon={<Download aria-hidden />} loading={install.isPending && install.variables?.slug === s.slug} onClick={() => install.mutate(s)}>
                  {s.installed ? t("skills.market.reinstall") : t("skills.market.install")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {catalog.data && catalog.data.registries.length > 0 && rows.length === 0 && !catalog.isFetching && <p className="hint">{t("skills.market.empty")}</p>}
      </div>
    </Modal>
  );
}
