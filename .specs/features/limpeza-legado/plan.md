# Limpeza do legado — o que sobrou depois dos dois shells, do design system e das primitivas

## Problem

A interface carrega código que ninguém alcança e documentação que descreve outro produto. Levantamento do
código real em `chore/tlc-spec-lean-skill` (5d2d082), medido, não presumido:

- **Código morto.** 39 símbolos exportados que nada importa nem usa dentro do próprio arquivo (a varredura
  do `knip` 6.41.0 e a de árvore sintática concordam), entre eles `runs/policy.ts` inteiro (sobra do
  compositor de execução rápida que o console substituiu: nenhum arquivo de produção o importa), `useApi`,
  `Empty`, `useOsRun`, `hudEquals`, `shortAge`, `AREA_COLORS`, `askAgent`, `subscribePanels`.
- **CSS morto.** 51 classes de 9 arquivos CSS sem uso em nenhum arquivo de produção (17 em
  `desktop/desktop.css`, 13 em `runsScene.css`, 6 em `skillsScene.css`, 5 em `backend.css`, 4 em `runs.css`, 3 em
  `nucleo.css`, 2 em `theme.css`, 1 em `onboarding.css`), 16 `@keyframes` que nenhuma regra chama e 4 propriedades
  customizadas que ninguém lê (`--canvas-line`, `--stage-top`, `--z-base`, `--dur-enter`).
- **Tradução órfã.** 275 das 2139 chaves de `en` e `pt-BR` não aparecem em nenhum arquivo de produção, literal
  ou por prefixo dinâmico (`runs.write.*`, `desktop.strip.*`, `desktop.cfg.*`, `desktop.hud.*`, `scene.runs.*`…);
  a paridade `en`/`pt-BR` já é testada, a ausência de uso não.
- **Um passo do Setup que grava e ninguém lê.** O quinto passo do Setup ("Monte seu HUD") mostra os cinco
  visuais (o preset de tema, que vale nas duas interfaces) e, abaixo, 13 + 7 chaves para montar os arcos de pílulas
  do HUD; o Setup grava o resultado em `hud` nas preferências de interface e nenhum arquivo lê esse campo (as
  pílulas laterais do desktop antigo não existem mais). A pessoa decide, no primeiro uso, algo que não muda nada
  na tela, e o passo tem o nome de uma coisa que não existe.
- **Três renderizadores do mesmo Markdown.** Um parser (`brain/markdown.ts`) e três funções que o desenham:
  `views/Skills/Markdown.tsx`, o `renderInline`/`renderBlocks` de `brain/PreviewPanel.tsx` e
  `nucleo/scenes/BrainSceneMarkdown.tsx`. Cada um decide sozinho o que é um link seguro: o primeiro aceita
  `http(s)`, `mailto:` e `#`, os outros dois só `http(s)://`; o primeiro descarta tabelas em silêncio.
- **Documentação de outro produto.** O README ainda apresenta "widgets arrastáveis que encaixam numa grade, um
  lançador de apps (⌘M) e o chip 'Back to the OS'" (o desktop de setembro); o produto tem dois shells (a moldura
  de app e o Núcleo). `docs/` mistura os guias do produto com 6 pastas e 2 arquivos de análise e plano internos
  (≈11 MB, 118 arquivos, um com caminhos absolutos da máquina de quem escreveu) ao lado de `install.md`.

O que o roteiro (item 12) supunha e o código **não** confirma: os 12 widgets de `desktop/widgets/`, o `desktop.css`
e os dois cérebros **estão em uso** (a "Hoje" da moldura monta seis widgets pelo registro, o Núcleo abre qualquer
widget como lâmina e monta a vista do Segundo Cérebro como "mapa clássico", a moldura monta a mesma vista em
`/brain`); o Pixel Studio **já é um chunk à parte** (`PixelStudio-*.js`, 20 020 bytes, `import()` em
`desktop/apps.tsx`), não está no bundle principal. O inventário completo, com a prova de cada item mantido e
removido, está em `design.md`.

