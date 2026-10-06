# Segurança P0 — autenticação, token da página, broker e abertura de arquivos

## Problem

A API local, que dispara agentes com acesso de escrita à máquina, aceita requisições sem token
quando uma letra do caminho vem codificada. `GET /%61pi/settings` devolve 200 com as
configurações, enquanto `GET /api/settings` devolve 401. O mesmo vale para escrita:
`PUT /%61pi/settings` muda o perfil para `approved_automation`, `POST /%61pi/pair/start` devolve
um código de pareamento, `POST /%61pi/backups` cria backup. Isso foi reproduzido em 06/10/2026
contra o build compilado. Quem paga é o dono da máquina: qualquer processo local, outro usuário
do sistema ou uma página aberta no navegador (POST `no-cors` sem corpo) controla a API, e com
`bindAddress` fora do loopback, qualquer um na rede.

Há mais quatro furos no mesmo caminho:

- A página do Command Centre recebe o token mestre quando o cabeçalho `Host` diz `localhost`,
  sem olhar o endereço real de quem conectou. Com acesso remoto ligado, um cliente da rede que
  envia `Host: localhost:4777` recebe o token mestre (reproduzido em 06/10).
- O servidor MCP de permissão recebe o token mestre, e o adaptador do Claude passa a
  configuração inteira como argumento (`--mcp-config <JSON>`), visível em `ps` para qualquer
  usuário e para o próprio agente. Com esse token o agente aprova as próprias ferramentas.
- `POST /api/memory/open` abre qualquer arquivo dentro das pastas concedidas com o programa
  padrão do sistema. No macOS isso executa `.app` e `.command`. No Windows passa por
  `cmd /c start`, que reinterpreta `&` no nome do arquivo.
- Codex e Cursor recebem o prompt como argumento posicional. Um prompt que começa com `-` é lido
  como opção do CLI.

## Flow

Reutiliza o hook `onRequest` que já faz a checagem de Host e token, o `ApprovalStore` que já
guarda o `runId` no payload, o `permissionBrokerFor` que já monta o ambiente do broker e o
`resolveInsideRoots` que já faz a contenção de caminho.

1. Requisição HTTP → `apps/api/src/server.ts` (exists), hook `onRequest`: checa o Host; resolve a
   credencial pela rota já casada pelo roteador (`req.routeOptions`), não pela URL crua (door 1).
   Rota sem `config.public` exige token mestre, token de dispositivo ou credencial de broker.
2. Credencial de broker → `apps/api/src/context.ts` (exists) emite e valida a credencial por
   execução (door 2); o hook marca a requisição com o `runId` da credencial.
3. Rotas de aprovação → `apps/api/src/routes/system.ts` (exists): com credencial de broker, só
   criam, consultam e negam aprovações da própria execução.
4. Execução com broker → `adapters/claude/src/index.ts` (exists) grava a configuração MCP num
   arquivo 0600 num diretório temporário 0700 e passa o caminho em `--mcp-config`; apaga o
   diretório quando a execução termina.
5. Página → `server.ts` (exists), `serveIndex`: injeta o token só quando o socket e o Host são
   loopback.
6. Abrir arquivo → `apps/api/src/routes/memory.ts` (exists): contenção, depois allowlist de
   extensões (door 3), depois o abridor da plataforma sem `cmd`.
7. Prompt posicional → `adapters/codex/src/index.ts` (exists) e `adapters/cursor/src/index.ts` (exists):
   o argumento final nunca começa com `-`.

## Impact

| Front       | What changes                                                                                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | novo termo: `credencial de broker` - segredo aleatório por execução, válido enquanto a execução está `queued` ou `running`, que só cria, consulta e nega aprovações daquela execução; vive em `apps/api/src/context.ts` |
| domain      | termo existente: `rota pública` era decidida pela string da URL (`req.url === "/api/meta"`), passa a ser `config: { public: true }` na rota; quem decide hoje é só o hook de `server.ts`                                |
| domain      | termo existente: `MORDOMO_TOKEN` no ambiente do broker era o token mestre, passa a ser a credencial de broker; quem lê é `apps/api/src/mcp/permission.ts` (`call()`), que não muda                                      |
| stored data | nada a migrar - a credencial de broker vive em memória; execuções ativas num reinício já viram `interrupted`                                                                                                            |
| contrato    | `POST /api/memory/open` ganha a resposta 415 `unsupported_type`; a UI (`api.ts`) já trata qualquer envelope de erro                                                                                                     |
| docs        | `docs/security.md` descreve hoje um modelo loopback-only que o código já não segue (pareamento, TLS, Telegram)                                                                                                          |

## Relations

None - no stored-data shape change

## Surface

Only routes this adds or whose signature changes.

