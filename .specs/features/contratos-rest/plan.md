# Contratos REST — corpos de requisição e resposta no contrato, OpenAPI com schemas e versão por tipo de evento

## Problem

O pacote `@mordomo/contracts` descreve o que atravessa a fronteira motor, API e interface, mas não
descreve a API. As 127 rotas sob `/api` validam a entrada com zod local, escrito dentro de cada
handler (`apps/api/src/routes/*.ts`: 41 `z.object` espalhados), e respondem objetos soltos: nada diz
a forma da resposta, e a interface declara à mão os 85 tipos que acha que a API devolve
(`apps/command-centre/src/api.ts`, 1 044 linhas, 113 chamadas `api.get<T>(…)` em que `T` é um palpite).
Mudar o corpo de uma resposta no servidor não quebra nada que alguém rode: nem o compilador, nem um
teste, nem a interface (que só sente em tempo de execução).

O documento `GET /api/v1/openapi.json` (`apps/api/src/openapi.ts`) é gerado da tabela de rotas do
Fastify e lista método, caminho, parâmetros de caminho, escopo e o envelope de erro, mas cada
operação responde só `"200": { description: "Success" }`: nenhum corpo de requisição, nenhum corpo de
resposta, e os códigos `403`, `409`, `413`, `422` e `429` que `api-v1`, `escopos-dispositivo` e
`dados-v2` introduziram existem em dois lugares sem schema (o código e `KNOWN_ERRORS`, que cobre
duas rotas). Nenhum validador de OpenAPI roda sobre ele. Um integrador de terceiros (a razão de existir
do contrato) não tem o que seguir.

Os eventos têm `v`, mas um só valor (`OS_EVENT_VERSION = 1`) para os 23 tipos e nenhuma política: o
payload de `settings.changed` e o de `index.progress` não podem evoluir em separado, não há schema
runtime de nenhum payload (só tipos), e o cliente da interface repassa qualquer `type` que chegue
(`api.streamEvents`). Os quadros do SSE de uma execução (`GET /api/runs/:id/stream`) não levam `v`
nenhuma: `started`, `text`, `assistant`, `tool_use`, `permission`, `session`, `result`, `error`, `usage`
e o `run_state` final são 10 formatos sem marca de versão.

Quem paga: quem integra com a API (hoje adivinha os corpos), quem mexe no servidor (muda uma resposta
sem saber quem lê) e a interface (tipos espelhados que divergem em silêncio, o problema que
`contratos` resolveu para as entidades e deixou aberto para as rotas: "Validar respostas da API…" e
"Tipos de memória, rotinas, objetivos, conectores e métricas no contrato" ficaram fora do escopo
dele). Evidência: `.specs/roadmap.md` S5 (`contratos-rest`, revisão de arquitetura de 07/10/2026),
`apps/api/src/openapi.ts:60-70` (`"200": { description: "Success" }`) e `apps/command-centre/src/api.ts`.

Quando isto entrega: cada rota tem um schema por parte (parâmetros, query, corpo, resposta, erros) no
pacote, o servidor valida a entrada pela mesma tabela de que sai o OpenAPI, o teste da API confere cada
resposta real contra o schema da rota (mudar uma resposta sem mudar o contrato reprova), o documento
OpenAPI é completo e válido, cada tipo de evento tem versão e política de evolução, e a interface chama
as rotas cobertas por tipos que vêm do contrato.

## Flow

Reutiliza o `ZodError → 400 validation` do `errorHandler` e o envelope `errorBody()` de `server.ts`, os
hooks `onRoute`/`onRequest` que já decidem escopo pela rota casada (`req.routeOptions`), os schemas zod que
já existem no contrato (`SettingsSchema`, `UiPreferencesSchema`, `ProviderId`) e os que moram no core
(`RoutineSchema`, `ConnectorSchema`, `SkillFrontmatterSchema`), que passam a morar no contrato e voltam
reexportados com o mesmo nome; o `app.apiRoutes` continua sendo a medida do que o roteador tem.

1. Contrato → `contracts/src/api/` (door 1, new): a tabela `API` (uma entrada por rota: método, caminho,
   acesso, `params`, `query`, `body`, `responses`, `errors`) e os schemas de cada parte; o registro de
   versões de evento (door 3) e os schemas dos eventos (door 4).
