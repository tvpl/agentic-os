# Preferências da interface checks

Profile: standard
Plan: `.specs/features/preferencias-ui/plan.md`

37 checks in 5 slices · 3 one-way doors · 0 open, of which 0 block

Comandos (da raiz): `npx vitest run tests/preferences.test.ts -t "<nome>"`; a interface com
`npm run typecheck -w apps/command-centre`, `npm run test -w apps/command-centre -- -t "<nome>"` e
`npx eslint --max-warnings=0 apps/command-centre/src`.

## Checks

### S1 - migração sem perder nada · 6 files · 60 KB · ~15k

**C1** - Um `settings.json` v1 com `themePreset: "jarvis"`, um micro app, `brain` e `hud` vira `ui-preferences.json` com esses quatro valores e `settings.json` com `version` 2 e nenhum dos sete campos, depois de montar o motor (AC 1)
Proof: `npx vitest run tests/preferences.test.ts -t "C1 a v1 settings file is migrated without losing a preference"`
Status: closed

**C2** - O arquivo original fica em `config/settings.json.v1.bak`, idêntico byte a byte; a fixture não é JSON canônico (outra indentação e ordem de chaves, sem quebra de linha final), então re-serializar em vez de copiar falha (AC 2)
Proof: `npx vitest run tests/preferences.test.ts -t "C2 the v1 file is kept byte for byte"`
Status: closed

**C3** - Com `ui-preferences.json` já existente (`themePreset: "ocean"`), a migração não o altera e ainda remove os sete campos de `settings.json` (AC 3)
Proof: `npx vitest run tests/preferences.test.ts -t "C3 existing preferences win over the migration"`
Status: closed

**C4** - Montar o motor sobre um `settings.json` já em `version` 2 não reescreve o arquivo (mesmo `mtimeMs` e mesmo conteúdo) (AC 4)
Proof: `npx vitest run tests/preferences.test.ts -t "C4 a migrated file is never rewritten by a load"`
Status: closed

**C5** - Com `settings.json` em `version` 3 no disco, `SettingsStore.save()` lança com `code` `"settings_newer"` e o arquivo fica igual byte a byte (AC 5)
Proof: `npx vitest run tests/preferences.test.ts -t "C5 a newer settings file is never overwritten"`
Status: closed

**C6** - `SettingsSchema.shape` não tem nenhuma das chaves `themePreset`, `microApps`, `dashboardLayout`, `spaces`, `activeSpace`, `hud`, `brain`, e `SettingsSchema.parse({}).version` é 2 (AC 6)
Proof: `npx vitest run tests/preferences.test.ts -t "C6 the engine schema holds no UI preference"`
Status: closed

**C7** - Um `settings.json` sem campo `version` é migrado como v1 (os campos de interface vão para `ui-preferences.json`) (Assumptions)
Proof: `npx vitest run tests/preferences.test.ts -t "C7 a file without version migrates as v1"`
Status: closed

### S2 - rotas das preferências · 4 files · 50 KB · ~13k

**C8** - `GET /api/ui-preferences` numa home nova responde `200` com `themePreset` `"hud-orange"` e `version` 1 (AC 7)
Proof: `npx vitest run tests/preferences.test.ts -t "C8 a new home answers the default preferences"`
Status: closed

**C9** - `PUT /api/ui-preferences` com `{ themePreset: "forest" }` responde `200`; um `GET` seguinte traz `forest` e os `microApps` gravados antes continuam (AC 8)
Proof: `npx vitest run tests/preferences.test.ts -t "C9 a partial preferences patch keeps the rest"`
Status: closed

**C10** - `PUT /api/ui-preferences` com `{ themePreset: "nope" }` responde `400` com `error.code` `"validation"` (AC 9)
Proof: `npx vitest run tests/preferences.test.ts -t "C10 an invalid preference is refused"`
Status: closed

**C11** - `PUT /api/ui-preferences` com `dashboardLayout` e um `dashboardLayoutBase` diferente do gravado responde `409` e o layout gravado continua (AC 10)
Proof: `npx vitest run tests/preferences.test.ts -t "C11 a stale layout write conflicts"`
Status: closed

