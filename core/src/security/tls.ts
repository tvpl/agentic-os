import crypto from "node:crypto";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";

/**
 * Self-signed TLS for remote access (plan follow-up 10), without a dependency:
 * a P-256 key and an X.509 v3 certificate are DER-encoded here and signed
 * with ECDSA/SHA-256 through node:crypto. The certificate names every host
 * the server answers to (Subject Alternative Names), lasts ten years and is
 * regenerated when the host list changes. The pairing screen shows its
 * SHA-256 fingerprint so a phone can check what it is trusting.
 */

export interface TlsMaterial {
  keyPem: string;
  certPem: string;
  /** SHA-256 of the DER certificate, colon-separated upper-case hex. */
  fingerprint: string;
  hosts: string[];
  notAfter: number;
}

/* ---------------------------------------------------------------- ASN.1 -- */

function len(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), len(content.length), content]);
}

const seq = (...parts: Buffer[]) => tlv(0x30, Buffer.concat(parts));
const set = (...parts: Buffer[]) => tlv(0x31, Buffer.concat(parts));
const octets = (b: Buffer) => tlv(0x04, b);
const bitString = (b: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
const bool = (v: boolean) => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));
const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, "utf8"));
const ctxExplicit = (n: number, b: Buffer) => tlv(0xa0 | n, b);
const ctxImplicit = (n: number, b: Buffer) => tlv(0x80 | n, b);

function integer(b: Buffer): Buffer {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0 && (b[i + 1]! & 0x80) === 0) i++;
  let body = b.subarray(i);
  if (body[0]! & 0x80) body = Buffer.concat([Buffer.from([0]), body]);
  return tlv(0x02, body);
}

function oid(dotted: string): Buffer {
  const parts = dotted.split(".").map(Number);
  const out: number[] = [parts[0]! * 40 + parts[1]!];
  for (const p of parts.slice(2)) {
    const stack: number[] = [];
    let v = p;
    do {
      stack.unshift(v & 0x7f);
      v >>= 7;
    } while (v > 0);
    for (let k = 0; k < stack.length - 1; k++) stack[k]! |= 0x80;
    out.push(...stack);
  }
  return tlv(0x06, Buffer.from(out));
}

