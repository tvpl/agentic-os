# Dados v2 checks

Profile: standard
Plan: `.specs/features/dados-v2/plan.md`

43 checks in 4 slices · 7 one-way doors · 0 open, of which 0 block

Comandos (da raiz): `npx vitest run tests/<arquivo>.test.ts -t "<nome>"`. Os arquivos novos são
`tests/data.migration.test.ts` (S1), `tests/data.owner-lock.test.ts` (S2), `tests/data.settings.test.ts`
(S3) e `tests/data.backup.test.ts` (S4). As provas de processo concorrente seguem a de
`tests/security-p1.test.ts` C9: o teste empacota o código-fonte atual com `rolldown` num script de
filho (`tests/helpers/childBundle.ts`), sem depender de `dist/`, e alinha os filhos por um relógio
(`START_AT`). As provas da CLI (C38, C39, C37) executam o `apps/api/dist/cli.js` e, como
`tests/cli.test.ts`, ficam de fora com aviso quando o `dist` não existe (o portão roda `build:server`
antes). Uma migração lenta de teste é uma lista de `Migration` passada a `openDb(paths, migrations)`.

## Checks

### S1 - a migração do banco não corre entre processos · 3 files · 20 KB · ~6k

**C1** - Três processos chamando `openDb` ao mesmo tempo, sobre um banco em `user_version` 1 e uma lista de três migrações (a 2 cria uma tabela com `CREATE TABLE` simples e a 2 e a 3 dormem 250 ms), terminam com código 0, `user_version` = 3, e a tabela de marcas tem exatamente as linhas `1`, `2` e `3`, uma de cada (AC 1)
Proof: `npx vitest run tests/data.migration.test.ts -t "C1 three processes opening together apply each migration once"`
Status: closed

**C2** - Abrir um banco em `user_version` 1 com uma linha de dados e duas migrações pendentes escreve `config/backups/mordomo.db.v1.<carimbo>.bak`, que abre em `user_version` = 1 com a mesma linha e sem a tabela da migração 2, tem modo `0600` (POSIX) e é o `backupPath` devolvido (AC 2)
Proof: `npx vitest run tests/data.migration.test.ts -t "C2 the pre-migration snapshot is consistent and private"`
Status: closed

**C3** - Na corrida de C1, exatamente um processo devolve `fromVersion` 1 e `toVersion` 3; os outros dois devolvem `fromVersion` = `toVersion` = 3 e `backupPath` nulo, e `config/backups/` tem exatamente um arquivo `.bak` (AC 3)
Proof: `npx vitest run tests/data.migration.test.ts -t "C3 the processes that lost the race apply nothing and leave no backup"`
Status: closed

**C4** - Com a migração 3 lançando `boom-migration` depois de criar uma tabela, `openDb` lança `MigrationError` com `code` `"db_migration_failed"` e mensagem contendo `3`, `boom-migration` e o caminho do backup; `user_version` fica 1, a tabela da migração 2 e a da 3 não existem, e o arquivo abre de novo com a lista correta chegando a 3 (AC 4)
Proof: `npx vitest run tests/data.migration.test.ts -t "C4 a failing migration rolls everything back and names itself"`
Status: closed

**C5** - Um banco em `user_version` 99 faz `openDb` lançar `DbNewerVersionError` com `code` `"db_newer"` e mensagem contendo `99`, a versão mais nova conhecida e `Use that version or restore a compatible backup`; `config/backups/` fica vazio e o SHA-256 do arquivo do banco é o mesmo de antes (AC 5)
Proof: `npx vitest run tests/data.migration.test.ts -t "C5 a database from a newer version is refused untouched"`
Status: closed

**C6** - Com um banco em modo de diário `delete` (não WAL) em `user_version` 1 e outro processo segurando `BEGIN EXCLUSIVE` por 600 ms, `openDb` espera (levou ≥ 400 ms e < 5000 ms), devolve e deixa `user_version` = 2 e o modo de diário `wal` (AC 6)
Proof: `npx vitest run tests/data.migration.test.ts -t "C6 openDb waits for a busy lock, also before WAL"`
Status: closed

