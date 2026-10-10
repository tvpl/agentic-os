# Dados v2 checks

Profile: standard
Plan: `.specs/features/dados-v2/plan.md`

84 checks in 4 slices · 9 one-way doors · 0 open, of which 0 block

Comandos (da raiz): `npx vitest run tests/<arquivo>.test.ts -t "<nome>"`. Os arquivos novos são
`tests/data.migration.test.ts` (S1), `tests/data.owner-lock.test.ts` (S2), `tests/data.settings.test.ts`
(S3), `tests/data.backup.test.ts` e `tests/data.restore-lock.test.ts` (S4). As provas de processo concorrente seguem a de
`tests/security-p1.test.ts` C9: o teste empacota o código-fonte atual com `rolldown` num script de
filho (`tests/helpers/childBundle.ts`), sem depender de `dist/`, e alinha os filhos por uma barreira de
arquivos (`tests/helpers/barrier.ts`: cada filho espera os outros terem chegado, em vez de um relógio, que uma
máquina carregada atrasa). As provas da CLI (C37, C38, C39, C53) executam o `apps/api/dist/cli.js` e o
CONSTRÓI quando falta (`ensureCli`), em vez de passar sem afirmar nada. Uma migração lenta de teste é uma lista de `Migration` passada a `openDb(paths, migrations)`.

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

**C43** - `tightenMode` não abre descritor num arquivo que já tem o modo pedido nem num link, e abre (e muda o modo) quando difere; depois de `openDb`, `tightenHomeFiles` sobre uma home já privada não chama `fs.openSync` para `mordomo.db`, `mordomo.db-wal` nem `mordomo.db-shm`; e um banco de uma versão antiga com `-wal`/`-shm` em `0644` fica `0600` antes de a conexão abrir (AC 8)
Proof: `npx vitest run tests/data.migration.test.ts -t "C43 tightening never opens a file that already has its mode"`
Status: closed

**C51** - Um banco de versão 99 cuja versão só o WAL pendente conhece (cópia do `.db` e do `-wal` com modo `0644`) faz `openDb` lançar `DbNewerVersionError`, e o SHA-256 do arquivo e do `-wal` e o modo `0644` dos dois são os de antes (AC 5)
Proof: `npx vitest run tests/data.migration.test.ts -t "C51 a newer database with a WAL still pending"`
Status: closed

**C52** - Com linhas que só o WAL tem (o escritor nunca faz checkpoint) e um leitor com a transação aberta desde antes delas, o instantâneo pré-migração passa `integrity_check`, está em `user_version` 1 e contém a linha `only in the wal` (AC 2)
Proof: `npx vitest run tests/data.migration.test.ts -t "C52 the pre-migration snapshot holds what only the WAL holds"`
Status: closed

**C71** - Um banco de versão 99 fechado sem WAL tem a versão 99 nos 4 bytes do deslocamento 60 do cabeçalho e é recusado com a pasta do banco idêntica à de antes (nenhum `-shm`), os bytes iguais e o modo `0644` que tinha continuando `0644` (a recusa não aperta o modo); um arquivo ausente e um vazio abrem do zero (`fromVersion` 0); um arquivo que não é banco não é "versão 0": a abertura normal lança `not a database` e o arquivo e a pasta ficam como estavam (AC 9)
Proof: `npx vitest run tests/data.migration.test.ts -t "C71 the version is read without SQLite"`
Status: closed

### S2 - o lock de dono distingue o dono de um PID reciclado · 5 files · 60 KB · ~16k

**C9** - Depois de `start()`, `engine.lock` tem `v` = 2, `pid` = `process.pid`, `startedAt` numérico, `token` de 32 hex, e `procStart` igual a `processStartMarker(process.pid)`; um segundo motor em outra home grava um `token` diferente (AC 10)
Proof: `npx vitest run tests/data.owner-lock.test.ts -t "C9 the lock records the identity of its owner"`
Status: closed

**C10** - Com um processo filho vivo e um `engine.lock` que cita o PID dele com um `procStart` diferente do real, `start()` toma o lock (o `pid` passa a ser `process.pid`) e recupera a etapa semeada para `pending` (AC 11)
Proof: `npx vitest run tests/data.owner-lock.test.ts -t "C10 a recycled pid is taken over"`
Status: closed

**C11** - Com o mesmo filho vivo e o `engine.lock` com o `procStart` verdadeiro dele, `start()` lança `EngineLockedError` com `code` `"engine_locked"` e `holderPid` = o PID do filho, e a etapa continua `dispatched` (AC 12)
Proof: `npx vitest run tests/data.owner-lock.test.ts -t "C11 the real owner keeps the lock"`
Status: closed

**C12** - Com um `engine.lock` que registra `procStart` e uma sonda que diz PID vivo mas não consegue ler o início, `OwnerLock.acquire()` lança `EngineLockedError` e o arquivo do lock fica como estava (AC 13)
Proof: `npx vitest run tests/data.owner-lock.test.ts -t "C12 an unreadable start is never proof of staleness"`
Status: closed

**C13** - Um `engine.lock` sem `procStart` (formato antigo) com o PID de um processo vivo faz `start()` lançar `EngineLockedError`; com o PID `2 ** 30` (morto) `start()` toma o lock (AC 14)
Proof: `npx vitest run tests/data.owner-lock.test.ts -t "C13 a lock without procStart keeps the old rule"`
Status: closed

**C14** - `processStartMarker` com leitores injetados devolve `linux:<boot_id>:<starttime>` para um `stat` cujo nome de comando é `(a b) (c)` (o campo 22 depois do último `)`), `ps:<segundos>` para a saída `Thu Oct  9 12:00:00 2026` de `ps -o lstart=` lido com `TZ=UTC` e `LC_ALL=C`, `win:<ticks>` para a saída do PowerShell, e `null` quando o leitor lança, devolve vazio ou devolve texto que não casa (AC 15)
Proof: `npx vitest run tests/data.owner-lock.test.ts -t "C14 processStartMarker reads each platform and fails to null"`
Status: closed

**C15** - Em 30 rodadas, cada uma com um `engine.lock` obsoleto próprio e 4 processos tomando o lock no mesmo instante, exatamente um processo por rodada vence, os outros 3 recebem `EngineLockedError`, e o arquivo da rodada nomeia o `pid` do vencedor (AC 16)
Proof: `npx vitest run tests/data.owner-lock.test.ts -t "C15 stale takeover never produces two owners"`
Status: closed

**C16** - Um processo filho que tomou o lock e é morto com `SIGKILL` deixa o lock para trás; o `acquire()` seguinte do pai o toma (o `pid` passa a ser o do pai e o `token` muda) (AC 17)
Proof: `npx vitest run tests/data.owner-lock.test.ts -t "C16 a killed owner is replaced"`
Status: closed

**C17** - `close()` de um motor cujo `engine.lock` agora tem outro `token` (de um processo vivo) deixa o arquivo no lugar; `close()` de um motor com o próprio `token` o remove (AC 18)
Proof: `npx vitest run tests/data.owner-lock.test.ts -t "C17 release removes only its own lock"`
Status: closed

**C18** - Os comportamentos de lock que já existiam continuam: a suíte `S2 only the owner recovers` de `tests/core.engine.test.ts` (ausente, vivo de outro processo, PID morto, o próprio processo, ilegível, criado por `link` sem `.tmp`) passa sem mudança no arquivo (AC 19)
Proof: `npx vitest run tests/core.engine.test.ts -t "S2 only the owner recovers"`
Status: closed

