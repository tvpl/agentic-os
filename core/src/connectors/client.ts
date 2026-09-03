import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { assertAllowed, killProcessGroup, ExecutableNotAllowedError } from "../spawn/safeSpawn.js";
import { findOnPath } from "../spawn/which.js";
import { redactSecrets } from "../security/redact.js";
import type { Connector, DataMapping, FieldSpec, ToolMapping } from "./registry.js";

/**
 * Read-only connector data client.
 *
 * - Minimal MCP stdio client (JSON-RPC 2.0, newline-delimited) with the
 *   `initialize → notifications/initialized → tools/list → tools/call` flow.
 * - safeSpawn semantics without safeSpawn itself (it closes stdin at once,
 *   which a JSON-RPC session cannot survive): argv only, no shell, executable
 *   must pass `assertAllowed` (base allowlist + `settings.connectors.allowedCommands`),
 *   own process group so timeouts kill the whole tree, minimal environment
 *   (PATH/HOME plus the env var NAMES the mapping declares).
 * - STRICT READ-ONLY policy: only the tools named by the connector's
 *   `dataMapping.tools` may be called, and never a tool whose name carries a
 *   write-like verb, whatever the mapping says.
 * - Errors are redacted before they leave this module.
 */

export interface ConnectorItem {
  id: string;
  title: string;
  subtitle?: string;
  ts?: number;
  flagged?: boolean;
  tag?: string;
  href?: string;
}

export interface ConnectorData {
  status: "not_configured" | "ok" | "error";
  syncedAt: number | null;
  message?: string;
  items: ConnectorItem[];
  summary?: Record<string, number>;
  /** Copyable setup checklist (install, env var names, allowlist step). */
  setup?: string[];
  /** Tool names the server advertised (probe/test only; never secrets). */
  tools?: string[];
}

export interface FetchOptions {
  /** Extra allowed executables (absolute paths or PATH names), from settings. */
  allowedCommands?: string[];
  /** Whole-operation timeout (spawn + protocol + calls). Default 30 s. */
  timeoutMs?: number;
  /** Working directory for the child process. */
  cwd?: string;
  /** IANA timezone for date templates ({today}, {todayStart}…). */
  tz?: string;
  now?: number;
  /** Cap on items returned. */
  maxItems?: number;
  /** Fetch implementation for `transport: "api"` (tests inject one). */
  fetchImpl?: typeof fetch;
}

export class ReadOnlyViolationError extends Error {
  constructor(tool: string) {
    super(`Refused to call "${tool}": connector data access is read-only.`);
    this.name = "ReadOnlyViolationError";
  }
}

export class McpProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpProtocolError";
  }
}

/** Verbs that mark a tool as writing, whatever the mapping says. */
const WRITE_VERBS = new Set([
  "create", "update", "delete", "remove", "send", "modify", "write", "patch", "put", "post", "move",
  "trash", "archive", "mark", "draft", "insert", "upload", "execute", "exec", "run", "set", "add",
  "reply", "forward", "cancel", "accept", "decline", "rsvp", "edit", "rename", "purge", "clear",
]);

/** Split `list_events`, `list-events`, `listEvents` into lowercase tokens. */
export function toolTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+|\s+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

export function isWriteLikeTool(name: string): boolean {
  return toolTokens(name).some((t) => WRITE_VERBS.has(t));
}

/** Tools a mapping is allowed to call (deny-list applied on top). */
export function allowedTools(mapping: DataMapping): Set<string> {
  const names = new Set<string>();
  for (const t of [mapping.tools.list, mapping.tools.flagged]) if (t?.name) names.add(t.name);
  if (mapping.tools.summary?.name) names.add(mapping.tools.summary.name);
  for (const n of [...names]) if (isWriteLikeTool(n)) names.delete(n);
  return names;
}

const PROTOCOL_VERSION = "2024-11-05";
const MAX_LINE_BYTES = 4 * 1024 * 1024;
const MAX_STDERR = 16 * 1024;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export interface McpTool {
  name: string;
  description?: string;
}

