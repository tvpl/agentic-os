# API v1 checks

Profile: standard
Plan: `.specs/features/api-v1/plan.md`

47 checks in 6 slices and 3 repair rounds · 6 one-way doors · 0 open, of which 0 block

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

**C5** - Em `apps/command-centre/src` (fora de testes e de `gallery/`), toda URL de API passa por `request()`/as funções de SSE de `api.ts`, que prefixam `/api/v1`; nenhuma string `"/api/` chega ao `fetch`/`EventSource` sem o prefixo; e `apps/api/src/mcp/*.ts` usa `/api/v1/` (AC 4). Rodada 3: lido na árvore sintática TS/TSX (`tests/helpers/apiUrlScanner.ts`), não por regex: todo atributo `src`/`href`/`poster`/`action` e todo argumento de `fetch`/`EventSource`/`new URL`/`new Request`/`window.open`/`xhr.open`/`navigator.sendBeacon` que é ou contém uma string `/api/` passa por `apiUrl()`; o detector e suas formas em C42
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

**C10** - Em `apps/api/src`, nenhum `return`/`reply.send` de rota devolve um objeto com `ok: false` (AC 7). Rodada 2: lido na árvore sintática do TypeScript, e recusa também `ok:` com qualquer expressão que não seja `true`, inclusive no retorno de uma função do mesmo arquivo que o handler chama (a varredura e suas formas em C35). Rodada 3: a varredura mora em `tests/helpers/okScanner.ts`, vê também spread, `Object.assign` e `x.ok = …` (formas em C40), e uma segunda varredura sobre todo arquivo de `apps/api/src` recusa qualquer `ok` que não seja `true` sem entrada na tabela de isenções do teste (corpo montado em outro arquivo)
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

**C17** - Dez `POST /api/pair/claim` de um endereço novo passam pela verificação; a 11ª responde `429 too_many_requests` com `Retry-After` inteiro > 0, e outro endereço ainda é atendido (AC 13)
Proof: `npx vitest run tests/api.v1.test.ts -t "C17 pairing attempts are limited per address"`
Status: closed

**C18** - Depois de 20 respostas `401` para um endereço novo, a próxima requisição (mesmo com token certo) responde `429`; com o relógio avançado 5 min (`vi.setSystemTime`), volta a responder `200` (AC 14)
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

**C29** - Depois de 10 `POST /api/v1/pair/claim` de um endereço novo (código errado, um código novo por tentativa para nenhum queimar), a 11ª com o código CERTO responde `429 too_many_requests` com `Retry-After` > 0, nenhum dispositivo é criado e o código continua aberto; o mesmo código, de outro endereço, pareia (`200`) (AC 13, "without checking the code")
Proof: `npx vitest run tests/api.v1.test.ts -t "C29 the pairing limit holds before the code is read"`
Status: closed

**C30** - Com `allowedUserIds: [42]`, table-driven sobre todo tipo que `parseCommand` reconhece: `/approve <id>`, `/deny <id>`, `/ok <id>`, `/no <id>`, `/pending`, `/status`, `/start`, `/help` e os botões `ap:<id>` e `dn:<id>`. De `from.id` 7 no chat configurado, nenhuma chamada à Bot API (nenhuma resposta) e a aprovação segue `pending`; a mesma atualização de 42 é respondida (AC 20)
Proof: `npx vitest run tests/api.v1.test.ts -t "C30 an unlisted person gets nothing from any command or button"`
Status: closed

**C31** - As rotas com `queryToken` são as quatro da door 4; para cada uma, nas duas grafias, cada método que não é `GET` (`HEAD`, o gêmeo que o Fastify cria, e `POST`, `PUT`, `PATCH`, `DELETE`, tirados da tabela de rotas) com `?token=<local>` responde `401`, num socket de verdade (AC 11, "on a non-`GET` method")
Proof: `npx vitest run tests/api.v1.test.ts -t "C31 a query token rides only on GET"`
Status: closed