**C61** - Com `engine.lock` sendo uma pasta com um arquivo dentro, `OwnerLock.acquire()` lança `EngineLockedError` com o caminho e `remove it by hand` na mensagem e não apaga o conteúdo; e o `acquire()` seguinte varre o temporário `<lock>.<pid>.<token>.tmp` (e o do formato antigo) de um PID morto e não toca o de um PID vivo (AC 20)
Proof: `npx vitest run tests/data.owner-lock.test.ts -t "C61 a lock path that is a folder refuses"`
Status: closed

### S3 - configurações toleram campo inválido · 4 files · 40 KB · ~10k

**C19** - Para cada um dos 27 campos de topo de `SettingsSchema`, um `settings.json` com um valor inválido só naquele campo (e valores não padrão nos outros) faz `load()` devolver o padrão daquele campo (o valor fechado, para `securityProfile`, `memorySkills` e os pais `limits`, `remote`, `sentinels`, `channels`) e o valor do arquivo em todos os outros 26, sem lançar (AC 21, AC 29, AC 30)
Proof: `npx vitest run tests/data.settings.test.ts -t "C19 an invalid value in any top-level field costs only that field"`
Status: closed

**C20** - `providers.claude.binaryPath` = `42` desliga o provedor (`enabled` `false`: nunca cai para o PATH) e `providers.cursor.defaultModel` do arquivo continua; `indexedFolders` com o segundo elemento sem `path` devolve o primeiro e o terceiro, nessa ordem; `limits.maxConcurrentRuns` = `99` vira `3` e `limits.logRetentionDays` = `7` do arquivo continua `7` (AC 22)
Proof: `npx vitest run tests/data.settings.test.ts -t "C20 a nested invalid value costs only that value"`
Status: closed

**C21** - Depois de um `load()` que descarta um campo, `config/settings.json.invalid` tem os bytes originais e modo `0600`; um segundo original diferente vai para `settings.json.invalid.<12 hex do SHA-256>` sem alterar o primeiro; repetir o `load()` do mesmo arquivo, ou de novo o mesmo original, não cria arquivo (AC 23)
Proof: `npx vitest run tests/data.settings.test.ts -t "C21 the original is preserved and never overwritten"`
Status: closed

**C22** - Um `settings.json` com indentação de tabulações, chaves fora de ordem e sem newline final fica byte a byte igual (mesmo SHA-256 e `mtime`) depois de um `load()` que descartou dois campos (AC 24)
Proof: `npx vitest run tests/data.settings.test.ts -t "C22 load never rewrites settings.json"`
Status: closed

**C23** - Um `load()` que descarta `port` e `limits.maxConcurrentRuns` escreve em `logs/settings.jsonl` duas linhas, uma com `path` `"port"` e uma com `"limits.maxConcurrentRuns"`, cada uma com `reason`; um segundo `load()` do mesmo arquivo não acrescenta linha, e depois de o arquivo mudar para outro inválido a linha nova aparece (AC 25)
Proof: `npx vitest run tests/data.settings.test.ts -t "C23 each dropped field is logged once per file version"`
Status: closed

**C24** - `update({ systemName: "X" })` sobre um arquivo com `port: "abc"` e `save()` sobre um arquivo que não é JSON deixam o `settings.json` novo gravado e os bytes de antes em `settings.json.invalid` (AC 26)
Proof: `npx vitest run tests/data.settings.test.ts -t "C24 save and update keep what they replace"`
Status: closed

**C25** - Um `settings.json` com `{` , com o texto `[]` e com `null` faz `load()` lançar com mensagem contendo `settings.json`, e deixa `settings.json.corrupt.<ts>` com os mesmos bytes (AC 27)
Proof: `npx vitest run tests/data.settings.test.ts -t "C25 a file that is not a JSON object still stops with the cause"`
Status: closed

**C26** - `limits.backupRetention` = `0`, `-1`, `1.5` e `"x"` no arquivo leem `10` com os outros `limits` intactos; `PUT /api/settings` com `limits.backupRetention` = `0` responde `400` e com `3` responde `200` e grava `3` (AC 28)
Proof: `npx vitest run tests/data.settings.test.ts -t "C26 backupRetention is an integer from 1 with default 10"`
Status: closed

**C44** - Para cada um dos 14 campos de segurança que se leem por um valor fechado fixo (os 9 abaixo e as cinco chaves `enabled` dos sentinelas; a lista `excludes` é a C62) (`securityProfile`, `indexedFolders[].enabled`, `providers.claude.binaryPath`, `channels.telegram.allowedUserIds`, `memorySkills`, `limits.dailyBudgetUsd`, `limits.approvalTtlDays`, `remote.deviceTtlDays`, `sentinels.triage.dailyBudgetUsd`) e para cada valor ilegível de uma lista de 12 (`null`, texto, `-7`, `1.5`, `"5"`, `{}`, `[1.5]`, `["BAD name"]`, `[false]`, `42`, `"false"`, `0`) que o esquema recusa, o valor lido é o PRIMEIRO da lista, escrita pelo teste, de valores válidos do mais restritivo ao mais permissivo (`read_only`; `false`; provedor desligado; canal desligado; `[]`; `0.01`; `1`; `1`; `0`), nunca mais permissivo que qualquer valor que o campo poderia ter; e cada valor da lista é lido como foi escrito nos campos diretos (AC 29)
Proof: `npx vitest run tests/data.settings.test.ts -t "C44 a security field that cannot be read"`
Status: closed

**C45** - Um elemento ilegível de `allowedUserIds` (`[7, 1.5]`) desliga o canal, `enabled: "false"` numa pasta concedida a deixa listada e desligada com a outra intacta, `memorySkills` com um nome inválido lê `[]`; e cada pai ilegível lê os campos de segurança abaixo dele fechados: `limits` (0.01 e 1), `remote` (1), `sentinels` (0), `channels` (canal desligado), `providers` (todos desligados, sem `binaryPath`) (AC 29, AC 30)
Proof: `npx vitest run tests/data.settings.test.ts -t "C45 an element, or the parent, that cannot be read"`
Status: closed

**C46** - Toda folha do `SettingsSchema` (os padrões, com um elemento de amostra de `indexedFolders` e de `providers`, normalizada para `providers.*`) é um campo de `SETTINGS_FAIL_CLOSED` ou está, pelo NOME EXATO, numa lista escrita pelo teste com o motivo de cada uma (nenhum prefixo); uma folha sem classe, ou listada e já fora do esquema, reprova (AC 32)
Proof: `npx vitest run tests/data.settings.test.ts -t "C46 every leaf of the settings"`
Status: closed

**C47** - 1100 elementos de `areas` com metade inválida saem todos num passe (550 ficam, em ordem, `systemName` mantido, menos de 5 s, nenhum `.corrupt`); 50 000 elementos (metade inválida) leem o padrão fechado (`securityProfile` `read_only`, `dailyBudgetUsd` `0.01`, `memorySkills` `[]`, `systemName` `MordomoOS`) em menos de 10 s, sem lançar nem `.corrupt`, com o arquivo em `.invalid` e um registro `(document)`; 6000 valores inválidos em `excludes` junto de `mine/*` e `also-mine` leem a lista padrão mais as duas entradas do dono (as exclusões legíveis não se perdem no estouro); 4000 inválidos direto em `parseTolerant` não estouram (AC 31, AC 34)
Proof: `npx vitest run tests/data.settings.test.ts -t "C47 more invalid values than a file can reasonably hold"`
Status: closed

