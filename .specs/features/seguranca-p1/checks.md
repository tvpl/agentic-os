# Segurança P1 checks

Profile: standard
Plan: `.specs/features/seguranca-p1/plan.md`

17 checks in 4 slices · 2 one-way doors · 0 open, of which 0 block

Comandos (da raiz): `npx vitest run tests/security-p1.test.ts -t "<nome>"`. As provas de git usam um
repositório temporário criado no teste (`git init`), e as de processo concorrente usam `fork` de um
script curto.

## Checks

### S1 - o home não é legível pela API · 4 files · 40 KB · ~10k

**C1** - `GET /api/memory/preview` com `p` = cada um de `config/token`, `config/vapid.json`, `config/registry-signing.json`, `config/settings.json`, `config/ui-preferences.json`, `config/db/mordomo.db`, `config/tls/key.pem`, `config/backups/x/a.json` e `logs/runs.jsonl` do home responde `403` `forbidden_path`, com um token de dispositivo e com o do dono (AC 1)
Proof: `npx vitest run tests/security-p1.test.ts -t "C1 no file under the home's config or logs is previewable"`
Status: open

**C2** - O mesmo para `<home>/config/../config/token`, um symlink dentro de `<home>/memory` apontando para `config/token`, `<home>/CONFIG/token` (home em sistema insensível a caixa simulado pelo filtro), `<home>/config/token.` e `<home>/config//token` (AC 2)
Proof: `npx vitest run tests/security-p1.test.ts -t "C2 path tricks do not reach the config directory"`
Status: open

**C3** - `<home>/memory/note.md`, `<home>/skills/x/SKILL.md` e `<home>/artifacts/r1/out.txt` continuam sendo pré-visualizados (`200`) (AC 3)
Proof: `npx vitest run tests/security-p1.test.ts -t "C3 memory, skills and artifacts stay previewable"`
Status: open

**C4** - `POST /api/memory/open` e o indexador recusam `<home>/config/token` e `<home>/logs/x`; um arquivo `config/app.json` dentro de uma pasta indexada do usuário (fora do home) continua legível e indexável (AC 4, door 1)
Proof: `npx vitest run tests/security-p1.test.ts -t "C4 open and index refuse the home config; user config folders stay readable"`
Status: open

### S2 - o diff não executa o repositório · 3 files · 30 KB · ~8k

**C5** - Toda chamada de `git` da rota de diff leva `core.fsmonitor=false`, `core.hooksPath` nulo, `--no-textconv`, `--no-ext-diff` e o ambiente `GIT_CONFIG_NOSYSTEM=1` e `GIT_CONFIG_GLOBAL` nulo (a função `git()` é exercitada com um `git` falso que registra argv e ambiente) (AC 5)
Proof: `npx vitest run tests/security-p1.test.ts -t "C5 every git call of the diff route is neutralised"`
Status: open

**C6** - Num repositório real com `core.fsmonitor`, `diff.x.textconv` (com `.gitattributes`) e um hook configurados para criar um arquivo marcador, `GET /api/runs/:id/diff` devolve o diff e nenhum marcador aparece (AC 6)
Proof: `npx vitest run tests/security-p1.test.ts -t "C6 a hostile repository config does not run on diff"`
Status: open

### S3 - permissões e tokens · 5 files · 50 KB · ~12k

**C7** - Num home novo (POSIX), `config`, `config/db`, `config/backups`, `logs` e `config/run` têm modo `0700`; `mordomo.db`, um backup criado e um arquivo de log têm `0600` (AC 7)
Proof: `npx vitest run tests/security-p1.test.ts -t "C7 a new home is private to its owner"`
Status: open

**C8** - Num home existente com tudo em `0755`/`0644`, montar o motor corrige os modos para os mesmos valores; num home com o modo certo, não grava nada (mesmo `mtime`) (AC 8)
Proof: `npx vitest run tests/security-p1.test.ts -t "C8 an existing home is tightened once"`
Status: open

**C9** - 20 processos filhos chamando `getOrCreateToken()` ao mesmo tempo num home sem token devolvem o mesmo valor, e o arquivo contém exatamente esse valor (AC 9)
Proof: `npx vitest run tests/security-p1.test.ts -t "C9 concurrent token creation agrees on one token"`
Status: open

**C10** - `git check-ignore` confirma que `config/token`, `config/vapid.json`, `config/registry-signing.json`, `config/tls/key.pem`, `config/ui-preferences.json`, `config/db/mordomo.db`, `config/settings.json.v1.bak` e `x.bak` são ignorados, e que `core/src/config/store.ts` e `apps/command-centre/src/config/x.ts` (código sob uma pasta chamada `config` fora da raiz do home) não são (AC 10)
Proof: `npx vitest run tests/security-p1.test.ts -t "C10 private home files are git-ignored and source files are not"`
Status: open

### S4 - o SSE se recupera · 4 files · 40 KB · ~10k

**C11** - Num servidor real, `GET /api/events` com `Last-Event-ID` maior que o último id manda `stream.reset` (com `lastId`) como primeiro quadro de dados, reenvia o anel e entrega um evento novo depois (AC 11)
Proof: `npx vitest run tests/security-p1.test.ts -t "C11 a stale resume point gets a stream reset"`
Status: open