2. Registro → `apps/api/src/contract.ts` (door 2, new): `bind(app, id, handler)` é o único jeito de registrar
   uma rota `/api`; pega método, caminho e acesso da entrada, faz `parse` de `params`, `query` e `body`
   com os schemas dela e entrega o resultado tipado ao handler.
3. Servidor → `apps/api/src/server.ts` (exists): o `onRoute` recusa uma rota `/api` registrada fora de `bind`;
   depois de registrar tudo, recusa subir se uma entrada de `API` ficou sem rota; com `validateResponses` ligado,
   um `preSerialization` confere status e corpo de cada resposta JSON contra a entrada casada.
4. Rotas → `apps/api/src/routes/*.ts` (exist): os handlers passam a `bind`, sem `z.object` local; o handler
   devolve o corpo (ou `reply`, nas rotas de fluxo e de arquivo) e o tipo do retorno é o da entrada.
5. Documento → `apps/api/src/openapi.ts` (exists) gera `paths` e `components.schemas` da tabela `API`, com
   `zod-to-json-schema` (door 6); recusa gerar uma entrada sem schema de sucesso.
6. Eventos → `core/src/events.ts` (exists) carimba `v` com a versão corrente do tipo; `routes/runs.ts` (exists)
   carimba `v` nos quadros da execução; `routes/sse.ts` e `routes/events.ts` (exist) não mudam de forma.
7. Cliente → `apps/command-centre/src/api.ts` (exists): `apiCall("GET /api/runs/:id", …)` tipado por
   `typeof API` (só tipos, nenhum zod no bundle), e `streamEvents`/`streamRun` ignoram o que
   `classifyEvent` (`@mordomo/contracts/events`, door 3) manda ignorar.
8. Documento de eventos → `docs/events.md` (new, door 5), gerado dos schemas e conferido por teste.

## Impact

| Front       | What changes                                                                                                                                                                                                                                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | novo termo: `entrada de rota` - o registro `{método, caminho, acesso, params, query, body, responses, errors}` de uma rota; vive em `contracts/src/api`; quem a lê: `bind`, `openapi.ts`, o teste de contrato e a interface                                                                                           |
| domain      | termo existente: `config.scope`/`public`/`queryToken`/`ticket` eram escritos em cada `app.get(…, { config })`; passam a vir da entrada. Quem ramifica neles hoje: o `onRequest` e o `onRoute` de `server.ts`, `ticketKey`, `tests/helpers/routeScopes.ts` (a tabela escrita à mão segue sendo o oráculo independente) |
| domain      | termo existente: `OsEventType` era uma união escrita à mão; passa a sair de `OS_EVENT_TYPES` (a lista em tempo de execução). Quem lê: `core/src/events.ts`, `routes/events.ts`, `api.ts` da interface, `typetests/events.ts`                                                                                          |
| domain      | termo existente: `OS_EVENT_VERSION` (1 para todos) vira o piso; a versão de um tipo é `currentEventVersion(type)`. Quem ramifica: `core/src/events.ts` (`emit`), `routes/events.ts` (`stream.reset`)                                                                                                                  |
| contrato    | OpenAPI: cada operação ganha `requestBody`, `parameters` de query, um schema por status de sucesso e as respostas de erro com o envelope; `x-mordomo-scope` fica (única extensão); `KNOWN_ERRORS` sai, a descrição de cada erro vem da entrada                                                                        |
| contrato    | SSE de execução: cada quadro ganha `v: 1` (campo aditivo; a interface lê só `type`); o evento persistido em `run_events` não muda                                                                                                                                                                                     |
| contrato    | `@mordomo/contracts` ganha o subcaminho `./events` (sem zod) e os exports de tempo de execução `API`, `checkResponse` e os schemas de evento; a lista fixada em `tests/contracts.test.ts` (C41) e o `exports` (C16) mudam de propósito                                                                                |
| dependência | `zod-to-json-schema` em `apps/api` (exata); `@apidevtools/swagger-parser` e `ajv` em `devDependencies` (exatas); nada disso entra no bundle da interface                                                                                                                                                              |
| stored data | nada a migrar - não há coluna, arquivo nem formato em disco novo; as rotas respondem os mesmos corpos                                                                                                                                                                                                                 |

