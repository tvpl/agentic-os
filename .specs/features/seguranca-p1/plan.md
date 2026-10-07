# Segurança P1 — o que a revisão de arquitetura achou e que não pode esperar

## Problem

A revisão de arquitetura de 07/10/2026 achou quatro falhas pequenas e reais. Uma delas eu confirmei
executando contra um home temporário: `previewFile(settings, [home], "<home>/config/token")` devolve
os 64 caracteres do token do dono. O home entra como raiz concedida na rota
`GET /api/memory/preview` (`apps/api/src/routes/memory.ts:127-131`), o filtro bloqueia só
`.git`, `.ssh`, `node_modules` e padrões de nome (`.env`, `*.pem`), e `token`, `vapid.json` (chave
privada do Web Push) e `registry-signing.json` não casam com nenhum. A rota não é `owner`, então um
dispositivo pareado, o caso do celular perdido, lê o token do dono e escala para dono.

Outras três, vindas da mesma leitura:

- `git diff` e `git status` da rota de diff (`routes/runs.ts:405-455`) rodam dentro do repositório que
  o agente acabou de editar, sem neutralizar `core.fsmonitor`, hooks nem `textconv`. Um agente em
  modo escrita que grave `core.fsmonitor=<comando>` em `.git/config` faz o comando rodar, como dono,
  no próximo clique em "ver diff".
- Os diretórios do home (`config/`, `config/db`, `logs`, `config/backups`) nascem com a máscara do
  processo, tipicamente 0755/0644 em máquina compartilhada, e guardam prompts, saídas e hashes de
  token. `getOrCreateToken()` (`core/src/config/store.ts:151-160`) verifica e depois grava, sem
  exclusividade: dois processos podem criar dois tokens. O `.gitignore` não cobre `vapid.json`,
  `registry-signing.json`, `config/tls/` nem os `.bak`, e num checkout de código-fonte o home padrão é
  a raiz do repositório.
- O SSE reinicia os ids a cada boot (`core/src/events.ts`); uma aba que reconecta com
  `Last-Event-ID: 1200` num serviço que reiniciou faz `apps/api/src/routes/events.ts:14-22` descartar
  todo evento com id ≤ 1200, e a interface fica muda até o contador passar disso.

Evidência: revisão de arquitetura de 07/10/2026 (itens 6.1, 6.3, 6.4 e 3) e a prova de execução acima.

## Flow

Reutiliza `makeWorkspaceFilter`/`isHardBlockedPath` (`core/src/memory/excludes.ts`, exists), `safeSpawn`
(exists), `ensureDirs` (`core/src/paths.ts`, exists), `SettingsStore` (exists), `openSse`
(`apps/api/src/routes/sse.ts`, exists).

1. Home → `core/src/memory/excludes.ts` (exists): a lista de diretórios bloqueados ganha o diretório
   `config` e `logs` **do home** (door 1) para pré-visualização, abertura e indexação; as rotas
   `preview` e `open`, o indexador e o diff passam pelo mesmo filtro.
2. Git → `routes/runs.ts` (exists) `git()`: toda chamada leva `-c core.fsmonitor=false -c
core.hooksPath=<dispositivo nulo> -c core.sshCommand= -c protocol.ext.allow=never`, `--no-textconv`
   e `--no-ext-diff`, e o ambiente `GIT_CONFIG_NOSYSTEM=1` e `GIT_CONFIG_GLOBAL=<dispositivo nulo>`.
3. Permissões → `ensureDirs` cria `config`, `config/db`, `config/backups`, `logs` e `config/run` com
   modo `0o700`; o banco, os backups e os logs nascem `0o600`; `getOrCreateToken()` cria o arquivo
   com `wx` e, se perder a corrida, lê o token que o outro processo gravou. Em Windows o modo é
   ignorado, e isso fica dito no `docs/security.md`.
4. Ignore → `.gitignore` (exists) passa a ignorar `config/*`, salvo uma lista explícita do que é versionável
   (nada hoje), e `*.bak`.
5. SSE → `openSse` (exists): se `Last-Event-ID`/`?since` for maior que o último id do processo
   (door 2), o servidor ignora o ponto de retomada, reenvia o anel e manda `stream.reset` como
   primeiro quadro; a interface, ao receber `stream.reset`, invalida suas consultas, como já faz em
   `stream.reconnected`.

## Impact

| Front       | What changes                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| domain      | termo existente: raiz concedida - o home continua sendo raiz para `memory/`, `skills/` e `artifacts/`, mas `config/` e `logs/` dele nunca são lidos pela API |
| contrato    | API: `GET /api/memory/preview` e `POST /api/memory/open` sobre `<home>/config/**` e `<home>/logs/**` respondem `403 forbidden_path` (antes `200`)            |
| contrato    | SSE: novo evento `stream.reset`, enviado quando o ponto de retomada é maior que o último id; `OsEventMap` o ganha                                            |
| stored data | modos de arquivo: diretórios 0700, banco/backups/logs 0600 nos homes novos; um home existente é corrigido na próxima inicialização (`chmod`)                 |

## Relations

None - no stored-data shape change

## Surface

| Route                     | In                                   | Out                             | Status                            |
| ------------------------- | ------------------------------------ | ------------------------------- | --------------------------------- |
| `GET /api/memory/preview` | `p` dentro de `<home>/config`/`logs` | `error.code` `"forbidden_path"` | `403` (antes `200`)               |
| `POST /api/memory/open`   | `p` dentro de `<home>/config`/`logs` | `error.code` `"forbidden_path"` | `403` (já era, agora pelo filtro) |
| `GET /api/events`         | `Last-Event-ID` > último id          | primeiro quadro `stream.reset`  | `200`                             |

## Landing

