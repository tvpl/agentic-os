/**
 * Step 2 of the guided cleanup (design.md "Etapa 2"): the cards of what a scope holds, from the inventory route, with
 * numbers that rise from zero (`useTweenNumber`, final at once under reduced motion) and bars that grow from their base;
 * and, below the cards while a scan runs, its phase in text, `done/total` and a progress bar, with "Cancelar".
 */
import { useEffect, useState, type CSSProperties } from "react";
import { AlertTriangle } from "lucide-react";
import { useLocale, useT, type TKey } from "../../i18n";
import { formatBytes } from "../../components/ui";
import { prefersReducedMotion } from "../../hooks/usePresence";
import { useTweenNumber } from "../../desktop/useTweenNumber";
import { PHASES, baseName, type Inventory, type Phase } from "./cleanupData";

const GROUPS: Record<Inventory["byKind"][number]["kind"], TKey> = {
  notes: "cleanup.group.notes",
  text: "cleanup.group.text",
  pdf: "scene.brain.kind.pdf",
  image: "cleanup.group.image",
  code: "cleanup.group.code",
  other: "cleanup.group.other",
};

/** A number that counts up from zero when it first arrives (AC 6). */
function Count({ value, className }: { value: number; className?: string }) {
  const locale = useLocale();
  const [target, setTarget] = useState(() => (prefersReducedMotion() ? value : 0));
  useEffect(() => setTarget(value), [value]);
  return <span className={className}>{Math.round(useTweenNumber(target)).toLocaleString(locale)}</span>;
}

const share = (n: number, max: number) =>
  `${n > 0 && max > 0 ? Math.max(2, Math.round((n / max) * 100)) : 0}%`;
const nth = (i: number) => ({ "--i": i }) as CSSProperties;

export function InventoryCards({ data }: { data: Inventory | undefined }) {
  const t = useT();
  if (!data)
    return (
      <div className="cln-grid" aria-busy="true">
        <p className="cln-loading" role="status">
          <span className="spinner" aria-hidden />
          {t("cleanup.phase.inventory")}…
        </p>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="cln-card cln-ghost" aria-hidden />
        ))}
      </div>
    );
  const kindMax = Math.max(0, ...data.byKind.map((k) => k.count));
  const ageMax = Math.max(0, ...data.byAge.map((a) => a.count));
  const folderMax = Math.max(0, ...data.topFolders.map((f) => f.bytes));
  return (
    <div className="cln-grid">
      <section className="cln-card">
        <h3>{t("shell.palette.files")}</h3>
        <Count value={data.total.count} className="cln-big" />
        <span className="cln-dim">{formatBytes(data.total.bytes)}</span>
      </section>
      <section className="cln-card">
        <h3>{t("cleanup.card.kinds")}</h3>
        <ul className="cln-bars">
          {data.byKind.map((k, i) => (
            <li key={k.kind}>
              <span className="cln-label">{t(GROUPS[k.kind])}</span>
              <span className="cln-track" aria-hidden>
                <span className="cln-fill" style={{ ...nth(i), width: share(k.count, kindMax) }} />
              </span>
              <Count value={k.count} className="cln-num" />
            </li>
          ))}
        </ul>
      </section>
      <section className="cln-card">
        <h3>{t("cleanup.card.age")}</h3>
        <ol className="cln-cols">
          {data.byAge.map((a, i) => (
            <li key={a.from} className={a.to === null ? "cln-warn" : undefined}>
              <span className="cln-num">
                <Count value={a.count} />
                {a.to === null && <> {t("cleanup.age.stale")}</>}
              </span>
              <span className="cln-col" aria-hidden>
                <span className="cln-col-fill" style={{ ...nth(i), height: share(a.count, ageMax) }} />
              </span>
              <span className="cln-label">
                {a.from === 0
                  ? t("cleanup.age.month")
                  : a.to === null
                    ? t("cleanup.age.older")
                    : `${a.from}-${a.to}`}
              </span>
            </li>
          ))}
        </ol>
      </section>
      <section className="cln-card">
        <h3>{t("cleanup.card.folders")}</h3>
        <ul className="cln-folders">
          {data.topFolders.map((f, i) => (
            <li key={f.path} title={f.path}>
              <span className="cln-label">{baseName(f.path)}</span>
              <span className="cln-num">{formatBytes(f.bytes)}</span>
              <span className="cln-track thin" aria-hidden>
                <span className="cln-fill" style={{ ...nth(i), width: share(f.bytes, folderMax) }} />
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="cln-card">
        <h3>{t("brain.groups")}</h3>
        <ul className="cln-pills">
          {data.clusters.slice(0, 12).map((c) => (
            <li key={`${c.kind}:${c.name}`} className="cln-pill">
              {c.name} <span className="cln-num">{c.count}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function ScanProgress(p: { phase: Phase; done: number; total: number; onCancel: () => void }) {
  const t = useT();
  return (
    <div className="cln-progress">
      <span className="spinner sm" aria-hidden />
      <span className="cln-phase">{t(PHASES[p.phase])}</span>
      <span className="cln-num">{`${p.done}/${p.total}`}</span>
      <div
        className="cln-track"
        role="progressbar"
        aria-label={t(PHASES[p.phase])}
        aria-valuemin={0}
        aria-valuemax={p.total}
        aria-valuenow={p.done}
      >
        <span className="cln-bar-now" style={{ width: share(p.done, p.total) }} />
      </div>
      <button type="button" className="btn sm" onClick={p.onCancel}>
        {t("common.cancel")}
      </button>
    </div>
  );
}

/** A step's failure, as text beside an icon in a `role="alert"` band, with "Tentar de novo" (AC 20, AC 39). */
export function Band({ text, onRetry }: { text: string; onRetry: () => void }) {
  const t = useT();
  return (
    <div className="cln-alert" role="alert">
      <AlertTriangle aria-hidden />
      <span>{text}</span>
      <button type="button" className="btn sm" onClick={onRetry}>
        {t("cleanup.retry")}
      </button>
    </div>
  );
}
