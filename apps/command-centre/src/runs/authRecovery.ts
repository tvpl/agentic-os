import type { ProviderSnapshot } from "../api";

type LoginSnapshot = Pick<ProviderSnapshot, "id" | "loginCommand">;

/** The command that signs a provider's CLI in, as its manifest declares it (`GET /api/providers`). */
export function loginHint(
  provider: string | null | undefined,
  snapshots: readonly LoginSnapshot[] | undefined,
): string | null {
  return snapshots?.find((s) => s.id === provider)?.loginCommand ?? null;
}

/** Match authentication failures only; never retry a denied or failed write automatically. */
export function authRecovery(
  provider: string,
  error: string | null | undefined,
  snapshots: readonly LoginSnapshot[] | undefined,
): string | null {
  if (
    !error ||
    !/(?:failed to authenticate|oauth session expired|not logged in|authentication (?:failed|required)|invalid api key|token (?:has )?expired)/i.test(
      error,
    )
  )
    return null;
  return loginHint(provider, snapshots);
}
