# Limpeza do legado checks

Profile: ui
Plan: `.specs/features/limpeza-legado/plan.md`

39 checks in 6 slices · 6 one-way doors · 0 open, of which 0 block

Comandos (da raiz): interface `npm run test -w apps/command-centre -- <arquivo> -t "<nome>"`; raiz
`npx vitest run <arquivo> -t "<nome>"`; lint `npm run lint`; build `npm run build`; peso `npm run bundle:check`; e2e
`MORDOMO_E2E_PORT=4897 npx playwright test --config <configuração temporária> <spec> -g "<nome>"`. A
configuração temporária do e2e (não comitada) alonga o teste para 90 s e o `expect` para 20 s, porque o ambiente
compartilhado fica com carga alta (a regra de C37).

Fora do alcance destes checks, por tela: o desenho fino de cada tela (espaçamento, hierarquia de peso acima do
piso) não muda e não é reaberto. A única tela que muda de arranjo é o quinto passo do Setup (perde o texto e os dois
grupos de chaves do HUD); as três superfícies de Markdown mudam de código e não de HTML (C15 é a prova, byte a byte);
o Pixel Studio muda de pasta e de import. O CSS removido não casa com nenhum elemento que a interface desenha
(C4, C5), e a galeria nas duas camadas (C38) e o axe (C36) vigiam o resto.

## Checks

### S1 - nada fica sem prova de uso · 8 arquivos · 160 KB · ~40k (CSS e tradução por script, sem ler inteiro)

**C1** - O grafo de importação de `apps/command-centre/src`, andado de `main.tsx`, `gallery/main.tsx` e `brain/engine/force.worker.ts` (importações estáticas, `export … from`, `import()`, `new URL(…, import.meta.url)` e `@import` de CSS), deixa de fora dos arquivos que não são teste exatamente os doze da lista fechada de `design.md` e nenhum outro (AC 1)
Proof: `npm run test -w apps/command-centre -- src/legacy.graph.test.ts -t "C1 "`
Status: closed

**C2** - Nenhum símbolo exportado de arquivo que não é teste fica sem importador por nome, sem `import * as`, sem `import()` do módulo e sem nova menção no próprio arquivo; a única exceção é a barrel `ui/index.ts` (AC 2)
Proof: `npm run test -w apps/command-centre -- src/legacy.graph.test.ts -t "C2 "`
Status: closed

**C3** - O leitor de símbolos mortos sobre fontes sintéticas: reprova uma função, uma constante, uma classe, uma interface, um tipo, um `default` e um re-export de barril que ninguém usa, e não reprova o que é importado por nome, por `import * as`, por `import()`, por JSX, nem o que só é usado no próprio arquivo (AC 2)
Proof: `npm run test -w apps/command-centre -- src/legacy.graph.test.ts -t "C3 "`
Status: closed

**C4** - Toda classe de seletor de todo CSS do Command Centre é um token de texto da produção (literal ou prefixo dinâmico de template), ou está na lista fechada das que só um teste constrói (`display-digits`, com o motivo); a lista tem exatamente um item (AC 3)
Proof: `npm run test -w apps/command-centre -- src/legacy.css.test.ts -t "C4 "`
Status: closed

**C5** - Todo `@keyframes` é nomeado por uma regra `animation`/`animation-name` ou por texto da produção, e toda propriedade `--x` definida é lida por `var(--x)` ou por texto da produção (AC 4)
Proof: `npm run test -w apps/command-centre -- src/legacy.css.test.ts -t "C5 "`
Status: closed

**C6** - O leitor de CSS sobre fontes sintéticas: acha a classe morta em seletor simples, composto, em lista, dentro de `@media`, de `:is()` e de `:not()`, trata o prefixo dinâmico e a classe só de teste como a lista manda, e acha o `@keyframes` e a propriedade mortos (AC 3, AC 4)
Proof: `npm run test -w apps/command-centre -- src/legacy.css.test.ts -t "C6 "`
Status: closed

