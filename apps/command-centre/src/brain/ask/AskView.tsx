/**
 * "Perguntar" (.specs/features/cerebro-perguntar, S5; design.md "Vista - Perguntar"): the owner asks the second brain
 * over `POST /api/memory/ask`, about the whole brain, a work context, a folder or some notes, directly or reasoning
 * first, and reads the answer `GET /api/memory/ask/:id` judges today, paragraph by paragraph with the sources each one
 * cites, the feedback on the owner's view, the provocation and how the answer was made. Below, the recent questions
 * (`GET /api/memory/ask`). The same screen is the frame's page at `/brain/ask` and the Núcleo's brain panel there; it is
 * a chunk of its own, fetched the first time it is opened (AC 54).
 */
import {
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Link, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  CircleCheck,
  CircleHelp,
  CircleSlash,
  ExternalLink,
  EyeOff,
  FileText,
  Loader,
  Lock,
  MessageSquare,
  MessageSquarePlus,
  PenLine,
  Plus,
  SearchX,
  Send,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ApiCallResult, AskMode, AskScope } from "@mordomo/contracts";
import { ApiError } from "../../api";
import { apiCall } from "../../apiCall";
import { useCommands, type Command } from "../../commands/registry";
import { Markdown } from "../../components/Markdown";
import { Field } from "../../components/primitives";
import { formatDuration, timeAgo } from "../../components/ui";
import { useWorkContext } from "../../contexts/useWorkContext";
import { AppRouteContext } from "../../desktop/appRoute";
import { useLang, useLocale, useT, type TKey } from "../../i18n";
import { qk, useOsSettings, useOsUiPreferences, useRouteQuery, useSaveUiPreferences } from "../../queries";
import { DropdownMenu, Popover, Tabs, type MenuEntry } from "../../ui";
import { errorMessage } from "../../views/shared";
import { parseMarkdown, type Block } from "../markdown";
import { NatureBadge } from "../natureza";
import { useBrainMode } from "../BrainViewSwitch";
import { Fold } from "../notes/Fold";
import { NotesTree } from "../notes/NotesTree";
import { useTreeLevel } from "../notes/notesData";
import "../notes/notes.css";
import { ASK_NOTE_PARAM } from "./askLink";
import "./ask.css";

export type AskDetail = ApiCallResult<"GET /api/memory/ask/:id">;
export type AskItem = ApiCallResult<"GET /api/memory/ask">["items"][number];
export type AskAnswer = NonNullable<AskDetail["answer"]>;
export type AskCitation = AskAnswer["paragraphs"][number]["citations"][number];
type T = ReturnType<typeof useT>;
/** What a question is sent with: the body of `POST /api/memory/ask`, `take` only in `reason_first`. */
export interface Asked {
  question: string;
  mode: AskMode;
  take: string;
  scope: AskScope;
}
/** A result with no ask to read: the recall abstained, the run was cancelled, or the request failed. */
type Local =
  | { kind: "abstained"; consulted: number; asked: Asked }
  | { kind: "cancelled" }
  | { kind: "error"; message: string; asked: Asked };

const QUESTION_MIN = 3;
const TAKE_MIN = 20;
const LIST_KEY = ["memory", "ask", "list"] as const;
const POLL_MS = 2_000;
/** The take's card shows six lines; a longer take has "Mostrar tudo". */
const TAKE_LINES = 6;
const TAKE_CHARS = 480;
const ALL: AskScope = { kind: "all" };

/** "Claude", "Cursor", "Codex": the provider's id as a name. */
export const providerName = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);
const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const overlaps = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
/** The rows a textarea shows: its lines, between `min` and `max`. */
const rowsFor = (text: string, min: number, max: number) =>
  Math.min(max, Math.max(min, text.split("\n").length));
/** The answer's text is prose (design.md "Resposta"): a heading reads as a paragraph. */
const prose = (text: string): Block[] =>
  parseMarkdown(text).map((b) => (b.type === "heading" ? { type: "paragraph", children: b.children } : b));

