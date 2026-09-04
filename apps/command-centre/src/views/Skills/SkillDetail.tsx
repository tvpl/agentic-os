import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Copy,
  Eraser,
  ExternalLink,
  File as FileIcon,
  FileCode2,
  FileImage,
  FileText,
  FileType2,
  Pause,
  Play,
  Scissors,
  Settings2,
} from "lucide-react";
import { api, getToken, type ApprovalRecord, type ProviderId, type ProviderSnapshot, type Skill, type SkillResource } from "../../api";
import { qk, useInvalidate } from "../../queries";
import { useT } from "../../i18n";
import { formatBytes, useToast } from "../../components/ui";
import { Badge, Button, EmptyState, Field, Segmented, Tabs } from "../../components/primitives";
import { ModelEffortMatrix, skillEffort, type Effort } from "../../desktop/SkillMatrixModal";
import { ApprovalCard } from "../../runs/Approvals";
import { copyText, errorMessage } from "../shared";
import Markdown from "./Markdown";
import { canPreviewInline, groupByFolder, resourceUrl, resourcesOf, MAX_INLINE_TEXT_BYTES } from "./resources";
import { clearDraft, readDraft, writeDraft } from "./runDraft";
import { buildSplitPrompt } from "./splitPrompt";
import "../apps.css";

const EFFORT_VALUES: readonly Effort[] = ["default", "low", "medium", "high"];

function isEffort(value: string | undefined): value is Effort {
  return value !== undefined && (EFFORT_VALUES as readonly string[]).includes(value);
}

interface RunResponse {
  runId: string | null;
  status?: string;
  pendingApproval?: ApprovalRecord | null;
}

