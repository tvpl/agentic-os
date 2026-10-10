/**
 * The voice line (immersive shell; the console of G4 before it): the one
 * place you talk to the machine, the same in every scene, centred at the
 * bottom of the screen.
 *
 * The conversation rises above the line and fades out at the top; what you
 * can point at — the lâminas and the scene you are in — completes with `@`,
 * `/` on an empty field fans the skill deck out, and the line lights while
 * a run is in flight. The context and the controls (mode, model, folder,
 * sessions) fold behind one button so the line itself stays a line.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Headphones, Mic, MicOff, Play, SlidersHorizontal } from "lucide-react";
import { api, ApiError, type LaunchRunResponse, type ProviderId, type SessionDetail } from "../../api";
import { useLocale, useT } from "../../i18n";
import {
  getVoiceNotify,
  listen,
  speak,
  speechRecognitionAvailable,
  stopSpeaking,
} from "../../hooks/systemNotify";
import { qk, useOsProviders, useOsSettings, useOsSkills, useOsUiPreferences } from "../../queries";
import { Link } from "react-router-dom";
import { authRecovery } from "../../runs/authRecovery";
import { providerProblem } from "../../components/providerReadiness";
import { Button } from "../../components/primitives";
import { useToast } from "../../components/ui";
import { useRunStream, type RunDetailPayload } from "../../runs/useRunStream";
import { loadPromptSubmission, savePromptSubmission } from "../promptSubmission";
import { useDesktopActions } from "../actions";
import { isActiveStatus } from "../data";
import { PANEL_GLYPH } from "../panelKinds";
import { ONBOARDING_DRAFT_EVENT } from "../../onboarding/state";
import {
  readConsoleDraft,
  storeConsoleDraft,
  CONSOLE_DRAFT_EVENT,
  CONSOLE_REFS_EVENT,
} from "../consoleDraft";
import {
  completeReference,
  docSuggestions,
  readFolders,
  replyFromEvents,
  resolveReferences,
  skillSuggestions,
} from "./refs";
import { narrate } from "../../runs/humanize";
import { ACTIVITY_EVENT, LISTEN_EVENT, SPEAK_EVENT } from "../../nucleo/events";
import { burst } from "../../nucleo/Sparks";
import { readHandsFree, spokenSummary, storeHandsFree } from "./voice";
import { useDesktopRuns } from "../data";
import { useOsMetrics } from "../../queries";
import { estimateRun } from "../estimate";
import { budgetState } from "../budget";
import type { Skill } from "../../api";
import { ConsoleThread, type Reply } from "./ConsoleThread";
import { ConsoleTray } from "./ConsoleTray";
import { ConsoleControls, type Mode, type ModelChoice } from "./ConsoleControls";
import { Tooltip } from "../../ui";

/** Fired on every keystroke; the core ripples with it (mirrors nucleo/CoreOrb's TYPING_EVENT). */
const TYPING_EVENT = "mordomo:typing";

const SESSION_KEY = "mordomo.console.session";
/** The thread is open by default (refino item 1): the console is a conversation, not a form. */
const THREAD_KEY = "mordomo.console.thread";
/** Fired on `window` to open the command palette; mirrors App.tsx's LAUNCHER_EVENT without importing the shell. */
const LAUNCHER_EVENT = "mordomo:launcher";
const MODEL_KEY = "mordomo.console.model.v1";
const SIDE_KEY = "mordomo.voice.side.v1";
/** Turns shown in the thread (older ones live in Runs). */
const THREAD_TURNS = 8;

/** Fired on `window` while the microphone listens; the core shows the Listening state. */
export const LISTENING_EVENT = "mordomo:listening";

/**
 * One conversation and one mode now that the spaces are gone. What a space
 * of the old desktop kept (`<key>.research`, `<key>.ops`) is read once as a
 * fallback, so a conversation left in one of them is not lost.
 */
