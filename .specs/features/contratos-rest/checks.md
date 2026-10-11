# Contratos REST checks

Profile: standard
Plan: `.specs/features/contratos-rest/plan.md`

39 checks in 6 slices · 9 one-way doors · 0 open, of which 0 block

Comandos (da raiz do repositório):

- unit/API: `npx vitest run <arquivo> -t "<nome>"` (`vitest.config.ts` já tem o alias `@mordomo/contracts`; este plano acrescenta `@mordomo/contracts/events`)
- tipos: `npx tsc -p typetests/tsconfig.json` (`typetests/rest.ts` e `typetests/events.ts`; compila contra os `.d.ts` construídos, depois de `npm run build:server`)
- interface: `npm run test -w apps/command-centre -- <arquivo> -t "<nome>"` e `npm run build -w apps/command-centre`
- build: `npm run build`, `npm run typecheck`, `npm run lint`

Arquivos de teste novos: `tests/contracts.api.test.ts` (a tabela e `checkResponse`, sem servidor), `tests/api.contract.test.ts` (o servidor), `tests/api.openapi.test.ts` (o documento), `tests/events.contract.test.ts` (eventos), `apps/command-centre/src/api.call.test.ts`, `apps/command-centre/src/api.calls.test.ts`.

Cada rota da API tem um cenário em `tests/api.contract.test.ts` (`SCENARIOS`, chaveado pela mesma `METHOD path` do roteador); os cenários listam o que a rota precisa para responder com sucesso (um semeador de `AppContext` com execução, aprovação, skill, rotina, objetivo, conector, dispositivo e backup) e um valor inválido por parte.

## Checks

### S1 - a tabela de rotas e o registro · 22 files · 360 KB · ~90k

**C1** - O conjunto `METHOD path` das rotas que o servidor registra (`app.apiRoutes`: 127) é igual, nos dois sentidos, ao das entradas de `API` (127, cada chave `<domínio>.<ação>` única, cada uma com `summary` e `tag` não vazios) (AC 1)
Proof: `npx vitest run tests/api.contract.test.ts -t "C1 every route of the router has an entry"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C2** - Cada entrada de `API` declara pelo menos um status de sucesso; cada status de sucesso é um schema zod ou um tipo cru (`stream` com `text/event-stream`: `GET /api/events` e `GET /api/runs/:id/stream`; `binary` com os tipos de conteúdo: `GET /api/artifacts/raw` e `GET /api/skills/:slug/resource`), e cada `params`, `query` e `body` declarado é um schema zod (AC 2)
Proof: `npx vitest run tests/contracts.api.test.ts -t "C2 every entry has a schema or a raw kind for each success status"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C3** - O acesso de cada entrada é o da tabela escrita à mão: `scope` igual ao de `EXPECTED_ROUTE_SCOPES` (owner 63, monitor 33, content 22, run 6, approve 1), `public` só em `GET /api/meta` e `POST /api/pair/claim`, `queryToken` só nas quatro rotas de arquivo e de fluxo (`GET /api/events`, `GET /api/runs/:id/stream`, `GET /api/artifacts/raw`, `GET /api/skills/:slug/resource`) e `ticket` só nas duas de fluxo; o `config` que o Fastify guarda de cada rota é o da entrada (AC 7)
Proof: `npx vitest run tests/api.contract.test.ts -t "C3 the access in the table equals the hand-written scope table"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C4** - `bind` entrega ao handler `params`, `query` e `body` já passados pelos schemas da entrada: um número que chega como texto na query vira número, um campo com padrão chega preenchido, uma chave desconhecida do corpo é apagada, e a rota que declara corpo opcional recebe `{}` quando nada foi enviado (AC 3)
Proof: `npx vitest run tests/api.contract.test.ts -t "C4 bind hands the handler parsed params, query and body"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C5** - Para cada rota cujas `params`, `query` ou `body` rejeitam algum valor, uma requisição com um valor que o schema rejeita responde `400` com `error.code` `validation` e `error.issues` não vazio, e o handler não roda (nenhum efeito: a contagem de chamadas do handler não muda); as rotas cujo schema aceita todo valor candidato estão numa lista explícita do teste (AC 4, AC 13)
Proof: `npx vitest run tests/api.contract.test.ts -t "C5 every part an entry declares is validated before the handler runs"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C6** - `app.get("/api/zz", …)` (e as quatro outras formas de método) registrada fora de `bind` lança no `onRoute` com `declares no contract`; `bind` com um id fora da tabela lança; e `buildServer` com uma entrada de `API` que nenhuma rota ligou lança antes de ouvir, nomeando a entrada (AC 5)
Proof: `npx vitest run tests/api.contract.test.ts -t "C6 a route outside bind and an unbound entry stop the server"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C7** - Um handler passado a `bind("runs.get", …)` que devolve um objeto sem um campo obrigatório ou com o tipo errado não compila (`// @ts-expect-error` em `typetests/rest.ts`), e um que devolve o corpo certo, ou um dos dois corpos de uma rota com `200` e `202`, compila (AC 6)
Amendment (while building): o texto aprovado dizia "um objeto com um campo a mais, sem um campo obrigatório ou com o tipo errado não compila". O TypeScript não recusa chave a mais no retorno de uma função `async` (subtipagem estrutural; a checagem de propriedade em excesso só vale para um literal atribuído direto), e `typetests/rest.ts` fixa isso (`extra` compila, sem `@ts-expect-error`). O campo a mais é reprovado em tempo de teste por `checkResponse` com `validateResponses` ligado (C9, padrão nos testes). Registrado em STATE, Perguntas ao dono, contratos-rest, item 2.
Proof: `npx tsc -p typetests/tsconfig.json`
Status: built (proof green at the build commit; not yet verified by someone else)

