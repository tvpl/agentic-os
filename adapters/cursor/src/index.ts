import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SpawnPolicy,
  type AgentAdapter,
  type AgentRun,
  type AuthStatus,
  type DetectionResult,
  type HealthStatus,
  type ModelOption,
  type RunEvent,
  type SafeInvocation,
  type ValidationResult,
  type AdapterFactoryOptions,
} from "@mordomo/core";
import { executeInvocation, findExecutable, parseHelpFlags, type LineParser } from "@mordomo/core/internal";
import { cursorManifest } from "./manifest.js";

/**
 * Cursor Agent adapter — headless (`cursor-agent -p`) with stream-json output
 * when the installed version supports it (confirmed by --help probing).
 * Write runs pass --force (Cursor's explicit opt-in for applying changes
 * without interactive approval); read-only runs never do.
 *
 * Conversations: none. The installed `cursor-agent --help` advertises no
 * resume/continue flag, so the manifest declares `resume: "none"`; the run
 * manager then emulates the session (earlier turns folded into the prompt)
 * and never asks this adapter to resume. The warning below only fires for a
 * caller that bypasses the run manager.
 */
export { cursorManifest };

/** Factory used by the provider registry (`apps/api/src/providers.ts`). */
export const createCursorAdapter = (opts: AdapterFactoryOptions): AgentAdapter =>
  new CursorAdapter({
    binaryPath: opts.binaryPath,
    ...(opts.homeDir ? { homeDir: opts.homeDir } : {}),
    ...(opts.spawn ? { spawn: opts.spawn } : {}),
  });

export class CursorAdapter implements AgentAdapter {
  readonly id = "cursor" as const;
  readonly manifest = cursorManifest;
  private detection: DetectionResult | null = null;

  /** The engine's spawn policy; an adapter built alone allows only `node` and its own binary. */
  private readonly spawn: SpawnPolicy;

  constructor(
    private readonly opts: { binaryPath?: string | null; homeDir?: string; spawn?: SpawnPolicy } = {},
  ) {
    this.spawn = opts.spawn ?? new SpawnPolicy({ binaries: [cursorManifest.binary] });
  }

  private binary(): string {
    return this.opts.binaryPath ?? findExecutable("cursor-agent") ?? "cursor-agent";
  }

  async detect(): Promise<DetectionResult> {
    const binaryPath = this.opts.binaryPath ?? findExecutable("cursor-agent");
    if (!binaryPath) {
      return {
        installed: false,
        binaryPath: null,
        version: null,
        supportedFlags: [],
        notes: [
          cursorIdeInstalled()
            ? "Cursor (the editor) is installed but its terminal agent `cursor-agent` is not. Install it: curl https://cursor.com/install -fsS | bash"
            : "`cursor-agent` was not found on PATH or in the usual install folders. Install: curl https://cursor.com/install -fsS | bash",
        ],
      };
    }
    const notes: string[] = [];
    let version: string | null = null;
    let supportedFlags: string[] = [];
    try {
      const v = await this.spawn.probe(binaryPath, ["--version"], os.tmpdir());
      version = (v.stdout || v.stderr).trim().split("\n")[0] ?? null;
    } catch (err) {
      notes.push(`--version failed: ${(err as Error).message}`);
    }
    try {
      const h = await this.spawn.probe(binaryPath, ["--help"], os.tmpdir());
      supportedFlags = parseHelpFlags(h.stdout + h.stderr);
      if (!supportedFlags.includes("--print") && !supportedFlags.includes("-p")) {
        notes.push("Installed cursor-agent does not advertise --print; headless runs may fail.");
      }
      if (!supportedFlags.includes("--output-format")) {
        notes.push("No --output-format flag detected; falling back to plain text parsing.");
      }
    } catch (err) {
      notes.push(`--help probe failed: ${(err as Error).message}`);
    }
    this.detection = {
      installed: true,
      binaryPath,
      version,
      supportedFlags,
      notes,
    };
    return this.detection;
  }

