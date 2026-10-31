import type { DashboardKind, DashboardSpec, DashboardWidget } from "@mordomo/contracts";

/**
 * The three templates of `design.md` "Os três modelos", as amendment 6 reads them: the overview has ten widgets (two
 * lists, "Em andamento" and "Agentes agora", where the design drew one), the area of a context eight and no connector
 * (a context has none), the question none of its own (the skill answers them, S6).
 */

const ACTIVE_HEALTHS = ["behind", "due_today", "in_review", "on_track"] as const;

export function overviewWidgets(): DashboardWidget[] {
  return [
    {
      id: "prioridades-kpi",
      kind: "kpi",
      title: "Prioridades de hoje",
      source: { kind: "tasks", window: "today" },
      options: { measure: "done_of_due", chip: "remaining" },
    },
    {
      id: "decisoes-kpi",
      kind: "kpi",
      title: "Decisões da semana",
      source: { kind: "decisions", window: "week" },
      options: { measure: "count", chip: "open" },
    },
    {
      id: "projetos-kpi",
      kind: "kpi",
      title: "Projetos no prazo",
      source: { kind: "projects" },
      options: { measure: "on_track_of_active", chip: "behind" },
    },
    {
      id: "revisoes-kpi",
      kind: "kpi",
      title: "Revisões vencidas",
      source: { kind: "reviews" },
      options: { measure: "count", upIsGood: false },
    },
    {
      id: "execucoes-kpi",
      kind: "kpi",
      title: "Execuções em 24 h",
      source: { kind: "metrics", series: "runs24h" },
      options: { measure: "latest" },
    },
    {
      id: "prioridades",
      kind: "checklist",
      title: "Prioridades de hoje",
      source: { kind: "tasks", window: "today" },
      options: { size: "m" },
    },
    {
      id: "decisoes",
      kind: "list",
      title: "Decisões da semana",
      source: { kind: "decisions", window: "week" },
      options: { size: "m" },
    },
    {
      id: "em-andamento",
      kind: "list",
      title: "Em andamento",
      source: { kind: "projects", health: [...ACTIVE_HEALTHS] },
      options: { size: "m" },
    },
    { id: "agentes", kind: "list", title: "Agentes agora", source: { kind: "runs" }, options: { size: "m" } },
    {
      id: "agenda",
      kind: "agenda",
      title: "Agenda de hoje",
      source: { kind: "connector", id: "calendar-google", read: "list" },
      options: { size: "l" },
    },
  ];
}

export function areaWidgets(): DashboardWidget[] {
  return [
    {
      id: "tarefas-kpi",
      kind: "kpi",
      title: "Tarefas abertas",
      source: { kind: "tasks", window: "week" },
      options: { measure: "open" },
    },
    {
      id: "decisoes-kpi",
      kind: "kpi",
      title: "Decisões da semana",
      source: { kind: "decisions", window: "week" },
      options: { measure: "count", chip: "open" },
    },
    {
      id: "notas-kpi",
      kind: "kpi",
      title: "Notas atualizadas na semana",
      source: { kind: "notes", changed: "week" },
      options: { measure: "count" },
    },
    {
      id: "revisoes-kpi",
      kind: "kpi",
      title: "Revisões vencidas",
      source: { kind: "reviews" },
      options: { measure: "count", upIsGood: false },
    },
    {
      id: "proximas",
      kind: "checklist",
      title: "Próximas tarefas",
      source: { kind: "tasks", window: "week" },
      options: { size: "m" },
    },
    {
      id: "por-status",
      kind: "bars",
      title: "Notas por status",
      source: { kind: "notes", groupBy: "status" },
      options: { size: "m" },
    },
    {
      id: "mudou",
      kind: "list",
      title: "Mudou nesta semana",
      source: { kind: "notes", changed: "week" },
      options: { size: "m" },
    },
    {
      id: "decisoes-abertas",
      kind: "list",
      title: "Decisões abertas",
      source: { kind: "decisions", window: "week", state: "open" },
      options: { size: "m" },
    },
  ];
}

export interface TemplateInput {
  template: DashboardKind;
  title?: string | undefined;
  context?: { id: string; name: string } | undefined;
  question?: string | undefined;
}

const cut = (text: string, max: number) => [...text].slice(0, max).join("");

/** The id a template derives (amendment 6 d), before `-2` to `-99`. */
export function templateBaseId(input: TemplateInput): string {
  if (input.template === "overview") return "visao-geral";
  if (input.template === "area") return `contexto-${input.context!.id}`;
  return "pergunta";
}

/** The definition a template writes. */
export function templateDefinition(input: TemplateInput): DashboardSpec {
  if (input.template === "overview") {
    return {
      v: 1,
      title: input.title ?? "Visão geral",
      kind: "overview",
      refresh: "15m",
      widgets: overviewWidgets(),
    };
  }
  if (input.template === "area") {
    const context = input.context!;
    return {
      v: 1,
      title: input.title ?? cut(context.name, 120),
      kind: "area",
      contextId: context.id,
      refresh: "15m",
      widgets: areaWidgets(),
    };
  }
  const question = input.question!.trim();
  return {
    v: 1,
    title: input.title ?? cut(question, 120),
    kind: "question",
    question,
    refresh: "manual",
    widgets: [],
  };
}
