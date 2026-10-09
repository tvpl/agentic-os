# Adaptadores tipados checks

Profile: standard
Plan: `.specs/features/adaptadores-tipados/plan.md`

22 checks in 5 slices · 5 one-way doors · 0 open, of which 0 block

Comandos (da raiz): `npx vitest run tests/adapters.typed.test.ts -t "<nome>"`; a interface com
`npm run test -w apps/command-centre -- <arquivo> -t "<nome>"`. As fixtures ficam em
`tests/fixtures/streams/{claude,codex}/*.jsonl`, uma por cenário, escritas a partir dos tipos
oficiais dos SDKs (citados no cabeçalho de cada arquivo de teste).

Os checks C16-C22 e as emendas aos C2, C4, C6, C7, C9-C15 vêm da revisão de código sênior da feature (não de uma
rodada do Verifier): cada um foi fechado só depois da prova rodar.

## Checks

### S1 - mensagens com tipo · 6 files · 60 KB · ~15k

**C1** - Toda linha de toda fixture em `tests/fixtures/streams/claude` passa em `ClaudeStreamMessage.safeParse`, e toda linha de `tests/fixtures/streams/codex` passa em `CodexStreamEvent.safeParse`; um campo extra (`{ ..., "novo": 1 }`) continua no resultado (AC 1)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C1 every fixture line matches its schema"`
Status: closed

**C2** - `@mordomo/contracts` exporta `ClaudeStreamMessage` e `CodexStreamEvent` (importados da raiz do pacote) e, do arquivo dos schemas, só mais `SessionId` e `KnownStreamTypes`; as peças internas não são API pública (AC 1)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C2 the stream schemas are part of the contract"`
Status: closed

**C3** - O parser do Claude, sobre a fixture `claude/complete-run.jsonl`, emite a sequência de eventos gravada em `claude/complete-run.events.json`, gerada com o parser de antes da feature (commit base) e conferida à mão (AC 2)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C3 the claude parser keeps its event sequence"`
Status: closed

**C4** - O parser do Codex emite a mesma sequência para `codex/item-type-current.jsonl` (`item.type`) e para `codex/item-type-legacy.jsonl` (`item_type`), a menos do campo `paths` do `file_change` (C15), e a do formato antigo `codex/legacy-msg.jsonl` não muda (AC 3)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C4 both codex item shapes parse alike"`
Status: closed

**C5** - O CLI falso `tests/fixtures/fake-bin/codex` emite `item.type`, e uma execução do Codex pelo `RunManager` termina `done` com `assistant` e `usage` (AC 3)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C5 the fake codex speaks the current format"`
Status: closed

### S2 - linhas estranhas · 4 files · 40 KB · ~10k

**C6** - Cada um dos três parsers (claude, codex, cursor) recebe `oi`, `{"type":"assistant"` (truncada), `null`, `[]`, `[1]`, `"str"`, `42`, `true`, quatorze objetos de forma errada (`content: 5`, `content: [null,5]`, `message: null`, `item: null`, `changes: 5`, `msg: null`, …) e uma linha JSON de 1 MiB e não lança; `oi`, a truncada e os JSON que não são objeto devolvem `null` (viram `text`) (AC 4)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C6 a strange line never throws"`
Status: closed

**C7** - Uma execução do Claude falso cujo prompt tem `[[unknown:novidade]]` (gatilho novo do CLI falso: imprime `{"type":"novidade"}` duas vezes) termina `done` e tem exatamente um evento `text` `[mordomo] claude emitted 2 unrecognized line(s): unknown type novidade. <consequência e dica>`, antes do `result` (AC 5)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C7 unknown lines become one warning"`
Status: closed

**C8** - Uma execução do Claude falso sem o gatilho não tem nenhum evento com `unrecognized` (AC 6)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C8 a known run has no warning"`
Status: closed

**C9** - Um `result` do Claude com `total_cost_usd` `"x"`, `-1` ou `1e999`, e um `turn.completed` do Codex com `usage` de `"x"`, negativo ou `1e999`, não geram `usage` e contam como `known type … with an invalid field`; um `token_count` antigo com `-1` idem, e uma mensagem antiga de outro tipo com `info: 5` continua lida (AC 7)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C9 a wrong needed field is unrecognized, never NaN or negative"`
Status: closed

### S3 - versão conferida · 6 files · 50 KB · ~13k

**C10** - Os manifestos de claude (`2.0.0`–`2.1.291`) e codex (`0.100.0`–`0.160.1`) declaram `testedVersions` com `min` ≤ `max`; o do cursor não declara e o status dele é `unknown` (AC 8)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C10 claude and codex declare the range they were developed against, cursor declares none"`
Status: closed

