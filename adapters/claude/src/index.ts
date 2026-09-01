import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cancelRunProcess,
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
} from "@mordomo/core";

/**
 * Claude Code adapter — headless (`claude -p`) with `stream-json` output.
 * Read-only runs stay in the default permission mode (headless auto-denies
 * writes) with an explicit allow-rule only for the run's artifacts directory.
 * Write runs use acceptEdits. bypassPermissions is never used.
 */
export class ClaudeAdapter implements AgentAdapter {
  readonly id = "claude" as const;
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
    const self = this;
    return (async function* () {
      const invocation = await self.buildInvocation(run);
      yield* executeInvocation(run, invocation, claudeStreamParser(), [invocation.executable]);
    })();
  }

  async cancel(runId: string): Promise<void> {
    cancelRunProcess(runId);
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

/** Parser for Claude Code's stream-json (one JSON object per line). */
function claudeStreamParser(): LineParser {
  let lastAssistantText = "";
  let resultText = "";
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
        return subtype === "init"
          ? [{ type: "text", ts, stream: "stdout", text: `[claude session started: model=${(obj.model as string) ?? "?"}]` }]
          : [];
      }
      if (type === "assistant" || type === "user") {
        const message = obj.message as { content?: Array<Record<string, unknown>> } | undefined;
        const events: RunEvent[] = [];
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
        return []; // lifecycle result event is emitted by the runner with exit code
      }
      return [];
    },
    summarize(): string {
      return (resultText || lastAssistantText).slice(0, 2000);
    },
  };
}
