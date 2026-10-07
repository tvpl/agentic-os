# Provedores plugáveis checks

Profile: standard
Plan: `.specs/features/provedores-plugaveis/plan.md`

28 checks in 5 slices · 3 one-way doors · 0 open, of which 0 block

Comandos (da raiz): `npx vitest run tests/providers.pluggable.test.ts -t "<nome>"`; a interface com
`npm run test -w apps/command-centre -- <arquivo> -t "<nome>"`. O provedor de teste `acme` reaproveita o
CLI falso do Claude (`tests/fixtures/fake-bin/claude`) copiado para um diretório temporário com o nome
`acme-cli`, com um manifesto próprio declarado no teste.

## Checks

### S1 - id aberto sem derrubar o que está gravado · 9 files · 90 KB · ~23k

**C1** - `ProviderId.safeParse` aceita `"gemini"`, `"acme-2"` e `"claude"` e recusa `"Claude"`, `""`, `"a"`, `"1x"` e um id de 33 caracteres (AC 1)
Proof: `npx vitest run tests/providers.pluggable.test.ts -t "C1 a provider id is a format, not a list"`
Status: closed

**C2** - Um `settings.json` com `defaultProvider: "gemini"` e `providers.gemini: { enabled: true }` carrega: `providers.gemini.enabled` é `true` e `providers.claude`, `providers.cursor` e `providers.codex` existem com `enabled: false` (AC 2)
Proof: `npx vitest run tests/providers.pluggable.test.ts -t "C2 an unknown provider in settings keeps the file and the builtins"`
Status: closed

**C3** - Uma rotina com `provider: "gemini"`, uma skill com `providers: [gemini]` e um conector com `compatibleProviders: ["gemini"]` carregam e não aparecem em `problems` (AC 3)
Proof: `npx vitest run tests/providers.pluggable.test.ts -t "C3 records naming an unregistered provider still load"`
Status: closed

**C4** - `POST /api/runs` com `provider: "gemini"` responde `400` com `error.code` `"unknown_provider"` e nenhuma execução é criada (AC 4)
Proof: `npx vitest run tests/providers.pluggable.test.ts -t "C4 a run on an unregistered provider is refused"`
Status: closed

**C5** - `POST /api/skills/:slug/run` e a criação de rotina com `provider: "gemini"`, e `POST /api/sessions/:id/continue` numa conversa gravada com `provider: "gemini"` (não existe `POST /api/sessions`: uma conversa nasce de `POST /api/runs`, já coberto por C4), respondem `400 unknown_provider` (AC 4)
Proof: `npx vitest run tests/providers.pluggable.test.ts -t "C5 every route taking a provider refuses an unregistered one"`
Status: closed

**C6** - Uma rotina gravada com `provider: "gemini"` disparada pelo agendador termina `failed` com erro contendo `unknown provider`, sem processo iniciado (AC 4)
Proof: `npx vitest run tests/providers.pluggable.test.ts -t "C6 a routine on an unregistered provider fails without a process"`
Status: closed

**C7** - `mordomo run <skill> --provider gemini` sai com código `2` (AC 4)
Proof: `npm run build:server && npx vitest run tests/providers.pluggable.test.ts -t "C7 the CLI refuses an unregistered provider with exit 2"`
Status: closed

**C8** - `POST /api/providers/:id/detect` e `GET /api/providers/:id/models`, com `:id` = `gemini`, respondem `400 unknown_provider` (antes `500`) (AC 5)
Proof: `npx vitest run tests/providers.pluggable.test.ts -t "C8 provider routes answer 400 for an unregistered id"`
Status: closed

### S2 - cada adaptador carrega o próprio manifesto · 10 files · 80 KB · ~20k

**C9** - `adapters/claude/src/manifest.ts`, `adapters/cursor/src/manifest.ts` e `adapters/codex/src/manifest.ts` existem e declaram `id` igual ao nome do pacote; `@mordomo/core` não tem as exportações `BUILTIN_MANIFESTS` nem `builtinManifests` (AC 6)
Proof: `npx vitest run tests/providers.pluggable.test.ts -t "C9 manifests live in the adapter packages"`
Status: closed

**C10** - Com `acme` registrado, `registry.ids()` termina em `"acme"`, `ConnectorAuditor` lê os `homeConfigFiles` de `acme` e o `SyncCompiler` do motor planeja a pasta de `acme` (AC 7)
Proof: `npx vitest run tests/providers.pluggable.test.ts -t "C10 a registered provider is seen by the auditor and the compiler"`
Status: closed

**C11** - Uma execução manual com `provider: "acme"` termina `done` com a saída do CLI falso (AC 7)
Proof: `npx vitest run tests/providers.pluggable.test.ts -t "C11 a run on a registered third-party provider executes"`
Status: closed

