import fs from "node:fs";
import { checkRouters, type ProviderId } from "@mordomo/core";
import type { AppContext } from "./context.js";

export interface DoctorCheck {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail" | "skip";
  detail: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  ok: number;
  warn: number;
  fail: number;
  generatedAt: number;
}

export async function runDoctor(ctx: AppContext): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const settings = ctx.settings();

  const [major] = process.versions.node.split(".");
  checks.push({
    id: "node",
    label: "Node.js version",
    status: Number(major) >= 20 ? "ok" : "fail",
    detail: `v${process.versions.node} (requires >= 20)`,
  });

  try {
    ctx.db.prepare("SELECT 1").get();
    checks.push({ id: "db", label: "SQLite database", status: "ok", detail: ctx.paths.dbFile });
  } catch (err) {
    checks.push({ id: "db", label: "SQLite database", status: "fail", detail: (err as Error).message });
  }

  const snapshots = await ctx.providerSnapshot(true);
  for (const snap of snapshots) {
    const id = snap.id as ProviderId;
    if (!snap.enabled) {
      checks.push({
        id: `provider-${id}`,
        label: `Provider: ${id}`,
        status: "skip",
        detail: snap.health.installed
          ? `installed (${snap.health.version ?? "?"}) but disabled in settings`
          : "not enabled",
      });
      continue;
    }
    checks.push({
      id: `provider-${id}`,
      label: `Provider: ${id}`,
      status: snap.health.ok ? "ok" : snap.health.installed ? "warn" : "fail",
      detail: snap.health.installed
        ? `${snap.health.version ?? "installed"} — auth: ${String(snap.health.authenticated)} — ${snap.health.detail}`
        : snap.health.detail,
    });
  }

  const indexed = settings.indexedFolders.filter((f) => f.enabled);
  if (indexed.length === 0) {
    checks.push({ id: "memory-folders", label: "Indexed folders", status: "warn", detail: "No folders selected — the Second Brain is empty. Add folders in Settings." });
  } else {
    const missing = indexed.filter((f) => !fs.existsSync(f.path));
    checks.push({
      id: "memory-folders",
      label: "Indexed folders",
      status: missing.length ? "warn" : "ok",
      detail: missing.length ? `Missing: ${missing.map((f) => f.path).join(", ")}` : `${indexed.length} folder(s) indexed`,
    });
  }

  const last = ctx.indexer.lastIndex();
  checks.push({
    id: "memory-index",
    label: "Memory index",
    status: last ? "ok" : "warn",
    detail: last
      ? `${new Date(last.at).toISOString()} — ${last.stats.scanned} files scanned`
      : "Never indexed. Run: mordomo index",
  });

  const routerIssues = checkRouters(ctx.db, ctx.paths, settings);
  checks.push({
    id: "routers",
    label: "Memory routers",
    status: routerIssues.length === 0 ? "ok" : "warn",
    detail: routerIssues.length === 0 ? "Routers present, no broken pointers" : routerIssues.map((i) => i.problem).join(" | "),
  });

  const skills = ctx.skills.list();
  const thick = skills.filter((s) => s.thick);
  checks.push({
    id: "skills",
    label: "Skill catalog",
    status: skills.length === 0 ? "warn" : thick.length > 0 ? "warn" : "ok",
    detail:
      skills.length === 0
        ? "No skills in the catalog"
        : `${skills.length} skill(s)` + (thick.length ? ` — thick (split recommended): ${thick.map((s) => s.slug).join(", ")}` : ""),
  });

  const routineStatus = ctx.scheduler.status();
  const unhealthy = routineStatus.filter((r) => !r.healthy);
  checks.push({
    id: "routines",
    label: "Routines",
    status: unhealthy.length ? "warn" : "ok",
    detail: routineStatus.length
      ? `${routineStatus.length} routine(s), ${routineStatus.filter((r) => r.enabled).length} enabled` +
        (unhealthy.length ? ` — repeatedly failing: ${unhealthy.map((r) => r.id).join(", ")}` : "")
      : "No routines defined",
  });

  const metrics = ctx.runs.metrics();
  checks.push({
    id: "runs",
    label: "Recent runs",
    status: metrics.failedRecent > 3 ? "warn" : "ok",
    detail: `${metrics.last7d} run(s) in 7 days, ${metrics.failedRecent} failed in 24h`,
  });

  checks.push({
    id: "bind",
    label: "Network exposure",
    status: settings.bindAddress === "127.0.0.1" ? "ok" : "warn",
    detail:
      settings.bindAddress === "127.0.0.1"
        ? "Server bound to 127.0.0.1 (local only)"
        : `Server configured to bind ${settings.bindAddress} — make sure this is intentional and protected`,
  });

  return {
    checks,
    ok: checks.filter((c) => c.status === "ok").length,
    warn: checks.filter((c) => c.status === "warn").length,
    fail: checks.filter((c) => c.status === "fail").length,
    generatedAt: Date.now(),
  };
}
