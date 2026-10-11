# Primitivas — design (binding para a feature)

Decide a pasta, o contrato de cada peça, o inventário (o que migra e o que fica) e o material de cada
shell. Ficam fora daqui: o conteúdo de cada diálogo, popover e aba (é da view), e espaçamento fino
(vem dos tokens de `theme.css`).

## Onde moram

`apps/command-centre/src/ui/` (a pasta de primitivas que não existia; `components/primitives.tsx`
guarda `Button`, `Field`, `Segmented`, `Badge`, `EmptyState` e `ConfirmDialog`, que não são do Radix e
ficam). Dentro: `Dialog.tsx` (`Modal`, `DialogSurface`), `Popover.tsx`, `Tabs.tsx`, `Switch.tsx`,
`Menu.tsx` (`DropdownMenu`), `Tooltip.tsx` (`Tooltip`, `UiProvider`), `layers.ts` (a pilha de camadas,
`useDialogLayer`, `useDrawer`), `ui.css`, `index.ts`, mais os testes e `testkit.tsx`. A saída com animação
(`usePresence`) mora em `hooks/usePresence.ts`, junto dos outros ganchos, e não é do Radix. Só esta pasta
importa `@radix-ui/*`.

## Inventário (lista fechada)

### Migra para as primitivas

| Widget feito à mão hoje                                                                                                                                                                                                                                       | Vira                             | Observação                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------- |
| `Modal` (`components/ui.tsx`) e seus 10 usos: `ShortcutsHelp`, `ExportModal`, `MarketplaceModal`, `NewSkillModal`, `SkillMatrixModal`, `Routines` (2), `SkillsScene` (folha `sks-sheet`), `ConfirmDialog` (via `useConfirm`, 10 telas), a história da galeria | `Modal`                          | mesma API (`title`, `onClose`, `narrow`, `initialFocus`, `open`, `className`)          |
| `CommandPalette` (`launcher`)                                                                                                                                                                                                                                 | `DialogSurface`                  | a saída `.closing` e o fechamento "instantâneo" do `App.tsx` ficam                     |
| `ProviderGate`                                                                                                                                                                                                                                                | `DialogSurface`                  | segue montado e fechado; o fundo acima do `Modal` (z-index +1) fica                    |
| `SkillDeck` (`skill-deck`)                                                                                                                                                                                                                                    | `DialogSurface`                  | o leque e o `deck.close` (⌘J) no escopo `modal` ficam                                  |
| `Popover` (`components/primitives.tsx`)                                                                                                                                                                                                                       | `Popover`                        | o menu "⋯" do Cérebro (`bs-menu`) e a galeria                                          |
| `moldura/BellPopover`                                                                                                                                                                                                                                         | `Popover`                        | Esc devolve o foco ao sino; o comando `moldura.bell.close` sai (o Radix trata o Esc)   |
| `desktop/ModelEffortPopover`, `ModelPopover`, `ConversationsPopover`                                                                                                                                                                                          | `Popover` (âncora por elemento)  | deixam de prender o foco e de deixar a página inerte (declaravam `aria-modal="false"`) |
| `Tabs` (`components/primitives.tsx`)                                                                                                                                                                                                                          | `Tabs`                           | as panes do detalhe da skill                                                           |
| `views/Settings.tsx` (`role="tablist"` vertical)                                                                                                                                                                                                              | `Tabs` vertical, variante `list` | mantém `#settings-tabs-panel-<aba>`                                                    |
| `nucleo/scenes/RunsSceneRun` (`rs-tabs`)                                                                                                                                                                                                                      | `Tabs`, variante `pill`          | mantém `#rs-run-panel`                                                                 |
| `BrainSceneMenu` (2 interruptores), `BrainPanel` (fichas de aresta)                                                                                                                                                                                           | `Switch`                         | o de "grafo local" é trilho; as fichas de aresta são `Switch` sem trilho (ficha)       |
| `SkillsSceneTools` `MoreMenu` (`sks-menu`)                                                                                                                                                                                                                    | `DropdownMenu`                   | mantém `data-testid="skills-more"` e os três itens                                     |
| Os botões só de ícone com `aria-label` igual ao `title` (74 sítios `Tooltip` em 38 arquivos; o levantamento inicial contou 81 `title`)                                                                                                                        | `Tooltip` (e sem `title`)        | mapa por arquivo no teste de fonte; o nome acessível fica no `aria-label`              |