**C12** - Uma fábrica que cria um adaptador com `id` diferente do manifesto faz `create()` lançar `ProviderRegistryError` (AC 8)
Proof: `npx vitest run tests/providers.pluggable.test.ts -t "C12 a factory must create the adapter its manifest names"`
Status: closed

**C13** - `GET /api/providers` traz `loginCommand` `"claude auth login"`, `"cursor-agent login"` e `"codex login"` nos três snapshots (AC 9)
Proof: `npx vitest run tests/providers.pluggable.test.ts -t "C13 each snapshot carries the login command"`
Status: closed

### S3 - allowlist dos manifestos e `binaryPath` conferido · 4 files · 40 KB · ~10k

**C14** - Antes de registrar `acme`, `assertAllowed("/tmp/x/acme-cli")` lança `ExecutableNotAllowedError`; depois, passa; `node` passa sempre (AC 10)
Proof: `npx vitest run tests/providers.pluggable.test.ts -t "C14 the allowlist follows the registered manifests"`
Status: closed

**C15** - Com um registro só com `claude`, `assertAllowed("/usr/bin/cursor-agent")` e `assertAllowed("/usr/bin/codex")` lançam (AC 11)
Proof: `npx vitest run tests/providers.pluggable.test.ts -t "C15 an unregistered binary is not allowed"`
Status: closed

**C16** - `PUT /api/settings` com `providers.claude.binaryPath` `"/bin/sh"` responde `400 binary_mismatch` e `settings.json` fica igual byte a byte (AC 12)
Proof: `npx vitest run tests/providers.pluggable.test.ts -t "C16 a binary path of another program is refused"`
Status: closed

**C17** - `PUT /api/settings` com `providers.claude.binaryPath` `"/opt/x/claude"`, com `"C:\\tools\\claude.exe"` (no win32 simulado por `path.win32`) e com `null` responde `200` (AC 13)
Proof: `npx vitest run tests/providers.pluggable.test.ts -t "C17 a binary path of the right program is accepted"`
Status: closed

### S4 - a interface lista os provedores registrados · 7 files · 70 KB · ~18k

**C18** - Em `apps/command-centre/src` (fora de `*.test.*` e de `gallery/`), nenhum arquivo tem uma lista literal com os três ids (`"claude"`, `"cursor"` e `"codex"` no mesmo literal de array) nem um literal `Record<ProviderId, …>` (AC 14)
Proof: `npx vitest run tests/providers.pluggable.test.ts -t "C18 the UI has no hard-coded provider list"`
Status: closed

**C19** - `providerOptions(snapshots)` (helper da interface usado pelo filtro das skills, das rotinas e do Setup) devolve os ids na ordem dos snapshots, incluindo `acme` (AC 14)
Proof: `npm run test -w apps/command-centre -- src/providers/options.test.ts -t "C19 provider options come from the snapshots"`
Status: closed

**C20** - `loginHint` de `authRecovery.ts` e o comando de `failureFix.ts` devolvem o `loginCommand` do snapshot dado (`acme login` para um snapshot `acme`) (AC 15)
Proof: `npm run test -w apps/command-centre -- src/runs/authRecovery.test.ts -t "C20 the login command comes from the snapshot"`
Status: closed

**C21** - `npm run typecheck` e `npm run test -w apps/command-centre` saem `0` (AC 16)
Proof: `npm run typecheck && npm run test -w apps/command-centre`
Status: closed

### Rodada 2 - lacunas da primeira verificação · 12 files · 90 KB · ~23k

Fecha as lacunas do relatório da rodada 1 (`verification.md`, commit `4d93cbd`). C22-C25 rodam com
`npx vitest run tests/providers.pluggable.test.ts -t "<nome>"`; C26 e C27 rodam na interface com
`npm run test -w apps/command-centre -- src/providers/sources.test.tsx -t "<nome>"`, contra um snapshot
`acme` (`loginCommand: "acme login"`) servido por um `api.get` simulado.

**C22** - `POST /api/runs/:id/retry` numa execução gravada com `provider: "gemini"`, table-driven sobre as três formas (skill `write`, skill `read_only`, prompt), responde `400` com `error.code` `"unknown_provider"` em cada uma, sem criar execução nem recibo em `run_action_receipts` (AC 4)
Proof: `npx vitest run tests/providers.pluggable.test.ts -t "C22 a retry of a run recorded on an unregistered provider is refused"`
Status: closed

