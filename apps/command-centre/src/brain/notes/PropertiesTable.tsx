/**
 * The properties of a note (.specs/features/cerebro-vista-notas, AC 26, AC 32-36, AC 56; design.md "Área de leitura",
 * item 3): a two-column table right below the note's header. Each key carries the icon of its kind; its value is edited
 * in place (Enter or leaving the field writes it through `PUT /api/memory/notes/properties`, Esc puts it back): text, tag
 * chips each with its "remover", a date, a `<select>` for `status`, `natureza` and `escopo`, `review_every` with its
 * suggestions. Each row's menu has "Remover"; "+ Adicionar propriedade" asks the key and the kind. The lines the reader
 * does not understand are shown as they are, read-only. A note that cannot be edited, or whose text has unsaved
 * changes, has a table that only reads; a write the disk overtook shows the conflict banner of cerebro-v2.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  CircleDot,
  ListChecks,
  MoreHorizontal,
  Repeat,
  Tag,
  Text,
  X,
  type LucideIcon,
} from "lucide-react";
import { ApiError } from "../../api";
import { apiCall } from "../../apiCall";
import { useT, type TKey } from "../../i18n";
import { Button } from "../../components/primitives";
import { DropdownMenu } from "../../ui";
import { errorMessage } from "../../views/shared";
import { ConflictBanner } from "./NoteEditInPlace";
import type { NoteDoc, NoteProperty } from "./notesData";
import type { NoteMeta } from "./useNotesState";

type Kind = NoteProperty["kind"];
type Value = NoteProperty["value"];
interface Change {
  set?: Record<string, Value>;
  remove?: string[];
}

const ICON: Record<Kind, LucideIcon> = {
  text: Text,
  list: Tag,
  date: Calendar,
  status: CircleDot,
  select: ListChecks,
  interval: Repeat,
};
/** The fixed kind of a known key (door 3); any other key is text. */
export const KIND_OF: Readonly<Record<string, Kind>> = {
  tags: "list",
  aliases: "list",
  created: "date",
  updated: "date",
  last_reviewed: "date",
  due: "date",
  status: "status",
  natureza: "select",
  escopo: "select",
  review_every: "interval",
};
const KIND_LABEL: Record<Kind, TKey> = {
  text: "notes.props.kind.text",
  list: "notes.props.kind.list",
  date: "notes.props.kind.date",
  status: "notes.props.kind.status",
  select: "notes.props.kind.select",
  interval: "notes.props.kind.interval",
};
const STATUS = ["active", "draft", "paused", "done", "archived"];
const CHOICES: Readonly<Record<string, ReadonlyArray<readonly [string, TKey]>>> = {
  natureza: [
    ["fato", "notes.callout.fato"],
    ["opiniao", "notes.callout.opiniao"],
    ["plano", "notes.callout.plano"],
    ["hipotese", "notes.callout.hipotese"],
    ["relato", "notes.callout.relato"],
  ],
  escopo: [
    ["pessoal", "notes.props.pessoal"],
    ["equipe", "notes.props.equipe"],
    ["externo", "notes.props.externo"],
  ],
};
const INTERVALS = ["7d", "30d", "90d", "180d", "365d", "never"];
const INTERVAL = /^([1-9][0-9]{0,2}d|never)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[a-z][a-z0-9_-]{0,39}$/;

export interface PropertiesTableProps {
  note: NoteDoc;
  /** The note's title, for the name of a copy. */
  title: string;
  /** The body has unsaved changes in the editor: the table only reads (AC 35). */
  locked: boolean;
  onOpen: (path: string, meta: NoteMeta) => void;
}

