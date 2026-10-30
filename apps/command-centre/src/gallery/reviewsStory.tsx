/**
 * "Revisões" in the gallery (.specs/features/cerebro-natureza, C91): the six nature badges, the scope badges, a list
 * item, the three action rows of the detail and the "Virou realidade" dialog, from fixture data (the gallery never talks
 * to the API). Fetched when the gallery opens, through the screen's own chunk.
 */
import { useState } from "react";
import { BecameFactDialog } from "../brain/reviews/BecameFactDialog";
import { Detail, ReviewListItem, type ReviewItem } from "../brain/reviews/ReviewsScreen";
import { ESCOPOS, NATUREZAS, NatureBadge, ScopeBadge } from "../brain/natureza";

const ROOT = "/fixture/memory/notes";
const item = (name: string, over: Partial<ReviewItem>): ReviewItem => ({
  path: `${ROOT}/${name}`,
  name,
  natureza: null,
  type: null,
  escopo: null,
  lastReviewed: "2026-05-02",
  dueSince: "2026-08-31",
  editable: true,
  mtime: Date.UTC(2026, 3, 2),
  ...over,
});
const ROWS: ReviewItem[] = [
  item("lancamento.md", { natureza: "plano", escopo: "equipe" }),
  item("opiniao-precos.md", { natureza: "opiniao" }),
  item("relatorio.pdf.md", { natureza: "fato", editable: false, path: "/fixture/work/relatorio.md" }),
];
const none = () => undefined;

export default function ReviewsStory() {
  const [dialog, setDialog] = useState(false);
  return (
    <div className="rv">
      <div className="nb-filters">
        {[...NATUREZAS, null].map((n) => (
          <NatureBadge key={n ?? "none"} n={n} />
        ))}
        {ESCOPOS.map((s) => (
          <ScopeBadge key={s} s={s} />
        ))}
      </div>
      <ul className="rv-list">
        <ReviewListItem
          item={ROWS[0]!}
          selected
          path="memory/notes/lancamento.md"
          age="revisado há 4 meses"
          onSelect={none}
        />
      </ul>
      {ROWS.map((r) => (
        <Detail
          key={r.path}
          item={r}
          kind="due"
          content={`Notas de **${r.name}**.`}
          snoozeOpen={false}
          onSnoozeOpen={none}
          onDecide={none}
          onFact={() => setDialog(true)}
        />
      ))}
      {dialog && <BecameFactDialog onCancel={() => setDialog(false)} onConfirm={() => Promise.resolve()} />}
    </div>
  );
}
