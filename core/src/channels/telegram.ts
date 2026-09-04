import type { Settings } from "../config/schema.js";
import type { EventBus, OsEvent } from "../events.js";
import type { NotificationRecord, NotificationTone } from "../notifications/store.js";
import { redactSecrets } from "../security/redact.js";

/**
 * Telegram delivery (Onda 2, item 4): the first way an alert leaves the tab.
 *
 * Rules that make this safe to leave running:
 *  - the bot token is NEVER stored in settings — only the NAME of the
 *    environment variable holding it (`settings.channels.telegram.botTokenEnv`);
 *  - exactly one outbound host, in one constant (`TELEGRAM_API_HOST`);
 *  - a 10-second timeout, and failures are logged at most once an hour and
 *    never thrown: a chat that is unreachable must not break the inbox.
 */

/** The only host this module ever talks to. */
export const TELEGRAM_API_HOST = "api.telegram.org";
export const TELEGRAM_API_ORIGIN = `https://${TELEGRAM_API_HOST}`;
export const TELEGRAM_TIMEOUT_MS = 10_000;
/** One log line per hour per channel, however many messages fail. */
export const ERROR_LOG_INTERVAL_MS = 3_600_000;
const MAX_MESSAGE_CHARS = 3_500;

/** Severity order of the inbox tones: only `>= minTone` is worth a message. */
const TONE_RANK: Record<NotificationTone, number> = { ok: 0, info: 1, warn: 2, danger: 3 };

export function toneAtLeast(tone: NotificationTone | null | undefined, minTone: NotificationTone): boolean {
  return TONE_RANK[tone ?? "info"] >= TONE_RANK[minTone];
}

/** `https://api.telegram.org/bot<token>/sendMessage` — the token never leaves this function. */
export function sendMessageUrl(token: string): string {
  return `${TELEGRAM_API_ORIGIN}/bot${encodeURIComponent(token)}/sendMessage`;
}

export interface TelegramSendResult {
  ok: boolean;
  error?: string;
}

export interface TelegramSendOptions {
  token: string;
  chatId: string;
  text: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** POST one message. Resolves with `{ ok: false, error }` instead of throwing. */
export async function sendTelegramMessage(opts: TelegramSendOptions): Promise<TelegramSendResult> {
  if (!opts.token) return { ok: false, error: "No bot token in the environment." };
  if (!opts.chatId) return { ok: false, error: "No chat id configured." };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TELEGRAM_TIMEOUT_MS);
  try {
    const res = await fetchImpl(sendMessageUrl(opts.token), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: opts.chatId,
        text: opts.text.slice(0, MAX_MESSAGE_CHARS),
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
      redirect: "error",
    });
    if (!res.ok) return { ok: false, error: `Telegram responded ${res.status}.` };
    // The API answers 200 with {"ok":false,"description":…} for a bad chat id.
    const body = (await res.json().catch(() => null)) as { ok?: unknown; description?: unknown } | null;
    if (body && body.ok === false) {
      const detail = typeof body.description === "string" ? body.description : "rejected the message";
      return { ok: false, error: sanitize(detail, opts.token) };
    }
    return { ok: true };
  } catch (err) {
    const reason = (err as Error).name === "AbortError" ? "Timed out after 10 s." : (err as Error).message;
    return { ok: false, error: sanitize(reason, opts.token) };
  } finally {
    clearTimeout(timer);
  }
}

/** Never echo the token, and never a raw secret, in an error string. */
function sanitize(message: string, token: string): string {
  const withoutToken = token ? message.split(token).join("[token]") : message;
  return redactSecrets(withoutToken).slice(0, 200);
}

/** Local URL a message links back to (`http://127.0.0.1:<port><href>`). */
export function localLink(port: number, href: string | null | undefined): string {
  const base = `http://127.0.0.1:${port}`;
  if (!href) return base;
  return href.startsWith("http") ? href : `${base}${href.startsWith("/") ? href : `/${href}`}`;
}

/** Title, body and the link back into the Command Centre. */
export function formatNotification(row: NotificationRecord, port: number): string {
  return [row.title, row.body ?? "", localLink(port, row.href)].filter(Boolean).join("\n");
}

/** The token, read from the environment at send time (never cached, never stored). */
export function telegramToken(settings: Settings, env: NodeJS.ProcessEnv = process.env): string {
  const name = settings.channels.telegram.botTokenEnv;
  return (name && env[name]) || "";
}

export interface TelegramChannelDeps {
  getSettings: () => Settings;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  onError?: (message: string) => void;
}

/**
 * Deliver one inbox row if the channel is on and the tone is loud enough.
 * Returns what happened, so the caller (and the tests) can assert on it.
 */
export async function deliverToTelegram(
  deps: TelegramChannelDeps,
  row: NotificationRecord,
): Promise<TelegramSendResult & { skipped?: "disabled" | "tone" | "not_configured" }> {
  const settings = deps.getSettings();
  const cfg = settings.channels.telegram;
  if (!cfg.enabled) return { ok: false, skipped: "disabled" };
  if (!toneAtLeast(row.tone, cfg.minTone)) return { ok: false, skipped: "tone" };
  const token = telegramToken(settings, deps.env ?? process.env);
  if (!token || !cfg.chatId)
    return { ok: false, skipped: "not_configured", error: "Channel not configured." };
  return sendTelegramMessage({
    token,
    chatId: cfg.chatId,
    text: formatNotification(row, settings.port),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
}

/**
 * Subscribe the channel to `notification.created`. Returns the unsubscribe
 * function. Delivery failures are counted and logged at most once an hour.
 */
export function installTelegramChannel(bus: EventBus, deps: TelegramChannelDeps): () => void {
  let lastLoggedAt = 0;
  let suppressed = 0;
  const log = (message: string) => {
    const now = deps.now?.() ?? Date.now();
    if (now - lastLoggedAt < ERROR_LOG_INTERVAL_MS) {
      suppressed++;
      return;
    }
    const tail = suppressed > 0 ? ` (${suppressed} more suppressed)` : "";
    lastLoggedAt = now;
    suppressed = 0;
    if (deps.onError) deps.onError(`${message}${tail}`);
    else console.error(`[telegram] ${message}${tail}`);
  };
  return bus.subscribe((event: OsEvent) => {
    if (event.type !== "notification.created") return;
    const row = event.payload as NotificationRecord;
    if (!row || typeof row.title !== "string") return;
    void deliverToTelegram(deps, row)
      .then((result) => {
        if (!result.ok && !result.skipped) log(result.error ?? "delivery failed");
      })
      .catch((err: unknown) => log((err as Error).message));
  });
}
