/**
 * Artifact search (analysis item 55). The magnifier — or `/` while the
 * desktop has focus — fades the windows and puts a single centred field over
 * the stage with its results under it. Choosing one opens the detail modal:
 * title, first lines, path and open / reveal / close, with the desktop
 * pushed back behind it.
 *
 * It used to highlight matching chips on the orbital ring; the ring is gone
 * (redesign F4b), so the matches are a list you can actually read.
 */
import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { useT } from "../i18n";
/** One search result: whatever the modal and the list need, nothing more. */
export interface ArtifactHit {
  key: string;
  /** Base file name. */
  label: string;
  /** Human title (markdown heading / html title / file name). */
  title: string;
  path: string;
  runId: string | null;
  skillSlug: string | null;
  ts: number;
}

export interface SearchBarProps {
  query: string;
  matches: number;
  /** The matches themselves: without the ring there is nowhere else to show them. */
  hits: readonly ArtifactHit[];
  onQuery: (q: string) => void;
  onPick: (hit: ArtifactHit) => void;
  onClose: () => void;
}

/** The centred field: the term is shown in caps, with the match count under it. */
export function SearchBar({ query, matches, hits, onQuery, onPick, onClose }: SearchBarProps) {
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
      {hits.length > 0 && (
        <ul className="art-search-hits" aria-label={t("desktop.search.placeholder")}>
          {hits.map((hit) => (
            <li key={hit.key}>
              <button type="button" className="art-hit" onClick={() => onPick(hit)}>
                <span className="art-hit-title">{hit.title}</span>
                <span className="art-hit-path">{hit.path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
