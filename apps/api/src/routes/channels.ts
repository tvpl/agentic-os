import type { FastifyInstance } from "fastify";
import { formatNotification, sendTelegramMessage, telegramToken } from "@mordomo/core";
import type { AppContext } from "../context.js";

/**
 * External delivery channels (Onda 2, item 4). Today: Telegram.
 *
 * The endpoint exists because the failure modes are all invisible otherwise —
 * a token that is not in the environment, a chat id the bot was never added
 * to, a proxy that blocks the API. It answers `{ ok, error? }` and never
 * throws, so the Settings page can show the reason verbatim. The token itself
 * is read from `process.env` at send time and never returned.
 */
export function registerChannelRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Inbound poller health for the Settings card. */
  app.get("/api/channels/telegram/status", async () => {
    const p = ctx.telegramPoller;
    return {
      inbound: p?.enabled() ?? false,
      polling: p?.active ?? false,
      lastPollAt: p?.lastPollAt ?? 0,
      lastError: p?.lastError ?? null,
      handled: p?.handled ?? 0,
    };
  });

  app.post("/api/channels/telegram/test", async () => {
    const settings = ctx.settings();
    const cfg = settings.channels.telegram;
    const token = telegramToken(settings);
    if (!token) {
      return {
        ok: false,
        error: `No bot token: set ${cfg.botTokenEnv} in the environment of the MordomoOS service.`,
      };
    }
    if (!cfg.chatId) return { ok: false, error: "No chat id configured in Settings › Channels." };
    const result = await sendTelegramMessage({
      token,
      chatId: cfg.chatId,
      text: formatNotification(
        {
          id: "n_test",
          kind: "system",
          tone: "info",
          title: `${settings.systemName} test message`,
          body: "Telegram delivery is wired up. Alerts at or above your minimum tone will arrive here.",
          href: "/settings?tab=channels",
          approvalId: null,
          runId: null,
          ts: Date.now(),
          read: true,
          dedupeKey: null,
        },
        settings.port,
      ),
    });
    return result.ok ? { ok: true } : { ok: false, error: result.error ?? "Delivery failed." };
  });
}