**C48** - `settings.json.invalid` sendo pasta, link pendente (POSIX) ou arquivo com outros bytes não impede o `load()` nem perde o original (vai para `.invalid.<hash>`, ou `-1` se esse também está tomado, e o conteúdo alheio fica intacto); com os 10 nomes tomados o `load()` ainda funciona e `update()` lança `settings_unpreserved` sem trocar o arquivo; nenhum `.corrupt` (AC 23, AC 26)
Proof: `npx vitest run tests/data.settings.test.ts -t "C48 a name taken by a folder"`
Status: closed

**C49** - Três instâncias novas de `SettingsStore` lendo o mesmo arquivo com 2 campos inválidos deixam 2 linhas em `logs/settings.jsonl`; depois de o arquivo mudar, outras três deixam 4 (AC 25)
Proof: `npx vitest run tests/data.settings.test.ts -t "C49 the log says it once per version of the file, across instances"`
Status: closed

**C50** - Três leituras de um arquivo que não é JSON deixam 1 `.corrupt.<ts>`; oito conteúdos diferentes deixam no máximo 5; um `settings.json` com `version: "abc"` é lido (`systemName` mantido), fica byte a byte e com o mesmo `mtime`, e não cria `settings.json.v1.bak` (AC 27, AC 33)
Proof: `npx vitest run tests/data.settings.test.ts -t "C50 an unreadable file is kept once"`
Status: closed

**C62** - Uma lista `excludes` do dono ilegível lê as entradas legíveis mais a lista padrão, nunca menor que nenhuma das duas: `"private-notes"` lê o padrão mais `private-notes`; `[5]`, `7` e `{a: 1}` leem o padrão; `["mine/*", 5, "also-mine"]` lê o padrão mais as duas legíveis; uma lista toda legível (`["only-this"]`, `[]`) é lida como foi escrita (AC 34)
Proof: `npx vitest run tests/data.settings.test.ts -t "C62 a list of the owner's exclusions"`
Status: closed

**C63** - Todo booleano do esquema que é ligado por padrão (derivado dos padrões: `indexedFolders[].enabled` e as cinco chaves `enabled` dos sentinelas `triage`, `connectorDelta`, `repeatedFailure`, `silentRoutine`, `repeatDetector`) lê `false` para cada um de seis valores ilegíveis (`"false"`, `0`, `null`, `"off"`, `{}`, `[]`); a lista dos ligados por padrão é exatamente essa (AC 35)
Proof: `npx vitest run tests/data.settings.test.ts -t "C63 an unreadable flag never reads on"`
Status: closed

**C69** - Três leituras de um arquivo que não é JSON, em milissegundos diferentes e por instâncias diferentes, deixam uma só cópia `.corrupt.<ts>`; uma pasta `settings.json.corrupt.1`, um arquivo `settings.json.corrupt.notes` e um link `settings.json.corrupt.2` do dono ficam como estavam durante oito leituras com conteúdos diferentes, o `load()` continua parando com a mensagem de conserto e as cópias que o código gravou são no máximo 5 (AC 27)
Proof: `npx vitest run tests/data.settings.test.ts -t "C69 copies of an unreadable file"`
Status: closed

**C70** - Um link para um arquivo com os mesmos bytes não conta como cópia guardada (o original vai para `.invalid.<hash>` e o link continua link); sem nenhum nome gravável, o mesmo arquivo lido de novo pelo mesmo processo não registra de novo (uma linha, `preserved` nulo); o registro de log marca `closed: true` exatamente nos campos que leram fechados (`securityProfile`, `limits`, `memorySkills.0`) e não em `port` (AC 23, AC 25)
Proof: `npx vitest run tests/data.settings.test.ts -t "C70 a link is not a copy"`
Status: closed

### S4 - backups verificáveis, restauração atômica e retenção · 7 files · 150 KB · ~38k

**C27** - Um backup criado com um symlink dentro de `skills/` e arquivos em `memory/`, `config/db` e `config/settings.json` tem `manifest.json` na raiz com `version` 1, `algorithm` `"sha256"`, `files` igual ao conjunto de arquivos reais da pasta (menos o próprio manifesto), cada `sha256` e `size` iguais aos calculados à parte, e o symlink em `links` com o destino lido (AC 36)
Proof: `npx vitest run tests/data.backup.test.ts -t "C27 a backup carries a manifest of everything in it"`
Status: closed

**C28** - Com a cópia de `skills/` no staging adulterada logo depois de copiada (o original intacto), `restoreBackup` lança `backup_invalid`; com o original adulterado depois de copiado (a cópia intacta), restaura e os bytes instalados são os da cópia verificada (AC 37)
Proof: `npx vitest run tests/data.backup.test.ts -t "C28 the staged copies are what gets verified"`
Status: closed

**C29** - Para cada um destes sete defeitos num backup selado: um byte trocado sem mudar o tamanho (`checksum`), um arquivo truncado (`size`), um arquivo apagado (`missing`), um arquivo acrescentado (`unexpected`), um destino de symlink trocado (`link`), um banco válido editado por SQL (`checksum`) e um `manifest.json` ilegível, `restoreBackup` lança `BackupVerificationError` com `code` `"backup_invalid"` e `statusCode` 422 citando o caminho (exceto o manifesto), e depois da recusa os arquivos vivos têm o SHA-256 de antes, `listBackups` tem o mesmo número de backups (nenhuma cópia de segurança) e a home não tem pasta `.restore-*` (AC 37)
Proof: `npx vitest run tests/data.backup.test.ts -t "C29 any difference from the manifest refuses the restore and changes nothing"`
Status: closed

**C30** - Um backup sem `manifest.json` faz `restoreBackup` lançar `backup_unsealed` e não mudar nada; com `{ allowUnverified: true }` restaura e o arquivo vivo passa a ter o conteúdo do backup (AC 39)
Proof: `npx vitest run tests/data.backup.test.ts -t "C30 an unsealed backup needs allowUnverified"`
Status: closed

**C31** - Um filho que restaura e é morto com `SIGKILL` no k-ésimo `rename` do staging, para cada k de 1 ao total de renames da restauração, deixa uma home que `recoverInterruptedRestore` devolve ao estado de antes: os SHA-256 de todos os arquivos vivos são os de antes da restauração e não sobra pasta `.restore-*` (AC 40)
Proof: `npx vitest run tests/data.backup.test.ts -t "C31 a restore killed at any rename is rolled back"`
Status: closed

**C32** - Com um processo vivo segurando o `RestoreLock` e uma pasta `.restore-<pid>-…` com um diário `installing` (a pasta `memory/` movida para o `old-0`), `recoverInterruptedRestore(paths, 100)` lança `RestoreInProgressError` e não toca em nada; depois do `SIGKILL` do processo, o mesmo diário é desfeito (o arquivo de volta no lugar, a pasta removida) (AC 38, AC 52)
Proof: `npx vitest run tests/data.backup.test.ts -t "C32 a restore that is running is left alone"`
Status: closed

**C33** - Numa restauração com `mordomo.db-wal` e `mordomo.db-shm` presentes, os dois `rename` que os tiram do lugar acontecem antes do `rename` que instala o banco novo (AC 42)
Proof: `npx vitest run tests/data.backup.test.ts -t "C33 the sidecars leave before the database is replaced"`
Status: closed