### Fica, com o motivo

| O que fica                                                                                   | Motivo                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `moldura/Sidebar` estreita e a gaveta da conversa (`moldura/Moldura`) em `useDrawer`         | o mesmo nó é gaveta modal só em janela estreita e coluna fixa no resto; o conteúdo é ao vivo (o Console) e não pode remontar; o Radix monta a camada com o conteúdo                                                                                                                                                                |
| `moldura/DocDrawer` em `useDrawer` (door 9 do plano)                                         | tentada em `DialogSurface` sem portal e revertida: o Radix põe `aria-hidden` em todo irmão de um modal que fica no lugar, `#modal-root` incluído, e a paleta aberta de dentro da gaveta mora lá e ficava escondida do leitor de tela. A gaveta mantém Esc, a armadilha de foco, o foco de volta e o `inert` até a raiz pelo gancho |
| `onboarding/Onboarding` (tour guiado)                                                        | é dono do teclado enquanto está de pé (`document.documentElement.dataset.onboarding` desliga o registro); o modo guiado não é modal                                                                                                                                                                                                |
| `nucleo/pending/FocusMode`                                                                   | camada `overlay` própria (design do `comandos-atalhos`)                                                                                                                                                                                                                                                                            |
| `.sks-sheet` (folha de detalhes de Skills, `Modal className="sks-sheet"`)                    | só posição e tamanho ficam em `skillsScene.css`; a folha era desenhada duas vezes (a regra de `ui.css` e a do cenário, com vidro, recorte de canto, sombra e entrada próprios) e ficou a de `ui.css`: o recorte de canto e o vidro próprio saem, uma mudança visível (STATE, Perguntas ao dono)                                    |
| `ToastProvider` (`components/ui.tsx`)                                                        | pequeno, com região viva certa, fora do `inert` de propósito; o Radix Toast instala um ouvinte de F8 no documento                                                                                                                                                                                                                  |
| `<select>` (≈55) e `<input type="checkbox">` (≈25)                                           | controles nativos de formulário; não há widget feito à mão equivalente; a pele de vidro do Núcleo para caixas de marcar (`luz.css`) é a pele de controles, não uma das seis                                                                                                                                                        |
| `Segmented`, `QuestionCard`, listas `role="listbox"` (paleta, console, busca, arquivos)      | `radiogroup` e `listbox` com teclado próprio; o Radix não tem listbox e RadioGroup/ToggleGroup estão fora das seis                                                                                                                                                                                                                 |
| botões `aria-pressed` (Pixel, Setup, BrainPanel "local")                                     | botão de alternar, papel diferente de `switch`                                                                                                                                                                                                                                                                                     |
| `<details>` (diagnóstico, memória, terminal)                                                 | divulgação nativa                                                                                                                                                                                                                                                                                                                  |
| `title` que carregam dado (caminho, texto cortado, resumo, contagem) e as 3 exceções binding | a dica nativa de um dado cortado não repete nome algum; a barra lateral (`moldura-app` Tela 1) e os cartões do deck (selecionados por `title` no e2e) ficam                                                                                                                                                                        |

## Contrato de cada peça

**Modal / DialogSurface.** Portal em `#modal-root`; o fundo (`.modal-backdrop`, ou `.launcher` na
paleta) é o único filho do portal e contém a folha (`.modal`, ou `.launcher-panel`), como hoje (a pilha
de `inert` lê `#modal-root > *`). A folha é `role="dialog"`, `aria-modal="true"`, nome por `title`
(`aria-label`) ou por `aria-labelledby`. Foco inicial: `initialFocus()`, senão o primeiro campo, senão o
primeiro foco que não é o botão de fechar, senão a folha (`tabIndex=-1`); ao fechar o foco volta ao que o
tinha ao abrir. O Tab circula; o Esc fecha só a camada de cima. Fechar pelo fundo é um `pointerdown`
fora da folha. A saída (160 ms) é `data-state="closed"` com a animação do CSS; `onClose` roda depois
dela (sem animação, na hora). Sem o provedor: nada a montar.

