import type { FastifyRequest } from "fastify";

/**
 * API versioning (docs/security.md, door 1 of `.specs/features/api-v1`):
 * `/api/v1/<rest>` is the documented path and is routed as `/api/<rest>`;
 * the unversioned spelling stays an alias of v1 that announces its successor.
 */
export const API_VERSION = 1;

const V1_PREFIX = "/api/v1/";

/** Fastify `rewriteUrl`: map `/api/v1/<rest>` onto the route registered as `/api/<rest>`. */
export function rewriteApiUrl(url: string): string {
  return url.startsWith(V1_PREFIX) ? `/api/${url.slice(V1_PREFIX.length)}` : url;
}

/**
 * `Deprecation` and the successor `Link` for a request that reached an `/api`
 * route without the version (none for `/api/v1/…`, for non-API paths and for
 * unmatched ones). The query is left out of the link so a token never lands
 * in a header.
 */
export function successorHeaders(req: FastifyRequest): Record<string, string> {
  if (!req.routeOptions?.url?.startsWith("/api/") || req.originalUrl.startsWith(V1_PREFIX)) return {};
  // The first segment is whatever spelling of `api` the router matched.
  const rest = req.originalUrl.split("?")[0]!.replace(/^\/[^/]*\//, "");
  return { Deprecation: "true", Link: `<${V1_PREFIX}${rest}>; rel="successor-version"` };
}
