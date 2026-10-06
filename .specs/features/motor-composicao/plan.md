# Motor com ciclo de vida próprio — `createEngine()` no core

## Problem

Quem quer usar o motor do MordomoOS fora da API Fastify (um app desktop, uma extensão de editor,
um teste) não tem por onde: o motor é montado dentro de `apps/api/src/context.ts` (`AppContext`),
junto com token HTTP, cache de saúde e credenciais de broker. A política de escrita (recusar,
pedir aprovação ou liberar uma execução de escrita) e a lista de pastas onde um `cwd` pode cair
moram em `apps/api/src/routes/common.ts`. Quem chama `RunManager` direto não recebe nenhuma das
duas.

Pior, montar o motor já muda estado. O construtor de `AppContext` roda
`objectives.recover(this.runs)`, e cada comando da CLI (`doctor`, `status`, `backup`, `index`,
`sync`… 17 pontos em `apps/api/src/cli.ts`) monta um `AppContext` novo enquanto o serviço pode
estar rodando. O processo da CLI não tem execuções ativas, então `recover()` conclui que as do
servidor morreram: etapas de objetivo com execução na fila voltam para `pending` e são
despachadas de novo (duplicação), e etapas com execução `running` viram `blocked`. O
`RunManager` também poda eventos (e pode rodar `VACUUM`) no construtor. Não há `busy_timeout`
no SQLite (`core/src/db/db.ts`), então CLI e servidor escrevendo ao mesmo tempo recebem
`SQLITE_BUSY` em vez de esperar.

Quem paga: o usuário que roda `mordomo doctor` com o serviço no ar e vê um objetivo despachar
duas vezes ou travar; e quem quiser embutir o motor, que hoje precisa copiar a API inteira.
Evidência: análise do motor de 06/10/2026 (achados S4 e S5); não há relato de usuário.

## Flow

Reutiliza os stores e gerenciadores que já existem no core (`RunManager`, `ObjectiveStore`,
`RoutineScheduler`, `SentinelRunner`, `ApprovalStore`, `writeDecision`, `resolveInsideRoots`):
o motor só os monta e dá a eles um ciclo de vida; nenhum é reescrito.

1. Embutidor (ou `AppContext`) → `createEngine({ home, providers, … })` em `core/src/engine.ts`
   (door 1): resolve caminhos, semeia a home, abre o banco (`core/src/db/db.ts`, exists, agora com
   `busy_timeout`), monta os stores. Nada de recuperação, poda nem timers aqui.
2. `engine.start()` (door 1) → adquire `config/run/engine.lock` (door 2) → poda eventos
   (`RunManager`, exists) → `objectives.recover` (`ObjectiveStore`, exists) →
   `runs.recoverInterrupted` (exists) → `scheduler.start` e `sentinels.start` (exist).
3. Política → `engine.gateWrite(…)`, `engine.assertWriteAllowed(…)`, `engine.grantedRoots()` e
   `engine.resolveCwd(…)` no motor (door 1), chamados pelas rotas de `apps/api/src/routes/common.ts`
   (exists), que deixam de ter cópia própria.
4. `apps/api/src/context.ts` (exists): `AppContext extends MordomoEngine` e guarda só o que é da
   API (token, credenciais de broker, cache de saúde dos provedores).
5. `apps/api/src/server.ts` (exists) `startServer` chama `ctx.start()` no lugar de
   `recoverInterrupted` + `scheduler.start` + `sentinels.start`; se o lock é de um serviço
   MordomoOS que ficou para trás (`apps/api/src/instances.ts`, exists), ele é encerrado e o
   `start()` é repetido, como a tomada da porta já fazia; o fechamento libera o lock em
   `ctx.close()`.
6. `apps/api/src/cli.ts` (exists): os comandos continuam montando `AppContext` e nunca chamam
   `start()`.

## Impact

| Front       | What changes                                                                                                                                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | novo termo: `MordomoEngine` - o motor montado, com `start()`/`stop()`; vive em `core/src/engine.ts`                                                                                                                                       |
| domain      | novo termo: `dono do motor` - o processo que segura `config/run/engine.lock`; só ele recupera estado e liga timers                                                                                                                        |
| domain      | termo existente: `AppContext` era o motor inteiro, passa a ser motor + preocupações HTTP; quem o usa hoje: todas as rotas, `cli.ts`, `server.ts` e ~30 arquivos de teste, que continuam funcionando porque os campos ficam no mesmo lugar |
| domain      | termo existente: `RunManager` podava no construtor por padrão; passa a podar só quando o motor chama, no `start()`; quem constrói `RunManager` direto (testes do core) mantém a opção `pruneOnBoot`                                       |
| stored data | nada a migrar - o lock é um arquivo novo em `config/run/`; `busy_timeout` é pragma de conexão                                                                                                                                             |
| contrato    | `@mordomo/core` passa a exportar `createEngine`, `MordomoEngine` e `EngineLockedError`                                                                                                                                                    |

