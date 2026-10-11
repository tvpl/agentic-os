# Primitivas — Radix por baixo, uma linguagem visual nos dois shells

## Problem

A interface refaz à mão, em lugares diferentes, as mesmas seis peças: diálogo, popover, abas,
interruptor, menu e dica. O levantamento do repositório de 10/10/2026 (`apps/command-centre/src`) acha:

- **Diálogos**: um `Modal` (`components/ui.tsx`) com 10 usos, mais cinco diálogos que repetem a
  mecânica por conta própria (`CommandPalette`, `ProviderGate`, `SkillDeck`, `DocDrawer`, e a
  confirmação por `useConfirm`), todos sobre um gancho `useDialog` de 240 linhas em
  `components/dialog.tsx` (armadilha de foco, Esc, `inert`, restauração de foco, escada de camadas).
- **Popovers**: um `Popover` (`components/primitives.tsx`, com posicionamento, clique fora e Esc
  próprios) e quatro cópias que o ignoram: o sino (`moldura/BellPopover.tsx`, Esc pelo registro e
  clique fora por `useOutsidePress`), `ModelEffortPopover`, `ModelPopover` e `ConversationsPopover`
  (cada um mede a âncora e prende o foco com `useDialog` mesmo dizendo `aria-modal="false"`).
- **Abas**: um `Tabs` (`primitives.tsx`) e duas cópias (a navegação das Configurações,
  `views/Settings.tsx`, com todas as abas na ordem de tabulação e sem setas; `.rs-tabs` da cena de
  Execuções do Núcleo).
- **Interruptores**: `role="switch"` escrito à mão em três lugares (`BrainSceneMenu` duas vezes,
  `BrainPanel`), e, no Núcleo, `luz.css` transforma toda caixa de marcar em interruptor de vidro,
  enquanto na moldura é uma caixa: o mesmo controle tem duas linguagens.
- **Menu**: o "+" da cena de Skills (`SkillsSceneTools.tsx`) escreve à mão `role="menu"`, setas, Esc e
  clique fora.
- **Dicas**: 81 botões só de ícone repetem o nome em `title` (a dica nativa do sistema operacional,
  que não aparece com o teclado, não segue o tema e não tem tamanho mínimo).
- **Duas linguagens**: `luz.css:149-206` reescreve `.modal` e `.modal-backdrop` por cima do tema para o
  Núcleo, e cada popover tem aparência própria (`.popover`, `.me-popover`, `.mold-popover`,
  `.popover.bs-menu`, `.sks-menu`). A feature `design-system` deixou isso dito em "Out of scope":
  "unificar é trocar as primitivas".

O custo é de quem usa e de quem mantém: um diálogo novo nasce copiando o anterior com a escada de
foco e de Esc escrita de novo; a navegação por teclado das Configurações não tem setas; o sino e o
modelo da conversa prendem o foco de um jeito diferente; e cada correção de acessibilidade tem de ser
feita em seis lugares. O roteiro (`.specs/roadmap.md`, item 10b) manda trocar essas peças por
primitivas sobre Radix.

Quando isto entrar, as peças da interface se comportam do mesmo jeito nos dois shells (foco entra,
Tab não escapa, Esc fecha a de cima, o foco volta a quem abriu, as setas andam nas abas e nos menus,
a dica aparece também com o teclado) e se desenham a partir de uma só folha de estilo, com o shell
mudando só o material (raio, vidro, véu) por tokens.

## Flow

Reaproveita o registro de comandos (`commands/registry.ts`) e a escada de camadas de
`components/dialog.tsx` (que vira `ui/layers.ts`), o portal `#modal-root`, os tokens de `theme.css`, o
leitor de estados de `states.test.ts` e a galeria.

1. Uma view ou um shell pede uma peça (`Modal`, `Popover`, `Tabs`, `Switch`, `DropdownMenu`,
   `Tooltip`) -> `src/ui/index.ts` (new, door 2), o único lugar que importa `@radix-ui/*` (door 1).
2. `ui/Dialog` (new, door 2) monta o Radix Dialog no `#modal-root` e registra a camada em
   `ui/layers.ts` (new, door 3, o código de pilha/`inert`/profundidade de `components/dialog.tsx`,
   que sai); a profundidade e o `inert` continuam sendo o que o resto do app lê.