export interface McpClientOptions {
  cwd: string;
  env?: Record<string, string>;
  allowPaths?: string[];
  /** Per-request timeout. */
  requestTimeoutMs?: number;
}

export class McpStdioClient {
  private child: ChildProcess | null = null;
  private pending = new Map<number, Pending>();
  private seq = 0;
  private buffer = "";
  private stderrTail = "";
  private exited: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  private closed = false;
  private readonly readOnly: Set<string> | null;

  constructor(
    private readonly executable: string,
    private readonly args: string[],
    private readonly opts: McpClientOptions,
    /** When given, `callTool` refuses any tool outside this set. */
    readOnlyTools: Set<string> | null = null,
  ) {
    this.readOnly = readOnlyTools;
  }

  /** Spawn the server (allowlist-checked) and run the initialize handshake. */
  async start(): Promise<{ serverName: string | null }> {
    assertAllowed(this.executable, this.opts.allowPaths);
    const child = spawn(this.executable, this.args, {
      cwd: this.opts.cwd,
      env: this.opts.env ?? minimalEnv([]),
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      shell: false,
      windowsHide: true,
    });
    this.child = child;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.onData(chunk));
    child.stderr?.on("data", (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-MAX_STDERR);
    });
    child.stdin?.on("error", () => undefined);
    const spawned = new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", (err) => reject(err));
    });
    child.on("close", (code, signal) => {
      this.exited = { code, signal };
      this.failAll(new McpProtocolError(`MCP server exited (${signal ?? code}). ${this.stderrHint()}`.trim()));
    });
    await spawned;
    const init = (await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "mordomo-os", version: "0.4" },
    })) as { serverInfo?: { name?: string } } | undefined;
    this.notify("notifications/initialized", {});
    return { serverName: init?.serverInfo?.name ?? null };
  }

  async listTools(): Promise<McpTool[]> {
    const res = (await this.request("tools/list", {})) as { tools?: unknown } | undefined;
    const tools = Array.isArray(res?.tools) ? res!.tools : [];
    return tools
      .filter((t): t is Record<string, unknown> => !!t && typeof t === "object" && typeof (t as { name?: unknown }).name === "string")
      .map((t) => ({ name: t.name as string, description: typeof t.description === "string" ? t.description : undefined }));
  }

  /** Call a tool; refused when it is outside the read-only set or write-like. */
  async callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean; raw: unknown }> {
    if (isWriteLikeTool(name) || (this.readOnly && !this.readOnly.has(name))) throw new ReadOnlyViolationError(name);
    const res = (await this.request("tools/call", { name, arguments: args })) as
      | { content?: unknown; isError?: boolean; structuredContent?: unknown }
      | undefined;
    const content = Array.isArray(res?.content) ? res!.content : [];
    const text = content
      .map((c) => (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : ""))
      .filter(Boolean)
      .join("\n");
    return { text, isError: Boolean(res?.isError), raw: res?.structuredContent ?? null };
  }

  /** Kill the whole process group and fail anything still pending. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new McpProtocolError("MCP client closed."));
    const pid = this.child?.pid;
    if (pid != null && !this.exited) {
      killProcessGroup(pid, "SIGTERM");
      const t = setTimeout(() => {
        if (!this.exited) killProcessGroup(pid, "SIGKILL");
      }, 2000);
      t.unref();
    }
  }

  stderr(): string {
    return this.stderrTail;
  }

  private stderrHint(): string {
    const tail = redactSecrets(this.stderrTail.trim()).split("\n").slice(-3).join(" ");
    return tail ? `stderr: ${tail.slice(0, 300)}` : "";
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.closed || this.exited || !this.child?.stdin?.writable) {
      return Promise.reject(new McpProtocolError(`MCP server is not running (${method}). ${this.stderrHint()}`.trim()));
    }
    const id = ++this.seq;
    const line = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpProtocolError(`Timed out waiting for ${method} (${this.opts.requestTimeoutMs ?? 15_000} ms).`));
      }, this.opts.requestTimeoutMs ?? 15_000);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin!.write(line, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new McpProtocolError(`Could not write to the MCP server: ${redactSecrets(err.message)}`));
        }
      });
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    if (!this.child?.stdin?.writable) return;
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n", () => undefined);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > MAX_LINE_BYTES) {
      this.buffer = "";
      this.failAll(new McpProtocolError("MCP server sent an oversized message."));
      return;
    }
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line) as Record<string, unknown>;
      } catch {
        // Servers sometimes log to stdout; ignore non-JSON lines rather than failing the session.
        continue;
      }
      if (!msg || typeof msg !== "object") continue;
      const id = typeof msg.id === "number" ? msg.id : null;
      if (id === null) continue; // notification / request from the server: ignored (we offer no capabilities)
      const pending = this.pending.get(id);
      if (!pending) continue;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      if (msg.error) {
        const err = msg.error as { message?: string; code?: number };
        pending.reject(new McpProtocolError(`MCP error ${err.code ?? ""}: ${redactSecrets(String(err.message ?? "unknown"))}`.trim()));
      } else {
        pending.resolve(msg.result);
      }
    }
  }

  private failAll(err: Error): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }
}

/** Minimal environment for connector children: PATH/HOME essentials plus the named pass-throughs. */
export function minimalEnv(names: string[], source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ["PATH", "HOME", "USERPROFILE", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "SystemRoot", "APPDATA", "LOCALAPPDATA", ...names]) {
    const v = source[key];
    if (typeof v === "string") out[key] = v;
  }
  return out;
}

