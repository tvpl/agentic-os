/**
 * The reader (Brain scene, immersive shell): where a note is read and
 * understood. The note in book typography (a measured column, real headings,
 * lists, code, quotes; every reference to another note is a synapse you can
 * travel through), its outline to jump through, how far you have read, the
 * key terms that light up the notes sharing them, and a context rail: who
 * cites it, what it cites, what resembles it, what lives next to it and what
 * is close without being linked — each with its icon and a line of its text.
 *
 * The sky stays alive beside it (the note's synapses are the space there),
 * so reading and navigating are one gesture. The actions are the Second
 * Brain's: reference it in the voice line, ask for a summary or an
 * explanation, project it as a lâmina, copy the path, open the editor.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { Markdown } from "../../components/Markdown";
import { formatBytes, timeAgo } from "../../components/ui";
import { useT, type TKey } from "../../i18n";
import type { FileNode } from "../../brain/engine/world";
import {
  collectReferences,
  inlineText,
  parseMarkdown,
  resolveReference,
  type Block,
} from "../../brain/markdown";
import { BrainGlyph } from "./BrainGlyph";
import type { ContentKind } from "./brainGlyphs";
import { starLabel } from "./brainModel";
import { outlineOf, readingMinutes, stripFrontmatter, type RelationKind } from "./brainReading";

export interface SheetPreview {
  node: FileNode;
  content: string | null;
  kind: string;
  message: string | null;
}

export interface RailEntry {
  index: number;
  id: number;
  label: string;
  kind: ContentKind;
  group: string;
  /** A line of its text, else why it is related. */
  line: string;
}

export interface RailGroup {
  relation: RelationKind;
  entries: RailEntry[];
}

const MD_EXT = new Set([".md", ".markdown", ".mdx", ".mdown"]);
const REL_KEYS: Record<RelationKind, TKey> = {
  backlink: "scene.brain.rel.backlink",
  outgoing: "scene.brain.rel.outgoing",
  similar: "scene.brain.rel.similar",
  sibling: "scene.brain.rel.sibling",
  other: "scene.brain.rel.other",
};
const REL_MARK: Record<RelationKind, string> = {
  backlink: "←",
  outgoing: "→",
  similar: "≈",
  sibling: "∥",
  other: "·",
};
const ENTRIES_SHOWN = 8;

export interface BrainSceneReaderProps {
  preview: SheetPreview;
  kind: ContentKind;
  kindLabel: string;
  group: string;
  degree: number;
  files: FileNode[];
  skills: ReadonlySet<string>;
  lang: string;
  caption?: string | null;
  /** The trail, when the reader has room for it (narrow screens). */
  trail?: ReactNode;
  context: RailGroup[];
  nearby: RailEntry[];
  terms: Array<{ term: string; n: number }>;
  pinned: ReadonlySet<string>;
  kindOfId: (id: number) => ContentKind | null;
  sheetRef?: Ref<HTMLElement>;
  onTermHover: (term: string | null) => void;
  onTermPin: (term: string) => void;
  onClose: () => void;
  onNote: (id: number) => void;
  onPeek: (id: number | null) => void;
  onProgress: (p: number) => void;
  onSkill: (slug: string) => void;
  onLamina: () => void;
  onReference: (ask?: string) => void;
  onCopy: () => void;
  onEditor: () => void;
  onDangling: (refs: string[]) => void;
}

