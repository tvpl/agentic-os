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
 * Cursor Agent adapter — headless (`cursor-agent -p`) with stream-json output
 * when the installed version supports it (confirmed by --help probing).
 * Write runs pass --force (Cursor's explicit opt-in for applying changes
 * without interactive approval); read-only runs never do.
 */
export class CursorAdapter implements AgentAdapter {
  readonly id = "cursor" as const;
  private detection: DetectionResult | null = null;

  constructor(private readonly opts: { binaryPath?: string | null; homeDir?: string } = {}) {}

  private binary(): string {
    return this.opts.binaryPath ?? findOnPath("cursor-agent") ?? "cursor-agent";
  }

  async detect(): Promise<DetectionResult> {
    const binaryPath = this.opts.binaryPath ?? findOnPath("cursor-agent");
    if (!binaryPath) {
      return {
        installed: false,
        binaryPath: null,
        version: null,
        supportedFlags: [],
        notes: ["`cursor-agent` was not found on PATH. Install: curl https://cursor.com/install -fsS | bash"],
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
      const h = await probe(binaryPath, ["--help"], os.tmpdir());
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
    this.detection = { installed: true, binaryPath, version, supportedFlags, notes };
    return this.detection;
  }

  async authenticate(): Promise<AuthStatus> {
    const binaryPath = this.opts.binaryPath ?? findOnPath("cursor-agent");
    if (!binaryPath) return { authenticated: false, method: null, detail: "cursor-agent is not installed." };
    try {
      // `cursor-agent status` prints login state without exposing tokens.
      const res = await probe(binaryPath, ["status"], os.tmpdir());
      const out = (res.stdout + res.stderr).toLowerCase();
      if (res.exitCode === 0 && /logged in|authenticated/.test(out)) {
        return { authenticated: true, method: "session", detail: "cursor-agent reports an active login." };
      }
      if (/not logged in|unauthenticated|login required/.test(out)) {
        return { authenticated: false, method: null, detail: "Not logged in. Run `cursor-agent login`." };
      }
      return { authenticated: "unknown", method: null, detail: "Could not determine login state from `cursor-agent status`." };
    } catch (err) {
      return { authenticated: "unknown", method: null, detail: `status probe failed: ${(err as Error).message}` };
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
    args.push(run.prompt);
    return {
      executable: this.binary(),
      args,
      env: {},
      description: `cursor-agent -p (${run.mode}, model=${run.model ?? "auto"})`,
    };
  }

  execute(run: AgentRun): AsyncIterable<RunEvent> {
    const self = this;
    return (async function* () {
      if (run.mode === "read_only") {
        // cursor-agent has no sandbox flag; constrain via the prompt contract
        // and never pass --force, so changes are not auto-applied.
        run = {
          ...run,
          prompt: `${run.prompt}\n\nIMPORTANT: this is a READ-ONLY run. Do not modify, create or delete any file outside ${run.artifactsDir}.`,
        };
      }
      const invocation = await self.buildInvocation(run);
      yield* executeInvocation(run, invocation, cursorStreamParser(), [invocation.executable]);
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

/** Cursor stream-json closely mirrors Claude Code's; parse defensively. */
function cursorStreamParser(): LineParser {
  let lastText = "";
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
      if (type === "assistant") {
        const message = obj.message as { content?: Array<Record<string, unknown>> } | undefined;
        const events: RunEvent[] = [];
        for (const block of message?.content ?? []) {
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
        return [];
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