export default function SkillDetail({ skill, providers }: { skill: Skill; providers: ProviderSnapshot[] }) {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const invalidate = useInvalidate();

  const compatible = providers.filter((p) => skill.providers.includes(p.id));
  const enabledProviders = compatible.filter((p) => p.enabled);
  const defaultProvider = enabledProviders.find((p) => p.isDefault) ?? enabledProviders[0];

  // Draft: what was typed for this skill survives a trip to the run page and back.
  const draft = useMemo(() => readDraft(skill.slug), [skill.slug]);
  const [provider, setProvider] = useState<ProviderId | undefined>(() => {
    const fromDraft = enabledProviders.find((p) => p.id === draft?.provider);
    return fromDraft?.id ?? defaultProvider?.id;
  });
  const [model, setModel] = useState<string | null>(() => (draft?.model !== undefined ? draft.model : skill.recommendedModel));
  const [effort, setEffort] = useState<Effort>(() => (isEffort(draft?.effort) ? draft.effort : skillEffort(skill)));
  const [inputs, setInputs] = useState<Record<string, string>>(() => draft?.inputs ?? {});
  const [pending, setPending] = useState<ApprovalRecord | null>(null);

  const [pane, setPane] = useState<"body" | "resources">("body");
  const [view, setView] = useState<"source" | "rendered">("source");
  const [lineNumbers, setLineNumbers] = useState(true);

  useEffect(() => {
    writeDraft(skill.slug, { provider, model, effort, inputs });
  }, [skill.slug, provider, model, effort, inputs]);

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
      api.post<RunResponse>(`/api/skills/${encodeURIComponent(skill.slug)}/run`, {
        provider,
        model,
        effort,
        inputs,
      }),
    onSuccess: (res) => {
      if (res.status === "waiting_approval" || !res.runId) {
        // The security profile put the run on hold: decide it here (analysis 4.3 item 21).
        setPending(res.pendingApproval ?? null);
        toast(t("runs.approvalPending"), "info");
        return;
      }
      navigate(`/runs/${res.runId}`);
    },
    onError: (err) => toast(errorMessage(err), "danger"),
  });

  const blocked: "skill" | "provider" | null = !skill.enabled ? "skill" : enabledProviders.length === 0 ? "provider" : null;
  const missingRequired = skill.inputs.some((i) => i.required && !(inputs[i.name] ?? "").trim());
  const canRun = blocked === null && Boolean(provider) && !missingRequired && !run.isPending;

  // ⌘/Ctrl+Enter runs from anywhere on the page, including from inside a field.
  const canRunRef = useRef(canRun);
  canRunRef.current = canRun;
  const runRef = useRef(() => run.mutate());
  runRef.current = () => run.mutate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
      if (!canRunRef.current) return;
      e.preventDefault();
      runRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const copyPath = async () => {
    toast((await copyText(skill.skillFile)) ? t("common.copied") : t("skills.copyFailed"), "ok");
  };
  const copyBody = async () => {
    toast((await copyText(skill.body)) ? t("apps.skills.copiedBody") : t("skills.copyFailed"), "ok");
  };
  const copySplitPrompt = async () => {
    const ok = await copyText(buildSplitPrompt(skill));
    toast(ok ? t("apps.skills.splitCopied") : t("skills.copyFailed"), ok ? "ok" : "danger");
  };
  const clearInputs = () => {
    setInputs({});
    clearDraft(skill.slug);
  };

  const resources = useMemo(() => resourcesOf(skill), [skill]);
  const lines = skill.body.split("\n");

  return (
    <div className="page">
      <div className="page-head">
        <div className="min0">
          <p className="crumb">
            <Link to="/skills">
              <ArrowLeft aria-hidden /> {t("skills.title")}
            </Link>
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
                {provider && (
                  <div className="field">
                    <span className="label" id="sk-matrix-label">
                      {t("apps.skills.modelEffort")}
                    </span>
                    <div className="apps-matrix-wrap" role="group" aria-labelledby="sk-matrix-label">
                      <ModelEffortMatrix
                        provider={provider}
                        model={model}
                        effort={effort}
                        onPick={(m, e2) => {
                          setModel(m);
                          setEffort(e2);
                        }}
                      />
                    </div>
                    {skill.recommendedModel && <span className="hint">{t("skills.recommended", { value: skill.recommendedModel })}</span>}
                  </div>
                )}
                <Field label={t("apps.skills.customModel")} htmlFor="sk-model">
                  <input
                    id="sk-model"
                    className="input mono"
                    value={model ?? ""}
                    onChange={(e) => setModel(e.target.value.trim() === "" ? null : e.target.value)}
                    placeholder={skill.recommendedModel ?? "AUTO"}
                  />
                </Field>
                {skill.inputs.map((input) => {
                  const id = `in-${input.name}`;
                  const value = inputs[input.name] ?? "";
                  const set = (v: string) => setInputs({ ...inputs, [input.name]: v });
                  const label = (
                    <>
                      {input.label}{" "}
                      {input.required && (
                        <span className="req" aria-hidden>
                          *
                        </span>
                      )}
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
                <div className="apps-run-actions">
                  <Button variant="primary" icon={<Play aria-hidden />} loading={run.isPending} disabled={!provider || missingRequired} onClick={() => run.mutate()}>
                    {t("skills.runNow")}
                  </Button>
                  {skill.inputs.length > 0 && (
                    <Button size="sm" variant="ghost" icon={<Eraser aria-hidden />} onClick={clearInputs}>
                      {t("apps.skills.clearInputs")}
                    </Button>
                  )}
                </div>
                <p className="apps-run-hint">
                  <span className="kbd">⌘Enter</span> {t("apps.skills.runHint")}
                </p>
              </>
            )}
          </div>

          {pending && (
            <div className="card apps-approval">
              <div className="apps-approval-head">
                <AlertTriangle aria-hidden /> {t("apps.skills.approvalTitle")}
              </div>
              <p>{t("apps.skills.approvalBody")}</p>
              <ApprovalCard
                approval={pending}
                onLaunched={(runId) => {
                  setPending(null);
                  if (runId) navigate(`/runs/${runId}`);
                }}
              />
            </div>
          )}

          {skill.thick && (
            <div className="card">
              <div className="apps-thick">
                <AlertTriangle aria-hidden />
                <div className="min0">
                  <strong>{t("apps.skills.thickTitle", { lines: skill.bodyLineCount })}</strong>
                  <p>{t("apps.skills.thickBody")}</p>
                  <Button size="sm" icon={<Scissors aria-hidden />} onClick={() => void copySplitPrompt()}>
                    {t("apps.skills.splitPrompt")}
                  </Button>
                </div>
              </div>
            </div>
          )}

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
            <Tabs
              id="skill-panes"
              ariaLabel={skill.name}
              active={pane}
              onChange={(id) => setPane(id as "body" | "resources")}
              tabs={[
                { id: "body", label: `SKILL.md · ${skill.bodyLineCount} ${t("skills.lines")}` },
                { id: "resources", label: `${t("apps.skills.tabResources")} (${resources.length})` },
              ]}
            />
            <div className="tab-panel" role="tabpanel" id={`skill-panes-panel-${pane}`} aria-labelledby={`skill-panes-tab-${pane}`}>
              {pane === "body" ? (
                <>
                  <div className="card-head-row">
                    <Segmented<"source" | "rendered">
                      size="sm"
                      ariaLabel={t("apps.skills.viewSource")}
                      value={view}
                      onChange={setView}
                      options={[
                        { value: "source", label: t("apps.skills.viewSource") },
                        { value: "rendered", label: t("apps.skills.viewRendered") },
                      ]}
                    />
                    <div className="head-actions">
                      {view === "source" && (
                        <label className="check">
                          <input type="checkbox" checked={lineNumbers} onChange={(e) => setLineNumbers(e.target.checked)} />
                          {t("skills.lineNumbers")}
                        </label>
                      )}
                      <Button size="sm" icon={<Copy aria-hidden />} onClick={() => void copyBody()}>
                        {t("apps.skills.copyBody")}
                      </Button>
                    </div>
                  </div>
                  {view === "source" ? (
                    <pre className={`skill-body${lineNumbers ? " numbered" : ""}`} tabIndex={0} role="region" aria-label="SKILL.md">
                      <code>
                        {lines.map((line, i) => (
                          <span className="line" key={i}>
                            <span className="txt">{line}</span>
                            {"\n"}
                          </span>
                        ))}
                      </code>
                    </pre>
                  ) : (
                    <Markdown source={skill.body} />
                  )}
                  <p className="mono file-path" title={skill.skillFile}>
                    {skill.skillFile}
                    <Button size="sm" variant="ghost" icon={<Copy aria-hidden />} aria-label={t("brain.copyPath")} title={t("brain.copyPath")} onClick={() => void copyPath()} />
                  </p>
                </>
              ) : (
                <ResourcesPane slug={skill.slug} resources={resources} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- resources */

function kindIcon(kind: SkillResource["kind"]) {
  switch (kind) {
    case "markdown":
      return <FileText aria-hidden />;
    case "html":
      return <FileCode2 aria-hidden />;
    case "image":
      return <FileImage aria-hidden />;
    case "pdf":
      return <FileType2 aria-hidden />;
    default:
      return <FileIcon aria-hidden />;
  }
}

function ResourcesPane({ slug, resources }: { slug: string; resources: SkillResource[] }) {
  const t = useT();
  const [selected, setSelected] = useState<string | null>(resources[0]?.rel ?? null);
  const active = resources.find((r) => r.rel === selected) ?? null;
  const groups = useMemo(() => groupByFolder(resources), [resources]);

  if (resources.length === 0) {
    return <EmptyState icon={<FileText aria-hidden />} title={t("apps.skills.noResources")} body={t("apps.skills.noResourcesBody")} />;
  }
  return (
    <div className="stack">
      <p className="hint">{t("apps.skills.resourceCount", { n: resources.length })}</p>
      {groups.map((group) => (
        <div key={group.folder || "."}>
          {group.folder && <p className="label mono">{group.folder}/</p>}
          <ul className="apps-res-list">
            {group.items.map((r) => (
              <li key={r.rel}>
                <button type="button" className="apps-res-row" aria-pressed={r.rel === selected} onClick={() => setSelected(r.rel)}>
                  {kindIcon(r.kind)}
                  <span className="rel" title={r.rel}>
                    {r.rel}
                  </span>
                  <Badge kind="meta">{t(`apps.skills.kind.${r.kind}`)}</Badge>
                  <span className="size">{formatBytes(r.size)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {active && <ResourcePreview slug={slug} resource={active} />}
    </div>
  );
}

function ResourcePreview({ slug, resource }: { slug: string; resource: SkillResource }) {
  const t = useT();
  const href = resourceUrl(slug, resource.rel, true);
  const tooBig = resource.kind === "markdown" && resource.size > MAX_INLINE_TEXT_BYTES;
  return (
    <div className="apps-res-preview">
      <div className="apps-res-preview-head">
        <span className="rel" title={resource.rel}>
          {resource.rel}
        </span>
        <a className="btn sm ghost" href={href} target="_blank" rel="noreferrer noopener">
          <ExternalLink aria-hidden /> {t("apps.skills.openNewTab")}
        </a>
      </div>
      {tooBig ? (
        <div className="apps-res-fallback">{t("apps.skills.previewTooLarge", { size: formatBytes(resource.size) })}</div>
      ) : !canPreviewInline(resource) ? (
        <div className="apps-res-fallback">{t("apps.skills.noPreview")}</div>
      ) : resource.kind === "markdown" ? (
        <MarkdownResource slug={slug} rel={resource.rel} />
      ) : resource.kind === "image" ? (
        <img className="apps-res-img" src={href} alt={resource.name} />
      ) : (
        <iframe className="apps-res-frame" src={href} sandbox="" title={`${resource.rel} — ${t("apps.skills.htmlPreview")}`} loading="lazy" />
      )}
    </div>
  );
}

/** Markdown resources are fetched as text and rendered with the safe renderer. */
function MarkdownResource({ slug, rel }: { slug: string; rel: string }) {
  const t = useT();
  const fetchText = useCallback(async () => {
    const res = await fetch(resourceUrl(slug, rel), { headers: { "x-mordomo-token": getToken() } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }, [slug, rel]);
  const query = useQuery({ queryKey: ["skill-resource", slug, rel], queryFn: fetchText, staleTime: 30_000 });
  if (query.isPending) return <div className="apps-res-fallback">{t("common.loading")}</div>;
  if (query.error || typeof query.data !== "string") return <div className="apps-res-fallback">{t("apps.skills.previewFailed")}</div>;
  return <Markdown source={query.data} />;
}