**C23** - Table-driven, com `gemini`: `PUT /api/routines/:id`, `POST /api/routines/:id/run` (rotina gravada com `gemini`), `POST /api/runs/:id/children`, `POST /api/objectives/:id/dispatch`, `PUT /api/providers/default`, `POST /api/providers/:id/smoke` e `PUT /api/settings` com `providers.gemini.binaryPath` respondem `400 unknown_provider` cada uma; a rotina editada continua `claude`, nenhuma execução é criada, nenhum passo do objetivo é despachado e `settings.json` fica igual byte a byte (AC 4, AC 5)
Proof: `npx vitest run tests/providers.pluggable.test.ts -t "C23 each remaining route taking a provider refuses an unregistered one"`
Status: closed

**C24** - `engine.gateWrite("write", "skill", …)` com `provider: "gemini"` lança um erro com `statusCode` `400` e `code` `"unknown_provider"`, que não é `ProviderRegistryError` (antes virava `500`) (AC 4)
Proof: `npx vitest run tests/providers.pluggable.test.ts -t "C24 the write gate refuses an unregistered provider with a mapped error"`
Status: closed

**C25** - Com `settings.json` gravado direto com `providers.claude.binaryPath` = `<tmp>/notclaude` (script que cria um arquivo-marcador) e o Claude falso no PATH: uma execução `claude` termina `done` com `"Working on it."` e o marcador não existe; `GET /api/doctor?audit=0` traz um check `warn` cujo rótulo cita `claude` e cujo detalhe cita o caminho; `PUT /api/settings` reenviando o mesmo valor responde `200`, e a execução seguinte também não cria o marcador e o aviso continua; um valor novo `/bin/sh` responde `400 binary_mismatch` (AC 12)
Proof: `npx vitest run tests/providers.pluggable.test.ts -t "C25 a stored mismatched binary path is never executed and doctor names it"`
Status: closed

**C26** - Com um snapshot `acme` sem login (`loginCommand: "acme login"`), `ProviderGate` (linha `gate-provider-acme`), o pré-voo do console (`console-preflight`, depois de Enter num prompt), `Setup` (linha `setup-provider-acme`), Ajustes › provedores (`ProvidersTab`) e o modo foco (item `provider` com `login_required`) mostram `acme login` (AC 15, Flow 6)
Proof: `npm run test -w apps/command-centre -- src/providers/sources.test.tsx -t "C26 every login command reader takes loginCommand from the snapshot"`
Status: closed

**C27** - Com um snapshot `acme`, o filtro de provedor de `SkillList`, os chips de `SkillsSceneTools`, o `select` de provedor do editor de rotina (`RoutineModal`) e o `select` padrão do `Setup` oferecem `acme`; concluir o `Setup` grava `providers.acme.enabled: true` e `defaultProvider: "acme"` (AC 14)
Proof: `npm run test -w apps/command-centre -- src/providers/sources.test.tsx -t "C27 every provider list is the snapshots"`
Status: closed

**C28** - Em `apps/command-centre/src` (fora de `*.test.*` e de `gallery/`), nenhum literal de objeto tem entre as próprias chaves dois ou mais ids embutidos (`{ claude: …, cursor: … }`, com ou sem aspas); o detector acha `{ claude: …, cursor: … }` e `{ "codex": { … }, claude: … }` e não acha `{ claude: …, other: … }` (AC 14)
Proof: `npx vitest run tests/providers.pluggable.test.ts -t "C28 the UI has no map keyed by the built-in provider ids"`
Status: closed

## Coverage

| Set (size)                                    | Member -> proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Unproven |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| entradas que recebem ou leem um provedor (17) | `POST /api/runs` C4 · `POST /api/skills/:slug/run` C5 · `POST /api/sessions/:id/continue` C5 · `POST /api/routines` C5 · `PUT /api/routines/:id` C23 · `POST /api/routines/:id/run` C23 · `POST /api/runs/:id/children` C23 · `POST /api/runs/:id/retry` (skill `write`, skill `read_only`, prompt) C22 · `POST /api/objectives/:id/dispatch` C23 · `PUT /api/providers/default` C23 · `POST /api/providers/:id/detect` C8 · `GET /api/providers/:id/models` C8 · `POST /api/providers/:id/smoke` C23 · `PUT /api/settings` (`providers.<id>.binaryPath`) C23, C16 · `engine.gateWrite` C24 · agendador C6 · CLI `--provider` C7 | -        |
| registros gravados com provedor (6)           | `settings.json` C2 · rotina C3 · skill C3 · conector C3 · linha `runs` (retry) C22 · linha `sessions` (continue) C5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | -        |
| consumidores de manifesto no core (6)         | registro C10 · auditor C10 · compilador C10 · allowlist C14, C15 · `RunManager` C11 · `gateWrite` C24                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | -        |
| manifestos embutidos (3)                      | claude C9, C13 · cursor C9, C13 · codex C9, C13                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | -        |
| regras da allowlist (5)                       | `node` C14 · `binary` registrado C14 · `binary` não registrado C15 · sufixo `.exe/.cmd/.bat` no win32 C17 · caminho gravado só fixado com o nome certo C25                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | -        |
| `binaryPath` (5)                              | nome errado novo C16 · nome certo (posix e Windows) C17 · `null` C17 · gravado divergente reenviado aceito C25 · gravado divergente nunca executado e avisado pelo doctor C25                                                                                                                                                                                                                                                                                                                                                                                                                                                    | -        |
| fontes fixas de provedor na interface (11)    | `SkillList` C19, C27 · `SkillsSceneTools` C19, C27 · `Routines` C27 · `Setup` (lista e gravação) C27 · `authRecovery` C20 · `failureFix` C20 · `ProviderGate` C26, C28 · pré-voo do console C26 · `Setup` (login) C26 · Ajustes › provedores C26 · modo foco C26                                                                                                                                                                                                                                                                                                                                                                 | -        |
| doors (3)                                     | formato do id C1 · forma de `providers` C2 · allowlist C14-C17, C25                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | -        |

