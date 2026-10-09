# Segurança P1 checks

Profile: standard
Plan: `.specs/features/seguranca-p1/plan.md`

38 checks in 5 slices · 4 one-way doors · 0 open, of which 0 block

Comandos (da raiz): `npx vitest run tests/security-p1.test.ts -t "<nome>"`. As provas de git usam um
repositório temporário criado no teste (`git init`), e as de processo concorrente usam `fork` de um
script curto.

## Checks

### S1 - o home não é legível pela API · 4 files · 40 KB · ~10k

**C1** - `GET /api/memory/preview` com `p` = cada um de `config/token`, `config/vapid.json`, `config/registry-signing.json`, `config/settings.json`, `config/ui-preferences.json`, `config/db/mordomo.db`, `config/tls/key.pem`, `config/backups/x/a.json` e `logs/runs.jsonl` do home responde `403` `forbidden_path`, com um token de dispositivo e com o do dono (AC 1)
Proof: `npx vitest run tests/security-p1.test.ts -t "C1 no file under the home's config or logs is previewable"`
Status: closed

**C2** - O mesmo para `<home>/config/../config/token`, um symlink dentro de `<home>/memory` apontando para `config/token`, `<home>/CONFIG/token` (home em sistema insensível a caixa simulado pelo filtro), `<home>/config/token.` e `<home>/config//token` (AC 2)
Proof: `npx vitest run tests/security-p1.test.ts -t "C2 path tricks do not reach the config directory"`
Status: closed

**C3** - `<home>/memory/note.md`, `<home>/skills/x/SKILL.md` e `<home>/artifacts/r1/out.txt` continuam sendo pré-visualizados (`200`) (AC 3)
Proof: `npx vitest run tests/security-p1.test.ts -t "C3 memory, skills and artifacts stay previewable"`
Status: closed

**C4** - `POST /api/memory/open` e o indexador recusam `<home>/config/token` e `<home>/logs/x`; um arquivo `config/app.json` dentro de uma pasta indexada do usuário (fora do home) continua legível e indexável (AC 4, door 1)
Proof: `npx vitest run tests/security-p1.test.ts -t "C4 open and index refuse the home config; user config folders stay readable"`
Status: closed

### S2 - o diff não executa o repositório · 3 files · 30 KB · ~8k

**C5** - Toda chamada de `git` da rota de diff leva `core.fsmonitor=false`, `core.hooksPath` nulo, `--no-textconv`, `--no-ext-diff` e o ambiente `GIT_CONFIG_NOSYSTEM=1` e `GIT_CONFIG_GLOBAL` nulo (a função `git()` é exercitada com um `git` falso que registra argv e ambiente) (AC 5)
Proof: `npx vitest run tests/security-p1.test.ts -t "C5 every git call of the diff route is neutralised"`
Status: closed

**C6** - Num repositório real com `core.fsmonitor`, `diff.x.textconv` (com `.gitattributes`) e um hook configurados para criar um arquivo marcador, `GET /api/runs/:id/diff` devolve o diff e nenhum marcador aparece (AC 6)
Proof: `npx vitest run tests/security-p1.test.ts -t "C6 a hostile repository config does not run on diff"`
Status: closed

### S3 - permissões e tokens · 5 files · 50 KB · ~12k

**C7** - Num home novo (POSIX), `config`, `config/db`, `config/backups`, `logs` e `config/run` têm modo `0700`; `mordomo.db`, um backup criado e um arquivo de log têm `0600` (AC 7)
Proof: `npx vitest run tests/security-p1.test.ts -t "C7 a new home is private to its owner"`
Status: closed

**C8** - Num home existente com tudo em `0755`/`0644`, montar o motor corrige os modos para os mesmos valores; num home com o modo certo, não grava nada (mesmo `mtime`) (AC 8)
Proof: `npx vitest run tests/security-p1.test.ts -t "C8 an existing home is tightened once"`
Status: closed

**C9** - 20 processos filhos chamando `getOrCreateToken()` ao mesmo tempo num home sem token devolvem o mesmo valor, e o arquivo contém exatamente esse valor (AC 9)
Proof: `npx vitest run tests/security-p1.test.ts -t "C9 concurrent token creation agrees on one token"`
Status: closed

