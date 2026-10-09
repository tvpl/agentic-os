/**
 * What the provider CLIs print, one JSON object per line, as far as MordomoOS
 * reads it. Written from the official SDK types: `@anthropic-ai/claude-agent-sdk`
 * 0.3.291 (`SDKMessage` in `sdk.d.ts`) for `claude -p --output-format
 * stream-json`, and `@openai/codex-sdk` 0.160.1 (`ThreadEvent` in
 * `dist/index.d.ts`) for `codex exec --json`. Those are the CLI contracts this
 * file holds; the adapters' `testedVersions` say which CLI versions that is.
 *
 * Every object is `.passthrough()`: a field a new CLI adds is kept, never a
 * reason to reject the line. (A passthrough object's inferred type gains an
 * index signature, so a misspelt field name still type-checks: the parsers read
 * only fields declared here.) Only fields the parsers read are declared.
 *
 * Two levels of strictness:
 *  - a field a parser needs to produce its events (ids, text, paths, the token
 *    counts of a `turn.completed`) is strict: present with the wrong type rejects
 *    the line, which the parser then counts as unrecognized;
 *  - a field that only decorates a line (`model`, `modelUsage`, the usage blocks
 *    that ride on a message that also carries text and tool calls) is tolerant:
 *    when it does not match, it reads as absent and the rest of the line is kept.
 */
import { z } from "zod";

/**
 * Token counts and prices come from a process we do not control: finite and
 * non-negative, so a corrupt line can neither become `NaN`/`Infinity` nor lower
 * a budget.
 */
const tokenCount = z.number().finite().nonnegative();
const costUsd = z.number().finite().nonnegative();

/** A field that falls back to "absent" instead of rejecting the line it sits in. */
const tolerant = <T extends z.ZodTypeAny>(schema: T) => schema.optional().catch(undefined);

/**
 * A provider conversation id as MordomoOS stores it and hands it back to the
 * CLI (`--resume <id>`, `exec resume <id>`): it never starts with `-`, so it
 * cannot be read as a flag, and has no whitespace or control characters.
 */
export const SessionId = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][\w.:-]*$/);

// ── Claude Code (stream-json) ────────────────────────────────────────────────

/** `BetaUsage` (assistant turns) / `NonNullableUsage` (result totals). */
const ClaudeUsage = z
  .object({
    input_tokens: tokenCount.optional(),
    output_tokens: tokenCount.optional(),
    cache_read_input_tokens: tokenCount.nullish(),
    cache_creation_input_tokens: tokenCount.nullish(),
  })
  .passthrough();

/** One content block (`text`, `tool_use`, `tool_result`, `thinking`, …). */
const ClaudeContentBlock = z.object({ type: z.string() }).passthrough();

const ClaudeMessageBody = z
  .object({
    model: tolerant(z.string()),
    // A user message's content may be a plain string (`MessageParam`).
    content: z.union([z.string(), z.array(ClaudeContentBlock)]).optional(),
    usage: ClaudeUsage.nullish().catch(undefined),
  })
  .passthrough();

const claudeLine = <T extends string>(type: T) =>
  z.object({ type: z.literal(type), session_id: SessionId.optional() });

/** Every `system` message carries a `subtype` (`init`, `status`, `api_retry`, `compact_boundary`, …). */
const ClaudeSystemMessage = claudeLine("system")
  .extend({ subtype: z.string(), model: tolerant(z.string()) })
  .passthrough();
const ClaudeAssistantMessage = claudeLine("assistant").extend({ message: ClaudeMessageBody }).passthrough();
const ClaudeUserMessage = claudeLine("user").extend({ message: ClaudeMessageBody }).passthrough();
const ClaudeResultMessage = claudeLine("result")
  .extend({
    result: z.string().optional(),
    total_cost_usd: costUsd.optional(),
    usage: ClaudeUsage.nullish().catch(undefined),
    modelUsage: tolerant(z.record(z.object({ outputTokens: tolerant(tokenCount) }).passthrough())),
  })
  .passthrough();

/**
 * Every top-level `SDKMessage` type. The last seven are known to the SDK but not
 * read by MordomoOS: accepted so they never count as unrecognized.
 */
export const ClaudeStreamMessage = z.discriminatedUnion("type", [
  ClaudeSystemMessage,
  ClaudeAssistantMessage,
  ClaudeUserMessage,
  ClaudeResultMessage,
  claudeLine("stream_event").passthrough(),
  claudeLine("tool_progress").passthrough(),
  claudeLine("tool_use_summary").passthrough(),
  claudeLine("auth_status").passthrough(),
  claudeLine("rate_limit_event").passthrough(),
  claudeLine("prompt_suggestion").passthrough(),
  claudeLine("conversation_reset").passthrough(),
]);
export type ClaudeStreamMessage = z.infer<typeof ClaudeStreamMessage>;

