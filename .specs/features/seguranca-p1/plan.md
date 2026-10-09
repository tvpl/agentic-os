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

1. Home → `core/src/memory/excludes.ts` (exists): o filtro ganha `HOME_PRIVATE_DIRS`, o `config` e o
   `logs` **do home** (door 1), avaliados sobre o caminho real, para pré-visualização, abertura e
   indexação; as rotas `preview` e `open`, o indexador e o diff passam pelo mesmo filtro.
2. Git → `routes/runs.ts` (exists) `git()`: toda chamada leva `-c core.fsmonitor=false -c
core.hooksPath=<dispositivo nulo> -c core.sshCommand= -c protocol.ext.allow=never`, `--no-textconv`
   e `--no-ext-diff`, e o ambiente `GIT_CONFIG_NOSYSTEM=1` e `GIT_CONFIG_GLOBAL=<dispositivo nulo>`. O `git()` vira `runGit` em `routes/git.ts`; como nenhuma opção desliga `filter.<driver>.clean` (que o git roda ao comparar o arquivo), `diff` e `status` esvaziam por nome cada driver `filter.*` que o repositório declara, e `--ignore-submodules=all` impede entrar no repositório de um submódulo. O diff também passa pelo filtro de caminhos antes de rodar o git.
3. Permissões → `ensureDirs` cria `config`, `config/db`, `config/backups`, `logs` e `config/run` com
   modo `0o700`; o banco, os backups e os logs nascem `0o600`; `getOrCreateToken()` grava o
   token inteiro num arquivo temporário e o publica com `link(2)` (atômico e exclusivo; rodada 2),
   e quem perde a corrida lê o token que o outro processo gravou, sem esperar. Em Windows o modo é
   ignorado, e isso fica dito no `docs/security.md`.
4. Ignore → `.gitignore` (exists) passa a ignorar `config/*`, salvo uma lista explícita do que é versionável
   (nada hoje), e `*.bak`.
5. SSE → `openSse` (exists): se `Last-Event-ID`/`?since` for maior que o último id do processo
   (door 2), o servidor ignora o ponto de retomada, reenvia o anel e manda `stream.reset` como
   primeiro quadro; a interface, ao receber `stream.reset`, invalida suas consultas, como já faz em
   `stream.reconnected`.
6. Leitura (rodada 2) → `core/src/security/safeFs.ts` (new, door 3): preview, journal, sync, recall e
   índice, skills, artifacts, routers, lojas de rotinas e conectores, indexador e evidência de
   objetivo leem por ele; o filtro de `excludes.ts` é avaliado ali, sobre o caminho real, e não na
   rota.
7. Diretório de trabalho (rodada 2) → `RunManager.resolveCwd` (door 4): `create` e o início da
   execução aplicam a regra; `MordomoEngine.resolveCwd` delega a ela; o agendador só trata a recusa
   (histórico `failed_to_fire`).
8. Git (rodada 3) → `routes/git.ts` `runGit` e `routes/runs.ts` `runFileDiff`: o pathspec é literal
   (`--literal-pathspecs`, `GIT_LITERAL_PATHSPECS=1`), `--git-dir`/`--work-tree` são explícitos e o
   ambiente `GIT_*` do serviço não é herdado; um repositório cujo `.git` não é um diretório real, que tem
   `alternates`/`commondir` ou cujo config faz `include` é recusado (o diff vira um instantâneo do arquivo);
   o diff lista os arquivos que o pathspec cobre (`diff --name-only -z`) e passa cada um pelo filtro antes de
   pedir o conteúdo.
9. Diretório de trabalho padrão (rodada 3) → `RunManager.resolveCwd` e `defaultCwd` (door 4): um `cwd`
   ausente, ou o próprio home, vira `<home>/workspace` (novo campo `MordomoPaths.workspace`, criado em
   `ensureDirs` e sob demanda); uma pasta concedida que contém o home é recusada; a execução de uma skill
   recebe a pasta da própria skill em `AgentRun.readDirs` (o Claude a recebe em `--add-dir`).
