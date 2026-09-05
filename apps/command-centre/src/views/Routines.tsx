import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarClock,
  Cloud,
  Copy,
  Monitor,
  Pause,
  Pencil,
  Play,
  Plus,
  Server,
  Trash2,
  Zap,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type ProviderId,
  type RoutineDelivery,
  type RoutineHistoryEntry,
  type RoutineKind,
  type RoutineRunner,
  type RoutineStatus,
  type RoutineSummary,
  type Skill,
} from "../api";
import { useLocale, useT, type TKey } from "../i18n";
import { qk, useApiQuery, useOsProviders, useOsRoutines, useOsSettings, useOsSkills } from "../queries";
import { ErrorBox, Modal, Skeleton, StatusBadge, timeAgo, useToast } from "../components/ui";
import { Badge, Button, EmptyState, Field, Segmented } from "../components/primitives";
import { useConfirm } from "../hooks/useConfirm";
import { errorMessage, isOffline } from "./shared";
import { describeSchedule, isValidCron, isValidTimeZone, nextFires, timeZoneOptions } from "./cron";
import "./backend.css";

const KINDS: RoutineKind[] = ["cron", "at", "every", "on-exit", "heartbeat"];
const RUNNERS: RoutineRunner[] = ["local", "service", "remote"];
const DELIVERIES: RoutineDelivery[] = ["announce", "webhook", "none"];
const EXIT_STATUSES = ["done", "failed", "timed_out"];

const KIND_KEY = (k: RoutineKind): TKey => `backend.kind.${k}` as TKey;
const RUNNER_KEY = (r: RoutineRunner): TKey => `backend.runner.${r}` as TKey;

function RunnerIcon({ runner }: { runner: RoutineRunner }) {
  if (runner === "remote") return <Cloud aria-hidden />;
  if (runner === "service") return <Server aria-hidden />;
  return <Monitor aria-hidden />;
}

/** A v1 server sends no `runner`/`kind`: fall back to the safe defaults. */
export function routineRunner(r: Pick<RoutineStatus, "runner">): RoutineRunner {
  return r.runner === "service" || r.runner === "remote" ? r.runner : "local";
}
export function routineKind(r: Pick<RoutineStatus, "kind">): RoutineKind {
  return r.kind && KINDS.includes(r.kind) ? r.kind : "cron";
}

/** `settings.routines.allowWebhooks`, read defensively (the settings view is untyped). */
function readAllowWebhooks(settings: unknown): boolean {
  const routines = (settings as { routines?: { allowWebhooks?: unknown } } | undefined)?.routines;
  return routines?.allowWebhooks === true;
}