**C7** - As versões de `MIGRATIONS` são exatamente `1..N` em ordem, sem repetição, onde `N` é a quantidade de migrações (AC 7)
Proof: `npx vitest run tests/data.migration.test.ts -t "C7 MIGRATIONS is contiguous"`
Status: closed

**C8** - Abrir um arquivo que não existe cria o banco na versão mais nova com `backupPath` nulo; reabrir um banco já na versão mais nova devolve `fromVersion` = `toVersion` = a mais nova, `backupPath` nulo e não cria arquivo em `config/backups/` (AC 1, AC 2 - os estados de partida)
Proof: `npx vitest run tests/data.migration.test.ts -t "C8 fresh and up-to-date databases open without a backup"`
Status: closed

**C43** - `tightenMode` não abre descritor num arquivo que já tem o modo pedido nem num link, e abre (e muda o modo) quando difere; depois de `openDb`, `tightenHomeFiles` sobre uma home já privada não chama `fs.openSync` para `mordomo.db`, `mordomo.db-wal` nem `mordomo.db-shm`; e um banco de uma versão antiga com `-wal`/`-shm` em `0644` fica `0600` antes de a conexão abrir (AC 38)
Proof: `npx vitest run tests/data.migration.test.ts -t "C43 tightening never opens a file that already has its mode"`
Status: closed

### S2 - o lock de dono distingue o dono de um PID reciclado · 5 files · 60 KB · ~16k

**C9** - Depois de `start()`, `engine.lock` tem `v` = 2, `pid` = `process.pid`, `startedAt` numérico, `token` de 32 hex, e `procStart` igual a `processStartMarker(process.pid)`; um segundo motor em outra home grava um `token` diferente (AC 8)
Proof: `npx vitest run tests/data.owner-lock.test.ts -t "C9 the lock records the identity of its owner"`
Status: closed

**C10** - Com um processo filho vivo e um `engine.lock` que cita o PID dele com um `procStart` diferente do real, `start()` toma o lock (o `pid` passa a ser `process.pid`) e recupera a etapa semeada para `pending` (AC 9)
Proof: `npx vitest run tests/data.owner-lock.test.ts -t "C10 a recycled pid is taken over"`
Status: closed

**C11** - Com o mesmo filho vivo e o `engine.lock` com o `procStart` verdadeiro dele, `start()` lança `EngineLockedError` com `code` `"engine_locked"` e `holderPid` = o PID do filho, e a etapa continua `dispatched` (AC 10)
Proof: `npx vitest run tests/data.owner-lock.test.ts -t "C11 the real owner keeps the lock"`
Status: closed

**C12** - Com um `engine.lock` que registra `procStart` e uma sonda que diz PID vivo mas não consegue ler o início, `OwnerLock.acquire()` lança `EngineLockedError` e o arquivo do lock fica como estava (AC 11)
Proof: `npx vitest run tests/data.owner-lock.test.ts -t "C12 an unreadable start is never proof of staleness"`
Status: closed

**C13** - Um `engine.lock` sem `procStart` (formato antigo) com o PID de um processo vivo faz `start()` lançar `EngineLockedError`; com o PID `2 ** 30` (morto) `start()` toma o lock (AC 12)
Proof: `npx vitest run tests/data.owner-lock.test.ts -t "C13 a lock without procStart keeps the old rule"`
Status: closed

**C14** - `processStartMarker` com leitores injetados devolve `linux:<boot_id>:<starttime>` para um `stat` cujo nome de comando é `(a b) (c)` (o campo 22 depois do último `)`), `ps:<segundos>` para a saída `Thu Oct  9 12:00:00 2026` de `ps -o lstart=` lido com `TZ=UTC` e `LC_ALL=C`, `win:<ticks>` para a saída do PowerShell, e `null` quando o leitor lança, devolve vazio ou devolve texto que não casa (AC 13)
Proof: `npx vitest run tests/data.owner-lock.test.ts -t "C14 processStartMarker reads each platform and fails to null"`
Status: closed