10. Escrita (rodada 3) → `core/src/security/safeFs.ts` (door 3): `writeWorkspaceFile` (substitui, acrescenta
    ou cria; recusa link no último componente, `O_NOFOLLOW`, sem truncar na abertura, descritor conferido),
    identidade de inode (um arquivo com mais de um nome que é um arquivo de `config/` ou `logs/` é recusado
    para leitura, escrita e listagem) e `copyTreeWithoutLinks` que lê e grava pelo primitivo; routers, notas
    e `SKILL.md` de skills, dia do journal, alvo do sync e desenho passam a escrever por ele; o detector
    (`tests/fsReadAudit.ts`) ganha as escritas e a lista de funções do `fs` vem de `@types/node`.

## Impact

| Front       | What changes                                                                                                                                                                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | termo existente: raiz concedida - o home continua sendo raiz para `memory/`, `skills/` e `artifacts/`, mas `config/` e `logs/` dele nunca são lidos pela API                                                                                                     |
| contrato    | API: `GET /api/memory/preview` e `POST /api/memory/open` sobre `<home>/config/**` e `<home>/logs/**` respondem `403 forbidden_path` (antes `200`)                                                                                                                |
| contrato    | SSE: novo evento `stream.reset`, enviado quando o ponto de retomada é maior que o último id; `OsEventMap` o ganha                                                                                                                                                |
| stored data | modos de arquivo: diretórios 0700, banco/backups/logs 0600 nos homes novos; um home existente é corrigido na próxima inicialização (`chmod`)                                                                                                                     |
| contrato    | API (rodada 2): journal, sync, recall, skills, artifacts, routers e as lojas de rotinas e conectores recusam arquivo que é, ou aponta para, `<home>/config/**` ou `<home>/logs/**`; rotina, repetição e continuação recusam `cwd` privado (`403 forbidden_path`) |
| domain      | termo novo: leitor seguro (`core/src/security/safeFs.ts`) - o único caminho de leitura de um caminho escolhido por pedido, registro, linha do índice ou pasta gravável por agente; a regra do diretório de trabalho mora no `RunManager`                         |
| stored data | índice de memória: linhas de caminho que a política não permite mais (o `config/` do home) são removidas na partida e filtradas na leitura                                                                                                                       |
| stored data | rodada 3: pasta nova `<home>/workspace` (diretório de trabalho padrão; no `.gitignore`); execuções gravadas com `cwd` = home passam a rodar nela                                                                                                                 |
| contrato    | API (rodada 3): `POST /api/runs`, `POST /api/skills/:slug/run`, `POST /api/objectives/:id/dispatch` sem `cwd` (ou com o home) iniciam em `<home>/workspace`; uma pasta concedida que contém o home é `403 forbidden_path` (antes `200`, com o home como `cwd`)   |
| contrato    | tipo: `AgentRun.readDirs?: string[]` (pastas fora do `cwd` que a execução lê; a skill roda lendo a própria pasta); `ReadScope.realHomeDir`; `copyTreeWithoutLinks(fromScope, source, toScope, target, limits?)` muda de assinatura                               |

## Relations

None - no stored-data shape change

## Surface

