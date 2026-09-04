/**
 * Virtualized run timeline (audit item 34): consecutive text lines are
 * grouped, every row has an icon and colour per event type, tool calls are
 * collapsible, autoscroll only while the reader is at the bottom, and only
 * a one-line status is `aria-live`.
 *
 * F-RUNS additions: in-timeline search with next/previous highlighting, an
 * absolute/relative timestamp toggle, usage rows, and a viewport-sized
 * viewport instead of the old fixed 480 px.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  Bot,
  ChevronDown,
  ChevronUp,
  Coins,
  CheckCircle2,
  Play,
  Search,
  ShieldAlert,
  Terminal,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import { useLocale, useT } from "../i18n";
import { Button, Segmented } from "../components/primitives";
import { absoluteTime, eventBody, relativeOffset, searchIndices, splitMatches } from "./logText";
import { formatTokens, formatUsd } from "./usage";
import type { RunEventView } from "./useRunStream";

type Item =
  | { kind: "text"; stream: "stdout" | "stderr"; ts: number; lines: string[] }
  | { kind: "event"; ts: number; event: RunEventView };

function groupEvents(events: RunEventView[]): Item[] {
  const items: Item[] = [];
  for (const e of events) {
    if (e.type === "text") {
      const stream = e.stream === "stderr" ? "stderr" : "stdout";
      const last = items[items.length - 1];
      if (last && last.kind === "text" && last.stream === stream) {
        last.lines.push(String(e.text ?? ""));
        continue;
      }
      items.push({ kind: "text", stream, ts: e.ts, lines: [String(e.text ?? "")] });
    } else {
      items.push({ kind: "event", ts: e.ts, event: e });
    }
  }
  return items;
}

/** Searchable text of one row (same rendering the "copy log" uses). */
function itemText(item: Item): string {
  return item.kind === "text" ? `${item.stream}: ${item.lines.join("\n")}` : eventBody(item.event);
}

export type TimestampMode = "relative" | "absolute";

export interface EventTimelineProps {
  events: RunEventView[];
  live: boolean;
  /** Viewport height: a number of px, or any CSS length. Defaults to filling the window. */
  height?: number | string;
  /** Show the search + timestamp toolbar (on in RunDetail, off for embeds). */
  searchable?: boolean;
}

export interface EventTimelineHandle {
  /** Focus the in-timeline search field (the `/` shortcut in RunDetail). */
  focusSearch(): void;
}

const DEFAULT_HEIGHT = "clamp(320px, calc(100vh - 420px), 1100px)";

