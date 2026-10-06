# Segurança P0 checks

Profile: standard
Plan: `.specs/features/seguranca-p0/plan.md`

34 checks in 7 slices · 3 one-way doors · 0 open, of which 0 block

Comandos (da raiz do repositório; o `vitest.config.ts` da raiz já roda `tests/**/*.test.ts`):

- `npx vitest run tests/api.security-p0.test.ts -t "<nome>"`
- `npx vitest run tests/adapters.security-p0.test.ts -t "<nome>"`

## Checks

### S1 - credencial em qualquer grafia · 3 files · 46 KB · ~12k

**C1** - `GET /%61pi/settings` sem token responde `401` com `error.code` `"unauthorized"` (AC 1)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C1 encoded GET without a token is 401"`
Status: closed

**C2** - `PUT /%61pi/settings` sem token responde `401` e o `securityProfile` salvo não muda (AC 2)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C2 encoded PUT without a token is 401 and changes nothing"`
Status: closed

**C3** - `POST /%61pi/pair/start` sem token responde `401` e nenhum código de pareamento é criado (AC 3)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C3 encoded pair start without a token is 401"`
Status: closed

**C4** - `POST /%2Fapi/backups`, `POST /%61%70%69/backups` e `POST /API/backups` sem token respondem `401` ou `404`, nunca `200`, e nenhum backup é criado (AC 4)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C4 other spellings of a protected route never reach it"`
Status: closed

**C5** - `GET /api/meta` sem token responde `200` (AC 5)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C5 meta stays public"`
Status: closed

**C6** - Com o acesso remoto ligado, `POST /api/pair/claim` sem token com um código errado responde o erro do próprio handler (`error.code` `"pair_failed"`), nunca `"unauthorized"` (AC 6)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C6 pair claim stays public"`
Status: closed

### S2 - token da página · 1 file · 20 KB · ~5k

**C7** - `GET /` vindo do socket `203.0.113.9` com `Host: localhost:4777` traz `<meta name="mordomo-token" content="" />` (AC 7)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C7 a remote socket never gets the token in the page"`
Status: closed

**C8** - `GET /` vindo do socket `127.0.0.1` com `Host: 127.0.0.1:4777` traz o token local no meta (AC 8)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C8 a loopback page gets the token"`
Status: closed

### S3 - broker sem poder de aprovar · 4 files · 70 KB · ~18k

**C9** - `permissionBrokerFor` de uma execução `review_before_write` devolve `env.MORDOMO_TOKEN` diferente do token local e começando com `brk_` (AC 9)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C9 the broker carries its own credential"`
Status: closed

**C10** - A invocação do Claude com broker não tem nenhum argumento contendo a credencial do broker nem o token local, e o argumento depois de `--mcp-config` é um caminho de arquivo existente (AC 10)
Proof: `npx vitest run tests/adapters.security-p0.test.ts -t "C10 the brokered claude invocation keeps secrets off argv"`
Status: closed

**C11** - O arquivo de configuração MCP tem modo `0600` (AC 11)
Proof: `npx vitest run tests/adapters.security-p0.test.ts -t "C11 the MCP config file is 0600"`
Status: closed

**C12** - Depois que a execução com broker termina (com sucesso ou falha), o arquivo de configuração MCP não existe mais (AC 12)
Proof: `npx vitest run tests/adapters.security-p0.test.ts -t "C12 the MCP config file is gone after the run"`
Status: closed

**C13** - Com a credencial do broker, `POST /api/approvals/:id/resolve` com `decision: "approved"` responde `403` e a aprovação continua `pending` (AC 13)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C13 the broker cannot approve"`
Status: closed

**C14** - Com a credencial do broker, negar uma aprovação da própria execução responde `200` e ela fica `denied` (AC 14)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C14 the broker can deny its own approval"`
Status: closed