// ------------------------------------------------------------- mapping --

/** Resolve `a.b[0].c` / `a[*].b` / `` against a JSON value. `[*]` fans out into a flat array. */
export function resolvePath(value: unknown, pathExpr: string): unknown {
  const trimmed = pathExpr.trim();
  if (!trimmed) return value;
  const tokens = trimmed.match(/[^.[\]]+|\[\*\]|\[\d+\]/g) ?? [];
  let current: unknown[] = [value];
  for (const token of tokens) {
    const next: unknown[] = [];
    for (const node of current) {
      if (node == null) continue;
      if (token === "[*]") {
        if (Array.isArray(node)) next.push(...node);
      } else if (/^\[\d+\]$/.test(token)) {
        if (Array.isArray(node)) next.push(node[Number(token.slice(1, -1))]);
      } else if (typeof node === "object") {
        const obj = node as Record<string, unknown>;
        const key = Object.keys(obj).find((k) => k === token) ?? Object.keys(obj).find((k) => k.toLowerCase() === token.toLowerCase());
        next.push(key === undefined ? undefined : obj[key]);
      }
    }
    current = next;
    if (trimmed.includes("[*]")) continue;
  }
  return trimmed.includes("[*]") ? current.filter((v) => v !== undefined) : current[0];
}

function fieldValue(item: unknown, spec: FieldSpec | undefined): unknown {
  if (spec === undefined) return undefined;
  const p = typeof spec === "string" ? spec : spec.path;
  let v = resolvePath(item, p);
  if (typeof spec === "object") {
    if (spec.includesAny) {
      const hay = Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : [];
      const anyHit = spec.includesAny.some((needle) => hay.some((h) => h === needle || h.toLowerCase().includes(needle.toLowerCase())));
      return anyHit;
    }
    if (spec.equals !== undefined) return v === spec.equals;
  }
  // Google-style { dateTime | date } objects
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    v = o.dateTime ?? o.date ?? o.value ?? o.text ?? o.name ?? undefined;
  }
  return v;
}

function toText(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(toText).filter(Boolean).join(", ") || undefined;
  return undefined;
}

