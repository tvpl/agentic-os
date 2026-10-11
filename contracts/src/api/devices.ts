/** Pairing and the paired devices, the persisted inbox, the delivery channels and the small owner-only writers. */
import { z } from "zod";
import { DEVICE_SCOPES } from "../devices.js";
import { OkSchema, UuidParams, err, notFound } from "./common.js";
import { route } from "./route.js";
import { DeviceRecordSchema, DeviceScopeSchema, NotificationRecordSchema } from "./wire.js";

const ScopesBody = z.array(z.enum(DEVICE_SCOPES)).max(DEVICE_SCOPES.length);

const notificationId = z.string().regex(/^n_[0-9a-f-]{8,64}$/i);

const PushSubscriptionRecordSchema = z.object({
  id: z.string(),
  endpoint: z.string(),
  deviceId: z.string().nullable(),
  label: z.string().nullable(),
  createdAt: z.number(),
  lastOkAt: z.number().nullable(),
  failures: z.number(),
});

const PushDeliverySchema = z.object({
  sent: z.number(),
  failed: z.number(),
  dropped: z.number(),
  skipped: z.enum(["disabled", "tone", "none"]).optional(),
});

const notConfigured = err(
  409,
  "channel_not_configured",
  "The channel is off, has no token or chat, or nobody subscribed",
);
const channelFailed = err(
  502,
  "channel_failed",
  "The service behind the channel refused the message or was unreachable",
);