**C10** - `git check-ignore` confirma que `config/token`, `config/vapid.json`, `config/registry-signing.json`, `config/tls/key.pem`, `config/ui-preferences.json`, `config/db/mordomo.db`, `config/settings.json.v1.bak` e `x.bak` são ignorados, e que `core/src/config/store.ts` e `apps/command-centre/src/config/x.ts` (código sob uma pasta chamada `config` fora da raiz do home) não são (AC 10)
Proof: `npx vitest run tests/security-p1.test.ts -t "C10 private home files are git-ignored and source files are not"`
Status: closed

### S4 - o SSE se recupera · 4 files · 40 KB · ~10k

**C11** - Num servidor real, `GET /api/events` com `Last-Event-ID` maior que o último id manda `stream.reset` (com `lastId`) como primeiro quadro de dados, reenvia o anel e entrega um evento novo depois (AC 11)
Proof: `npx vitest run tests/security-p1.test.ts -t "C11 a stale resume point gets a stream reset"`
Status: closed

**C12** - Com `Last-Event-ID` dentro da faixa, ou ausente, nenhum `stream.reset` é enviado e o replay é o de antes (AC 13)
Proof: `npx vitest run tests/security-p1.test.ts -t "C12 an in-range resume point replays as before"`
Status: closed

**C13** - A interface, ao receber `stream.reset`, invalida suas consultas (o mapa de invalidação o inclui como `stream.reconnected`) (AC 12)
Proof: `npm run test -w apps/command-centre -- src/queries.test.ts -t "C13 a stream reset refreshes every query"`
Status: closed

**C14** - `OsEventMap` tem a chave `stream.reset` com `{ lastId: number }` e `v` 1 (door 2; o teste de tipos de eventos continua exaustivo nos dois sentidos)
Proof: `npx tsc -p typetests/tsconfig.json`
Status: closed

### Depois da construção - achado do builder

**C18** - `POST /api/runs`, com token de dispositivo e do dono, e com `cwd` = `<home>/config`, `<home>/config/db`, `<home>/config/tls` e `<home>/logs`, responde `403` `forbidden_path` (o `cwd` passa por `ctx.resolveCwd`, que aplica o filtro do home; `POST /api/skills/:slug/run` e `POST /api/objectives/:id/dispatch` usam o mesmo caminho); `<home>/memory` segue sendo um `cwd` válido (AC 4; fecha a rota pela qual um agente iniciado em `config/` leria o token)
Proof: `npx vitest run tests/security-p1.test.ts -t "C18 a run cannot start with its working directory in config or logs"`
Status: closed

### Fechamento

**C15** - `docs/security.md` descreve o bloqueio do home, o git neutralizado, os modos de arquivo (e que no Windows não se aplicam) e o `stream.reset`; a seção "Not covered" não lista mais o que foi coberto (AC 1-13)
Proof: `npx vitest run tests/security-p1.test.ts -t "C15 the security doc describes what is enforced"`
Status: closed

**C16** - A suíte da raiz e da interface, o typecheck e o lint saem `0` (AC 1-13)
Proof: `npm run typecheck && npm run lint`
Status: closed

**C17** - `tests/api.test.ts` "preview refuses secrets" continua passando e ganha um caso por arquivo secreto do home (regressão de C1 no teste antigo) (AC 1)
Proof: `npx vitest run tests/api.test.ts -t "preview"`
Status: closed

### Rodada 2 - lacunas da primeira verificação · 14 files · 150 KB · ~60k

Fecha o FAIL da rodada 1 (`verification.md`, commit `41d0fd6`): A1-A4 (o token do dono lido por um dispositivo
pareado pelo journal, pelo plano de sync, pelo recall e por uma rotina), os mutantes sobreviventes S1-S6 e
a qualidade de código. A causa comum era o guarda na chamada escrita (a rota) e não na leitura; a regra agora
é estrutural (leitor seguro, `RunManager` decidindo o diretório de trabalho, teste sobre a árvore sintática).
As provas C19-C27, C30-C32 e C34-C36 rodam com `npx vitest run tests/security-reads.test.ts -t "<nome>"`; a C28 em
`tests/security-p1.test.ts` e a C29 na interface. As provas de A2-A4 plantam um link simbólico REAL para
`<home>/config/token` e perguntam à rota, com o token de um dispositivo pareado e com o do dono, se o token
volta. O teste antigo `extra: production calls of the filter functions all pass an options argument` saiu: `homeDir`
passou a ser obrigatório por tipo em `previewFile`, `checkWorkspacePath`, `resolveOpenablePath`,
`makeWorkspaceFilter` e `MemoryIndexer`, e a varredura C32 cobre as leituras.