O conjunto de entradas foi recomposto com `rg -n "provider|requireProvider|submitPromptRun|launchSkillRun|gateWrite" apps/api/src/routes` (corpo, params e registro gravado). Ficam fora, por não iniciarem execução nem gravarem provedor: `GET /api/runs?provider=` e `GET /api/sessions?provider=` (filtro sobre o histórico; as execuções de um provedor removido continuam listáveis) e `POST /api/objectives/:id/steps/:stepId/retry` (só devolve o passo à fila; o provedor vem do `dispatch`, C23). `PUT /api/settings` com `defaultProvider` não registrado responde `200`, como a suposição do plano manda; as execuções que usam o padrão respondem `unknown_provider` (C4).

- Claims naming a status code or route: C4, C5, C8, C13, C16, C17, C22, C23, C25 - provados por `inject` na rota

## Test policy

| Code                                                                                                    | Required proofs      | Coverage expectation       |
| ------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------- |
| Decides, reached across a boundary (rotas com `provider` ou registro gravado, `binaryPath`, doctor)     | one at the boundary  | each route and each status |
| Decides, not reached across a boundary (registro, allowlist, schema, `gateWrite`, `ignoredBinaryPaths`) | one at its own layer | each rule above            |
| Instrumentation (interface trocando a fonte das listas e dos comandos de login)                         | unit + source check  | each list                  |

Evidence:

- `core/src/agents/registry.ts` `register()`/`create()`: formato do id e coerência manifesto↔adaptador -> decides
- `core/src/spawn/safeSpawn.ts` `assertAllowed()`: nome base × manifestos -> decides
- `core/src/engine.ts` `ignoredBinaryPaths()`/`buildAdapters()`: nome base do `binaryPath` gravado × manifesto -> decides (C25)
- `apps/command-centre/src/providers/sources.test.tsx`: unidade por leitor (C26) e por lista (C27); source check C18 + C28
- closest analogue in the repo: `tests/api.test.ts` "rejects runs of unknown or disabled providers"; `tests/core.security.test.ts` "rejects non-allowlisted executables"

Cost: 1 arquivo de teste novo na raiz, 2 na interface, 28 provas; testes existentes que importam `BUILTIN_MANIFESTS` passam a importar dos pacotes de adaptador.

## Swept

- validation: C1 (formato do id), C16, C17, C25 (`binaryPath`)
- failure modes: C4-C8, C22-C24 (provedor desconhecido recusado antes de qualquer processo), C2, C3 (nada gravado é descartado)
- idempotency: C22 (um retry recusado não deixa recibo em `run_action_receipts`, então o mesmo `submissionId` não fica preso)
- authorization: C14-C16, C25 (o que pode ser executado); quem chama as rotas: existing - regra de auth da feature 1
- concurrency: n/a - o registro é montado no boot e em `reloadAdapters`, no mesmo processo
- data lifecycle: C2 (chaves de provedor desconhecidas sobrevivem a uma gravação)
- dependency failure: n/a - nenhuma dependência nova
- state transitions: C6 (rotina `queued` → `failed` sem processo)
- observability: C13 (`loginCommand` visível ao cliente), C25 (o doctor nomeia o `binaryPath` ignorado)

## Handoff

- S1-S4 ≈ 71k: settings.ts trecho 8 KB, registry.ts 8 KB, safeSpawn.ts 12 KB, engine.ts trecho 10 KB, auditor/compiler trechos 8 KB, 3 adaptadores (cabeçalho) 12 KB, rotas com `provider` trechos ~25 KB, cli.ts trechos 15 KB, 7 arquivos da interface em trechos ~40 KB, testes novos ~25 KB, testes existentes a ajustar ~20 KB ≈ 183 KB / 4 ≈ 46k, mais leitura e execução - abaixo de 150k - one builder
