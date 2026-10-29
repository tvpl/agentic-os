/**
 * Settings › Memory › Contexts (.specs/features/cerebro-contextos/design.md, "Tela - Configurações › Memória ›
 * Contextos"): one row per context with its id, its file count and each path with its state in icon and text; "Edit"
 * opens the dialog filled in, "Edit brief" opens the note editor on `_resumo.md` (made from the template when it is
 * missing) and "Delete" asks first, saying the notes stay.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, EyeOff, FolderX, Plus } from "lucide-react";
import { apiCall } from "../apiCall";
import { useLocale, useT, type TKey } from "../i18n";
import { qk } from "../queries";
import { Button } from "../components/primitives";
import { useToast } from "../components/ui";
import { useConfirm } from "../hooks/useConfirm";
import { openNoteEditor } from "../brain/noteEvents";
import { errorMessage } from "../views/shared";
import { NewContextDialog } from "./NewContextDialog";
import { useWorkContext, type WorkContextView } from "./useWorkContext";
import "./contexts.css";

const STATE: Record<WorkContextView["paths"][number]["state"], { icon: typeof Check; text: TKey }> = {
  ok: { icon: Check, text: "context.state.ok" },
  missing: { icon: FolderX, text: "context.state.missing" },
  not_indexed: { icon: EyeOff, text: "context.state.notIndexed" },
};

export function ContextsSettings() {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const work = useWorkContext();
  const [dialog, setDialog] = useState<{ editing?: WorkContextView } | null>(null);

  const editBrief = async (c: WorkContextView) => {
    try {
      const answer = await apiCall("PATCH /api/contexts/:id", {
        params: { id: c.id },
        body: { brief: true },
      });
      void qc.invalidateQueries({ queryKey: qk.contexts });
      if (answer.brief) openNoteEditor({ mode: "edit", path: answer.brief });
    } catch (err) {
      toast(errorMessage(err, t), "danger");
    }
  };
  const remove = async (c: WorkContextView) => {
    const ok = await confirm({
      title: t("context.delete.confirm", { name: c.name, dir: `memory/notes/${c.id}/` }),
      confirmLabel: t("context.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await apiCall("DELETE /api/contexts/:id", { params: { id: c.id } });
      // The server set the active context back to the whole brain when it named this one.
      await qc.invalidateQueries({ queryKey: qk.uiPreferences });
      await qc.invalidateQueries({ queryKey: qk.contexts });
    } catch (err) {
      toast(errorMessage(err, t), "danger");
    }
  };

  return (
    <section className="ctx-settings field" aria-labelledby="ctx-settings-t">
      <div className="ctx-settings-head">
        <span className="label" id="ctx-settings-t">
          {t("context.section")}
        </span>
        {work.contexts.length > 0 && (
          <Button size="sm" icon={<Plus aria-hidden />} onClick={() => setDialog({})}>
            {t("context.new")}
          </Button>
        )}
      </div>
      {work.list.isPending ? (
        <p className="ctx-settings-note">
          <span className="spinner sm" aria-hidden /> {t("common.loading")}
        </p>
      ) : work.list.isError ? (
        <div className="ctx-settings-note" role="alert">
          <span>{errorMessage(work.list.error, t)}</span>
          <Button size="sm" onClick={() => void work.list.refetch()}>
            {t("brain.links.retry")}
          </Button>
        </div>
      ) : work.contexts.length === 0 ? (
        <div className="ctx-settings-note">
          <span>{t("context.none")}</span>
          <Button size="sm" icon={<Plus aria-hidden />} onClick={() => setDialog({})}>
            {t("context.new")}
          </Button>
        </div>
      ) : (
        <ul className="ctx-rows">
          {work.contexts.map((c) => (
            <li key={c.id} className="ctx-row" data-context={c.id}>
              <div className="ctx-row-head">
                <span className="ctx-row-name">{c.name}</span>
                <span className="ctx-row-id mono">{c.id}</span>
                <span className="ctx-row-files">
                  {t("context.files", { n: c.files.toLocaleString(locale) })}
                </span>
              </div>
              <ul className="ctx-row-paths">
                {c.paths.map((p) => {
                  const state = STATE[p.state];
                  return (
                    <li key={p.path} className="ctx-row-path" data-state={p.state}>
                      <span className="mono ctx-row-path-t">{p.path}</span>
                      <span className="ctx-state">
                        <state.icon aria-hidden />
                        {t(state.text)}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="ctx-row-actions">
                <Button size="sm" onClick={() => setDialog({ editing: c })}>
                  {t("context.edit")}
                </Button>
                <Button size="sm" onClick={() => void editBrief(c)}>
                  {t("context.editBrief")}
                </Button>
                <Button size="sm" onClick={() => void remove(c)}>
                  {t("context.delete")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {dialog && <NewContextDialog editing={dialog.editing} onClose={() => setDialog(null)} />}
    </section>
  );
}