Evidência: o levantamento de 11/10/2026 desta sessão (grafo de importação de 1 241 arquivos rastreados, `knip`
6.41.0 fora do repositório como instrumento, varredura de `postcss` e de árvore sintática do TypeScript).
Quando isto sair: o repositório tem menos o que ler, o README descreve o produto, e cada uma das varreduras
vira um teste que impede a volta.

## Flow

Reutiliza `src/testing/` (os leitores de CSS e TS do design system, `sizeScan`/`stateScan`, exist), o
`TypeScript` já devDependency para a varredura de árvore, `scripts/bundle-baseline.json` (exists) para o peso e
`tests/legal.docs.test.ts` (exists) para a varredura de marcas.

1. Instrumento → `src/testing/sourceGraph.ts` (new, no door - placement per conventions) lê a árvore de
   `apps/command-centre/src` com o compilador do TypeScript e entrega grafo de importação, exportações e usos;
   `legacy.graph.test.ts`, `legacy.css.test.ts` e `i18n.orphans.test.ts` (new) o consomem.
2. Remoção → código, CSS e chaves sem prova de uso saem em commits separados, um por família (door 4); cada
   teste de código removido sai com ele (lista em `design.md`).
3. Setup → `views/Setup.tsx` (exists) troca `DesktopStep` por um passo "Aparência" só com os cinco visuais e tira
   `hud` do corpo gravado; `UiPreferencesSchema` (`contracts/src/preferences.ts`, exists) segue aceitando e
   servindo `hud` (door 3).
4. Markdown → `components/Markdown.tsx` (new, door 2) é a única função que desenha blocos; `views/Skills`,
   `brain/PreviewPanel` e `nucleo/scenes/BrainSceneReader` (exist) passam a chamá-lo.
5. Pixel → `plugins/pixel/` (new, door 1) guarda `PixelStudio.tsx` e o manifesto; `desktop/apps.tsx` (exists)
   monta `APPS.pixel` a partir do manifesto.
6. Documentação → `README.md` e `docs/` (exist) são reescritos contra o código; as pastas internas vão para
   `docs/internal/` (door 5); `tests/docs.drift.test.ts` (new) segura o README, os links e o instalador.

## Impact

| Front       | What changes                                                                                                                                                                                                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | novo termo: `AppPlugin` - o registro de um micro-app carregado sob demanda (rota, títulos, ícone, `load`), mora em `src/plugins/types.ts`                                                                                                                                                      |
| domain      | termo existente: "passo do Setup" - o quinto passo deixa de ser "Monte seu HUD" e passa a ser "Aparência" (só os cinco visuais); continua cinco passos; quem ramifica nele: `Setup.tsx` (`LAST_STEP`), o e2e `setup-wizard.spec.ts` (quatro "Next" e "Finish setup")                           |
| domain      | termo existente: "link seguro" em Markdown - passa a ser uma só função (door 2); quem ramifica nela hoje: os três renderizadores                                                                                                                                                               |
| screen      | Setup, quinto passo: some o texto sobre o HUD e os dois grupos de chaves ("Arco da esquerda · apps", "Arco da direita · leituras"); o rótulo do passo passa de "Monte seu HUD" a "Aparência"; os cinco visuais ficam como estão                                                                |
| screen      | Skills (detalhe e console), Segundo Cérebro (painel de pré-visualização) e Núcleo (leitor do cérebro): o HTML desenhado é o mesmo de antes, salvo as duas diferenças decididas na suposição 2                                                                                                  |
| screen      | nenhuma outra tela muda de aparência: o CSS removido não casa com nenhum elemento que a interface desenha                                                                                                                                                                                      |
| contract    | nenhum na API: `hud` e os demais campos de `UiPreferences` ficam (door 3); `docs/events.md`, o OpenAPI e a lista pública do SDK não mudam                                                                                                                                                      |
| test        | testes de código removido saem com ele (`runs/policy.test.ts`, `runs/policy.delegation.test.ts`, os de `hud.ts` removidos e os de `Setup` do passo), listados em `design.md`; provas de outras features que citam esses testes (`contratos` C15 e C17) ficam sem código a provar (suposição 6) |
| bundle      | o JS gzip não sobe (a feature só remove e unifica); entrada nova em `scripts/bundle-baseline.json` com a razão                                                                                                                                                                                 |
| stored data | nada a migrar: `ui-preferences.json` antigos, com ou sem `hud`, são lidos como antes                                                                                                                                                                                                           |
| docs        | `docs/` perde 8 entradas que vão para `docs/internal/`; os links de README e de guias passam a resolver; o instalador continua sem nenhum arquivo de `docs/`                                                                                                                                   |