3. Tecla: o Radix trata Esc (ouvinte de documento em captura) e Tab (armadilha de foco) da camada de
   cima e marca o evento `defaultPrevented`; `commands/registry.ts` (exists) ignora o que já foi
   tratado e continua com o único ouvinte de comandos da página. `useDrawer` e os ouvintes de janela em
   captura das cenas do Núcleo leem a mesma marca (e `floatingLayerOpen()`): um Esc fecha uma coisa, a de cima.
4. `commands/listenersAllowlist.ts` (exists) ganha a lista das dependências que escutam teclado
   (door 5); `commands.probe.test.tsx` (exists) atribui o ouvinte ao pacote do Radix, e não ao React DOM.
5. `ui/ui.css` (new, door 4) desenha tudo por tokens `--ui-*`; `html:has(.nu-shell)` e
   `[data-shell="moldura"]` só declaram o material (raio, vidro, véu); `luz.css` deixa de reescrever `.modal`.
6. Os widgets feitos à mão (o inventário fechado da seção de inventário do desenho) passam a usar a peça; os três painéis que
   continuam no lugar (barra lateral estreita, gaveta da conversa e gaveta do documento) ficam em `useDrawer`
   (`ui/layers.ts`), com o motivo escrito (door 9).

## Impact

| Front       | What changes                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | novo termo: `ui` - a pasta das primitivas (`apps/command-centre/src/ui`), a única que importa `@radix-ui/*`                                                                                                                                                                                                                                                                                                                                       |
| domain      | novo termo: material do shell - o conjunto de tokens `--ui-*` (raio da folha, véu, vidro, recorte) que o Núcleo e a moldura declaram uma vez; é a única diferença entre os dois shells nas primitivas                                                                                                                                                                                                                                             |
| domain      | termo existente: `useDialog` quer dizer "gaveta que fica onde está": só a barra lateral estreita, a gaveta da conversa e a gaveta do documento o usam, e ele passa a se chamar `useDrawer`; quem ramifica nele hoje: `moldura/Sidebar.tsx`, `moldura/Moldura.tsx`, `moldura/DocDrawer.tsx`, `ProviderGate`, `CommandPalette`, `SkillDeck`, `ModelEffortPopover`, `ConsoleControls` (os três primeiros ficam; os outros trocam para as primitivas) |
| domain      | termo existente: "camada modal" do registro de comandos - `getDialogDepth()` e `useDialogDepth()` passam de `components/dialog` para `ui/layers`; quem os lê: `commands/registry.ts`, `App.tsx`, `moldura/hooks.ts`, `onboarding/Onboarding.tsx`, `nucleo/scenes/BrainScene.tsx`                                                                                                                                                                  |
| contrato    | no repositório: seis dependências novas em `apps/command-centre/package.json`, com versão exata; `package-lock.json` muda; nada na API                                                                                                                                                                                                                                                                                                            |
| screen      | popovers que prendiam o foco e deixavam a página inerte sem serem modais (`ModelEffortPopover`, `ModelPopover`, `ConversationsPopover`) passam a ser não modais de verdade: a página atrás continua viva, um clique fora fecha, Esc fecha e devolve o foco à âncora                                                                                                                                                                               |
| screen      | a navegação das Configurações passa a ter uma só parada de Tab e setas (hoje as 10 abas são 10 paradas)                                                                                                                                                                                                                                                                                                                                           |
| screen      | o Núcleo perde o véu/folha escritos por cima de `.modal` em `luz.css` e os ganha pelos tokens do material; o sino, o menu "⋯" do Cérebro, o menu "+" de Skills e os popovers do console ficam com a superfície das primitivas (vidro no Núcleo, folha opaca na moldura)                                                                                                                                                                           |
| screen      | 81 botões só de ícone trocam o `title` nativo por uma dica das primitivas (atraso de 400 ms, aparece com o foco do teclado); os `title` que carregam dado (caminho, texto cortado, resumo) ficam                                                                                                                                                                                                                                                  |
| test        | `commands/listenersAllowlist.ts` e `commands.probe.test.tsx` passam a contar também as dependências; a entrada `components/dialog.tsx` vira `ui/layers.ts` (a gaveta) e a de `components/primitives.tsx` sai (o Esc do popover é do Radix, com o ouvinte listado como dependência); as listas `MICROCOPY` e `MARKED_ELSEWHERE` perdem as entradas dos seletores que somem e ganham as das primitivas, cada uma com o motivo                       |
| screen      | um menu aberto é uma camada para o registro de comandos (`overlay`), como um diálogo: as letras e o `Mod+K` não chegam à tela atrás dele; um diálogo aberto por um item de menu ou por um controle de popover devolve o foco ao controle de que o painel pendia, quando o item sumiu; um Esc com dica, popover ou menu aberto fecha essa camada antes de qualquer gaveta ou cena                                                                  |
| screen      | a dica de um controle cujo nome ela repete deixa de ser a sua descrição (`aria-describedby`): o leitor de tela dizia o nome duas vezes a cada foco; o vidro dos popovers do Núcleo passa de 70% a 86% de opacidade; a folha de detalhes de Skills, que era desenhada duas vezes (`ui.css` e `skillsScene.css`), fica só com o material das primitivas: o recorte de canto e o vidro próprio saem                                                  |
| test        | `tests/bundle-size.test.ts` e `scripts/bundle-baseline.json` (o guarda de peso, no CI); `tests/ui-deps.test.ts` lê a lista de partida da própria feature e não o histórico do git                                                                                                                                                                                                                                                                 |
| stored data | nada a migrar                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Relations

