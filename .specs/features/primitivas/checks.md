# Primitivas checks

Profile: ui
Plan: `.specs/features/primitivas/plan.md`

32 checks in 4 slices · 9 one-way doors · 0 open, of which 0 block

Comandos (da raiz): interface `npm run test -w apps/command-centre -- <arquivo> -t "<nome>"`; raiz
`npx vitest run tests/ui-deps.test.ts -t "<nome>"`; lint `npm run lint`; e2e
`MORDOMO_E2E_PORT=4888 npx playwright test --config <configuração temporária> <spec> -g "<nome>"`. A configuração
temporária do e2e (não comitada) aumenta o teste para 90 s e o `expect` para 20 s, porque o ambiente
compartilhado fica com carga alta (a regra de C32 e a base conhecida estão em C32).

Fora do alcance destes checks, por tela: o conteúdo de cada diálogo, popover e aba (é da view); o
espaçamento fino e a hierarquia de peso acima do piso; a composição de cada tela não muda. As peças
são provadas na galeria (cada uma nos dois shells e nos dois temas) e nos widgets que as usam; cada
uma das 18 telas e janelas com diálogo (Rotinas, Skills, Cérebro, Execuções, Configurações, paleta,
deck, gate, gaveta, sino, console) é nomeada no inventário de `design.md` e provada pelo teste da
migração dela (C20-C25), não por captura de pixel.

## Checks

### S1 - as seis primitivas, sobre Radix · 14 files · 150 KB · ~30k

**C1** - `apps/command-centre/package.json` ganha exatamente seis `dependencies` em relação a `chore/tlc-spec-lean-skill` (`9c82fc1`): `@radix-ui/react-dialog` `1.1.23`, `@radix-ui/react-dropdown-menu` `2.1.24`, `@radix-ui/react-popover` `1.1.23`, `@radix-ui/react-switch` `1.3.7`, `@radix-ui/react-tabs` `1.1.21`, `@radix-ui/react-tooltip` `1.2.16`, cada uma sem `^`, `~` nem faixa, e nenhuma outra dependência, direta ou de desenvolvimento, aparece ou muda (AC 1)
Proof: `npx vitest run tests/ui-deps.test.ts -t "C1 the six primitives are pinned"`
Status: closed

**C2** - O `package-lock.json` tem as seis com `resolved` e `integrity`, todo pacote que elas trazem e que o lock não tinha na base tem licença `MIT`, `ISC`, `0BSD` ou `BSD-3-Clause` (a lista, para o NOTICE da feature 14, é impressa pelo teste), e `npm ci --dry-run` sai `0` (AC 2)
Proof: `npx vitest run tests/ui-deps.test.ts -t "C2 the lockfile and the licences"`
Proof: `npm ci --dry-run`
Status: closed

**C3** - `src/ui/index.ts` exporta exatamente `Modal`, `DialogSurface`, `Popover`, `Tabs`, `Switch`, `DropdownMenu`, `Tooltip`, `UiProvider`, `getDialogDepth`, `subscribeDialogDepth`, `useDialogDepth`, `useDrawer` e `focusables`; nenhum arquivo de `src` fora de `src/ui/` importa `@radix-ui/*`; `components/ui.tsx` não exporta `Modal`, `components/primitives.tsx` não exporta `Popover` nem `Tabs` e `components/dialog.tsx` não existe (lido pela árvore sintática, com autoteste de cada forma de importação: `import`, `export … from`, `import()`, `require`) (AC 3)
Proof: `npm run test -w apps/command-centre -- src/ui/ui.source.test.ts -t "C3"`
Status: closed

**C4** - Um `Modal` aberto fica em `#modal-root`, é `role="dialog"` com `aria-modal="true"` e `aria-label` igual ao título, tem `tabIndex=-1`, e o foco aterrissa no `initialFocus()` quando existe, senão no primeiro campo (`input`, `select` ou `textarea`), senão no primeiro foco que não é `[data-dialog-close]`, senão na própria folha (quatro casos) (AC 4)
Proof: `npm run test -w apps/command-centre -- src/ui/dialog.test.tsx -t "C4"`
Status: closed

**C5** - Ao fechar o `Modal` (Esc, botão, fundo ou `open={false}`), o foco volta ao elemento que o tinha na abertura, e não há gatilho Radix: quatro formas de fechar, cada uma devolve o foco ao botão que abriu (AC 5)
Proof: `npm run test -w apps/command-centre -- src/ui/dialog.test.tsx -t "C5"`
Status: closed

