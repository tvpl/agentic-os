# Provider stream fixtures

One file per scenario of what a provider CLI prints, one JSON object per line.
They were written by hand from the official SDK message types, not recorded
from a real CLI (none is installed in this environment):

| Folder    | CLI                                     | Types taken from                                                     |
| --------- | --------------------------------------- | -------------------------------------------------------------------- |
| `claude/` | `claude -p --output-format stream-json` | `@anthropic-ai/claude-agent-sdk` 0.3.291, `SDKMessage` in `sdk.d.ts` |
| `codex/`  | `codex exec --json`                     | `@openai/codex-sdk` 0.160.1, `ThreadEvent` in `dist/index.d.ts`      |

- `codex/item-type-legacy.jsonl` is `codex/item-type-current.jsonl` in the earlier `item.item_type` spelling;
  `codex/legacy-msg.jsonl` is the oldest `{ "msg": { "type": … } }` shape.
- `*.events.json` is the `RunEvent` sequence (without `ts`) the parsers emitted for the fixture of
  the same name before typed parsing landed; `tests/adapters.typed.test.ts` holds the parsers to it.
- A recording from a real CLI can be added next to these; every line must pass
  `ClaudeStreamMessage` / `CodexStreamEvent` from `@mordomo/contracts`.
