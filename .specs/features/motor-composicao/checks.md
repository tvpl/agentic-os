# Motor com ciclo de vida próprio checks

Profile: standard
Plan: `.specs/features/motor-composicao/plan.md`

19 checks in 4 slices · 3 one-way doors · 0 open, of which 0 block

Comandos (da raiz): `npx vitest run tests/core.engine.test.ts -t "<nome>"`. As semeaduras usam a API
pública dos stores (`ObjectiveStore.create` + `markDispatched`, `RunManager.create`) e, para pôr uma
execução em `running`, um `UPDATE` direto (o mesmo estado que um serviço derrubado deixa).

## Checks

### S1 - montar o motor não muda estado · 4 files · 120 KB · ~30k

**C1** - Montar um motor com `createEngine` sobre uma home com etapa `dispatched` cuja execução está `queued` deixa a etapa `dispatched` com o mesmo `run_id` (AC 1)
Proof: `npx vitest run tests/core.engine.test.ts -t "C1 constructing an engine leaves a queued step dispatched"`
Status: open

**C2** - Montar um `AppContext` (o que todo comando da CLI faz) sobre a mesma semeadura deixa a etapa `dispatched` com o mesmo `run_id` (AC 1)
Proof: `npx vitest run tests/core.engine.test.ts -t "C2 constructing an AppContext leaves a queued step dispatched"`
Status: open

**C3** - Montar um motor sobre uma home com etapa `dispatched` cuja execução está `running` deixa a etapa `dispatched`, não `blocked` (AC 2)
Proof: `npx vitest run tests/core.engine.test.ts -t "C3 constructing an engine leaves a running step dispatched"`
Status: open

**C4** - Montar um motor sobre uma home com execução `running` deixa a execução `running` (AC 3)
Proof: `npx vitest run tests/core.engine.test.ts -t "C4 constructing an engine leaves a running run running"`
Status: open

**C5** - Montar um motor não cria `config/run/engine.lock` (AC 4)
Proof: `npx vitest run tests/core.engine.test.ts -t "C5 constructing an engine takes no lock"`
Status: open

### S2 - só o dono recupera · 3 files · 70 KB · ~18k

**C6** - `start()` sobre uma etapa `dispatched` com execução `queued` inativa deixa a etapa `pending` com `run_id` nulo (AC 5)
Proof: `npx vitest run tests/core.engine.test.ts -t "C6 start requeues a step whose run never started"`
Status: open

**C7** - `start()` sobre uma execução `running` deixa a execução `interrupted` (AC 6)
Proof: `npx vitest run tests/core.engine.test.ts -t "C7 start interrupts a run left running"`
Status: open

**C8** - Depois de `start()`, `config/run/engine.lock` existe e o `pid` nele é `process.pid` (AC 7)
Proof: `npx vitest run tests/core.engine.test.ts -t "C8 start writes the owner lock"`
Status: open

**C9** - Com `engine.lock` apontando para um processo vivo que não é o atual, `start()` lança `EngineLockedError` com `code` `"engine_locked"` e a etapa semeada continua `dispatched` (AC 8)
Proof: `npx vitest run tests/core.engine.test.ts -t "C9 a live foreign lock refuses start and recovers nothing"`
Status: open

**C10** - Com `engine.lock` apontando para um PID que não existe, `start()` toma o lock (passa a ter `process.pid`) e recupera a etapa para `pending` (AC 9)
Proof: `npx vitest run tests/core.engine.test.ts -t "C10 a dead lock is taken over"`
Status: open

**C11** - Depois de `stop()`, `config/run/engine.lock` não existe (AC 10)
Proof: `npx vitest run tests/core.engine.test.ts -t "C11 stop releases the lock"`
Status: open

**C12** - `startServer` sobre uma home com execução `running` deixa `config/run/engine.lock` com `process.pid` e a execução `interrupted`; fechar o servidor remove o lock (AC 11)
Proof: `npx vitest run tests/core.engine.test.ts -t "C12 the API service owns the engine"`
Status: open

### S3 - SQLite espera · 1 file · 4 KB · ~1k

**C13** - A conexão aberta por `openDb` responde `busy_timeout` = `5000` (AC 12)
Proof: `npx vitest run tests/core.engine.test.ts -t "C13 the database waits on a busy lock"`
Status: open

### S4 - embutidor com motor e política · 4 files · 60 KB · ~15k

**C14** - Um teste que importa só `@mordomo/core` e `@mordomo/adapter-claude` (o arquivo não importa nada de `apps/`) cria o motor, chama `start()`, cria e executa uma execução `read_only` no CLI falso do Claude, e ela termina `done` (AC 13)
Proof: `npx vitest run tests/core.engine.test.ts -t "C14 an embedder runs a read-only run with core and one adapter"`
Status: open

**C15** - Com perfil `review_before_write`, `engine.gateWrite("write", "manual", …)` devolve `pendingApproval.kind` `"write_run"` e um `runId` cuja execução está `waiting_approval` (AC 14)
Proof: `npx vitest run tests/core.engine.test.ts -t "C15 the engine parks a reviewed write"`
Status: open

