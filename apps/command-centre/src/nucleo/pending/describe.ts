/**
 * A pending item in words: the one line the hub and the queue show, and the
 * mono subject beside it. Translation happens here so every place says the
 * same thing.
 */
import type { TKey, TVars } from "../../i18n";
import { describeDecision } from "../../desktop/decision";
import { notificationText } from "../../hooks/notificationText";
import type { PendingItem } from "./model";
import { questionsOf } from "../question";

type T = (key: TKey, vars?: TVars) => string;

export interface PendingText {
  title: string;
  subject: string | null;
}

export function describePending(item: PendingItem, t: T): PendingText {
  switch (item.kind) {
    case "question": {
      const first = questionsOf(item.approval!)?.[0];
      return { title: first?.question ?? t("trace.asked"), subject: first?.header ?? null };
    }
    case "decision": {
      const d = describeDecision(item.approval!, t, t("runs.approve.title"));
      return { title: d.headline, subject: d.subject };
    }
    case "provider":
      return {
        title: t("nucleo.pending.provider", {
          provider: item.provider!.snapshot.displayName ?? item.provider!.snapshot.id,
          state: t(`gate.state.${item.provider!.problem}`),
        }),
        subject: null,
      };
    case "budget":
      return {
        title: t(item.budget!.tone === "over" ? "nucleo.pending.budgetOver" : "nucleo.pending.budgetWarn", {
          pct: Math.round(item.budget!.ratio * 100),
        }),
        subject: null,
      };
    case "failure": {
      const r = item.run!;
      return {
        title: r.skillSlug ? `/${r.skillSlug}` : r.promptSummary.slice(0, 80),
        subject: r.failure?.message ?? r.error ?? null,
      };
    }
    case "routine": {
      const r = item.routine!;
      return {
        title: t("nucleo.pending.routine", { name: r.name, n: r.recentFailures }),
        subject: r.lastStatus ? t(`status.${r.lastStatus}` as TKey) : null,
      };
    }
    case "notice": {
      // System notices are stored in English: say them in the UI's language,
      // the way the inbox does.
      const n = item.notice!;
      const lang = typeof document === "undefined" ? "en" : document.documentElement.lang || "en";
      const text = notificationText(n.title, n.body, lang, n);
      return { title: text.title, subject: text.body ?? null };
    }
  }
}
