/**
 * Redaction of token-shaped strings before anything is persisted or displayed.
 * Deliberately aggressive: a false positive costs a little readability,
 * a false negative leaks a credential.
 */
const PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /sk-[A-Za-z0-9_-]{16,}/g, label: "api-key" },
  { re: /sk-ant-[A-Za-z0-9_-]{16,}/g, label: "api-key" },
  { re: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, label: "github-token" },
  { re: /github_pat_[A-Za-z0-9_]{20,}/g, label: "github-token" },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/g, label: "slack-token" },
  { re: /AKIA[0-9A-Z]{16}/g, label: "aws-key-id" },
  { re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, label: "jwt" },
  { re: /AIza[0-9A-Za-z_-]{30,}/g, label: "google-key" },
  {
    re: /\b(password|passwd|secret|token|api[_-]?key|authorization|auth)\s*[=:]\s*["']?[^\s"',;]{6,}/gi,
    label: "credential-pair",
  },
  { re: /Bearer\s+[A-Za-z0-9._~+/-]{16,}=*/g, label: "bearer" },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, label: "private-key" },
];

export function redactSecrets(input: string): string {
  let out = input;
  for (const { re, label } of PATTERNS) {
    out = out.replace(re, (m) => {
      // For key=value pairs keep the key name for debuggability.
      const eq = m.search(/[=:]/);
      if (label === "credential-pair" && eq > 0) {
        return `${m.slice(0, eq + 1)}[REDACTED:${label}]`;
      }
      return `[REDACTED:${label}]`;
    });
  }
  return out;
}

export function redactObject<T>(value: T): T {
  return JSON.parse(redactSecrets(JSON.stringify(value))) as T;
}