**C19** - O leitor seguro (`core/src/security/safeFs.ts`): recusa com `PathAccessError` o `config/token` e o `logs/` do home direto, por `..`, por link para o arquivo, por link para a pasta, por barra final, o que está fora das raízes do escopo, um nome inocente que aponta para `.env` ou para o token, e um link pendente; devolve `NotRegularFileError` para uma pasta e para um pipe sem travar; respeita o teto de bytes (truncado e `strict`); lista sem links; recusa a troca entre a checagem e a abertura (último componente virando link, pasta no caminho virando link para `config/`, pasta virando link para outro lugar inócuo, arquivo trocado depois de aberto); recusa escrever por um link (pendente inclusive); a regra de `cwd` recusa `config`, `config/db`, `logs`, link para `config` e `..` (AC 14, door 3)
Proof: `npx vitest run tests/security-reads.test.ts -t "C19 the safe-read primitive"`
Status: closed

**C20** - Com um link real `memory/journal/2026-01-02.md` -> `<home>/config/token`, `GET /api/memory/journal?date=2026-01-02` responde `403` `forbidden_path` sem o token, com o token de um dispositivo e com o do dono; a janela `?days=3` omite o dia e segue `200`; `POST /api/memory/journal/append` para esse dia responde `403` e o arquivo do token fica igual; um link pendente também é `403` e nada é criado; um link para outra nota dentro de `memory/` segue lido (`200`) e fora da lista `dates` (AC 14; A2)
Proof: `npx vitest run tests/security-reads.test.ts -t "C20 a journal day that is a link to the token is not served, not written through, not listed"`
Status: closed

**C21** - Com `CLAUDE.md` e `AGENTS.md` de uma pasta concedida sendo links reais para `<home>/config/token`, `GET /api/sync/plan?target=<pasta>` responde `200` sem o token, com as duas ações `conflict` e `diff` nulo, para o dispositivo e para o dono; `POST /api/sync/apply` do dono com os dois caminhos aprovados os devolve em `skippedConflicts`, deixa o token e os links como estavam; `target` = `<home>/config` e `<home>/logs` respondem `403` (AC 14; A3)
Proof: `npx vitest run tests/security-reads.test.ts -t "C21 a sync target whose instruction files are links to the token shows no token and is not written through"`
Status: closed

**C22** - `GET /api/memory/recall` e `GET /api/memory/search`, com o token de um dispositivo e com o do dono, não devolvem o token em três casos: (a) uma nota indexada e depois trocada por link para `<home>/config/token` (`answerContext` e `candidates` vazios), (b) linhas do índice de um home antigo que já indexou `config/token` (conteúdo incluído) - recall e busca não as devolvem, e `purgeExcluded()` remove exatamente essa linha e na segunda chamada nenhuma, (c) a nota é um arquivo comum quando o recall julga a linha e um link quando a abre (troca na janela) (AC 14, AC 17; A4)
Proof: `npx vitest run tests/security-reads.test.ts -t "C22 recall and search never return a file that is, or became, private"`
Status: closed

**C23** - `POST /api/routines` com `workingDir` = `<home>/config`, `<home>/config/db`, `<home>/config/tls` e `<home>/logs` responde `403` `forbidden_path` com o token de um dispositivo e com o do dono, e nada é gravado; `PUT /api/routines/:id` movendo uma rotina boa para `config/` responde `403` e a rotina fica em `workingDir` original; `POST /api/routines/:id/run` numa rotina gravada com `workingDir` privado, e noutra cujo `workingDir` saiu das pastas concedidas, responde `403`, grava uma linha `failed_to_fire` com a nota `Working directory refused:` por disparo e não cria execução; uma rotina `isolated` segue disparando e roda num diretório `mordomo-<id>-*` (AC 4, AC 16; A1)
Proof: `npx vitest run tests/security-reads.test.ts -t "C23 a routine cannot be pointed at config or logs: refused at create, at edit and at every fire"`
Status: closed

