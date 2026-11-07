/**
 * The chip above the composer (.specs/features/cerebro-contextos/design.md, "Tela - Chip no chat"): with a context
 * active, "In this context: <name>" and an `X` that turns the context off for the whole machine. A continued
 * conversation shows its own context (the session's), not the active one, and has no `X`: it keeps it (door 4).
 */
import { Crosshair, X } from "lucide-react";
import { useT } from "../i18n";
import { useToast } from "../components/ui";
import { Tooltip } from "../ui";
import { errorMessage } from "../views/shared";
import { useWorkContext } from "./useWorkContext";
import "./contexts.css";

export function ContextChip({ session }: { session?: string | null }) {
  const t = useT();
  const toast = useToast();
  const work = useWorkContext();
  if (session !== undefined) {
    if (session === null) return null;
    const name = work.contexts.find((c) => c.id === session)?.name ?? session;
    return (
      <div className="ctx-chip" data-session="">
        <Crosshair aria-hidden />
        <span>{t("context.chip.session", { name })}</span>
      </div>
    );
  }
  if (!work.active) return null;
  return (
    <div className="ctx-chip">
      <Crosshair aria-hidden />
      <span>{t("context.chip", { name: work.active.name })}</span>
      <Tooltip label={t("context.chip.off")}>
        <button
          type="button"
          className="ctx-chip-x"
          aria-label={t("context.chip.off")}
          onClick={() =>
            void work.choose(null).catch((err: unknown) => toast(errorMessage(err, t), "danger"))
          }
        >
          <X aria-hidden />
        </button>
      </Tooltip>
    </div>
  );
}