None - no stored-data shape change

## Surface

None - nothing consumed outside; a superfície interna (`src/ui/index.ts`) é a porta 2 de Landing

## Landing

| One-way door                                     | Literal shape                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Alternative rejected                                                                                                                                                                                                                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Dependências                                  | em `apps/command-centre/package.json`, `dependencies`, sem `^`: `"@radix-ui/react-dialog": "1.1.23"`, `"@radix-ui/react-dropdown-menu": "2.1.24"`, `"@radix-ui/react-popover": "1.1.23"`, `"@radix-ui/react-switch": "1.3.7"`, `"@radix-ui/react-tabs": "1.1.21"`, `"@radix-ui/react-tooltip": "1.2.16"` (todas MIT, publicadas em 24/07/2026, a última linha com mais de dois meses); só `@radix-ui/*` entra, e só dentro de `src/ui/`                                                       | o metapacote `radix-ui` (traz mais de trinta primitivas e a poda por árvore não é garantida: peso sem uso); a linha 1.2/1.3 publicada em 05/10/2026 (cinco dias de idade: sem tempo de ser achada defeituosa); faixa `^` (um `npm install` muda o código do app sem que ninguém decida) |
| 2. Pasta e superfície pública                    | `apps/command-centre/src/ui/` com `index.ts` exportando exatamente `Modal`, `DialogSurface`, `Popover`, `Tabs`, `Switch`, `DropdownMenu`, `Tooltip`, `UiProvider` e, de `layers.ts`, `getDialogDepth`, `subscribeDialogDepth`, `useDialogDepth`, `useDrawer`, `focusables`; `components/ui.tsx` perde `Modal` e `components/primitives.tsx` perde `Popover` e `Tabs`, sem reexportá-los                                                                                                       | deixar as primitivas em `components/primitives.tsx` (mistura Radix e nativo, sem fronteira que um teste consiga ler); reexportar do lugar antigo (dois caminhos para a mesma peça: a duplicação que esta feature existe para tirar)                                                     |
| 3. Camadas e teclado                             | o Radix é dono do foco, do Tab e do Esc de `Modal`/`DialogSurface`/`Popover`/`DropdownMenu`/`Tooltip`; `ui/layers.ts` é dono da pilha (`inert` do `#root` e dos irmãos de `#modal-root`, `getDialogDepth()`), e cada diálogo se registra nela com `useDialogLayer(ref, open)`; `Escape` tratado pelo Radix chega ao registro com `defaultPrevented`; `Popover` escreve `aria-modal="false"`                                                                                                   | trocar `inert` por `aria-hidden` do Radix (os checks aprovados da moldura leem `inert`, e `aria-hidden` ainda deixa o foco entrar); refazer à mão a armadilha de foco (é a duplicação que a feature tira); `modal={false}` nos diálogos (o foco sai e o Esc fica sem dono)              |
| 4. Contrato de estilo                            | uma folha, `ui/ui.css`, importada por `main.tsx` e pela galeria; classes mantidas (`modal`, `modal-backdrop`, `launcher`, `popover`, `tabs`) mais `ui-switch`, `ui-menu`, `ui-tip`; estados por `aria-selected`, `aria-checked`, `data-state`, `data-highlighted`; material do shell só por `--ui-sheet-r`, `--ui-sheet-bg`, `--ui-veil`, `--ui-veil-blur`, `--ui-pop-r`, `--ui-pop-bg`, `--ui-pop-blur`, `--ui-pop-clip` declarados em `:root` (moldura) e em `html:has(.nu-shell)` (Núcleo) | uma reescrita por shell nos CSS de cada cena, como `luz.css` faz hoje (duas linguagens que divergem a cada correção); renomear todas as classes para `ui-*` (reabre dezenas de seletores de `MICROCOPY`, `MARKED_ELSEWHERE` e dos e2e sem ganho de comportamento)                       |
| 5. Ouvintes de dependência na lista honesta      | `commands/listenersAllowlist.ts` exporta `OUTSIDE_THE_REGISTRY_DEPS: Record<string, [count: number, why: string]>` chaveado pelo nome do pacote npm (`"@radix-ui/react-use-escape-keydown": [1, "…"]`); a sonda de execução atribui um ouvinte cuja primeira chamada de pilha está em `node_modules/<pacote>` a esse pacote, e um pacote fora da lista reprova                                                                                                                                | deixar o React DOM como atribuição de qualquer ouvinte sem arquivo do app (a sonda hoje conta o ouvinte do Radix como "delegação do React" e nunca mostra que há um segundo ouvinte de Esc na página: a lista deixaria de ser honesta)                                                  |
| 6. Dica no lugar do `title` em controle de ícone | `<Tooltip label={nome}><button aria-label={nome}>…</button></Tooltip>`: o nome acessível continua no `aria-label` e a dica não o substitui; `title` fica só onde carrega dado ou onde um documento binding o nomeia (a barra lateral recolhida e o botão de recolher)                                                                                                                                                                                                                         | `title` nativo (não aparece com o foco do teclado, não segue o tema); a dica como único nome do controle (sem `aria-label` o nome some quando o Radix desmonta o conteúdo)                                                                                                              |

