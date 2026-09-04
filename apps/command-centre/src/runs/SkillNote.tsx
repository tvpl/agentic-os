/**
 * "Save as note" (plan Onda 4, agent notes): after a skill run finishes, one
 * line the next run should know goes into the skill's NOTES.md. The catalog
 * reads that file into every run prompt, so lessons compound without editing
 * SKILL.md.
 */
import { useState } from "react";
import { NotebookPen } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type RunRecord } from "../api";
import { useT } from "../i18n";
import { qk, useApiQuery } from "../queries";
import { useToast } from "../components/ui";
import { Button } from "../components/primitives";

/** Bullet lines of NOTES.md, newest last (the file is append-only). */
export function noteLines(notes: string): string[] {
  return notes
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim());
}

export function SkillNoteCard({ run }: { run: RunRecord }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const slug = run.skillSlug ?? "";
  const notes = useApiQuery<{ notes: string; path: string }>(
    qk.skillNotes(slug),
    `/api/skills/${encodeURIComponent(slug)}/notes`,
    { enabled: slug.length > 0 },
  );
  const [text, setText] = useState("");
  const save = useMutation({
    mutationFn: (body: string) =>
      api.post<{ notes: string }>(`/api/skills/${encodeURIComponent(slug)}/notes`, {
        text: body,
        runId: run.id,
      }),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: qk.skillNotes(slug) }).catch(() => undefined);
      toast(t("runs.note.saved", { slug }), "ok");
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  if (!slug || run.status === "running" || run.status === "queued") return null;
  const recent = noteLines(notes.data?.notes ?? "")
    .slice(-3)
    .reverse();
  return (
    <div className="card skill-note">
      <div className="card-head-row">
        <h2>
          <NotebookPen size={16} aria-hidden /> {t("runs.note.title")}
        </h2>
        <span className="widget-muted">
          {t("runs.note.count", { n: noteLines(notes.data?.notes ?? "").length })}
        </span>
      </div>
      <p className="hint">{t("runs.note.hint")}</p>
      {recent.length > 0 && (
        <ul className="skill-note-recent">
          {recent.map((l, i) => (
            <li key={i}>{l.replace(/^\*\*[^*]+\*\*\s*(\([^)]*\))?:\s*/, "")}</li>
          ))}
        </ul>
      )}
      <textarea
        rows={2}
        value={text}
        placeholder={t("runs.note.placeholder")}
        onChange={(e) => setText(e.target.value)}
        maxLength={4000}
      />
      <div className="squad-form-row">
        <Button
          size="sm"
          variant="primary"
          disabled={!text.trim() || save.isPending}
          onClick={() => save.mutate(text)}
        >
          {t("runs.note.save")}
        </Button>
      </div>
    </div>
  );
}
