import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../api";
import { qk, useInvalidate } from "../../queries";
import { useT } from "../../i18n";
import { Modal, useToast } from "../../components/ui";
import { Button, Field } from "../../components/primitives";
import { errorMessage, SLUG_RE, slugify } from "../shared";

export default function NewSkillModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [name, setName] = useState("");
  const [slugValue, setSlugValue] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<"read_only" | "write">("read_only");
  const [body, setBody] = useState(() => t("skills.bodyTemplate"));

  const derived = slugify(name);
  const slug = slugValue.trim() || derived;
  const slugValid = SLUG_RE.test(slug);
  const slugError = (slugTouched || slugValue.trim() !== "" || (name.trim() !== "" && !slugValid)) && !slugValid ? t("skills.slugInvalid") : undefined;

  const create = useMutation({
    mutationFn: () =>
      api.post("/api/skills", {
        frontmatter: { name: name.trim(), slug, description: description.trim(), mode, triggers: [`/${slug}`] },
        body,
      }),
    onSuccess: async () => {
      await invalidate(qk.skills);
      toast(t("skills.created", { name: name.trim() }), "ok");
      onCreated();
    },
    onError: (err) => toast(errorMessage(err), "danger"),
  });

  const canSave = name.trim() !== "" && description.trim() !== "" && slugValid && !create.isPending;

  return (
    <Modal title={t("skills.new")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) create.mutate();
        }}
      >
        <Field label={t("skills.name")} htmlFor="ns-name">
          <input id="ns-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        <Field
          label={t("skills.slug")}
          htmlFor="ns-slug"
          hint={slugValue.trim() === "" && derived ? t("skills.slugAuto", { slug: derived }) : t("skills.slugHint")}
          error={slugError}
        >
          <input
            id="ns-slug"
            className="input mono"
            placeholder={derived || "my-skill"}
            value={slugValue}
            aria-invalid={slugError ? true : undefined}
            onChange={(e) => setSlugValue(e.target.value.toLowerCase())}
            onBlur={() => setSlugTouched(true)}
          />
        </Field>
        <Field label={t("common.description")} htmlFor="ns-desc">
          <textarea id="ns-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label={t("common.mode")} htmlFor="ns-mode">
          <select id="ns-mode" className="input" value={mode} onChange={(e) => setMode(e.target.value as "read_only" | "write")}>
            <option value="read_only">{t("skills.mode.read_only")}</option>
            <option value="write">{t("skills.mode.write")}</option>
          </select>
        </Field>
        <Field label="SKILL.md" htmlFor="ns-body" hint={t("skills.bodyHint")}>
          <textarea id="ns-body" className="input mono tall" value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={create.isPending} disabled={!canSave}>
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