**C6** - Com o `Modal` aberto, Tab no último foco vai ao primeiro, Shift+Tab no primeiro vai ao último, e com o foco fora (no `body`) Tab entra no primeiro (AC 6)
Proof: `npm run test -w apps/command-centre -- src/ui/dialog.test.tsx -t "C6"`
Status: closed

**C7** - Com dois `Modal` empilhados, um Escape fecha só o de cima e chama o `onClose` dele uma vez; um segundo Escape fecha o de baixo; e um comando do registro com a tecla `Escape` nos escopos `global`, `nucleo`, `moldura` e `modal` não roda em nenhum dos dois (AC 7)
Proof: `npm run test -w apps/command-centre -- src/ui/dialog.test.tsx -t "C7"`
Status: closed

**C8** - Com o `Modal` aberto, todo filho de `#root` e todo outro filho de `#modal-root` tem o atributo `inert`, exceto o `.toast-wrap` (que continua clicável), `getDialogDepth()` vale `1` (`2` com dois) e `useDialogDepth()` conta só os que saíram de `#root`; ao fechar, nenhum `inert` resta e a profundidade volta a `0` (AC 8)
Proof: `npm run test -w apps/command-centre -- src/ui/dialog.test.tsx -t "C8"`
Status: closed

**C9** - Um `pointerdown` no fundo fecha o `Modal` e um dentro da folha não; o `onClose` roda 160 ms depois do pedido (com relógio falso, nem 159 nem 161) e, com `prefers-reduced-motion: reduce`, na hora (AC 9)
Proof: `npm run test -w apps/command-centre -- src/ui/dialog.test.tsx -t "C9"`
Status: closed

**C10** - Um `Popover` aberto é `role="dialog"` com `aria-modal="false"`, não deixa nada `inert`, não conta em `getDialogDepth()` (vale `0`), Esc o fecha e o foco volta à âncora, e um `pointerdown` fora o fecha e deixa o foco no elemento pressionado (AC 10)
Proof: `npm run test -w apps/command-centre -- src/ui/popover.test.tsx -t "C10"`
Status: closed

**C11** - `Tabs` com `id="x"` e as abas `a`, `b`, `c`: `role="tablist"`; cada `role="tab"` com `id="x-tab-<aba>"`, `aria-selected` verdadeiro só na ativa, `aria-controls="x-panel-<aba>"` e `tabIndex` `0` só na ativa; o painel é um só `role="tabpanel"` com `id="x-panel-<ativa>"` e `aria-labelledby="x-tab-<ativa>"`; ArrowRight/ArrowLeft (ArrowDown/ArrowUp quando vertical), Home e End movem a seleção e o foco, com volta nas pontas (AC 11)
Proof: `npm run test -w apps/command-centre -- src/ui/tabs.test.tsx -t "C11"`
Status: closed

**C12** - `Switch` é `role="switch"` com `aria-checked` `"false"` e `"true"`; Espaço e clique chamam `onCheckedChange` com o valor trocado; `disabled` não chama (AC 12)
Proof: `npm run test -w apps/command-centre -- src/ui/switch.test.tsx -t "C12"`
Status: closed

**C13** - `DropdownMenu` com três itens: o gatilho tem `aria-haspopup="menu"`; ao abrir, `role="menu"` com três `role="menuitem"` e o foco no primeiro; ArrowDown/ArrowUp andam com volta, Home e End vão às pontas, a letra inicial de um item foca esse item; Enter e Espaço executam o item e fecham; Esc fecha e o foco volta ao gatilho; o menu é nomeado pelo gatilho (`aria-labelledby`), não é modal (a página atrás não tem `aria-hidden`, um clique fora fecha e o Tab não sai dele) e as setas têm volta (AC 13, door 9)
Proof: `npm run test -w apps/command-centre -- src/ui/menu.test.tsx -t "C13"`
Status: closed

**C14** - `Tooltip` sobre um botão com `aria-label`: com o foco do teclado aparece um `role="tooltip"` com o texto e o botão ganha `aria-describedby` para ele; com o ponteiro parado ele aparece aos 400 ms (nem 399); Esc o remove e o foco fica no botão; sem foco nem ponteiro não há tooltip e o botão não tem `title` (AC 14)
Proof: `npm run test -w apps/command-centre -- src/ui/tooltip.test.tsx -t "C14"`
Status: closed

