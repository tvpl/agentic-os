/**
 * A skill that asks for inputs before it runs (redesign G3). The prototype's
 * form panel: the fields, the required ones marked, one "run" button, and
 * the promise printed under it — the result opens as a panel. Submitting
 * closes this plate and opens the trace in its place.
 */
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Play } from "lucide-react";

import { apiCall } from "../apiCall";
import { Button, Field } from "../components/primitives";
import { useToast } from "../components/ui";
import { useLang, useT } from "../i18n";
import { useOsSkills } from "../queries";
import { localizeSkill } from "../views/Skills/localize";
import { useDesktopActions } from "./actions";

export default function SkillInputsPanel({ slug, onDone }: { slug: string; onDone: () => void }) {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const { openRun, openPanel } = useDesktopActions();
  const skills = useOsSkills();
  const skill = useMemo(() => (skills.data ?? []).find((s) => s.slug === slug), [skills.data, slug]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);

  const missing = useMemo(
    () =>
      (skill?.inputs ?? []).filter((i) => i.required && !(values[i.name] ?? "").trim()).map((i) => i.name),
    [skill, values],
  );

  const run = useMutation({
    mutationFn: () => apiCall("POST /api/skills/:slug/run", { params: { slug }, body: { inputs: values } }),
    onSuccess: (res) => {
      onDone();
      if (res.status === "waiting_approval" || !res.runId) {
        toast(t("runs.approvalPending"), "info");
        openPanel("approvals");
        return;
      }
      openRun(res.runId);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  if (!skill) return <p className="dm-note">{t("common.loading")}</p>;
  const local = localizeSkill(skill, lang);

  return (
    <form
      className="skill-form"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (missing.length > 0) {
          document.getElementById(`${slug}-${missing[0]}`)?.focus();
          return;
        }
        run.mutate();
      }}
    >
      <p className="dm-note">{t("desktop.form.hint", { name: local.name })}</p>
      {skill.inputs.map((input) => {
        const id = `${slug}-${input.name}`;
        const value = values[input.name] ?? "";
        const bad = touched && missing.includes(input.name);
        const set = (v: string) => setValues((prev) => ({ ...prev, [input.name]: v }));
        const label = input.required ? `${input.label} *` : input.label;
        return (
          <Field
            key={input.name}
            label={label}
            htmlFor={id}
            error={bad ? t("desktop.form.required") : undefined}
          >
            {input.type === "textarea" ? (
              <textarea
                id={id}
                className={`input${bad ? " bad" : ""}`}
                rows={3}
                placeholder={input.placeholder}
                value={value}
                onChange={(e) => set(e.target.value)}
                aria-invalid={bad || undefined}
              />
            ) : input.type === "select" && input.options ? (
              <select
                id={id}
                className={`input${bad ? " bad" : ""}`}
                value={value}
                onChange={(e) => set(e.target.value)}
                aria-invalid={bad || undefined}
              >
                <option value="">—</option>
                {input.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                className={`input${bad ? " bad" : ""}`}
                type="text"
                placeholder={input.placeholder}
                value={value}
                onChange={(e) => set(e.target.value)}
                aria-invalid={bad || undefined}
              />
            )}
          </Field>
        );
      })}
      <div className="skill-form-foot">
        <Button type="submit" variant="primary" size="sm" icon={<Play aria-hidden />} loading={run.isPending}>
          {t("desktop.form.run")}
        </Button>
        <span className="dm-note">{t("desktop.form.opensAsPanel")}</span>
      </div>
    </form>
  );
}
