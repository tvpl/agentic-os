/**
 * A question the agent asked you, answerable where it is: in the
 * conversation and in the pendências. Options are choices you tap (several
 * when the agent allows it), any question can be answered in your own words,
 * and "Responder" sends the answers back to the agent, which carries on.
 * Not an approval box — the agent is talking to you.
 */
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Send } from "lucide-react";
import { type ApprovalRecord } from "../api";
import { apiCall } from "../apiCall";
import { useT } from "../i18n";
import { qk } from "../queries";
import { useToast } from "../components/ui";
import { answersFor, complete, questionsOf } from "./question";

export default function QuestionCard({
  approval,
  compact = false,
  onAnswered,
}: {
  approval: ApprovalRecord;
  compact?: boolean;
  onAnswered?: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const questions = useMemo(() => questionsOf(approval) ?? [], [approval]);
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [written, setWritten] = useState<Record<string, string>>({});
  const answers = answersFor(questions, picks, written);
  const ready = complete(questions, answers);
  const send = useMutation({
    mutationFn: (decision: "approved" | "denied") =>
      apiCall("POST /api/approvals/:id/resolve", {
        params: { id: approval.id },
        body: {
          decision,
          ...(decision === "approved" ? { answers } : {}),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.approvals }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: ["runs"] }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: ["sessions"] }).catch(() => undefined);
      onAnswered?.();
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const toggle = (q: string, label: string, multi: boolean) =>
    setPicks((cur) => {
      const now = cur[q] ?? [];
      const next = multi ? (now.includes(label) ? now.filter((x) => x !== label) : [...now, label]) : [label];
      return { ...cur, [q]: next };
    });

  return (
    <form
      className={`nu-ask${compact ? " compact" : ""}`}
      data-testid="agent-question"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !send.isPending) send.mutate("approved");
      }}
    >
      {questions.map((q, qi) => {
        const chosen = picks[q.question] ?? [];
        const id = `ask-${approval.id}-${qi}`;
        return (
          <fieldset key={q.question} className="nu-ask-q">
            <legend>
              {q.header && <span className="nu-ask-h mono">{q.header}</span>}
              <span className="nu-ask-t">{q.question}</span>
            </legend>
            {q.options.length > 0 && (
              <div className="nu-ask-opts" role={q.multiSelect ? "group" : "radiogroup"}>
                {q.options.map((o) => {
                  const on = chosen.includes(o.label);
                  return (
                    <button
                      key={o.label}
                      type="button"
                      role={q.multiSelect ? "checkbox" : "radio"}
                      aria-checked={on}
                      className={`nu-ask-opt${on ? " on" : ""}`}
                      onClick={() => toggle(q.question, o.label, q.multiSelect)}
                    >
                      <span className="mk" aria-hidden>
                        {on && <Check />}
                      </span>
                      <span className="lb">{o.label}</span>
                      {o.description && !compact && <span className="ds">{o.description}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <label className="nu-ask-own" htmlFor={id}>
              <span className="sr-only">{t("nucleo.ask.own")}</span>
              <input
                id={id}
                className="input"
                placeholder={t(q.options.length > 0 ? "nucleo.ask.other" : "nucleo.ask.own")}
                value={written[q.question] ?? ""}
                onChange={(e) => setWritten((cur) => ({ ...cur, [q.question]: e.target.value }))}
              />
            </label>
          </fieldset>
        );
      })}
      <div className="nu-ask-acts">
        <button type="submit" className="nu-act primary" disabled={!ready || send.isPending}>
          <Send aria-hidden />
          <span>{t("nucleo.ask.send")}</span>
        </button>
        <button
          type="button"
          className="nu-act"
          disabled={send.isPending}
          onClick={() => send.mutate("denied")}
        >
          <span>{t("nucleo.ask.skip")}</span>
        </button>
      </div>
    </form>
  );
}