| Route                                              | In                             | Out                                    | Status                                                                 |
| -------------------------------------------------- | ------------------------------ | -------------------------------------- | ---------------------------------------------------------------------- |
| `ANY /api/*` (qualquer grafia que o roteador case) | `x-mordomo-token` ou `?token=` | envelope de erro                       | `401` sem credencial válida, `403` credencial de broker fora do escopo |
| `POST /api/approvals/:id/resolve`                  | `decision`, `answers`          | aprovação                              | `200`, `403` broker tentando aprovar ou agindo noutra execução, `404`  |
| `POST /api/approvals/tool`                         | `runId`, `toolName`, `input`   | aprovação                              | `200`, `403` broker de outra execução, `404`, `409`                    |
| `GET /api/approvals/:id`                           | `id`                           | aprovação                              | `200`, `403` broker de outra execução, `404`                           |
| `POST /api/memory/open`                            | `p`                            | `opened`                               | `200`, `403` fora das pastas, `415` tipo fora da allowlist             |
| `GET /`, `GET /index.html`, fallback da SPA        | -                              | HTML com `<meta name="mordomo-token">` | `200` (meta vazio quando o socket não é loopback)                      |

## Landing

| One-way door                                                     | Literal shape                                                                                                                                                                                                                  | Alternative rejected                                                                                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Rota pública por configuração da rota, auth negada por padrão | `app.get("/api/meta", { config: { public: true } }, handler)`; o hook lê `req.routeOptions.config.public` e `req.routeOptions.url`                                                                                             | Decodificar e normalizar `req.url` antes do `startsWith`: duplica o parser do roteador, e qualquer diferença futura entre os dois reabre o furo             |
| 2. Credencial de broker por execução, em memória, com escopo     | `brk_` + 32 bytes base64url; `Map<credencial, runId>` em `AppContext`; aceita só `POST /api/approvals/tool`, `GET /api/approvals/:id` e `POST /api/approvals/:id/resolve` com `decision: "denied"`, sempre da própria execução | Token assinado sem estado (HMAC com `runId`): não dá para revogar no fim da execução sem uma lista de revogação, que é o mesmo mapa                         |
| 3. Allowlist de extensões para `memory/open`                     | constante `OPENABLE_EXTENSIONS` em `routes/memory.ts`: `md txt pdf png jpg jpeg gif webp svg mp4 mov webm mp3 wav m4a csv json html htm docx xlsx pptx odt ods odp rtf`; pasta sem extensão é permitida                        | Denylist de executáveis: sempre incompleta (`.command`, `.tool`, `.terminal`, `.scpt`, `.lnk`, `.url`, `.desktop`…), e um tipo novo do sistema passa calado |

- Nothing else in this change is hard to reverse

## Criteria

### S1: A API exige credencial em qualquer grafia de rota (P1)

Nenhuma rota sob `/api/` responde sem credencial, independentemente de como o caminho foi
codificado.

**Acceptance Criteria**