**C7** - Toda chave do dicionário `en` aparece como literal na produção ou fica sob um prefixo de `DYNAMIC_PREFIXES` que um template ou concatenação monta, e `pt-BR` tem exatamente as chaves de `en` (AC 5)
Proof: `npm run test -w apps/command-centre -- src/i18n.orphans.test.ts -t "C7 "`
Proof: `npm run test -w apps/command-centre -- src/i18n.test.ts -t "pt-BR and en carry exactly the same keys"`
Status: closed

**C8** - Um prefixo de `DYNAMIC_PREFIXES` que não cobre chave nenhuma reprova nomeando o prefixo, e o leitor de chaves acha prefixo em `` `x.${y}` ``, em `` `x.${y}` as TKey ``, em `"x." + y` e em `` `x.${y}Hint` `` (AC 6)
Proof: `npm run test -w apps/command-centre -- src/i18n.orphans.test.ts -t "C8 "`
Status: closed

**C9** - `runs/policy.ts`, `runs/policy.test.ts` e `runs/policy.delegation.test.ts` não existem, nenhum arquivo importa `writePolicyFor`, `followUpPrompt` nem `cwdSuggestions`, e a obrigação "a interface não tem tabela de perfis" de `contratos` C11 fica provada por uma varredura de todo arquivo de produção da interface (AC 7)
Proof: `npm run test -w apps/command-centre -- src/legacy.graph.test.ts -t "C9 "`
Proof: `npx vitest run tests/contracts.test.ts -t "C11 the UI has no profile table"`
Status: closed

### S2 - o Setup sem o passo do HUD · 4 arquivos · 40 KB · ~10k

**C10** - O Setup aberto mostra cinco passos na ordem Provedores, Identidade, Pastas, Conectar dados, Aparência (`Providers`, `Identity`, `Folders`, `Connect data`, `Appearance` em `en`), nenhum rótulo, dica ou grupo contém "HUD", e o quinto passo mostra os cinco visuais, nenhum botão `[data-hud]` e nenhum grupo "Left arc" nem "Right arc"; escolher um visual põe `data-preset` no `<html>` na hora (AC 8, AC 9)
Proof: `npm run test -w apps/command-centre -- src/views/Setup.test.tsx -t "C10 "`
Status: closed

**C11** - Concluir o Setup chama `putUiPreferences` com exatamente `{ themePreset }` e depois `putSettings` com `setupCompleted: true`; se a primeira gravação falha a segunda não roda (AC 10)
Proof: `npm run test -w apps/command-centre -- src/views/Setup.test.tsx -t "C11 "`
Status: closed

**C12** - Um `ui-preferences.json` escrito pela versão anterior: com um `hud` personalizado, `GET /api/ui-preferences` o devolve igual e um `PUT` só de `themePreset` o deixa igual em disco; sem `hud` devolve `DEFAULT_HUD`; com `hud` ilegível (texto, número, `null`, listas de números, um lado que não é lista) devolve `DEFAULT_HUD` e os demais campos como estão; um lado ausente lê esse lado como o padrão; o arquivo do teste tem outra indentação, outra ordem de chaves e nenhuma quebra de linha final (AC 11, AC 12, AC 13)
Proof: `npx vitest run tests/preferences.hud.test.ts -t "C12 "`
Status: closed

**C13** - Um `settings.json` de versão 1 com `hud` migra sem perder a preferência (a prova de `preferencias-ui` segue de pé e verde) (AC 14)
Proof: `npx vitest run tests/preferences.test.ts -t "C1 a v1 settings file is migrated without losing a preference"`
Status: closed

**C14** - Nenhum arquivo de produção da interface lê ou grava o campo `hud` do documento de preferências (nem `.hud`, nem a chave `hud:`), fora de `settings.typetest.ts`, e `desktop/hud.ts` exporta só o que a paleta usa (`HUD_CATALOGUE`, `hudTitleKey`) (AC 15)
Proof: `npm run test -w apps/command-centre -- src/legacy.graph.test.ts -t "C14 "`
Status: closed