const LEGACY_SPACES = ["research", "ops"] as const;
const spaceKey = (base: string, _space?: string) => base;
function readLegacy(base: string): string | null {
  try {
    const own = localStorage.getItem(base);
    if (own !== null) return own;
    for (const sp of LEGACY_SPACES) {
      const old = localStorage.getItem(`${base}.${sp}`);
      if (old !== null) return old;
    }
  } catch {
    /* private mode */
  }
  return null;
}

function readStoredSession(_space = "work"): string | null {
  return readLegacy(SESSION_KEY);
}
function storeSession(id: string | null, space = "work") {
  try {
    if (id) localStorage.setItem(spaceKey(SESSION_KEY, space), id);
    else localStorage.removeItem(spaceKey(SESSION_KEY, space));
  } catch {
    /* ignore */
  }
}
const MODE_KEY = "mordomo.console.mode";
function readStoredMode(space: string): Mode {
  try {
    return readLegacy(spaceKey(MODE_KEY, space)) === "write" ? "write" : "read_only";
  } catch {
    return "read_only";
  }
}
function storeMode(mode: Mode, space: string) {
  try {
    localStorage.setItem(spaceKey(MODE_KEY, space), mode);
  } catch {
    /* ignore */
  }
}
function readModelChoice(): ModelChoice {
  try {
    const raw = JSON.parse(localStorage.getItem(MODEL_KEY) ?? "null") as Partial<ModelChoice> | null;
    if (raw && typeof raw === "object")
      return {
        model: typeof raw.model === "string" ? raw.model : null,
        effort: (["low", "medium", "high", "default"] as const).includes(raw.effort as ModelChoice["effort"])
          ? (raw.effort as ModelChoice["effort"])
          : "default",
      };
  } catch {
    /* ignore */
  }
  return { model: null, effort: "default" };
}
function storeModelChoice(choice: ModelChoice) {
  try {
    localStorage.setItem(MODEL_KEY, JSON.stringify(choice));
  } catch {
    /* ignore */
  }
}

export interface ConsoleProps {
  /** A run is in flight somewhere on the desk: the frame lights up. */
  busy: boolean;
  deckOpen: boolean;
  onToggleDeck: (open?: boolean) => void;
  /** Narrow stage: the console flows in the column instead of floating. */
  stacked: boolean;
  /** Drawn first on the line: the shell puts the agent's iris there. */
  lead?: ReactNode;
}

