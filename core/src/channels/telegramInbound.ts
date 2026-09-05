import type { Settings } from "../config/schema.js";
import { TELEGRAM_API_ORIGIN, TELEGRAM_TIMEOUT_MS, telegramToken } from "./telegram.js";

/**
 * Telegram inbound (the phone answers back): a long poll on `getUpdates`
 * that turns inline-button taps and `/approve` `/deny` `/pending` commands
 * into approval decisions.
 *
 * Trust rules:
 *  - only updates from the configured `chatId` are honoured; anything else
 *    is dropped without a reply (a stranger who finds the bot gets silence);
 *  - the poller runs only while `channels.telegram.enabled && inbound` and
 *    a token is present in the environment;
 *  - the same single outbound host as delivery; no other URL is ever fetched;
 *  - each decision goes through the caller's `resolve`, the exact code path
 *    the Command Centre button uses, so nothing can be approved here that the
 *    UI could not.
 */

export interface TelegramUpdate {
  update_id: number;
  message?: { message_id: number; chat: { id: number | string }; text?: string };
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number | string } };
    from?: { id: number };
  };
}

export interface PendingApprovalView {
  id: string;
  kind: string;
  description: string;
}

export interface InboundDeps {
  getSettings: () => Settings;
  /** Resolve through the same path as the HTTP route. Returns a human line for the chat. */
  resolve: (id: string, decision: "approved" | "denied") => Promise<{ ok: boolean; message: string }>;
  pending: () => PendingApprovalView[];
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  onError?: (message: string) => void;
  /** Long-poll timeout in seconds (Telegram holds the request open). */
  pollSeconds?: number;
}

/** Inline keyboard for an approval message (attached by delivery when the row has an approvalId). */
export function approvalKeyboard(approvalId: string): Record<string, unknown> {
  return {
    inline_keyboard: [
      [
        { text: "✅ Approve", callback_data: `ap:${approvalId}` },
        { text: "⛔ Deny", callback_data: `dn:${approvalId}` },
      ],
    ],
  };
}

/** Parse a button payload or a text command into a decision. Exported for tests. */
export function parseCommand(
  text: string,
):
  | { type: "resolve"; id: string; decision: "approved" | "denied" }
  | { type: "pending" }
  | { type: "help" }
  | null {
  const t = text.trim();
  let m = /^(ap|dn):([\w-]{4,80})$/.exec(t);
  if (m) return { type: "resolve", id: m[2]!, decision: m[1] === "ap" ? "approved" : "denied" };
  m = /^\/(approve|deny|ok|no)(?:@\w+)?\s+([\w-]{4,80})$/i.exec(t);
  if (m)
    return { type: "resolve", id: m[2]!, decision: /^(approve|ok)$/i.test(m[1]!) ? "approved" : "denied" };
  if (/^\/(pending|status)(?:@\w+)?$/i.test(t)) return { type: "pending" };
  if (/^\/(start|help)(?:@\w+)?$/i.test(t)) return { type: "help" };
  return null;
}

const HELP =
  "MordomoOS bot.\n/pending — approvals waiting\n/approve <id> or /deny <id> — decide (the buttons under each alert do the same).";

function sameChat(a: number | string | undefined, b: string): boolean {
  return a !== undefined && String(a) === String(b);
}

export class TelegramPoller {
  private offset = 0;
  private running = false;
  private abort: AbortController | null = null;
  private lastErrorAt = 0;
  /** For status: when the last successful poll returned. */
  lastPollAt = 0;
  lastError: string | null = null;
  handled = 0;

  constructor(private readonly deps: InboundDeps) {}

  get active(): boolean {
    return this.running;
  }

  /** Whether settings + environment allow polling right now. */
  enabled(): boolean {
    const s = this.deps.getSettings();
    const cfg = s.channels.telegram;
    return cfg.enabled && cfg.inbound && !!cfg.chatId && !!telegramToken(s, this.deps.env ?? process.env);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
    this.abort?.abort();
  }

