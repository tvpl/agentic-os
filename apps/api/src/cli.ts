#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { parseArgs, type ParseArgsConfig } from "node:util";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { type Settings } from "@mordomo/core";
import {
  createBackup,
  inspectRestoreState,
  isSealed,
  resolvePaths,
  SettingsStore,
  type RestoreState,
  listBackups,
  restoreBackup,
  generateRouters,
  isStartupServiceInstalled,
  planStartupService,
  recall,
  recordRecall,
  DEFAULT_EXCLUDES,
  detectTimezone,
  EffortLevel,
  ProviderSettingsSchema,
  type IndexStats,
  type IndexProgress,
  ensureSigningKeys,
  publishRegistry,
  type MordomoPaths,
  type ProviderId,
  type ProviderSettings,
} from "@mordomo/core/internal";
import { AppContext } from "./context.js";
import { cliEntry } from "./entry.js";
import { buildProviderRegistry } from "./providers.js";
import {
  installedBuildTime,
  isOlderService,
  listServiceProcesses,
  orphanProcesses,
  probeServer,
  terminate,
} from "./instances.js";
import { PKG_VERSION } from "./routes/system.js";
import { servePermissionTool } from "./mcp/permission.js";
import { httpApi, serveMordomoMcp } from "./mcp/mordomo.js";
import {
  LAUNCH_SECRET_MIN_LENGTH,
  PortInUseError,
  startServer,
  takeLaunchSecret,
  type SidecarOptions,
} from "./server.js";
import { EngineLockedError } from "@mordomo/core";
import { runDoctor } from "./doctor.js";

const CLI_PATH = cliEntry();

/**
 * Exit codes: 0 ok · 1 runtime failure · 2 usage error (bad flag/argument) · 3 the home is blocked by a leftover ·
 * 4 another MordomoOS service holds the home (`--sidecar` only) · 5 the port asked of `--sidecar` is taken.
 */
const EXIT_USAGE = 2;
const EXIT_HOME_BLOCKED = 3;
const EXIT_HOME_IN_USE = 4;
const EXIT_PORT_BUSY = 5;
/** Errors that mean the home itself cannot be used until a person clears something by hand. */
const HOME_BLOCKED_CODES = new Set(["restore_leftover", "restore_recovery_failed", "restore_lock_unusable"]);
/** The registered providers, in registration order (the only valid `--provider` values). */
const PROVIDER_IDS = buildProviderRegistry().ids();
const SERVICE_LOG_MAX_BYTES = 5 * 1024 * 1024;

// ------------------------------------------------------------ arguments ----

const COMMANDS = [
  "setup",
  "doctor",
  "start",
  "stop",
  "restart",
  "launch",
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
  "skills",
  "version",
  "help",
] as const;
type Command = (typeof COMMANDS)[number];

/** Every option the CLI knows, typed once; each command opts into a subset. */
const OPTION_SPECS = {
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
  sidecar: { type: "boolean" },
  port: { type: "string" },
  json: { type: "boolean" },
  defaults: { type: "boolean" },
  foreground: { type: "boolean" },
  "no-browser": { type: "boolean" },
  list: { type: "boolean" },
  "include-artifacts": { type: "boolean" },
  "allow-unverified": { type: "boolean" },
  purge: { type: "boolean" },
  yes: { type: "boolean", short: "y" },
  apply: { type: "boolean" },
  diff: { type: "boolean" },
  approve: { type: "string", multiple: true },
  provider: { type: "string" },
  model: { type: "string" },
  effort: { type: "string" },
  input: { type: "string", multiple: true },
  out: { type: "string" },
  "base-url": { type: "string" },
  name: { type: "string" },
  unsigned: { type: "boolean" },
} as const satisfies ParseArgsConfig["options"];
type OptionName = keyof typeof OPTION_SPECS;

const COMMAND_OPTIONS: Record<Command, readonly OptionName[]> = {
  setup: ["defaults"],
  doctor: ["json"],
  start: ["foreground", "sidecar", "port"],
  stop: [],
  restart: [],
  launch: ["no-browser"],
  status: ["json"],
  backup: ["list", "include-artifacts"],
  restore: ["allow-unverified"],
  uninstall: ["purge", "yes"],
  index: ["json"],
  sync: ["apply", "approve", "diff"],
  run: ["provider", "model", "effort", "input", "json"],
  service: ["yes"],
  recall: ["json"],
  mcp: [],
  skills: ["out", "base-url", "name", "unsigned", "json"],
  version: [],
  help: [],
};

