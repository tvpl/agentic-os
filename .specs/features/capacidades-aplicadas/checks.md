# Capacidades aplicadas checks

Profile: standard
Plan: `.specs/features/capacidades-aplicadas/plan.md`

12 checks in 3 slices · 2 one-way doors · 0 open, of which 0 block

Comandos (da raiz): `npx vitest run tests/core.capabilities.test.ts -t "<nome>"`. O CLI falso do
Claude (`tests/fixtures/fake-bin/claude`) ganha um gatilho `[[env]]` no prompt que responde com os
nomes das variáveis de ambiente que recebeu; o falso do Cursor já existe.

## Checks

### S1 - somente-leitura sem supervisão · 3 files · 75 KB · ~19k

**C1** - Uma execução `read_only` de origem `routine` no Cursor (`enforcesReadOnly: false`) termina `failed` com erro contendo `cannot enforce read-only`, sem nenhum evento `started` do adaptador (AC 1)
Proof: `npx vitest run tests/core.capabilities.test.ts -t "C1 an unattended read-only run refuses a provider that cannot enforce it"`
Status: closed

**C2** - O mesmo para origem `sentinel` (AC 1)
Proof: `npx vitest run tests/core.capabilities.test.ts -t "C2 a sentinel read-only run refuses it too"`
Status: closed

**C3** - Uma execução `read_only` de origem `manual` no Cursor termina `done` e tem um evento `permission` cujo texto contém `only requested in the prompt` (AC 2)
Proof: `npx vitest run tests/core.capabilities.test.ts -t "C3 a manual read-only run on cursor runs with a warning"`
Status: closed

**C4** - Uma execução `read_only` de origem `routine` no Claude (`enforcesReadOnly: true`) termina `done` sem esse aviso (AC 3)
Proof: `npx vitest run tests/core.capabilities.test.ts -t "C4 an unattended read-only run on claude runs normally"`
Status: closed

### S2 - escrita sem confinamento pede um humano · 4 files · 60 KB · ~15k

**C5** - Os manifestos declaram `writeConfinement` `"broker"` (claude), `"sandbox"` (codex) e `"none"` (cursor) (AC 4)
Proof: `npx vitest run tests/core.capabilities.test.ts -t "C5 every builtin manifest declares its write confinement"`
Status: closed

**C6** - Sob `controlled_write`, `gateWrite` de uma escrita manual no Cursor devolve `pendingApproval.kind` `"write_run"` e execução `waiting_approval` (AC 5)
Proof: `npx vitest run tests/core.capabilities.test.ts -t "C6 controlled_write parks an unconfined write"`
Status: closed

**C7** - Sob `controlled_write`, `gateWrite` de uma escrita manual no Claude e no Codex devolve `{ pendingApproval: null, runId: null }` (AC 6)
Proof: `npx vitest run tests/core.capabilities.test.ts -t "C7 controlled_write lets confined writes through"`
Status: closed

**C8** - Sob `approved_automation`, `gateWrite` de uma escrita manual no Cursor devolve `{ pendingApproval: null, runId: null }` (AC 7)
Proof: `npx vitest run tests/core.capabilities.test.ts -t "C8 approved_automation lets an unconfined write through"`
Status: closed

**C9** - `POST /api/runs` com `provider: "cursor"`, `mode: "write"` sob `controlled_write` responde `202` com `status` `"waiting_approval"` e `pendingApproval.kind` `"write_run"` (AC 8)
Proof: `npx vitest run tests/core.capabilities.test.ts -t "C9 the API answers 202 for an unconfined write"`
Status: closed

### S3 - ambiente dos provedores · 4 files · 35 KB · ~9k

**C10** - Com `MORDOMO_SECRET_X` e `MORDOMO_TELEGRAM_TOKEN` no ambiente do serviço, uma execução no Claude falso não recebe nenhuma variável com prefixo `MORDOMO_` (AC 9)
Proof: `npx vitest run tests/core.capabilities.test.ts -t "C10 no MORDOMO_ variable reaches the provider"`
Status: closed

