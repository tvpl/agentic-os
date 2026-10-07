# Provedores plugáveis — um provedor novo é um pacote, não uma edição no núcleo

## Problem

O conjunto de provedores é fechado em três lugares que não deveriam saber quais provedores
existem. `ProviderId` é um `z.enum(["claude", "cursor", "codex"])` (`contracts/src/settings.ts:3`),
e `settings.providers` é um objeto com essas três chaves (`:285-291`), que descarta qualquer outra
sem avisar. Os manifestos dos três moram no core (`BUILTIN_MANIFESTS`,
`core/src/agents/registry.ts:116-184`), e os pacotes de adaptador só os reexportam. A allowlist de
executáveis é uma lista fixa (`BASE_ALLOWLIST`, `core/src/spawn/safeSpawn.ts:16`) e não usa o campo
`binary` do manifesto, apesar do comentário dizer que usa.

Para um terceiro, ou para o próprio MordomoOS ao ganhar um quarto provedor (Gemini CLI, Aider), isso
significa editar o schema, o core, a allowlist, a CLI e cinco listas na interface. É o oposto de um
SDK. Pior, um valor desconhecido persistido derruba coisas inteiras. Um `defaultProvider` desconhecido
em `settings.json` faz o `SettingsStore` recusar o arquivo todo (`core/src/config/store.ts:62-79`).
Uma rotina, uma skill ou um conector com provedor desconhecido somem para `problems`. Um id válido no
enum mas não registrado vira `500` (`apps/api/src/routes/system.ts:487,502`).

Há também um furo de segurança no mesmo lugar. A allowlist aceita qualquer arquivo cujo nome base
seja `claude`, `codex` ou `cursor-agent`, de qualquer diretório. E `providers.*.binaryPath` é gravado
por `PUT /api/settings` sem validação, e o adaptador então fixa esse caminho como permitido.

Evidência: mapeamento de provedores de 06/10/2026 nesta sessão (achados 1-6) e a análise do motor de
06/10/2026 (achado S5, "provedores fechados").

## Flow

Reutiliza o `ProviderRegistry` (`core/src/agents/registry.ts`), que já registra manifesto + fábrica,
e o padrão de configuração global de `safeSpawn` que a feature 4 criou (`setProbeEnvDrop`).

1. Identidade → `contracts/src/settings.ts` (exists): `ProviderId` vira uma string com formato
   (door 1). `BUILTIN_PROVIDER_IDS` lista os três embutidos. `settings.providers` vira um registro por
   id (door 2), sempre com as três chaves embutidas preenchidas e sem descartar as outras.
2. Manifestos → cada `adapters/<id>/src/manifest.ts` (new) declara o seu. `core/src/agents/registry.ts`
   (exists) perde `BUILTIN_MANIFESTS` e `builtinManifests()`. O auditor de conectores
   (`core/src/connectors/auditor.ts`, via `homeConfigFilesOf(manifests)`) e o compilador de sync
   (`core/src/sync/compiler.ts`, `getManifests` obrigatório) recebem os manifestos do registro.
3. Registro → `ProviderRegistry.register()` (exists) aceita qualquer id no formato e exige `manifest.id` igual
   ao `adapter.id` criado pela fábrica.
4. Allowlist → `core/src/spawn/safeSpawn.ts` (exists): `node` + o `binary` de cada manifesto
   registrado, por `setProviderBinaries()`, chamado pelo motor ao montar e ao recarregar adaptadores.
5. Validação → `apps/api/src/routes/common.ts` (exists) ganha `requireProvider(ctx, id)` (e
   `requireAdapter` para as rotas que usam o adaptador). Um id bem formado mas não registrado responde
   `400 unknown_provider` em todas as rotas que recebem provedor; a CLI confere `--provider` (e o
   `defaultProvider`) contra os ids registrados; o `RunManager` termina `failed` ("unknown provider") uma
   execução já gravada cujo provedor sumiu. `PUT /api/settings` recusa um `binaryPath` novo cujo nome
   base não é o `binary` do manifesto (`400 binary_mismatch`); um valor já gravado não é revalidado.
6. Interface → as listas fixas de provedores (`views/Skills/SkillList.tsx`, exists;
   `nucleo/scenes/SkillsSceneTools.tsx`, `views/Routines.tsx`, `views/Setup.tsx`) passam a vir dos
   snapshots de `GET /api/providers` (`providers/options.ts`, new: `providerOptions`). Os dois mapas de
   comando de login que discordam entre si (`runs/authRecovery.ts`, `runs/failureFix.ts`) passam a ler
   `loginCommand` do snapshot, que vem do manifesto, e os outros leitores do mapa (`ProviderGate`, o
   pré-voo do console, `Setup`, Ajustes › provedores, o modo foco) também.

## Impact

