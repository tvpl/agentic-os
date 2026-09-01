import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Play, Plus, Star, Upload } from "lucide-react";
import { api, type ProviderId, type ProviderSnapshot, type Skill } from "../api";
import { useT } from "../i18n";
import { Empty, ErrorBox, Loading, Modal, useApi, useToast } from "../components/ui";

export default function Skills() {
  const { slug } = useParams();
  const t = useT();
  const { data, error, offline, loading, reload } = useApi(async () => {
    const [skills, providers] = await Promise.all([
      api.get<Skill[]>("/api/skills"),
      api.get<ProviderSnapshot[]>("/api/providers"),
    ]);
    return { skills, providers };
  });

  if (loading && !data) return <div className="page"><Loading /></div>;
  if (error && !data) return <div className="page"><ErrorBox message={error} offline={offline} onRetry={reload} /></div>;
  if (!data) return null;

  const selected = slug ? data.skills.find((s) => s.slug === slug) : null;
  if (selected) return <SkillDetail skill={selected} providers={data.providers} onChanged={reload} />;
  return <SkillList skills={data.skills} onChanged={reload} />;
}

function SkillList({ skills, onChanged }: { skills: Skill[]; onChanged: () => void }) {
  const t = useT();
  const [showNew, setShowNew] = useState(false);
  const [showExport, setShowExport] = useState(false);

  const toggleFavorite = async (slug: string) => {
    await api.post(`/api/skills/${slug}/favorite`);
    onChanged();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("skills.title")}</h1>
          <p className="sub">{t("skills.sub")}</p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => setShowExport(true)}>
            <Upload aria-hidden /> {t("skills.export")}
          </button>
          <button className="btn primary" onClick={() => setShowNew(true)}>
            <Plus aria-hidden /> {t("skills.new")}
          </button>
        </div>
      </div>

      {skills.length === 0 ? (
        <Empty>{t("common.empty")}</Empty>
      ) : (
        <div className="grid grid-2">
          {skills.map((s) => (
            <div className="card" key={s.slug} style={{ margin: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <h3 style={{ marginBottom: 2 }}>
                  <Link to={`/skills/${s.slug}`}>{s.name}</Link>
                </h3>
                <button
                  className="btn ghost sm"
                  aria-label={`${t("dash.favorites")}: ${s.name}`}
                  aria-pressed={!!s.favorite}
                  onClick={() => toggleFavorite(s.slug)}
                >
                  <Star fill={s.favorite ? "currentColor" : "none"} color={s.favorite ? "var(--warn)" : "currentColor"} aria-hidden />
                </button>
              </div>
              <p style={{ color: "var(--text-dim)", margin: "0 0 10px", minHeight: 40 }}>
                {s.description.split("\n")[0]}
              </p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <span className="badge dim mono">/{s.slug}</span>
                <span className={`badge ${s.mode === "write" ? "warn" : "info"}`}>
                  {t(s.mode === "write" ? "skills.mode.write" : "skills.mode.read_only")}
                </span>
                <span className="badge dim">{s.bodyLineCount} {t("skills.lines")}</span>
                {s.thick && <span className="badge warn">{t("skills.thick")}</span>}
                {!s.enabled && <span className="badge danger">{t("common.disabled")}</span>}
                {s.providers.map((p) => (
                  <span key={p} className="badge dim">{p}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {showNew && <NewSkillModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); onChanged(); }} />}
      {showExport && <ExportModal onClose={() => setShowExport(false)} />}
    </div>
  );
}

function SkillDetail({ skill, providers, onChanged }: { skill: Skill; providers: ProviderSnapshot[]; onChanged: () => void }) {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const enabledProviders = providers.filter((p) => p.enabled && skill.providers.includes(p.id));
  const defaultProvider = providers.find((p) => p.isDefault && enabledProviders.includes(p)) ?? enabledProviders[0];
  const [provider, setProvider] = useState<ProviderId | undefined>(defaultProvider?.id);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState(skill.recommendedEffort);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!provider) return;
    setBusy(true);
    try {
      const res = await api.post<{ runId: string }>(`/api/skills/${skill.slug}/run`, {
        provider,
        model: model.trim() || null,
        effort,
        inputs,
      });
      navigate(`/runs/${res.runId}`);
    } catch (err) {
      toast((err as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p style={{ margin: 0 }}><Link to="/skills">← {t("skills.title")}</Link></p>
          <h1>{skill.name}</h1>
          <p className="sub">{skill.description}</p>
        </div>
        <div className="head-actions">
          <button
            className="btn"
            onClick={async () => {
              await api.post(`/api/skills/${skill.slug}/toggle`);
              onChanged();
            }}
          >
            {skill.enabled ? t("routines.pause") : t("routines.resume")}
          </button>
        </div>
      </div>

      <div className="grid grid-2">
        <div>
          <div className="card">
            <h2>{t("skills.runWith")}</h2>
            {enabledProviders.length === 0 ? (
              <p style={{ color: "var(--warn)" }}>{t("common.disabled")}</p>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="sk-provider">{t("skills.provider")}</label>
                  <select id="sk-provider" className="input" value={provider} onChange={(e) => setProvider(e.target.value as ProviderId)}>
                    {enabledProviders.map((p) => (
                      <option key={p.id} value={p.id}>{p.id}{p.isDefault ? ` (${t("dash.default")})` : ""}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="sk-model">{t("skills.model")}</label>
                  <input id="sk-model" className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder={skill.recommendedModel ?? ""} />
                </div>
                <div className="field">
                  <label htmlFor="sk-effort">{t("skills.effort")}</label>
                  <select id="sk-effort" className="input" value={effort} onChange={(e) => setEffort(e.target.value)}>
                    {["default", "low", "medium", "high"].map((e2) => (
                      <option key={e2} value={e2}>{e2}</option>
                    ))}
                  </select>
                </div>
                {skill.inputs.map((input) => (
                  <div className="field" key={input.name}>
                    <label htmlFor={`in-${input.name}`}>
                      {input.label} {input.required && <span style={{ color: "var(--danger)" }}>*</span>}
                    </label>
                    {input.type === "textarea" ? (
                      <textarea
                        id={`in-${input.name}`}
                        className="input"
                        placeholder={input.placeholder}
                        value={inputs[input.name] ?? ""}
                        onChange={(e) => setInputs({ ...inputs, [input.name]: e.target.value })}
                      />
                    ) : input.type === "select" ? (
                      <select
                        id={`in-${input.name}`}
                        className="input"
                        value={inputs[input.name] ?? ""}
                        onChange={(e) => setInputs({ ...inputs, [input.name]: e.target.value })}
                      >
                        <option value="">—</option>
                        {(input.options ?? []).map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`in-${input.name}`}
                        className="input"
                        placeholder={input.placeholder}
                        value={inputs[input.name] ?? ""}
                        onChange={(e) => setInputs({ ...inputs, [input.name]: e.target.value })}
                      />
                    )}
                  </div>
                ))}
                <button className="btn primary" onClick={run} disabled={busy || !skill.enabled}>
                  {busy ? <span className="spinner" aria-hidden /> : <Play aria-hidden />} {t("skills.runNow")}
                </button>
              </>
            )}
          </div>

          <div className="card">
            <h2>{t("skills.guardrails")}</h2>
            <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text-dim)" }}>
              {skill.guardrails.map((g, i) => <li key={i}>{g}</li>)}
            </ul>
          </div>
          <div className="card">
            <h2>{t("skills.success")}</h2>
            <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text-dim)" }}>
              {skill.successCriteria.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </div>
        </div>

        <div>
          <div className="card">
            <h2>SKILL.md · v{skill.version} · {skill.bodyLineCount} {t("skills.lines")}</h2>
            <pre className="preview-pre" style={{ maxHeight: 420 }}>{skill.body}</pre>
            <p className="mono" style={{ color: "var(--text-faint)", fontSize: 11.5, wordBreak: "break-all" }}>{skill.skillFile}</p>
          </div>
          {skill.resources.length > 0 && (
            <div className="card">
              <h2>{t("skills.resources")}</h2>
              <ul style={{ margin: 0, paddingLeft: 18 }} className="mono">
                {skill.resources.map((r) => <li key={r}>{r}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NewSkillModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const t = useT();
  const toast = useToast();
  const [name, setName] = useState("");
  const [slugValue, setSlugValue] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<"read_only" | "write">("read_only");
  const [body, setBody] = useState("# Procedure\n\n1. \n2. \n3. Write outputs into the artifacts directory.\n");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const slug = slugValue || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      await api.post("/api/skills", {
        frontmatter: { name, slug, description, mode, triggers: [`/${slug}`] },
        body,
      });
      onCreated();
    } catch (err) {
      toast((err as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t("skills.new")} onClose={onClose}>
      <div className="field">
        <label htmlFor="ns-name">{t("settings.name")}</label>
        <input id="ns-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="ns-slug">Slug</label>
        <input id="ns-slug" className="input mono" placeholder="auto" value={slugValue} onChange={(e) => setSlugValue(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="ns-desc">Description</label>
        <textarea id="ns-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="ns-mode">Mode</label>
        <select id="ns-mode" className="input" value={mode} onChange={(e) => setMode(e.target.value as "read_only" | "write")}>
          <option value="read_only">{t("skills.mode.read_only")}</option>
          <option value="write">{t("skills.mode.write")}</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="ns-body">SKILL.md</label>
        <textarea id="ns-body" className="input mono" style={{ minHeight: 160 }} value={body} onChange={(e) => setBody(e.target.value)} />
        <span className="hint">Keep it under 60 lines — short skills get followed, long ones get skimmed.</span>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn" onClick={onClose}>{t("common.cancel")}</button>
        <button className="btn primary" onClick={create} disabled={busy || !name || !description}>
          {t("common.save")}
        </button>
      </div>
    </Modal>
  );
}

interface SyncPlanResp {
  targetDir: string;
  actions: Array<{ filePath: string; kind: string; reason: string; diff: string | null }>;
  conflicts: number;
}

function ExportModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const [target, setTarget] = useState("");
  const [plan, setPlan] = useState<SyncPlanResp | null>(null);
  const [approved, setApproved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const preview = async () => {
    setBusy(true);
    try {
      setPlan(await api.get<SyncPlanResp>(`/api/sync/plan${target ? `?target=${encodeURIComponent(target)}` : ""}`));
      setApproved([]);
    } catch (err) {
      toast((err as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ written: string[]; skippedConflicts: string[]; backupDir: string | null }>(
        "/api/sync/apply",
        { target: target || undefined, approvedConflicts: approved },
      );
      toast(`${res.written.length} files written${res.backupDir ? " (backup created)" : ""}`, "ok");
      await preview();
    } catch (err) {
      toast((err as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t("skills.export")} onClose={onClose}>
      <p style={{ color: "var(--text-dim)", marginTop: 0 }}>{t("skills.exportHint")}</p>
      <div className="field">
        <label htmlFor="ex-target">{t("settings.syncTarget")}</label>
        <input id="ex-target" className="input mono" placeholder="(MordomoOS home)" value={target} onChange={(e) => setTarget(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" onClick={preview} disabled={busy}>{t("settings.syncPlan")}</button>
        {plan && (
          <button className="btn primary" onClick={apply} disabled={busy}>
            {t("settings.syncApply")}
          </button>
        )}
      </div>
      {plan && (
        <div style={{ marginTop: 14 }}>
          <p style={{ color: "var(--text-faint)", fontSize: 12 }}>{t("settings.conflicts")}</p>
          <div className="table-scroll" style={{ maxHeight: 300, overflowY: "auto" }}>
            <table className="table">
              <tbody>
                {plan.actions.map((a) => (
                  <tr key={a.filePath}>
                    <td>
                      <span className={`badge ${a.kind === "conflict" ? "danger" : a.kind === "unchanged" ? "dim" : a.kind === "create" ? "ok" : "info"}`}>{a.kind}</span>
                    </td>
                    <td className="mono" style={{ fontSize: 11.5, wordBreak: "break-all" }}>{a.filePath}</td>
                    <td>
                      {a.kind === "conflict" && (
                        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                          <input
                            type="checkbox"
                            checked={approved.includes(a.filePath)}
                            onChange={(e) =>
                              setApproved(e.target.checked ? [...approved, a.filePath] : approved.filter((f) => f !== a.filePath))
                            }
                          />
                          overwrite
                        </label>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