**C15** - Em `src/ui/ui.css` (lido como árvore) toda declaração `animation` e `animation-name` está dentro de `@media (prefers-reduced-motion: no-preference)`, e nenhuma regra fora do bloco `reduce` define `animation` para uma peça (o teste se prova contra uma folha que tem `animation` fora do bloco); com `prefers-reduced-motion: reduce` um `Modal` fechado some sem esperar animação (AC 15)
Proof: `npm run test -w apps/command-centre -- src/ui/ui.source.test.ts -t "C15"`
Status: closed

**C16** - As regras de `ui.css` que estilizam estado (`[aria-selected]`, `[aria-checked]`, `[data-state]`, `[data-highlighted]`) entram no leitor de estados e cada grupo tem marca que não é cor (sublinhado da aba, botão que anda no interruptor, barra do item de menu), nenhuma entrada nova em `MARKED_ELSEWHERE` além das enumeradas com motivo; a folha passa no stylelint de cor, no piso de 12px e no texto corrido a 13px (AC 16)
Proof: `npm run test -w apps/command-centre -- src/states.test.ts -t "C16 a state is never told by colour alone"`
Proof: `npm run test -w apps/command-centre -- src/ui/ui.source.test.ts -t "C16"`
Proof: `npm run test -w apps/command-centre -- src/typography.test.ts`
Proof: `npm run lint:css`
Status: closed

### S2 - camadas, teclado e a sonda honesta · 5 files · 50 KB · ~12k

**C17** - Com um `Modal` aberto no Núcleo, um comando do escopo `nucleo` com a tecla `p` não roda e o `Mod+J` do escopo `modal` (o `deck.close`) roda; fechado o `Modal`, o `p` volta a rodar; com um `Popover` aberto o `p` continua rodando (a página atrás está viva) (AC 17)
Proof: `npm run test -w apps/command-centre -- src/ui/layers.test.tsx -t "C17"`
Status: closed

**C18** - Com os dois shells montados em cada rota e com os diálogos abertos, a página tem exatamente um ouvinte de `keydown` do registro; os de arquivos de `src` são os de `OUTSIDE_THE_REGISTRY` (a entrada `components/dialog.tsx` vira `ui/layers.ts` com um ouvinte, a de `components/primitives.tsx` sai) e os de pacotes são os de `OUTSIDE_THE_REGISTRY_DEPS`, com a contagem e o motivo de cada um; nenhum `on…` da página foi posto (AC 18)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.probe.test.tsx -t "C18"`
Proof: `npm run test -w apps/command-centre -- src/commands/commands.source.test.ts -t "C18"`
Status: closed

**C19** - A sonda atribui a um pacote o ouvinte posto por código de `node_modules/@radix-ui/<pacote>` (e não ao React DOM), abrir um `Modal` mostra o ouvinte de `@radix-ui/react-dismissable-layer` na contagem, um ouvinte posto por um pacote que a lista não tem reprova a sonda, e o autoteste mostra os dois lados (AC 19)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.probe.test.tsx -t "C19"`
Status: closed

### S3 - os widgets feitos à mão passam para as primitivas · 70 files · 540 KB (lido em trechos) · ~135k

**C20** - Cada diálogo do inventário usa a folha das primitivas e se comporta como antes: a paleta (foco no campo, Esc fecha e devolve o foco, ⌘K fecha pelo escopo `modal`, fecha na hora com `instant`), `ProviderGate` (segue montado e fechado; "Pular" fecha), o deck (⌘J fecha, foco na busca), a gaveta de documento, que fica em `useDrawer` (door 9: Esc fecha, o foco volta, o `inert` abre o caminho até a raiz), a confirmação (foco em Cancelar quando `danger`, em Confirmar senão), a ajuda de atalhos e cada um dos 10 usos de `Modal` por arquivo (AC 20)
Proof: `npm run test -w apps/command-centre -- src/ui/migration.test.tsx -t "C20"`
Proof: `npm run test -w apps/command-centre -- src/desktop/SkillDeck.test.tsx src/moldura/moldura.test.tsx src/commands/commands.test.tsx`
Status: closed

**C21** - O sino (Esc fecha e o foco volta ao sino; clique fora fecha; o `moldura.bell.close` do registro não existe mais), o popover de modelo+esforço do deck, o de modelo e o de conversas do console (abrem ancorados ao botão, Esc devolve o foco, a página atrás continua sem `inert`) e o menu "⋯" do Cérebro (mantém `bs-menu`) usam `Popover` (AC 21)
Proof: `npm run test -w apps/command-centre -- src/ui/migration.test.tsx -t "C21"`
Status: closed

