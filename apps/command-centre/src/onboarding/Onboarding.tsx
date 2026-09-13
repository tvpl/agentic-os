import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Compass,
  FileText,
  Orbit,
  Rocket,
  ShieldCheck,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import { DialogPortal, useDialogDepth } from "../components/dialog";
import { PROVIDER_GATE_EVENT } from "../components/providerReadiness";
import { useWorkspace, type WorkspaceMode } from "../components/Workspace";
import { readConsoleDraft, storeConsoleDraft } from "../desktop/consoleDraft";
import { useLang } from "../i18n";
import { useOsProviders, useOsSettings } from "../queries";
import { tourCopy } from "./copy";
import {
  ONBOARDING_DRAFT_EVENT,
  ONBOARDING_EVENT,
  TOUR_STEPS,
  freshProgress,
  placeCoach,
  readProgress,
  saveProgress,
  type TourProgress,
} from "./state";
import { useTourFocus, useTourTarget } from "./useTourSurface";
import "./onboarding.css";

const MODES: WorkspaceMode[] = ["overview", "focus", "explore"];
const CHAPTER_ICONS = [Compass, BrainCircuit, Rocket, Sparkles];
const DRAFT_KEY = "mordomo.onboarding.draft.v1";
function readPractice() {
  try {
    return sessionStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

export function Onboarding() {
  const c = tourCopy(useLang());
  const navigate = useNavigate();
  const location = useLocation();
  const depth = useDialogDepth();
  const { mode, setMode } = useWorkspace();
  const providers = useOsProviders();
  const settings = useOsSettings();
  const [progress, setProgress] = useState(readProgress);
  const [screen, setScreen] = useState<"welcome" | "tour" | "complete" | null>(null);
  const [draft, setDraft] = useState(readPractice);
  const [triedMode, setTriedMode] = useState(false);
  const [answer, setAnswer] = useState<"review" | "approve" | null>(null);
  const [variant, setVariant] = useState("");
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [cardSize, setCardSize] = useState({ x: 0, y: 0, width: 390, height: 440 });
  const returnRoute = useRef(location.pathname + location.search);
  const dialog = useRef<HTMLDivElement>(null);
  const autoOpened = useRef(false);
  const navigatedStep = useRef<string | null>(null);
  const step = TOUR_STEPS[Math.min(progress.step, TOUR_STEPS.length - 1)]!;
  const info = c.steps[step.id];
  const selector =
    screen !== "tour"
      ? null
      : variant === "generations"
        ? '[data-onboarding="generations"] .page'
        : step.id === "settings" && variant
          ? `#settings-tabs-panel-${variant}`
          : step.target;
  const { target, element } = useTourTarget(selector, screen === "tour");
  const update = useCallback((fn: (p: TourProgress) => TourProgress) => {
    setProgress((p) => {
      const next = fn(p);
      saveProgress(next);
      return next;
    });
  }, []);
  const pause = useCallback(() => {
    update((p) => ({ ...p, status: p.status === "completed" ? "completed" : "paused" }));
    setScreen(null);
    navigate(returnRoute.current, { replace: true });
  }, [navigate, update]);
  useTourFocus(
    dialog,
    screen !== null && depth === 0,
    screen === "tour" && step.id === "modes" ? element : null,
    pause,
  );

  // The "configure your AI" gate comes first; the tour waits until it closes.
  const [gateOpen, setGateOpen] = useState(() => Boolean(document.documentElement.dataset.providerGate));
  useEffect(() => {
    const onGate = (event: Event) =>
      setGateOpen(Boolean((event as CustomEvent<{ open: boolean }>).detail?.open));
    window.addEventListener(PROVIDER_GATE_EVENT, onGate);
    return () => window.removeEventListener(PROVIDER_GATE_EVENT, onGate);
  }, []);
  // Wait for the boot sequence and any existing dialog. Skips/completions never auto-open again.
  useEffect(() => {
    if (autoOpened.current || depth > 0 || gateOpen || !["new", "active"].includes(progress.status)) return;
    const timer = window.setTimeout(() => {
      autoOpened.current = true;
      setScreen(
        progress.status === "active" ? (progress.step >= TOUR_STEPS.length ? "complete" : "tour") : "welcome",
      );
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [depth, gateOpen, progress.status, progress.step]);
  useEffect(() => {
    const open = () => {
      autoOpened.current = true;
      returnRoute.current = location.pathname + location.search;
      setScreen("welcome");
    };
    window.addEventListener(ONBOARDING_EVENT, open);
    return () => window.removeEventListener(ONBOARDING_EVENT, open);
  }, [location.pathname, location.search]);
  useEffect(() => {
    if (screen !== "tour") {
      navigatedStep.current = null;
      return;
    }
    // HashRouter's navigate callback changes with the URL. A choice within a
    // stop (e.g. Generations) must not send the user back to its default route.
    if (navigatedStep.current === step.id) return;
    navigatedStep.current = step.id;
    setVariant("");
    if (step.id === "console") setMode("focus");
    navigate(step.route, { replace: true });
  }, [screen, step, navigate, setMode]);
  useLayoutEffect(() => {
    if (!screen) return;
    const resize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      const rect = dialog.current?.getBoundingClientRect();
      if (rect)
        setCardSize((old) =>
          old.width === rect.width && old.height === rect.height
            ? old
            : { x: 0, y: 0, width: rect.width, height: rect.height },
        );
    };
    const observer = new ResizeObserver(resize);
    if (dialog.current) observer.observe(dialog.current);
    window.addEventListener("resize", resize);
    resize();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [screen]);
  // Clicks on the real dock count too, including selecting the current mode.
  useEffect(() => {
    if (screen !== "tour" || step.id !== "modes" || !element) return;
    const tried = () => setTriedMode(true);
    element.addEventListener("click", tried);
    return () => element.removeEventListener("click", tried);
  }, [screen, step.id, element]);

  const begin = (restart = false) => {
    if (restart) {
      update(() => ({ ...freshProgress(), status: "active" }));
      changeDraft("");
      setTriedMode(false);
    } else update((p) => ({ ...p, status: "active" }));
    setAnswer(null);
    setScreen(!restart && progress.step >= TOUR_STEPS.length ? "complete" : "tour");
  };
  const goStep = (index: number) => {
    update((p) => ({
      ...p,
      status: "active",
      step: index,
      visited: [...new Set([...p.visited, step.id])],
      practiced: draft.trim().length > 0,
    }));
    setScreen(index === TOUR_STEPS.length ? "complete" : "tour");
    // Announce each new stop without stealing focus while typing or changing a mode.
    requestAnimationFrame(() => dialog.current?.focus({ preventScroll: true }));
  };
  const changeDraft = (text: string) => {
    setDraft(text);
    try {
      sessionStorage.setItem(DRAFT_KEY, text);
    } catch {
      /* session only */
    }
  };
  const finish = (destination: "os" | "draft" | "provider") => {
    if (destination === "draft" && draft.trim()) {
      const current = readConsoleDraft();
      storeConsoleDraft({
        ...current,
        text: [current.text.trimEnd(), draft.trim()].filter(Boolean).join("\n\n"),
      });
      window.dispatchEvent(new Event(ONBOARDING_DRAFT_EVENT));
      setMode("focus");
    }
    update((p) => ({ ...p, status: "completed", practiced: draft.trim().length > 0 }));
    setScreen(null);
    navigate(destination === "provider" ? "/settings?tab=providers" : "/", { replace: true });
  };
  if (!screen || depth > 0) return null;
  const providerReady = providers.data?.some((p) => p.enabled && p.health.ok) ?? false;
  const memoryReady = settings.data?.indexedFolders?.some((f) => f.enabled !== false) ?? false;
  const placement = placeCoach(target, viewport.width, viewport.height, cardSize);
  const canResume =
    progress.status !== "new" &&
    progress.status !== "completed" &&
    (progress.step > 0 || progress.visited.length > 0);
  const guided = screen === "tour";
  const complete = screen === "complete";

  return (
    <DialogPortal>
      <div className={`onboarding ${guided ? "ob-guided" : "ob-centered"}`} data-testid="onboarding">
        {guided && target ? (
          <>
            <div className="ob-shade" style={{ inset: `0 0 auto 0`, height: target.y }} />
            <div
              className="ob-shade"
              style={{ top: target.y, left: 0, width: target.x, height: target.height }}
            />
            <div
              className="ob-shade"
              style={{ top: target.y, left: target.x + target.width, right: 0, height: target.height }}
            />
            <div className="ob-shade" style={{ top: target.y + target.height, insetInline: 0, bottom: 0 }} />
            {step.id !== "modes" && (
              <div
                className="ob-target-shield"
                style={{ left: target.x, top: target.y, width: target.width, height: target.height }}
              />
            )}
            <div
              className="ob-spotlight"
              style={{ left: target.x, top: target.y, width: target.width, height: target.height }}
              aria-hidden
            >
              <i />
              <i />
              <i />
              <i />
            </div>
          </>
        ) : (
          <div className="ob-shade ob-full" />
        )}

        <div
          ref={dialog}
          className={`ob-dialog ${guided ? "ob-coach" : "ob-welcome"}`}
          role="dialog"
          aria-modal={guided ? undefined : true}
          aria-labelledby="ob-title"
          aria-describedby="ob-description"
          tabIndex={-1}
          style={guided ? { left: placement.x, top: placement.y } : undefined}
        >
          {guided ? (
            <>
              <div className="ob-coach-top">
                <span className="ob-live">
                  <span />
                  {c.live}
                </span>
                <button className="ob-icon-button" type="button" onClick={pause} aria-label={c.close}>
                  <X size={17} />
                </button>
              </div>
              <nav className="ob-chapters" aria-label={c.chapter}>
                {c.chapters.map((name, index) => (
                  <button
                    type="button"
                    key={name}
                    title={name}
                    aria-label={`${c.chapter} ${index + 1}: ${name}`}
                    aria-current={step.chapter === index ? "step" : undefined}
                    className={step.chapter === index ? "active" : index < step.chapter ? "past" : ""}
                    onClick={() => goStep(TOUR_STEPS.findIndex((s) => s.chapter === index))}
                  />
                ))}
              </nav>
              <div
                className="ob-step-content"
                key={step.id}
                role="region"
                aria-labelledby="ob-title"
                tabIndex={0}
              >
                <div className="ob-eyebrow">
                  {String(progress.step + 1).padStart(2, "0")} / {TOUR_STEPS.length} <span>·</span>{" "}
                  {c.chapters[step.chapter]}
                </div>
                <h2 id="ob-title">{info.title}</h2>
                <p id="ob-description">{info.body}</p>
                <div className="ob-tags">
                  {info.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
                {step.id === "modes" && (
                  <div className="ob-activity">
                    <p>{c.modes}</p>
                    <div className="ob-choice-row">
                      {MODES.map((value, i) => (
                        <button
                          type="button"
                          key={value}
                          aria-pressed={mode === value}
                          onClick={() => {
                            setMode(value);
                            setTriedMode(true);
                          }}
                        >
                          {c.modeNames[i]}
                        </button>
                      ))}
                    </div>
                    <p className="ob-feedback" role="status">
                      {triedMode ? c.modeDone : c.modeHints[MODES.indexOf(mode)]}
                    </p>
                  </div>
                )}
                {step.id === "console" && (
                  <div className="ob-activity">
                    <div className="ob-activity-title">
                      <Terminal size={15} />
                      <label htmlFor="ob-draft">{c.practice}</label>
                      <button type="button" className="ob-text-button" onClick={() => changeDraft(c.sample)}>
                        {c.template}
                      </button>
                    </div>
                    <textarea
                      id="ob-draft"
                      aria-label={c.promptLabel}
                      value={draft}
                      maxLength={4000}
                      onChange={(event) => changeDraft(event.target.value)}
                      placeholder={c.promptPlaceholder}
                      rows={3}
                    />
                    <p className="ob-feedback" role="status">
                      {draft.trim() ? c.draftDone : c.draftHint}
                    </p>
                  </div>
                )}
                {step.id === "runs" && (
                  <div className="ob-activity">
                    <p>{c.quiz}</p>
                    <div className="ob-quiz">
                      {(["review", "approve"] as const).map((value) => (
                        <button
                          type="button"
                          key={value}
                          aria-pressed={answer === value}
                          onClick={() => setAnswer(value)}
                        >
                          {answer === value ? <Check size={15} /> : <Circle size={15} />}
                          {c[value]}
                        </button>
                      ))}
                    </div>
                    {answer && (
                      <p className="ob-feedback" role="status">
                        {answer === "review" ? c.correct : c.incorrect}
                      </p>
                    )}
                  </div>
                )}
                {step.id === "artifacts" && (
                  <div className="ob-choice-row">
                    {["artifacts", "generations"].map((value) => (
                      <button
                        type="button"
                        key={value}
                        aria-pressed={value === (variant || "artifacts")}
                        onClick={() => {
                          setVariant(value);
                          navigate(`/${value}`, { replace: true });
                        }}
                      >
                        <FileText size={14} />
                        {value === "artifacts" ? c.artifacts : c.generations}
                      </button>
                    ))}
                  </div>
                )}
                {step.id === "settings" && (
                  <div className="ob-choice-row">
                    {(["theme", "security", "notifications"] as const).map((value) => (
                      <button
                        type="button"
                        key={value}
                        aria-pressed={value === (variant || "theme")}
                        onClick={() => {
                          setVariant(value);
                          navigate(`/settings?tab=${value}`, { replace: true });
                        }}
                      >
                        {c[value]}
                      </button>
                    ))}
                  </div>
                )}
                <div className="ob-tip">
                  <Sparkles size={15} />
                  <p>{info.hint}</p>
                </div>
                {!target && (
                  <p className="ob-missing" role="status">
                    {c.unavailable}
                  </p>
                )}
              </div>
              <footer className="ob-coach-footer">
                <button
                  type="button"
                  className="ob-text-button"
                  onClick={() => (progress.step ? goStep(progress.step - 1) : setScreen("welcome"))}
                >
                  <ArrowLeft size={15} />
                  {c.back}
                </button>
                <button type="button" className="ob-primary" onClick={() => goStep(progress.step + 1)}>
                  {progress.step === TOUR_STEPS.length - 1 ? c.finish : c.next}
                  <ArrowRight size={16} />
                </button>
              </footer>
              <div className="ob-bottom">
                <button className="ob-text-button" type="button" onClick={pause}>
                  {c.skip}
                </button>
                <span>{Math.round((progress.visited.length / TOUR_STEPS.length) * 100)}%</span>
              </div>
              <div
                className="ob-progress"
                role="progressbar"
                aria-label={c.progress}
                aria-valuemin={0}
                aria-valuemax={TOUR_STEPS.length}
                aria-valuenow={progress.visited.length}
              >
                <span style={{ width: `${(progress.visited.length / TOUR_STEPS.length) * 100}%` }} />
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                className="ob-icon-button ob-dismiss"
                onClick={pause}
                aria-label={c.close}
              >
                <X size={19} />
              </button>
              <div className="ob-hero">
                <div className="ob-hero-copy">
                  <div className="ob-eyebrow">
                    <Orbit size={16} /> {c.label}{" "}
                    <span className="ob-pill">{complete ? "✓" : "01 → 12"}</span>
                  </div>
                  <h1 id="ob-title">{complete ? c.complete : c.welcome}</h1>
                  <p id="ob-description">{complete ? c.completeBody : c.intro}</p>
                  <div className="ob-duration">
                    {complete ? `${progress.visited.length}/${TOUR_STEPS.length} ${c.visited}` : c.duration}
                  </div>
                </div>
                <div className={`ob-universe${complete ? " ob-celebrate" : ""}`} aria-hidden>
                  <div className="ob-orbit ob-orbit-a" />
                  <div className="ob-orbit ob-orbit-b" />
                  <div className="ob-orbit ob-orbit-c" />
                  <div className="ob-core">{complete ? <Check size={44} /> : <Orbit size={42} />}</div>
                  {[BrainCircuit, Terminal, Sparkles, ShieldCheck].map((Icon, i) => (
                    <div className={`ob-satellite ob-satellite-${i}`} key={i}>
                      <Icon size={23} />
                    </div>
                  ))}
                  {Array.from({ length: 12 }, (_, i) => (
                    <i className="ob-particle" key={i} style={{ "--i": i } as CSSProperties} />
                  ))}
                </div>
              </div>
              {complete ? (
                <div className="ob-readiness">
                  {[
                    [c.providerCheck, providerReady],
                    [c.memoryCheck, memoryReady],
                    [c.practiceCheck, !!draft.trim()],
                  ].map(([label, ready]) => (
                    <div key={String(label)}>
                      {ready ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                      <span>{label}</span>
                      <small>{ready ? c.ready : c.pending}</small>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="ob-map">
                  {c.chapters.map((title, i) => {
                    const Icon = CHAPTER_ICONS[i]!;
                    return (
                      <div key={title} style={{ "--i": i } as CSSProperties}>
                        <Icon size={20} />
                        <span>0{i + 1}</span>
                        <strong>{title}</strong>
                        <ChevronRight size={15} />
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="ob-welcome-actions">
                {complete ? (
                  <>
                    <button
                      type="button"
                      className="ob-primary"
                      onClick={() => finish(draft.trim() ? "draft" : "os")}
                    >
                      {draft.trim() ? c.goDraft : c.go}
                      <ArrowRight size={17} />
                    </button>
                    {!providerReady && (
                      <button type="button" className="ob-secondary" onClick={() => finish("provider")}>
                        {c.providerAction}
                        <ArrowUpRight size={15} />
                      </button>
                    )}
                    {!!draft.trim() && (
                      <button type="button" className="ob-text-button" onClick={() => finish("os")}>
                        {c.go}
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="ob-primary"
                      onClick={() => begin(progress.status === "completed")}
                    >
                      {canResume ? c.resume : c.start}
                      <ArrowRight size={17} />
                    </button>
                    {canResume && (
                      <button type="button" className="ob-secondary" onClick={() => begin(true)}>
                        {c.restart}
                      </button>
                    )}
                    <button type="button" className="ob-text-button" onClick={pause}>
                      {c.skip}
                    </button>
                  </>
                )}
              </div>
              <p className="ob-replay-hint">{c.replayHint}</p>
            </>
          )}
        </div>
      </div>
    </DialogPortal>
  );
}

/** A permanent entry point, also available to people who skipped the welcome. */
export function OnboardingButton() {
  const c = tourCopy(useLang());
  return (
    <button type="button" className="btn" onClick={() => window.dispatchEvent(new Event(ONBOARDING_EVENT))}>
      <Compass size={16} aria-hidden /> {c.label}
    </button>
  );
}
