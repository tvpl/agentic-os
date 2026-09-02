import os from "node:os";
import path from "node:path";
import type { MordomoPaths } from "../paths.js";

/**
 * OS scheduler integration: generates the unit/plist/task definitions that keep
 * the MordomoOS service alive at login so the internal scheduler is always on.
 * Files are GENERATED and shown to the user; installing them is approval-gated
 * (create_startup_service) and done by the CLI with the user's confirmation.
 *
 * Every path is quoted for the target format (systemd, plist XML, PowerShell)
 * and every command is exposed BOTH as an argv array (what the CLI actually
 * spawns — never split on spaces) and as a display string for humans.
 */

export interface StartupServicePlan {
  platform: "linux" | "darwin" | "win32" | "unsupported";
  files: Array<{ path: string; content: string }>;
  /** Human-readable install commands (shell-quoted). */
  installCommands: string[];
  /** Human-readable uninstall commands (shell-quoted). */
  uninstallCommands: string[];
  /** argv arrays to spawn (no shell, no splitting). */
  installArgv: string[][];
  uninstallArgv: string[][];
  notes: string[];
}

export type StartupPlatform = NodeJS.Platform;

/**
 * Quote a single argument for a systemd `ExecStart=`/`Environment=` line.
 * systemd's rules: double quotes, backslash escapes for `\` and `"`, and `%`
 * doubled because the value goes through specifier expansion.
 */
export function systemdQuote(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%");
  return `"${escaped}"`;
}

/** Escape text for a plist/XML text node. */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Quote for a PowerShell single-quoted string literal. */
export function powershellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** POSIX shell quoting for display (and for copy-paste into a terminal). */
export function shellQuote(arg: string): string {
  if (/^[A-Za-z0-9_\-./:=@%+,]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/** Windows cmd/PowerShell style quoting for display. */
export function windowsQuote(arg: string): string {
  if (/^[A-Za-z0-9_\-./:=@%+,\\]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

/** Render an argv array as a copy-pasteable command line for the platform. */
export function formatCommand(argv: readonly string[], platform: StartupPlatform = process.platform): string {
  const quote = platform === "win32" ? windowsQuote : shellQuote;
  return argv.map(quote).join(" ");
}

export function planStartupService(
  paths: MordomoPaths,
  nodePath: string,
  platform: StartupPlatform = process.platform,
  homeDir: string = os.homedir(),
): StartupServicePlan {
  const serverEntry = path.join(paths.home, "apps", "api", "dist", "cli.js");
  const withDisplay = (argvs: string[][]): { argv: string[][]; display: string[] } => ({
    argv: argvs,
    display: argvs.map((a) => formatCommand(a, platform)),
  });

  switch (platform) {
    case "linux": {
      const unitPath = path.join(homeDir, ".config", "systemd", "user", "mordomo.service");
      const install = withDisplay([
        ["systemctl", "--user", "daemon-reload"],
        ["systemctl", "--user", "enable", "--now", "mordomo.service"],
      ]);
      const uninstall = withDisplay([
        ["systemctl", "--user", "disable", "--now", "mordomo.service"],
        ["rm", "-f", unitPath],
        ["systemctl", "--user", "daemon-reload"],
      ]);
      return {
        platform: "linux",
        files: [
          {
            path: unitPath,
            content: `[Unit]
Description=MordomoOS local service
After=default.target

[Service]
ExecStart=${systemdQuote(nodePath)} ${systemdQuote(serverEntry)} start --foreground
Restart=on-failure
RestartSec=5
Environment=${systemdQuote(`MORDOMO_HOME=${paths.home}`)}

[Install]
WantedBy=default.target
`,
          },
        ],
        installCommands: install.display,
        uninstallCommands: uninstall.display,
        installArgv: install.argv,
        uninstallArgv: uninstall.argv,
        notes: [
          "Uses systemd user units — no root required. `loginctl enable-linger $USER` keeps it running while logged out.",
        ],
      };
    }
    case "darwin": {
      const plistPath = path.join(homeDir, "Library", "LaunchAgents", "com.mordomo.service.plist");
      const install = withDisplay([["launchctl", "load", "-w", plistPath]]);
      const uninstall = withDisplay([
        ["launchctl", "unload", "-w", plistPath],
        ["rm", "-f", plistPath],
      ]);
      return {
        platform: "darwin",
        files: [
          {
            path: plistPath,
            content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.mordomo.service</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodePath)}</string>
    <string>${xmlEscape(serverEntry)}</string>
    <string>start</string>
    <string>--foreground</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>MORDOMO_HOME</key><string>${xmlEscape(paths.home)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xmlEscape(path.join(paths.logs, "service.out.log"))}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(path.join(paths.logs, "service.err.log"))}</string>
</dict>
</plist>
`,
          },
        ],
        installCommands: install.display,
        uninstallCommands: uninstall.display,
        installArgv: install.argv,
        uninstallArgv: uninstall.argv,
        notes: ["launchd user agent — starts at login, restarts on crash."],
      };
    }
    case "win32": {
      const scriptPath = path.join(paths.config, "mordomo-task.ps1");
      // The task's argument string is parsed by Windows: double-quote the script path there.
      const taskArgument = `"${serverEntry.replace(/"/g, '\\"')}" start --foreground`;
      const install = withDisplay([["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath]]);
      const uninstall = withDisplay([
        ["powershell", "-NoProfile", "-Command", "Unregister-ScheduledTask -TaskName MordomoOS -Confirm:$false"],
      ]);
      return {
        platform: "win32",
        files: [
          {
            path: scriptPath,
            content: `# Registers MordomoOS as a logon task (run in an elevated-or-not PowerShell)
$action = New-ScheduledTaskAction -Execute ${powershellQuote(nodePath)} -Argument ${powershellQuote(taskArgument)}
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "MordomoOS" -Action $action -Trigger $trigger -Description "MordomoOS local service"
`,
          },
        ],
        installCommands: install.display,
        uninstallCommands: uninstall.display,
        installArgv: install.argv,
        uninstallArgv: uninstall.argv,
        notes: ["Windows Task Scheduler logon task. WSL users should prefer the Linux unit inside WSL."],
      };
    }
    default:
      return {
        platform: "unsupported",
        files: [],
        installCommands: [],
        uninstallCommands: [],
        installArgv: [],
        uninstallArgv: [],
        notes: ["Unsupported platform — use `mordomo start` manually."],
      };
  }
}
