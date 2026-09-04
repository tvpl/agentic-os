#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs, type ParseArgsConfig } from "node:util";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  createBackup,
  listBackups,
  restoreBackup,
  generateRouters,
  planStartupService,
  recall,
  recordRecall,
  DEFAULT_EXCLUDES,
  detectTimezone,
  EffortLevel,
  ProviderId,
  type IndexStats,
  type IndexProgress,
  type Settings,
} from "@mordomo/core";
import { AppContext } from "./context.js";
import { PKG_VERSION } from "./routes/system.js";
import { servePermissionTool } from "./mcp/permission.js";
import { httpApi, serveMordomoMcp } from "./mcp/mordomo.js";
import { startServer } from "./server.js";
import { runDoctor } from "./doctor.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(here, "cli.js");

/** Exit codes: 0 ok · 1 runtime failure · 2 usage error (bad flag/argument). */
const EXIT_USAGE = 2;
const SERVICE_LOG_MAX_BYTES = 5 * 1024 * 1024;

// ------------------------------------------------------------ arguments ----

const COMMANDS = [
  "setup",
  "doctor",
  "start",
  "stop",
  "status",
  "backup",
  "restore",
  "uninstall",
  "index",
  "sync",
  "run",
  "service",
  "recall",
  "mcp",
  "help",
] as const;
type Command = (typeof COMMANDS)[number];

/** Every option the CLI knows, typed once; each command opts into a subset. */
const OPTION_SPECS = {
  help: { type: "boolean", short: "h" },
  json: { type: "boolean" },
  defaults: { type: "boolean" },
  foreground: { type: "boolean" },
  list: { type: "boolean" },
  "include-artifacts": { type: "boolean" },
  purge: { type: "boolean" },
  yes: { type: "boolean", short: "y" },
  apply: { type: "boolean" },
  diff: { type: "boolean" },
  approve: { type: "string", multiple: true },
  provider: { type: "string" },
  model: { type: "string" },
  effort: { type: "string" },
  input: { type: "string", multiple: true },
} as const satisfies ParseArgsConfig["options"];
type OptionName = keyof typeof OPTION_SPECS;

const COMMAND_OPTIONS: Record<Command, readonly OptionName[]> = {
  setup: ["defaults"],
  doctor: ["json"],
  start: ["foreground"],
  stop: [],
  status: ["json"],
  backup: ["list", "include-artifacts"],
  restore: [],
  uninstall: ["purge", "yes"],
  index: ["json"],
  sync: ["apply", "approve", "diff"],
  run: ["provider", "model", "effort", "input", "json"],
  service: ["yes"],
  recall: ["json"],
  mcp: [],
  help: [],
};

export interface CliArgs {
  command: Command;
  positionals: string[];
  help: boolean;
  json: boolean;
  defaults: boolean;
  foreground: boolean;
  list: boolean;
  includeArtifacts: boolean;
  purge: boolean;
  yes: boolean;
  apply: boolean;
  diff: boolean;
  approve: string[];
  provider: ProviderId | undefined;
  model: string | undefined;
  effort: EffortLevel | undefined;
  inputs: Record<string, string>;
}

class UsageError extends Error {}

function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value);
}

/**
 * Parse `process.argv`-style arguments with `node:util.parseArgs`.
 * Throws `UsageError` for unknown commands/options, missing values and enum
 * violations (`--provider`, `--effort`) so the caller can exit with code 2.
 */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  let values: Record<string, unknown>;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: [...argv],
      options: OPTION_SPECS,
      allowPositionals: true,
      strict: true,
    }));
  } catch (err) {
    throw new UsageError((err as Error).message.replace(/\.$/, ""));
  }

  const [first = "help", ...rest] = positionals;
  const help = values.help === true;
  if (!isCommand(first)) {
    if (help) return { ...emptyArgs("help"), help: true };
    throw new UsageError(`Unknown command "${first}". Commands: ${COMMANDS.join(", ")}`);
  }
  const command = first;

  const allowed = new Set<string>([...COMMAND_OPTIONS[command], "help"]);
  for (const name of Object.keys(values)) {
    if (!allowed.has(name)) {
      throw new UsageError(`Option --${name} is not valid for "mordomo ${command}"`);
    }
  }

  let provider: ProviderId | undefined;
  if (values.provider !== undefined) {
    const parsed = ProviderId.safeParse(values.provider);
    if (!parsed.success) {
      throw new UsageError(
        `Invalid --provider "${String(values.provider)}". Expected one of: ${ProviderId.options.join(", ")}`,
      );
    }
    provider = parsed.data;
  }
  let effort: EffortLevel | undefined;
  if (values.effort !== undefined) {
    const parsed = EffortLevel.safeParse(values.effort);
    if (!parsed.success) {
      throw new UsageError(
        `Invalid --effort "${String(values.effort)}". Expected one of: ${EffortLevel.options.join(", ")}`,
      );
    }
    effort = parsed.data;
  }
  const inputs: Record<string, string> = {};
  for (const raw of (values.input as string[] | undefined) ?? []) {
    const eq = raw.indexOf("=");
    if (eq <= 0) throw new UsageError(`Invalid --input "${raw}". Expected key=value`);
    inputs[raw.slice(0, eq)] = raw.slice(eq + 1);
  }

  return {
    command,
    positionals: rest,
    help,
    json: values.json === true,
    defaults: values.defaults === true,
    foreground: values.foreground === true,
    list: values.list === true,
    includeArtifacts: values["include-artifacts"] === true,
    purge: values.purge === true,
    yes: values.yes === true,
    apply: values.apply === true,
    diff: values.diff === true,
    approve: (values.approve as string[] | undefined) ?? [],
    provider,
    model: values.model as string | undefined,
    effort,
    inputs,
  };
}

