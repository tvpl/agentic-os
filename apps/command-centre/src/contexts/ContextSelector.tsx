/**
 * The work-context selector (.specs/features/cerebro-contextos/design.md, "Tela - Seletor de contexto"): in the frame
 * a full-width button below the brand (only its icon when the sidebar is folded), in the Núcleo a compact one left of
 * the voice line. A menu of the primitives lists "Whole brain" first and then each context with its file count; the
 * chosen one is checked. One selector is mounted per shell, so it also says once when the active context is gone, and
 * it registers the two commands of the palette.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Crosshair, Plus, RefreshCw, Settings2, Sparkles } from "lucide-react";
import { useT, useLocale } from "../i18n";
import { qk, useRouteQuery } from "../queries";
import { useToast } from "../components/ui";
import { useOsNavigate } from "../hooks/useViewTransition";
import { DropdownMenu, type MenuEntry } from "../ui";
import { errorMessage } from "../views/shared";
import { useCommands, type Command } from "../commands/registry";
import { openCleanup } from "../brain/cleanupEvents";
import { NewContextDialog } from "./NewContextDialog";
import { SWITCH_CONTEXT_ID, WHOLE_BRAIN_ID, useWorkContext } from "./useWorkContext";
import "./contexts.css";

export interface ContextSelectorProps {
  variant: "frame" | "nucleo";
  /** The frame's sidebar is folded: only the icon, with the name as its name and its hint. */
  collapsed?: boolean;
}

/** The registry's names for the two commands (AC 39), beside `useWorkContext` so a reader of them needs no selector. */
export { SWITCH_CONTEXT_ID, WHOLE_BRAIN_ID };

export function ContextSelector({ variant, collapsed = false }: ContextSelectorProps) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const navigate = useOsNavigate();
  const work = useWorkContext();
  const status = useRouteQuery(qk.memoryStatus, "GET /api/memory/status", undefined, { staleTime: 30_000 });
  const [menuOpen, setMenuOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  // The active context was deleted elsewhere, or the list no longer holds it: back to the whole brain, said once.
  const announced = useRef<string | null>(null);
  const { gone, choose } = work;
  useEffect(() => {
    if (!gone || announced.current === gone) return;
    announced.current = gone;
    toast(t("context.gone"), "info");
    void choose(null).catch(() => undefined);
  }, [gone, choose, toast, t]);

  const live = useRef({ work, toast, t });
  live.current = { work, toast, t };
  // Memoised, so the commands keep their place in the registry (useCommands).
  const commands = useMemo<Command[]>(
    () => [
      {
        id: SWITCH_CONTEXT_ID,
        title: "context.cmd.switch",
        group: "actions",
        scope: "global",
        icon: Crosshair,
        keywords: ["context", "contexto", "project", "projeto", "scope", "focus", "trocar", "switch"],
        palette: true,
        // The palette closes first and hands focus back; the menu opens after it.
        run: () => window.setTimeout(() => setMenuOpen(true), 220),
      },
      {
        id: WHOLE_BRAIN_ID,
        title: "context.all",
        group: "actions",
        scope: "global",
        icon: Crosshair,
        keywords: ["context", "contexto", "whole", "brain", "todo", "cerebro", "cérebro", "all"],
        palette: true,
        run: () => {
          const { work, toast, t } = live.current;
          void work.choose(null).catch((err: unknown) => toast(errorMessage(err, t), "danger"));
        },
      },
    ],
    [],
  );
  useCommands(commands);

  const count = (n: number) => t("context.files", { n: n.toLocaleString(locale) });
  const active = work.active;
  const name = active ? active.name : t("context.all");
  const files = active ? active.files : status.data?.facets.total;
  const pick = (id: string | null) => () =>
    void work.choose(id).catch((err: unknown) => toast(errorMessage(err, t), "danger"));

  const entries: MenuEntry[] = [
    { id: "all", label: t("context.all"), checked: active === null, onSelect: pick(null) },
    { id: "sep-list", separator: true },
  ];
  if (work.list.isPending)
    entries.push({
      id: "loading",
      note: t("common.loading"),
      icon: <span className="spinner sm" aria-hidden />,
    });
  else if (work.list.isError)
    entries.push(
      { id: "error", note: errorMessage(work.list.error, t), icon: <AlertTriangle aria-hidden /> },
      {
        id: "retry",
        label: t("brain.links.retry"),
        icon: <RefreshCw aria-hidden />,
        keepOpen: true,
        onSelect: () => void work.list.refetch(),
      },
    );
  else if (work.contexts.length === 0) entries.push({ id: "empty", note: t("context.empty") });
  else
    for (const c of work.contexts) {
      const problem = c.paths.some((p) => p.state !== "ok");
      entries.push({
        id: `ctx:${c.id}`,
        checked: active?.id === c.id,
        onSelect: pick(c.id),
        label: (
          <span className="ctx-item">
            <span className="ctx-item-name">{c.name}</span>
            <span className="ctx-item-meta">{count(c.files)}</span>
            {problem && (
              <span className="ctx-item-warn">
                <AlertTriangle aria-hidden />
                {t("context.pathProblem")}
              </span>
            )}
          </span>
        ),
      });
    }
  entries.push({ id: "sep-actions", separator: true });
  // The guided cleanup of the active context, at its step 2 (cerebro-faxina-guiada, amendment 11).
  if (active)
    entries.push({
      id: "cleanup",
      label: t("cleanup.open.context"),
      icon: <Sparkles aria-hidden />,
      onSelect: () => openCleanup({ context: active.id, step: 2 }),
    });
  entries.push(
    { id: "new", label: t("context.new"), icon: <Plus aria-hidden />, onSelect: () => setCreating(true) },
    {
      id: "manage",
      label: t("context.manage"),
      icon: <Settings2 aria-hidden />,
      onSelect: () => navigate("/settings?tab=memory"),
    },
  );

  const folded = variant === "frame" && collapsed;
  const trigger = folded ? (
    <button type="button" className="ctx-sel" data-variant={variant} data-folded="" aria-label={name}>
      <Crosshair aria-hidden className="ctx-sel-i" />
    </button>
  ) : (
    <button type="button" className="ctx-sel" data-variant={variant}>
      <Crosshair aria-hidden className="ctx-sel-i" />
      <span className="ctx-sel-text">
        <span className="ctx-sel-name">{name}</span>
        {variant === "frame" && files !== undefined && <span className="ctx-sel-count">{count(files)}</span>}
      </span>
    </button>
  );
  return (
    <>
      <DropdownMenu
        trigger={trigger}
        tip={folded ? name : undefined}
        items={entries}
        align="start"
        className="ctx-menu"
        open={menuOpen}
        onOpenChange={setMenuOpen}
      />
      {creating && <NewContextDialog onClose={() => setCreating(false)} />}
    </>
  );
}