| Route                                                                                        | In                                                                                           | Out                                                               | Status                                     |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------ |
| `GET /api/memory/preview`                                                                    | `p` dentro de `<home>/config`/`logs`                                                         | `error.code` `"forbidden_path"`                                   | `403` (antes `200`)                        |
| `POST /api/memory/open`                                                                      | `p` dentro de `<home>/config`/`logs`                                                         | `error.code` `"forbidden_path"`                                   | `403` (já era, agora pelo filtro)          |
| `GET /api/events`                                                                            | `Last-Event-ID` > último id                                                                  | primeiro quadro `stream.reset`                                    | `200`                                      |
| `POST /api/runs`                                                                             | `cwd` dentro de `<home>/config`/`logs`                                                       | `error.code` `"forbidden_path"`                                   | `403` (antes `200`)                        |
| `POST /api/skills/:slug/run`                                                                 | `cwd` dentro de `<home>/config`/`logs`                                                       | `error.code` `"forbidden_path"`                                   | `403` (antes `200`)                        |
| `POST /api/objectives/:id/dispatch`                                                          | `cwd` dentro de `<home>/config`/`logs`                                                       | `error.code` `"forbidden_path"`                                   | `403` (antes `200`)                        |
| `POST /api/sessions/:id/continue`                                                            | sessão com `cwd` agora privado ou revogado                                                   | `error.code` `"forbidden_path"`                                   | `403` (antes `200`)                        |
| `POST /api/runs/:id/children`                                                                | execução-mãe com `cwd` agora privado ou revogado                                             | `error.code` `"forbidden_path"`                                   | `403` (antes `200`)                        |
| `POST /api/runs/:id/retry`                                                                   | execução gravada com `cwd` agora privado ou revogado                                         | `error.code` `"forbidden_path"`                                   | `403` (antes `200`)                        |
| `POST /api/routines`, `PUT /api/routines/:id`                                                | `workingDir` dentro de `<home>/config`/`logs` ou fora das pastas concedidas                  | `error.code` `"forbidden_path"`                                   | `403` (antes `200`)                        |
| `POST /api/routines/:id/run`                                                                 | rotina gravada com `workingDir` agora privado ou revogado                                    | `error.code` `"forbidden_path"`; histórico `failed_to_fire`       | `403` (antes `200`)                        |
| `GET /api/memory/journal`, `POST /api/memory/journal/append`                                 | dia do journal que é link para fora de `memory/` (p.ex. `config/token`)                      | `error.code` `"forbidden_path"` (a janela `days` omite o dia)     | `403` (antes `200` com o conteúdo)         |
| `GET /api/sync/plan`, `POST /api/sync/apply`                                                 | `target` em `<home>/config`/`logs`; arquivo de instruções que é link para fora               | `403 forbidden_path`; ação `conflict` sem `diff`, não sobrescrita | `403` / `200` (antes `200` com o conteúdo) |
| `GET /api/memory/recall`, `GET /api/memory/search`                                           | linha do índice cujo caminho a política não permite (ou virou link)                          | a linha não volta (sem `excerpt`, sem `snippet`)                  | `200` (antes `200` com o conteúdo)         |
| `GET /api/skills/:slug`, `…/notes`, `…/resource`; `GET /api/artifacts/file`, `/raw`, `/list` | `SKILL.md`, notas ou artefato que é link para fora                                           | `403 forbidden_path` / `404` / item ausente da lista              | `403`, `404`, `200`                        |
| `GET /api/runs/:id/diff`                                                                     | arquivo rastreado que o filtro bloqueia (`.env`, `*.pem`); arquivo de `<home>/config`        | `kind: "unavailable"` sem rodar o git; `403 forbidden_path`       | `200` / `403`                              |
| `GET /api/runs/:id/diff` (rodada 3)                                                          | `file` que é padrão (`*`, `?env`, `[.]env`, `:(top).env`) ou diretório com arquivo bloqueado | `kind: "unavailable"`, nenhum byte do arquivo bloqueado           | `200`                                      |
| `GET /api/runs/:id/diff` (rodada 3)                                                          | repositório com `core.worktree`, `.git` arquivo/link, `alternates` ou `include`              | `kind: "snapshot"` do arquivo, nunca o diff de outro lugar        | `200`                                      |
| `POST /api/runs` (rodada 3)                                                                  | `cwd` ausente, ou o próprio home                                                             | execução com `cwd` `<home>/workspace`                             | `200` (antes: `cwd` = home)                |
| `POST /api/runs`, `POST /api/skills/:slug/run` (rodada 3)                                    | `cwd` = pasta concedida que contém o home                                                    | `error.code` `"forbidden_path"`                                   | `403` (antes `200`)                        |
| `POST /api/memory/routers`, `POST /api/skills/:slug/notes`, `POST /api/microapps/pixel/save` | alvo que é link, ou outro nome de um arquivo de `config/`/`logs/`                            | `error.code` `"forbidden_path"`; o alvo do link fica como estava  | `403` (antes `200`, o link foi seguido)    |

## Landing

