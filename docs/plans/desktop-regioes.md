# Desktop em regiões — palco, trilho, gaveta e faixa

Rascunho 1 · 23/09/2026 · Sucessor de [`desktop-jarvis-refino.md`](desktop-jarvis-refino.md). Branch `feature/desktop-regions`.

Análise publicada com o print anotado, capturas e mockups: "Palco MordomoOS" (artefato de 23/09).

## 1. Diagnóstico

O refino JARVIS deixou o desktop com os órgãos certos e sem um modelo de espaço: janelas, console, pods e faixas disputavam os mesmos pixels.

| # | Causa | Onde nascia |
|---|-------|-------------|
| E1 | As janelas reservavam 150 px para o console; o console real media 360–600 px com a conversa aberta (o padrão) e ficava em z 30 sobre janelas em z 10. | `windowModel.ts` (`CONSOLE_BAND`), `.cons` fixo em `desktop.css` |
| E2 | Pods nas duas bordas em z 20 sobre janelas em z 10; `tile`, `snapBox` e `overviewSlots` ignoravam a margem deles. | `desktop.css` (`.pod-arc`), `windowModel.ts` |
| E3 | `placeNew` escolhia o lugar "menos ruim" e nunca recusava sobreposição; a partir da quarta janela, tudo se empilhava. | `windowModel.ts` |
| E4 | Colunas ignoravam o mínimo de cada tipo; a normalização alargava de volta e as colunas se sobrepunham ao recarregar. | `columns()`, `normalizeWindows()` |
| E5 | O mesmo número (custo do dia) em quatro renderizadores; faixa com sparklines que cortava em 1280 px; dock com tudo que existe em vez do que está aberto. | `AmbientStrip.tsx`, widgets, `Workspace.tsx` |
| E6 | Apps repetiam o próprio título dentro de uma janela que já tinha título. | `BrainChrome.tsx`, `runs/index.tsx` e demais apps |

Nenhum teste E2E verificava interseção entre janela e console, janela e pod ou janela e janela.

## 2. Regras

1. **Regiões não se sobrepõem.** Faixa (topo), trilho (esquerda, `--rail-w`), gaveta do console (acima do dock, altura medida em `--console-h`) e palco no que sobra. O palco é inset por essas variáveis; a geometria das janelas não reserva margens.
2. **Abrir nunca cobre.** Uma a três janelas em colunas do tamanho do palco, respeitando o mínimo de cada tipo; da quarta em diante, a janela entra como aba da coluna mais antiga.
3. **Uma ativa, as outras em véu.**
4. **Um número, um lugar.** Custo e execuções só na faixa; contadores só nos pods; histórico só nos painéis Pulso e Custo.
5. **O app não se apresenta duas vezes.** Título e handle no cabeçalho da janela.
6. **Dock é o que está aberto.** Ferramentas de HUD na paleta.
7. **Maximizar ocupa o palco, nunca a tela;** o console continua utilizável.

## 3. Passos

| Passo | Entrega | Aceite |
|-------|---------|--------|
| 1 | Regiões: tokens `--rail-w` e `--console-h`, palco inset, trilho único com pods que encolhem para caber, sem guia de arco nem rótulos sobre o palco. | Nenhum pod sobre uma janela em 1280, 1440 e 2000 px. |
| 2 | Console como gaveta docada: área de conversa rolável com altura arrastável (↑/↓, duplo clique recolhe), coluna de contexto em telas largas, resumo do dia como primeira mensagem. | O palco encolhe quando a gaveta cresce; nenhuma janela sob ela. |
| 3 | Colunas com mínimos, abas a partir da quarta janela, véu, maximizar dentro do palco. | Cinco painéis abertos resultam em três quadros sem sobreposição. |
| 4 | Faixa sem sparklines e sem transbordar; custo fora da Caixa de entrada. | `scrollWidth ≤ clientWidth` na faixa em 1280 px. |
| 5 | Cabeçalho único nos apps; dock só com janelas abertas; HUD, Visão geral e Distribuir na paleta. | Nenhum rótulo cortado no dock em 1280 px. |
| 6 | `tests/e2e/desktop-regions.spec.ts`: 1, 3 e 5 painéis em três tamanhos, sem interseção com console, trilho, faixa, dock ou outra janela. | Spec verde. |

## 4. Registro — 23/09/2026

| Passo | O que entrou | Como se prova |
|-------|--------------|---------------|
| 1 | `--rail-w` e `--console-h` em `theme.css`; `.desktop-widgets` inset por eles; pods das duas listas numa coluna `.pod-rail` que encolhe (`--pod-s`) em vez de rolar; guia de arco e rótulos que invadiam o palco removidos. `ARC_MARGIN` e `CONSOLE_BAND` saíram de `windowModel.ts`. | `desktop-regions.spec.ts` (três tamanhos). |
| 2 | Console docado entre o trilho e a borda direita; `.cons-scroll` com altura por alça (`DRAWER_MIN`–`DRAWER_MAX`, ↑/↓, duplo clique recolhe, lembrada em `mordomo.console.drawer.v1`); coluna de contexto acima de 1040 px de container; a altura medida vira `--console-h`. Resumo do dia sem o custo; orçamento restante só ao digitar ou quando apertado. | Spec "growing the console drawer shrinks the stage"; `briefing.test.ts`. |
| 3 | `tabOf`/`tabAt` no modelo e no schema de settings; quarta janela em diante vira aba do quadro menos usado; véu (`.panel.inactive`); maximizar e Cinema dentro do palco, sem modal nem `inert` (item 51 do refino); colunas respeitam o mínimo de cada tipo e são re-derivadas quando o palco muda ou quando o layout foi salvo em outra largura (`hasColumnsShape`). O quadro se identifica pela aba visível (`data-panel`) e guarda o anfitrião em `data-frame`. | `windowModel.test.ts`, `WidgetLayer.surface.test.tsx`, `Panel.test.tsx`. |
| 4 | Faixa sem sparklines; itens de menor prioridade dobram num "⋯" (`useFitLevel.ts`); custo do dia fora do cabeçalho de Execuções. | `AmbientStrip.test.tsx`; `desktop-hud.spec.ts` em 1280 px. |
| 5 | Apps sem título duplicado dentro do quadro (`.app-panel`); dock só com o que está aberto, "+" abre a paleta em "Abrir um painel"; Editar HUD, Visão geral e Distribuir na paleta; dock e ⌘1–6 leem a mesma lista de espaços. | `WorkspaceDock.test.tsx`; `desktop-parity.spec.ts`. |
| 6 | `tests/e2e/desktop-regions.spec.ts`. | Suíte E2E completa verde. |

Achados no caminho: a marca de entrada `new` ficava presa quando dois painéis chegavam em menos de 540 ms (o temporizador era cancelado pela mudança seguinte; teste de regressão em `WidgetLayer.surface.test.tsx`); o contraste de `.ev-tool-name` no tema claro (2,6:1, já falhava antes desta branch) e a spec de smoke que ainda digitava no formulário removido de Execuções foram corrigidos.