const EventTimeline = forwardRef<EventTimelineHandle, EventTimelineProps>(function EventTimeline(
  { events, live, height = DEFAULT_HEIGHT, searchable = false },
  ref,
) {
  const t = useT();
  const locale = useLocale();
  const parentRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const atBottomRef = useRef(true);
  const [unseen, setUnseen] = useState(0);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [stamps, setStamps] = useState<TimestampMode>("relative");
  const items = useMemo(() => groupEvents(events), [events]);
  const firstTs = events[0]?.ts ?? 0;
  const lastCountRef = useRef(0);

  const matches = useMemo(() => searchIndices(items.map(itemText), query), [items, query]);
  const active = matches.length > 0 ? matches[Math.min(cursor, matches.length - 1)] : undefined;

  useImperativeHandle(ref, () => ({ focusSearch: () => searchRef.current?.focus() }), []);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 30,
    overscan: 10,
  });

  const onScroll = () => {
    const el = parentRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
    atBottomRef.current = atBottom;
    if (atBottom) setUnseen(0);
  };

  // Autoscroll only while the reader was already at the bottom and not searching.
  useEffect(() => {
    const added = items.length - lastCountRef.current;
    lastCountRef.current = items.length;
    if (items.length === 0) return;
    if (query) return;
    if (atBottomRef.current) {
      virtualizer.scrollToIndex(items.length - 1, { align: "end" });
    } else if (added > 0) {
      setUnseen((n) => n + added);
    }
  }, [items.length, virtualizer, query]);

  // Bring the current match into view.
  useEffect(() => {
    if (active === undefined) return;
    atBottomRef.current = false;
    virtualizer.scrollToIndex(active, { align: "center" });
  }, [active, virtualizer]);

  const step = useCallback(
    (delta: number) => {
      if (matches.length === 0) return;
      setCursor((c) => (c + delta + matches.length) % matches.length);
    },
    [matches.length],
  );

  const jump = () => {
    atBottomRef.current = true;
    setUnseen(0);
    virtualizer.scrollToIndex(items.length - 1, { align: "end" });
  };

  const lastEvent = events[events.length - 1];

  return (
    <div className="timeline">
      {searchable && (
        <div className="timeline-tools">
          <div className="timeline-search">
            <Search aria-hidden className="timeline-search-icon" />
            <input
              ref={searchRef}
              type="search"
              className="input sm"
              placeholder={t("runs.timeline.searchPh")}
              aria-label={t("runs.timeline.search")}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setCursor(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  step(e.shiftKey ? -1 : 1);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setQuery("");
                  setCursor(0);
                }
              }}
            />
            {query && (
              <>
                <span className="timeline-matches mono" aria-live="polite">
                  {matches.length === 0
                    ? t("runs.timeline.noMatch")
                    : `${Math.min(cursor, matches.length - 1) + 1}/${matches.length}`}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<ChevronUp aria-hidden />}
                  aria-label={t("runs.timeline.prev")}
                  title={t("runs.timeline.prev")}
                  disabled={matches.length === 0}
                  onClick={() => step(-1)}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<ChevronDown aria-hidden />}
                  aria-label={t("runs.timeline.next")}
                  title={t("runs.timeline.next")}
                  disabled={matches.length === 0}
                  onClick={() => step(1)}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<X aria-hidden />}
                  aria-label={t("runs.timeline.clear")}
                  title={t("runs.timeline.clear")}
                  onClick={() => {
                    setQuery("");
                    setCursor(0);
                  }}
                />
              </>
            )}
          </div>
          <Segmented
            ariaLabel={t("runs.timeline.stamps")}
            size="sm"
            value={stamps}
            onChange={(v) => setStamps(v as TimestampMode)}
            options={[
              { value: "relative", label: t("runs.timeline.relative") },
              { value: "absolute", label: t("runs.timeline.absolute") },
            ]}
          />
        </div>
      )}
      <div className="timeline-status" aria-live="polite" aria-atomic="true">
        {live && <span className="spinner sm" aria-hidden />}
        <span>{t("timeline.events", { n: events.length })}</span>
        {lastEvent && <span className="mono">· {lastEvent.type}</span>}
        {live && <span className="badge info">{t("timeline.live")}</span>}
      </div>
      <div className="timeline-scroll" ref={parentRef} onScroll={onScroll} style={{ height }}>
        {items.length === 0 ? (
          <p className="timeline-empty">{t("timeline.waiting")}</p>
        ) : (
          <div className="timeline-inner" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((v) => {
              const item = items[v.index]!;
              return (
                <div
                  key={v.key}
                  data-index={v.index}
                  ref={virtualizer.measureElement}
                  className={`timeline-row-wrap${v.index === active ? " is-match" : ""}`}
                  style={{ transform: `translateY(${v.start}px)` }}
                >
                  <TimelineRow item={item} firstTs={firstTs} query={query} stamps={stamps} locale={locale} />
                </div>
              );
            })}
          </div>
        )}
      </div>
      {unseen > 0 && (
        <button type="button" className="timeline-jump" onClick={jump}>
          <ArrowDown aria-hidden /> {t("timeline.jump", { n: unseen })}
        </button>
      )}
    </div>
  );
});

export default EventTimeline;

/** Query matches wrapped in `<mark>` (odd segments of `splitMatches`). */
function Hit({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const parts = splitMatches(text, query);
  return (
    <>{parts.map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>))}</>
  );
}

