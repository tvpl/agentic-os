/**
 * The brain's search, to pick a note (.specs/features/cerebro-vista-notas, design.md "Abas" and "Home"): "+" of the
 * tabs opens a note with it, and "Definir uma Home" chooses the Home with it. A failed search says so and asks again
 * (AC 48), never showing the hits of an earlier text.
 */
import { useId, useRef, useState, type ReactElement, type RefObject } from "react";
import { FileText } from "lucide-react";
import { useT } from "../../i18n";
import { Popover } from "../../ui";
import { RequestFailed } from "../RequestFailed";
import { useBrainSearch, type BrainHit } from "../memoryData";
import { NatureBadge, NatureSearchFilters, type Natureza } from "../natureza";

export interface NoteSearchProps {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLElement | null>;
  /** The active work context: the hits are its files. */
  context?: string;
  label: string;
  onPick: (hit: BrainHit) => void;
}

export function NoteSearch({ open, onClose, anchor, context, label, onPick }: NoteSearchProps): ReactElement {
  return (
    <Popover open={open} onClose={onClose} anchor={anchor} ariaLabel={label} className="notes-search">
      {open && <NoteSearchBody context={context} label={label} onPick={onPick} />}
    </Popover>
  );
}

function NoteSearchBody({ context, label, onPick }: Pick<NoteSearchProps, "context" | "label" | "onPick">) {
  const t = useT();
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const [natureza, setNatureza] = useState<Natureza[]>([]);
  const search = useBrainSearch(q, 8, context, natureza);
  const list = useId();
  const input = useRef<HTMLInputElement>(null);
  const hits = search.hits;
  const pick = (hit: BrainHit | undefined) => hit && onPick(hit);
  return (
    <div className="notes-search-body">
      <input
        ref={input}
        className="input"
        type="search"
        role="combobox"
        aria-label={label}
        aria-expanded={hits.length > 0}
        aria-controls={list}
        aria-activedescendant={hits[at] ? `${list}-${at}` : undefined}
        placeholder={t("notes.search.label")}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setAt(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setAt((i) => Math.min(hits.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setAt((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(hits[at]);
          }
        }}
      />
      <NatureSearchFilters chosen={natureza} onChange={setNatureza} />
      {search.failed && <RequestFailed message={t("brain.search.failed")} onRetry={search.retry} />}
      <ul className="notes-search-hits" role="listbox" id={list} aria-label={label}>
        {hits.map((hit, i) => (
          <li
            key={hit.id}
            id={`${list}-${i}`}
            role="option"
            aria-selected={i === at}
            className="notes-search-hit"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(hit)}
            onKeyDown={(e) => e.key === "Enter" && pick(hit)}
          >
            <FileText aria-hidden size={14} />
            <span className="notes-search-title">{hit.title ?? hit.name}</span>
            <NatureBadge n={(hit.natureza ?? null) as Natureza | null} dense />
            <span className="notes-search-rel">{hit.rel}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
