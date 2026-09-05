/**
 * Artifacts gallery (analysis item 25): everything under `artifacts/` with
 * thumbnails, filters (kind, skill, age), free-text search over titles and
 * file names, and a lightbox with copy-path / open-run.
 *
 * `ArtifactGallery` is the reusable body; the Generations micro-app renders
 * the same grid restricted to images and video.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FileCode,
  FileText,
  Globe,
  Images,
  Search,
} from "lucide-react";
import { api, artifactRawUrl, type ArtifactKind, type ArtifactListItem } from "../api";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useT, type TKey } from "../i18n";
import { Button, EmptyState, Segmented } from "../components/primitives";
import { Modal, Skeleton, formatBytes, useToast } from "../components/ui";
import { useArtifactList } from "../desktop/data";

const KINDS = ["all", "image", "video", "html", "markdown", "code", "other"] as const;
type KindFilter = (typeof KINDS)[number];
const KIND_LABEL: Record<Exclude<KindFilter, "all">, TKey> = {
  image: "desktop.artifacts.kindImage",
  video: "desktop.artifacts.kindVideo",
  html: "desktop.artifacts.kindHtml",
  markdown: "desktop.artifacts.kindMarkdown",
  code: "desktop.artifacts.kindCode",
  other: "desktop.artifacts.kindOther",
};

const SINCE = [
  { value: "all", labelKey: "desktop.artifacts.all" as TKey, ms: 0 },
  { value: "24h", labelKey: "desktop.artifacts.since24h" as TKey, ms: 86_400_000 },
  { value: "7d", labelKey: "desktop.artifacts.since7d" as TKey, ms: 7 * 86_400_000 },
  { value: "30d", labelKey: "desktop.artifacts.since30d" as TKey, ms: 30 * 86_400_000 },
];

export function ArtifactThumb({ item }: { item: ArtifactListItem }) {
  if (item.thumbnail && item.kind === "image")
    return <img src={artifactRawUrl(item.path)} alt={item.title} loading="lazy" />;
  if (item.thumbnail && item.kind === "video")
    return (
      <video src={artifactRawUrl(item.path)} muted playsInline preload="metadata" aria-label={item.title}>
        <track kind="captions" />
      </video>
    );
  if (item.kind === "html") return <Globe aria-hidden />;
  if (item.kind === "code") return <FileCode aria-hidden />;
  if (item.kind === "markdown" || item.kind === "other") return <TextPeek item={item} />;
  return <FileText aria-hidden />;
}

const PEEK_LINES = 9;
const PEEK_MAX_BYTES = 256 * 1024;

/**
 * First lines of a text artifact as the thumbnail (plan Onda 0): a markdown
 * digest is recognisable at a glance instead of a generic file glyph. Only
 * small files are fetched; anything else keeps the glyph.
 */
