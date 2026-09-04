import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Plus, Search, Sparkles, Star, Upload, Store } from "lucide-react";
import { api, type ProviderId, type Skill } from "../../api";
import { qk, useInvalidate } from "../../queries";
import { useT } from "../../i18n";
import { useToast } from "../../components/ui";
import { Badge, Button, EmptyState, Segmented } from "../../components/primitives";
import { errorMessage } from "../shared";
import NewSkillModal from "./NewSkillModal";
import MarketplaceModal from "./MarketplaceModal";
import ExportModal from "./ExportModal";

type ModeFilter = "all" | "read_only" | "write";
type ProviderFilter = "all" | ProviderId;
const PROVIDERS: ProviderId[] = ["claude", "cursor", "codex"];
const MAX_META_BADGES = 3;

export default function SkillList({ skills }: { skills: Skill[] }) {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidate();
  // `/skills?new=1&prompt=…` (the did-it-twice suggestion) opens the modal pre-filled.
  const [params, setParams] = useSearchParams();
  const [showNew, setShowNew] = useState(() => params.get("new") === "1");
  const initialPrompt = params.get("prompt") ?? undefined;
  const [showExport, setShowExport] = useState(false);
  const [showMarket, setShowMarket] = useState(false);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<ModeFilter>("all");
  const [provider, setProvider] = useState<ProviderFilter>("all");
  const [favOnly, setFavOnly] = useState(false);

  const favorite = useMutation({
    mutationFn: (slug: string) => api.post(`/api/skills/${encodeURIComponent(slug)}/favorite`),
    onSuccess: () => invalidate(qk.skills),
    onError: (err) => toast(errorMessage(err), "danger"),
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skills.filter(
      (s) =>
        (mode === "all" || s.mode === mode) &&
        (provider === "all" || s.providers.includes(provider)) &&
        (!favOnly || s.favorite) &&
        (!q ||
          s.name.toLowerCase().includes(q) ||
          s.slug.includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.triggers.some((tr) => tr.toLowerCase().includes(q))),
    );
  }, [skills, query, mode, provider, favOnly]);

  const hasFilters = query.trim() !== "" || mode !== "all" || provider !== "all" || favOnly;
  const clearFilters = () => {
    setQuery("");
    setMode("all");
    setProvider("all");
    setFavOnly(false);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("skills.title")}</h1>
          <p className="sub">{t("skills.sub")}</p>
        </div>
        <div className="head-actions">
          <Button icon={<Store aria-hidden />} onClick={() => setShowMarket(true)}>
            {t("skills.market.title")}
          </Button>
          <Button icon={<Upload aria-hidden />} onClick={() => setShowExport(true)}>
            {t("skills.export")}
          </Button>
          <Button variant="primary" icon={<Plus aria-hidden />} onClick={() => setShowNew(true)}>
            {t("skills.new")}
          </Button>
        </div>
      </div>

      {skills.length > 0 && (
        <div className="filter-bar" role="search">
          <label className="filter-search">
            <Search aria-hidden />
            <input
              className="input"
              type="search"
              placeholder={t("skills.searchPh")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t("common.search")}
            />
          </label>
          <Segmented<ModeFilter>
            size="sm"
            ariaLabel={t("common.mode")}
            value={mode}
            onChange={setMode}
            options={[
              { value: "all", label: t("brain.all") },
              { value: "read_only", label: t("skills.mode.read_only") },
              { value: "write", label: t("skills.mode.write") },
            ]}
          />
          <Segmented<ProviderFilter>
            size="sm"
            ariaLabel={t("skills.provider")}
            value={provider}
            onChange={setProvider}
            options={[{ value: "all", label: t("brain.all") }, ...PROVIDERS.map((p) => ({ value: p, label: p }))]}
          />
          <Button
            size="sm"
            variant={favOnly ? "outline" : "secondary"}
            icon={<Star aria-hidden fill={favOnly ? "currentColor" : "none"} />}
            aria-pressed={favOnly}
            onClick={() => setFavOnly((v) => !v)}
          >
            {t("skills.favorites")}
          </Button>
          <span className="filter-count" aria-live="polite">
            {t("skills.count", { shown: filtered.length, total: skills.length })}
          </span>
        </div>
      )}

      {skills.length === 0 ? (
        <EmptyState
          icon={<Sparkles aria-hidden />}
          title={t("skills.emptyTitle")}
          body={t("skills.emptyBody")}
          action={
            <Button variant="primary" icon={<Plus aria-hidden />} onClick={() => setShowNew(true)}>
              {t("skills.new")}
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Search aria-hidden />}
          title={t("skills.noMatch")}
          body={t("skills.noMatchBody")}
          action={
            hasFilters ? (
              <Button onClick={clearFilters}>{t("skills.clearFilters")}</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-2">
          {filtered.map((s) => (
            <SkillCard
              key={s.slug}
              skill={s}
              onFavorite={() => favorite.mutate(s.slug)}
              favoriteBusy={favorite.isPending && favorite.variables === s.slug}
            />
          ))}
        </div>
      )}

      {showNew && (
        <NewSkillModal
          initialPrompt={initialPrompt}
          onClose={() => {
            setShowNew(false);
            if (params.has("new")) setParams({});
          }}
          onCreated={() => {
            setShowNew(false);
            if (params.has("new")) setParams({});
          }}
        />
      )}
      {showExport && <ExportModal onClose={() => setShowExport(false)} />}
      {showMarket && <MarketplaceModal onClose={() => setShowMarket(false)} />}
    </div>
  );
}

function SkillCard({ skill: s, onFavorite, favoriteBusy }: { skill: Skill; onFavorite: () => void; favoriteBusy: boolean }) {
  const t = useT();
  const meta: Array<{ key: string; label: string; tone?: "warn" }> = [
    { key: "lines", label: `${s.bodyLineCount} ${t("skills.lines")}` },
    ...s.providers.map((p) => ({ key: `p-${p}`, label: p })),
    ...(s.thick ? [{ key: "thick", label: t("skills.thick"), tone: "warn" as const }] : []),
  ];
  const visible = meta.slice(0, MAX_META_BADGES);
  const rest = meta.slice(MAX_META_BADGES);
  return (
    <article className="card skill-card">
      <div className="skill-card-head">
        <div className="min0">
          <h3>
            <Link to={`/skills/${s.slug}`}>{s.name}</Link>
          </h3>
          <span className="mono skill-slug">/{s.slug}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<Star fill={s.favorite ? "currentColor" : "none"} color={s.favorite ? "var(--warn)" : "currentColor"} aria-hidden />}
          aria-label={`${t("dash.favorites")}: ${s.name}`}
          aria-pressed={!!s.favorite}
          loading={favoriteBusy}
          onClick={onFavorite}
        />
      </div>
      <p className="skill-desc">{s.description.split("\n")[0]}</p>
      <div className="badge-row">
        <Badge kind="state" tone={s.mode === "write" ? "warn" : "info"}>
          {t(s.mode === "write" ? "skills.mode.write" : "skills.mode.read_only")}
        </Badge>
        {!s.enabled && (
          <Badge kind="state" tone="danger">
            {t("common.disabled")}
          </Badge>
        )}
        {visible.map((m) => (
          <Badge key={m.key} kind="meta" tone={m.tone}>
            {m.label}
          </Badge>
        ))}
        {rest.length > 0 && (
          <Badge kind="meta" title={rest.map((m) => m.label).join(" · ")}>
            +{rest.length}
          </Badge>
        )}
      </div>
    </article>
  );
}