**C32** - Table-driven, com um único helper de asserção (`expectEnvelope`: `error.code`, `error.message` não vazio e `message` de topo igual) e `content-type` JSON: `403 owner_only`, `429 too_many_requests` do bloqueio (com `Retry-After` inteiro > 0), os `401 unauthorized` do gancho (sem token, token errado, `?token=` recusado), `400 bad_request` do parser do Fastify (JSON malformado), `415 unsupported_media_type`, `404 not_found` de rota desconhecida, `413 payload_too_large`, `403 forbidden_host`, `403 forbidden_path` (`artifacts/raw` fora da pasta) e `500 internal` (o store da rota falha, por um stub explícito que só vale durante a chamada) (AC 5)
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

### Rodada 3 - lacunas da segunda verificação · 7 files · 60 KB · ~16k

Fecha as lacunas do relatório da rodada 2 (`verification.md`, commit `f765b1f`). Todas rodam com
`npx vitest run tests/api.v1.test.ts -t "<nome>"`; cada uma foi provada contra o mutante que o relatório
deixou vivo, injetado à mão, visto falhar e revertido. Os endereços das provas de limite vêm de
`freshAddress()` (um novo por chamada, sem colisão entre provas); os detectores de árvore sintática moram em
`tests/helpers/` com auto-teste.

**C37** - Com `allowedUserIds: [42]`, table-driven sobre os 10 tipos de C30 e sobre os remetentes sem id utilizável (sem `from`, `from` sem `id`, `from.id` em texto): nenhuma chamada à Bot API, a aprovação segue `pending`; a mesma atualização de 42 é respondida. Com a lista vazia, um botão sem `from` ainda decide (regra do chat, `telegram:unknown`) (AC 20, AC 21; M51)
Proof: `npx vitest run tests/api.v1.test.ts -t "C37 an update with no listed person behind it is ignored"`
Status: closed

**C38** - `?token=<local>` responde `401 unauthorized` no envelope em toda grafia de `/api`: `/%61pi/runs` (rota casada, URL crua sem `/api/`), `/%61pi/v1/runs`, `/%61pi/meta` e `POST /%61pi/pair/claim` (públicas), `/api//runs`, `/api/v1//runs` (`GET` e `POST`), `/api/v1/`, `/api/v1`, `/api`, `/api/nao-existe`, `/api/v1/nao-existe` (`GET`/`POST`) e `/api/runs/x/y/z`; `/?token=` e `/apix?token=` não são `/api`. `isApiRequest(url, rota)` decide uma vez, e cada metade decide sozinha (rota casada; caminho decodificado), numa tabela de 14 casos. Decisão: caminho inexistente é `401`, não `404` (plano, Surface) (AC 11; M48)
Proof: `npx vitest run tests/api.v1.test.ts -t "C38"`
Status: closed

**C39** - Em um serviço de home própria, `GET /api/health` e `GET /api/v1/health` respondem `200` com `ok: true` e `db.open: true`; depois de fechar o banco, `503` com `error.code` `service_unavailable` no envelope (nunca `internal`, nunca um corpo com `ok`), `content-type` JSON (AC 5, AC 7; M55)
Proof: `npx vitest run tests/api.v1.test.ts -t "C39 a closed database answers GET /api/health with a 503 envelope"`
Status: closed

**C40** - As varreduras de AC 7 acham, uma vez cada, o spread (`{ ...{ ok } }`, `{ ...local }`, `{ ...(c ? {…} : {…}) }`, `{ ...build() }`), `Object.assign({}, { ok: false })`, `Object.assign(local, { ok })`, `local.ok = false`, `local["ok"] = …`, uma constante do módulo; e, no arquivo inteiro, `ok:` que não é `true` em literal (abreviado, chave `"ok"`/`["ok"]`, spread, `Object.assign`) e em `x.ok = …`; e não acham `ok: true`, `x.ok = true`, tipo `ok: boolean`, `okay`, comentário, string, comparação, desestruturação nem leitura (AC 7; M55 pelo spread)
Proof: `npx vitest run tests/api.v1.test.ts -t "C40 the ok scans see a spread, Object.assign, a late assignment and another file's body"`
Status: closed

