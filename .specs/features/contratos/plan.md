# Contratos compartilhados — um pacote de tipos e eventos para motor, API e interface

## Problem

A interface não importa nada do motor. `apps/command-centre/src/api.ts` declara 85 tipos à mão;
só 7 dizem que espelham o core, e vários já divergiram. `SettingsDoc` não tem `bindAddress`,
`autostart`, `memory`, `favoriteSkills` nem `brain`. `MicroApp` está declarado três vezes. A resposta
de execução aparece com dois nomes diferentes (`LaunchRunResponse` e `RunLaunchResponse`). Os 22
tipos de evento chegam à interface como `type: string`. No motor, `events.emit<T>(type, payload)`
não liga o tipo do payload ao nome do evento, e quatro eventos já saem com formatos diferentes
conforme o ponto que os emite (`routine.alert`, `routine.changed`, `session.updated`,
`objective.changed`). Nenhum evento carrega versão.

A regra de escrita por perfil também está duplicada. `apps/command-centre/src/runs/policy.ts` copia
`writeDecision` de `core/src/security/profiles.ts`, e duas telas fixam a lista de perfis à mão.

Quem paga é quem mexe no sistema e quem quer integrar com ele. Uma mudança de formato no motor
quebra a interface só em tempo de execução, e um cliente de terceiros não tem contrato nenhum para
seguir. Evidência: mapeamento de 06/10/2026 (`api.ts:144, 559, 580, 676, 862, 987, 1058`;
`runs/policy.ts:6-11`; `queries.ts:54-81`).

## Flow

Reutiliza os tipos e o schema zod que já existem no core: eles mudam de casa para o pacote novo, e
o core passa a reexportá-los, então nenhum importador do core muda.

1. `contracts/` (door 1): pacote `@mordomo/contracts` com os tipos do fio (execução, evento de
   execução, uso, aprovação, notificação, sessão, capacidades de provedor), o schema zod de
   configurações, o mapa de eventos `OsEventMap` e a regra pura `writeDecision`/`PROFILES`.
2. `core/src/events.ts` (exists): `EventBus.emit<K extends OsEventType>(type: K, payload: OsEventMap[K])`;
   o envelope ganha `v: 1` (door 2).
3. Os módulos do core que hoje declaram esses tipos (configurações, perfis, tipos de agente,
   execuções, aprovações, inbox, sessões e o registro de provedores; all exist) passam a importá-los
   de `@mordomo/contracts` e a reexportá-los com os mesmos nomes.
4. `apps/api/src/routes/sse.ts` (exists): repassa o envelope como está, agora com `v`.
5. `apps/command-centre/src/api.ts` (exists): os tipos desses domínios viram aliases dos tipos do
   contrato (`export type RunRecord = Contracts.RunRecord`); `OsEvent` vira o envelope tipado;
   `apps/command-centre/src/runs/policy.ts` (exists) importa `writeDecision` do contrato.
6. Build: `tsc -b` constrói `contracts` antes de `core`; `vitest.config.ts` (exists) ganha o alias
   para a fonte; o empacotador (`scripts/package.mjs`, exists) já empacota dependências de
   workspace junto com o core.

## Impact

| Front       | What changes                                                                                                                                                                                                                                                                                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | novo termo: `contrato` - os tipos e schemas que atravessam a fronteira motor ↔ API ↔ interface; vive em `contracts/src`                                                                                                                                                                                                                                                                 |
| domain      | termo existente: `OsEvent` era `{id, type, ts, payload}` com payload livre; passa a ter `v: 1` e payload amarrado ao `type`; quem lê hoje: `routes/sse.ts`, `context.ts` (sincronia de objetivos), `notifications/recorder.ts`, `memory/journal.ts`, `sentinels/*`, `channels/*` e a interface (`hooks/useEventStream.ts`, `queries.ts`, `useNotifications.ts`, `nucleo/agentState.ts`) |
| domain      | termos existentes: `RunRecord`, `RunEvent`, `RunUsage`, `Approval`, `NotificationRecord`, `SessionRecord`, `ProviderCapabilities`, `Settings`, `writeDecision` mudam de arquivo e mantêm nome e forma; o core os reexporta                                                                                                                                                              |
| contrato    | o SSE `/api/events` ganha o campo `v` em cada evento; o campo é aditivo, e a interface que ignora campos desconhecidos continua funcionando                                                                                                                                                                                                                                             |
| stored data | nada a migrar - eventos não são persistidos além do anel em memória                                                                                                                                                                                                                                                                                                                     |

