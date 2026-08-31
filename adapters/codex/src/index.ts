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
 * OpenAI Codex CLI adapter — non-interactive `codex exec` with `--json` events.
 * Read-only runs use `--sandbox read-only`; write runs use
 * `--sandbox workspace-write`. `danger-full-access` is never used.
 */
export class CodexAdapter implements AgentAdapter {
  readonly id = "codex" as const;
  private detection: DetectionResult | null = null;

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
      if (!supportedFlags.includes("--sandbox")) {
        notes.push("codex exec does not advertise --sandbox; read-only enforcement unavailable — runs will be refused in read_only mode.");
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

  async buildInvocation(run: AgentRun): Promise<SafeInvocation> {
    const detection = this.detection ?? (await this.detect());
    const args: string[] = ["exec"];
    if (detection.supportedFlags.includes("--json")) args.push("--json");
    if (detection.supportedFlags.includes("--skip-git-repo-check")) args.push("--skip-git-repo-check");
    if (run.mode === "read_only") {
      if (!detection.supportedFlags.includes("--sandbox")) {
        throw new Error("Installed codex has no --sandbox flag; refusing a read_only run without enforcement.");
      }
      args.push("--sandbox", "read-only");
    } else {
      if (detection.supportedFlags.includes("--sandbox")) args.push("--sandbox", "workspace-write");
    }
    if (run.model) args.push("--model", run.model);
    if (run.effort !== "default" && detection.supportedFlags.includes("-c")) {
      args.push("-c", `model_reasoning_effort=${JSON.stringify(run.effort)}`);
    }
    args.push(run.prompt);
    return {
      executable: this.binary(),
      args,
      env: {},
      description: `codex exec (${run.mode}, model=${run.model ?? "default"})`,
    };
  }

  execute(run: AgentRun): AsyncIterable<RunEvent> {
    const self = this;
    return (async function* () {
      const invocation = await self.buildInvocation(run);
      yield* executeInvocation(run, invocation, codexStreamParser(), [invocation.executable]);
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

/**
 * Codex --json emits JSONL events; shapes vary across versions
 * ("item.completed" items, or msg-typed events). Parse defensively.
 */
function codexStreamParser(): LineParser {
  let lastMessage = "";
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

      // Newer shape: {"type":"item.completed","item":{"item_type"/"type": "...", "text": ...}}
      const item = obj.item as Record<string, unknown> | undefined;
      if (item) {
        const itemType = String(item.item_type ?? item.type ?? "");
        if (itemType.includes("agent_message") || itemType === "assistant_message") {
          const text = String(item.text ?? "");
          if (text.trim()) {
            lastMessage = text;
            return [{ type: "assistant", ts, text }];
          }
          return [];
        }
        if (itemType.includes("command") || itemType.includes("tool") || itemType.includes("patch") || itemType.includes("file")) {
          return [
            {
              type: "tool_use",
              ts,
              tool: itemType,
              detail: JSON.stringify({ command: item.command, path: item.path, status: item.status }).slice(0, 400),
            },
          ];
        }
        if (itemType.includes("reasoning")) return [];
      }

      // Older shape: {"msg":{"type":"agent_message","message":"..."}}
      const msg = obj.msg as Record<string, unknown> | undefined;
      if (msg) {
        const msgType = String(msg.type ?? "");
        if (msgType === "agent_message" && typeof msg.message === "string") {
          lastMessage = msg.message;
          return [{ type: "assistant", ts, text: msg.message }];
        }
        if (msgType.includes("exec") || msgType.includes("patch")) {
          return [{ type: "tool_use", ts, tool: msgType, detail: JSON.stringify(msg).slice(0, 400) }];
        }
        if (msgType === "error" && typeof msg.message === "string") {
          return [{ type: "permission", ts, detail: msg.message.slice(0, 400) }];
        }
        return [];
      }
      if (type === "turn.completed" || type === "thread.started") return [];
      return [];
    },
    summarize(stdout: string): string {
      return (lastMessage || stdout.slice(-2000)).slice(0, 2000);
    },
  };
}