export default function Routines() {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const routines = useOsRoutines({ refetchInterval: 300_000 });
  const skills = useOsSkills();
  const settings = useOsSettings();
  // The summary endpoint is optional: a server without it just hides the counts.
  const summary = useApiQuery<RoutineSummary>([...qk.routines, "summary"], "/api/routines/summary", {
    refetchInterval: 300_000,
    retry: false,
  });
  const [editing, setEditing] = useState<RoutineStatus | "new" | null>(null);
  const [historyFor, setHistoryFor] = useState<RoutineStatus | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.routines }).catch(() => undefined);
    qc.invalidateQueries({ queryKey: ["runs"] }).catch(() => undefined);
  };
  const act = useMutation({
    mutationFn: async ({ fn }: { fn: () => Promise<unknown>; okMsg?: string }) => fn(),
    onSuccess: (_r, vars) => {
      if (vars.okMsg) toast(vars.okMsg, "ok");
      invalidate();
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  if (routines.isPending && !routines.data)
    return (
      <div className="page">
        <Skeleton lines={6} />
      </div>
    );
  if (routines.error && !routines.data)
    return (
      <div className="page">
        <ErrorBox
          message={errorMessage(routines.error)}
          offline={isOffline(routines.error)}
          onRetry={() => void routines.refetch()}
        />
      </div>
    );
  const list = routines.data ?? [];
  const counts = summary.data;

  const remove = async (r: RoutineStatus) => {
    if (
      await confirm({
        title: `${t("common.delete")} "${r.name}"?`,
        body: t("routines.deleteBody"),
        danger: true,
        confirmLabel: t("common.delete"),
      })
    ) {
      act.mutate({
        fn: () => api.del(`/api/routines/${encodeURIComponent(r.id)}`),
        okMsg: t("routines.deleted"),
      });
    }
  };
  const testRun = (r: RoutineStatus) =>
    act.mutate({
      fn: async () => {
        const res = await api.post<{ runId: string | null }>(`/api/routines/${encodeURIComponent(r.id)}/run`);
        if (res.runId) navigate(`/runs/${res.runId}`);
      },
    });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("routines.title")}</h1>
          <p className="sub">{t("routines.sub")}</p>
          {counts && (
            <div className="rt-head-counts" aria-live="polite">
              <span>{t("backend.summary", { fired: counts.firedToday, total: counts.totalToday })}</span>
              {RUNNERS.filter((runner) => (counts.byRunner[runner] ?? 0) > 0).map((runner) => (
                <span key={runner} className="rt-count">
                  <RunnerIcon runner={runner} /> {t(RUNNER_KEY(runner))} {counts.byRunner[runner]}
                </span>
              ))}
            </div>
          )}
        </div>
        <Button variant="primary" icon={<Plus aria-hidden />} onClick={() => setEditing("new")}>
          {t("routines.new")}
        </Button>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={<CalendarClock aria-hidden />}
          title={t("routines.emptyTitle")}
          body={t("routines.emptyBody")}
          action={
            <Button variant="primary" icon={<Plus aria-hidden />} onClick={() => setEditing("new")}>
              {t("routines.new")}
            </Button>
          }
        />
      ) : (
        list.map((r) => {
          const runner = routineRunner(r);
          const kind = routineKind(r);
          return (
            <div className={`card routine-card${r.firedToday ? " fired-today" : ""}`} key={r.id}>
              <div className="routine-main">
                <h3 className="routine-title">
                  {r.name}
                  <span className="rt-badges">
                    <Badge kind="meta">{t(KIND_KEY(kind))}</Badge>
                    <Badge
                      kind="meta"
                      className={`rt-runner runner-${runner}`}
                      title={r.remoteName ?? t(RUNNER_KEY(runner))}
                    >
                      <RunnerIcon runner={runner} />
                      {r.remoteName ?? t(RUNNER_KEY(runner))}
                    </Badge>
                    {!r.healthy && (
                      <Badge kind="state" tone="danger">
                        {t("routines.failing")}
                      </Badge>
                    )}
                    {!r.enabled && (
                      <Badge kind="meta">
                        {r.endedReason === "run_once_fired"
                          ? t("backend.endedReason.run_once_fired")
                          : r.endedReason === "run_once_missed"
                            ? t("backend.endedReason.run_once_missed")
                            : t("common.disabled")}
                      </Badge>
                    )}
                    {r.firedToday && <Badge kind="meta">{t("backend.firedToday")}</Badge>}
                  </span>
                </h3>
                <div className="routine-line">
                  {r.skillSlug ? <span className="mono">/{r.skillSlug}</span> : (r.prompt ?? "").slice(0, 70)}
                  {" · "}
                  <span className="mono">{describeSchedule(r, (k, vars) => t(k as TKey, vars))}</span>
                  {kind !== "on-exit" && <> · {r.timezone || t("routines.tzInherited")}</>} · {r.provider}
                  {r.context === "isolated" && <> · {t("backend.context.isolated")}</>}
                  {r.delivery && r.delivery !== "announce" && (
                    <> · {t(`backend.delivery.${r.delivery}` as TKey)}</>
                  )}
                </div>
                <div className="routine-meta">
                  {t("routines.next")}: {r.enabled && r.nextRunAt ? timeAgo(r.nextRunAt, locale) : "—"}
                  {" · "}
                  {t("routines.last")}: {r.lastFiredAt ? timeAgo(r.lastFiredAt, locale) : t("common.never")}
                  {r.lastStatus ? (
                    <>
                      {" "}
                      <StatusBadge status={r.lastStatus} />
                    </>
                  ) : null}
                </div>
              </div>
              <div className="row-actions">
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Zap aria-hidden />}
                  onClick={() => testRun(r)}
                  loading={act.isPending}
                >
                  {t("routines.testRun")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={r.enabled ? <Pause aria-hidden /> : <Play aria-hidden />}
                  onClick={() =>
                    act.mutate({ fn: () => api.post(`/api/routines/${encodeURIComponent(r.id)}/toggle`) })
                  }
                >
                  {r.enabled ? t("routines.pause") : t("routines.resume")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Pencil aria-hidden />}
                  aria-label={`${t("common.edit")} ${r.name}`}
                  title={t("common.edit")}
                  onClick={() => setEditing(r)}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Copy aria-hidden />}
                  aria-label={t("routines.duplicate")}
                  title={t("routines.duplicate")}
                  onClick={() =>
                    act.mutate({
                      fn: () => api.post(`/api/routines/${encodeURIComponent(r.id)}/duplicate`),
                      okMsg: t("routines.duplicated"),
                    })
                  }
                />
                <Button size="sm" variant="secondary" onClick={() => setHistoryFor(r)}>
                  {t("routines.history")}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  icon={<Trash2 aria-hidden />}
                  aria-label={`${t("common.delete")} ${r.name}`}
                  title={t("common.delete")}
                  onClick={() => void remove(r)}
                />
              </div>
            </div>
          );
        })
      )}

      {editing && (
        <RoutineModal
          routine={editing === "new" ? null : editing}
          skills={skills.data ?? []}
          allowWebhooks={readAllowWebhooks(settings.data)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            invalidate();
          }}
        />
      )}
      {historyFor && <HistoryModal routine={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

const PROFILES = ["read_only", "review_before_write", "controlled_write", "approved_automation"] as const;

/** ISO datetime → the `datetime-local` shape the input expects (local wall time). */
function toLocalInput(iso: string | null | undefined): string {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

function RoutineModal({
  routine,
  skills,
  allowWebhooks,
  onClose,
  onSaved,
}: {
  routine: RoutineStatus | null;
  skills: Skill[];
  allowWebhooks: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const providers = useOsProviders();
  const [form, setForm] = useState(() => ({
    id: routine?.id ?? "",
    name: routine?.name ?? "",
    skillSlug: routine?.skillSlug ?? "",
    prompt: routine?.prompt ?? "",
    kind: routineKind(routine ?? { kind: undefined }),
    schedule: routine?.schedule ?? "0 9 * * 1-5",
    at: toLocalInput(routine?.at),
    everyValue: routine?.every?.value ?? 30,
    everyUnit: routine?.every?.unit ?? ("minutes" as "minutes" | "hours"),
    onExitSkill: routine?.onExit?.skillSlug ?? "",
    onExitStatuses: routine?.onExit?.statuses ?? EXIT_STATUSES,
    hbInterval: routine?.heartbeat?.intervalMinutes ?? 30,
    hbActive: Boolean(routine?.heartbeat?.activeHours),
    hbStart: routine?.heartbeat?.activeHours?.start ?? "08:00",
    hbEnd: routine?.heartbeat?.activeHours?.end ?? "20:00",
    hbTz: routine?.heartbeat?.activeHours?.tz ?? "",
    hbToken: routine?.heartbeat?.okToken ?? "HEARTBEAT_OK",
    timezone: routine?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    runner: routineRunner(routine ?? { runner: undefined }),
    remoteName: routine?.remoteName ?? "",
    context: routine?.context ?? ("main" as "main" | "isolated"),
    delivery: routine?.delivery ?? ("announce" as RoutineDelivery),
    webhookUrl: routine?.webhookUrl ?? "",
    provider: routine?.provider ?? ("claude" as ProviderId),
    effort: routine?.effort ?? "default",
    missedPolicy: routine?.missedPolicy ?? "skip",
    timeoutMs: routine?.timeoutMs ?? 600000,
    maxAttempts: routine?.maxAttempts ?? 1,
    profile: routine?.profile ?? "read_only",
    enabled: routine?.enabled ?? false,
  }));
  const [tzQuery, setTzQuery] = useState("");
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const cronOk = form.kind !== "cron" || isValidCron(form.schedule);
  const tzOk = isValidTimeZone(form.timezone) && (!form.hbActive || isValidTimeZone(form.hbTz));
  const atMs = form.at ? Date.parse(form.at) : NaN;
  const kindOk =
    form.kind === "cron"
      ? cronOk
      : form.kind === "at"
        ? Number.isFinite(atMs)
        : form.kind === "every"
          ? form.everyValue >= 1
          : form.kind === "on-exit"
            ? form.onExitSkill.length > 0 && form.onExitSkill !== form.skillSlug
            : form.hbInterval >= 1 && (!form.hbActive || form.hbStart !== form.hbEnd);
  const webhookOk =
    form.delivery !== "webhook" || (allowWebhooks && /^https?:\/\/\S+$/i.test(form.webhookUrl));

  /** The routine shape `nextFires` needs, kept in sync with the form. */
  const draft = useMemo(
    () => ({
      kind: form.kind,
      schedule: form.schedule,
      timezone: form.timezone,
      at: form.at ? new Date(form.at).toISOString() : null,
      every: { value: form.everyValue, unit: form.everyUnit },
      onExit: form.onExitSkill ? { skillSlug: form.onExitSkill, statuses: form.onExitStatuses } : null,
      heartbeat: {
        intervalMinutes: form.hbInterval,
        activeHours: form.hbActive ? { start: form.hbStart, end: form.hbEnd, tz: form.hbTz } : null,
        okToken: form.hbToken,
      },
      createdAt: routine?.createdAt ?? Date.now(),
      enabled: true,
    }),
    [form, routine?.createdAt],
  );
  const preview = useMemo(
    () => (kindOk && tzOk ? nextFires(draft, Date.now(), 5) : []),
    [draft, kindOk, tzOk],
  );
  const zones = useMemo(() => {
    const all = timeZoneOptions();
    const q = tzQuery.trim().toLowerCase();
    return (q ? all.filter((z) => z.toLowerCase().includes(q)) : all).slice(0, 400);
  }, [tzQuery]);

  const save = useMutation({
    mutationFn: async () => {
      const id =
        form.id ||
        form.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
      const payload = {
        id,
        name: form.name,
        skillSlug: form.skillSlug || null,
        prompt: form.skillSlug ? null : form.prompt || null,
        kind: form.kind,
        schedule: form.kind === "cron" ? form.schedule : "",
        at: form.kind === "at" && form.at ? new Date(form.at).toISOString() : null,
        every: form.kind === "every" ? { value: form.everyValue, unit: form.everyUnit } : null,
        onExit:
          form.kind === "on-exit" ? { skillSlug: form.onExitSkill, statuses: form.onExitStatuses } : null,
        heartbeat:
          form.kind === "heartbeat"
            ? {
                intervalMinutes: form.hbInterval,
                activeHours: form.hbActive ? { start: form.hbStart, end: form.hbEnd, tz: form.hbTz } : null,
                quiet: true,
                okToken: form.hbToken,
              }
            : null,
        timezone: form.timezone,
        runner: form.runner,
        remoteName: form.runner === "remote" ? form.remoteName || null : null,
        context: form.context,
        delivery: form.delivery,
        webhookUrl: form.delivery === "webhook" ? form.webhookUrl || null : null,
        provider: form.provider,
        effort: form.effort,
        missedPolicy: form.missedPolicy,
        timeoutMs: form.timeoutMs,
        maxAttempts: form.maxAttempts,
        profile: form.profile,
        enabled: form.enabled,
        endedReason: form.enabled ? null : (routine?.endedReason ?? null),
        model: routine?.model ?? null,
        inputs: routine?.inputs ?? {},
        backoffMs: routine?.backoffMs ?? 60000,
        retryOnTimeout: routine?.retryOnTimeout ?? false,
        notify: routine?.notify ?? true,
        workingDir: routine?.workingDir ?? null,
        artifactsSubdir: routine?.artifactsSubdir ?? null,
        createdAt: routine?.createdAt ?? Date.now(),
      };
      if (routine) await api.put(`/api/routines/${encodeURIComponent(routine.id)}`, payload);
      else await api.post("/api/routines", payload);
    },
    onSuccess: () => {
      toast(t("common.saved"), "ok");
      onSaved();
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const nameOk = form.name.trim().length > 0;
  const bodyOk = Boolean(form.skillSlug) || form.prompt.trim().length > 0;
  const canSave = nameOk && bodyOk && kindOk && tzOk && webhookOk && !save.isPending;
  const enabledProviders = (providers.data ?? []).filter((p) => p.enabled).map((p) => p.id);
  const enabledSkills = skills.filter((s) => s.enabled);
  const overnight = form.hbActive && form.hbStart > form.hbEnd;

  return (
    <Modal title={routine ? form.name : t("routines.new")} onClose={onClose}>
      <div className="grid grid-2">
        <Field
          label={t("routines.name")}
          htmlFor="rt-name"
          error={!nameOk && form.name !== "" ? t("common.required") : undefined}
        >
          <input
            id="rt-name"
            className="input"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>
        <Field label={t("routines.skill")} htmlFor="rt-skill" hint={t("routines.skillHint")}>
          <select
            id="rt-skill"
            className="input"
            value={form.skillSlug}
            onChange={(e) => set({ skillSlug: e.target.value })}
          >
            <option value="">{t("routines.promptOnly")}</option>
            {enabledSkills.map((s) => (
              <option key={s.slug} value={s.slug}>
                /{s.slug}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {!form.skillSlug && (
        <Field label={t("runs.prompt")} htmlFor="rt-prompt">
          <textarea
            id="rt-prompt"
            className="input"
            rows={3}
            value={form.prompt}
            onChange={(e) => set({ prompt: e.target.value })}
          />
        </Field>
      )}

      <div className="field">
        <span className="hud-label">{t("backend.kind")}</span>
        <Segmented
          ariaLabel={t("backend.kind")}
          value={form.kind}
          onChange={(kind) => set({ kind })}
          options={KINDS.map((k) => ({ value: k, label: t(KIND_KEY(k)) }))}
        />
      </div>
      <p className="rt-kind-hint">{t(`backend.kind.${form.kind}Hint` as TKey)}</p>

      {form.kind === "cron" && (
        <div className="grid grid-2">
          <Field
            label={t("routines.schedule")}
            htmlFor="rt-cron"
            hint={t("routines.cronHint")}
            error={cronOk ? undefined : t("routines.cronInvalid")}
          >
            <input
              id="rt-cron"
              className="input mono"
              value={form.schedule}
              onChange={(e) => set({ schedule: e.target.value })}
              aria-invalid={!cronOk}
            />
          </Field>
          <TimezoneField
            form={form}
            set={set}
            tzOk={tzOk}
            tzQuery={tzQuery}
            setTzQuery={setTzQuery}
            zones={zones}
          />
        </div>
      )}

      {form.kind === "at" && (
        <div className="grid grid-2">
          <Field
            label={t("backend.at.label")}
            htmlFor="rt-at"
            hint={t("backend.kind.atHint")}
            error={Number.isFinite(atMs) || !form.at ? undefined : t("backend.sched.at.invalid")}
          >
            <input
              id="rt-at"
              type="datetime-local"
              className="input"
              value={form.at}
              onChange={(e) => set({ at: e.target.value })}
              aria-invalid={form.at !== "" && !Number.isFinite(atMs)}
            />
          </Field>
          <TimezoneField
            form={form}
            set={set}
            tzOk={tzOk}
            tzQuery={tzQuery}
            setTzQuery={setTzQuery}
            zones={zones}
          />
        </div>
      )}

      {form.kind === "every" && (
        <div className="rt-inline">
          <Field label={t("backend.every.label")} htmlFor="rt-every">
            <input
              id="rt-every"
              type="number"
              min={1}
              className="input"
              value={form.everyValue}
              onChange={(e) => set({ everyValue: Math.max(1, Number(e.target.value) || 1) })}
            />
          </Field>
          <Field label={t("backend.every.unit")} htmlFor="rt-every-unit">
            <select
              id="rt-every-unit"
              className="input"
              value={form.everyUnit}
              onChange={(e) => set({ everyUnit: e.target.value as "minutes" | "hours" })}
            >
              <option value="minutes">{t("backend.every.minutes")}</option>
              <option value="hours">{t("backend.every.hours")}</option>
            </select>
          </Field>
        </div>
      )}

      {form.kind === "on-exit" && (
        <div className="grid grid-2">
          <Field
            label={t("backend.onExit.skill")}
            htmlFor="rt-onexit"
            hint={t("backend.onExit.hint")}
            error={
              form.onExitSkill && form.onExitSkill === form.skillSlug ? t("backend.onExit.hint") : undefined
            }
          >
            <select
              id="rt-onexit"
              className="input"
              value={form.onExitSkill}
              onChange={(e) => set({ onExitSkill: e.target.value })}
            >
              <option value="">—</option>
              {enabledSkills.map((s) => (
                <option key={s.slug} value={s.slug}>
                  /{s.slug}
                </option>
              ))}
            </select>
          </Field>
          <div className="field">
            <span className="hud-label">{t("backend.onExit.statuses")}</span>
            <div className="rt-inline" role="group" aria-label={t("backend.onExit.statuses")}>
              {EXIT_STATUSES.map((status) => (
                <label className="check" key={status}>
                  <input
                    type="checkbox"
                    checked={form.onExitStatuses.includes(status)}
                    onChange={(e) =>
                      set({
                        onExitStatuses: e.target.checked
                          ? [...form.onExitStatuses, status]
                          : form.onExitStatuses.filter((s) => s !== status),
                      })
                    }
                  />
                  <span className="mono">{status}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {form.kind === "heartbeat" && (
        <>
          <div className="rt-inline">
            <Field label={t("backend.hb.interval")} htmlFor="rt-hb">
              <input
                id="rt-hb"
                type="number"
                min={1}
                className="input"
                value={form.hbInterval}
                onChange={(e) => set({ hbInterval: Math.max(1, Number(e.target.value) || 1) })}
              />
            </Field>
            <Field label={t("backend.hb.token")} htmlFor="rt-hb-token" hint={t("backend.hb.tokenHint")}>
              <input
                id="rt-hb-token"
                className="input mono"
                value={form.hbToken}
                onChange={(e) => set({ hbToken: e.target.value })}
              />
            </Field>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={form.hbActive}
              onChange={(e) => set({ hbActive: e.target.checked })}
            />
            <span>{t("backend.hb.activeHours")}</span>
          </label>
          {form.hbActive && (
            <>
              <div className="rt-inline">
                <Field label={t("backend.hb.start")} htmlFor="rt-hb-start">
                  <input
                    id="rt-hb-start"
                    type="time"
                    className="input"
                    value={form.hbStart}
                    onChange={(e) => set({ hbStart: e.target.value })}
                  />
                </Field>
                <Field label={t("backend.hb.end")} htmlFor="rt-hb-end">
                  <input
                    id="rt-hb-end"
                    type="time"
                    className="input"
                    value={form.hbEnd}
                    onChange={(e) => set({ hbEnd: e.target.value })}
                  />
                </Field>
                <Field
                  label={t("backend.hb.tz")}
                  htmlFor="rt-hb-tz"
                  error={isValidTimeZone(form.hbTz) ? undefined : t("routines.tzInvalid")}
                >
                  <input
                    id="rt-hb-tz"
                    className="input mono"
                    placeholder={form.timezone || "UTC"}
                    value={form.hbTz}
                    onChange={(e) => set({ hbTz: e.target.value })}
                  />
                </Field>
              </div>
              {overnight && <p className="rt-kind-hint">{t("backend.hb.overnight")}</p>}
            </>
          )}
          <div className="grid grid-2">
            <TimezoneField
              form={form}
              set={set}
              tzOk={tzOk}
              tzQuery={tzQuery}
              setTzQuery={setTzQuery}
              zones={zones}
            />
          </div>
        </>
      )}

      <div className="notice rt-fires" aria-live="polite">
        <span className="hud-label">{t("backend.nextFires")}</span>
        {preview.length === 0 ? (
          <span className="widget-muted">
            {form.kind === "on-exit" ? t("backend.noFires") : t("routines.noUpcoming")}
          </span>
        ) : (
          <ul>
            {preview.map((ts) => (
              <li key={ts} className="mono">
                {new Date(ts).toLocaleString(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: form.timezone || undefined,
                })}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-2">
        <Field label={t("backend.runner")} htmlFor="rt-runner" hint={t("backend.runner.hint")}>
          <select
            id="rt-runner"
            className="input"
            value={form.runner}
            onChange={(e) => set({ runner: e.target.value as RoutineRunner })}
          >
            {RUNNERS.map((r) => (
              <option key={r} value={r}>
                {t(RUNNER_KEY(r))}
              </option>
            ))}
          </select>
        </Field>
        {form.runner === "remote" && (
          <Field
            label={t("backend.remoteName")}
            htmlFor="rt-remote"
            hint={t("backend.remoteNameHint")}
            error={form.remoteName.trim() ? undefined : t("common.required")}
          >
            <input
              id="rt-remote"
              className="input"
              value={form.remoteName}
              onChange={(e) => set({ remoteName: e.target.value })}
            />
          </Field>
        )}
        <Field label={t("backend.context")} htmlFor="rt-context" hint={t("backend.context.hint")}>
          <select
            id="rt-context"
            className="input"
            value={form.context}
            onChange={(e) => set({ context: e.target.value as "main" | "isolated" })}
          >
            <option value="main">{t("backend.context.main")}</option>
            <option value="isolated">{t("backend.context.isolated")}</option>
          </select>
        </Field>
        <Field label={t("backend.delivery")} htmlFor="rt-delivery" hint={t("backend.delivery.hint")}>
          <select
            id="rt-delivery"
            className="input"
            value={form.delivery}
            onChange={(e) => set({ delivery: e.target.value as RoutineDelivery })}
          >
            {DELIVERIES.map((d) => (
              <option key={d} value={d} disabled={d === "webhook" && !allowWebhooks}>
                {t(`backend.delivery.${d}` as TKey)}
                {d === "webhook" && !allowWebhooks ? ` (${t("common.disabled")})` : ""}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {form.delivery === "webhook" && (
        <Field
          label={t("backend.webhookUrl")}
          htmlFor="rt-webhook"
          hint={allowWebhooks ? undefined : t("backend.webhookOff")}
          error={
            webhookOk ? undefined : allowWebhooks ? t("backend.webhookInvalid") : t("backend.webhookOff")
          }
        >
          <input
            id="rt-webhook"
            className="input mono"
            value={form.webhookUrl}
            onChange={(e) => set({ webhookUrl: e.target.value })}
            aria-invalid={!webhookOk}
          />
        </Field>
      )}

      <div className="grid grid-2">
        <Field
          label={t("skills.provider")}
          htmlFor="rt-provider"
          hint={
            enabledProviders.length && !enabledProviders.includes(form.provider)
              ? t("routines.providerDisabled")
              : undefined
          }
        >
          <select
            id="rt-provider"
            className="input"
            value={form.provider}
            onChange={(e) => set({ provider: e.target.value as ProviderId })}
          >
            {(["claude", "cursor", "codex"] as ProviderId[]).map((p) => (
              <option key={p} value={p}>
                {p}
                {enabledProviders.length && !enabledProviders.includes(p) ? ` (${t("common.disabled")})` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("routines.missed")} htmlFor="rt-missed">
          <select
            id="rt-missed"
            className="input"
            value={form.missedPolicy}
            onChange={(e) => set({ missedPolicy: e.target.value })}
          >
            <option value="skip">{t("routines.missed.skip")}</option>
            <option value="run_on_boot">{t("routines.missed.run_on_boot")}</option>
          </select>
        </Field>
        <Field label={t("routines.timeoutMin")} htmlFor="rt-timeout">
          <input
            id="rt-timeout"
            type="number"
            className="input"
            min={1}
            value={Math.round(form.timeoutMs / 60000)}
            onChange={(e) => set({ timeoutMs: Math.max(1, Number(e.target.value)) * 60000 })}
          />
        </Field>
        <Field label={t("routines.attempts")} htmlFor="rt-attempts" hint={t("routines.attemptsHint")}>
          <input
            id="rt-attempts"
            type="number"
            className="input"
            min={1}
            max={5}
            value={form.maxAttempts}
            onChange={(e) => set({ maxAttempts: Math.min(5, Math.max(1, Number(e.target.value))) })}
          />
        </Field>
      </div>
      <Field label={t("settings.profile")} htmlFor="rt-profile">
        <select
          id="rt-profile"
          className="input"
          value={form.profile}
          onChange={(e) => set({ profile: e.target.value })}
        >
          {PROFILES.map((prof) => (
            <option key={prof} value={prof}>
              {t(`profile.${prof}`)}
            </option>
          ))}
        </select>
      </Field>
      <label className="check">
        <input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <span>
          {t("common.enabled")} <span className="hint">— {t("routines.enabledHint")}</span>
        </span>
      </label>
      <div className="modal-actions">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button variant="primary" onClick={() => save.mutate()} disabled={!canSave} loading={save.isPending}>
          {t("common.save")}
        </Button>
      </div>
    </Modal>
  );
}

function TimezoneField({
  form,
  set,
  tzOk,
  tzQuery,
  setTzQuery,
  zones,
}: {
  form: { timezone: string };
  set: (patch: { timezone: string }) => void;
  tzOk: boolean;
  tzQuery: string;
  setTzQuery: (v: string) => void;
  zones: string[];
}) {
  const t = useT();
  return (
    <Field
      label={t("settings.timezone")}
      htmlFor="rt-tz"
      hint={t("routines.tzHint")}
      error={tzOk ? undefined : t("routines.tzInvalid")}
    >
      <input
        className="input sm"
        placeholder={t("common.search")}
        value={tzQuery}
        onChange={(e) => setTzQuery(e.target.value)}
        aria-label={`${t("common.search")} ${t("settings.timezone")}`}
      />
      <select
        id="rt-tz"
        className="input"
        value={form.timezone}
        onChange={(e) => set({ timezone: e.target.value })}
        size={1}
      >
        <option value="">{t("routines.tzInherited")}</option>
        {!zones.includes(form.timezone) && form.timezone && (
          <option value={form.timezone}>{form.timezone}</option>
        )}
        {zones.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </select>
    </Field>
  );
}

function HistoryModal({ routine, onClose }: { routine: RoutineStatus; onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const history = useApiQuery<RoutineHistoryEntry[]>(
    qk.routineHistory(routine.id),
    `/api/routines/${encodeURIComponent(routine.id)}/history`,
  );
  const heartbeat = routineKind(routine) === "heartbeat";
  return (
    <Modal title={`${t("routines.history")} — ${routine.name}`} onClose={onClose}>
      {history.isPending ? (
        <Skeleton lines={4} />
      ) : history.error ? (
        <ErrorBox message={errorMessage(history.error)} onRetry={() => void history.refetch()} />
      ) : (history.data ?? []).length === 0 ? (
        <EmptyState title={t("routines.noHistory")} body={t("routines.noHistoryBody")} />
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t("runs.when")}</th>
                <th>{t("runs.status")}</th>
                {heartbeat && <th>{t("backend.history.outcome")}</th>}
                <th>{t("routines.note")}</th>
              </tr>
            </thead>
            <tbody>
              {(history.data ?? []).map((h) => (
                <tr key={h.id}>
                  <td className="dim">{timeAgo(h.firedAt, locale)}</td>
                  <td>
                    <StatusBadge status={h.runStatus ?? h.status} />
                  </td>
                  {heartbeat && (
                    <td className={h.outcome === "alert" ? "rt-outcome-alert" : "rt-outcome-quiet"}>
                      {h.outcome ? t(`backend.outcome.${h.outcome}` as TKey) : "—"}
                    </td>
                  )}
                  <td>
                    {h.runId ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          onClose();
                          navigate(`/runs/${h.runId}`);
                        }}
                      >
                        {t("runs.title")} →
                      </Button>
                    ) : (
                      <span className="dim">{h.note ?? "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
