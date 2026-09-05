import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import {
  b64url,
  decryptPayload,
  encryptPayload,
  generateVapidKeys,
  sendWebPush,
  vapidAuthorization,
  verifyVapidToken,
} from "../core/src/channels/webpush.js";

/** RFC 8291 Appendix A: the one worked example every Web Push library must reproduce byte for byte. */
const RFC = {
  plaintext: "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

describe("web push encryption", () => {
  it("reproduces the RFC 8291 example exactly", () => {
    const out = encryptPayload(
      { endpoint: "https://push.example.net/x", keys: { p256dh: RFC.uaPublic, auth: RFC.auth } },
      b64url.decode(RFC.plaintext),
      { salt: b64url.decode(RFC.salt), localKeys: { publicKey: RFC.asPublic, privateKey: RFC.asPrivate } },
    );
    expect(b64url.encode(out)).toBe(RFC.body);
  });

  it("round-trips a random payload through the receiver side", () => {
    const ua = crypto.createECDH("prime256v1");
    ua.generateKeys();
    const auth = b64url.encode(crypto.randomBytes(16));
    const sub = {
      endpoint: "https://push.example.net/x",
      keys: { p256dh: b64url.encode(ua.getPublicKey()), auth },
    };
    const msg = Buffer.from(JSON.stringify({ title: "Olá", body: "ação ✓".repeat(40) }));
    const body = encryptPayload(sub, msg);
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(body[20]).toBe(65);
    const back = decryptPayload(body, b64url.encode(ua.getPrivateKey()), sub.keys.p256dh, auth);
    expect(back.equals(msg)).toBe(true);
  });

  it("refuses malformed subscriptions and oversized payloads", () => {
    const ua = crypto.createECDH("prime256v1");
    ua.generateKeys();
    const good = {
      endpoint: "https://p/x",
      keys: { p256dh: b64url.encode(ua.getPublicKey()), auth: b64url.encode(crypto.randomBytes(16)) },
    };
    expect(() => encryptPayload({ ...good, keys: { ...good.keys, auth: "AAAA" } }, Buffer.from("x"))).toThrow(
      /auth/,
    );
    expect(() => encryptPayload(good, Buffer.alloc(5000))).toThrow(/too large/);
  });
});

describe("VAPID", () => {
  it("signs a JWT the public key verifies, scoped to the push service origin", () => {
    const keys = generateVapidKeys();
    expect(b64url.decode(keys.publicKey).length).toBe(65);
    const header = vapidAuthorization(
      "https://fcm.googleapis.com/fcm/send/abc",
      "mailto:me@example.com",
      keys,
      1_800_000_000_000,
    );
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    expect(m).not.toBeNull();
    expect(m![2]).toBe(keys.publicKey);
    const claims = verifyVapidToken(m![1]!, keys.publicKey);
    expect(claims).toEqual({
      aud: "https://fcm.googleapis.com",
      sub: "mailto:me@example.com",
      exp: 1_800_000_000 + 12 * 3600,
    });
    const other = generateVapidKeys();
    expect(verifyVapidToken(m![1]!, other.publicKey)).toBeNull();
  });

  it("posts ciphertext with the aes128gcm headers and reports dead subscriptions", async () => {
    const ua = crypto.createECDH("prime256v1");
    ua.generateKeys();
    const sub = {
      endpoint: "https://push.example.net/sub/1",
      keys: { p256dh: b64url.encode(ua.getPublicKey()), auth: b64url.encode(crypto.randomBytes(16)) },
    };
    const keys = generateVapidKeys();
    let seen: { url: string; headers: Record<string, string>; body: Buffer } | null = null;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      seen = {
        url: String(url),
        headers: init!.headers as Record<string, string>,
        body: init!.body as Buffer,
      };
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const res = await sendWebPush(
      sub,
      { title: "hi" },
      { keys, subject: "mailto:me@example.com", fetchImpl },
    );
    expect(res).toEqual({ ok: true, status: 201, gone: false });
    expect(seen!.headers["content-encoding"]).toBe("aes128gcm");
    expect(seen!.headers.authorization.startsWith("vapid t=")).toBe(true);
    expect(seen!.body.length).toBeGreaterThan(86);
    const gone = await sendWebPush(
      sub,
      { title: "hi" },
      {
        keys,
        subject: "mailto:me@example.com",
        fetchImpl: (async () => new Response(null, { status: 410 })) as unknown as typeof fetch,
      },
    );
    expect(gone.gone).toBe(true);
    expect(gone.ok).toBe(false);
  });
});
