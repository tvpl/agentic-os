/**
 * Keyboard shortcuts sheet (analysis item 30): opened with `?` outside a
 * field, from the palette, or by dispatching `SHORTCUTS_EVENT`.
 */
import { Modal } from "./ui";
import { useT, type TKey } from "../i18n";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";

interface Row {
  keys: string[][];
  label: TKey;
}
interface Group {
  title: TKey;
  rows: Row[];
}

const GROUPS: Group[] = [
  {
    title: "shell.shortcuts.global",
    rows: [
      { keys: [[MOD, "K"]], label: "shell.shortcuts.openPalette" },
      { keys: [[MOD, "M"]], label: "shell.shortcuts.openMenu" },
      { keys: [["?"]], label: "shell.shortcuts.help" },
      { keys: [["Esc"]], label: "shell.shortcuts.escape" },
    ],
  },
  {
    title: "shell.shortcuts.palette",
    rows: [
      { keys: [["↑"], ["↓"]], label: "shell.shortcuts.navigate" },
      { keys: [["↵"]], label: "shell.shortcuts.open" },
      { keys: [[MOD, "↵"]], label: "shell.shortcuts.runReadOnly" },
      { keys: [["→"]], label: "shell.palette.runSkill" },
      { keys: [["⌫"]], label: "shell.shortcuts.back" },
    ],
  },
  {
    title: "shell.shortcuts.desktop",
    rows: [
      { keys: [["E"]], label: "shell.shortcuts.editMode" },
      { keys: [["↑↓←→"], ["Shift", "↑↓←→"]], label: "shell.shortcuts.nudge" },
    ],
  },
  {
    title: "shell.shortcuts.brain",
    rows: [
      { keys: [["/"]], label: "shell.shortcuts.brainSearch" },
      { keys: [["P"]], label: "shell.shortcuts.brainPresent" },
      { keys: [["F"]], label: "shell.shortcuts.brainFilters" },
      { keys: [["L"]], label: "shell.shortcuts.brainList" },
      { keys: [[MOD, "+"], [MOD, "−"], [MOD, "0"]], label: "shell.shortcuts.brainZoom" },
    ],
  },
  {
    title: "shell.shortcuts.pixel",
    rows: [
      { keys: [["1"], ["2"], ["3"], ["4"]], label: "shell.shortcuts.pixelTools" },
      { keys: [[MOD, "Z"], [MOD, "Shift", "Z"]], label: "shell.shortcuts.pixelUndo" },
      { keys: [["["], ["]"]], label: "shell.shortcuts.pixelFrames" },
    ],
  },
];

export function ShortcutsHelp({ onClose, open = true }: { onClose: () => void; open?: boolean }) {
  const t = useT();
  return (
    <Modal title={t("shell.shortcuts.title")} onClose={onClose} open={open} className="shortcuts-modal">
      <div className="shortcuts-grid">
        {GROUPS.map((g) => (
          <section key={g.title} className="shortcut-group" aria-label={t(g.title)}>
            <h3 className="hud-label">{t(g.title)}</h3>
            {g.rows.map((row) => (
              <div key={row.label} className="shortcut-row">
                <span className="shortcut-keys">
                  {row.keys.map((combo, i) => (
                    <span key={i} className="shortcut-combo">
                      {combo.map((k) => (
                        <kbd key={k} className="kbd">
                          {k}
                        </kbd>
                      ))}
                    </span>
                  ))}
                </span>
                <span className="shortcut-label">{t(row.label)}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}

export default ShortcutsHelp;
