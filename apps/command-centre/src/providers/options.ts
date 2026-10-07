import type { ProviderId, ProviderSnapshot } from "../api";

/**
 * The providers a list offers: the registered ones, in the server's order
 * (`GET /api/providers`). The Command Centre never lists providers by name.
 */
export function providerOptions(
  snapshots: readonly Pick<ProviderSnapshot, "id">[] | undefined,
): ProviderId[] {
  return (snapshots ?? []).map((s) => s.id);
}
