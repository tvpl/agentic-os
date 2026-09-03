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
 * Claude Code adapter — headless (`claude -p`) with `stream-json` output.
 * Read-only runs stay in the default permission mode (headless auto-denies
 * writes) with an explicit allow-rule only for the run's artifacts directory.
 * Write runs use acceptEdits. bypassPermissions is never used.
 */
export const claudeManifest: ProviderManifest = BUILTIN_MANIFESTS.claude;

/** Factory used by the provider registry (`apps/api/src/providers.ts`). */
export const createClaudeAdapter = (opts: AdapterFactoryOptions): AgentAdapter =>
  new ClaudeAdapter({ binaryPath: opts.binaryPath, ...(opts.homeDir ? { homeDir: opts.homeDir } : {}) });

export class ClaudeAdapter implements AgentAdapter {
  readonly id = "claude" as const;
  readonly manifest = claudeManifest;
  private detection: DetectionResult | null = null;

  constructor(private readonly opts: { binaryPath?: string | null; homeDir?: string } = {}) {}

  private binary(): string {
    return this.opts.binaryPath ?? findOnPath("claude") ?? "claude";
  }

  async detect(): Promise<DetectionResult> {
    const binaryPath = this.opts.binaryPath ?? findOnPath("claude");
    if (!binaryPath) {
      return {
        installed: false,
        binaryPath: null,
        version: null,
        supportedFlags: [],
        notes: ["`claude` was not found on PATH. Install: npm install -g @anthropic-ai/claude-code"],
      };
    }
    const notes: string[] = [];
    let version: string | null = null;
    let supportedFlags: string[] = [];
    try {
      const v = await probe(binaryPath, ["--version"], os.tmpdir());
      version = v.stdout.trim().split("\n")[0] ?? null;
    } catch (err) {
      notes.push(`--version failed: ${(err as Error).message}`);
    }
    try {
      const h = await probe(binaryPath, ["--help"], os.tmpdir());
      supportedFlags = parseHelpFlags(h.stdout + h.stderr);
      for (const required of ["--print", "--output-format", "--model"]) {
        if (!supportedFlags.includes(required)) {
          notes.push(`Installed claude does not advertise ${required}; headless runs may fail.`);
        }
      }
    } catch (err) {
      notes.push(`--help probe failed: ${(err as Error).message}`);
    }
    this.detection = { installed: true, binaryPath, version, supportedFlags, notes };
    return this.detection;
  }

  async authenticate(): Promise<AuthStatus> {
    // Presence checks only — never read, print or store credential values.
    const home = this.opts.homeDir ?? os.homedir();
    if (fs.existsSync(path.join(home, ".claude", ".credentials.json"))) {
      return { authenticated: true, method: "session", detail: "Claude Code session credentials are present." };
    }
    if (process.env.ANTHROPIC_API_KEY) {
      return { authenticated: true, method: "api-key", detail: "ANTHROPIC_API_KEY is set in the environment." };
    }
    if (fs.existsSync(path.join(home, ".claude"))) {
      return {
        authenticated: "unknown",
        method: null,
        detail: "~/.claude exists but no portable credential marker was found (macOS keychain auth is not detectable). The smoke test will confirm.",
      };
    }
    return { authenticated: false, method: null, detail: "Not logged in. Run `claude` once to authenticate." };
  }