**C24** - Table-driven sobre as 11 entradas que recebem ou guardam um diretório de trabalho (`POST /api/runs`, `POST /api/skills/:slug/run`, `POST /api/objectives/:id/dispatch` com passo de prompt e com passo de skill, `POST /api/routines`, `PUT /api/routines/:id`, `POST /api/routines/:id/run` com `workingDir` gravado, `POST /api/runs/:id/retry` de prompt e de skill com `cwd` gravado, `POST /api/sessions/:id/continue` com `cwd` da sessão, `POST /api/runs/:id/children` com `cwd` da mãe) com `cwd` = `<home>/config`: `403` `forbidden_path` com dispositivo e dono e nenhuma execução criada, em três passadas - a pilha inteira, só a checagem da rota (`RunManager.create` troca por um que lança) e só a do `RunManager` (o `resolveCwd` das rotas trocado pela identidade) - para que remover uma das duas camadas apareça (AC 4, AC 16; S1, M11-M13)
Proof: `npx vitest run tests/security-reads.test.ts -t "C24 every entry that takes or keeps a working directory refuses config and logs"`
Status: closed

**C25** - `RunManager.create` lança `PathAccessError` para `config`, `config/db`, `logs`, um link para `config`, `..` até `config` e uma pasta fora das concedidas, e grava o caminho real das permitidas; uma execução enfileirada cujo `cwd` virou `config/` no banco, e outra cuja pasta saiu das concedidas, terminam `failed` sem que o adaptador seja chamado, e uma pasta boa chega ao adaptador; e a única chamada de `AgentAdapter.execute` em `core/src` e `apps/api/src` é a de `core/src/runs/runManager.ts` (AC 16)
Proof: `npx vitest run tests/security-reads.test.ts -t "C25 RunManager refuses a bad working directory itself: at create and at launch"`
Proof: `npx vitest run tests/security-reads.test.ts -t "starts an agent only through RunManager.execute"`
Status: closed

**C26** - Num repositório real em pasta concedida, com `.env` e `server.pem` rastreados e alterados, `GET /api/runs/:id/diff?file=` responde `200` com `kind: "unavailable"` e sem o texto do segredo, para dispositivo e dono, e `ok.txt` segue `kind: "git"` com `+two`; com o próprio home como repositório, o diff de `config/tracked.txt` rastreado responde `403` sem o conteúdo (AC 18; S2, M20)
Proof: `npx vitest run tests/security-reads.test.ts -t "C26 the diff of a tracked secret file is refused before git runs; a tracked config of the home is a 403"`
Status: closed

**C27** - Com o home alcançado por um link simbólico: o filtro (`homeDir` = o link) recusa `config/token` e `logs/x` nas duas grafias e deixa `memory/` passar, e o escopo recusa as duas; o indexador com o home como raiz indexada por link não indexa nada de `config/` nem de `logs/` (com `homeDir` real e com `homeDir` o link), e uma raiz indexada que é um link para `<home>/config` não indexa nada e conta `skippedExcluded` (AC 18; S3, M3, M9a, M9b)
Proof: `npx vitest run tests/security-reads.test.ts -t "C27 a home reached through a symlink, and an indexed root that is a symlink, stay private"`
Status: closed

**C28** - Toda chamada de `diff` leva `--ignore-submodules=all` e toda de `status` também, antes do `--` do pathspec (o `git` falso registra o argv) (AC 18; S4, M16, M16b)
Proof: `npx vitest run tests/security-p1.test.ts -t "C28 diff and status never enter a submodule's own repository"`
Status: closed

**C29** - Renderizado o `NotificationsProvider` real, `stream.reset` e `stream.reconnected` fazem a lista ser lida de novo do servidor (a lista passa de `first` para `after the restart` e há uma segunda chamada a `/api/notifications`), e um evento sem relação (`settings.changed`) não (AC 19; S5, M36)
Proof: `npm run test -w apps/command-centre -- src/hooks/useNotifications.reset.test.tsx -t "C29 the notification feed is re-read when the event stream loses its place"`
Status: closed

