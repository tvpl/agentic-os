# Provedores plugáveis checks

Profile: standard
Plan: `.specs/features/provedores-plugaveis/plan.md`

21 checks in 4 slices · 3 one-way doors · 0 open, of which 0 block

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

## Coverage

| Set (size)                            | Member -> proof                                                                                                                     | Unproven |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------- |
| entradas que recebem `provider` (7)   | `POST /api/runs` C4 · rota de skill C5 · sessões C5 · rotinas C5 · agendador C6 · CLI C7 · `detect`/`models` C8                     | -        |
| registros gravados com provedor (4)   | `settings.json` C2 · rotina C3 · skill C3 · conector C3                                                                             | -        |
| consumidores de manifesto no core (3) | registro C10 · auditor C10 · compilador C10                                                                                         | -        |
| manifestos embutidos (3)              | claude C9, C13 · cursor C9, C13 · codex C9, C13                                                                                     | -        |
| membros da allowlist (2 regras)       | `node` C14 · `binary` registrado C14 / não registrado C15                                                                           | -        |
| `binaryPath` (3)                      | nome errado C16 · nome certo (posix e Windows) C17 · `null` C17                                                                     | -        |
| listas fixas na interface (6)         | `SkillList` C18, C19 · `SkillsSceneTools` C18, C19 · `Routines` C18, C19 · `Setup` C18, C19 · `authRecovery` C20 · `failureFix` C20 | -        |
| doors (3)                             | formato do id C1 · forma de `providers` C2 · allowlist C14-C17                                                                      | -        |

- Claims naming a status code or route: C4, C5, C8, C13, C16, C17 - provados por `inject` na rota

## Test policy

| Code                                                                    | Required proofs      | Coverage expectation       |
| ----------------------------------------------------------------------- | -------------------- | -------------------------- |
| Decides, reached across a boundary (rotas com `provider`, `binaryPath`) | one at the boundary  | each route and each status |
| Decides, not reached across a boundary (registro, allowlist, schema)    | one at its own layer | each rule above            |
| Instrumentation (interface trocando a fonte das listas)                 | unit + source check  | each list                  |

Evidence:

- `core/src/agents/registry.ts` `register()`/`create()`: formato do id e coerência manifesto↔adaptador -> decides
- `core/src/spawn/safeSpawn.ts` `assertAllowed()`: nome base × manifestos -> decides
- closest analogue in the repo: `tests/api.test.ts` "rejects runs of unknown or disabled providers"; `tests/core.security.test.ts` "rejects non-allowlisted executables"

Cost: 1 arquivo de teste novo na raiz, 1 na interface, 21 provas; testes existentes que importam `BUILTIN_MANIFESTS` passam a importar dos pacotes de adaptador.

## Swept

- validation: C1 (formato do id), C16, C17 (`binaryPath`)
- failure modes: C4-C8 (provedor desconhecido recusado antes de qualquer processo), C2, C3 (nada gravado é descartado)
- idempotency: n/a - nada novo é gravado além do que `PUT /api/settings` já grava
- authorization: C14-C16 (o que pode ser executado); quem chama as rotas: existing - regra de auth da feature 1
- concurrency: n/a - o registro é montado no boot e em `reloadAdapters`, no mesmo processo
- data lifecycle: C2 (chaves de provedor desconhecidas sobrevivem a uma gravação)
- dependency failure: n/a - nenhuma dependência nova
- state transitions: C6 (rotina `queued` → `failed` sem processo)
- observability: C13 (`loginCommand` visível ao cliente)

## Handoff

- S1-S4 ≈ 71k: settings.ts trecho 8 KB, registry.ts 8 KB, safeSpawn.ts 12 KB, engine.ts trecho 10 KB, auditor/compiler trechos 8 KB, 3 adaptadores (cabeçalho) 12 KB, rotas com `provider` trechos ~25 KB, cli.ts trechos 15 KB, 7 arquivos da interface em trechos ~40 KB, testes novos ~25 KB, testes existentes a ajustar ~20 KB ≈ 183 KB / 4 ≈ 46k, mais leitura e execução - abaixo de 150k - one builder