**C12** - `PUT /api/settings` com cada um dos sete campos responde `400` com `error.code` `"moved_to_ui_preferences"`, e um `settings.json` gravado antes das chamadas continua igual byte a byte (AC 11)
Proof: `npx vitest run tests/preferences.test.ts -t "C12 the settings route refuses moved fields"`
Status: closed

**C13** - `GET /api/settings` não traz nenhum dos sete campos (AC 12)
Proof: `npx vitest run tests/preferences.test.ts -t "C13 settings no longer carry UI preferences"`
Status: closed

**C14** - Um backup criado com `themePreset: "forest"` e restaurado devolve `ui-preferences.json` com `forest` (AC 13)
Proof: `npx vitest run tests/preferences.test.ts -t "C14 preferences survive a backup and restore"`
Status: closed

### S3 - a interface lê das preferências · 9 files · 120 KB · ~30k

**C15** - O tipo `SettingsDoc` da interface não tem os sete campos: `apps/command-centre/src/settings.typetest.ts` afirma `Extract<keyof SettingsDoc, Moved>` igual a `never` em tempo de compilação, e o typecheck da interface (que inclui `src`) sai `0` (AC 14)
Proof: `npm run typecheck -w apps/command-centre`
Status: closed

**C16** - Lido pela AST do TypeScript (comentários e nomes parecidos não contam): fora de `api.ts`, nenhuma chamada `api.put|post|patch|del(…)` tem como primeiro argumento um literal (string, template ou `const` do mesmo arquivo ligada a um literal) que nomeia `/api/settings`; em `api.ts` a única escrita é `putSettings(patch: SettingsPatch)`, com `SettingsPatch = Partial<SettingsDoc> & { [K in MovedSettingKey]?: never }`; `uiPreferences` e `putUiPreferences` apontam para `/api/ui-preferences` (AC 15, AC 21). Rodada 3: C16 deixou de procurar leituras e `fetch` por regex, que davam falso positivo (comentário, variável `settings` ligada às preferências, `fetch` GET) e falso negativo (quebra de linha, cópia, desestruturação). A garantia passou para quem a prova sem depender de grafia: leitura pelo tipo (C29), escrita pelo `Put` pelo tipo (C30), qualquer grafia de escrita em execução (C31), `fetch` cru pelo lint (C32)
Proof: `npx vitest run tests/preferences.test.ts -t "C16 the UI reads and writes preferences through their route"`
Status: closed

**C17** - A chave de query das preferências é invalidada pelo mesmo evento que invalida as configurações (`settings.changed` no mapa de invalidação da interface) (AC 16)
Proof: `npx vitest run tests/preferences.test.ts -t "C17 a saved preference refreshes the UI query"`
Status: closed

### Rodada 2 - lacunas da primeira verificação · 12 files · 90 KB · ~25k

**C18** - Uma home v1 (`mono`) migrada, com as preferências trocadas para `forest`, restaura um backup no formato antigo (`settings.json` v1 com `themePreset: "jarvis"`, `activeSpace: "focus"`, `brain.layout: "rings"`, sem `ui-preferences.json`); na próxima subida `GET /api/ui-preferences` traz `jarvis`, `focus` e `rings`, `settings.json` fica v2 sem os sete campos, e o `.v1.bak` continua o original da primeira migração (AC 17)
Proof: `npx vitest run tests/preferences.test.ts -t "C18 an old backup brings its own preferences back"`
Status: closed

**C19** - `PUT /api/ui-preferences` com `{ themePreset: "forest" }` responde `200` e o barramento do motor recebe exatamente um `settings.changed` (AC 18)
Proof: `npx vitest run tests/preferences.test.ts -t "C19 a saved preference is announced as settings.changed"`
Status: closed

**C20** - Um `settings.json` v1 com `themePreset: "nope"` migra sem erro: `ui-preferences.json` tem `themePreset` `"hud-orange"` e os `microApps`, `brain`, `hud` e `activeSpace` da fixture; `settings.json` fica v2 sem os sete campos (AC 19)
Proof: `npx vitest run tests/preferences.test.ts -t "C20 a v1 file with one invalid preference keeps the valid ones"`
Status: closed

