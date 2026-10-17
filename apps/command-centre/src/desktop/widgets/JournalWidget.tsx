/**
 * The agent's day (refino item 35): today's journal, section by section,
 * with a line you can add yourself. Runs write here; the briefing reads
 * from here.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiCall } from "../../apiCall";
import { useT } from "../../i18n";
import { useApiQuery } from "../../queries";
import { EmptyState } from "../../components/primitives";
import { useToast } from "../../components/ui";
import { WidgetGate } from "./WidgetGate";
import type { WidgetProps } from "../widgetTypes";

interface JournalDay {
  date: string;
  content: string;
  sections: Array<{ name: string; lines: string[] }>;
}
interface JournalPayload {
  today: string;
  days: JournalDay[];
}

export default function JournalWidget(_props: WidgetProps) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const journal = useApiQuery<JournalPayload>(["memory", "journal", 1], "/api/memory/journal?days=1", {
    refetchInterval: 120_000,
  });
  const append = useMutation({
    mutationFn: (line: string) =>
      apiCall("POST /api/memory/journal/append", { body: { text: line, section: "Today" } }),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["memory", "journal"] }).catch(() => undefined);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const today = journal.data?.days.find((d) => d.date === journal.data?.today) ?? journal.data?.days[0];
  const sections = (today?.sections ?? []).filter((s) => s.lines.some((l) => l.trim()));
  return (
    <WidgetGate queries={[journal]} lines={3}>
      <div className="journal">
        {sections.length === 0 ? (
          <EmptyState
            className="compact"
            title={t("desktop.journal.empty")}
            body={t("desktop.journal.emptyBody")}
          />
        ) : (
          sections.map((s) => (
            <div key={s.name} className="journal-section">
              <p className="cp">{s.name}</p>
              <ul>
                {s.lines
                  .filter((l) => l.trim())
                  .slice(-12)
                  .map((l, i) => (
                    <li key={i}>{l.replace(/^[-*]\s+/, "")}</li>
                  ))}
              </ul>
            </div>
          ))
        )}
        <form
          className="journal-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) append.mutate(text.trim());
          }}
        >
          <input
            className="input sm"
            value={text}
            placeholder={t("desktop.journal.addPh")}
            aria-label={t("desktop.journal.addPh")}
            onChange={(e) => setText(e.target.value)}
          />
        </form>
      </div>
    </WidgetGate>
  );
}
