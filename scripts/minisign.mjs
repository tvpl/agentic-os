/**
 * Verifying a minisign signature (the format `tauri signer` writes and `tauri-plugin-updater` checks) without any
 * package: Ed25519 over the BLAKE2b-512 of the file (`ED`, what Tauri writes) or over the file itself (`Ed`, legacy),
 * and over the signature and the trusted comment (the "global" signature). It is the check every installed app makes
 * before it installs an update; the release scripts make it first, so a key pair that does not match is found before
 * a manifest every app would refuse is published.
 *
 * Public key as Tauri holds it in `tauri.updater.conf.json`: base64 of the two-line `.pub` file, whose second line is
 * base64 of `Ed` + 8-byte key id + 32-byte key. Signature as Tauri's `.sig` and `latest.json` hold it: base64 of the
 * four-line `.sig` file (the plain four lines are accepted too).
 *
 * The version the file was signed for: `tauri-plugin-updater` reads `version:` out of the trusted comment (tab-separated
 * `key:value` pairs), once the signature verified, and refuses an update whose signed version differs from the one the
 * endpoint announced. `verifyMinisign({ version })` does the same, so a manifest that pairs a new version number with an
 * older release's file is found here and not by every installed app. As in the plugin (its `require_signed_version` is
 * off, and this app does not turn it on), a signature that records no version is accepted.
 */
import crypto from "node:crypto";

const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");
const lines = (text) => text.split("\n").map((l) => l.replace(/\r$/, ""));

function plainText(value, what) {
  const trimmed = String(value).trim();
  if (trimmed.startsWith("untrusted comment:")) return trimmed;
  const decoded = Buffer.from(trimmed, "base64").toString("utf8");
  if (!decoded.startsWith("untrusted comment:")) throw new Error(`${what} is not a minisign ${what}`);
  return decoded;
}

/** `{ id, key }` of a minisign public key (the `pubkey` of the updater configuration). */
export function parsePublicKey(pubkey) {
  const [, body] = lines(plainText(pubkey, "public key"));
  const raw = Buffer.from((body ?? "").trim(), "base64");
  if (raw.length !== 42 || raw.subarray(0, 2).toString("latin1") !== "Ed")
    throw new Error("the public key is not an Ed25519 minisign key");
  return {
    id: raw.subarray(2, 10),
    key: crypto.createPublicKey({
      key: Buffer.concat([SPKI_ED25519, raw.subarray(10)]),
      format: "der",
      type: "spki",
    }),
  };
}

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

/** The plugin's comparison: as semver (leading `v`s dropped) when both are, otherwise the two strings as written. */
export function sameVersion(signed, announced) {
  const bare = (v) => v.replace(/^v+/, "");
  return SEMVER.test(bare(signed)) && SEMVER.test(bare(announced))
    ? bare(signed) === bare(announced)
    : signed === announced;
}

/** The `version:` field of a trusted comment, or undefined. */
export function signedVersion(trustedComment) {
  for (const field of trustedComment.split("\t")) if (field.startsWith("version:")) return field.slice(8);
  return undefined;
}

/**
 * Throws an Error saying why `signature` is not a valid signature of `data` by `pubkey`; returns when it is. With
 * `version`, the version recorded in the signed trusted comment (when there is one) must be that version.
 */
export function verifyMinisign({ pubkey, signature, data, version }) {
  const { id, key } = parsePublicKey(pubkey);
  const [, sigLine, trustedLine, globalLine] = lines(plainText(signature, "signature"));
  const sig = Buffer.from((sigLine ?? "").trim(), "base64");
  if (sig.length !== 74) throw new Error("the signature is not a minisign signature");
  const algorithm = sig.subarray(0, 2).toString("latin1");
  if (algorithm !== "Ed" && algorithm !== "ED") throw new Error(`unknown signature algorithm ${algorithm}`);
  if (!sig.subarray(2, 10).equals(id))
    throw new Error("the signature was made by another key (key id differs)");
  const signed = algorithm === "ED" ? crypto.createHash("blake2b512").update(data).digest() : data;
  if (!crypto.verify(null, signed, key, sig.subarray(10)))
    throw new Error("the signature does not verify (the file or the key differs)");
  const trusted = (trustedLine ?? "").replace(/^trusted comment: ?/, "");
  const globalSig = Buffer.from((globalLine ?? "").trim(), "base64");
  const message = Buffer.concat([sig.subarray(10), Buffer.from(trusted, "utf8")]);
  if (globalSig.length !== 64 || !crypto.verify(null, message, key, globalSig))
    throw new Error("the trusted comment does not verify (global signature)");
  // Only now is the comment worth reading: the global signature above covers it.
  const signedFor = signedVersion(trusted);
  if (version !== undefined && signedFor !== undefined && !sameVersion(signedFor, version))
    throw new Error(`the signature is for version ${signedFor}, not ${version} (signed version differs)`);
}