## Relations

None - no stored-data shape change

## Surface

Só o que muda de assinatura. A tabela `API` não é uma rota: é o contrato das 127 que já existem, que
seguem respondendo o mesmo (`/api/v1/<rest>` e o apelido sem versão, `Deprecation` e `Link` inalterados).

| Route                                        | In                                            | Out                                                                                                                   | Status                            |
| -------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `GET /api/v1/openapi.json`                   | -                                             | OpenAPI 3.1: `paths` com `parameters`, `requestBody`, `responses` por status e `components.schemas`                   | `200`, `401`, `403`, `429`        |
| `GET /api/v1/runs/:id/stream`                | `ticket` ou `token`, `Last-Event-ID`, `since` | quadros `{ type, ts, … , v }` (10 formatos), cada um com `v: 1`                                                       | `200`, `401`, `403`, `404`, `429` |
| qualquer rota `/api` com `validateResponses` | a requisição de sempre                        | se a resposta do handler não casa com a entrada: `error.code` `response_contract_violation` e os caminhos que diferem | `500`                             |

## Landing

| One-way door                          | Literal shape                                                                                                                                                                                                                                                                                                                                                                                                                                             | Alternative rejected                                                                                                                                                                                                                                                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. A tabela de rotas `API`            | `export const API = { "runs.get": route({ method: "GET", path: "/api/runs/:id", scope: "monitor", tag: "runs", summary: "…", params: z.object({ id: z.string().uuid() }), responses: { 200: RunDetail }, errors: [{ status: 404, code: "not_found", description: "…" }] }), … } as const`; chave `<domínio>.<ação>`, exportada da raiz do pacote com `checkResponse` e `ErrorEnvelope`; a lista de exports de tempo de execução fica fixada com `toEqual` | OpenAPI escrito à mão (YAML/JSON) como fonte e tipos gerados: o zod que valida em tempo de execução já é a fonte do contrato (`settings`, `preferences`), um gerador de zod a partir de YAML põe um passo de build e perde a inferência `z.infer` que a interface usa; e as duas descrições da mesma rota voltariam a divergir |
| 2. `bind` é o único registro de rota  | `bind(app, "runs.get", async ({ params }, req, reply) => body)`; `onRoute` lança em `/api` sem `config.route`; `buildServer` lança se uma entrada de `API` não foi ligada; `Result<K>` = união dos corpos de sucesso da entrada                                                                                                                                                                                                                           | Gancho global que valida por rota casada deixando `app.get(…)` e `req.params as {…}` nos handlers: o retorno do handler não fica ligado à entrada, então uma resposta que mudou compila e só um teste que a toque nota                                                                                                         |
| 3. Registro de versões de evento      | subcaminho `exports["./events"] = { "types": "./dist/eventRegistry.d.ts", "default": "./dist/eventRegistry.js" }` sem zod; `OS_EVENT_TYPES` (23), `EVENT_VERSIONS: Record<OsEventType, readonly number[]>` (hoje `[1]` em todos), `RUN_FRAME_TYPES` (10) e `classifyEvent(raw)` → `{ kind: "known", type, v } \| { kind: "unknown_type" } \| { kind: "unsupported_version", type, v }`                                                                    | Pôr `classifyEvent` na raiz: a interface importaria a raiz em tempo de execução e levaria zod e todos os schemas de rota para o bundle (o guarda `C13` de `contratos` e o de peso de `primitivas` reprovam)                                                                                                                    |
| 4. Versão por tipo de evento          | envelope `{ id, type, ts, v, payload }` com `v ∈ EVENT_VERSIONS[type]`; schema por `(type, v)` em `EVENT_SCHEMAS`, união discriminada por `type` e `v`; mudança compatível (campo aditivo) não muda `v`; mudança incompatível acrescenta `v + 1` e mantém o schema velho e o emissor velho até nenhuma versão publicada precisar dele; cliente ignora `type` ou `v` que não conhece                                                                       | Uma `v` global (o `OS_EVENT_VERSION` de hoje) subida a cada mudança: um cliente teria de tratar os 22 tipos como mudados por causa de um, e o `index.progress` não poderia evoluir sem arrastar o `settings.changed`                                                                                                           |
| 5. `v` nos quadros da execução        | `{"type":"assistant","ts":1,"text":"…","v":1}`; `run_state` idem; acrescentado no envio (`ch.send`), nunca gravado em `run_events`                                                                                                                                                                                                                                                                                                                        | Deixar os 10 formatos sem versão: nenhuma mudança incompatível seria detectável por um cliente (não há marca para ignorar); migrar `run_events` para gravar `v`: reescreve o histórico por um leitor que não existe                                                                                                            |
| 6. Dependências novas                 | `apps/api/package.json` → `"zod-to-json-schema": "3.25.2"`; raiz `devDependencies` → `"@apidevtools/swagger-parser": "13.1.0"`, `"ajv": "<a que o npm ci já resolve>"`, versões exatas, sem `^`; todas MIT/ISC                                                                                                                                                                                                                                            | Emissor de JSON Schema escrito à mão (~300 linhas que precisam acompanhar os internos do zod a cada versão); `fastify-type-provider-zod` + `@fastify/swagger`: troca o serializador do Fastify (corta chaves desconhecidas em produção) e prende o contrato ao Fastify, que o navegador não importa                            |
| 7. Erros documentados na entrada      | `errors: [{ status: 409, code: "channel_not_configured", description: "…" }]` por rota, mais `COMMON_ERRORS` (400 `validation`, 401, 403 `owner_only`/`scope_required`/`tls_required`/`forbidden_host`/`forbidden_path`/`forbidden`, 413, 415, 429, 500); o par `(status, code)` de uma resposta tem de estar numa das duas listas                                                                                                                        | Texto livre na descrição (o `KNOWN_ERRORS` de hoje): não há como conferir contra a resposta real, e um código novo passa sem que ninguém o documente                                                                                                                                                                           |
| 8. Nomes dos componentes do documento | `components.schemas`: `Error`, `Run`, `RunSummary`, `RunEvent`, `RunUsage`, `Approval`, `Notification`, `Session`, `ProviderCapabilities`, `Settings`, `UiPreferences`, `Skill`, `Routine`, `RoutineStatus`, `Connector`, `ConnectorData`, `Device`, `BackupInfo`, `MetricsSample`, `Fact`, `DoctorReport` (`NAMED_SCHEMAS`); o resto fica inline onde é usado; os nomes aparecem como tipos em qualquer cliente gerado do documento                      | Um nome por operação (`GetRunsIdResponse`): o gerador de `sdk-core` produziria um tipo por operação para a mesma entidade, e renomear depois quebra quem já gerou o cliente                                                                                                                                                    |
| 9. A forma de chamada da interface    | `apiCall("GET /api/runs/:id", { params, query, body }, { signal, timeoutMs })` com `CallArgs<K>`, e `useRouteQuery(queryKey, "GET /api/runs/:id", input?, options?)`; a chave é `"<MÉTODO> <caminho com :nome>"` escrita como literal em cada uma das chamadas migradas                                                                                                                                                                                   | Um método gerado por rota (`api.runs.get(id)`): exige um gerador de código na compilação e uma segunda grafia por rota, e a chave literal já é a que o roteador, o documento e os testes usam                                                                                                                                  |
| 10. O texto de uma flag de query      | `unread`, `refresh`, `related`, `record`, `includeExpired`: `1` e `true` ligam, `0` e `false` desligam, ausente é ausente, outro texto é `400 validation`; no documento é `{ "type": "string", "enum": ["1", "true", "0", "false"] }` (`QueryFlag`); `apiCall` manda `1` e `0`                                                                                                                                                                            | `z.coerce.boolean()` (o que a base fazia): lê `"0"` e `"false"` como ligado, e uma flag que não desliga não é uma flag; ficou publicada como `boolean` no documento, o que um cliente gerado levaria a mandar `false` e ligar                                                                                                  |

