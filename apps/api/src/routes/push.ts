import type { FastifyInstance } from "fastify";
import { checkPushEndpoint, deliverPush } from "@mordomo/core/internal";
import type { AppContext } from "../context.js";
import { bind } from "../contract.js";
import { httpError } from "./common.js";

/**
 * Web Push (the PWA hears about alerts while closed). The browser subscribes
 * with the VAPID public key, hands the subscription here, and from then on
 * inbox rows at or above `channels.push.minTone` arrive encrypted at the push
 * service. A dead endpoint (404/410) is dropped on the next send.
 *
 * An endpoint is a URL the server POSTs to with its own VAPID credential, so who may name one matters
 * (.specs/features/escopos-dispositivo, round 1): the owner any public https endpoint (a self-hosted push server
 * included), a paired device only the push services of browsers, and only with `content` (what a push carries are
 * the inbox's titles and bodies). Both are checked by address, name and DNS (`checkPushEndpoint`), and again at send
 * time. A subscription a device registers is its own: it alone removes it, it is deleted when the device is revoked
 * or loses `content`, and it never replaces the keys of one that someone else registered.
 */
export function registerPushRoutes(app: FastifyInstance, ctx: AppContext): void {
  bind(app, "push.vapid", async () => ({
    publicKey: ctx.push.vapidKeys().publicKey,
    enabled: ctx.settings().channels.push.enabled,
  }));

  bind(app, "push.subscribe", async ({ body }, req) => {
    const deviceId = req.principal?.kind === "device" ? req.principal.deviceId : null;
    const problem = await checkPushEndpoint(body.subscription.endpoint, ctx.pushResolver, {
      knownServicesOnly: deviceId !== null,
    });
    if (problem) throw httpError(400, problem, "invalid_push_endpoint");
    const holder = ctx.push.ownerOf(body.subscription.endpoint);
    if (deviceId !== null && holder !== undefined && holder !== deviceId) {
      throw httpError(409, "That endpoint is registered by someone else.", "push_endpoint_taken");
    }
    return ctx.push.upsert(body.subscription, body.label ?? null, deviceId);
  });

  bind(app, "push.unsubscribe", async ({ body: { endpoint } }, req) => {
    const deviceId = req.principal?.kind === "device" ? req.principal.deviceId : undefined;
    return { removed: ctx.push.removeByEndpoint(endpoint, deviceId) };
  });

  bind(app, "push.subscriptions", async () => ctx.push.list());

  bind(app, "push.remove", async ({ params: { id } }) => {
    if (!ctx.push.remove(id)) throw httpError(404, "Subscription not found");
    return { removed: true as const };
  });

  bind(app, "push.test", async () => {
    const settings = ctx.settings();
    if (!settings.channels.push.enabled)
      throw httpError(409, "Push is off in Settings › Notifications.", "channel_not_configured");
    const r = await deliverPush(
      { getSettings: () => settings, store: ctx.push, resolveHost: ctx.pushResolver },
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
    return { ok: true as const, ...r };
  });
}
