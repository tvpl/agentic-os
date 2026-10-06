# Moldura de app checks

Profile: ui
Plan: `.specs/features/moldura-app/plan.md`

24 checks in 4 slices · 2 one-way doors · 0 open, of which 0 block

Comandos (da raiz):

- interface (jsdom): `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "<nome>"`
- composição no navegador (Playwright, Chromium em `/opt/pw-browsers`): `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/moldura.spec.ts -g "<nome>"`
- motor e rota: `npx vitest run tests/moldura.test.ts -t "<nome>"`

Fora do alcance destes checks, por tela: espaçamento, cor e peso de tipo da Moldura, da página Hoje,
do controle de interface e da paleta (vêm dos tokens e do preset).

## Checks

### S1 - a moldura e suas regiões · 8 files · 90 KB · ~23k

**C1** - Com `shell: "moldura"`, a tela tem exatamente um `nav`, um `header`, um `main` e um `aside` dentro de `[data-shell="moldura"]`, e nenhum `.nu-shell` (AC 1)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C1 the frame has exactly four regions"`
Status: open

**C2** - No navegador (1440×900), a caixa do `nav` fica à esquerda de `main`, a do `aside` à direita de `main`, o `header` acima de `main` na mesma coluna, e `nav` e `aside` têm a altura da viewport (AC 1)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/moldura.spec.ts -g "C2 the regions sit where the design draws them"`
Status: open

**C3** - Os links da barra lateral são, nesta ordem, Hoje, Execuções, Skills, Rotinas, Memória, Conectores, Artefatos, Gerações, Pixel Studio, Configurações (em pt-BR) e Today, Runs, Skills, Routines, Memory, Connectors, Artifacts, Generations, Pixel Studio, Settings (em en), com `href` `#/`, `#/runs`, `#/skills`, `#/routines`, `#/brain`, `#/connectors`, `#/artifacts`, `#/generations`, `#/pixel`, `#/settings` (AC 2)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C3 the sidebar lists the ten items in order"`
Status: open

**C4** - O grupo de Conectores a Pixel Studio tem o título visível "Mais" / "More", e o primeiro grupo não tem título; em `/runs/r1` o link Execuções tem `aria-current="page"` e nenhum outro tem (AC 2)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C4 groups and the current item"`
Status: open

**C5** - Com 2 aprovações pendentes, o item Hoje mostra `2`; com 0, nenhum número (AC 3)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C5 today counts pending approvals"`
Status: open

**C6** - Depois de "Recolher", nenhum rótulo de item é texto visível e cada link tem o rótulo como nome acessível (AC 4)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C6 a collapsed sidebar keeps accessible names"`
Status: open

**C7** - A barra superior tem, nesta ordem, um `h1` com o rótulo do item ativo (também em `/runs/r1`: "Execuções"), o botão "Buscar ou comandar…" com a dica do atalho, o sino de notificações e o botão "Conversa"; o botão de busca abre a paleta (AC 5)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C7 the top bar shows title, search, bell and chat in order"`
Status: open

**C8** - O botão "Conversa" e ⌘. / Ctrl . escondem e mostram o `aside` (com `aria-pressed` acompanhando), e o estado sobrevive a um recarregamento (`localStorage`) (AC 6)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C8 the chat column toggles and is remembered"`
Status: open

**C9** - Em 800×900, a barra lateral começa recolhida; abrir a conversa a mostra como gaveta sobre o `main` (a caixa sobrepõe a de `main`) e Esc a fecha (AC 7)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/moldura.spec.ts -g "C9 a narrow window collapses the sidebar and drawers the chat"`
Status: open

**C10** - Com `shell: "moldura"`, as teclas 1, `]`, `/`, `p`, ⌘J, ⌘F, ⌘⇧A e ⌘⇧D não mudam a rota, não abrem deck, busca nem foco, e não resolvem aprovação (AC 8)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C10 the Núcleo keys are inert in the frame"`
Status: open

### S2 - conteúdo e página Hoje · 6 files · 60 KB · ~15k

**C11** - Para cada um dos 9 apps, a rota rende no `main` o componente de `APPS[kind]` (marcador `data-app=<kind>`), e `/runs/r1`, `/skills/s1` e `/settings?tab=security` rendem o detalhe (AC 9)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C11 each route renders its existing view"`
Status: open