  async listModels(): Promise<ModelOption[]> {
    return [
      { id: "sonnet", label: "Claude Sonnet (alias)", recommendedFor: "day-to-day work" },
      { id: "opus", label: "Claude Opus (alias)", recommendedFor: "hard reasoning" },
      { id: "haiku", label: "Claude Haiku (alias)", recommendedFor: "cheap/fast runs" },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
      { id: "claude-opus-5", label: "Claude Opus 5" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    ];
  }

  async validateConfig(): Promise<ValidationResult> {
    const issues: string[] = [];
    const detection = this.detection ?? (await this.detect());
    if (!detection.installed) issues.push("claude binary not found on PATH.");
    issues.push(...detection.notes);
    const auth = await this.authenticate();
    if (auth.authenticated === false) issues.push(auth.detail);
    return { ok: issues.length === 0, issues };
  }

  async buildInvocation(run: AgentRun): Promise<SafeInvocation> {
    const args = ["-p", "--output-format", "stream-json", "--verbose"];
    if (run.model) args.push("--model", run.model);
    args.push("--add-dir", run.artifactsDir);
    if (run.mode === "read_only") {
      // Headless default mode auto-denies permission prompts; writes are only
      // pre-approved inside the artifacts directory. Claude Code permission
      // rules address absolute paths with a leading double slash.
      const artifactsRule = run.artifactsDir.startsWith("/")
        ? `/${run.artifactsDir}`
        : run.artifactsDir;
      args.push(
        "--permission-mode",
        "default",
        "--allowedTools",
        `Write(${artifactsRule}/**),Edit(${artifactsRule}/**)`,
        "--disallowedTools",
        "Bash(rm:*),Bash(sudo:*)",
      );
    } else {
      args.push("--permission-mode", "acceptEdits");
    }
    const env: Record<string, string> = {};
    const thinking = { low: "1024", medium: "8192", high: "31999" }[run.effort as string];
    if (thinking) env.MAX_THINKING_TOKENS = thinking;

    return {
      executable: this.binary(),
      args,
      env,
      stdin: run.prompt,
      description: `claude -p (${run.mode}, model=${run.model ?? "default"})`,
    };
  }

  execute(run: AgentRun): AsyncIterable<RunEvent> {
    const build = (r: AgentRun) => this.buildInvocation(r);
    return (async function* () {
      const invocation = await build(run);
      yield* executeInvocation(run, invocation, claudeStreamParser(), [invocation.executable]);
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
 * Usage block of a Claude Code stream-json message (`assistant.message.usage`
 * or `result.usage`). Returns null when the block carries no token counts.
 */
export function parseClaudeUsage(raw: unknown): { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  if (u.input_tokens == null && u.output_tokens == null) return null;
  return {
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheReadTokens: num(u.cache_read_input_tokens),
    cacheWriteTokens: num(u.cache_creation_input_tokens),
  };
}

/** Model with the most output tokens in a `result.modelUsage` map (null when absent). */
export function dominantModel(modelUsage: unknown): string | null {
  if (!modelUsage || typeof modelUsage !== "object") return null;
  let best: { model: string; out: number } | null = null;
  for (const [model, stats] of Object.entries(modelUsage as Record<string, unknown>)) {
    const out = num((stats as Record<string, unknown> | null)?.outputTokens);
    if (!best || out > best.out) best = { model, out };
  }
  return best?.model ?? null;
}

/** Parser for Claude Code's stream-json (one JSON object per line). Exported for tests. */
export function claudeStreamParser(): LineParser {
  let lastAssistantText = "";
  let resultText = "";
  let sessionModel: string | null = null;
  return {
    parseLine(line: string): RunEvent[] | null {
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
      const ts = Date.now();
      const type = obj.type as string;
      if (type === "system") {
        const subtype = (obj.subtype as string) ?? "";
        if (subtype === "init" && typeof obj.model === "string") sessionModel = obj.model;
        return subtype === "init"
          ? [{ type: "text", ts, stream: "stdout", text: `[claude session started: model=${(obj.model as string) ?? "?"}]` }]
          : [];
      }
      if (type === "assistant" || type === "user") {
        const message = obj.message as { content?: Array<Record<string, unknown>>; usage?: unknown; model?: unknown } | undefined;
        const events: RunEvent[] = [];
        // Per-turn usage (context meter): one event per assistant message.
        const turn = type === "assistant" ? parseClaudeUsage(message?.usage) : null;
        if (turn) {
          const model = typeof message?.model === "string" ? message.model : sessionModel;
          events.push({ type: "usage", ts, scope: "turn", ...turn, costUsd: null, ...(model ? { model } : {}) });
        }
        for (const block of message?.content ?? []) {
          if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
            lastAssistantText = block.text;
            if (type === "assistant") events.push({ type: "assistant", ts, text: block.text });
          } else if (block.type === "tool_use") {
            const input = JSON.stringify(block.input ?? {});
            events.push({
              type: "tool_use",
              ts,
              tool: String(block.name ?? "tool"),
              detail: input.length > 400 ? input.slice(0, 400) + "…" : input,
            });
          } else if (block.type === "tool_result" && block.is_error) {
            events.push({ type: "permission", ts, detail: `Tool call denied or failed: ${JSON.stringify(block.content ?? "").slice(0, 300)}` });
          }
        }
        return events;
      }
      if (type === "result") {
        resultText = typeof obj.result === "string" ? obj.result : lastAssistantText;
        // Session totals: tokens + cost. The lifecycle `result` event itself is
        // emitted by the runner with the exit code.
        const total = parseClaudeUsage(obj.usage);
        const cost = typeof obj.total_cost_usd === "number" ? obj.total_cost_usd : null;
        if (total || cost != null) {
          const model = dominantModel(obj.modelUsage) ?? sessionModel;
          return [
            {
              type: "usage",
              ts,
              scope: "total",
              inputTokens: total?.inputTokens ?? 0,
              outputTokens: total?.outputTokens ?? 0,
              cacheReadTokens: total?.cacheReadTokens ?? 0,
              cacheWriteTokens: total?.cacheWriteTokens ?? 0,
              costUsd: cost,
              ...(model ? { model } : {}),
            },
          ];
        }
        return [];
      }
      return [];
    },
    summarize(): string {
      return (resultText || lastAssistantText).slice(0, 2000);
    },
  };
}