**C34** - `POST /api/backups/:name/restore` responde `422` com `error.code` `"backup_invalid"` para um backup com um byte trocado e `"backup_unsealed"` para um sem manifesto, nos dois casos sem `config/restore-pending/`; responde `202` para um backup íntegro, `404` para um nome que não existe e `409` com uma execução ativa (AC 43)
Proof: `npx vitest run tests/data.backup.test.ts -t "C34 the restore route verifies before it stages"`
Status: closed

**C35** - Com uma restauração agendada cujo backup foi adulterado depois, `new AppContext(home, { applyPendingRestore: true })` não lança, os arquivos vivos continuam os de antes, `restoreRejectedAtBoot` tem `name` e `message`, `restoredAtBoot` é nulo e `readRestorePending` é nulo (AC 44)
Proof: `npx vitest run tests/data.backup.test.ts -t "C35 a rejected staged restore does not stop the service"`
Status: closed

**C36** - Com `keep` = 2 e esta home (os `mtime` das pastas embaralhados: a ordem vem do nome): 1 legado (sem manifesto) mais antigo que todos, 4 backups selados, o selado mais antigo nomeado por `restore-pending`, e um symlink `full-link` para fora, `createBackup` publica o novo e deixa exatamente: o novo, o selado mais novo antes dele, o legado, o da `restore-pending` e o symlink; apagou os outros dois selados antigos (AC 45)
Proof: `npx vitest run tests/data.backup.test.ts -t "C36 retention deletes only sealed backups beyond the newest"`
Status: closed

**C37** - Com `limits.backupRetention` = 2, quatro `POST /api/backups` seguidos deixam 2 backups; e `mordomo backup` três vezes numa home com `backupRetention` 2 deixa 2 e imprime `removed 1 old backup(s)` na terceira (AC 46)
Proof: `npx vitest run tests/data.backup.test.ts -t "C37 the route and the CLI apply the configured retention"`
Status: closed

**C38** - `mordomo backup --list` imprime `unsealed` na linha de um backup sem manifesto e não nas de backups selados (AC 46)
Proof: `npx vitest run tests/data.backup.test.ts -t "C38 the CLI list marks unsealed backups"`
Status: closed

**C39** - `mordomo restore <backup legado>` sai com `1` e `stderr` contendo `--allow-unverified`; com `--allow-unverified` sai com `0`; `mordomo restore <backup adulterado>` sai com `1` e `stderr` com o caminho do arquivo; sem nome, sai com `2` (AC 37, AC 39)
Proof: `npx vitest run tests/data.backup.test.ts -t "C39 the restore command refuses unsealed and tampered backups"`
Status: closed

**C40** - Um backup feito com o banco em versão anterior à mais nova (3 migrações a menos), restaurado, é levado por `openDb` à versão mais nova com as linhas que tinha (AC 48)
Proof: `npx vitest run tests/data.backup.test.ts -t "C40 a backup from an older schema restores and migrates"`
Status: closed

**C77** - Um backup feito em outro processo, parado a meio da cópia (a primeira pasta copiada, as outras não), segura o lock compartilhado: `restoreBackup(paths, name, { waitMs: 0 })` lança `RestoreInProgressError` sem mudar nada nem criar `.restore-*`, e um `restoreBackup` que espera só roda depois do backup (levou mais de 500 ms); o backup publicado tem `skills/`, `memory/` e `routines/` todos no estado de antes da restauração (`CURRENT`), nenhum no restaurado, e `verifyBackup` o aceita (AC 56)
Proof: `npx vitest run tests/data.restore-lock.test.ts -t "C77 a backup holds the lock for the whole of it"`
Status: closed

**C78** - Uma restauração morta com SIGKILL quando a home foi alcançada por um link é desfeita por um motor montado pelo caminho real; uma morta pelo caminho real, com a home depois movida de lugar, é desfeita por `recoverInterruptedRestore` no caminho novo e deixa os arquivos como estavam; e um `createBackup` na home movida não sela o meio da restauração (o backup tem `note CURRENT`) (AC 38, AC 40)
Proof: `npx vitest run tests/data.restore-lock.test.ts -t "C78 a restore that died is undone whatever the spelling"`
Status: closed

**C79** - (a) Com uma restauração real parada 1,2 s depois de mover o banco, `new AppContext(home)` sem `restoreWaitMs` espera (mais de 300 ms), monta depois dela e abre o banco restaurado (`marker` = `backup`, `integrity_check` `ok`); (b) com um motor de outro processo parado dentro da abertura do banco, `restoreBackup(…, { waitMs: 0 })` e `RestoreLock.acquire(paths, 0)` lançam `RestoreInProgressError`, nada muda e nenhuma pasta `.restore-*` nasce, e só depois de o motor terminar a restauração roda (AC 59, AC 47)
Proof: `npx vitest run tests/data.restore-lock.test.ts -t "C79 an engine built while a restore runs"`
Status: closed

**C80** - O arquivo do lock é criado `0600` e `config/run` `0700` (POSIX); um arquivo mais frouxo é apertado para `0600` ao tomar o lock, e um motor deixa a pasta em `0700` e o arquivo em `0600` partindo de `0755` e `0666` (AC 58)
Proof: `npx vitest run tests/data.restore-lock.test.ts -t "C80 the lock file is owner-only"`
Status: closed

**C81** - Um segundo `RestoreLock.acquire` exclusivo no mesmo processo lança "not reentrant" e o pedido compartilhado lança `RestoreInProgressError`, e depois dessas recusas outro processo continua recusado (a primeira trava não foi solta); dois compartilhados coexistem (um terceiro processo obtém o compartilhado, o exclusivo é recusado) e o exclusivo só passa quando os dois soltaram; soltar duas vezes não faz nada (AC 52, AC 58)
Proof: `npx vitest run tests/data.restore-lock.test.ts -t "C81 the lock is not reentrant"`
Status: closed

**C82** - Com `restore.lock` cheio de texto, ou sendo uma pasta, `RestoreLock.acquire`, `restoreBackup`, `recoverInterruptedRestore`, `new AppContext(home)` e `createBackup` lançam `RestoreLockError` com "remove it by hand" e o caminho; o arquivo não é sobrescrito, os arquivos vivos não mudam, e depois de apagado à mão o lock volta a funcionar (AC 58)
Proof: `npx vitest run tests/data.restore-lock.test.ts -t "C82 a lock file that cannot be a lock"`
Status: closed

**C83** - Com um processo esperando o lock que outro segura, o arquivo `restore.lock` é substituído (rename por cima) ou apagado e o dono é morto: quem esperava passa a segurar o arquivo que está no caminho agora (mesmo inode que `stat`, igual ao do arquivo novo no caso da troca) e um terceiro processo é recusado, isto é, não há dois donos (AC 58)
Proof: `npx vitest run tests/data.restore-lock.test.ts -t "C83 a lock file deleted or replaced while someone waits"`
Status: closed

**C84** - Para cada k de 1 ao total de renames de uma restauração com os onze alvos em jogo (pastas `skills`, `memory`, `routines`, `connectors`, `artifacts`, `settings.json`, `ui-preferences.json`, `sync-manifest.json`, o banco e seu `-wal`/`-shm`; total lido do próprio teste), com e sem `artifacts` e `sync-manifest.json` na home viva (`hadTarget` `false`), um SIGKILL no k-ésimo rename é desfeito de modo que o SHA-256 de todos os arquivos vivos é o de antes e o que ainda não existia continua não existindo; o diário de um k tardio nomeia exatamente os onze `slot` e diz `hadTarget` `false` para os dois ausentes (AC 40)
Proof: `npx vitest run tests/data.restore-lock.test.ts -t "C84 a restore killed at any rename"`
Status: closed

