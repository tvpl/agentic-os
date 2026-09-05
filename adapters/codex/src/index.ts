import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  executeInvocation,
  findOnPath,
  parseHelpFlags,
  probe,
  type AgentAdapter,
  type AgentRun,
  type AuthStatus,
  type DetectionResult,
  type HealthStatus,
  type LineParser,
  type ModelOption,
  type RunEvent,
  type SafeInvocation,
  type ValidationResult,
  BUILTIN_MANIFESTS,
  type ProviderManifest,
  type AdapterFactoryOptions,
} from "@mordomo/core";

/**
 * OpenAI Codex CLI adapter — non-interactive `codex exec` with `--json` events.
 * Read-only runs use `--sandbox read-only`; write runs use
 * `--sandbox workspace-write`. `danger-full-access` is never used.
 *
 * Conversations are best effort: recent CLIs continue one with
 * `codex exec resume <session-id>` (manifest capability `resume:
 * "subcommand"`), which `detect()` confirms against the installed
 * `codex exec --help`. When the binary is older the run simply starts a fresh
 * conversation and says `resumeSupported: false` in a text event.
 */
export const codexManifest: ProviderManifest = BUILTIN_MANIFESTS.codex;

/** Factory used by the provider registry (`apps/api/src/providers.ts`). */
export const createCodexAdapter = (opts: AdapterFactoryOptions): AgentAdapter =>
  new CodexAdapter({ binaryPath: opts.binaryPath, ...(opts.homeDir ? { homeDir: opts.homeDir } : {}) });

export class CodexAdapter implements AgentAdapter {
  readonly id = "codex" as const;
  readonly manifest = codexManifest;
  private detection: DetectionResult | null = null;
  /** Whether the installed `codex exec` advertises the `resume` subcommand (set by detect()). */
  private resumeSupported = false;

  constructor(private readonly opts: { binaryPath?: string | null; homeDir?: string } = {}) {}

  private binary(): string {
    return this.opts.binaryPath ?? findOnPath("codex") ?? "codex";
  }

  async detect(): Promise<DetectionResult> {
    const binaryPath = this.opts.binaryPath ?? findOnPath("codex");
    if (!binaryPath) {
      return {
        installed: false,
        binaryPath: null,
        version: null,
        supportedFlags: [],
        notes: ["`codex` was not found on PATH. Install: npm install -g @openai/codex"],
      };
    }
    const notes: string[] = [];
    let version: string | null = null;
    let supportedFlags: string[] = [];
    try {
      const v = await probe(binaryPath, ["--version"], os.tmpdir());
      version = (v.stdout || v.stderr).trim().split("\n")[0] ?? null;
    } catch (err) {
      notes.push(`--version failed: ${(err as Error).message}`);
    }
    try {
      const h = await probe(binaryPath, ["exec", "--help"], os.tmpdir());
      supportedFlags = parseHelpFlags(h.stdout + h.stderr);
      if (!supportedFlags.includes("--json")) {
        notes.push("codex exec does not advertise --json; falling back to plain text parsing.");
      }
      // `resume` is a subcommand, not a flag, so it never shows up in
      // parseHelpFlags: look for it in the help text itself.
      this.resumeSupported = /(^|\s)resume(\s|$)/im.test(h.stdout + h.stderr);
      if (!this.resumeSupported) {
        notes.push("codex exec does not advertise a `resume` subcommand; conversations always start fresh.");
      }
      if (!supportedFlags.includes("--sandbox")) {
        notes.push(
          "codex exec does not advertise --sandbox; read-only enforcement unavailable — runs will be refused in read_only mode.",
        );
      }
    } catch (err) {
      notes.push(`exec --help probe failed: ${(err as Error).message}`);
    }
    this.detection = { installed: true, binaryPath, version, supportedFlags, notes };
    return this.detection;
  }

  async authenticate(): Promise<AuthStatus> {
    const home = this.opts.homeDir ?? os.homedir();
    if (fs.existsSync(path.join(home, ".codex", "auth.json"))) {
      return { authenticated: true, method: "session", detail: "Codex auth.json is present." };
    }
    if (process.env.OPENAI_API_KEY) {
      return { authenticated: true, method: "api-key", detail: "OPENAI_API_KEY is set in the environment." };
    }
    return { authenticated: false, method: null, detail: "Not logged in. Run `codex login`." };
  }