**C16** - Com perfil `read_only`, `engine.assertWriteAllowed("write", "manual")` lança com `statusCode` `403` e `code` `"profile_refused"`; com `mode` `read_only` não lança (AC 15)
Proof: `npx vitest run tests/core.engine.test.ts -t "C16 the engine refuses writes under read_only"`
Status: open

**C17** - `engine.resolveCwd` lança `PathAccessError` para um caminho fora da home e das pastas indexadas habilitadas, e devolve o caminho real para um caminho dentro de uma pasta indexada habilitada (AC 16)
Proof: `npx vitest run tests/core.engine.test.ts -t "C17 the engine contains cwd to the granted roots"`
Status: open

**C18** - Com `controlled_write`, `engine.gateWrite("write", "manual", …)` devolve `pendingApproval` nulo e `runId` nulo (a escrita segue direto) (AC 14)
Proof: `npx vitest run tests/core.engine.test.ts -t "C18 the engine lets a controlled write through"`
Status: open

**C19** - As suítes de perfil, submissão e contenção da API passam sem mudança nos seus arquivos (AC 17)
Proof: `npx vitest run tests/api.profiles.test.ts tests/api.submission.test.ts tests/api.hardening.test.ts -t "security profiles|submission|containment"`
Status: open

## Coverage

| Set (size)                                           | Member -> proof                                                                    | Unproven |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- | -------- |
| montagens do motor (3 assemblies)                    | `createEngine` C1 · `AppContext` (CLI) C2 · `startServer` C12                      | -        |
| fases do ciclo de vida (3)                           | construir C1-C5 · `start()` C6-C10 · `stop()` C11                                  | -        |
| estados do lock em `start()` (3)                     | ausente C8 · vivo de outro processo C9 · PID morto C10                             | -        |
| casos de `ObjectiveStore.recover` tocados (2)        | execução `queued` inativa C1, C6 · execução `running` C3                           | -        |
| decisão de escrita por perfil para origem manual (3) | `read_only` C16 · `review_before_write` C15 · `controlled_write` C18               | -        |
| `resolveCwd` (2)                                     | fora C17 · dentro C17                                                              | -        |
| doors (3)                                            | `createEngine`/`MordomoEngine` C1, C14 · `engine.lock` C8-C11 · `busy_timeout` C13 | -        |

- `approved_automation` fica fora do conjunto de decisão: para origem `manual` ele decide igual a `controlled_write` (`core/src/security/profiles.ts` `writeDecision`), e a tabela inteira já é provada em `tests/core.security.test.ts`
- Claims naming a status code, route or response shape: C16 (`statusCode` 403) - provado na camada do motor, que é onde o contrato novo vive; a rota HTTP é C19

## Test policy

| Code                                                                                     | Required proofs                                      | Coverage expectation                                                                |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Decides, not reached across a boundary (`start()`: lock vivo/morto/ausente; recuperação) | one at its own layer                                 | one asserted case per lock state and per recovery case touched                      |
| Decides, reached across a boundary (política de escrita, contenção)                      | one at its own layer **and** the existing API suites | one asserted case per profile decision for `manual`; inside/outside for containment |
| Instrumentation (`AppContext` repassando ao motor; `openDb` pragma)                      | one reading the effect                               | covered by C2, C12, C13                                                             |

Evidence:

- `core/src/engine.ts` `start()`: lock ausente / vivo / morto (3 branch points) e a ordem recuperar → interromper → ligar timers -> decides
- closest analogue in the repo: `tests/core.runs.test.ts` (ciclo de vida do `RunManager`, provado na própria camada contra uma home temporária)

Cost: 1 arquivo de teste novo, 18 provas próprias. Sem essas linhas, o lock só seria provado pelo caminho feliz de `startServer`.

## Swept

- validation: n/a - nenhuma entrada de usuário nova; as opções de `createEngine` são tipadas
- failure modes: C9 (start recusado não recupera nada pela metade)
- idempotency: C10 (lock de PID morto é retomado, não duplicado)
- authorization: C15, C16, C17 (a política agora vale para quem embute)
- concurrency: C9 (dois processos não recuperam ao mesmo tempo), C13 (escritas concorrentes esperam)
- data lifecycle: C11 (lock removido no `stop()`)
- dependency failure: n/a - nenhuma dependência externa nova
- state transitions: C6, C7 (só o dono move etapas e execuções na recuperação)
- observability: existing - `startServer` já loga "marked orphaned runs as interrupted" (`apps/api/src/server.ts`), mantido

## Handoff

- S1-S4 ≈ 64k tokens: context.ts 15 KB, server.ts 22 KB, routes/common.ts 14 KB, db.ts 3 KB, runManager.ts (só o construtor) ~5 KB lidos, objectiveStore.ts ~5 KB lidos, engine.ts novo ~12 KB, cli.ts (pontos de montagem) ~10 KB lidos, teste novo ~15 KB ≈ 100 KB / 4 ≈ 25k, com margem para leitura - abaixo de 150k - one builder