function toTs(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string") {
    const ms = Date.parse(v);
    if (Number.isFinite(ms)) return ms;
    const n = Number(v);
    if (Number.isFinite(n) && v.trim() !== "") return n < 1e12 ? n * 1000 : n;
  }
  return undefined;
}

/** Parse the text of a tool result into structured data according to `parse` (with graceful fallbacks). */
export function parseToolText(text: string, parse: ToolMapping["parse"]): { kind: "json"; data: unknown } | { kind: "records"; data: Record<string, string>[] } {
  const trimmed = text.trim();
  if (parse === "json" || parse === undefined) {
    try {
      return { kind: "json", data: JSON.parse(trimmed) };
    } catch {
      // Not JSON: many community servers print formatted text. Fall back.
      parse = /^[A-Za-z][\w /-]{0,30}:\s/m.test(trimmed) ? "blocks" : "lines";
    }
  }
  if (parse === "blocks") {
    const records = trimmed
      .split(/\n\s*\n|\n(?=-{3,})|\n(?=={3,})/)
      .map((block) => block.replace(/^[-=]{3,}\s*$/gm, "").trim())
      .filter(Boolean)
      .map((block) => {
        const rec: Record<string, string> = {};
        let first = "";
        for (const line of block.split("\n")) {
          const m = line.match(/^\s*([A-Za-z][\w /-]{0,30}?)\s*:\s*(.*)$/);
          if (m) rec[m[1]!.trim().toLowerCase()] = m[2]!.trim();
          else if (!first && line.trim()) first = line.trim();
        }
        if (first && !rec["_first"]) rec["_first"] = first;
        return rec;
      })
      .filter((r) => Object.keys(r).length > 0);
    return { kind: "records", data: records };
  }
  const lines = trimmed
    .split("\n")
    .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter(Boolean);
  return { kind: "records", data: lines.map((l) => ({ _first: l })) };
}

/** Turn a parsed tool result into normalized items. */
export function itemsFromParsed(parsed: ReturnType<typeof parseToolText>, mapping: ToolMapping, maxItems = 50): ConnectorItem[] {
  let raw: unknown[];
  let byRecord = false;
  if (parsed.kind === "json") {
    const at = resolvePath(parsed.data, mapping.path);
    raw = Array.isArray(at) ? at : at && typeof at === "object" ? Object.values(at as Record<string, unknown>) : [];
  } else {
    raw = parsed.data;
    byRecord = true;
  }
  const f = mapping.fields;
  const out: ConnectorItem[] = [];
  raw.slice(0, maxItems).forEach((item, i) => {
    const get = (spec: FieldSpec | undefined): unknown => {
      if (!byRecord) return fieldValue(item, spec);
      const rec = item as Record<string, string>;
      if (spec === undefined) return undefined;
      const key = (typeof spec === "string" ? spec : spec.path).toLowerCase();
      const v = rec[key] ?? rec[key.replace(/[_-]/g, " ")];
      if (typeof spec === "object" && spec.includesAny) return spec.includesAny.some((n) => (v ?? "").toLowerCase().includes(n.toLowerCase()));
      return v;
    };
    const title = toText(get(f.title)) ?? (byRecord ? ((item as Record<string, string>)["_first"] ?? (item as Record<string, string>)["subject"] ?? (item as Record<string, string>)["title"]) : toText(fieldValue(item, "title") ?? fieldValue(item, "summary") ?? fieldValue(item, "subject") ?? fieldValue(item, "name")));
    const id = toText(get(f.id)) ?? (byRecord ? ((item as Record<string, string>)["id"] ?? null) : toText(fieldValue(item, "id"))) ?? `${i}`;
    const entry: ConnectorItem = { id: String(id), title: (title ?? "").slice(0, 200) || `#${i + 1}` };
    const subtitle = toText(get(f.subtitle));
    if (subtitle) entry.subtitle = subtitle.slice(0, 200);
    const ts = toTs(get(f.ts));
    if (ts !== undefined) entry.ts = ts;
    const flagged = get(f.flagged);
    if (flagged !== undefined) entry.flagged = flagged === true || flagged === "true" || flagged === 1;
    const tag = toText(get(f.tag));
    if (tag) entry.tag = tag.slice(0, 40);
    const href = toText(get(f.href));
    if (href && /^https?:\/\//.test(href)) entry.href = href;
    out.push(entry);
  });
  return out;
}

/** Fill {today}, {todayStart}, {todayEnd}, {tomorrow}, {tz} in string args. */
export function renderArgs(args: Record<string, unknown>, tz: string, now = Date.now()): Record<string, unknown> {
  const today = dateIn(now, tz);
  const tomorrow = dateIn(now + 86_400_000, tz);
  const vars: Record<string, string> = {
    today,
    tomorrow,
    todayStart: `${today}T00:00:00`,
    todayEnd: `${today}T23:59:59`,
    tz,
  };
  const render = (v: unknown): unknown => {
    if (typeof v === "string") return v.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
    if (Array.isArray(v)) return v.map(render);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, render(x)]));
    return v;
  };
  return render(args) as Record<string, unknown>;
}

