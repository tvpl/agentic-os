import { loadPromptSubmission, savePromptSubmission } from "../promptSubmission";
/**
 * The Console (plan Onda 1 §4): the desktop prompt became a conversation.
 * Every submit continues the same session — the server resumes the
 * provider's own conversation (`--resume`) — and the thread above the input
 * shows each turn: what you asked, what the agent answered, which tools it
 * used and what it cost. A running turn streams live; the full log is one
 * click away in Runs. Write runs that need approval are answered inline.
 *
 * Still supports `/skill` autocomplete (a bare `/slug` runs the skill) and the
 * read-only / write toggle, folder picker and ⌘↵.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, MessageSquarePlus, Mic, MicOff, Play, ShieldAlert, Square, Volume2, X } from "lucide-react";
import {
  api,
  ApiError,
  type LaunchRunResponse,
  type ProviderId,
  type RunRecord,
  type SessionDetail,
  type Skill,
} from "../../api";
import { useLocale, useT } from "../../i18n";
import { listen, speak, speechRecognitionAvailable } from "../../hooks/systemNotify";
import { qk, useOsProviders, useOsSettings, useOsSkills } from "../../queries";
import { PROVIDER_LOGIN_COMMANDS } from "../../runs/authRecovery";
import { providerProblem } from "../../components/providerReadiness";
import { Button, Segmented } from "../../components/primitives";
import { formatDuration, useToast } from "../../components/ui";
import { useRunStream, type RunDetailPayload, type RunEventView } from "../../runs/useRunStream";
import { ToolApprovalCard, useApprovals } from "../../runs/ApprovalCards";
import { toolApprovalsForRun } from "../../runs/approvals";
import { authRecovery } from "../../runs/authRecovery";
import { useDesktopActions } from "../actions";
import { isActiveStatus } from "../data";
import type { WidgetProps } from "../widgetTypes";
import { ONBOARDING_DRAFT_EVENT } from "../../onboarding/state";
import {
  readConsoleDraft,
  storeConsoleDraft,
  CONSOLE_DRAFT_EVENT,
  CONSOLE_REFS_EVENT,
} from "../consoleDraft";

type Mode = "read_only" | "write";

interface FolderOption {
  path: string;
  label: string;
}

const SESSION_KEY = "mordomo.console.session";
/** Turns shown in the thread (older ones live in Runs). */
const THREAD_TURNS = 8;
const REPLY_MAX_CHARS = 900;

/** Skills whose slug starts with the `/word` being typed (empty when not completing). */
/**
 * Documents matching the `@word` the caret is sitting in (redesign F5).
 * Returns `null` when the caret is not in a reference at all, so the caller
 * can tell "no matches" from "not referencing anything".
 */
export function docSuggestions<T extends { ref: string }>(
  textBeforeCaret: string,
  docs: readonly T[],
  limit = 6,
): T[] | null {
  const m = /@([\w.-]*)$/.exec(textBeforeCaret);
  if (!m) return null;
  const needle = (m[1] ?? "").toLowerCase();
  return docs.filter((d) => d.ref.toLowerCase().includes(needle)).slice(0, limit);
}

/**
 * Puts a reference into the draft. When the caret sits inside a half-typed
 * `@word` it completes that one; otherwise it appends — which is what a click
 * on a context chip means, and what the first version silently failed to do
 * on an empty prompt.
 */
export function completeReference(text: string, caret: number, ref: string): { text: string; caret: number } {
  const before = text.slice(0, caret);
  const m = /@([\w.-]*)$/.exec(before);
  const inserted = `@${ref} `;
  if (!m) {
    const head = text.trimEnd();
    const next = head ? `${head} ${inserted}` : inserted;
    return { text: next, caret: next.length };
  }
  const start = before.length - m[0].length;
  return { text: text.slice(0, start) + inserted + text.slice(caret), caret: start + inserted.length };
}

/**
 * Turns the `@name` references in a prompt into paths the agent can read.
 * The user sees a name; the model gets the file.
 */