**C22** - A navegação das Configurações é `Tabs` vertical (uma parada de Tab, ArrowDown muda de aba, painel `#settings-tabs-panel-<aba>` com `aria-labelledby` `settings-tabs-tab-<aba>`), a barra de Execuções do Núcleo é `Tabs` `pill` (painel `#rs-run-panel`) e as panes do detalhe da skill são `Tabs` `line` (painel `skill-panes-panel-<pane>`) (AC 22)
Proof: `npm run test -w apps/command-centre -- src/ui/migration.test.tsx -t "C22"`
Status: closed

**C23** - O interruptor de grafo local do menu do Cérebro e as fichas de aresta (menu do Núcleo e painel do Cérebro) são `role="switch"` das primitivas com `aria-checked` que acompanha o estado e a ficha continua mostrando o texto e a contagem (AC 23)
Proof: `npm run test -w apps/command-centre -- src/ui/migration.test.tsx -t "C23"`
Status: closed

**C24** - O menu "+" da cena de Skills é um `DropdownMenu`: mantém `data-testid="skills-more"`, três itens (mercado, exportar, nova) que chamam cada um o seu callback uma vez, e fecha ao escolher (AC 24)
Proof: `npm run test -w apps/command-centre -- src/ui/migration.test.tsx -t "C24"`
Status: closed

**C25** - Em `src` nenhum botão, `Button` ou `Link` tem `aria-label` e `title` com o mesmo texto, os 74 sítios `Tooltip` (em 38 arquivos, mais o `tip` do menu) são `Tooltip` com o `aria-label` mantido, e os `title` restantes de controle estão na lista fechada do teste, com o motivo de cada um (lido pela árvore sintática do TypeScript, com autoteste de cada forma: texto literal, template, expressão, `Button`, `Link`, `a`) (AC 25)
Proof: `npm run test -w apps/command-centre -- src/ui/ui.source.test.ts -t "C25"`
Status: closed

**C26** - Em `src` fora de `src/ui/`, todo `role="dialog"`, `role="tablist"`, `role="menu"` e `role="switch"` (atributo JSX com literal, objeto de props ou `setAttribute`) está em uma lista fechada de arquivos com o motivo de cada um (gaveta da conversa, gaveta do documento, tour, modo foco, folha estática da galeria, a tira de fichas do Pixel…) e cada entrada da lista ainda é usada; os importadores de `useDrawer` são exatamente `moldura/Sidebar.tsx`, `moldura/Moldura.tsx` e `moldura/DocDrawer.tsx` (AC 26, door 9)
Proof: `npm run test -w apps/command-centre -- src/ui/ui.source.test.ts -t "C26"`
Status: closed

**C27** - Lendo todo CSS de `src` como árvore, nenhuma regra fora de `ui/ui.css` tem como sujeito `.modal`, `.modal-backdrop`, `.launcher`, `.launcher-panel`, `.popover`, `.tabs`, `.ui-*` e declara `background`, `border`, `box-shadow`, `backdrop-filter`, `clip-path` ou `animation` (modificadores de tamanho e posição ficam: `.modal.narrow`, `.modal.sks-sheet`); `luz.css` não reescreve `.modal` nem `.modal-backdrop`; os oito tokens `--ui-*` do material estão declarados em `:root`, em `[data-shell="moldura"]`, em `html:has(.nu-shell)` e em `.nu-shell`; e no navegador a folha do diálogo mede `26px` de raio na camada do Núcleo da galeria e `8px` na da moldura (AC 27)
Proof: `npm run test -w apps/command-centre -- src/ui/ui.source.test.ts -t "C27"`
Proof: `MORDOMO_E2E_PORT=4888 npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/gallery.spec.ts -g "C10 the gallery shows both layers"`
Status: closed

### S4 - verificação visual e peso · 8 files · 100 KB · ~25k

**C28** - A galeria tem `#story-primitives` (as seis peças nuas) e as camadas `#story-nucleo-layer` e `#story-frame-layer` passam a incluir um interruptor, uma aba, um menu aberto e uma dica aberta; as capturas de Linux de todas as seções são regeradas e conferidas, nos dois temas (AC 28)
Proof: `MORDOMO_E2E_PORT=4888 npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/gallery.spec.ts`
Status: closed