function TimelineRow({
  item,
  firstTs,
  query,
  stamps,
  locale,
}: {
  item: Item;
  firstTs: number;
  query: string;
  stamps: TimestampMode;
  locale: string;
}) {
  const t = useT();
  const ts = item.ts;
  const label = stamps === "absolute" ? absoluteTime(ts, locale) : relativeOffset(ts, firstTs);
  const title = stamps === "absolute" ? relativeOffset(ts, firstTs) : absoluteTime(ts, locale);
  const time = (
    <time className="ev-time mono" dateTime={new Date(ts).toISOString()} title={title}>
      {label}
    </time>
  );

  if (item.kind === "text") {
    return (
      <div className={`ev ev-text ev-${item.stream}`}>
        {time}
        <span className="ev-icon" aria-hidden>
          <Terminal />
        </span>
        <div className="ev-body">
          <span className="ev-tag">{item.stream}</span>
          <pre className="ev-pre">
            <Hit text={item.lines.join("\n")} query={query} />
          </pre>
        </div>
      </div>
    );
  }
  const e = item.event;
  switch (e.type) {
    case "started":
      return (
        <div className="ev ev-started">
          {time}
          <span className="ev-icon" aria-hidden>
            <Play />
          </span>
          <div className="ev-body">{t("timeline.started", { pid: String(e.pid ?? "?") })}</div>
        </div>
      );
    case "assistant":
      return (
        <div className="ev ev-assistant">
          {time}
          <span className="ev-icon" aria-hidden>
            <Bot />
          </span>
          <div className="ev-body">
            <pre className="ev-pre">
              <Hit text={String(e.text ?? "")} query={query} />
            </pre>
          </div>
        </div>
      );
    case "tool_use": {
      const detail = String(e.detail ?? "");
      return (
        <div className="ev ev-tool">
          {time}
          <span className="ev-icon" aria-hidden>
            <Wrench />
          </span>
          <div className="ev-body">
            {detail ? (
              <details>
                <summary>
                  <span className="ev-tag">tool</span>{" "}
                  <span className="mono ev-tool-name">
                    <Hit text={String(e.tool ?? "")} query={query} />
                  </span>
                </summary>
                <pre className="ev-pre">
                  <Hit text={detail} query={query} />
                </pre>
              </details>
            ) : (
              <>
                <span className="ev-tag">tool</span>{" "}
                <span className="mono ev-tool-name">
                  <Hit text={String(e.tool ?? "")} query={query} />
                </span>
              </>
            )}
          </div>
        </div>
      );
    }
    case "usage": {
      const cost = typeof e.costUsd === "number" ? formatUsd(e.costUsd) : null;
      return (
        <div className="ev ev-usage">
          {time}
          <span className="ev-icon" aria-hidden>
            <Coins />
          </span>
          <div className="ev-body">
            <span className="ev-tag">
              {e.scope === "total" ? t("runs.timeline.usageTotal") : t("runs.timeline.usageTurn")}
            </span>
            <span className="mono">
              ↑{formatTokens(Number(e.inputTokens ?? 0))} ↓{formatTokens(Number(e.outputTokens ?? 0))}
              {Number(e.cacheReadTokens ?? 0) > 0
                ? ` · ${t("runs.timeline.cache")} ${formatTokens(Number(e.cacheReadTokens))}`
                : ""}
              {cost ? ` · ${cost}` : ""}
              {typeof e.model === "string" ? ` · ${e.model}` : ""}
            </span>
          </div>
        </div>
      );
    }
    case "permission":
      return (
        <div className="ev ev-permission">
          {time}
          <span className="ev-icon" aria-hidden>
            <ShieldAlert />
          </span>
          <div className="ev-body">
            <span className="ev-tag">{t("timeline.permission")}</span>
            <pre className="ev-pre">
              <Hit text={String(e.detail ?? "")} query={query} />
            </pre>
          </div>
        </div>
      );
    case "error":
      return (
        <div className="ev ev-error">
          {time}
          <span className="ev-icon" aria-hidden>
            <XCircle />
          </span>
          <div className="ev-body">
            <pre className="ev-pre">
              <Hit text={String(e.message ?? "")} query={query} />
            </pre>
          </div>
        </div>
      );
    case "result": {
      const code = e.exitCode == null ? "?" : String(e.exitCode);
      const ok = e.exitCode === 0 && !e.timedOut;
      return (
        <div className={`ev ev-result ${ok ? "ok" : "bad"}`}>
          {time}
          <span className="ev-icon" aria-hidden>
            {ok ? <CheckCircle2 /> : <XCircle />}
          </span>
          <div className="ev-body">
            <strong>{t("timeline.result", { code })}</strong>
            {e.timedOut ? ` · ${t("timeline.timedOut")}` : ""}
            {e.summary ? (
              <pre className="ev-pre">
                <Hit text={String(e.summary)} query={query} />
              </pre>
            ) : null}
          </div>
        </div>
      );
    }
    default:
      return (
        <div className="ev ev-other">
          {time}
          <span className="ev-icon" aria-hidden>
            <Terminal />
          </span>
          <div className="ev-body">
            <span className="ev-tag">{e.type}</span>
            <pre className="ev-pre">
              <Hit text={JSON.stringify(e)} query={query} />
            </pre>
          </div>
        </div>
      );
  }
}
