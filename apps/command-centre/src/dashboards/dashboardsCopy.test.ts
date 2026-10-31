/**
 * The words of the dashboards (.specs/features/cerebro-paineis, C97; design.md "Texto" and plan.md amendment 26): every
 * key of the design's table (29 rows, 41 keys) and of amendment 26 (36 keys) is in `en` and `ptBR` of
 * `locales/dashboards.ts` with that text, both locales hold the same keys, and no key of the file is unused.
 */
import { describe, expect, it } from "vitest";
import { en, ptBR } from "../locales/dashboards";
import { loadTree, productionFiles, spelledIn } from "../testing/sourceGraph";

/** design.md "Texto": key, pt-BR, en. */
const DESIGN: Array<[string, string, string]> = [
  ["dash.nav", "Painéis", "Dashboards"],
  ["dash.greet.morning", "Bom dia", "Good morning"],
  ["dash.greet.afternoon", "Boa tarde", "Good afternoon"],
  ["dash.greet.evening", "Boa noite", "Good evening"],
  ["dash.kind.overview", "Visão geral", "Overview"],
  ["dash.kind.area", "Contexto: {name}", "Context: {name}"],
  ["dash.kind.question", "Pergunta", "Question"],
  ["dash.updatedAt", "Atualizado às {time}", "Updated at {time}"],
  ["dash.updating", "Atualizando…", "Updating…"],
  ["dash.stale", "Desatualizado — atualizado às {time}", "Out of date — updated at {time}"],
  ["dash.never", "Ainda sem dados", "No data yet"],
  ["dash.refresh", "Atualizar", "Refresh"],
  ["dash.export", "Exportar HTML", "Export HTML"],
  ["dash.customize", "Personalizar", "Customize"],
  ["dash.archive", "Arquivar painel", "Archive dashboard"],
  ["dash.new", "Novo painel", "New dashboard"],
  ["dash.new.area", "Painel de um contexto", "Context dashboard"],
  ["dash.new.question", "Painel de uma pergunta", "Question dashboard"],
  ["dash.widget.error", "Não foi possível carregar.", "Could not load."],
  ["dash.widget.retry", "Tentar de novo", "Try again"],
  [
    "dash.widget.unavailable",
    "Esta fonte ainda não existe nesta versão.",
    "This source is not in this version yet.",
  ],
  ["dash.widget.notConfigured", "Conecte {connector} para ver isto.", "Connect {connector} to see this."],
  ["dash.widget.noHistory", "Sem histórico ainda", "No history yet"],
  ["dash.widget.asTable", "Ver como tabela", "Show as table"],
  [
    "dash.context.gone",
    "O contexto deste painel não existe mais.",
    "This dashboard's context no longer exists.",
  ],
  ["dash.task.overdue", "Atrasada há {n} d", "{n} d overdue"],
  ["dash.task.today", "Vence hoje", "Due today"],
  ["dash.task.tomorrow", "Amanhã", "Tomorrow"],
  [
    "dash.task.readonly",
    "Fora de memory/: abra a nota para marcar.",
    "Outside memory/: open the note to check it.",
  ],
  ["dash.state.decided", "Decidido", "Decided"],
  ["dash.state.open", "Aberta", "Open"],
  ["dash.state.onTrack", "No prazo", "On track"],
  ["dash.state.behind", "Atrasado", "Behind"],
  ["dash.state.dueToday", "Vence hoje", "Due today"],
  ["dash.state.inReview", "Em revisão", "In review"],
  ["dash.state.paused", "Pausado", "Paused"],
  ["dash.state.running", "Executando", "Running"],
  [
    "dash.unauthorised",
    "Este dispositivo não tem permissão para ver painéis.",
    "This device may not view dashboards.",
  ],
  ["dash.today.link", "Ver a visão geral →", "See the overview →"],
  ["dash.question.sources", "Fontes", "Sources"],
  ["dash.question.how", "Como esta resposta foi feita", "How this answer was made"],
];