## Relations

None - no stored-data shape change

## Surface

None - nothing consumed outside (as rotas HTTP não mudam; o export novo do core está em `Landing`)

## Landing

| One-way door                    | Literal shape                                                                                                                                                                                                                                                                                                                                                          | Alternative rejected                                                                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. API pública do motor no core | `export function createEngine(opts: EngineOptions): MordomoEngine`; `EngineOptions = { home?: string; providers: ProviderRegistry; seedDir?: string \| null; applyPendingRestore?: boolean; permissionBroker?: PermissionBrokerFactory }`; métodos `start(): void`, `stop(timeoutMs?): Promise<void>`, `gateWrite`, `assertWriteAllowed`, `grantedRoots`, `resolveCwd` | Função que devolve um objeto literal com os stores: a API não tem como herdar (`AppContext extends`) e cada rota teria que trocar `ctx.runs` por outra coisa, um diff de ~30 arquivos sem ganho |
| 2. Lock de dono do motor        | arquivo `config/run/engine.lock` com `{"pid":<n>,"startedAt":<ms>}`, criado com `fs.openSync(…, "wx")`; lock de PID morto é retomado; `start()` com lock vivo de outro processo lança `EngineLockedError` (`code: "engine_locked"`)                                                                                                                                    | Lock pelo `server.pid` que já existe: ele é escrito depois do `listen`, tarde demais para proteger a recuperação, e é do servidor HTTP, não do motor (um embutidor sem HTTP não o escreve)      |
| 3. Pragma `busy_timeout`        | `db.pragma("busy_timeout = 5000")` em `openDb`                                                                                                                                                                                                                                                                                                                         | Repetir a escrita em `SQLITE_BUSY` em cada store: dezenas de pontos de escrita, e o SQLite já oferece a espera                                                                                  |

| 4. Lock criado já com o PID (acrescentado na rodada 2) | o lock nasce por `fs.linkSync(<temp com {"pid","startedAt"}>, "config/run/engine.lock")`; `start()` devolve `{ recovered: number }` | `fs.openSync("wx")` + `writeSync` (forma da door 2): deixa uma janela em que outro processo lê o lock vazio, o considera ilegível e também o toma |

- Limite conhecido: dois `start()` simultâneos sobre um lock de PID morto ainda podem ambos retomá-lo (ler o dono, apagar, linkar não é atômico); exige dois serviços subindo no mesmo instante sobre a mesma home
- Nothing else in this change is hard to reverse

## Criteria

### S1: Montar o motor não muda estado (P1)

O que toda CLI faz, montar um `AppContext`, deixa o banco como estava.

**Acceptance Criteria**

1. WHEN an engine (or an `AppContext`) is constructed over a home holding an objective step `dispatched` whose run is `queued` THEN the step SHALL stay `dispatched` with the same `run_id`
2. WHEN an engine is constructed over a home holding an objective step `dispatched` whose run is `running` THEN the step SHALL stay `dispatched`, not `blocked`
3. WHEN an engine is constructed over a home holding a run `running` THEN the run SHALL stay `running`
4. WHEN an engine is constructed THEN no `engine.lock` file SHALL be created

**Independent test:** semear uma etapa `dispatched`, montar `AppContext`, ler a etapa: continua `dispatched`.

### S2: Só o dono recupera e liga timers (P1)

**Acceptance Criteria**

5. WHEN `engine.start()` runs over a home holding an objective step `dispatched` whose run is `queued` and not active THEN the step SHALL become `pending` with `run_id` null
6. WHEN `engine.start()` runs over a home holding a run `running` THEN the run SHALL become `interrupted`
7. WHEN `engine.start()` succeeds THEN `config/run/engine.lock` SHALL exist holding the current `pid`
8. IF `config/run/engine.lock` names a live process other than the current one THEN `engine.start()` SHALL throw `EngineLockedError` with `code` `"engine_locked"` and the objective step SHALL stay `dispatched`
9. IF `config/run/engine.lock` names a process that no longer exists THEN `engine.start()` SHALL take the lock and recover
10. WHEN `engine.stop()` completes THEN `config/run/engine.lock` SHALL no longer exist
11. WHEN the API service starts (`startServer`) THEN it SHALL hold `config/run/engine.lock` and runs left `running` SHALL be `interrupted`