- Nothing else in this change is hard to reverse

### Emendas

Texto de um check ou de uma porta que mudou depois de aprovado, dito aqui e no check, para quem verifica não ter de descobrir pela diferença (regra 4: a parada e a pergunta pertencem a um check errado; estas são correções de contagem, de redação ou de escopo que a verificação pediu, com o dono avisado em "Perguntas ao dono"):

- **Door 7 (rodada 2).** `403 forbidden_path`, `404 not_a_file` e `413 file_too_large` não são mais `COMMON_ERRORS` de todas as rotas: cada rota as declara se a sonda de `tests/api.refusals.test.ts` (C45) a vê respondê-las com o filtro de caminhos e o leitor seguro recusando; a lista de `contracts/src/api/errors.ts` é a que a sonda imprimiu, comparada nos dois sentidos. O resto de door 7 (o par `(status, code)` de uma resposta tem de estar na entrada ou em `COMMON_ERRORS`) não muda.
- **C13 (rodada 1, dita na rodada 2).** O texto aprovado dizia 50 pares; a contagem certa era 48 (as 51 chaves da verificação contam `status null` repetidas) e o texto ganhou o `<unresolved>`; com `409 settings_newer` lançado de verdade (C46) são 49, fixados no teste, e o teste ganhou o sentido inverso (todo par próprio de uma entrada é lançado em algum lugar).
- **C18 (rodada 1, dita na rodada 2).** Acrescentou que o `Retry-After` do `429` está em todas as operações (afirmado em C17 e C18).
- **C35 (rodada 1, dita na rodada 2).** Acrescentou a exceção de `unknown errors → 500` dentro de "error envelope" (a rota de erro passa por `bindEntry`); a emenda é uma entrada de `AMENDMENTS` em `tests/sdk.api-thin.test.ts`.
- **C43 e C44 (rodada 2).** C43 trocou "só nas áreas que tocam arquivo" por "só nas rotas que a sonda de C45 prova"; C44 acrescentou que o objeto `API` de topo é congelado e que uma entrada de teste pertence a um servidor (C51).

