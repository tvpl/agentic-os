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
import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useT } from "../i18n";
/** One search result: whatever the modal and the list need, nothing more. */
export type HitKind = "artifact" | "file" | "run" | "skill" | "notification";

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
  /** Which group the hit belongs to (refino item 52); artifacts when absent. */
  kind?: HitKind;
  /** A memory node id, for flying to it in the brain (⌥↵). */
  nodeId?: number;
}

const KIND_ORDER: HitKind[] = ["artifact", "file", "run", "skill", "notification"];
const KIND_KEY: Record<
  HitKind,
  | "desktop.search.group.artifact"
  | "desktop.search.group.file"
  | "desktop.search.group.run"
  | "desktop.search.group.skill"
  | "desktop.search.group.notification"
> = {
  artifact: "desktop.search.group.artifact",
  file: "desktop.search.group.file",
  run: "desktop.search.group.run",
  skill: "desktop.search.group.skill",
  notification: "desktop.search.group.notification",
};

export interface SearchBarProps {
  query: string;
  matches: number;
  /** The matches themselves: without the ring there is nowhere else to show them. */
  hits: readonly ArtifactHit[];
  onQuery: (q: string) => void;
  onPick: (hit: ArtifactHit) => void;
  /** ⌥↵ or the arrow: fly to the hit in the Second Brain. */
  onFly?: (hit: ArtifactHit) => void;
  onClose: () => void;
}

/** The centred field: the term is shown in caps, with the match count under it. */
export function SearchBar({ query, matches, hits, onQuery, onPick, onFly, onClose }: SearchBarProps) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [query, hits.length]);
  const groups = KIND_ORDER.map((kind) => ({
    kind,
    hits: hits.filter((h) => (h.kind ?? "artifact") === kind),
  })).filter((g) => g.hits.length > 0);
  const ordered = groups.flatMap((g) => g.hits);
  const current = ordered[selected];
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
              return;
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const n = ordered.length;
              if (n) setSelected((i) => (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
              return;
            }
            if (e.key === "Enter" && current) {
              e.preventDefault();
              if (e.altKey && onFly) onFly(current);
              else onPick(current);
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
      {groups.length > 0 && (
        <div className="art-search-groups" role="listbox" aria-label={t("desktop.search.placeholder")}>
          {groups.map((g) => (
            <div key={g.kind} className="art-search-group">
              <span className="hud-label art-group-label">{t(KIND_KEY[g.kind])}</span>
              <ul className="art-search-hits">
                {g.hits.map((hit) => (
                  <li key={hit.key}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={current?.key === hit.key}
                      className={`art-hit${current?.key === hit.key ? " on" : ""}`}
                      onMouseEnter={() => setSelected(ordered.indexOf(hit))}
                      onClick={() => onPick(hit)}
                    >
                      <span className="art-hit-title">{hit.title}</span>
                      <span className="art-hit-path">{hit.path}</span>
                    </button>
                    {onFly && (hit.kind === "file" || hit.kind === "artifact") && (
                      <button
                        type="button"
                        className="art-hit-fly"
                        title={t("desktop.search.fly")}
                        aria-label={t("desktop.search.fly")}
                        onClick={() => onFly(hit)}
                      >
                        ✦
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