| One-way door                    | Literal shape                                                                                                                                                                                                                       | Alternative rejected                                                                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Bloqueio do `config` do home | os nomes `config` e `logs` entram em `HARD_BLOCKED_DIRS` **apenas quando o segmento é filho direto do home do MordomoOS** (`<home>/config`, `<home>/logs`); outros diretórios chamados `config` em pastas indexadas seguem legíveis | Bloquear qualquer diretório chamado `config`: quebraria pastas de projeto indexadas pelo usuário, que têm `config/` legítimos                          |
| 2. Evento `stream.reset`        | `{ type: "stream.reset", payload: { lastId: number } }`, versão `v` 1, enviado uma vez, antes do replay                                                                                                                             | Prefixar o id do evento com uma época de boot: muda o formato do `id:` do SSE e de `Last-Event-ID` para todo cliente, de mão única; o evento é aditivo |

- Nothing else in this change is hard to reverse

## Criteria

### S1: O home do MordomoOS não é legível pela API (P0)

**Acceptance Criteria**

1. WHEN `GET /api/memory/preview` is asked for any file under `<home>/config` (token, vapid.json, registry-signing.json, settings.json, ui-preferences.json, db, tls, backups) or `<home>/logs` THEN the API SHALL answer `403` with `error.code` `"forbidden_path"` and SHALL NOT read the file
2. WHEN the path reaches the same files through `..`, a symlink inside a granted root, a different case (on case-insensitive file systems) or a trailing dot/slash THEN the answer SHALL be the same
3. WHEN `<home>/memory`, `<home>/skills` or `<home>/artifacts` files are previewed THEN they SHALL still be served
4. The indexer and `POST /api/memory/open` SHALL refuse `<home>/config/**` and `<home>/logs/**` through the same filter; a `config` directory inside an indexed user folder SHALL stay readable (door 1)

**Independent test:** `GET /api/memory/preview?p=<home>/config/token` responde `403`.

### S2: O diff do git não executa o que o repositório diz (P1)

**Acceptance Criteria**

5. WHEN the diff route runs `git` THEN every invocation SHALL carry `core.fsmonitor=false`, `core.hooksPath` pointing at the null device, `--no-textconv` and `--no-ext-diff`, and the environment SHALL set `GIT_CONFIG_NOSYSTEM=1` and `GIT_CONFIG_GLOBAL` to the null device
6. WHEN the repository config sets `core.fsmonitor` to a command that writes a marker file, `diff.<driver>.textconv` to such a command, or a `hooks/` script THEN asking for the diff SHALL NOT run any of them

**Independent test:** um repositório com `core.fsmonitor=touch /tmp/marca` não cria a marca ao pedir o diff.

### S3: Permissões e tokens (P1)

**Acceptance Criteria**

7. WHEN a new home is created THEN `config`, `config/db`, `config/backups`, `logs` and `config/run` SHALL be mode `0700`, and the database, backups and log files SHALL be `0600` (POSIX; on Windows this is documented as not applied)
8. WHEN the service starts on an existing home THEN it SHALL tighten those modes to the same values
9. WHEN two processes call `getOrCreateToken()` on a home without a token concurrently THEN both SHALL return the same token and the file SHALL hold exactly that token
10. The `.gitignore` SHALL ignore everything under `config/` except an explicit allowlist (empty today) and `*.bak`

**Independent test:** 20 processos criando o token ao mesmo tempo terminam com um único valor.

### S4: O SSE se recupera de um reinício (P1)

**Acceptance Criteria**

11. WHEN a client reconnects with `Last-Event-ID` (or `?since`) greater than the process's last event id THEN the first frame SHALL be `stream.reset` and the ring SHALL be replayed from the start, and live events SHALL be delivered afterwards
12. WHEN the Command Centre receives `stream.reset` THEN it SHALL invalidate its cached queries, as it does on `stream.reconnected`
13. WHEN `Last-Event-ID` is within the process's range THEN no `stream.reset` SHALL be sent and the replay SHALL behave as before

**Independent test:** uma aba com `Last-Event-ID: 1200` num serviço recém-reiniciado volta a receber eventos.

## Out of scope

| Excluded                                              | Why                                                                                                        |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Escopos de dispositivo (allowlist em vez de denylist) | feature `escopos-dispositivo`: a matriz de rotas e o transporte (TLS, ticket de SSE) merecem plano próprio |
| ACL de arquivos no Windows                            | exige API do sistema; documentado como não aplicado                                                        |
| Corrida de migração e lock por PID reciclado          | feature `dados-v2`                                                                                         |

## Assumptions

| Assumption                                | Chosen default                                                      | Rationale                                                                                       | Confirmed? |
| ----------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------- |
| `logs/` do home também é bloqueado        | sim                                                                 | guarda prompts e saídas de execuções, que a interface lê pela API de execuções, não por arquivo | n          |
| O dono lê o próprio `config/` fora da API | sim, pelo sistema de arquivos; a API é que não serve esses arquivos | a API é alcançável por dispositivos pareados                                                    | n          |

**Open questions:** none - all resolved or logged above.

## Observable

| Surface                       | Decision        | Landing                                     |
| ----------------------------- | --------------- | ------------------------------------------- |
| API `GET /api/memory/preview` | error shape     | AC 1-2 - `403 forbidden_path`               |
| API `GET /api/events`         | response shape  | AC 11, 13 - `stream.reset`                  |
| API (todas)                   | who may call it | existing - regra de auth das features 1 e 7 |

## Sources

- Revisão de arquitetura de 07/10/2026 (itens 3, 6.1, 6.3, 6.4) e a prova de execução contra um home temporário (`config/token` legível)
- `docs/security.md` - modelo de ameaça e o que não é coberto