export function PropertiesTable({ note, title, locked, onOpen }: PropertiesTableProps) {
  const t = useT();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<"idle" | "saving" | "conflict" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [lost, setLost] = useState<Change | null>(null);
  const [adding, setAdding] = useState(false);
  const key = ["memory", "note", note.path];
  const canEdit = note.editable && !locked && phase !== "conflict";

  const send = async (change: Change): Promise<boolean> => {
    setPhase("saving");
    setMessage(null);
    try {
      const done = await apiCall("PUT /api/memory/notes/properties", {
        body: { path: note.path, baseVersion: note.version, ...change },
      });
      qc.setQueryData<NoteDoc>(key, (old) => old && { ...old, ...done });
      void qc.invalidateQueries({ queryKey: key });
      setPhase("idle");
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === "edit_conflict") {
        setLost(change);
        setPhase("conflict");
      } else {
        setMessage(errorMessage(err, t));
        setPhase("error");
      }
      return false;
    }
  };
  const reload = () => {
    void qc.invalidateQueries({ queryKey: key });
    setLost(null);
    setPhase("idle");
  };
  /** "Salvar como cópia": the note as it was read, with the change, as a new note beside it. */
  const saveAsCopy = async () => {
    try {
      const copy = await apiCall("POST /api/memory/notes", {
        body: { title: `${title} ${t("note.copySuffix")}` },
      });
      const written = await apiCall("PUT /api/memory/notes", {
        body: { path: copy.path, content: note.content, baseVersion: copy.version },
      });
      await apiCall("PUT /api/memory/notes/properties", {
        body: { path: copy.path, baseVersion: written.version, ...lost },
      });
      void qc.invalidateQueries({ queryKey: ["memory"] });
      reload();
      onOpen(copy.path, {});
    } catch (err) {
      setMessage(errorMessage(err, t));
    }
  };

  return (
    <section className="notes-props" aria-label={t("notes.props.label")}>
      {phase === "conflict" && (
        <ConflictBanner message={message} onReload={reload} onCopy={() => void saveAsCopy()} />
      )}
      {note.editable && locked && <p className="notes-props-note">{t("notes.props.locked")}</p>}
      {note.properties.length > 0 && (
        <table className="notes-props-table">
          <tbody>
            {note.properties.map((p) => (
              <Row
                key={p.key}
                prop={p}
                editable={canEdit}
                onSet={(value) => send({ set: { [p.key]: value } })}
                onRemove={() => void send({ remove: [p.key] })}
              />
            ))}
          </tbody>
        </table>
      )}
      {note.otherProperties !== null && (
        <div className="notes-props-other">
          <div className="notes-props-head">{t("notes.props.other")}</div>
          <pre className="mono">{note.otherProperties}</pre>
        </div>
      )}
      {phase === "error" && message && (
        <p className="notes-props-note notes-props-error" role="alert">
          {message}
        </p>
      )}
      {note.editable &&
        !locked &&
        (adding ? (
          <AddProperty
            disabled={!canEdit}
            onAdd={async (k, value) => (await send({ set: { [k]: value } })) && setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button
            type="button"
            className="notes-props-add"
            disabled={!canEdit}
            onClick={() => setAdding(true)}
          >
            {t("notes.props.add")}
          </button>
        ))}
    </section>
  );
}

function Row({
  prop,
  editable,
  onSet,
  onRemove,
}: {
  prop: NoteProperty;
  editable: boolean;
  onSet: (value: Value) => Promise<boolean>;
  onRemove: () => void;
}) {
  const t = useT();
  const Icon = ICON[prop.kind];
  return (
    <tr>
      <th scope="row">
        <Icon aria-hidden />
        <span>{prop.key}</span>
      </th>
      <td>
        <div className="notes-prop-value">
          <ValueOf prop={prop} editable={editable} onSet={onSet} />
          {editable && (
            <DropdownMenu
              tip={t("notes.props.menu", { key: prop.key })}
              items={[{ id: "remove", label: t("notes.props.remove"), onSelect: onRemove }]}
              trigger={
                <button
                  type="button"
                  className="notes-icon-btn"
                  aria-label={t("notes.props.menu", { key: prop.key })}
                >
                  <MoreHorizontal aria-hidden />
                </button>
              }
            />
          )}
        </div>
      </td>
    </tr>
  );
}

const asText = (v: Value) => (Array.isArray(v) ? v.join(", ") : v);

function ValueOf({
  prop,
  editable,
  onSet,
}: {
  prop: NoteProperty;
  editable: boolean;
  onSet: (value: Value) => Promise<boolean>;
}) {
  const t = useT();
  const { key, kind, value } = prop;
  const label = t("notes.props.value", { key });
  if (kind === "list") {
    const items = Array.isArray(value) ? value : [value];
    return (
      <span className="notes-chips">
        {items.map((item) => (
          <span key={item} className="notes-chip">
            {item}
            {editable && (
              <button
                type="button"
                aria-label={t("notes.props.removeItem", { item })}
                onClick={() => void onSet(items.filter((x) => x !== item))}
              >
                <X aria-hidden />
              </button>
            )}
          </span>
        ))}
        {editable && (
          <InlineField
            value=""
            label={t("notes.props.addItem", { key })}
            onCommit={(v) => (v.trim() ? onSet([...items, v.trim()]) : Promise.resolve(true))}
          />
        )}
      </span>
    );
  }
  const text = asText(value);
  const choices = kind === "status" ? STATUS.map((s) => [s, s] as const) : CHOICES[key];
  if ((kind === "status" || kind === "select") && choices) {
    const named = (v: string) => {
      const c = choices.find(([x]) => x === v);
      return c ? (kind === "status" ? c[1] : t(c[1] as TKey)) : v;
    };
    if (!editable) return <span>{named(text)}</span>;
    // A value outside the list is shown and kept; the choice offers only the list (door 3).
    const known = choices.some(([x]) => x === text);
    return (
      <select
        className="input notes-prop-input"
        aria-label={label}
        value={text}
        onChange={(e) => void onSet(e.target.value)}
      >
        {!known && <option value={text}>{text}</option>}
        {choices.map(([v]) => (
          <option key={v} value={v}>
            {named(v)}
          </option>
        ))}
      </select>
    );
  }
  // A date read that is not AAAA-MM-DD (an instant, as "Nova nota" writes `created`) is text, kept as it is.
  if (!editable || (kind === "date" && !DATE.test(text))) return <span>{text}</span>;
  if (kind === "interval")
    return (
      <InlineField
        value={text}
        label={label}
        suggestions={INTERVALS}
        check={(v) => (INTERVAL.test(v) ? null : t("notes.props.interval"))}
        onCommit={onSet}
      />
    );
  return <InlineField value={text} label={label} type={kind === "date" ? "date" : "text"} onCommit={onSet} />;
}