### S3 - um só renderizador de Markdown · 8 arquivos · 60 KB · ~15k

**C15** - Para o corpus de Markdown (os 7 tipos de bloco e os 7 tipos de inline em cada uma das três superfícies), o HTML de `Markdown` com `shape` `page`, `panel` e `scene` é igual byte a byte ao que os três renderizadores antigos desenharam em `5d2d082` (arquivos dourados), exceto nos dois casos decididos (AC 16)
Proof: `npm run test -w apps/command-centre -- src/components/Markdown.test.tsx -t "C15 "`
Status: closed

**C16** - Só um arquivo que não é teste contém `case "paragraph"` na interface: `components/Markdown.tsx`; `views/Skills/Markdown.tsx` e `nucleo/scenes/BrainSceneMarkdown.tsx` não existem e `brain/PreviewPanel.tsx` não tem `renderInline` nem `renderBlocks` (AC 17)
Proof: `npm run test -w apps/command-centre -- src/legacy.graph.test.ts -t "C16 "`
Status: closed

**C17** - HTML cru no texto (`<script>`, `<img onerror>`, `<iframe>`, `<a href="javascript:…">`) vira texto nas três superfícies, sem elemento da tag no DOM (AC 18)
Proof: `npm run test -w apps/command-centre -- src/components/Markdown.test.tsx -t "C17 "`
Status: closed

**C18** - Um link com `javascript:`, `data:`, `vbscript:`, `file:`, `//host`, `#âncora`, `java<TAB>script:` ou `JAVASCRIPT:` não vira `<a>` em nenhuma das três superfícies; o texto sai como texto inerte (AC 19)
Proof: `npm run test -w apps/command-centre -- src/components/Markdown.test.tsx -t "C18 "`
Status: closed

**C19** - Um link com `http://`, `https://` ou `mailto:` vira `<a target="_blank" rel="noreferrer noopener">` nas três superfícies (AC 20)
Proof: `npm run test -w apps/command-centre -- src/components/Markdown.test.tsx -t "C19 "`
Status: closed

**C20** - Uma tabela no corpo de uma skill é desenhada pela superfície `page` (cabeçalho e linhas, cada célula com o inline) (AC 21)
Proof: `npm run test -w apps/command-centre -- src/components/Markdown.test.tsx -t "C20 "`
Status: closed

**C21** - Nas superfícies `panel` e `scene`, um caminho ou link que resolve vira o botão que seleciona a nota (e chama `onPeek` no `scene`), e um `/skill` conhecido vira o botão que abre a skill; um que não resolve vira `dangling` com o `title` de antes (AC 22)
Proof: `npm run test -w apps/command-centre -- src/components/Markdown.test.tsx -t "C21 "`
Status: closed

### S4 - o Pixel Studio como plugin · 6 arquivos · 45 KB · ~12k

**C22** - `APPS.pixel` é montado de `pixelPlugin` e vale, campo a campo, o que valia em `5d2d082`: `kind` `pixel`, `route` `/pixel`, `titleKey` `nav.pixel`, `refKey` `desktop.ref.app.pixel`, `descKey` `microapp.pixel.desc`, ícone `Grid3x3` (AC 23)
Proof: `npm run test -w apps/command-centre -- src/plugins/pixel/plugin.test.ts -t "C22 "`
Status: closed

**C23** - O build de produção emite um chunk `PixelStudio-*.js`, e nenhum chunk alcançável por importação estática de `index.html` contém a chave `pixel-studio-draft` (AC 24)
Proof: `npx vitest run tests/pixel.plugin.test.ts -t "C23 "`
Status: closed