## Relations

None - no stored-data shape change

## Surface

None - nothing consumed outside

## Landing

| One-way door                               | Literal shape                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Alternative rejected                                                                                                                                                                                                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Contrato de plugin de app               | `src/plugins/types.ts`: `export interface AppPlugin { kind: string; route: \`/${string}\`; titleKey: TKey; refKey: TKey; descKey: TKey; Icon: LucideIcon; load: () => Promise<{ default: ComponentType<any> }> }`; `plugins/pixel/index.ts`exporta`pixelPlugin: AppPlugin`com`load: () => import("./PixelStudio")`; `desktop/apps.tsx`monta`APPS.pixel`de`pixelPlugin` (`Component: lazyRoute(pixelPlugin.load)`); o plugin importa do app só pela lista fechada de módulos de `design.md` (`../../ui`, `../../commands/registry`, `../../commands/keys`, `../../i18n`, `../../apiCall`, `../../components/ui`, `../../hooks/useConfirm`, `../../views/shared`) | descoberta em tempo de execução (`import.meta.glob("./plugins/*/index.ts")`): o Vite embute o manifesto de todo plugin no chunk principal e o `AppKind`, as preferências e a barra lateral ainda precisariam saber o nome em tempo de compilação                                                     |
| 2. Um só renderizador de Markdown          | `components/Markdown.tsx`: `export function Markdown(props: { source?: string; blocks?: Block[]; shape: "page" \| "panel" \| "scene"; refs?: MarkdownRefs })`, onde `shape` escolhe o conjunto de classes e o nível dos títulos e `MarkdownRefs` traz `{ resolve, skills, onNote, onSkill, onPeek, kindOf, headingIds }`; a política de link é `safeExternalHref(href)`: `^https?://` ou `^mailto:`, qualquer outra coisa é texto; todo `<a>` leva `target="_blank"` e `rel="noreferrer noopener"`                                                                                                                                                              | três componentes com um `safeHref` compartilhado: o que diverge entre eles (o que é um link, o que vira botão, a marcação) fica copiado três vezes e a próxima correção de segurança precisa lembrar de três lugares                                                                                 |
| 3. O campo `hud` das preferências fica     | `UiPreferencesSchema.hud` e `DEFAULT_HUD` ficam em `@mordomo/contracts`; a interface não lê nem grava `hud`; um arquivo antigo é servido como veio                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | tirar `hud` do esquema: `tests/preferences.test.ts` (C1, C7) e `tests/contracts.test.ts` fixam que a migração v1→v2 não perde preferência e que `DEFAULT_HUD` é exportado, e um cliente da API pública perderia o campo sem aviso                                                                    |
| 4. Instrumento de código morto             | uma varredura própria, `src/testing/sourceGraph.ts` sobre o compilador do TypeScript (devDependency que já existe), e testes que a executam no `vitest` da interface; nenhuma dependência nova                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `knip` 6.41.0 como devDependency: licença ISC (compatível), mas traz 14 pacotes e 20 binários nativos opcionais ao `package-lock.json`, duplica `yaml` e `zod` 4, e exige uma lista de `ignore` que esconde o que a varredura própria diz em uma frase (o símbolo não é referenciado em lugar algum) |
| 5. Pasta de documentação interna           | `docs/internal/` (com `README.md` e a tabela "de onde veio") recebe `analysis-2026-09`, `audit-2026-09`, `plan-2026-09`, `execution-2026-09-06`, `review-2026-09-06`, `plans`, `analise-engine-ui-2026-09-12.md` e `validation-report.md`; `package.mjs` não copia `docs/`; um teste prova as duas coisas                                                                                                                                                                                                                                                                                                                                                       | apagar as pastas: os specs (`conceito-em-todo-sistema`, `licenca-comercial`) e o código (`desktop/signal.ts`, `nucleo-shell.spec.ts`) as citam como a história da decisão                                                                                                                            |
| 6. Lista de prefixos dinâmicos de tradução | `DYNAMIC_PREFIXES` em `i18n.orphans.test.ts`: cada prefixo (`effort.`, `status.`, `scene.skills.cat.`…) com o motivo e a contagem de chaves que ele cobre, e um teste que reprova um prefixo que não cobre chave nenhuma                                                                                                                                                                                                                                                                                                                                                                                                                                        | considerar usada toda chave sob qualquer prefixo de template: uma chave nova morta passa a ser "usada" por acaso de um `` `x.${y}` `` qualquer                                                                                                                                                       |