// ── OpenAI Codex (exec --json) ───────────────────────────────────────────────

/** `Usage` of `turn.completed`, and the older `token_count` blocks. */
const CodexUsage = z
  .object({
    input_tokens: tokenCount.optional(),
    output_tokens: tokenCount.optional(),
    cached_input_tokens: tokenCount.optional(),
    cache_read_input_tokens: tokenCount.optional(),
  })
  .passthrough();

/** One file of a `file_change` (`FileUpdateChange`). */
const CodexFileChange = z.object({ path: z.string(), kind: z.string().optional() }).passthrough();

const codexItem = <T extends string>(type: T) =>
  z.object({ id: z.string().optional(), type: z.literal(type) });

/** `ThreadItem`, discriminated by `item.type`. */
const CodexThreadItem = z.discriminatedUnion("type", [
  codexItem("agent_message").extend({ text: z.string() }).passthrough(),
  codexItem("reasoning").passthrough(),
  codexItem("command_execution")
    .extend({ command: z.string().optional(), status: z.string().optional() })
    .passthrough(),
  codexItem("file_change")
    .extend({ changes: z.array(CodexFileChange).optional(), status: z.string().optional() })
    .passthrough(),
  codexItem("mcp_tool_call").extend({ status: z.string().optional() }).passthrough(),
  codexItem("web_search").passthrough(),
  codexItem("todo_list").passthrough(),
  codexItem("error").extend({ message: z.string().optional() }).passthrough(),
]);

/**
 * The earlier spelling of the same items: `item.item_type` instead of
 * `item.type`. The fields the parser reads are typed, so one of the wrong type
 * (an object `text`) rejects the line instead of becoming "[object Object]".
 */
const CodexLegacyItem = z
  .object({
    id: z.string().optional(),
    item_type: z.string(),
    text: z.string().optional(),
    command: z.string().optional(),
    path: z.string().optional(),
    status: z.string().optional(),
    changes: z.array(CodexFileChange).optional(),
  })
  .passthrough();

const CodexItem = z.union([CodexThreadItem, CodexLegacyItem]);

/** Some CLI versions repeat the model on every line; it only labels usage, so a bad one reads as absent. */
const codexEvent = <T extends string>(type: T) =>
  z.object({ type: z.literal(type), model: tolerant(z.string()) });

/** `ThreadEvent`, discriminated by `type`. */
const CodexThreadEvent = z.discriminatedUnion("type", [
  codexEvent("thread.started").extend({ thread_id: SessionId }).passthrough(),
  codexEvent("turn.started").passthrough(),
  codexEvent("turn.completed").extend({ usage: CodexUsage.nullish() }).passthrough(),
  codexEvent("turn.failed")
    .extend({ error: z.object({ message: z.string() }).passthrough().optional() })
    .passthrough(),
  codexEvent("item.started").extend({ item: CodexItem }).passthrough(),
  codexEvent("item.updated").extend({ item: CodexItem }).passthrough(),
  codexEvent("item.completed").extend({ item: CodexItem }).passthrough(),
  codexEvent("error").extend({ message: z.string() }).passthrough(),
]);

/**
 * The oldest `codex exec --json` shape: `{ "id": …, "msg": { "type": …, … } }`,
 * no top-level `type`. The usage blocks belong to `token_count` alone, so a
 * strange one is rejected there and cannot reject any other message type.
 */
const CodexLegacyTokenCount = z
  .object({
    type: z.literal("token_count"),
    session_id: SessionId.optional(),
    info: z
      .object({ total_token_usage: CodexUsage.optional(), token_usage: CodexUsage.optional() })
      .passthrough()
      .nullish(),
    total_token_usage: CodexUsage.optional(),
    token_usage: CodexUsage.optional(),
  })
  .passthrough();
const CodexLegacyOtherMsg = z
  .object({
    type: z.string().refine((t) => t !== "token_count"),
    message: tolerant(z.string()),
    session_id: SessionId.optional(),
  })
  .passthrough();
const CodexLegacyEvent = z
  .object({
    session_id: SessionId.optional(),
    model: tolerant(z.string()),
    msg: z.union([CodexLegacyTokenCount, CodexLegacyOtherMsg]),
  })
  .passthrough();

export const CodexStreamEvent = z.union([CodexThreadEvent, CodexLegacyEvent]);
export type CodexStreamEvent = z.infer<typeof CodexStreamEvent>;

/**
 * The message types each schema knows, so a rejected line can say whether its
 * type is new to us or one of these with a field that did not match.
 */
export const KnownStreamTypes = {
  claude: new Set<string>(ClaudeStreamMessage.options.map((o) => o.shape.type.value)),
  codex: new Set<string>(CodexThreadEvent.options.map((o) => o.shape.type.value)),
  codexItem: new Set<string>(CodexThreadItem.options.map((o) => o.shape.type.value)),
} as const;
