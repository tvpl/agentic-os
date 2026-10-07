# API v1 checks

Profile: standard
Plan: `.specs/features/api-v1/plan.md`

26 checks in 6 slices · 6 one-way doors · 0 open, of which 0 block

Comandos (da raiz): `npx vitest run tests/api.v1.test.ts -t "<nome>"`; a interface com
`npm run test -w apps/command-centre -- <arquivo> -t "<nome>"`. Requisições de dispositivo e de outro
endereço usam `app.inject({ remoteAddress })` com um dispositivo pareado por `ctx.devices` e
`remote.enabled: true`.

## Checks

### S1 - versão no caminho · 5 files · 50 KB · ~13k

**C1** - Para cada rota `GET` sem parâmetro registrada sob `/api` (lista tirada de `app.printRoutes`/`onRoute`, exceto as de SSE), `GET /api/v1/<resto>` responde o mesmo status e o mesmo corpo que `GET /api/<resto>` (AC 1)
Proof: `npx vitest run tests/api.v1.test.ts -t "C1 every GET route answers the same under v1"`
Status: closed

**C2** - `POST /api/v1/runs` cria uma execução como `POST /api/runs`, e `GET /api/v1/events?token=` abre o SSE (AC 1)
Proof: `npx vitest run tests/api.v1.test.ts -t "C2 writes and streams work under v1"`
Status: closed

**C3** - `GET /api/runs` traz `Deprecation: true` e `Link: </api/v1/runs>; rel="successor-version"`; `GET /api/v1/runs` não traz `Deprecation` (AC 2)
Proof: `npx vitest run tests/api.v1.test.ts -t "C3 unversioned routes announce their successor"`
Status: closed

**C4** - `GET /api/v1/meta` sem credencial responde `200` com `apiVersion` `1` (AC 3)
Proof: `npx vitest run tests/api.v1.test.ts -t "C4 meta names the API version"`
Status: closed

**C5** - Em `apps/command-centre/src` (fora de testes e de `gallery/`), toda URL de API passa por `request()`/as funções de SSE de `api.ts`, que prefixam `/api/v1`; nenhuma string `"/api/` chega ao `fetch`/`EventSource` sem o prefixo; e `apps/api/src/mcp/*.ts` usa `/api/v1/` (AC 4)
Proof: `npx vitest run tests/api.v1.test.ts -t "C5 the clients call v1"`
Status: closed

**C6** - `apiUrl("/api/runs")` da interface devolve `/api/v1/runs` e `apiUrl("/api/v1/runs")` não duplica o prefixo (AC 4)
Proof: `npm run test -w apps/command-centre -- src/api.test.ts -t "C6 the UI prefixes v1 once"`
Status: closed

### S2 - um formato de erro · 4 files · 40 KB · ~10k

**C7** - `POST /api/pair/claim` com código errado, `GET /api/v1/nao-existe`, um corpo de 6 MB e um `ZodError` respondem com `error.code`, `error.message` e `message` de topo iguais (AC 5)
Proof: `npx vitest run tests/api.v1.test.ts -t "C7 every failure uses the envelope"`
Status: closed

**C8** - `POST /api/channels/telegram/test` e `POST /api/channels/telegram/send` sem token do bot respondem `409 channel_not_configured`; com um Telegram falso que recusa (`fetch` interceptado), `502 channel_failed` (AC 6)
Proof: `npx vitest run tests/api.v1.test.ts -t "C8 telegram failures are errors"`
Status: closed

**C9** - `POST /api/push/test` com push desligado e sem inscritos responde `409 channel_not_configured`; com todas as entregas falhando, `502 channel_failed` (AC 6)
Proof: `npx vitest run tests/api.v1.test.ts -t "C9 push failures are errors"`
Status: closed

**C10** - Em `apps/api/src`, nenhum `return`/`reply.send` de rota devolve um objeto com `ok: false` (AC 7)
Proof: `npx vitest run tests/api.v1.test.ts -t "C10 no route answers ok false with a 2xx"`
Status: closed

### S3 - escopos e token na URL · 6 files · 60 KB · ~15k

**C11** - Para cada uma das 18 rotas `owner` da door 3, uma chamada com token de dispositivo responde `403 owner_only`, e nada muda (para `PUT /api/settings`, `settings.json` fica igual byte a byte; para `POST /api/system/restart`, nenhum processo é criado) (AC 8)
Proof: `npx vitest run tests/api.v1.test.ts -t "C11 a device cannot call an owner route"`
Status: closed