**C12** - Com `Last-Event-ID` dentro da faixa, ou ausente, nenhum `stream.reset` é enviado e o replay é o de antes (AC 13)
Proof: `npx vitest run tests/security-p1.test.ts -t "C12 an in-range resume point replays as before"`
Status: open

**C13** - A interface, ao receber `stream.reset`, invalida suas consultas (o mapa de invalidação o inclui como `stream.reconnected`) (AC 12)
Proof: `npm run test -w apps/command-centre -- src/queries.test.ts -t "C13 a stream reset refreshes every query"`
Status: open

**C14** - `OsEventMap` tem a chave `stream.reset` com `{ lastId: number }` e `v` 1 (door 2; o teste de tipos de eventos continua exaustivo nos dois sentidos)
Proof: `npx tsc -p typetests/tsconfig.json`
Status: open

### Fechamento

**C15** - `docs/security.md` descreve o bloqueio do home, o git neutralizado, os modos de arquivo (e que no Windows não se aplicam) e o `stream.reset`; a seção "Not covered" não lista mais o que foi coberto (AC 1-13)
Proof: `npx vitest run tests/security-p1.test.ts -t "C15 the security doc describes what is enforced"`
Status: open

**C16** - A suíte da raiz e da interface, o typecheck e o lint saem `0` (AC 1-13)
Proof: `npm run typecheck && npm run lint`
Status: open

**C17** - `tests/api.test.ts` "preview refuses secrets" continua passando e ganha um caso por arquivo secreto do home (regressão de C1 no teste antigo) (AC 1)
Proof: `npx vitest run tests/api.test.ts -t "preview"`
Status: open

## Coverage

| Set (size)                                 | Member -> proof                                                                                                                                                                                                                                                                        | Unproven |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| arquivos secretos do home (9)              | token, vapid, registry-signing, settings, ui-preferences, db, tls key, backups, logs - C1, table-driven over all 9                                                                                                                                                                     | -        |
| truques de caminho (5)                     | `..` C2 · symlink C2 · caixa C2 · ponto final C2 · barra dupla C2                                                                                                                                                                                                                      | -        |
| entradas que leem arquivos do home (3)     | preview C1 · open C4 · indexador C4                                                                                                                                                                                                                                                    | -        |
| diretórios do home que seguem legíveis (3) | memory C3 · skills C3 · artifacts C3                                                                                                                                                                                                                                                   | -        |
| configurações do git neutralizadas (4)     | fsmonitor C5, C6 · hooks C5, C6 · textconv C5, C6 · config global/sistema C5                                                                                                                                                                                                           | -        |
| diretórios com modo restrito (5)           | config C7 · db C7 · backups C7 · logs C7 · run C7                                                                                                                                                                                                                                      | -        |
| arquivos com modo restrito (3)             | banco C7 · backup C7 · log C7                                                                                                                                                                                                                                                          | -        |
| situações do home quanto ao modo (3)       | novo C7 · existente frouxo C8 · já certo C8                                                                                                                                                                                                                                            | -        |
| padrões do `.gitignore` (10)               | `config/token` C10 · `vapid.json` C10 · `registry-signing.json` C10 · `tls/key.pem` C10 · `ui-preferences.json` C10 · `db/mordomo.db` C10 · `settings.json.v1.bak` C10 · `x.bak` C10 · `core/src/config/store.ts` não ignorado C10 · `command-centre/src/config/x.ts` não ignorado C10 | -        |
| pontos de retomada do SSE (3)              | acima do último id C11 · dentro da faixa C12 · ausente C12                                                                                                                                                                                                                             | -        |
| doors (2)                                  | bloqueio do `config` do home C1-C4 · `stream.reset` C11-C14                                                                                                                                                                                                                            | -        |

- Claims naming a status code or route: C1, C2, C3, C6, C11, C12 - provados por `inject` ou servidor real

## Test policy

| Code                                                                  | Required proofs      | Coverage expectation        |
| --------------------------------------------------------------------- | -------------------- | --------------------------- |
| Decides, reached across a boundary (preview, open, diff, SSE)         | one at the boundary  | each file, trick and status |
| Decides, not reached across a boundary (filtro, modos, token, ignore) | one at its own layer | each member of each set     |

Evidence:

- `core/src/memory/excludes.ts` filtro: caminho × raiz × segmento -> decides
- closest analogue in the repo: `tests/api.security-p0.test.ts` (a mesma forma: rota + arquivo secreto)

Cost: 1 arquivo de teste novo, 17 provas.

## Swept

- validation: C2 (variações de caminho)
- failure modes: C9 (corrida de criação do token), C6 (repositório hostil)
- idempotency: C8 (corrigir o modo uma vez e não regravar)
- authorization: C1 (dispositivo e dono), regra de auth das features 1 e 7: existing
- concurrency: C9
- data lifecycle: C7, C8 (home novo e existente)
- dependency failure: C5 (git ausente ou configuração hostil não executam nada)
- state transitions: n/a - nenhuma máquina de estados muda
- observability: C11 (o reset é um evento visível ao cliente)

## Handoff

- S1-S4 ≈ 35k: excludes.ts 6 KB, preview.ts 6 KB, memory.ts rota 10 KB, runs.ts diff 10 KB, paths.ts 5 KB, store.ts 8 KB, sse.ts + events.ts 8 KB, queries.ts trecho 4 KB, docs 6 KB, teste novo ~30 KB ≈ 93 KB / 4 ≈ 23k, mais leitura - abaixo de 150k - one builder