**C30** - Com links reais para `<home>/config/token`, nenhum destes devolve o token (dispositivo e dono): `GET /api/skills/linked` (SKILL.md link) `403`, `GET /api/skills` `200`, recurso link `404`, `GET /api/skills/:slug/notes` com NOTES.md link `403`, `GET /api/artifacts/file` e `/raw` com artefato link `403`, `GET /api/runs/:id/diff` de um arquivo que é link `403`, `GET /api/artifacts/list` e `/recent` `200` sem o link na lista, `GET /api/memory/routers/check` `200`, `GET /api/routines` e `GET /api/connectors` `200` com um `.json` link na pasta, e `POST /api/skills/import` do dono com `sourceDir` = `config` ou uma pasta de skill link `400/403` (AC 14)
Proof: `npx vitest run tests/security-reads.test.ts -t "C30 skills, notes, artifacts, routers and the engine's stores do not follow a link to the token"`
Status: closed

**C31** - O detector de leituras cruas do `fs` vê, pelo verificador de tipos, `fs.readFileSync(p)` (import padrão, nome nu `"fs"`, `import * as ns`, import nomeado com alias), `node:fs/promises` (padrão e nomeado), `fs.promises.readFile`, `createReadStream` com alias, desestruturação, a função guardada numa variável, entregue a `promisify`, passada como argumento, `import()` dinâmico, `createRequire`, todas as outras APIs de leitura e um template com substituição; e não sinaliza caminho literal, descritor (`fd`), escrita/existência/remoção, objeto, classe e sombra locais de mesmo nome, `FileHandle` já aberto, tipo e texto que citam a função (AC 15)
Proof: `npx vitest run tests/security-reads.test.ts -t "C31 the raw-read detector sees every way of calling fs"`
Status: closed

**C32** - Em `core/src` e `apps/api/src`, nenhuma chamada crua de leitura do `fs` com caminho não literal está fora da lista revisada (cada linha com o motivo e a contagem exata; linha sem código e código sem linha falham), o `realpath` aparece em um único arquivo (`core/src/security/paths.ts`), `realOrResolved` e `realpathOr` não existem mais, e os leitores do achado (journal, recall, preview, routers, catálogo de skills, lojas de rotinas e conectores, evidência de objetivo, rotas de memória, runs e skills) não têm leitura crua (AC 15, AC 14)
Proof: `npx vitest run tests/security-reads.test.ts -t "C32 every raw fs read in core/src and apps/api/src is on the reviewed list"`
Status: closed

**C33** - `docs/security.md` diz o que é garantido (o leitor seguro e a regra do `cwd` no `RunManager`, T3, T4, T15) e o que não é (agente com shell lê o que o usuário do SO lê, com `escopos-dispositivo` como a próxima feature; hard link; Windows sem `O_NOFOLLOW`; escrita por link; arquivos do motor lidos crus) (AC 20)
Proof: `npx vitest run tests/security-reads.test.ts -t "C33 the security doc says what the code guarantees, and what it does not"`
Status: closed

**C34** - `getOrCreateToken()` não espera um rival: o vencedor publica o token inteiro por `link(2)` sem deixar `.tmp`, o perdedor lê o do vencedor, um arquivo vazio é substituído na hora, `Atomics.wait` nunca é chamado, e num sistema de arquivos sem hard link (`link` lança `EPERM`) a criação exclusiva (`wx`) entrega um token gravado (AC 21; C9 segue provando os 20 processos)
Proof: `npx vitest run tests/security-reads.test.ts -t "C34 the token is created without blocking the process"`
Proof: `npx vitest run tests/security-p1.test.ts -t "C9 concurrent token creation agrees on one token"`
Status: closed

**C35** - O indexador lê pelo leitor seguro: um arquivo comum na lista da varredura que vira link para o token antes da leitura não entra no índice (nenhuma linha, nenhum texto com o token em `files_fts`) e a linha antiga sai (AC 14)
Proof: `npx vitest run tests/security-reads.test.ts -t "C35 the indexer reads through the primitive: a file swapped for a link after the scan never reaches the index"`
Status: closed

**C36** - A evidência de um passo de objetivo só lista (e só faz hash de) artefatos que ficam dentro de `artifacts/`: o link para o token fica de fora, o arquivo real traz `bytes` 13 e o hash do token não aparece (AC 14)
Proof: `npx vitest run tests/security-reads.test.ts -t "C36 the objective evidence hashes only artifacts that stay inside artifacts/"`
Status: closed

**C37** - `plan.md` e `checks.md` passam nos validadores sem erro (AC 14-21; S6)
Proof: `python3 .claude/skills/tlc-spec-lean/scripts/validate_plan.py .specs/features/seguranca-p1/plan.md && python3 .claude/skills/tlc-spec-lean/scripts/validate_checks.py .specs/features/seguranca-p1/checks.md`
Status: closed

