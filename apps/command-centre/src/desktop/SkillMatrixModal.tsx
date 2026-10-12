/**
 * Model × Effort matrix. `ModelEffortMatrix` is the reusable controlled grid
 * (the skill detail and the console use it). `useSaveSkillMatrix` is the
 * persistence the anchored deck popover and the skill detail share.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ModelishOption, type ProviderId, type ProviderSnapshot, type Skill } from "../api";
import { apiCall } from "../apiCall";
import { useT } from "../i18n";
import { qk, useApiQuery } from "../queries";
import { useToast } from "../components/ui";

export const EFFORTS = ["low", "medium", "high", "default"] as const;
export type Effort = (typeof EFFORTS)[number];

export function shortModel(model: string | null): string {
  if (!model) return "AUTO";
  const m = model.toLowerCase();
  for (const name of ["opus", "sonnet", "haiku", "fable", "gpt-5.2", "gpt-5", "o4"]) {
    if (m.includes(name)) return name.toUpperCase();
  }
  return model.slice(0, 10).toUpperCase();
}

export function useEffortLabels(): Record<Effort, string> {
  const t = useT();
  return {
    low: t("effort.low"),
    medium: t("effort.medium"),
    high: t("effort.high"),
    default: t("effort.default"),
  };
}

export function useProviderModels(provider: ProviderId) {
  // Provider models are not part of `qk` yet; nested under the providers key so `settings.changed` invalidates them.
  return useApiQuery<ModelishOption[]>(
    [...qk.providers, provider, "models"],
    `/api/providers/${provider}/models`,
    { staleTime: 60_000 },
  );
}

export function skillEffort(skill: Skill): Effort {
  return (EFFORTS as readonly string[]).includes(skill.recommendedEffort)
    ? (skill.recommendedEffort as Effort)
    : "default";
}

/** Persist `recommendedModel` / `recommendedEffort` on the canonical skill (same PUT as the skill editor). */
export function useSaveSkillMatrix(skill: Skill, onSaved: (model: string | null, effort: Effort) => void) {
  const toast = useToast();
  const qc = useQueryClient();
  const labels = useEffortLabels();
  return useMutation({
    mutationFn: async ({ model, effort }: { model: string | null; effort: Effort }) => {
      const {
        body,
        skillFile: _f,
        resources: _r,
        bodyLineCount: _c,
        thick: _t,
        favorite: _v,
        ...front
      } = skill as Skill & Record<string, unknown>;
      delete (front as Record<string, unknown>).dir;
      await apiCall("PUT /api/skills/:slug", {
        params: { slug: skill.slug },
        body: {
          frontmatter: { ...front, recommendedModel: model, recommendedEffort: effort },
          body,
        },
      });
      return { model, effort };
    },
    onSuccess: ({ model, effort }) => {
      qc.invalidateQueries({ queryKey: qk.skills }).catch(() => undefined);
      toast(`/${skill.slug}: ${shortModel(model)} · ${labels[effort]}`, "ok");
      onSaved(model, effort);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
}

export interface ModelEffortMatrixProps {
  provider: ProviderId;
  model: string | null;
  effort: Effort;
  onPick: (model: string | null, effort: Effort) => void;
  busy?: boolean;
}

/** Controlled matrix: rows = models (AUTO first), columns = efforts. */
export function ModelEffortMatrix({ provider, model, effort, onPick, busy = false }: ModelEffortMatrixProps) {
  const labels = useEffortLabels();
  const models = useProviderModels(provider);
  const rows: Array<{ id: string | null; label: string }> = [
    { id: null, label: "AUTO" },
    ...(models.data ?? []).map((m) => ({ id: m.id, label: shortModel(m.id) })),
  ];
  return (
    <table className="matrix">
      <thead>
        <tr>
          <th />
          {EFFORTS.map((e) => (
            <th key={e} scope="col">
              {labels[e]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const activeRow = (model ?? null) === row.id;
          return (
            <tr key={row.id ?? "auto"} className={activeRow ? "active-row" : ""}>
              <td className="model-name">{row.label}</td>
              {EFFORTS.map((e) => {
                const selected = activeRow && effort === e;
                return (
                  <td className="cell" key={e}>
                    <button
                      type="button"
                      className={`m-dot${selected ? " selected" : ""}`}
                      disabled={busy}
                      onClick={() => onPick(row.id, e)}
                      aria-label={`${row.label} · ${labels[e]}`}
                      aria-pressed={selected}
                    />
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Providers enabled for this skill, with the default one first. */
export function pickProvider(
  skill: Skill,
  providers: ProviderSnapshot[],
): { enabled: ProviderSnapshot[]; initial: ProviderId } {
  const enabled = providers.filter((p) => p.enabled && skill.providers.includes(p.id));
  return {
    enabled,
    initial: providers.find((p) => p.isDefault && enabled.includes(p))?.id ?? enabled[0]?.id ?? "claude",
  };
}
