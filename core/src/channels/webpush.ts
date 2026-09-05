import crypto from "node:crypto";

/**
 * Web Push without dependencies: VAPID (RFC 8292) signed with ES256 and the
 * `aes128gcm` content encoding of RFC 8291 / RFC 8188, on top of node:crypto.
 *
 * The keys are generated once per installation and kept in
 * `config/vapid.json` (0600). A subscription is the JSON the browser's
 * `PushManager.subscribe()` returns: an endpoint at the browser vendor's push
 * service plus the receiver's P-256 public key and 16-byte auth secret.
 * The push service only ever sees ciphertext; the payload is readable solely
 * by the browser that subscribed.
 */

export interface VapidKeys {
  /** base64url, 65-byte uncompressed P-256 point. */
  publicKey: string;
  /** base64url, 32-byte scalar. */
  privateKey: string;
}

export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
}

export const b64url = {
  encode(buf: Uint8Array | Buffer): string {
    return Buffer.from(buf).toString("base64url");
  },
  decode(s: string): Buffer {
    return Buffer.from(s, "base64url");
  },
};

/** Raw 65-byte public point + 32-byte private scalar of a fresh P-256 pair. */
export function generateVapidKeys(): VapidKeys {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: b64url.encode(ecdh.getPublicKey()),
    privateKey: b64url.encode(ecdh.getPrivateKey()),
  };
}

function privateKeyObject(keys: VapidKeys): crypto.KeyObject {
  const pub = b64url.decode(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 0x04)
    throw new Error("VAPID public key must be an uncompressed P-256 point");
  return crypto.createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: b64url.encode(pub.subarray(1, 33)),
      y: b64url.encode(pub.subarray(33, 65)),
      d: keys.privateKey,
    },
    format: "jwk",
  });
}

export function publicKeyObject(publicKey: string): crypto.KeyObject {
  const pub = b64url.decode(publicKey);
  return crypto.createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: b64url.encode(pub.subarray(1, 33)),
      y: b64url.encode(pub.subarray(33, 65)),
    },
    format: "jwk",
  });
}

/**
 * The VAPID JWT: `aud` is the push service origin, `sub` a mailto: or https:
 * contact, `exp` at most 24 h ahead (12 h here). ES256 with the IEEE P1363
 * (r‖s) signature JOSE expects.
 */