| One-way door                                                                                     | Literal shape                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Alternative rejected                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Bloqueio do `config` do home (forma única, rodada 2: junta as linhas 1 e 3 do plano aprovado) | `HOME_PRIVATE_DIRS = ["config", "logs"]` em `excludes.ts`, avaliada pelo filtro sobre o **caminho real** contra `<home>/config` e `<home>/logs` (opções `{ homeDir, platform }`, `homeDir` obrigatório, escritas lexical e real), **apenas como filhos diretos do home**; os nomes **não** entram em `HARD_BLOCKED_DIRS`; `checkWorkspacePath` e `inspectPath` lançam `PathAccessError` (403 `forbidden_path`) em vez de devolver `kind: "blocked"`; outros diretórios chamados `config` em pastas indexadas seguem legíveis                                                                                                                                                                                                                                                                                                                                        | Bloquear qualquer diretório chamado `config`: quebraria pastas de projeto com `config/` legítimos. Pôr `config`/`logs` em `HARD_BLOCKED_DIRS` com teste de posição do segmento: a lista casa o nome em qualquer segmento e o teste de posição duplicaria a comparação de caminho, sem tratar symlink nem caixa; `kind: "blocked"` com 200 contradiz o AC 1 (403)                                                                      |
| 2. Evento `stream.reset`                                                                         | `{ type: "stream.reset", payload: { lastId: number } }`, versão `v` 1, enviado uma vez, antes do replay                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Prefixar o id do evento com uma época de boot: muda o formato do `id:` do SSE e de `Last-Event-ID` para todo cliente, de mão única; o evento é aditivo                                                                                                                                                                                                                                                                                |
| 3. O leitor seguro (rodada 2)                                                                    | `core/src/security/safeFs.ts`: `ReadScope { homeDir, roots, filter }`; `openWorkspaceFile` / `readWorkspaceFile` / `readWorkspaceText` (teto de bytes obrigatório), `statWorkspacePath`, `listWorkspaceDir`, `inspectPath` / `resolveReadable`, `assertWritablePath`; caminho real, raiz do escopo, filtro sobre o caminho real, `O_NOFOLLOW`, reverificação com o descritor aberto; rodada 3: `writeWorkspaceFile` (`replace`/`append`/`create`) e `copyTreeWithoutLinks(fromScope, source, toScope, target, limits)` pelo mesmo primitivo, e a identidade do inode (`nlink > 1` e mesmo `dev`/`ino` de um arquivo de `config/` ou `logs/` é recusado em leitura, escrita e listagem); todo leitor e todo escritor de `core/src` e `apps/api/src` com caminho não literal passa por ele ou consta, com motivo, na lista revisada de `tests/security-reads.test.ts` | Guardar na rota (a forma da rodada 1): protege a chamada escrita e nenhuma outra, e cada leitor novo esqueceu o filtro (journal, sync, recall). Recusar qualquer link simbólico na leitura: quebra `memory/` com links legítimos entre notas. Recusar todo arquivo com `nlink > 1`: quebra pastas do usuário com cópias por hard link (`cp -al`, rsync); a comparação de inode recusa só o que é o mesmo arquivo de `config/`/`logs/` |
| 4. A regra do diretório de trabalho (rodada 2)                                                   | `RunManager.resolveCwd(cwd?)`: dentro de uma pasta concedida, fora de `<home>/config` e `<home>/logs` e **fora de qualquer pasta que os contenha** (rodada 3: o home e as pastas acima dele); `cwd` ausente ou o próprio home resolvem para `<home>/workspace` (`defaultCwd`); aplicada por `RunManager.create` e de novo no início da execução; `MordomoEngine.resolveCwd` delega a ela; o diretório descartável de uma rotina `isolated` é feito por `RunManager.scratchDir` e é a única exceção                                                                                                                                                                                                                                                                                                                                                                  | Checar nas rotas (a forma da rodada 1): rotina, repetição e continuação ficaram de fora. Uma lista de chamadores no teste: não impede o chamador novo. Recusar o home como `cwd` com `403` (rodada 3): quebraria toda conversa gravada com `cwd` = home e o botão de skill sem `cwd`; mapear para `<home>/workspace` mantém a conversa e tira o token do alcance das ferramentas de arquivo do agente                                 |

- Nothing else in this change is hard to reverse

## Criteria

### S1: O home do MordomoOS não é legível pela API (P0)

**Acceptance Criteria**