**Popover.** Não modal: `role="dialog"` com `aria-modal="false"` escrito, âncora por elemento ou ref
(sem gatilho), nada fica inerte e a pilha não o conta. Esc e clique fora fecham; o foco volta à âncora
ao fechar por Esc ou por escolha, e fica onde o clique o pôs ao fechar por clique fora. Abre com
`spring-in`, fecha com `fade-out` (`data-state`).

**Tabs.** `id` base da conta: `${id}-tab-${aba}` e `${id}-panel-${aba}` (ou `ids`, para um painel que
várias abas dividem); uma parada de Tab (a lista; o foco anda por setas, assíncrono no Radix), setas
(cima/baixo na vertical), Home e End, ativação automática (a aba foca e seleciona); sem filhos a peça só
desenha a lista e o painel vem de `Tabs.Panel` onde a tela o quiser; uma aba que recebe um `click` por
conta própria (um script, um toque) também seleciona; variantes `line`
(sublinhado), `list` (navegação vertical das Configurações) e `pill` (a barra de Execuções do Núcleo).

**Switch.** `button[role="switch"]` com `aria-checked`; Espaço alterna; `disabled` não alterna. Variante
de trilho (trilho e botão que anda, sinal que não é cor) e variante de ficha (filhos próprios, sem trilho).

**DropdownMenu.** Gatilho com `aria-haspopup="menu"`; conteúdo `role="menu"` nomeado pelo gatilho (o
Radix aponta `aria-labelledby` para ele: não há prop de nome), itens `role="menuitem"`; setas com volta
(`loop`), Home, End e digitação; Enter/Espaço executa e fecha; Esc fecha e devolve o foco ao gatilho. Não
é modal (`modal={false}`, door 9): a página atrás não ganha `aria-hidden`, um clique fora fecha, e o Tab
não sai do menu. Aberto, é uma camada `overlay` para o registro de comandos (`useCommandScope`), como um
diálogo: as letras de busca do menu e o `Mod+K` não chegam à tela atrás dele (AC 35). `tip` envolve o gatilho num `Tooltip`.

**Tooltip.** Envolve um controle que já tem `aria-label`; aparece com o foco do teclado e depois de
400 ms de ponteiro parado; `role="tooltip"`, e `aria-describedby` no controle quando a dica diz mais que o
nome (uma dica que só repete o `aria-label` não vira a descrição: seria dita duas vezes, AC 37); Esc fecha sem mexer no foco (e, enquanto
ela está aberta, o Radix a trata como a camada de cima e consome o primeiro Esc: ver "Perguntas ao dono"); o
conteúdo mínimo é 12px; entra por `UiProvider` (a primitiva monta o seu próprio provedor quando não
há um acima, para uma view solta num teste).

## Camadas, teclado e a sonda

- A pilha (`ui/layers.ts`) contém os diálogos Radix (registrados por `useDialogLayer`) e as três gavetas
  (`useDrawer`: barra lateral estreita, conversa e documento): daí vêm o `inert`, a profundidade que empurra o shell (`data-depth="pushed"`) e o
  escopo `modal` do registro de comandos. Um `Popover` não entra.
- `useDrawer` lê `defaultPrevented` antes de tudo: o Esc que uma camada Radix acima dele (popover do
  console sobre a gaveta da conversa, dica num controle da barra lateral ou da gaveta do documento) já
  tomou não fecha também a gaveta (AC 33). **Por que as três gavetas não passam a usar o Esc do registro**:
  a gaveta também prende o Tab, que o registro não trata (é fluxo de digitação, não comando); o Esc dela, lido
  pela mesma marca que o registro lê, dá o mesmo efeito de camadas sem um terceiro caminho, e o ouvinte
  único continua um item contado e explicado em `OUTSIDE_THE_REGISTRY`.
- `floatingLayerOpen()` (de `ui/layers.ts`) diz se há dica, popover ou menu aberto. Os ouvintes de janela
  em captura das cenas do Núcleo (`BrainScene`, `RunsScene`, `RoutinesScene`, `SkillsScene`, `FocusMode`) o
  consultam e não respondem ao Esc enquanto há uma: o Radix escuta no documento, depois da janela, e sem isso
  a cena fechava o que é dela antes de a dica fechar (AC 34). Os de letras (`SkillsScene`, `BrainScene`
  Shift+1-4) também.
