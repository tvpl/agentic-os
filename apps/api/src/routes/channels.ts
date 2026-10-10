import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { formatNotification, sendTelegramMessage, telegramToken, type Settings } from "@mordomo/core";
import type { AppContext } from "../context.js";
import { httpError } from "./common.js";

/**
 * External delivery channels (Onda 2, item 4). Today: Telegram.
 *
 * The endpoint exists because the failure modes are all invisible otherwise —
 * a token that is not in the environment, a chat id the bot was never added
 * to, a proxy that blocks the API. A send answers `{ ok: true }`, or an error
 * envelope whose message the Settings page shows verbatim: `409
 * channel_not_configured` (no token or no chat) and `502 channel_failed`
 * (Telegram refused or was unreachable). The token itself is read from
 * `process.env` at send time and never returned.
 */
export function registerChannelRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Inbound poller health for the Settings card. */
  app.get("/api/channels/telegram/status", { config: { scope: "monitor" } }, async () => {
    const p = ctx.telegramPoller;
    return {
      inbound: p?.enabled() ?? false,
      polling: p?.active ?? false,
      lastPollAt: p?.lastPollAt ?? 0,
      lastError: p?.lastError ?? null,
      handled: p?.handled ?? 0,
    };
  });

  /** Send one line to the configured chat (refino item 45: an artifact or a reply, on demand). */
  app.post("/api/channels/telegram/send", { config: { scope: "owner" } }, async (req) => {
    const body = z.object({ text: z.string().min(1).max(4000) }).parse(req.body);
    const settings = ctx.settings();
    const cfg = settings.channels.telegram;
    const token = telegramDestination(settings);
    return delivered(await sendTelegramMessage({ token, chatId: cfg.chatId, text: body.text }));
  });

  app.post("/api/channels/telegram/test", { config: { scope: "owner" } }, async () => {
    const settings = ctx.settings();
    const cfg = settings.channels.telegram;
    const token = telegramDestination(settings);
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
    return delivered(result);
  });
}

/** The bot token, or `409 channel_not_configured` when the token or the chat is missing. */
function telegramDestination(settings: Settings): string {
  const cfg = settings.channels.telegram;
  const token = telegramToken(settings);
  if (!token)
    throw httpError(
      409,
      `No bot token: set ${cfg.botTokenEnv} in the environment of the MordomoOS service.`,
      "channel_not_configured",
    );
  if (!cfg.chatId)
    throw httpError(409, "No chat id configured in Settings › Channels.", "channel_not_configured");
  return token;
}

/** `{ ok: true }`, or `502 channel_failed` carrying Telegram's reason. */
function delivered(result: { ok: boolean; error?: string }): { ok: true } {
  if (!result.ok) throw httpError(502, result.error ?? "Delivery failed.", "channel_failed");
  return { ok: true };
}
