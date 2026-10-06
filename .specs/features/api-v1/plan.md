# API v1 — um contrato versionado, com escopos, limites e um formato de erro

## Problem

A API tem 124 rotas sob `/api`, sem versão, sem documento e sem distinção de quem chama. Um token de
dispositivo pareado (o celular do dono, `core/src/security/devices.ts`) pode fazer tudo o que o token
local faz: mudar `providers.*.binaryPath`, ligar o acesso remoto, trocar o perfil de segurança,
restaurar um backup, reiniciar o serviço, instalar skills e parear outro dispositivo
(`apps/api/src/server.ts:210-234` aceita os dois sem registrar a identidade). Um telefone perdido é,
hoje, uma chave da máquina.

O token também é aceito em `?token=` em qualquer rota (`server.ts:220-222`), o que o põe em logs de
proxy e no histórico do navegador. A feature 1 adiou essa restrição para cá
(`.specs/features/seguranca-p0/plan.md:164-188`). Não há limite de tentativas: `POST /api/pair/claim`
é público e só conta 5 tentativas por código, não por origem. O Telegram autoriza pelo `chatId` e
ignora quem, dentro do grupo, apertou "aprovar" (`core/src/channels/telegramInbound.ts:27,83-85`). E
nenhuma aprovação registra quem decidiu.

Para quem integra (a interface, a CLI, o servidor MCP, um app de terceiro), não há contrato estável:
os erros vêm em três formatos, e três rotas respondem `200` com `{ ok: false, error: "…" }`
(`apps/api/src/routes/channels.ts:35-53,74`, `push.ts:49,66,69`). Não há documento de rotas.

Evidência: mapeamento da API de 06/10/2026 (nesta sessão) e a análise do motor de 06/10/2026
(achados S4 e S7). `docs/security.md:76` lista escopos, Telegram por pessoa e limites como pendentes.

## Flow

Reutiliza o gancho `onRequest` de `apps/api/src/server.ts` (exists), o envelope `errorBody()` e o
`errorHandler` (exists), `httpError` (`apps/api/src/routes/common.ts`, exists) e o `DeviceStore`
(`core/src/security/devices.ts`, exists).

1. Versão → `server.ts`: o Fastify reescreve `/api/v1/<resto>` para `/api/<resto>` antes do roteamento
   (door 1). As rotas sem versão continuam respondendo e ganham os cabeçalhos de obsolescência.
   `GET /api/v1/meta` traz `apiVersion: 1`.
2. Identidade → o gancho `onRequest` grava `req.principal` (door 3): `{ kind: "owner" }`,
   `{ kind: "device", deviceId }` ou `{ kind: "broker", runId }`. Uma rota marcada
   `config: { scope: "owner" }` recusa um dispositivo com `403 owner_only`.
3. Token na URL → aceito só em `GET` de rota marcada `config: { queryToken: true }` (door 4).
4. Limites → `apps/api/src/rateLimit.ts` (new): janela deslizante em memória por endereço (door 5),
   aplicada em `POST /api/pair/claim` e nas respostas `401`.
5. Erros → todo `4xx`/`5xx` sai pelo envelope (door 2). As rotas de teste de canal e de push passam a
   responder `4xx`/`502` em vez de `200 { ok: false }`.
6. Documento → uma rota nova `GET /api/v1/openapi.json`, gerada da tabela de rotas do Fastify (`onRoute`): método,
   caminho, parâmetros de caminho, escopo, `queryToken`, e as respostas de erro comuns.
7. Quem decidiu → `approvals.resolved_by` (door 6), preenchido pelo principal da requisição ou pelo
   Telegram (`telegram:<userId>`). O Telegram passa a conferir `from.id` contra
   `channels.telegram.allowedUserIds`.
8. Clientes → `apps/command-centre/src/api.ts` (exists) prefixa `/api/v1` em `request()` e nas URLs de
   SSE; a CLI (`apps/api/src/mcp/*.ts`, exists) usa `/api/v1`.

## Impact

