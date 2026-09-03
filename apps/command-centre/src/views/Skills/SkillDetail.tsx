import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Copy, Pause, Play, Settings2 } from "lucide-react";
import { api, type ProviderId, type ProviderSnapshot, type Skill } from "../../api";
import { qk, useInvalidate } from "../../queries";
import { useT } from "../../i18n";
import { useToast } from "../../components/ui";
import { Badge, Button, Field } from "../../components/primitives";
import { copyText, errorMessage } from "../shared";

const EFFORTS = ["default", "low", "medium", "high"] as const;

export default function SkillDetail({ skill, providers }: { skill: Skill; providers: ProviderSnapshot[] }) {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const invalidate = useInvalidate();

  const compatible = providers.filter((p) => skill.providers.includes(p.id));
  const enabledProviders = compatible.filter((p) => p.enabled);
  const defaultProvider = enabledProviders.find((p) => p.isDefault) ?? enabledProviders[0];
  const [provider, setProvider] = useState<ProviderId | undefined>(defaultProvider?.id);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState(skill.recommendedEffort);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [lineNumbers, setLineNumbers] = useState(true);

  const toggle = useMutation({
    mutationFn: () => api.post(`/api/skills/${encodeURIComponent(skill.slug)}/toggle`),
    onSuccess: async () => {
      await invalidate(qk.skills);
      toast(skill.enabled ? t("skills.pausedToast", { name: skill.name }) : t("skills.enabledToast", { name: skill.name }), "ok");
    },
    onError: (err) => toast(errorMessage(err), "danger"),
  });

  const run = useMutation({
    mutationFn: () =>
      api.post<{ runId: string | null }>(`/api/skills/${encodeURIComponent(skill.slug)}/run`, {
        provider,
        model: model.trim() || null,
        effort,
        inputs,
      }),
    onSuccess: (res) => {
      if (!res.runId) {
        toast(t("runs.approvalPending"), "info");
        navigate("/settings?tab=security");
        return;
      }
      navigate(`/runs/${res.runId}`);
    },
    onError: (err) => toast(errorMessage(err), "danger"),
  });

  const blocked: "skill" | "provider" | null = !skill.enabled ? "skill" : enabledProviders.length === 0 ? "provider" : null;
  const missingRequired = skill.inputs.some((i) => i.required && !(inputs[i.name] ?? "").trim());

  const copyPath = async () => {
    toast((await copyText(skill.skillFile)) ? t("common.copied") : t("skills.copyFailed"), "ok");
  };

  const lines = skill.body.split("\n");

  return (
    <div className="page">
      <div className="page-head">
        <div className="min0">
          <p className="crumb">
            <Link to="/skills">← {t("skills.title")}</Link>
          </p>
          <h1>{skill.name}</h1>
          <p className="sub">{skill.description}</p>
          <div className="badge-row">
            <Badge kind="state" tone={skill.mode === "write" ? "warn" : "info"}>
              {t(skill.mode === "write" ? "skills.mode.write" : "skills.mode.read_only")}
            </Badge>
            {!skill.enabled && (
              <Badge kind="state" tone="danger">
                {t("common.disabled")}
              </Badge>
            )}
            <Badge kind="meta">
              <span className="mono">/{skill.slug}</span>
            </Badge>
            <Badge kind="meta">v{skill.version}</Badge>
          </div>
        </div>
        <div className="head-actions">
          <Button icon={skill.enabled ? <Pause aria-hidden /> : <Play aria-hidden />} loading={toggle.isPending} onClick={() => toggle.mutate()}>
            {skill.enabled ? t("skills.pause") : t("skills.enable")}
          </Button>
        </div>
      </div>

      <div className="grid grid-2 align-start">
        <div className="stack">
          <div className="card">
            <h2>{t("skills.runWith")}</h2>
            {blocked === "skill" && (
              <div className="notice warn" role="status">
                <AlertTriangle aria-hidden />
                <div>
                  <strong>{t("skills.pausedTitle")}</strong>
                  <p>{t("skills.pausedBody")}</p>
                  <Button size="sm" variant="primary" icon={<Play aria-hidden />} loading={toggle.isPending} onClick={() => toggle.mutate()}>
                    {t("skills.enable")}
                  </Button>
                </div>
              </div>
            )}
            {blocked === "provider" && (
              <div className="notice warn" role="status">
                <AlertTriangle aria-hidden />
                <div>
                  <strong>{t("skills.noProviderTitle")}</strong>
                  <p>{t("skills.noProviderBody", { providers: skill.providers.join(", ") })}</p>
                  <Link className="btn sm primary" to="/settings?tab=providers">
                    <Settings2 aria-hidden /> {t("skills.openProviders")}
                  </Link>
                </div>
              </div>
            )}
            {blocked === null && (
              <>
                <Field label={t("skills.provider")} htmlFor="sk-provider">
                  <select id="sk-provider" className="input" value={provider} onChange={(e) => setProvider(e.target.value as ProviderId)}>
                    {enabledProviders.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.id}
                        {p.isDefault ? ` (${t("dash.default")})` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("skills.model")} htmlFor="sk-model" hint={skill.recommendedModel ? t("skills.recommended", { value: skill.recommendedModel }) : undefined}>
                  <input id="sk-model" className="input mono" value={model} onChange={(e) => setModel(e.target.value)} placeholder={skill.recommendedModel ?? ""} />
                </Field>
                <Field label={t("skills.effort")} htmlFor="sk-effort">
                  <select id="sk-effort" className="input" value={effort} onChange={(e) => setEffort(e.target.value)}>
                    {EFFORTS.map((e2) => (
                      <option key={e2} value={e2}>
                        {t(`effort.${e2}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                {skill.inputs.map((input) => {
                  const id = `in-${input.name}`;
                  const value = inputs[input.name] ?? "";
                  const set = (v: string) => setInputs({ ...inputs, [input.name]: v });
                  const label = (
                    <>
                      {input.label} {input.required && <span className="req" aria-hidden>*</span>}
                    </>
                  );
                  return (
                    <Field key={input.name} label={label} htmlFor={id} hint={input.required ? t("skills.required") : undefined}>
                      {input.type === "textarea" ? (
                        <textarea id={id} className="input" placeholder={input.placeholder} value={value} onChange={(e) => set(e.target.value)} required={input.required} />
                      ) : input.type === "select" ? (
                        <select id={id} className="input" value={value} onChange={(e) => set(e.target.value)} required={input.required}>
                          <option value="">—</option>
                          {(input.options ?? []).map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input id={id} className="input" placeholder={input.placeholder} value={value} onChange={(e) => set(e.target.value)} required={input.required} />
                      )}
                    </Field>
                  );
                })}
                <Button variant="primary" icon={<Play aria-hidden />} loading={run.isPending} disabled={!provider || missingRequired} onClick={() => run.mutate()}>
                  {t("skills.runNow")}
                </Button>
              </>
            )}
          </div>

          {skill.guardrails.length > 0 && (
            <div className="card">
              <h2>{t("skills.guardrails")}</h2>
              <ul className="plain-list">
                {skill.guardrails.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </div>
          )}
          {skill.successCriteria.length > 0 && (
            <div className="card">
              <h2>{t("skills.success")}</h2>
              <ul className="plain-list">
                {skill.successCriteria.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head-row">
              <h2>
                SKILL.md · v{skill.version} · {skill.bodyLineCount} {t("skills.lines")}
              </h2>
              <div className="head-actions">
                <label className="check">
                  <input type="checkbox" checked={lineNumbers} onChange={(e) => setLineNumbers(e.target.checked)} />
                  {t("skills.lineNumbers")}
                </label>
                <Button size="sm" icon={<Copy aria-hidden />} onClick={() => void copyPath()}>
                  {t("brain.copyPath")}
                </Button>
              </div>
            </div>
            <pre className={`skill-source${lineNumbers ? " numbered" : ""}`} tabIndex={0} role="region" aria-label="SKILL.md">
              <code>
                {lines.map((line, i) => (
                  <span className="line" key={i}>
                    {lineNumbers && (
                      <span className="ln" aria-hidden>
                        {i + 1}
                      </span>
                    )}
                    <span className="txt">{line}</span>
                    {"\n"}
                  </span>
                ))}
              </code>
            </pre>
            <p className="mono file-path" title={skill.skillFile}>
              {skill.skillFile}
            </p>
          </div>
          {skill.resources.length > 0 && (
            <div className="card">
              <h2>{t("skills.resources")}</h2>
              <ul className="plain-list mono">
                {skill.resources.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