  async authenticate(): Promise<AuthStatus> {
    const binaryPath = this.opts.binaryPath ?? findExecutable("cursor-agent");
    if (!binaryPath) return { authenticated: false, method: null, detail: "cursor-agent is not installed." };
    try {
      // `cursor-agent status` prints login state without exposing tokens.
      const res = await this.spawn.probe(binaryPath, ["status"], os.tmpdir());
      const out = (res.stdout + res.stderr).toLowerCase();
      // Negated status contains the positive substring: inspect it first.
      if (/not logged in|unauthenticated|not authenticated|login required/.test(out)) {
        return { authenticated: false, method: null, detail: "Not logged in. Run `cursor-agent login`." };
      }
      if (res.exitCode === 0 && /\blogged in\b|\bauthenticated\b/.test(out)) {
        return { authenticated: true, method: "session", detail: "cursor-agent reports an active login." };
      }
      return {
        authenticated: "unknown",
        method: null,
        detail: "Could not determine login state from `cursor-agent status`.",
      };
    } catch (err) {
      return {
        authenticated: "unknown",
        method: null,
        detail: `status probe failed: ${(err as Error).message}`,
      };
    }
  }

  async listModels(): Promise<ModelOption[]> {
    return [
      { id: "auto", label: "Auto (Cursor picks)", recommendedFor: "default" },
      { id: "sonnet-4.5", label: "Claude Sonnet (via Cursor)" },
      { id: "gpt-5", label: "GPT-5 (via Cursor)" },
      { id: "opus-4.1", label: "Claude Opus (via Cursor)" },
    ];
  }

  async validateConfig(): Promise<ValidationResult> {
    const issues: string[] = [];
    const detection = this.detection ?? (await this.detect());
    if (!detection.installed) issues.push("cursor-agent binary not found on PATH.");
    issues.push(...detection.notes);
    const auth = await this.authenticate();
    if (auth.authenticated === false) issues.push(auth.detail);
    return { ok: issues.length === 0, issues };
  }

  async buildInvocation(run: AgentRun): Promise<SafeInvocation> {
    const detection = this.detection ?? (await this.detect());
    const args: string[] = ["-p"];
    const hasStreamJson = detection.supportedFlags.includes("--output-format");
    if (hasStreamJson) args.push("--output-format", "stream-json");
    if (run.model && run.model !== "auto") args.push("--model", run.model);
    if (run.mode === "write" && detection.supportedFlags.includes("--force")) {
      args.push("--force");
    }
    // A prompt is never an option: a leading space keeps "-…" from being parsed as a flag.
    args.push(run.prompt.startsWith("-") ? ` ${run.prompt}` : run.prompt);
    return {
      executable: this.binary(),
      args,
      env: {},
      description: `cursor-agent -p (${run.mode}, model=${run.model ?? "auto"})`,
    };
  }

  execute(run: AgentRun): AsyncIterable<RunEvent> {
    const build = (r: AgentRun) => this.buildInvocation(r);
    const canResume = this.manifest.capabilities.resume !== "none";
    return (async function* () {
      if (run.resume?.providerSessionId && !canResume) {
        yield {
          type: "text",
          ts: Date.now(),
          stream: "stderr",
          text: "[mordomo] resumeSupported: false — cursor-agent has no resume flag; starting a fresh conversation.",
        } as RunEvent;
      }
      if (run.mode === "read_only") {
        // cursor-agent has no sandbox flag; constrain via the prompt contract
        // and never pass --force, so changes are not auto-applied.
        run = {
          ...run,
          prompt: `${run.prompt}\n\nIMPORTANT: this is a READ-ONLY run. Do not modify, create or delete any file outside ${run.artifactsDir}.`,
        };
      }
      const invocation = await build(run);
      yield* executeInvocation(run, invocation, cursorStreamParser(), [invocation.executable]);
    })();
  }

