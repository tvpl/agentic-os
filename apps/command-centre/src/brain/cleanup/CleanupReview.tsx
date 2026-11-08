/**
 * Steps 4 and 5 of the guided cleanup (design.md "Etapa 4" and "Etapa 5"): the list of every change an apply would make,
 * one line per file, grouped into what goes to the archive and what stays a proposal; then what the apply did (moved,
 * skipped with the reason in words, proposals with a link to their list) and, once undone, what came back.
 */
import { Check } from "lucide-react";
import { useT, type TKey } from "../../i18n";
import { OPEN_PANEL_EVENT } from "../../components/CommandPalette";
import { ANSWERS, type ApplyResult, type PlanLine, type UndoResult } from "./cleanupData";

const SKIPS: Record<ApplyResult["skipped"][number]["reason"], TKey> = {
  changed: "cleanup.skip.changed",
  missing: "cleanup.skip.missing",
  exists: "cleanup.skip.exists",
  forbidden_path: "cleanup.skip.forbidden",
};
const label = (d: PlanLine["decision"]) => ANSWERS.find(([x]) => x === d)![1];

export function ReviewStep({ plan }: { plan: PlanLine[] }) {
  const t = useT();
  if (plan.length === 0) return <p className="cln-empty">{t("cleanup.noChanges")}</p>;
  const moves = plan.filter((l) => l.to !== null);
  const proposals = plan.filter((l) => l.to === null);
  const list = (lines: PlanLine[]) => (
    <ul className="cln-plan">
      {lines.map((l) => (
        <li key={l.from}>
          <span className="cln-mono">{l.from}</span>
          <span aria-hidden>→</span>
          {l.to === null ? (
            <span>{t("cleanup.review.proposal")}</span>
          ) : (
            <span className="cln-mono">{l.to}</span>
          )}
          <span className="cln-dim">{t(label(l.decision))}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="cln-review">
      <p className="cln-totals-line">
        {t("cleanup.review.totals", { n: plan.length, a: moves.length, p: proposals.length })}
      </p>
      <section>
        <h3>{t("cleanup.review.archive", { n: moves.length })}</h3>
        {list(moves)}
      </section>
      <section>
        <h3>{t("cleanup.review.proposals", { n: proposals.length })}</h3>
        {list(proposals)}
      </section>
    </div>
  );
}

function Skipped({ items }: { items: ApplyResult["skipped"] }) {
  const t = useT();
  if (items.length === 0) return null;
  return (
    <ul className="cln-plan">
      {items.map((s) => (
        <li key={s.path}>
          <span className="cln-mono">{s.path}</span>
          <span>{t(SKIPS[s.reason])}</span>
        </li>
      ))}
    </ul>
  );
}

export function DoneStep(p: {
  result: ApplyResult;
  proposals: number;
  undone: UndoResult | null;
  onOpen: () => void;
}) {
  const t = useT();
  const numbers: Array<[TKey, number]> = [
    ["cleanup.done.moved", p.result.moved.length],
    ["cleanup.done.skipped", p.result.skipped.length],
    ["cleanup.done.proposals", p.result.proposals ? p.proposals : 0],
  ];
  const list = p.result.proposals;
  return (
    <div className="cln-done">
      <ol className="cln-totals">
        {numbers.map(([key, n]) => (
          <li key={key}>
            <span className="cln-big">{n}</span>
            <span className="cln-label">{t(key)}</span>
          </li>
        ))}
      </ol>
      <Skipped items={p.result.skipped} />
      {list && (
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => {
            p.onOpen();
            // A document panel by its id (`desktop/docIds.ts`: `doc:` and the path).
            window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT, { detail: `doc:${list}` }));
          }}
        >
          {t("cleanup.openProposals")}
        </button>
      )}
      {p.undone && (
        <>
          <p className="cln-undone" role="status">
            <Check aria-hidden />
            {t("cleanup.undone", { n: p.undone.restored.length })}
          </p>
          <Skipped items={p.undone.skipped} />
        </>
      )}
    </div>
  );
}