**C8** - Os schemas de entidade do fio (`RunRecord`, `RunEvent`, `RunUsage`, `Approval`, `NotificationRecord`, `SessionRecord`, `ProviderCapabilities`, `MetricsSample`, `DeviceRecord`, `Settings`) inferem tipos mutuamente atribuíveis aos tipos que o contrato já exporta (`typetests/rest.ts`), então o schema não pode divergir do tipo que o core usa (AC 2)
Proof: `npx tsc -p typetests/tsconfig.json`
Status: built (proof green at the build commit; not yet verified by someone else)

### S2 - a resposta real é conferida · 9 files · 120 KB · ~30k

**C9** - `checkResponse(entry, status, body)` devolve problemas para cada um dos seis modos de falha e nenhum para o corpo certo: uma chave que o schema não nomeia (`$.run.extra`), uma chave que falta, um tipo errado, um status de sucesso que a entrada não declara (`201` onde só há `200`), um par `(status, code)` de erro que nem a entrada nem `COMMON_ERRORS` declaram, e um corpo de erro que não é o envelope; e o servidor com `validateResponses` ligado troca cada um por `500` `response_contract_violation` com os caminhos que diferem (AC 8, AC 9)
Proof: `npx vitest run tests/api.contract.test.ts -t "C9 a response that departs from its entry is replaced by response_contract_violation"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C10** - Com `validateResponses` desligado o servidor envia o corpo que o handler produziu mesmo quando ele não casa com a entrada (um schema com `safeParse` espiado conta zero chamadas) (AC 10)
Proof: `npx vitest run tests/api.contract.test.ts -t "C10 with validateResponses off the response is sent as the handler made it"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C11** - `validateResponses` liga com `NODE_ENV=test`, com `NODE_ENV=development` e com `MORDOMO_VALIDATE_RESPONSES=1` (também com `NODE_ENV=production`), e desliga com `NODE_ENV=production`, com nenhuma variável (o serviço instalado) e com `MORDOMO_VALIDATE_RESPONSES=0` (também com `NODE_ENV=test`) (AC 11)
Proof: `npx vitest run tests/api.contract.test.ts -t "C11 validateResponses defaults"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C12** - Para cada uma das 127 rotas, a lista de cenários tem uma chave igual à do roteador e à da tabela, e a requisição real do cenário responde um status de sucesso que a entrada declara com um corpo que `checkResponse` aceita (as duas rotas de fluxo, lidas por `listen` e abortadas depois do primeiro quadro, e as duas de arquivo, pelos cabeçalhos e pelo tipo de conteúdo) (AC 12)
Proof: `npx vitest run tests/api.contract.test.ts -t "C12 every route answers what its entry declares"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C13** - Todo par `(status, code)` de erro que o código sob `apps/api/src` e `core/src` pode lançar (as chamadas `httpError(status, msg, code)`, os objetos com `statusCode` e `code`, as classes com `readonly statusCode`; 50 pares quando o plano foi escrito) está em `errors` de alguma entrada ou em `COMMON_ERRORS`, e cada par de `httpError` de um arquivo de rotas está nos `errors` das entradas que aquele arquivo registra ou em `COMMON_ERRORS` (a leitura é feita na árvore sintática, com autoteste de cada forma que ela cobre e de cada falso positivo que ela não pode apontar) (AC 14)
Proof: `npx vitest run tests/api.contract.test.ts -t "C13 every error a handler raises is documented"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C14** - Uma violação de contrato é registrada em `logs/api.jsonl` com o id da rota, o método, o status e os caminhos que diferem, e o corpo de erro não traz caminho do disco nem dado do corpo recusado (AC 9)
Proof: `npx vitest run tests/api.contract.test.ts -t "C14 a violation is logged without the body"`
Status: built (proof green at the build commit; not yet verified by someone else)

### S3 - o documento OpenAPI · 4 files · 70 KB · ~18k

**C15** - Para cada uma das 127 operações, os parâmetros de caminho do documento são os `:nome` do caminho, os de query incluem cada chave de `query` da entrada (com `required` conforme o schema), há `requestBody` com `content.application/json.schema` se e só se a entrada declara `body`, e cada status de sucesso tem `content.<tipo>.schema` (JSON) ou o tipo de conteúdo do tipo cru (AC 15)
Proof: `npx vitest run tests/api.openapi.test.ts -t "C15 every route has parameters, request body and a response schema"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C16** - `SwaggerParser.validate` sobre o documento serializado (cópia, para o `$ref` resolvido) termina sem erro, e `openapi` vale `3.1.0` (AC 16)
Proof: `npx vitest run tests/api.openapi.test.ts -t "C16 the document validates as OpenAPI 3.1"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C17** - Cada operação tem, para cada `errors` da entrada e para cada `COMMON_ERRORS` que se aplica a ela (`401` se não é pública, `403`, `429` e `500` em todas, `400`, `413` e `415` onde há corpo, `400` onde há `params` ou `query`), uma resposta com o schema do envelope, e a descrição lista cada `error.code` daquele status; a descrição do `409` de `POST /api/backups` continua casando `restore_in_progress.*restore_leftover.*restore_recovery_failed.*restore_lock_unusable` (AC 17)
Proof: `npx vitest run tests/api.openapi.test.ts -t "C17 each operation lists the error envelope for its errors"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C18** - O documento traz os dez pares nomeados no AC 18: `403 owner_only`, `403 scope_required`, `403 tls_required`, `403 self_approval`, `409 restore_in_progress`, `409 restore_leftover`, `409 restore_recovery_failed`, `409 restore_lock_unusable`, `422 backup_invalid` e `422 backup_unsealed`, cada um nas operações que os respondem, e o `413` (corpo grande e arquivo grande) e o `429` (`too_many_requests`, com o cabeçalho `Retry-After`) (AC 18)
Proof: `npx vitest run tests/api.openapi.test.ts -t "C18 the 403, 409, 413, 422 and 429 of the earlier features are documented"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C19** - Toda chave que começa por `x-` no documento, em qualquer profundidade, é `x-mordomo-scope`, e cada operação não pública a tem com o escopo da entrada (AC 19)
Proof: `npx vitest run tests/api.openapi.test.ts -t "C19 x-mordomo-scope is the only extension"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C20** - O gerador lança, nomeando a rota, para uma entrada sem `responses`, com só status de erro, com um sucesso que não é schema nem tipo cru, e com um schema que o conversor não sabe exprimir (um `z.function()`) (AC 20)
Proof: `npx vitest run tests/api.openapi.test.ts -t "C20 a route without a success schema is refused"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C21** - O corpo real de cada cenário de C12 valida (Ajv, JSON Schema 2020-12) contra o schema que o documento guarda para a sua rota e status de sucesso (AC 21)
Proof: `npx vitest run tests/api.openapi.test.ts -t "C21 a real response satisfies the schema of the document"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C39** - Os nomes de `components.schemas` do documento são, com `toEqual`, a lista fixada do teste (os 21 de `NAMED_SCHEMAS`: `Error`, `Run`, `RunSummary`, `RunEvent`, `RunUsage`, `Approval`, `Notification`, `Session`, `ProviderCapabilities`, `Settings`, `UiPreferences`, `Skill`, `Routine`, `RoutineStatus`, `Connector`, `ConnectorData`, `Device`, `BackupInfo`, `MetricsSample`, `Fact`, `DoctorReport`), cada um é apontado por um `$ref` do documento e todo `$ref` aponta para um deles (door 8, acrescentada durante a construção)
Proof: `npx vitest run tests/api.openapi.test.ts -t "C39 the component names of the document are the ones fixed"`
Status: built (proof green at the build commit; not yet verified by someone else)

