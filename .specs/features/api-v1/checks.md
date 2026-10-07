# API v1 checks

Profile: standard
Plan: `.specs/features/api-v1/plan.md`

36 checks in 6 slices · 6 one-way doors · 0 open, of which 0 block

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

**C10** - Em `apps/api/src`, nenhum `return`/`reply.send` de rota devolve um objeto com `ok: false` (AC 7). Rodada 2: lido na árvore sintática do TypeScript, e recusa também `ok:` com qualquer expressão que não seja `true`, inclusive no retorno de uma função do mesmo arquivo que o handler chama (a varredura e suas formas em C35)
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

### Rodada 2 - lacunas da primeira verificação · 8 files · 70 KB · ~18k

Fecha as lacunas do relatório da rodada 1 (`verification.md`, commit `1596f78`). Todas rodam com
`npx vitest run tests/api.v1.test.ts -t "<nome>"`. Cada uma foi provada contra o mutante que o
relatório deixou vivo (ou contra o defeito), injetado à mão, visto falhar e revertido.

**C27** - As rotas `public` da tabela são exatamente `GET /api/meta` e `POST /api/pair/claim`; nas duas grafias (`/api/` e `/api/v1/`), `GET …meta?token=<local>` e `POST …pair/claim?token=<local>` com o código certo respondem `401 unauthorized` no envelope, nenhum dispositivo é pareado e o código continua aberto; sem `?token=`, `meta` responde `200` e o mesmo código pareia (AC 11)
Proof: `npx vitest run tests/api.v1.test.ts -t "C27 a query token is refused on public routes too"`
Status: closed

**C28** - De um endereço que não é loopback, table-driven: 25 respostas `404 not_found`, 25 `403 owner_only` e 25 `400 validation`, cada conjunto de um endereço, não bloqueiam (a requisição seguinte com o token local responde `200`); 20 `401` de outro endereço bloqueiam (`429`) (AC 14)
Proof: `npx vitest run tests/api.v1.test.ts -t "C28 only 401 answers count toward the lockout"`
Status: closed

**C29** - Depois de 10 `POST /api/v1/pair/claim` de `203.0.113.70` (código errado, um código novo por tentativa para nenhum queimar), a 11ª com o código CERTO responde `429 too_many_requests` com `Retry-After` > 0, nenhum dispositivo é criado e o código continua aberto; o mesmo código, de outro endereço, pareia (`200`) (AC 13, "without checking the code")
Proof: `npx vitest run tests/api.v1.test.ts -t "C29 the pairing limit holds before the code is read"`
Status: closed

**C30** - Com `allowedUserIds: [42]`, table-driven sobre todo tipo que `parseCommand` reconhece: `/approve <id>`, `/deny <id>`, `/ok <id>`, `/no <id>`, `/pending`, `/status`, `/start`, `/help` e os botões `ap:<id>` e `dn:<id>`. De `from.id` 7 no chat configurado, nenhuma chamada à Bot API (nenhuma resposta) e a aprovação segue `pending`; a mesma atualização de 42 é respondida (AC 20)
Proof: `npx vitest run tests/api.v1.test.ts -t "C30 an unlisted person gets nothing from any command or button"`
Status: closed

**C31** - As rotas com `queryToken` são as quatro da door 4; para cada uma, nas duas grafias, cada método que não é `GET` (`HEAD`, o gêmeo que o Fastify cria, e `POST`, `PUT`, `PATCH`, `DELETE`, tirados da tabela de rotas) com `?token=<local>` responde `401`, num socket de verdade (AC 11, "on a non-`GET` method")
Proof: `npx vitest run tests/api.v1.test.ts -t "C31 a query token rides only on GET"`
Status: closed

**C32** - Table-driven, com um único helper de asserção (`expectEnvelope`: `error.code`, `error.message` não vazio e `message` de topo igual) e `content-type` JSON: `403 owner_only`, `429 too_many_requests` do bloqueio (com `Retry-After` inteiro > 0), os `401 unauthorized` do gancho (sem token, token errado, `?token=` recusado), `400 bad_request` do parser do Fastify (JSON malformado), `415 unsupported_media_type`, `404 not_found` de rota desconhecida, `413 payload_too_large`, `403 forbidden_host`, `403 forbidden_path` (`artifacts/raw` fora da pasta) e `500 internal` (o store da rota falha uma vez) (AC 5)
Proof: `npx vitest run tests/api.v1.test.ts -t "C32 every failure of the hook and the parser uses the envelope"`
Status: closed