## Criteria

### S1: Uma tabela de rotas é a fonte única (P1)

A API passa a ter um contrato por rota, e o servidor o usa para validar a entrada.

**Acceptance Criteria**

1. The package `@mordomo/contracts` SHALL export `API`, a table with one entry for each route the server registers under `/api` (127 today), each entry naming its `method`, `path`, access (`public`, or `scope` with the optional `queryToken` and `ticket` flags), `tag` and `summary`
2. Each entry of `API` SHALL carry a zod schema for every part of the request the route reads (`params`, `query`, `body`) and for the body of every success status it answers, or declare the status as a raw kind (`stream` or `binary` with its content type) when it answers no JSON
3. The server SHALL register every `/api` route through `bind`, which takes the method, path and access from the entry and hands the handler `params`, `query` and `body` already parsed by the entry's schemas
4. IF a request fails the schema of an entry THEN the API SHALL answer `400` with `error.code` `validation` and the zod `issues` in the envelope, and SHALL NOT run the handler
5. IF a route is registered under `/api` outside `bind`, or an entry of `API` is not bound once every route is registered, THEN `buildServer` SHALL throw before it listens
6. The return type of a handler passed to `bind` SHALL be the union of the success bodies of its entry, so a handler that returns another shape fails `tsc -b`
7. The access in `API` SHALL equal, route by route, the hand-written table `EXPECTED_ROUTE_SCOPES` and `PUBLIC_ROUTES` of `tests/helpers/routeScopes.ts`

**Independent test:** `npx vitest run tests/api.contract.test.ts -t "every route of the router has an entry"` lista as 127 rotas do roteador e as 127 chaves de `API` e as compara.

### S2: A resposta real é conferida contra a rota (P1)

Mudar uma resposta sem mudar o contrato reprova.

**Acceptance Criteria**

8. WHILE `validateResponses` is on, the API SHALL check each JSON response before it is sent: the status SHALL be one that the entry declares (a success status, an error of the entry or one of `COMMON_ERRORS`) and the body SHALL satisfy that status's schema with no key the schema does not name
9. IF a response fails that check THEN the API SHALL answer `500` with `error.code` `response_contract_violation` and the paths that differ, instead of the response the handler produced
10. WHILE `validateResponses` is off, the API SHALL send the handler's response without parsing it
11. The default of `validateResponses` SHALL be on when `NODE_ENV` is `test` or `development` or `MORDOMO_VALIDATE_RESPONSES` is `1`, and off otherwise (`MORDOMO_VALIDATE_RESPONSES=0` turns it off in test)
12. The API test suite SHALL call each route of `API` (a scenario per route, listed from the router and from the table) and check the real status and body of the response against its entry with `checkResponse`
13. IF a request carries a part that its entry's schema rejects THEN the API SHALL answer `400` `validation` for every route that declares that part (table-driven over the routes with `params`, `query` or `body`)
14. The `error.code` and status of every `httpError(…)` call in a route file SHALL appear among the `errors` of the entries registered by that file or in `COMMON_ERRORS`

