import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CodexStreamEvent,
  KnownStreamTypes,
  createUnrecognizedTally,
  executeInvocation,
  findExecutable,
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
  type AdapterFactoryOptions,
  readTypedLine,
  resumableSessionId,
  type RejectedLine,
} from "@mordomo/core";
import { codexManifest } from "./manifest.js";

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
export { codexManifest };

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
    return this.opts.binaryPath ?? findExecutable("codex") ?? "codex";
  }

  async detect(): Promise<DetectionResult> {
    const binaryPath = this.opts.binaryPath ?? findExecutable("codex");
    if (!binaryPath) {
      return {
        installed: false,
        binaryPath: null,
        version: null,
        supportedFlags: [],
        notes: [
          "`codex` was not found on PATH or in the usual install folders. Install: npm install -g @openai/codex",
        ],
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
    const home = this.opts.homeDir ?? os.homedir();
    if (fs.existsSync(path.join(home, ".codex", "auth.json"))) {
      return {
        authenticated: "unknown",
        method: "session",
        detail: "Codex credentials are present; session validity has not been verified.",
      };
    }
    if (process.env.OPENAI_API_KEY) {
      return {
        authenticated: "unknown",
        method: "api-key",
        detail: "OPENAI_API_KEY is configured; validity has not been verified.",
      };
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
    if (!resumableSessionId(run)) return false;
    if (this.manifest.capabilities.resume !== "subcommand") return false;
    if (!this.detection) await this.detect();
    return this.resumeSupported;
  }

  async buildInvocation(run: AgentRun): Promise<SafeInvocation> {
    const detection = this.detection ?? (await this.detect());
    const resumeId = (await this.canResume(run)) ? resumableSessionId(run) : undefined;
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
    // A prompt is never an option: a leading space keeps "-…" from being parsed as a flag.
    args.push(run.prompt.startsWith("-") ? ` ${run.prompt}` : run.prompt);
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
      const wanted = Boolean(resumableSessionId(run));
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

type CodexItem = Extract<CodexStreamEvent, { type: "item.completed" }>["item"];
type CodexLegacyItem = Extract<CodexItem, { item_type: string }>;
type CodexLegacyEvent = Extract<CodexStreamEvent, { msg: unknown }>;
type CodexLegacyMsg = CodexLegacyEvent["msg"];

// The schemas are passthrough objects, whose types carry an index signature: `in` does not narrow them, a guard does.
const isLegacyItem = (item: CodexItem): item is CodexLegacyItem => "item_type" in item;
const isLegacyEvent = (event: CodexStreamEvent): event is CodexLegacyEvent => "msg" in event;
const isTokenCount = (msg: CodexLegacyMsg): msg is Extract<CodexLegacyMsg, { type: "token_count" }> =>
  msg.type === "token_count";

/** What the parser reads of an item, in either spelling (`item.type` or `item.item_type`). */
interface ItemView {
  kind: string;
  id?: string | undefined;
  text?: string | undefined;
  command?: string | undefined;
  path?: string | undefined;
  status?: string | undefined;
  message?: string | undefined;
  changes?: Array<{ path: string }> | undefined;
}

function viewOf(item: CodexItem): ItemView {
  if (isLegacyItem(item)) {
    const { id, text, command, path: file, status, changes } = item;
    return { kind: item.item_type, id, text, command, path: file, status, changes };
  }
  switch (item.type) {
    case "agent_message":
      return { kind: item.type, id: item.id, text: item.text };
    case "command_execution":
      return { kind: item.type, id: item.id, command: item.command, status: item.status };
    case "file_change":
      return { kind: item.type, id: item.id, status: item.status, changes: item.changes };
    case "mcp_tool_call":
      return { kind: item.type, id: item.id, status: item.status };
    case "error":
      return { kind: item.type, id: item.id, message: item.message };
    default:
      return { kind: item.type, id: item.id };
  }
}

/**
 * At most this many paths ride on one `tool_use` event, and none longer than
 * `MAX_PATH_CHARS`: the event is journaled whole, so a patch of thousands of
 * files (or a hostile line) must not make one enormous row. A patch beyond the
 * cap records its first 200 files.
 */
const MAX_PATHS = 200;
const MAX_PATH_CHARS = 4096;

function changedPaths(changes: Array<{ path: string }> | undefined): string[] | undefined {
  if (!changes) return undefined;
  return changes
    .map((c) => c.path)
    .filter((p) => p.length > 0 && p.length <= MAX_PATH_CHARS)
    .slice(0, MAX_PATHS);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Names a rejected line for the warning: its type (with the item's, for `item.*`), and whether the schema has it. */
function describeCodexLine(value: Record<string, unknown>): RejectedLine {
  const type = value.type;
  if (typeof type === "string") {
    const item = value.item;
    if (isRecord(item)) {
      const legacy = typeof item.item_type === "string";
      const kind = legacy ? item.item_type : item.type;
      if (typeof kind === "string") {
        const known = KnownStreamTypes.codex.has(type) && (legacy || KnownStreamTypes.codexItem.has(kind));
        return { name: `${type}/${kind}`, known };
      }
    }
    return { name: type, known: KnownStreamTypes.codex.has(type) };
  }
  // The oldest shape has no top-level `type`; its `msg.type` is any string, so such a line fails on a field.
  const msg = value.msg;
  if (isRecord(msg) && typeof msg.type === "string") return { name: `msg.${msg.type}`, known: true };
  return { known: false };
}

/** A failed turn or a stream error is never silent: it becomes a line of the trace. */
const failure = (ts: number, what: string, message: string | undefined): RunEvent => ({
  type: "text",
  ts,
  stream: "stderr",
  text: `[codex] ${what}${message ? `: ${message.slice(0, 400)}` : ""}`,
});

/**
 * Codex --json emits JSONL events; shapes vary across versions
 * ("item.completed" items, or msg-typed events). Each line is checked against
 * `CodexStreamEvent` first: a JSON object that matches no known event is
 * counted, never read, and `finish()` names the count once. Exported for tests.
 */
export function codexStreamParser(): LineParser {
  const unknown = createUnrecognizedTally("codex");
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
      const read = readTypedLine(line, CodexStreamEvent, unknown, describeCodexLine);
      if (!read.ok) return read.events;
      const data = read.data;
      const ts = Date.now();
      if (data.model) model = data.model;

      // Conversation id, whichever spelling this CLI version uses.
      const sessionEvents: RunEvent[] = [];
      const conversationId = isLegacyEvent(data)
        ? (data.session_id ?? data.msg.session_id)
        : data.type === "thread.started"
          ? data.thread_id
          : undefined;
      if (conversationId && conversationId !== seenSessionId) {
        seenSessionId = conversationId;
        sessionEvents.push({ type: "session", ts, providerSessionId: conversationId });
      }

      // Older shape: {"msg":{"type":"agent_message","message":"..."}}
      if (isLegacyEvent(data)) {
        const msg: CodexLegacyMsg = data.msg;
        if (msg.type === "agent_message" && typeof msg.message === "string") {
          lastMessage = msg.message;
          return [...sessionEvents, { type: "assistant", ts, text: msg.message }];
        }
        if (msg.type.includes("exec") || msg.type.includes("patch")) {
          return [
            ...sessionEvents,
            { type: "tool_use", ts, tool: msg.type, detail: JSON.stringify(msg).slice(0, 400) },
          ];
        }
        if (msg.type === "error" && typeof msg.message === "string") {
          return [...sessionEvents, { type: "permission", ts, detail: msg.message.slice(0, 400) }];
        }
        // Older shape: {"msg":{"type":"token_count","info":{"total_token_usage":{...},"last_token_usage":{...}}}}
        if (isTokenCount(msg)) {
          const parsed = parseCodexUsage(
            msg.info?.total_token_usage ?? msg.total_token_usage ?? msg.token_usage ?? msg.info?.token_usage,
          );
          return parsed ? [...sessionEvents, usageEvent(ts, parsed)] : sessionEvents;
        }
        return sessionEvents;
      }

      switch (data.type) {
        // Newer shape: {"type":"turn.completed","usage":{"input_tokens":..,"output_tokens":..}}
        case "turn.completed": {
          const parsed = parseCodexUsage(data.usage);
          return parsed ? [...sessionEvents, usageEvent(ts, parsed)] : sessionEvents;
        }
        case "turn.failed":
          return [...sessionEvents, failure(ts, "turn failed", data.error?.message)];
        case "error":
          return [...sessionEvents, failure(ts, "error", data.message)];
        case "item.started":
        case "item.updated":
        case "item.completed":
          return [...sessionEvents, ...itemEvents(data.type, viewOf(data.item), ts)];
        default:
          return sessionEvents;
      }
    },
    summarize(stdout: string): string {
      return (lastMessage || stdout.slice(-2000)).slice(0, 2000);
    },
    finish: () => unknown.warning(),
    dropped: () => unknown.noteUnreadable(),
  };

  /** Events of a newer-shape `item.*` line: {"type":"item.completed","item":{"type"/"item_type": "...", "text": ...}} */
  function itemEvents(
    type: "item.started" | "item.updated" | "item.completed",
    item: ItemView,
    ts: number,
  ): RunEvent[] {
    if (item.kind.includes("agent_message") || item.kind === "assistant_message") {
      if (item.text?.trim()) {
        lastMessage = item.text;
        return [{ type: "assistant", ts, text: item.text }];
      }
      return [];
    }
    if (item.kind === "error") {
      return type === "item.completed" ? [failure(ts, "error", item.message)] : [];
    }
    if (
      item.kind.includes("command") ||
      item.kind.includes("tool") ||
      item.kind.includes("patch") ||
      item.kind.includes("file")
    ) {
      const paths = changedPaths(item.changes);
      return [
        {
          type: "tool_use",
          ts,
          tool: item.kind,
          detail: JSON.stringify({ command: item.command, path: item.path, status: item.status }).slice(
            0,
            400,
          ),
          // The files a patch wrote travel as data, not as text in `detail` (which is cut at 400 characters).
          ...(paths ? { paths } : {}),
          ...(item.id !== undefined ? { callId: item.id } : {}),
          phase: type === "item.completed" ? "end" : "start",
          ...(type === "item.completed"
            ? {
                outcome: (item.status ?? "").toLowerCase().includes("fail")
                  ? ("error" as const)
                  : ("ok" as const),
              }
            : {}),
        },
      ];
    }
    return [];
  }
}