## Relations

None - no stored-data shape change

## Surface

| Route                   | In                        | Out                                             | Status |
| ----------------------- | ------------------------- | ----------------------------------------------- | ------ |
| `GET /api/events` (SSE) | `Last-Event-ID`, `?since` | cada evento: `id`, `type`, `ts`, `v`, `payload` | `200`  |

## Landing

| One-way door                                            | Literal shape                                                                                                                                                                                                       | Alternative rejected                                                                                                                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Pacote de contratos                                  | diretório `contracts/`, nome `@mordomo/contracts`, `type: module`, `exports: { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }`, dependência só de `zod`; construído por `tsc -b` como o core | Tipos só de tipo, sem schema (`.d.ts` escrito à mão): a interface e terceiros não poderiam validar uma resposta, e o schema de configurações continuaria morando no core, longe de quem consome |
| 2. Versão no envelope de evento                         | `OsEvent<K> = { id: number; type: K; ts: number; v: 1; payload: OsEventMap[K] }`; mudar a forma de um payload incrementa `v` daquele tipo de evento                                                                 | Versão por stream (cabeçalho no SSE): um cliente que guarda eventos (o anel, o replay por `Last-Event-ID`) perderia a versão de cada um                                                         |
| 3. Payloads com formato por ponto de emissão            | `routine.alert`, `routine.changed`, `session.updated` e `objective.changed` viram uniões discriminadas no mapa (`{ reason: "budget" … } \| { status … }`), sem mudar o que já é emitido                             | Normalizar cada evento num formato único: muda o que a interface recebe hoje em quatro eventos, num diff que não é desta feature                                                                |
| 1a. Subcaminho `./policy` (emenda da rodada 2, aditiva) | `exports["./policy"] = { "types": "./dist/policy.d.ts", "default": "./dist/policy.js" }`, ao lado de `"."`; `contracts/src/policy.ts` só tem `import type`, então o subcaminho não puxa zod                         | Só a raiz `"."`: a interface importaria `writeDecision` pela raiz e levaria zod para o bundle do navegador junto com o schema                                                                   |

- Nothing else in this change is hard to reverse

## Criteria

### S1: Um pacote de contratos que o motor usa (P1)

**Acceptance Criteria**

1. The package `@mordomo/contracts` SHALL export the types `RunRecord`, `RunEvent`, `RunUsage`, `Approval`, `NotificationRecord`, `SessionRecord`, `ProviderCapabilities`, `Settings`, `OsEvent`, `OsEventMap` and `OsEventType`, the schema `SettingsSchema` and the functions `writeDecision` and `PROFILES`
2. The package `@mordomo/contracts` SHALL depend at runtime on `zod` only
3. The package `@mordomo/core` SHALL keep exporting each of those names, and `writeDecision` from core SHALL be the same function object as the one from contracts
4. WHEN `npm run build` runs from a clean checkout THEN `contracts/dist/index.js` SHALL exist before `core` compiles, and the build SHALL exit `0`

**Independent test:** `node -e "import('@mordomo/contracts').then(m => console.log(typeof m.writeDecision))"` imprime `function`.

### S2: Eventos tipados e versionados (P1)

**Acceptance Criteria**