**C85** - Com outro processo segurando o lock, `POST /api/backups` espera sem travar o laço de eventos (o maior intervalo de um temporizador de 20 ms durante o pedido fica abaixo de 500 ms) e responde `409` `restore_in_progress` depois de mais de 500 ms (AC 47)
Proof: `npx vitest run tests/data.restore-lock.test.ts -t "C85 a restore running makes a backup wait"`
Status: closed

**C86** - Com outro processo segurando o lock exclusivo, `restoreBackup(…, { waitMs: 0 })` lança `RestoreInProgressError` (409) cuja mensagem cita o backup e o processo que está começando, e deixa os arquivos vivos como estavam sem criar `.restore-*`; `recoverInterruptedRestore` com a espera padrão espera um dono que solta em 0,8 s (mais de 300 ms) e remove a pasta sem diário; `restoreBackup` com a espera padrão espera um dono compartilhado que solta em 0,8 s e restaura (AC 47, AC 52)
Proof: `npx vitest run tests/data.restore-lock.test.ts -t "C86 a second restore is refused"`
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

**C53** - Uma restauração morta com SIGKILL no 9º rename é desfeita por cada caminho de volta à home, sem chamar `recoverInterruptedRestore` à mão: (1) o `restoreBackup` seguinte (a cópia de segurança dele contém `note CURRENT`, o estado de antes, e não o meio), (2) `applyPendingRestore` sem nada agendado, (3) `new AppContext(home)` (o que todo comando da CLI faz), (4) `createBackup` (o backup contém `note CURRENT`), (5) `mordomo backup --list` e `mordomo backup` na CLI; e `createBackup` recusa com `restore is in progress` enquanto outro processo segura o `RestoreLock` (AC 38, AC 47, AC 49, AC 57)
Proof: `npx vitest run tests/data.backup.test.ts -t "C53 a restore that died half way is undone by every way back"`
Status: closed

**C54** - `keep` NaN, 0, -1, 1.5 e Infinity fazem `createBackup` e `pruneBackups` lançar `RangeError` sem apagar nada; três `createBackup` com `keep: 1` ao mesmo tempo terminam os três cumpridos (AC 50)
Proof: `npx vitest run tests/data.backup.test.ts -t "C54 a keep that is not an integer"`
Status: closed

**C55** - Uma restauração morta depois de instalar tudo e antes de limpar (SIGKILL no primeiro `rm` da pasta de staging) deixa um diário na fase `done`; `recoverInterruptedRestore` mantém o estado restaurado (`note v1`, `systemName` `Backed`) e só remove a pasta (AC 41)
Proof: `npx vitest run tests/data.backup.test.ts -t "C55 a restore that dies after it installed everything"`
Status: closed

**C56** - Um processo que segura o `RestoreLock` faz `RestoreLock.acquire(paths, 0)` lançar `RestoreInProgressError`; depois do `SIGKILL` dele o lock é obtido de imediato, sem nada obsoleto a julgar (AC 52)
Proof: `npx vitest run tests/data.backup.test.ts -t "C56 a restore lock is released by the kernel"`
Status: closed

**C57** - Uma pasta `.restore-<pid>-…` sem diário não é removida enquanto outro processo segura o `RestoreLock` (`recoverInterruptedRestore` lança `RestoreInProgressError`) e é removida assim que o lock é nosso (AC 38, AC 52)
Proof: `npx vitest run tests/data.backup.test.ts -t "C57 a folder without a journal is debris once the lock is ours"`
Status: closed

**C58** - Para cada rename do staging, de 1 ao total (contado do próprio teste), uma falha injetada nele em processo faz `restoreBackup` lançar e deixa os SHA-256 de todos os arquivos vivos como estavam e nenhuma pasta `.restore-*` (AC 40)
Proof: `npx vitest run tests/data.backup.test.ts -t "C58 a restore that fails in this process after any install puts everything back"`
Status: closed

**C59** - Um backup sem manifesto cujo banco tem `user_version` 0, ou 9999, é recusado com `Invalid backup database` mesmo com `allowUnverified`, e a home não muda (AC 51)
Proof: `npx vitest run tests/data.backup.test.ts -t "C59 a backup whose database is empty or from a newer version"`
Status: closed

**C60** - `startServer` sobre uma restauração agendada cujo backup foi adulterado imprime (`console.warn`) `staged restore of <nome> refused` e `checksum memory/note.md`, sobe com `systemName` `Current` e expõe `restoreRejectedAtBoot` (AC 44)
Proof: `npx vitest run tests/data.backup.test.ts -t "C60 the service tells the owner at boot"`
Status: closed

**C64** - Em 6 rodadas, uma restauração morta no 9º rename de uma home com 400 arquivos em `skills/big` e 400 em `memory/bulk`, e 4 processos reais chamando `recoverInterruptedRestore` no mesmo instante (barreira), terminam todos com código 0 e sem `could not be undone`, exatamente um deles desfez a restauração (os resultados são `[0,0,0,1]`), os SHA-256 de todos os arquivos vivos são os de antes e não sobra pasta `.restore-*` (AC 38)
Proof: `npx vitest run tests/data.backup.test.ts -t "C64 several commands finding the same dead restore"`
Status: closed

**C65** - Com um processo real no meio de uma restauração (o banco já movido para o staging, parado 2,5 s), `new AppContext(home, { restoreWaitMs: 200 })` lança `RestoreInProgressError` (`statusCode` 409) e `mordomo.db`, `-wal` e `-shm` continuam não existindo; terminada a restauração, o motor abre sobre o banco restaurado (a linha `marker` = `backup` está lá e `integrity_check` é `ok`) (AC 47, AC 59)
Proof: `npx vitest run tests/data.backup.test.ts -t "C65 an engine built while a restore is running"`
Status: closed

**C66** - Diários que esta versão não escreveu não são executados, e a home recusa tudo enquanto eles estão lá: um `slot` que não é um dos onze nomes, um `slot` que é um caminho, o mesmo `slot` duas vezes, `hadTarget` que não é booleano, uma fase que não existe, uma entrada legítima mais uma de fora (tudo ou nada), um diário que não é JSON ou não é objeto, originais `old-N` sem diário ou sob um diário danificado, e (POSIX) um link `.restore-N-…` para uma pasta com um diário válido deixam o arquivo de fora, os arquivos vivos e o conteúdo da pasta como estavam, e `recoverInterruptedRestore`, `restoreBackup`, `createBackup` e `new AppContext(home)` lançam `RestoreLeftoverError` (409, "delete the folder and try again"); uma pasta do dono `.restore-notes` não é olhada nem apagada; um diário legítimo é desfeito pelo índice e pelo `slot`, ignorando os caminhos `target`/`old` que o arquivo diga (AC 53, AC 57)
Proof: `npx vitest run tests/data.backup.test.ts -t "C66 a journal this code did not write"`
Status: closed

**C72** - Com um processo segurando o `RestoreLock`, `POST /api/backups` responde `409` com `error.code` `restore_in_progress` e uma mensagem com `restore is in progress`; com um `settings.json` de campo ilegível e todos os nomes de `.invalid` tomados, `PUT /api/settings` responde `409` com `error.code` `settings_unpreserved` e o arquivo fica como estava (AC 54)
Proof: `npx vitest run tests/data.backup.test.ts -t "C72 the API answers 409"`
Status: closed