**C15** - Com a credencial do broker, `POST /api/approvals/tool` da própria execução responde `200` com `status` `"pending"`, e `GET /api/approvals/:id` dessa aprovação responde `200` (AC 15)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C15 the broker raises and reads its own approval"`
Status: closed

**C16** - Com a credencial do broker de uma execução, agir sobre outra responde `403`: `POST /api/approvals/tool` com `runId` alheio, `GET /api/approvals/:id` alheio e `POST …/resolve` com `denied` alheio (AC 16)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C16 the broker cannot touch another run"`
Status: closed

**C17** - Com a credencial do broker, `GET /api/settings`, `POST /api/runs` e `POST /api/pair/start` respondem `403` (AC 17)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C17 the broker credential opens no other route"`
Status: closed

**C18** - Depois que a execução sai de `queued`/`running` (cancelada), a credencial do broker recebe `401` em `POST /api/approvals/tool` (AC 18)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C18 the broker credential dies with its run"`
Status: closed

### S4 - abrir arquivo não executa · 1 file · 12 KB · ~3k

**C19** - `POST /api/memory/open` para `run.command`, `Tool.app`, `x.sh` e `setup.exe` dentro de uma pasta concedida responde `415` com `error.code` `"unsupported_type"` e não chama o abridor (AC 19)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C19 executables are never opened"`
Status: closed

**C20** - `POST /api/memory/open` para um `.md` dentro de uma pasta concedida responde `200` com `opened` igual ao caminho resolvido (AC 20)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C20 a markdown note opens"`
Status: closed

**C21** - O abridor por plataforma é `open [p]` em `darwin`, `xdg-open [p]` em `linux` e `explorer.exe [p]` em `win32`; nenhum usa `cmd` (AC 21)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C21 the opener per platform never goes through cmd"`
Status: closed

**C25** - `POST /api/memory/open` fora das pastas concedidas responde `403` (Surface `POST /api/memory/open`)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C25 a path outside the roots is refused"`
Status: closed

### S5 - prompt nunca vira opção · 2 files · 22 KB · ~6k

**C22** - Com o prompt `--help`, o último argumento da invocação do Codex é `" --help"` (AC 22)
Proof: `npx vitest run tests/adapters.security-p0.test.ts -t "C22 a dashed prompt is never a codex flag"`
Status: closed

**C23** - Com o prompt `--help`, o último argumento da invocação do Cursor não começa com `-` (AC 23)
Proof: `npx vitest run tests/adapters.security-p0.test.ts -t "C23 a dashed prompt is never a cursor flag"`
Status: closed

### S6 - modelo de ameaças · 1 file · 6 KB · ~2k

**C24** - `docs/security.md` tem uma seção que nomeia a regra de rota negada por padrão (`config: { public: true }`), o escopo da credencial de broker (`brk_`), a condição de socket loopback para injetar o token e a allowlist `OPENABLE_EXTENSIONS` (AC 24)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C24 the threat model names the new rules"`
Status: closed

### Superfície que já existia (regressão do contrato)

**C26** - Com o token do dono, `POST /api/approvals/tool` para uma execução inexistente responde `404` e para uma execução terminada responde `409` (Surface `POST /api/approvals/tool`)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C26 approvals tool keeps 404 and 409 for the owner"`
Status: closed

**C27** - Com o token do dono, `GET /api/approvals/:id` e `POST /api/approvals/:id/resolve` de um id inexistente respondem `404` (Surface `GET /api/approvals/:id`, `POST /api/approvals/:id/resolve`)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C27 unknown approvals are 404 for the owner"`
Status: closed

**C28** - Com o token do dono, `POST /api/approvals/:id/resolve` com `decision: "approved"` continua respondendo `200` (o dono aprova)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C28 the owner still approves"`
Status: closed

### Rodada 2 - membros que a primeira verificação achou sem prova