function dateIn(instant: number, tz: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
    return fmt.format(new Date(instant));
  } catch {
    return new Date(instant).toISOString().slice(0, 10);
  }
}

/** Substitute `$ENV_NAME` tokens; returns the names that were missing (never values). */
export function substituteEnv(template: string, source: NodeJS.ProcessEnv = process.env): { value: string; missing: string[] } {
  const missing: string[] = [];
  const value = template.replace(/\$([A-Z][A-Z0-9_]*)/g, (m, name: string) => {
    const v = source[name];
    if (v === undefined) {
      missing.push(name);
      return m;
    }
    return v;
  });
  return { value, missing };
}

/** Copyable setup checklist for a connector (names only, never values). */
export function setupChecklist(connector: Connector, opts: FetchOptions = {}): string[] {
  const m = connector.dataMapping;
  const lines: string[] = [];
  if (!m) {
    lines.push(`Add a "dataMapping" block to connectors/${connector.id}.json (see docs/user-manual.md › Connectors).`);
    return lines;
  }
  if (m.install) lines.push(`Install: ${m.install}`);
  if (m.transport === "mcp") {
    if (m.command) {
      const resolved = resolveCommand(m.command);
      lines.push(resolved ? `Command: ${m.command} (found at ${resolved})` : `Command: ${m.command} (NOT found on PATH)`);
      const allowed = resolved ? isAllowed(resolved, opts.allowedCommands ?? []) : false;
      if (!allowed) lines.push(`Allowlist it: add "${m.command}" (or its absolute path) to settings.connectors.allowedCommands.`);
    } else {
      lines.push("Set dataMapping.command to the MCP server executable.");
    }
    if (m.env.length) lines.push(`Environment variables the service must have: ${m.env.join(", ")} (values are never read by the UI).`);
    if (m.tools.list?.name) lines.push(`Read-only tool used: ${m.tools.list.name}`);
  } else {
    if (!m.url) lines.push(`Set dataMapping.url to the JSON endpoint to read (GET). $ENV_NAME tokens are substituted from the service environment.`);
    else {
      const names = [...m.url.matchAll(/\$([A-Z][A-Z0-9_]*)/g)].map((x) => x[1]!);
      for (const h of Object.values(m.headers)) for (const x of h.matchAll(/\$([A-Z][A-Z0-9_]*)/g)) names.push(x[1]!);
      if (names.length) lines.push(`Environment variables the service must have: ${[...new Set(names)].join(", ")}.`);
    }
  }
  lines.push(...m.setup);
  return lines;
}

/** Resolve a mapping command to an absolute path (null when not found). */
export function resolveCommand(command: string): string | null {
  if (path.isAbsolute(command)) return command;
  return findOnPath(command);
}

