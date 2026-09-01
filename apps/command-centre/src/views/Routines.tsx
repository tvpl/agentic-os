import { useContext, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Pause, Play, Plus, Trash2, Zap } from "lucide-react";
import { api, type ProviderId, type RoutineStatus, type Skill } from "../api";
import { I18nContext, useT } from "../i18n";
import { Empty, ErrorBox, Loading, Modal, StatusBadge, timeAgo, useApi, useToast } from "../components/ui";

export default function Routines() {
  const t = useT();
  const { lang } = useContext(I18nContext);
  const toast = useToast();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<RoutineStatus | "new" | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  const { data, error, offline, loading, reload } = useApi(async () => {
    const [routines, skills] = await Promise.all([
      api.get<RoutineStatus[]>("/api/routines"),
      api.get<Skill[]>("/api/skills"),
    ]);
    return { routines, skills };
  });

  if (loading && !data) return <div className="page"><Loading /></div>;
  if (error && !data) return <div className="page"><ErrorBox message={error} offline={offline} onRetry={reload} /></div>;
  if (!data) return null;

  const act = async (fn: () => Promise<unknown>, okMsg?: string) => {
    try {
      await fn();
      if (okMsg) toast(okMsg, "ok");
      reload();
    } catch (err) {
      toast((err as Error).message, "danger");
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("routines.title")}</h1>
          <p className="sub">{t("routines.sub")}</p>
        </div>
        <button className="btn primary" onClick={() => setEditing("new")}>
          <Plus aria-hidden /> {t("routines.new")}
        </button>
      </div>

      {data.routines.length === 0 ? (
        <Empty>{t("common.empty")}</Empty>
      ) : (
        data.routines.map((r) => (
          <div className="card" key={r.id}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ minWidth: 240 }}>
                <h3 style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {r.name}
                  {!r.healthy && <span className="badge danger">{t("routines.failing")}</span>}
                  {!r.enabled && <span className="badge dim">{t("common.disabled")}</span>}
                </h3>
                <div style={{ color: "var(--text-dim)", fontSize: 13 }}>
                  {r.skillSlug ? <span className="mono">/{r.skillSlug}</span> : (r.prompt ?? "").slice(0, 70)}
                  {" · "}<span className="mono">{r.schedule}</span> · {r.timezone} · {r.provider}
                </div>
                <div style={{ color: "var(--text-faint)", fontSize: 12.5, marginTop: 4 }}>
                  {t("routines.next")}: {r.enabled && r.nextRunAt ? timeAgo(r.nextRunAt, lang) : "—"}
                  {" · "}
                  {t("routines.last")}: {r.lastFiredAt ? timeAgo(r.lastFiredAt, lang) : t("common.never")}
                  {r.lastStatus ? <> (<StatusBadge status={r.lastStatus} />)</> : null}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-start", flexWrap: "wrap" }}>
                <button
                  className="btn sm primary"
                  onClick={() =>
                    act(async () => {
                      const res = await api.post<{ runId: string | null }>(`/api/routines/${r.id}/run`);
                      if (res.runId) navigate(`/runs/${res.runId}`);
                    })
                  }
                >
                  <Zap aria-hidden /> {t("routines.testRun")}
                </button>
                <button className="btn sm" onClick={() => act(() => api.post(`/api/routines/${r.id}/toggle`))}>
                  {r.enabled ? <><Pause aria-hidden /> {t("routines.pause")}</> : <><Play aria-hidden /> {t("routines.resume")}</>}
                </button>
                <button className="btn sm" onClick={() => setEditing(r)}>✎</button>
                <button className="btn sm" onClick={() => act(() => api.post(`/api/routines/${r.id}/duplicate`))} aria-label={t("routines.duplicate")}>
                  <Copy aria-hidden />
                </button>
                <button className="btn sm" onClick={() => setHistoryFor(r.id)}>{t("routines.history")}</button>
                <button
                  className="btn sm danger"
                  aria-label={`${t("common.delete")} ${r.name}`}
                  onClick={() => window.confirm(`${t("common.delete")} "${r.name}"?`) && act(() => api.del(`/api/routines/${r.id}`))}
                >
                  <Trash2 aria-hidden />
                </button>
              </div>
            </div>
          </div>
        ))
      )}

      {editing && (
        <RoutineModal
          routine={editing === "new" ? null : editing}
          skills={data.skills}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
      {historyFor && <HistoryModal id={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

function RoutineModal({
  routine,
  skills,
  onClose,
  onSaved,
}: {
  routine: RoutineStatus | null;
  skills: Skill[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const toast = useToast();
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
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    setBusy(true);
    try {
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
      if (routine) await api.put(`/api/routines/${routine.id}`, payload);
      else await api.post("/api/routines", payload);
      onSaved();
    } catch (err) {
      toast((err as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={routine ? form.name : t("routines.new")} onClose={onClose}>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="rt-name">{t("settings.name")}</label>
          <input id="rt-name" className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="rt-skill">Skill</label>
          <select id="rt-skill" className="input" value={form.skillSlug} onChange={(e) => set({ skillSlug: e.target.value })}>
            <option value="">(prompt)</option>
            {skills.filter((s) => s.enabled).map((s) => (
              <option key={s.slug} value={s.slug}>/{s.slug}</option>
            ))}
          </select>
        </div>
      </div>
      {!form.skillSlug && (
        <div className="field">
          <label htmlFor="rt-prompt">Prompt</label>
          <textarea id="rt-prompt" className="input" value={form.prompt} onChange={(e) => set({ prompt: e.target.value })} />
        </div>
      )}
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="rt-cron">{t("routines.schedule")}</label>
          <input id="rt-cron" className="input mono" value={form.schedule} onChange={(e) => set({ schedule: e.target.value })} />
          <span className="hint">min hour day month weekday — e.g. 30 7 * * 1-5</span>
        </div>
        <div className="field">
          <label htmlFor="rt-tz">{t("settings.timezone")}</label>
          <input id="rt-tz" className="input" value={form.timezone} onChange={(e) => set({ timezone: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="rt-provider">{t("skills.provider")}</label>
          <select id="rt-provider" className="input" value={form.provider} onChange={(e) => set({ provider: e.target.value as ProviderId })}>
            {["claude", "cursor", "codex"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rt-missed">{t("routines.missed")}</label>
          <select id="rt-missed" className="input" value={form.missedPolicy} onChange={(e) => set({ missedPolicy: e.target.value })}>
            <option value="skip">{t("routines.missed.skip")}</option>
            <option value="run_on_boot">{t("routines.missed.run_on_boot")}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="rt-timeout">Timeout (min)</label>
          <input
            id="rt-timeout"
            type="number"
            className="input"
            min={1}
            value={Math.round(form.timeoutMs / 60000)}
            onChange={(e) => set({ timeoutMs: Math.max(1, Number(e.target.value)) * 60000 })}
          />
        </div>
        <div className="field">
          <label htmlFor="rt-attempts">Attempts</label>
          <input
            id="rt-attempts"
            type="number"
            className="input"
            min={1}
            max={5}
            value={form.maxAttempts}
            onChange={(e) => set({ maxAttempts: Math.min(5, Math.max(1, Number(e.target.value))) })}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="rt-profile">{t("settings.profile")}</label>
        <select id="rt-profile" className="input" value={form.profile} onChange={(e) => set({ profile: e.target.value })}>
          {["read_only", "review_before_write", "controlled_write", "approved_automation"].map((prof) => (
            <option key={prof} value={prof}>{t(`profile.${prof}` as Parameters<typeof t>[0])}</option>
          ))}
        </select>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
        <input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        {t("common.enabled")}
      </label>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn" onClick={onClose}>{t("common.cancel")}</button>
        <button className="btn primary" onClick={save} disabled={busy || !form.name || (!form.skillSlug && !form.prompt)}>
          {t("common.save")}
        </button>
      </div>
    </Modal>
  );
}

function HistoryModal({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const { lang } = useContext(I18nContext);
  const navigate = useNavigate();
  const { data } = useApi<Array<{ id: number; runId: string | null; firedAt: number; status: string; note: string | null }>>(
    () => api.get(`/api/routines/${id}/history`),
  );
  return (
    <Modal title={`${t("routines.history")} — ${id}`} onClose={onClose}>
      {!data ? (
        <Loading />
      ) : data.length === 0 ? (
        <Empty>{t("common.empty")}</Empty>
      ) : (
        <table className="table">
          <tbody>
            {data.map((h) => (
              <tr key={h.id}>
                <td>{timeAgo(h.firedAt, lang)}</td>
                <td><StatusBadge status={h.status} /></td>
                <td>
                  {h.runId ? (
                    <button className="btn ghost sm" onClick={() => { onClose(); navigate(`/runs/${h.runId}`); }}>
                      {t("runs.title")} →
                    </button>
                  ) : (
                    <span style={{ color: "var(--text-faint)" }}>{h.note ?? "—"}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