**C15** - Em 30 rodadas, cada uma com um `engine.lock` obsoleto próprio e 4 processos tomando o lock no mesmo instante, exatamente um processo por rodada vence, os outros 3 recebem `EngineLockedError`, e o arquivo da rodada nomeia o `pid` do vencedor (AC 14)
Proof: `npx vitest run tests/data.owner-lock.test.ts -t "C15 stale takeover never produces two owners"`
Status: closed

**C16** - Um processo filho que tomou o lock e é morto com `SIGKILL` deixa o lock para trás; o `acquire()` seguinte do pai o toma (o `pid` passa a ser o do pai e o `token` muda) (AC 15)
Proof: `npx vitest run tests/data.owner-lock.test.ts -t "C16 a killed owner is replaced"`
Status: closed

**C17** - `close()` de um motor cujo `engine.lock` agora tem outro `token` (de um processo vivo) deixa o arquivo no lugar; `close()` de um motor com o próprio `token` o remove (AC 16)
Proof: `npx vitest run tests/data.owner-lock.test.ts -t "C17 release removes only its own lock"`
Status: closed

**C18** - Os comportamentos de lock que já existiam continuam: a suíte `S2 only the owner recovers` de `tests/core.engine.test.ts` (ausente, vivo de outro processo, PID morto, o próprio processo, ilegível, criado por `link` sem `.tmp`) passa sem mudança no arquivo (AC 17)
Proof: `npx vitest run tests/core.engine.test.ts -t "S2 only the owner recovers"`
Status: closed

### S3 - configurações toleram campo inválido · 4 files · 40 KB · ~10k

**C19** - Para cada um dos 27 campos de topo de `SettingsSchema`, um `settings.json` com um valor inválido só naquele campo (e valores não padrão nos outros) faz `load()` devolver o padrão daquele campo e o valor do arquivo em todos os outros 26, sem lançar (AC 18)
Proof: `npx vitest run tests/data.settings.test.ts -t "C19 an invalid value in any top-level field costs only that field"`
Status: closed

**C20** - `providers.claude.binaryPath` = `42` mantém `providers.claude.enabled` = `true` e `providers.cursor.model` do arquivo; `indexedFolders` com o segundo elemento sem `path` devolve o primeiro e o terceiro, nessa ordem; `limits.maxConcurrentRuns` = `99` vira `3` e `limits.logRetentionDays` = `7` do arquivo continua `7` (AC 19)
Proof: `npx vitest run tests/data.settings.test.ts -t "C20 a nested invalid value costs only that value"`
Status: closed

**C21** - Depois de um `load()` que descarta um campo, `config/settings.json.invalid` tem os bytes originais e modo `0600`; um segundo original diferente vai para `settings.json.invalid.<12 hex do SHA-256>` sem alterar o primeiro; repetir o `load()` do mesmo arquivo, ou de novo o mesmo original, não cria arquivo (AC 20)
Proof: `npx vitest run tests/data.settings.test.ts -t "C21 the original is preserved and never overwritten"`
Status: closed

**C22** - Um `settings.json` com indentação de tabulações, chaves fora de ordem e sem newline final fica byte a byte igual (mesmo SHA-256 e `mtime`) depois de um `load()` que descartou dois campos (AC 21)
Proof: `npx vitest run tests/data.settings.test.ts -t "C22 load never rewrites settings.json"`
Status: closed

**C23** - Um `load()` que descarta `port` e `limits.maxConcurrentRuns` escreve em `logs/settings.jsonl` duas linhas, uma com `path` `"port"` e uma com `"limits.maxConcurrentRuns"`, cada uma com `reason`; um segundo `load()` do mesmo arquivo não acrescenta linha, e depois de o arquivo mudar para outro inválido a linha nova aparece (AC 22)
Proof: `npx vitest run tests/data.settings.test.ts -t "C23 each dropped field is logged once per file version"`
Status: closed

**C24** - `update({ systemName: "X" })` sobre um arquivo com `port: "abc"` e `save()` sobre um arquivo que não é JSON deixam o `settings.json` novo gravado e os bytes de antes em `settings.json.invalid` (AC 23)
Proof: `npx vitest run tests/data.settings.test.ts -t "C24 save and update keep what they replace"`
Status: closed