| 7. Material do shell, tokens acrescentados na construção (door 4, additive) | além dos oito, `--ui-sheet-edge`, `--ui-sheet-shadow`, `--ui-sheet-blur`, `--ui-sheet-in`, `--ui-sheet-out`, `--ui-veil-in`, `--ui-pop-edge`, `--ui-pop-shadow`, `--ui-item-r`, `--ui-item-clip`, todos em `ui/ui.css` (`:root` e `[data-shell="moldura"]` para a moldura, `html:has(.nu-shell)` e `.nu-shell` para o Núcleo); o `animation` da folha é `animation: var(--ui-sheet-in)` dentro do bloco `no-preference` | declarar a pele de vidro do Núcleo como regras num bloco `html:has(.nu-shell) .modal` dentro de `ui.css` (uma segunda regra por peça: o que `luz.css` já fazia, só mudou de arquivo) |
| 8. Ouvintes de dependência, nomes achados na construção (door 5, additive) | na versão fixada o ouvinte de Esc está em `@radix-ui/react-dismissable-layer` (`document`, captura, só a camada de cima) e o do `@radix-ui/react-menu` (`document`, captura) só marca se a última tecla foi do teclado; a lista é `"@radix-ui/react-dismissable-layer": [1, …]` e `"@radix-ui/react-menu": [1, …]`; `@radix-ui/react-use-escape-keydown` do exemplo da porta 5 não existe nesta linha | manter o nome do exemplo (a sonda reprovaria um pacote que não escuta e deixaria passar os dois que escutam) |
| 9. Gaveta do documento fica em `useDrawer` e o menu não é modal (door 3, additive; achado na construção) | `moldura/DocDrawer` chama `useDrawer(ref, onClose)` (não `DialogSurface`), e `DropdownMenu` passa `modal={false}` ao Radix; `useDrawer` é importado por exatamente `moldura/Sidebar.tsx`, `moldura/Moldura.tsx` e `moldura/DocDrawer.tsx` | `DialogSurface portal={false}` na gaveta: o Radix põe `aria-hidden` em todo irmão de um modal que não sai do lugar, `#modal-root` incluído, e a paleta aberta de dentro da gaveta mora lá e ficava escondida do leitor de tela (achado ao migrar, revertido); menu modal: o Radix põe `aria-hidden` e `pointer-events: none` na página inteira, e o axe reprova conteúdo focável sob `aria-hidden` (`aria-hidden-focus`) |