export default function Console({ busy, deckOpen, onToggleDeck, stacked, lead }: ConsoleProps) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const actions = useDesktopActions();
  const providers = useOsProviders();
  const skills = useOsSkills();
  const settings = useOsSettings();
  const uiPreferences = useOsUiPreferences();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /* ---- the draft --------------------------------------------------------- */
  const [initialDraft] = useState(readConsoleDraft);
  const [prompt, setPrompt] = useState(initialDraft.text);
  // What is in the field right now. A submit that follows a keystroke in the
  // same tick must not read the previous render's draft (empty, or one
  // character short) and decide there is nothing to send.
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  useEffect(() => {
    const refresh = () => setPrompt(readConsoleDraft().text);
    window.addEventListener(ONBOARDING_DRAFT_EVENT, refresh);
    window.addEventListener(CONSOLE_DRAFT_EVENT, refresh);
    return () => {
      window.removeEventListener(ONBOARDING_DRAFT_EVENT, refresh);
      window.removeEventListener(CONSOLE_DRAFT_EVENT, refresh);
    };
  }, []);
  const space = uiPreferences.data?.activeSpace ?? "work";
  const [mode, setModeState] = useState<Mode>(() => readStoredMode(space));
  const setMode = (next: Mode) => {
    setModeState(next);
    storeMode(next, space);
  };
  const [cwd, setCwd] = useState(initialDraft.cwd);
  const [choice, setChoiceState] = useState<ModelChoice>(readModelChoice);
  const setChoice = (next: ModelChoice) => {
    setChoiceState(next);
    storeModelChoice(next);
  };
  const [sessionId, setSessionIdState] = useState<string | null>(() =>
    initialDraft.sessionId === undefined ? readStoredSession(space) : initialDraft.sessionId,
  );
  const setSessionId = useCallback(
    (id: string | null) => {
      setSessionIdState(id);
      storeSession(id, space);
    },
    [space],
  );
  // A space switch is a different desk: it brings its own conversation and mode.
  const spaceRef = useRef(space);
  useEffect(() => {
    if (spaceRef.current === space) return;
    spaceRef.current = space;
    setSessionIdState(readStoredSession(space));
    setModeState(readStoredMode(space));
    setCwd("");
  }, [space]);
  const [threadOpen, setThreadOpenState] = useState(() => {
    try {
      return localStorage.getItem(THREAD_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const setThreadOpen = (next: boolean | ((v: boolean) => boolean)) =>
    setThreadOpenState((v) => {
      const value = typeof next === "function" ? next(v) : next;
      try {
        localStorage.setItem(THREAD_KEY, value ? "1" : "0");
      } catch {
        /* ignore */
      }
      return value;
    });

  // The context and the controls fold behind one button (the line stays a line).
  const [sideOpen, setSideOpenState] = useState(() => {
    try {
      return localStorage.getItem(SIDE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const setSideOpen = (next: boolean) => {
    setSideOpenState(next);
    try {
      localStorage.setItem(SIDE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  // The field grows with the text, up to a few lines (prototype `grow()`).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [prompt]);

  /* ---- voice: hold the mic, the transcript lands in the prompt; hands-free
     (refino item 3) keeps the loop going: the reply is spoken, then the mic
     re-arms, and a finished sentence is sent without a click. ---- */
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [handsFree, setHandsFreeState] = useState(readHandsFree);
  const handsFreeRef = useRef(handsFree);
  handsFreeRef.current = handsFree;
  const stopListening = useRef<(() => void) | null>(null);
  const canListen = useMemo(() => speechRecognitionAvailable(), []);
  const submitRef = useRef<() => void>(() => undefined);
  const startListening = useCallback(() => {
    if (stopListening.current) return;
    const stop = listen(
      locale,
      (text) => {
        setInterim("");
        const next = promptRef.current.trim() ? `${promptRef.current.trimEnd()} ${text}` : text;
        promptRef.current = next;
        setPrompt(next);
        // Hands-free: a finished sentence is the send.
        if (handsFreeRef.current) window.setTimeout(() => submitRef.current(), 0);
      },
      () => {
        setListening(false);
        setInterim("");
        stopListening.current = null;
        window.dispatchEvent(new CustomEvent(LISTENING_EVENT, { detail: false }));
        if (!handsFreeRef.current) inputRef.current?.focus();
      },
      { onInterim: setInterim },
    );
    if (!stop) return;
    stopListening.current = stop;
    setListening(true);
    window.dispatchEvent(new CustomEvent(LISTENING_EVENT, { detail: true }));
  }, [locale]);
  const toggleListening = () => {
    if (listening) stopListening.current?.();
    else startListening();
  };
  const setHandsFree = (on: boolean) => {
    setHandsFreeState(on);
    storeHandsFree(on);
    if (on) startListening();
    else {
      stopSpeaking();
      stopListening.current?.();
    }
  };
  useEffect(() => () => stopListening.current?.(), []);
  // "Falar" from the core: open the conversation (focusing the line does)
  // and listen; without speech recognition the line is simply focused.
  useEffect(() => {
    const onTalk = () => {
      inputRef.current?.focus();
      if (canListen) startListening();
    };
    window.addEventListener(LISTEN_EVENT, onTalk);
    return () => window.removeEventListener(LISTEN_EVENT, onTalk);
  }, [canListen, startListening]);

  /* ---- the day's data the line needs (cost estimate, budget) ---------------- */
  const runsQ = useDesktopRuns();
  const metricsQ = useOsMetrics({ refetchInterval: 300_000 });

  /* ---- what it will cost, and whether it may run at all (refino item 39) ---- */
  const bareSlug = /^\/([a-z0-9-]+)(?:\s|$)/i.exec(prompt.trim())?.[1] ?? null;
  const estimate = useMemo(
    () =>
      estimateRun(runsQ.data ?? [], bareSlug ? { skillSlug: bareSlug } : { prompt: prompt.trim() || null }),
    [runsQ.data, bareSlug, prompt],
  );
  const budget = budgetState(settings.data?.limits?.dailyBudgetUsd, metricsQ.data?.cost?.todayUsd);
  const budgetBlocked = budget.tone === "over";

  /* ---- a skill that needs inputs asks in the thread (refino item 40) ---- */
  const [ask, setAsk] = useState<{ skill: Skill; values: Record<string, string> } | null>(null);
  const askRun = useMutation({
    mutationFn: ({ skill, values }: { skill: Skill; values: Record<string, string> }) =>
      api.post<LaunchRunResponse>(`/api/skills/${encodeURIComponent(skill.slug)}/run`, { inputs: values }),
    onSuccess: (res) => {
      setAsk(null);
      setPrompt("");
      qc.invalidateQueries({ queryKey: ["runs"] }).catch(() => undefined);
      if (res.status === "waiting_approval" || !res.runId) {
        qc.invalidateQueries({ queryKey: qk.approvals }).catch(() => undefined);
        return;
      }
      actions.openRun(res.runId);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const enabled = (providers.data ?? []).filter((p) => p.enabled);
  const defaultProvider = enabled.find((p) => p.isDefault)?.id ?? enabled[0]?.id;
  const folders = useMemo(() => readFolders(settings.data), [settings.data]);
  const suggestions = useMemo(() => skillSuggestions(prompt, skills.data ?? []), [prompt, skills.data]);

  /* ---- references: `@` completes any open panel ---------------------------- */
  const [caret, setCaret] = useState(0);
  const refHits = useMemo(
    () => docSuggestions(prompt.slice(0, caret), actions.openPanels),
    [prompt, caret, actions.openPanels],
  );
  const [acSel, setAcSel] = useState(0);
  /** Escape closes the list until the draft changes again. */
  const [acHidden, setAcHidden] = useState(false);
  const acKey = refHits?.map((h) => h.id).join("|") ?? "";
  useEffect(() => {
    setAcSel(0);
    setAcHidden(false);
  }, [acKey]);
  const referencedIds = useMemo(
    () => resolveReferences(prompt, actions.openPanels).used,
    [prompt, actions.openPanels],
  );
  const referenced = useMemo(() => new Set(referencedIds), [referencedIds]);
  const refsKey = referencedIds.join("|");
  // The desktop listens and draws the tethers; an event keeps the console
  // ignorant of the stage's geometry.
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
  }, [session.error, setSessionId]);

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
    const out = new Map<string, Reply>();
    finishedIds.forEach((id, i) => {
      const ev = details[i]?.data?.events;
      if (ev) out.set(id, replyFromEvents(ev));
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details.map((d) => d.dataUpdatedAt).join(","), finishedIds.join(",")]);
  const live = useMemo(() => replyFromEvents(stream.events), [stream.events]);
  // When the turn that was streaming settles, say the gist (hands-free or the
  // voice toggle), then listen again if the loop is on.
  const spokenFor = useRef<string | null>(null);
  const lastActiveId = useRef<string | null>(null);
  if (active) lastActiveId.current = active.id;
  useEffect(() => {
    const settled = lastActiveId.current;
    if (active || !settled || spokenFor.current === settled) return;
    const reply = replies.get(settled);
    if (!reply?.text) return;
    spokenFor.current = settled;
    const gist = spokenSummary(reply.text);
    if (!gist) return;
    const loop = handsFreeRef.current;
    if (!loop && !getVoiceNotify()) return;
    speak(gist, locale, { force: true, onEnd: () => loop && handsFreeRef.current && startListening() });
  }, [active, replies, locale, startListening]);
  // What the agent is doing right now, in words (refino item 36).
  const narration = useMemo(
    () => narrate(stream.events, t, session.data?.session.cwd ?? cwd),
    [stream.events, t, session.data?.session.cwd, cwd],
  );
  // The shell's entity shows the same activity orbiting it.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(ACTIVITY_EVENT, { detail: active ? narration : [] }));
  }, [narration, active]);
  // Reply text arriving is the entity speaking.
  const spokenChars = useRef(0);
  useEffect(() => {
    const n = live.text?.length ?? 0;
    const delta = n - spokenChars.current;
    spokenChars.current = n;
    if (delta > 0) window.dispatchEvent(new CustomEvent(SPEAK_EVENT, { detail: { chars: delta } }));
  }, [live.text]);

  /* ---- mutations -------------------------------------------------------- */
  const submission = useRef(loadPromptSubmission());
  const submitting = useRef(false);
  const launch = useMutation({
    mutationFn: (): Promise<LaunchRunResponse> => {
      // The user writes `@plan.md`; the agent receives the path behind it.
      const { text } = resolveReferences(promptRef.current.trim(), actions.openPanels);
      const fingerprint = JSON.stringify({ text, mode, sessionId, cwd, defaultProvider, choice });
      if (submission.current?.fingerprint !== fingerprint)
        submission.current = { fingerprint, id: crypto.randomUUID() };
      savePromptSubmission(submission.current);
      const submissionId = submission.current.id;
      const tuning = { model: choice.model, effort: choice.effort };
      if (sessionId)
        return api.post<LaunchRunResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/continue`, {
          prompt: text,
          submissionId,
          mode,
          ...tuning,
        });
      return api.post<LaunchRunResponse>("/api/runs", {
        prompt: text,
        submissionId,
        mode,
        ...tuning,
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
        // The decision dock on the console picks it up (refino item 5); the
        // draft stays in the field until the run is actually launched.
        qc.invalidateQueries({ queryKey: qk.approvals }).catch(() => undefined);
        if (!res.pendingApproval) toast(t("runs.approvalPending"), "info");
        return;
      }
      setPrompt("");
      // No trace sheet pops up: the conversation shows the agent working,
      // step by step, and the full trace is one click away from the turn.
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

  const stop = useMutation({
    mutationFn: (runId: string) => api.post(`/api/runs/${encodeURIComponent(runId)}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }).catch(() => undefined),
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const cwdUnavailable =
    sessionId === null && cwd !== "" && (!settings.data || !folders.some((folder) => folder.path === cwd));
  const runnable = (text: string) =>
    text.trim().length > 0 &&
    !budgetBlocked &&
    !launch.isPending &&
    enabled.length > 0 &&
    !active &&
    !cwdUnavailable &&
    (!sessionId || (!session.isPending && !session.error));
  const canRun = runnable(prompt);

  // Pre-flight: a provider that definitely cannot run gets a notice, not a failed run.
  const [preflight, setPreflight] = useState<{
    id: ProviderId;
    command: string | null;
    problem: string;
  } | null>(null);
  const submit = () => {
    if (!runnable(promptRef.current) || submitting.current) return;
    const target = enabled.find((p) => p.id === defaultProvider);
    const problem = target ? providerProblem(target) : null;
    if (target && (problem === "not_installed" || problem === "login_required")) {
      setPreflight({
        id: target.id,
        problem,
        command: problem === "not_installed" ? (target.installHint ?? null) : (target.loginCommand ?? null),
      });
      return;
    }
    setPreflight(null);
    // A bare "/slug" runs the skill itself rather than sending the text.
    const bare = /^\/([a-z0-9-]+)$/i.exec(promptRef.current.trim());
    const skill = bare
      ? (skills.data ?? []).find((s) => s.slug.toLowerCase() === bare[1]!.toLowerCase())
      : undefined;
    if (skill) {
      if (skill.inputs.some((i) => i.required)) {
        // Ask for what is missing here, in the conversation, not in a form panel.
        setAsk({ skill, values: {} });
        return;
      }
      setPrompt("");
      actions.runSkill(skill);
      return;
    }
    submitting.current = true;
    // The request leaves the line as light: the agent has it.
    const r = inputRef.current?.getBoundingClientRect();
    if (r) burst(r.left + 24, r.top + r.height / 2, "agent", 0.9);
    launch.mutate();
  };

  submitRef.current = submit;

  const complete = (slug: string) => {
    setPrompt(`/${slug} `);
    inputRef.current?.focus();
  };

  const acOpen = !acHidden && refHits !== null && refHits.length > 0;
  // The conversation sheet is the thread: it always shows the whole of it.
  const showThread = true;
  const threadTurns = turns;
  // An expired login is not history: while the thread is folded, the last
  // turn's recovery is a notice on the console itself.
  const last = turns[turns.length - 1];
  const recovery =
    !showThread && last
      ? authRecovery(last.provider, `${last.error ?? ""} ${replies.get(last.id)?.text ?? ""}`, providers.data)
      : null;

  return (
    <section
      className={`cons${busy || launch.isPending ? " busy" : ""}${stacked ? " stacked" : ""}`}
      data-console
      data-onboarding="console"
      aria-label={t("desktop.widget.prompt")}
    >
      <div className="cons-in">
        <div className="cons-main">
          <div className="cons-scroll" data-testid="console-scroll">
            {cwdUnavailable && settings.data && (
              <p role="status" className="cons-note dim">
                {t("desktop.prompt.cwdUnavailable")}
              </p>
            )}
            {enabled.length === 0 && providers.data && (
              <p className="cons-note warn">{t("desktop.prompt.noProvider")}</p>
            )}
            {preflight && (
              <div className="auth-recovery cons-note" role="alert" data-testid="console-preflight">
                <strong>{t(`gate.state.${preflight.problem as "login_required"}`)}</strong>
                <p>{t(preflight.problem === "not_installed" ? "gate.installHint" : "gate.loginHint")}</p>
                {preflight.command && <code>{preflight.command}</code>}
                {" · "}
                <Link to="/settings?tab=providers">{t("desktop.auth.settings")}</Link>
              </div>
            )}
            {budgetBlocked && (
              <p className="cons-note warn" role="status" data-testid="console-budget-blocked">
                {t("desktop.budget.blocked")}{" "}
                <Link to="/settings?tab=security">{t("desktop.budget.raise")}</Link>
              </p>
            )}
            {ask && (
              <form
                className="console-msg agent ask spring-in"
                data-testid="console-ask"
                onSubmit={(e) => {
                  e.preventDefault();
                  const missing = ask.skill.inputs.filter(
                    (i) => i.required && !(ask.values[i.name] ?? "").trim(),
                  );
                  if (missing.length > 0) {
                    document.getElementById(`ask-${missing[0]!.name}`)?.focus();
                    return;
                  }
                  askRun.mutate(ask);
                }}
              >
                <span className="console-who">{t("desktop.console.agent")}</span>
                <p>
                  {t("desktop.ask.title")} · <span className="mono">/{ask.skill.slug}</span>
                </p>
                <div className="ask-fields">
                  {ask.skill.inputs.map((input) => {
                    const id = `ask-${input.name}`;
                    const value = ask.values[input.name] ?? "";
                    const set = (v: string) =>
                      setAsk((cur) => (cur ? { ...cur, values: { ...cur.values, [input.name]: v } } : cur));
                    return (
                      <label key={input.name} className="ask-field">
                        <span className="ask-label">
                          {input.label}
                          {input.required && " *"}
                        </span>
                        {input.options && input.options.length > 0 ? (
                          <select
                            id={id}
                            className="input sm"
                            value={value}
                            onChange={(e) => set(e.target.value)}
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
                            className="input sm"
                            value={value}
                            placeholder={input.placeholder ?? ""}
                            onChange={(e) => set(e.target.value)}
                          />
                        )}
                      </label>
                    );
                  })}
                </div>
                <div className="console-foot mono">
                  <Button type="submit" size="sm" variant="primary" loading={askRun.isPending}>
                    {t("desktop.ask.run")}
                  </Button>
                  <button type="button" className="console-link" onClick={() => setAsk(null)}>
                    {t("desktop.ask.cancel")}
                  </button>
                </div>
              </form>
            )}
            {recovery && (
              <div className="auth-recovery cons-note" role="alert">
                <strong>{t("desktop.auth.title")}</strong>
                <p>{t("desktop.auth.body", { command: recovery })}</p>
                <code>{recovery}</code>
                {" · "}
                <Link to="/settings?tab=providers">{t("desktop.auth.settings")}</Link>
              </div>
            )}

            {showThread && (
              <ConsoleThread
                turns={threadTurns}
                activeId={active?.id}
                live={live}
                narration={narration}
                replies={replies}
                panels={actions.openPanels}
                onStop={(id) => stop.mutate(id)}
                stopping={stop.isPending}
              />
            )}
          </div>

          {(interim || (listening && handsFree)) && (
            <p className="cons-interim mono" aria-live="polite">
              <span className="cons-interim-dot" aria-hidden />
              {interim || t("desktop.console.listening")}
            </p>
          )}
          <div className="cons-row">
            {lead}
            <textarea
              ref={inputRef}
              className="cons-input"
              rows={1}
              value={prompt}
              placeholder={t("desktop.prompt.placeholder")}
              aria-label={t("desktop.prompt.placeholder")}
              aria-autocomplete="list"
              aria-controls={acOpen ? "cons-ac" : undefined}
              onChange={(e) => {
                const next = e.target.value;
                // `/` on an empty field is the deck, not a character; `>` is the
                // command palette (refino item 9: one field, four prefixes).
                if (next === "/" && prompt === "") {
                  onToggleDeck(true);
                  return;
                }
                if (next === ">" && prompt === "") {
                  window.dispatchEvent(new CustomEvent(LAUNCHER_EVENT, { detail: { query: "" } }));
                  return;
                }
                promptRef.current = next;
                setPrompt(next);
                window.dispatchEvent(new CustomEvent(TYPING_EVENT));
                setCaret(e.target.selectionStart ?? next.length);
              }}
              onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
              onKeyDown={(e) => {
                if (acOpen) {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const n = refHits!.length;
                    setAcSel((s) => (s + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
                    return;
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    insertRef(refHits![acSel]!.ref);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setAcHidden(true);
                    return;
                  }
                }
                if (e.key === "Tab" && refHits === null && suggestions.length > 0) {
                  e.preventDefault();
                  complete(suggestions[0]!.slug);
                  return;
                }
                // Enter sends; Shift+Enter is a new line. ⌘↵ still sends, as it always did.
                if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            {canListen && (
              <Tooltip label={handsFree ? t("desktop.console.handsFreeOff") : t("desktop.console.handsFree")}>
                <button
                  type="button"
                  className={`os-tool cons-handsfree${handsFree ? " active" : ""}`}
                  aria-pressed={handsFree}
                  aria-label={handsFree ? t("desktop.console.handsFreeOff") : t("desktop.console.handsFree")}
                  onClick={() => setHandsFree(!handsFree)}
                >
                  <Headphones aria-hidden />
                </button>
              </Tooltip>
            )}
            {canListen && (
              <Tooltip label={listening ? t("desktop.console.micStop") : t("desktop.console.mic")}>
                <button
                  type="button"
                  className={`os-tool cons-mic${listening ? " active" : ""}`}
                  aria-pressed={listening}
                  aria-label={listening ? t("desktop.console.micStop") : t("desktop.console.mic")}
                  onClick={toggleListening}
                >
                  {listening ? <MicOff aria-hidden /> : <Mic aria-hidden />}
                </button>
              </Tooltip>
            )}
            <Tooltip label={t("nucleo.voice.more")}>
              <button
                type="button"
                className={`os-tool cons-more${sideOpen ? " active" : ""}`}
                aria-expanded={sideOpen}
                aria-controls="cons-side"
                aria-label={t("nucleo.voice.more")}
                onClick={() => setSideOpen(!sideOpen)}
              >
                <SlidersHorizontal aria-hidden />
              </button>
            </Tooltip>
            <button
              type="button"
              className="cbtn cons-skills"
              aria-expanded={deckOpen}
              aria-haspopup="dialog"
              title={`${t("desktop.deck.title")} (⌘J)`}
              onClick={() => onToggleDeck()}
            >
              <span aria-hidden>◈</span> {t("desktop.prompt.skills")}
            </button>
            <Button
              variant="primary"
              size="sm"
              className="cons-send"
              icon={<Play aria-hidden />}
              disabled={!canRun}
              loading={launch.isPending}
              onClick={submit}
            >
              {t("desktop.prompt.run")}
            </Button>
          </div>
        </div>

        <aside
          className="cons-side"
          id="cons-side"
          hidden={!sideOpen}
          aria-label={t("desktop.console.context")}
        >
          <ConsoleTray panels={actions.openPanels} referenced={referenced} onPick={insertRef} />
          <ConsoleControls
            mode={mode}
            onMode={setMode}
            cwd={cwd}
            onCwd={setCwd}
            cwdUnavailable={cwdUnavailable}
            folders={folders}
            sessionLocked={sessionId !== null}
            provider={(session.data?.session.provider as ProviderId | undefined) ?? defaultProvider}
            providers={enabled}
            choice={choice}
            onChoice={setChoice}
            session={session.data}
            onNewChat={() => {
              setSessionId(null);
              setThreadOpen(false);
            }}
            onPickSession={(id) => {
              setSessionId(id);
              // Its conversation comes back with it, in the thread.
              setThreadOpen(true);
            }}
            threadOpen={threadOpen}
            onToggleThread={() => setThreadOpen((v) => !v)}
            estimate={estimate}
            budget={budget}
            showBudget={prompt.trim().length > 0}
          />
        </aside>

        {acOpen && (
          <div className="cons-ac" id="cons-ac" role="listbox" aria-label={t("desktop.console.ac")}>
            <div className="cons-h">{t("desktop.console.ac")}</div>
            {refHits!.map((panel, i) => (
              <button
                key={panel.id}
                type="button"
                role="option"
                aria-selected={i === acSel}
                className={`mono${i === acSel ? " s" : ""}`}
                title={panel.path ?? panel.title}
                onMouseEnter={() => setAcSel(i)}
                onClick={() => insertRef(panel.ref)}
              >
                <span aria-hidden>{PANEL_GLYPH[panel.kind]}</span>
                <span className="cons-ac-title">{panel.title}</span>
                <span className="r">@{panel.ref}</span>
              </button>
            ))}
          </div>
        )}
        {refHits === null && suggestions.length > 0 && (
          <div className="cons-ac" role="listbox" aria-label={t("desktop.prompt.skills")}>
            <div className="cons-h">{t("desktop.prompt.skills")}</div>
            {suggestions.map((s) => (
              <button
                key={s.slug}
                type="button"
                role="option"
                aria-selected={false}
                className="mono"
                onClick={() => complete(s.slug)}
              >
                <span aria-hidden>✶</span>
                <span className="cons-ac-title">/{s.slug}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