**C11** - `versionStatus(range, saída)` devolve `tested` para `2.1.0 (Claude Code)`, `older` para `0.0.1`, `newer` para `99.0.0`, `unknown` para `dev build`, os limites `min` e `max` contam como `tested`, uma pré-release vale a sua versão, uma faixa malformada dá `unknown`, e `installedVersion` devolve o semver (`codex-cli 0.99.0-fake` → `0.99.0`) ou `null` (AC 9)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C11 the version status follows the range"`
Status: closed

**C12** - Com o Claude falso respondendo `--version` `0.0.1` (`FAKE_CLAUDE_VERSION`), o snapshot de `GET /api/providers` traz `installedVersion` `"0.0.1"` e `versionStatus` `"older"` (AC 9)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C12 an older CLI is reported as older"`
Status: closed

**C13** - `GET /api/providers` traz `installedVersion`, `versionStatus` e `testedVersions` em cada snapshot, com os valores literais esperados (claude `tested` 2.1.0, codex `older` 0.99.0, cursor `unknown` com `testedVersions: null`) (AC 10)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C13 snapshots carry the version status"`
Status: closed

**C14** - A aba de provedores mostra o aviso com o semver lido (não o texto cru de `--version`), a faixa com que esta versão foi desenvolvida e o que fazer, quando `versionStatus` é `older` ou `newer`, e não mostra com `tested` nem `unknown` nem sem os campos novos (AC 11)
Proof: `npm run test -w apps/command-centre -- src/views/settings/providers.test.tsx -t "C14 an untested CLI version shows a notice"`
Status: closed

### S4 - escritas do Codex · 4 files · 30 KB · ~8k

**C15** - O parser do Codex põe todos os `changes[].path` de um `file_change` em `paths` no evento `tool_use` (o `detail` volta a ser `{"status":"completed"}`), com o caminho do Windows `C:\work\b.ts` literal, o `writeToolPattern` do Codex casa `file_change`, e uma execução do Codex falso com `[[patch]]` (sete caminhos, cinco deles longos: mais de 400 caracteres no total) grava os sete em `filesChanged` pelo `RunManager` (AC 12, 13)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C15 every path of a codex file_change counts as changed"`
Status: closed

### Rodada 2 - revisão de qualidade · 4 files · 40 KB · ~25k

**C16** - Um `file_change` com 300 caminhos põe só os 200 primeiros em `paths`, cada um inteiro; caminhos vazios ou com mais de 4096 caracteres ficam de fora; sem `changes` o evento não tem `paths` (AC 13)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C16 the paths of a patch are neither cut nor unbounded"`
Status: closed

**C17** - Um `tool_use` `Write`/`Edit` sem `paths` (adaptador de teste) cujo `content` cita `/var/www` e `/etc/hosts` grava só o primeiro caminho em `filesChanged`, e um nome com vírgula (`/repo/with, comma.ts`) é cortado no espaço como antes da feature (AC 14)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C17 a tool without paths records its first path only, as before"`
Status: closed

**C18** - O aviso separa `unknown type X` de `known type X with an invalid field`, nomeia o item do Codex (`item.completed/collab_tool_call`), imprime o tipo só com `[\w.:/-]` e até 40 caracteres (nenhum caractere de controle nem bidi sobrevive) e termina com a consequência e onde conferir a versão do CLI (AC 5)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C18 the warning names the real reason and prints only safe text"`
Status: closed

**C19** - Um `session_id`/`thread_id` com `-`, espaço, quebra de linha, vazio, 201 caracteres ou não ASCII torna a linha desconhecida e não gera evento `session`; um id guardado assim não chega a `--resume` nem a `exec resume` (começa uma conversa nova), e um UUID chega (AC 16)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C19 a provider session id is a plain token, here and on the command line"`
Status: closed

**C20** - Uma mensagem `assistant` do Claude com `usage` malformado (`input_tokens: null`, `"x"`, negativo, `usage: "x"`, `model: 5`) ainda emite o texto e o `tool_use`; um `result` com `usage` nulo, malformado ou `modelUsage: 5` ainda emite o custo; `usage` malformado conta no aviso e `null` não (AC 17)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C20 a bad decorative field does not drop the line"`
Status: closed

**C21** - Sobre `codex/failed-turn.jsonl` o parser emite um `text` para o item `error`, um para o `error` do topo e um para o `turn.failed`, com a mensagem, e nenhum evento `error` nem aviso; um `turn.failed` sem mensagem também deixa uma linha (AC 18)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C21 a failed codex turn is never silent"`
Status: closed

**C22** - Pelo `executeInvocation` real: um parser cujo `parseLine`, `summarize` e `finish` lançam deixa a execução terminar com `result` (`exitCode` 0, sem evento `error`) e duas notas; um parser com `dropped()` é chamado uma vez por linha; uma linha de 1 MiB em vários pedaços é lida inteira; uma de 5 MiB (acima de 4 MiB) é descartada e contada uma vez (`an unreadable line`) e a execução segue até o `result` (AC 15)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C22 a throwing parser, or a huge line, costs that line and nothing more"`
Status: closed