export interface CliArgs {
  command: Command;
  positionals: string[];
  help: boolean;
  version: boolean;
  /** `start`: run as a desktop shell's service (docs/release.md); `port` is then the port to ask for. */
  sidecar: boolean;
  port: number | undefined;
  json: boolean;
  defaults: boolean;
  foreground: boolean;
  noBrowser: boolean;
  list: boolean;
  includeArtifacts: boolean;
  allowUnverified: boolean;
  purge: boolean;
  yes: boolean;
  apply: boolean;
  diff: boolean;
  approve: string[];
  provider: ProviderId | undefined;
  model: string | undefined;
  effort: EffortLevel | undefined;
  inputs: Record<string, string>;
  out: string | undefined;
  baseUrl: string | undefined;
  name: string | undefined;
  unsigned: boolean;
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
export function parseCliArgs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): CliArgs {
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
  const version = values.version === true;
  if (!isCommand(first)) {
    if (version) return { ...emptyArgs("version"), version: true };
    if (help) return { ...emptyArgs("help"), help: true };
    throw new UsageError(`Unknown command "${first}". Commands: ${COMMANDS.join(", ")}`);
  }
  const command = first;

  const allowed = new Set<string>([...COMMAND_OPTIONS[command], "help", "version"]);
  for (const name of Object.keys(values)) {
    if (!allowed.has(name)) {
      throw new UsageError(`Option --${name} is not valid for "mordomo ${command}"`);
    }
  }

  let provider: ProviderId | undefined;
  if (values.provider !== undefined) {
    if (typeof values.provider !== "string" || !PROVIDER_IDS.includes(values.provider)) {
      throw new UsageError(
        `Invalid --provider "${String(values.provider)}". Expected one of: ${PROVIDER_IDS.join(", ")}`,
      );
    }
    provider = values.provider;
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
  let port: number | undefined;
  if (values.port !== undefined) {
    const text = String(values.port);
    port = /^\d{1,5}$/.test(text) ? Number(text) : Number.NaN;
    if (!(port >= 0 && port <= 65535))
      throw new UsageError(
        `Invalid --port "${text}". Expected a number from 0 to 65535 (0 lets the system choose)`,
      );
    if (values.sidecar !== true) throw new UsageError("--port is only valid with --sidecar");
  }
  if (values.sidecar === true) {
    const secret = env.MORDOMO_LAUNCH_TOKEN ?? "";
    if (secret.length < LAUNCH_SECRET_MIN_LENGTH)
      throw new UsageError(
        `--sidecar needs MORDOMO_LAUNCH_TOKEN in the environment, ${LAUNCH_SECRET_MIN_LENGTH} characters or more`,
      );
    if (values.foreground !== true) throw new UsageError("--sidecar is only valid with --foreground");
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
    version,
    sidecar: values.sidecar === true,
    port,
    json: values.json === true,
    defaults: values.defaults === true,
    foreground: values.foreground === true,
    noBrowser: values["no-browser"] === true,
    list: values.list === true,
    includeArtifacts: values["include-artifacts"] === true,
    allowUnverified: values["allow-unverified"] === true,
    purge: values.purge === true,
    yes: values.yes === true,
    apply: values.apply === true,
    diff: values.diff === true,
    approve: (values.approve as string[] | undefined) ?? [],
    out: values.out as string | undefined,
    baseUrl: values["base-url"] as string | undefined,
    name: values.name as string | undefined,
    unsigned: values.unsigned === true,
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
    version: false,
    sidecar: false,
    port: undefined,
    json: false,
    defaults: false,
    foreground: false,
    noBrowser: false,
    list: false,
    includeArtifacts: false,
    allowUnverified: false,
    purge: false,
    yes: false,
    apply: false,
    diff: false,
    approve: [],
    provider: undefined,
    model: undefined,
    effort: undefined,
    inputs: {},
    out: undefined,
    baseUrl: undefined,
    name: undefined,
    unsigned: false,
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
  // Source checkout runs `cli.js`; a packaged install runs the single bundle.
  if (cmdline !== null) return cmdline.includes(path.basename(CLI_PATH)) || cmdline.includes("cli.js");
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
  if (args.version || args.command === "version") {
    console.log(`mordomo ${PKG_VERSION}`);
    return;
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
    case "restart":
      return cmdRestart();
    case "launch":
      return cmdLaunch(args);
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
    case "skills":
      return cmdSkills(args);
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
                           For a desktop shell: --foreground --sidecar --port <n|0> with MORDOMO_LAUNCH_TOKEN set;
                           prints MORDOMO_READY {json} when it listens and shuts down when stdin closes
  mordomo stop             Stop the local service
  mordomo restart          Restart the local service (also the login service, after an update)
  mordomo launch           Start if needed and open the Command Centre in the browser (--no-browser)
  mordomo status           Service status (--json)
  mordomo index            Re-index the workspace and regenerate memory routers
  mordomo sync [dir]       Compile canonical skills/routers to provider-native files
                           (--apply to write, --diff to show conflicts, --approve <file> per conflict)
  mordomo skills publish [dir] --out <registry-dir> [--base-url <url>] [--name <n>] [--unsigned]
                           Build a signed skill registry (index.json + files) from a skills folder
  mordomo skills key       Print this machine's registry signing public key
  mordomo run <skill>      Run a skill headlessly (--provider ${PROVIDER_IDS.join("|")}, --model <m>,
                           --effort ${EffortLevel.options.join("|")}, --input k=v ...)
  mordomo recall <question>  Layered memory retrieval: only the sections worth reading (--json)
  mordomo mcp              Serve MordomoOS as an MCP server (stdio) to Claude/Cursor/Codex
  mordomo backup           Create a backup (--list to list, --include-artifacts to include outputs)
  mordomo restore <name>   Restore a backup after checking it against its manifest (a safety backup is
                           taken first; --allow-unverified restores one made before backups were sealed)
  mordomo service          Startup service: mordomo service install | remove | plan  (--yes skips confirmation)
  mordomo version          Print the version (also: mordomo --version, mordomo -v)
  mordomo uninstall        Remove services/processes; data is PRESERVED unless you pass --purge
                           (--purge asks for confirmation; add --yes when not attached to a terminal)

  Exit codes: 0 ok · 1 failure · 2 usage error · 3 home blocked · 4 home held by another service and 5 port taken (--sidecar)
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
  const prefsOf = (id: ProviderId): ProviderSettings =>
    (settings.providers[id] ??= ProviderSettingsSchema.parse({}));

  // 1. Provider detection (read-only; --help capability probing; no tokens shown)
  const spinner = p.spinner();
  spinner.start("Detecting Claude Code, Cursor Agent and Codex…");
  const detections = {} as Record<
    ProviderId,
    { installed: boolean; version: string | null; auth: string; notes: string[] }
  >;
  for (const id of ctx.providers.ids()) {
    const det = await ctx.adapters[id]!.detect();
    const auth = det.installed ? await ctx.adapters[id]!.authenticate() : null;
    detections[id] = {
      installed: det.installed,
      version: det.version,
      auth: auth ? `${String(auth.authenticated)}${auth.method ? ` (${auth.method})` : ""}` : "n/a",
      notes: det.notes,
    };
    if (det.binaryPath) prefsOf(id).binaryPath = det.binaryPath;
  }
  spinner.stop("Provider detection finished");
  for (const id of ctx.providers.ids()) {
    const d = detections[id]!;
    p.log.message(
      `${d.installed ? pc.green("●") : pc.red("○")} ${pc.bold(id.padEnd(6))} ${
        d.installed ? `${d.version ?? "installed"} · auth: ${d.auth}` : "not installed"
      }${d.notes.length ? pc.dim(` · ${d.notes[0]}`) : ""}`,
    );
  }

  if (nonInteractive) {
    for (const id of ctx.providers.ids()) {
      prefsOf(id).enabled = prefsOf(id).enabled || detections[id]!.installed;
    }
    if (!settings.providers[settings.defaultProvider]?.enabled) {
      const firstEnabled = ctx.providers.ids().find((i) => prefsOf(i).enabled);
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
      options: ctx.providers.ids().map((id) => ({
        value: id,
        label: `${id}${detections[id]!.installed ? "" : " (not installed — can be enabled later)"}`,
      })),
      initialValues: ctx.providers.ids().filter((id) => prefsOf(id).enabled || detections[id]!.installed),
      required: true,
    });
    if (p.isCancel(enabled)) return cancel();
    const enabledIds = enabled as ProviderId[];
    for (const id of ctx.providers.ids()) {
      prefsOf(id).enabled = enabledIds.includes(id);
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
      const models = await ctx.adapters[id]!.listModels();
      const model = await p.select({
        message: `Default model for ${id}?`,
        options: [
          { value: "", label: "(provider default)" },
          ...models.map((m) => ({
            value: m.id,
            label: `${m.label}${m.recommendedFor ? pc.dim(` — ${m.recommendedFor}`) : ""}`,
          })),
        ],
        initialValue: prefsOf(id).defaultModel ?? "",
      });
      if (p.isCancel(model)) return cancel();
      prefsOf(id).defaultModel = (model as string) || null;
      const effort = await p.select({
        message: `Default effort/reasoning for ${id}?`,
        options: [
          { value: "default", label: "provider default" },
          { value: "low", label: "low" },
          { value: "medium", label: "medium" },
          { value: "high", label: "high" },
        ],
        initialValue: prefsOf(id).defaultEffort,
      });
      if (p.isCancel(effort)) return cancel();
      prefsOf(id).defaultEffort = effort as EffortLevel;
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
      for (const id of ctx.providers.ids()) {
        if (!prefsOf(id).enabled) continue;
        if (!detections[id]!.installed) {
          p.log.warn(`${id}: skipped (not installed)`);
          continue;
        }
        const s2 = p.spinner();
        s2.start(`Smoke-testing ${id}…`);
        try {
          const { run: rec } = await ctx.execution.smokeTest(id, null);
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

// ------------------------------------------------- a home that is blocked ----

/**
 * What `doctor`, `status`, `stop` and `backup --list` say about a home a restore left in a state nothing may
 * continue over. They do not build the engine for it (building it recovers, and refuses): they look, read-only, and
 * explain step by step, with the full paths a person at the terminal needs.
 */
function homeBlockedLines(home: string, state: RestoreState): string[] {
  return [
    `${pc.red("✘")} The MordomoOS home (${home}) cannot be used until this is cleared by hand. Nothing was changed.`,
    ...state.blockers.map((b) => `    · ${b.name}: ${b.reason}\n      ${b.folder}`),
    "  What to do:",
    "    1. Make sure no MordomoOS process is running (`mordomo stop` works even now).",
    "    2. For a .restore-… folder: open it. MAPA.txt (when there) says which thing of the home each old-N is.",
    "       old-N with no JOURNAL.json can be the leftover of a restore that FINISHED: if your files are the",
    "       restored ones, delete the folder (the originals are also in the safety backup the restore made, the",
    "       newest in config/backups). If the restore did NOT finish, move each old-N back over its line of",
    "       MAPA.txt, or restore that safety backup, then delete the folder.",
    "    3. For config/run/restore.lock: delete the file (only with no MordomoOS process running).",
    "    4. Run the command again.",
  ];
}

/** The blockers of the home, printed (to `stderr`, or into a JSON report by the caller); `null` when none. */
function blockedHome(paths: MordomoPaths): { state: RestoreState; lines: string[] } | null {
  const state = inspectRestoreState(paths);
  return state.blockers.length > 0 ? { state, lines: homeBlockedLines(paths.home, state) } : null;
}

// --------------------------------------------------------------- doctor ----
async function cmdDoctor(args: CliArgs): Promise<void> {
  const blocked = blockedHome(resolvePaths());
  if (blocked) {
    // The checks need the engine, and the engine cannot be built over this: report it as the one failing check.
    const detail = blocked.state.blockers.map((b) => `${b.name}: ${b.reason}`).join("; ");
    if (args.json) {
      const checks = [{ id: "restore-state", label: "Restore leftovers", status: "fail" as const, detail }];
      const count = (status: string) => checks.filter((c) => c.status === status).length;
      const totals = Object.fromEntries(["ok", "warn", "fail"].map((status) => [status, count(status)]));
      console.log(
        JSON.stringify(
          {
            checks,
            ...totals,
            generatedAt: Date.now(),
            blocked: true,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(pc.bold(`\nMordomoOS doctor — ${new Date().toLocaleString()}\n`));
      console.log(blocked.lines.join("\n") + "\n");
    }
    process.exit(EXIT_HOME_BLOCKED);
  }
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
  if (args.sidecar) return cmdSidecar(args);
  if (args.foreground) {
    const handle = await startServer();
    // The server writes a minimal pidfile; enrich it with identity so `status`/`stop`
    // can tell a recycled PID from the real service.
    writePidFile(handle.ctx, handle.ctx.settings().port);
    console.log(
      `[mordomo] ${handle.ctx.settings().systemName} running at ${handle.url}${handle.tlsUrl ? ` · remote: ${handle.tlsUrl}` : ""}`,
    );
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
  const info = await startDetached(ctx);
  if (info)
    console.log(`${pc.green("●")} MordomoOS started (pid ${info.pid}) → http://127.0.0.1:${info.port}`);
  else console.log(`${pc.red("✘")} Service did not report healthy — check ${serviceLogFile(ctx)}`);
  ctx.close();
}

/**
 * `start --foreground --sidecar`: the service a desktop shell starts and owns (docs/release.md, "The shell and its
 * service"). The shell's secret is in `MORDOMO_LAUNCH_TOKEN` (never in argv); the service listens on the port it
 * was asked for (0: the system's choice), never stops another service to get the home or the port, says
 * `MORDOMO_READY {json}` on stdout once it listens, and shuts down when its stdin closes: the shell's own exit,
 * clean or not, closes the pipe, so a service never outlives the window that was showing it.
 */
async function cmdSidecar(args: CliArgs): Promise<void> {
  const sidecar: SidecarOptions = {
    port: args.port ?? 0,
    // The secret is the shell's; a child of this service (a provider CLI) has no use for it.
    launchSecret: takeLaunchSecret(process.env),
  };
  let handle;
  try {
    handle = await startServer(undefined, sidecar);
  } catch (err) {
    if (err instanceof EngineLockedError) {
      console.error(
        `[mordomo] another MordomoOS service holds this home${err.holderPid === null ? "" : ` (pid ${err.holderPid})`}; stop it (mordomo stop) and open the app again`,
      );
      process.exit(EXIT_HOME_IN_USE);
    }
    if (err instanceof PortInUseError) {
      console.error(`[mordomo] ${err.message}`);
      process.exit(EXIT_PORT_BUSY);
    }
    throw err;
  }
  const port = handle.listeners.plain.port;
  writePidFile(handle.ctx, port);
  console.log(
    `MORDOMO_READY ${JSON.stringify({
      v: 1,
      pid: process.pid,
      port,
      version: PKG_VERSION,
      updatesCheck: handle.ctx.settings().updates.check,
    })}`,
  );
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
  // EOF (or a broken pipe) on stdin is the shell going away.
  process.stdin.on("end", shutdown);
  process.stdin.on("close", shutdown);
  process.stdin.on("error", shutdown);
  process.stdin.resume();
}

function serviceLogFile(ctx: Pick<AppContext, "paths">): string {
  return path.join(ctx.paths.logs, "service.out.log");
}

/** Spawn the foreground server as a detached child and wait for its pidfile (up to ~6 s). */
async function startDetached(ctx: Pick<AppContext, "paths">): Promise<PidInfo | null> {
  const logFile = serviceLogFile(ctx);
  fs.mkdirSync(ctx.paths.logs, { recursive: true });
  rotateLogIfNeeded(logFile);
  const out = fs.openSync(logFile, "a", 0o600);
  const child = spawn(process.execPath, [CLI_PATH, "start", "--foreground"], {
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, MORDOMO_HOME: ctx.paths.home },
  });
  child.unref();
  fs.closeSync(out);
  return waitForPidFile(ctx, 30);
}

async function waitForPidFile(ctx: Pick<AppContext, "paths">, ticks: number): Promise<PidInfo | null> {
  for (let i = 0; i < ticks; i++) {
    const info = readPidInfo(ctx);
    if (info) return info;
    await new Promise((r) => setTimeout(r, 200));
  }
  return readPidInfo(ctx);
}

/** Open `url` in the default browser; never throws (headless machines just print the URL). */
function openBrowser(url: string): boolean {
  const [exe, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(exe, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * What `launch` and `restart` need of the home: its paths and its settings. They start and stop a SERVICE; they
 * never use the database, so they do not build an engine (a second engine in a process that already has one would
 * open the same database file twice, and one that recovers a restore has no business in a command that only
 * starts a process).
 */
function lightContext(): { paths: MordomoPaths; settings: () => Settings; close: () => void } {
  const paths = resolvePaths();
  const store = new SettingsStore(paths);
  return { paths, settings: () => store.load(), close: () => undefined };
}

/**
 * `mordomo launch`: the double-click entry point of a packaged install. Starts
 * the service when nothing answers on the configured port, then opens the
 * Command Centre (the in-UI setup takes over on a fresh home).
 */
async function cmdLaunch(args: CliArgs): Promise<void> {
  const ctx = lightContext();
  const port = ctx.settings().port;
  const url = `http://127.0.0.1:${port}`;
  // An older build already answering is replaced before the window opens:
  // "open the app" must always mean "open this version of the app".
  const answering = await probeServer(port);
  if (answering && isOlderService(answering, installedBuildTime())) {
    console.log(
      `${pc.yellow("!")} An older MordomoOS build is running (pid file: ${readPidInfo(ctx)?.pid ?? "?"}); restarting it with the current build…`,
    );
    await cmdRestart({ keepOpen: true });
  }
  let running = readPidInfo(ctx) !== null || (await probeServer(port)) !== null;
  if (!running) {
    const info = await startDetached(ctx);
    running = info !== null || (await probeServer(port)) !== null;
  }
  if (!running) {
    console.log(`${pc.red("✘")} MordomoOS did not start — check ${serviceLogFile(ctx)}`);
    ctx.close();
    process.exit(1);
  }
  console.log(`${pc.green("●")} ${ctx.settings().systemName} is running at ${url}`);
  if (!args.noBrowser) {
    if (!openBrowser(url)) console.log(`Open ${url} in your browser.`);
  }
  ctx.close();
}

/**
 * `mordomo restart`: stop the running service and bring it back with the
 * current build. Under a login service (launchd/systemd/Task Scheduler) the
 * service manager restarts it; otherwise a fresh detached process is spawned.
 */
async function cmdRestart(opts: { keepOpen?: boolean } = {}): Promise<void> {
  const ctx = lightContext();
  const info = readPidInfo(ctx);
  const port = ctx.settings().port;
  // Leftover service processes (a lost port race, another checkout's build)
  // go first: the new service must not lose the port to one of them.
  const leftovers = orphanProcesses(listServiceProcesses(), info?.pid ?? null);
  if (leftovers.length > 0) {
    const stopped = await terminate(leftovers);
    if (stopped.length > 0)
      console.log(`${pc.yellow("!")} Stopped leftover service process(es): ${stopped.join(", ")}`);
  }
  if (!info) {
    const foreign = await probeServer(port);
    if (foreign && leftovers.length === 0) {
      console.log(
        `${pc.yellow("!")} ${foreign.name} ${foreign.version} answers on port ${port} but was not started from this home.\n` +
          `  Stop it where it was started (or with your login service manager), then run: mordomo start`,
      );
      ctx.close();
      if (opts.keepOpen) return;
      process.exit(1);
    }
    for (let i = 0; i < 40 && (await probeServer(port, 500)); i++)
      await new Promise((r) => setTimeout(r, 250));
  } else {
    try {
      process.kill(info.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
    for (let i = 0; i < 50; i++) {
      if (!readPidInfo(ctx)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (isStartupServiceInstalled(ctx.paths)) {
    const restarted = await waitForPidFile(ctx, 50);
    if (restarted && restarted.pid !== info?.pid) {
      console.log(
        `${pc.green("●")} Restarted by the login service (pid ${restarted.pid}) → http://127.0.0.1:${restarted.port}`,
      );
      ctx.close();
      return;
    }
  }
  const started = await startDetached(ctx);
  if (started)
    console.log(
      `${pc.green("●")} MordomoOS restarted (pid ${started.pid}) → http://127.0.0.1:${started.port}`,
    );
  else console.log(`${pc.red("✘")} Service did not report healthy — check ${serviceLogFile(ctx)}`);
  ctx.close();
}

async function cmdStop(): Promise<void> {
  // No engine: stopping must work when the home is blocked, and building one is not needed to read a pid file.
  const ctx = { paths: resolvePaths() };
  const info = readPidInfo(ctx);
  if (!info) {
    console.log("Not running.");
  } else {
    process.kill(info.pid, "SIGTERM");
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (!readPidInfo(ctx)) break;
    }
    console.log(readPidInfo(ctx) ? `${pc.yellow("!")} Still stopping…` : `${pc.green("●")} Stopped.`);
  }
  const blocked = blockedHome(ctx.paths);
  if (blocked) console.error(blocked.lines.join("\n"));
}

async function cmdStatus(args: CliArgs): Promise<void> {
  // No engine (it would recover, and refuse over a leftover): the pid file and the settings are all this reads.
  const ctx = { paths: resolvePaths() };
  const info = readPidInfo(ctx);
  const s = new SettingsStore(ctx.paths).load();
  const blocked = blockedHome(ctx.paths);
  const foreign = info ? null : await probeServer(s.port);
  if (args.json) {
    console.log(
      JSON.stringify({
        running: info !== null,
        /** Something answers on the port even though this home owns no pidfile. */
        reachable: info !== null || foreign !== null,
        pid: info?.pid ?? null,
        port: info?.port ?? s.port,
        startedAt: info?.startedAt ?? null,
        url: `http://127.0.0.1:${info?.port ?? s.port}`,
        ...(blocked
          ? { homeBlocked: blocked.state.blockers.map((b) => ({ name: b.name, reason: b.reason })) }
          : {}),
      }),
    );
  } else if (info) {
    console.log(
      `${pc.green("●")} running · pid ${info.pid} · http://127.0.0.1:${info.port} · since ${new Date(info.startedAt).toLocaleString()}`,
    );
  } else if (foreign) {
    console.log(
      `${pc.dim("○")} stopped (this home) · but ${foreign.name} ${foreign.version} answers on http://127.0.0.1:${s.port} — started from another home or by hand`,
    );
  } else {
    console.log(`${pc.dim("○")} stopped · configured port ${s.port}`);
  }
  if (blocked) {
    if (!args.json) console.error(blocked.lines.join("\n"));
    process.exit(EXIT_HOME_BLOCKED);
  }
}

// --------------------------------------------------------------- backup ----
async function cmdBackup(args: CliArgs): Promise<void> {
  if (args.list) {
    // No engine: a list is read from the folder, and must work whatever state a restore left the home in.
    const paths = resolvePaths();
    for (const b of listBackups(paths)) {
      console.log(
        `${b.name}  ${(b.sizeBytes / 1024).toFixed(1)} KB  ${new Date(b.createdAt).toLocaleString()}${isSealed(b.path) ? "" : "  unsealed"}`,
      );
    }
    const blocked = blockedHome(paths);
    if (blocked) {
      console.error(blocked.lines.join("\n"));
      process.exit(EXIT_HOME_BLOCKED);
    }
    return;
  }
  const ctx = new AppContext();
  const before = listBackups(ctx.paths).length;
  const info = await createBackup(ctx.paths, ctx.db, {
    bus: ctx.events,
    includeArtifacts: args.includeArtifacts,
    keep: ctx.settings().limits.backupRetention,
  });
  console.log(`${pc.green("●")} Backup created: ${info.path} (${(info.sizeBytes / 1024).toFixed(1)} KB)`);
  const removed = before + 1 - listBackups(ctx.paths).length;
  if (removed > 0) console.log(`removed ${removed} old backup(s)`);
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
  const result = restoreBackup(paths, name, { allowUnverified: args.allowUnverified });
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
  const plan = planStartupService(ctx.paths, process.execPath, process.platform, os.homedir(), CLI_PATH);
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
/**
 * `mordomo skills publish [dir]`: the producer side of the marketplace. Copies
 * every skill of `dir` (default: this home's skills/) into `--out`, writes
 * index.json with a SHA-256 per file and signs it with the key generated
 * once into config/registry-signing.json. `mordomo skills key` prints the
 * public key a consumer pins with `#key=` on the registry URL.
 */
async function cmdSkills(args: CliArgs): Promise<void> {
  const sub = args.positionals[0];
  const ctx = new AppContext();
  const paths = ctx.paths;
  try {
    await runSkillsCommand(args, sub, paths);
  } finally {
    ctx.close();
  }
}

async function runSkillsCommand(args: CliArgs, sub: string | undefined, paths: MordomoPaths): Promise<void> {
  if (sub === "key") {
    const keys = ensureSigningKeys(paths.config);
    console.log(args.json ? JSON.stringify({ publicKey: keys.publicKey }) : keys.publicKey);
    return;
  }
  if (sub !== "publish") {
    console.error(
      "Usage: mordomo skills publish [dir] --out <registry-dir> [--base-url <url>] [--name <n>] [--unsigned]\n       mordomo skills key",
    );
    process.exitCode = 2;
    return;
  }
  if (!args.out) {
    console.error(pc.red("--out <registry-dir> is required"));
    process.exitCode = 2;
    return;
  }
  const skillsDir = path.resolve(args.positionals[1] ?? paths.skills);
  const keys = args.unsigned ? undefined : ensureSigningKeys(paths.config);
  const result = publishRegistry({
    skillsDir,
    outDir: args.out,
    baseUrl: args.baseUrl,
    name: args.name,
    keys,
  });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(
    `${pc.green("●")} Published ${result.skills.length} skill(s) to ${result.indexFile}${result.signed ? " (signed)" : " (unsigned)"}`,
  );
  for (const s of result.skills) console.log(`  /${s.slug} v${s.version} · ${s.files} file(s)`);
  for (const k of result.skipped) console.log(pc.yellow(`  skipped ${k.dir}: ${k.reason}`));
  console.log(`\nRegistry URL for Settings › Memory › Registries:\n  ${result.registryUrl}`);
  if (result.signed)
    console.log(
      pc.dim("The #key= fragment pins your public key: consumers refuse an index signed by anyone else."),
    );
}

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
      `Usage: mordomo run <skill-slug> [--provider ${PROVIDER_IDS.join("|")}] [--model m] [--effort ${EffortLevel.options.join("|")}] [--input key=value]...`,
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
  if (!ctx.providers.has(provider)) {
    console.error(`Unknown provider "${provider}". Registered: ${PROVIDER_IDS.join(", ")}`);
    ctx.close();
    process.exit(EXIT_USAGE);
  }
  // The same write policy and the same rules as the Command Centre: refuse, park for approval, or run.
  let started;
  try {
    started = ctx.execution.startSkill({
      slug,
      inputs: args.inputs,
      provider,
      ...(args.model !== undefined ? { model: args.model } : {}),
      ...(args.effort !== undefined ? { effort: args.effort } : {}),
      startedBy: null,
    });
  } catch (err) {
    console.error(`${pc.red("✘")} ${(err as Error).message}`);
    ctx.close();
    process.exit(1);
  }
  if (started.pendingApproval) {
    if (args.json) {
      console.log(
        JSON.stringify({
          status: "waiting_approval",
          runId: started.runId,
          pendingApproval: started.pendingApproval,
        }),
      );
    } else {
      console.log(
        `${pc.yellow("◐")} Waiting for approval ${started.pendingApproval.id} (run ${started.runId}): approve it in the Command Centre; the run starts then.`,
      );
    }
    ctx.close();
    process.exit(0);
  }
  if (!args.json)
    console.log(`${pc.cyan("▶")} Running ${skill.name} via ${provider} (run ${started.runId})…`);
  const unsubscribe = args.json
    ? () => undefined
    : ctx.execution.subscribe(started.runId, (event) => {
        if (event.type === "assistant") console.log(pc.dim(event.text.split("\n")[0]!.slice(0, 120)));
        if (event.type === "tool_use") console.log(pc.dim(`  ⚙ ${event.tool}`));
      });
  const record = await ctx.execution.wait(started.runId);
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
  const plan = planStartupService(ctx.paths, process.execPath, process.platform, os.homedir(), CLI_PATH);
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
  const plan = planStartupService(ctx.paths, process.execPath, process.platform, os.homedir(), CLI_PATH);
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
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && HOME_BLOCKED_CODES.has(code)) {
    // The messages name the home's files from the home (they also go to an API client): the terminal gets the path.
    console.error(`Home: ${resolvePaths().home}`);
    process.exit(EXIT_HOME_BLOCKED);
  }
  process.exit(1);
});