- Nada mais nesta mudança é difícil de reverter: cada remoção é um commit (o `git revert` a desfaz), e o que o
  teste deixa passar entra numa lista com o motivo.

## Criteria

### S1: Nada fica sem prova de uso (P1)

Cada família de legado vira uma varredura que reprova a volta; o que não tem uso sai.

**Acceptance Criteria**

1. WHEN the import graph of `apps/command-centre/src` is walked from `main.tsx`, `gallery/main.tsx` and `brain/engine/force.worker.ts` (static imports, re-exports, `import()`, CSS `@import`, `new URL` of the worker) THEN the non-test source files that no entry reaches SHALL be exactly the twelve of the closed list in `design.md` (test kits, the readers of the guards, the entity harness), each with its reason
2. WHEN every `export` of a non-test source file in `apps/command-centre/src` is looked up by name in the importers, the namespace imports, the dynamic imports and the file's own references THEN no exported symbol SHALL have none of them (zero dead exports; the primitives' barrel `ui/index.ts` is the one file excepted, because `primitivas` C3 pins its value list)
3. WHEN every class selector of every CSS file of the Command Centre is looked up in the production source (literal tokens and dynamic prefixes) THEN each SHALL be used, or be on the closed list of classes only a test builds (`display-digits`, with the reason)
4. WHEN every `@keyframes` and every custom property defined in the CSS is looked up THEN each SHALL be referenced by a rule, a `var()` or the production source
5. WHEN every key of the `en` dictionary is looked up in the production source THEN each SHALL appear as a string literal, or sit under a prefix of `DYNAMIC_PREFIXES` that a template or concatenation in the production source builds, and the `pt-BR` dictionary SHALL have exactly the same keys
6. IF a prefix of `DYNAMIC_PREFIXES` covers no key of the dictionary THEN the check SHALL fail naming the prefix
7. WHEN the legacy removal is complete THEN `runs/policy.ts` and its two test files SHALL NOT exist, and no file SHALL import `writePolicyFor`, `followUpPrompt` or `cwdSuggestions`

**Independent test:** apagar o uso de uma chave de tradução, de uma classe ou de um símbolo exportado faz o teste dele
falhar nomeando o item.

### S2: O Setup sem o passo do HUD (P1)

A pessoa escolhe o visual e termina sem montar arcos que nada desenha.

**Acceptance Criteria**

