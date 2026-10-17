import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { bind } from "../contract.js";
import { SlidingWindow } from "../rateLimit.js";
import { httpError } from "./common.js";

/**
 * Pairing and paired devices (plan Onda 3 §1). Starting a pairing needs the
 * local token (you are at the desk); claiming needs only the six-digit code
 * (you are on the phone) and is the one unauthenticated write in the API —
 * five wrong attempts burn the code, a code lives ten minutes, and one
 * address gets ten attempts a minute (`429 too_many_requests`). What a device
 * may do is chosen when the code is shown and changed later by the owner
 * (`PATCH /api/devices/:id`); the set is closed (`closeDeviceScopes`).
 */
export function registerDeviceRoutes(app: FastifyInstance, ctx: AppContext): void {
  const claims = new SlidingWindow(10, 60_000);

  bind(app, "pair.start", async ({ body }) => {
    const pairing = ctx.devices.startPairing(body.name ?? null, body.scopes);
    const settings = ctx.settings();
    return {
      ...pairing,
      remoteEnabled: settings.remote.enabled,
      allowedHosts: settings.remote.allowedHosts,
      bindAddress: settings.bindAddress,
      port: ctx.servicePort(),
    };
  });

  bind(
    app,
    "pair.claim",
    async ({ body }) => {
      const settings = ctx.settings();
      if (!settings.remote.enabled) throw httpError(403, "Remote access is off");
      const ttlMs = settings.remote.deviceTtlDays * 86_400_000;
      const claimed = ctx.devices.claim(body.code, body.name, ttlMs);
      if (!claimed) throw httpError(401, "Wrong or expired code", "pair_failed");
      return { token: claimed.token, device: claimed.device };
    },
    {
      // Counted before anything of the request is read, the body included: a guesser learns nothing past the limit.
      preHandler: async (req, reply) => {
        const wait = claims.retryAfter(req.ip);
        if (wait > 0) {
          reply.header("Retry-After", String(wait));
          throw httpError(
            429,
            "Too many pairing attempts from this address; try again later",
            "too_many_requests",
          );
        }
        claims.hit(req.ip);
      },
    },
  );

  bind(app, "devices.list", async () => ({
    devices: ctx.devices.list(),
    pairing: ctx.devices.pairingOpen() !== null,
  }));

  /** Replace what a paired device may do; its next request is judged by the new set. */
  bind(app, "devices.update", async ({ params: { id }, body: { scopes } }) => {
    const device = ctx.devices.setScopes(id, scopes);
    if (!device) throw httpError(404, "Device not found or already revoked");
    return device;
  });

  bind(app, "devices.revoke", async ({ params: { id } }) => {
    if (!ctx.devices.revoke(id)) throw httpError(404, "Device not found or already revoked");
    return { revoked: true as const };
  });
}
