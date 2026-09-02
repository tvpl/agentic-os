import fs from "node:fs";
import path from "node:path";
import { checkRouters, probe, type ProviderId } from "@mordomo/core";
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

export interface DoctorOptions {
  /** Run `npm audit` against the MordomoOS home (20 s budget). Default true. */
  npmAudit?: boolean;
}

/**
 * `npm audit --json --audit-level=high` run through safeSpawn: `npm` itself is
 * not on the executable allowlist, so the Node binary runs npm's CLI script.
 * Never fatal — offline, missing npm or a missing lockfile all report "skip"/"warn".
 */
export async function npmAuditCheck(home: string, timeoutMs = 20_000): Promise<DoctorCheck> {
  const id = "npm-audit";
  const label = "Dependency audit (npm audit)";
  if (process.env.MORDOMO_SKIP_NPM_AUDIT === "1") {
    return { id, label, status: "skip", detail: "Skipped (MORDOMO_SKIP_NPM_AUDIT=1)" };
  }
  if (!fs.existsSync(path.join(home, "package-lock.json"))) {
    return { id, label, status: "skip", detail: `No package-lock.json in ${home}` };
  }
  const npmCli = path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
  if (!fs.existsSync(npmCli)) {
    return { id, label, status: "skip", detail: "npm CLI not found next to the Node binary" };
  }
  try {
    const res = await probe(process.execPath, [npmCli, "audit", "--json", "--audit-level=high"], home, timeoutMs);
    if (res.timedOut) {
      return { id, label, status: "warn", detail: `npm audit timed out after ${Math.round(timeoutMs / 1000)} s (offline?)` };
    }
    interface AuditJson {
      metadata?: { vulnerabilities?: Record<string, number> };
      error?: { summary?: string };
    }
    let report: AuditJson | null;
    try {
      report = JSON.parse(res.stdout) as AuditJson;
    } catch {
      report = null;
    }
    if (!report) {
      return { id, label, status: "warn", detail: `npm audit produced no JSON (exit ${res.exitCode}): ${res.stderr.trim().slice(0, 200) || "no output"}` };
    }
    if (report.error) {
      return { id, label, status: "warn", detail: `npm audit failed: ${report.error.summary ?? "unknown error"}` };
    }
    const v: Record<string, number> = report.metadata?.vulnerabilities ?? {};
    const high = (v.high ?? 0) + (v.critical ?? 0);
    const total = Object.values(v).reduce((a: number, b: number) => a + b, 0);
    return {
      id,
      label,
      status: high > 0 ? "fail" : total > 0 ? "warn" : "ok",
      detail:
        total === 0
          ? "No known vulnerabilities"
          : `${total} advisory(ies): ${Object.entries(v).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(", ")}`,
    };
  } catch (err) {
    return { id, label, status: "skip", detail: `Could not run npm audit: ${(err as Error).message}` };
  }
}

export async function runDoctor(ctx: AppContext, opts: DoctorOptions = {}): Promise<DoctorReport> {
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

  if (opts.npmAudit !== false) checks.push(await npmAuditCheck(ctx.paths.home));

  return {
    checks,
    ok: checks.filter((c) => c.status === "ok").length,
    warn: checks.filter((c) => c.status === "warn").length,
    fail: checks.filter((c) => c.status === "fail").length,
    generatedAt: Date.now(),
  };
}