8. WHILE the in-UI Setup is open THEN the step indicator SHALL list five steps, in this order: providers, identity, folders, connect data, appearance (pt-BR "Provedores", "Identidade", "Pastas", "Conectar dados", "Aparência"), and no step label, hint or group label SHALL contain the word "HUD"
9. WHILE the fifth step is open THEN it SHALL show the five theme presets and SHALL NOT show any instrument toggle (no `[data-hud]` button, no group "Left arc" nor "Right arc"), and choosing a preset SHALL still apply it at once (`data-preset` on `<html>`)
10. WHEN the person finishes the Setup THEN the request to `PUT /api/ui-preferences` SHALL carry `themePreset` and SHALL NOT carry `hud`
11. WHERE `config/ui-preferences.json` was written by the previous version with a custom `hud` THEN `GET /api/ui-preferences` SHALL return that `hud` unchanged, and a `PUT` of `themePreset` alone SHALL leave it unchanged on disk
12. WHERE `config/ui-preferences.json` has no `hud` (a file older than the field) THEN `GET /api/ui-preferences` SHALL return `DEFAULT_HUD`
13. IF `hud` in `config/ui-preferences.json` is unreadable (a string, a number, arrays of numbers) THEN `GET /api/ui-preferences` SHALL return `DEFAULT_HUD` and the other fields SHALL be returned as stored
14. WHEN a `settings.json` of version 1 that carries a `hud` is migrated THEN the `hud` SHALL be in `ui-preferences.json` (the proof of `preferencias-ui` stays)
15. The Command Centre SHALL NOT read nor write the `hud` preference: no source file outside `src/settings.typetest.ts` SHALL name `.hud` of the preferences document, `HUD_CATALOGUE` SHALL stay only as the list the palette shows to open a panel

**Independent test:** completar o Setup em um navegador novo e abrir `config/ui-preferences.json`: sem `hud` novo.

### S3: Um só renderizador de Markdown (P1)

O mesmo texto desenha igual onde já desenhava, e o que é seguro é decidido em um lugar.

**Acceptance Criteria**

16. WHEN the same corpus of Markdown is drawn by each of the three surfaces (Skills `page`, Brain preview `panel`, Brain scene reader `scene`) THEN the HTML SHALL equal, byte for byte, the HTML the three old renderers drew at `5d2d082` (golden files), except for the two differences of assumption 2
17. The Command Centre SHALL have one function that switches over the block types of the Markdown tree (`components/Markdown.tsx`): no other non-test source file SHALL contain `case "paragraph"`
18. WHEN a source holds raw HTML (`<script>`, `<img onerror>`, `<iframe>`, `<a href="javascript:…">`) THEN every surface SHALL draw it as text, with no element of that tag in the DOM
19. WHEN a link has the scheme `javascript:`, `data:`, `vbscript:`, `file:`, a protocol-relative `//host` or a bare `#anchor` THEN no surface SHALL draw an `<a>`; the text SHALL be drawn as inert text
20. WHEN a link has the scheme `http://`, `https://` or `mailto:` THEN every surface SHALL draw an `<a>` with `target="_blank"` and `rel="noreferrer noopener"`
21. WHEN a table is in a skill body THEN the `page` surface SHALL draw it (it was dropped in silence)
22. WHEN a path or a link resolves to a note, or a `/skill` token names a known skill THEN the `panel` and `scene` surfaces SHALL draw the button that selects the note or opens the skill, exactly as before

**Independent test:** colar `[x](javascript:alert(1))` e `<img src=x onerror=alert(1)>` no corpo de uma skill, numa nota do cérebro e no leitor do Núcleo: nenhum vira link nem elemento.

### S4: O Pixel Studio como plugin (P2)

O Pixel continua carregado sob demanda e passa a ser registrado por um contrato.

**Acceptance Criteria**