export const BrainSceneReader = memo(function BrainSceneReader(p: BrainSceneReaderProps) {
  const t = useT();
  const { node } = p.preview;
  const bodyRef = useRef<HTMLDivElement>(null);
  const title = starLabel(node, 140);
  const body = useMemo(
    () => (p.preview.content ? stripFrontmatter(p.preview.content).body : null),
    [p.preview.content],
  );
  const blocks = useMemo<Block[] | null>(() => {
    if (!MD_EXT.has(node.ext.toLowerCase()) || p.preview.kind !== "text" || body === null) return null;
    const parsed = parseMarkdown(body);
    // The reader already says the title: a first heading that repeats it goes.
    const first = parsed[0];
    const same = (a: string) => a.trim().toLowerCase() === (node.title ?? title).trim().toLowerCase();
    return first?.type === "heading" && same(inlineText(first.children)) ? parsed.slice(1) : parsed;
  }, [node.ext, node.title, title, p.preview.kind, body]);
  const outline = useMemo(() => (blocks ? outlineOf(blocks) : []), [blocks]);
  const headingIds = useMemo(() => new Map(outline.map((o) => [o.block, o.id])), [outline]);
  const minutes = body ? readingMinutes(body) : null;
  const resolve = useMemo(() => {
    const cache = new Map<string, number | null>();
    return (ref: string): number | null => {
      let v = cache.get(ref);
      if (v === undefined) {
        v = resolveReference(ref, p.files);
        cache.set(ref, v);
      }
      return v;
    };
  }, [p.files]);
  const { onDangling, onProgress } = p;
  useEffect(() => {
    onDangling(blocks ? collectReferences(blocks).filter((ref) => resolve(ref) === null) : []);
  }, [blocks, resolve, onDangling]);

  /* ---- reading progress + where in the outline you are ---- */
  // Wide, the text column scrolls on its own beside the rail; narrow, the whole body scrolls.
  const textRef = useRef<HTMLDivElement>(null);
  const scroller = useCallback((): HTMLElement | null => {
    const text = textRef.current;
    if (text && text.scrollHeight > text.clientHeight + 2) return text;
    return bodyRef.current;
  }, []);
  const [active, setActive] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const measure = useCallback(() => {
    const el = scroller();
    const text = textRef.current;
    if (!el || !text) return;
    const box = el.getBoundingClientRect();
    const tb = text.getBoundingClientRect();
    // Progress through the text itself (the rail below it, narrow, does not count).
    const start = el === text ? 0 : tb.top - box.top + el.scrollTop;
    const room = start + text.scrollHeight - el.clientHeight;
    const pr = room <= 4 ? 1 : Math.min(1, Math.max(0, el.scrollTop / room));
    setProgress(pr);
    onProgress(pr);
    let cur: string | null = null;
    for (const o of outline) {
      const h = text.querySelector<HTMLElement>(`#${CSS.escape(o.id)}`);
      if (h && h.getBoundingClientRect().top - box.top <= 96) cur = o.id;
    }
    setActive(cur ?? outline[0]?.id ?? null);
  }, [outline, onProgress, scroller]);
  useEffect(() => {
    const els = [bodyRef.current, textRef.current].filter((x): x is HTMLDivElement => x !== null);
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };
    for (const el of els) el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    for (const el of els) ro.observe(el);
    return () => {
      for (const el of els) el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [measure]);
  // A new note starts at its top.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
    textRef.current?.scrollTo({ top: 0 });
    requestAnimationFrame(measure);
  }, [node.id, blocks, measure]);
  const jump = (id: string) => {
    const el = scroller();
    const h = textRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (!el || !h) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const top = h.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 16;
    el.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
  };

  const readable = !["loading", "blocked", "error"].includes(p.preview.kind);
  const rail = (
    <aside className="bs-rail" aria-label={t("scene.brain.context")}>
      {outline.length >= 2 && (
        <section className="bs-rail-sec">
          <p className="bs-eyebrow">{t("scene.brain.outline")}</p>
          <ol className="bs-outline">
            {outline.map((o) => (
              <li key={o.id} data-level={Math.min(3, o.level)}>
                <button
                  type="button"
                  aria-current={active === o.id ? "location" : undefined}
                  onClick={() => jump(o.id)}
                >
                  {o.text}
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
      <section className="bs-rail-sec">
        <p className="bs-eyebrow">
          {t("scene.brain.context")} <span className="mono">{p.degree}</span>
        </p>
        {p.context.length === 0 && <p className="bs-faint">{t("scene.brain.noLinks")}</p>}
        {p.context.map((g) => (
          <RailList
            key={g.relation}
            title={t(REL_KEYS[g.relation])}
            mark={REL_MARK[g.relation]}
            relation={g.relation}
            entries={g.entries}
            onNote={p.onNote}
            onPeek={p.onPeek}
          />
        ))}
      </section>
      {p.nearby.length > 0 && (
        <section className="bs-rail-sec">
          <RailList
            title={t("scene.brain.nearby")}
            mark="◌"
            relation="nearby"
            entries={p.nearby}
            onNote={p.onNote}
            onPeek={p.onPeek}
          />
        </section>
      )}
    </aside>
  );

  return (
    <article
      ref={p.sheetRef}
      className="bs-sheet bs-reader"
      aria-label={t("scene.brain.sheet")}
      data-note={node.id}
    >
      <div
        className="bs-read-progress"
        role="progressbar"
        aria-label={t("scene.brain.progress", { n: Math.round(progress * 100) })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <i style={{ transform: `scaleX(${progress})` }} />
      </div>
      {p.trail}
      <header className="bs-read-head">
        <p className="bs-eyebrow bs-read-eyebrow">
          <span className="bs-read-kind">
            <BrainGlyph kind={p.kind} size={14} />
            {p.kindLabel}
          </span>
          <span aria-hidden> · </span>
          <span className="bs-eyebrow-area">{p.group}</span>
          <span aria-hidden> · </span>
          {timeAgo(node.mtime, p.lang)}
          {minutes !== null && (
            <>
              <span aria-hidden> · </span>
              {t("scene.brain.minutes", { n: minutes })}
            </>
          )}
        </p>
        <h2 className="bs-sheet-title">{title}</h2>
        <p className="bs-sheet-path mono" title={node.path}>
          {node.rel}
          <span className="bs-sheet-facts">
            {" · "}
            {node.ext || "file"} · {formatBytes(node.size)} · {t("scene.brain.links", { n: p.degree })}
          </span>
        </p>
        {p.terms.length > 0 && (
          <div className="bs-terms" role="group" aria-label={t("scene.brain.terms")}>
            <span className="bs-eyebrow">{t("scene.brain.terms")}</span>
            {p.terms.map((k) => (
              <button
                key={k.term}
                type="button"
                aria-pressed={p.pinned.has(k.term)}
                title={t("scene.brain.termPin", { term: k.term, n: k.n })}
                onMouseEnter={() => p.onTermHover(k.term)}
                onMouseLeave={() => p.onTermHover(null)}
                onFocus={() => p.onTermHover(k.term)}
                onBlur={() => p.onTermHover(null)}
                onClick={() => p.onTermPin(k.term)}
              >
                {k.term}
                {k.n > 0 && <small>{k.n}</small>}
              </button>
            ))}
          </div>
        )}
        {p.caption && (
          <p className="bs-sheet-caption" role="status">
            {p.caption}
          </p>
        )}
      </header>

      <div className="bs-read-body" ref={bodyRef}>
        <div className="bs-read-text" ref={textRef}>
          {p.preview.kind === "loading" ? (
            <p className="bs-faint bs-breathe">{t("scene.brain.reading")}</p>
          ) : blocks ? (
            <Markdown
              blocks={blocks}
              shape="scene"
              refs={{
                resolve,
                skills: p.skills,
                onNote: p.onNote,
                onSkill: p.onSkill,
                onPeek: p.onPeek,
                headingIds,
                iconOf: (id) => {
                  const kind = p.kindOfId(id);
                  return kind ? <BrainGlyph kind={kind} size={13} className="bs-md-link-icon" /> : null;
                },
              }}
            />
          ) : p.preview.kind === "text" ? (
            <pre className="bs-md-pre bs-read-plain">{p.preview.content}</pre>
          ) : (
            <p className="bs-faint">
              {p.preview.kind === "blocked" ? t("brain.blocked") : (p.preview.message ?? t("brain.binary"))}
            </p>
          )}
        </div>
        {rail}
      </div>

      <div className="bs-acts">
        <button type="button" className="bs-act agent" onClick={() => p.onReference()} disabled={!readable}>
          {t("scene.brain.reference")}
        </button>
        <button
          type="button"
          className="bs-act agent"
          onClick={() => p.onReference(t("brain.askSummary"))}
          disabled={!readable}
        >
          {t("brain.summarize")}
        </button>
        <button
          type="button"
          className="bs-act agent"
          onClick={() => p.onReference(t("scene.brain.askExplain"))}
          disabled={!readable}
        >
          {t("scene.brain.explain")}
        </button>
        <button type="button" className="bs-act" onClick={p.onLamina}>
          {t("scene.brain.lamina")}
        </button>
        <button type="button" className="bs-act" onClick={p.onCopy}>
          {t("brain.copyPath")}
        </button>
        <button type="button" className="bs-act" onClick={p.onEditor}>
          {t("brain.openEditor")}
        </button>
        <button type="button" className="bs-act ghost" onClick={p.onClose}>
          {t("scene.brain.close")}
        </button>
      </div>
    </article>
  );
});

function RailList({
  title,
  mark,
  relation,
  entries,
  onNote,
  onPeek,
}: {
  title: string;
  mark: string;
  relation: string;
  entries: RailEntry[];
  onNote: (id: number) => void;
  onPeek: (id: number | null) => void;
}) {
  const t = useT();
  const [all, setAll] = useState(false);
  const shown = all ? entries : entries.slice(0, ENTRIES_SHOWN);
  return (
    <div className="bs-rail-group" data-rel={relation}>
      <p className="bs-rail-kind">
        <span className="bs-rail-mark" aria-hidden>
          {mark}
        </span>
        {title} <span className="bs-faint">{entries.length}</span>
      </p>
      <ul className="bs-rail-list">
        {shown.map((e) => (
          <li key={e.index}>
            <button
              type="button"
              onClick={() => onNote(e.id)}
              onMouseEnter={() => onPeek(e.id)}
              onMouseLeave={() => onPeek(null)}
              onFocus={() => onPeek(e.id)}
              onBlur={() => onPeek(null)}
              title={t("scene.brain.travel", { name: e.label })}
            >
              <BrainGlyph kind={e.kind} size={14} />
              <span className="bs-rail-name">{e.label}</span>
              {e.line && <span className="bs-rail-line">{e.line}</span>}
            </button>
          </li>
        ))}
      </ul>
      {entries.length > ENTRIES_SHOWN && (
        <button type="button" className="bs-link-btn" onClick={() => setAll((v) => !v)}>
          {all ? t("scene.brain.fewerAreas") : t("brain.moreN", { n: entries.length - ENTRIES_SHOWN })}
        </button>
      )}
    </div>
  );
}