**C33** - O conjunto de métodos da tabela de rotas (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) é exatamente o dos casos do teste; para cada método, uma rota da tabela com estado novo a cada chamada (`GET /api/runs`, `POST /api/notifications/read`, `PUT /api/ui-preferences`, `PATCH /api/sessions/:id`, `DELETE /api/notifications/:id`) responde `200` sem versão, e sob `/api/v1` o mesmo status e o mesmo corpo (AC 1)
Proof: `npx vitest run tests/api.v1.test.ts -t "C33 every method of the route table answers the same under v1"`
Status: closed

**C34** - O `Link` de obsolescência nunca leva a query: `GET /api/events?token=` (stream, socket de verdade) → `</api/v1/events>; rel="successor-version"`; `GET /api/runs?token=` (`401`) e `GET /api/runs?limit=3` → `</api/v1/runs>; rel="successor-version"` (AC 2)
Proof: `npx vitest run tests/api.v1.test.ts -t "C34 the successor link never carries the query"`
Status: closed

**C35** - A varredura de C10 (árvore sintática) acha cada forma que o AC 7 recusa, uma vez cada: `return { ok: false }`, corpo de arrow `({ ok: result.ok })`, `reply.send({ ok: !x })`, `{ ok }` abreviado, chave `"ok"` e `["ok"]`, `as`/`satisfies`, os dois braços de `?:` e `??`, handler por nome (declaração e `const`), `app.route({ handler })`, variável local devolvida, `send` dentro de callback, outro receptor (`fastify.put`), retorno de função do mesmo arquivo chamada pelo handler, rota em template; e não acha: `ok: true`, `ok` aninhado (`{ health: { ok } }`), objeto montado e não devolvido, retorno de callback interno, função que não é rota, `ok: false` em string e em comentário, `okay`/`notOk` (AC 7)
Proof: `npx vitest run tests/api.v1.test.ts -t "C35 the ok scanner sees every answer shape and nothing else"`
Status: closed

**C36** - `probeServer` (a sonda de `mordomo launch`, movida de `cli.ts` para `instances.ts`) lê `/api/v1/meta`; num serviço que só responde `/api/v1/meta` devolve o nome e a versão; num serviço anterior à v1 (`404` em `/api/v1/meta`, `200` em `/api/meta`) também; sem nenhum dos dois, `null`; e contra o servidor de verdade devolve a versão (AC 4, fora do AC na rodada 1)
Proof: `npx vitest run tests/api.v1.test.ts -t "C36 the CLI probe asks v1 first and falls back for an older service"`
Status: closed

## Coverage