function TextPeek({ item }: { item: ArtifactListItem }) {
  const small = item.sizeBytes > 0 && item.sizeBytes <= PEEK_MAX_BYTES;
  const file = useQuery({
    queryKey: ["artifact", "peek", item.path],
    queryFn: ({ signal }) =>
      api.get<{ content: string | null }>(`/api/artifacts/file?p=${encodeURIComponent(item.path)}`, {
        signal,
      }),
    enabled: small,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const text = file.data?.content;
  if (!small || !text) return <FileText aria-hidden />;
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^#+\s*/, "").trimEnd())
    .filter((l) => l.length > 0)
    .slice(0, PEEK_LINES);
  return (
    <span className="art-peek" aria-hidden>
      {lines.map((l, i) => (
        <span key={i} className={i === 0 ? "head" : undefined}>
          {l}
        </span>
      ))}
    </span>
  );
}

export interface ArtifactGalleryProps {
  /** Restrict the whole view to these kinds (Generations: image + video). */
  only?: ArtifactKind[];
  emptyTitle: string;
  emptyBody: string;
}

export function ArtifactGallery({ only, emptyTitle, emptyBody }: ArtifactGalleryProps) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [skill, setSkill] = useState("all");
  const [since, setSince] = useState("all");
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const sinceMs = SINCE.find((s) => s.value === since)?.ms ?? 0;
  const list = useArtifactList({ limit: 400, ...(sinceMs > 0 ? { since: Date.now() - sinceMs } : {}) });

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (list.data?.items ?? []).filter((i) => {
      if (only && !only.includes(i.kind)) return false;
      if (kind !== "all" && i.kind !== kind) return false;
      if (skill !== "all" && i.skillSlug !== skill) return false;
      if (needle && !`${i.title} ${i.file} ${i.skillSlug ?? ""} ${i.folder}`.toLowerCase().includes(needle))
        return false;
      return true;
    });
  }, [list.data, only, kind, skill, q]);

  const open = openIndex !== null ? items[openIndex] : undefined;
  const copyPath = (path: string) => {
    void navigator.clipboard?.writeText(path).catch(() => undefined);
    toast(t("common.copied"), "ok");
  };

  if (list.isPending && !list.data) return <Skeleton page lines={6} />;

  return (
    <>
      <div className="art-filters" role="group" aria-label={t("common.search")}>
        <label className="visually-hidden" htmlFor="art-q">
          {t("desktop.artifacts.search")}
        </label>
        <span className="input-with-icon">
          <Search aria-hidden />
          <input
            id="art-q"
            className="input sm"
            type="search"
            value={q}
            placeholder={t("desktop.artifacts.search")}
            onChange={(e) => setQ(e.target.value)}
          />
        </span>
        {!only && (
          <select
            className="input sm"
            value={kind}
            onChange={(e) => setKind(e.target.value as KindFilter)}
            aria-label={t("desktop.artifacts.kind")}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k === "all" ? t("desktop.artifacts.all") : t(KIND_LABEL[k])}
              </option>
            ))}
          </select>
        )}
        <select
          className="input sm"
          value={skill}
          onChange={(e) => setSkill(e.target.value)}
          aria-label={t("desktop.artifacts.skill")}
        >
          <option value="all">{t("desktop.artifacts.all")}</option>
          {(list.data?.skills ?? []).map((s) => (
            <option key={s} value={s}>
              /{s}
            </option>
          ))}
        </select>
        <Segmented
          size="sm"
          ariaLabel={t("desktop.artifacts.since")}
          value={since}
          onChange={setSince}
          options={SINCE.map((s) => ({ value: s.value, label: t(s.labelKey) }))}
        />
        <span className="filter-count">
          {t("desktop.artifacts.count", { n: items.length, total: list.data?.total ?? items.length })}
        </span>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<Images aria-hidden />}
          title={(list.data?.total ?? 0) === 0 ? emptyTitle : t("desktop.artifacts.noMatch")}
          body={(list.data?.total ?? 0) === 0 ? emptyBody : ""}
        />
      ) : (
        <div className="art-grid">
          {items.map((item, i) => (
            <button key={item.id} type="button" className="art-card" onClick={() => setOpenIndex(i)}>
              <span className="art-thumb">
                <ArtifactThumb item={item} />
              </span>
              <span className="art-info">
                <span className="art-name truncate" title={item.title}>
                  {item.title}
                </span>
                <span className="art-sub truncate">
                  {item.skillSlug ? `/${item.skillSlug} · ` : ""}
                  {new Date(item.createdAt).toLocaleDateString(locale, {
                    day: "2-digit",
                    month: "short",
                  })}{" "}
                  · {formatBytes(item.sizeBytes)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {open && openIndex !== null && (
        <Modal title={open.title} onClose={() => setOpenIndex(null)}>
          <div className="art-lightbox">
            {open.thumbnail && open.kind === "image" && (
              <img src={artifactRawUrl(open.path)} alt={open.title} />
            )}
            {open.thumbnail && open.kind === "video" && (
              <video src={artifactRawUrl(open.path)} controls aria-label={open.title}>
                <track kind="captions" />
              </video>
            )}
            <p className="art-modal-path mono">{open.path}</p>
            <div className="art-lightbox-nav">
              <Button
                size="sm"
                variant="ghost"
                icon={<ChevronLeft aria-hidden />}
                disabled={openIndex === 0}
                onClick={() => setOpenIndex(openIndex - 1)}
              >
                {t("desktop.artifacts.prev")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<Copy aria-hidden />}
                onClick={() => copyPath(open.path)}
              >
                {t("desktop.artifacts.copyPath")}
              </Button>
              {open.thumbnail && (
                <a
                  className="btn sm outline-accent"
                  href={artifactRawUrl(open.path)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink aria-hidden /> {t("common.open")}
                </a>
              )}
              {open.runId && (
                <Link className="btn sm outline-accent" to={`/runs/${open.runId}`}>
                  {t("desktop.search.openRun")}
                </Link>
              )}
              <Button
                size="sm"
                variant="ghost"
                icon={<ChevronRight aria-hidden />}
                disabled={openIndex >= items.length - 1}
                onClick={() => setOpenIndex(openIndex + 1)}
              >
                {t("desktop.artifacts.next")}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function Artifacts() {
  const t = useT();
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("desktop.artifacts.title")}</h1>
          <p className="sub">{t("desktop.artifacts.sub")}</p>
        </div>
      </div>
      <ArtifactGallery
        emptyTitle={t("desktop.artifacts.empty")}
        emptyBody={t("desktop.artifacts.emptyBody")}
      />
    </div>
  );
}
