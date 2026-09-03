/** Small pure helpers shared by the run views (kept out of the .tsx so they are testable). */

/** What a write run will do under the active security profile. */
export type WritePolicy = "allowed" | "approval" | "refused";

/** Mirrors `writeDecision()` in core/src/security/profiles.ts for origin "manual". */
export function writePolicyFor(profile: string | undefined): WritePolicy {
  if (profile === "controlled_write" || profile === "approved_automation") return "allowed";
  if (profile === "review_before_write") return "approval";
  return "refused";
}

/** The follow-up prompt carries the previous request as context, then the new ask. */
export function followUpPrompt(previous: string, followUp: string): string {
  return `Previous request:\n${previous.trim()}\n\nFollow-up:\n${followUp.trim()}`;
}

/** Working-directory suggestions: enabled indexed folders first, then recent run cwds. */
export function cwdSuggestions(
  folders: ReadonlyArray<{ path: string; enabled: boolean }> | undefined,
  runs: ReadonlyArray<{ cwd?: string | null }> | undefined,
  limit = 12,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const folder of folders ?? []) {
    if (folder.enabled && folder.path && !seen.has(folder.path)) {
      seen.add(folder.path);
      out.push(folder.path);
    }
  }
  for (const run of runs ?? []) {
    if (run.cwd && !seen.has(run.cwd)) {
      seen.add(run.cwd);
      out.push(run.cwd);
    }
  }
  return out.slice(0, limit);
}