**C41** - O `403 forbidden` do broker de permissão (credencial de uma execução em rota fora das três de aprovação) responde no envelope (`expectEnvelope`: `error.code`, `error.message` não vazio, `message` de topo igual) com `content-type` JSON, nas duas grafias e em `GET`/`POST`/`PUT`/`DELETE` (AC 5; M63)
Proof: `npx vitest run tests/api.v1.test.ts -t "C41 the permission broker's 403 uses the envelope"`
Status: closed

**C42** - O leitor de C5 acha, ao menos uma vez cada, 25 formas (`<img src="/api/…">`, `src={"…"}`, template, concatenação, `poster`, `<form action>`, braço de `?:`, constante do arquivo, `fetch`/`new EventSource`/`new URL`/`new Request`/`window.open`/`xhr.open`/`sendBeacon` com `/api/` ou com argumento que não é chamada de construtor, `img.src =`, `location.href =`, `{ src: … }`); e nenhuma de 20 formas aceitas (as mesmas pontas por `apiUrl(…)`/`artifactRawUrl(…)`/`resourceUrl(…)`, URL externa, `status.url`, `action={<Button/>}`, `api.get("/api/…")`, comentário, string solta); e conta o que julgou (AC 4; M64)
Proof: `npx vitest run tests/api.v1.test.ts -t "C42 the api url reader sees every sink shape and nothing else"`
Status: closed

**C43** - Com a interface montada a partir de um diretório estático mínimo criado pela própria prova (não do `dist` ignorado pelo git), a página e uma rota da SPA respondem `200` HTML, e `GET /api/v1/nao-existe`, `/api/nao-existe`, `/api`, `/%61pi/nao-existe`, `/assets/missing.js`, `/missing.css` e `POST /some/spa/route` respondem `404 not_found` no envelope, `content-type` JSON e `Cache-Control: no-store` (AC 5; M65)
Proof: `npx vitest run tests/api.v1.test.ts -t "C43 the 404 answers in the envelope with the UI mounted"`
Status: closed

**C44** - `probeServer` só aceita `/api/v1/meta` quando responde `200`, JSON de objeto, com `apiVersion`; em qualquer outra resposta (`404`, `401`, `403`, `500`, `200` que não é JSON, JSON sem `apiVersion`, JSON que não é objeto) pergunta `/api/meta`, na ordem v1 depois sem versão (a lista de pedidos é a esperada em cada caso); `null` quando os dois falham (`401`, `500`, não JSON, sem `version`, nada responde, porta fechada) (AC 4; Q3, M50, M52)
Proof: `npx vitest run tests/api.v1.test.ts -t "C44 the CLI probe falls back to /api/meta unless v1 answered for good"`
Status: closed

### Depois da rodada 3 - correção do autor (escalada ao dono)

**C45** - Por socket cru, `GET http://127.0.0.1:<porta>/api/runs?token=<local>` (alvo em forma absoluta, que `inject` normaliza) responde `401`: só a metade da regra que usa a rota casada o vê como `/api`; `/api/v1/runs` em forma absoluta, que não é reescrito e nunca chega a uma rota, é recusado (`401` ou `403`) (AC 11; mata R3-08)
Proof: `npx vitest run tests/api.v1.test.ts -t "C38 a query token is refused on every spelling of an /api path"`
Status: closed

**C46** - `probeServer` contra um servidor que aceita e nunca responde devolve `null` dentro do orçamento (menos de 1500 ms com 300 ms de limite), e a requisição leva o `signal` (mata R3-33 e R3-34)
Proof: `npx vitest run tests/api.v1.test.ts -t "C44 the CLI probe falls back to /api/meta unless v1 answered for good"`
Status: closed

**C47** - Um `500` com corpo v1 válido (`apiVersion`, `version`) não é aceito como v1: o probe cai para `/api/meta` (mata R3-32)
Proof: `npx vitest run tests/api.v1.test.ts -t "C44 the CLI probe falls back to /api/meta unless v1 answered for good"`
Status: closed