**C29** - axe (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`) sem violação `serious` ou `critical` com cada peça aberta na galeria, nas duas camadas e nos dois temas, e com a paleta aberta no Núcleo e na moldura (AC 29)
Proof: `MORDOMO_E2E_PORT=4888 npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/a11y.spec.ts -g "C29"`
Status: closed

**C30** - No navegador, na moldura e no Núcleo: Esc fecha a paleta e o foco volta a quem a abriu, Tab dá a volta dentro de um diálogo, o `animationName` computado da folha é `none` com `reducedMotion: "reduce"` e diferente de `none` sem ele, e a dica de um botão da barra aparece com o foco do teclado (AC 30)
Proof: `MORDOMO_E2E_PORT=4888 npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/primitives.spec.ts`
Status: closed

**C31** - `scripts/bundle-size.mjs` mede `apps/command-centre/dist` (JS e CSS, bruto e gzip) e sai `1` quando o JS gzip passa de 5% sobre o valor medido depois da feature (gravado no próprio script); a medição antes (`9c82fc1`) e depois está gravada no script: JS 1 445 758 B bruto e 470 410 B gzip antes, 1 552 075 e 503 649 depois (mais 7,1% gzip, o custo do Radix e das dicas); CSS 337 189 e 70 728 antes, 340 497 e 71 459 depois (AC 31)
Proof: `node scripts/bundle-size.mjs --check`
Status: closed

**C32** - `npm run typecheck && npm run lint && npm run test -w apps/command-centre && npm test` saem `0`, e as specs e2e das telas migradas (a11y, galeria, contrastes, moldura, nucleo-shell, console-context, desktop-execution, desktop-parity, concept, onboarding, rework, brain-context, smoke) não mostram falha que a base (`9c82fc1`) não mostre, rodadas com a configuração temporária de timeouts alongados; a base conhecida falha igual: `brain-context.spec.ts:27` e `:61`, `moldura.spec.ts` C20 e C57, `nucleo-shell.spec.ts:165`, `:467` e `:1048`, `onboarding.spec.ts:7` e `:33`, `rework.spec.ts:49` e `desktop-parity.spec.ts:22` (AC 32)
Proof: `npm run typecheck && npm run lint && npm run test -w apps/command-centre && npm test`
Proof: `MORDOMO_E2E_PORT=4888 npx playwright test --config <temporária, timeout 90s e expect 20s> tests/e2e/a11y.spec.ts tests/e2e/gallery.spec.ts tests/e2e/gallery-contrast.spec.ts tests/e2e/surface-contrast.spec.ts tests/e2e/moldura.spec.ts tests/e2e/nucleo-shell.spec.ts tests/e2e/console-context.spec.ts tests/e2e/desktop-execution.spec.ts tests/e2e/desktop-parity.spec.ts tests/e2e/concept.spec.ts tests/e2e/onboarding.spec.ts tests/e2e/rework.spec.ts tests/e2e/brain-context.spec.ts tests/e2e/smoke.spec.ts tests/e2e/primitives.spec.ts`
Status: closed

Resultado de C32, medido na construção, com a configuração temporária (teste 90 s, `expect` 20 s, porta 4888): `typecheck`, `lint` (ESLint e stylelint), a suíte da interface (906 testes) e a da raiz (996 testes) saem `0`, e `npm ci --dry-run` sai `0`. Nos e2e das telas migradas (15 specs, 187 casos) 172 passam e 15 falham: onze são a base conhecida; três (`concept.spec.ts:393`, `console-context.spec.ts:13`, `desktop-execution.spec.ts:115`) a lista da base não trazia e **falham igual em `9c82fc1`** (medido numa cópia da base construída à parte); e `concept.spec.ts:729` (o diálogo fecha com Esc e com o véu) falhou uma vez sob carga e passa sozinho. Em uma segunda rodada de 11 specs que tocam as peças (surface-contrast, closeout-recovery, desktop-intel, desktop-reflow, flows, product-workflows, provider-gate, provider-readiness, setup-wizard, desktop-regressions, desktop-context) 47 passam e 2 falham, `desktop-regressions.spec.ts:63` e `provider-readiness.spec.ts:4`, que também **falham igual na base**. A lista da base na redação de C32 estava incompleta; a redação não foi reescrita e estas entradas estão aqui.

## Coverage

| Set (size)                                                | Member -> proof                                                                                                                                                                                                                                                                                                                                 | Unproven |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| pacotes `@radix-ui` fixados (6)                           | dialog C1, C2 · dropdown-menu C1, C2 · popover C1, C2 · switch C1, C2 · tabs C1, C2 · tooltip C1, C2                                                                                                                                                                                                                                            | -        |
| exportações de `src/ui/index.ts` (13)                     | `Modal` C3 · `DialogSurface` C3 · `Popover` C3 · `Tabs` C3 · `Switch` C3 · `DropdownMenu` C3 · `Tooltip` C3 · `UiProvider` C3 · `getDialogDepth` C3 · `subscribeDialogDepth` C3 · `useDialogDepth` C3 · `useDrawer` C3 · `focusables` C3                                                                                                        | -        |
| contrato do diálogo (14)                                  | portal em `#modal-root` C4 · `role="dialog"` C4 · `aria-modal="true"` C4 · nome C4 · foco inicial, quatro casos C4 · foco volta C5 · Tab C6 · Shift+Tab C6 · Esc só o de cima C7 · Esc não chega ao registro C7 · `inert` C8 · profundidade C8 · fundo fecha C9 · saída de 160 ms e movimento reduzido C9                                       | -        |
| formas de fechar o diálogo (4)                            | Esc C5, C7 · botão C5 · fundo C5, C9 · `open={false}` C5                                                                                                                                                                                                                                                                                        | -        |
| contrato do popover (5)                                   | `aria-modal="false"` C10 · sem `inert` C10 · fora da profundidade C10 · Esc devolve o foco C10 · clique fora não move o foco C10                                                                                                                                                                                                                | -        |
| teclas das abas (6)                                       | ArrowRight C11 · ArrowLeft C11 · ArrowDown na vertical C11 · ArrowUp na vertical C11 · Home C11 · End C11                                                                                                                                                                                                                                       | -        |
| teclas do menu (8)                                        | ArrowDown C13 · ArrowUp C13 · Home C13 · End C13 · letra C13 · Enter C13 · Espaço C13 · Esc C13                                                                                                                                                                                                                                                 | -        |
| contrato da dica (4)                                      | foco do teclado C14 · ponteiro aos 400 ms C14 · Esc C14 · sem `title` C14                                                                                                                                                                                                                                                                       | -        |
| widgets que migram (15)                                   | `Modal` e seus 10 usos C20 · paleta C20 · `ProviderGate` C20 · deck C20 · `Popover` e o menu do Cérebro C21 · sino C21 · modelo+esforço do deck C21 · modelo do console C21 · conversas do console C21 · Configurações C22 · Execuções do Núcleo C22 · panes da skill C22 · interruptores e fichas C23 · menu "+" C24 · dicas dos 74 sítios C25 | -        |
| os 10 usos de `Modal` (10)                                | `ShortcutsHelp` C20 · `ConfirmDialog` C20 · `SkillMatrixModal` C20 · `ExportModal` C20 · `MarketplaceModal` C20 · `NewSkillModal` C20 · `Routines` formulário C20 · `Routines` histórico C20 · folha de `SkillsScene` C20 · história da galeria C28 (a leitura da fonte, C3 e C26, fecha a lista: nenhum outro `Modal` existe)                  | -        |
| widgets que ficam, com motivo (8)                         | barra lateral estreita, gaveta da conversa e gaveta do documento C20, C26 · tour C26 · modo foco C26 · Toast C3 (continua em `components/ui.tsx`) · `<select>` e caixa de marcar nativos C26 · `Segmented` e listas C26 · botões `aria-pressed` C26 · `title` de dado C25                                                                       | -        |
| ouvintes de teclado na página (3 origens)                 | registro, um C18 · arquivos de `src`, a lista C18 · pacotes, a lista C18, C19                                                                                                                                                                                                                                                                   | -        |
| tokens do material do shell (8)                           | `--ui-sheet-r` C27 · `--ui-sheet-bg` C27 · `--ui-veil` C27 · `--ui-veil-blur` C27 · `--ui-pop-r` C27 · `--ui-pop-bg` C27 · `--ui-pop-blur` C27 · `--ui-pop-clip` C27                                                                                                                                                                            | -        |
| lugares do material (4 seletores)                         | `:root` C27 · `[data-shell="moldura"]` C27 · `html:has(.nu-shell)` C27 · `.nu-shell` C27                                                                                                                                                                                                                                                        | -        |
| partes de peça que o CSS fora de `ui.css` não desenha (7) | `.modal` C27 · `.modal-backdrop` C27 · `.launcher` C27 · `.launcher-panel` C27 · `.popover` C27 · `.tabs` C27 · `.ui-*` C27                                                                                                                                                                                                                     | -        |
| propriedades que só `ui.css` declara nessas partes (5)    | `background` C27 · `border` C27 · `box-shadow` C27 · `backdrop-filter` C27 · `clip-path` C27 · `animation` C27 e C15                                                                                                                                                                                                                            | -        |
| configuração de partida: `ui.css` carregado (2 montagens) | `main.tsx` C27 · `gallery/main.tsx` C27                                                                                                                                                                                                                                                                                                         | -        |
| configuração de partida: `#modal-root` (2 montagens)      | `index.html` C4 (o teste monta o seu) e C30 (o navegador) · `gallery.html` C28, C29                                                                                                                                                                                                                                                             | -        |
| configuração de partida: `UiProvider` (2 montagens)       | `main.tsx` C14, C30 · `gallery/main.tsx` C28 (o `Tooltip` monta o seu provedor quando não há um acima: C14)                                                                                                                                                                                                                                     | -        |
| estados com marca que não é cor (4)                       | aba selecionada C16 · interruptor ligado C16 · item de menu destacado C16 · diálogo `data-state` (só movimento) C15                                                                                                                                                                                                                             | -        |
| camadas na galeria (3)                                    | nua C28 · Núcleo C28, C29 · moldura C28, C29                                                                                                                                                                                                                                                                                                    | -        |
| temas (2)                                                 | escuro C28, C29 · claro C28, C29                                                                                                                                                                                                                                                                                                                | -        |
| shells no navegador (2)                                   | moldura C30 · Núcleo C30                                                                                                                                                                                                                                                                                                                        | -        |
| doors (9)                                                 | dependências C1, C2 · pasta e superfície C3 · camadas e teclado C4-C9, C17 · contrato de estilo C15, C16, C27 · ouvintes de dependência C18, C19 · dica no lugar do `title` C14, C25 · tokens acrescentados C27 · nomes das dependências C18, C19 · gaveta do documento em `useDrawer` e menu não modal C13, C20, C26                           | -        |
| rotas da Surface (0)                                      | nenhuma (a Surface é `None`)                                                                                                                                                                                                                                                                                                                    | -        |

- Claims naming a status code, route or response shape: nenhum (não há rota nova); os que nomeiam a tela (C28-C30) têm prova no navegador
- No other check claims more than the single case its proof exercises

## Binding sources

| Source                                           | Rules                                                                                                        | Checks             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------ |
| `.specs/features/primitivas/design.md`           | pasta, inventário (migra / fica), contrato de cada peça, camadas, material do shell                          | C1-C32             |
| `.specs/features/design-system/design.md`        | piso de 12px, texto corrido a 13px, cor só por token, estado nunca só por cor, axe, galeria de duas camadas  | C16, C27, C28, C29 |
| `.specs/features/comandos-atalhos/design.md`     | um só ouvinte, escopos `modal`/`overlay`, o que fica fora do registro                                        | C7, C17, C18, C19  |
| `.specs/features/moldura-app/design.md` (Tela 1) | sino, gaveta de documento e de conversa são diálogos, Esc fecha o de cima, a dica (`title`) da barra lateral | C5, C20, C21, C25  |

## Test policy

| Code                                                                | Required proofs                                                | Coverage expectation                                                                       |
| ------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Decides: a pilha de camadas, o foco inicial, a restauração, a saída | one at its own layer (render com jsdom) and one in the browser | one asserted case per row of the contract (quatro focos iniciais, quatro formas de fechar) |
| Instrumentation: os envoltórios finos sobre o Radix                 | one at its own layer                                           | o contrato que o app exige, não o que o Radix já prova                                     |
| Configuration: `ui.css`, `package.json`, a lista de ouvintes        | a source check that reads the tree                             | each form (propriedade, seletor, pacote)                                                   |
| Migration: cada widget que passou                                   | the widget's behaviour, proven through the primitive           | each widget of the inventory                                                               |

Evidence:

- `ui/layers.ts`: empilha, registra `inert` por nível, conta profundidade, escolhe o de cima, cinco ramos -> decides
- `ui/Dialog.tsx`: foco inicial em quatro ramos, restauração, três saídas -> decides
- `ui/Tabs.tsx`, `ui/Switch.tsx`, `ui/Menu.tsx`, `ui/Tooltip.tsx`: repassam props ao Radix e fixam ids/classes -> instrumentation
- closest analogue in the repo: `src/commands/commands.probe.test.tsx` (tabela de estados × contagem) e `src/moldura/moldura.test.tsx` (`inert` e foco das gavetas)

Cost: 7 arquivos novos de teste na interface (≈110 casos), 1 na raiz, 1 spec e2e nova e 3 estendidas (a galeria, o `a11y` e o `gallery-contrast` já lê a galeria inteira), 1 script de peso.
Sem estas linhas, o contrato de foco e de Esc só seria provado pelo caminho que os e2e atravessam.

## Swept

- validation: C4 (quatro focos iniciais), C11 (id base sem aba, aba desconhecida), C12 (`disabled`)
- failure modes: C5 (foco volta mesmo sem gatilho e quando o opener sumiu), C9 (saída sem animação), C19 (pacote fora da lista reprova)
- idempotency: C7 (Esc duas vezes fecha cada camada uma vez), C13 (escolher um item chama o callback uma vez)
- authorization: n/a - as primitivas não decidem acesso e a feature não toca a API
- concurrency: C7 (dois diálogos), C8 (profundidade com dois), C17 (diálogo + popover + escopos do registro)
- data lifecycle: n/a - nada é gravado; o estado de uma peça morre com ela
- dependency failure: C2 (`npm ci --dry-run` e licenças) e C31 (peso); o Radix em si é a dependência, fixada em C1
- state transitions: C4-C9 (aberto, fechando, fechado), C10, C11 (selecionada), C12 (ligado/desligado), C16 (marcas)
- observability: n/a - não há requisito de log; o peso do pacote é registrado em C31

## Out of scope

- Select e Checkbox sobre Radix, Toast sobre Radix, `AlertDialog`, `ContextMenu`, `RadioGroup`, `ToggleGroup`, `Combobox` - ver o Out of scope do plano
- A gaveta da conversa e a barra lateral estreita em Radix - ver o Out of scope do plano

## Handoff

- S1 = 30k (14 arquivos: `src/ui` novo, `theme.css`, `states.test.ts`, `typography.test.ts`, os leitores), S2 = 12k, S3 = 135k (`wc -c` dos 41 arquivos existentes que a migração lê e edita: 825 KB, dos quais se lê um terço em trechos; mais 81 sítios de `title` espalhados em 69 arquivos), S4 = 25k: total ≈ 202k, acima do orçamento de 150k
- Cortes naturais se fosse com passagem de bastão: depois de S2 (a primitiva e a sonda fechadas, verdes) e depois dos diálogos e popovers de S3 (a metade que muda o teclado); o resto (abas, interruptores, menu, dicas) é mecânico
- Mechanism: one builder (compaction accepted) - o pedido do orquestrador foi uma só construção e o plano foi aprovado por delegação do dono; a passagem de bastão no meio exigiria o orquestrador. Releitura de `checks.md` e do diff ao primeiro sinal de compactação

### Boundary

- Feita por um só construtor, na ordem S1, S2, S3, S4; a compactação veio no meio de S4 e a releitura de `checks.md` e do diff bastou.

### Settled mid-build

- A gaveta do documento fica em `useDrawer` (door 9), não em `DialogSurface`: o `aria-hidden` do Radix num modal que fica no lugar esconde `#modal-root` e a paleta. AC 20, C20, C26 e o inventário foram corrigidos junto, e o desvio está em "Perguntas ao dono" de `STATE.md`.
- O menu não é modal (door 9) e é nomeado pelo gatilho: não há prop `label`; as setas têm volta (`loop`). Achado pelo axe (`aria-hidden-focus`) com o menu aberto na galeria.
- Os nomes dos pacotes de ouvinte são `@radix-ui/react-dismissable-layer` e `@radix-ui/react-menu` (door 8); os tokens `--ui-*` acrescentados (door 7); `usePresence` mora em `hooks/usePresence.ts`; `DialogPortal` não é exportado.
- A galeria não mostra a ficha do `Switch` sem trilho: sem a classe de uma tela (`brain-chip`) ela é um botão sem pele; a ficha é provada em C23 e em `switch.test.tsx`.
- A aba `line` marca a selecionada com uma barra interna (`box-shadow` inset) e não com borda de 2px: a lista fica 2px mais baixa e a marca não é só cor (C16).
- Nenhuma afirmação de teste existente foi alterada: mudaram só as importações (`getDialogDepth` e `useDrawer` vêm de `ui`), a leitura da fonte da sonda e da lista de ouvintes (C18, C19) e duas entradas de lista que perderam o sujeito (`.tabs [role="tab"]…` de `MARKED_ELSEWHERE`, hoje coberta por C16 com a barra interna, e `.settings-group-label` de `MICROCOPY`, que deixou de existir). Nenhum e2e existente foi tocado; `a11y.spec.ts` e `gallery.spec.ts` só ganharam casos.

### Abandoned

- `DialogSurface` sem portal para a gaveta do documento (revertida, acima).
- Menu modal (o padrão do Radix): reprovado pelo axe e pelo `aria-hidden` da página inteira.
