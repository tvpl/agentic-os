import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolvePaths } from "@mordomo/core";
import {
  formatCommand,
  planStartupService,
  powershellQuote,
  shellQuote,
  systemdQuote,
  xmlEscape,
} from "../core/src/routines/osIntegration.js";
import { makeTempHome } from "./helpers.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(repoRoot, "apps", "api", "dist", "cli.js");
/**
 * The CLI tests exercise the BUILT artifact. Skip (loudly) when dist is missing, or when the
 * workspace's dist is temporarily unloadable because another package is mid-edit.
 */
function probeDist(): { ready: boolean; reason: string } {
  if (!fs.existsSync(CLI)) {
    return {
      ready: false,
      reason: `${CLI} missing — run: npx tsc -b core adapters/claude adapters/cursor adapters/codex apps/api`,
    };
  }
  const res = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8", timeout: 30_000 });
  const stderr = res.stderr ?? "";
  if (
    res.status !== 0 &&
    /does not provide an export named|Cannot find module|ERR_MODULE_NOT_FOUND/.test(stderr)
  ) {
    return {
      ready: false,
      reason: `built workspace does not load: ${stderr.split("\n").find((l) => l.includes("Error")) ?? stderr.slice(0, 200)}`,
    };
  }
  return { ready: true, reason: "" };
}
const dist = probeDist();
const distReady = dist.ready;
if (!distReady) console.warn(`[cli.test] skipping CLI tests: ${dist.reason}`);

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function mordomo(home: string, args: string[]): CliResult {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      MORDOMO_HOME: home,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      // A PATH without real provider CLIs keeps `doctor` fast and deterministic.
      PATH: path.dirname(process.execPath),
    },
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe.skipIf(!distReady)("mordomo CLI (built apps/api/dist/cli.js)", () => {
  it("--help prints usage and exits 0", () => {
    const { paths, cleanup } = makeTempHome("mordomo-cli-");
    try {
      const res = mordomo(paths.home, ["--help"]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("mordomo setup");
      expect(res.stdout).toContain("mordomo run <skill>");
      // `help` as a command and `-h` behave the same.
      expect(mordomo(paths.home, ["help"]).status).toBe(0);
      expect(mordomo(paths.home, ["-h"]).stdout).toContain("mordomo status");
    } finally {
      cleanup();
    }
  });

  it("status reports stopped when no service is running (text and --json)", () => {
    const { paths, cleanup } = makeTempHome("mordomo-cli-");
    try {
      const res = mordomo(paths.home, ["status"]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("stopped");
      const json = mordomo(paths.home, ["status", "--json"]);
      expect(json.status).toBe(0);
      const parsed = JSON.parse(json.stdout) as { running: boolean; port: number; pid: number | null };
      expect(parsed.running).toBe(false);
      expect(parsed.pid).toBeNull();
      expect(parsed.port).toBe(4777);
    } finally {
      cleanup();
    }
  });

  it("ignores a stale pidfile whose PID belongs to another process", () => {
    const { paths, cleanup } = makeTempHome("mordomo-cli-");
    try {
      // Our own test runner PID is alive but is not `cli.js`: must not count as "running".
      fs.mkdirSync(paths.run, { recursive: true });
      fs.writeFileSync(
        path.join(paths.run, "server.pid"),
        JSON.stringify({ pid: process.pid, port: 4777, startedAt: Date.now() - 60_000 }),
      );
      const res = mordomo(paths.home, ["status", "--json"]);
      expect(res.status).toBe(0);
      expect((JSON.parse(res.stdout) as { running: boolean }).running).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("rejects an invalid --provider with exit code 2 before touching the data dir", () => {
    const { paths, cleanup } = makeTempHome("mordomo-cli-");
    try {
      const res = mordomo(paths.home, ["run", "whatever", "--provider", "foo"]);
      expect(res.status).toBe(2);
      expect(res.stderr).toMatch(/Invalid --provider "foo"/);
      expect(res.stderr).toContain("claude, cursor, codex");
      const effort = mordomo(paths.home, ["run", "whatever", "--effort", "max"]);
      expect(effort.status).toBe(2);
      expect(effort.stderr).toMatch(/Invalid --effort "max"/);
    } finally {
      cleanup();
    }
  });

  it("rejects unknown options, unknown commands and options that need a value (exit 2)", () => {
    const { paths, cleanup } = makeTempHome("mordomo-cli-");
    try {
      expect(mordomo(paths.home, ["status", "--bogus"]).status).toBe(2);
      expect(mordomo(paths.home, ["frobnicate"]).status).toBe(2);
      expect(mordomo(paths.home, ["run", "x", "--provider"]).status).toBe(2);
      // An option valid for one command is a usage error for another.
      const res = mordomo(paths.home, ["status", "--purge"]);
      expect(res.status).toBe(2);
      expect(res.stderr).toContain("--purge");
    } finally {
      cleanup();
    }
  });

  it("uninstall --purge refuses without --yes when stdin is not a TTY", () => {
    const { paths, cleanup } = makeTempHome("mordomo-cli-");
    try {
      fs.writeFileSync(path.join(paths.logs, "marker.log"), "keep me");
      const res = mordomo(paths.home, ["uninstall", "--purge"]);
      expect(res.status).toBe(2);
      expect(res.stderr).toContain("--yes");
      expect(fs.existsSync(path.join(paths.logs, "marker.log"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("doctor --json prints a machine-readable report", () => {
    const { paths, cleanup } = makeTempHome("mordomo-cli-");
    try {
      const res = mordomo(paths.home, ["doctor", "--json"]);
      const report = JSON.parse(res.stdout) as {
        checks: Array<{ id: string; status: string }>;
        ok: number;
        warn: number;
        fail: number;
      };
      expect(Array.isArray(report.checks)).toBe(true);
      expect(report.checks.map((c) => c.id)).toContain("node");
      expect(report.checks.map((c) => c.id)).toContain("db");
      expect(res.status).toBe(report.fail > 0 ? 1 : 0);
    } finally {
      cleanup();
    }
  });
});

describe("startup service plan quoting", () => {
  // Resolved like the CLI does at runtime, so the expectations hold on Windows too.
  const home = path.resolve("/Users", "Ana Maria", "My Projects", "mordomo os");
  const node = path.resolve("/Applications", "Node Tools", "bin", "node");
  const paths = resolvePaths(home);
  const cli = path.join(home, "apps", "api", "dist", "cli.js");

  it("systemd: ExecStart and Environment are quoted per systemd rules", () => {
    const plan = planStartupService(paths, node, "linux", "/home/ana maria");
    const unit = plan.files[0]!.content;
    expect(unit).toContain(`ExecStart=${systemdQuote(node)} ${systemdQuote(cli)} start --foreground`);
    expect(unit).toContain(`Environment=${systemdQuote(`MORDOMO_HOME=${home}`)}`);
    expect(plan.files[0]!.path).toBe("/home/ana maria/.config/systemd/user/mordomo.service");
    // argv arrays are what the CLI spawns: no splitting on spaces.
    expect(plan.installArgv).toEqual([
      ["systemctl", "--user", "daemon-reload"],
      ["systemctl", "--user", "enable", "--now", "mordomo.service"],
    ]);
    expect(plan.uninstallArgv[1]).toEqual([
      "rm",
      "-f",
      "/home/ana maria/.config/systemd/user/mordomo.service",
    ]);
    expect(plan.uninstallCommands[1]).toBe("rm -f '/home/ana maria/.config/systemd/user/mordomo.service'");
  });

  it("systemd: doubles % and escapes quotes/backslashes", () => {
    expect(systemdQuote('/opt/100%/it\'s "x"\\y')).toBe('"/opt/100%%/it\'s \\"x\\"\\\\y"');
  });

  it("launchd: ProgramArguments stay one string per argument and are XML-escaped", () => {
    const plan = planStartupService(paths, node, "darwin", "/Users/ana maria");
    const plist = plan.files[0]!.content;
    expect(plist).toContain(`<string>${node}</string>`);
    expect(plist).toContain(`<string>${cli}</string>`);
    expect(plist).toContain(`<key>MORDOMO_HOME</key><string>${home}</string>`);
    expect(plan.installArgv).toEqual([
      ["launchctl", "load", "-w", "/Users/ana maria/Library/LaunchAgents/com.mordomo.service.plist"],
    ]);
    expect(plan.installCommands[0]).toBe(
      "launchctl load -w '/Users/ana maria/Library/LaunchAgents/com.mordomo.service.plist'",
    );
    expect(xmlEscape(`R&D <"x">`)).toBe("R&amp;D &lt;&quot;x&quot;&gt;");
    const weird = planStartupService(resolvePaths("/tmp/a&b"), node, "darwin", "/Users/x");
    expect(weird.files[0]!.content).toContain("<string>/tmp/a&amp;b</string>");
    expect(weird.files[0]!.content).not.toContain("<string>/tmp/a&b</string>");
  });

  it("windows: Task Scheduler script quotes paths with spaces and single quotes", () => {
    const winHome = "C:\\Users\\Ana O'Neil\\mordomo os";
    const winNode = "C:\\Program Files\\nodejs\\node.exe";
    const plan = planStartupService(resolvePaths(winHome), winNode, "win32", "C:\\Users\\Ana O'Neil");
    const script = plan.files[0]!.content;
    expect(script).toContain(`-Execute 'C:\\Program Files\\nodejs\\node.exe'`);
    expect(script).toContain(`-Argument '"`);
    expect(script).toContain("Ana O''Neil");
    expect(script).toContain(`start --foreground'`);
    expect(plan.installArgv[0]!.slice(0, 5)).toEqual([
      "powershell",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
    ]);
    expect(plan.installArgv[0]![5]).toContain("mordomo-task.ps1");
    expect(plan.installCommands[0]).toMatch(/-File "[^"]*mordomo-task\.ps1"/);
    expect(powershellQuote("it's")).toBe("'it''s'");
  });

  it("formats argv for copy-paste with shell quoting", () => {
    expect(shellQuote("plain-arg_1")).toBe("plain-arg_1");
    expect(shellQuote("has space")).toBe("'has space'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    expect(formatCommand(["rm", "-f", "/a b/c"], "linux")).toBe("rm -f '/a b/c'");
    expect(formatCommand(["powershell", "-File", "C:\\a b\\c.ps1"], "win32")).toBe(
      'powershell -File "C:\\a b\\c.ps1"',
    );
  });

  it("unsupported platforms return an empty, safe plan", () => {
    const plan = planStartupService(paths, node, "freebsd");
    expect(plan.platform).toBe("unsupported");
    expect(plan.installArgv).toEqual([]);
    expect(plan.installCommands).toEqual([]);
  });
});