**C11** - Com `botTokenEnv` = `TG_BOT_TOKEN` e essa variável no ambiente do serviço, a execução não a recebe (AC 10)
Proof: `npx vitest run tests/core.capabilities.test.ts -t "C11 the configured bot token variable never reaches the provider"`
Status: closed

**C12** - A mesma execução recebe `PATH`, `HOME` e `ANTHROPIC_API_KEY` (AC 11)
Proof: `npx vitest run tests/core.capabilities.test.ts -t "C12 the provider keeps the rest of the environment"`
Status: closed

## Coverage

| Set (size)                                           | Member -> proof                                                                                                                   | Unproven |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------- |
| origens × `enforcesReadOnly` (4 linhas que importam) | `routine`+false C1 · `sentinel`+false C2 · `manual`+false C3 · `routine`+true C4                                                  | -        |
| manifestos embutidos (3)                             | claude C5 · codex C5 · cursor C5                                                                                                  | -        |
| `writeConfinement` × perfil que libera direto (4)    | `none`+`controlled_write` C6 · `broker`+`controlled_write` C7 · `sandbox`+`controlled_write` C7 · `none`+`approved_automation` C8 | -        |
| `POST /api/runs` statuses mudados (1)                | 202 C9                                                                                                                            | -        |
| variáveis removidas (2 regras)                       | prefixo `MORDOMO_` C10 · nome de `botTokenEnv` C11                                                                                | -        |
| variáveis mantidas (3)                               | `PATH` C12 · `HOME` C12 · `ANTHROPIC_API_KEY` C12                                                                                 | -        |
| doors (2)                                            | `writeConfinement` C5-C8 · regra de ambiente C10-C12                                                                              | -        |

- `review_before_write` não está no conjunto `writeConfinement × perfil`: ele já estaciona toda escrita manual e não muda (provado em `tests/core.engine.test.ts` C15)
- Claims naming a status code: C9 - provado por `inject` na rota

## Test policy

| Code                                                                                                              | Required proofs      | Coverage expectation                          |
| ----------------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------- |
| Decides, not reached across a boundary (`execute()` × capacidade; `gateWrite` × confinamento; filtro de ambiente) | one at its own layer | one asserted case per row of each table above |
| Decides, reached across a boundary (`POST /api/runs`)                                                             | one at the boundary  | the changed status                            |

Evidence:

- `core/src/runs/runManager.ts` `execute()`: origem sem supervisão × `enforcesReadOnly` -> 2 branch points -> decides
- `core/src/engine.ts` `gateWrite()`: decisão do perfil × `writeConfinement` -> decides
- closest analogue in the repo: `tests/core.engine.test.ts` C15-C18, mesma forma

Cost: 1 arquivo de teste novo, 12 provas; uma linha nova no CLI falso.

## Swept

- validation: n/a - nenhuma entrada nova de usuário
- failure modes: C1, C2 (recusa sem iniciar o processo)
- idempotency: n/a - nada novo é gravado além do desfecho da execução
- authorization: C6-C9 (escrita sem confinamento exige um humano)
- concurrency: n/a - a decisão é tomada por execução, sem estado compartilhado
- data lifecycle: n/a - nada persiste
- dependency failure: n/a - nenhuma dependência nova
- state transitions: C1, C2 (`queued` → `failed` sem passar por `running` do adaptador)
- observability: C3 (aviso no rastro)

## Handoff

- S1-S3 ≈ 43k: runManager.ts trecho de `execute` ~20 KB lido, registry.ts 8 KB, engine.ts 14 KB, baseExec.ts 12 KB, safeSpawn.ts 8 KB, fixture 3 KB, teste novo ~12 KB ≈ 77 KB / 4 ≈ 19k com margem - abaixo de 150k - one builder