- Um diálogo aberto de dentro de um painel flutuante (um item de menu, um botão do sino) guarda, ao abrir, o
  controle de que o painel pendia (`ui/layers.ts: controlOfPanelAround`; o menu do Radix nomeia o seu
  gatilho, o `Popover` registra a sua âncora) e devolve o foco a ele se o opener já não existe (AC 36).
- O Radix trata Esc num ouvinte de documento em captura (`@radix-ui/react-dismissable-layer`, só a
  camada de cima; o `@radix-ui/react-menu` tem outro, que só anota se a última tecla foi do teclado) e
  marca o evento como tratado; o registro, que ouve a janela em bolha, já o ignora quando
  `defaultPrevented`. Os ouvintes de janela em captura das cenas (`BrainScene`, `RunsScene`…) continuam
  rodando antes e conferem `getDialogDepth()` e `closest('[role="dialog"]')` como hoje.
- `commands/listenersAllowlist.ts` lista os arquivos do app (`OUTSIDE_THE_REGISTRY`) e as dependências
  (`OUTSIDE_THE_REGISTRY_DEPS`); a sonda atribui o ouvinte ao primeiro quadro da pilha que não é de
  `commands/` nem do React: um arquivo de `src`, ou o pacote em `node_modules` (o React DOM entra só
  como delegação própria dele).

## Material do shell (a única diferença)

Declarados uma vez em `ui/ui.css`: o padrão em `:root` e em `[data-shell="moldura"]`, o do Núcleo em
`html:has(.nu-shell)` e em `.nu-shell` (para a galeria, onde as duas camadas dividem a página).

| Token            | Moldura            | Núcleo                                                      |
| ---------------- | ------------------ | ----------------------------------------------------------- |
| `--ui-sheet-r`   | `var(--r-3)` (8px) | `26px`                                                      |
| `--ui-sheet-bg`  | `var(--bg-raise)`  | vidro: gradiente do agente sobre `color-mix(var(--bg) 62%)` |
| `--ui-veil`      | `shadow-ink` 62%   | gradiente do agente sobre `color-mix(var(--bg) 54%)`        |
| `--ui-veil-blur` | `3px`              | `12px saturate(0.75) brightness(0.85)`                      |
| `--ui-pop-r`     | `var(--r-3)`       | `18px`                                                      |
| `--ui-pop-bg`    | `var(--surface)`   | `color-mix(var(--bg) 86%)`                                  |
| `--ui-pop-blur`  | `none`             | `blur(22px) saturate(1.3)`                                  |
| `--ui-pop-clip`  | `none`             | `none`                                                      |

A classe `ui-material-default` volta aos valores da moldura dentro de uma página do Núcleo (a seção "nua" da
galeria, que divide a página com a camada do Núcleo e do contrário vestiria o vidro dele).

Tokens acrescentados na construção (door 7 do plano, mesmos lugares): `--ui-sheet-edge`,
`--ui-sheet-shadow`, `--ui-sheet-blur`, `--ui-sheet-in`, `--ui-sheet-out`, `--ui-veil-in`, `--ui-pop-edge`,
`--ui-pop-shadow`, `--ui-item-r`, `--ui-item-clip`. Cada um vale o que a regra de `luz.css` que saiu valia
(vidro, brilho, recorte); a moldura fica com a borda e a sombra do tema.

## Binding sources

| Source                                           | O que decide                                                                                                                                                                      |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.specs/features/design-system/design.md`        | piso de 12px, texto corrido a 13px, cor só por token, estado nunca só por cor, axe sem `serious`/`critical`, galeria com as duas camadas                                          |
| `.specs/features/comandos-atalhos/design.md`     | um só ouvinte de teclado, escopos `modal`/`overlay`, o que fica fora do registro (tour, modo foco, `dialog.tsx`, popover, campos)                                                 |
| `.specs/features/moldura-app/design.md` (Tela 1) | o sino, a gaveta do documento e a da conversa são diálogos (o foco entra, o resto fica inerte, o foco volta a quem abriu); Esc fecha o de cima; a dica (`title`) da barra lateral |
