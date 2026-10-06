# Contratos compartilhados checks

Profile: standard
Plan: `.specs/features/contratos/plan.md`

17 checks in 4 slices · 4 one-way doors · 0 open, of which 0 block

Comandos (da raiz):

- unit: `npx vitest run tests/contracts.test.ts -t "<nome>"` (o `vitest.config.ts` ganha o alias `@mordomo/contracts` → `contracts/src/index.ts`)
- tipos: `npx tsc -p typetests/tsconfig.json` (arquivos `typetests/*.ts` com `// @ts-expect-error`; compila contra os `.d.ts` construídos, então roda depois de `npm run build:server`)
- build: `npm run build`, `npm run typecheck`

## Checks

### S1 - pacote de contratos · 12 files · 120 KB · ~30k

**C1** - `@mordomo/contracts` exporta em tempo de execução `SettingsSchema` (um schema zod que aceita `{}` e devolve `version` = `CURRENT_SETTINGS_VERSION`; 1 até a feature `preferencias-ui`, 2 depois), `writeDecision` e `PROFILES` (AC 1)
Proof: `npx vitest run tests/contracts.test.ts -t "C1 the contracts package exports the runtime pieces"`
Status: closed

**C2** - `@mordomo/contracts` exporta os tipos `RunRecord`, `RunEvent`, `RunUsage`, `Approval`, `NotificationRecord`, `SessionRecord`, `ProviderCapabilities`, `Settings`, `OsEvent`, `OsEventMap` e `OsEventType` (um arquivo de tipos que importa os 11 nomes compila) (AC 1)
Proof: `npx tsc -p typetests/tsconfig.json`
Status: closed

**C3** - `contracts/package.json` tem `dependencies` igual a `{ "zod": … }` e nada mais (AC 2)
Proof: `npx vitest run tests/contracts.test.ts -t "C3 the contracts package depends on zod only"`
Status: closed

**C4** - `@mordomo/core` exporta `writeDecision`, `PROFILES` e `SettingsSchema`, e são os mesmos objetos de `@mordomo/contracts` (`toBe`) (AC 3)
Proof: `npx vitest run tests/contracts.test.ts -t "C4 core re-exports the very same contract objects"`
Status: closed

**C5** - Com `contracts/dist`, `core/dist` e os `tsconfig.tsbuildinfo` dos dois apagados (um checkout limpo), `npm run build:server` sai `0` e deixa `contracts/dist/index.js` e `core/dist/index.js` (AC 4)
Proof: `rm -rf contracts/dist core/dist contracts/tsconfig.tsbuildinfo core/tsconfig.tsbuildinfo && npm run build:server && test -f contracts/dist/index.js && test -f core/dist/index.js`
Status: closed

### S2 - eventos tipados e versionados · 14 files · 110 KB · ~28k

**C6** - Todo evento emitido pelo barramento (testado com `run.finished`, `settings.changed` e `notification.read`) tem `v` = 1, também no anel de replay (`since`) (AC 5)
Proof: `npx vitest run tests/contracts.test.ts -t "C6 every emitted event carries v 1"`
Status: closed

**C7** - Cada evento de `GET /api/events` lido por um cliente SSE traz `"v":1` (AC 6)
Proof: `npx vitest run tests/contracts.test.ts -t "C7 the SSE feed carries the event version"`
Status: closed

**C8** - `emit("run.finished", { runId: 1 })` e `emit("settings.changed", { nope: true })` não compilam (`// @ts-expect-error` em `typetests/events.ts`), e `emit("run.finished", { runId: "x", status: "done", durationMs: 1 })` compila (AC 7)
Proof: `npx tsc -p typetests/tsconfig.json`
Status: closed

**C9** - `OsEventMap` tem chave para cada um dos 22 valores de `OsEventType` e nenhuma a mais (`typetests/events.ts`: `Exclude<OsEventType, keyof OsEventMap>` e `Exclude<keyof OsEventMap, OsEventType>` são `never`) (AC 8)
Proof: `npx tsc -p typetests/tsconfig.json`
Status: closed

### S3 - a interface usa o contrato · 6 files · 70 KB · ~18k

**C10** - Em `apps/command-centre/src/api.ts`, `RunRecord`, `RunUsage`, `RunUsageEvent`, `ApprovalRecord`, `NotificationItem`, `NotificationKind`, `SessionRecord`, `SettingsDoc`, `ProviderId`, `ProviderCapabilities` e `OsEvent` são declarados como `export type X = …` apontando para `@mordomo/contracts`, e o arquivo tem zero ocorrências de `mirrors core` (AC 9)
Proof: `npx vitest run tests/contracts.test.ts -t "C10 the UI api types are contract aliases"`
Status: closed

**C11** - `apps/command-centre/src/runs/policy.ts` importa `writeDecision` de `@mordomo/contracts` e não contém `read_only:`, `review_before_write:` nem `controlled_write:` como chaves de tabela (AC 10)
Proof: `npx vitest run tests/contracts.test.ts -t "C11 the UI write policy comes from the contract"`
Status: closed

**C12** - `npm run typecheck` e `npm run build -w apps/command-centre` saem `0` (AC 11)
Proof: `npm run typecheck && npm run build -w apps/command-centre`
Status: closed

**C13** - Nenhum arquivo em `apps/command-centre/dist/assets` contém `better-sqlite3`, `node:fs` nem `ZodError` (AC 12)
Proof: `npm run build -w apps/command-centre && ! grep -rlE "better-sqlite3|node:fs|ZodError" apps/command-centre/dist/assets`
Status: closed

