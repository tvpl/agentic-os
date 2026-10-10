import type { Settings } from "@mordomo/core";

/**
 * Where the service listens (.specs/features/escopos-dispositivo, door 6). The listener without TLS is for this
 * machine: it is bound to loopback whatever `bindAddress` says, and a tunnel or a reverse proxy running here reaches
 * it from there. `bindAddress` beyond loopback applies to the TLS listener alone, and only when remote access and its
 * TLS are on (`remote.enabled`, `remote.tls.enabled`); another machine never meets plain HTTP.
 */
const LOOPBACK_BINDS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLoopbackBind(address: string): boolean {
  const a = address.trim().toLowerCase();
  return LOOPBACK_BINDS.has(a) || /^127\.\d+\.\d+\.\d+$/.test(a);
}

export interface ListenPlan {
  /** Where the listener without TLS binds. */
  plainHost: string;
  /** Where the TLS listener binds, or null when there is none (remote access or its TLS is off). */
  tlsHost: string | null;
  /** The `bindAddress` that was not honoured because nothing would carry TLS on it, or null. */
  ignoredBind: string | null;
}

export function listenPlan(settings: Pick<Settings, "bindAddress" | "remote">): ListenPlan {
  const bind = settings.bindAddress;
  const loopback = isLoopbackBind(bind);
  const tls = settings.remote.enabled && settings.remote.tls.enabled;
  return {
    plainHost: loopback ? bind : "127.0.0.1",
    tlsHost: tls ? bind : null,
    ignoredBind: !loopback && !tls ? bind : null,
  };
}

/** What the start-up log and `mordomo doctor` say when `bindAddress` leaves loopback and nothing carries TLS on it. */
export function ignoredBindMessage(bind: string): string {
  return (
    `bindAddress ${bind} is not honoured: another machine would reach plain HTTP. The service listens on 127.0.0.1 only. ` +
    "To serve other machines, turn on remote.enabled and remote.tls.enabled (Settings › Security › Remote access), " +
    "or leave bindAddress alone and reach the service through a tunnel that runs on this machine and forwards to 127.0.0.1."
  );
}