export function resolveReferences(
  text: string,
  docs: readonly { ref: string; path: string }[],
): { text: string; used: string[] } {
  const used: string[] = [];
  for (const doc of docs) {
    const pattern = new RegExp(`@${doc.ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    if (!pattern.test(text)) continue;
    used.push(doc.path);
  }
  if (used.length === 0) return { text, used };
  const list = used.map((p) => `- ${JSON.stringify(p)}`).join("\n");
  return { text: `${text.trimEnd()}\n\nReferenced files:\n${list}`, used };
}

export function skillSuggestions(prompt: string, skills: readonly Skill[], limit = 6): Skill[] {
  const m = /^\/([a-z0-9-]*)$/i.exec(prompt.trim());
  if (!m) return [];
  const needle = (m[1] ?? "").toLowerCase();
  return skills.filter((s) => s.enabled && s.slug.toLowerCase().startsWith(needle)).slice(0, limit);
}

function readFolders(settings: Record<string, unknown> | undefined): FolderOption[] {
  const raw = settings?.indexedFolders;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (f): f is { path: string; enabled?: boolean } =>
        typeof f === "object" && f !== null && typeof (f as { path?: unknown }).path === "string",
    )
    .filter((f) => f.enabled !== false)
    .map((f) => ({ path: f.path, label: f.path.split(/[\\/]/).filter(Boolean).pop() ?? f.path }));
}

/** The agent's reply as the thread shows it: the last assistant message, trimmed. */
export function replyFromEvents(events: readonly RunEventView[]): {
  text: string;
  tools: number;
  tool: string | null;
} {
  let text = "";
  let tools = 0;
  let tool: string | null = null;
  for (const e of events) {
    if (e.type === "assistant" && typeof e.text === "string" && e.text.trim()) text = e.text.trim();
    else if (e.type === "tool_use") {
      tools += 1;
      tool = typeof e.tool === "string" ? e.tool : tool;
    } else if (e.type === "result" && typeof e.summary === "string" && !text) text = e.summary.trim();
  }
  if (text.length > REPLY_MAX_CHARS) text = `${text.slice(0, REPLY_MAX_CHARS).trimEnd()}…`;
  return { text, tools, tool };
}

function readStoredSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}
function storeSession(id: string | null) {
  try {
    if (id) localStorage.setItem(SESSION_KEY, id);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** Fired on `window` while the microphone listens; the core shows the Listening state. */
export const LISTENING_EVENT = "mordomo:listening";

export default function PromptWidget(_props: WidgetProps) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const actions = useDesktopActions();
  const providers = useOsProviders();
  const skills = useOsSkills();
  const settings = useOsSettings();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const [initialDraft] = useState(readConsoleDraft);
  const [prompt, setPrompt] = useState(initialDraft.text);
  useEffect(() => {
    const refresh = () => setPrompt(readConsoleDraft().text);
    window.addEventListener(ONBOARDING_DRAFT_EVENT, refresh);
    window.addEventListener(CONSOLE_DRAFT_EVENT, refresh);
    return () => {
      window.removeEventListener(ONBOARDING_DRAFT_EVENT, refresh);
      window.removeEventListener(CONSOLE_DRAFT_EVENT, refresh);
    };
  }, []);
  const [mode, setMode] = useState<Mode>("read_only");
  const [cwd, setCwd] = useState(initialDraft.cwd);
  const [sessionId, setSessionIdState] = useState<string | null>(() =>
    initialDraft.sessionId === undefined ? readStoredSession() : initialDraft.sessionId,
  );
  const setSessionId = (id: string | null) => {
    setSessionIdState(id);
    storeSession(id);
  };
  const [pendingApproval, setPendingApproval] = useState<{ id: string; description: string } | null>(null);

  /* ---- voice (plan Onda 3 §3): hold the mic, the transcript lands in the prompt ---- */
  const [listening, setListening] = useState(false);
  const stopListening = useRef<(() => void) | null>(null);
  const canListen = useMemo(() => speechRecognitionAvailable(), []);
  const toggleListening = () => {
    if (listening) {
      stopListening.current?.();
      return;
    }
    const stop = listen(
      locale,
      (text) => setPrompt((p) => (p.trim() ? `${p.trimEnd()} ${text}` : text)),
      () => {
        setListening(false);
        stopListening.current = null;
        window.dispatchEvent(new CustomEvent(LISTENING_EVENT, { detail: false }));
        inputRef.current?.focus();
      },
    );
    if (!stop) return;
    stopListening.current = stop;
    setListening(true);
    window.dispatchEvent(new CustomEvent(LISTENING_EVENT, { detail: true }));
  };
  useEffect(() => () => stopListening.current?.(), []);

  const enabled = (providers.data ?? []).filter((p) => p.enabled);
  const defaultProvider = enabled.find((p) => p.isDefault)?.id ?? enabled[0]?.id;
  const folders = useMemo(() => readFolders(settings.data), [settings.data]);
  const suggestions = useMemo(() => skillSuggestions(prompt, skills.data ?? []), [prompt, skills.data]);
  /** Caret position, so `@` completion edits the reference being typed. */
  const [caret, setCaret] = useState(0);
  const refHits = useMemo(
    () => docSuggestions(prompt.slice(0, caret), actions.openDocs),
    [prompt, caret, actions.openDocs],
  );
  /**
   * Publish which documents the draft points at. The desktop listens and
   * draws the tethers; keeping it an event means the console does not need to
   * know anything about the stage's geometry.
   */
  const referencedIds = useMemo(
    () => resolveReferences(prompt, actions.openDocs).used,
    [prompt, actions.openDocs],
  );
  const refsKey = referencedIds.join("|");
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(CONSOLE_REFS_EVENT, { detail: refsKey ? refsKey.split("|") : [] }));
    return () => {
      window.dispatchEvent(new CustomEvent(CONSOLE_REFS_EVENT, { detail: [] }));
    };
  }, [refsKey]);

  const insertRef = (ref: string) => {
    const next = completeReference(prompt, caret, ref);
    setPrompt(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  /* ---- the conversation ------------------------------------------------ */
  const session = useQuery({
    queryKey: qk.session(sessionId ?? ""),
    queryFn: ({ signal }) =>
      api.get<SessionDetail>(`/api/sessions/${encodeURIComponent(sessionId ?? "")}`, { signal }),
    enabled: sessionId !== null,
    retry: false,
    refetchInterval: (q) => (q.state.data?.runs.some((r) => isActiveStatus(r.status)) ? 20_000 : false),
  });
  useEffect(() => {
    storeConsoleDraft({ text: prompt, cwd: session.data?.session.cwd ?? cwd, sessionId });
  }, [prompt, cwd, sessionId, session.data?.session.cwd]);
  // A session the server no longer knows (older server, pruned, deleted) is dropped quietly.
  useEffect(() => {
    if (session.error instanceof ApiError && (session.error.status === 404 || session.error.status === 400))
      setSessionId(null);
  }, [session.error]);

  const turns = useMemo(
    () => [...(session.data?.runs ?? [])].sort((a, b) => a.createdAt - b.createdAt).slice(-THREAD_TURNS),
    [session.data],
  );
  const active = turns.find((r) => isActiveStatus(r.status));
  const stream = useRunStream(active?.id ?? "", active !== undefined);
  const finishedIds = turns.filter((r) => !isActiveStatus(r.status)).map((r) => r.id);
  const details = useQueries({
    queries: finishedIds.map((id) => ({
      queryKey: qk.run(id),
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        api.get<RunDetailPayload>(`/api/runs/${encodeURIComponent(id)}`, { signal }),
      staleTime: 5 * 60_000,
      retry: false,
    })),
  });
  const replies = useMemo(() => {
    const out = new Map<string, ReturnType<typeof replyFromEvents>>();
    finishedIds.forEach((id, i) => {
      const ev = details[i]?.data?.events;
      if (ev) out.set(id, replyFromEvents(ev));
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details.map((d) => d.dataUpdatedAt).join(","), finishedIds.join(",")]);
  const live = useMemo(() => replyFromEvents(stream.events), [stream.events]);

  /**
   * A finished run's artifact opens on the stage (redesign F5). This is the
   * payoff: the thing the agent just made is in front of you and already
   * referenceable, instead of a link that would take you off the desktop.
   *
   * Only runs that finish while the console is open, and only once each — a
   * refetch must not reopen a window the user deliberately closed.
   */
  const openedFor = useRef(new Set<string>());
  const openDocRef = useRef(actions.openDoc);
  openDocRef.current = actions.openDoc;
  useEffect(() => {
    finishedIds.forEach((id, i) => {
      if (openedFor.current.has(id)) return;
      const run = details[i]?.data?.run;
      if (!run) return;
      openedFor.current.add(id);
      const artifact = run.artifacts?.[0];
      if (artifact) openDocRef.current(artifact);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details.map((d) => d.dataUpdatedAt).join(","), finishedIds.join(",")]);
  // Tool prompts the running turn is waiting on (the CLI is paused until answered).
  const approvals = useApprovals({ enabled: active !== undefined, refetchInterval: active ? 30_000 : false });
  const toolApprovals = toolApprovalsForRun(approvals.data, active?.id);

  // Keep the newest turn in view as it streams.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, live.text, live.tools]);

  /* ---- mutations -------------------------------------------------------- */
  const submission = useRef(loadPromptSubmission());
  const submitting = useRef(false);
  const launch = useMutation({
    mutationFn: (): Promise<LaunchRunResponse> => {
      // The user writes `@plan.md`; the agent receives the path behind it.
      const { text } = resolveReferences(prompt.trim(), actions.openDocs);
      const fingerprint = JSON.stringify({ text, mode, sessionId, cwd, defaultProvider });
      if (submission.current?.fingerprint !== fingerprint)
        submission.current = { fingerprint, id: crypto.randomUUID() };
      savePromptSubmission(submission.current);
      const submissionId = submission.current.id;
      if (sessionId)
        return api.post<LaunchRunResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/continue`, {
          prompt: text,
          submissionId,
          mode,
        });
      return api.post<LaunchRunResponse>("/api/runs", {
        prompt: text,
        submissionId,
        mode,
        ...(cwd ? { cwd } : {}),
        ...(defaultProvider ? { provider: defaultProvider as ProviderId } : {}),
      });
    },
    onSuccess: (res) => {
      submission.current = null;
      savePromptSubmission(null);
      qc.invalidateQueries({ queryKey: ["runs"] }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: ["sessions"] }).catch(() => undefined);
      if (res.sessionId && res.sessionId !== sessionId) setSessionId(res.sessionId);
      if (res.status === "waiting_approval") {
        const approval = res.pendingApproval;
        setPendingApproval(approval ? { id: approval.id, description: approval.description } : null);
        if (!approval) toast(t("runs.approvalPending"), "info");
        return;
      }
      setPrompt("");
      setPendingApproval(null);
    },
    onError: (err: Error) =>
      toast(
        err instanceof ApiError && err.code === "submission_uncertain"
          ? t("desktop.prompt.submissionUncertain")
          : err instanceof ApiError && err.code === "submission_conflict"
            ? t("desktop.prompt.submissionConflict")
            : err.message,
        "danger",
      ),
    onSettled: () => {
      submitting.current = false;
    },
  });

  const resolve = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approved" | "denied" }) =>
      api.post<{ runId: string | null }>(`/api/approvals/${encodeURIComponent(id)}/resolve`, { decision }),
    onSuccess: (_res, vars) => {
      setPendingApproval(null);
      qc.invalidateQueries({ queryKey: qk.approvals }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: ["runs"] }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: ["sessions"] }).catch(() => undefined);
      if (vars.decision === "approved") setPrompt("");
      toast(
        vars.decision === "approved" ? t("desktop.prompt.approved") : t("desktop.prompt.denied"),
        vars.decision === "approved" ? "ok" : "info",
      );
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const stop = useMutation({
    mutationFn: (runId: string) => api.post(`/api/runs/${encodeURIComponent(runId)}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }).catch(() => undefined),
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const cwdUnavailable =
    sessionId === null && cwd !== "" && (!settings.data || !folders.some((folder) => folder.path === cwd));
  const canRun =
    prompt.trim().length > 0 &&
    !launch.isPending &&
    enabled.length > 0 &&
    !active &&
    !cwdUnavailable &&
    (!sessionId || (!session.isPending && !session.error));

  // Pre-flight: a provider that definitely cannot run gets a notice, not a failed run.
  const [preflight, setPreflight] = useState<{
    id: ProviderId;
    command: string | null;
    problem: string;
  } | null>(null);
  const submit = () => {
    if (!canRun || submitting.current) return;
    const target = enabled.find((p) => p.id === defaultProvider);
    const problem = target ? providerProblem(target) : null;
    if (target && (problem === "not_installed" || problem === "login_required")) {
      setPreflight({
        id: target.id,
        problem,
        command:
          problem === "not_installed" ? (target.installHint ?? null) : PROVIDER_LOGIN_COMMANDS[target.id],
      });
      return;
    }
    setPreflight(null);
    // A bare "/slug" runs the skill itself rather than sending the text.
    const bare = /^\/([a-z0-9-]+)$/i.exec(prompt.trim());
    const skill = bare
      ? (skills.data ?? []).find((s) => s.slug.toLowerCase() === bare[1]!.toLowerCase())
      : undefined;
    if (skill) {
      setPrompt("");
      actions.runSkill(skill);
      return;
    }
    submitting.current = true;
    launch.mutate();
  };

  const complete = (slug: string) => {
    setPrompt(`/${slug} `);
    inputRef.current?.focus();
  };

  const hasThread = sessionId !== null && turns.length > 0;

  return (
    <div className="promptw console">
      {cwdUnavailable && settings.data && (
        <p role="status" className="dim">
          {t("desktop.prompt.cwdUnavailable")}
        </p>
      )}
      <div className="console-thread" ref={threadRef} aria-live="polite">
        {!hasThread && <p className="console-empty">{t("desktop.console.empty")}</p>}
        {turns.map((run) => (
          <Turn
            key={run.id}
            run={run}
            reply={active?.id === run.id ? live : (replies.get(run.id) ?? null)}
            streaming={active?.id === run.id}
            onStop={() => stop.mutate(run.id)}
            stopping={stop.isPending}
          />
        ))}
      </div>

      {toolApprovals.map((a) => (
        <ToolApprovalCard key={a.id} approval={a} />
      ))}

      {actions.openDocs.length > 0 && (
        <div className="console-context" aria-label={t("desktop.doc.context")}>
          <span className="hud-label">{t("desktop.doc.context")}</span>
          {actions.openDocs.map((doc) => (
            <button
              key={doc.id}
              type="button"
              className="context-chip mono"
              title={doc.path}
              onClick={() => insertRef(doc.ref)}
            >
              @{doc.ref}
            </button>
          ))}
        </div>
      )}

      {refHits !== null && refHits.length > 0 && (
        <div className="promptw-suggest" role="listbox" aria-label={t("desktop.doc.context")}>
          {refHits.map((doc) => (
            <button
              key={doc.id}
              type="button"
              role="option"
              aria-selected={false}
              className="promptw-sugg mono"
              title={doc.path}
              onClick={() => insertRef(doc.ref)}
            >
              @{doc.ref}
            </button>
          ))}
        </div>
      )}

      {refHits === null && suggestions.length > 0 && (
        <div className="promptw-suggest" role="listbox" aria-label={t("desktop.prompt.skills")}>
          {suggestions.map((s) => (
            <button
              key={s.slug}
              type="button"
              role="option"
              aria-selected={false}
              className="promptw-sugg mono"
              onClick={() => complete(s.slug)}
            >
              /{s.slug}
            </button>
          ))}
        </div>
      )}

      <div className="promptw-field">
        <textarea
          ref={inputRef}
          className="input promptw-input"
          rows={1}
          value={prompt}
          placeholder={t("desktop.prompt.placeholder")}
          aria-label={t("desktop.prompt.placeholder")}
          onChange={(e) => {
            setPrompt(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
          }}
          onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              submit();
              return;
            }
            // While a reference is being typed, Tab completes it instead of a skill.
            if (e.key === "Tab" && refHits && refHits.length > 0) {
              e.preventDefault();
              insertRef(refHits[0]!.ref);
              return;
            }
            if (e.key === "Tab" && refHits === null && suggestions.length > 0) {
              e.preventDefault();
              complete(suggestions[0]!.slug);
            }
          }}
        />
        {canListen && (
          <button
            type="button"
            className={`os-tool console-mic${listening ? " active" : ""}`}
            aria-pressed={listening}
            aria-label={listening ? t("desktop.console.micStop") : t("desktop.console.mic")}
            title={listening ? t("desktop.console.micStop") : t("desktop.console.mic")}
            onClick={toggleListening}
          >
            {listening ? <MicOff aria-hidden /> : <Mic aria-hidden />}
          </button>
        )}
        <Button
          variant="primary"
          size="sm"
          icon={<Play aria-hidden />}
          disabled={!canRun}
          loading={launch.isPending}
          onClick={submit}
        >
          {t("desktop.prompt.run")}
        </Button>
      </div>

      <div className="promptw-row">
        <Segmented
          size="sm"
          ariaLabel={t("desktop.prompt.mode")}
          value={mode}
          onChange={setMode}
          options={[
            { value: "read_only", label: t("desktop.prompt.readOnly") },
            { value: "write", label: t("desktop.prompt.write") },
          ]}
        />
        {defaultProvider && (
          <span className="promptw-pill" title={t("desktop.prompt.provider")}>
            {session.data?.session.provider ?? defaultProvider}
          </span>
        )}
        {sessionId === null ? (
          <select
            className="input sm promptw-cwd"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            aria-label={t("desktop.prompt.cwd")}
          >
            <option value="">{t("desktop.prompt.cwdHome")}</option>
            {cwdUnavailable && (
              <option value={cwd} disabled>
                {cwd}
              </option>
            )}
            {folders.map((f) => (
              <option key={f.path} value={f.path}>
                {f.label}
              </option>
            ))}
          </select>
        ) : (
          <>
            {session.data && (
              <span className="console-meta mono">
                {t("desktop.console.turns", { n: session.data.session.turns })}
                {session.data.session.costUsd > 0 && ` · $${session.data.session.costUsd.toFixed(3)}`}
              </span>
            )}
            <Button
              size="sm"
              variant="ghost"
              icon={<MessageSquarePlus aria-hidden />}
              onClick={() => setSessionId(null)}
            >
              {t("desktop.console.newChat")}
            </Button>
          </>
        )}
      </div>

      {enabled.length === 0 && providers.data && (
        <p className="hint warn">{t("desktop.prompt.noProvider")}</p>
      )}
      {preflight && (
        <div className="auth-recovery" role="alert" data-testid="console-preflight">
          <strong>{t(`gate.state.${preflight.problem as "login_required"}`)}</strong>
          <p>{t(preflight.problem === "not_installed" ? "gate.installHint" : "gate.loginHint")}</p>
          {preflight.command && <code>{preflight.command}</code>}
          {" · "}
          <Link to="/settings?tab=providers">{t("desktop.auth.settings")}</Link>
        </div>
      )}

      {pendingApproval && (
        <div className="promptw-approval spring-in" role="alert">
          <ShieldAlert aria-hidden />
          <div className="promptw-approval-text">
            <strong>{t("desktop.prompt.approvalTitle")}</strong>
            <span className="truncate">{pendingApproval.description}</span>
          </div>
          <Button
            size="sm"
            variant="primary"
            icon={<Check aria-hidden />}
            loading={resolve.isPending}
            onClick={() => resolve.mutate({ id: pendingApproval.id, decision: "approved" })}
          >
            {t("desktop.prompt.approve")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<X aria-hidden />}
            onClick={() => resolve.mutate({ id: pendingApproval.id, decision: "denied" })}
          >
            {t("desktop.prompt.deny")}
          </Button>
        </div>
      )}
    </div>
  );
}

function Turn({
  run,
  reply,
  streaming,
  onStop,
  stopping,
}: {
  run: RunRecord;
  reply: ReturnType<typeof replyFromEvents> | null;
  streaming: boolean;
  onStop: () => void;
  stopping: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const cost = run.usage?.costUsd;
  const recovery = authRecovery(run.provider, `${run.error ?? ""} ${reply?.text ?? ""}`);
  const failed = run.status === "failed" || run.status === "timed_out" || run.status === "interrupted";
  return (
    <div className={`console-turn${streaming ? " streaming" : ""}${failed ? " failed" : ""}`}>
      <div className="console-msg you">
        <span className="console-who">{t("desktop.console.you")}</span>
        <p>{run.promptSummary}</p>
      </div>
      <div className="console-msg agent">
        <span className="console-who">{t("desktop.console.agent")}</span>
        {reply?.text ? (
          <p>{reply.text}</p>
        ) : streaming ? (
          <p className="console-thinking">
            <span className="spinner sm" aria-hidden />{" "}
            {reply?.tool ? t("desktop.console.tool", { tool: reply.tool }) : t("desktop.console.thinking")}
          </p>
        ) : (
          <p className="console-muted">{run.error ?? t("desktop.console.noReply")}</p>
        )}
        {recovery && (
          <div className="auth-recovery" role="alert">
            <strong>{t("desktop.auth.title")}</strong>
            <p>{t("desktop.auth.body", { command: recovery })}</p>
            <code>{recovery}</code>
            {" · "}
            <Link to="/settings?tab=providers">{t("desktop.auth.settings")}</Link>
          </div>
        )}
        <div className="console-foot mono">
          {reply && reply.tools > 0 && <span>{t("desktop.console.tools", { n: reply.tools })}</span>}
          {typeof cost === "number" && cost > 0 && <span>${cost.toFixed(3)}</span>}
          {run.durationMs != null && !streaming && <span>{formatDuration(run.durationMs)}</span>}
          {streaming ? (
            <button type="button" className="console-link danger" onClick={onStop} disabled={stopping}>
              <Square aria-hidden /> {t("desktop.console.stop")}
            </button>
          ) : (
            <>
              {reply?.text && (
                <button
                  type="button"
                  className="console-link"
                  onClick={() => speak(reply.text, locale, { force: true })}
                  aria-label={t("desktop.console.read")}
                  title={t("desktop.console.read")}
                >
                  <Volume2 aria-hidden /> {t("desktop.console.read")}
                </button>
              )}
              <Link to={`/runs/${run.id}`} className="console-link">
                {t("desktop.console.open")} →
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