**Independent test:** trocar o corpo de `GET /api/runs/:id` por um objeto com um campo a mais no handler faz `tests/api.contract.test.ts` falhar com `response_contract_violation`.

### S3: O OpenAPI é completo e válido (P1)

O documento descreve cada rota por inteiro e passa por um validador de OpenAPI de verdade.

**Acceptance Criteria**

15. WHEN `GET /api/v1/openapi.json` is called THEN the document SHALL describe every route of `API` with its path parameters, its query parameters, a `requestBody` schema where the entry has `body`, and a response schema for every success status (or the content type of a raw kind), generated from the schemas of the entry
16. The document SHALL validate as OpenAPI 3.1 under `@apidevtools/swagger-parser` (`validate`, with every `$ref` resolved)
17. Each operation SHALL list the error envelope for every `errors` entry of its route and for the `COMMON_ERRORS` that apply to it (`401` unless public, `403`, `429` for all, `400`, `413` and `415` where it has a body or a query, `500`), with the `error.code` values in the description
18. The document SHALL document `403`, `409`, `413`, `422` and `429` on the routes that answer them, with the codes introduced by `escopos-dispositivo` (`owner_only`, `scope_required`, `tls_required`, `self_approval`) and `dados-v2` (`restore_in_progress`, `restore_leftover`, `restore_recovery_failed`, `restore_lock_unusable`, `backup_invalid`, `backup_unsealed`)
19. The document SHALL carry no `x-` key other than `x-mordomo-scope`
20. IF an entry of `API` has no success schema and no raw kind THEN the generator SHALL throw, naming the route
21. WHEN the real response of a scenario is checked against the JSON Schema that the document holds for its route and status THEN it SHALL validate

**Independent test:** `npx vitest run tests/api.openapi.test.ts -t "the document validates"` imprime zero erros do `swagger-parser`.

### S4: Eventos versionados por tipo (P1)

Cada tipo de evento tem versão, schema e uma política de evolução que o cliente segue.

**Acceptance Criteria**

22. The package SHALL export `OS_EVENT_TYPES` (the 23 types of the bus) and `EVENT_VERSIONS`, which lists for each type the versions it has had (`[1]` for all today), and the current version of a type SHALL be its last
23. The contract SHALL hold a payload schema for each type and version, and the envelope `{ id, type, ts, v, payload }` SHALL be a union discriminated by `type` and `v`
24. The stream of a run SHALL send `v: 1` on each of its frames, and the contract SHALL hold a schema for each of the 9 run-event types and the final `run_state`
25. WHEN a client receives an event whose `type` is not in `OS_EVENT_TYPES`, or whose `v` is above the highest version it knows for that type, THEN `classifyEvent` SHALL return `unknown_type` or `unsupported_version` without throwing, and the client SHALL drop the event and keep the stream open
26. WHEN an event of a known type and version carries a field its schema does not name (in the envelope or in the payload) THEN the reader SHALL accept it
27. The fixtures of version 1 (one per event type and one per run frame type) SHALL parse under the schema of version 1, and the test SHALL fail if a schema change makes one stop parsing
28. WHEN the bus emits an event during the test suite THEN the event SHALL satisfy the schema of its type and version
29. The file `docs/events.md` SHALL list each event type with its versions and payload fields and state the evolution policy (a field added keeps `v`; an incompatible change adds `v + 1`; a client ignores a type or version it does not know), and the test SHALL fail when the file differs from the text generated from the schemas

**Independent test:** `npx vitest run tests/events.contract.test.ts -t "a future version is ignored"` passa um quadro `{"type":"run.created","v":2,…}` e `{"type":"x.y","v":1}` por `classifyEvent`.

### S5: A interface usa o contrato (P1)

As chamadas às rotas cobertas ganham os tipos do contrato.