| Set (size)                                            | Member -> proof                                                                                                                                                                                                                                                                                                                                       | Unproven |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| métodos sob `/api/v1`, tirados da tabela de rotas (5) | `GET` C1 (todas as rotas sem parâmetro), C33 · `POST` C2, C33 · `PUT` C33 · `PATCH` C33 · `DELETE` C33                                                                                                                                                                                                                                                | -        |
| clientes da API (3) e a sonda da CLI                  | interface C5, C6 · servidor MCP C5 · cliente de permissão C5 · `probeServer` de `mordomo launch` C36                                                                                                                                                                                                                                                  | -        |
| quem produz erro ≥ 400 (16)                           | `ZodError` 400 C7 · `httpError` < 500 C7, C8, C9 · 502 C8, C9 · 413 C7, C32 · 404 C7, C32 · `owner_only` 403 C32 · `429` do bloqueio C32 · `429` do pareamento C29 · `401` sem token C32 · `401` token errado C32 · `401` `?token=` recusado C32 · `400` do parser C32 · `415` C32 · `forbidden_host` C32 · `forbidden_path` C32 · 500 `internal` C32 | -        |
| rotas `200 ok:false` de hoje (3) e a regra AC 7       | telegram send C8 · telegram test C8 · push test C9 · varredura na árvore sintática C10, com as formas em C35 (`ok:` com expressão, função auxiliar chamada pelo handler)                                                                                                                                                                              | -        |
| rotas `owner` (18)                                    | C11, table-driven over all 18 · C12 (o conjunto exato)                                                                                                                                                                                                                                                                                                | -        |
| principais (3)                                        | owner C14 · device C11, C13 · broker C22 (e as três rotas de aprovação já cobertas em `tests/api.security-p0.test.ts`)                                                                                                                                                                                                                                | -        |
| `?token=` aceito (4)                                  | C16 (o conjunto exato) · `events` C16 · `runs/:id/stream` C16 · `artifacts/raw` e `skills/:slug/resource` C16 (conjunto)                                                                                                                                                                                                                              | -        |
| `?token=` recusado, pelo AC 11 (3)                    | rota autenticada fora da door 4 (`GET`/`POST`) C15, C32 · rota pública (as 2, nas duas grafias) C27 · método que não é `GET` (`HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`) nas 4 rotas da door 4, nas duas grafias C31                                                                                                                                   | -        |
| limites, pelos AC 13-15 (6)                           | 11ª tentativa C17 · antes de verificar o código C29 · 20 `401` bloqueiam C18 · só `401` conta (`404`/`403`/`400` não) C28 · janela de 5 min C18 · loopback C19                                                                                                                                                                                        | -        |
| valores de `resolvedBy` (5)                           | `owner` C22 · `device:` C22 · `broker:` C22 · `system` C22 · `telegram:` C23                                                                                                                                                                                                                                                                          | -        |
| regra do Telegram: estados (2)                        | lista vazia C25 · lista com nomes C24, e table-driven sobre os 10 tipos (`/approve`, `/deny`, `/ok`, `/no`, `/pending`, `/status`, `/start`, `/help`, `ap:`, `dn:`) C30                                                                                                                                                                               | -        |
| `Link` de obsolescência (2)                           | caminho C3 · sem a query (stream com `?token=`, rota normal) C34                                                                                                                                                                                                                                                                                      | -        |
| doors (6)                                             | versão C1-C4, C33, C34 · envelope C7-C10, C32, C35 · escopos C11-C14 · token na URL C15, C16, C27, C31 · limites C17-C19, C28, C29 · `resolved_by` C22, C26                                                                                                                                                                                           | -        |

- Claims naming a status code or route: todas por `inject` na rota, com `remoteAddress` quando o endereço importa

## Test policy

| Code                                                                  | Required proofs                                                         | Coverage expectation                                                                 |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Decides, reached across a boundary (gancho de auth, escopo, limites)  | one at the boundary                                                     | each route of each door list and status; each method; each status that counts or not |
| Decides, not reached across a boundary (poller do Telegram, migração) | one at its own layer                                                    | each rule, table-driven over every update kind                                       |
| Instrumentation (prefixo dos clientes, documento, sonda da CLI)       | unit + source check (source checks on the syntax tree, with self-tests) | each client; every route                                                             |

Evidence:

- `apps/api/src/server.ts` `onRequest`: credencial × rota × escopo × endereço -> decides
- `core/src/channels/telegramInbound.ts`: `chat.id` × `from.id` × lista -> decides
- closest analogue in the repo: `tests/api.security-p0.test.ts` (auth por rota com `inject`)

Cost: 1 arquivo de teste novo na raiz, 1 teste novo na interface, 26 provas; rodada 2: 10 provas novas no mesmo arquivo.

## Swept

- validation: C7 (envelope do `ZodError`)
- failure modes: C8, C9 (falha de canal como erro), C7 (`413`)
- idempotency: n/a - nada novo é gravado além de `resolved_by`, uma vez por aprovação
- authorization: C11-C16, C27, C31 (escopos e token na URL), C24, C30 (Telegram)
- concurrency: n/a - os limites são por processo e em memória; um serviço por máquina (feature 3)
- data lifecycle: C26 (linhas antigas)
- dependency failure: C8 (Telegram recusou)
- state transitions: C22 (`pending` → `approved`/`denied`/`expired` com o autor)
- observability: C22, C23 (`resolvedBy`), C3 (cabeçalhos de obsolescência)

## Handoff

- S1-S6 ≈ 67k: server.ts 20 KB, system.ts trechos 20 KB, devices/channels/push 12 KB, telegramInbound 10 KB, approvals store + migração 10 KB, api.ts trechos 15 KB, mcp/*.ts 6 KB, docs 8 KB, teste novo ~40 KB ≈ 141 KB / 4 ≈ 35k, mais leitura e execução - abaixo de 150k - one builder