| Front       | What changes                                                                                                                                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | termo existente: `ProviderId` deixa de ser a lista dos provedores e passa a ser o formato de um id; "os provedores" são os registrados                                                                                                    |
| domain      | novo termo: `loginCommand` - o comando que a pessoa roda no terminal para autenticar o CLI; vive no manifesto                                                                                                                             |
| contrato    | `@mordomo/contracts`: `ProviderId` vira `string` com formato; quem usava a união fechada (`Record<ProviderId, …>`) passa a tratar a ausência de uma chave                                                                                 |
| contrato    | API: id bem formado mas desconhecido responde `400` com `error.code` `"unknown_provider"` (antes `400 validation` ou `500 internal`); `GET /api/providers` ganha `loginCommand` em cada snapshot                                          |
| contrato    | API: `PUT /api/settings` com `providers.<id>.binaryPath` de nome base errado responde `400 binary_mismatch`                                                                                                                               |
| contrato    | `@mordomo/adapter-*`: cada pacote exporta `<id>Manifest` declarado nele mesmo; `@mordomo/core` deixa de exportar `BUILTIN_MANIFESTS` e `builtinManifests`                                                                                 |
| contrato    | `@mordomo/core`: novos `BUILTIN_PROVIDER_IDS`, `setProviderBinaries`, `executableName`, `homeConfigFilesOf`; `runAudit`/`discoverMcpServers` exigem a lista de arquivos e `SyncCompiler` exige `getManifests` (antes caíam nos embutidos) |
| stored data | `settings.json`: as chaves de `providers` que não são embutidas passam a ser mantidas; nenhum arquivo existente muda de forma                                                                                                             |

## Relations

None - no stored-data shape change (o registro aceita o que o objeto aceitava, e mais)

## Surface

| Route                                                                     | In                                       | Out                                | Status                         |
| ------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------- | ------------------------------ |
| `POST /api/runs`, `POST /api/skills/:slug/run` e as demais com `provider` | `provider` bem formado e não registrado  | `error.code` `"unknown_provider"`  | `400` (antes `400 validation`) |
| `POST /api/providers/:id/detect`, `GET /api/providers/:id/models`         | `:id` bem formado e não registrado       | `error.code` `"unknown_provider"`  | `400` (antes `500 internal`)   |
| `PUT /api/settings`                                                       | `providers.<id>.binaryPath` de outro CLI | `error.code` `"binary_mismatch"`   | `400` (antes `200`)            |
| `GET /api/providers`                                                      | -                                        | cada snapshot ganha `loginCommand` | `200`                          |

## Landing

| One-way door                         | Literal shape                                                                                                                                                                                            | Alternative rejected                                                                                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Formato do id de provedor         | `ProviderId = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/)`; `BUILTIN_PROVIDER_IDS = ["claude", "cursor", "codex"] as const`                                                                               | Manter a união e gerá-la a partir dos adaptadores instalados: o tipo dependeria de quais pacotes estão no build, e um terceiro não conseguiria compilar sem editar o contrato |
| 2. Forma de `settings.providers`     | `Record<ProviderId, ProviderSettings>`; depois do parse, as três chaves embutidas sempre existem (com os padrões de hoje) e as outras são mantidas como vieram                                           | Uma lista `[{ id, … }]`: muda a forma de todo `settings.json` existente e de cada patch parcial da interface, sem ganho sobre o registro                                      |
| 3. Fonte da allowlist de executáveis | `node` + `manifest.binary` de cada provedor registrado, comparado pelo nome base (sem `.exe`/`.cmd`/`.bat` no Windows); o caminho de `binaryPath` só é aceito se o nome base for o `binary` do manifesto | Allowlist só por caminho absoluto: o provedor que o usuário instalou no PATH sem configurar `binaryPath` deixaria de rodar                                                    |

- Nothing else in this change is hard to reverse

## Criteria

### S1: Um id de provedor aberto, sem derrubar o que já está gravado (P1)

**Acceptance Criteria**

1. The `ProviderId` schema SHALL accept any string matching `^[a-z][a-z0-9-]{1,31}$` and SHALL reject `"Claude"`, `""` and `"a"`
2. WHEN `settings.json` carries `defaultProvider: "gemini"` and `providers.gemini` THEN the settings SHALL load, and `providers.gemini` SHALL be kept as written while `providers.claude`, `providers.cursor` and `providers.codex` exist with their defaults
3. WHEN a routine file, a skill frontmatter or a connector record names a provider that is well formed but not registered THEN it SHALL load (it SHALL NOT be listed under `problems`)
4. WHEN a run is started for a provider that is well formed but not registered (API, CLI, routine or skill) THEN it SHALL be refused before any process starts: the API with `400` and `error.code` `"unknown_provider"`, the CLI with exit code 2
5. WHEN `POST /api/providers/:id/detect` or `GET /api/providers/:id/models` names a well-formed id that is not registered THEN the API SHALL answer `400` with `error.code` `"unknown_provider"`

**Independent test:** um `settings.json` com `defaultProvider: "gemini"` sobe o motor, e `POST /api/runs` com `provider: "gemini"` responde `400 unknown_provider`.

### S2: Cada adaptador carrega o próprio manifesto (P1)

**Acceptance Criteria**