5. The event bus SHALL stamp every event it emits with `v` = `1`
6. WHEN a client reads `GET /api/events` THEN each event line SHALL carry `v` = `1`
7. IF core code emits an event with a payload that does not match `OsEventMap` for that type THEN `tsc -b` SHALL fail
8. The map `OsEventMap` SHALL have an entry for each of the 22 values of `OsEventType`

**Independent test:** um arquivo de testes de tipo com `// @ts-expect-error` num `emit` errado compila.

### S3: A interface usa o contrato (P1)

**Acceptance Criteria**

9. The file `apps/command-centre/src/api.ts` SHALL define `RunRecord`, `RunUsage`, `RunUsageEvent`, `ApprovalRecord`, `NotificationItem`, `NotificationKind`, `SessionRecord`, `SettingsDoc`, `ProviderId`, `ProviderCapabilities` and `OsEvent` as aliases of `@mordomo/contracts` types, and SHALL contain no "mirrors core" comment
10. The file `apps/command-centre/src/runs/policy.ts` SHALL import `writeDecision` from `@mordomo/contracts` and SHALL NOT contain its own profile table
11. WHEN `npm run typecheck` and `npm run build -w apps/command-centre` run THEN both SHALL exit `0`
12. The UI bundle SHALL NOT contain the string `"better-sqlite3"` (the contract pulls no engine code into the browser)

**Independent test:** `npm run typecheck` verde, e `grep -c "mirrors core" apps/command-centre/src/api.ts` imprime `0`.

## Out of scope

| Excluded                                                                | Why                                                                                                                                                                   |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Separar as preferências da interface das configurações do motor         | feature 5b `preferencias-ui`, que muda o que é gravado e precisa de migração                                                                                          |
| Tipos de memória, rotinas, objetivos, conectores e métricas no contrato | ficam para quando cada domínio mudar; esta feature cobre o caminho da execução, das aprovações, do inbox e das configurações, que são os que a interface mais consome |
| Validar respostas da API com zod na interface                           | o contrato permite; ligar a validação é decisão de produto (custo de bundle)                                                                                          |
| Publicar o pacote no npm e versionar com changesets                     | depende da licença (feature 15)                                                                                                                                       |
| Remover o parser de cron próprio da interface (`views/cron.ts`)         | o servidor usa croner, que não é para o browser; duplicação aceita até a feature 9 redesenhar Rotinas                                                                 |

## Assumptions

| Assumption                    | Chosen default                                                                            | Rationale                                                   | Confirmed? |
| ----------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------- |
| Onde fica o pacote            | `contracts/` na raiz, ao lado de `core/`                                                  | mesma convenção de `core/` e `adapters/`                    | n          |
| Nome dos aliases na interface | mantém os nomes atuais (`ApprovalRecord`, `NotificationItem`, `SettingsDoc`) como aliases | evita tocar dezenas de arquivos que já importam esses nomes | n          |
| `v` inicial                   | `1` para todos os tipos                                                                   | nenhum evento tinha versão; esta é a primeira               | n          |

**Open questions:** none - all resolved or logged above.

## Observable

| Surface                      | Decision                                  | Landing                                                |
| ---------------------------- | ----------------------------------------- | ------------------------------------------------------ |
| API `GET /api/events`        | response shape                            | AC 6                                                   |
| API `GET /api/events`        | error shape, who may call it, rate limits | existing - inalterados (auth da feature 1)             |
| API `GET /api/events`        | versioning                                | AC 5, AC 6 (door 2)                                    |
| package `@mordomo/contracts` | what a consumer imports                   | AC 1, AC 3                                             |
| package `@mordomo/contracts` | versioning                                | n/a - privado e na versão do monorepo até a feature 15 |

## Sources

- Mapeamento de duplicação de 06/10/2026 (nesta sessão) - tipos espelhados, eventos e campos de interface no schema
- Análise do motor de 06/10/2026 - achado S6 (sem contrato tipado entre motor e interface)