**C73** - Uma restauração que não consegue ser desfeita (o `rename` do banco de volta falha) faz o motor lançar `RestoreRecoveryError` com `could not be undone`, a causa (`ENOENT`), o nome da pasta de staging e `move old-N back over its target`, os arquivos continuam no staging e a mesma recuperação, quando pode, termina o serviço (os SHA-256 vivos voltam aos de antes); e `mordomo backup --list` com a restauração ainda rodando em outro processo sai com `1` e `restore is in progress` (AC 55, AC 47)
Proof: `npx vitest run tests/data.backup.test.ts -t "C73 a restore that cannot be undone, or is still running"`
Status: closed

**C74** - Um backup que some enquanto se lista é pulado por `listBackups`; uma exclusão da retenção que falha (`EBUSY`) não faz `createBackup` falhar; e 4 processos reais, 4 vezes cada, fazendo `createBackup` com `keep: 1` no mesmo instante terminam todos com código 0 (AC 45, AC 50)
Proof: `npx vitest run tests/data.backup.test.ts -t "C74 retention that loses a race"`
Status: closed

**C75** - Uma falha ao escrever a marca `done` do diário não faz `restoreBackup` lançar (o estado restaurado fica, `note v1`, sem pasta de staging); uma falha ao escrever o primeiro diário o faz lançar e não deixa pasta `.restore-*` nem muda arquivo vivo (AC 41)
Proof: `npx vitest run tests/data.backup.test.ts -t "C75 a restore is not an error because its done mark"`
Status: closed

**C76** - Três backups cujos nomes, `createdAt` de manifesto e `mtime` dizem coisas diferentes são listados pela data do nome, e dois com o mesmo instante pelo nome (decrescente); `pruneBackups(paths, 1)` apaga exatamente os dois mais antigos e deixa o mais novo (AC 45)
Proof: `npx vitest run tests/data.backup.test.ts -t "C76 backups are ordered by the time in their name"`
Status: closed

## Coverage