**Independent test:** dois motores na mesma home: o segundo `start()` lança `engine_locked`.

### S3: O SQLite espera em vez de falhar (P2)

**Acceptance Criteria**

12. The database connection opened by `openDb` SHALL report `busy_timeout` = `5000`

**Independent test:** `db.pragma("busy_timeout", { simple: true })` devolve `5000`.

### S4: Um embutidor tem o motor e a política sem a API (P1)

**Acceptance Criteria**

13. WHEN a program importing only `@mordomo/core` and `@mordomo/adapter-claude` creates an engine, starts it and submits a read-only run to the fake Claude CLI THEN the run SHALL reach status `done`
14. WHILE the profile is `review_before_write`, WHEN `engine.gateWrite` is called for a `write` run from a manual origin THEN it SHALL return a pending approval of kind `write_run` and a run in `waiting_approval`
15. IF the profile is `read_only` and `engine.assertWriteAllowed` is called for a `write` run THEN it SHALL throw with `statusCode` `403` and `code` `"profile_refused"`
16. IF `engine.resolveCwd` gets a path outside the home and the enabled indexed folders THEN it SHALL throw `PathAccessError`
17. The API routes SHALL keep their behaviour: the existing profile, submission and containment suites (`tests/api.profiles.test.ts`, `tests/api.submission.test.ts`, `tests/api.hardening.test.ts`) SHALL pass unchanged

**Independent test:** um script com `createEngine` e o CLI falso do Claude chega a `done`.

## Out of scope

| Excluded                                                                                  | Why                                                                                             |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Tirar layout, HUD, tema e idioma do schema de configurações do motor                      | feature 5 `contratos` (`UiPreferences`)                                                         |
| Erros tipados sem `statusCode` HTTP no core                                               | feature 7 `api-v1`, que define o envelope único                                                 |
| Mover o fluxo de submissão de conversa (`submitPromptRun`, recibos, sessões) para o motor | depende dos contratos tipados da feature 5; nesta feature o motor ganha a política, não o fluxo |
| Barramento de eventos por instância (hoje `events` é global do processo)                  | feature 5 `contratos`, junto com os eventos tipados                                             |
| Separar `RunManager` em repositório, executor e contabilidade                             | refatoração sem mudança de comportamento; fica para quando a feature 8 mexer na execução        |

## Assumptions

| Assumption                                                        | Chosen default                                                                 | Rationale                                                                                  | Confirmed? |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ---------- |
| Valor do `busy_timeout`                                           | 5000 ms                                                                        | escritas do motor são curtas; 5 s cobre um backup online sem prender a CLI por muito tempo | n          |
| `mordomo run` na CLI com o serviço no ar                          | executa sem `start()` (sem lock, sem recuperação), como hoje menos o `recover` | o comando roda uma execução e sai; não deve disputar o lock com o serviço                  | n          |
| Lock em plataforma sem `process.kill(pid, 0)` confiável (Windows) | mesma checagem; `kill(pid, 0)` funciona no Windows para PID existente          | é o mesmo teste que `instances.ts` já usa                                                  | n          |

**Open questions:** none - all resolved or logged above.

## Observable

| Surface                             | Decision                             | Landing                                                                                        |
| ----------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| API `createEngine` (export do core) | error shape and codes                | AC 8 (`EngineLockedError`, `engine_locked`), AC 15, AC 16                                      |
| API `createEngine` (export do core) | who may call it                      | n/a - biblioteca local, sem autenticação                                                       |
| API `createEngine` (export do core) | versioning                           | n/a - pacotes seguem `private` e na mesma versão até a feature 5 publicar `@mordomo/contracts` |
| command `mordomo <qualquer>`        | output and exit codes                | existing - nenhum comando muda de saída                                                        |
| command `mordomo start`             | what it prints when it fails halfway | AC 8 - `engine_locked` sai como erro de inicialização                                          |

## Sources

- Análise do motor de 06/10/2026 (nesta sessão) - achados S4 (CLI muda estado do servidor) e S5 (motor acoplado à API)
- `.specs/STATE.md` AD-003 - ordem do roteiro