**Acceptance Criteria**

30. The Command Centre SHALL call the migrated routes through `apiCall("<METHOD> <path>", input)`, whose parameters, query, body and result types come from `API`, so a call that names a route that does not exist, or passes a body or reads a field the entry does not have, fails `tsc`
31. The Command Centre SHALL import `API` as a type only, and the built bundle SHALL NOT contain `ZodError` nor the text of any schema of `API`
32. WHEN the events feed or a run stream delivers a frame that `classifyEvent` rejects THEN `api.streamEvents` and `api.streamRun` SHALL NOT call `onEvent` and SHALL NOT close the stream
33. The routes not migrated SHALL be listed with the reason, in `.specs/features/contratos-rest/checks.md` and in a test that fails when an `api.get`/`api.post` call names a route that is neither migrated nor on the list

**Independent test:** `npm run typecheck` com uma chamada `apiCall("GET /api/runs/:id", { params: { id: 1 } })` acrescentada falha.

### S6: Compatibilidade (P1)

Nada do que já funcionava muda de comportamento.

**Acceptance Criteria**

34. The API SHALL answer `/api/<rest>` (unversioned) exactly as `/api/v1/<rest>` with the headers `Deprecation: true` and `Link: </api/v1/<rest>>; rel="successor-version"`, for the 127 routes
35. The API SHALL answer every status `>= 400` with the single envelope `{ error: { code, message, issues? }, message }`, and the existing suites for the envelope, the scopes, the device rules and the restore codes SHALL pass unchanged
36. The runtime exports of `@mordomo/contracts` SHALL equal, with `toEqual`, a pinned list, and its `exports` SHALL be exactly `.`, `./policy` and `./events`, none of the last two reaching a module outside `contracts/src` nor `zod`

**Independent test:** `npx vitest run tests/api.v1.test.ts tests/device-scopes.test.ts` segue verde.

## Out of scope

| Excluded                                                                           | Why                                                                                                                               |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Validar respostas em produção por padrão                                           | custo de um `parse` por resposta; fica ligável por `MORDOMO_VALIDATE_RESPONSES=1`, o dono decide (STATE, Perguntas ao dono)       |
| Validar respostas com zod no navegador                                             | o contrato permite; custa bundle (mesmo motivo registrado em `contratos`); a interface usa só os tipos                            |
| Migrar as 113 chamadas da interface de uma vez                                     | a migração é incremental (AC 33); o que fica de fora está listado com o motivo em `checks.md`                                     |
| Gerar SDK/cliente para terceiros a partir do OpenAPI e publicar o pacote           | é a feature `sdk-core` (S4) e depende da licença (feature 15)                                                                     |
| Schemas dos eventos que os CLIs emitem (`ClaudeStreamMessage`, `CodexStreamEvent`) | já são contrato de `adaptadores-tipados`; não atravessam a API                                                                    |
| Mudar o corpo, o status ou o código de erro de qualquer rota existente             | a feature descreve e confere o que há; um corpo que o contrato obrigaria a mudar é achado, não escopo (registrado em `checks.md`) |
| Paginação por cursor, ETag, `Retry-After` novo, qualquer limite de taxa novo       | outras features; o limite de `429` que existe fica documentado, não alterado                                                      |
| Webhooks de saída e WebSocket                                                      | a API não tem                                                                                                                     |

## Assumptions