23. The Command Centre SHALL register Pixel Studio through `pixelPlugin` of `plugins/pixel/index.ts` (an `AppPlugin`): `APPS.pixel` SHALL have the route `/pixel`, the title, reference and description keys and the icon it has at `5d2d082`
24. WHEN the production build runs THEN `dist/assets` SHALL hold a `PixelStudio-*.js` chunk, and no chunk reachable by static imports from `main.tsx` SHALL contain the Pixel Studio draft key `pixel-studio-draft`
25. The only static importer of any file of `plugins/pixel/` outside that folder SHALL be `desktop/apps.tsx` importing `plugins/pixel/index.ts`; `PixelStudio.tsx` SHALL be reached only by the dynamic `import()` of the manifest
26. The files of `plugins/pixel/` SHALL import from the rest of the app only the eight modules of the closed list (registry of commands, primitives of layers, interface helpers)
27. WHEN Pixel Studio is open THEN its keys SHALL stay the 13 commands of scope `view:pixel` of the typed registry (the 14 keys of `comandos-atalhos` C26, plus `[` and `]`), with the same ids, keys and title keys as at `5d2d082`
28. WHEN `npm run bundle:check` runs on the build of this feature THEN it SHALL exit 0, and the JS gzip of the build SHALL NOT be above the 507 021 bytes of the last recorded build; `scripts/bundle-baseline.json` SHALL gain the entry `limpeza-legado` with its reason

**Independent test:** abrir `#/pixel` nos dois shells: a mesma tela, com as teclas `1`-`4`, `B`, `[` e `]`.

### S5: Documentação do produto (P2)

**Acceptance Criteria**

29. The `README.md` SHALL describe the Command Centre as two shells (the app frame and the Núcleo), SHALL name the licence (FSL-1.1-ALv2) and SHALL NOT contain any of the phrases of the stale list (`drag-and-drop widgets`, `snap to a grid`, `Back to the OS`, `Ctrl/⌘ M`)
30. The commands table of the `README.md` SHALL list exactly the commands the CLI registers (`apps/api/src/cli.ts`), each by its first word
31. WHEN `README.md` and the product guides of `docs/*.md` link to a file THEN the target SHALL exist; every `npm run <script>` they name SHALL be a script of `package.json`
32. The folders and files of internal analysis, plans and reviews listed in door 5 SHALL live under `docs/internal/`, with a `README.md` that gives the old path of each; the `README.md` of the repository SHALL link them only from a "Project history" line
33. The installer payload built by `scripts/package.mjs` and `scripts/legal-stage.mjs` SHALL NOT contain any path under `docs/`, and `legal/THIRD_PARTY_NOTICES.md` SHALL NOT name any file of `docs/internal/`
34. WHEN the trademark sweep of `tests/legal.docs.test.ts` runs THEN it SHALL read the files of `docs/internal/` (the sweep covers every folder of `docs/`)
35. The `CHANGELOG.md` SHALL have an entry for the feature under "Unreleased" that lists what was removed and what was kept

**Independent test:** `npx vitest run tests/docs.drift.test.ts` apontando para um README com "drag-and-drop widgets" falha.

### S6: Nada quebra (P1)

**Acceptance Criteria**

36. WHEN the UI tests, the root tests, `npm run typecheck`, `npm run lint` (ESLint and stylelint), `npm run build`, `npm run bundle:check`, `npm run licenses:check` and `npm run network:scan -- --check` run THEN each SHALL exit 0
37. WHEN the e2e specs of a11y, gallery, gallery-contrast, surface-contrast, moldura, nucleo-shell, smoke, setup-wizard, onboarding, primitives and the specs that touch the screens above run THEN the set of failing tests SHALL NOT contain any test that passes at `5d2d082` (the failures of the known base are listed in `checks.md`)
38. WHEN the gallery is rendered THEN the Linux reference captures SHALL be regenerated only if a capture differs, and each regenerated PNG SHALL be opened and reviewed before the commit

**Independent test:** `npm run build && npm run bundle:check`.

