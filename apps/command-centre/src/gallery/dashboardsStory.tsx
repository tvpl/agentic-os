/**
 * The dashboards in the gallery (.specs/features/cerebro-paineis, C95): a KPI tile with and without history, each
 * widget kind, the header in its four states and the highlights row, from fixture data (the gallery never talks to the
 * API). Fetched when the gallery opens, through the screens' own chunk.
 */
import { HeaderMeta } from "../dashboards/DashboardBoard";
import { HighlightsRow, KpiTile, WidgetCard, type WidgetEnv } from "../dashboards/widgets";
import type { DashboardRead, DefWidget, SnapWidget } from "../dashboards/dashboardsData";

const NOW = Date.UTC(2026, 8, 2, 14, 30);
const HOUR = 3_600_000;
const env: WidgetEnv = {
  now: NOW,
  memoryRoot: "/fixture/memory",
  sources: [],
  open: () => undefined,
  retry: () => undefined,
};
const def = (
  id: string,
  kind: DefWidget["kind"],
  source: DefWidget["source"],
  title: string,
  options?: DefWidget["options"],
) => ({ id, kind, title, source, ...(options ? { options } : {}) }) as DefWidget;
const ok = (id: string, kind: SnapWidget["kind"], data: Record<string, unknown>): SnapWidget => ({
  id,
  kind,
  status: "ok",
  data,
});
const series = [3, 4, 4, 6, 5, 7].map((value, i) => ({ at: NOW - (5 - i) * HOUR, value }));

const CARDS: Array<[DefWidget, SnapWidget]> = [
  [
    def("tarefas", "checklist", { kind: "tasks", window: "today" }, "Prioridades de hoje"),
    ok("tarefas", "checklist", {
      items: [
        {
          path: "/fixture/memory/notes/a.md",
          line: 3,
          fileId: 1,
          text: "Mandar a proposta",
          done: false,
          due: "2026-08-31",
          priority: 2,
          title: "Cliente A",
        },
        {
          path: "/fixture/work/b.md",
          line: 5,
          fileId: 2,
          text: "Ler o contrato",
          done: false,
          due: "2026-09-02",
          priority: 0,
          title: "Contrato",
        },
      ],
      total: 2,
    }),
  ],
  [
    def("decisoes", "list", { kind: "decisions", window: "week" }, "Decisões da semana"),
    ok("decisoes", "list", {
      items: [
        {
          text: "Usar Postgres",
          state: "decided",
          natureza: "fato",
          day: "2026-09-01",
          fileId: 3,
          title: "Arquitetura",
        },
        {
          text: "Lançar em março",
          state: "open",
          natureza: "plano",
          day: "2026-08-31",
          fileId: 4,
          title: "Plano",
        },
      ],
      total: 2,
    }),
  ],
  [
    def("tabela", "table", { kind: "notes" }, "Clientes"),
    ok("tabela", "table", {
      columns: ["Cliente", "Dias"],
      rows: [
        { cells: ["A", 12], state: "behind" },
        { cells: ["B", 4], state: "on_track" },
      ],
    }),
  ],
  [
    def("status", "bars", { kind: "notes", groupBy: "status" }, "Notas por status", {
      ordered: true,
      funnel: true,
    }),
    ok("status", "bars", {
      categories: [
        { label: "draft", count: 13 },
        { label: "active", count: 6 },
        { label: "done", count: 3 },
      ],
    }),
  ],
  [
    def("agenda", "agenda", { kind: "connector", id: "calendar-google", read: "list" }, "Agenda de hoje", {
      size: "l",
    }),
    ok("agenda", "agenda", {
      connector: { id: "calendar-google", name: "Calendar" },
      items: [
        { id: "e1", title: "Café com a equipe", ts: NOW - 5 * HOUR },
        { id: "e2", title: "Cliente A", ts: NOW - 0.25 * HOUR, subtitle: "Ler o contrato antes" },
        { id: "e3", title: "Revisão", ts: NOW + 2 * HOUR },
      ],
      total: 3,
    }),
  ],
  [
    def("nota", "note", { kind: "notes" }, "Resumo"),
    ok("nota", "note", { text: "O **onboarding** demora mais por causa do contrato.", fileId: 5 }),
  ],
  [
    def("falha", "list", { kind: "facts" }, "Fatos"),
    { id: "falha", kind: "list", status: "error", error: "The index could not be read." },
  ],
  [
    def("vazio", "list", { kind: "projects" }, "Em andamento"),
    { id: "vazio", kind: "list", status: "empty", data: { items: [], total: 0 } },
  ],
];

const READ = (over: Partial<DashboardRead>): DashboardRead => ({
  definition: { v: 1, title: "Visão geral", kind: "overview", refresh: "15m", widgets: [] },
  version: `sha256:${"0".repeat(64)}`,
  snapshot: {
    v: 1,
    dashboardId: "visao-geral",
    generatedAt: NOW - 20 * 60_000,
    sources: [
      { id: "tasks", kind: "tasks", status: "ok", syncedAt: NOW },
      { id: "connector:calendar-google", kind: "connector", status: "not_configured", syncedAt: null },
    ],
    widgets: [],
  },
  stale: false,
  highlights: [],
  ...over,
});
const HEADERS: Array<[string, DashboardRead, boolean]> = [
  ["ok", READ({}), false],
  ["updating", READ({}), true],
  ["stale", READ({ stale: true }), false],
  ["never", READ({ snapshot: null }), false],
];

export default function DashboardsStory() {
  return (
    <div className="dsh">
      {HEADERS.map(([state, read, refreshing]) => (
        <div key={state} className="dsh-head-l" data-state={state}>
          <h3 className="dsh-title">Boa tarde</h3>
          <HeaderMeta
            kindLabel="Visão geral"
            date="quarta-feira, 2 de setembro"
            read={read}
            refreshing={refreshing}
          />
        </div>
      ))}
      <HighlightsRow
        env={env}
        highlights={[
          { rule: "overdue", title: "Mandar a proposta", tone: "danger", target: "/brain?sel=1" },
          { rule: "due_today", title: "Ler o contrato", tone: "warn", target: "/brain?sel=2" },
          { rule: "decided_this_week", title: "Usar Postgres", tone: "ok", target: "/brain?sel=3" },
          { rule: "new_since_visit", title: "Nova nota", tone: "info", target: "/brain?sel=5" },
        ]}
      />
      <div className="dsh-kpis">
        <KpiTile
          env={env}
          def={def("com", "kpi", { kind: "tasks", window: "today" }, "Prioridades de hoje", {
            measure: "done_of_due",
            chip: "remaining",
          })}
          snap={ok("com", "kpi", {
            value: 3,
            of: 5,
            delta: 1,
            deltaPct: 50,
            direction: "up",
            good: true,
            chip: { rule: "remaining", n: 2, tone: "warn" },
            series,
          })}
        />
        <KpiTile
          env={env}
          def={def("sem", "kpi", { kind: "reviews" }, "Revisões vencidas", { measure: "count" })}
          snap={ok("sem", "kpi", { value: 0, series: [{ at: NOW, value: 0 }] })}
        />
      </div>
      <div className="dsh-grid">
        {CARDS.map(([d, snap]) => (
          <WidgetCard key={d.id} def={d} snap={snap} env={env} />
        ))}
      </div>
    </div>
  );
}
