import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { deliverPush } from "@mordomo/core";
import type { AppContext } from "../context.js";
import { httpError } from "./common.js";

/**
 * Web Push (the PWA hears about alerts while closed). The browser subscribes
 * with the VAPID public key, hands the subscription here, and from then on
 * inbox rows at or above `channels.push.minTone` arrive encrypted at the push
 * service. Subscriptions carry no identity beyond an optional label; a dead
 * endpoint (404/410) is dropped on the next send.
 */
const Subscription = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({ p256dh: z.string().min(80).max(120), auth: z.string().min(16).max(32) }),
  expirationTime: z.number().nullable().optional(),
});

export function registerPushRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/push/vapid", { config: { scope: "monitor" } }, async () => ({
    publicKey: ctx.push.vapidKeys().publicKey,
    enabled: ctx.settings().channels.push.enabled,
  }));

  app.post("/api/push/subscribe", { config: { scope: "monitor" } }, async (req) => {
    const body = z
      .object({ subscription: Subscription, label: z.string().max(120).optional() })
      .parse(req.body);
    return ctx.push.upsert(body.subscription, body.label ?? null);
  });

  app.post("/api/push/unsubscribe", { config: { scope: "monitor" } }, async (req) => {
    const { endpoint } = z.object({ endpoint: z.string().url().max(2048) }).parse(req.body ?? {});
    return { removed: ctx.push.removeByEndpoint(endpoint) };
  });

  app.get("/api/push/subscriptions", { config: { scope: "owner" } }, async () => ctx.push.list());

  app.delete("/api/push/subscriptions/:id", { config: { scope: "owner" } }, async (req) => {
    const { id } = z.object({ id: z.string().regex(/^ps_[0-9a-f-]{8,64}$/i) }).parse(req.params);
    if (!ctx.push.remove(id)) throw httpError(404, "Subscription not found");
    return { removed: true };
  });

  app.post("/api/push/test", { config: { scope: "owner" } }, async () => {
    const settings = ctx.settings();
    if (!settings.channels.push.enabled)
      throw httpError(409, "Push is off in Settings › Notifications.", "channel_not_configured");
    const r = await deliverPush(
      { getSettings: () => settings, store: ctx.push },
      {
        id: "n_test",
        kind: "system",
        tone: "danger",
        title: `${settings.systemName} test push`,
        body: "Push delivery is wired up. Alerts at or above your minimum tone arrive here even with the app closed.",
        href: "/settings?tab=notifications",
        approvalId: null,
        runId: null,
        ts: Date.now(),
        read: true,
        dedupeKey: "push-test",
      },
    );
    if (r.skipped === "none") throw httpError(409, "No device subscribed yet.", "channel_not_configured");
    if (r.sent === 0)
      throw httpError(502, `Sent to nobody (${r.failed} failed, ${r.dropped} dropped).`, "channel_failed");
    return { ok: true, ...r };
  });
}
