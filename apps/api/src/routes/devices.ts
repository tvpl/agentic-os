import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { DEVICE_SCOPES } from "@mordomo/core";
import type { AppContext } from "../context.js";
import { SlidingWindow } from "../rateLimit.js";
import { httpError } from "./common.js";
import { UuidParams } from "./params.js";

/**
 * Pairing and paired devices (plan Onda 3 §1). Starting a pairing needs the
 * local token (you are at the desk); claiming needs only the six-digit code
 * (you are on the phone) and is the one unauthenticated write in the API —
 * five wrong attempts burn the code, a code lives ten minutes, and one
 * address gets ten attempts a minute (`429 too_many_requests`). What a device
 * may do is chosen when the code is shown and changed later by the owner
 * (`PATCH /api/devices/:id`); the set is closed (`closeDeviceScopes`).
 */
const ScopesBody = z.array(z.enum(DEVICE_SCOPES)).max(DEVICE_SCOPES.length);

export function registerDeviceRoutes(app: FastifyInstance, ctx: AppContext): void {
  const claims = new SlidingWindow(10, 60_000);

  app.post("/api/pair/start", { config: { scope: "owner" } }, async (req) => {
    const body = z
      .object({ name: z.string().max(80).optional(), scopes: ScopesBody.optional() })
      .parse(req.body ?? {});
    const pairing = ctx.devices.startPairing(body.name ?? null, body.scopes);
    const settings = ctx.settings();
    return {
      ...pairing,
      remoteEnabled: settings.remote.enabled,
      allowedHosts: settings.remote.allowedHosts,
      bindAddress: settings.bindAddress,
      port: settings.port,
    };
  });

  app.post("/api/pair/claim", { config: { public: true } }, async (req, reply) => {
    // Counted before the code is even read: a guesser learns nothing past the limit.
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
    const body = z
      .object({ code: z.string().regex(/^\d{6}$/), name: z.string().max(80).default("") })
      .parse(req.body ?? {});
    const settings = ctx.settings();
    if (!settings.remote.enabled) throw httpError(403, "Remote access is off");
    const ttlMs = settings.remote.deviceTtlDays * 86_400_000;
    const claimed = ctx.devices.claim(body.code, body.name, ttlMs);
    if (!claimed) throw httpError(401, "Wrong or expired code", "pair_failed");
    return { token: claimed.token, device: claimed.device };
  });

  app.get("/api/devices", { config: { scope: "owner" } }, async () => ({
    devices: ctx.devices.list(),
    pairing: ctx.devices.pairingOpen() !== null,
  }));

  /** Replace what a paired device may do; its next request is judged by the new set. */
  app.patch("/api/devices/:id", { config: { scope: "owner" } }, async (req) => {
    const { id } = UuidParams.parse(req.params);
    const { scopes } = z.object({ scopes: ScopesBody }).parse(req.body ?? {});
    const device = ctx.devices.setScopes(id, scopes);
    if (!device) throw httpError(404, "Device not found or already revoked");
    return device;
  });

  app.delete("/api/devices/:id", { config: { scope: "owner" } }, async (req) => {
    const { id } = UuidParams.parse(req.params);
    if (!ctx.devices.revoke(id)) throw httpError(404, "Device not found or already revoked");
    return { revoked: true };
  });
}
