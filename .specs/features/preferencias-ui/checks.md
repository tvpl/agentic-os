# Preferências da interface checks

Profile: standard
Plan: `.specs/features/preferencias-ui/plan.md`

17 checks in 3 slices · 3 one-way doors · 0 open, of which 0 block

Comandos (da raiz): `npx vitest run tests/preferences.test.ts -t "<nome>"`; a interface com
`npm run typecheck` e `npm run test -w apps/command-centre`.

## Checks

### S1 - migração sem perder nada · 6 files · 60 KB · ~15k

**C1** - Um `settings.json` v1 com `themePreset: "jarvis"`, um micro app, `brain` e `hud` vira `ui-preferences.json` com esses quatro valores e `settings.json` com `version` 2 e nenhum dos sete campos, depois de montar o motor (AC 1)
Proof: `npx vitest run tests/preferences.test.ts -t "C1 a v1 settings file is migrated without losing a preference"`
Status: closed

**C2** - O arquivo original fica em `config/settings.json.v1.bak`, idêntico byte a byte (AC 2)
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

**C12** - `PUT /api/settings` com cada um dos sete campos responde `400` com `error.code` `"moved_to_ui_preferences"`, e `settings.json` não muda (AC 11)
Proof: `npx vitest run tests/preferences.test.ts -t "C12 the settings route refuses moved fields"`
Status: closed

**C13** - `GET /api/settings` não traz nenhum dos sete campos (AC 12)
Proof: `npx vitest run tests/preferences.test.ts -t "C13 settings no longer carry UI preferences"`
Status: closed

**C14** - Um backup criado com `themePreset: "forest"` e restaurado devolve `ui-preferences.json` com `forest` (AC 13)
Proof: `npx vitest run tests/preferences.test.ts -t "C14 preferences survive a backup and restore"`
Status: closed

### S3 - a interface lê das preferências · 9 files · 120 KB · ~30k

**C15** - O tipo `SettingsDoc` da interface não tem os sete campos, e `npm run typecheck` sai `0` (AC 14)
Proof: `npm run typecheck`
Status: closed

**C16** - Em `apps/command-centre/src` (fora de testes) não há leitura `settings.data?.(themePreset|microApps|activeSpace|hud|brain)` nem escrita desses campos por `put(`/`api.put("/api/settings"`; `api.ts` tem `uiPreferences` e `putUiPreferences` apontando para `/api/ui-preferences` (AC 15)
Proof: `npx vitest run tests/preferences.test.ts -t "C16 the UI reads and writes preferences through their route"`
Status: closed

**C17** - A chave de query das preferências é invalidada pelo mesmo evento que invalida as configurações (`settings.changed` no mapa de invalidação da interface) (AC 16)
Proof: `npx vitest run tests/preferences.test.ts -t "C17 a saved preference refreshes the UI query"`
Status: closed

## Coverage

| Set (size)                                        | Member -> proof                                                                             | Unproven |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------- |
| campos movidos (7)                                | C6, table-driven over all 7 (schema) · C12, table-driven over all 7 (rota) · C13 (resposta) | -        |
| estado do arquivo de configurações na leitura (4) | v1 C1 · sem versão C7 · v2 C4 · v3 C5                                                       | -        |
| `ui-preferences.json` na migração (2)             | ausente C1 · existente C3                                                                   | -        |
| `PUT /api/ui-preferences` statuses (3)            | 200 C9 · 400 C10 · 409 C11                                                                  | -        |
| `GET /api/ui-preferences` statuses (1)            | 200 C8                                                                                      | -        |
| `PUT /api/settings` status novo (1)               | 400 C12                                                                                     | -        |
| `GET /api/settings` (1)                           | sem os campos C13                                                                           | -        |
| arquivos do backup tocados (1)                    | `ui-preferences.json` C14                                                                   | -        |
| doors (3)                                         | arquivo e schema C1, C8 · migração C1-C4, C7 · recusa C5                                    | -        |

- Claims naming a status code or route: C8-C14 - provados por `inject` na rota

## Test policy

| Code                                                                 | Required proofs          | Coverage expectation    |
| -------------------------------------------------------------------- | ------------------------ | ----------------------- |
| Decides, not reached across a boundary (migração por versão; recusa) | one at its own layer     | one case per file state |
| Decides, reached across a boundary (rotas, conflito de layout)       | one at the boundary      | each status             |
| Instrumentation (interface trocando a fonte)                         | typecheck + source check | each moved field        |

Evidence:

- `core/src/config/store.ts` `load()`/`save()`: versão < 2 / = 2 / > 2 -> decides
- closest analogue in the repo: `tests/api.layout-conflict.test.ts` (conflito de layout pela rota)

Cost: 1 arquivo de teste novo, 17 provas.

## Swept

- validation: C10 (schema de preferências na rota)
- failure modes: C5 (arquivo mais novo não é sobrescrito), C2 (cópia do original antes de migrar)
- idempotency: C4 (ler de novo não reescreve), C3 (preferências existentes vencem)
- authorization: existing - as rotas novas seguem a regra de auth da feature 1 (não são `public`)
- concurrency: existing - `updateAsync` serializa gravações no mesmo processo; o store novo usa o mesmo padrão; a gravação é atômica (temp + rename)
- data lifecycle: C14 (backup e restauração)
- dependency failure: n/a - nenhuma dependência externa
- state transitions: C1, C4, C5, C7 (versão do arquivo)
- observability: n/a - nenhum requisito de log; a migração deixa o `.v1.bak` como rastro

## Handoff

- S1-S3 ≈ 70k: store.ts 6 KB, settings.ts 25 KB, backup.ts 12 KB, system.ts (rota de configurações) ~15 KB lidos, api.ts 40 KB, nove telas ~100 KB lidas em trechos (~30 KB), teste novo ~15 KB ≈ 145 KB / 4 ≈ 36k, mais leitura - abaixo de 150k - one builder