  async listModels(): Promise<ModelOption[]> {
    return [
      { id: "gpt-5.2-codex", label: "GPT-5.2 Codex", recommendedFor: "default coding" },
      { id: "gpt-5.2", label: "GPT-5.2" },
      { id: "o4-mini", label: "o4-mini", recommendedFor: "cheap/fast runs" },
    ];
  }

  async validateConfig(): Promise<ValidationResult> {
    const issues: string[] = [];
    const detection = this.detection ?? (await this.detect());
    if (!detection.installed) issues.push("codex binary not found on PATH.");
    issues.push(...detection.notes);
    const auth = await this.authenticate();
    if (auth.authenticated === false) issues.push(auth.detail);
    return { ok: issues.length === 0, issues };
  }

  /** The installed `codex exec` advertises `resume` (detected once). */
  async supportsResume(): Promise<boolean> {
    if (this.manifest.capabilities.resume !== "subcommand") return false;
    if (!this.detection) await this.detect();
    return this.resumeSupported;
  }

  /** True when this run asked to resume and the installed CLI can do it. */
  private async canResume(run: AgentRun): Promise<boolean> {
    if (!run.resume?.providerSessionId) return false;
    if (this.manifest.capabilities.resume !== "subcommand") return false;
    if (!this.detection) await this.detect();
    return this.resumeSupported;
  }

  async buildInvocation(run: AgentRun): Promise<SafeInvocation> {
    const detection = this.detection ?? (await this.detect());
    const resumeId = (await this.canResume(run)) ? run.resume?.providerSessionId : undefined;
    const args: string[] = ["exec"];
    if (resumeId) args.push("resume");
    if (detection.supportedFlags.includes("--json")) args.push("--json");
    if (detection.supportedFlags.includes("--skip-git-repo-check")) args.push("--skip-git-repo-check");
    if (run.mode === "read_only") {
      if (!detection.supportedFlags.includes("--sandbox")) {
        throw new Error(
          "Installed codex has no --sandbox flag; refusing a read_only run without enforcement.",
        );
      }
      args.push("--sandbox", "read-only");
    } else {
      if (detection.supportedFlags.includes("--sandbox")) args.push("--sandbox", "workspace-write");
    }
    if (run.model) args.push("--model", run.model);
    if (run.effort !== "default" && detection.supportedFlags.includes("-c")) {
      args.push("-c", `model_reasoning_effort=${JSON.stringify(run.effort)}`);
    }
    // `codex exec resume <SESSION_ID> [PROMPT]`: the session id is the first
    // positional, the prompt the second.
    if (resumeId) args.push(resumeId);
    args.push(run.prompt);
    return {
      executable: this.binary(),
      args,
      env: {},
      description: `codex exec${resumeId ? " resume" : ""} (${run.mode}, model=${run.model ?? "default"})`,
    };
  }

  execute(run: AgentRun): AsyncIterable<RunEvent> {
    const build = (r: AgentRun) => this.buildInvocation(r);
    const canResume = (r: AgentRun) => this.canResume(r);
    return (async function* () {
      const wanted = Boolean(run.resume?.providerSessionId);
      const resuming = await canResume(run);
      const invocation = await build(run);
      if (wanted && !resuming) {
        yield {
          type: "text",
          ts: Date.now(),
          stream: "stderr",
          text: "[mordomo] resumeSupported: false — the installed codex CLI has no `exec resume`; starting a fresh conversation.",
        } as RunEvent;
      }
      yield* executeInvocation(run, invocation, codexStreamParser(), [invocation.executable]);
    })();
  }