| Set (size)                                                       | Member -> proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Unproven |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| estados de partida de `openDb` (6)                               | arquivo novo C8 · já na versão nova C8 · abaixo da nova, sem dados C8, C4 · abaixo da nova, com dados C2 · migração que falha C4 · versão futura C5                                                                                                                                                                                                                                                                                                                                                                             | -        |
| quem abre o banco ao mesmo tempo (2)                             | o que migra C1, C3 · o que perde a corrida C3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | -        |
| esperas por trava do banco (2)                                   | WAL C1 · fora do WAL C6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | -        |
| estados do `engine.lock` em `start()` (9)                        | ausente C9 · vivo de outro processo com o mesmo início C11 · vivo com início diferente (PID reciclado) C10 · vivo, início ilegível agora C12 · vivo, formato antigo C13 · morto C13, C16 · o próprio processo C18 · ilegível C18 · criado por `link` sem janela C9, C18                                                                                                                                                                                                                                                         | -        |
| plataformas de `processStartMarker` (4)                          | Linux C14 · macOS/BSD (`ps`) C14 · Windows (PowerShell) C14 · leitura falha C14                                                                                                                                                                                                                                                                                                                                                                                                                                                 | -        |
| rodadas de disputa pelo lock obsoleto (30)                       | C15, table-driven over all 30 rounds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | -        |
| quem libera o lock (2)                                           | com o próprio `token` C17, C18 · com outro `token` C17                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | -        |
| campos de topo de `SettingsSchema` (27)                          | C19, table-driven over all 27, driven by the schema (`version`, `systemName`, `language`, `theme`, `accentColor`, `port`, `bindAddress`, `timezone`, `autostart`, `setupCompleted`, `defaultProvider`, `securityProfile`, `providers`, `remote`, `marketplace`, `updates`, `indexedFolders`, `excludes`, `areas`, `limits`, `favoriteSkills`, `memorySkills`, `routines`, `connectors`, `memory`, `sentinels`, `channels`)                                                                                                      | -        |
| formas de valor inválido aninhado (3)                            | propriedade de objeto C20 · elemento de array C20 · propriedade de objeto dentro de um registro C20                                                                                                                                                                                                                                                                                                                                                                                                                             | -        |
| destinos do original em `.invalid` (3)                           | `settings.json.invalid` novo C21 · outro conteúdo, nome com hash C21 · mesmo conteúdo, nada novo C21                                                                                                                                                                                                                                                                                                                                                                                                                            | -        |
| arquivos que `save()`/`update()` substituem (2)                  | com campo inválido C24 · que não é JSON C24                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | -        |
| raízes de `settings.json` que continuam parando (3)              | `{` C25 · `[]` C25 · `null` C25                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | -        |
| valores de `backupRetention` (6)                                 | `0` C26 · `-1` C26 · `1.5` C26 · `"x"` C26 · API `0` → 400 C26 · API `3` → 200 C26                                                                                                                                                                                                                                                                                                                                                                                                                                              | -        |
| defeitos de um backup que a restauração recusa (7)               | byte trocado C29 · truncado C29 · apagado C29 · acrescentado C29 · destino de link C29 · banco válido editado C29 · manifesto ilegível C29                                                                                                                                                                                                                                                                                                                                                                                      | -        |
| tipos de problema do manifesto (5)                               | `checksum` C29 · `size` C29 · `missing` C29 · `unexpected` C29 · `link` C29                                                                                                                                                                                                                                                                                                                                                                                                                                                     | -        |
| entradas que iniciam uma restauração (3)                         | `mordomo restore` C30, C39 · `POST /api/backups/:name/restore` C34 · boot com restauração agendada C35 (todas chegam a `restoreBackup`: C28, C29)                                                                                                                                                                                                                                                                                                                                                                               | -        |
| estados de um backup quanto ao manifesto (3)                     | selado e íntegro C28, C40 · selado e adulterado C29 · legado C30                                                                                                                                                                                                                                                                                                                                                                                                                                                                | -        |
| situações de uma restauração que não terminou (2)                | processo morto, em cada um dos k renames do staging (k lido do próprio teste) C31 · dono ainda vivo C32                                                                                                                                                                                                                                                                                                                                                                                                                         | -        |
| backups candidatos à retenção (6)                                | o novo C36 · selado além do `keep` C36 · selado dentro do `keep` C36 · legado C36 · o da `restore-pending` C36 · link C36                                                                                                                                                                                                                                                                                                                                                                                                       | -        |
| quem aplica a retenção configurada (2)                           | `POST /api/backups` C37 · `mordomo backup` C37                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | -        |
| `POST /api/backups/:name/restore` statuses (4)                   | 202 C34 · 404 C34 · 409 C34 · 422 C34                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | -        |
| `PUT /api/settings` (campo novo) statuses (2)                    | 200 C26 · 400 C26                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | -        |
| `mordomo restore` saídas (3)                                     | 0 C39 · 1 C39 · 2 C39                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | -        |
| doors (9)                                                        | 1 `engine.lock` C9, C10, C11, C13 · 2 `OwnerLock`/`EngineLockedError` C11, C12, C17 · 3 `BEGIN IMMEDIATE` C15 · 4 `.invalid` C21 · 5 `manifest.json` C27 · 6 `openDb`/erros C1, C4, C5 · 7 retenção e `BackupVerificationError` C26, C29, C36 · 8 `SETTINGS_FAIL_CLOSED` C44, C45, C46 · 9 `RestoreLock` C32, C56, C57, C64, C65, C77, C79, C81, C82, C83                                                                                                                                                                       | -        |
| campos de segurança do esquema (15)                              | `securityProfile` C44 · `indexedFolders[].enabled` C44, C45, C63 · `providers.*.binaryPath` C44, C45 · `channels.telegram.allowedUserIds` C44, C45 · `memorySkills` C44, C45 · `limits.dailyBudgetUsd` C44, C45 · `limits.approvalTtlDays` C44, C45 · `remote.deviceTtlDays` C44, C45 · `sentinels.triage.dailyBudgetUsd` C44, C45 · `excludes` C62 · `triage.enabled` C44, C63 · `connectorDelta.enabled` C44, C63 · `repeatedFailure.enabled` C44, C63 · `silentRoutine.enabled` C44, C63 · `repeatDetector.enabled` C44, C63 | -        |
| formas de um segurança ilegível (3)                              | o valor C44 · um elemento da lista C45 · o pai inteiro C45                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | -        |
| conjunto das folhas do esquema, todas classificadas (1)          | C46, derivado dos padrões do `SettingsSchema` (nenhuma sem classe)                                                                                                                                                                                                                                                                                                                                                                                                                                                              | -        |
| tamanhos de documento inválido (3)                               | 1100 C47 · 4000 (limite do parser) C47 · 50 000 C47                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | -        |
| nomes de `.invalid` ocupados por (4)                             | pasta C48 · link pendente C48 · outros bytes C48 · os 10 nomes C48                                                                                                                                                                                                                                                                                                                                                                                                                                                              | -        |
| quem lê o mesmo arquivo inválido (2)                             | a mesma instância C23 · instâncias novas C49                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | -        |
| caminhos de volta à home depois de uma restauração morta (6)     | `restoreBackup` C53 · `applyPendingRestore` C53 · construir o motor C53 · `createBackup` C53 · CLI `backup --list` C53 · CLI `backup` C53                                                                                                                                                                                                                                                                                                                                                                                       | -        |
| fases do diário (3)                                              | `staging` C57 · `installing` C31, C56 · `done` C55                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | -        |
| dono de uma restauração (2)                                      | morta, o kernel soltou o lock C31, C56 · viva, segura o lock C32, C65                                                                                                                                                                                                                                                                                                                                                                                                                                                           | -        |
| `keep` inválido (5)                                              | C54, table-driven over all 5 (NaN, 0, -1, 1.5, Infinity)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | -        |
| criações simultâneas (1)                                         | três juntas C54                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | -        |
| banco do backup recusado mesmo sem manifesto (2)                 | `user_version` 0 C59 · 9999 C59                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | -        |
| aviso de restauração recusada (2)                                | `restoreRejectedAtBoot` C35 · linha impressa por `startServer` C60                                                                                                                                                                                                                                                                                                                                                                                                                                                              | -        |
| caminhos do lock que não são arquivo (2)                         | pasta C61 · temporário de processo morto C61                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | -        |
| versões que o banco de versão futura pode ter pendentes (2)      | limpo C5 · WAL pendente C51                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | -        |
| recuperadores simultâneos (6)                                    | C64, table-driven over all 6 rounds de 4 processos reais                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | -        |
| quem pode estar com o `RestoreLock` (3)                          | o próprio processo C56 · outro processo vivo C32, C57, C65, C72, C73 · outro processo morto C56                                                                                                                                                                                                                                                                                                                                                                                                                                 | -        |
| modos do `RestoreLock` (2)                                       | exclusivo (restaurar, desfazer, aplicar agendada) C32, C56, C57 · compartilhado (backup inteiro, motor até o banco abrir) C77, C79, C81                                                                                                                                                                                                                                                                                                                                                                                         | -        |
| quem segura o compartilhado (2)                                  | `createBackup`, do primeiro arquivo ao manifesto C77 · o motor, até o banco abrir C79                                                                                                                                                                                                                                                                                                                                                                                                                                           | -        |
| grafias do caminho da home (3)                                   | a real C31 · por um link C78 · depois de movida C78                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | -        |
| os onze alvos de uma restauração (11)                            | `skills` C84 · `memory` C84 · `routines` C84 · `connectors` C84 · `artifacts` C84 · `settings.json` C84 · `ui-preferences.json` C84 · `sync-manifest.json` C84 · `-wal` C84 · `-shm` C84 · banco C84 (C84, table-driven over all 11)                                                                                                                                                                                                                                                                                            | -        |
| o alvo existia antes (2)                                         | sim C84 · não (`hadTarget` `false`) C84                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | -        |
| estados do arquivo do lock (4)                                   | ausente, criado `0600` C80 · mais frouxo, apertado C80 · bytes que não são banco C82 · pasta C82                                                                                                                                                                                                                                                                                                                                                                                                                                | -        |
| arquivo do lock mudado enquanto se espera (2)                    | substituído C83 · apagado C83 (C83, table-driven over both)                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | -        |
| esperas que são esperas (4)                                      | o motor, espera padrão C79 · `recoverInterruptedRestore`, espera padrão C86 · `restoreBackup`, espera padrão C86 · `POST /api/backups`, sem travar o laço C85                                                                                                                                                                                                                                                                                                                                                                   | -        |
| pedidos do lock no mesmo processo (4)                            | exclusivo sobre exclusivo C81 · compartilhado sobre exclusivo C81 · compartilhado sobre compartilhado C81 · soltar duas vezes C81                                                                                                                                                                                                                                                                                                                                                                                               | -        |
| quem constrói ou guarda a home enquanto uma restauração roda (4) | motor C65 · `createBackup` C53, C72 · `recoverInterruptedRestore` C32, C57 · CLI C73                                                                                                                                                                                                                                                                                                                                                                                                                                            | -        |
| diários e pastas `.restore-*` de que não se age (11)             | `slot` que não é dos onze C66 · `slot` que é um caminho C66 · `slot` repetido C66 · `hadTarget` que não é booleano C66 · fase que não existe C66 · entrada legítima mais uma de fora C66 · diário que não é JSON C66 · diário que não é objeto C66 · diário danificado sobre `old-N` C66 · `old-N` sem diário C66 · link com nome de staging C66 (C66, table-driven over all 11)                                                                                                                                                | -        |
| booleanos ligados por padrão (6)                                 | `indexedFolders[].enabled` C63 · `triage` C63 · `connectorDelta` C63 · `repeatedFailure` C63 · `silentRoutine` C63 · `repeatDetector` C63                                                                                                                                                                                                                                                                                                                                                                                       | -        |
| formas ilegíveis de `excludes` (5)                               | texto C62 · `[5]` C62 · número C62 · objeto C62 · lista com um elemento ruim C62                                                                                                                                                                                                                                                                                                                                                                                                                                                | -        |
| arquivos que o espiar da versão lê (4)                           | ausente C71 · vazio C71 · cabeçalho sem WAL C5, C71 · WAL esperando C51                                                                                                                                                                                                                                                                                                                                                                                                                                                         | -        |
| nomes parecidos com `.corrupt` do dono (3)                       | pasta C69 · nota C69 · link C69                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | -        |
| respostas da API a falhas da casa (2)                            | `409 restore_in_progress` C72 · `409 settings_unpreserved` C72                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | -        |
| falhas do diário (3)                                             | escrever o primeiro C75 · escrever o `done` C75 · desfazer C73                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | -        |
| ordem dos backups (3)                                            | pela data do nome C76 · empate pelo nome C76 · legado e selado C36                                                                                                                                                                                                                                                                                                                                                                                                                                                              | -        |

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