### S4 - eventos versionados por tipo · 14 files · 150 KB · ~38k

**C22** - `OS_EVENT_TYPES` tem os 23 tipos do barramento (as chaves de `OsEventMap`, nos dois sentidos), `EVENT_VERSIONS` tem uma lista por tipo que começa em `1` e é contígua (hoje `[1]` nos 23), `currentEventVersion(type)` é o último da lista, e o `emit` do barramento carimba essa versão (AC 22)
Proof: `npx vitest run tests/events.contract.test.ts -t "C22 every event type has a version list"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C23** - Existe um schema de envelope por `(tipo, versão)` e a união é discriminada por `type` e `v`: um evento de cada um dos 23 tipos em `v: 1` valida; `type: "run.created"` com o payload de `run.finished` não valida; `v: 2` num tipo que só tem a versão 1 não valida contra a união (AC 23)
Proof: `npx vitest run tests/events.contract.test.ts -t "C23 the envelope is a union discriminated by type and v"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C24** - O quadro de cada um dos 9 tipos de evento de execução (`started`, `text`, `assistant`, `tool_use`, `permission`, `session`, `result`, `error`, `usage`) e o `run_state` final tem schema em `v: 1`, e o SSE real de uma execução envia `"v":1` em todos os quadros, inclusive o `run_state`, enquanto a linha gravada em `run_events` não ganha `v` (AC 24)
Proof: `npx vitest run tests/events.contract.test.ts -t "C24 run frames have a schema and the stream sends v"`
Proof: `npx vitest run tests/api.contract.test.ts -t "C24 the run stream sends v on every frame"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C25** - `classifyEvent` devolve `unknown_type` para um `type` fora de `OS_EVENT_TYPES` (`x.y`, `""`, número), `unsupported_version` para `v` acima da maior conhecida do tipo (`run.created` com `v: 2`) e `known` para `v` na lista; devolve `unknown_type` ou `unsupported_version` sem lançar para `null`, texto, lista, `v` ausente, `v` não inteiro e `v: 0`; e `GET /api/events` reaberto depois dele segue entregando (AC 25)
Proof: `npx vitest run tests/events.contract.test.ts -t "C25 a future version or an unknown type is dropped"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C26** - Um evento de tipo e versão conhecidos com uma chave a mais no envelope e uma chave a mais no payload valida, em cada um dos 23 tipos (AC 26)
Proof: `npx vitest run tests/events.contract.test.ts -t "C26 an extra field is accepted"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C27** - Os arquivos `tests/fixtures/events/v1/<tipo>.json` (23) e `tests/fixtures/events/v1/run-frames/<tipo>.json` (10) são congelados: o conjunto de nomes é igual ao de `OS_EVENT_TYPES` e ao dos tipos de quadro, cada um valida em `v: 1`, e para toda versão de `EVENT_VERSIONS` existe um diretório de fixtures, então tirar o schema da `v1` ou torná-la incompatível reprova (AC 27)
Proof: `npx vitest run tests/events.contract.test.ts -t "C27 the v1 fixtures keep parsing"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C28** - Todo evento que o barramento emite durante uma suíte inteira (um guarda carregado por `setupFiles` assina o barramento e falha o teste que o emitiu) valida contra o schema do seu tipo e versão; um teste emite os 23 tipos pelos emissores reais (execução, aprovação, rotina, indexação, configurações, backup, notificação, orçamento, sentinela, sessão, objetivo) e confere (AC 28)
Proof: `npx vitest run tests/events.contract.test.ts -t "C28 the bus emissions satisfy their schema"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C29** - `docs/events.md` é igual ao texto gerado dos schemas (cada tipo com versões e campos do payload, os 10 quadros de execução), contém as três regras da política (campo aditivo mantém `v`; mudança incompatível soma `v + 1`; o cliente ignora tipo ou versão desconhecidos) e o teste reprova quando o arquivo difere (AC 29)
Proof: `npx vitest run tests/events.contract.test.ts -t "C29 docs/events.md equals the generated text"`
Status: built (proof green at the build commit; not yet verified by someone else)

### S5 - a interface · 30 files · 200 KB · ~50k

**C30** - `apiCall("GET /api/runs/:id", { params: { id: 1 } })`, `apiCall("GET /api/nao-existe")`, `apiCall("POST /api/runs/:id/cancel", { params: { id }, body: { x: 1 } })` e a leitura de um campo que a resposta não tem não compilam (`// @ts-expect-error` em `typetests/rest.ts`, sobre os tipos `ApiCallInput<K>` e `ApiCallResult<K>` do contrato); `apiCall` monta a URL `/api/v1/…` com os parâmetros codificados e a query serializada, e manda o corpo JSON, nas chamadas migradas (AC 30)
Proof: `npx tsc -p typetests/tsconfig.json`
Proof: `npm run test -w apps/command-centre -- src/api.call.test.ts -t "C30 apiCall builds the request from the route"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C31** - A interface importa `API` só como tipo (`import type`), e nenhum arquivo de `apps/command-centre/dist/assets` contém `ZodError`, `ZodObject` nem `invalid_type` (AC 31)
Proof: `npm run build -w apps/command-centre && ! grep -rlE "ZodError|ZodObject|invalid_type" apps/command-centre/dist/assets`
Status: built (proof green at the build commit; not yet verified by someone else)

**C32** - `api.streamEvents` e `api.streamRun` não chamam `onEvent` para um quadro que `classifyEvent` rejeita (tipo desconhecido, versão futura, JSON que não é objeto) e seguem entregando o quadro seguinte, sem fechar o `EventSource` (AC 32)
Proof: `npm run test -w apps/command-centre -- src/api.test.ts -t "C32 a frame of an unknown type or a future version is dropped"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C33** - Cada uma das 113 chamadas `api.get/post/put/patch/del` que existiam ao escrever o plano está em `apiCall` ou numa lista do teste com a rota e o motivo, e o teste reprova uma chamada nova que não é nem uma nem outra (leitura na árvore sintática, com autoteste de cada forma de URL: literal, template com `encodeURIComponent`, variável) (AC 33)
Proof: `npm run test -w apps/command-centre -- src/api.calls.test.ts -t "C33 every call is migrated or listed with a reason"`
Status: built (proof green at the build commit; not yet verified by someone else)