/** The label of a scope: the button, the abstention's "Procurei em …" and a recent question's line. */
export function scopeLabel(
  t: T,
  scope: AskScope,
  contexts: ReadonlyArray<{ id: string; name: string }>,
  active: string | null,
): string {
  if (scope.kind === "all") return t("ask.scope.all");
  if (scope.kind === "folder") return baseName(scope.path);
  if (scope.kind === "notes") return t("ask.scope.notes");
  const name = contexts.find((c) => c.id === scope.id)?.name ?? scope.id;
  return scope.id === active ? t("ask.scope.active", { name }) : name;
}

/** The route's own search: the panel's in the Núcleo, the router's in the frame. */
function useAskSearch(): string {
  const panel = useContext(AppRouteContext);
  const location = useLocation();
  return panel?.search ?? location.search;
}

export default function AskView() {
  const t = useT();
  const lang = useLang();
  const qc = useQueryClient();
  const work = useWorkContext();
  const prefs = useOsUiPreferences();
  const saveUi = useSaveUiPreferences();
  const settings = useOsSettings({ staleTime: 30_000 });
  const search = useAskSearch();
  const brain = useBrainMode();
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const fieldsRef = useRef<HTMLDivElement>(null);

  // The mode and the scope (AC 36, AC 37): the person's choice, else the last of this machine, else direct and the
  // active context (or the whole brain).
  const stored = prefs.data?.brain?.ask;
  const [ownMode, setOwnMode] = useState<AskMode | null>(null);
  const [ownScope, setOwnScope] = useState<AskScope | null>(null);
  const defaultScope: AskScope = work.active ? { kind: "context", id: work.active.id } : ALL;
  const mode: AskMode = ownMode ?? stored?.mode ?? "direct";
  const scope: AskScope = ownScope ?? (stored ? (stored.scope ?? ALL) : defaultScope);
  const remember = (next: { mode: AskMode; scope: AskScope }) => {
    setOwnMode(next.mode);
    setOwnScope(next.scope);
    void saveUi({ brain: { ask: next } }).catch(() => undefined);
  };

  const [question, setQuestion] = useState("");
  const [take, setTake] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  /** An ask opened from the list (or the one in progress): its fields only read. */
  const [readOnly, setReadOnly] = useState(false);
  const [local, setLocal] = useState<Local | null>(null);
  const [off, setOff] = useState(false);
  const [sending, setSending] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const scopeButton = useRef<HTMLButtonElement>(null);

  // "Perguntar sobre esta nota" (AC 50): `?note=` is the scope `notes` of that note, and the focus goes to the question.
  const noteParam = new URLSearchParams(search).get(ASK_NOTE_PARAM);
  useEffect(() => {
    if (!noteParam) return;
    setOwnScope({ kind: "notes", paths: [noteParam] });
    questionRef.current?.focus();
  }, [noteParam]);

  const detail = useRouteQuery(
    ["memory", "ask", openId],
    "GET /api/memory/ask/:id",
    { params: { id: openId ?? "" } },
    {
      enabled: openId !== null,
      refetchInterval: (q) => (q.state.data?.status === "running" ? POLL_MS : false),
    },
  );
  const list = useRouteQuery(LIST_KEY, "GET /api/memory/ask");
  const status = detail.data?.status;
  useEffect(() => {
    if (status !== undefined && status !== "running") void qc.invalidateQueries({ queryKey: LIST_KEY });
  }, [status, qc]);

  // An ask opened from the list shows its own question, mode and take (AC 48).
  const shown =
    readOnly && detail.data
      ? { question: detail.data.question, mode: detail.data.mode, take: detail.data.take ?? "" }
      : { question, mode, take };
  const missing: TKey | null =
    shown.mode === "reason_first" && take.trim().length < TAKE_MIN
      ? "ask.need.take"
      : question.trim().length < QUESTION_MIN
        ? "ask.need.question"
        : null;
  const canSend = !readOnly && !off && !sending && missing === null;

  const open = (id: string) => {
    setOpenId(id);
    setReadOnly(true);
    setLocal(null);
  };

  const submit = async (asked: Asked) => {
    setSending(true);
    setLocal(null);
    try {
      const body = {
        question: asked.question,
        mode: asked.mode,
        scope: asked.scope,
        ...(asked.mode === "reason_first" ? { take: asked.take } : {}),
      };
      const answer = await apiCall("POST /api/memory/ask", { body });
      if (answer.status === "abstained") {
        setOpenId(null);
        setLocal({ kind: "abstained", consulted: answer.consulted, asked });
      } else setOpenId(answer.id);
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    } catch (err) {
      if (err instanceof ApiError && err.code === "skill_unavailable") setOff(true);
      else if (err instanceof ApiError && err.code === "ask_in_progress") {
        // Another question is being answered (AC 47): open it, with no error.
        const now = await apiCall("GET /api/memory/ask").catch(() => null);
        const running = now?.items.find((i) => i.status === "running");
        if (running) open(running.id);
      } else setLocal({ kind: "error", message: errorMessage(err), asked });
    } finally {
      setSending(false);
    }
  };
  const send = () => {
    if (!canSend) return;
    void submit({ question: question.trim(), mode, take: take.trim(), scope });
  };
  const again = (asked: Asked) => {
    setQuestion(asked.question);
    setTake(asked.take);
    setReadOnly(false);
    void submit(asked);
  };
  const clear = () => {
    setQuestion("");
    setTake("");
    setReadOnly(false);
    setOpenId(null);
    setLocal(null);
    questionRef.current?.focus();
  };
  const fill = (text: string) => {
    if (readOnly) clear();
    setQuestion(text);
    questionRef.current?.focus();
  };

  // `Mod+Enter` inside a field of the view sends (design.md "Campos"; comandos-atalhos, scope `view:ask`).
  const live = useRef({ canSend, send });
  live.current = { canSend, send };
  const commands = useMemo<Command[]>(
    () => [
      {
        id: "ask.send",
        title: "ask.send",
        group: "view",
        scope: "view:ask",
        keys: ["Mod+Enter"],
        when: () => live.current.canSend && Boolean(fieldsRef.current?.contains(document.activeElement)),
        run: () => live.current.send(),
      },
    ],
    [],
  );
  useCommands(commands);

  const turnOn = async () => {
    const now = await apiCall("GET /api/settings");
    const skills = now.memorySkills.includes("brain-ask")
      ? now.memorySkills
      : [...now.memorySkills, "brain-ask"];
    await apiCall("PUT /api/settings", { body: { memorySkills: skills } });
    void qc.invalidateQueries({ queryKey: qk.settings });
    setOff(false);
  };

  const label = (s: AskScope) => scopeLabel(t, s, work.contexts, work.active?.id ?? null);
  const hidden = (settings.data?.folderAccess ?? []).filter((e) => e.agents === "hide").map((e) => e.path);
  const scopePaths: string[] | null =
    scope.kind === "all"
      ? null
      : scope.kind === "folder"
        ? [scope.path]
        : scope.kind === "notes"
          ? scope.paths
          : (work.contexts.find((c) => c.id === scope.id)?.paths.map((p) => p.path) ?? []);
  const showHidden =
    hidden.length > 0 && (scopePaths === null || scopePaths.some((p) => hidden.some((h) => overlaps(p, h))));

  const chooseScope = (next: AskScope) => remember({ mode, scope: next });
  const menu: MenuEntry[] = [
    ...(work.active
      ? [
          {
            id: "active",
            label: t("ask.scope.active", { name: work.active.name }),
            checked: scope.kind === "context" && scope.id === work.active.id,
            onSelect: () => chooseScope({ kind: "context", id: work.active!.id }),
          },
        ]
      : []),
    { id: "all", label: t("ask.scope.all"), checked: scope.kind === "all", onSelect: () => chooseScope(ALL) },
    ...work.contexts
      .filter((c) => c.id !== work.active?.id)
      .map((c) => ({
        id: `context:${c.id}`,
        label: c.name,
        checked: scope.kind === "context" && scope.id === c.id,
        onSelect: () => chooseScope({ kind: "context", id: c.id }),
      })),
    { id: "folder", label: t("ask.scope.folder"), onSelect: () => setFolderOpen(true) },
    ...(scope.kind === "notes"
      ? [{ id: "notes", label: t("ask.scope.notes"), checked: true, onSelect: () => undefined }]
      : []),
  ];
  const removeNote = (path: string) => {
    if (scope.kind !== "notes") return;
    const rest = scope.paths.filter((p) => p !== path);
    chooseScope(rest.length > 0 ? { kind: "notes", paths: rest } : defaultScope);
  };

  const ids = useId();
  const tabs = [
    { id: "direct", label: t("ask.mode.direct") },
    { id: "reason_first", label: t("ask.mode.reasonFirst") },
  ];
  const takeCount = take.trim().length;

  const fields = off ? (
    <Off onTurnOn={() => void turnOn()} />
  ) : (
    <div className="ask-fields" ref={fieldsRef}>
      {shown.mode === "reason_first" && (
        <Field
          htmlFor={`${ids}-take`}
          label={t("ask.take")}
          hint={
            takeCount < TAKE_MIN
              ? t("ask.take.short", { n: takeCount })
              : t("ask.take.count", { n: takeCount })
          }
        >
          <textarea
            id={`${ids}-take`}
            className="input"
            aria-describedby={`${ids}-take-hint`}
            rows={rowsFor(shown.take, 4, 12)}
            readOnly={readOnly}
            value={shown.take}
            onChange={(e) => setTake(e.target.value)}
          />
        </Field>
      )}
      <Field htmlFor={`${ids}-q`} label={t("ask.question")}>
        <textarea
          id={`${ids}-q`}
          ref={questionRef}
          className="input"
          rows={rowsFor(shown.question, 2, 6)}
          placeholder={t("ask.question.example")}
          readOnly={readOnly}
          value={shown.question}
          onChange={(e) => setQuestion(e.target.value)}
        />
      </Field>
      <div className="ask-send">
        {readOnly ? (
          <button type="button" className="btn primary" onClick={clear}>
            <Plus aria-hidden />
            {t("ask.new")}
          </button>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={!canSend}
            title={missing !== null ? t(missing) : undefined}
            onClick={send}
          >
            <Send aria-hidden />
            {t("ask.send")}
          </button>
        )}
      </div>
    </div>
  );

  let result: ReactNode = null;
  if (local?.kind === "cancelled")
    result = (
      <p className="ask-line" role="status">
        {t("ask.cancelled")}
      </p>
    );
  else if (local?.kind === "abstained")
    result = (
      <Abstained
        scope={label(local.asked.scope)}
        consulted={local.consulted}
        onAskAll={local.asked.scope.kind === "all" ? null : () => void submit({ ...local.asked, scope: ALL })}
      />
    );
  else if (local?.kind === "error")
    result = <Band title={local.message} onRetry={() => again(local.asked)} />;
  else if (openId !== null) {
    const d = detail.data;
    if (!d)
      result = detail.isError ? (
        <Band title={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />
      ) : (
        <p className="ask-line">
          <span className="spinner" aria-hidden />
          {t("ask.loading")}
        </p>
      );
    else if (d.status === "running")
      result = (
        <Answering
          provider={d.run.provider}
          onCancel={() =>
            void apiCall("POST /api/runs/:id/cancel", { params: { id: d.id } }).then(() => {
              setOpenId(null);
              setReadOnly(false);
              setLocal({ kind: "cancelled" });
              void qc.invalidateQueries({ queryKey: LIST_KEY });
            })
          }
        />
      );
    else if (d.status === "answered" && d.answer)
      result = (
        <Answer
          detail={d}
          answer={d.answer}
          onOpenNote={(id) => brain.go("graph", `?sel=${id}`)}
          onAskAbout={(text, path) => {
            setReadOnly(false);
            setQuestion(text);
            if (readOnly && d.mode === "reason_first") setTake(d.take ?? "");
            chooseScope({ kind: "notes", paths: [path] });
            questionRef.current?.focus();
          }}
        />
      );
    else {
      const asked: Asked = { question: d.question, mode: d.mode, take: d.take ?? "", scope: d.scope };
      result = (
        <Band
          title={t(d.status === "refused" ? "ask.refused" : "ask.failed")}
          reason={d.reason}
          onRetry={() => again(asked)}
        />
      );
    }
  }

  // Six regions, one under the other (design.md "Vista - Perguntar" 1-6): the mode's tabs and its hint are one region
  // and the fields, the tabs' panel, the next, so the tabs' root wraps the column (it lays nothing out).
  return (
    <div className="ask">
      <Tabs.Root
        value={shown.mode}
        onChange={(id) => !readOnly && remember({ mode: id as AskMode, scope })}
        ids={{ panel: () => `${ids}-panel` }}
      >
        <div className="ask-col">
          <header className="ask-head">
            <h1 className="ask-h1">{t("ask.title")}</h1>
            <p className="ask-small">{t("ask.lede")}</p>
          </header>

          <section className="ask-scope">
            <div className="ask-scope-row">
              <span className="ask-small">{t("ask.scope.about")}</span>
              <DropdownMenu
                align="start"
                items={menu}
                trigger={
                  <button type="button" className="btn sm" ref={scopeButton}>
                    {label(scope)}
                    <ChevronDown aria-hidden />
                  </button>
                }
              />
            </div>
            {scope.kind === "notes" && (
              <ul className="ask-chips">
                {scope.paths.map((p) => (
                  <li key={p} className="ask-chip">
                    <span>{baseName(p)}</span>
                    <button
                      type="button"
                      className="ask-chip-x"
                      aria-label={t("ask.scope.remove", { name: baseName(p) })}
                      onClick={() => removeNote(p)}
                    >
                      <X aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {showHidden && (
              <p className="ask-small ask-line">
                <EyeOff aria-hidden />
                <span>{t("ask.hidden")}</span>
              </p>
            )}
            <FolderPicker
              open={folderOpen}
              anchor={scopeButton}
              chosen={scope.kind === "folder" ? scope.path : null}
              onClose={() => setFolderOpen(false)}
              onChoose={(path) => chooseScope({ kind: "folder", path })}
            />
          </section>

          {off ? (
            fields
          ) : (
            <>
              <div className="ask-mode">
                <Tabs.List>
                  {tabs.map((tab) => (
                    <Tabs.Tab key={tab.id} value={tab.id}>
                      {tab.label}
                    </Tabs.Tab>
                  ))}
                </Tabs.List>
                {shown.mode === "reason_first" && <p className="ask-small">{t("ask.mode.hint")}</p>}
              </div>
              <Tabs.Panel>{fields}</Tabs.Panel>
            </>
          )}

          {result !== null && <div className="ask-result">{result}</div>}

          <Recent
            list={list}
            openId={openId}
            label={label}
            lang={lang}
            onOpen={open}
            onExample={fill}
            onRetry={() => void list.refetch()}
          />
        </div>
      </Tabs.Root>
    </div>
  );
}

/** "Respondendo" (design.md "Estados"): the spinner and the sentence in `role="status"`, "Cancelar", the cost. */
export function Answering({ provider, onCancel }: { provider: string; onCancel: () => void }) {
  const t = useT();
  return (
    <div className="ask-wait">
      <div className="ask-wait-row">
        <p className="ask-line" role="status">
          <span className="spinner" aria-hidden />
          <span>{t("ask.answering")}</span>
        </p>
        <button type="button" className="btn sm" onClick={onCancel}>
          {t("ask.cancel")}
        </button>
      </div>
      <p className="ask-small">{t("ask.answering.cost", { provider: providerName(provider) })}</p>
    </div>
  );
}

/** "Não encontrei" (AC 44): where it looked and how many files; "Perguntar em todo o cérebro" for a narrower scope. */
export function Abstained({
  scope,
  consulted,
  onAskAll,
}: {
  scope: string;
  consulted: number;
  onAskAll: (() => void) | null;
}) {
  const t = useT();
  return (
    <div className="ask-none">
      <p className="ask-line">
        <SearchX aria-hidden />
        <span>{t("ask.abstained")}</span>
      </p>
      <p className="ask-small">{t("ask.abstained.where", { scope, n: consulted })}</p>
      {onAskAll && (
        <button type="button" className="btn sm" onClick={onAskAll}>
          {t("ask.askAll")}
        </button>
      )}
    </div>
  );
}

/** "Desligado" (AC 46): in place of the fields, `Lock`, the sentence and "Ligar". */
export function Off({ onTurnOn }: { onTurnOn: () => void }) {
  const t = useT();
  return (
    <div className="ask-off">
      <p className="ask-line">
        <Lock aria-hidden />
        <span>{t("ask.off")}</span>
      </p>
      <button type="button" className="btn primary" onClick={onTurnOn}>
        {t("ask.turnOn")}
      </button>
    </div>
  );
}

/** The `role="alert"` band of a refused or failed ask (design.md "Estados"): the title, the reason, "Tentar de novo". */
export function Band({ title, reason, onRetry }: { title: string; reason?: string; onRetry: () => void }) {
  const t = useT();
  return (
    <div className="ask-band" role="alert">
      <AlertTriangle aria-hidden />
      <div className="ask-band-text">
        <p>{title}</p>
        {reason && <p className="ask-small">{reason}</p>}
      </div>
      <button type="button" className="btn sm" onClick={onRetry}>
        {t("ask.retry")}
      </button>
    </div>
  );
}

/** The citations of a paragraph or an item: `FileText` + `nome § seção`, the nature chip right after a labelled one. */
export function Cites({
  cites,
  onOpen,
}: {
  cites: readonly AskCitation[];
  onOpen: (fileId: number) => void;
}) {
  return (
    <div className="ask-cites">
      {cites.map((c, i) => (
        <span key={`${c.path}§${c.section}§${i}`} className="ask-cite-item">
          <button type="button" className="ask-cite" onClick={() => onOpen(c.fileId)}>
            <FileText aria-hidden />
            {`${c.name} § ${c.section}`}
          </button>
          {c.natureza && <NatureBadge n={c.natureza} dense />}
        </span>
      ))}
    </div>
  );
}

function Paragraphs({ items, onOpen }: { items: AskAnswer["paragraphs"]; onOpen: (fileId: number) => void }) {
  return (
    <div className="ask-pars">
      {items.map((p, i) => (
        <div key={i} className="ask-par">
          <Markdown blocks={prose(p.text)} shape="page" className="ask-md" />
          <Cites cites={p.citations} onOpen={onOpen} />
        </div>
      ))}
    </div>
  );
}

const FEEDBACK: Array<["agrees" | "disagrees" | "missing", LucideIcon, TKey]> = [
  ["agrees", CircleCheck, "ask.agrees"],
  ["disagrees", CircleSlash, "ask.disagrees"],
  ["missing", CircleHelp, "ask.missing"],
];
const KIND: Record<NonNullable<AskAnswer["provocation"]>["kind"], TKey> = {
  contradiz: "ask.provocation.contradiz",
  complica: "ask.provocation.complica",
  falta: "ask.provocation.falta",
};

/** An `answered` ask (design.md "Resposta"): the paragraphs, or the view and the feedback first; the provocation; how. */
export function Answer({
  detail,
  answer,
  onOpenNote,
  onAskAbout,
}: {
  detail: AskDetail;
  answer: AskAnswer;
  onOpenNote: (fileId: number) => void;
  onAskAbout: (text: string, path: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [all, setAll] = useState(false);
  const take = detail.take ?? "";
  const long = take.split("\n").length > TAKE_LINES || take.length > TAKE_CHARS;
  const p = answer.provocation;
  const { startedAt, finishedAt } = detail.run;
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(startedAt);
  return (
    <div className="ask-answer">
      {detail.mode === "reason_first" ? (
        <>
          <section className="card ask-take">
            <h2 className="ask-h2">{t("ask.take")}</h2>
            <p className="ask-take-text" data-clamped={long && !all ? "" : undefined}>
              {take}
            </p>
            {long && !all && (
              <button type="button" className="btn ghost sm" onClick={() => setAll(true)}>
                {t("ask.showAll")}
              </button>
            )}
          </section>
          {FEEDBACK.map(([key, Icon, title]) => {
            const items = answer.takeFeedback?.[key] ?? [];
            if (items.length === 0) return null;
            return (
              <section key={key} className="ask-fb">
                <h2 className="ask-h2 ask-line">
                  <Icon aria-hidden />
                  {t(title)}
                </h2>
                <Paragraphs items={items} onOpen={onOpenNote} />
              </section>
            );
          })}
          <Fold title={t("ask.fold")} shut>
            <Paragraphs items={answer.paragraphs} onOpen={onOpenNote} />
          </Fold>
        </>
      ) : (
        <Paragraphs items={answer.paragraphs} onOpen={onOpenNote} />
      )}
      {p && (
        <section className="ask-provocation">
          <p className="ask-small">{t(KIND[p.kind])}</p>
          <p className="ask-prov-text">{p.text}</p>
          <Cites cites={[p.citation]} onOpen={onOpenNote} />
          <div className="ask-acts">
            <button type="button" className="btn sm" onClick={() => onOpenNote(p.citation.fileId)}>
              <ExternalLink aria-hidden />
              {t("ask.provocation.open")}
            </button>
            <button type="button" className="btn sm" onClick={() => onAskAbout(p.text, p.citation.path)}>
              <MessageSquarePlus aria-hidden />
              {t("ask.provocation.ask")}
            </button>
          </div>
        </section>
      )}
      <section className="card ask-how">
        <h2 className="ask-h2">{t("ask.how")}</h2>
        <p className="ask-small">
          {t("ask.how.line", {
            provider: providerName(detail.run.provider),
            duration: formatDuration(finishedAt === undefined ? null : finishedAt - startedAt, locale),
            time,
          })}
        </p>
        <Link className="ask-link" to={`/runs/${detail.id}`}>
          {t("ask.how.run")}
        </Link>
      </section>
    </div>
  );
}

const STATUS: Partial<Record<AskItem["status"], [LucideIcon, TKey]>> = {
  running: [Loader, "ask.recent.answering"],
  refused: [AlertTriangle, "ask.recent.refused"],
  failed: [AlertTriangle, "ask.recent.failed"],
};

/** "Perguntas recentes" (design.md item 6, AC 48, AC 49): the list, its loading, error and empty states. */
function Recent({
  list,
  openId,
  label,
  lang,
  onOpen,
  onExample,
  onRetry,
}: {
  list: { isPending: boolean; isError: boolean; data?: { items: AskItem[] } };
  openId: string | null;
  label: (s: AskScope) => string;
  lang: string;
  onOpen: (id: string) => void;
  onExample: (text: string) => void;
  onRetry: () => void;
}) {
  const t = useT();
  const id = useId();
  const status = useRouteQuery(qk.memoryStatus, "GET /api/memory/status", undefined, { staleTime: 30_000 });
  const items = list.data?.items ?? [];
  let body: ReactNode;
  if (list.isPending)
    body = (
      <p className="ask-line">
        <span className="spinner" aria-hidden />
        {t("ask.loading")}
      </p>
    );
  else if (list.isError)
    body = (
      <div className="ask-line" role="alert">
        <AlertTriangle aria-hidden />
        <span>{t("ask.listFailed")}</span>
        <button type="button" className="btn sm" onClick={onRetry}>
          {t("ask.retry")}
        </button>
      </div>
    );
  else if (items.length === 0) {
    const area = [...(status.data?.facets.areas ?? [])].sort((a, b) => b.count - a.count)[0]?.area ?? null;
    body = <Empty area={area} onExample={onExample} />;
  } else
    body = (
      <ul className="ask-list">
        {items.map((item) => {
          const ModeIcon = item.mode === "direct" ? MessageSquare : PenLine;
          const state = STATUS[item.status];
          return (
            <li key={item.id}>
              <button
                type="button"
                className="ask-row"
                aria-current={item.id === openId ? "true" : undefined}
                onClick={() => onOpen(item.id)}
              >
                <span className="ask-row-q">{item.question}</span>
                <span className="ask-row-meta">
                  <span className="ask-line">
                    <ModeIcon aria-hidden />
                    {t(item.mode === "direct" ? "ask.recent.direct" : "ask.mode.reasonFirst")}
                  </span>
                  <span>{label(item.scope)}</span>
                  <span>{timeAgo(item.startedAt, lang)}</span>
                  {state && (
                    <span className="ask-line">
                      {(() => {
                        const [Icon, key] = state;
                        return (
                          <>
                            <Icon aria-hidden />
                            {t(key)}
                          </>
                        );
                      })()}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  return (
    <section className="ask-recent" aria-labelledby={id}>
      <h2 className="ask-eyebrow" id={id}>
        {t("ask.recent")}
      </h2>
      {body}
    </section>
  );
}

/** "Vazio" (AC 49): "Nenhuma pergunta ainda." and three examples that fill the question, the first about the area. */
export function Empty({ area, onExample }: { area: string | null; onExample: (text: string) => void }) {
  const t = useT();
  const examples = [
    area ? t("ask.example.area", { area }) : t("ask.example.month"),
    t("ask.example.plans"),
    t("ask.example.stalled"),
  ];
  return (
    <div className="ask-empty">
      <p>{t("ask.empty")}</p>
      <ul className="ask-examples">
        {examples.map((text) => (
          <li key={text}>
            <button type="button" className="ask-link" onClick={() => onExample(text)}>
              {text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Uma pasta…" (design.md "Escopo"): the notes view's tree of each root in a `Popover`; choosing a folder sets it. */
function FolderPicker({
  open,
  anchor,
  chosen,
  onClose,
  onChoose,
}: {
  open: boolean;
  anchor: RefObject<HTMLButtonElement | null>;
  chosen: string | null;
  onClose: () => void;
  onChoose: (path: string) => void;
}) {
  const t = useT();
  const top = useTreeLevel({}, open);
  return (
    <Popover
      open={open}
      onClose={onClose}
      anchor={anchor}
      ariaLabel={t("ask.scope.folder")}
      className="ask-folders"
    >
      {top.data ? (
        top.data.roots.map((r) => <RootTree key={r.path} root={r.path} chosen={chosen} onChoose={onChoose} />)
      ) : (
        <p className="ask-line">
          <span className="spinner" aria-hidden />
          {t("ask.loading")}
        </p>
      )}
    </Popover>
  );
}

function RootTree({
  root,
  chosen,
  onChoose,
}: {
  root: string;
  chosen: string | null;
  onChoose: (path: string) => void;
}) {
  const level = useTreeLevel({ root });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  if (!level.data) return null;
  return (
    <NotesTree
      root={root}
      sort="name"
      top={level.data}
      expanded={expanded}
      setExpanded={(path, on) =>
        setExpanded((s) => {
          const next = new Set(s);
          if (on) next.add(path);
          else next.delete(path);
          return next;
        })
      }
      selected={chosen}
      onOpenFile={() => undefined}
      onSelectFolder={(f) => onChoose(`${f.root}/${f.rel}`)}
    />
  );
}