**C25** - Um `settings.json` com `{` , com o texto `[]` e com `null` faz `load()` lançar com mensagem contendo `settings.json`, e deixa `settings.json.corrupt.<ts>` com os mesmos bytes (AC 24)
Proof: `npx vitest run tests/data.settings.test.ts -t "C25 a file that is not a JSON object still stops with the cause"`
Status: closed

**C26** - `limits.backupRetention` = `0`, `-1`, `1.5` e `"x"` no arquivo leem `10` com os outros `limits` intactos; `PUT /api/settings` com `limits.backupRetention` = `0` responde `400` e com `3` responde `200` e grava `3` (AC 25)
Proof: `npx vitest run tests/data.settings.test.ts -t "C26 backupRetention is an integer from 1 with default 10"`
Status: closed

### S4 - backups verificáveis, restauração atômica e retenção · 7 files · 150 KB · ~38k

**C27** - Um backup criado com um symlink dentro de `skills/` e arquivos em `memory/`, `config/db` e `config/settings.json` tem `manifest.json` na raiz com `version` 1, `algorithm` `"sha256"`, `files` igual ao conjunto de arquivos reais da pasta (menos o próprio manifesto), cada `sha256` e `size` iguais aos calculados à parte, e o symlink em `links` com o destino lido (AC 26)
Proof: `npx vitest run tests/data.backup.test.ts -t "C27 a backup carries a manifest of everything in it"`
Status: closed

**C28** - Com a cópia de `skills/` no staging adulterada logo depois de copiada (o original intacto), `restoreBackup` lança `backup_invalid`; com o original adulterado depois de copiado (a cópia intacta), restaura e os bytes instalados são os da cópia verificada (AC 27)
Proof: `npx vitest run tests/data.backup.test.ts -t "C28 the staged copies are what gets verified"`
Status: closed

**C29** - Para cada um destes sete defeitos num backup selado: um byte trocado sem mudar o tamanho (`checksum`), um arquivo truncado (`size`), um arquivo apagado (`missing`), um arquivo acrescentado (`unexpected`), um destino de symlink trocado (`link`), um banco válido editado por SQL (`checksum`) e um `manifest.json` ilegível, `restoreBackup` lança `BackupVerificationError` com `code` `"backup_invalid"` e `statusCode` 422 citando o caminho (exceto o manifesto), e depois da recusa os arquivos vivos têm o SHA-256 de antes, `listBackups` tem o mesmo número de backups (nenhuma cópia de segurança) e a home não tem pasta `.restore-*` (AC 28)
Proof: `npx vitest run tests/data.backup.test.ts -t "C29 any difference from the manifest refuses the restore and changes nothing"`
Status: closed

**C30** - Um backup sem `manifest.json` faz `restoreBackup` lançar `backup_unsealed` e não mudar nada; com `{ allowUnverified: true }` restaura e o arquivo vivo passa a ter o conteúdo do backup (AC 29)
Proof: `npx vitest run tests/data.backup.test.ts -t "C30 an unsealed backup needs allowUnverified"`
Status: closed

**C31** - Um filho que restaura e é morto com `SIGKILL` no k-ésimo `rename` do staging, para cada k de 1 ao total de renames da restauração, deixa uma home que `recoverInterruptedRestore` devolve ao estado de antes: os SHA-256 de todos os arquivos vivos são os de antes da restauração e não sobra pasta `.restore-*` (AC 30)
Proof: `npx vitest run tests/data.backup.test.ts -t "C31 a restore killed at any rename is rolled back"`
Status: closed

**C32** - O diário de uma restauração cujo processo dono está vivo (um filho vivo com o próprio `procStart`) não é tocado por `recoverInterruptedRestore`: a pasta `.restore-*` e os alvos movidos ficam como estavam (AC 30)
Proof: `npx vitest run tests/data.backup.test.ts -t "C32 a restore in progress is left alone"`
Status: closed