**C21** - Um `settings.json` com `version` 0, e outro com `version` -3, migram como v1 (`themePreset: "ocean"` vai para `ui-preferences.json`, `settings.json` fica v2); uma segunda leitura e uma segunda subida do motor não o reescrevem (mesmo `mtimeMs` e conteúdo) (AC 20)
Proof: `npx vitest run tests/preferences.test.ts -t "C21 a version below 1 migrates once like v1"`
Status: closed

**C22** - O tipo do patch de `api.putSettings` recusa cada um dos sete campos, por literal e por spread (`@ts-expect-error` em `apps/command-centre/src/settings.typetest.ts`, oito linhas), aceita `theme`/`accentColor`/`setupCompleted`, e `MovedSettingKey` é exatamente os sete; o typecheck da interface sai `0` (AC 21)
Proof: `npm run typecheck -w apps/command-centre`
Status: closed

**C23** - Renderizando `Setup` com as duas rotas servindo valores diferentes, escolher JARVIS e concluir chama `putUiPreferences` uma vez com `themePreset: "jarvis"` e um `hud`; a única escrita de configurações (por `putSettings` ou por `api.put|post|patch("/api/settings")`) leva `setupCompleted: true` e nenhum dos sete campos; rodada 3: `putUiPreferences` vem antes de `putSettings` (`invocationCallOrder`), então o setup só fica concluído depois que as duas gravações deram certo (AC 21, Assumptions)
Proof: `npm run test -w apps/command-centre -- -t "C23 setup completion saves the preset and the HUD as UI preferences"`
Status: closed

**C24** - `useBrainState` aplica o `serverBlob` recebido (`layout` `"rings"`) e, ao persistir com `toServer`, chama `putUiPreferences` com `brain.layout` `"hex"` depois de 700 ms: com relógio falso, nenhuma chamada aos 699 ms e exatamente uma aos 700 ms; nenhuma escrita vai para `/api/settings` (AC 15)
Proof: `npm run test -w apps/command-centre -- -t "C24 the brain state saves its view to the UI preferences"`
Status: closed

**C25** - Renderizando `SecondBrain` com `/api/settings` servindo `brain.layout` `"hex"` e `/api/ui-preferences` servindo `"rings"`, o `serverBlob` entregue a `useBrainState` é `{ layout: "rings" }` (AC 15)
Proof: `npm run test -w apps/command-centre -- -t "C25 the Second Brain reads its saved view from the UI preferences"`
Status: closed

**C26** - O mesmo para `BrainScene`: o `serverBlob` entregue a `useBrainState` é `{ layout: "rings" }`, não o `"hex"` das configurações (AC 15)
Proof: `npm run test -w apps/command-centre -- -t "C26 the brain scene reads its saved view from the UI preferences"`
Status: closed

**C27** - `ThemeTab` com `/api/settings` servindo `themePreset: "forest"` e `/api/ui-preferences` servindo `"jarvis"` marca JARVIS com `aria-pressed="true"` e Forest com `"false"` depois que a query responde; clicar em Forest chama `putUiPreferences` com exatamente `{ themePreset: "forest" }`, o `put` da aba recebe uma única escrita com só `accentColor`, e nenhuma escrita de configurações (pelo `put`, por `putSettings` ou por `api.put|post|patch` com a URL resolvida para `/api/settings`, qualquer que seja a grafia) leva um dos sete campos (AC 15, AC 21)
Proof: `npm run test -w apps/command-centre -- -t "C27 the theme tab marks the preset saved in the UI preferences"`
Status: closed

**C28** - `DesktopTab` mostra um `.skeleton` enquanto `/api/ui-preferences` não responde, a mensagem do erro (`ErrorBox`) quando a rota falha, com um botão "Retry" que, clicado, pede `/api/ui-preferences` de novo (uma chamada a mais a `api.get`) e mostra a resposta (`Pixel`), e os micro apps das preferências (`Pixel`, não o `Old app` das configurações) quando ela responde (AC 22)
Proof: `npm run test -w apps/command-centre -- -t "C28 the desktop tab waits, fails and lists from the UI preferences"`
Status: closed