function emptyArgs(command: Command): CliArgs {
  return {
    command,
    positionals: [],
    help: false,
    json: false,
    defaults: false,
    foreground: false,
    list: false,
    includeArtifacts: false,
    purge: false,
    yes: false,
    apply: false,
    diff: false,
    approve: [],
    provider: undefined,
    model: undefined,
    effort: undefined,
    inputs: {},
  };
}

// -------------------------------------------------------------- pidfile ----

export interface PidInfo {
  pid: number;
  port: number;
  startedAt: number;
  /** Executable that started the service (`process.execPath`). */
  argv0?: string;
  /** Random per-boot token so two pidfiles are never confused. */
  token?: string;
}

function pidFilePath(ctx: Pick<AppContext, "paths">): string {
  return path.join(ctx.paths.run, "server.pid");
}

function writePidFile(ctx: Pick<AppContext, "paths">, port: number): PidInfo {
  const info: PidInfo = {
    pid: process.pid,
    port,
    startedAt: Date.now(),
    argv0: process.execPath,
    token: crypto.randomBytes(8).toString("hex"),
  };
  fs.mkdirSync(ctx.paths.run, { recursive: true });
  fs.writeFileSync(pidFilePath(ctx), JSON.stringify(info));
  return info;
}

/**
 * Run the first candidate executable that exists and exits 0, without relying on PATH
 * (services and tests may run with a minimal one). Returns trimmed stdout or null.
 */