### S6 - compatibilidade · 6 files · 40 KB · ~10k

**C34** - Para cada uma das 127 rotas, `/api/<resto>` e `/api/v1/<resto>` respondem o mesmo status e o mesmo corpo de erro a uma requisição sem credencial (`401`; as públicas: `200` em `GET /api/meta` e `400` `validation` em `POST /api/pair/claim`), só o apelido traz `Deprecation: true` e `Link: </api/v1/<resto>>; rel="successor-version"`, e as rotas `GET` com cenário respondem o mesmo status nas duas grafias (AC 34)
Proof: `npx vitest run tests/api.contract.test.ts -t "C34 the unversioned alias answers as v1"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C35** - O envelope de erro, a tabela de escopos, o documento de rotas e os códigos de restauração das features anteriores seguem passando sem alteração do teste: `tests/api.hardening.test.ts` ("error envelope"), `tests/api.v1.test.ts` (C20, C21), `tests/device-scopes.test.ts` (C3) e `tests/data.restore-lock.test.ts` (C90) (AC 35)
Proof: `npx vitest run tests/api.hardening.test.ts -t "error envelope"`
Proof: `npx vitest run tests/api.v1.test.ts -t "C20 the document lists every route"`
Proof: `npx vitest run tests/api.v1.test.ts -t "C21 each operation carries its scope"`
Proof: `npx vitest run tests/device-scopes.test.ts -t "C3 the route table is the expected one"`
Proof: `npx vitest run tests/data.restore-lock.test.ts -t "C90 the API answers 409 with a code"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C36** - Os exports de tempo de execução de `@mordomo/contracts` são, com `toEqual`, a lista fixada do teste (a lista atual mais `API`, `checkResponse`, `COMMON_ERRORS`, `ErrorEnvelope`, `EVENT_SCHEMAS`, `OsEventSchema`, `RunFrameSchema`, `readOsEvent` e os de `./events`), o `exports` do `package.json` é exatamente `.`, `./policy` e `./events` com as formas do `Landing`, e seguindo cada `import`/`export … from` de valor a partir de `contracts/src/policy.ts` e de `contracts/src/eventRegistry.ts` nenhum módulo fora de `contracts/src` é alcançado (zod fica fora dos dois) (AC 36)
Proof: `npx vitest run tests/contracts.test.ts -t "C41 the device pieces are the only new exports"`
Proof: `npx vitest run tests/contracts.test.ts -t "C16 the contracts package publishes exactly three entry points"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C37** - `zod-to-json-schema` está em `apps/api/package.json` e `@apidevtools/swagger-parser` e `ajv` em `package.json` da raiz, com versão exata (sem `^`, `~`, `>=`), e `contracts/package.json` segue com `dependencies` igual a `{ "zod": … }` (Landing, door 6)
Proof: `npx vitest run tests/contracts.api.test.ts -t "C37 the new dependencies are pinned exactly"`
Status: built (proof green at the build commit; not yet verified by someone else)

**C38** - Os schemas do contrato aceitam um corpo com uma chave a mais (um cliente não quebra com um campo aditivo) e `checkResponse` reprova o mesmo corpo, para as respostas de `runs.get`, `approvals.get` e `settings.get`; e uma requisição com uma chave a mais no corpo de `POST /api/runs` segue aceita como antes; e a lista `OPEN_FIELDS` do teste (um campo aberto por linha, com o motivo) é igual, com `toEqual`, aos `z.unknown()`, `z.record(z.unknown())` e `z.any()` que a leitura da árvore sintática dos schemas de `contracts/src/api` encontra (Assumptions: chaves a mais e campos de forma aberta) (AC 35)
Proof: `npx vitest run tests/contracts.api.test.ts -t "C38 schemas are tolerant and the checker is not"`
Status: built (proof green at the build commit; not yet verified by someone else)

## Coverage

| Set (size)                                                         | Member -> proof                                                                                                                                                                                                                                                                              | Unproven |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| rotas `/api` (127)                                                 | tabela C1, table-driven over all 127 · cenário real C12, table-driven over all 127 · documento C15, table-driven over all 127 · resposta no documento C21, table-driven over all 127 · apelido sem versão C34, table-driven over all 127                                                     | -        |
| acessos (6)                                                        | `owner` (63) C3 · `monitor` (33) C3 · `content` (22) C3 · `run` (6) C3 · `approve` (1) C3 · `public` (2) C3                                                                                                                                                                                  | -        |
| flags de acesso (2)                                                | `queryToken` (4 rotas) C3 · `ticket` (2 rotas) C3                                                                                                                                                                                                                                            | -        |
| tipos crus de resposta (2)                                         | `stream` (2 rotas) C12 · `binary` (2 rotas) C12                                                                                                                                                                                                                                              | -        |
| partes da requisição que um schema valida (3)                      | `params` C5 · `query` C5 · `body` C5                                                                                                                                                                                                                                                         | -        |
| modos de falha da conferência de resposta (6)                      | chave a mais C9 · chave que falta C9 · tipo errado C9 · status de sucesso não declarado C9 · par `(status, code)` não declarado C9 · corpo de erro fora do envelope C9                                                                                                                       | -        |
| combinações de `validateResponses` (6)                             | `test` C11 · `development` C11 · `MORDOMO_VALIDATE_RESPONSES=1` C11 · `production` C11 · nenhuma variável C11 · `MORDOMO_VALIDATE_RESPONSES=0` C11                                                                                                                                           | -        |
| startup config: `validateResponses` (2 assemblies)                 | `buildServer`, montagem dos testes C9 · `startServer`, o serviço instalado sem `NODE_ENV` C11                                                                                                                                                                                                | -        |
| startup config: o alias `@mordomo/contracts/events` (3 assemblies) | `tsc -b` (build) C22 · `vitest.config.ts` (testes) C25 · Vite (interface) C31                                                                                                                                                                                                                | -        |
| status de erro documentados (12)                                   | `400` C17 · `401` C17 · `403` C18 · `404` C17 · `409` C18 · `413` C18 · `415` C17 · `422` C18 · `429` C18 · `500` C17 · `502` C17 · `503` C17                                                                                                                                                | -        |
| pares `(status, code)` nomeados no AC 18 (10)                      | `403 owner_only` C18 · `403 scope_required` C18 · `403 tls_required` C18 · `403 self_approval` C18 · `409 restore_in_progress` C18 · `409 restore_leftover` C18 · `409 restore_recovery_failed` C18 · `409 restore_lock_unusable` C18 · `422 backup_invalid` C18 · `422 backup_unsealed` C18 | -        |
| pares `(status, code)` que o código pode lançar (50)               | C13, table-driven over all 50 (a leitura da árvore enumera os pares e confere cada um)                                                                                                                                                                                                       | -        |
| tipos de evento do barramento (23)                                 | versões C22, table-driven over all 23 · envelope C23, table-driven over all 23 · chave a mais C26, table-driven over all 23 · fixtures C27, table-driven over all 23 · emissão real C28, table-driven over all 23 · documento C29, table-driven over all 23                                  | -        |
| tipos de quadro da execução (10)                                   | `started` C24 · `text` C24 · `assistant` C24 · `tool_use` C24 · `permission` C24 · `session` C24 · `result` C24 · `error` C24 · `usage` C24 · `run_state` C24                                                                                                                                | -        |
| resultados de `classifyEvent` (3)                                  | `known` C25 · `unknown_type` C25 · `unsupported_version` C25                                                                                                                                                                                                                                 | -        |
| entradas inválidas de `classifyEvent` (7)                          | tipo desconhecido C25 · `v` acima da maior C25 · `null` C25 · texto C25 · lista C25 · `v` ausente C25 · `v: 0` C25                                                                                                                                                                           | -        |
| `GET /api/v1/openapi.json` (4 statuses)                            | `200` C16 · `401` C17 · `403` C17 · `429` C17                                                                                                                                                                                                                                                | -        |
| `GET /api/v1/runs/:id/stream` (5 statuses)                         | `200` C24 · `401` C34 · `403` C17 · `404` C17 · `429` C17                                                                                                                                                                                                                                    | -        |
| `500 response_contract_violation` em qualquer rota (1)             | C9                                                                                                                                                                                                                                                                                           | -        |
| chamadas da interface (113)                                        | C33, table-driven over all 113                                                                                                                                                                                                                                                               | -        |
| doors (9)                                                          | 1 tabela C1, C2, C3, C36 · 2 `bind` C4, C6, C7 · 3 subcaminho `./events` C25, C36 · 4 versão por tipo C22, C23, C26, C27 · 5 `v` nos quadros C24 · 6 dependências C37 · 7 erros na entrada C13, C17, C18 · 8 nomes dos componentes C39 · 9 forma de chamada da interface C30, C33            | -        |

- Claims naming a status code, route or response shape: C1, C3, C5, C9, C12, C15, C17, C18, C21, C24, C34 - cada um tem uma prova que cruza a fronteira (requisição real ao servidor, `inject` ou `listen`)
- O que um cenário não prova sozinho: a ordem de erros quando uma rota tem uma parte inválida e um recurso ausente ao mesmo tempo (o plano não a fixa; C5 manda partes inválidas contra recursos existentes) e a forma interna dos campos abertos listados em "Campos abertos" abaixo
- Nenhum outro check afirma mais do que o caso que a sua prova exercita

## Test policy

Linhas novas para o que esta feature cria; o resto do repositório já responde (os testes de rota ficam em `tests/api.*.test.ts`, o de política em `tests/core.engine.test.ts`) e não é repetido.

| Code                                                                                            | Required proofs                                 | Coverage expectation                                                                                                      |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Decide, atravessado por uma fronteira (`bind`, o gancho de conferência, o gerador do documento) | uma na fronteira (HTTP) **e** uma na sua camada | o contrato na fronteira; um caso afirmado por linha da tabela de decisão na camada                                        |
| Decide, sem fronteira (`checkResponse`, `classifyEvent`, `responsesValidated`, `apiCall`)       | uma na sua camada                               | um caso afirmado por linha da tabela de decisão                                                                           |
| Declarativo (as entradas de `API`, os schemas de payload, as listas de versão)                  | nenhuma própria                                 | coberto pelo consumidor: o cenário de C12 e o documento de C15 passam por todas; a igualdade de tipos de C8 trava o resto |
| Instrumentation (o handler de rota depois de migrado: chama a engine e devolve)                 | nenhuma própria                                 | coberto pelas suítes `tests/api.*.test.ts` que já existem, agora com a conferência de resposta ligada                     |

Evidence:

- `apps/api/src/contract.ts` (`bind`): parse de três partes, corpo opcional, id desconhecido, status declarado -> decide (4 pontos de decisão)
- `contracts/src/api/check.ts` (`checkResponse`): status declarado, schema, chave a mais, par de erro, envelope, tipo cru -> decide (6 pontos)
- `contracts/src/eventRegistry.ts` (`classifyEvent`): não objeto, tipo, versão, inteiro -> decide (5 pontos); `readOsEvent` (zod) -> decide (3 pontos)
- `apps/api/src/openapi.ts`: segurança por acesso, erros comuns por parte, tipos crus, recusa de entrada sem schema -> decide (7 pontos)
- `apps/command-centre/src/api.ts` `apiCall`: codifica parâmetro, serializa query (ignora `undefined`), corpo JSON -> decide (3 pontos)
- análogo mais próximo no repositório: `tests/device-scopes.test.ts` C3 e `tests/helpers/routeScopes.ts` (tabela escrita à mão medida contra o roteador real, `table-driven` sobre as rotas) e `tests/contracts.test.ts` C41 (a superfície fixada com `toEqual`), mesma forma, já provados nesse nível

Cost: 6 provas na sua camada em 4 arquivos de teste novos, mais o cenário de 127 rotas. Sem estas linhas, as quatro tabelas de decisão novas seriam provadas só por um caminho que passa por elas.

## Campos abertos

Campos de forma aberta no contrato (o valor é de quem escreve, não do servidor) e as rotas de que o schema descreve só o contorno, com o motivo:

- `Approval.payload` (`Record<string, unknown>`): o conteúdo depende de `kind` (comando de ferramenta, tela, preferência) e é o do agente
- `ConnectorSchema.dataMapping.tools.*.args` e `FieldSpec`: mapas livres do conector
- `GET /api/sentinels` `config`: o objeto de configuração de cada sentinela, que difere por sentinela
- `GET /api/diagnostics/export` `doctor.checks[].detail` e `settings`: o relatório do médico e o espelho das configurações, só o contorno
- `GET /api/memory/graph` `nodes[].meta`, `GET /api/memory/query` `files[].fields`: campos inline `chave:: valor` do usuário
- `POST /api/microapps/pixel/save`, `PUT /api/ui-preferences`: o desenho e as preferências são do usuário

A lista final é a `OPEN_FIELDS` do teste de C38, que a compara com os campos abertos que a leitura da árvore dos schemas encontra.

## Swept

- validation: C5, C4
- failure modes: C9, C6, C20
- idempotency: n/a - a feature não cria caminho de escrita nem de repetição; os recibos de `POST /api/runs` e de `retry` (`submissionId`) ficam como estão
- authorization: C3, C34, existing - o gancho `onRequest` e a tabela `EXPECTED_ROUTE_SCOPES` (escopos-dispositivo) seguem decidindo pela rota casada
- concurrency: n/a - `bind` e a conferência são síncronos e sem estado compartilhado, e a tabela `API` é imutável (`as const`); nada novo é lido e gravado por duas requisições
- data lifecycle: n/a - nada novo é gravado; o `v` dos quadros é acrescentado no envio e `run_events` não muda (C24)
- dependency failure: C20 (um schema que o conversor não exprime para o documento e o nomeia), C16 (o documento inválido reprova)
- state transitions: C22 (a lista de versões de um tipo só cresce e é contígua), C27 (nenhuma versão publicada perde o schema)
- observability: C14

## Chamadas da interface que ficam de fora

A leitura da árvore sintática acha 126 chamadas `api.get/post/put/patch/del` no início da feature: as 113 que o plano contou por linha de texto e 13 que a busca por linha não via (`api` e `.get` em linhas separadas). Passaram a `apiCall("<MÉTODO> <caminho>", …)` 125 e uma continua na lista de `apps/command-centre/src/api.calls.test.ts` (`NOT_MIGRATED`), que reprova uma chamada nova que não seja uma coisa nem a outra (e exige pelo menos as 113 do plano):

- `queries.ts`, `useApiQuery`: `api.get<T>(path, { signal })` com o caminho como parâmetro. Os 44 chamadores de `useApiQuery<T>(chave, "/api/…")` escrevem a rota numa string que o compilador não lê e `T` é palpite; `useRouteQuery` é o irmão tipado, já usado pelos `useOs*` (meta, providers, skills, routines, runs, run, metrics, artifacts, connectors, objectives), e os chamadores passam a ele um hook de cada vez. Ficam de fora desta feature porque cada um troca `T` por um tipo do contrato e abre erros de tipo nos consumidores (o `GET /api/runs` já mostrou um: a lista não traz `request`).
- Os tipos-espelho de `api.ts` (94 `export interface/type`) que ainda não derivam do contrato: `Meta`, `ProviderSnapshot`, `Metrics`, `SystemInfo`, `UpdateCheck`, `GraphData`, `ArtifactEntry`, `RoutineHistoryEntry` e semelhantes. Os que a migração tocou foram alinhados: `Skill.inputs` e `recommendedEffort`, `Connector.kind/status/authMethod/dataMapping.transport`, `RoutineStatus.effort/missedPolicy/profile`, `RunSummary` (novo; as listas deixam de se dizer `RunRecord`).
- Resposta não validada no navegador: as chamadas migradas confiam no servidor, que conferiu (C9); validar com zod na interface custa bundle (C31).

## Settled while building

Registrado para quem verifica; nada abaixo muda o texto aprovado de um check, salvo onde diz "Amendment" no próprio check.

- C7 foi emendado (ver o check): o compilador não vê chave a mais num retorno `async`; quem a reprova é C9.
- O alvo do `apiCall` ficou em `apps/command-centre/src/apiCall.ts`, ao lado de `api.ts` (o plano dizia `api.ts`): 13 testes existentes trocam o objeto `api` do módulo `./api` por um duplo, e um `apiCall` dentro de `api.ts` chamaria o `api` verdadeiro, fora do duplo. O teste de C30 importa de `./apiCall`.
- O guarda de C28 (`tests/helpers/eventGuard.ts`) liga o barramento num `beforeAll` com `import()` dinâmico: um `import` estático em arquivo de `setupFiles` carrega `@mordomo/core` (e `node:child_process`) antes do `vi.mock` do teste e o mock deixa de valer (`tests/device-scopes.test.ts` perdeu as contagens de lançamento).
- Testes de features anteriores que mudaram, sem enfraquecer asserção e sem tocar nos que C35 nomeia (`api.hardening` "error envelope", `api.v1` C20 e C21, `device-scopes` C3, `data.restore-lock` C90):
  - o que a regra nova de registro desfaz: `tests/device-scopes.test.ts` (duas expectativas de que uma rota pública ou com escopo registrada à mão não lança passam a esperar `declares no contract`; a rota raiz `/api` do teste de C-escopo passa por `bindEntry`), `tests/api.v1.test.ts` (o leitor de `ok` ganhou os casos de `bind` e de `true as const`, nenhum caso removido; `tests/helpers/okScanner.ts` reconhece `bind(app, id, handler)`), `tests/contracts.test.ts` (C16: três pontos de entrada em vez de dois, com o alcance de `./events` sem zod; C41: a superfície de tempo de execução fixada com os nomes novos, que é o C36 deste plano) e `tests/api.hardening.test.ts` (a rota de erro `/api/__boom` passa por `bindEntry` e só existe durante o teste que a usa: uma entrada de tabela sem rota derruba o `buildServer` seguinte);
  - o que o guarda de C28 (todo evento do barramento valida contra o schema) revelou: payloads que o contrato nunca teve, emitidos à mão. `tests/api.hardening.test.ts` emitia `settings.changed` com `{ keys: [...] }` (passou a emitir `{ settings }` e a conferir `systemName`), `tests/core.routines.v2.test.ts` e `tests/builtin-context.test.ts` emitiam `run.finished` sem `durationMs` (o segundo com `as never`) e o adaptador falso de `tests/core.runs.test.ts` devolvia um `result` sem `timedOut`.
- A tabela achou um erro não documentado: o core lança `409 approval_resolved` ao decidir uma aprovação já decidida e a entrada `approvals.resolve` só dizia `approval_expired`; o `tests/helpers/errorScan.ts` passou a ler `code` condicional (`ok ? "a" : "b"`) e a entrada ganhou o par. O que sobrou de resposta que o contrato achou divergente da interface foi consertado na interface (tipos e leitura), nenhuma rota mudou: `GET /api/runs` é `RunSummary`, `POST /api/skills/:slug/notes/promote` responde o lançamento (`runId`, `status`) sem a forma `run` que a tela tentava, `POST /api/backups/:name/restore` responde `message` (sem `note`), `PushSubscription.toJSON()` tem chaves opcionais e a tela agora recusa o que o servidor recusaria.
- Os cenários de C5: a lista `ACCEPTS_ANYTHING` tem as sete rotas cujo `query` aceita qualquer texto em cada chave (uma flag ou um texto livre), e o teste a compara com o que o schema realmente aceita.

Depois de integrada com `sdk-core` e `licenca-comercial` (rebase sobre `8c26712`, a branch passou a `feat/contratos-rest-r`):

- Não há barramento do processo: cada motor tem o seu (`ctx.events`). O guarda de C28 passou a envolver `EventBus.prototype.emit` (em `beforeAll`, com `import()` dinâmico), e vê todo barramento, também os que um teste constrói sozinho; por isso `tests/core.event-order.test.ts` e `tests/core.memory.v2.test.ts` ganharam payloads completos (uma notificação e um `index.finished` inteiros, `pid` e `durationMs`). C28 observa as emissões dos cenários da mesma forma.
- O motor lança as recusas por `new MordomoError(status, mensagem, código?)`: o leitor de erros de C13 (`tests/helpers/errorScan.ts`) lê essa forma, com autoteste. Todo par que o núcleo novo pode lançar já estava documentado nas entradas.
- Os corpos de pedido das rotas que lançam execuções (prompt, filhos, sessão, rotina e despacho) usam os limites do motor: `RUN_LIMITS` (`promptMaxChars`, `timeoutMinMs`, `timeoutMaxMs`) mora em `@mordomo/contracts` e `core/src/execution/schemas.ts` o reexporta (os números são os mesmos de antes). O teto de 3 600 000 ms vale só para o `timeoutMs` que um chamador pede; o `limits.defaultTimeoutMs` do setting não é limitado pelo contrato (o despacho de objetivo com um default maior que isso responde `400` no motor, defeito do `sdk-core`, não replicado aqui).
- Os `202` de um pedido estacionado (`POST /api/runs`, filhos, `sessions/:id/continue`, `skills/:slug/run` e o `retry` de uma execução estacionada) passam pela conferência de resposta: prova nova em `tests/api.contract.test.ts` ("C12 a write parked for a human answers 202 and satisfies its entry"), com o perfil `review_before_write`.
- A prova do pacote de `sdk-core` (`tests/sdk.package.test.ts`, C43) compila os `.d.ts` publicados sem `skipLibCheck` e achou um tipo meu inválido (`CountedSchema` com chave computada virava índice `string` em `memory.d.ts`): são três schemas explícitos agora. O pacote `@mordomo/contracts` tem três pontos de entrada (`./events` novo) e `docs/sdk.md` o diz.
- `tests/sdk.api-thin.test.ts` (C29 do `sdk-core`: as oito suítes das rotas guardam toda asserção da base) ganhou uma lista `AMENDMENTS`: os 7 trechos que esta feature mudou em `tests/api.hardening.test.ts` e `tests/device-scopes.test.ts` (rota registrada à mão passa por `bindEntry`; `settings.changed` com o payload do contrato), cada um com o trecho da base e o que virou, e cada um tem de casar exatamente uma vez; uma asserção mudada em outro lugar segue reprovando.
- A prova de ponta a ponta `tests/e2e/provider-readiness.spec.ts` ("a remote indexing failure clears an observer's progress through the event stream") finge o transporte com quadros sem `v`; o cliente agora descarta o quadro sem versão (C32), como o servidor real nunca envia, e a fixture passou a enviar `v: 1`.
- Dependências: `legal/THIRD_PARTY_NOTICES.md` regenerado (`npm run licenses:write`: 185 distribuídos, 493 ferramentas, `zod-to-json-schema` ISC entra; `swagger-parser`, `ajv` e `ajv-formats` são só ferramentas de teste) e as contagens fixadas em `tests/legal.licenses.test.ts` e `tests/legal.docs.test.ts` subiram de 184/183 para 185/184 (o SBOM leva ainda os 4 de `bundled`). A varredura de rede conta o rótulo `"git"` do contrato (`kind: z.literal("git")` do diff de execução) como ponto de rede: entrou em `legal/network-policy.json` com a nota de que não executa nada (como os rótulos iguais da interface), e o `tests/legal.network.test.ts` passou de 36 a 37 pontos. `licenses:check` e `network-scan --check` passam.

## Out of scope

Vem de `plan.md` (Out of scope); nada acrescentado.

## Handoff

Tamanho, em `wc -c`/4 dos arquivos que cada fatia toca (ler e escrever):

- S1 = ~90k: `routes/*.ts` 150 KB reescritos, `contracts/src/api/*` ~110 KB novos, `server.ts` 36 KB e `contract.ts` 8 KB, mais ~60 KB de tipos do core lidos para os schemas de resposta (364 KB / 4)
- S2 = ~30k: `check.ts`, o gancho de `server.ts` e `tests/api.contract.test.ts` com os 127 cenários (~120 KB / 4); S3 = ~18k: `openapi.ts` e `tests/api.openapi.test.ts` (~70 KB / 4)
- S4 = ~38k: `eventRegistry.ts`, `events.ts` (contrato e core), 32 fixtures, `docs/events.md`, `tests/events.contract.test.ts` e o carimbo `v` em `routes/runs.ts` (~150 KB / 4)
- S5 = ~50k: `api.ts` (42 KB) e os arquivos das chamadas migradas (~30 arquivos, ~120 KB lidos em parte) e dois testes (~200 KB / 4); S6 = ~10k: ajuste dos testes fixados e do arquivo de exports (~40 KB / 4)
- Total ~236k, acima do orçamento de 150k. A fatia maior (S1, ~90k) cabe sozinha no orçamento, então o corte natural é a fronteira de superfície já escrita: S1+S2+S3 (~138k, tudo em `apps/api` e `contracts`) e S4+S5+S6 (~98k, eventos e interface).
- Mechanism: one builder (compaction accepted) - escolhido pelo delegado sem poder perguntar (a execução é delegada pelo dono e o chamador pediu a construção nesta mesma execução; não há sub-agente a quem entregar um segundo lote). A alternativa `handoff` no corte acima continua válida se o dono preferir revisar S1-S3 antes de S4-S6. Registrado em STATE (Perguntas ao dono, contratos-rest, item 6).