### Rodada 3 - lacunas da segunda verificação · 14 files · 110 KB · ~28k

**C29** - O resultado da query de configurações é exatamente `SettingsDoc`, sem índice: `settings.typetest.ts` afirma identidade de tipos (`Exact`, não só atribuição mútua) entre `SettingsDoc` e `NonNullable<ReturnType<typeof useOsSettings>["data"]>`, `SettingsView` e o `SettingsShape` da página de Ajustes, e que `string` não é chave de `SettingsView`; e traz um `@ts-expect-error` por leitura de cada um dos sete campos em `useOsSettings().data`, um na cópia (`const saved = q.data; saved?.themePreset`), um na desestruturação (`const { activeSpace } = q.data ?? {}`) e um na query da página de Ajustes (`useApiQuery<SettingsDoc>`); o typecheck da interface sai `0` (AC 25, AC 15)
Proof: `npm run typecheck -w apps/command-centre`
Status: closed

**C30** - O `Put` das abas de Ajustes recebe o mesmo patch de `api.putSettings`: `settings.typetest.ts` afirma `Exact<Parameters<Put>[0], SettingsPatch>` (identidade: `Partial<SettingsDoc>`, que é atribuível ao patch, falha) e recusa `put({ accentColor, ...{ themePreset } })`, `put({ ...{ brain } }, true)` e `put({ activeSpace })` com `@ts-expect-error`; `put({ accentColor }, true)` compila; o typecheck da interface sai `0` (AC 25, AC 21)
Proof: `npm run typecheck -w apps/command-centre`
Status: closed

**C31** - `request()` em `api.ts` recusa, antes de chamar `fetch`, uma requisição que não é `GET` para `/api/settings` cujo corpo tem um dos sete campos: para cada campo × `api.put|post|patch` × cinco grafias da URL (numa variável, com `?fresh=1`, com `/` no fim, com `//`, absoluta), e por `putSettings` com cast, a promessa rejeita com `ApiError` de `code` `"moved_to_ui_preferences"` cuja mensagem nomeia o campo, e `fetch` não é chamado; `PUT /api/settings` sem os campos, `PUT /api/ui-preferences` com eles, `GET /api/settings` e `POST /api/settings-export` saem, na ordem; `MOVED_SETTING_KEYS` é exatamente os sete (teste e `settings.typetest.ts`) (AC 24)
Proof: `npm run test -w apps/command-centre -- -t "C31 "`
Status: closed

**C32** - Fora de `api.ts` e dos testes, a interface não chama `fetch`, `XMLHttpRequest`, `window.fetch`, `globalThis.fetch`, `self.fetch` nem `navigator.sendBeacon` (regras `no-restricted-globals` e `no-restricted-properties` em `eslint.config.js`), então toda requisição passa por `request()` e pela recusa de C31; o teste lint cada uma dessas seis chamadas num arquivo de `apps/command-centre/src/views/` e vê exatamente um erro de severidade 2 por linha, vê `fetch` aceito em `api.ts`, e lint `apps/command-centre/src/**/*.{ts,tsx}` sem nenhuma ocorrência das duas regras; os dois `fetch` GET que já existiam (`ServiceHealthBanner.tsx`, `SkillDetail.tsx`) levam um `eslint-disable-next-line` com o motivo (AC 24)
Proof: `npx vitest run tests/preferences.test.ts -t "C32 the UI reaches the API only through the request guard"`
Status: closed

**C33** - Renderizando `App` com `/api/meta` dizendo `setupCompleted: true`, `/api/settings` servindo `themePreset: "forest"` e `/api/ui-preferences` servindo `"jarvis"`, sem preset guardado no navegador, o `data-preset` do `<html>` vira `jarvis` e continua `jarvis` depois que as duas respostas chegam, e o espelho do navegador guarda `jarvis` (AC 15)
Proof: `npm run test -w apps/command-centre -- -t "C33 "`
Status: closed

