export const PROVIDER_LOGIN_COMMANDS = {
  claude: "claude auth login",
  codex: "codex login",
  cursor: "cursor-agent login",
} as const;

/** Match authentication failures only; never retry a denied or failed write automatically. */
export function authRecovery(provider: string, error: string | null | undefined): string | null {
  if (
    !error ||
    !/(?:failed to authenticate|oauth session expired|not logged in|authentication (?:failed|required)|invalid api key|token (?:has )?expired)/i.test(
      error,
    )
  )
    return null;
  if (provider === "claude") return PROVIDER_LOGIN_COMMANDS.claude;
  if (provider === "codex") return PROVIDER_LOGIN_COMMANDS.codex;
  if (provider === "cursor") return PROVIDER_LOGIN_COMMANDS.cursor;
  return null;
}
