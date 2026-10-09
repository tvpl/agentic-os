/** The frame's two shortcut hints, written for the platform the browser runs on. */
const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** ⌘K / Ctrl K: open the palette. */
export const paletteKeys = () => (isMac() ? "⌘K" : "Ctrl K");
/** ⌘. / Ctrl .: show or hide the conversation. */
export const chatKeys = () => (isMac() ? "⌘." : "Ctrl .");