**C34** - Renderizando `Console` com um rascunho apontado para a pasta `/srv/project`: com as preferências em `activeSpace: "focus"` e as configurações em `"work"`, a troca de espaço limpa a pasta do rascunho; com as preferências em `"work"` e as configurações em `"focus"`, depois que as duas respostas chegam, a pasta continua `/srv/project` (AC 15)
Proof: `npm run test -w apps/command-centre -- -t "C34 "`
Status: closed

**C35** - Um backup sem `config/settings.json` e sem `config/ui-preferences.json`, restaurado sobre uma home com `ui-preferences.json` (`themePreset: "mono"`) e `settings.json` gravados, deixa os dois arquivos vivos iguais byte a byte (AC 23)
Proof: `npx vitest run tests/preferences.test.ts -t "C35 a backup without either settings file leaves the live preferences alone"`
Status: closed

### Depois da rodada 3 - correção do autor (escalada ao dono)

**C36** - Com `putUiPreferences` rejeitando, concluir o `Setup` não chama `putSettings`, não faz nenhuma escrita de configurações e não chama `onDone` (o setup só fica concluído depois das duas gravações; mata o mutante S2 da rodada 3, que tirava o `await`) (AC 21, Assumptions)
Proof: `npm run test -w apps/command-centre -- -t "C36 a failed preferences write leaves setup unfinished"`
Status: closed

**C37** - `PUT /api/settings` com um corpo JSON que não é objeto (`"themePreset"`, `42`) responde `400` com `error.code` `"validation"`, como antes da feature (a checagem de campos movidos não lança mais sobre um corpo que não é objeto) (AC 11)
Proof: `npx vitest run tests/preferences.test.ts -t "C37 a settings body that is not an object is a validation error"`
Status: closed

## Coverage

| Set (size)                                        | Member -> proof                                                                                                                                                                                                                                                                                | Unproven |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| campos movidos (7)                                | C6, table-driven over all 7 (schema) · C12, table-driven over all 7 (rota) · C13 (resposta) · C15 (`SettingsDoc`) · C22, one `@ts-expect-error` per field (escrita da UI) · C29, one `@ts-expect-error` per field (leitura da UI) · C31, table-driven over all 7 (recusa em execução)          | -        |
| escritas de `/api/settings` na UI (4 caminhos)    | `putSettings` direto C22 (literal e spread) · `Put` das abas -> `Settings.tsx` C30 (tipo) e C27 (renderização) · `api.put/post/patch/del` com URL literal ou `const` C16, com qualquer grafia C31 · `fetch` cru C32                                                                            | -        |
| estado do arquivo de configurações na leitura (5) | v1 C1 · sem versão C7 · abaixo de 1 C21 · v2 C4 · v3 C5                                                                                                                                                                                                                                        | -        |
| cópia `settings.json.v<n>.bak` (2)                | ausente C2 · já existe C18 (fica a da primeira migração)                                                                                                                                                                                                                                       | -        |
| `ui-preferences.json` na migração (3)             | ausente C1 · existente C3 · ausente com campo inválido C20                                                                                                                                                                                                                                     | -        |
| `PUT /api/ui-preferences` statuses (3)            | 200 C9 · 400 C10 · 409 C11                                                                                                                                                                                                                                                                     | -        |
| `GET /api/ui-preferences` statuses (1)            | 200 C8                                                                                                                                                                                                                                                                                         | -        |
| `PUT /api/settings` status novo (1)               | 400 C12                                                                                                                                                                                                                                                                                        | -        |
| `GET /api/settings` (1)                           | sem os campos C13                                                                                                                                                                                                                                                                              | -        |
| backup/restauração de `ui-preferences.json` (3)   | backup com o arquivo C14 · backup antigo sem o arquivo C18 · backup sem nenhum dos dois arquivos C35                                                                                                                                                                                           | -        |
| telas que liam os campos, Flow 6 (8)              | `App.tsx` C29, C33 · `settings/theme.tsx` C27, C30 · `settings/desktop.tsx` C28 · `desktop/console/Console.tsx` C29, C34 · `views/Setup.tsx` C22, C23 · `views/SecondBrain.tsx` C29, C25 · `nucleo/scenes/BrainScene.tsx` C29, C26 · `brain/useBrainState.ts` C24 (C16 e C31 valem para todas) | -        |
| estados da aba `Ajustes › Desktop`, AC 22 (4)     | carregando C28 · erro com mensagem C28 · botão de tentar de novo que pede a rota de novo C28 · dados das preferências C28                                                                                                                                                                      | -        |
| caminho de atualização do AC 16 (2)               | emissão do servidor C19 · mapa de invalidação da UI C17                                                                                                                                                                                                                                        | -        |
| doors (3)                                         | arquivo e schema C1, C8 · migração C1-C4, C7, C20, C21 · recusa C5                                                                                                                                                                                                                             | -        |