/** A value edited where it is shown: Enter or leaving writes it, Esc puts it back with no request. */
function InlineField({
  value,
  label,
  type = "text",
  suggestions,
  check,
  onCommit,
}: {
  value: string;
  label: string;
  type?: "text" | "date";
  suggestions?: readonly string[];
  check?: (v: string) => string | null;
  onCommit: (v: string) => Promise<boolean>;
}) {
  const [v, setV] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const undo = useRef(false);
  const sent = useRef<string | null>(null);
  const id = useId();
  useEffect(() => {
    setV(value);
    sent.current = null;
  }, [value]);
  const commit = () => {
    if (v === value || v === sent.current) return setError(null);
    const why = check?.(v) ?? null;
    setError(why);
    if (why) return;
    sent.current = v;
    void onCommit(v).then((ok) => {
      if (!ok) sent.current = null;
      else if (value === "") setV("");
    });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      undo.current = true;
      setV(value);
      setError(null);
      e.currentTarget.blur();
    }
  };
  return (
    <span className="notes-prop-field">
      <input
        className="input notes-prop-input"
        type={type}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        list={suggestions ? `${id}-list` : undefined}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (undo.current) undo.current = false;
          else commit();
        }}
      />
      {suggestions && (
        <datalist id={`${id}-list`}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      {error && (
        <span className="notes-prop-error" id={`${id}-error`} role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

/** "+ Adicionar propriedade": the key, its kind (the fixed one of a known key), and a value before anything is sent. */
function AddProperty({
  disabled,
  onAdd,
  onCancel,
}: {
  disabled: boolean;
  onAdd: (key: string, value: Value) => Promise<unknown>;
  onCancel: () => void;
}) {
  const t = useT();
  const id = useId();
  const [key, setKey] = useState("");
  const [kind, setKind] = useState<Kind>("text");
  const [value, setValue] = useState("");
  const k = key.trim();
  const choices = kind === "status" ? STATUS.map((s) => [s, s] as const) : CHOICES[k];
  const ready = KEY.test(k) && value.trim() !== "" && !disabled;
  const add = () => {
    if (!ready) return;
    const v = value.trim();
    void onAdd(
      k,
      kind === "list"
        ? v
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
        : v,
    );
  };
  let input: ReactNode;
  if ((kind === "status" || kind === "select") && choices)
    input = (
      <select id={`${id}-v`} className="input" value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="">—</option>
        {choices.map(([v, name]) => (
          <option key={v} value={v}>
            {kind === "status" ? name : t(name as TKey)}
          </option>
        ))}
      </select>
    );
  else
    input = (
      <input
        id={`${id}-v`}
        className="input"
        type={kind === "date" ? "date" : "text"}
        list={kind === "interval" ? `${id}-list` : undefined}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
      />
    );
  return (
    <div className="notes-props-new" role="group" aria-label={t("notes.props.add")}>
      <label htmlFor={`${id}-k`}>{t("notes.props.key")}</label>
      <input
        id={`${id}-k`}
        className="input"
        value={key}
        autoComplete="off"
        onChange={(e) => {
          setKey(e.target.value);
          const fixed = KIND_OF[e.target.value.trim()];
          if (fixed) setKind(fixed);
        }}
      />
      <label htmlFor={`${id}-t`}>{t("notes.props.kind")}</label>
      <select id={`${id}-t`} className="input" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
        {(Object.keys(KIND_LABEL) as Kind[]).map((x) => (
          <option key={x} value={x}>
            {t(KIND_LABEL[x])}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-v`}>{t("notes.props.valueLabel")}</label>
      {input}
      {kind === "interval" && (
        <datalist id={`${id}-list`}>
          {INTERVALS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      <span className="notes-props-new-actions">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" variant="primary" disabled={!ready} onClick={add}>
          {t("notes.props.addThis")}
        </Button>
      </span>
    </div>
  );
}