| 10. Camadas flutuantes e rodada 1 da verificação (doors 2, 3 e 6, additive) | `ui/index.ts` passa a exportar também `floatingLayerOpen` (14 valores); `useDrawer` retorna sem agir quando `e.defaultPrevented`; `DropdownMenu` mantém `useCommandScope("overlay", open)`; `Tooltip` não deixa `aria-describedby` no controle quando o texto da dica é o seu `aria-label`; `Dialog` guarda o controle de que o painel (menu ou popover) pendia e o usa se o opener sumiu; o guarda de peso lê `scripts/bundle-baseline.json` (`tolerance` 1.05, `before`, `after[]` com motivo) e roda por `npm run bundle:check` no CI | tratar o Esc do popover na gaveta pelo registro (a gaveta também prende o Tab, que o registro não trata, e o Esc dela já é lido pela marca `defaultPrevented`: o mesmo efeito sem um terceiro caminho); `modal` no menu (rejeitado na door 9); manter `AFTER` como constante no script (o limite se movia sem uma linha revisável) |

- Nothing else in this change is hard to reverse

## Criteria

### S1: As seis primitivas, sobre Radix (P1)

Uma pasta `src/ui` com diálogo, popover, abas, interruptor, menu e dica, cada uma com o contrato de
teclado, foco e `aria-*` que o Radix dá e que o app já exigia dos seus diálogos.

**Acceptance Criteria**

1. The Command Centre SHALL add six runtime dependencies, `@radix-ui/react-dialog`, `-popover`, `-tabs`, `-switch`, `-dropdown-menu` and `-tooltip`, each at an exact version (no range) from the line published before 2026-09-01, and no other direct dependency
2. The lockfile SHALL agree with the manifests (`npm ci --dry-run` exits 0) and every package the six pull in SHALL carry the licence MIT, ISC, 0BSD or BSD-3-Clause
3. The folder `apps/command-centre/src/ui/` SHALL export `Modal`, `DialogSurface`, `Popover`, `Tabs`, `Switch`, `DropdownMenu`, `Tooltip` and `UiProvider`, and no file outside it SHALL import `@radix-ui/*`
4. WHEN a `Modal` opens THEN it SHALL render under `#modal-root` as `role="dialog"` with `aria-modal="true"` named by its title, and focus SHALL land on its `initialFocus` element, else on its first field, else on the dialog itself
5. WHEN a `Modal` closes THEN focus SHALL return to the element that held it when the dialog opened, with or without a trigger
6. WHILE a `Modal` is open, Tab and Shift+Tab SHALL cycle inside it
7. WHEN Escape is pressed with two dialogs open THEN only the top one SHALL close, once, and the key SHALL reach no command of the registry
8. WHILE a `Modal` is open, every other child of `#root` and of `#modal-root` SHALL be `inert` (the toasts excepted) and `getDialogDepth()` SHALL count it
9. WHEN the backdrop is pressed THEN the `Modal` SHALL ask to close and a press inside it SHALL NOT; `onClose` SHALL run after the 160 ms exit, or at once when reduced motion is preferred
10. WHILE a `Popover` is open it SHALL be `role="dialog"` with `aria-modal="false"`, the page SHALL NOT be `inert` and the depth SHALL NOT count it; WHEN Escape is pressed THEN it SHALL close and focus SHALL return to its anchor; WHEN a press lands outside THEN it SHALL close and focus SHALL stay where the press put it
11. The `Tabs` SHALL expose `role="tablist"`, `role="tab"` with `aria-selected` and `aria-controls` equal to the id `${id}-panel-${tab}` of the one `role="tabpanel"`, one tab stop, the arrow keys (up and down when vertical), Home and End
12. The `Switch` SHALL expose `role="switch"` with `aria-checked`, toggle with Space and not toggle while `disabled`
13. The `DropdownMenu` SHALL expose `role="menu"` of `role="menuitem"`, move with ArrowDown, ArrowUp, Home, End and typed letters, run the item and close on Enter, close on Escape, and return focus to its trigger
14. WHEN a `Tooltip` trigger receives keyboard focus, or the pointer rests on it for 400 ms, THEN the hint SHALL appear as `role="tooltip"` referenced by `aria-describedby`; WHEN Escape is pressed THEN it SHALL disappear with focus unchanged
15. WHERE reduced motion is preferred, the primitives SHALL NOT animate: every `animation` declaration of `ui/ui.css` SHALL sit inside `@media (prefers-reduced-motion: no-preference)`
16. The rules of `ui/ui.css` that style a state (`aria-selected`, `aria-checked`, `data-state`, `data-highlighted`) SHALL each carry a mark other than colour, and the file SHALL pass the colour lint, the 12px floor and the 13px prose rule

