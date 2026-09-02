/**
 * Virtualized run timeline (audit item 34): consecutive text lines are
 * grouped, every row has an icon and colour per event type, tool calls are
 * collapsible, autoscroll only while the reader is at the bottom, and only
 * a one-line status is `aria-live`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, Bot, CheckCircle2, Play, ShieldAlert, Terminal, Wrench, XCircle } from "lucide-react";
import { useT } from "../i18n";
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

export interface EventTimelineProps {
  events: RunEventView[];
  live: boolean;
  /** Fixed height of the scroll viewport in px. */
  height?: number;
}

export default function EventTimeline({ events, live, height = 480 }: EventTimelineProps) {
  const t = useT();
  const parentRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [unseen, setUnseen] = useState(0);
  const items = useMemo(() => groupEvents(events), [events]);
  const firstTs = events[0]?.ts ?? 0;
  const lastCountRef = useRef(0);

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

  // Autoscroll only while the reader was already at the bottom.
  useEffect(() => {
    const added = items.length - lastCountRef.current;
    lastCountRef.current = items.length;
    if (items.length === 0) return;
    if (atBottomRef.current) {
      virtualizer.scrollToIndex(items.length - 1, { align: "end" });
    } else if (added > 0) {
      setUnseen((n) => n + added);
    }
  }, [items.length, virtualizer]);

  const jump = () => {
    atBottomRef.current = true;
    setUnseen(0);
    virtualizer.scrollToIndex(items.length - 1, { align: "end" });
  };

  const lastEvent = events[events.length - 1];

  return (
    <div className="timeline">
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
                  className="timeline-row-wrap"
                  style={{ transform: `translateY(${v.start}px)` }}
                >
                  <TimelineRow item={item} firstTs={firstTs} />
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
}

function offset(ts: number, firstTs: number): string {
  return `+${((ts - firstTs) / 1000).toFixed(1)}s`;
}

function TimelineRow({ item, firstTs }: { item: Item; firstTs: number }) {
  const t = useT();
  if (item.kind === "text") {
    return (
      <div className={`ev ev-text ev-${item.stream}`}>
        <span className="ev-time mono">{offset(item.ts, firstTs)}</span>
        <span className="ev-icon" aria-hidden>
          <Terminal />
        </span>
        <div className="ev-body">
          <span className="ev-tag">{item.stream}</span>
          <pre className="ev-pre">{item.lines.join("\n")}</pre>
        </div>
      </div>
    );
  }
  const e = item.event;
  const time = <span className="ev-time mono">{offset(e.ts, firstTs)}</span>;
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
            <pre className="ev-pre">{String(e.text ?? "")}</pre>
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
                  <span className="ev-tag">tool</span> <span className="mono ev-tool-name">{String(e.tool ?? "")}</span>
                </summary>
                <pre className="ev-pre">{detail}</pre>
              </details>
            ) : (
              <>
                <span className="ev-tag">tool</span> <span className="mono ev-tool-name">{String(e.tool ?? "")}</span>
              </>
            )}
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
            <pre className="ev-pre">{String(e.detail ?? "")}</pre>
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
            <pre className="ev-pre">{String(e.message ?? "")}</pre>
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
            {e.summary ? <pre className="ev-pre">{String(e.summary)}</pre> : null}
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
            <pre className="ev-pre">{JSON.stringify(e)}</pre>
          </div>
        </div>
      );
  }
}