  /** One `getUpdates` request and its handling. Exposed for tests; the loop calls it repeatedly. */
  async pollOnce(): Promise<number> {
    const s = this.deps.getSettings();
    const token = telegramToken(s, this.deps.env ?? process.env);
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const seconds = this.deps.pollSeconds ?? 25;
    this.abort = new AbortController();
    const timer = setTimeout(() => this.abort?.abort(), (seconds + 10) * 1000);
    try {
      const res = await fetchImpl(`${TELEGRAM_API_ORIGIN}/bot${encodeURIComponent(token)}/getUpdates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          offset: this.offset,
          timeout: seconds,
          allowed_updates: ["message", "callback_query"],
        }),
        signal: this.abort.signal,
        redirect: "error",
      });
      if (!res.ok) throw new Error(`Telegram responded ${res.status}.`);
      const body = (await res.json()) as { ok: boolean; result?: TelegramUpdate[]; description?: string };
      if (!body.ok) throw new Error(body.description ?? "getUpdates rejected");
      this.lastPollAt = Date.now();
      this.lastError = null;
      const updates = body.result ?? [];
      for (const u of updates) {
        this.offset = Math.max(this.offset, u.update_id + 1);
        await this.handle(u, token, fetchImpl);
      }
      return updates.length;
    } finally {
      clearTimeout(timer);
      this.abort = null;
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      if (!this.enabled()) {
        await sleep(5000);
        continue;
      }
      try {
        await this.pollOnce();
      } catch (err) {
        if (!this.running) break;
        const msg = (err as Error).name === "AbortError" ? "poll aborted" : (err as Error).message;
        this.lastError = msg.slice(0, 200);
        if (Date.now() - this.lastErrorAt > 3_600_000) {
          this.lastErrorAt = Date.now();
          (this.deps.onError ?? ((m: string) => console.error(`[telegram] ${m}`)))(this.lastError);
        }
        await sleep(15_000);
      }
    }
  }

  private async handle(u: TelegramUpdate, token: string, fetchImpl: typeof fetch): Promise<void> {
    const cfg = this.deps.getSettings().channels.telegram;
    const chatId = cfg.chatId;
    const api = (method: string, payload: Record<string, unknown>) =>
      fetchImpl(`${TELEGRAM_API_ORIGIN}/bot${encodeURIComponent(token)}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
        redirect: "error",
      }).catch(() => undefined);

    if (u.callback_query) {
      const q = u.callback_query;
      if (!sameChat(q.message?.chat.id, chatId)) return; // not our chat: silence
      const cmd = parseCommand(q.data ?? "");
      let line = "Unknown action.";
      if (cmd && cmd.type === "resolve") {
        const r = await this.deps.resolve(cmd.id, cmd.decision);
        line = r.message;
        this.handled++;
      }
      await api("answerCallbackQuery", { callback_query_id: q.id, text: line.slice(0, 200) });
      if (q.message) {
        // Replace the buttons with the outcome so a second tap cannot re-decide.
        await api("editMessageReplyMarkup", {
          chat_id: q.message.chat.id,
          message_id: q.message.message_id,
          reply_markup: { inline_keyboard: [] },
        });
        await api("sendMessage", {
          chat_id: q.message.chat.id,
          text: line.slice(0, 3500),
          reply_to_message_id: q.message.message_id,
        });
      }
      return;
    }
    if (u.message?.text) {
      if (!sameChat(u.message.chat.id, chatId)) return;
      const cmd = parseCommand(u.message.text);
      if (!cmd) return; // ordinary chatter is ignored
      let text: string;
      if (cmd.type === "help") text = HELP;
      else if (cmd.type === "pending") {
        const rows = this.deps.pending();
        text =
          rows.length === 0
            ? "Nothing waiting."
            : rows
                .map(
                  (r) => `• ${r.kind}: ${r.description.slice(0, 120)}\n  /approve ${r.id}  ·  /deny ${r.id}`,
                )
                .join("\n");
      } else {
        const r = await this.deps.resolve(cmd.id, cmd.decision);
        text = r.message;
        this.handled++;
      }
      await api("sendMessage", { chat_id: u.message.chat.id, text: text.slice(0, 3500) });
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
