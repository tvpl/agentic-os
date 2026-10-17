import type { Settings } from "../config/schema.js";
import type { EventBus, OsEvent } from "../events.js";
import type { NotificationRecord } from "../notifications/store.js";
import type { PushStore } from "../notifications/pushStore.js";
import { classifyPushEndpoint, systemResolver, type HostResolver } from "./pushEndpoint.js";
import { toneAtLeast } from "./telegram.js";
import { sendWebPush } from "./webpush.js";

export interface PushChannelDeps {
  getSettings: () => Settings;
  store: PushStore;
  fetchImpl?: typeof fetch;
  /** Resolves an endpoint's host just before the send (the name may point elsewhere than when it was subscribed). */
  resolveHost?: HostResolver;
  onError?: (message: string) => void;
}

/** What the service worker receives (see `public/sw.js` `push` handler). */
export function pushPayload(row: NotificationRecord): Record<string, unknown> {
  return {
    title: row.title,
    body: row.body ?? "",
    href: row.href ?? "/",
    tag: row.dedupeKey ?? row.id,
    tone: row.tone,
    approvalId: row.approvalId,
  };
}

/** Send one inbox row to every subscription; drop the dead ones. Returns counts. */
export async function deliverPush(
  deps: PushChannelDeps,
  row: NotificationRecord,
): Promise<{ sent: number; failed: number; dropped: number; skipped?: "disabled" | "tone" | "none" }> {
  const settings = deps.getSettings();
  const cfg = settings.channels.push;
  if (!cfg.enabled) return { sent: 0, failed: 0, dropped: 0, skipped: "disabled" };
  if (!toneAtLeast(row.tone, cfg.minTone)) return { sent: 0, failed: 0, dropped: 0, skipped: "tone" };
  const targets = deps.store.targets();
  if (targets.length === 0) return { sent: 0, failed: 0, dropped: 0, skipped: "none" };
  const keys = deps.store.vapidKeys();
  const payload = pushPayload(row);
  const resolve = deps.resolveHost ?? systemResolver;
  let sent = 0;
  let failed = 0;
  let dropped = 0;
  await Promise.all(
    targets.map(async (t) => {
      // Checked again at send time: a subscription outlives the check that let it in, and the name's records move.
      // An endpoint the policy now refuses (it points inside) is dropped for good. A name that could not be
      // resolved right now (no network, a resolver that timed out) says nothing about where it points: it is a failed
      // delivery like any other, counted, and the subscription goes only after the usual run of failures.
      const found = await classifyPushEndpoint(t.sub.endpoint, resolve);
      if (found.verdict === "rejected") {
        dropped++;
        deps.store.remove(t.id);
        return;
      }
      if (found.verdict === "unresolved") {
        failed++;
        if (deps.store.markFailure(t.id)) dropped++;
        return;
      }
      const r = await sendWebPush(t.sub, payload, {
        keys,
        subject: cfg.subject,
        urgency: row.tone === "danger" ? "high" : "normal",
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      });
      if (r.ok) {
        sent++;
        deps.store.markOk(t.id);
      } else if (r.gone) {
        dropped++;
        deps.store.remove(t.id);
      } else {
        failed++;
        if (deps.store.markFailure(t.id)) dropped++;
      }
    }),
  );
  return { sent, failed, dropped };
}

/** Subscribe delivery to `notification.created`. Failures are logged at most once an hour. */
export function installPushChannel(bus: EventBus, deps: PushChannelDeps): () => void {
  let lastLoggedAt = 0;
  return bus.subscribe((event: OsEvent) => {
    if (event.type !== "notification.created") return;
    const row = event.payload as NotificationRecord;
    if (!row || typeof row.title !== "string") return;
    void deliverPush(deps, row)
      .then((r) => {
        if (r.failed > 0 && Date.now() - lastLoggedAt > 3_600_000) {
          lastLoggedAt = Date.now();
          (deps.onError ?? ((m: string) => console.error(`[push] ${m}`)))(
            `${r.failed} push delivery failure(s)`,
          );
        }
      })
      .catch((err: unknown) => deps.onError?.((err as Error).message));
  });
}