### Rodada 2 - lacunas da primeira verificação

**C14** - `@mordomo/core` exporta os 11 tipos do C2 com os mesmos nomes, e cada um é mutuamente atribuível ao de `@mordomo/contracts` (`typetests/core-exports.ts`) (AC 3)
Proof: `npx tsc -p typetests/tsconfig.json`
Status: closed

**C17** - `writePolicyFor` devolve `refused` para um perfil desconhecido (`bogus`, `""`, `toString`, `__proto__`) e para `undefined` (AC 10; rodada 3)
Proof: `npm run test -w apps/command-centre -- src/runs/policy.test.ts -t "C17"`
Status: closed

**C15** - Com `writeDecision` trocado por um stub (`vi.mock("@mordomo/contracts/policy")`), `writePolicyFor` segue o stub para os 4 perfis e as 3 decisões, chamando-o com `(perfil, "manual")` (AC 10)
Proof: `npm run test -w apps/command-centre -- src/runs/policy.delegation.test.ts`
Status: closed

**C16** - `contracts/package.json` tem `exports` igual a `{ ".", "./policy" }` com as formas literais do `Landing` (porta 1 e emenda 1a), e, seguindo cada `import`/`export … from` de valor a partir de `contracts/src/policy.ts` (os `import type`/`export type` são apagados pelo compilador), nenhum módulo fora de `contracts/src` é alcançado - o subcaminho não puxa zod (Landing; rodada 3)
Proof: `npx vitest run tests/contracts.test.ts -t "C16 the contracts package publishes exactly two entry points"`
Status: closed

## Coverage

| Set (size)                                                | Member -> proof                                                                                                                                     | Unproven |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| exports de tempo de execução (3)                          | `SettingsSchema` C1 · `writeDecision` C1 · `PROFILES` C1                                                                                            | -        |
| exports de tipo (11)                                      | C2, table-driven over all 11 (um import de cada em `typetests/exports.ts`)                                                                          | -        |
| reexports do core (14)                                    | `writeDecision` C4 · `PROFILES` C4 · `SettingsSchema` C4 · os 11 tipos C14, table-driven over all 11                                                | -        |
| tipos de evento (22)                                      | C9, table-driven over all 22 (exaustivo em tipo nos dois sentidos)                                                                                  | -        |
| uniões por ponto de emissão (4)                           | `routine.alert` C8 · `routine.changed` C8 · `session.updated` C8 · `objective.changed` C8 (um `emit` válido de cada forma em `typetests/events.ts`) | -        |
| aliases na interface (11)                                 | C10, table-driven over all 11                                                                                                                       | -        |
| `GET /api/events` (1)                                     | `v` em cada evento C7                                                                                                                               | -        |
| startup config: alias `@mordomo/contracts` (3 assemblies) | `tsc -b` (build) C5 · `vitest.config.ts` (testes) C1 · Vite (interface) C12                                                                         | -        |
| doors (4)                                                 | pacote C1-C5, C16 · subcaminho `./policy` C16 · `v` no envelope C6, C7 e `tsc` (o envelope é anotado, não convertido) · uniões C8                   | -        |

- C13 é uma guarda: hoje a interface só importa tipos do contrato (`runs/policy.ts` é importado só pelos testes), então nada de tempo de execução do contrato chega ao bundle; o `ZodError` faz a guarda notar se zod entrar
- C11 é textual; o comportamento (delegar a `writeDecision`) é C15
- Claims naming a route: C7 - provado lendo o SSE de um servidor real (`listen`), como `tests/api.hardening.test.ts` já faz

## Test policy

| Code                                                                 | Required proofs      | Coverage expectation                                                                  |
| -------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------- |
| Instrumentation (tipos e reexports movidos)                          | type-level, compiled | each moved name imported once; each emit shape accepted once and a wrong one rejected |
| Decides (nenhum código novo decide; `writeDecision` só muda de casa) | the existing suite   | `tests/core.engine.test.ts` C15-C18, C27 cobrem a tabela pelo motor                   |
| Configuration (build e aliases)                                      | one per assembly     | C5, C1, C12                                                                           |

Evidence:

- `core/src/events.ts` `emit()`: carimba `v` e encaminha -> instrumentation
- closest analogue in the repo: nenhum teste de tipo existe hoje; `typetests/` é novo e roda no `npm run typecheck`

Cost: 1 arquivo de teste, 2 arquivos de teste de tipo, 13 provas.

## Swept

- validation: C1 (`SettingsSchema` continua validando e aplicando padrões)
- failure modes: C8 (um payload errado não compila)
- idempotency: n/a - nada novo é gravado
- authorization: existing - `/api/events` segue a regra de auth da feature 1
- concurrency: n/a - nenhuma mudança de estado
- data lifecycle: n/a - eventos não são persistidos
- dependency failure: n/a - nenhuma dependência externa nova (zod já é dependência do core)
- state transitions: n/a - nenhuma máquina de estados muda
- observability: C6, C7 (a versão de cada evento é visível a quem o lê)

## Handoff

- S1-S3 ≈ 76k: schema.ts 25 KB, events.ts 6 KB, agents/types.ts 8 KB, runManager.ts (tipos) ~8 KB lidos, approvals/store/sessions/registry ~20 KB, api.ts 40 KB, policy.ts 1 KB, configs e package.json ~5 KB, 22 pontos de `emit` ~15 KB lidos, testes novos ~15 KB ≈ 143 KB / 4 ≈ 36k, mais leitura de verificação - abaixo de 150k - one builder