| Front       | What changes                                                                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | novo termo: `principal` - quem fez a requisição: `owner` (token local), `device` (token pareado), `broker` (credencial de uma execução)                          |
| domain      | novo termo: `scope` de rota - `owner` (só o dono na máquina) ou o padrão (dono ou dispositivo); o broker continua restrito às três rotas de aprovação            |
| contrato    | API: `/api/v1/*` é o caminho documentado; `/api/*` segue igual e responde `Deprecation: true` + `Link: </api/v1/…>; rel="successor-version"`                     |
| contrato    | API: dispositivo em rota `owner` → `403 owner_only`; `?token=` fora das rotas marcadas → `401 unauthorized`; excesso → `429 too_many_requests` com `Retry-After` |
| contrato    | API: `POST /api/channels/telegram/send`, `/test` e `POST /api/push/test` deixam de responder `200 { ok: false }`                                                 |
| contrato    | `Approval` ganha `resolvedBy: string \| null`                                                                                                                    |
| stored data | coluna `approvals.resolved_by TEXT NULL` (migração aditiva); `settings.channels.telegram.allowedUserIds: number[]` (padrão `[]`)                                 |

## Relations

| Data                               | Change                  | Existing rows                                          | Reversible                                  |
| ---------------------------------- | ----------------------- | ------------------------------------------------------ | ------------------------------------------- |
| `approvals.resolved_by`            | coluna nova `TEXT NULL` | ficam `NULL` (decididas antes de haver registro)       | sim - a coluna é ignorada por código antigo |
| `channels.telegram.allowedUserIds` | campo novo, padrão `[]` | arquivos sem o campo leem `[]` (comportamento de hoje) | sim                                         |

## Surface

| Route                                          | In                                | Out                                               | Status                         |
| ---------------------------------------------- | --------------------------------- | ------------------------------------------------- | ------------------------------ |
| `GET /api/v1/runs` (e toda rota sob `/api/v1`) | o mesmo de `/api/runs`            | o mesmo corpo                                     | `200` (o mesmo de `/api/runs`) |
| `GET /api/runs` (e toda rota sem versão)       | o mesmo                           | cabeçalhos `Deprecation`, `Link`                  | `200` (inalterado)             |
| `GET /api/v1/meta`                             | -                                 | `apiVersion: 1`                                   | `200`                          |
| `GET /api/v1/openapi.json`                     | -                                 | documento OpenAPI 3.1                             | `200`                          |
| rota `owner` chamada por dispositivo           | token de dispositivo              | `error.code` `"owner_only"`                       | `403`                          |
| qualquer rota com `?token=` não marcada        | `?token=`                         | `error.code` `"unauthorized"`                     | `401`                          |
| `POST /api/pair/claim` além do limite          | -                                 | `error.code` `"too_many_requests"`, `Retry-After` | `429`                          |
| `POST /api/channels/telegram/send`, `/test`    | sem token do bot ou sem chat      | `error.code` `"channel_not_configured"`           | `409` (antes `200`)            |
| `POST /api/channels/telegram/send`, `/test`    | o Telegram recusou                | `error.code` `"channel_failed"`                   | `502` (antes `200`)            |
| `POST /api/push/test`                          | push desligado / ninguém inscrito | `error.code` `"channel_not_configured"`           | `409` (antes `200`)            |
| `POST /api/push/test`                          | nenhuma entrega                   | `error.code` `"channel_failed"`                   | `502` (antes `200`)            |
| `GET /api/approvals/:id`                       | -                                 | `resolvedBy`                                      | `200`                          |

## Landing