**C33** - Numa restauração com `mordomo.db-wal` e `mordomo.db-shm` presentes, os dois `rename` que os tiram do lugar acontecem antes do `rename` que instala o banco novo (AC 31)
Proof: `npx vitest run tests/data.backup.test.ts -t "C33 the sidecars leave before the database is replaced"`
Status: closed

**C34** - `POST /api/backups/:name/restore` responde `422` com `error.code` `"backup_invalid"` para um backup com um byte trocado e `"backup_unsealed"` para um sem manifesto, nos dois casos sem `config/restore-pending/`; responde `202` para um backup íntegro, `404` para um nome que não existe e `409` com uma execução ativa (AC 32)
Proof: `npx vitest run tests/data.backup.test.ts -t "C34 the restore route verifies before it stages"`
Status: closed

**C35** - Com uma restauração agendada cujo backup foi adulterado depois, `new AppContext(home, { applyPendingRestore: true })` não lança, os arquivos vivos continuam os de antes, `restoreRejectedAtBoot` tem `name` e `message`, `restoredAtBoot` é nulo e `readRestorePending` é nulo (AC 33)
Proof: `npx vitest run tests/data.backup.test.ts -t "C35 a rejected staged restore does not stop the service"`
Status: closed

**C36** - Com `keep` = 2 e esta home: 4 backups selados antigos, 1 legado (sem manifesto) mais antigo que todos, o selado mais antigo nomeado por `restore-pending`, e um symlink `full-link` para fora, `createBackup` publica o novo e deixa exatamente: o novo, o selado mais novo antes dele, o legado, o da `restore-pending` e o symlink; apagou os outros dois selados antigos (AC 34)
Proof: `npx vitest run tests/data.backup.test.ts -t "C36 retention deletes only sealed backups beyond the newest"`
Status: closed

**C37** - Com `limits.backupRetention` = 2, quatro `POST /api/backups` seguidos deixam 2 backups; e `mordomo backup` três vezes numa home com `backupRetention` 2 deixa 2 e imprime `removed 1 old backup(s)` na terceira (AC 35)
Proof: `npx vitest run tests/data.backup.test.ts -t "C37 the route and the CLI apply the configured retention"`
Status: closed

**C38** - `mordomo backup --list` imprime `unsealed` na linha de um backup sem manifesto e não nas de backups selados (AC 36)
Proof: `npx vitest run tests/data.backup.test.ts -t "C38 the CLI list marks unsealed backups"`
Status: closed

**C39** - `mordomo restore <backup legado>` sai com `1` e `stderr` contendo `--allow-unverified`; com `--allow-unverified` sai com `0`; `mordomo restore <backup adulterado>` sai com `1` e `stderr` com o caminho do arquivo; sem nome, sai com `2` (AC 28, AC 29, Surface)
Proof: `npx vitest run tests/data.backup.test.ts -t "C39 the restore command refuses unsealed and tampered backups"`
Status: closed

**C40** - Um backup feito com o banco em versão anterior à mais nova (3 migrações a menos), restaurado, é levado por `openDb` à versão mais nova com as linhas que tinha (AC 37)
Proof: `npx vitest run tests/data.backup.test.ts -t "C40 a backup from an older schema restores and migrates"`
Status: closed

### Transversais · 2 files · 100 KB · ~5k

**C41** - A lista revisada de leituras e escritas cruas de `fs` (`ALLOWED` em `tests/security-reads.test.ts`) bate exatamente com o código depois desta feature: nenhuma leitura crua nova fora da lista, nenhuma linha velha sobrando (todas as ACs)
Proof: `npx vitest run tests/security-reads.test.ts -t "finds nothing outside the list, and nothing on the list that is no longer there"`
Status: closed

