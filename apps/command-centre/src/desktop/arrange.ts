/**
 * The generative HUD (refino item 47): "organise the desk for reviewing
 * code" becomes a set of panels. No model call — the vocabulary is small
 * and a person's intents for a desk are few — so the answer is instant and
 * free. Unknown intents return null and the palette says so. Pure, tested.
 */
export interface Arrangement {
  /** Panel ids: `app:<kind>` for apps, a reading id for instruments. */
  panels: string[];
  /** Which vocabulary matched, for the palette's row. */
  theme: string;
}

const THEMES: Array<{ theme: string; words: string[]; panels: string[] }> = [
  {
    theme: "review",
    words: ["revis", "review", "código", "codigo", "code", "pr", "diff", "commit"],
    panels: ["app:runs", "attention", "app:artifacts"],
  },
  {
    theme: "cost",
    words: ["custo", "cost", "gasto", "spend", "orçamento", "orcamento", "budget", "token"],
    panels: ["cost", "pulse", "app:runs"],
  },
  {
    theme: "routines",
    words: ["rotina", "routine", "agenda", "cron", "schedule", "noite", "nightly"],
    panels: ["app:routines", "routines", "attention"],
  },
  {
    theme: "memory",
    words: [
      "memór",
      "memor",
      "cérebro",
      "cerebro",
      "brain",
      "nota",
      "note",
      "arquivo",
      "file",
      "pesquis",
      "research",
    ],
    panels: ["app:brain", "inbox", "app:artifacts"],
  },
  {
    theme: "skills",
    words: ["skill", "habilidade", "comando", "sop"],
    panels: ["app:skills", "pulse", "app:runs"],
  },
  {
    theme: "connectors",
    words: ["conector", "connector", "integra", "email", "e-mail", "gmail", "calend", "mcp"],
    panels: ["app:connectors", "attention", "inbox"],
  },
  {
    theme: "morning",
    words: [
      "manhã",
      "manha",
      "morning",
      "dia",
      "day",
      "briefing",
      "resumo",
      "foco",
      "focus",
      "hoje",
      "today",
    ],
    panels: ["now", "attention", "approvals"],
  },
  {
    theme: "images",
    words: ["imagem", "image", "pixel", "arte", "art", "geraç", "gerac", "generation", "vídeo", "video"],
    panels: ["app:generations", "app:pixel"],
  },
  {
    theme: "ops",
    words: [
      "ops",
      "operaç",
      "operac",
      "saúde",
      "saude",
      "health",
      "sistema",
      "system",
      "doctor",
      "serviço",
      "service",
    ],
    panels: ["app:settings", "attention", "app:routines"],
  },
];

/** The verbs that turn a palette query into an arrangement request. */
export const ARRANGE_VERBS =
  /^(?:organizar|organize|organise|arrange|arrumar|montar|prepare|preparar)\s+(.+)$/i;

export function arrangeFor(intent: string): Arrangement | null {
  const text = intent.toLowerCase();
  let best: { theme: (typeof THEMES)[number]; hits: number } | null = null;
  for (const theme of THEMES) {
    const hits = theme.words.filter((w) => text.includes(w)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { theme, hits };
  }
  return best ? { panels: [...best.theme.panels], theme: best.theme.theme } : null;
}
