import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, Copy, Pause, Pencil, Play, Plus, Trash2, Zap } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ProviderId, type RoutineStatus, type Skill } from "../api";
import { useLocale, useT } from "../i18n";
import { qk, useApiQuery, useOsProviders, useOsRoutines, useOsSkills } from "../queries";
import { ErrorBox, Modal, Skeleton, StatusBadge, timeAgo, useToast } from "../components/ui";
import { Badge, Button, EmptyState, Field } from "../components/primitives";
import { useConfirm } from "../hooks/useConfirm";
import { errorMessage, isOffline } from "./shared";
import { isValidCron, isValidTimeZone, nextCronRuns, timeZoneOptions } from "./cron";

export default function Routines() {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const routines = useOsRoutines({ refetchInterval: 30_000 });
  const skills = useOsSkills();
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

  if (routines.isPending && !routines.data) return <div className="page"><Skeleton lines={6} /></div>;
  if (routines.error && !routines.data) return <div className="page"><ErrorBox message={errorMessage(routines.error)} offline={isOffline(routines.error)} onRetry={() => void routines.refetch()} /></div>;
  const list = routines.data ?? [];

  const remove = async (r: RoutineStatus) => {
    if (await confirm({ title: `${t("common.delete")} "${r.name}"?`, body: t("routines.deleteBody"), danger: true, confirmLabel: t("common.delete") })) {
      act.mutate({ fn: () => api.del(`/api/routines/${encodeURIComponent(r.id)}`), okMsg: t("routines.deleted") });
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
        list.map((r) => (
          <div className="card routine-card" key={r.id}>
            <div className="routine-main">
              <h3 className="routine-title">
                {r.name}
                {!r.healthy && <Badge kind="state" tone="danger">{t("routines.failing")}</Badge>}
                {!r.enabled && <Badge kind="meta">{t("common.disabled")}</Badge>}
              </h3>
              <div className="routine-line">
                {r.skillSlug ? <span className="mono">/{r.skillSlug}</span> : (r.prompt ?? "").slice(0, 70)}
                {" · "}
                <span className="mono">{r.schedule}</span> · {r.timezone || t("routines.tzInherited")} · {r.provider}
              </div>
              <div className="routine-meta">
                {t("routines.next")}: {r.enabled && r.nextRunAt ? timeAgo(r.nextRunAt, locale) : "—"}
                {" · "}
                {t("routines.last")}: {r.lastFiredAt ? timeAgo(r.lastFiredAt, locale) : t("common.never")}
                {r.lastStatus ? <> <StatusBadge status={r.lastStatus} /></> : null}
              </div>
            </div>
            <div className="row-actions">
              <Button size="sm" variant="primary" icon={<Zap aria-hidden />} onClick={() => testRun(r)} loading={act.isPending}>
                {t("routines.testRun")}
              </Button>
              <Button size="sm" variant="secondary" icon={r.enabled ? <Pause aria-hidden /> : <Play aria-hidden />} onClick={() => act.mutate({ fn: () => api.post(`/api/routines/${encodeURIComponent(r.id)}/toggle`) })}>
                {r.enabled ? t("routines.pause") : t("routines.resume")}
              </Button>
              <Button size="sm" variant="secondary" icon={<Pencil aria-hidden />} aria-label={`${t("common.edit")} ${r.name}`} title={t("common.edit")} onClick={() => setEditing(r)} />
              <Button size="sm" variant="secondary" icon={<Copy aria-hidden />} aria-label={t("routines.duplicate")} title={t("routines.duplicate")} onClick={() => act.mutate({ fn: () => api.post(`/api/routines/${encodeURIComponent(r.id)}/duplicate`), okMsg: t("routines.duplicated") })} />
              <Button size="sm" variant="secondary" onClick={() => setHistoryFor(r)}>
                {t("routines.history")}
              </Button>
              <Button size="sm" variant="danger" icon={<Trash2 aria-hidden />} aria-label={`${t("common.delete")} ${r.name}`} title={t("common.delete")} onClick={() => void remove(r)} />
            </div>
          </div>
        ))
      )}

      {editing && (
        <RoutineModal
          routine={editing === "new" ? null : editing}
          skills={skills.data ?? []}
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

function RoutineModal({ routine, skills, onClose, onSaved }: { routine: RoutineStatus | null; skills: Skill[]; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const providers = useOsProviders();
  const [form, setForm] = useState(() => ({
    id: routine?.id ?? "",
    name: routine?.name ?? "",
    skillSlug: routine?.skillSlug ?? "",
    prompt: routine?.prompt ?? "",
    schedule: routine?.schedule ?? "0 9 * * 1-5",
    timezone: routine?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
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

  const cronOk = isValidCron(form.schedule);
  const tzOk = isValidTimeZone(form.timezone);
  const preview = useMemo(() => {
    if (!cronOk || !tzOk) return [];
    try {
      return nextCronRuns(form.schedule, form.timezone || undefined, 3);
    } catch {
      return [];
    }
  }, [form.schedule, form.timezone, cronOk, tzOk]);
  const zones = useMemo(() => {
    const all = timeZoneOptions();
    const q = tzQuery.trim().toLowerCase();
    return (q ? all.filter((z) => z.toLowerCase().includes(q)) : all).slice(0, 400);
  }, [tzQuery]);

  const save = useMutation({
    mutationFn: async () => {
      const id = form.id || form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const payload = {
        ...form,
        id,
        skillSlug: form.skillSlug || null,
        prompt: form.skillSlug ? null : form.prompt || null,
        model: routine?.model ?? null,
        inputs: routine?.inputs ?? {},
        backoffMs: routine?.backoffMs ?? 60000,
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
  const canSave = nameOk && bodyOk && cronOk && tzOk && !save.isPending;
  const enabledProviders = (providers.data ?? []).filter((p) => p.enabled).map((p) => p.id);

  return (
    <Modal title={routine ? form.name : t("routines.new")} onClose={onClose}>
      <div className="grid grid-2">
        <Field label={t("routines.name")} htmlFor="rt-name" error={!nameOk && form.name !== "" ? t("common.required") : undefined}>
          <input id="rt-name" className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label={t("routines.skill")} htmlFor="rt-skill" hint={t("routines.skillHint")}>
          <select id="rt-skill" className="input" value={form.skillSlug} onChange={(e) => set({ skillSlug: e.target.value })}>
            <option value="">{t("routines.promptOnly")}</option>
            {skills
              .filter((s) => s.enabled)
              .map((s) => (
                <option key={s.slug} value={s.slug}>
                  /{s.slug}
                </option>
              ))}
          </select>
        </Field>
      </div>
      {!form.skillSlug && (
        <Field label={t("runs.prompt")} htmlFor="rt-prompt">
          <textarea id="rt-prompt" className="input" rows={3} value={form.prompt} onChange={(e) => set({ prompt: e.target.value })} />
        </Field>
      )}
      <div className="grid grid-2">
        <Field label={t("routines.schedule")} htmlFor="rt-cron" hint={t("routines.cronHint")} error={cronOk ? undefined : t("routines.cronInvalid")}>
          <input id="rt-cron" className="input mono" value={form.schedule} onChange={(e) => set({ schedule: e.target.value })} aria-invalid={!cronOk} />
        </Field>
        <Field label={t("settings.timezone")} htmlFor="rt-tz" hint={t("routines.tzHint")} error={tzOk ? undefined : t("routines.tzInvalid")}>
          <input className="input sm" placeholder={t("common.search")} value={tzQuery} onChange={(e) => setTzQuery(e.target.value)} aria-label={`${t("common.search")} ${t("settings.timezone")}`} />
          <select id="rt-tz" className="input" value={form.timezone} onChange={(e) => set({ timezone: e.target.value })} size={1}>
            <option value="">{t("routines.tzInherited")}</option>
            {!zones.includes(form.timezone) && form.timezone && <option value={form.timezone}>{form.timezone}</option>}
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="notice cron-preview" aria-live="polite">
        <span className="hud-label">{t("routines.nextRuns")}</span>
        {preview.length === 0 ? (
          <span className="widget-muted">{cronOk ? t("routines.noUpcoming") : t("routines.cronInvalid")}</span>
        ) : (
          <ul className="plain-list">
            {preview.map((ts) => (
              <li key={ts} className="mono">
                {new Date(ts).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: form.timezone || undefined })}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="grid grid-2">
        <Field label={t("skills.provider")} htmlFor="rt-provider" hint={enabledProviders.length && !enabledProviders.includes(form.provider) ? t("routines.providerDisabled") : undefined}>
          <select id="rt-provider" className="input" value={form.provider} onChange={(e) => set({ provider: e.target.value as ProviderId })}>
            {(["claude", "cursor", "codex"] as ProviderId[]).map((p) => (
              <option key={p} value={p}>
                {p}
                {enabledProviders.length && !enabledProviders.includes(p) ? ` (${t("common.disabled")})` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("routines.missed")} htmlFor="rt-missed">
          <select id="rt-missed" className="input" value={form.missedPolicy} onChange={(e) => set({ missedPolicy: e.target.value })}>
            <option value="skip">{t("routines.missed.skip")}</option>
            <option value="run_on_boot">{t("routines.missed.run_on_boot")}</option>
          </select>
        </Field>
        <Field label={t("routines.timeoutMin")} htmlFor="rt-timeout">
          <input id="rt-timeout" type="number" className="input" min={1} value={Math.round(form.timeoutMs / 60000)} onChange={(e) => set({ timeoutMs: Math.max(1, Number(e.target.value)) * 60000 })} />
        </Field>
        <Field label={t("routines.attempts")} htmlFor="rt-attempts" hint={t("routines.attemptsHint")}>
          <input id="rt-attempts" type="number" className="input" min={1} max={5} value={form.maxAttempts} onChange={(e) => set({ maxAttempts: Math.min(5, Math.max(1, Number(e.target.value))) })} />
        </Field>
      </div>
      <Field label={t("settings.profile")} htmlFor="rt-profile">
        <select id="rt-profile" className="input" value={form.profile} onChange={(e) => set({ profile: e.target.value })}>
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

interface HistoryEntry {
  id: number;
  runId: string | null;
  firedAt: number;
  status: string;
  note: string | null;
  durationMs?: number | null;
}

function HistoryModal({ routine, onClose }: { routine: RoutineStatus; onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const history = useApiQuery<HistoryEntry[]>(qk.routineHistory(routine.id), `/api/routines/${encodeURIComponent(routine.id)}/history`);
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
                <th>{t("routines.note")}</th>
              </tr>
            </thead>
            <tbody>
              {(history.data ?? []).map((h) => (
                <tr key={h.id}>
                  <td className="dim">{timeAgo(h.firedAt, locale)}</td>
                  <td>
                    <StatusBadge status={h.status} />
                  </td>
                  <td>
                    {h.runId ? (
                      <Button size="sm" variant="ghost" onClick={() => { onClose(); navigate(`/runs/${h.runId}`); }}>
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
