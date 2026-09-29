# Conceito imersivo em todo o sistema

## Problem

O Núcleo, a conversa e o Cérebro já falam a linguagem nova (vidro arredondado, neon sutil,
uma coisa em foco por vez, o agente no centro). O resto do sistema ainda fala a linguagem antiga:
caixas chanfradas, formulários nativos, colunas de informação lado a lado, tudo aberto ao mesmo
tempo. O dono do produto, testando em 2026-09-29, registrou com seis capturas:

- **Resolver (pendências):** "ainda não parece estar no conceito novo". A fila lista a mesma causa
  várias vezes (a falha de `/consolidate-memory` e a rotina "Nightly memory consolidation" são dois
  itens; "A execução excedeu o tempo limite" aparece três vezes; "consolidate-memory failed 2
  times" e "consolidate-memory: 2 falhas" são dois avisos). O erro aparece duas vezes no mesmo
  cartão (linha de erro e caixa de recuperação).
- **Execuções:** "bonitos, são confusos, o usuário se perde … muito bagunçado". Selecionar uma
  execução abre o rio, a trilha de passos embaixo e a folha "Detalhe completo" ao lado ao mesmo
  tempo; o mesmo erro aparece três vezes; os rótulos do rio se sobrepõem quando ele encolhe.
- **Habilidades:** "ainda não parece com o novo sistema". Filtros em três linhas à esquerda, três
  blocos de metadados à direita, e o Marketplace é um modal quadrado amarelo antigo.
- **Conectores:** "estão quebrando, estão feias". O botão de etapa "O que ele faz" quebra uma
  palavra por linha; o conteúdo dos cartões é cortado embaixo sem rolagem.
- As capturas feitas nesta análise mostram o mesmo em Artefatos e Gerações (busca com rótulo
  duplicado, `<select>` nativos), Ajustes (formulário antigo) e Pixel (painéis antigos).

Quem paga é o usuário: ele sai do Núcleo imersivo e cai num painel administrativo, se perde em
telas que mostram tudo ao mesmo tempo, e resolve a mesma pendência duas vezes.

Quando isso chegar: toda tela usa a mesma linguagem, cada tela mostra uma coisa em foco e o
resto sob demanda, cada causa aparece uma vez, e em toda tela o agente lê o item primeiro e
oferece a próxima ação.

## Flow

Reutiliza as primitivas existentes (`components/ui.tsx`, `components/dialog.tsx`,
`components/primitives.tsx`), as viagens e lâminas do shell (`nucleo/travel.ts`,
`nucleo/projections.ts`), o modelo de pendências (`nucleo/pending/model.ts`) e a conversa
(`desktop/console/Console.tsx`, com `@ref`). Nenhuma primitiva nova duplicada.

1. linguagem: `nucleo/nucleo.css` (exists) define os tokens Luz; `.nu-shell` sobrepõe as classes
   das primitivas compartilhadas (door 1) - toda tela dentro do shell herda sem reescrita
2. Resolver: `nucleo/pending/model.ts` (exists) agrupa causas -> `nucleo/pending/FocusMode.tsx`
   (exists) mostra um cartão por vez
3. Execuções: `nucleo/scenes/RunsScene.tsx` (exists) alterna entre visão geral (rio) e foco
   (uma execução, `RunsSceneRun.tsx`); a trilha e a folha "Detalhe completo" saíram - a folha
   virou a aba Log (`runs/RunDetail.tsx`, exists), ainda alcançável por `?detail=1`
4. Habilidades: `nucleo/scenes/SkillsScene.tsx` (exists) + `SkillsSceneTools.tsx` + `SkillsSceneFocus.tsx`
   (exist) - filtros em uma linha com um menu "+", leituras só em "Detalhes", o editor
   (`views/Skills/SkillDetail.tsx`, exists) numa `Modal` (exists) em vez da folha lateral
5. Conectores: `views/Connectors.tsx` (exists) + `views/ConnectorWizard.tsx` (exists) - lista de cartões,
   um aberto por vez
6. Artefatos e Gerações: `views/Artifacts.tsx` (exists) + `views/Generations.tsx` (exists) - busca única,
   filtros em chips, abrir como lâmina (`desktop/DocWindow.tsx`, exists, passa a mostrar imagem e vídeo;
   a caixa de visualização antiga saiu)
7. Ajustes e Pixel: `views/Settings.tsx` (exists) + `views/PixelStudio.tsx` (exists) - só a linguagem (1)
8. out: "Perguntar ao agente" em cada foco torna o item o assunto (`nucleo/subject.ts`, new, no door -
   placement per conventions), que o shell publica entre os painéis referenciáveis; a conversa
   (exists) abre com o `@ref` do item. A lâmina de artefato usa o `@ref` que já tinha

## Impact

| Front       | What changes                                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | termo novo: `causa` - o que uma pendência resolve; itens com a mesma causa viram um só no Resolver; vive em `nucleo/pending/model.ts`                                           |
| domain      | termo existente: `notice` no nível `info` era listado no Resolver; passa a ficar em "histórico" (recolhido) - `PendingHub`, `FocusMode` e `describe.ts` ramificam nele hoje     |
| domain      | rota existente: `/runs/:id` abria a folha "Detalhe completo"; passa a abrir o foco da execução - links de pendências, da conversa ("Abrir execução") e da paleta usam essa rota |
| stored data | nada a migrar - silenciar e lido continuam nas mesmas chaves                                                                                                                    |
| tests       | e2e que clicam "Detalhe completo", no `<select>` de Artefatos ou nos botões de etapa de Conectores mudam de seletor; a intenção de cada teste se mantém                         |

## Relations

`None - no stored-data shape change`

## Surface

`None - nothing consumed outside; nenhuma rota de API muda`

## Landing

| One-way door                                         | Literal shape                                                                                                                                                                                                | Alternative rejected                                                                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| linguagem Luz aplicada às primitivas dentro do shell | seletores `.nu-shell .btn`, `.nu-shell .input`, `.nu-shell .card`, `.nu-shell .modal` em `nucleo/luz.css`, importado por `nucleo/index.tsx`; tokens `--luz-r` (raio), `--luz-glass`, `--luz-edge` em `:root` | componentes React `Luz*` novos - duplicam `ui.tsx` e obrigam reescrever toda view; editar `ui.tsx` direto - muda também o onboarding e a galeria, fora do shell |
| agrupamento de causas no modelo de pendências        | `PendingItem.also: PendingItem[]` (itens absorvidos) e `PendingItem.count` - o id do item que absorve é o id visível                                                                                         | agrupar só na tela - o contador do hub e os atalhos `⌘⇧A` contariam itens diferentes do que a tela mostra                                                       |

- Nothing else in this change is hard to reverse

## Criteria

### S1: Uma linguagem em todas as telas (P1)

Qualquer tela dentro do shell parece parte do mesmo sistema do Núcleo e da conversa.

**Acceptance Criteria**

1. The system SHALL render every `button`, `input`, `textarea` and dialog inside `.nu-shell` with a computed `clip-path` of `none` and a `border-radius` of at least 10px (pills: 999px)
2. The system SHALL render no native `select` element visible in the scenes Artefatos, Gerações, Conectores and Habilidades; choices appear as chips or as the shell's listbox
3. WHEN a dialog opens inside the shell THEN the system SHALL raise it as a glass sheet over the same veil as the conversation, entering in at most 450 ms
4. WHEN a dialog is open and the user presses Esc or clicks the veil THEN the system SHALL close it and return focus to the control that opened it
5. The system SHALL keep text contrast of at least 4.5:1 on the glass surfaces in the dark and light themes (existing `surface-contrast` e2e)

**Independent test:** abrir cada cena a 1440×900 e medir `clip-path`, `border-radius` e contraste por script.

### S2: Resolver - uma pendência por vez, cada causa uma vez (P1)

O modo foco mostra um cartão com a leitura do agente e a próxima ação; nada repetido.

**Acceptance Criteria**

6. WHEN a run failure belongs to a routine that is listed as unhealthy THEN the system SHALL show one item for the routine, with the failure inside it, and count it once in the hub
7. WHEN two or more unread notices share the same title THEN the system SHALL show one row with the title and `×N`
8. The system SHALL list notices of level `info` only inside a collapsed "Histórico (N)" group at the end of the queue
9. WHEN the focus mode opens THEN the system SHALL show the first item as one centred card whose first line is the agent's reading in plain words, followed by one primary action and at most three secondary actions
10. The system SHALL show an item's error text exactly once in its card
11. WHEN the user moves to another item (↑/↓, j/k or click) THEN the system SHALL animate the card change in at most 400 ms and update a counter "N de M"
12. WHEN an item is resolved (approve, deny, answer, rerun, silence) THEN the system SHALL animate it out and focus the next item
13. IF the queue becomes empty THEN the system SHALL show the empty state "Nada precisa de você" with the entity and a "Voltar ao sistema" action

**Independent test:** semear uma rotina doente com duas falhas e três avisos iguais; o Resolver mostra 2 itens, não 6.

### S3: Execuções - visão geral ou foco, nunca os dois (P1)

Selecionar uma execução troca a visão geral pelo foco daquela execução.

**Acceptance Criteria**

14. WHILE no run is selected the system SHALL show the river and the period summary only
15. WHEN a run is selected THEN the system SHALL compress the river into a strip at most 120px tall and show one run view in the rest of the scene
16. The system SHALL show the run view with three sections - Resumo, Passos, Log - and open on Resumo
17. The system SHALL start Resumo with the agent's line about the outcome and the actions "Executar de novo", "Continuar" and "Perguntar ao agente"
18. The system SHALL show a run's error text exactly once in the run view
19. WHEN the user presses Esc or the back control in the run view THEN the system SHALL restore the full river and remove the run view with an animation of at most 450 ms
20. WHEN the route is `/runs/:id` THEN the system SHALL open that run's view directly
21. IF two labels in the river would overlap THEN the system SHALL hide the one of the older run

**Independent test:** abrir Execuções, clicar uma execução falha: vê-se só a faixa do rio e o foco; o erro uma vez; Esc volta.

### S4: Habilidades - o anel no centro, o resto sob demanda (P2)

A cena mostra o anel e a habilidade em foco; filtros e metadados não ficam abertos o tempo todo.

**Acceptance Criteria**

22. The system SHALL show the skill filters as one search pill plus one row of chips above the ring
23. The system SHALL group Marketplace, Exportar para provedores and Nova skill under one "+" menu
24. The system SHALL show recent runs, inputs and model of the focused skill only after the user opens "Detalhes" on its card
25. WHEN Marketplace, Nova skill or the skill editor opens THEN the system SHALL present it as the shell's glass sheet (AC 3)
26. IF no registry is configured THEN the Marketplace sheet SHALL show one sentence and one action "Configurar registros"

**Independent test:** abrir Habilidades a 1440×900: nada à direita do anel até abrir "Detalhes".

### S5: Conectores - consertar e trazer para o conceito (P1)

Cada conector é um cartão de vidro; um aberto por vez; nada quebra nem é cortado.

**Acceptance Criteria**

27. The system SHALL render every connector step label on a single line at viewport widths of 1280px and above
28. IF a scene's content is taller than the space above the voice line THEN the system SHALL scroll it, with no content clipped
29. The system SHALL list connectors as glass cards showing status orb, name and one-line purpose
30. WHEN a connector card is opened THEN the system SHALL expand that card into its setup steps in place and fold any other open card
31. The system SHALL place "Auditar" as a pill in the scene header

**Independent test:** abrir Conectores a 1280×720 e 1440×900; nenhum rótulo quebra, tudo alcançável rolando.

### S6: Artefatos e Gerações - galeria no conceito (P2)

Uma busca, filtros em chips, abrir como lâmina.

**Acceptance Criteria**

32. The system SHALL render exactly one search field in Artefatos and one in Gerações
33. The system SHALL show kind, origin and period filters as chips
34. WHEN a tile is clicked THEN the system SHALL open the item as a lâmina growing from the tile
35. IF a filter leaves no items THEN the system SHALL show "Nada aqui com esses filtros" and a "Limpar filtros" action

**Independent test:** filtrar até zero, limpar, abrir um item: nasce do cartão.

### S7: O agente presente em cada foco (P2)

Em toda tela, o item em foco pode ser levado ao agente.

**Acceptance Criteria**

36. WHEN the user chooses "Perguntar ao agente" on a focused item (pendência, execução, habilidade, conector, artefato) THEN the system SHALL open the conversation with that item's `@ref` already in the line

**Independent test:** em cada cena, "Perguntar ao agente" abre a conversa com o `@ref` certo.

## Out of scope

| Excluded                                                                  | Why                                                       |
| ------------------------------------------------------------------------- | --------------------------------------------------------- |
| Núcleo, conversa e Cérebro                                                | refeitos nas rodadas 3-4; só herdam a linguagem           |
| Novas capacidades de backend (registros de marketplace, novos conectores) | o problema é experiência, não capacidade                  |
| Novas ferramentas do Pixel                                                | o Pixel só recebe a linguagem                             |
| Onboarding e galeria de componentes fora do shell                         | fora de `.nu-shell`, não herdam a linguagem nesta entrega |

## Assumptions

| Assumption                                   | Chosen default                                                                                            | Rationale                            | Confirmed? |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------- |
| Ordem de entrega                             | S5 (quebrado) e S2 primeiro, depois S3, S1, S4, S6, S7                                                    | conserta o que quebra antes de polir | y          |
| Ajustes                                      | só a linguagem (S1), sem reorganizar as seções                                                            | o dono não apontou Ajustes           | n          |
| Leitura do agente no Resolver e em Execuções | frase gerada no cliente a partir do tipo de item (`describe.ts`, `runs/humanize.ts`), sem chamar o modelo | instantânea e sem custo              | n          |
| Rotinas                                      | fica como está (mostrador já no conceito); só herda S1                                                    | o dono não apontou Rotinas           | n          |

**Open questions:** none - all resolved or logged above.

## Observable

| Surface                   | Decision                    | Landing                                                              |
| ------------------------- | --------------------------- | -------------------------------------------------------------------- |
| screen Resolver           | empty state                 | AC 13                                                                |
| screen Resolver           | loading state               | existing - o hub mostra o anel enquanto `usePending` carrega         |
| screen Resolver           | error state                 | AC 10                                                                |
| screen Resolver           | destructive action confirms | existing - negar e silenciar são reversíveis na fila; nada é apagado |
| screen Resolver           | density and ordering        | AC 6, AC 7, AC 8                                                     |
| screen Execuções          | empty state                 | existing - "Nada neste período" no rio                               |
| screen Execuções          | loading state               | existing - esqueleto do rio                                          |
| screen Execuções          | error state                 | AC 18                                                                |
| screen Execuções          | density and ordering        | AC 14, AC 15, AC 21                                                  |
| screen Execuções          | destructive action confirms | existing - parar execução pede confirmação                           |
| screen Habilidades        | empty state                 | AC 26                                                                |
| screen Habilidades        | density                     | AC 22, AC 24                                                         |
| screen Habilidades        | destructive action confirms | existing - apagar skill confirma no editor                           |
| screen Conectores         | error state                 | existing - resultado do teste mostra a falha no passo 3              |
| screen Conectores         | density                     | AC 27, AC 28, AC 30                                                  |
| screen Artefatos/Gerações | empty state                 | AC 35                                                                |
| screen Artefatos/Gerações | loading state               | existing - grade com placeholders                                    |
| all screens               | unauthorised state          | n/a - serviço local de um usuário, sem login                         |
| all dialogs               | dismissal                   | AC 4                                                                 |

## Sources

- capturas do dono do produto em 2026-09-29 (Resolver, Execuções ×2, Habilidades, Marketplace, Conectores)
- `docs/plans/nucleo-imersivo.md` - o conceito e as rodadas 1-4
