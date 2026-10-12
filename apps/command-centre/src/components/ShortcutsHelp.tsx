/**
 * Keyboard shortcuts sheet (analysis item 30; .specs/features/comandos-atalhos):
 * opened with `?` outside a field or from the palette. It lists what the
 * command registry holds right now — one block per scope, "General" first,
 * then the shell, then each screen that registers keys — so it says what
 * the keys do where you are, and nothing else.
 */
import { Modal } from "../ui";
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

export interface HelpRow {
  command: Command;
  /** The combinations to draw, one per physical key on this platform, minus the ones an inner scope covers. */
  combos: string[];
}
export interface HelpBlock {
  scope: CommandScope;
  title: TKey;
  rows: HelpRow[];
}

/**
 * The blocks the sheet shows: scope by scope, outer first, only the keys
 * that answer where you are. A key an inner scope also declares is that
 * scope's while it is up (door 2), so it is drawn there, once, with the
 * inner meaning (AC 17): Pixel Studio's `2` is not also "go to Brain". A
 * command left with no key of its own leaves the sheet.
 */
export function helpBlocks(commands: readonly Command[], mac = isMac()): HelpBlock[] {
  // The innermost rank that declares each physical key (layers are not behind the sheet: it is one).
  const innermost = new Map<string, number>();
  for (const d of commands) {
    if (!scopeTitle(d.scope)) continue;
    for (const k of d.keys ?? []) {
      const key = canonicalCombo(k, mac);
      innermost.set(key, Math.max(innermost.get(key) ?? -1, scopeRank(d.scope)));
    }
  }
  const blocks = new Map<CommandScope, HelpRow[]>();
  for (const c of commands) {
    if (!c.keys?.length || !scopeTitle(c.scope)) continue;
    const mine = new Map<string, string>();
    for (const k of c.keys) {
      const key = canonicalCombo(k, mac);
      if ((innermost.get(key) ?? -1) <= scopeRank(c.scope)) mine.set(key, k);
    }
    if (mine.size === 0) continue;
    blocks.set(c.scope, [...(blocks.get(c.scope) ?? []), { command: c, combos: [...mine.values()] }]);
  }
  return [...blocks]
    .sort(([a], [b]) => scopeRank(a) - scopeRank(b))
    .map(([scope, rows]) => ({ scope, title: scopeTitle(scope)!, rows }));
}

export function ShortcutsHelp({ onClose, open = true }: { onClose: () => void; open?: boolean }) {
  const t = useT();
  const mac = isMac();
  const blocks = helpBlocks(useRegisteredCommands(), mac);
  return (
    <Modal title={t("shell.shortcuts.title")} onClose={onClose} open={open} className="shortcuts-modal">
      <div className="shortcuts-grid">
        {blocks.map((b) => (
          <section key={b.scope} className="shortcut-group" data-scope={b.scope} aria-label={t(b.title)}>
            <h3 className="hud-label">{t(b.title)}</h3>
            {b.rows.map(({ command: c, combos }) => (
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
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}
