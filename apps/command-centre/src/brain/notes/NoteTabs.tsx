/**
 * The tabs of the notes view (.specs/features/cerebro-vista-notas, AC 14-16; design.md "Área de leitura", item 1):
 * `Tabs` of the primitives, one per open note, with its title, a dot and the hidden text "alterações não salvas" when
 * it holds unsaved changes, and its own "Fechar <título>" (`X`); "+" opens the brain's search to open another note.
 * The close buttons sit beside the tabs, not inside them and not inside the tab list (a tab list holds tabs only):
 * the strip is one grid, each `X` in the column after its tab. Closing a tab with unsaved changes asks first, with
 * "Continuar editando" focused.
 */
import { useRef, useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { useT } from "../../i18n";
import { Tabs, Tooltip } from "../../ui";
import { useConfirm } from "../../hooks/useConfirm";
import type { BrainHit } from "../memoryData";
import { NoteSearch } from "./NoteSearch";
import { baseName, withoutExt } from "./notesData";
import type { NotesState } from "./useNotesState";

export const READING_PANEL_ID = "notes-reading";
const tabId = (path: string) => `notes-tab-${encodeURIComponent(path)}`;

export interface NoteTabsProps {
  state: NotesState;
  context?: string;
  /** The tab shown; `null` while a folder, the Home or nothing is shown instead. */
  value: string | null;
  children: ReactNode;
}

/** Ask before closing a tab with unsaved changes; true when it was closed. */
export function useCloseTab(state: NotesState): (path: string) => Promise<boolean> {
  const t = useT();
  const confirm = useConfirm();
  return async (path) => {
    if (state.unsaved.has(path)) {
      const discard = await confirm({
        title: t("note.discard.title"),
        confirmLabel: t("note.discard.confirm"),
        cancelLabel: t("note.discard.keep"),
        danger: true,
      });
      if (!discard) return false;
    }
    state.close(path);
    return true;
  };
}

export function titleOf(state: NotesState, path: string): string {
  return state.meta.get(path)?.title ?? withoutExt(baseName(path));
}

export function NoteTabs({ state, context, value, children }: NoteTabsProps) {
  const t = useT();
  const close = useCloseTab(state);
  const plus = useRef<HTMLButtonElement>(null);
  const [searching, setSearching] = useState(false);
  const tabs = state.tabs.tabs;
  return (
    <Tabs.Root
      value={value ?? ""}
      onChange={(path) => state.focus(path)}
      ids={{ tab: tabId, panel: () => READING_PANEL_ID }}
      className="notes-tabs-root"
    >
      <div className="notes-tabs">
        <Tabs.List label={t("notes.tab.list")} variant="line" className="notes-tablist">
          {tabs.map((path) => (
            <Tabs.Tab key={path} value={path} className="notes-tab">
              <span className="notes-tab-title">{titleOf(state, path)}</span>
              {state.unsaved.has(path) && (
                <>
                  <span className="notes-tab-dot" aria-hidden />
                  <span className="sr-only">{t("notes.tab.unsaved")}</span>
                </>
              )}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <div className="notes-tab-closes">
          {tabs.map((path) => {
            const label = t("notes.tab.close", { title: titleOf(state, path) });
            return (
              <Tooltip key={path} label={label}>
                <button
                  type="button"
                  className="notes-tab-x"
                  aria-label={label}
                  data-active={path === value ? "" : undefined}
                  onClick={() => void close(path)}
                >
                  <X aria-hidden />
                </button>
              </Tooltip>
            );
          })}
        </div>
        <Tooltip label={t("notes.tab.open")}>
          <button
            ref={plus}
            type="button"
            className="notes-tab-plus"
            aria-label={t("notes.tab.open")}
            aria-haspopup="dialog"
            onClick={() => setSearching(true)}
          >
            <Plus aria-hidden />
          </button>
        </Tooltip>
      </div>
      <NoteSearch
        open={searching}
        onClose={() => setSearching(false)}
        anchor={plus}
        context={context}
        label={t("notes.tab.open")}
        onPick={(hit: BrainHit) => {
          setSearching(false);
          if (hit.path) state.open(hit.path, { id: hit.id, title: hit.title ?? null });
        }}
      />
      {value !== null ? (
        <Tabs.Panel className="notes-reading" tabIndex={-1}>
          {children}
        </Tabs.Panel>
      ) : (
        <div className="notes-reading">{children}</div>
      )}
    </Tabs.Root>
  );
}
