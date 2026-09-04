/**
 * Notifications outside the tab (plan Onda 2 §4): system notifications via
 * the Notification API (through the service worker when it controls the
 * page, so a click focuses or opens the OS) and spoken alerts via
 * speechSynthesis. Both are opt-in toggles kept in localStorage; both are
 * no-ops where the browser lacks the API.
 */
const DESKTOP_KEY = "mordomo.notifications.desktop";
const VOICE_KEY = "mordomo.notifications.voice";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function getDesktopNotify(): boolean {
  return storage()?.getItem(DESKTOP_KEY) === "1";
}
export function setDesktopNotify(on: boolean): void {
  try {
    storage()?.setItem(DESKTOP_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}
export function getVoiceNotify(): boolean {
  return storage()?.getItem(VOICE_KEY) === "1";
}
export function setVoiceNotify(on: boolean): void {
  try {
    storage()?.setItem(VOICE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export type NotifyPermission = "granted" | "denied" | "default" | "unsupported";

export function notifyPermission(): NotifyPermission {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

/** Ask once; resolves to the resulting permission. */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

export interface SystemNotice {
  title: string;
  body?: string;
  href?: string;
  tag?: string;
}

/**
 * Show a system notification when the toggle is on, permission was granted
 * and the tab is not the thing the user is looking at. Returns true when one
 * was shown.
 */
export function showSystemNotification(n: SystemNotice, opts: { force?: boolean } = {}): boolean {
  if (!getDesktopNotify() || notifyPermission() !== "granted") return false;
  if (
    !opts.force &&
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    document.hasFocus()
  )
    return false;
  try {
    const sw = navigator.serviceWorker?.controller;
    if (sw) {
      sw.postMessage({ type: "notify", ...n });
      return true;
    }
    const note = new Notification(n.title, { body: n.body, tag: n.tag, icon: "/icons/icon-192.png" });
    note.onclick = () => {
      window.focus();
      if (n.href) location.hash = `#${n.href}`;
      note.close();
    };
    return true;
  } catch {
    return false;
  }
}

/** Speak a short line (alerts, replies) in the UI language; silent without the toggle or the API. */
export function speak(text: string, lang: string, opts: { force?: boolean } = {}): boolean {
  if (!opts.force && !getVoiceNotify()) return false;
  if (typeof speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") return false;
  try {
    const u = new SpeechSynthesisUtterance(text.slice(0, 400));
    u.lang = lang;
    u.rate = 1.05;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

export function stopSpeaking(): void {
  try {
    speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
}

/** Minimal typing for the prefixed Web Speech API. */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult:
    ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> & { length: number } }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export function speechRecognitionAvailable(): boolean {
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return typeof w.SpeechRecognition === "function" || typeof w.webkitSpeechRecognition === "function";
}

/** Start listening; `onText` receives the final transcript, `onEnd` fires when recognition stops. Returns a stop function. */
export function listen(lang: string, onText: (text: string) => void, onEnd: () => void): (() => void) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = false;
  rec.continuous = false;
  rec.onresult = (e) => {
    const parts: string[] = [];
    for (let i = 0; i < e.results.length; i++) {
      const alt = e.results[i]?.[0];
      if (alt?.transcript) parts.push(alt.transcript);
    }
    if (parts.length > 0) onText(parts.join(" ").trim());
  };
  rec.onend = () => onEnd();
  rec.onerror = () => onEnd();
  try {
    rec.start();
  } catch {
    onEnd();
    return null;
  }
  return () => {
    try {
      rec.stop();
    } catch {
      /* ignore */
    }
  };
}