function firstOutput(candidates: string[], args: string[], timeout: number): string | null {
  for (const bin of candidates) {
    try {
      const res = spawnSync(bin, args, { encoding: "utf8", timeout, windowsHide: true });
      if (res.error || res.status !== 0) continue;
      const text = res.stdout.trim();
      if (text.length > 0) return text;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

const PS_CANDIDATES = ["/bin/ps", "/usr/bin/ps", "ps"];
const POWERSHELL_CANDIDATES = [
  path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  ),
  "powershell.exe",
];

/** Process start time in epoch ms via `ps -o lstart=` (POSIX), or null when unavailable. */
function processStartTime(pid: number): number | null {
  if (process.platform === "win32") return null;
  const text = firstOutput(PS_CANDIDATES, ["-o", "lstart=", "-p", String(pid)], 2000);
  if (text === null) return null;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Command line of `pid`, or null when the platform gives us no way to read it.
 * Linux: procfs. macOS/BSD: `ps -o command=`. Windows: a CIM query via PowerShell.
 */
function processCommandLine(pid: number): string | null {
  if (process.platform === "linux") {
    try {
      return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
    } catch {
      /* /proc unavailable (container, hardened kernel) — fall back to ps below */
    }
  }
  if (process.platform === "win32") {
    return firstOutput(
      POWERSHELL_CANDIDATES,
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`,
      ],
      10_000,
    );
  }
  return firstOutput(PS_CANDIDATES, ["-o", "command=", "-p", String(pid)], 2000);
}

/**
 * Does `info.pid` still belong to the MordomoOS service that wrote the pidfile?
 * A bare `kill(pid, 0)` is not enough: PIDs are recycled, so a stale pidfile
 * could point at an unrelated process. The command line is the primary check
 * on every platform; the process start time (POSIX) is the fallback.
 */
export function isServiceProcess(info: PidInfo): boolean {
  if (!Number.isInteger(info.pid) || info.pid <= 0) return false;
  try {
    process.kill(info.pid, 0);
  } catch {
    return false;
  }
  const cmdline = processCommandLine(info.pid);
  if (cmdline !== null) return cmdline.includes("cli.js");
  const started = processStartTime(info.pid);
  if (started !== null && Number.isFinite(info.startedAt)) {
    // The process must predate its own pidfile (1 s tolerance: `lstart` has second granularity).
    return started <= info.startedAt + 1000;
  }
  return true;
}

function readPidInfo(ctx: Pick<AppContext, "paths">): PidInfo | null {
  try {
    const info = JSON.parse(fs.readFileSync(pidFilePath(ctx), "utf8")) as PidInfo;
    if (typeof info.pid !== "number") return null;
    return isServiceProcess(info) ? info : null;
  } catch {
    return null;
  }
}

/** Keep `service.out.log` bounded: when it grows past `maxBytes`, move it to `.1` (one generation). */
export function rotateLogIfNeeded(file: string, maxBytes = SERVICE_LOG_MAX_BYTES): boolean {
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return false;
  }
  if (size <= maxBytes) return false;
  const rotated = `${file}.1`;
  try {
    fs.rmSync(rotated, { force: true });
    fs.renameSync(file, rotated);
    return true;
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------- main ----

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(pc.red(`mordomo: ${err.message}`));
      console.error(`Run ${pc.bold("mordomo --help")} for usage.`);
      process.exit(EXIT_USAGE);
    }
    throw err;
  }
  if (args.help || args.command === "help") {
    printHelp();
    return;
  }
  switch (args.command) {
    case "setup":
      return cmdSetup(args);
    case "doctor":
      return cmdDoctor(args);
    case "start":
      return cmdStart(args);
    case "stop":
      return cmdStop();
    case "status":
      return cmdStatus(args);
    case "backup":
      return cmdBackup(args);
    case "restore":
      return cmdRestore(args);
    case "uninstall":
      return cmdUninstall(args);
    case "index":
      return cmdIndex(args);
    case "sync":
      return cmdSync(args);
    case "run":
      return cmdRun(args);
    case "service":
      return cmdService(args);
    case "recall":
      return cmdRecall(args);
    case "mcp":
      return cmdMcp(args);
    default:
      printHelp();
  }
}

function printHelp(): void {
  console.log(`
${pc.bold("MordomoOS")} — local agentic OS over Claude Code, Cursor Agent and Codex

  mordomo setup            Guided, idempotent configuration (add --defaults for non-interactive)
  mordomo doctor           Full diagnostic (providers, auth, index, routines, security) (--json)
  mordomo start            Start the local service + Command Centre (add --foreground to stay attached)
  mordomo stop             Stop the local service
  mordomo status           Service status (--json)
  mordomo index            Re-index the workspace and regenerate memory routers
  mordomo sync [dir]       Compile canonical skills/routers to provider-native files
                           (--apply to write, --diff to show conflicts, --approve <file> per conflict)
  mordomo run <skill>      Run a skill headlessly (--provider ${ProviderId.options.join("|")}, --model <m>,
                           --effort ${EffortLevel.options.join("|")}, --input k=v ...)
  mordomo recall <question>  Layered memory retrieval: only the sections worth reading (--json)
  mordomo mcp              Serve MordomoOS as an MCP server (stdio) to Claude/Cursor/Codex
  mordomo backup           Create a backup (--list to list, --include-artifacts to include outputs)
  mordomo restore <name>   Restore a backup (a safety backup is taken first)
  mordomo service          Startup service: mordomo service install | remove | plan  (--yes skips confirmation)
  mordomo uninstall        Remove services/processes; data is PRESERVED unless you pass --purge
                           (--purge asks for confirmation; add --yes when not attached to a terminal)

  Exit codes: 0 ok · 1 failure · 2 usage error
`);
}

// ---------------------------------------------------------------- setup ----
async function cmdSetup(args: CliArgs): Promise<void> {
  const ctx = new AppContext();
  const nonInteractive = args.defaults || !process.stdout.isTTY;
  p.intro(pc.bgBlue(pc.white(" MordomoOS setup ")));

  p.log.info(
    `Environment: ${process.platform}/${process.arch} · Node ${process.versions.node} · home: ${ctx.paths.home}`,
  );
  let settings = ctx.settings();

  // 1. Provider detection (read-only; --help capability probing; no tokens shown)
  const spinner = p.spinner();
  spinner.start("Detecting Claude Code, Cursor Agent and Codex…");
  const detections = {} as Record<
    ProviderId,
    { installed: boolean; version: string | null; auth: string; notes: string[] }
  >;
  for (const id of ProviderId.options) {
    const det = await ctx.adapters[id].detect();
    const auth = det.installed ? await ctx.adapters[id].authenticate() : null;
    detections[id] = {
      installed: det.installed,
      version: det.version,
      auth: auth ? `${String(auth.authenticated)}${auth.method ? ` (${auth.method})` : ""}` : "n/a",
      notes: det.notes,
    };
    if (det.binaryPath) settings.providers[id].binaryPath = det.binaryPath;
  }
  spinner.stop("Provider detection finished");
  for (const id of ProviderId.options) {
    const d = detections[id];
    p.log.message(
      `${d.installed ? pc.green("●") : pc.red("○")} ${pc.bold(id.padEnd(6))} ${
        d.installed ? `${d.version ?? "installed"} · auth: ${d.auth}` : "not installed"
      }${d.notes.length ? pc.dim(` · ${d.notes[0]}`) : ""}`,
    );
  }

  if (nonInteractive) {
    for (const id of ProviderId.options) {
      settings.providers[id].enabled = settings.providers[id].enabled || detections[id].installed;
    }
    if (!settings.providers[settings.defaultProvider].enabled) {
      const firstEnabled = ProviderId.options.find((i) => settings.providers[i].enabled);
      if (firstEnabled) settings.defaultProvider = firstEnabled;
    }
    // A stored (or defaulted) "UTC" means nobody ever chose a zone: use the
    // machine's, so the clock and the routines agree after `setup --defaults`.
    if (!settings.timezone || settings.timezone === "UTC") settings.timezone = detectTimezone();
    settings.setupCompleted = true;
    settings = ctx.settingsStore.save(settings);
    p.log.success(`Applied defaults (non-interactive mode). Timezone: ${settings.timezone}.`);
  } else {
    // 2. Enable providers
    const enabled = await p.multiselect({
      message: "Which providers do you want enabled?",
      options: ProviderId.options.map((id) => ({
        value: id,
        label: `${id}${detections[id].installed ? "" : " (not installed — can be enabled later)"}`,
      })),
      initialValues: ProviderId.options.filter(
        (id) => settings.providers[id].enabled || detections[id].installed,
      ),
      required: true,
    });
    if (p.isCancel(enabled)) return cancel();
    const enabledIds = enabled as ProviderId[];
    for (const id of ProviderId.options) {
      settings.providers[id].enabled = enabledIds.includes(id);
    }

    // 3. Default provider
    const def = await p.select({
      message: "Default provider?",
      options: enabledIds.map((id) => ({ value: id, label: id })),
      initialValue: enabledIds.includes(settings.defaultProvider) ? settings.defaultProvider : enabledIds[0],
    });
    if (p.isCancel(def)) return cancel();
    settings.defaultProvider = def as ProviderId;

    // 4. Model + effort per provider
    for (const id of enabledIds) {
      const models = await ctx.adapters[id].listModels();
      const model = await p.select({
        message: `Default model for ${id}?`,
        options: [
          { value: "", label: "(provider default)" },
          ...models.map((m) => ({
            value: m.id,
            label: `${m.label}${m.recommendedFor ? pc.dim(` — ${m.recommendedFor}`) : ""}`,
          })),
        ],
        initialValue: settings.providers[id].defaultModel ?? "",
      });
      if (p.isCancel(model)) return cancel();
      settings.providers[id].defaultModel = (model as string) || null;
      const effort = await p.select({
        message: `Default effort/reasoning for ${id}?`,
        options: [
          { value: "default", label: "provider default" },
          { value: "low", label: "low" },
          { value: "medium", label: "medium" },
          { value: "high", label: "high" },
        ],
        initialValue: settings.providers[id].defaultEffort,
      });
      if (p.isCancel(effort)) return cancel();
      settings.providers[id].defaultEffort = effort as EffortLevel;
    }

    // 5. Folders to index
    const currentFolders = settings.indexedFolders.map((f) => f.path).join(", ") || "(none)";
    const foldersRaw = await p.text({
      message: `Folders to index for the Second Brain (comma-separated absolute paths). Current: ${currentFolders}`,
      placeholder: "/home/you/workspace, /home/you/documents  — empty keeps current",
      defaultValue: "",
    });
    if (p.isCancel(foldersRaw)) return cancel();
    if ((foldersRaw as string).trim()) {
      const areaNames = settings.areas;
      settings.indexedFolders = [];
      for (const raw of (foldersRaw as string)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)) {
        if (!fs.existsSync(raw)) {
          p.log.warn(`Skipping non-existent folder: ${raw}`);
          continue;
        }
        const area = await p.select({
          message: `Area for ${raw}?`,
          options: [{ value: "", label: "(no area)" }, ...areaNames.map((a) => ({ value: a, label: a }))],
        });
        if (p.isCancel(area)) return cancel();
        settings.indexedFolders.push({
          path: path.resolve(raw),
          area: (area as string) || null,
          enabled: true,
        });
      }
    }

    // 6. Exclusions
    const extraExcludes = await p.text({
      message: `Extra exclusion patterns (comma-separated). Defaults already cover: ${DEFAULT_EXCLUDES.slice(0, 8).join(", ")}…`,
      defaultValue: "",
    });
    if (p.isCancel(extraExcludes)) return cancel();
    const extras = (extraExcludes as string)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    settings.excludes = [...new Set([...settings.excludes, ...extras])];

    // 7. Identity
    const name = await p.text({
      message: "System name?",
      defaultValue: settings.systemName,
      placeholder: settings.systemName,
    });
    if (p.isCancel(name)) return cancel();
    settings.systemName = (name as string) || settings.systemName;
    const theme = await p.select({
      message: "Theme?",
      options: [
        { value: "dark", label: "Dark (default)" },
        { value: "light", label: "Light" },
        { value: "system", label: "Follow system" },
      ],
      initialValue: settings.theme,
    });
    if (p.isCancel(theme)) return cancel();
    settings.theme = theme as Settings["theme"];
    const lang = await p.select({
      message: "Interface language?",
      options: [
        { value: "en", label: "English" },
        { value: "pt-BR", label: "Português (Brasil)" },
      ],
      initialValue: settings.language,
    });
    if (p.isCancel(lang)) return cancel();
    settings.language = lang as Settings["language"];
    const port = await p.text({
      message: "Local port?",
      defaultValue: String(settings.port),
      placeholder: String(settings.port),
    });
    if (p.isCancel(port)) return cancel();
    const portNum = Number(port as string);
    if (Number.isInteger(portNum) && portNum >= 1024 && portNum <= 65535) settings.port = portNum;
    const tz = await p.text({
      message: "Timezone for routines?",
      defaultValue: settings.timezone === "UTC" ? detectTimezone() : settings.timezone,
      placeholder: detectTimezone(),
    });
    if (p.isCancel(tz)) return cancel();
    settings.timezone = (tz as string) || settings.timezone;

    settings.setupCompleted = true;
    settings = ctx.settingsStore.save(settings);
    p.log.success(`Settings saved to ${ctx.paths.settingsFile}`);

    // 8. Optional smoke tests (read-only, no file changes)
    const doSmoke = await p.confirm({
      message: "Run a safe read-only smoke test for each enabled provider now?",
      initialValue: true,
    });
    if (!p.isCancel(doSmoke) && doSmoke) {
      for (const id of ProviderId.options) {
        if (!settings.providers[id].enabled) continue;
        if (!detections[id].installed) {
          p.log.warn(`${id}: skipped (not installed)`);
          continue;
        }
        const s2 = p.spinner();
        s2.start(`Smoke-testing ${id}…`);
        try {
          const run = ctx.runs.create({
            origin: "manual",
            provider: id,
            prompt: "Smoke test",
            cwd: ctx.paths.home,
            model: settings.providers[id].defaultModel,
            effort: "low",
            mode: "read_only",
            timeoutMs: 180_000,
            profile: "read_only",
          });
          const rec = await ctx.runs.execute(
            run.id,
            "Smoke test: reply with exactly MORDOMO_OK and do nothing else. Do not read or write any file.",
            "read_only",
          );
          if (rec.status === "done") s2.stop(`${id}: ${pc.green("OK")} (${rec.durationMs} ms)`);
          else s2.stop(`${id}: ${pc.red(rec.status)} — ${rec.error ?? ""}`);
        } catch (err) {
          s2.stop(`${id}: ${pc.red("failed")} — ${(err as Error).message}`);
        }
      }
    }

    // 9. Autostart (approval-gated)
    const auto = await p.confirm({
      message:
        "Configure automatic start at login? (creates an OS startup service — nothing is installed without this approval)",
      initialValue: settings.autostart,
    });
    if (!p.isCancel(auto) && auto) {
      await installStartupService(ctx, true);
      ctx.settingsStore.update({ autostart: true });
    } else if (!p.isCancel(auto)) {
      ctx.settingsStore.update({ autostart: false });
    }
  }

  // 10. Index + routers (both modes)
  const s3 = p.spinner();
  s3.start("Indexing workspace and generating memory routers…");
  const stats = await runIndex(ctx, (msg) => s3.message(msg));
  generateRouters(ctx.db, ctx.paths, ctx.settings());
  s3.stop(`Indexed ${stats.scanned} files (+${stats.added} new) · routers written to memory/`);

  // 11. Final diagnostic
  const report = await runDoctor(ctx);
  p.log.message(pc.bold("Diagnostic:"));
  for (const check of report.checks) {
    p.log.message(` ${statusIcon(check.status)} ${check.label.padEnd(20)} ${pc.dim(check.detail)}`);
  }
  p.outro(
    `Setup complete. Start with ${pc.bold("mordomo start")} → http://127.0.0.1:${ctx.settings().port}  (re-run setup anytime; it never destroys data)`,
  );
  ctx.close();
}

function cancel(): void {
  p.cancel("Setup cancelled — nothing was destroyed. Run `mordomo setup` again anytime.");
  process.exit(1);
}

function statusIcon(status: "ok" | "warn" | "fail" | "skip"): string {
  return status === "ok"
    ? pc.green("✔")
    : status === "warn"
      ? pc.yellow("!")
      : status === "fail"
        ? pc.red("✘")
        : pc.dim("−");
}

// --------------------------------------------------------------- doctor ----
async function cmdDoctor(args: CliArgs): Promise<void> {
  const ctx = new AppContext();
  const report = await runDoctor(ctx);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(pc.bold(`\nMordomoOS doctor — ${new Date(report.generatedAt).toLocaleString()}\n`));
    for (const check of report.checks) {
      console.log(` ${statusIcon(check.status)} ${check.label.padEnd(22)} ${check.detail}`);
    }
    console.log(
      `\n ${pc.green(`${report.ok} ok`)} · ${pc.yellow(`${report.warn} warn`)} · ${pc.red(`${report.fail} fail`)}\n`,
    );
  }
  ctx.close();
  process.exit(report.fail > 0 ? 1 : 0);
}

// ---------------------------------------------------------------- start ----
async function cmdStart(args: CliArgs): Promise<void> {
  if (args.foreground) {
    const handle = await startServer();
    // The server writes a minimal pidfile; enrich it with identity so `status`/`stop`
    // can tell a recycled PID from the real service.
    writePidFile(handle.ctx, handle.ctx.settings().port);
    console.log(`[mordomo] ${handle.ctx.settings().systemName} running at ${handle.url}`);
    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      handle
        .close()
        .then(() => process.exit(0))
        .catch((err: unknown) => {
          console.error(pc.red(`[mordomo] shutdown failed: ${(err as Error).message}`));
          process.exit(1);
        });
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return; // keep process alive
  }
  const ctx = new AppContext();
  const existing = readPidInfo(ctx);
  if (existing) {
    console.log(`Already running (pid ${existing.pid}) at http://127.0.0.1:${existing.port}`);
    ctx.close();
    return;
  }
  const logFile = path.join(ctx.paths.logs, "service.out.log");
  fs.mkdirSync(ctx.paths.logs, { recursive: true });
  rotateLogIfNeeded(logFile);
  const out = fs.openSync(logFile, "a");
  const child = spawn(process.execPath, [CLI_PATH, "start", "--foreground"], {
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, MORDOMO_HOME: ctx.paths.home },
  });
  child.unref();
  fs.closeSync(out);
  const port = ctx.settings().port;
  // Wait briefly for the pidfile to confirm a healthy boot.
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (readPidInfo(ctx)) break;
  }
  const info = readPidInfo(ctx);
  if (info) console.log(`${pc.green("●")} MordomoOS started (pid ${info.pid}) → http://127.0.0.1:${port}`);
  else console.log(`${pc.red("✘")} Service did not report healthy — check ${logFile}`);
  ctx.close();
}

async function cmdStop(): Promise<void> {
  const ctx = new AppContext();
  const info = readPidInfo(ctx);
  if (!info) {
    console.log("Not running.");
    ctx.close();
    return;
  }
  process.kill(info.pid, "SIGTERM");
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (!readPidInfo(ctx)) break;
  }
  console.log(readPidInfo(ctx) ? `${pc.yellow("!")} Still stopping…` : `${pc.green("●")} Stopped.`);
  ctx.close();
}

