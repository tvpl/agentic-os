# Adaptadores tipados checks

Profile: standard
Plan: `.specs/features/adaptadores-tipados/plan.md`

14 checks in 3 slices · 3 one-way doors · 0 open, of which 0 block

Comandos (da raiz): `npx vitest run tests/adapters.typed.test.ts -t "<nome>"`; a interface com
`npm run test -w apps/command-centre -- <arquivo> -t "<nome>"`. As fixtures ficam em
`tests/fixtures/streams/{claude,codex}/*.jsonl`, uma por cenário, escritas a partir dos tipos
oficiais dos SDKs (citados no cabeçalho de cada arquivo de teste).

## Checks

### S1 - mensagens com tipo · 6 files · 60 KB · ~15k

**C1** - Toda linha de toda fixture em `tests/fixtures/streams/claude` passa em `ClaudeStreamMessage.safeParse`, e toda linha de `tests/fixtures/streams/codex` passa em `CodexStreamEvent.safeParse`; um campo extra (`{ ..., "novo": 1 }`) continua no resultado (AC 1)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C1 every fixture line matches its schema"`
Status: open

**C2** - `@mordomo/contracts` exporta `ClaudeStreamMessage` e `CodexStreamEvent` (importados da raiz do pacote) (AC 1)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C2 the stream schemas are part of the contract"`
Status: open

**C3** - O parser do Claude, sobre a fixture `claude/complete-run.jsonl`, emite a sequência de eventos gravada em `claude/complete-run.events.json`, gerada com o parser de antes da feature (commit base) e conferida à mão (AC 2)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C3 the claude parser keeps its event sequence"`
Status: open

**C4** - O parser do Codex emite a mesma sequência para `codex/item-type.jsonl` (`item.type`) e para `codex/item_type.jsonl` (`item_type`), e a do formato antigo `codex/legacy-msg.jsonl` não muda (AC 3)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C4 both codex item shapes parse alike"`
Status: open

**C5** - O CLI falso `tests/fixtures/fake-bin/codex` emite `item.type`, e uma execução do Codex pelo `RunManager` termina `done` com `assistant` e `usage` (AC 3)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C5 the fake codex speaks the current format"`
Status: open

### S2 - linhas estranhas · 4 files · 40 KB · ~10k

**C6** - Cada parser recebe, nesta ordem, `oi`, `42`, `[1]`, `{"type":"assistant"` (truncada) e uma linha JSON de 1 MiB e não lança; `oi` vira `text` (AC 4)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C6 a strange line never throws"`
Status: open

**C7** - Uma execução do Claude falso cujo prompt tem `[[unknown:novidade]]` (gatilho novo do CLI falso: imprime `{"type":"novidade"}` duas vezes) termina `done` e tem exatamente um evento `text` com `2 unrecognized line(s): novidade`, antes do `result` (AC 5)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C7 unknown lines become one warning"`
Status: open

**C8** - Uma execução do Claude falso sem o gatilho não tem nenhum evento com `unrecognized` (AC 6)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C8 a known run has no warning"`
Status: open

**C9** - Uma linha `result` do Claude com `usage.input_tokens: "x"` não gera `usage` com `NaN` e conta como desconhecida; o mesmo para `turn.completed` do Codex com `usage.output_tokens: "x"` (AC 7)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C9 a wrong field type is unknown, not NaN"`
Status: open

### S3 - versão conferida · 6 files · 50 KB · ~13k

**C10** - Os manifestos de claude, codex e cursor declaram `testedVersions` com `min` ≤ `max` em semver (AC 8)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C10 every builtin manifest declares a tested range"`
Status: open

**C11** - `versionStatus(range, saída)` devolve `tested` para `2.1.0 (Claude Code)`, `older` para `0.0.1`, `newer` para `99.0.0`, `unknown` para `dev build`, e os limites `min` e `max` contam como `tested` (AC 9)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C11 the version status follows the range"`
Status: open

**C12** - Com o Claude falso respondendo `--version` `0.0.1` (`FAKE_CLAUDE_VERSION`), `detect()` traz `versionStatus` `"older"` (AC 9)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C12 detect reports an older CLI"`
Status: open

**C13** - `GET /api/providers` traz `versionStatus` e `testedVersions` em cada snapshot (AC 10)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C13 snapshots carry the version status"`
Status: open

**C14** - A aba de provedores mostra o aviso com a versão instalada e a faixa quando `versionStatus` é `older` ou `newer`, e não mostra com `tested` nem `unknown` (AC 11)
Proof: `npm run test -w apps/command-centre -- src/views/settings/providers.test.tsx -t "C14 an untested CLI version shows a notice"`
Status: open

## Coverage

| Set (size)                            | Member -> proof                                                             | Unproven |
| ------------------------------------- | --------------------------------------------------------------------------- | -------- |
| mensagens do Claude lidas (4)         | `system/init` C1, C3 · `assistant` C1, C3 · `user` C1, C3 · `result` C1, C3 | -        |
| formas de evento do Codex (3)         | `item.type` C4, C5 · `item_type` C4 · `msg.*` C4                            | -        |
| linhas estranhas (5)                  | não-JSON C6 · número C6 · array C6 · truncada C6 · 1 MiB C6                 | -        |
| desfechos do aviso (2)                | com linhas desconhecidas C7 · sem C8                                        | -        |
| campos com tipo errado (2 provedores) | Claude C9 · Codex C9                                                        | -        |
| `versionStatus` (4)                   | `tested` C11 · `older` C11, C12 · `newer` C11 · `unknown` C11               | -        |
| manifestos embutidos (3)              | claude C10 · codex C10 · cursor C10                                         | -        |
| doors (3)                             | schemas C1, C2 · aviso C7, C8 · faixa C10-C12                               | -        |

- Claims naming a route: C13 - provado por `inject`

## Test policy

| Code                                                     | Required proofs      | Coverage expectation            |
| -------------------------------------------------------- | -------------------- | ------------------------------- |
| Decides, not reached across a boundary (parsers, versão) | one at its own layer | each message shape, each status |
| Decides, reached across a boundary (snapshot)            | one at the boundary  | the new fields                  |
| Instrumentation (aviso na tela)                          | one render test      | shown and hidden                |

Evidence:

- `adapters/claude/src/index.ts` `claudeStreamParser()` e `adapters/codex/src/index.ts` `codexStreamParser()`: tipo da mensagem → evento -> decides
- closest analogue in the repo: `tests/core.usage.test.ts` (chama os parsers direto)

Cost: 1 arquivo de teste novo na raiz, 1 na interface, fixtures, 14 provas.

## Swept

- validation: C1, C9 (schemas; tipo errado)
- failure modes: C6 (linha estranha não lança), C7 (formato novo vira aviso, não silêncio)
- idempotency: n/a - nada é gravado
- authorization: n/a - nenhuma rota nova; `GET /api/providers` segue a regra de auth existente
- concurrency: n/a - um parser por execução
- data lifecycle: n/a - nada novo é guardado; as fixtures são só de teste
- dependency failure: C12 (CLI de versão fora da faixa)
- state transitions: n/a - o status da execução continua decidido pelos eventos `result`/`error`, que não mudam
- observability: C7 (aviso no rastro), C14 (aviso na tela)

## Handoff

- S1-S3 ≈ 38k: adaptadores claude e codex trechos dos parsers ~25 KB, baseExec 6 KB, contrato 4 KB, fixtures novas ~15 KB, CLI falso 6 KB, providers.tsx 8 KB, testes novos ~25 KB ≈ 89 KB / 4 ≈ 22k, mais leitura - abaixo de 150k - one builder