1. WHEN `GET /api/memory/preview` is asked for any file under `<home>/config` (token, vapid.json, registry-signing.json, settings.json, ui-preferences.json, db, tls, backups) or `<home>/logs` THEN the API SHALL answer `403` with `error.code` `"forbidden_path"` and SHALL NOT read the file
2. WHEN the path reaches the same files through `..`, a symlink inside a granted root, a different case (on case-insensitive file systems) or a trailing dot/slash THEN the answer SHALL be the same
3. WHEN `<home>/memory`, `<home>/skills` or `<home>/artifacts` files are previewed THEN they SHALL still be served
4. WHEN a run is created or launched with a working directory outside the granted folders or inside `<home>/config` or `<home>/logs` THEN it SHALL be refused: `403` `forbidden_path` from every entry that takes the directory (a prompt run, a session continuation, a squad child, a skill run, an objective dispatch, the repeat of a stored run), and, for a routine, at create and edit (`403`) and at every fire (`403` and a `failed_to_fire` row in its history, no run created); `RunManager` applies the rule itself, at create and at launch, so no entry can skip it
   4a. The indexer and `POST /api/memory/open` SHALL refuse `<home>/config/**` and `<home>/logs/**` through the same filter, and so SHALL every other reader (AC 14); a `config` directory inside an indexed user folder SHALL stay readable (door 1)

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

### Rodada 2 - lacunas da primeira verificação (P1)

Acrescentada depois do FAIL da rodada 1 (`verification.md`): o dono do token foi lido por um dispositivo
pareado pelo journal, pelo plano de sync e pelo recall (a rota de preview estava fechada, as outras
não), e rotinas aceitavam `workingDir` sem validar. A causa comum: o guarda ficava onde a chamada é
escrita, não onde o arquivo é lido.

**Acceptance Criteria**

14. EVERY reader of a path that a request, a stored record, an index row or a folder an agent can write to chooses SHALL read it through the safe-read primitive (`core/src/security/safeFs.ts`, door 3); WHEN the file is, or links to, `<home>/config/**` or `<home>/logs/**` THEN the reader SHALL refuse it and never return its bytes: the journal (read and append), the sync plan and apply, recall and search, the skill catalog (`SKILL.md`, notes, resources), the artifacts (file, raw, list), the router files, the routine and connector stores, the indexer and the objective evidence
15. The files of `core/src` and `apps/api/src` outside a reviewed list SHALL NOT call a raw `fs` read API with a path that is not a literal, however it is imported, aliased or destructured (`tests/security-reads.test.ts` reads the code with the TypeScript type checker and lists each exception with its reason)
16. WHEN a run is created or launched THEN `RunManager` SHALL apply the working-directory rule itself (door 4); only agent processes started by `RunManager.execute` exist, and the isolated-routine scratch directory it makes is the one place outside the granted folders
17. WHEN the index holds rows for a path the policy no longer allows THEN the engine SHALL drop them at start, and search and recall SHALL not return them in the meantime
18. WHEN the diff route is asked for a tracked file the filter blocks (`.env`, `*.pem`) THEN it SHALL answer `unavailable` without running git; a tracked file under `<home>/config` SHALL be `403`; a home reached through a symlink and an indexed root that is a symlink SHALL be as private as the plain ones; `diff` and `status` SHALL carry `--ignore-submodules=all`
19. WHEN the event stream delivers `stream.reset` THEN the Command Centre SHALL re-read the notification feed from the server, as it does on `stream.reconnected`
20. The `docs/security.md` page SHALL say exactly what is guaranteed (the reads and the working directory above) and what is not: an agent with a shell reads whatever its operating-system user can (device scopes are the feature `escopos-dispositivo`), a hard link, Windows, writes through a link, and the engine's own files read raw
21. The `getOrCreateToken` function SHALL NOT block the event loop waiting for a rival process: the token is published complete and atomically, and the bounded wait stays only for file systems without hard links

**Independent test:** `ln -s <home>/config/token <home>/memory/journal/2026-01-02.md` e `GET /api/memory/journal?date=2026-01-02` com o token de um dispositivo: `403`, e o corpo não traz o token.

### Rodada 3 - lacunas da segunda verificação (P1)