  async healthCheck(): Promise<HealthStatus> {
    const detection = await this.detect();
    const auth = detection.installed
      ? await this.authenticate()
      : { authenticated: false as const, method: null, detail: "not installed" };
    return {
      ok: detection.installed && auth.authenticated === true,
      installed: detection.installed,
      authenticated: auth.authenticated,
      version: detection.version,
      detail: detection.installed ? auth.detail : detection.notes.join(" "),
      checkedAt: Date.now(),
    };
  }
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Best-effort usage from a cursor-agent JSON line: a `usage` block on the
 * message or on the result (`input_tokens`/`output_tokens`, or camelCase).
 * Returns null when nothing usable is present — Cursor often reports none.
 */
export function parseCursorUsage(
  raw: unknown,
): { inputTokens: number; outputTokens: number; cacheReadTokens: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  const input = u.input_tokens ?? u.inputTokens ?? u.prompt_tokens;
  const output = u.output_tokens ?? u.outputTokens ?? u.completion_tokens;
  if (input == null && output == null) return null;
  return {
    inputTokens: num(input),
    outputTokens: num(output),
    cacheReadTokens: num(u.cache_read_input_tokens ?? u.cachedTokens),
  };
}

/** Cursor stream-json closely mirrors Claude Code's; parse defensively. Exported for tests. */
export function cursorStreamParser(): LineParser {
  let lastText = "";
  const usageEvent = (
    ts: number,
    scope: "turn" | "total",
    parsed: NonNullable<ReturnType<typeof parseCursorUsage>>,
    model: unknown,
  ): RunEvent => ({
    type: "usage",
    ts,
    scope,
    ...parsed,
    costUsd: null,
    ...(typeof model === "string" ? { model } : {}),
  });
  return {
    parseLine(line: string): RunEvent[] | null {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return null;
      }
      // Valid JSON that is not an object (`null`, a number, an array) is a banner, not a message: show it as text.
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      const obj = parsed as Record<string, unknown>;
      const ts = Date.now();
      const type = obj.type as string;
      if (type === "assistant") {
        const message = obj.message as { content?: unknown; usage?: unknown; model?: unknown } | undefined;
        const events: RunEvent[] = [];
        const turn = parseCursorUsage(message?.usage ?? obj.usage);
        if (turn) events.push(usageEvent(ts, "turn", turn, message?.model ?? obj.model));
        // `content` and its blocks come from the CLI: only an array of objects is read.
        const content: unknown[] = Array.isArray(message?.content) ? message.content : [];
        for (const item of content) {
          if (item === null || typeof item !== "object") continue;
          const block = item as Record<string, unknown>;
          if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
            lastText = block.text;
            events.push({ type: "assistant", ts, text: block.text });
          } else if (block.type === "tool_use" || block.type === "tool_call") {
            events.push({
              type: "tool_use",
              ts,
              tool: String(block.name ?? block.tool ?? "tool"),
              detail: JSON.stringify(block.input ?? block.args ?? {}).slice(0, 400),
            });
          }
        }
        return events;
      }
      if (type === "result") {
        if (typeof obj.result === "string") lastText = obj.result;
        const total = parseCursorUsage(obj.usage);
        return total ? [usageEvent(ts, "total", total, obj.model)] : [];
      }
      if (type === "system") return [];
      // Unknown JSON shape: surface something readable.
      const text = typeof obj.text === "string" ? obj.text : null;
      if (text) {
        lastText = text;
        return [{ type: "assistant", ts, text }];
      }
      return [];
    },
    summarize(stdout: string): string {
      return (lastText || stdout.slice(-2000)).slice(0, 2000);
    },
  };
}

/** Exposed for tests. */
export function cursorConfigDir(homeDir?: string): string {
  return path.join(homeDir ?? os.homedir(), ".cursor");
}
export function hasCursorCliConfig(homeDir?: string): boolean {
  return fs.existsSync(path.join(cursorConfigDir(homeDir), "cli.json"));
}

/** The Cursor editor itself (not the agent CLI) — a hint that the user is a Cursor user. */
export function cursorIdeInstalled(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): boolean {
  const candidates =
    platform === "darwin"
      ? ["/Applications/Cursor.app", path.join(home, "Applications", "Cursor.app")]
      : platform === "win32"
        ? [
            path.join(
              env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"),
              "Programs",
              "cursor",
              "Cursor.exe",
            ),
          ]
        : [
            "/usr/bin/cursor",
            "/usr/local/bin/cursor",
            "/opt/cursor",
            path.join(home, ".local", "bin", "cursor"),
          ];
  const present = candidates.some((c) => {
    try {
      fs.statSync(c);
      return true;
    } catch {
      return false;
    }
  });
  return present || findExecutable("cursor", env) !== null;
}