## Out of scope

| Excluded                                                                            | Why                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remover os 12 widgets, `desktop/` ou `desktop.css` inteiros                         | estão em uso: a "Hoje" da moldura monta seis widgets pelo registro, o Núcleo abre qualquer widget como lâmina e a paleta e o console os nomeiam (`design.md`, inventário); só o que a varredura prova morto sai |
| Remover um dos dois cérebros                                                        | os dois estão vivos: a moldura monta o Segundo Cérebro em `/brain` e o Núcleo monta a constelação, com o "mapa clássico" (o mesmo Segundo Cérebro) a um clique; não há preferência que os escolha               |
| Tirar `hud`, `dashboardLayout`, `spaces` ou `microApps` do contrato de preferências | é contrato público da API e das provas de `preferencias-ui`; fica como pergunta ao dono (padrão: manter)                                                                                                        |
| Um sistema de plugins descoberto em tempo de execução                               | o `AppKind`, as preferências e a barra lateral nomeiam o Pixel em tempo de compilação; um `AppPlugin` é uma costura de registro, não um carregador                                                              |
| Reescrever as análises internas ou os `.specs` históricos                           | são a história da decisão; ganham um mapa de caminhos em `docs/internal/README.md`                                                                                                                              |
| Adotar o `knip`                                                                     | porta 4: custo de dependência maior que o ganho                                                                                                                                                                 |
| Colapsar os 12 widgets em menos, ou redesenhar a "Hoje"                             | é produto, não limpeza                                                                                                                                                                                          |

## Assumptions

| Assumption                                                                                          | Chosen default                                                                                                                                                                                                          | Rationale                                                                                                                                                                                                                                                                                                                           | Confirmed? |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1. O roteiro dizia "remover widgets, `desktop.css` e dois cérebros"                                 | manter o que está em uso e remover só o que a varredura prova morto                                                                                                                                                     | a regra do dono: nenhuma remoção sem prova de inalcançabilidade; o inventário mostra que o que o roteiro supunha morto está vivo                                                                                                                                                                                                    | n          |
| 2. A política de link do renderizador único é `http(s)://` e `mailto:`; `#âncora` não é link        | duas diferenças visíveis: o `mailto:` passa a ser link nas superfícies do cérebro (era texto), e a âncora `#x` dos corpos de skill passa a ser texto (era `<a href="#x">`, que com `HashRouter` trocaria a rota do app) | a união mais larga das três sem a âncora, que quebra a navegação; reverter: aceitar `#` em `safeExternalHref`                                                                                                                                                                                                                       | n          |
| 3. A superfície `page` passa a desenhar tabelas                                                     | desenha (a tabela era descartada em silêncio, o parser já a entrega)                                                                                                                                                    | descartar dado do texto da pessoa é defeito; reverter: devolver `null` ao caso `table` quando `shape === "page"`                                                                                                                                                                                                                    | n          |
| 4. `runs/policy.ts` e os testes dele saem                                                           | saem, com o motivo e a lista em `design.md`                                                                                                                                                                             | nenhum arquivo de produção o importa e as chaves de tradução que o alimentavam (`runs.write.*`) estão órfãs; as provas C15/C17 de `contratos` citam esses testes, e a obrigação delas (a interface não duplica a tabela de perfis) passa a ser provada por `tests/contracts.test.ts` C11 e pela ausência de `PROFILES` na interface | n          |
| 5. `hud` fica no contrato                                                                           | fica, só a interface deixa de gravá-lo                                                                                                                                                                                  | porta 3                                                                                                                                                                                                                                                                                                                             | n          |
| 5b. O quinto passo do Setup também escolhia o visual (preset de tema), que vale nas duas interfaces | o passo fica, como "Aparência", só com os cinco visuais; sai o HUD                                                                                                                                                      | tirar o passo inteiro tiraria da pessoa a escolha do visual e da cor de destaque no primeiro uso, que não é legado (os dois shells a usam); reverter: apagar `AppearanceStep` e mover os cinco visuais para o passo de identidade                                                                                                   | n          |
| 6. As provas de outras features que citam teste removido                                            | listadas em `design.md` ("provas que mudaram de endereço"), sem editar `verification.md` antigos                                                                                                                        | os relatórios são história; a obrigação segue provada por outro teste ou não tem mais código                                                                                                                                                                                                                                        | n          |
| 7. O Pixel não muda de comportamento nem de atalho                                                  | o `PixelStudio.tsx` muda de pasta e de import, e o corpo não muda                                                                                                                                                       | o roteiro pede plugin "sem mudar comportamento nem atalhos"                                                                                                                                                                                                                                                                         | y          |
| 8. Os `.specs` históricos seguem citando `docs/plans/…`                                             | o mapa de `docs/internal/README.md` os resolve                                                                                                                                                                          | apagar ou reescrever relatório verificado é perder a história                                                                                                                                                                                                                                                                       | n          |
| 9. O peso é registrado numa entrada nova do baseline                                                | `limpeza-legado`, com os bytes medidos                                                                                                                                                                                  | a regra de `primitivas` C31: o limite só se move por linha revisada                                                                                                                                                                                                                                                                 | n          |

