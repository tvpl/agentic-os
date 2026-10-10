/**
 * What the OS is watching (refino item 32): one row per sentinel with its
 * configuration, whether it is on, and the last time it spoke — read back
 * from the inbox rows it wrote, so the panel and the bell never disagree.
 */
import type { FastifyInstance } from "fastify";
import { SENTINEL_IDS } from "@mordomo/core";
import type { AppContext } from "../context.js";

export interface SentinelStatusRow {
  id: string;
  enabled: boolean;
  config: Record<string, unknown>;
  lastFiredAt: number | null;
  lastTitle: string | null;
  /** Folders the fs sentinel watches; empty for the others. */
  watched: string[];
}

export function registerSentinelRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/sentinels", { config: { scope: "monitor" } }, async () => {
    const settings = ctx.settings();
    const cfg = settings.sentinels as Record<string, Record<string, unknown> & { enabled?: boolean }>;
    const recent = ctx.notifications.list({ limit: 300 });
    const ids: string[] = [...SENTINEL_IDS, "repeatDetector", "triage"];
    const rows: SentinelStatusRow[] = ids.map((id) => {
      const last = recent.find((n) =>
        id === "repeatDetector"
          ? n.messageKey === "skill.repeat"
          : id === "triage"
            ? (n.dedupeKey ?? "").startsWith("triage:")
            : (n.dedupeKey ?? "").startsWith(`sentinel:${id}:`),
      );
      const conf = cfg[id] ?? {};
      return {
        id,
        enabled: conf.enabled !== false,
        config: conf,
        lastFiredAt: last?.ts ?? null,
        lastTitle: last?.title ?? null,
        watched: id === "fsWatch" ? ctx.sentinels.watchedFolders() : [],
      };
    });
    return { running: ctx.sentinels.isRunning(), sentinels: rows };
  });
}