| One-way door                | Literal shape                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Alternative rejected                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Esquema de versão        | prefixo de caminho `/api/v1/`; `/api/` sem versão é um apelido de v1 com `Deprecation: true` e `Link: </api/v1/<resto>>; rel="successor-version"`; `meta.apiVersion` = `1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Versão por cabeçalho (`Accept-Version`): invisível em logs e no navegador, e o `EventSource` não manda cabeçalhos                                                                   |
| 2. Envelope de erro         | todo status `>= 400`: `{ "error": { "code": string, "message": string, "issues"?: ZodIssue[] }, "message": string }` (o `message` de topo repete o interno, para clientes antigos); nenhum `2xx` com `ok: false`                                                                                                                                                                                                                                                                                                                                                                                                                                              | RFC 9457 (`application/problem+json`): troca a forma que a interface, a CLI e os testes já leem, sem ganho para um cliente local                                                    |
| 3. Escopos                  | `owner`: token local; `device`: token pareado; `broker`: credencial de execução (só as três rotas de aprovação, como hoje). Rotas `owner`: `PUT /api/settings`, `PUT /api/providers/default`, `POST /api/providers/:id/detect`, `POST /api/system/restart`, `POST /api/system/reap`, `POST /api/backups`, `POST /api/backups/:name/restore`, `DELETE /api/backups/restore-pending`, `POST /api/sync/apply`, `POST /api/skills/install`, `POST /api/skills/import`, `POST /api/connectors`, `PUT /api/connectors/:id`, `DELETE /api/connectors/:id`, `POST /api/pair/start`, `DELETE /api/devices/:id`, `POST /api/memory/open`, `GET /api/diagnostics/export` | Escopos finos por recurso (`runs:write`, `settings:read`…): sem um segundo usuário real ainda, é uma matriz que ninguém configura; os dois níveis cobrem o caso do telefone perdido |
| 4. Token na URL             | aceito só em `GET` de `/api/events`, `/api/runs/:id/stream`, `/api/artifacts/raw` e `/api/skills/:slug/resource`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Bilhete de uso único para SSE: mais seguro, mas exige uma rota nova e uma troca no cliente para cada stream; fica para quando houver acesso fora da rede local                      |
| 5. Limites                  | `POST /api/pair/claim`: 10 por minuto por endereço; respostas `401`: 20 por 5 minutos por endereço, sem contar loopback; além disso `429 too_many_requests` com `Retry-After` em segundos                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Limite global por rota: um cliente local barulhento (a interface aberta em três abas) travaria o dono                                                                               |
| 6. Registro de quem decidiu | `approvals.resolved_by TEXT NULL`: `"owner"`, `"device:<deviceId>"`, `"broker:<runId>"`, `"telegram:<userId>"`, `"system"` (expiração)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Tabela de auditoria separada: duplica o estado da aprovação; uma coluna basta para responder "quem aprovou isto"                                                                    |

- Nothing else in this change is hard to reverse

## Criteria

### S1: Uma versão no caminho (P1)

**Acceptance Criteria**

1. WHEN a request targets `/api/v1/<path>` THEN the API SHALL answer exactly as it answers `/api/<path>` (same status and body), for every route
2. WHEN a request targets an unversioned `/api/<path>` route THEN the response SHALL carry `Deprecation: true` and `Link: </api/v1/<path>>; rel="successor-version"`
3. WHEN `GET /api/v1/meta` is called THEN the body SHALL include `apiVersion: 1`
4. The Command Centre SHALL send every API and SSE request to `/api/v1/…`, and so SHALL the MCP and permission clients of the CLI

**Independent test:** `GET /api/v1/runs` e `GET /api/runs` devolvem o mesmo corpo; só o segundo tem `Deprecation`.

### S2: Um formato de erro (P1)

**Acceptance Criteria**

5. The API SHALL answer every status `>= 400` with the envelope of door 2, including `POST /api/pair/claim` failures, `404` on unknown `/api` paths and `413`
6. WHEN the Telegram channel or push is not configured THEN their send/test routes SHALL answer `409` with `error.code` `"channel_not_configured"`; WHEN delivery fails THEN `502` with `"channel_failed"`
7. The API SHALL NOT answer any `2xx` whose body has `ok: false`

**Independent test:** `POST /api/push/test` com push desligado responde `409` no envelope.

### S3: Escopos e o token na URL (P1)

**Acceptance Criteria**

8. WHEN a device token calls one of the owner routes of door 3 THEN the API SHALL answer `403` with `error.code` `"owner_only"` and SHALL NOT perform the action
9. WHEN a device token calls a default-scope route (e.g. `GET /api/runs`, `POST /api/runs`, `POST /api/approvals/:id/resolve`) THEN the API SHALL serve it
10. WHEN the local token calls an owner route THEN the API SHALL serve it
11. IF a credential arrives in `?token=` on a route outside door 4, or on a non-`GET` method THEN the API SHALL answer `401 unauthorized`
12. WHEN a credential arrives in `?token=` on `GET /api/events` or `GET /api/runs/:id/stream` THEN the API SHALL accept it

**Independent test:** um dispositivo pareado não consegue `PUT /api/settings`, mas lista execuções.

### S4: Limites de tentativa (P1)

**Acceptance Criteria**

13. WHEN one address sends the 11th `POST /api/pair/claim` within 60 s THEN the API SHALL answer `429` with `error.code` `"too_many_requests"` and a `Retry-After` header, without checking the code
14. WHEN one non-loopback address collects its 21st `401` within 5 minutes THEN its next request SHALL answer `429` until the window passes
15. WHILE requests come from loopback, failed authentications SHALL NOT be rate limited

**Independent test:** 11 tentativas de pareamento seguidas do mesmo IP → a 11ª é `429`.

### S5: Documento das rotas (P2)

**Acceptance Criteria**

16. WHEN `GET /api/v1/openapi.json` is called THEN it SHALL return an OpenAPI 3.1 document whose `paths` contain every registered `/api` route under its `/api/v1` path, with its method, path parameters and a `security` entry, and owner routes SHALL be marked with `x-mordomo-scope: "owner"`
17. The document SHALL be generated from the route table at startup, so a route added without documentation still appears

**Independent test:** o número de operações do documento é igual ao número de rotas `/api` registradas.

### S6: Quem decidiu, e o Telegram por pessoa (P2)

**Acceptance Criteria**

18. WHEN an approval is resolved through the API THEN `resolvedBy` SHALL be `"owner"`, `"device:<deviceId>"` or `"broker:<runId>"` according to the principal; WHEN it expires THEN `"system"`
19. WHEN an approval is resolved from Telegram THEN `resolvedBy` SHALL be `"telegram:<from.id>"`
20. WHILE `channels.telegram.allowedUserIds` is non-empty, IF a Telegram command or button comes from a `from.id` not in the list THEN the poller SHALL ignore it (no approval changes, no reply)
21. WHILE `allowedUserIds` is empty, the poller SHALL keep today's rule (the configured chat only)
22. The approvals rows written before the migration SHALL read back with `resolvedBy: null`

**Independent test:** num grupo, só a pessoa listada consegue aprovar pelo botão.

## Out of scope

| Excluded                                   | Why                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Esquemas de corpo e de resposta no OpenAPI | as 124 rotas validam com zod inline; levar cada schema ao documento é um trabalho por rota que vem depois, sobre este documento base |
| Remover as rotas sem versão                | exige uma versão maior e um aviso aos clientes; aqui elas só ficam marcadas                                                          |
| Bilhete de uso único para SSE              | ver door 4                                                                                                                           |
| Vários usuários com contas e senhas        | o MordomoOS é de um dono; dispositivos e pessoas no Telegram são extensões dele                                                      |
| Telegram enviando para várias conversas    | a entrega segue indo para um `chatId`; o que muda é quem pode decidir                                                                |

## Assumptions

| Assumption                     | Chosen default                                  | Rationale                                                                                                        | Confirmed? |
| ------------------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------- |
| Ler configurações é `owner`?   | não: `GET /api/settings` segue no escopo padrão | a interface no celular precisa ler; nada secreto mora em `settings.json` (o token do bot é variável de ambiente) | n          |
| Aprovar pelo celular           | permitido (escopo padrão)                       | é o uso principal do pareamento                                                                                  | n          |
| Contagem de `401` por loopback | não conta                                       | o dono na própria máquina nunca deve ficar trancado                                                              | n          |
| Estado dos limites             | em memória, zera ao reiniciar                   | um serviço local, um processo; persistir não protege mais                                                        | n          |

**Open questions:** none - all resolved or logged above.

## Observable

| Surface                         | Decision        | Landing                                  |
| ------------------------------- | --------------- | ---------------------------------------- |
| API (todas)                     | versioning      | AC 1-3 (door 1)                          |
| API (todas)                     | error shape     | AC 5-7 (door 2)                          |
| API (todas)                     | who may call it | AC 8-12 (doors 3, 4)                     |
| API (todas)                     | rate limits     | AC 13-15 (door 5)                        |
| API `GET /api/v1/openapi.json`  | response shape  | AC 16-17                                 |
| API `GET /api/approvals/:id`    | response shape  | AC 18 (door 6)                           |
| screen `Configurações › Canais` | test result     | AC 6 - a interface já lê `error.message` |
| channel Telegram                | who may decide  | AC 20-21                                 |

## Sources

- Mapeamento da API de 06/10/2026 (nesta sessão)
- Análise do motor de 06/10/2026 - achados S4 (escopos) e S7 (contrato da API)
- `.specs/features/seguranca-p0/plan.md` - itens adiados para api-v1
- `docs/security.md` - "Deferred"