function utcTime(d: Date): Buffer {
  const p = (n: number) => String(n).padStart(2, "0");
  const s = `${String(d.getUTCFullYear()).slice(2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return tlv(0x17, Buffer.from(s, "ascii"));
}

const OID = {
  ecdsaWithSha256: "1.2.840.10045.4.3.2",
  commonName: "2.5.4.3",
  organization: "2.5.4.10",
  subjectAltName: "2.5.29.17",
  basicConstraints: "2.5.29.19",
  keyUsage: "2.5.29.15",
  extKeyUsage: "2.5.29.37",
  serverAuth: "1.3.6.1.5.5.7.3.1",
};

function name(cn: string, org: string): Buffer {
  return seq(set(seq(oid(OID.organization), utf8(org))), set(seq(oid(OID.commonName), utf8(cn))));
}

function isIp(host: string): boolean {
  return net.isIP(host) !== 0;
}

function ipBytes(host: string): Buffer | null {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return Buffer.from(host.split(".").map(Number));
  if (host.includes(":")) {
    // IPv6: expand "::" and parse eight groups.
    const [head, tail = ""] = host.split("::");
    const hs = head ? head.split(":") : [];
    const ts = tail ? tail.split(":") : [];
    const groups = [...hs, ...Array(8 - hs.length - ts.length).fill("0"), ...ts];
    if (groups.length !== 8) return null;
    const out = Buffer.alloc(16);
    groups.forEach((g, i) => out.writeUInt16BE(parseInt(g || "0", 16), i * 2));
    return out;
  }
  return null;
}

function extension(id: string, critical: boolean, value: Buffer): Buffer {
  return critical ? seq(oid(id), bool(true), octets(value)) : seq(oid(id), octets(value));
}

/** Host names and IPs that go into the certificate: always loopback, then what the server answers to. */
export function certificateHosts(extra: readonly string[]): string[] {
  const out = new Set<string>(["localhost", "127.0.0.1", "::1"]);
  for (const raw of extra) {
    let host = raw.trim().toLowerCase();
    const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(host);
    if (bracket)
      host = bracket[1]!; // [::1]:4777 → ::1
    else if ((host.match(/:/g) ?? []).length === 1) host = host.split(":")[0]!; // name:port → name
    // Anything with several colons is a bare IPv6 address: kept as is.
    if (host && /^[a-z0-9.:-]+$/.test(host)) out.add(host);
  }
  return [...out];
}

export interface CertOptions {
  hosts: readonly string[];
  commonName?: string;
  organization?: string;
  days?: number;
  now?: Date;
}

/** Generate a fresh P-256 key and a self-signed certificate for `hosts`. */
export function createSelfSignedCertificate(opts: CertOptions): TlsMaterial {
  const hosts = certificateHosts(opts.hosts);
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const now = opts.now ?? new Date();
  const notBefore = new Date(now.getTime() - 60_000);
  const notAfter = new Date(now.getTime() + (opts.days ?? 3650) * 86_400_000);
  const cn = opts.commonName ?? hosts.find((h) => !isIp(h) && h !== "localhost") ?? "localhost";
  const org = opts.organization ?? "MordomoOS";
  const serial = crypto.randomBytes(16);
  serial[0] = serial[0]! & 0x7f; // positive

  const san = seq(
    ...hosts.map((h) => {
      const ip = isIp(h) ? ipBytes(h) : null;
      return ip ? ctxImplicit(7, ip) : ctxImplicit(2, Buffer.from(h, "ascii"));
    }),
  );
  const extensions = ctxExplicit(
    3,
    seq(
      extension(OID.basicConstraints, true, seq()), // CA:FALSE (default omitted)
      extension(OID.keyUsage, true, tlv(0x03, Buffer.from([0x07, 0x80]))), // digitalSignature
      extension(OID.extKeyUsage, false, seq(oid(OID.serverAuth))),
      extension(OID.subjectAltName, false, san),
    ),
  );
  const algId = seq(oid(OID.ecdsaWithSha256));
  const tbs = seq(
    ctxExplicit(0, integer(Buffer.from([2]))), // v3
    integer(serial),
    algId,
    name(cn, org),
    seq(utcTime(notBefore), utcTime(notAfter)),
    name(cn, org),
    spki,
    extensions,
  );
  const signature = crypto.sign("sha256", tbs, { key: privateKey, dsaEncoding: "der" });
  const cert = seq(tbs, algId, bitString(signature));
  const certPem = `-----BEGIN CERTIFICATE-----\n${cert
    .toString("base64")
    .match(/.{1,64}/g)!
    .join("\n")}\n-----END CERTIFICATE-----\n`;
  const keyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  return { keyPem, certPem, fingerprint: fingerprintOf(cert), hosts, notAfter: notAfter.getTime() };
}

export function fingerprintOf(der: Buffer): string {
  return crypto.createHash("sha256").update(der).digest("hex").toUpperCase().match(/.{2}/g)!.join(":");
}

/**
 * The certificate on disk (`config/tls/`), created on first use and replaced
 * when the host list changed or it is within 30 days of expiry.
 */
export function ensureTlsMaterial(
  configDir: string,
  hosts: readonly string[],
  now = Date.now(),
): TlsMaterial {
  const dir = path.join(configDir, "tls");
  const keyFile = path.join(dir, "key.pem");
  const certFile = path.join(dir, "cert.pem");
  const metaFile = path.join(dir, "meta.json");
  const wanted = certificateHosts(hosts);
  if (fs.existsSync(keyFile) && fs.existsSync(certFile) && fs.existsSync(metaFile)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, "utf8")) as {
        hosts: string[];
        notAfter: number;
        fingerprint: string;
      };
      const same = meta.hosts.length === wanted.length && meta.hosts.every((h) => wanted.includes(h));
      if (same && meta.notAfter - now > 30 * 86_400_000) {
        return {
          keyPem: fs.readFileSync(keyFile, "utf8"),
          certPem: fs.readFileSync(certFile, "utf8"),
          fingerprint: meta.fingerprint,
          hosts: meta.hosts,
          notAfter: meta.notAfter,
        };
      }
    } catch {
      /* regenerate below */
    }
  }
  const material = createSelfSignedCertificate({ hosts: wanted, now: new Date(now) });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyFile, material.keyPem, { mode: 0o600 });
  fs.writeFileSync(certFile, material.certPem, { mode: 0o644 });
  fs.writeFileSync(
    metaFile,
    JSON.stringify(
      { hosts: material.hosts, notAfter: material.notAfter, fingerprint: material.fingerprint },
      null,
      2,
    ),
  );
  return material;
}