/** Absolute paths from `allowedCommands` (bare names resolved on PATH; unknown names dropped). */
export function allowPathsFrom(allowedCommands: string[]): string[] {
  const out: string[] = [];
  for (const entry of allowedCommands) {
    const resolved = resolveCommand(entry);
    if (resolved) out.push(resolved);
  }
  return out;
}

function isAllowed(executable: string, allowedCommands: string[]): boolean {
  try {
    assertAllowed(executable, allowPathsFrom(allowedCommands));
    return true;
  } catch {
    return false;
  }
}

function notConfigured(connector: Connector, message: string, opts: FetchOptions): ConnectorData {
  return { status: "not_configured", syncedAt: null, message, items: [], setup: setupChecklist(connector, opts) };
}

function summaryFromItems(items: ConnectorItem[]): Record<string, number> {
  return { total: items.length, flagged: items.filter((i) => i.flagged).length };
}

/**
 * Read a connector's data. Never throws: problems come back as
 * `not_configured` (setup missing) or `error` (setup present but the read
 * failed), with redacted messages.
 */
export async function fetchConnectorData(connector: Connector, opts: FetchOptions = {}): Promise<ConnectorData> {
  const mapping = connector.dataMapping;
  if (!mapping) return notConfigured(connector, "This connector has no read-only data mapping yet.", opts);
  try {
    if (mapping.transport === "api") return await fetchApiData(connector, mapping, opts);
    return await fetchMcpData(connector, mapping, opts);
  } catch (err) {
    return {
      status: "error",
      syncedAt: null,
      message: redactSecrets((err as Error).message).slice(0, 500),
      items: [],
      setup: setupChecklist(connector, opts),
    };
  }
}

async function fetchApiData(connector: Connector, mapping: DataMapping, opts: FetchOptions): Promise<ConnectorData> {
  if (!mapping.url) return notConfigured(connector, "No URL configured for this API connector.", opts);
  const url = substituteEnv(mapping.url);
  const headers: Record<string, string> = {};
  const missing = [...url.missing];
  for (const [k, v] of Object.entries(mapping.headers)) {
    const sub = substituteEnv(v);
    missing.push(...sub.missing);
    headers[k] = sub.value;
  }
  if (missing.length) {
    return notConfigured(connector, `Missing environment variable(s): ${[...new Set(missing)].join(", ")}.`, opts);
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url.value);
  } catch {
    return notConfigured(connector, "dataMapping.url is not a valid URL.", opts);
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return notConfigured(connector, "dataMapping.url must be http(s).", opts);
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetchImpl(url.value, { method: "GET", headers, signal: controller.signal, redirect: "error" });
    if (!res.ok) throw new Error(`Endpoint responded ${res.status}.`);
    const text = await res.text();
    const parsed = parseToolText(text, "json");
    const listMapping = mapping.tools.list ?? { name: "GET", args: {}, parse: "json" as const, path: "", fields: {} };
    const items = itemsFromParsed(parsed, listMapping, opts.maxItems ?? 50);
    const summary = { ...summaryFromItems(items), ...summaryFromJson(parsed, mapping) };
    return { status: "ok", syncedAt: opts.now ?? Date.now(), items, summary };
  } catch (err) {
    // Never echo the URL (it may carry substituted tokens).
    const message = redactSecrets((err as Error).message).replace(url.value, "[url]");
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }
}