async function cmdStatus(args: CliArgs): Promise<void> {
  const ctx = new AppContext();
  const info = readPidInfo(ctx);
  const s = ctx.settings();
  if (args.json) {
    console.log(
      JSON.stringify({
        running: info !== null,
        pid: info?.pid ?? null,
        port: info?.port ?? s.port,
        startedAt: info?.startedAt ?? null,
        url: `http://127.0.0.1:${info?.port ?? s.port}`,
      }),
    );
  } else if (info) {
    console.log(
      `${pc.green("●")} running · pid ${info.pid} · http://127.0.0.1:${info.port} · since ${new Date(info.startedAt).toLocaleString()}`,
    );
  } else {
    console.log(`${pc.dim("○")} stopped · configured port ${s.port}`);
  }
  ctx.close();
}

// --------------------------------------------------------------- backup ----
async function cmdBackup(args: CliArgs): Promise<void> {
  const ctx = new AppContext();
  if (args.list) {
    for (const b of listBackups(ctx.paths)) {
      console.log(
        `${b.name}  ${(b.sizeBytes / 1024).toFixed(1)} KB  ${new Date(b.createdAt).toLocaleString()}`,
      );
    }
    ctx.close();
    return;
  }
  const info = await createBackup(ctx.paths, ctx.db, { includeArtifacts: args.includeArtifacts });
  console.log(`${pc.green("●")} Backup created: ${info.path} (${(info.sizeBytes / 1024).toFixed(1)} KB)`);
  ctx.close();
}

