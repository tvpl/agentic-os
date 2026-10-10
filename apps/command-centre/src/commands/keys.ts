/**
 * Key combinations as commands write them (`"Mod+K"`, `"Shift+1"`, `"["`,
 * `"Escape"`), how an event matches one, and how one is drawn.
 *
 * `Mod` is the platform's command key (door 3): ⌘ on a Mac, Ctrl elsewhere.
 * The platform is read from `navigator.platform` on every call — the labels
 * and the matching ask the same question the same way.
 */

export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

interface Combo {
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

const COMBO = /^((?:(?:Mod|Ctrl|Meta|Alt|Shift)\+)*)(.+)$/;

export function parseCombo(combo: string): Combo {
  const m = COMBO.exec(combo);
  if (!m) throw new Error(`Not a key combination: "${combo}"`);
  const mods = m[1]!.split("+").filter(Boolean);
  return {
    mod: mods.includes("Mod"),
    ctrl: mods.includes("Ctrl"),
    meta: mods.includes("Meta"),
    alt: mods.includes("Alt"),
    shift: mods.includes("Shift"),
    key: m[2]!,
  };
}

const isLetter = (k: string) => /^[a-z]$/i.test(k);
const isDigit = (k: string) => /^[0-9]$/.test(k);
/** `?`, `[`, `+`, `/`…: Shift is how some of them are typed, so it is not part of the match. */
const isSymbol = (k: string) => k.length === 1 && !isLetter(k) && !isDigit(k);

/** True when the combination holds a real modifier (Shift alone does not count: it types). */
export function hasModifier(combo: string): boolean {
  const c = parseCombo(combo);
  return c.mod || c.ctrl || c.meta || c.alt;
}

export function matchesCombo(combo: string, e: KeyboardEvent, mac = isMac()): boolean {
  const c = parseCombo(combo);
  const ctrl = c.ctrl || (c.mod && !mac);
  const meta = c.meta || (c.mod && mac);
  if (e.ctrlKey !== ctrl || e.metaKey !== meta || e.altKey !== c.alt) return false;
  if (isLetter(c.key)) return e.shiftKey === c.shift && e.key.toLowerCase() === c.key.toLowerCase();
  // Shift+1 types "!" (or another sign, by layout): the physical key is what is meant.
  if (isDigit(c.key))
    return e.shiftKey === c.shift && (c.shift ? e.code === `Digit${c.key}` : e.key === c.key);
  if (isSymbol(c.key)) return e.key === c.key;
  return e.shiftKey === c.shift && e.key === c.key;
}

/** One spelling per physical combination on this platform: two of these that are equal collide. */
export function canonicalCombo(combo: string, mac = isMac()): string {
  const c = parseCombo(combo);
  const ctrl = c.ctrl || (c.mod && !mac);
  const meta = c.meta || (c.mod && mac);
  const shift = c.shift && !isSymbol(c.key);
  const key = isLetter(c.key) ? c.key.toLowerCase() : c.key;
  return `${ctrl ? "Ctrl+" : ""}${meta ? "Meta+" : ""}${c.alt ? "Alt+" : ""}${shift ? "Shift+" : ""}${key}`;
}

const NAMES: Record<string, string> = {
  Escape: "Esc",
  Enter: "↵",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Backspace: "⌫",
  " ": "Space",
  "-": "−",
};

/** The chips of one combination: `["⌘", "⇧", "A"]` on a Mac, `["Ctrl", "Shift", "A"]` elsewhere. */
export function comboParts(combo: string, mac = isMac()): string[] {
  const c = parseCombo(combo);
  const out: string[] = [];
  if (c.ctrl || (c.mod && !mac)) out.push(mac ? "⌃" : "Ctrl");
  if (c.meta || (c.mod && mac)) out.push(mac ? "⌘" : "Win");
  if (c.alt) out.push(mac ? "⌥" : "Alt");
  if (c.shift) out.push(mac ? "⇧" : "Shift");
  out.push(NAMES[c.key] ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key));
  return out;
}

/** The combination in the WAI-ARIA `aria-keyshortcuts` spelling: `Meta+K`, `Control+Shift+A`. */
export function ariaShortcut(combo: string, mac = isMac()): string {
  const c = parseCombo(combo);
  const out: string[] = [];
  if (c.ctrl || (c.mod && !mac)) out.push("Control");
  if (c.meta || (c.mod && mac)) out.push("Meta");
  if (c.alt) out.push("Alt");
  if (c.shift) out.push("Shift");
  out.push(c.key.length === 1 ? c.key.toUpperCase() : c.key);
  return out.join("+");
}

/** One combination as a short label: `⌘K` on a Mac, `Ctrl K` elsewhere. */
export function comboLabel(combo: string, mac = isMac()): string {
  return comboParts(combo, mac).join(mac ? "" : " ");
}

/** A field the person is typing in: a bare key there is a letter, not a command. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  // jsdom has no isContentEditable; the attribute says the same.
  return target.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}