## Coverage

| Set (size)                                            | Member -> proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Unproven |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| métodos sob `/api/v1`, tirados da tabela de rotas (5) | `GET` C1 (todas as rotas sem parâmetro), C33 · `POST` C2, C33 · `PUT` C33 · `PATCH` C33 · `DELETE` C33                                                                                                                                                                                                                                                                                                                                                                                                                             | -        |
| clientes da API (3) e a sonda da CLI                  | interface C5 (árvore sintática, todo atributo `src`/`href`/`poster`/`action` e todo `fetch`/`EventSource`/`new URL`/`window.open`/`xhr.open`/`sendBeacon`; detector C42), C6 · servidor MCP C5 · cliente de permissão C5 · `probeServer` de `mordomo launch` C36, e cada resposta que manda ao fallback C44                                                                                                                                                                                                                        | -        |
| quem produz erro ≥ 400 (18)                           | `ZodError` 400 C7 · `httpError` < 500 C7, C8, C9 · 502 C8, C9 · 503 `service_unavailable` (`GET /api/health`, banco fechado) C39 · 413 C7, C32 · 404 C7, C32 · 404 com a interface montada C43 · `owner_only` 403 C32 · `forbidden` 403 do broker de permissão (`server.ts`, gancho) C41 · `429` do bloqueio C32 · `429` do pareamento C29 · `401` sem token C32 · `401` token errado C32 · `401` `?token=` recusado C32, C38 · `400` do parser C32 · `415` C32 · `forbidden_host` C32 · `forbidden_path` C32 · 500 `internal` C32 | -        |
| rotas `200 ok:false` de hoje (3) e a regra AC 7       | telegram send C8 · telegram test C8 · push test C9 · varredura na árvore sintática C10, com as formas em C35 (`ok:` com expressão, função auxiliar chamada pelo handler) e C40 (spread, `Object.assign`, atribuição tardia, constante do módulo) · varredura do arquivo inteiro de `apps/api/src` C10 (corpo vindo de outro arquivo; isenções justificadas em tabela no teste) · `GET /api/health` com o banco fechado C39                                                                                                         | -        |
| rotas `owner` (18)                                    | C11, table-driven over all 18 · C12 (o conjunto exato)                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | -        |
| principais (3)                                        | owner C14 · device C11, C13 · broker C22 (e as três rotas de aprovação já cobertas em `tests/api.security-p0.test.ts`)                                                                                                                                                                                                                                                                                                                                                                                                             | -        |
| `?token=` aceito (4)                                  | C16 (o conjunto exato) · `events` C16 · `runs/:id/stream` C16 · `artifacts/raw` e `skills/:slug/resource` C16 (conjunto)                                                                                                                                                                                                                                                                                                                                                                                                           | -        |
| `?token=` recusado, pelo AC 11 (4)                    | rota autenticada fora da door 4 (`GET`/`POST`) C15, C32 · rota pública (as 2, nas duas grafias) C27 · método que não é `GET` (`HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`) nas 4 rotas da door 4, nas duas grafias C31 · rota casada com caminho codificado e caminho `/api/**` inexistente (401, não 404), cada metade de `isApiRequest` sozinha C38                                                                                                                                                                                 | -        |
| limites, pelos AC 13-15 (6)                           | 11ª tentativa C17 · antes de verificar o código C29 · 20 `401` bloqueiam C18 · só `401` conta (`404`/`403`/`400` não) C28 · janela de 5 min C18 · loopback C19                                                                                                                                                                                                                                                                                                                                                                     | -        |
| valores de `resolvedBy` (5)                           | `owner` C22 · `device:` C22 · `broker:` C22 · `system` C22 · `telegram:` C23                                                                                                                                                                                                                                                                                                                                                                                                                                                       | -        |
| regra do Telegram: estados (2) × remetentes (4)       | lista vazia C25 (e sem `from` C37) · lista com nomes C24, e table-driven sobre os 10 tipos (`/approve`, `/deny`, `/ok`, `/no`, `/pending`, `/status`, `/start`, `/help`, `ap:`, `dn:`) C30 · os mesmos 10 tipos de remetente sem `from`, com `from` sem `id` e com `from.id` em texto C37                                                                                                                                                                                                                                          | -        |
| `Link` de obsolescência (2)                           | caminho C3 · sem a query (stream com `?token=`, rota normal) C34                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | -        |
| doors (6)                                             | versão C1-C4, C33, C34 · envelope C7-C10, C32, C35 · escopos C11-C14 · token na URL C15, C16, C27, C31 · limites C17-C19, C28, C29 · `resolved_by` C22, C26                                                                                                                                                                                                                                                                                                                                                                        | -        |

