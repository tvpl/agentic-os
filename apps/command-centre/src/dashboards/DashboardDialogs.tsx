/**
 * The two dialogs of the dashboards (.specs/features/cerebro-paineis, design.md "Página"): "Novo painel" (three
 * cards: the overview, a context's, a question's) and "Personalizar" (show, hide and reorder the widgets of the
 * definition, saved by `PUT /api/dashboards/:id` with the version that was read; a conflict says so and reloads).
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { GripVertical } from "lucide-react";
import { ApiError } from "../api";
import { apiCall } from "../apiCall";
import { useT } from "../i18n";
import { useOsContexts } from "../queries";
import { Modal, Switch } from "../ui";
import { errorMessage } from "../views/shared";
import type { CreateInput, DefWidget, Definition } from "./dashboardsData";

export type NewChoice = "overview" | "area" | "question";
const QUESTION_MAX = 500;

export function NewDashboardDialog({
  initial,
  onCreate,
  onClose,
}: {
  initial: NewChoice;
  onCreate: (input: CreateInput) => Promise<unknown>;
  onClose: () => void;
}) {
  const t = useT();
  const contexts = useOsContexts();
  const list = contexts.data?.contexts ?? [];
  const [choice, setChoice] = useState<NewChoice>(initial);
  const [contextId, setContextId] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picked = contextId || list[0]?.id || "";
  const ready =
    choice === "overview" ||
    (choice === "area" && picked !== "") ||
    (choice === "question" && question.trim().length > 0 && question.trim().length <= QUESTION_MAX);
  const submit = async () => {
    if (!ready) return;
    const input: CreateInput =
      choice === "overview"
        ? { template: "overview" }
        : choice === "area"
          ? { template: "area", contextId: picked }
          : { template: "question", question: question.trim() };
    setBusy(true);
    setError(null);
    try {
      await onCreate(input);
      onClose();
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };
  const card = (value: NewChoice, title: string, body: ReactNode) => (
    <div className="dsh-new-card" data-choice={value} data-chosen={choice === value ? "" : undefined}>
      <label className="dsh-new-pick">
        <input type="radio" name="dsh-new" checked={choice === value} onChange={() => setChoice(value)} />
        <span className="dsh-new-t">{title}</span>
      </label>
      {body}
    </div>
  );
  return (
    <Modal title={t("dash.new")} onClose={onClose} className="dsh-modal">
      <div className="dsh-new">
        {card("overview", t("dash.new.overview"), null)}
        {card(
          "area",
          t("scene.brain.context"),
          !contexts.data ? null : list.length === 0 ? (
            <Link className="dsh-link" to="/settings?tab=memory">
              {t("dash.new.needContext")}
            </Link>
          ) : (
            <select
              className="input dsh-new-field"
              aria-label={t("scene.brain.context")}
              value={picked}
              onChange={(e) => {
                setContextId(e.target.value);
                setChoice("area");
              }}
            >
              {list.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ),
        )}
        {card(
          "question",
          t("dash.kind.question"),
          <textarea
            className="input dsh-new-field"
            aria-label={t("dash.kind.question")}
            maxLength={QUESTION_MAX}
            rows={3}
            value={question}
            onChange={(e) => {
              setQuestion(e.target.value);
              setChoice("question");
            }}
          />,
        )}
      </div>
      {error && (
        <p className="dsh-dialog-msg" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" className="btn primary" disabled={!ready || busy} onClick={() => void submit()}>
          {t("dash.create")}
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          {t("dash.cancel")}
        </button>
      </div>
    </Modal>
  );
}

type Item = { widget: DefWidget; shown: boolean };
const itemsOf = (d: Definition): Item[] =>
  d.widgets.map((w) => ({ widget: w, shown: w.options?.hidden !== true }));

/** A widget with `hidden` as chosen: `true` when hidden, the key gone when shown. */
function withShown({ widget, shown }: Item): DefWidget {
  const { hidden: _hidden, ...rest } = widget.options ?? {};
  const options = shown ? rest : { ...rest, hidden: true };
  const { options: _old, ...bare } = widget;
  return Object.keys(options).length > 0 || widget.options ? { ...bare, options } : bare;
}

export function CustomizeDialog({
  id,
  definition,
  version,
  onSaved,
  onReload,
  onClose,
}: {
  id: string;
  definition: Definition;
  version: string;
  onSaved: (definition: Definition, version: string) => void;
  onReload: () => Promise<{ definition: Definition; version: string } | undefined>;
  onClose: () => void;
}) {
  const t = useT();
  const [base, setBase] = useState({ definition, version });
  const [items, setItems] = useState<Item[]>(() => itemsOf(definition));
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const focusId = useRef<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (focusId.current === null) return;
    list.current?.querySelector<HTMLElement>(`[data-widget="${focusId.current}"]`)?.focus();
    focusId.current = null;
  });
  const move = (event: KeyboardEvent, i: number) => {
    if (event.target !== event.currentTarget) return;
    const to = event.key === "ArrowDown" ? i + 1 : event.key === "ArrowUp" ? i - 1 : -1;
    if (to < 0 || to >= items.length || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
    event.preventDefault();
    const next = [...items];
    const [it] = next.splice(i, 1);
    next.splice(to, 0, it!);
    focusId.current = it!.widget.id;
    setItems(next);
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const answer = await apiCall("PUT /api/dashboards/:id", {
        params: { id },
        body: {
          definition: { ...base.definition, widgets: items.map(withShown) },
          baseVersion: base.version,
        },
      });
      onSaved(answer.definition, answer.version);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "edit_conflict") setConflict(true);
      else setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };
  const reload = async () => {
    const fresh = await onReload();
    if (!fresh) return;
    setBase(fresh);
    setItems(itemsOf(fresh.definition));
    setConflict(false);
  };
  return (
    <Modal title={t("dash.customize")} onClose={onClose} className="dsh-modal">
      <ul className="dsh-custom" ref={list}>
        {items.map((item, i) => (
          <li key={item.widget.id} className="dsh-custom-row">
            <button
              type="button"
              className="btn ghost sm icon-only dsh-custom-grip"
              data-widget={item.widget.id}
              aria-label={item.widget.title}
              onKeyDown={(e) => move(e, i)}
            >
              <GripVertical aria-hidden />
            </button>
            <span className="dsh-custom-t">{item.widget.title}</span>
            <label className="dsh-custom-show">
              <Switch
                checked={item.shown}
                aria-label={`${t("dash.customize.show")} ${item.widget.title}`}
                onCheckedChange={(shown) =>
                  setItems((all) => all.map((x, j) => (j === i ? { ...x, shown } : x)))
                }
              />
              <span>{t("dash.customize.show")}</span>
            </label>
          </li>
        ))}
      </ul>
      {conflict && (
        <div className="dsh-dialog-msg" role="alert">
          <span>{t("dash.customize.conflict")}</span>
          <button type="button" className="btn sm" onClick={() => void reload()}>
            {t("dash.reload")}
          </button>
        </div>
      )}
      {error && (
        <p className="dsh-dialog-msg" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" className="btn primary" disabled={busy || conflict} onClick={() => void save()}>
          {t("common.save")}
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          {t("dash.cancel")}
        </button>
      </div>
    </Modal>
  );
}
