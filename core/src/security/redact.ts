/**
 * Redaction of token-shaped strings before anything is persisted or displayed.
 * Deliberately aggressive: a false positive costs a little readability,
 * a false negative leaks a credential.
 *
 * Order matters: opaque token shapes (bearer, API keys) run before the generic
 * key/value pattern so `Authorization: Bearer <token>` cannot survive with the
 * token intact after the key name has been consumed.
 */
const PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, label: "private-key" },
  { re: /Bearer\s+[A-Za-z0-9._~+/-]{16,}=*/g, label: "bearer" },
  { re: /sk-ant-[A-Za-z0-9_-]{16,}/g, label: "api-key" },
  { re: /sk-[A-Za-z0-9_-]{16,}/g, label: "api-key" },
  { re: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, label: "github-token" },
  { re: /github_pat_[A-Za-z0-9_]{20,}/g, label: "github-token" },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/g, label: "slack-token" },
  { re: /AKIA[0-9A-Z]{16}/g, label: "aws-key-id" },
  { re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, label: "jwt" },
  { re: /AIza[0-9A-Za-z_-]{30,}/g, label: "google-key" },
];

/**
 * `key = value` / `key: value` / `"key": "value"` pairs. Groups:
 *  1 key name, 2 separator (with the optional closing quote of a JSON key),
 *  3 double-quoted value body (escapes allowed), 4 single-quoted value body,
 *  5 opening quote of an unterminated value, 6 bare value.
 * Quoted values are consumed whole (including `\"` escapes) and re-emitted
 * with the same quotes, so a redacted JSON document still parses.
 */
const CREDENTIAL_PAIR =
  /\b(password|passwd|secret|token|api[_-]?key|authorization|auth)(["']?\s*[=:]\s*)(?:"((?:[^"\\]|\\.){6,})"|'((?:[^'\\]|\\.){6,})'|(["']?)([^\s"',;]{6,}))/gi;

export function redactSecrets(input: string): string {
  let out = input;
  for (const { re, label } of PATTERNS) {
    out = out.replace(re, () => `[REDACTED:${label}]`);
  }
  // Key/value pairs: keep the key name (and its quoting) for debuggability.
  out = out.replace(
    CREDENTIAL_PAIR,
    (
      m,
      key: string,
      sep: string,
      dq: string | undefined,
      sq: string | undefined,
      open: string | undefined,
      bare: string | undefined,
    ) => {
      const value = dq ?? sq ?? bare ?? "";
      if (value.startsWith("[REDACTED")) return m; // already handled above
      const label = "[REDACTED:credential-pair]";
      if (dq !== undefined) return `${key}${sep}"${label}"`;
      if (sq !== undefined) return `${key}${sep}'${label}'`;
      return `${key}${sep}${open ?? ""}${label}`;
    },
  );
  return out;
}

export function redactObject<T>(value: T): T {
  return JSON.parse(redactSecrets(JSON.stringify(value))) as T;
}