  async healthCheck(): Promise<HealthStatus> {
    const detection = await this.detect();
    const auth = detection.installed
      ? await this.authenticate()
      : { authenticated: false as const, method: null, detail: "not installed" };
    return {
      ok: detection.installed && auth.authenticated !== false,
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
 * Token usage from a Codex JSONL payload. Accepts both spellings the CLI has
 * used (`input_tokens`/`output_tokens`/`cached_input_tokens` and the older
 * `token_usage` info blocks). Returns null when no counts are present.
 */
export function parseCodexUsage(
  raw: unknown,
): { inputTokens: number; outputTokens: number; cacheReadTokens: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  if (u.input_tokens == null && u.output_tokens == null) return null;
  return {
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheReadTokens: num(u.cached_input_tokens ?? u.cache_read_input_tokens),
  };
}

/**
 * Codex --json emits JSONL events; shapes vary across versions
 * ("item.completed" items, or msg-typed events). Parse defensively.
 * Exported for tests.
 */
export function codexStreamParser(): LineParser {
  let lastMessage = "";
  let model: string | null = null;
  // The conversation id repeats on later lines; report it only when it changes.
  let seenSessionId: string | null = null;
  const usageEvent = (ts: number, parsed: NonNullable<ReturnType<typeof parseCodexUsage>>): RunEvent => ({
    type: "usage",
    ts,
    scope: "total",
    ...parsed,
    costUsd: null, // Codex reports tokens but never a price
    ...(model ? { model } : {}),
  });
  return {
    parseLine(line: string): RunEvent[] | null {
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
      const ts = Date.now();
      const type = String(obj.type ?? "");
      if (typeof obj.model === "string") model = obj.model;

      // Conversation id, whichever spelling this CLI version uses.
      const msgObj = obj.msg as Record<string, unknown> | undefined;
      const conversationId = [obj.session_id, obj.thread_id, msgObj?.session_id].find(
        (v): v is string => typeof v === "string" && v.length > 0,
      );
      const sessionEvents: RunEvent[] = [];
      if (conversationId && conversationId !== seenSessionId) {
        seenSessionId = conversationId;
        sessionEvents.push({ type: "session", ts, providerSessionId: conversationId });
      }

      // Newer shape: {"type":"turn.completed","usage":{"input_tokens":..,"output_tokens":..}}
      if (type === "turn.completed") {
        const parsed = parseCodexUsage(obj.usage);
        return parsed ? [...sessionEvents, usageEvent(ts, parsed)] : sessionEvents;
      }

      // Newer shape: {"type":"item.completed","item":{"item_type"/"type": "...", "text": ...}}
      const item = obj.item as Record<string, unknown> | undefined;
      if (item) {
        const itemType = String(item.item_type ?? item.type ?? "");
        if (itemType.includes("agent_message") || itemType === "assistant_message") {
          const text = String(item.text ?? "");
          if (text.trim()) {
            lastMessage = text;
            return [...sessionEvents, { type: "assistant", ts, text }];
          }
          return sessionEvents;
        }
        if (
          itemType.includes("command") ||
          itemType.includes("tool") ||
          itemType.includes("patch") ||
          itemType.includes("file")
        ) {
          return [
            {
              type: "tool_use",
              ts,
              tool: itemType,
              detail: JSON.stringify({ command: item.command, path: item.path, status: item.status }).slice(
                0,
                400,
              ),
            },
          ];
        }
        if (itemType.includes("reasoning")) return sessionEvents;
      }

      // Older shape: {"msg":{"type":"agent_message","message":"..."}}
      const msg = msgObj;
      if (msg) {
        const msgType = String(msg.type ?? "");
        if (msgType === "agent_message" && typeof msg.message === "string") {
          lastMessage = msg.message;
          return [...sessionEvents, { type: "assistant", ts, text: msg.message }];
        }
        if (msgType.includes("exec") || msgType.includes("patch")) {
          return [{ type: "tool_use", ts, tool: msgType, detail: JSON.stringify(msg).slice(0, 400) }];
        }
        if (msgType === "error" && typeof msg.message === "string") {
          return [{ type: "permission", ts, detail: msg.message.slice(0, 400) }];
        }
        // Older shape: {"msg":{"type":"token_count","info":{"total_token_usage":{...},"last_token_usage":{...}}}}
        if (msgType === "token_count") {
          const info = msg.info as Record<string, unknown> | undefined;
          const parsed = parseCodexUsage(
            info?.total_token_usage ?? msg.total_token_usage ?? msg.token_usage ?? info?.token_usage,
          );
          return parsed ? [...sessionEvents, usageEvent(ts, parsed)] : sessionEvents;
        }
        return sessionEvents;
      }
      return sessionEvents;
    },
    summarize(stdout: string): string {
      return (lastMessage || stdout.slice(-2000)).slice(0, 2000);
    },
  };
}
