/**
 * Release check. Opt-in: nothing is fetched unless `settings.updates.check` is
 * on or the user presses "Check now". One anonymous GET to the public releases
 * API, no identifiers sent, answer cached for six hours.
 */
export const RELEASES_REPO = "tvpl/agentic-os";
export const RELEASES_PAGE = `https://github.com/${RELEASES_REPO}/releases`;
const LATEST_URL = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`;
const CACHE_MS = 6 * 60 * 60 * 1000;

export interface UpdateStatus {
  current: string;
  latest: string | null;
  url: string;
  /** null when the check did not run or failed. */
  upToDate: boolean | null;
  checkedAt: number;
  error: string | null;
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** `1.2.3` vs `1.10.0` (leading `v` and pre-release suffixes tolerated). */
export function compareVersions(a: string, b: string): number {
  const norm = (v: string) =>
    v
      .replace(/^v/, "")
      .split("-")[0]!
      .split(".")
      .map((n) => Number(n) || 0);
  const pa = norm(a);
  const pb = norm(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export class UpdateChecker {
  private cached: UpdateStatus | null = null;
  constructor(
    private readonly current: string,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
  ) {}

  async check(force = false): Promise<UpdateStatus> {
    if (!force && this.cached && Date.now() - this.cached.checkedAt < CACHE_MS) return this.cached;
    const base = { current: this.current, url: RELEASES_PAGE, checkedAt: Date.now() };
    try {
      const res = await this.fetchImpl(LATEST_URL, {
        headers: { accept: "application/vnd.github+json", "user-agent": "mordomo-os" },
        signal: AbortSignal.timeout(8000),
      });
      // 404: no release published yet (or a private repository) — not a failure of this machine.
      if (res.status === 404) throw new Error("no published release yet");
      if (!res.ok) throw new Error(`releases API answered ${res.status}`);
      const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
      const latest = typeof body.tag_name === "string" ? body.tag_name.replace(/^v/, "") : null;
      if (!latest) throw new Error("no published release");
      this.cached = {
        ...base,
        latest,
        url: typeof body.html_url === "string" ? body.html_url : RELEASES_PAGE,
        upToDate: compareVersions(this.current, latest) >= 0,
        error: null,
      };
    } catch (err) {
      this.cached = { ...base, latest: null, upToDate: null, error: (err as Error).message };
    }
    return this.cached;
  }
}
