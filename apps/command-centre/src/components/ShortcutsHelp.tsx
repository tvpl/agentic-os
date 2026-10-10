/**
 * Keyboard shortcuts sheet (analysis item 30; .specs/features/comandos-atalhos):
 * opened with `?` outside a field or from the palette. It lists what the
 * command registry holds right now — one block per scope, "General" first,
 * then the shell, then each screen that registers keys — so it says what
 * the keys do where you are, and nothing else.
 */
import { Modal } from "./ui";
import { useT, type TKey } from "../i18n";
import { APPS, type AppKind } from "../desktop/apps";
import { useRegisteredCommands, scopeRank, type Command, type CommandScope } from "../commands/registry";
import { canonicalCombo, comboParts, isMac } from "../commands/keys";

function scopeTitle(scope: CommandScope): TKey | null {
  if (scope === "global") return "shell.shortcuts.global";
  if (scope === "moldura") return "cmd.scope.moldura";
  if (scope === "nucleo") return "cmd.scope.nucleo";
  if (scope.startsWith("view:")) return APPS[scope.slice("view:".length) as AppKind]?.titleKey ?? null;
  // A layer (a dialog, the focus mode) is never behind the sheet.
  return null;
}

/** The blocks the sheet shows: scope by scope, outer first, only the commands that have keys. */
export function helpBlocks(
  commands: readonly Command[],
): Array<{ scope: CommandScope; title: TKey; rows: Command[] }> {
  const blocks = new Map<CommandScope, Command[]>();
  for (const c of commands) {
    if (!c.keys?.length || !scopeTitle(c.scope)) continue;
    blocks.set(c.scope, [...(blocks.get(c.scope) ?? []), c]);
  }
  return [...blocks]
    .sort(([a], [b]) => scopeRank(a) - scopeRank(b))
    .map(([scope, rows]) => ({ scope, title: scopeTitle(scope)!, rows }));
}

export function ShortcutsHelp({ onClose, open = true }: { onClose: () => void; open?: boolean }) {
  const t = useT();
  const blocks = helpBlocks(useRegisteredCommands());
  const mac = isMac();
  return (
    <Modal title={t("shell.shortcuts.title")} onClose={onClose} open={open} className="shortcuts-modal">
      <div className="shortcuts-grid">
        {blocks.map((b) => (
          <section key={b.scope} className="shortcut-group" data-scope={b.scope} aria-label={t(b.title)}>
            <h3 className="hud-label">{t(b.title)}</h3>
            {b.rows.map((c) => {
              // Mod+M and Ctrl+M are one key off a Mac: one chip group.
              const combos = [...new Map(c.keys!.map((k) => [canonicalCombo(k, mac), k])).values()];
              return (
                <div key={c.id} className="shortcut-row" data-command={c.id}>
                  <span className="shortcut-keys">
                    {combos.map((combo) => (
                      <span key={combo} className="shortcut-combo">
                        {comboParts(combo, mac).map((k, i) => (
                          <kbd key={i} className="kbd">
                            {k}
                          </kbd>
                        ))}
                      </span>
                    ))}
                  </span>
                  <span className="shortcut-label">{t(c.title)}</span>
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </Modal>
  );
}

export default ShortcutsHelp;