export function vapidAuthorization(
  endpoint: string,
  subject: string,
  keys: VapidKeys,
  now = Date.now(),
): string {
  const aud = new URL(endpoint).origin;
  const header = b64url.encode(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64url.encode(
    Buffer.from(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })),
  );
  const signingInput = `${header}.${payload}`;
  const sig = crypto.sign("sha256", Buffer.from(signingInput), {
    key: privateKeyObject(keys),
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${signingInput}.${b64url.encode(sig)}, k=${keys.publicKey}`;
}

/** Verify a token produced by `vapidAuthorization` (used by the tests and by nobody else). */
export function verifyVapidToken(
  token: string,
  publicKey: string,
): { aud: string; sub: string; exp: number } | null {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  const ok = crypto.verify(
    "sha256",
    Buffer.from(`${h}.${p}`),
    { key: publicKeyObject(publicKey), dsaEncoding: "ieee-p1363" },
    b64url.decode(s),
  );
  if (!ok) return null;
  return JSON.parse(b64url.decode(p).toString("utf8")) as { aud: string; sub: string; exp: number };
}

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, length));
}

export interface EncryptOptions {
  /** Test hook: fixed 16-byte salt (random otherwise). */
  salt?: Buffer;
  /** Test hook: fixed application-server ephemeral pair (random otherwise). */
  localKeys?: VapidKeys;
  /** Record size (default 4096, the common value push services accept). */
  recordSize?: number;
}

/**
 * RFC 8291 encryption of one payload for one subscription. Output is the
 * whole `aes128gcm` body: header (salt, rs, key id = the ephemeral public
 * key) followed by a single record with the 0x02 delimiter.
 */
export function encryptPayload(
  sub: PushSubscriptionJson,
  plaintext: Buffer,
  opts: EncryptOptions = {},
): Buffer {
  const uaPublic = b64url.decode(sub.keys.p256dh);
  const authSecret = b64url.decode(sub.keys.auth);
  if (uaPublic.length !== 65) throw new Error("p256dh must be a 65-byte uncompressed point");
  if (authSecret.length !== 16) throw new Error("auth must be 16 bytes");
  const rs = opts.recordSize ?? 4096;
  if (plaintext.length + 1 > rs - 16) throw new Error(`Payload too large (max ${rs - 17} bytes)`);

  const ecdh = crypto.createECDH("prime256v1");
  if (opts.localKeys) ecdh.setPrivateKey(b64url.decode(opts.localKeys.privateKey));
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = opts.salt ?? crypto.randomBytes(16);

  // IKM = HKDF(auth, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = hkdf(authSecret, shared, keyInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);

  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const record = Buffer.concat([plaintext, Buffer.from([0x02])]);
  const body = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(16 + 4 + 1 + 65);
  salt.copy(header, 0);
  header.writeUInt32BE(rs, 16);
  header[20] = 65;
  asPublic.copy(header, 21);
  return Buffer.concat([header, body]);
}

/** The receiver side, for tests: decrypt an `aes128gcm` body with the browser's private key. */
export function decryptPayload(body: Buffer, uaPrivate: string, uaPublic: string, auth: string): Buffer {
  const salt = body.subarray(0, 16);
  const idlen = body[20]!;
  const asPublic = body.subarray(21, 21 + idlen);
  const cipherText = body.subarray(21 + idlen);
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(b64url.decode(uaPrivate));
  const shared = ecdh.computeSecret(asPublic);
  const ua = b64url.decode(uaPublic);
  const ikm = hkdf(
    b64url.decode(auth),
    shared,
    Buffer.concat([Buffer.from("WebPush: info\0"), ua, asPublic]),
    32,
  );
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const decipher = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(cipherText.subarray(cipherText.length - 16));
  const record = Buffer.concat([
    decipher.update(cipherText.subarray(0, cipherText.length - 16)),
    decipher.final(),
  ]);
  const delim = record.lastIndexOf(0x02);
  return record.subarray(0, delim);
}

export interface PushSendOptions {
  keys: VapidKeys;
  /** `mailto:` or `https:` contact the push service may use to reach the operator. */
  subject: string;
  ttlSeconds?: number;
  urgency?: "very-low" | "low" | "normal" | "high";
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface PushSendResult {
  ok: boolean;
  status: number;
  /** 404 / 410: the subscription is dead and must be dropped. */
  gone: boolean;
  error?: string;
}

/** Encrypt and POST one payload. Never throws. */
export async function sendWebPush(
  sub: PushSubscriptionJson,
  payload: Record<string, unknown>,
  opts: PushSendOptions,
): Promise<PushSendResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    const body = encryptPayload(sub, Buffer.from(JSON.stringify(payload)));
    const res = await fetchImpl(sub.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "content-encoding": "aes128gcm",
        "content-length": String(body.length),
        ttl: String(opts.ttlSeconds ?? 86_400),
        urgency: opts.urgency ?? "normal",
        authorization: vapidAuthorization(sub.endpoint, opts.subject, opts.keys),
      },
      body,
      signal: controller.signal,
      redirect: "error",
    });
    const gone = res.status === 404 || res.status === 410;
    return res.ok
      ? { ok: true, status: res.status, gone: false }
      : { ok: false, status: res.status, gone, error: `Push service responded ${res.status}.` };
  } catch (err) {
    const reason = (err as Error).name === "AbortError" ? "Timed out." : (err as Error).message;
    return { ok: false, status: 0, gone: false, error: reason.slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}
