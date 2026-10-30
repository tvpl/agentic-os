/**
 * The guided cleanup (.specs/features/cerebro-faxina-guiada, S5; design.md "Tela - Assistente de faxina"): one wide
 * `Modal`, the same in both shells, with a fixed header (the title, the scope, the five-step bar and the step in text)
 * and a fixed footer ("Fechar", "Voltar", the step's action). It is a chunk of its own: `CleanupHost` imports it the
 * first time a person opens it. The steps' bodies are `CleanupInventory`, `CleanupFindings` and `CleanupReview`.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Sparkles } from "lucide-react";
import { apiCall } from "../../apiCall";
import { useLocale, useT, type TKey } from "../../i18n";
import { useApiQuery, useOsSettings, useRouteQuery } from "../../queries";
import { useToast } from "../../components/ui";
import { useOsEvent } from "../../hooks/useEventStream";
import { prefersReducedMotion } from "../../hooks/usePresence";
import { Modal } from "../../ui";
import { errorMessage } from "../../views/shared";
import { useWorkContext } from "../../contexts/useWorkContext";
import type { CleanupRequest } from "../cleanupEvents";
import {
  DAY,
  localDay,
  planOf,
  remember,
  resumable,
  scopeKey,
  scopeQuery,
  type Answers,
  type ApplyResult,
  type Phase,
  type Scan,
  type Scope,
  type UndoResult,
} from "./cleanupData";
import { Band, InventoryCards, ScanProgress } from "./CleanupInventory";
import { CleanupFindings } from "./CleanupFindings";
import { DoneStep, ReviewStep } from "./CleanupReview";
import "./cleanup.css";

const STEPS: TKey[] = [
  "cleanup.step.scope",
  "cleanup.step.inventory",
  "cleanup.step.findings",
  "cleanup.step.review",
  "cleanup.step.done",
];

type Choice = { context: string } | { dir: string } | null;
type Failure = { message: string; retry: () => void } | null;
interface ScanState {
  scanId: string;
  status: Scan["status"];
  phase: Phase;
  done: number;
  total: number;
  findings: Scan["findings"];
}

function FailureBand({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useT();
  return <Band text={`${t("cleanup.failed")} ${message}`} onRetry={onRetry} />;
}

/** Five numbered circles tied by a line, each named; the current one `aria-current="step"`, the done ones a `Check`. */
export function StepBar({ step }: { step: number }) {
  const t = useT();
  return (
    <>
      <ol className="cln-steps">
        {STEPS.map((name, i) => (
          <li
            key={name}
            className="cln-step"
            aria-current={i + 1 === step ? "step" : undefined}
            data-done={i + 1 < step ? "" : undefined}
          >
            <span className="cln-dot" aria-hidden>
              {i + 1 < step ? <Check /> : i + 1}
            </span>
            <span className="cln-step-name">{t(name)}</span>
          </li>
        ))}
      </ol>
      <div className="cln-now">{t("cleanup.stepOf", { n: step, name: t(STEPS[step - 1]!) })}</div>
    </>
  );
}

// The gallery's story takes the parts through this module, so the app and the gallery fetch one chunk.
export { InventoryCards } from "./CleanupInventory";
export { FindingCard } from "./CleanupFindings";
export { ReviewStep } from "./CleanupReview";

