/**
 * Settings › Memory › Agents' stance (.specs/features/cerebro-organizar, S4, AC 31-33): how the compiled AGENTS.md and
 * CLAUDE.md ask an agent to treat a request against the owner's goals (`settings.memory.agentStance`, door 7). The
 * option saves on its own; a save that fails says why beside an icon and keeps the option that was saved.
 */
import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";
import { useT } from "../../i18n";
import type { SettingsPatch } from "../../api";
import type { Put } from "../SettingsFields";
import type { SettingsShape } from "./shared";
import "./agentStance.css";

type Stance = "neutral" | "contest-conflicts";

export function AgentStance({ s, put }: { s: SettingsShape; put: Put }) {
  const t = useT();
  const saved: Stance = s.memory?.agentStance === "contest-conflicts" ? "contest-conflicts" : "neutral";
  // The option being saved, shown checked until the settings come back with it (or the save fails).
  const [chosen, setChosen] = useState<Stance | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (chosen !== null && saved === chosen) setChosen(null);
  }, [saved, chosen]);
  const current = chosen ?? saved;

  const choose = async (value: Stance) => {
    if (value === current) return;
    setError(null);
    setChosen(value);
    // One field of memory: the route merges `memory` field by field, so the rest of it stays as it is.
    const result = await put({ memory: { agentStance: value } } as SettingsPatch, true);
    if (!result.ok) {
      setChosen(null);
      setError(result.error);
    }
  };

  const options: Array<{ value: Stance; label: string }> = [
    { value: "neutral", label: t("settings.stance.neutral") },
    { value: "contest-conflicts", label: t("settings.stance.contest") },
  ];
  return (
    <fieldset className="stance" aria-describedby={error ? "st-stance-error" : "st-stance-hint"}>
      <legend className="stance-legend">{t("settings.stance.title")}</legend>
      {options.map((option) => (
        <label key={option.value} className="check stance-option">
          <input
            type="radio"
            name="agent-stance"
            value={option.value}
            checked={current === option.value}
            onChange={() => void choose(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
      <p className="stance-hint" id="st-stance-hint">
        {t("settings.stance.hint")}
      </p>
      {error && (
        <p className="stance-error" id="st-stance-error" role="alert">
          <CircleAlert aria-hidden />
          <span>{error}</span>
        </p>
      )}
    </fieldset>
  );
}