**C29** - Com a execução em `running`, a credencial do broker cria (`200`), lê (`200`) e nega (`200`) a própria aprovação; quando a execução vai a `done`, recebe `401` (AC 15, AC 18)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C29 the broker credential works while its run is running and dies when it ends"`
Status: closed

**C30** - `POST /api/memory/open` abre uma pasta sem extensão (`200`) e recusa um arquivo sem extensão com `415` `unsupported_type`, sem chamar o abridor (AC 19, door 3)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C30 a folder opens, an extensionless file does not"`
Status: closed

**C31** - Cada uma das 26 extensões de `OPENABLE_EXTENSIONS`, em minúsculas e maiúsculas, abre com `200` (AC 20, door 3)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C31 every allow-listed type opens"`
Status: closed

**C32** - `GET /`, `GET /index.html` e o fallback da SPA (`/runs/abc`, `/brain`) vindos do socket `203.0.113.9` com `Host: localhost:4777` trazem o meta vazio (AC 7)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C32 every page route keeps the token from a remote socket"`
Status: closed

**C33** - Os sockets `127.0.0.1`, `127.0.0.2`, `::1` e `::ffff:127.0.0.1` recebem o token; `isLoopbackAddress` devolve `false` para `10.0.0.5`, `::ffff:10.0.0.5`, `fe80::1`, vazio e ausente (AC 8)
Proof: `npx vitest run tests/api.security-p0.test.ts -t "C33 every loopback socket form gets the token"`
Status: closed

**C34** - Abandonar o stream de uma execução do Claude com broker logo após o primeiro evento remove o diretório do arquivo MCP (AC 12)
Proof: `npx vitest run tests/adapters.security-p0.test.ts -t "C34 abandoning the stream after the first event removes the MCP config"`
Status: closed

## Coverage

| Set (size)                                     | Member -> proof                                                                                           | Unproven |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------- |
| grafias de rota protegida sem token (5)        | `%61pi` GET C1 · `%61pi` PUT C2 · `%61pi` POST C3 · `%2Fapi` C4 · `%61%70%69` C4                          | -        |
| caixa da rota protegida (1)                    | `/API/` C4                                                                                                | -        |
| rotas públicas (2)                             | `/api/meta` C5 · `/api/pair/claim` C6                                                                     | -        |
| `ANY /api/*` statuses (2)                      | 401 C1 · 403 C17                                                                                          | -        |
| socket da página (2)                           | não loopback C7, C32 · loopback C8, C33                                                                   | -        |
| rotas de página (4)                            | `/` C7 · `/index.html` C32 · fallback `/runs/abc` C32 · fallback `/brain` C32                             | -        |
| formas de endereço loopback (4)                | `127.0.0.1` C33 · `127.0.0.2` C33 · `::1` C33 · `::ffff:127.0.0.1` C33                                    | -        |
| escopo da credencial de broker (6 linhas)      | criar própria C15 · ler própria C15 · negar própria C14 · aprovar C13 · alheia C16 · outra rota C17       | -        |
| alvos alheios do broker (3)                    | `approvals/tool` C16 · `GET approvals/:id` C16 · `resolve denied` C16                                     | -        |
| estado da execução para a credencial (4)       | `queued` C15 · `running` C29 · `cancelled` C18 · `done` C29                                               | -        |
| `POST /api/approvals/:id/resolve` statuses (3) | 200 C14 · 403 C13 · 404 C27                                                                               | -        |
| `POST /api/approvals/tool` statuses (4)        | 200 C15 · 403 C16 · 404 C26 · 409 C26                                                                     | -        |
| `GET /api/approvals/:id` statuses (3)          | 200 C15 · 403 C16 · 404 C27                                                                               | -        |
| `POST /api/memory/open` statuses (3)           | 200 C20 · 403 C25 · 415 C19                                                                               | -        |
| extensões recusadas no teste (4)               | `.command` C19 · `.app` C19 · `.sh` C19 · `.exe` C19                                                      | -        |
| alvo sem extensão (2)                          | pasta C30 · arquivo C30                                                                                   | -        |
| `OPENABLE_EXTENSIONS` (26)                     | C31, table-driven over all 26, both cases                                                                 | -        |
| abridor por plataforma (3)                     | `darwin` C21 · `linux` C21 · `win32` C21                                                                  | -        |
| adaptadores com prompt posicional (2)          | codex C22 · cursor C23                                                                                    | -        |
| arquivo MCP: segredos, modo, ciclo de vida (4) | fora do argv C10 · `0600` C11 · apagado no fim C12 · apagado ao abandonar C34                             | -        |
| startup config: hook de auth (2 assemblies)    | `buildServer` (usado por `startServer` e pelos testes) C1 · listener TLS (emite no mesmo `app.server`) C1 | -        |
| doors (3)                                      | rota pública por config C5, C6 · credencial de broker C9, C13 · `OPENABLE_EXTENSIONS` C19, C20            | -        |