| `GET /api/health` (2 respostas) | `200` com o banco aberto (e `ok`, `db.open` que o soak lê) C39 · `503 service_unavailable` com o banco fechado C39 | - |
| fluxo `stream.reset` do SSE (1) | pertence a `seguranca-p1` C11 (`tests/security-p1.test.ts`), que criou o quadro; o api-v1 só prova que o SSE abre e aceita `?token=` (C2, C16) | - |

- Claims naming a status code or route: todas por `inject` na rota, com `remoteAddress` quando o endereço importa (um endereço novo por prova, `freshAddress()`)

## Test policy

| Code                                                                  | Required proofs                                                                                      | Coverage expectation                                                                                                                                                                |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decides, reached across a boundary (gancho de auth, escopo, limites)  | one at the boundary                                                                                  | each route of each door list and status; each method; each status that counts or not; each spelling of the path (encoded, doubled slash, unknown); each producer of an error status |
| Decides, not reached across a boundary (poller do Telegram, migração) | one at its own layer                                                                                 | each rule, table-driven over every update kind and every kind of sender (listed, unlisted, no `from`, no `id`)                                                                      |
| Instrumentation (prefixo dos clientes, documento, sonda da CLI)       | unit + source check (source checks on the syntax tree, with self-tests, readers in `tests/helpers/`) | each client and each sink shape; every route; every answer of the probe                                                                                                             |

Evidence:

- `apps/api/src/server.ts` `onRequest`: credencial × rota × escopo × endereço -> decides
- `core/src/channels/telegramInbound.ts`: `chat.id` × `from.id` × lista -> decides
- closest analogue in the repo: `tests/api.security-p0.test.ts` (auth por rota com `inject`)

Cost: 1 arquivo de teste novo na raiz, 1 teste novo na interface, 26 provas (C1-C26); rodada 2: 10 provas novas no mesmo arquivo (C27-C36); rodada 3: 8 provas novas (C37-C44) e 2 leitores de árvore sintática em `tests/helpers/` (`okScanner.ts`, `apiUrlScanner.ts`), no total 44 provas.

## Swept

- validation: C7 (envelope do `ZodError`)
- failure modes: C8, C9 (falha de canal como erro), C7 (`413`)
- idempotency: n/a - nada novo é gravado além de `resolved_by`, uma vez por aprovação
- authorization: C11-C16, C27, C31, C38 (escopos e token na URL), C24, C30, C37 (Telegram), C41 (broker)
- concurrency: n/a - os limites são por processo e em memória; um serviço por máquina (feature 3)
- data lifecycle: C26 (linhas antigas)
- dependency failure: C8 (Telegram recusou), C39 (banco fechado), C44 (a sonda sem resposta ou com resposta que não é v1)
- state transitions: C22 (`pending` → `approved`/`denied`/`expired` com o autor)
- observability: C22, C23 (`resolvedBy`), C3 (cabeçalhos de obsolescência)

## Handoff

- S1-S6 ≈ 67k: server.ts 20 KB, system.ts trechos 20 KB, devices/channels/push 12 KB, telegramInbound 10 KB, approvals store + migração 10 KB, api.ts trechos 15 KB, mcp/*.ts 6 KB, docs 8 KB, teste novo ~40 KB ≈ 141 KB / 4 ≈ 35k, mais leitura e execução - abaixo de 150k - one builder