**C38** - As suítes da raiz e da interface, o typecheck e o lint saem `0` (AC 1-21)
Proof: `npm run typecheck && npm run lint`
Status: closed

## Coverage

| Set (size)                                                                                   | Member -> proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Unproven |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| arquivos secretos do home (9)                                                                | token, vapid, registry-signing, settings, ui-preferences, db, tls key, backups, logs - C1, table-driven over all 9                                                                                                                                                                                                                                                                                                                                                                                                             | -        |
| truques de caminho (5)                                                                       | `..` C2 · symlink C2 · caixa C2 · ponto final C2 · barra dupla C2                                                                                                                                                                                                                                                                                                                                                                                                                                                              | -        |
| entradas que leem arquivos do home (3)                                                       | preview C1 · open C4 · indexador C4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | -        |
| diretórios do home que seguem legíveis (3)                                                   | memory C3 · skills C3 · artifacts C3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | -        |
| configurações do git neutralizadas (4)                                                       | fsmonitor C5, C6 · hooks C5, C6 · textconv C5, C6 · config global/sistema C5                                                                                                                                                                                                                                                                                                                                                                                                                                                   | -        |
| diretórios com modo restrito (5)                                                             | config C7 · db C7 · backups C7 · logs C7 · run C7                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | -        |
| arquivos com modo restrito (3)                                                               | banco C7 · backup C7 · log C7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | -        |
| situações do home quanto ao modo (3)                                                         | novo C7 · existente frouxo C8 · já certo C8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | -        |
| padrões do `.gitignore` (10)                                                                 | `config/token` C10 · `vapid.json` C10 · `registry-signing.json` C10 · `tls/key.pem` C10 · `ui-preferences.json` C10 · `db/mordomo.db` C10 · `settings.json.v1.bak` C10 · `x.bak` C10 · `core/src/config/store.ts` não ignorado C10 · `command-centre/src/config/x.ts` não ignorado C10                                                                                                                                                                                                                                         | -        |
| pontos de retomada do SSE (3)                                                                | acima do último id C11 · dentro da faixa C12 · ausente C12                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | -        |
| doors (4)                                                                                    | bloqueio do `config` do home C1-C4, C27 · `stream.reset` C11-C14, C29 · leitor seguro C19-C22, C30-C32, C35, C36 · regra do diretório de trabalho C23-C25                                                                                                                                                                                                                                                                                                                                                                      | -        |
| entradas que recebem ou guardam um diretório de trabalho (11)                                | `POST /api/runs` C24 · `POST /api/skills/:slug/run` C24 · `POST /api/objectives/:id/dispatch` passo de prompt C24 · `POST /api/objectives/:id/dispatch` passo de skill C24 · `POST /api/routines` C23, C24 · `PUT /api/routines/:id` C23, C24 · `POST /api/routines/:id/run` (disparo) C23, C24 · `POST /api/runs/:id/retry` prompt C24 · `POST /api/runs/:id/retry` skill C24 · `POST /api/sessions/:id/continue` C24 · `POST /api/runs/:id/children` C24.                                                                    | -        |
| camadas da regra do diretório de trabalho (3)                                                | checagem da rota C24 (segunda passada) · `RunManager.create` C24 (terceira passada), C25 · início da execução C25                                                                                                                                                                                                                                                                                                                                                                                                              | -        |
| leitores de caminho escolhido por pedido, registro, índice ou pasta gravável por agente (23) | preview C1, C2 · open C4 · journal (leitura, janela `days`, append) C20 · plano de sync C21 · apply do sync C21 · recall C22 · busca C22 · linhas antigas do índice C22 · `SKILL.md` C30 · notas de skill C30 · recurso de skill C30 · `artifacts/file` C30 · `artifacts/raw` C30 · `artifacts/list` C30 · `artifacts/recent` C30 · router check C30 · loja de rotinas C30 · loja de conectores C30 · importação de skill C30 · indexador C4, C27, C35 · evidência de objetivo C36 · diff git C26 · diff por snapshot C26, C30 | -        |
| garantias do leitor seguro (18)                                                              | fora das raízes C19 · `config`/`logs` direto C19 · `..` C19 · link para arquivo C19 · link para pasta C19 · nome secreto por link C19 · link pendente C19 · pasta C19 · pipe C19 · teto de bytes truncado C19 · teto `strict` C19 · listagem sem links C19 · `stat` C19 · troca do último componente C19 · troca de pasta para `config` C19 · troca de pasta para lugar inócuo C19 · arquivo trocado depois de aberto C19 · escrita por link C19                                                                               | -        |
| formas de chamar o `fs` que o detector sinaliza (16)                                         | import padrão C31 · nome nu `"fs"` C31 · `import * as ns` C31 · import nomeado com alias C31 · `fs/promises` padrão C31 · `fs/promises` nomeado C31 · `fs.promises` C31 · `createReadStream` com alias C31 · desestruturação C31 · função numa variável C31 · `promisify` C31 · função como argumento C31 · `import()` dinâmico C31 · `createRequire` C31 · todas as outras APIs C31 · template com substituição C31                                                                                                           | -        |
| formas que o detector não sinaliza (9)                                                       | caminho literal C31 · descritor C31 · escrita, existência e remoção C31 · objeto de mesmo nome C31 · classe de mesmo nome C31 · sombra local de `fs` C31 · `FileHandle` aberto C31 · tipo que cita a função C31 · texto e comentário C31                                                                                                                                                                                                                                                                                       | -        |
| tabela revisada de leituras cruas (1)                                                        | 40 linhas e a do leitor seguro, cada uma com contagem exata e motivo: C32 (linha sem código e código sem linha falham)                                                                                                                                                                                                                                                                                                                                                                                                         | -        |
| leituras do achado que saíram da lista (12 arquivos)                                         | journal C32 · recall C32 · preview C32 · routers C32 · plano de sync (resta o manifesto) C32 · catálogo de skills C32 · loja de rotinas C32 · loja de conectores C32 · evidência de objetivo C32 · rotas de memória C32 · rotas de runs C32 · rotas de skills C32                                                                                                                                                                                                                                                              | -        |
| rotas novas do `Surface` (13)                                                                | `POST /api/runs` C24 · `POST /api/skills/:slug/run` C24 · `POST /api/objectives/:id/dispatch` C24 · `POST /api/sessions/:id/continue` C24 · `POST /api/runs/:id/children` C24 · `POST /api/runs/:id/retry` C24 · `POST /api/routines`, `PUT /api/routines/:id` C23 · `POST /api/routines/:id/run` C23 · journal e append C20 · sync plan e apply C21 · recall e busca C22 · skills e artifacts C30 · `GET /api/runs/:id/diff` C26                                                                                              | -        |
| arquivos rastreados que o diff recusa (3)                                                    | `.env` C26 · `*.pem` C26 · `<home>/config/**` C26                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | -        |
| home e raiz indexada por link (4)                                                            | filtro com `homeDir` = link C27 · escopo com `homeDir` = link C27 · raiz indexada = home por link C27 · raiz indexada = `config` por link C27                                                                                                                                                                                                                                                                                                                                                                                  | -        |
| `--ignore-submodules=all` (2)                                                                | `diff` C28 · `status` C28                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | -        |
| tipos de evento que a interface relê (2)                                                     | `stream.reset` C29 · `stream.reconnected` C29                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | -        |
| caminhos da criação do token (4)                                                             | vencedor C34 · perdedor C34 · arquivo vazio C34 · sem hard link C34                                                                                                                                                                                                                                                                                                                                                                                                                                                            | -        |
| corrida de processos no token (1)                                                            | 20 processos C9                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | -        |
| afirmações do `docs/security.md` sobre o que não é garantido (5)                             | agente com shell C33 · hard link C33 · Windows C33 · escrita por link C33 · arquivos do motor lidos crus C33                                                                                                                                                                                                                                                                                                                                                                                                                   | -        |