**C42** - Os blocos que já provavam backup, restauração, configurações, migrações, preferências, restauração agendada e motor passam sem mudança nos seus arquivos (todas as ACs)
Proof: `npx vitest run tests/core.backup.test.ts -t "backup"`
Proof: `npx vitest run tests/core.foundation.test.ts -t "backup and restore"`
Proof: `npx vitest run tests/core.foundation.test.ts -t "settings store"`
Proof: `npx vitest run tests/core.foundation.test.ts -t "database migrations"`
Proof: `npx vitest run tests/preferences.test.ts -t "S1 migration without losing anything"`
Proof: `npx vitest run tests/api.hardening.test.ts -t "backup restore is staged, never against the open DB"`
Proof: `npx vitest run tests/api.engine.test.ts -t "the service owns the engine"`
Status: closed

## Coverage

| Set (size)                                          | Member -> proof                                                                                                                                                                                                                                                                                                                                                                                                            | Unproven |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| estados de partida de `openDb` (6)                  | arquivo novo C8 · já na versão nova C8 · abaixo da nova, sem dados C8, C4 · abaixo da nova, com dados C2 · migração que falha C4 · versão futura C5                                                                                                                                                                                                                                                                        | -        |
| quem abre o banco ao mesmo tempo (2)                | o que migra C1, C3 · o que perde a corrida C3                                                                                                                                                                                                                                                                                                                                                                              | -        |
| esperas por trava do banco (2)                      | WAL C1 · fora do WAL C6                                                                                                                                                                                                                                                                                                                                                                                                    | -        |
| estados do `engine.lock` em `start()` (9)           | ausente C9 · vivo de outro processo com o mesmo início C11 · vivo com início diferente (PID reciclado) C10 · vivo, início ilegível agora C12 · vivo, formato antigo C13 · morto C13, C16 · o próprio processo C18 · ilegível C18 · criado por `link` sem janela C9, C18                                                                                                                                                    | -        |
| plataformas de `processStartMarker` (4)             | Linux C14 · macOS/BSD (`ps`) C14 · Windows (PowerShell) C14 · leitura falha C14                                                                                                                                                                                                                                                                                                                                            | -        |
| rodadas de disputa pelo lock obsoleto (30)          | C15, table-driven over all 30 rounds                                                                                                                                                                                                                                                                                                                                                                                       | -        |
| quem libera o lock (2)                              | com o próprio `token` C17, C18 · com outro `token` C17                                                                                                                                                                                                                                                                                                                                                                     | -        |
| campos de topo de `SettingsSchema` (27)             | C19, table-driven over all 27, driven by the schema (`version`, `systemName`, `language`, `theme`, `accentColor`, `port`, `bindAddress`, `timezone`, `autostart`, `setupCompleted`, `defaultProvider`, `securityProfile`, `providers`, `remote`, `marketplace`, `updates`, `indexedFolders`, `excludes`, `areas`, `limits`, `favoriteSkills`, `memorySkills`, `routines`, `connectors`, `memory`, `sentinels`, `channels`) | -        |
| formas de valor inválido aninhado (3)               | propriedade de objeto C20 · elemento de array C20 · propriedade de objeto dentro de um registro C20                                                                                                                                                                                                                                                                                                                        | -        |
| destinos do original em `.invalid` (3)              | `settings.json.invalid` novo C21 · outro conteúdo, nome com hash C21 · mesmo conteúdo, nada novo C21                                                                                                                                                                                                                                                                                                                       | -        |
| arquivos que `save()`/`update()` substituem (2)     | com campo inválido C24 · que não é JSON C24                                                                                                                                                                                                                                                                                                                                                                                | -        |
| raízes de `settings.json` que continuam parando (3) | `{` C25 · `[]` C25 · `null` C25                                                                                                                                                                                                                                                                                                                                                                                            | -        |
| valores de `backupRetention` (6)                    | `0` C26 · `-1` C26 · `1.5` C26 · `"x"` C26 · API `0` → 400 C26 · API `3` → 200 C26                                                                                                                                                                                                                                                                                                                                         | -        |
| defeitos de um backup que a restauração recusa (7)  | byte trocado C29 · truncado C29 · apagado C29 · acrescentado C29 · destino de link C29 · banco válido editado C29 · manifesto ilegível C29                                                                                                                                                                                                                                                                                 | -        |
| tipos de problema do manifesto (5)                  | `checksum` C29 · `size` C29 · `missing` C29 · `unexpected` C29 · `link` C29                                                                                                                                                                                                                                                                                                                                                | -        |
| entradas que iniciam uma restauração (3)            | `mordomo restore` C30, C39 · `POST /api/backups/:name/restore` C34 · boot com restauração agendada C35 (todas chegam a `restoreBackup`: C28, C29)                                                                                                                                                                                                                                                                          | -        |
| estados de um backup quanto ao manifesto (3)        | selado e íntegro C28, C40 · selado e adulterado C29 · legado C30                                                                                                                                                                                                                                                                                                                                                           | -        |
| situações de uma restauração que não terminou (2)   | processo morto, em cada um dos k renames do staging (k lido do próprio teste) C31 · dono ainda vivo C32                                                                                                                                                                                                                                                                                                                    | -        |
| backups candidatos à retenção (6)                   | o novo C36 · selado além do `keep` C36 · selado dentro do `keep` C36 · legado C36 · o da `restore-pending` C36 · link C36                                                                                                                                                                                                                                                                                                  | -        |
| quem aplica a retenção configurada (2)              | `POST /api/backups` C37 · `mordomo backup` C37                                                                                                                                                                                                                                                                                                                                                                             | -        |
| `POST /api/backups/:name/restore` statuses (4)      | 202 C34 · 404 C34 · 409 C34 · 422 C34                                                                                                                                                                                                                                                                                                                                                                                      | -        |
| `PUT /api/settings` (campo novo) statuses (2)       | 200 C26 · 400 C26                                                                                                                                                                                                                                                                                                                                                                                                          | -        |
| `mordomo restore` saídas (3)                        | 0 C39 · 1 C39 · 2 C39                                                                                                                                                                                                                                                                                                                                                                                                      | -        |
| doors (7)                                           | 1 `engine.lock` C9, C10, C11, C13 · 2 `OwnerLock`/`EngineLockedError` C11, C12, C17 · 3 `BEGIN IMMEDIATE` C15 · 4 `.invalid` C21 · 5 `manifest.json` C27 · 6 `openDb`/erros C1, C4, C5 · 7 retenção e `BackupVerificationError` C26, C29, C36                                                                                                                                                                              | -        |

