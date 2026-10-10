# Dados v2 — migração sem corrida, dono sem PID reciclado, configurações tolerantes, backups verificáveis

## Problem

Os quatro pontos onde o MordomoOS guarda estado que não se recompra têm uma janela em que dois
processos, ou o tempo, o corrompem sem aviso. A revisão crítica de 07/10/2026 (`review-arch`) apontou
os quatro; o código confirma cada um:

1. **A migração do banco corre entre processos.** `openDb` lê `user_version` fora de qualquer
   transação (`core/src/db/db.ts`), calcula as migrações pendentes a partir dessa leitura, copia o
   arquivo do banco com `copyFileSync` e só depois abre uma transação comum (`BEGIN` adiado). A CLI e o
   serviço abrem o mesmo arquivo (a CLI monta um `AppContext` a cada comando): duas instâncias que
   leem `user_version` = 3 ao mesmo tempo rodam as migrações 4..N duas vezes, e a segunda falha em
   `CREATE TABLE` ou, pior, duplica um `up()` que não é idempotente. A cópia de segurança por
   `copyFileSync` é lida enquanto outro processo pode estar escrevendo no WAL. O `busy_timeout` só é
   ligado depois de `journal_mode = WAL`, que já exige o arquivo livre.
2. **O lock de dono confunde um PID reciclado com o dono.** `config/run/engine.lock` guarda só
   `{pid, startedAt}` e `pidAlive` só faz `kill(pid, 0)` (`core/src/engine.ts`). Depois de um
   reboot ou de muito uso, o sistema entrega aquele PID a outro programa: o lock de um serviço morto
   parece vivo e o serviço novo não sobe (`engine_locked`), ou, no sentido oposto, nada o distingue do
   dono real. E a retomada de um lock morto (ler o dono, apagar, `link`) não é atômica: o plano da
   feature `motor-composicao` registrou o limite ("dois `start()` simultâneos sobre um lock de PID morto
   ainda podem ambos retomá-lo") — dois donos, com `recoverInterrupted` rodando duas vezes.
3. **Um campo inválido derruba o serviço.** `SettingsStore.load()` faz `SettingsSchema.parse` do
   documento inteiro; um único campo fora do contrato (`port: "abc"`, um `limits.maxConcurrentRuns`
   de 99, um provedor com `binaryPath` numérico, uma pasta indexada sem `path`) joga uma exceção, e
   quem chama (`AppContext`, toda rota, toda CLI) cai. A mensagem manda "corrigir ou apagar
   `settings.json`" — apagar leva junto todo o resto. E a cada `load()` que falha o código copia o
   arquivo para um novo `settings.json.corrupt.<ts>`, sem limite. Um `save()` sobre um arquivo que não
   se lê (JSON quebrado) o sobrescreve sem guardar o que estava lá.
4. **Um backup não prova que está inteiro.** `createBackup` copia diretórios e o banco; nada registra o
   que deveria haver neles. `restoreBackup` valida só o banco (`user_version`, `quick_check`) e então
   instala `skills/`, `memory/`, `routines/`, `connectors/` e as configurações como estão: um arquivo
   truncado por um disco cheio, um `SKILL.md` adulterado ou uma pasta apagada é restaurado em silêncio
   por cima de dados bons. Backups nunca são apagados (a pasta cresce sem limite), e uma restauração
   interrompida no meio (processo morto entre os `rename`) deixa a home com metade dos alvos trocados e
   nada que a desfaça.

Quem paga: o dono que vê o serviço recusar subir por um PID alheio ou por um campo que digitou errado,
que restaura um backup e descobre depois que ele estava truncado, ou que roda `mordomo doctor` com o
serviço subindo. Evidência: a revisão crítica de 07/10/2026 e o limite registrado em
`.specs/features/motor-composicao/plan.md` (door 4); não há relato de usuário.

Depois desta feature: abrir o banco de dois processos juntos aplica cada migração uma vez; o lock de dono
reconhece o processo pelo instante de início e nunca tem dois donos; um `settings.json` com um campo
errado sobe com o valor padrão daquele campo, avisa no log e guarda o original em `.invalid`; um backup
traz o SHA-256 de cada arquivo, a restauração recusa o que não bate (e não deixa a home pela metade) e o
número de backups guardados é configurável.

## Flow

Reutiliza `openDb`/`MIGRATIONS` (a lista e o runner continuam os mesmos), `MordomoEngine.start()` e o
`EngineLockedError` (o lock continua sendo o arquivo `config/run/engine.lock` criado por `link`), o
`SettingsStore` e o `SettingsSchema` do contrato (o esquema decide o que é válido; nada de um validador
paralelo), e o esqueleto de `createBackup`/`restoreBackup` (a cópia em staging, o rollback e a
restauração agendada no boot); nada disso é reescrito, ganha-se uma verificação e uma exclusão mútua.

1. **Migração.** `openDb` (exists, `core/src/db/db.ts`): abre o arquivo, liga `busy_timeout` antes de
   qualquer instrução que trave, confere a versão; se há migração pendente, tira o instantâneo
   consistente (`VACUUM INTO`, door 6) e roda `runMigrations` (exists, passa a ser exportada) em
   `BEGIN EXCLUSIVE`: relê `user_version` já com o lock, aplica só o que ainda falta, grava a nova
   versão na mesma transação; uma migração que falha desfaz tudo e vira `MigrationError` (door 6); o
   instantâneo de quem não migrou nada é apagado. `tightenMode` (exists, `core/src/paths.ts`) deixa de abrir
   um descritor num arquivo que já tem o modo certo, e `openDb` aperta o banco e os `-wal`/`-shm` antes
   de abrir a conexão (achado da construção: abrir e fechar qualquer descritor num arquivo que o SQLite tem
   aberto derruba os locks do processo sobre ele, e dois processos abrindo juntos recebiam
   `SQLITE_PROTOCOL`).
2. **Lock de dono.** `MordomoEngine.start()` (exists) → `OwnerLock.acquire()` (door 2, módulo novo
   `core/src/ownerLock.ts`) dentro de `BEGIN IMMEDIATE` no banco da própria home (door 3): lê o
   `engine.lock`; se há dono, pergunta a `processIdentity` (new, no door - placement per conventions,
   `core/src/processIdentity.ts`) se aquele PID ainda é o mesmo processo; se não é, apaga o lock
   obsoleto e cria o seu por `link` de um temporário completo. `stop()`/`close()` → `OwnerLock.release()`
   apaga o arquivo só se o `token` é o seu.
3. **Configurações.** `SettingsStore.load()` (exists): `JSON.parse` → `migrateSettings` (exists) →
   `parseTolerant` (new, no door - placement per conventions, `core/src/config/tolerant.ts`) valida com
   o `SettingsSchema` e, a cada falha, tira do documento o valor no caminho da falha e valida de novo, até
   passar; o que foi tirado volta como `SettingsIssue[]`; o original vai para `settings.json.invalid`
   (door 4), uma linha por campo vai para `logs/settings.jsonl`, e o resultado entra no cache por
   `mtime`+tamanho como hoje. `save()`/`update()` (exist) guardam o original no `.invalid` antes de
   substituir um arquivo que tem campo inválido ou não é JSON.
4. **Backup.** `createBackup` (exists, `core/src/backup.ts`) copia como hoje e, em `finalize`, grava
   `manifest.json` (door 5, `core/src/backupManifest.ts` novo) antes de publicar a pasta; com `keep`,
   apaga os backups selados que sobram (door 7). `POST /api/backups` e `mordomo backup` (exist) passam
   `settings.limits.backupRetention`.
5. **Restauração.** `restoreBackup` (exists): valida o banco da origem como hoje (mesma mensagem);
   copia cada conjunto para o staging (`.restore-*`) como hoje; **verifica as cópias do staging contra
   o manifesto** (`backupManifest.verifyMounts`); só então tira a cópia de segurança, grava o diário do
   staging e instala (`-wal`/`-shm` antes do banco). `recoverInterruptedRestore` (new, no door -
   placement per conventions, em `backup.ts`) desfaz uma restauração cujo processo morreu, e roda no
   começo de `applyPendingRestore` e de `restoreBackup`.
6. **Rota e CLI.** `POST /api/backups/:name/restore` (exists, `apps/api/src/routes/system.ts`)
   chama `verifyBackup` (async, cede o laço entre arquivos) antes de agendar; `422` se falhar.
   `mordomo restore` (exists) aceita `--allow-unverified`; `mordomo backup --list` marca o backup sem
   manifesto. No boot, `applyPendingRestore` que falha na verificação não derruba o serviço:
   `MordomoEngine.restoreRejectedAtBoot` e uma linha de aviso em `startServer` (exists).

## Impact

| Front       | What changes                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | novo termo: `procStart` - o identificador opaco do instante de início de um processo (`linux:<boot_id>:<ticks>`, `ps:<epoch s>`, `win:<ticks>`); vive em `core/src/processIdentity.ts`                                                                                                                                                                                                                                          |
| domain      | novo termo: `backup selado` - um backup com `manifest.json`; o sem manifesto é `legado` (todo backup feito antes desta feature)                                                                                                                                                                                                                                                                                                 |
| domain      | novo termo: `campo inválido` - um valor de `settings.json` que o `SettingsSchema` recusa; lê-se como o padrão do campo e o original fica em `.invalid`                                                                                                                                                                                                                                                                          |
| domain      | existente: `engine.lock` era `{pid, startedAt}` e "vivo" era `kill(pid, 0)`; passa a ser `{v, pid, startedAt, token, procStart}` e "vivo" exige o mesmo `procStart`; quem lê hoje: `MordomoEngine.lockHolder()` (usado por `startServer` via `EngineLockedError.holderPid`) e um binário anterior da CLI, que só lê `pid` e continua funcionando                                                                                |
| domain      | existente: `tightenMode` abria um descritor em todo arquivo que apertava, inclusive no banco aberto; passa a olhar o modo por `lstat` e abrir só o que precisa mudar; quem chama hoje: `openDb`, `tightenHomeFiles` (início do motor), `ensureDirs`, o fim de `createBackup` e as cópias de segurança                                                                                                                           |
| domain      | existente: `restoreBackup` sempre restaurava um backup cujo banco abrisse; passa a recusar o que não bate com o manifesto e o legado (salvo `--allow-unverified`); quem chama hoje: `mordomo restore`, `applyPendingRestore` (boot do serviço) e 4 arquivos de teste                                                                                                                                                            |
| domain      | existente: `SettingsStore.load()` jogava exceção em qualquer campo inválido; passa a devolver o padrão do campo; quem ramifica nisso hoje: nada captura essa exceção (a mensagem só chegava ao usuário como falha de inicialização)                                                                                                                                                                                             |
| domain      | existente: `createBackup` nunca apagava; passa a apagar os selados além de `limits.backupRetention` (padrão 10) quando quem chama passa `keep`; quem chama: `POST /api/backups`, `mordomo backup`                                                                                                                                                                                                                               |
| stored data | `engine.lock` e backups novos mudam de formato; um `engine.lock` antigo (sem `procStart`) é lido como "vivo se o PID existe", como antes; um backup antigo não tem manifesto e **não é apagado por retenção** nem restaurado sem `--allow-unverified`; o banco não muda de esquema (nenhuma migração nova); `settings.json` não é reescrito por esta feature; `limits.backupRetention` ausente lê-se 10 (campo novo com padrão) |

## Relations

None - no stored-data shape change (o manifesto e o lock são arquivos novos de formato próprio, não
entidades do banco; os formatos estão em `Landing`)

## Surface

| Route                             | In                                     | Out                                                                     | Status                                                           |
| --------------------------------- | -------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `POST /api/backups/:name/restore` | `:name` (`full-…`)                     | `{ staged, restored, name, stagedAt, apply, message }` · error envelope | `202`, `404`, `409`, `422` (`backup_invalid`, `backup_unsealed`) |
| `PUT /api/settings` (campo novo)  | `limits.backupRetention` (inteiro ≥ 1) | settings salvas                                                         | `200`, `400`                                                     |

Comando (sem código HTTP): `mordomo restore <name> [--allow-unverified]` imprime uma linha de resultado, ou o motivo da recusa em `stderr`; saída `0` restaurado, `1` recusado ou falhou, `2` uso incorreto.

## Landing

| One-way door                                                   | Literal shape                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Alternative rejected                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Formato do `config/run/engine.lock`                         | `{"v":2,"pid":<n>,"startedAt":<ms>,"token":"<32 hex>","procStart":"<opaco>"\|null}`, criado completo por `link(temp, engine.lock)`; um binário anterior lê só `pid` e `startedAt` e continua certo                                                                                                                                                                                                                                                                                              | Manter `{pid, startedAt}` e checar `kill(pid, 0)`: um PID reciclado parece vivo; arquivo com `mtime` renovado por heartbeat: um notebook suspenso passa o prazo e o lock vivo vira "obsoleto", dois donos                                                                                                                                  |
| 2. `OwnerLock` e o que ele decide                              | `core/src/ownerLock.ts`: `class OwnerLock { constructor(file, db); acquire(): void; release(): void; holder(): LockOwner \| null }`, `class EngineLockedError extends Error { code = "engine_locked"; holderPid: number \| null }` (reexportada por `engine.ts`); obsoleto = ilegível, ou PID morto, ou PID do próprio processo, ou `procStart` registrado diferente do atual; **na dúvida é dono** (lock sem `procStart` com PID vivo, ou `procStart` registrado e leitura indisponível agora) | Tratar o lock sem `procStart` como obsoleto depois de um tempo: um serviço antigo ainda vivo perderia o lock; pedir ao dono para apagar o lock à mão: o bug que `engine_locked` já causava                                                                                                                                                 |
| 3. A tomada do lock roda em `BEGIN IMMEDIATE` no banco da home | `db.transaction(() => { /* ler, julgar, apagar o obsoleto, linkar o novo */ }).immediate()`; o SQLite espera até o `busy_timeout` (5 s) e libera sozinho se o processo morrer                                                                                                                                                                                                                                                                                                                   | Um segundo arquivo de "reivindicação" para quebrar o lock obsoleto: ele também fica obsoleto se o processo morre no meio, e quebrá-lo repete a corrida um nível acima; manter o lock aberto no SQLite durante toda a vida do processo: muda o que significa "o próprio processo" (hoje retoma, C22) e depende de travas de arquivo de rede |
| 4. `settings.json.invalid`                                     | os bytes originais de `config/settings.json`, modo `0600`, criados com `wx` (nunca sobrescrevem); se já existe com bytes diferentes, `settings.json.invalid.<12 primeiros hex do SHA-256 dos bytes>`; iguais: nada novo                                                                                                                                                                                                                                                                         | Reescrever o `settings.json` reparado no `load()`: apaga o valor que o dono digitou e muda o arquivo sem ele pedir; um `.corrupt.<ts>` por `load()` (o que existe): cresce a cada leitura que falha                                                                                                                                        |
| 5. `manifest.json` do backup                                   | na raiz da pasta do backup: `{"version":1,"algorithm":"sha256","createdAt":<ms>,"files":[{"path":"config/db/mordomo.db","size":<n>,"sha256":"<64 hex>"}],"links":[{"path":"skills/x","target":"../y"}]}`; `path` relativo com `/`; o manifesto não lista a si mesmo                                                                                                                                                                                                                             | Um `.sha256` ao lado de cada arquivo: um arquivo que ninguém listou (acrescentado) não é detectado e são N arquivos novos; empacotar em tar/zip: `docs/backup-restore-uninstall.md` promete backups restauráveis à mão com `cp -r`                                                                                                         |
| 6. API pública do banco                                        | `openDb(paths, migrations = MIGRATIONS)`, `runMigrations(db, paths, migrations)`, `class MigrationError extends Error { code = "db_migration_failed"; version; migration; backupPath }`, `class DbNewerVersionError extends Error { code = "db_newer"; found; supported }`, todas exportadas de `@mordomo/core`; o instantâneo pré-migração é `VACUUM INTO` (consistente sob WAL, preserva `user_version`)                                                                                      | `Error` simples: a CLI e a API não distinguem "banco de uma versão futura" de "migração quebrada"; `copyFileSync` do arquivo: lê um banco WAL que outro processo está escrevendo (instantâneo rasgado)                                                                                                                                     |
| 7. Retenção e erros dos backups                                | campo `limits.backupRetention: z.number().int().min(1).default(10)` no `SettingsSchema`; `createBackup(paths, db, { includeArtifacts?, keep? })` apaga, depois de publicar, os `full-…` além dos `keep` mais novos que tenham manifesto, não sejam link e não sejam o da `restore-pending`; `class BackupVerificationError extends Error { code: "backup_invalid" \| "backup_unsealed"; statusCode = 422; problems }`; `restoreBackup(paths, name, { allowUnverified? })`                       | Retenção por idade (`backupRetentionDays`): uma semana sem backups apagaria todos; `0` = sem limite: uma chave que desliga a proteção por engano (quem quer guardar mais põe 1000); `409` para backup inválido: o `409` desta rota já significa "execuções ativas"                                                                         |

- Limite deliberado: o manifesto detecta dano e edição acidental, não um adversário que escreva em `config/backups/` (quem reescreve os arquivos reescreve o manifesto); assinar exigiria uma chave fora da home e fica para a feature `distribuicao`
- Limite deliberado: a exclusão mútua do lock vale entre processos desta versão em diante (todos abrem o mesmo banco); um binário anterior ainda vivo usa o protocolo antigo e não participa dela
- Nothing else in this change is hard to reverse (o diário de restauração `.restore-*/JOURNAL.json` é interno e só esta versão o lê)

## Criteria

### S1: A migração do banco não corre entre processos (P1)

Abrir o mesmo banco de vários processos juntos deixa a versão nova aplicada uma vez, ou recusa com a causa.

**Acceptance Criteria**

1. WHEN three processes call `openDb` at the same moment on a database below the newest version THEN every call SHALL return, `user_version` SHALL equal the newest version, and each migration SHALL have run exactly once
2. WHEN pending migrations exist on a database that already has data THEN `openDb` SHALL write `config/backups/mordomo.db.v<from>.<stamp>.bak` before applying them, a consistent snapshot that opens at `user_version` = `<from>` with the same rows (mode `0600` on POSIX), and SHALL return its path as `backupPath`
3. WHEN another process has applied every pending migration while this one waited for the exclusive lock THEN this call SHALL apply none, return `fromVersion` = `toVersion` and `backupPath` null, and leave no backup file of its own
4. IF a migration throws THEN `openDb` SHALL throw `MigrationError` (`code` `"db_migration_failed"`) whose message names the migration version, its name and the backup path, the database SHALL stay at `fromVersion` with none of this run's schema changes, and the file SHALL be openable again
5. IF `user_version` is above the newest known version THEN `openDb` SHALL throw `DbNewerVersionError` (`code` `"db_newer"`) whose message states both versions and "Use that version or restore a compatible backup", SHALL write no backup, and SHALL leave the file's bytes unchanged
6. WHILE another process holds the database's write lock for less than five seconds, `openDb` SHALL wait and succeed, including on a database that is not yet in WAL mode
7. The list `MIGRATIONS` SHALL be contiguous: versions `1..N`, in order, none repeated
8. WHILE the database is open, the system SHALL NOT open and close a file descriptor on `mordomo.db`, `mordomo.db-wal` or `mordomo.db-shm` to tighten their mode when it already is `0600` (closing any descriptor on a SQLite file drops this process's locks on it)

**Independent test:** três processos abrindo a mesma home com uma migração lenta: o banco termina na versão N e a tabela de marcas tem uma linha por migração.

### S2: O lock de dono distingue o dono de um PID reciclado (P1)

**Acceptance Criteria**

8. WHEN `start()` takes the lock THEN `config/run/engine.lock` SHALL appear already complete, holding `v` = 2, `pid`, `startedAt`, a 32-hex `token` that differs on every acquisition and `procStart` (`null` where the platform gives none)
9. IF the lock names a live pid whose current `procStart` differs from the recorded one THEN `start()` SHALL take the lock over and recover
10. IF the lock names a live pid whose current `procStart` equals the recorded one THEN `start()` SHALL throw `EngineLockedError` (`code` `"engine_locked"`) holding that pid
11. IF the lock records a `procStart` and the platform cannot read that live pid's start now THEN `start()` SHALL throw `EngineLockedError`
12. IF the lock has no `procStart` THEN a live pid SHALL refuse `start()` and a dead pid SHALL be taken over
13. WHEN `processStartMarker` reads a start identity THEN it SHALL return `linux:<boot_id>:<starttime>` from procfs (also for a command name holding spaces and parentheses), `ps:<epoch seconds>` from `ps -o lstart=` read in UTC, `win:<ticks>` from the PowerShell creation time, and `null` when the read fails or does not parse
14. WHEN several processes take the lock (`OwnerLock.acquire()`, the first thing `start()` does) at the same moment on a home whose lock is stale THEN exactly one SHALL own it and every other SHALL throw `EngineLockedError`, in each of 30 rounds
15. WHEN the process that owns the lock is killed with `SIGKILL` THEN the next `start()` SHALL take the lock over
16. WHEN the engine releases the lock THEN `engine.lock` SHALL be removed only if it holds the `token` this engine wrote, and a lock with another `token` SHALL stay
17. The existing lock behaviours SHALL hold unchanged: absent, live foreign, dead pid, this very process, unreadable content, created by `link` with no `.tmp` left behind

**Independent test:** dois motores na mesma home com um lock cujo PID existe mas pertence a outro processo (início diferente): o segundo `start()` assume o lock.

### S3: Configurações toleram campo inválido (P1)

**Acceptance Criteria**

18. IF `settings.json` holds a value that fails the schema in any one top-level field THEN `SettingsStore.load()` SHALL NOT throw, SHALL return the schema default for that field and SHALL keep the file's value for every other field, for each top-level field of `SettingsSchema`
19. IF the invalid value is nested THEN `load()` SHALL drop only that value: an invalid `providers.claude.binaryPath` keeps `providers.claude.enabled` and the other providers, an invalid element of `indexedFolders` is removed and the others stay in order, and an invalid `limits.maxConcurrentRuns` takes its default and keeps the other `limits`
20. WHEN `load()` drops a field THEN `config/settings.json.invalid` SHALL hold the file's original bytes (mode `0600`); WHEN it already holds different bytes THEN the original SHALL go to `settings.json.invalid.<first 12 hex of its SHA-256>`; an existing `.invalid` SHALL never be overwritten and identical bytes SHALL not be written twice
21. The system SHALL leave `settings.json` byte for byte as it was after a `load()` that dropped fields
22. WHEN `load()` drops fields THEN it SHALL append one record per field with its path and reason to `logs/settings.jsonl`, once per version of the file (a second `load()` of the same file adds none)
23. WHEN `save()` or `update()` replaces a `settings.json` that holds an invalid field or is not valid JSON THEN the previous bytes SHALL already be in a `.invalid` file
24. IF `settings.json` is not valid JSON or its root is not an object THEN `load()` SHALL throw as before, with the copy `settings.json.corrupt.<ts>` and a message that says to fix the file
25. IF a hand-edited `limits.backupRetention` is 0, negative or not an integer THEN `load()` SHALL read 10 and `PUT /api/settings` SHALL answer `400`

**Independent test:** `settings.json` com `port: "abc"` e `systemName: "Casa"`: o serviço sobe na porta padrão, o nome é `Casa` e o original está em `settings.json.invalid`.

### S4: Backups verificáveis, restauração atômica e retenção (P1)

**Acceptance Criteria**

26. WHEN a backup is created THEN `manifest.json` SHALL exist at its root before the folder is published, listing every file (`path`, `size`, `sha256`) and every link (`path`, `target`) in it, with `version` 1 and `algorithm` `"sha256"`, and not listing itself
27. WHEN `restoreBackup` runs THEN it SHALL compare the copies it staged (not the originals) with the manifest before the safety backup is made and before any live file is moved
28. IF a file differs by content, by size, is missing, is not in the manifest, or a link changed, or the manifest cannot be read as a manifest THEN `restoreBackup` SHALL throw `BackupVerificationError` (`code` `"backup_invalid"`, `statusCode` 422) naming up to five problems by path and kind, and SHALL leave the live files, the database and `config/backups/` as they were and no `.restore-*` folder behind
29. IF the backup has no `manifest.json` THEN `restoreBackup` SHALL throw `BackupVerificationError` with `code` `"backup_unsealed"` unless called with `allowUnverified`, which restores after the database checks only
30. WHEN `restoreBackup` is interrupted after some live targets were moved and its process died THEN `recoverInterruptedRestore` SHALL put every moved target back so the live files equal their state before the restore, and SHALL leave alone a restore whose process is alive
31. WHEN `restoreBackup` installs THEN it SHALL move the database's `-wal` and `-shm` away before it replaces the database file
32. IF `POST /api/backups/:name/restore` names a backup that fails verification THEN the route SHALL answer `422` with `error.code` `"backup_invalid"` or `"backup_unsealed"` and SHALL NOT write `config/restore-pending/`
33. IF a restore staged for the next boot fails verification THEN the engine SHALL start with the current data, clear the pending restore and report it in `restoreRejectedAtBoot` (`name`, `message`)
34. WHEN `createBackup` is given `keep` = N and more than N `full-…` backups exist after publishing THEN it SHALL delete the oldest beyond N, only those that have a manifest, are not links and are not the one named by `restore-pending`, and SHALL never delete the backup it just made
35. WHEN `POST /api/backups` or `mordomo backup` creates a backup THEN it SHALL pass `settings.limits.backupRetention` (integer ≥ 1, default 10) as `keep`
36. WHEN `mordomo backup --list` lists a backup without a manifest THEN the line SHALL say `unsealed`
37. WHEN a backup whose database is at an older version than the newest is restored THEN the next `openDb` SHALL bring it to the newest version with its rows intact

**Independent test:** criar um backup, trocar um byte de um `SKILL.md` dentro dele e restaurar: recusa com `backup_invalid` nomeando o arquivo, e a home segue como estava.

## Out of scope

| Excluded                                                                                        | Why                                                                                                                                     |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Assinar o manifesto (HMAC ou chave pública)                                                     | exige uma chave fora da home; é da feature `distribuicao` (instaladores e updater assinados). O SHA-256 detecta dano e edição acidental |
| Tela de configurações para a retenção e rótulo "sem manifesto" na lista de backups da interface | a feature não toca em tela; o valor se edita por `PUT /api/settings` e a CLI mostra `unsealed`                                          |
| Reter as cópias pré-migração `mordomo.db.v*.bak`                                                | outro arquivo, outra política; acumulam uma por migração, não por uso                                                                   |
| Corrida na migração de `settings.json` (a cópia `settings.json.v<n>.bak`)                       | arquivo e mecanismo distintos; o resultado das duas instâncias é o mesmo documento                                                      |
| Endurecer `server.pid`                                                                          | já guarda `token`, `startedAt` e confere a linha de comando (`isServiceProcess`); a feature trata o lock de dono                        |
| Linha no `doctor` para campos inválidos                                                         | a informação fica no log e no `.invalid`; mostrar no `doctor` é uma superfície nova                                                     |
| Restaurar um arquivo ou uma pasta de um backup                                                  | a restauração é do conjunto                                                                                                             |

## Assumptions

| Assumption                                               | Chosen default                                                                                                                                                           | Rationale                                                                                                                         | Confirmed? |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Um backup feito antes desta feature (sem manifesto)      | `restoreBackup` recusa com `backup_unsealed`; `mordomo restore --allow-unverified` o restaura com as checagens de antes; a rota da API recusa (`422`) e não tem o desvio | o padrão seguro: nada é restaurado sem prova; o dono que quer o backup antigo tem a CLI                                           | n          |
| Retenção: quantos e o que nunca se apaga                 | 10; só apaga backup selado, nunca o legado, nunca o da `restore-pending`                                                                                                 | quem já tem 30 backups antigos não os perde no primeiro backup novo; o contador conta todos                                       | n          |
| `settings.json` que não é JSON                           | continua a lançar, guardando `settings.json.corrupt.<ts>`                                                                                                                | zerar tudo para o padrão em silêncio (portas, pastas concedidas, provedores) é pior que parar com a causa; não é "campo inválido" | n          |
| Campo inválido reverte ao padrão do esquema              | o mesmo valor que um campo ausente teria (`securityProfile` inválido volta a `review_before_write`, o padrão restritivo)                                                 | nenhum padrão do esquema afrouxa a segurança; é o que uma instalação nova teria                                                   | n          |
| Janela do `busy_timeout` ao tomar o lock                 | 5000 ms (o do banco); estourar propaga o erro `SQLITE_BUSY`                                                                                                              | o lock demora milissegundos; mais de 5 s é um banco travado de verdade, que `doctor` já mostra                                    | n          |
| Plataformas sem leitura do início do processo            | `procStart` `null` e vale só PID (como hoje)                                                                                                                             | Windows lê por PowerShell, mas se ele falhar não se perde o lock de um serviço vivo                                               | n          |
| Linux em contêiner sem `/proc/sys/kernel/random/boot_id` | `procStart` `null`                                                                                                                                                       | não há identidade confiável; cai no comportamento de hoje                                                                         | n          |

**Open questions:** none - all resolved or logged above (as três decisões do dono — backups legados, retenção, JSON quebrado — estão registradas em `.specs/STATE.md` com o padrão seguro escolhido).

## Observable

| Surface                                                  | Decision                                                                  | Landing                                                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| API `POST /api/backups/:name/restore`                    | response shape, error shape with its codes                                | AC 32 (`422`, `backup_invalid`, `backup_unsealed`), existing - `202`, `404`, `409` como hoje                                               |
| API `POST /api/backups/:name/restore`                    | who may call it                                                           | existing - rota `scope: "owner"`                                                                                                           |
| API `POST /api/backups/:name/restore`                    | versioning, rate limits                                                   | n/a - a rota não muda de caminho; o limite de tentativas é o de autenticação já existente                                                  |
| command `mordomo restore`                                | flags and their default, exit codes, what it prints when it fails halfway | AC 29, AC 28 (exit `1`, motivo em `stderr`); o uso incorreto continua `2`                                                                  |
| command `mordomo backup`                                 | output and what it prints on retention                                    | AC 35; o resultado imprime o caminho como hoje, e as exclusões por retenção saem em uma linha `removed N old backup(s)`                    |
| command `mordomo backup --list`                          | output format                                                             | AC 36                                                                                                                                      |
| command `mordomo start`                                  | what it prints when it fails halfway                                      | AC 4 e AC 5 (a mensagem de `MigrationError` e `DbNewerVersionError` sai como erro de inicialização); AC 33 (aviso de restauração recusada) |
| API `PUT /api/settings` (campo `limits.backupRetention`) | error shape and codes, validation                                         | AC 25 (`400 validation`)                                                                                                                   |
| all `/api/*`                                             | empty/loading/unauthorised states                                         | n/a - nenhuma tela nem rota nova                                                                                                           |

## Sources

- Revisão crítica de 07/10/2026 (`review-arch`), itens de dados — entrega S3 do `.specs/roadmap.md` (migração sem corrida, lock sem PID reciclado, configurações tolerantes, backups com checksum e retenção)
- `.specs/features/motor-composicao/plan.md`, door 4 — registra o limite que a AC 14 fecha
- `.specs/STATE.md` AD-004 (só o dono recupera) e as lições L-011, L-024, L-025, L-027 e L-030
