import inject, { type DispatchFunc, type InjectOptions } from "light-my-request";
import type { FastifyInstance } from "fastify";
import { isLoopbackAddress } from "../../apps/api/src/server.js";

/**
 * A request as the second (https) listener of `startServer` hands it to the app: the same handler, a connection that
 * is TLS. `app.inject` always makes a plain one, so a test that needs a peer from another machine whose request
 * is judged by the rules below the transport gate (rate limits, the page's token, scopes) goes through this.
 * `.specs/features/escopos-dispositivo`, door 6: another machine never gets past the gate without TLS.
 */
export function injectTls(app: FastifyInstance, options: InjectOptions) {
  const dispatch: DispatchFunc = (req, res) => {
    (req.socket as unknown as { encrypted?: boolean }).encrypted = true;
    app.server.emit("request", req, res);
  };
  return app.ready().then(() => inject(dispatch, options));
}

/**
 * `app` with `inject` made TLS-aware for peers that are not loopback, so a test written for rate limits or for the
 * page's token keeps testing that. The transport gate has its own tests (`tests/remote-transport.test.ts`).
 */
export function tlsForRemotePeers<T extends FastifyInstance>(app: T): T {
  const plain = app.inject.bind(app) as (options: InjectOptions) => Promise<unknown>;
  const aware = (options: InjectOptions) =>
    typeof options === "object" && options.remoteAddress && !isLoopbackAddress(options.remoteAddress)
      ? injectTls(app, options)
      : plain(options);
  app.inject = aware as unknown as T["inject"];
  return app;
}