- Claims naming a status code or route: C8-C14, C18, C19 - provados por `inject` na rota

## Test policy

| Code                                                                 | Required proofs                                                                                                                                                                                                                                                                                                       | Coverage expectation                    |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Decides, not reached across a boundary (migração por versão; recusa) | one at its own layer                                                                                                                                                                                                                                                                                                  | one case per file state                 |
| Decides, reached across a boundary (rotas, conflito de layout)       | one at the boundary                                                                                                                                                                                                                                                                                                   | each status                             |
| Instrumentation (interface trocando a fonte)                         | typecheck (`settings.typetest.ts`: leitura C29, escrita C22, C30) + recusa em execução em `request()` (C31) + lint contra `fetch` cru (C32) + source check pela AST (C16) + render test of each screen of Flow 6 that reads or writes a moved field, with the two routes serving different values (C23-C28, C33, C34) | each moved field; each screen of Flow 6 |

Evidence:

- `core/src/config/store.ts` `load()`/`save()`: versão < 2 / = 2 / > 2 -> decides
- closest analogue in the repo: `tests/api.layout-conflict.test.ts` (conflito de layout pela rota)

Cost: rodada 1 - 1 arquivo de teste novo, 17 provas; rodada 2 - 1 teste de interface novo (`apps/command-centre/src/preferences.test.tsx`), 1 typetest (`apps/command-centre/src/settings.typetest.ts`), 4 testes novos na raiz, 11 provas novas; rodada 3 - 1 teste de interface novo (`apps/command-centre/src/settingsGuard.test.ts`), 2 renderizações novas em `preferences.test.tsx`, 1 teste novo na raiz, 1 bloco de lint, 7 provas novas e 5 claims emendados (C16, C23, C24, C27, C28).

## Swept

- validation: C10 (schema de preferências na rota)
- failure modes: C5 (arquivo mais novo não é sobrescrito), C2 (cópia do original antes de migrar), C20 (campo inválido na migração), C28 (rota de preferências falhando na aba Desktop, com retry), C31 (escrita com campo movido recusada antes da rede)
- idempotency: C4 (ler de novo não reescreve), C3 (preferências existentes vencem)
- authorization: existing - as rotas novas seguem a regra de auth da feature 1 (não são `public`)
- concurrency: existing - `updateAsync` serializa gravações no mesmo processo; o store novo usa o mesmo padrão; a gravação é atômica (temp + rename)
- data lifecycle: C14 (backup e restauração), C18 (restauração de backup antigo), C35 (backup sem configurações)
- dependency failure: n/a - nenhuma dependência externa
- state transitions: C1, C4, C5, C7, C21 (versão do arquivo)
- observability: n/a - nenhum requisito de log; a migração deixa o `.v1.bak` como rastro

## Handoff

- S1-S3 ≈ 70k: store.ts 6 KB, settings.ts 25 KB, backup.ts 12 KB, system.ts (rota de configurações) ~15 KB lidos, api.ts 40 KB, nove telas ~100 KB lidas em trechos (~30 KB), teste novo ~15 KB ≈ 145 KB / 4 ≈ 36k, mais leitura - abaixo de 150k - one builder
