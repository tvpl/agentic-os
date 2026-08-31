import os from "node:os";
import path from "node:path";
import type { MordomoPaths } from "../paths.js";

/**
 * OS scheduler integration: generates the unit/plist/task definitions that keep
 * the MordomoOS service alive at login so the internal scheduler is always on.
 * Files are GENERATED and shown to the user; installing them is approval-gated
 * (create_startup_service) and done by the CLI with the user's confirmation.
 */

export interface StartupServicePlan {
  platform: "linux" | "darwin" | "win32" | "unsupported";
  files: Array<{ path: string; content: string }>;
  installCommands: string[];
  uninstallCommands: string[];
  notes: string[];
}

export function planStartupService(paths: MordomoPaths, nodePath: string): StartupServicePlan {
  const serverEntry = path.join(paths.home, "apps", "api", "dist", "cli.js");
  switch (process.platform) {
    case "linux": {
      const unitPath = path.join(os.homedir(), ".config", "systemd", "user", "mordomo.service");
      return {
        platform: "linux",
        files: [
          {
            path: unitPath,
            content: `[Unit]
Description=MordomoOS local service
After=default.target

[Service]
ExecStart=${nodePath} ${serverEntry} start --foreground
Restart=on-failure
RestartSec=5
Environment=MORDOMO_HOME=${paths.home}

[Install]
WantedBy=default.target
`,
          },
        ],
        installCommands: [
          "systemctl --user daemon-reload",
          "systemctl --user enable --now mordomo.service",
        ],
        uninstallCommands: [
          "systemctl --user disable --now mordomo.service",
          `rm -f ${unitPath}`,
          "systemctl --user daemon-reload",
        ],
        notes: ["Uses systemd user units — no root required. `loginctl enable-linger $USER` keeps it running while logged out."],
      };
    }
    case "darwin": {
      const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", "com.mordomo.service.plist");
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
    <string>${nodePath}</string>
    <string>${serverEntry}</string>
    <string>start</string>
    <string>--foreground</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>MORDOMO_HOME</key><string>${paths.home}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${path.join(paths.logs, "service.out.log")}</string>
  <key>StandardErrorPath</key><string>${path.join(paths.logs, "service.err.log")}</string>
</dict>
</plist>
`,
          },
        ],
        installCommands: [`launchctl load -w ${plistPath}`],
        uninstallCommands: [`launchctl unload -w ${plistPath}`, `rm -f ${plistPath}`],
        notes: ["launchd user agent — starts at login, restarts on crash."],
      };
    }
    case "win32": {
      const scriptPath = path.join(paths.config, "mordomo-task.ps1");
      return {
        platform: "win32",
        files: [
          {
            path: scriptPath,
            content: `# Registers MordomoOS as a logon task (run in an elevated-or-not PowerShell)
$action = New-ScheduledTaskAction -Execute "${nodePath}" -Argument '"${serverEntry}" start --foreground'
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "MordomoOS" -Action $action -Trigger $trigger -Description "MordomoOS local service"
`,
          },
        ],
        installCommands: [`powershell -ExecutionPolicy Bypass -File ${scriptPath}`],
        uninstallCommands: [`powershell -Command "Unregister-ScheduledTask -TaskName MordomoOS -Confirm:$false"`],
        notes: ["Windows Task Scheduler logon task. WSL users should prefer the Linux unit inside WSL."],
      };
    }
    default:
      return { platform: "unsupported", files: [], installCommands: [], uninstallCommands: [], notes: ["Unsupported platform — use `mordomo start` manually."] };
  }
}