| Assumption                                                        | Chosen default                                                                                                                                                   | Rationale                                                                                                                                                                      | Confirmed? |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| Onde `validateResponses` liga sozinho                             | em `NODE_ENV` `test` ou `development`, ou por `MORDOMO_VALIDATE_RESPONSES=1`; desligado no serviço instalado (que não define `NODE_ENV`)                         | o `parse` por resposta custa; "desenvolvimento ou teste, configurável" é o pedido; ligar em produção é uma decisão do dono                                                     | n          |
| Chaves a mais na resposta                                         | a conferência de teste reprova chave que o schema não nomeia (compara o `parse` com o corpo); os schemas do contrato seguem tolerantes (`z.object` sem `strict`) | mudar uma resposta sem mudar o contrato tem de reprovar, e um cliente que lê o schema não pode quebrar com um campo aditivo (AC 26)                                            | n          |
| Chaves a mais na requisição                                       | seguem ignoradas, como hoje (`z.object` apaga a chave)                                                                                                           | o código de erro e o comportamento existentes não mudam (AC 35); recusar mudaria o que clientes antigos mandam                                                                 | n          |
| `x-mordomo-scope`                                                 | fica; é a única extensão `x-`                                                                                                                                    | o escopo de dispositivo (`monitor`, `content`, `run`, `approve`) não cabe em `security` padrão sem uma segunda grafia; as checagens de `api-v1` e `escopos-dispositivo` o leem | n          |
| Um corpo que o contrato obrigaria a mudar                         | o schema descreve o que o handler devolve hoje; a divergência vira nota em `checks.md`, não mudança de rota                                                      | "códigos de erro e envelope inalterados"; a feature não muda comportamento                                                                                                     | n          |
| Campos de forma aberta (mapas de usuário, `payload` de aprovação) | `z.record(z.unknown())`, listados em `checks.md` com o motivo                                                                                                    | o conteúdo é de quem escreve (o agente, o dono), não do servidor                                                                                                               | n          |
| `v` nos quadros da execução                                       | acrescentado no envio; o evento gravado em `run_events` não muda                                                                                                 | campo aditivo que a interface ignora; é o mínimo para os 10 formatos poderem evoluir                                                                                           | n          |
| Cliente que recebe `v` maior que a que conhece                    | ignora o evento (não o lê pela versão velha)                                                                                                                     | ler pela versão velha repete a falha que a política existe para evitar (campo mudou de sentido)                                                                                | n          |

**Open questions:** none - all resolved or logged above.

## Observable

| Surface                           | Decision                                    | Landing                                                                                                    |
| --------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| all `/api/v1/*` routes            | response shape                              | AC 2, AC 8, AC 12                                                                                          |
| all `/api/v1/*` routes            | error shape and codes                       | AC 14, AC 17, AC 18, AC 35 (door 7)                                                                        |
| all `/api/v1/*` routes            | who may call it                             | AC 1, AC 7 (existing - o gate `onRequest` e `escopos-dispositivo` não mudam)                               |
| all `/api/v1/*` routes            | versioning                                  | AC 34 (existing - `api-v1`, door 1 dela)                                                                   |
| all `/api/v1/*` routes            | rate limit                                  | AC 17 (o `429` que existe fica documentado); n/a - nenhum limite novo                                      |
| API `GET /api/v1/openapi.json`    | response shape                              | AC 15, AC 16, AC 19                                                                                        |
| API `GET /api/v1/openapi.json`    | error shape and codes                       | AC 17 (`401`, `403`, `429`)                                                                                |
| API `GET /api/v1/runs/:id/stream` | response shape                              | AC 24                                                                                                      |
| API `GET /api/v1/runs/:id/stream` | versioning                                  | AC 24, AC 25 (door 5)                                                                                      |
| API `GET /api/v1/events`          | versioning                                  | AC 22, AC 23, AC 25, AC 26 (door 4)                                                                        |
| package `@mordomo/contracts`      | what a consumer imports                     | AC 1, AC 36 (door 1, door 3)                                                                               |
| package `@mordomo/contracts`      | versioning                                  | n/a - privado e na versão do monorepo até a feature 15 (a versão de evento é AC 22)                        |
| document `docs/events.md`         | structure, depth, what the reader does next | AC 29                                                                                                      |
| screen `Command Centre` (cliente) | error state                                 | existing - o `request()` de `api.ts` já traduz o envelope em `ApiError`; AC 32 cobre o quadro desconhecido |
| screen `Command Centre` (cliente) | empty, loading, unauthorised states         | n/a - nenhuma tela muda: só os tipos das chamadas e o descarte de um quadro desconhecido                   |

## Sources

- `.specs/roadmap.md` S5 (`contratos-rest`, revisão de arquitetura de 07/10/2026) - o escopo: corpos no contrato, OpenAPI com schemas, versão por tipo de evento
- `.specs/features/contratos/plan.md` (door 2 e "Out of scope") e `.specs/features/api-v1/plan.md` (doors 1, 2 e 3), `escopos-dispositivo` (doors 2, 5, 6): o que já está fixado e que esta feature descreve sem mudar