**C12** - O conjunto de rotas com `config.scope === "owner"` na tabela de rotas é exatamente o da door 3 (AC 8)
Proof: `npx vitest run tests/api.v1.test.ts -t "C12 the owner routes are exactly the door's list"`
Status: closed

**C13** - Com token de dispositivo, `GET /api/runs` `200`, `POST /api/runs` `202`/`200` e `POST /api/approvals/:id/resolve` `200` (AC 9)
Proof: `npx vitest run tests/api.v1.test.ts -t "C13 a device keeps the everyday routes"`
Status: closed

**C14** - Com o token local, `PUT /api/settings` e `POST /api/pair/start` respondem `200` (AC 10)
Proof: `npx vitest run tests/api.v1.test.ts -t "C14 the owner keeps every route"`
Status: closed

**C15** - `GET /api/runs?token=<local>` e `POST /api/runs?token=<local>` respondem `401 unauthorized` (AC 11)
Proof: `npx vitest run tests/api.v1.test.ts -t "C15 a query token is refused outside streams"`
Status: closed

**C16** - As rotas com `config.queryToken` são exatamente as quatro da door 4, e `GET /api/events?token=`, `GET /api/runs/:id/stream?token=` aceitam o token (AC 12)
Proof: `npx vitest run tests/api.v1.test.ts -t "C16 streams accept a query token"`
Status: closed

### S4 - limites · 3 files · 25 KB · ~7k

**C17** - Dez `POST /api/pair/claim` do endereço `203.0.113.5` passam pela verificação; a 11ª responde `429 too_many_requests` com `Retry-After` inteiro > 0, e outro endereço ainda é atendido (AC 13)
Proof: `npx vitest run tests/api.v1.test.ts -t "C17 pairing attempts are limited per address"`
Status: closed

**C18** - Depois de 20 respostas `401` para `203.0.113.6`, a próxima requisição (mesmo com token certo) responde `429`; com o relógio avançado 5 min (`vi.setSystemTime`), volta a responder `200` (AC 14)
Proof: `npx vitest run tests/api.v1.test.ts -t "C18 failed logins are limited per address"`
Status: closed

**C19** - 30 respostas `401` de `127.0.0.1` não geram `429` (AC 15)
Proof: `npx vitest run tests/api.v1.test.ts -t "C19 loopback is never locked out"`
Status: closed

### S5 - documento das rotas · 3 files · 30 KB · ~8k

**C20** - `GET /api/v1/openapi.json` responde `openapi` `"3.1.0"`, e o conjunto `(método, caminho)` das operações é igual ao das rotas `/api` registradas, com o caminho em `/api/v1` e `{param}` no lugar de `:param` (AC 16, AC 17)
Proof: `npx vitest run tests/api.v1.test.ts -t "C20 the document lists every route"`
Status: closed

**C21** - Cada operação tem `security` e os parâmetros de caminho; as 18 rotas `owner` têm `x-mordomo-scope: "owner"`; `/api/v1/meta` e `/api/v1/pair/claim` têm `security: []` (AC 16)
Proof: `npx vitest run tests/api.v1.test.ts -t "C21 each operation carries its scope"`
Status: closed

### S6 - quem decidiu e Telegram por pessoa · 6 files · 55 KB · ~14k

**C22** - Uma aprovação resolvida com o token local tem `resolvedBy` `"owner"`; com token de dispositivo, `"device:<id>"`; negada pelo broker da execução, `"broker:<runId>"`; varrida para `expired`, `"system"` (AC 18)
Proof: `npx vitest run tests/api.v1.test.ts -t "C22 an approval records who decided it"`
Status: closed

**C23** - Um botão `ap:<id>` do Telegram com `from.id` 42 resolve a aprovação com `resolvedBy` `"telegram:42"` (AC 19)
Proof: `npx vitest run tests/api.v1.test.ts -t "C23 telegram records the person"`
Status: closed

**C24** - Com `allowedUserIds: [42]`, um botão e um `/approve <id>` de `from.id` 7 no chat configurado não mudam a aprovação e não enviam resposta; de `from.id` 42, mudam (AC 20)
Proof: `npx vitest run tests/api.v1.test.ts -t "C24 only listed people decide from telegram"`
Status: closed