export default function CleanupWizard({
  request,
  onClose,
}: {
  request: CleanupRequest;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const work = useWorkContext();
  const [open, setOpen] = useState(true);
  const [step, setStep] = useState<number>(request.context && request.step === 2 ? 2 : 1);
  const [forward, setForward] = useState(true);
  const [choice, setChoice] = useState<Choice>(request.context ? { context: request.context } : null);
  const touched = useRef(false);
  const [scan, setScan] = useState<ScanState | null>(null);
  const [answered, setAnswered] = useState<Answers>({});
  const [failure, setFailure] = useState<Failure>(null);
  const [applied, setApplied] = useState<ApplyResult | null>(null);
  const [undone, setUndone] = useState<UndoResult | null>(null);
  const [busy, setBusy] = useState(false);
  const scanRef = useRef<string | null>(null);

  // The palette and the two "Faxina" buttons open on "Escopo" with the active context, if any (amendment 11).
  const activeId = work.active?.id;
  useEffect(() => {
    if (!touched.current && !request.context && activeId) setChoice({ context: activeId });
  }, [activeId, request.context]);

  const ctx = choice && "context" in choice ? work.contexts.find((c) => c.id === choice.context) : undefined;
  const scope: Scope | null = !choice
    ? null
    : "dir" in choice
      ? { kind: "dir", path: choice.dir }
      : { kind: "context", id: choice.context, name: ctx?.name ?? choice.context, brief: ctx?.brief ?? null };
  const key = scope ? scopeKey(scope) : "";

  const inventory = useRouteQuery(
    ["memory", "cleanup", "inventory", key],
    "GET /api/memory/cleanup/inventory",
    { query: scope ? scopeQuery(scope) : {} },
    { enabled: scope !== null, staleTime: 30_000 },
  );
  const info = useApiQuery<{ home: string }>(["system", "info"], "/api/system/info", { staleTime: 60_000 });

  const close = useCallback(() => {
    setOpen(false);
    window.setTimeout(onClose, prefersReducedMotion() ? 0 : 170);
  }, [onClose]);
  const go = (to: number) => {
    setForward(to > step);
    setFailure(null);
    setStep(to);
  };

  /** Read a scan; a finished one with findings opens "Achados" (AC 18), one with none stays on step 2 (AC 38). */
  const read = async (scanId: string, given: Answers) => {
    const s = await apiCall("GET /api/memory/cleanup/scans/:id", { params: { id: scanId } });
    if (scanRef.current !== scanId) return;
    setScan((prev) => ({
      scanId,
      status: s.status,
      phase: s.phase,
      done: prev?.scanId === scanId ? prev.done : 0,
      total: prev?.scanId === scanId ? prev.total : 0,
      findings: s.findings,
    }));
    if (s.status === "failed") throw new Error(s.code ?? "scan_failed");
    if (s.status === "finished" && scope) {
      remember(scopeKey(scope), scanId, given, Date.now());
      if (s.findings.length > 0) {
        setForward(true);
        setStep(3);
      }
    }
  };
  /** One request of a step: its failure is the step's band, whose "Tentar de novo" runs it again (AC 39). */
  const task = async (fn: () => Promise<void>, again: () => void) => {
    setFailure(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setFailure({ message: errorMessage(err, t), retry: again });
    } finally {
      setBusy(false);
    }
  };
  const startScan = (): Promise<void> =>
    task(
      async () => {
        if (!scope) return;
        const { scanId } = await apiCall("POST /api/memory/cleanup/scans", { body: scopeQuery(scope) });
        scanRef.current = scanId;
        setScan({ scanId, status: "running", phase: "inventory", done: 0, total: 0, findings: [] });
        await read(scanId, answered);
      },
      () => void startScan(),
    );
  const scanFailed = (err: unknown) =>
    setFailure({ message: errorMessage(err, t), retry: () => void startScan() });

  useOsEvent(["cleanup.progress", "cleanup.finished", "cleanup.failed"], (event) => {
    const p = event.payload as { scanId?: string; phase?: Phase; done?: number; total?: number };
    if (!p.scanId || p.scanId !== scanRef.current) return;
    if (event.type === "cleanup.progress")
      setScan((prev) =>
        prev ? { ...prev, phase: p.phase ?? prev.phase, done: p.done ?? 0, total: p.total ?? 0 } : prev,
      );
    else read(p.scanId, answered).catch(scanFailed);
  });

  /** Step 2 with a scope: within a day of a finished scan of it, back at "Achados" with its answers (AC 40). */
  const enter = async () => {
    go(2);
    scanRef.current = null;
    setScan(null);
    setAnswered({});
    const saved = scope ? resumable(scopeKey(scope)) : null;
    if (!saved) return;
    scanRef.current = saved.scanId;
    setAnswered(saved.answered);
    try {
      await read(saved.scanId, saved.answered);
    } catch {
      scanRef.current = null;
      setScan(null);
    }
  };
  // Opened at step 2 (the selector's entry): the same check, once.
  const entered = useRef(false);
  useEffect(() => {
    if (entered.current || step !== 2 || !scope) return;
    entered.current = true;
    void enter();
  });

  /** "Cancelar" closes the wizard; the scan ends on the server by itself and nothing is applied (amendment 17). */
  const cancel = () => {
    scanRef.current = null;
    toast(t("cleanup.cancelled"), "info");
    close();
  };

  const onAnswered = (entries: Answers) =>
    setAnswered((prev) => {
      const next = { ...prev, ...entries };
      if (scope && scan) remember(scopeKey(scope), scan.scanId, next);
      return next;
    });

  const memoryDir = info.data ? `${info.data.home}/memory` : null;
  const plan = scan && memoryDir ? planOf(scan.findings, answered, memoryDir, localDay()) : [];

  const apply = (): Promise<void> =>
    task(
      async () => {
        if (!scan) return;
        setApplied(await apiCall("POST /api/memory/cleanup/apply", { body: { scanId: scan.scanId } }));
        go(5);
      },
      () => void apply(),
    );
  const undo = (): Promise<void> =>
    task(
      async () => {
        if (applied?.manifest)
          setUndone(await apiCall("POST /api/memory/cleanup/undo", { body: { manifest: applied.manifest } }));
      },
      () => void undo(),
    );

  const running = scan?.status === "running";
  const empty = step === 2 && scan?.status === "finished" && scan.findings.length === 0;
  const nothing = step === 4 && plan.length === 0;
  const settings = useOsSettings({ staleTime: 30_000 });
  const folders = (settings.data?.indexedFolders ?? []).filter((f) => f.enabled !== false).map((f) => f.path);
  const bare =
    step === 1 && work.list.isSuccess && settings.isSuccess && !work.contexts.length && !folders.length;

  // The step's action (.btn.primary); "Fechar" itself where the step ends the wizard.
  type Action = { label: string; run: () => void; disabled?: boolean };
  const closing: Action = { label: t("common.close"), run: close };
  const action: Action | null =
    step === 1
      ? bare
        ? null
        : { label: t("cleanup.action.see"), run: () => void enter(), disabled: !inventory.isSuccess }
      : step === 2
        ? empty
          ? closing
          : {
              label: t("cleanup.action.scan"),
              run: () => void startScan(),
              disabled: busy || running || !inventory.isSuccess,
            }
        : step === 3
          ? { label: t("cleanup.action.review"), run: () => go(4) }
          : step === 4
            ? nothing
              ? closing
              : { label: t("cleanup.action.apply"), run: () => void apply(), disabled: busy }
            : closing;

  const invFailed = inventory.isError && (
    <FailureBand message={errorMessage(inventory.error, t)} onRetry={() => void inventory.refetch()} />
  );
  let body: ReactNode = null;
  if (step === 1)
    body = (
      <ScopeStep
        choice={choice}
        folders={folders}
        bare={bare}
        onChoose={(c) => {
          touched.current = true;
          setChoice(c);
        }}
        scope={scope}
        files={inventory.data?.total.count}
        failed={invFailed}
      />
    );
  else if (step === 2)
    body = (
      <>
        {invFailed || <InventoryCards data={inventory.data} />}
        {running && scan && (
          <ScanProgress phase={scan.phase} done={scan.done} total={scan.total} onCancel={cancel} />
        )}
        {empty && (
          <p className="cln-empty" role="status">
            <Sparkles aria-hidden />
            {t("cleanup.empty")}
          </p>
        )}
      </>
    );
  else if (step === 3 && scan && scope)
    body = (
      <CleanupFindings
        scanId={scan.scanId}
        findings={scan.findings}
        answered={answered}
        onAnswered={onAnswered}
        brief={scope.kind === "context" ? scope.brief : null}
      />
    );
  else if (step === 4) body = <ReviewStep plan={plan} />;
  else if (applied)
    body = (
      <DoneStep
        result={applied}
        proposals={plan.filter((l) => l.to === null).length}
        undone={undone}
        onOpen={close}
      />
    );

  return (
    <Modal open={open} title={t("cleanup.title")} onClose={onClose} className="cln-modal">
      <div className="cln-head">
        {scope && (
          <div className={scope.kind === "dir" ? "cln-scope-line cln-mono" : "cln-scope-line"}>
            {scope.kind === "dir" ? scope.path : scope.name}
          </div>
        )}
        <StepBar step={step} />
      </div>
      <div className="cln-body">
        <div key={step} className="cln-stage" data-back={forward ? undefined : ""}>
          {failure && <FailureBand message={failure.message} onRetry={failure.retry} />}
          {body}
        </div>
      </div>
      <div className="cln-foot">
        {action !== closing && (
          <button type="button" className="btn ghost" onClick={close}>
            {t("common.close")}
          </button>
        )}
        <span className="cln-gap" />
        {step < 5 ? (
          <button type="button" className="btn" disabled={step === 1} onClick={() => go(step - 1)}>
            {t("common.back")}
          </button>
        ) : (
          !undone &&
          applied?.manifest && (
            <button type="button" className="btn" disabled={busy} onClick={() => void undo()}>
              {t("cleanup.undo")}
            </button>
          )
        )}
        {action && (
          <button type="button" className="btn primary" disabled={action.disabled} onClick={action.run}>
            {action.label}
          </button>
        )}
      </div>
    </Modal>
  );
}

/**
 * Step 1: the contexts (name, main path, file count), then "Ou uma pasta…" over the indexed folders; a chosen scope
 * reads "N arquivos, última mudança há D dias" (design.md "Etapa 1").
 */
function ScopeStep(p: {
  choice: Choice;
  folders: string[];
  bare: boolean;
  onChoose: (c: Choice) => void;
  scope: Scope | null;
  files: number | undefined;
  failed: ReactNode;
}) {
  const t = useT();
  const locale = useLocale();
  const work = useWorkContext();
  const [dir, setDir] = useState(p.choice && "dir" in p.choice ? p.choice.dir : "");
  const recent = useRouteQuery(
    ["memory", "cleanup", "recent", p.scope ? scopeKey(p.scope) : ""],
    "GET /api/memory/search",
    { query: { q: "", mode: "text", limit: 1, ...(p.scope ? scopeQuery(p.scope) : {}) } },
    { enabled: p.scope !== null, staleTime: 30_000 },
  );
  if (p.bare) return <p className="cln-empty">{t("cleanup.scope.nothing")}</p>;
  const last = recent.data?.[0]?.mtime;
  const picked = p.choice && "context" in p.choice ? p.choice.context : null;
  return (
    <div className="cln-scope">
      <div role="radiogroup" aria-label={t("cleanup.step.scope")} className="cln-contexts">
        {work.contexts.map((c) => (
          <label key={c.id} className="cln-context">
            <input
              type="radio"
              name="cln-scope"
              checked={picked === c.id}
              onChange={() => {
                setDir("");
                p.onChoose({ context: c.id });
              }}
            />
            <span className="cln-context-name">{c.name}</span>
            <span className="cln-mono">{c.paths[0]?.path ?? c.notesDir}</span>
            <span className="cln-count">{t("context.files", { n: c.files.toLocaleString(locale) })}</span>
          </label>
        ))}
      </div>
      <label className="cln-field">
        <span>{t("cleanup.scope.folder")}</span>
        <input
          className="input cln-mono"
          list="cln-folders"
          value={dir}
          onChange={(e) => {
            const value = e.target.value;
            setDir(value);
            p.onChoose(/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(value.trim()) ? { dir: value.trim() } : null);
          }}
        />
        <datalist id="cln-folders">
          {p.folders.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </label>
      {p.failed}
      {p.scope && p.files !== undefined && recent.isSuccess && (
        <p className="cln-chosen">
          {last === undefined
            ? t("context.files", { n: p.files })
            : t("cleanup.scope.chosen", {
                n: p.files,
                d: Math.max(0, Math.floor((Date.now() - last) / DAY)),
              })}
        </p>
      )}
    </div>
  );
}
