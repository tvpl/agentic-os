/**
 * "Perguntar" in the gallery (.specs/features/cerebro-perguntar, C99; design.md "Vista - Perguntar"): the view's states
 * from fixture data (the gallery never talks to the API): the empty list, answering, a direct answer with a provocation,
 * a reason-first answer, the abstention, a refused answer and the view turned off. Fetched when the gallery opens,
 * through the view's own chunk.
 */
import {
  Abstained,
  Answer,
  Answering,
  Band,
  Empty,
  Off,
  type AskCitation,
  type AskDetail,
} from "../brain/ask/AskView";
import { useT } from "../i18n";

const ROOT = "/fixture/memory/notes";
const none = () => undefined;
const cite = (
  name: string,
  section: string,
  fileId: number,
  natureza?: AskCitation["natureza"],
): AskCitation => ({
  path: `${ROOT}/${name}`,
  section,
  name,
  fileId,
  ...(natureza ? { natureza } : {}),
});
const DECISAO = cite("onboarding.md", "Decisão", 1);
const PLANO = cite("plano.md", "Próximos passos", 2, "plano");
const AT = Date.UTC(2026, 10, 22, 13, 0);
const PARAGRAPHS = [
  {
    text: "Você decidiu fazer o onboarding em duas etapas: o cadastro e a primeira reunião.",
    citations: [DECISAO],
  },
  {
    text: "O próximo passo é **testar** com três clientes antes do fim do mês.",
    citations: [DECISAO, PLANO],
  },
];
const DIRECT: AskDetail = {
  id: "fixture-run",
  question: "O que decidi sobre o onboarding?",
  mode: "direct",
  scope: { kind: "all" },
  status: "answered",
  answer: {
    paragraphs: PARAGRAPHS,
    provocation: {
      kind: "contradiz",
      text: "O contrato com a Ana pede uma etapa só.",
      citation: cite("contrato.md", "Cláusula 3", 3, "opiniao"),
    },
  },
  run: { provider: "claude", startedAt: AT, finishedAt: AT + 42_000 },
};
const REASON_FIRST: AskDetail = {
  ...DIRECT,
  mode: "reason_first",
  take: "Acho que o onboarding devia ser uma etapa só, sem formulário, e que já decidimos isso em outubro.",
  answer: {
    paragraphs: PARAGRAPHS,
    takeFeedback: {
      agrees: [{ text: "As notas também pedem menos passos.", citations: [DECISAO] }],
      disagrees: [{ text: "A decisão de outubro foi por duas etapas.", citations: [DECISAO] }],
      missing: [{ text: "Nenhuma nota fala do custo de uma etapa só.", citations: [PLANO] }],
    },
  },
};

export default function AskStory() {
  const t = useT();
  return (
    <div className="ask">
      <div className="ask-col">
        <Empty area="clientes" onExample={none} />
        <Answering provider="claude" onCancel={none} />
        <Answer detail={DIRECT} answer={DIRECT.answer!} onOpenNote={none} onAskAbout={none} />
        <Answer detail={REASON_FIRST} answer={REASON_FIRST.answer!} onOpenNote={none} onAskAbout={none} />
        <Abstained scope={t("ask.scope.active", { name: "Projeto X" })} consulted={3} onAskAll={none} />
        <Band
          title={t("ask.refused")}
          reason="A citação do parágrafo 1 nomeia /fixture/memory/notes/x.md, que o índice não tem."
          onRetry={none}
        />
        <Off onTurnOn={none} />
      </div>
    </div>
  );
}
