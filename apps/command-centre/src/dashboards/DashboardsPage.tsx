/**
 * "Painéis", the moldura's page (.specs/features/cerebro-paineis, S5; design.md "Página - Painéis"): the header, then
 * the highlights row, the KPI row and the cards on a 12-column grid, in the definition's order. A chunk of its own,
 * fetched the first time `/dashboards` opens (amendment 24).
 */
import { Skeleton } from "../components/ui";
import {
  Card,
  HeaderActions,
  BoardMeta,
  Highlights,
  KpiRow,
  NextSteps,
  QuestionError,
  splitWidgets,
  useBoardScreen,
} from "./DashboardBoard";

export default function DashboardsPage(_props: { onMetaChanged?: () => void }) {
  const s = useBoardScreen();
  const { board, t } = s;
  if (board.unauthorised)
    return (
      <div className="page dsh">
        <p className="dsh-empty dsh-denied" role="alert">
          {t("dash.unauthorised")}
        </p>
      </div>
    );
  if (!board.list.data) return <Skeleton page lines={6} />;
  const { cards } = splitWidgets(s);
  return (
    <div className="page dsh" data-dashboard={board.currentId ?? undefined}>
      <header className="dsh-head">
        <div className="dsh-head-l">
          <h2 className="dsh-title" data-kind={s.read?.definition.kind ?? board.current?.kind}>
            {s.heading}
          </h2>
          <BoardMeta s={s} />
        </div>
        <HeaderActions s={s} />
      </header>
      <QuestionError s={s} />
      <div className="dsh-body">
        <Highlights s={s} />
        <KpiRow s={s} className="dsh-kpis" />
        <div className="dsh-grid">
          {cards.map((w) => (
            <Card key={w.def?.id ?? w.snap?.id} s={s} w={w} />
          ))}
        </div>
        <NextSteps s={s} />
      </div>
      {s.dialogs}
    </div>
  );
}