function summaryFromJson(parsed: ReturnType<typeof parseToolText>, mapping: DataMapping): Record<string, number> {
  const spec = mapping.tools.summary;
  if (!spec || parsed.kind !== "json") return {};
  const node = resolvePath(parsed.data, spec.path);
  if (!node || typeof node !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (spec.keys && !spec.keys.includes(k)) continue;
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

async function fetchMcpData(connector: Connector, mapping: DataMapping, opts: FetchOptions): Promise<ConnectorData> {
  if (!mapping.command) return notConfigured(connector, "No MCP command configured for this connector.", opts);
  if (!mapping.tools.list?.name) return notConfigured(connector, "The data mapping declares no read-only list tool.", opts);
  const resolved = resolveCommand(mapping.command);
  if (!resolved) {
    return notConfigured(connector, `Command "${mapping.command}" was not found on PATH.${mapping.install ? ` Install: ${mapping.install}` : ""}`, opts);
  }
  const allowPaths = allowPathsFrom(opts.allowedCommands ?? []);
  try {
    assertAllowed(resolved, allowPaths);
  } catch (err) {
    if (err instanceof ExecutableNotAllowedError) {
      return notConfigured(connector, `"${mapping.command}" is not on the executable allowlist. Add it to settings.connectors.allowedCommands.`, opts);
    }
    throw err;
  }
  const missingEnv = mapping.env.filter((name) => process.env[name] === undefined);
  if (missingEnv.length) {
    return notConfigured(connector, `Missing environment variable(s) for this connector: ${missingEnv.join(", ")}.`, opts);
  }
  const tz = opts.tz || "UTC";
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const started = Date.now();
  const client = new McpStdioClient(
    resolved,
    mapping.args,
    { cwd: opts.cwd ?? process.cwd(), env: minimalEnv(mapping.env), allowPaths, requestTimeoutMs: timeoutMs },
    allowedTools(mapping),
  );
  const hardStop = setTimeout(() => client.close(), timeoutMs);
  hardStop.unref();
  try {
    await client.start();
    const tools = await client.listTools();
    const names = tools.map((t) => t.name);
    const listTool = mapping.tools.list;
    if (!names.includes(listTool.name)) {
      throw new McpProtocolError(`The server does not offer tool "${listTool.name}" (available: ${names.slice(0, 12).join(", ") || "none"}).`);
    }
    const remaining = () => Math.max(1000, timeoutMs - (Date.now() - started));
    const listRes = await withTimeout(client.callTool(listTool.name, renderArgs(listTool.args, tz, opts.now)), remaining(), listTool.name);
    if (listRes.isError) throw new McpProtocolError(`Tool "${listTool.name}" reported an error: ${listRes.text.slice(0, 300)}`);
    const parsed = listRes.raw ? { kind: "json" as const, data: listRes.raw } : parseToolText(listRes.text, listTool.parse);
    const items = itemsFromParsed(parsed, listTool, opts.maxItems ?? 50);

    const flagTool = mapping.tools.flagged;
    if (flagTool && names.includes(flagTool.name)) {
      try {
        const flagRes = await withTimeout(client.callTool(flagTool.name, renderArgs(flagTool.args, tz, opts.now)), remaining(), flagTool.name);
        if (!flagRes.isError) {
          const flagged = itemsFromParsed(flagRes.raw ? { kind: "json", data: flagRes.raw } : parseToolText(flagRes.text, flagTool.parse), flagTool, opts.maxItems ?? 50);
          const ids = new Set(flagged.map((f) => f.id));
          const titles = new Set(flagged.map((f) => f.title));
          for (const item of items) if (ids.has(item.id) || titles.has(item.title)) item.flagged = true;
        }
      } catch {
        /* flagged read is best effort */
      }
    }

    let summary = summaryFromItems(items);
    const sumTool = mapping.tools.summary;
    if (sumTool?.name && names.includes(sumTool.name)) {
      try {
        const sumRes = await withTimeout(client.callTool(sumTool.name, renderArgs(sumTool.args, tz, opts.now)), remaining(), sumTool.name);
        const parsedSum = sumRes.raw ? { kind: "json" as const, data: sumRes.raw } : parseToolText(sumRes.text, "json");
        summary = { ...summary, ...summaryFromJson(parsedSum, mapping) };
      } catch {
        /* summary is best effort */
      }
    }
    return { status: "ok", syncedAt: opts.now ?? Date.now(), items, summary, tools: names };
  } finally {
    clearTimeout(hardStop);
    client.close();
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new McpProtocolError(`Timed out after ${ms} ms (${label}).`)), ms);
    t.unref();
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: Error) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