## Coverage

| Set (size)                                        | Member -> proof                                                                                                                                       | Unproven |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| mensagens do Claude lidas (4)                     | `system/init` C1, C3 · `assistant` C1, C3 · `user` C1, C3 · `result` C1, C3                                                                           | -        |
| formas de evento do Codex (3)                     | `item.type` C4, C5 · `item_type` C4 · `msg.*` C4                                                                                                      | -        |
| linhas estranhas (7)                              | não-JSON C6 · `null`, texto, número, `true`, array C6 · truncada C6 · 1 MiB C6 · forma errada aninhada C6 · acima de 4 MiB C22 · parser que lança C22 | -        |
| parsers que não lançam (3)                        | claude C6 · codex C6 · cursor C6                                                                                                                      | -        |
| desfechos do aviso (2)                            | com linhas desconhecidas C7 · sem C8                                                                                                                  | -        |
| campos necessários com tipo errado (2 provedores) | Claude C9 · Codex C9                                                                                                                                  | -        |
| campos decorativos com tipo errado (3)            | `usage` de mensagem C20 · `usage`/`modelUsage` de `result` C20 · `model` C20                                                                          | -        |
| motivos do aviso (2)                              | `unknown type` C7, C18 · `known type … with an invalid field` C9, C18                                                                                 | -        |
| ids de sessão inválidos (2 destinos)              | linha do stream C19 · argv de `--resume` / `exec resume` C19                                                                                          | -        |
| falhas do Codex (3)                               | `turn.failed` C21 · `error` do topo C21 · item `error` C21                                                                                            | -        |
| `versionStatus` (4)                               | `tested` C11 · `older` C11, C12 · `newer` C11 · `unknown` C11, C13 (cursor)                                                                           | -        |
| manifestos embutidos (3)                          | claude C10 · codex C10 · cursor (sem faixa) C10                                                                                                       | -        |
| caminhos de um `file_change` (2 formas)           | POSIX C15 · Windows C15                                                                                                                               | -        |
| origem de `filesChanged` (2)                      | `paths` C15, C16 · primeiro caminho de `detail` C17                                                                                                   | -        |
| doors (5)                                         | schemas C1, C2 · aviso C7, C8, C18 · faixa C10-C13 · formato antigo do Codex C4 · `paths` C15-C17                                                     | -        |

- Claims naming a route: C13 - provado por `inject`

## Test policy

| Code                                                                          | Required proofs      | Coverage expectation                                                             |
| ----------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------- |
| Decides, not reached across a boundary (parsers, versão)                      | one at its own layer | each message shape, each status                                                  |
| Decides, reached across a boundary (snapshot)                                 | one at the boundary  | the new fields                                                                   |
| Decides, reached across a boundary (linhas do processo filho, `filesChanged`) | one at the boundary  | each way a line can fail (throws, oversize, strange shape), each source of paths |
| Instrumentation (aviso na tela)                                               | one render test      | shown and hidden                                                                 |

Evidence:

- `adapters/claude/src/index.ts` `claudeStreamParser()` e `adapters/codex/src/index.ts` `codexStreamParser()`: tipo da mensagem → evento -> decides
- closest analogue in the repo: `tests/core.usage.test.ts` (chama os parsers direto)

Cost: 1 arquivo de teste novo na raiz, 1 na interface, fixtures, 22 provas.

## Swept

- validation: C1, C9, C19, C20 (schemas; tipo errado; id de sessão; campos decorativos)
- failure modes: C6 (linha estranha não lança), C7 (formato novo vira aviso, não silêncio), C21 (turno falho do Codex), C22 (parser que lança, linha enorme)
- idempotency: n/a - nada é gravado
- authorization: n/a - nenhuma rota nova; `GET /api/providers` segue a regra de auth existente
- concurrency: n/a - um parser por execução
- data lifecycle: n/a - nada novo é guardado; as fixtures são só de teste
- dependency failure: C12, C13 (CLI de versão fora da faixa)
- state transitions: n/a - o status da execução continua decidido pelos eventos `result`/`error`, que não mudam
- observability: C7 (aviso no rastro), C14 (aviso na tela)

## Handoff

- S1-S3 ≈ 38k: adaptadores claude e codex trechos dos parsers ~25 KB, baseExec 6 KB, contrato 4 KB, fixtures novas ~15 KB, CLI falso 6 KB, providers.tsx 8 KB, testes novos ~25 KB ≈ 89 KB / 4 ≈ 22k, mais leitura - abaixo de 150k - one builder