**Independent test:** `npm run test -w apps/command-centre -- src/ui` e a galeria mostram as seis peças.

### S2: Camadas, teclado e a sonda honesta (P1)

O Radix instala os seus ouvintes; a lista e a sonda do `comandos-atalhos` dizem isso em vez de escondê-lo.

**Acceptance Criteria**

17. WHILE a `Modal` is open the commands of the scopes under `modal` SHALL NOT fire, and the dialog's own `modal` commands SHALL
18. The page SHALL carry exactly one registry listener, every other `keydown` listener a file of `src` adds SHALL be in `OUTSIDE_THE_REGISTRY`, and every one a dependency adds SHALL be in `OUTSIDE_THE_REGISTRY_DEPS` with its count and reason
19. IF code in `node_modules/@radix-ui/<package>` adds a `keydown` listener to the page THEN the runtime probe SHALL attribute it to that package, and a package absent from `OUTSIDE_THE_REGISTRY_DEPS` SHALL fail the probe

**Independent test:** abrir um diálogo na sonda mostra o ouvinte de Esc do Radix na lista de dependências.

### S3: Os widgets feitos à mão passam para as primitivas (P1)

O inventário de `design.md` é uma lista fechada: o que migra e o que fica, com o motivo.

**Acceptance Criteria**