**C12** - Em `/`, o `main` tem um `h1`/`h2` "Hoje" com a data longa em pt-BR, e seis cartões com os títulos, nesta ordem: Pede você, Em execução, Rotinas de hoje, Caixa de entrada, Diário, Custo (e em en: Needs you, Running, Today's routines, Inbox, Journal, Cost), cada um com o widget `approvals`, `now`, `routines`, `inbox`, `journal`, `cost` (AC 10)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C12 today shows six cards in order"`
Status: open

**C13** - No navegador, em 1440 de largura os cartões 1 e 2 estão na mesma linha (mesmo `top`, `left` crescente) e em 1000 de largura cada cartão está abaixo do anterior (AC 11)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/moldura.spec.ts -g "C13 today is two columns wide and one column narrow"`
Status: open

**C14** - `openRun("r1")` vindo da conversa e da paleta navega para `/runs/r1`; `openDoc("notes/a.md")` abre uma gaveta com o visualizador e o botão "Fechar", que a fecha (AC 12)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C14 runs navigate and documents open in a drawer"`
Status: open

### S3 - troca de shell · 6 files · 50 KB · ~13k

**C15** - Numa home nova, `GET /api/ui-preferences` traz `shell` `"moldura"`; `PUT { shell: "nucleo" }` responde `200` e um `GET` seguinte traz `nucleo`; `PUT { shell: "x" }` responde `400` `validation` (AC 13)
Proof: `npx vitest run tests/moldura.test.ts -t "C15 the shell preference round-trips"`
Status: open

**C16** - Um `ui-preferences.json` com `shell: "outro"` no disco lê `moldura`, sem falhar (door 1)
Proof: `npx vitest run tests/moldura.test.ts -t "C16 an unknown shell on disk falls back"`
Status: open

**C17** - Migrar um `settings.json` v1 gera `ui-preferences.json` com `shell` `"nucleo"`; uma home nova sem arquivo lê `moldura` (AC 14)
Proof: `npx vitest run tests/moldura.test.ts -t "C17 migrated homes keep the Núcleo"`
Status: open

**C18** - A aba de aparência tem o rótulo "Interface" e um controle segmentado com "Moldura de app" e "Núcleo imersivo", nesta ordem, acima dos presets, com a opção atual marcada (AC 15)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C18 appearance offers the two interfaces"`
Status: open

**C19** - Escolher "Núcleo imersivo" chama `putUiPreferences({ shell: "nucleo" })` e, com a resposta, `[data-shell="moldura"]` sai e `.nu-shell` entra, sem `location.reload` (AC 16)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C19 choosing an interface swaps the shell in place"`
Status: open

**C20** - No navegador: trocar para o Núcleo em Configurações, recarregar a página e encontrar `.nu-shell`; trocar de volta e encontrar `[data-shell="moldura"]` (AC 16)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/moldura.spec.ts -g "C20 the interface choice survives a reload"`
Status: open

**C21** - Na moldura, a paleta lista "Mudar para o Núcleo imersivo" e não lista "Abrir painel" nem a ação de organizar (mesmo com a consulta "organizar"); no Núcleo, lista "Mudar para a moldura de app"; rodar a ação grava `shell` (AC 17)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C21 the palette switches shells and hides lâmina actions"`
Status: open

### S4 - o Núcleo segue igual · 3 files · 20 KB · ~5k

**C22** - Com `shell: "nucleo"`, a tela rende `.nu-shell` e nenhum `[data-shell="moldura"]`, e a suíte e2e existente do Núcleo (`tests/e2e/nucleo-shell.spec.ts`) passa com as homes de teste semeadas com `shell: "nucleo"` (AC 13, AC 16)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/nucleo-shell.spec.ts`
Status: open

**C23** - Os textos novos têm chave em `en` e em `ptBR` (o teste de paridade de locales passa) (AC 2, AC 10, AC 15, AC 17)
Proof: `npm run test -w apps/command-centre -- src/i18n.test.ts`
Status: open

**C24** - `npm run typecheck` e `npm run build -w apps/command-centre` saem `0` (AC 1-17)
Proof: `npm run typecheck && npm run build -w apps/command-centre`
Status: open

## Coverage

| Set (size)                                | Member -> proof                                                                           | Unproven |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- | -------- |
| regiões da moldura (4)                    | `nav` C1, C2 · `header` C1, C2 · `main` C1, C2 · `aside` C1, C2                           | -        |
| itens da barra lateral (10)               | C3, table-driven over all 10 (rótulo pt/en, ordem, rota)                                  | -        |
| grupos da barra lateral (3)               | principal sem título C4 · "Mais" C4 · Configurações sozinho C3                            | -        |
| controles da barra superior (4)           | título C7 · busca C7 · sino C7 · Conversa C7, C8                                          | -        |
| estados da conversa (3)                   | aberta C8 · fechada C8 · gaveta estreita C9                                               | -        |
| teclas do Núcleo inertes (8)              | 1-5 C10 (1) · `[` `]` C10 (`]`) · `/` C10 · `p` C10 · ⌘J C10 · ⌘F C10 · ⌘⇧A C10 · ⌘⇧D C10 | -        |
| apps no conteúdo (9)                      | C11, table-driven over all 9                                                              | -        |
| rotas de detalhe (3)                      | `/runs/:id` C11 · `/skills/:slug` C11 · `/settings?tab=` C11                              | -        |
| cartões de Hoje (6)                       | C12, table-driven over all 6 (título, ordem, widget)                                      | -        |
| arranjos de Hoje (2)                      | duas colunas C13 · uma coluna C13                                                         | -        |
| `PUT /api/ui-preferences` com `shell` (2) | `200` C15 · `400` C15                                                                     | -        |
| origens do padrão (2)                     | home nova C15, C17 · migração v1 C17                                                      | -        |
| caminhos de troca (2)                     | Configurações C18, C19, C20 · paleta C21                                                  | -        |
| doors (2)                                 | campo `shell` C15, C16 · padrão por origem C17                                            | -        |

- Claims naming a status code or route: C15 - provado por `inject`
- A linha "teclas do Núcleo inertes" prova uma tecla de cada família (1 por 1-5, `]` por `[ ]`); as outras são o mesmo ramo

## Binding sources

| Source                                  | Screens                                                      | Checks           |
| --------------------------------------- | ------------------------------------------------------------ | ---------------- |
| `.specs/features/moldura-app/design.md` | Tela 1 Moldura, Tela 2 Hoje, Tela 3 Aparência, Tela 4 Paleta | C1-C14, C18, C21 |

## Test policy

| Code                                                                 | Required proofs                | Coverage expectation                |
| -------------------------------------------------------------------- | ------------------------------ | ----------------------------------- |
| Instrumentation (composição das telas)                               | render test + browser geometry | each region, item, card and control |
| Decides, not reached across a boundary (padrão do `shell`, migração) | one at its own layer           | each origin                         |
| Decides, reached across a boundary (`PUT /api/ui-preferences`)       | one at the boundary            | each status                         |

Evidence:

- `App.tsx` `OsShell`: `shell` → qual árvore monta -> decides
- closest analogue in the repo: `src/preferences.test.tsx` (render com as duas rotas mockadas) e `tests/e2e/nucleo-shell.spec.ts` (geometria no navegador)

Cost: 1 arquivo de teste de interface, 1 spec e2e, 1 teste de raiz, 24 provas.

## Swept

- validation: C15, C16 (`shell` inválido na rota e no disco)
- failure modes: C16 (valor desconhecido não derruba a interface)
- idempotency: n/a - escolher o shell atual grava o mesmo valor
- authorization: existing - `PUT /api/ui-preferences` segue a regra de auth das features 1 e 7
- concurrency: n/a - uma preferência gravada por vez pelo `UiPreferencesStore`, como as outras
- data lifecycle: C17 (padrão por origem)
- dependency failure: n/a - nenhuma dependência nova
- state transitions: C19, C20 (moldura ↔ Núcleo)
- observability: n/a - nenhum requisito de log; a troca é visível na tela

## Handoff

- S1-S4 ≈ 70k: App.tsx 20 KB, nucleo/index.tsx trechos 15 KB, apps.tsx 6 KB, Console props e CSS 10 KB, registry.tsx 8 KB, CommandPalette trechos 15 KB, theme.tsx 4 KB, preferences/migrations 8 KB, CSS novo ~12 KB, componentes novos ~30 KB, testes novos ~40 KB, locales 6 KB ≈ 174 KB / 4 ≈ 44k, mais leitura e execução do Playwright - abaixo de 150k - one builder
