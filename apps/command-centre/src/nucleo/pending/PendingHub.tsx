/**
 * The pendências hub (top-left corner): a beacon that counts what waits on
 * you and a ticker that reads the most urgent item. New items arrive as a
 * slip under the beacon for a few seconds — alerts live here, next to the
 * things they are about, not in a toast somewhere else. A click turns the
 * whole OS toward resolving them.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import type { Pending } from "./usePending";
import type { PendingItem } from "./model";
import { describePending } from "./describe";

const TICK_MS = 4200;
const SLIP_MS = 6500;
const BASELINE_MS = 5000;

export default function PendingHub({ pending, onOpen }: { pending: Pending; onOpen: () => void }) {
  const t = useT();
  const counted = useMemo(() => pending.items.filter((i) => i.level !== "info"), [pending.items]);
  // The ticker walks the three most urgent items.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (counted.length < 2) return;
    const id = window.setInterval(() => setTick((v) => v + 1), TICK_MS);
    return () => window.clearInterval(id);
  }, [counted.length]);
  const shown = counted.length > 0 ? counted[tick % Math.min(3, counted.length)] : undefined;

  // New arrivals slip in under the beacon.
  // What loads with the page is the baseline, not news: only items that
  // appear after the first few seconds slip in.
  const seen = useRef<Set<string>>(new Set());
  const mountedAt = useRef(Date.now());
  const [slips, setSlips] = useState<PendingItem[]>([]);
  // Each arrival owns its timer: a later change to the list must not cancel
  // it, or that slip would stay under the hub for good.
  const timers = useRef(new Set<number>());
  useEffect(() => {
    const own = timers.current;
    return () => own.forEach((id) => window.clearTimeout(id));
  }, []);
  useEffect(() => {
    // A slip about something no longer pending (resolved, or folded into
    // another item) leaves with it.
    const live = new Set(pending.items.map((i) => i.id));
    setSlips((cur) => (cur.every((s) => live.has(s.id)) ? cur : cur.filter((s) => live.has(s.id))));
    if (Date.now() - mountedAt.current < BASELINE_MS) {
      for (const i of pending.items) seen.current.add(i.id);
      return;
    }
    const fresh = pending.items.filter((i) => !seen.current.has(i.id) && i.level !== "info");
    for (const i of pending.items) seen.current.add(i.id);
    if (fresh.length === 0) return;
    setSlips((cur) => [...fresh, ...cur].slice(0, 3));
    const ids = fresh.map((i) => i.id);
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setSlips((cur) => cur.filter((s) => !ids.includes(s.id)));
    }, SLIP_MS);
    timers.current.add(timer);
  }, [pending.items]);

  const level = pending.count > 0 ? pending.level : null;
  const label =
    pending.count > 0 ? t("nucleo.pending.count", { n: pending.count }) : t("nucleo.pending.none");
  return (
    <div className="nu-hub" data-level={level ?? "clear"}>
      <button
        type="button"
        className="nu-hub-beacon"
        onClick={onOpen}
        aria-label={`${t("nucleo.pending.open")} · ${label}`}
        title={t("nucleo.pending.open")}
        data-testid="pending-hub"
      >
        <svg viewBox="0 0 48 48" aria-hidden className="nu-hub-ring">
          <circle cx="24" cy="24" r="21" className="track" />
          <circle cx="24" cy="24" r="21" className="arc" />
          <circle cx="24" cy="24" r="15" className="inner" />
        </svg>
        <span className="nu-hub-n mono">{pending.count > 0 ? pending.count : "✓"}</span>
      </button>
      <button type="button" className="nu-hub-text" onClick={onOpen} tabIndex={-1} aria-hidden>
        <span className="nu-hub-k">{t("nucleo.pending.title")}</span>
        <span className="nu-hub-tick" key={shown?.id ?? "none"}>
          {shown ? describePending(shown, t).title : t("nucleo.pending.none")}
        </span>
      </button>
      {slips.length > 0 && (
        <ul className="nu-hub-slips" aria-live="polite">
          {slips.map((s) => (
            <li key={s.id} data-level={s.level}>
              <button type="button" onClick={onOpen}>
                <span className="lv mono">{t(`nucleo.pending.level.${s.level}`)}</span>
                <span className="tx">{describePending(s, t).title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
