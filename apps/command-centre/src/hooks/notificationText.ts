/** Translate persisted legacy system templates, preserving user-authored names and prompts. */
export function notificationText(
  title: string,
  body: string | undefined,
  locale: string,
  message?: { messageKey?: string | null; messageParams?: Record<string, string | number | boolean> | null },
) {
  if (!locale.startsWith("pt")) return { title, body };
  if (message?.messageKey) {
    const p = message.messageParams ?? {};
    const fixed: Record<string, string> = {
      "skill.repeat": "Tarefa recorrente — transformar em skill?",
      "approval.requested": "Aprovação solicitada",
      "backup.created": "Backup criado",
      "index.finished": "Indexação concluída",
      "index.failed": "A indexação falhou",
      "run.finished": p.status === "timed_out" ? "A execução excedeu o tempo limite" : "A execução falhou",
      "budget.crossed": p.level === 100 ? "Orçamento diário excedido" : "80% do orçamento diário utilizado",
    };
    let translatedBody = body;
    if (message.messageKey === "index.finished") {
      const labels: Record<string, string> = {
        scanned: "verificados",
        added: "adicionados",
        updated: "atualizados",
        removed: "removidos",
        errors: "erros",
      };
      translatedBody =
        Object.entries(labels)
          .filter(([key]) => typeof p[key] === "number")
          .map(([key, label]) => `${p[key]} ${label}`)
          .join(" · ") || body;
    }
    if (message.messageKey === "index.failed")
      translatedBody =
        p.previousIndexPreserved === true
          ? "Índice anterior preservado. Verifique as pastas configuradas e tente novamente."
          : "Atualização do índice interrompida. Verifique o diagnóstico e tente novamente.";
    if (
      message.messageKey === "budget.crossed" &&
      typeof p.spentUsd === "number" &&
      typeof p.budgetUsd === "number"
    )
      translatedBody = `${p.spentUsd.toLocaleString(locale, { style: "currency", currency: "USD" })} utilizados de ${p.budgetUsd.toLocaleString(locale, { style: "currency", currency: "USD" })}.`;
    if (fixed[message.messageKey]) return { title: fixed[message.messageKey]!, body: translatedBody };
    if (message.messageKey === "routine.alert" && p.reason === "budget")
      return {
        title,
        body: `Execução adiada: orçamento diário de US$ ${p.budgetUsd ?? "?"} comprometido; US$ ${p.spentUsd ?? "?"} gastos ou reservados.`,
      };
    switch (message.messageKey) {
      case "sentinel.silentRoutine":
        return {
          title: `A rotina “${p.name ?? ""}” parou de executar`,
          body: `${p.neverRun ? "Nunca executou; criada há" : "Última execução há"} ${p.hours ?? "?"} h. Intervalo previsto: ${p.interval ?? "?"}.${p.failed ? " As execuções recentes falharam." : ""}`,
        };
      case "sentinel.repeatedFailure":
        return {
          title: `${p.label ?? "Tarefa"}: ${p.count ?? "?"} falhas`,
          body: `O mesmo trabalho falhou ${p.count ?? "?"} vezes nas últimas 24 horas. Revise a última execução antes de tentar novamente.`,
        };
      case "sentinel.fsWatch":
        return {
          title: `${p.count ?? "?"} arquivos alterados`,
          body: `Alterações em ${p.folder ?? ""}. O índice de memória está sendo atualizado.`,
        };
      case "sentinel.connectorDelta":
        return {
          title: `${p.count ?? "?"} novos itens em ${p.name ?? "conector"}`,
          body: "A leitura do conector encontrou novos itens.",
        };
    }
    // Unknown structured events retain authored text; no guessing by title.
    return { title, body };
  }
  const titles: Record<string, string> = {
    "Run failed": "A execução falhou",
    "Run timed out": "A execução excedeu o tempo limite",
    "Index failed": "A indexação falhou",
    "Index finished": "Indexação concluída",
    "Backup created": "Backup criado",
    "Approval requested": "Aprovação solicitada",
    "Routine alert": "Rotina precisa de atenção",
    "Daily budget exceeded": "Orçamento diário excedido",
    "Daily budget 80% used": "80% do orçamento diário utilizado",
    "You did this twice — make it a skill?": "Tarefa recorrente — transformar em skill?",
  };
  const routine = /^Routine "(.*)" went quiet$/.exec(title);
  const translatedTitle = titles[title] ?? (routine ? `A rotina “${routine[1]}” parou de executar` : title);
  let translatedBody = body;
  if (title === "Index finished") {
    translatedBody = body
      ?.replace(/\bscanned\b/g, "verificados")
      .replace(/\badded\b/g, "adicionados")
      .replace(/\bupdated\b/g, "atualizados")
      .replace(/\bremoved\b/g, "removidos")
      .replace(/\berrors\b/g, "erros");
  } else if (title === "Index failed") {
    const messages: Record<string, string> = {
      "Previous index preserved. Check configured folders and retry.":
        "Índice anterior preservado. Verifique as pastas configuradas e tente novamente.",
      "Index update interrupted. Check diagnostics and retry.":
        "Atualização do índice interrompida. Verifique o diagnóstico e tente novamente.",
    };
    translatedBody = body === undefined ? undefined : (messages[body] ?? body);
  } else if (routine) {
    translatedBody = body
      ?.replace(
        /^It has never run, (\d+) h after it was created, and its schedule expects every (.+)\.$/,
        "Nunca executou, mesmo após $1 h da criação. Intervalo previsto: $2.",
      )
      .replace(
        /^Last run was (\d+) h ago; its schedule expects every (.+?)\./,
        "Última execução há $1 h. Intervalo previsto: $2.",
      )
      .replace(" Its recent runs failed.", " As execuções recentes falharam.");
  }
  return { title: translatedTitle, body: translatedBody };
}