**C24** - Fora de `plugins/pixel/`, o único importador estático de arquivo do plugin é `desktop/apps.tsx` importando `plugins/pixel/index.ts`, e `PixelStudio.tsx` só é alcançado pelo `import()` do manifesto (AC 25)
Proof: `npm run test -w apps/command-centre -- src/legacy.graph.test.ts -t "C24 "`
Status: closed

**C25** - Os arquivos de `plugins/pixel/` importam do app só os oito módulos da lista fechada (mais `react`, `react-router-dom` e `lucide-react`); um nono módulo reprova nomeando-o (AC 26)
Proof: `npm run test -w apps/command-centre -- src/legacy.graph.test.ts -t "C25 "`
Status: closed

**C26** - No Pixel Studio aberto no Núcleo, cada tecla faz o que diz (`1`-`4`, `=`/`+`, `-`/`_`, `x`, `o`, ⌘Z, ⌘⇧Z, ⌘Y, Esc): a prova de `comandos-atalhos` C26, sem tocar nela (AC 27)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.screens.test.tsx -t "C26"`
Status: closed

**C27** - O registro tem os 13 comandos de escopo `view:pixel` com os mesmos ids, teclas e chaves de título de `5d2d082` (lista literal no teste), e o arquivo do plugin está na lista de ouvintes de `OUTSIDE_THE_REGISTRY` só se estava (zero ouvinte novo) (AC 27)
Proof: `npm run test -w apps/command-centre -- src/plugins/pixel/plugin.test.ts -t "C27 "`
Proof: `npm run test -w apps/command-centre -- src/commands/commands.source.test.ts`
Status: closed

**C28** - `npm run bundle:check` sai `0` no build da feature, o JS gzip não passa de 507 021 bytes (o último build registrado), e `scripts/bundle-baseline.json` ganha a entrada `limpeza-legado` com razão e os quatro números medidos (AC 28)
Proof: `npm run bundle:check`
Proof: `npx vitest run tests/bundle-size.test.ts`
Proof: `npx vitest run tests/pixel.plugin.test.ts -t "C28 "`
Status: closed

### S5 - documentação do produto · 8 arquivos (118 movidos) · 95 KB · ~24k

**C29** - O README descreve o Command Centre como dois shells (os dois nomes), cita `FSL-1.1-ALv2` e não contém `drag-and-drop widgets`, `snap to a grid`, `Back to the OS` nem `Ctrl/⌘ M` (AC 29)
Proof: `npx vitest run tests/docs.drift.test.ts -t "C29 "`
Status: closed

**C30** - A tabela de comandos do README lista cada comando que a CLI registra em `COMMANDS` (17 mais `help`, que não entra), pela primeira palavra, e nenhum comando que a CLI não registra (AC 30)
Proof: `npx vitest run tests/docs.drift.test.ts -t "C30 "`
Status: closed

**C31** - Todo link relativo do README e dos guias `docs/*.md` aponta para arquivo que existe, e todo `npm run <script>` que eles citam é script do `package.json` (AC 31)
Proof: `npx vitest run tests/docs.drift.test.ts -t "C31 "`
Status: closed

**C32** - As oito entradas da porta 5 estão em `docs/internal/` e não nos caminhos antigos; `docs/internal/README.md` dá o caminho antigo de cada uma; o README do repositório as liga só numa linha "Project history" (AC 32)
Proof: `npx vitest run tests/docs.drift.test.ts -t "C32 "`
Status: closed

**C33** - O que `stageLegal` e `scripts/package.mjs` copiam para o instalador não tem caminho em `docs/` (a fonte de `package.mjs` só copia `ui`, `seed`, `legal`, `LICENSE` e o manifesto), e `legal/THIRD_PARTY_NOTICES.md` não cita arquivo de `docs/internal/` (AC 33)
Proof: `npx vitest run tests/docs.drift.test.ts -t "C33 "`
Proof: `npm run dist:quick`
Status: closed

**C34** - A varredura de marcas lê os arquivos de `docs/internal/` (a prova C20 de `licenca-comercial`, com os caminhos novos) (AC 34)
Proof: `npx vitest run tests/legal.docs.test.ts -t "C20 the sweep reads"`
Status: closed

**C35** - O `CHANGELOG.md` tem, em "Unreleased", a entrada da feature, que nomeia o que saiu e o que ficou (AC 35)
Proof: `npx vitest run tests/docs.drift.test.ts -t "C35 "`
Status: closed

### S6 - nada quebra · medido no fim

**C36** - `npm run typecheck`, `npm run lint` (ESLint e stylelint), `npm run build`, `npm run licenses:check`, `npm run network:scan -- --check`, a suíte da interface inteira e a suíte da raiz inteira saem `0` (AC 36)
Proof: `npm run typecheck`
Proof: `npm run lint`
Proof: `npm run test -w apps/command-centre`
Proof: `npx vitest run`
Proof: `npm run licenses:check`
Proof: `npm run network:scan -- --check`
Status: closed

**C37** - Nenhum teste e2e que passava em `5d2d082` falha no fim: a base conhecida do ambiente (brain-context:27/:61, moldura C20/C57, nucleo-shell:165/:467/:1048, onboarding:7/:33, rework:49, desktop-parity:22, concept:393/:729, console-context:13, desktop-execution:115, desktop-regressions:63, provider-readiness:4, boot-recovery:3, render-profile:4) é a lista de falhas aceitas, e a lista de falhas do fim é medida contra a da base na mesma máquina (AC 37)
Proof: `MORDOMO_E2E_PORT=4897 npx playwright test --config <configuração temporária> tests/e2e/a11y.spec.ts tests/e2e/gallery.spec.ts tests/e2e/gallery-contrast.spec.ts tests/e2e/surface-contrast.spec.ts tests/e2e/moldura.spec.ts tests/e2e/nucleo-shell.spec.ts tests/e2e/smoke.spec.ts tests/e2e/setup-wizard.spec.ts tests/e2e/onboarding.spec.ts tests/e2e/primitives.spec.ts`
Status: closed

**C38** - As capturas de referência de Linux da galeria só são regeradas se uma capturada difere, e cada PNG regerado é aberto e revisado antes do commit; sem diferença, `git status` não mostra PNG alterado (AC 38)
Proof: `MORDOMO_E2E_PORT=4897 npx playwright test --config <configuração temporária> tests/e2e/gallery.spec.ts`
Status: closed

**C39** - O inventário de `design.md` é verdadeiro: todo caminho das tabelas "Mantido" e da lista fechada existe, e todo caminho da tabela "Sai" que é um arquivo não existe (a obrigação "kept true" do `design.md`) (AC 1, AC 7)
Proof: `npx vitest run tests/docs.drift.test.ts -t "C39 "`
Status: closed

## Coverage

| Set (size)                                                     | Member -> proof                                                                                                                                                                                                                                                                                                                                                   | Unproven |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| arquivos que nenhuma entrada alcança (12)                      | `nucleo/entity/harness.tsx` C1 · `commands/testkit.tsx` C1 · `commands/testserver.ts` C1 · `ui/testkit.tsx` C1 · `commands/listenersAllowlist.ts` C1 · `components/markdown.corpus.ts` C1 · `testing/canvasText.ts` C1 · `testing/cssUsage.ts` C1 · `testing/fontSize.ts` C1 · `testing/sizeScan.ts` C1 · `testing/sourceGraph.ts` C1 · `testing/stateScan.ts` C1 | -        |
| formas de símbolo morto que o leitor acha ou deixa passar (11) | função C3 · constante C3 · classe C3 · interface C3 · tipo C3 · `default` C3 · re-export de barril C3 · usado por nome C3 · usado por `import * as` C3 · usado por `import()` C3 · usado só no próprio arquivo C3                                                                                                                                                 | -        |
| formas de seletor que o leitor de CSS lê (7)                   | simples C6 · composto C6 · lista C6 · `@media` C6 · `:is()` C6 · `:not()` C6 · prefixo dinâmico C6                                                                                                                                                                                                                                                                | -        |
| famílias de CSS (3)                                            | classes C4 · `@keyframes` C5 · propriedades `--x` C5                                                                                                                                                                                                                                                                                                              | -        |
| formas de chave dinâmica (4)                                   | `` `x.${y}` `` C8 · `` `x.${y}` as TKey `` C8 · `"x." + y` C8 · `` `x.${y}Hint` `` C8                                                                                                                                                                                                                                                                             | -        |
| passos do Setup (5)                                            | Provedores C10 · Identidade C10 · Pastas C10 · Conectar dados C10 · Aparência C10                                                                                                                                                                                                                                                                                 | -        |
| visuais do Setup (5)                                           | `hud-orange` C10 · `jarvis` C10 · `forest` C10 · `ocean` C10 · `mono` C10                                                                                                                                                                                                                                                                                         | -        |
| leituras de `ui-preferences.json` (8)                          | `hud` personalizado C12 · `hud` ausente C12 · `hud` texto C12 · `hud` número C12 · `hud` `null` C12 · `hud` com listas de números C12 · `hud` com um lado que não é lista C12 · `hud` com um lado ausente C12                                                                                                                                                     | -        |
| tipos de bloco de Markdown × superfícies (21)                  | C15, table-driven over all 21                                                                                                                                                                                                                                                                                                                                     | -        |
| tipos de inline de Markdown × superfícies (21)                 | C15, table-driven over all 21                                                                                                                                                                                                                                                                                                                                     | -        |
| HTML cru × superfícies (12)                                    | C17, table-driven over all 12                                                                                                                                                                                                                                                                                                                                     | -        |
| esquemas inseguros × superfícies (24)                          | C18, table-driven over all 24                                                                                                                                                                                                                                                                                                                                     | -        |
| esquemas seguros × superfícies (9)                             | C19, table-driven over all 9                                                                                                                                                                                                                                                                                                                                      | -        |
| comandos do Pixel Studio (13)                                  | `pixel.undo` C27 · `pixel.redo` C27 · `pixel.prevFrame` C27 · `pixel.nextFrame` C27 · `pixel.brushUp` C27 · `pixel.brushDown` C27 · `pixel.swap` C27 · `pixel.onion` C27 · `pixel.tool.pencil` C27 · `pixel.tool.eraser` C27 · `pixel.tool.fill` C27 · `pixel.tool.eyedropper` C27 · `pixel.leave` C27                                                            | -        |
| módulos que o plugin pode importar do app (8)                  | `../../ui` C25 · `../../commands/registry` C25 · `../../commands/keys` C25 · `../../i18n` C25 · `../../apiCall` C25 · `../../components/ui` C25 · `../../hooks/useConfirm` C25 · `../../views/shared` C25                                                                                                                                                         | -        |
| medidas de peso (4)                                            | JS raw C28 · JS gzip C28 · CSS raw C28 · CSS gzip C28                                                                                                                                                                                                                                                                                                             | -        |
| comandos da CLI no README (17)                                 | C30, table-driven over all 17                                                                                                                                                                                                                                                                                                                                     | -        |
| frases velhas do README (4)                                    | `drag-and-drop widgets` C29 · `snap to a grid` C29 · `Back to the OS` C29 · `Ctrl/⌘ M` C29                                                                                                                                                                                                                                                                        | -        |
| entradas movidas para `docs/internal/` (8)                     | `analysis-2026-09` C32 · `audit-2026-09` C32 · `plan-2026-09` C32 · `execution-2026-09-06` C32 · `review-2026-09-06` C32 · `plans` C32 · `analise-engine-ui-2026-09-12.md` C32 · `validation-report.md` C32                                                                                                                                                       | -        |
| specs de e2e do gate (10)                                      | `a11y` C37 · `gallery` C37, C38 · `gallery-contrast` C37 · `surface-contrast` C37 · `moldura` C37 · `nucleo-shell` C37 · `smoke` C37 · `setup-wizard` C37 · `onboarding` C37 · `primitives` C37                                                                                                                                                                   | -        |
| testes de código removido (3 arquivos)                         | `runs/policy.test.ts` C9 · `runs/policy.delegation.test.ts` C9 · casos de `desktop/hud.test.ts` do código removido C14                                                                                                                                                                                                                                            | -        |
| rotas da Surface (0)                                           | nenhuma (a Surface é `None`)                                                                                                                                                                                                                                                                                                                                      | -        |

- Claims naming a status code, route or response shape: nenhum (não há rota nova nem muda); os que nomeiam a tela (C10, C15, C26) têm prova no jsdom e, os de arranjo, no navegador (C36-C38)
- No other check claims more than the single case its proof exercises

## Test policy

| Code                                                                                                                                                             | Required proofs                                                      | Coverage expectation                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decides: os leitores (`sourceGraph.ts`, o de CSS, o de chaves) e `Markdown.tsx`                                                                                  | one at its own layer (jsdom ou fontes sintéticas)                    | uma entrada afirmada por forma da tabela: cada forma de símbolo (11), de seletor (7), de chave dinâmica (4), de bloco (7), de inline (7), de link (8 + 3) |
| Configuration: as listas (`DYNAMIC_PREFIXES`, lista fechada de arquivos, de classes de teste, módulos do plugin), `package.json`, `scripts/bundle-baseline.json` | a source check that reads the tree                                   | cada item da lista com o seu motivo, e a lista reprova quando um item não casa com nada                                                                   |
| Instrumentation: `plugins/pixel/index.ts`, `plugins/types.ts`                                                                                                    | none of its own                                                      | coberto pelo teste do `APPS.pixel` (C22) e pela importação (C24)                                                                                          |
| Migration: cada arquivo que mudou de pasta (Pixel, documentos)                                                                                                   | o comportamento da coisa movida, provado pelo teste que já a provava | cada arquivo do inventário                                                                                                                                |

Evidence:

- `legacy.graph.test.ts`: lê a árvore sintática de ~490 arquivos, cinco consultas (alcance, símbolo, `case`, `.hud`, importador do plugin) -> decide
- `components/Markdown.tsx`: troca de forma em 7 blocos, 7 inlines e 3 superfícies, três políticas de link -> decide
- `plugins/pixel/index.ts`: devolve um objeto literal e um `import()` -> instrumentation
- closest analogue in the repo: `src/commands/commands.source.test.ts` (varredura de árvore com autoteste de forma, L-029) e `src/typography.test.ts` (leitor de CSS com lista `MICROCOPY`)

Cost: 7 arquivos novos de teste na interface (≈90 casos) e 3 na raiz (≈25), 3 arquivos dourados, 1 spec e2e estendida (a galeria, o `a11y` e o `gallery-contrast` já leem tudo). Sem estas linhas, o legado só seria
vigiado pelo caminho que os testes existentes atravessam.

## Swept

- validation: C18 (esquemas inseguros), C12 (`hud` ilegível), C17 (HTML cru)
- failure modes: C11 (a primeira gravação falha e a segunda não roda), C8 (prefixo que não cobre chave), C3 e C6 (o leitor sobre fonte que ele deve reprovar)
- idempotency: n/a - nenhuma operação repetida; as remoções são commits e `git revert` as desfaz
- authorization: n/a - nenhuma rota, escopo nem credencial muda; C33 prova que o instalador não leva `docs/`
- concurrency: n/a - nada concorrente muda; o `finish` do Setup grava preferências antes das configurações como antes (C11)
- data lifecycle: C12 (arquivo antigo lido e preservado), C13 (migração v1 → v2 com `hud`), C32 (os documentos internos movidos, não apagados)
- dependency failure: C36 (`licenses:check`, `network:scan`; nenhuma dependência nova, nenhuma muda de versão)
- state transitions: C10 (passos do Setup, escolha de visual), C21 (nota resolve ou não)
- observability: n/a - nenhum requisito de log; o peso fica registrado em C28 e o inventário em `design.md`

## Out of scope

- Remover os 12 widgets, `desktop/` ou `desktop.css` inteiros - estão em uso (inventário de `design.md`)
- Remover um dos dois cérebros - os dois estão vivos
- Tirar `hud`, `dashboardLayout`, `spaces` ou `microApps` do contrato - é contrato público
- Um sistema de plugins descoberto em tempo de execução - `AppPlugin` é uma costura de registro
- Adotar o `knip` como dependência - porta 4

## Handoff

Tamanho, com a conta, depois dos checks e antes de qualquer código. Orçamento: 150k (AGENTS.md).

- S1 = ~40k: o instrumento novo (≈15 KB), os quatro testes novos (≈35 KB) e as remoções por script em 9 CSS (≈300 KB) e 14 locales (≈230 KB), que não são lidos inteiros (≈520 KB / 4 = 130k se fossem; contados 40k pela parte lida)
- S2 = ~10k: `Setup.tsx` (21 KB), `hud.ts` e o teste (6 KB), `apps.css`, o teste novo
- S3 = ~15k: os três renderizadores (23 KB), `Markdown.tsx` novo, os dourados e o teste
- S4 = ~12k: `PixelStudio.tsx` (35 KB), `apps.tsx`, três listas de caminho
- S5 = ~24k: `README.md` (10 KB), `docs/architecture.md`, `docs/user-manual.md`, `docs/install.md` (47 KB), `tests/legal.docs.test.ts` (50 KB, só a parte do caminho), 118 arquivos movidos por `git mv`
- S6 = ~15k: leituras de relatório e o relatório do fim
- Soma ≈ 116k mais a leitura de contexto já gasta (≈50k) ≈ 166k, acima dos 150k: o gate manda perguntar entre handoff e um construtor
- Mechanism: one builder (compaction accepted) - o delegado não tem a quem entregar um segundo lote nem como perguntar; a escolha está em "Perguntas ao dono" do `STATE.md`, com a alternativa (handoff no corte S1-S2 / S3-S6)
- Boundary: um construtor só, S1 a S6 em sequência; a verificação independente é o próximo passo e não é deste construtor.
- Settled mid-build: (1) a lista fechada de arquivos sem importador tem 12 e não 10 (`cssUsage.ts`, `sourceGraph.ts` e `markdown.corpus.ts` são instrumentos de teste); (2) a barrel `ui/index.ts` é a única exceção da varredura de exportações sem uso (primitivas C3 fixa a lista de valores); (3) a única classe construída por teste que a varredura de CSS aceita é `display-digits`; (4) o passo 5 do Setup fica como "Aparência" (só os visuais), e `hud` segue no contrato com leitura tolerante; (5) a prova de C28 constrói com `NODE_ENV=production`, porque o vitest roda em `test` e o React de desenvolvimento infla o JS em 30%.
- Gate do fim (uma vez): `npm run build`, `typecheck`, `lint` (ESLint e stylelint), UI 129 arquivos / 1046 testes, raiz 111 arquivos / 1571 testes, `bundle:check` (JS gzip 499 906 contra 507 021 da base), `licenses:check`, `network:scan -- --check`, `dist:quick` sem `docs/` no pacote: todos `0`. e2e (a11y, galeria e contraste, superfície, moldura, nucleo-shell, smoke, setup-wizard, onboarding, primitivas, em duas rodadas porque o limite de 10 min do ambiente cortou a primeira): só falham os casos da base conhecida (moldura C20/C57, nucleo-shell:165/:467/:1048, onboarding:7/:33); nenhuma captura de galeria mudou (`git status` sem PNG).