6. The builtin adapter packages SHALL each export its manifest declared in its own source (`adapters/<id>/src/manifest.ts`), and `@mordomo/core` SHALL NOT export `BUILTIN_MANIFESTS` nor `builtinManifests`
7. WHEN a provider with a new id (`"acme"`) is registered with its manifest and factory THEN `ids()` SHALL include it, the connector auditor and the sync compiler SHALL see its manifest, and a run on it SHALL execute through its adapter
8. IF a factory creates an adapter whose `id` differs from its manifest `id` THEN `register()` or the first `create()` SHALL throw `ProviderRegistryError`
9. The provider manifests SHALL each declare `loginCommand`, and `GET /api/providers` SHALL return it in each snapshot (`claude` → `claude auth login`, `cursor` → `cursor-agent login`, `codex` → `codex login`)

**Independent test:** um provedor `acme` registrado num teste roda uma execução pelo seu CLI falso.

### S3: A allowlist vem dos manifestos e o caminho do binário é conferido (P1)

**Acceptance Criteria**

10. The executable allowlist SHALL contain `node` and the `binary` of every registered manifest, and nothing else; WHEN the `acme` provider (binary `acme-cli`) is registered THEN `acme-cli` SHALL be allowed and, before that, refused
11. IF no registered manifest declares `cursor-agent` THEN `assertAllowed("/usr/bin/cursor-agent")` SHALL throw `ExecutableNotAllowedError`
12. WHEN `PUT /api/settings` sets `providers.<id>.binaryPath` to an absolute path whose basename (without `.exe`, `.cmd` or `.bat`) is not that manifest's `binary` THEN the API SHALL answer `400` with `error.code` `"binary_mismatch"` and the settings SHALL NOT change
13. WHEN `PUT /api/settings` sets `providers.claude.binaryPath` to `/opt/x/claude` or to `null` THEN the API SHALL answer `200`

**Independent test:** `binaryPath` do Claude apontando para `/bin/sh` é recusado.

### S4: A interface lista os provedores registrados (P2)

**Acceptance Criteria**

14. The Command Centre source (outside tests and the component gallery) SHALL NOT contain a literal list of provider ids (`["claude", "cursor", "codex"]` in any order) nor a `Record<ProviderId, …>` literal; the lists SHALL come from the provider snapshots
15. The login command shown after an authentication failure SHALL be the snapshot's `loginCommand`, in both `runs/authRecovery.ts` and `runs/failureFix.ts`
16. The typecheck (`npm run typecheck`) and the Command Centre test suite SHALL pass

**Independent test:** com um snapshot `acme` na resposta de `/api/providers`, o filtro de provedores das skills mostra `acme`.

## Out of scope

| Excluded                                                                     | Why                                                                                                                                                             |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Carregar adaptadores de pacotes instalados em tempo de execução              | precisa de assinatura e de uma decisão de confiança sobre código de terceiros; aqui o registro passa a aceitar, a fonte segue sendo `apps/api/src/providers.ts` |
| Caminho de busca do Windows do `cursor-agent` (`core/src/spawn/which.ts:57`) | é detalhe de instalação do Cursor; vai para o manifesto junto com a feature 14 (distribuição)                                                                   |
| Escopo de token para `PUT /api/settings`                                     | é a feature 7 (`api-v1`); aqui só se valida o valor de `binaryPath`                                                                                             |
| Ícones por provedor                                                          | não existem hoje                                                                                                                                                |

## Assumptions

| Assumption                                         | Chosen default                                                       | Rationale                                                                                   | Confirmed? |
| -------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------- |
| `defaultProvider` não registrado ao montar o motor | carrega; as execuções que usam o padrão respondem `unknown_provider` | derrubar o serviço por uma configuração de provedor é pior que recusar a execução           | n          |
| Ordem dos provedores nas listas                    | a ordem de registro (`claude`, `cursor`, `codex`)                    | é a ordem de hoje; a mensagem da CLI (`tests/cli.test.ts:120`) continua igual               | n          |
| Perfil da verificação                              | `standard`                                                           | nenhuma tela muda de aparência com os três embutidos; as listas só passam a vir do servidor | n          |

**Open questions:** none - all resolved or logged above.

## Observable

| Surface                             | Decision                | Landing                                    |
| ----------------------------------- | ----------------------- | ------------------------------------------ |
| API rotas com `provider`            | error shape             | AC 4, AC 5 - `400 unknown_provider`        |
| API `PUT /api/settings`             | error shape             | AC 12 - `400 binary_mismatch`              |
| API `GET /api/providers`            | response shape          | AC 9 - `loginCommand`                      |
| API (todas)                         | who may call it         | existing - regra de auth da feature 1      |
| command `mordomo run --provider x`  | exit code               | AC 4 - `2`, como um provedor inválido hoje |
| package `@mordomo/core`             | what a consumer imports | AC 6 - sai `BUILTIN_MANIFESTS`             |
| screen `Skills`, `Rotinas`, `Setup` | provider list           | AC 14 - mesma aparência, fonte no servidor |

## Sources

- Mapeamento de provedores de 06/10/2026 (nesta sessão)
- Análise do motor de 06/10/2026 - achado S5
- `docs/adapters-guide.md` - como se adiciona um provedor hoje