O conjunto de entradas de diretório de trabalho foi recomposto com `rg -n 'cwd|workingDir' apps/api/src core/src`. Ficam fora, por usarem `ctx.paths.home` fixo ou `skill.dir` e entrarem em `RunManager.create` do mesmo jeito (C25): CLI, sentinelas, `notes/promote` e conectores. O conjunto de leitores foi recomposto com a varredura de C32 (toda leitura crua de `core/src` e `apps/api/src`), não com a lista do relatório da rodada 1.

- Claims naming a status code or route: C1, C2, C3, C6, C11, C12, C20-C24, C26, C30 - provados por `inject` ou servidor real, com dispositivo e dono

## Test policy

| Code                                                                                                                                               | Required proofs                                                                                                                                               | Coverage expectation                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Decides, reached across a boundary (preview, open, diff, SSE)                                                                                      | one at the boundary                                                                                                                                           | each file, trick and status                                                             |
| Decides, not reached across a boundary (filtro, modos, token, ignore)                                                                              | one at its own layer                                                                                                                                          | each member of each set                                                                 |
| Decides, reached across a boundary and shared (rodada 2: o leitor seguro e o `RunManager.resolveCwd`, atrás de rotas, do agendador e do indexador) | uma na fronteira de cada leitor/entrada, com um link REAL para o token e os dois principais, **e** uma na própria camada, uma por membro da tabela de decisão | cada leitor e cada entrada do conjunto; cada camada provada sozinha (a outra desligada) |
| Mechanical rule over the whole source (rodada 2: o detector de leituras cruas)                                                                     | uma prova de que o detector vê cada forma e uma de que não vê as inocentes, e uma sobre o código real                                                         | cada forma de chamada; a lista revisada com contagem exata                              |

