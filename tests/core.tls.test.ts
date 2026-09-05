import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import {
  certificateHosts,
  createSelfSignedCertificate,
  ensureTlsMaterial,
} from "../core/src/security/tls.js";

describe("self-signed TLS material", () => {
  it("encodes a certificate node parses, names every host and verifies with its own key", () => {
    const m = createSelfSignedCertificate({ hosts: ["mordomo.test:4777", "192.168.1.20", "Studio.local"] });
    const cert = new crypto.X509Certificate(m.certPem);
    expect(cert.subject).toContain("CN=mordomo.test");
    expect(cert.subjectAltName).toContain("DNS:mordomo.test");
    expect(cert.subjectAltName).toContain("DNS:studio.local");
    expect(cert.subjectAltName).toContain("IP Address:192.168.1.20");
    expect(cert.subjectAltName).toContain("IP Address:127.0.0.1");
    expect(cert.checkHost("mordomo.test")).toBe("mordomo.test");
    expect(cert.checkIP("192.168.1.20")).toBe("192.168.1.20");
    expect(cert.checkHost("evil.test")).toBeUndefined();
    expect(cert.verify(cert.publicKey)).toBe(true);
    expect(cert.ca).toBe(false);
    expect(cert.fingerprint256).toBe(m.fingerprint);
    expect(new Date(cert.validTo).getTime()).toBeGreaterThan(Date.now() + 3000 * 86_400_000);
    const key = crypto.createPrivateKey(m.keyPem);
    expect(cert.checkPrivateKey(key)).toBe(true);
    expect(certificateHosts(["[::1]:4777", "Host.Example:1"])).toEqual([
      "localhost",
      "127.0.0.1",
      "::1",
      "host.example",
    ]);
  });

  it("serves https that a client trusting the certificate accepts", async () => {
    const m = createSelfSignedCertificate({ hosts: ["localhost"] });
    const server = https.createServer({ key: m.keyPem, cert: m.certPem }, (_req, res) => res.end("ok"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    try {
      const body = await new Promise<string>((resolve, reject) => {
        https
          .get({ host: "localhost", port, path: "/", ca: m.certPem, servername: "localhost" }, (res) => {
            let data = "";
            res.on("data", (c: Buffer) => (data += c.toString()));
            res.on("end", () => resolve(data));
          })
          .on("error", reject);
      });
      expect(body).toBe("ok");
      // Without the CA the same client refuses it: that is the self-signed trade-off.
      await expect(
        new Promise((resolve, reject) =>
          https.get({ host: "localhost", port, path: "/" }, resolve).on("error", reject),
        ),
      ).rejects.toThrow(/self[- ]signed|SELF_SIGNED/i);
    } finally {
      server.close();
    }
  });

  it("keeps the files until the hosts change", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-tls-"));
    const a = ensureTlsMaterial(dir, ["a.test"]);
    const b = ensureTlsMaterial(dir, ["a.test:4777"]);
    expect(b.fingerprint).toBe(a.fingerprint);
    if (process.platform !== "win32")
      expect(fs.statSync(path.join(dir, "tls", "key.pem")).mode & 0o777).toBe(0o600);
    const c = ensureTlsMaterial(dir, ["a.test", "b.test"]);
    expect(c.fingerprint).not.toBe(a.fingerprint);
    expect(c.hosts).toContain("b.test");
  });
});