async function cmdRestore(args: CliArgs): Promise<void> {
  const name = args.positionals[0];
  if (!name) {
    console.error("Usage: mordomo restore <backup-name>   (see: mordomo backup --list)");
    process.exit(EXIT_USAGE);
  }
  const ctx = new AppContext();
  const running = readPidInfo(ctx);
  if (running) {
    console.error("Stop the service first: mordomo stop");
    ctx.close();
    process.exit(1);
  }
  const paths = ctx.paths;
  ctx.close(); // release the DB before overwriting it
  const result = restoreBackup(paths, name);
  console.log(
    `${pc.green("●")} Restored ${name}. A safety backup of the previous state is at ${result.safetyBackup.path}`,
  );
}

// ------------------------------------------------------------ uninstall ----
async function cmdUninstall(args: CliArgs): Promise<void> {
  const ctx = new AppContext();
  const info = readPidInfo(ctx);
  if (info) {
    process.kill(info.pid, "SIGTERM");
    console.log("Stopped the running service.");
  }
  const plan = planStartupService(ctx.paths, process.execPath);
  const unitInstalled = plan.files.some((f) => fs.existsSync(f.path));
  if (unitInstalled) {
    console.log("A startup service is installed. Remove it with:");
    for (const cmd of plan.uninstallCommands) console.log(`  ${cmd}`);
  }
  if (!args.purge) {
    console.log(`
${pc.green("Data preserved.")} MordomoOS keeps by default:
  · your skills, routines, connectors and memory routers (they are your files)
  · config/ (settings, database, backups), logs/ and artifacts/

To remove EVERYTHING this installation created, run: ${pc.bold("mordomo uninstall --purge")}
To remove the code too, simply delete the repository folder afterwards.`);
    ctx.close();
    return;
  }
  const paths = ctx.paths;
  ctx.close();
  if (!args.yes) {
    if (!process.stdin.isTTY) {
      console.error(
        pc.red(
          "Refusing to purge without confirmation: stdin is not a terminal. Re-run with --yes to confirm.",
        ),
      );
      process.exit(EXIT_USAGE);
    }
    const sure = await p.confirm({
      message: `PERMANENTLY delete config/, logs/ and artifacts/ under ${paths.home}? Skills/routines/connectors files are kept.`,
      initialValue: false,
    });
    if (p.isCancel(sure) || !sure) {
      console.log("Aborted. Nothing was deleted.");
      return;
    }
  }
  for (const dir of [paths.config, paths.logs, paths.artifacts]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(
    `${pc.green("●")} Purged config/, logs/ and artifacts/. Skills, routines and connectors files were preserved.`,
  );
}

// ---------------------------------------------------------------- index ----

function describeProgress(progress: IndexProgress): string {
  const parts = [
    `${progress.scanned} scanned`,
    `+${progress.added}`,
    `~${progress.updated}`,
    `-${progress.removed}`,
  ];
  if (typeof progress.total === "number")
    parts.unshift(`${Math.round((progress.scanned / Math.max(1, progress.total)) * 100)}%`);
  return parts.join(" ");
}

/** The sliced, non-blocking indexer with a progress spinner. */
function runIndex(ctx: AppContext, onMessage?: (message: string) => void): Promise<IndexStats> {
  return ctx.indexer.indexAllAsync((progress) => {
    if (onMessage) onMessage(`Indexing… ${describeProgress(progress)}`);
  });
}

async function cmdIndex(args: CliArgs): Promise<void> {
  const ctx = new AppContext();
  const spinner = args.json || !process.stdout.isTTY ? null : p.spinner();
  spinner?.start("Indexing workspace…");
  const stats = await runIndex(ctx, (msg) => spinner?.message(msg));
  generateRouters(ctx.db, ctx.paths, ctx.settings());
  const summary = `Indexed: ${stats.scanned} scanned, +${stats.added} added, ~${stats.updated} updated, -${stats.removed} removed, ${stats.skippedExcluded} excluded (${stats.durationMs} ms). Routers regenerated.`;
  if (spinner) spinner.stop(summary);
  else if (args.json) console.log(JSON.stringify(stats));
  else console.log(`${pc.green("●")} ${summary}`);
  ctx.close();
}

// --------------------------------------------------------------- recall ----

/** `mordomo recall "<question>"`: the same layered retrieval as GET /api/memory/recall, offline (no token needed). */
/**
 * `mordomo mcp` serves MordomoOS to the CLIs as an MCP server (recall, skills,
 * journal, facts, inbox) over stdio; `mordomo mcp permission` is the
 * permission prompt tool the API wires into write runs.
 */
async function cmdMcp(args: CliArgs): Promise<void> {
  const sub = args.positionals[0] ?? "serve";
  if (sub === "permission") {
    await servePermissionTool(PKG_VERSION);
    return;
  }
  const ctx = new AppContext();
  try {
    const settings = ctx.settings();
    const api = httpApi(process.env.MORDOMO_URL ?? `http://127.0.0.1:${settings.port}`, ctx.token());
    await serveMordomoMcp(api, PKG_VERSION);
  } finally {
    ctx.close();
  }
}

async function cmdRecall(args: CliArgs): Promise<void> {
  const question = args.positionals.join(" ").trim();
  if (!question) {
    console.error(pc.red('Usage: mordomo recall "<question>" [--json]'));
    process.exit(EXIT_USAGE);
  }
  const ctx = new AppContext();
  try {
    const result = recall(ctx.db, ctx.paths, ctx.settings(), question);
    recordRecall(ctx.db, result);
    if (args.json) {
      console.log(JSON.stringify(result));
      return;
    }
    console.log(
      `${pc.bold("recall")} keywords: ${result.keywords.join(", ") || "(none)"} · ${result.candidatesConsidered} candidates scored, ${result.opened} opened, ~${result.tokensEstimate} tokens`,
    );
    if (result.answerContext.length === 0)
      console.log(pc.dim("No indexed section matched. Run `mordomo index` if the workspace changed."));
    for (const c of result.answerContext) {
      console.log(`\n${pc.green("●")} ${c.path} § ${pc.bold(c.section)} ${pc.dim(`(score ${c.score})`)}`);
      console.log(pc.dim(`  why: ${c.why}`));
      console.log(
        c.excerpt
          .split("\n")
          .map((l) => `  ${l}`)
          .join("\n"),
      );
    }
  } finally {
    ctx.close();
  }
}

// ----------------------------------------------------------------- sync ----
async function cmdSync(args: CliArgs): Promise<void> {
  const ctx = new AppContext();
  const target = args.positionals[0] ?? ctx.paths.home;
  const plan = ctx.sync.plan(path.resolve(target));
  console.log(pc.bold(`Sync plan for ${plan.targetDir}:`));
  for (const action of plan.actions) {
    const color =
      action.kind === "create"
        ? pc.green
        : action.kind === "update"
          ? pc.cyan
          : action.kind === "conflict"
            ? pc.red
            : pc.dim;
    console.log(` ${color(action.kind.padEnd(9))} ${action.filePath} ${pc.dim(action.reason)}`);
    if (action.kind === "conflict" && args.diff && action.diff) {
      console.log(pc.dim(action.diff.split("\n").slice(0, 30).join("\n")));
    }
  }
  if (!args.apply) {
    console.log(
      `\nDry run. Apply with: mordomo sync ${target} --apply` +
        (plan.conflicts ? "  (conflicts need --approve <file>)" : ""),
    );
    ctx.close();
    return;
  }
  const result = ctx.sync.apply(plan, args.approve);
  console.log(`${pc.green("●")} Wrote ${result.written.length} file(s).`);
  if (result.backupDir) console.log(`  Overwritten files were backed up to ${result.backupDir}`);
  if (result.skippedConflicts.length) {
    console.log(`${pc.yellow("!")} Skipped conflicts (approve individually with --approve <file>):`);
    for (const f of result.skippedConflicts) console.log(`   ${f}`);
  }
  ctx.close();
}

// ------------------------------------------------------------------ run ----
async function cmdRun(args: CliArgs): Promise<void> {
  const slug = args.positionals[0];
  if (!slug) {
    console.error(
      `Usage: mordomo run <skill-slug> [--provider ${ProviderId.options.join("|")}] [--model m] [--effort ${EffortLevel.options.join("|")}] [--input key=value]...`,
    );
    process.exit(EXIT_USAGE);
  }
  const ctx = new AppContext();
  const skill = ctx.skills.load(slug);
  if (!skill) {
    console.error(
      `Unknown skill: ${slug}. Available: ${ctx.skills
        .list()
        .map((s) => s.slug)
        .join(", ")}`,
    );
    ctx.close();
    process.exit(1);
  }
  const settings = ctx.settings();
  const provider = args.provider ?? settings.defaultProvider;
  const run = ctx.runs.create({
    origin: "skill",
    provider,
    prompt: `(skill: ${slug})`,
    cwd: ctx.paths.home,
    model: args.model ?? skill.recommendedModel ?? settings.providers[provider].defaultModel,
    effort: args.effort ?? skill.recommendedEffort,
    mode: skill.mode === "write" ? "write" : "read_only",
    timeoutMs: settings.limits.defaultTimeoutMs,
    profile: skill.mode === "write" ? settings.securityProfile : "read_only",
    skillSlug: slug,
  });
  if (!args.json) console.log(`${pc.cyan("▶")} Running ${skill.name} via ${provider} (run ${run.id})…`);
  const prompt = ctx.skills.buildRunPrompt(skill, args.inputs, path.join(ctx.paths.artifacts, run.id));
  const unsubscribe = args.json
    ? () => undefined
    : ctx.runs.onEvent(run.id, (event) => {
        if (event.type === "assistant") console.log(pc.dim(event.text.split("\n")[0]!.slice(0, 120)));
        if (event.type === "tool_use") console.log(pc.dim(`  ⚙ ${event.tool}`));
      });
  const record = await ctx.runs.execute(run.id, prompt, skill.mode === "write" ? "write" : "read_only");
  unsubscribe();
  if (args.json) {
    console.log(JSON.stringify(record));
  } else if (record.status === "done") {
    console.log(`${pc.green("●")} Done in ${record.durationMs} ms.`);
    for (const artifact of record.artifacts) console.log(`  📄 ${path.join(ctx.paths.artifacts, artifact)}`);
  } else {
    console.log(`${pc.red("✘")} ${record.status}: ${record.error ?? ""}`);
  }
  ctx.close();
  process.exit(record.status === "done" ? 0 : 1);
}

// -------------------------------------------------------------- service ----
async function cmdService(args: CliArgs): Promise<void> {
  const ctx = new AppContext();
  const sub = args.positionals[0] ?? "plan";
  const plan = planStartupService(ctx.paths, process.execPath);
  if (sub === "plan") {
    console.log(pc.bold(`Startup service plan (${plan.platform}):`));
    for (const f of plan.files) console.log(`  file: ${f.path}`);
    for (const c of plan.installCommands) console.log(`  install: ${c}`);
    for (const n of plan.notes) console.log(pc.dim(`  note: ${n}`));
  } else if (sub === "install") {
    await installStartupService(ctx, !args.yes);
  } else if (sub === "remove") {
    for (const f of plan.files) {
      if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
    }
    console.log("Service files removed. Also run:");
    for (const c of plan.uninstallArgv.filter((argv) => argv[0] !== "rm")) console.log(`  ${c.join(" ")}`);
    ctx.settingsStore.update({ autostart: false });
  } else {
    console.error(`Unknown subcommand "${sub}". Use: mordomo service install | remove | plan`);
    ctx.close();
    process.exit(EXIT_USAGE);
  }
  ctx.close();
}

async function installStartupService(ctx: AppContext, interactive: boolean): Promise<void> {
  const plan = planStartupService(ctx.paths, process.execPath);
  if (plan.platform === "unsupported") {
    console.log("Startup services are not supported on this platform.");
    return;
  }
  console.log(pc.bold("This will create:"));
  for (const f of plan.files) console.log(`  ${f.path}`);
  console.log("And run:");
  for (const c of plan.installCommands) console.log(`  ${c}`);
  if (interactive && process.stdout.isTTY) {
    const ok = await p.confirm({ message: "Proceed?", initialValue: true });
    if (p.isCancel(ok) || !ok) {
      console.log("Skipped. You can do it later with: mordomo service install");
      return;
    }
  }
  for (const f of plan.files) {
    fs.mkdirSync(path.dirname(f.path), { recursive: true });
    fs.writeFileSync(f.path, f.content, "utf8");
  }
  for (const argv of plan.installArgv) {
    const [exe, ...cmdArgs] = argv;
    if (!exe) continue;
    const code = await new Promise<number | null>((resolve, reject) => {
      const res = spawn(exe, cmdArgs, { stdio: "inherit" });
      res.on("error", reject);
      res.on("close", resolve);
    });
    if (code !== 0) {
      console.error(pc.yellow(`!`) + ` "${argv.join(" ")}" exited with code ${String(code)}`);
    }
  }
  console.log(`${pc.green("●")} Startup service installed.`);
}

main().catch((err: unknown) => {
  const command = process.argv[2] ?? "help";
  console.error(pc.red(`mordomo ${command}: ${(err as Error).message}`));
  process.exit(1);
});