Acrescentada depois do FAIL da rodada 2 (`verification.md`, `bbc4b56`): o diff ainda lia, por magia de pathspec e por
`core.worktree`, o que o filtro bloqueia (inclusive o token); uma execução `read_only` com o `cwd` padrão (o home) alcançava
`config/token`; escrever por um link (roteadores, notas) corrompia o token; um hard link o servia; a importação de pasta copiava
tudo e recursava; 13 mutantes sobreviveram. Emenda depois da aprovação, registrada como AD-011 em `.specs/STATE.md`. A causa
comum: a decisão era tomada sobre um caminho e o git ou o agente lia outro.

**Acceptance Criteria**

22. WHEN the diff route asks git for a file THEN every git call SHALL take the pathspec literally (`--literal-pathspecs` and `GIT_LITERAL_PATHSPECS=1`), SHALL name the git directory and the work tree itself (`--git-dir`, `--work-tree`; a `GIT_*` variable of the service is not inherited) and SHALL list the files the pathspec covers and run each through the workspace filter before the contents are asked for (one blocked file makes the answer `unavailable`); WHEN the repository's `.git` is not a real directory of the work tree, has `objects/info/alternates` or `commondir`, or its config includes another file THEN no git command SHALL run and the answer SHALL be a snapshot of the file
23. WHEN a run is created or launched with no `cwd`, or with the MordomoOS home as `cwd`, THEN it SHALL start in `<home>/workspace`; WHEN the `cwd` is a granted folder that holds the home's `config/` or `logs/` (a folder above the home) THEN `RunManager` SHALL refuse it (`403` `forbidden_path`); WHEN a skill runs from there THEN the run SHALL be given its own skill folder to read (`AgentRun.readDirs`) and nothing else outside the working directory
24. EVERY write the engine does into a folder an agent can write to (a router, a skill's `SKILL.md` and notes, a journal day, a sync target, a saved drawing, each file of an imported folder) SHALL go through `writeWorkspaceFile`; WHEN the target is a link (dangling ones included), is outside the scope or refused by the filter, or is another name for a file under `<home>/config` or `<home>/logs` THEN nothing SHALL be written (`403`) and the file behind the link SHALL be as it was
25. WHEN a file has more than one link and is the same file (device and inode) as one under `<home>/config` or `<home>/logs` THEN the safe reader SHALL refuse it for a read, a write and a listing, wherever its name lies; a file with several names that is not one of those SHALL still be read and written
26. WHEN a skill folder is imported THEN only its regular files SHALL be copied, read and written through the primitive: links, devices, secret file names, protected folders (`.git`, `node_modules`) and anything the filter refuses SHALL stay behind at any depth, a folder that holds the home's `config/` or `logs/` SHALL be refused, the target SHALL never be copied into itself, the copy SHALL be bounded (2 000 files, 8 MiB a file, 64 MiB, 12 levels), and a failed import SHALL leave no folder behind
27. The raw-`fs` detector SHALL cover the writes (`writeFile`, `appendFile`, `createWriteStream`, `truncate`, `chmod`, `chown`, `utimes`, `copyFile`, `cp`, in every form) with the same reviewed list, and SHALL derive the list of path-taking functions of `node:fs` and `node:fs/promises` from `@types/node`, so a function Node adds is classified before the build passes; `tightenMode` SHALL NOT follow a link; the engine SHALL drop the index rows the policy no longer allows when it starts

**Independent test:** um repositório com `.env` rastreado e alterado, `GET /api/runs/<id>/diff?file=<repo>/*` com o token de um dispositivo: sem o texto do `.env`; e `POST /api/runs` sem `cwd` cria uma execução com `cwd` = `<home>/workspace`.

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

| Surface                                       | Decision        | Landing                                     |
| --------------------------------------------- | --------------- | ------------------------------------------- |
| API `GET /api/memory/preview`                 | error shape     | AC 1-2 - `403 forbidden_path`               |
| API `GET /api/events`                         | response shape  | AC 11, 13 - `stream.reset`                  |
| API (todas)                                   | who may call it | existing - regra de auth das features 1 e 7 |
| API journal, sync, recall, rotinas, repetição | error shape     | AC 4, 14 - `403 forbidden_path`             |

## Sources

- Revisão de arquitetura de 07/10/2026 (itens 3, 6.1, 6.3, 6.4) e a prova de execução contra um home temporário (`config/token` legível)
- `docs/security.md` - modelo de ameaça e o que não é coberto