export const deviceRoutes = {
  "pair.start": route({
    method: "POST",
    path: "/api/pair/start",
    summary: "Open a six-digit pairing code (ten minutes) and choose what the device may do",
    tag: "devices",
    scope: "owner",
    body: z.object({ name: z.string().max(80).optional(), scopes: ScopesBody.optional() }),
    bodyOptional: true,
    responses: {
      200: z.object({
        code: z.string(),
        expiresAt: z.number(),
        scopes: z.array(DeviceScopeSchema),
        remoteEnabled: z.boolean(),
        allowedHosts: z.array(z.string()),
        bindAddress: z.string(),
        port: z.number(),
      }),
    },
  }),
  "pair.claim": route({
    method: "POST",
    path: "/api/pair/claim",
    summary: "Claim a pairing code from the device; the one unauthenticated write of the API",
    tag: "devices",
    public: true,
    body: z.object({ code: z.string().regex(/^\d{6}$/), name: z.string().max(80).default("") }),
    bodyOptional: true,
    responses: { 200: z.object({ token: z.string(), device: DeviceRecordSchema }) },
    errors: [
      err(401, "pair_failed", "The code is wrong or expired"),
      err(403, "forbidden", "Remote access is off"),
      err(
        429,
        "too_many_requests",
        "Ten attempts a minute from one address; Retry-After says when to try again",
      ),
    ],
    headers: { "retry-after": "Seconds until the next attempt is counted (only on 429)" },
  }),
  "devices.list": route({
    method: "GET",
    path: "/api/devices",
    summary: "The paired devices and whether a pairing code is open",
    tag: "devices",
    scope: "owner",
    responses: { 200: z.object({ devices: z.array(DeviceRecordSchema), pairing: z.boolean() }) },
  }),
  "devices.update": route({
    method: "PATCH",
    path: "/api/devices/:id",
    summary: "Replace what a paired device may do; its next request is judged by the new set",
    tag: "devices",
    scope: "owner",
    params: UuidParams,
    body: z.object({ scopes: ScopesBody }),
    responses: { 200: DeviceRecordSchema },
    errors: [err(404, "not_found", "The device does not exist or was already revoked")],
  }),
  "devices.revoke": route({
    method: "DELETE",
    path: "/api/devices/:id",
    summary: "Revoke a paired device",
    tag: "devices",
    scope: "owner",
    params: UuidParams,
    responses: { 200: z.object({ revoked: z.literal(true) }) },
    errors: [err(404, "not_found", "The device does not exist or was already revoked")],
  }),

  // ---- the inbox
  "notifications.list": route({
    method: "GET",
    path: "/api/notifications",
    summary: "The persisted inbox, newest first, with the unread count",
    tag: "notifications",
    scope: "monitor",
    query: z.object({
      limit: z.coerce.number().int().min(1).max(500).default(200),
      unread: z.coerce.boolean().optional(),
    }),
    responses: { 200: z.object({ items: z.array(NotificationRecordSchema), unread: z.number() }) },
  }),
  "notifications.read": route({
    method: "POST",
    path: "/api/notifications/read",
    summary: "Mark rows read, by id or all of them",
    tag: "notifications",
    scope: "owner",
    body: z.object({ ids: z.array(notificationId).max(500).optional(), all: z.boolean().optional() }),
    bodyOptional: true,
    responses: { 200: z.object({ updated: z.number() }) },
    errors: [err(400, "bad_request", "Neither ids nor all: true was passed")],
  }),
  "notifications.delete": route({
    method: "DELETE",
    path: "/api/notifications/:id",
    summary: "Delete one inbox row",
    tag: "notifications",
    scope: "owner",
    params: z.object({ id: notificationId }),
    responses: { 200: z.object({ deleted: z.literal(true) }) },
    errors: [notFound("The notification")],
  }),

  // ---- web push
  "push.vapid": route({
    method: "GET",
    path: "/api/push/vapid",
    summary: "The VAPID public key a browser subscribes with, and whether push is on",
    tag: "push",
    scope: "monitor",
    responses: { 200: z.object({ publicKey: z.string(), enabled: z.boolean() }) },
  }),
  "push.subscribe": route({
    method: "POST",
    path: "/api/push/subscribe",
    summary: "Register a browser's push subscription (a device only at a browser's push service)",
    tag: "push",
    scope: "content",
    body: z.object({
      subscription: z.object({
        endpoint: z.string().url().max(2048),
        keys: z.object({ p256dh: z.string().min(80).max(120), auth: z.string().min(16).max(32) }),
        expirationTime: z.number().nullable().optional(),
      }),
      label: z.string().max(120).optional(),
    }),
    responses: { 200: PushSubscriptionRecordSchema },
    errors: [
      err(
        400,
        "invalid_push_endpoint",
        "The endpoint is not a public https push service the caller may name",
      ),
      err(409, "push_endpoint_taken", "The endpoint is registered by someone else"),
    ],
  }),
  "push.unsubscribe": route({
    method: "POST",
    path: "/api/push/unsubscribe",
    summary: "Remove a subscription by endpoint (a device removes only its own)",
    tag: "push",
    scope: "monitor",
    body: z.object({ endpoint: z.string().url().max(2048) }),
    responses: { 200: z.object({ removed: z.boolean() }) },
  }),
  "push.subscriptions": route({
    method: "GET",
    path: "/api/push/subscriptions",
    summary: "Every registered push subscription (endpoints, never keys)",
    tag: "push",
    scope: "owner",
    responses: { 200: z.array(PushSubscriptionRecordSchema) },
  }),
  "push.remove": route({
    method: "DELETE",
    path: "/api/push/subscriptions/:id",
    summary: "Remove one subscription",
    tag: "push",
    scope: "owner",
    params: z.object({ id: z.string().regex(/^ps_[0-9a-f-]{8,64}$/i) }),
    responses: { 200: z.object({ removed: z.literal(true) }) },
    errors: [notFound("The subscription")],
  }),
  "push.test": route({
    method: "POST",
    path: "/api/push/test",
    summary: "Send a test push to every subscription",
    tag: "push",
    scope: "owner",
    responses: { 200: PushDeliverySchema.extend({ ok: z.literal(true) }) },
    errors: [notConfigured, channelFailed],
  }),

  // ---- telegram
  "telegram.status": route({
    method: "GET",
    path: "/api/channels/telegram/status",
    summary: "Health of the Telegram inbound poller",
    tag: "channels",
    scope: "monitor",
    responses: {
      200: z.object({
        inbound: z.boolean(),
        polling: z.boolean(),
        lastPollAt: z.number(),
        lastError: z.string().nullable(),
        handled: z.number(),
      }),
    },
  }),
  "telegram.send": route({
    method: "POST",
    path: "/api/channels/telegram/send",
    summary: "Send one line to the configured chat",
    tag: "channels",
    scope: "owner",
    body: z.object({ text: z.string().min(1).max(4000) }),
    responses: { 200: OkSchema },
    errors: [notConfigured, channelFailed],
  }),
  "telegram.test": route({
    method: "POST",
    path: "/api/channels/telegram/test",
    summary: "Send a test message to the configured chat",
    tag: "channels",
    scope: "owner",
    responses: { 200: OkSchema },
    errors: [notConfigured, channelFailed],
  }),

  // ---- micro apps
  "microapps.pixelSave": route({
    method: "POST",
    path: "/api/microapps/pixel/save",
    summary: "Save a Pixel Studio drawing (a base64 PNG data URL) into artifacts/pixel-studio",
    tag: "microapps",
    scope: "owner",
    body: z.object({
      name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
      dataUrl: z.string(),
      spriteSheetDataUrl: z.string().optional(),
      frames: z.number().int().min(1).optional(),
    }),
    responses: { 200: z.object({ saved: z.array(z.string()) }) },
    errors: [
      err(400, "bad_request", "A data URL is not a base64 PNG, is empty or is larger than 2 MB"),
      err(403, "forbidden_path", "The destination is a link out of artifacts/ or a secret name"),
      err(413, "folder_too_large", "artifacts/ is full"),
    ],
  }),
} as const;