1. WHEN `GET /%61pi/settings` arrives with no token THEN the API SHALL answer `401` with `error.code` `"unauthorized"`
2. WHEN `PUT /%61pi/settings` arrives with no token and a body changing `securityProfile` THEN the API SHALL answer `401` and the stored `securityProfile` SHALL stay unchanged
3. WHEN `POST /%61pi/pair/start` arrives with no token THEN the API SHALL answer `401` and no pairing code SHALL be created
4. WHEN `POST /api/backups` arrives as `POST /%2Fapi/backups` or `POST /%61%70%69/backups` with no token THEN the API SHALL answer `401` or `404`, never `200`
5. The API SHALL answer `GET /api/meta` with `200` and no token
6. The API SHALL let `POST /api/pair/claim` reach its handler with no token (a wrong code answers the handler's own error `pair_failed`, never `error.code` `"unauthorized"`)

**Independent test:** `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/%61pi/settings` prints `401`.

### S2: O token mestre só vai para uma página aberta da própria máquina (P1)

**Acceptance Criteria**

7. IF a page request (`GET /`) comes from a non-loopback socket address with `Host: localhost:<port>` THEN the server SHALL serve the page with `<meta name="mordomo-token" content="" />`
8. WHEN a page request comes from socket `127.0.0.1` with `Host: 127.0.0.1:<port>` THEN the server SHALL inject the local token into the `mordomo-token` meta

**Independent test:** `app.inject({ url: "/", remoteAddress: "203.0.113.9", headers: { host: "localhost:4777" } })` returns an empty meta.

### S3: O broker de permissão não consegue aprovar nada (P1)

**Acceptance Criteria**

9. The broker environment built for a write run SHALL carry in `MORDOMO_TOKEN` a credential different from the local token
10. WHEN the Claude adapter builds a brokered invocation THEN no argument SHALL contain the broker credential or the local token, and `--mcp-config` SHALL be followed by a file path
11. The MCP config file SHALL have mode `0600` on POSIX
12. WHEN a brokered run reaches a terminal status THEN the MCP config file SHALL no longer exist
13. WHEN the broker credential calls `POST /api/approvals/:id/resolve` with `decision: "approved"` THEN the API SHALL answer `403` and the approval SHALL stay `pending`
14. WHEN the broker credential calls `POST /api/approvals/:id/resolve` with `decision: "denied"` on an approval of its own run THEN the API SHALL answer `200` and the approval SHALL be `denied`
15. WHEN the broker credential calls `POST /api/approvals/tool` for its own run THEN the API SHALL answer `200` with a `pending` approval
16. IF the broker credential acts on an approval or a `runId` of another run THEN the API SHALL answer `403`
17. IF the broker credential calls any other route (e.g. `GET /api/settings`) THEN the API SHALL answer `403`
18. IF the broker credential is used after its run left `queued`/`running` THEN the API SHALL answer `401`

**Independent test:** criar uma execução em modo escrita, pegar `MORDOMO_TOKEN` do broker e tentar aprovar: `403`.

### S4: Abrir um arquivo nunca executa nada (P1)

**Acceptance Criteria**

19. IF `POST /api/memory/open` targets a file whose extension is outside `OPENABLE_EXTENSIONS` (e.g. `run.command`, `Tool.app`, `x.sh`, `setup.exe`) THEN the API SHALL answer `415` with `error.code` `"unsupported_type"` and SHALL NOT spawn any process
20. WHEN `POST /api/memory/open` targets a `.md` file inside a granted root THEN the API SHALL answer `200` with `opened` equal to the resolved path
21. The opener for `win32` SHALL be `explorer.exe` with the path as its only argument, never `cmd`

**Independent test:** criar `x.command` numa pasta indexada e chamar `memory/open`: `415`, nenhum processo.

### S5: Um prompt nunca vira opção do CLI (P2)

**Acceptance Criteria**

22. IF a run prompt begins with `-` THEN the Codex invocation SHALL end with a prompt argument that does not begin with `-`
23. IF a run prompt begins with `-` THEN the Cursor invocation SHALL end with a prompt argument that does not begin with `-`

**Independent test:** `buildInvocation({ prompt: "--help", … })` no Codex: o último argumento é `" --help"`.

### S6: O modelo de ameaças descreve o que o código faz (P2)

**Acceptance Criteria**

24. The document `docs/security.md` SHALL describe the deny-by-default route rule, the broker credential scope, the socket-address condition for token injection and the `memory/open` allowlist

**Independent test:** ler a seção nova de `docs/security.md`.

## Out of scope

| Excluded                                                                | Why                                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Escopos para token de dispositivo e aprovação pelo Telegram por usuário | feature 7 `api-v1`, que redesenha os escopos de todos os tokens          |
| Allowlist do ambiente dos processos filhos                              | feature 4 `capacidades-aplicadas`                                        |
| Impedir o agente de ler `config/token` no disco                         | exige sandbox do sistema operacional; o agente roda como o mesmo usuário |
| Segredos no keychain e certificado TLS de até 825 dias                  | feature 7 `api-v1`                                                       |
| Remover o zip do histórico do git                                       | reescreve a `main` com force-push; decisão do dono                       |
| Rate limit e `/api/v1`                                                  | feature 7 `api-v1`                                                       |

## Assumptions

| Assumption                           | Chosen default                                                       | Rationale                                                                                                                       | Confirmed? |
| ------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Prefixo do prompt que começa com `-` | prefixar um espaço (`" --help"`)                                     | não depende de suporte a `--` nos CLIs, que não dá para confirmar aqui sem eles instalados; um espaço inicial não muda o pedido | n          |
| Onde fica o arquivo MCP              | diretório de `fs.mkdtemp` em `os.tmpdir()`, 0700, arquivo 0600       | fora de `artifacts/`, que o usuário vê e o agente lista                                                                         | n          |
| Pasta como alvo de `memory/open`     | permitida quando não tem extensão; `.app` é pasta e cai na allowlist | abrir pasta no gerenciador de arquivos é um uso real da tela do Cérebro                                                         | n          |
| `?token=` na query                   | continua aceito em todas as rotas                                    | o SSE depende dele; restringir é parte da `api-v1`                                                                              | n          |

**Open questions:** none - all resolved or logged above.

## Observable

| Surface                          | Decision                             | Landing                                                          |
| -------------------------------- | ------------------------------------ | ---------------------------------------------------------------- |
| API `ANY /api/*`                 | error shape and codes                | AC 1, AC 17, AC 18                                               |
| API `ANY /api/*`                 | who may call it                      | AC 1-6, AC 13-18                                                 |
| API `ANY /api/*`                 | versioning, rate limits              | n/a - feature 7 `api-v1`                                         |
| API `POST /api/approvals/*`      | response shape                       | existing - aprovação inteira, sem mudança                        |
| API `POST /api/memory/open`      | error shape and codes                | AC 19                                                            |
| API `POST /api/memory/open`      | who may call it                      | AC 1 (mesma regra de todas as rotas)                             |
| screen `Command Centre (index)`  | unauthorised state                   | AC 7 - página sem token cai no fluxo de pareamento que já existe |
| screen `Command Centre (index)`  | empty, loading, error                | n/a - a página não muda, só o valor injetado                     |
| command `mordomo mcp permission` | output format, exit codes            | existing - `permission.ts` não muda; continua negando em timeout |
| document `docs/security.md`      | structure, what the reader does next | AC 24                                                            |

## Sources

- Análise crítica de 06/10/2026 (nesta sessão) - achados C1, C2, H1, H3 e S3, reproduzidos contra `apps/api/dist`
- `docs/security.md` - modelo de ameaças atual (T1, T2)