- `core/src/config/tolerant.ts` (rodada 1): remoção em lote por caminho, regra fechada por campo, pai inteiro, estouro (6 branch points) -> decides
- `core/src/config/failClosed.ts`: tabela de 15 campos -> decide, provada campo a campo e por classificação de todas as folhas (C44-C46)

- `core/src/db/db.ts` `runMigrations`: versão futura (2 pontos), nada pendente, pendente com dados, pendente sem dados, perdeu a corrida, migração falhou (7 branch points) -> decides
- `core/src/ownerLock.ts` (julgamento de obsolescência): ilegível, o próprio PID, PID morto, formato antigo, início registrado igual/diferente/ilegível (7 estados) -> decides
- `core/src/processIdentity.ts`: 3 plataformas, cada uma com leitura que pode falhar (6 branch points) -> decides
- `core/src/config/tolerant.ts`: valor inválido numa propriedade, num elemento de array, escalada quando o pai exige a chave, raiz irrecuperável (4 branch points) -> decides
- `core/src/backupManifest.ts` `verifyMounts`: 5 tipos de problema, montagem sem cópia (6 branch points) -> decides
- `core/src/backup.ts` `restoreBackup`/`recoverInterruptedRestore`: ordem verificar → cópia de segurança → instalar, rollback, diário por `slot`, pasta que não se coloca (13 branch points) -> decides
- `core/src/restoreLock.ts`: exclusivo/compartilhado, reentrada, arquivo que não é lock, troca do arquivo durante a espera, espera zero (8 branch points) -> decides; `core/src/engine.ts` (construtor): lock compartilhado até o banco abrir, trecho exclusivo para desfazer/aplicar (4 branch points) -> decides
- `apps/api/src/routes/system.ts` rota de restauração: repassa o erro do core -> instrumentation
- closest analogue in the repo: `tests/core.backup.test.ts` (a restauração provada no core, contra uma home temporária, com `vi.spyOn(fs, …)` para injetar falha) e `tests/core.engine.test.ts` (estados do lock), ambos já provados nesse nível

Mutantes equivalentes, justificados: `tolerant.ts` "sem pular descendente de ancestral já tomado" (T4): o ancestral e o descendente saem do mesmo documento e a remoção de uma chave de um objeto já destacado não muda o resultado, porque os pais são lidos antes de qualquer remoção; `store.ts` "guarda de `save()` sem as regras fechadas" (S8): a guarda só usa a CONTAGEM de problemas, e as regras fechadas trocam um valor, não tiram nenhum problema da contagem. O terceiro da lista (S3, o `lastReported`) não é equivalente e tem prova (C70).

Cost: 5 arquivos de teste novos, 50 provas próprias e 1 ajuste da lista revisada de leituras de `fs`. Sem essas linhas, o lock só seria provado pelo caminho feliz, a corrida só por dois motores no mesmo processo (que o SQLite serializa por construção) e a verificação do backup por um único byte trocado.

## Swept

- validation: C19, C20, C25, C26, C44-C50 (configurações), C29 (manifesto), C5, C51 (versão do banco), C54 (`keep`), C59 (banco do backup)
- failure modes: C66, C82, C84 (o que não se desfaz fica como está e recusa; o lock que não é lock é dito; morte em cada rename com os onze alvos), C4 (migração que falha desfaz tudo), C29 (verificação falha sem tocar em nada), C31, C53, C55-C58 (processo morto ou falha no meio da restauração), C35, C60 (restauração recusada no boot não derruba o serviço), C47, C48 (arquivo de configurações que não cabe ou sem onde guardar o original)
- idempotency: C3 (a segunda abertura não reaplica), C21, C48 (o mesmo original não vira dois arquivos), C23, C49 (um aviso por versão do arquivo)
- authorization: existing - a rota de restauração e `POST /api/backups` já são `scope: "owner"` (`apps/api/src/routes/system.ts`); a CLI roda como o dono; o `.invalid`, o diário e o manifesto nascem `0600` em pastas `0700` (C2, C21); C80 (o lock `0600` em `config/run` `0700`); C44, C45 (um valor ilegível nunca abre permissão)
- concurrency: C77, C79, C83, C85, C86 (backup, motor e restauração de processos reais sob o lock compartilhado/exclusivo), C64, C65, C74 (recuperadores, motor e backups simultâneos de processos reais), C1, C3, C6, C52 (banco), C15, C16 (lock), C32, C53, C57 (restauração de outro processo), C54 (backups simultâneos)
- data lifecycle: C36, C54 (retenção), C21, C50 (o `.invalid` nunca é apagado nem sobrescrito; as cópias `.corrupt` são podadas), C40 (backup antigo restaurado e migrado)
- dependency failure: C12 e C14 (o sistema não responde sobre o início do processo), C6 (o banco está travado por outro processo), C61 (caminho do lock que não é arquivo)
- state transitions: C10, C11, C13 (lock: dono → obsoleto → retomado), C28, C30 (backup: selado → verificado → instalado), C55 (restauração: instalando → feita)
- observability: C66, C82 (o que sobrou diz a pasta, o motivo e o passo manual; o lock diz "remove it by hand"), C70 (o registro marca `closed`), C73 (a recuperação impossível diz a causa), C23, C49 (`logs/settings.jsonl`), C35, C60 (`restoreRejectedAtBoot` e o aviso em `startServer`), C4 e C5 (as mensagens dos erros de migração)

## Out of scope

See the plan's `Out of scope`.

## Handoff

- S1 = db.ts 5 KB + testes ~20 KB ≈ 7k
- S2 = engine.ts 23 KB, ownerLock.ts ~9 KB, processIdentity.ts ~5 KB, testes ~20 KB ≈ 14k
- S3 = store.ts 15 KB, tolerant.ts ~8 KB, failClosed.ts ~3 KB, settings.ts (trecho) ~3 KB, testes ~30 KB ≈ 15k
- S4 = backup.ts 25 KB, backupManifest.ts ~9 KB, system.ts/cli.ts/server.ts (trechos) ~20 KB, testes ~45 KB ≈ 25k
- Transversais (lista de leituras de `fs`, docs, STATE) ≈ 12k
- S1-S4 + transversais ≈ 73k, abaixo do orçamento de 150k - one builder
- Rodada 1 (correção estrutural pedida pelo orquestrador depois da verificação FAIL): fail-closed dos campos de segurança, provas dos mutantes sobreviventes, recuperação da restauração por todo caminho de volta à home, espiar a versão do banco sem tocá-lo, ordem dos backups pelo nome - um construtor
- Rodada 2: `RestoreLock` (exclusão mútua da restauração, da recuperação e da construção do motor, no kernel), diário validado, `excludes` e as chaves `enabled` fechados, classificação folha a folha, espiar a versão sem SQLite quando não há WAL, mensagens 409, provas de processos reais - um construtor, ≈ 40k adicionais
- Rodada 3: o `RestoreLock` ganha os modos compartilhado/exclusivo (o backup o segura inteiro, o motor até o banco abrir), o diário nomeia os onze alvos por `slot` e não por caminho, o que a recuperação não consegue colocar fica como está e recusa tudo (`RestoreLeftoverError`), o arquivo do lock é criado só se ausente, não é reentrante, é conferido pelo inode depois de tomado e o que não pode ser lock é dito (`RestoreLockError`), o estouro dos 5000 mantém as exclusões legíveis do dono, e as provas de processos reais das alegações do lock (C77-C86) - um construtor, ≈ 45k adicionais