20. The 10 `Modal` uses (shortcuts help, confirmation, skill matrix, export, marketplace, new skill, the two Routines dialogs, the Skills scene sheet and the gallery's), the command palette, the provider gate and the skill deck SHALL render through `ui/Modal` or `ui/DialogSurface`, and the document drawer SHALL stay on `useDrawer` and keep its Escape, its focus and the `inert` path up to the root (door 9)
21. The bell, the model+effort popover of the deck, the model and conversations popovers of the console and the brain menu SHALL render through `ui/Popover`
22. The Settings navigation, the Runs scene tabs and the Skill detail panes SHALL render through `ui/Tabs`, and the Settings panel SHALL keep the id `settings-tabs-panel-<tab>`
23. The brain menu's local-graph toggle and the edge-kind chips of both brain panels SHALL render through `ui/Switch`
24. The "+" menu of the Skills scene SHALL render through `ui/DropdownMenu`
25. WHERE a control has only an icon and its `aria-label` equals its `title`, the hint SHALL be a `ui/Tooltip` and the `title` attribute SHALL be absent; the `title` that stay SHALL be a closed, reasoned list
26. IF a hand-made `role="dialog"`, `role="tablist"`, `role="menu"` or `role="switch"` remains in `src` outside `src/ui/` THEN it SHALL be on the closed list of design.md with its reason
27. WHILE the Núcleo is active the primitives SHALL be drawn by the same rules as in the frame: no rule outside `ui/ui.css` SHALL give a primitive's part its own background, border, shadow, blur, clip or animation, and the dialog SHALL keep the radius of its shell (26px in the Núcleo, 8px in the frame)

**Independent test:** a leitura da fonte reprova um `role="dialog"` novo fora de `src/ui`.

### S4: Verificação visual e peso (P2)

**Acceptance Criteria**

28. The gallery SHALL show the six primitives bare and inside both shells, in both themes, with the Linux baselines regenerated and each image looked at
29. WHEN each primitive is open in the gallery, in both layers and both themes, and WHEN the palette is open in each shell, axe (WCAG 2 A and AA) SHALL report no `serious` nor `critical` violation
30. WHEN Escape is pressed in a browser, in the frame and in the Núcleo, the palette SHALL close and focus SHALL return to the opener; WHILE a dialog is open Tab SHALL stay inside it, and WHERE reduced motion is preferred the dialog SHALL have no animation
31. The build SHALL record the weight of `dist` (JS and CSS, raw and gzip) before and after, and a guard SHALL fail when the JS gzip exceeds the recorded `after` by more than 5%
32. The typecheck, the lint (ESLint and stylelint), the interface suite and the root suite SHALL pass, and the e2e specs of the migrated screens SHALL show no failure that the base does not show

**Independent test:** `npm run build` e `node scripts/bundle-size.mjs --check`.

### S5: Rodada 1 da verificação (P1)

O verificador independente achou o que o construtor não viu: duas camadas respondendo a um mesmo Esc, três popovers sem prova, e algumas provas que não podiam falhar. As regras abaixo fecham o que mudou de comportamento; o que foi só prova mais forte está nas emendas de `checks.md`.

**Acceptance Criteria**

33. WHEN a Radix layer (a popover, a hint or a menu) is above a panel kept by `useDrawer` and Escape is pressed THEN only that layer SHALL close; the panel SHALL close on the next Escape, and an Escape already marked handled SHALL NOT close any of the three drawers
34. WHILE a hint, a popover or a menu is up, the Escape that a scene of the Núcleo listens for in the window capture SHALL reach that layer first (`floatingLayerOpen()`), and one Escape SHALL close one thing, in the frame and in the Núcleo
35. WHILE a menu is open the registry SHALL hold an `overlay` layer: no command of the screen behind it (a letter, `Mod+K`) SHALL run, and the keys SHALL answer again when it closes
36. WHEN a dialog opened from an item of a menu, or from a control inside a popover, closes and the opener is gone, focus SHALL go to the control the menu or the popover hung from
37. WHERE a Tooltip's label is the accessible name of its control, the control SHALL NOT point `aria-describedby` at the hint (it would be said twice)
38. The weight guard SHALL run in CI, read a versioned baseline in which every entry says why, and hold the tolerance at 5% by a test that fails a build above it

**Independent test:** `npm run test -w apps/command-centre -- src/ui/drawer.test.tsx` e `MORDOMO_E2E_PORT=4888 npx playwright test --config <temporária> tests/e2e/primitives.spec.ts`.

## Out of scope

| Excluded                                                                  | Why                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Select e Checkbox sobre Radix                                             | os ~55 `<select>` e as ~25 caixas de marcar são controles nativos de formulário (teclado, leitor de tela e seletor do celular de graça); não há widget feito à mão equivalente                                                                                                       |
| Toast sobre Radix                                                         | `ToastProvider` (`components/ui.tsx`) é pequeno, tem região viva certa e fica fora do `inert` de propósito; o Radix Toast instala um ouvinte de F8 no documento (um segundo gerenciador de teclas)                                                                                   |
| `AlertDialog`, `ContextMenu`, `RadioGroup`, `ToggleGroup`, `Combobox`     | fora das seis do roteiro; a confirmação continua `role="dialog"` (os e2e e o registro leem esse papel); o produto não tem menu de contexto; `Segmented` e as listas do console, da paleta e da busca já têm o teclado delas                                                          |
| Trocar as caixas de marcar de ligar/desligar por `Switch` nos dois shells | muda o papel (`checkbox` para `switch`) de dezenas de testes e e2e; decisão do dono (ver Perguntas ao dono)                                                                                                                                                                          |
| A barra lateral estreita, a gaveta da conversa e a gaveta do documento    | os dois primeiros são o mesmo nó (gaveta modal só em janela estreita e coluna no resto, e a conversa é ao vivo: o Radix monta e desmonta a camada com o conteúdo); a do documento, um modal que fica no lugar esconde `#modal-root` do leitor de tela (door 9); ficam em `useDrawer` |
| O tour (`Onboarding`) e o modo foco (`FocusMode`)                         | camadas com dono próprio do teclado (design do `comandos-atalhos`: ficam)                                                                                                                                                                                                            |
| Mudar a forma de `.btn`, campos e `Segmented` dentro das folhas           | a pele de controles do Núcleo (`luz.css`, botões em pílula) não é uma das seis primitivas                                                                                                                                                                                            |
| Remover CSS morto e `desktop.css`                                         | feature 12 (`limpeza-legado`)                                                                                                                                                                                                                                                        |
| Capturas de macOS da galeria                                              | o CI roda Linux; este ambiente não gera capturas de Mac                                                                                                                                                                                                                              |

## Assumptions

| Assumption                                              | Chosen default                                                                                                                                                       | Rationale                                                                                                                                           | Confirmed? |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Linha do Radix a fixar                                  | a de 24/07/2026 (dialog 1.1.23, popover 1.1.23, tabs 1.1.21, switch 1.3.7, dropdown-menu 2.1.24, tooltip 1.2.16)                                                     | a 1.2/1.3 saiu há cinco dias; dois meses sem defeito achado é o critério de idade que o projeto usa para pacotes de terceiros                       | n          |
| Linguagem única = mesmas regras, material por token     | o Núcleo mantém o vidro e o raio de 26px na folha (como o check C10 do `design-system`), declarados por token; a moldura, a folha opaca de 8px                       | trocar o material mudaria um check aprovado (C10) e o desenho do Núcleo; o que se unifica é a estrutura, o teclado, o movimento e a folha de estilo | n          |
| Popovers do console deixam de prender o foco e a página | não modais: clique fora e Esc fecham, a página atrás fica viva (o menu "+" também, door 9)                                                                           | declaravam `aria-modal="false"` e eram modais por acidente do gancho; Esc e o foco de volta à âncora continuam                                      | n          |
| Dica fecha o primeiro Esc enquanto aberta               | o Radix a trata como a camada de cima e consome a tecla; o atraso de 400 ms limita quando isso acontece                                                              | é o contrato de dispensa da WCAG 1.4.13; trocar exige um segundo gerenciador de Esc                                                                 | n          |
| `title` que ficam                                       | os que carregam dado (caminho, texto cortado, resumo), os dois da barra lateral que o design da moldura nomeia, e os cartões do deck que o e2e seleciona por `title` | a dica substitui um nome repetido em controle de ícone, não um dado                                                                                 | n          |
| Orçamento de peso                                       | JS gzip até 5% acima do medido depois da feature                                                                                                                     | um guarda sem folga falha por ruído de build; sem guarda o peso volta a crescer sem ninguém ver                                                     | n          |

**Open questions:** none - all resolved or logged above; as escolhas de produto estão em "Perguntas ao dono" de `STATE.md` com o padrão adotado.

## Observable

| Surface                                        | Decision                                           | Landing                                                                                            |
| ---------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| screen Modal (todas as janelas e confirmações) | empty state                                        | n/a - o diálogo mostra o conteúdo que a view lhe dá; cada view já decide o seu vazio               |
| screen Modal                                   | loading and error states                           | existing - o conteúdo é da view (Skeleton, ErrorBox, aviso); a primitiva não carrega dados         |
| screen Modal                                   | destructive action confirms                        | existing - `useConfirm` abre `ConfirmDialog`, com foco inicial em Cancelar quando `danger`         |
| screen Modal                                   | unauthorised                                       | n/a - a primitiva não decide acesso                                                                |
| screen Modal e Popover                         | focus, Escape, restore                             | AC 4-7, 10                                                                                         |
| screen Modal                                   | inert behind and layering                          | AC 8, 17                                                                                           |
| screen Popover (sino, modelo, conversas, menu) | empty state                                        | existing - o conteúdo é do widget (a caixa de entrada e a lista de conversas já têm o vazio delas) |
| screen Popover                                 | position and flip near the edge                    | existing - o Radix Popper coloca e inverte; a largura fica por widget                              |
| screen Tabs (Configurações, Execuções, Skill)  | keyboard and ids                                   | AC 11, 22                                                                                          |
| screen Tabs                                    | empty / loading / error                            | n/a - o painel é da view                                                                           |
| screen Switch                                  | state without colour alone                         | AC 12, 16                                                                                          |
| screen DropdownMenu                            | keyboard and close                                 | AC 13, 24                                                                                          |
| screen Tooltip                                 | keyboard, touch and dismissal                      | AC 14, 25 (o toque não tem passador: o nome do controle continua no `aria-label`)                  |
| screen Galeria                                 | coverage and baselines                             | AC 28                                                                                              |
| screen (todas, nos dois shells)                | motion preference                                  | AC 15, 30                                                                                          |
| screen (todas, nos dois shells)                | accessibility                                      | AC 29                                                                                              |
| screen (todas, nos dois shells)                | text floor and colours                             | AC 16 (as regras do `design-system` valem para a folha nova)                                       |
| all new `src/ui` components                    | concurrency (dois diálogos, popover sobre diálogo) | AC 7, 8                                                                                            |
| build                                          | weight                                             | AC 31                                                                                              |

## Sources

- `.specs/features/design-system/design.md` - **binding**: piso de 12px, texto corrido a 13px, cor só por token, estado nunca só por cor, axe, galeria de duas camadas
- `.specs/features/comandos-atalhos/design.md` - **binding**: um só ouvinte de teclado, escada de camadas (`modal`, `overlay`), allowlist de ouvintes; o que fica fora do registro
- `.specs/features/moldura-app/design.md` - **binding**: o sino, a gaveta do documento e a da conversa são diálogos (o foco entra, o resto fica inerte, o foco volta a quem abriu), Esc fecha o de cima, a dica (`title`) da barra lateral
- `.specs/roadmap.md` item 10b e `docs/architecture.md` - o escopo (Dialog, Popover, Tabs, Switch, Menu, Tooltip)