**C25** - Com `allowedUserIds: []`, o botão de qualquer `from.id` no chat configurado resolve, e de outro chat não (AC 21)
Proof: `npx vitest run tests/api.v1.test.ts -t "C25 an empty list keeps the chat rule"`
Status: closed

**C26** - Um banco na versão de migração anterior, com uma aprovação resolvida, abre migrado e a aprovação lê `resolvedBy: null` (AC 22)
Proof: `npx vitest run tests/api.v1.test.ts -t "C26 old approvals read back without a decider"`
Status: closed

## Coverage

| Set (size)                       | Member -> proof                                                                                                          | Unproven |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------- |
| métodos sob `/api/v1` (2)        | `GET` C1, table-driven over all GET routes without params · escrita e SSE C2                                             | -        |
| clientes da API (3)              | interface C5, C6 · servidor MCP C5 · cliente de permissão C5                                                             | -        |
| formas de falha (5)              | código de pareamento C7 · rota desconhecida C7 · corpo grande C7 · validação C7 · `200 ok:false` C8-C10                  | -        |
| rotas `200 ok:false` de hoje (3) | telegram send C8 · telegram test C8 · push test C9                                                                       | -        |
| rotas `owner` (18)               | C11, table-driven over all 18 · C12 (o conjunto exato)                                                                   | -        |
| principais (3)                   | owner C14 · device C11, C13 · broker C22 (e as três rotas de aprovação já cobertas em `tests/api.security-p0.test.ts`)   | -        |
| rotas com `queryToken` (4)       | C16 (o conjunto exato) · `events` C16 · `runs/:id/stream` C16 · `artifacts/raw` e `skills/:slug/resource` C16 (conjunto) | -        |
| limites (3 regras)               | pareamento C17 · `401` C18 · loopback C19                                                                                | -        |
| valores de `resolvedBy` (5)      | `owner` C22 · `device:` C22 · `broker:` C22 · `system` C22 · `telegram:` C23                                             | -        |
| regra do Telegram (2 estados)    | lista com nomes C24 · lista vazia C25                                                                                    | -        |
| doors (6)                        | versão C1-C4 · envelope C7-C10 · escopos C11-C14 · token na URL C15, C16 · limites C17-C19 · `resolved_by` C22, C26      | -        |

- Claims naming a status code or route: todas por `inject` na rota, com `remoteAddress` quando o endereço importa

## Test policy

| Code                                                                  | Required proofs      | Coverage expectation                    |
| --------------------------------------------------------------------- | -------------------- | --------------------------------------- |
| Decides, reached across a boundary (gancho de auth, escopo, limites)  | one at the boundary  | each route of each door list and status |
| Decides, not reached across a boundary (poller do Telegram, migração) | one at its own layer | each rule                               |
| Instrumentation (prefixo dos clientes, documento)                     | unit + source check  | each client; every route                |

Evidence:

- `apps/api/src/server.ts` `onRequest`: credencial × rota × escopo × endereço -> decides
- `core/src/channels/telegramInbound.ts`: `chat.id` × `from.id` × lista -> decides
- closest analogue in the repo: `tests/api.security-p0.test.ts` (auth por rota com `inject`)

Cost: 1 arquivo de teste novo na raiz, 1 teste novo na interface, 26 provas.

## Swept

- validation: C7 (envelope do `ZodError`)
- failure modes: C8, C9 (falha de canal como erro), C7 (`413`)
- idempotency: n/a - nada novo é gravado além de `resolved_by`, uma vez por aprovação
- authorization: C11-C16 (escopos e token na URL), C24 (Telegram)
- concurrency: n/a - os limites são por processo e em memória; um serviço por máquina (feature 3)
- data lifecycle: C26 (linhas antigas)
- dependency failure: C8 (Telegram recusou)
- state transitions: C22 (`pending` → `approved`/`denied`/`expired` com o autor)
- observability: C22, C23 (`resolvedBy`), C3 (cabeçalhos de obsolescência)

## Handoff

- S1-S6 ≈ 67k: server.ts 20 KB, system.ts trechos 20 KB, devices/channels/push 12 KB, telegramInbound 10 KB, approvals store + migração 10 KB, api.ts trechos 15 KB, mcp/*.ts 6 KB, docs 8 KB, teste novo ~40 KB ≈ 141 KB / 4 ≈ 35k, mais leitura e execução - abaixo de 150k - one builder
