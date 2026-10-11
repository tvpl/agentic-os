import dns from "node:dns";
import net from "node:net";

/**
 * Where a push endpoint may point (.specs/features/escopos-dispositivo, round 1). A subscription hands the server a URL it
 * will POST to with its own VAPID credential, so the URL is the caller's choice of destination: an endpoint that names this
 * machine or its network would make the server an HTTP client for whoever subscribes. An endpoint is accepted only when it
 * is https on the default port, names no credentials, no single-label or local-only host and no address of a private,
 * loopback, link-local, multicast or documentation range, and every address its name resolves to is public. A paired device
 * gets a narrower rule still: only the hosts of the push services the browsers use (`KNOWN_PUSH_HOSTS`).
 */

/** Resolves a host name to the addresses a connection would use (replaceable in tests; the default asks the system). */
export type HostResolver = (host: string) => Promise<string[]>;

export const systemResolver: HostResolver = async (host) =>
  (await dns.promises.lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/**
 * The push services of the browsers: Chrome/Edge (FCM, and the older `android.googleapis.com`), Firefox (autopush,
 * `updates.push.services.mozilla.com` and its siblings), Safari (APNs web push, `web.push.apple.com` and its siblings)
 * and Windows (WNS, `*.notify.windows.com`). Five patterns, each anchored at both ends and tested one by one
 * (`tests/push-security.test.ts`): a name that merely starts or ends like one of them is not one.
 */
export const KNOWN_PUSH_HOSTS: ReadonlyArray<RegExp> = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^[a-z0-9-]+\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
  /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.notify\.windows\.com$/,
];

export function isKnownPushHost(host: string): boolean {
  return KNOWN_PUSH_HOSTS.some((re) => re.test(host));
}

const PRIVATE = new net.BlockList();
for (const [net4, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  PRIVATE.addSubnet(net4, prefix, "ipv4");
}
for (const [net6, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["100::", 64],
  // Forms that can carry or stand for a private IPv4 address, or that no push service uses: IPv4-compatible
  // (`::a.b.c.d`), the local-use NAT64 prefix, IPv4-translated (SIIT), 6to4, Teredo and the retired site-local range.
  ["::", 96],
  ["64:ff9b:1::", 48],
  ["::ffff:0:0:0", 96],
  ["2002::", 16],
  ["2001::", 32],
  ["fec0::", 10],
] as const) {
  PRIVATE.addSubnet(net6, prefix, "ipv6");
}

/** The IPv4 address an IPv6 one carries (`::ffff:a.b.c.d`, NAT64 `64:ff9b::/96`), or null. */
function embeddedV4(ip: string): string | null {
  const dotted = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (dotted) return dotted[1]!;
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (!hex) return null;
  const hi = parseInt(hex[1]!, 16);
  const lo = parseInt(hex[2]!, 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** Whether an address is one a push service could have: not private, loopback, link-local, multicast or reserved. */
export function isPublicAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const family = net.isIP(ip);
  if (family === 0) return false;
  if (family === 6) {
    const v4 = embeddedV4(ip);
    if (v4) return isPublicAddress(v4);
    return !PRIVATE.check(ip, "ipv6");
  }
  return !PRIVATE.check(ip, "ipv4");
}

const LOCAL_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".localdomain",
  ".lan",
  ".home",
  ".corp",
  ".intranet",
];

/** What is wrong with an endpoint on its face (no lookup), or null. */
export function endpointProblem(endpoint: string): string | null {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return "The endpoint is not a URL.";
  }
  if (url.protocol !== "https:") return "A push endpoint must be https.";
  if (url.username || url.password) return "A push endpoint carries no credentials.";
  if (url.port && url.port !== "443") return "A push endpoint uses the default https port.";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const literal = host.replace(/^\[|\]$/g, "");
  if (net.isIP(literal) !== 0) {
    return isPublicAddress(literal)
      ? null
      : "A push endpoint is not an address of this machine or its network.";
  }
  if (!host.includes(".") || LOCAL_SUFFIXES.some((s) => host.endsWith(s)) || host === "localhost") {
    return "A push endpoint names a public host.";
  }
  return null;
}

/** What `classifyPushEndpoint` found: fine, refused by the policy, or not decidable now (the name did not resolve). */
export type EndpointVerdict =
  { verdict: "ok" } | { verdict: "rejected"; reason: string } | { verdict: "unresolved"; reason: string };

/**
 * The policy applied to an endpoint, with the reason a name could not be judged kept apart from the reason it was
 * refused: a name that does not resolve (no network, a resolver that timed out, an empty answer) says nothing about
 * where the endpoint points, so a sender counts it as a failed delivery and tries again, while an endpoint that
 * points inside, or that the policy refuses on its face, is dropped.
 */
export async function classifyPushEndpoint(
  endpoint: string,
  resolve: HostResolver,
  opts: { knownServicesOnly?: boolean } = {},
): Promise<EndpointVerdict> {
  const problem = endpointProblem(endpoint);
  if (problem) return { verdict: "rejected", reason: problem };
  const url = new URL(endpoint);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (opts.knownServicesOnly && !isKnownPushHost(host)) {
    return {
      verdict: "rejected",
      reason: "A paired device registers only the push services of browsers (FCM, Mozilla, Apple, Windows).",
    };
  }
  if (net.isIP(host.replace(/^\[|\]$/g, "")) !== 0) return { verdict: "ok" };
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return { verdict: "unresolved", reason: "The endpoint's host does not resolve." };
  }
  if (addresses.length === 0) {
    return { verdict: "unresolved", reason: "The endpoint's host does not resolve." };
  }
  if (!addresses.every(isPublicAddress)) {
    return {
      verdict: "rejected",
      reason: "The endpoint's host resolves to an address of this machine or its network.",
    };
  }
  return { verdict: "ok" };
}

/** The same as one answer for a caller that only needs to refuse: null when the endpoint is acceptable now. */
export async function checkPushEndpoint(
  endpoint: string,
  resolve: HostResolver,
  opts: { knownServicesOnly?: boolean } = {},
): Promise<string | null> {
  const found = await classifyPushEndpoint(endpoint, resolve, opts);
  return found.verdict === "ok" ? null : found.reason;
}
