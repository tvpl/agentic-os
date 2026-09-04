/**
 * Prompt bar on the desktop (analysis item 19): free prompt with a
 * read-only / write toggle, the provider pill, a folder picker, `/skill`
 * autocomplete and ⌘↵ to run. A write run that needs approval does not
 * bounce the user to Settings — the approval card is answered inline.
 */
import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Play, ShieldAlert, X } from "lucide-react";
import { api, type LaunchRunResponse, type ProviderId, type Skill } from "../../api";
import { useT } from "../../i18n";
import { qk, useOsProviders, useOsSettings, useOsSkills } from "../../queries";
import { Button, Segmented } from "../../components/primitives";
import { useToast } from "../../components/ui";
import { useOsNavigate } from "../../hooks/useViewTransition";
import { useDesktopActions } from "../actions";
import { cfgString, type WidgetProps } from "../widgetTypes";

type Mode = "read_only" | "write";

interface FolderOption {
  path: string;
  label: string;
}

/** Skills whose slug starts with the `/word` being typed (empty when not completing). */
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

export default function PromptWidget({ config }: WidgetProps) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useOsNavigate();
  const actions = useDesktopActions();
  const providers = useOsProviders();
  const skills = useOsSkills();
  const settings = useOsSettings();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<Mode>(
    cfgString(config, "mode", "read_only") === "write" ? "write" : "read_only",
  );
  const [cwd, setCwd] = useState("");
  const [pendingApproval, setPendingApproval] = useState<{ id: string; description: string } | null>(null);

  const enabled = (providers.data ?? []).filter((p) => p.enabled);
  const defaultProvider = enabled.find((p) => p.isDefault)?.id ?? enabled[0]?.id;
  const folders = useMemo(() => readFolders(settings.data), [settings.data]);
  const suggestions = useMemo(() => skillSuggestions(prompt, skills.data ?? []), [prompt, skills.data]);

  const launch = useMutation({
    mutationFn: () =>
      api.post<LaunchRunResponse>("/api/runs", {
        prompt: prompt.trim(),
        mode,
        ...(cwd ? { cwd } : {}),
        ...(defaultProvider ? { provider: defaultProvider as ProviderId } : {}),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["runs"] }).catch(() => undefined);
      if (res.runId) {
        setPrompt("");
        setPendingApproval(null);
        navigate(`/runs/${res.runId}`);
        return;
      }
      const approval = res.pendingApproval;
      setPendingApproval(approval ? { id: approval.id, description: approval.description } : null);
      if (!approval) toast(t("runs.approvalPending"), "info");
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const resolve = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approved" | "denied" }) =>
      api.post<{ runId: string | null }>(`/api/approvals/${encodeURIComponent(id)}/resolve`, { decision }),
    onSuccess: (res, vars) => {
      setPendingApproval(null);
      qc.invalidateQueries({ queryKey: qk.approvals }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: ["runs"] }).catch(() => undefined);
      if (vars.decision === "approved" && res.runId) {
        setPrompt("");
        navigate(`/runs/${res.runId}`);
      } else {
        toast(
          vars.decision === "approved" ? t("desktop.prompt.approved") : t("desktop.prompt.denied"),
          vars.decision === "approved" ? "ok" : "info",
        );
      }
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const canRun = prompt.trim().length > 0 && !launch.isPending && enabled.length > 0;

  const submit = () => {
    if (!canRun) return;
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
    launch.mutate();
  };

  const complete = (slug: string) => {
    setPrompt(`/${slug} `);
    inputRef.current?.focus();
  };

  return (
    <div className="promptw">
      <div className="promptw-field">
        <textarea
          ref={inputRef}
          className="input promptw-input"
          rows={2}
          value={prompt}
          placeholder={t("desktop.prompt.placeholder")}
          aria-label={t("desktop.prompt.placeholder")}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              submit();
              return;
            }
            if (e.key === "Tab" && suggestions.length > 0) {
              e.preventDefault();
              complete(suggestions[0]!.slug);
            }
          }}
        />
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

      {suggestions.length > 0 && (
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
            {defaultProvider}
          </span>
        )}
        <select
          className="input sm promptw-cwd"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          aria-label={t("desktop.prompt.cwd")}
        >
          <option value="">{t("desktop.prompt.cwdHome")}</option>
          {folders.map((f) => (
            <option key={f.path} value={f.path}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {enabled.length === 0 && providers.data && (
        <p className="hint warn">{t("desktop.prompt.noProvider")}</p>
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