- Claims naming a status code, route or response shape: C1-C8, C13-C20, C25-C28 - each proof goes through `app.inject`, crossing the HTTP boundary
- C9 and C21 assert at their own layer (`permissionBrokerFor`, `openerFor`); C10-C12, C22, C23 assert on the adapter's invocation

## Test policy

O repositório diz onde ficam os testes (`tests/api.*`, `tests/adapters*`) e como montar um
servidor (`buildServer` + `inject`), mas não diz em que nível uma tabela de decisão se prova.

| Code                                                                               | Required proofs      | Coverage expectation                                              |
| ---------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------- |
| Decides, reached across a boundary (hook de auth, escopo do broker, `memory/open`) | one at the boundary  | one asserted case per row of the decision table, through `inject` |
| Decides, not reached across a boundary (`openerFor`, prefixo do prompt)            | one at its own layer | one asserted case per platform / adapter                          |
| Instrumentation (`permission.ts` `call()`)                                         | none of its own      | covered by the existing `tests/api.mcp.test.ts`                   |

Evidence:

- `apps/api/src/server.ts` hook `onRequest`: Host, rota pública, token, dispositivo, broker -> 5 branch points -> decides
- escopo do broker: rota (3) × decisão (approved/denied) × própria/alheia × ativa/terminada -> decides
- `routes/memory.ts` `memory/open`: contenção, extensão, plataforma (3) -> decides
- closest analogue in the repo: `tests/api.hardening.test.ts` ("host and token checks"), same shape, proven through `inject`

Cost: 2 test files, 28 proofs. Without these rows the broker's scope table is proven only by
the happy path in `tests/api.mcp.test.ts`, which mocks the HTTP calls.

## Swept

- validation: C19 (extensão), C22, C23 (prompt com `-`)
- failure modes: C12 (arquivo MCP apagado também quando a execução falha)
- idempotency: existing - `ApprovalStore.resolve` só atualiza `WHERE status = 'pending'`; negar duas vezes não muda nada
- authorization: C1-C6, C13-C18
- concurrency: n/a - a credencial é uma chave num `Map` mexido só no event loop; duas execuções têm credenciais distintas e o cruzamento entre elas é C16
- data lifecycle: C18 (credencial morre com a execução), C12 (arquivo apagado)
- dependency failure: existing - abridor ausente já é ignorado (`child.on("error")` em `routes/memory.ts`)
- state transitions: C18 (só `queued`/`running` valem)
- observability: existing - toda resposta 401/403 já sai no log `logs/api.jsonl` pelo hook `onResponse`, com status

## Handoff

- S1-S6 = ~46k tokens (server.ts 20 KB, routes/system.ts 30 KB, routes/memory.ts 12 KB, context.ts 14 KB, adapters claude/codex/cursor 37 KB, docs/security.md 6 KB, dois arquivos de teste novos ~20 KB ≈ 139 KB / 4 ≈ 35k, mais margem), abaixo do orçamento de 150k - one builder