/** plan.md amendment 26: key, pt-BR, en. */
const AMENDMENT_26: Array<[string, string, string]> = [
  ["dash.empty.notes", "Nenhuma nota.", "No notes."],
  ["dash.empty.tasks", "Nada com prazo para hoje.", "Nothing due today."],
  ["dash.empty.decisions", "Nenhuma decisão nesta semana.", "No decisions this week."],
  ["dash.empty.openLoops", "Nenhuma pendência aberta.", "No open loops."],
  ["dash.empty.projects", "Nenhum projeto ativo.", "No active projects."],
  ["dash.empty.reviews", "Nada para revisar.", "Nothing to review."],
  ["dash.empty.facts", "Nenhum fato registrado.", "No facts recorded."],
  ["dash.empty.runs", "Nenhuma execução recente.", "No recent runs."],
  ["dash.empty.approvals", "Nenhuma aprovação pendente.", "No pending approvals."],
  ["dash.empty.connector", "Nada de {connector} hoje.", "Nothing from {connector} today."],
  ["dash.empty.table", "Nada para mostrar.", "Nothing to show."],
  ["dash.empty.bars", "Sem dados para comparar.", "No data to compare."],
  ["dash.empty.agenda", "Agenda livre hoje.", "Free day."],
  ["dash.empty.note", "Esta nota está vazia.", "This note is empty."],
  ["dash.task.howto", "Como marcar um prazo", "How to set a due date"],
  ["dash.task.conflict", "A nota mudou; atualize o painel.", "The note changed; refresh the dashboard."],
  ["dash.chip.remaining", "{n} restantes", "{n} left"],
  ["dash.chip.open", "{n} abertas", "{n} open"],
  ["dash.chip.behind", "{n} atrasados", "{n} behind"],
  ["dash.more", "Mais", "More"],
  ["dash.editFile", "Editar no editor do sistema", "Open in the system editor"],
  ["dash.customize.conflict", "Este painel mudou em outro lugar.", "This dashboard changed elsewhere."],
  ["dash.reload", "Recarregar", "Reload"],
  ["dash.new.overview", "Visão geral", "Overview"],
  ["dash.new.needContext", "Crie um contexto primeiro", "Create a context first"],
  ["dash.create", "Criar", "Create"],
  ["dash.cancel", "Cancelar", "Cancel"],
  ["dash.seeAll", "Ver todas ({n})", "See all ({n})"],
  ["dash.openNote", "Abrir nota", "Open note"],
  ["dash.agents", "Agentes agora", "Agents now"],
  ["dash.exported", "Exportado do MordomoOS em {date}", "Exported from MordomoOS on {date}"],
  ["dash.cmd.open", "Abrir painéis", "Open dashboards"],
  ["dash.cmd.refresh", "Atualizar painel", "Refresh dashboard"],
  ["reminder.overdue", "Atrasada: {text}", "Overdue: {text}"],
  ["reminder.due_today", "Vence hoje: {text}", "Due today: {text}"],
  ["reminder.project_behind", "Projeto atrasado: {text}", "Project behind: {text}"],
];

const pt = ptBR as Record<string, string>;
const english = en as Record<string, string>;

describe("C97 the words of the dashboards", () => {
  it("C97 the design's table is 41 keys and amendment 26 is 36, none twice", () => {
    expect(DESIGN).toHaveLength(41);
    expect(AMENDMENT_26).toHaveLength(36);
    expect(new Set([...DESIGN, ...AMENDMENT_26].map(([k]) => k)).size).toBe(77);
  });

  for (const [name, rows] of [
    ["design.md Texto", DESIGN],
    ["amendment 26", AMENDMENT_26],
  ] as const)
    it(`C97 every key of ${name} is in en and ptBR with that text`, () => {
      for (const [key, ptText, enText] of rows) {
        expect([key, pt[key]]).toEqual([key, ptText]);
        expect([key, english[key]]).toEqual([key, enText]);
      }
    });

  it("C97 both locales hold the same keys", () => {
    expect(Object.keys(pt).sort()).toEqual(Object.keys(english).sort());
  });

  it("C97 no key of the file is unused: each is spelled whole by a production source", () => {
    const tree = loadTree();
    const defines = (file: string) => file === "i18n.ts" || file.startsWith("locales/");
    const spelled = spelledIn(tree, productionFiles(tree), defines);
    expect(Object.keys(english).filter((k) => !spelled.words.has(k))).toEqual([]);
  });
});
