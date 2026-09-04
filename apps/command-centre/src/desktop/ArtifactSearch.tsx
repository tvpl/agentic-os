/**
 * Search mode over the artifact ring (analysis item 55). The magnifier (or
 * `/` while the desktop has focus) fades the widgets, greys the chips and
 * puts a single centred field on the core; only matching chips keep their
 * ring. Clicking one opens the detail modal — title, first lines, path and
 * open / reveal / close — while the desktop behind it is pushed back.
 */
import { useEffect, useRef, useState } from "react";
import { ExternalLink, FolderOpen, Search, X } from "lucide-react";
import { api, artifactRawUrl, isRawViewable, type MemoryPreview } from "../api";
import { useLocale, useT } from "../i18n";
import { Button } from "../components/primitives";
import { Modal, useToast } from "../components/ui";
import type { RingChip } from "./ringChips";

export interface SearchBarProps {
  query: string;
  matches: number;
  onQuery: (q: string) => void;
  onClose: () => void;
}

/** The centred field: the term is shown in caps, with the match count under it. */
export function SearchBar({ query, matches, onQuery, onClose }: SearchBarProps) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="art-search enter-fade-up" role="search">
      <div className="art-search-field">
        <Search aria-hidden />
        <input
          ref={ref}
          type="search"
          className="art-search-input"
          value={query}
          placeholder={t("desktop.search.placeholder")}
          aria-label={t("desktop.search.placeholder")}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
        />
        <button
          type="button"
          className="btn ghost sm icon-only"
          onClick={onClose}
          aria-label={t("common.close")}
        >
          <X aria-hidden />
        </button>
      </div>
      <div className="art-search-meta">
        <span className="hud-label accent">
          {matches === 0
            ? t("desktop.search.none")
            : matches === 1
              ? t("desktop.search.match")
              : t("desktop.search.matches", { n: matches })}
        </span>
        <span className="hud-label">{t("desktop.search.exit")}</span>
      </div>
    </div>
  );
}

const PREVIEW_LINES = 6;

export function ArtifactModal({
  chip,
  onClose,
  onOpenRun,
}: {
  chip: RingChip;
  onClose: () => void;
  onOpenRun: (runId: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<MemoryPreview>(`/api/memory/preview?p=${encodeURIComponent(chip.path)}`)
      .then((res) => {
        if (!alive) return;
        const text =
          res.kind === "text" && res.content
            ? res.content
                .split(/\r?\n/)
                .filter((l) => l.trim())
                .slice(0, PREVIEW_LINES)
                .join("\n")
            : "";
        setPreview(text || null);
      })
      .catch(() => alive && setPreview(null));
    return () => {
      alive = false;
    };
  }, [chip.path]);

  const folder = chip.path.slice(0, Math.max(chip.path.lastIndexOf("/"), chip.path.lastIndexOf("\\")));
  const viewable = isRawViewable(chip.label);

  const reveal = () => {
    void navigator.clipboard?.writeText(folder).catch(() => undefined);
    toast(t("desktop.search.revealed", { path: folder }), "ok");
  };

  return (
    <Modal title={chip.title} onClose={onClose} className="art-modal" narrow>
      <p className="modal-intro">
        {chip.skillSlug ? `/${chip.skillSlug} · ` : ""}
        {new Date(chip.ts).toLocaleString(locale, {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>
      {viewable ? (
        <img className="art-modal-thumb" src={artifactRawUrl(chip.path)} alt={chip.title} loading="lazy" />
      ) : (
        <pre className="art-modal-preview mono">{preview ?? t("desktop.search.noPreview")}</pre>
      )}
      <p className="art-modal-path mono" title={chip.path}>
        {chip.path}
      </p>
      <div className="head-actions">
        {viewable ? (
          <a className="btn sm primary" href={artifactRawUrl(chip.path)} target="_blank" rel="noreferrer">
            <ExternalLink aria-hidden /> {t("desktop.search.openFile")}
          </a>
        ) : chip.runId ? (
          <Button
            size="sm"
            variant="primary"
            icon={<ExternalLink aria-hidden />}
            onClick={() => onOpenRun(chip.runId!)}
          >
            {t("desktop.search.openRun")}
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" icon={<FolderOpen aria-hidden />} onClick={reveal}>
          {t("desktop.search.reveal")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
    </Modal>
  );
}
