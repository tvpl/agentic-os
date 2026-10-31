/**
 * "Painéis", the Núcleo's scene (.specs/features/cerebro-paineis, design.md "Cena - Painéis"): the same composition
 * under the Núcleo's frame. The header is the scene's voice line, the KPIs a strip at the top, the cards lâminas in the
 * definition's order in two columns, the selector the scene's menu. No camera moves. A chunk of its own (amendment 24).
 */
import { MoreHorizontal } from "lucide-react";
import { Skeleton } from "../components/ui";
import { DropdownMenu } from "../ui";
import type { SceneViewProps } from "../nucleo/sceneViews";
import {
  Card,
  BoardMeta,
  Highlights,
  KpiRow,
  NextSteps,
  QuestionError,
  splitWidgets,
  useBoardScreen,
} from "./DashboardBoard";

export default function DashboardsScene(_props: SceneViewProps) {
  const s = useBoardScreen();
  const { board, t } = s;
  if (board.unauthorised)
    return (
      <div className="dsn">
        <p className="dsh-empty dsh-denied" role="alert">
          {t("dash.unauthorised")}
        </p>
      </div>
    );
  if (!board.list.data) return <Skeleton page lines={6} />;
  const { cards } = splitWidgets(s);
  const menu = [
    ...s.selector,
    { id: "dash-sep2", separator: true as const },
    {
      id: "dash:refresh",
      label: t("dash.refresh"),
      onSelect: () => board.currentId && void board.refresh(board.currentId),
    },
    ...s.more,
  ];
  return (
    <div className="dsn dsh" data-dashboard={board.currentId ?? undefined}>
      <div className="dsn-voice">
        <h2 className="dsh-title dsn-voice-t">{s.heading}</h2>
        <BoardMeta s={s} />
        <DropdownMenu
          items={menu}
          align="end"
          tip={t("dash.more")}
          trigger={
            <button type="button" className="btn sm ghost icon-only dsn-menu" aria-label={t("dash.more")}>
              <MoreHorizontal aria-hidden />
            </button>
          }
        />
      </div>
      <QuestionError s={s} />
      <KpiRow s={s} className="dsh-kpis dsn-kpis" />
      <Highlights s={s} />
      <div className="dsn-laminas">
        {cards.map((w) => (
          <Card key={w.def?.id ?? w.snap?.id} s={s} w={w} as="article" />
        ))}
      </div>
      <NextSteps s={s} />
      {s.dialogs}
    </div>
  );
}