- Claims naming a status code, route or response shape: C26, C34, C39 - cada um tem uma prova que cruza a fronteira (rota via `app.inject`, CLI via o `dist`); C29 e C4/C5 provam `statusCode`/`code` na camada do core, que é onde o contrato novo vive, e a rota é C34
- As provas de C1, C3, C15, C16, C31 usam processos de verdade; nenhuma é substituída por dois motores no mesmo processo
- No other check claims more than the single case its proof exercises

## Test policy

| Code                                                                                                                                                                                     | Required proofs                                  | Coverage expectation                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decides, not reached across a boundary (`runMigrations`, `OwnerLock`, `processStartMarker`, `parseTolerant`, `backupManifest.verifyMounts`, `pruneBackups`, `recoverInterruptedRestore`) | one at its own layer                             | one asserted case per row of the decision table: cada estado do lock, cada tipo de problema do manifesto, cada candidato da retenção, cada campo de topo |
| Decides, reached across a boundary (`restoreBackup` pelo boot, pela CLI e pela rota; `SettingsStore.load()` por toda rota)                                                               | one at the boundary **and** one at its own layer | o contrato na fronteira (`422`, saída `1`); um caso por linha da tabela na camada do core                                                                |
| Instrumentation (a rota que repassa `keep`, a CLI que repassa a opção, o `server.ts` que imprime o aviso)                                                                                | none of its own                                  | coberta pela prova do consumidor (C34, C35, C37, C39)                                                                                                    |

Evidence:

- `core/src/db/db.ts` `runMigrations`: versão futura (2 pontos), nada pendente, pendente com dados, pendente sem dados, perdeu a corrida, migração falhou (7 branch points) -> decides
- `core/src/ownerLock.ts` (julgamento de obsolescência): ilegível, o próprio PID, PID morto, formato antigo, início registrado igual/diferente/ilegível (7 estados) -> decides
- `core/src/processIdentity.ts`: 3 plataformas, cada uma com leitura que pode falhar (6 branch points) -> decides
- `core/src/config/tolerant.ts`: valor inválido numa propriedade, num elemento de array, escalada quando o pai exige a chave, raiz irrecuperável (4 branch points) -> decides
- `core/src/backupManifest.ts` `verifyMounts`: 5 tipos de problema, montagem sem cópia (6 branch points) -> decides
- `core/src/backup.ts` `restoreBackup`/`recoverInterruptedRestore`: ordem verificar → cópia de segurança → instalar, rollback, diário (9 branch points) -> decides
- `apps/api/src/routes/system.ts` rota de restauração: repassa o erro do core -> instrumentation
- closest analogue in the repo: `tests/core.backup.test.ts` (a restauração provada no core, contra uma home temporária, com `vi.spyOn(fs, …)` para injetar falha) e `tests/core.engine.test.ts` (estados do lock), ambos já provados nesse nível

Cost: 4 arquivos de teste novos, 40 provas próprias e 1 ajuste da lista revisada de leituras de `fs`. Sem essas linhas, o lock só seria provado pelo caminho feliz, a corrida só por dois motores no mesmo processo (que o SQLite serializa por construção) e a verificação do backup por um único byte trocado.

## Swept

- validation: C19, C20, C25, C26 (configurações), C29 (manifesto), C5 (versão do banco)
- failure modes: C4 (migração que falha desfaz tudo), C29 (verificação falha sem tocar em nada), C31 (processo morto no meio da restauração), C35 (restauração recusada no boot não derruba o serviço)
- idempotency: C3 (a segunda abertura não reaplica), C21 (o mesmo original não vira dois arquivos), C23 (um aviso por versão do arquivo)
- authorization: existing - a rota de restauração e `POST /api/backups` já são `scope: "owner"` (`apps/api/src/routes/system.ts`); a CLI roda como o dono; o `.invalid`, o diário e o manifesto nascem `0600` em pastas `0700` (C2, C21)
- concurrency: C1, C3, C6 (banco), C15, C16 (lock), C32 (restauração de outro processo)
- data lifecycle: C36 (retenção), C21 (o `.invalid` nunca é apagado nem sobrescrito), C40 (backup antigo restaurado e migrado)
- dependency failure: C12 e C14 (o sistema não responde sobre o início do processo), C6 (o banco está travado por outro processo)
- state transitions: C10, C11, C13 (lock: dono → obsoleto → retomado), C28, C30 (backup: selado → verificado → instalado)
- observability: C23 (`logs/settings.jsonl`), C35 (`restoreRejectedAtBoot` e o aviso em `startServer`), C4 e C5 (as mensagens dos erros de migração)

## Out of scope

See the plan's `Out of scope`.

## Handoff

- S1 = db.ts 3 KB + migrations.ts (só o cabeçalho) 1 KB + teste novo ~14 KB ≈ 18 KB ≈ 5k
- S2 = engine.ts 23 KB, ownerLock.ts novo ~8 KB, processIdentity.ts novo ~4 KB, teste novo ~16 KB, core.engine.test.ts lido 15 KB ≈ 66 KB ≈ 17k
- S3 = store.ts 9 KB, tolerant.ts novo ~6 KB, settings.ts (trecho) ~3 KB, teste novo ~14 KB ≈ 32 KB ≈ 8k
- S4 = backup.ts 12 KB (reescrito ~20 KB), backupManifest.ts novo ~8 KB, system.ts (trecho) ~6 KB, cli.ts (trechos) ~12 KB, server.ts (trecho) ~3 KB, context.ts/engine.ts (opções) ~4 KB, testes lidos 8 KB + novo ~30 KB ≈ 100 KB ≈ 25k
- Transversais: security-reads.test.ts (trecho da lista) ~25 KB ≈ 6k; docs e STATE ~25 KB ≈ 6k
- S1-S4 + transversais ≈ 67k, abaixo do orçamento de 150k - one builder