Evidence:

- `core/src/memory/excludes.ts` filtro: caminho × raiz × segmento -> decides
- closest analogue in the repo: `tests/api.security-p0.test.ts` (a mesma forma: rota + arquivo secreto)
- `core/src/security/safeFs.ts`: 6 verificações em sequência (caminho real, raiz, filtro, `O_NOFOLLOW`, nova resolução, inode), 3 verificações de tipo/tamanho, 12 pontos de decisão -> decides; cada uma tem um membro em C19 (as sobrepostas, como `O_NOFOLLOW` e a nova resolução, não são separáveis por comportamento: a troca é pega pela outra, e o mutante de uma sozinha é equivalente)
- `core/src/runs/runManager.ts` `resolveCwd`/`create`/início da execução: 3 pontos de decisão (concedida, privada, diretório descartável) -> decides; C24 prova a rota e o `RunManager` cada um sozinho, C25 prova o `RunManager` direto
- `tests/security-reads.test.ts` C31/C32: o detector decide sobre 16 formas e 9 inocentes; análogo no repo: o teste de árvore sintática de `tests/api.v1.test.ts` (C10/C35 do api-v1)

Cost: 2 arquivos de teste novos (`tests/security-reads.test.ts`, `tests/fsReadAudit.ts`) e 1 de interface, 21 provas novas (C19-C38).

## Swept

- validation: C2 (variações de caminho), C19 (todas as formas de chegar a `config/`), C31 (formas de chamar o `fs`)
- failure modes: C9 (corrida de criação do token), C6 (repositório hostil), C19 (troca entre a checagem e a abertura), C34 (sem hard link)
- idempotency: C8 (corrigir o modo uma vez e não regravar), C22 (`purgeExcluded` na segunda chamada remove zero)
- authorization: C1 (dispositivo e dono), C20-C24, C26, C30 (dispositivo e dono em cada rota), regra de auth das features 1 e 7: existing
- concurrency: C9, C19 (trocas na janela), C34
- data lifecycle: C7, C8 (home novo e existente), C22 (linhas antigas do índice)
- dependency failure: C5 (git ausente ou configuração hostil não executam nada), C25 (adaptador nunca chamado quando o diretório é recusado)
- state transitions: n/a - nenhuma máquina de estados muda
- observability: C11 (o reset é um evento visível ao cliente), C23 (a recusa fica no histórico da rotina)

## Handoff

- S1-S4 ≈ 35k: excludes.ts 6 KB, preview.ts 6 KB, memory.ts rota 10 KB, runs.ts diff 10 KB, paths.ts 5 KB, store.ts 8 KB, sse.ts + events.ts 8 KB, queries.ts trecho 4 KB, docs 6 KB, teste novo ~30 KB ≈ 93 KB / 4 ≈ 23k, mais leitura - abaixo de 150k - one builder
- Rodada 2 ≈ 90k: `safeFs.ts` 14 KB, 14 leitores migrados ~60 KB, `RunManager`/engine/agendador/rotas 20 KB, testes ~90 KB, docs e specs 25 KB ≈ 210 KB / 4 ≈ 55k, mais leitura e 70 mutantes - abaixo de 150k - one builder