**Open questions:** none - all resolved or logged above. As decisões de produto estão em "Perguntas ao dono" do
`STATE.md`, com o padrão e como reverter.

## Observable

| Surface                                                        | Decision                            | Landing                                                                                                                           |
| -------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| screen Setup                                                   | empty state                         | n/a - o Setup não lista dados; o passo "Conectar dados" mostra o que já mostrava                                                  |
| screen Setup                                                   | loading and error states            | existing - `useMutation` do `finish` desabilita os botões enquanto grava e mostra o erro no passo; AC 10 só tira o campo do corpo |
| screen Setup                                                   | unauthorised state                  | n/a - um navegador remoto sem credencial vai à tela de pareamento antes do Setup (`App.tsx`)                                      |
| screen Setup                                                   | density and ordering                | AC 8, AC 9                                                                                                                        |
| screen Setup                                                   | destructive action confirms         | n/a - nenhuma ação destrutiva                                                                                                     |
| screen Skills (corpo), Segundo Cérebro (nota), Núcleo (leitor) | empty, loading, error               | existing - cada tela mantém os seus; AC 16 prova o desenho do texto                                                               |
| screen Skills (corpo), Segundo Cérebro (nota), Núcleo (leitor) | density and ordering                | AC 16                                                                                                                             |
| screen Skills (corpo), Segundo Cérebro (nota), Núcleo (leitor) | a link in the text                  | AC 18, 19, 20                                                                                                                     |
| screen Pixel Studio                                            | empty, loading, error, unauthorised | existing - a tela é a mesma; AC 23 e AC 27                                                                                        |
| screen Pixel Studio                                            | destructive action confirms         | existing - `useConfirm` ("Limpar quadro", "Excluir sprite")                                                                       |
| all removed code, CSS and keys                                 | validation, bounds                  | AC 1-6                                                                                                                            |
| all removed code, CSS and keys                                 | failure                             | n/a - nada roda em tempo de execução que a varredura julgue; a falha é do teste                                                   |
| document README and docs                                       | structure, tone, next step          | AC 29-32                                                                                                                          |
| API / CLI                                                      | any                                 | n/a - nenhuma rota, comando nem flag muda                                                                                         |

## Sources

- `.specs/roadmap.md` item 12 (`limpeza-legado`) - o escopo e a dependência da moldura
- `.specs/features/design-system/design.md`, `primitivas/design.md`, `comandos-atalhos/design.md`, `moldura-app/design.md` - as regras que a limpeza não pode quebrar (piso de 12px, cor por token, estado não só por cor, um ouvinte de teclado, camadas, galeria de duas camadas)
