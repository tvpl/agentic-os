# Conceito em todo o sistema checks

Profile: ui
Plan: `.specs/features/conceito-em-todo-sistema/plan.md`

36 checks in 7 slices · 2 one-way doors · 0 open, of which 0 block

Comandos (da raiz do repositório):

- unit: `cd apps/command-centre && npx vitest run <arquivo> -t "<nome>"`
- e2e: `cd apps/command-centre && npx vite build` e depois
  `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "<nome>"`

## Checks

### S1 - uma linguagem · 4 files · 111 KB · ~28k

**C1** - Dentro de `.nu-shell`, todo `button`, `input`, `textarea` e diálogo visível nas cenas Execuções, Habilidades, Rotinas, Conectores, Artefatos, Gerações, Pixel e Ajustes tem `clip-path: none` e `border-radius` ≥ 10px (AC 1)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C1 every control in every scene is rounded glass"`
Status: closed

**C2** - Nenhum `select` nativo visível em Artefatos, Gerações, Conectores e Habilidades (AC 2)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C2 no native select in the gallery, connector and skill scenes"`
Status: closed

**C3** - Um diálogo aberto no shell sobe como folha de vidro sobre um véu igual ao da conversa (`.nu-dialog-veil`: mesmo desfoque e mesmo brilho), com animação de entrada ≤ 450 ms (AC 3)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C3 a dialog rises as a sheet over the veil"`
Status: closed

**C4** - Esc e clique no véu fecham o diálogo e devolvem o foco ao controle que o abriu (AC 4)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C4 a dialog folds on Esc and on the veil and gives focus back"`
Status: closed

**C5** - Contraste de texto ≥ 4.5:1 nas superfícies de vidro, escuro e claro (AC 5)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/surface-contrast.spec.ts -g "surface contrast"`
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C5 the new glass surfaces keep their contrast"`
Status: closed

### S2 - Resolver · 5 files · 31 KB · ~8k

**C6** - Uma falha de execução cuja `routineId` é de uma rotina doente listada vira parte do item da rotina: um item, contado uma vez (AC 6)
Proof: `cd apps/command-centre && npx vitest run src/nucleo/pending/model.test.ts -t "folds a routine's failures into the routine"`
Status: closed

**C7** - Avisos não lidos com o mesmo título viram uma linha com `×N` (AC 7)
Proof: `cd apps/command-centre && npx vitest run src/nucleo/pending/model.test.ts -t "collapses notices with the same title"`
Proof: `cd apps/command-centre && npx vitest run src/nucleo/pending/model.test.ts -t "collapses a sentinel's notice and its untranslated twin"`
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C7 the resolver shows each cause once"`
Status: closed

**C8** - Avisos de nível `info` só aparecem dentro do grupo recolhido "Histórico (N)" no fim da fila (AC 8)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C8 quiet notices wait in a folded history"`
Status: closed

**C9** - Ao abrir, o Resolver mostra um cartão centrado no palco ao lado da fila, cuja primeira linha é a leitura do agente, com 1 ação primária e no máximo 3 secundárias (AC 9)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C9 one card, the agent's reading first, one primary action"`
Status: closed

**C10** - O texto de erro de um item aparece exatamente uma vez no cartão (AC 10)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C10 the resolver says an error once"`
Status: closed

**C11** - Trocar de item (↓, ↑, j, k, clique) anima o cartão em no máximo 400 ms e atualiza o contador "N de M" (AC 11)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C11 moving through the queue animates and counts"`
Status: closed

**C12** - Resolver um item o tira da fila e foca o próximo (AC 12)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C12 a resolved item leaves and the next takes focus"`
Status: closed

**C13** - Fila vazia mostra "Nada precisa de você", a entidade e "Voltar ao sistema" (AC 13)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C13 an empty queue says nothing needs you"`
Status: closed

### S3 - Execuções · 5 files · 61 KB · ~15k

**C14** - Sem execução selecionada: só o rio e o resumo do período; nenhuma visão de execução (AC 14)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C14 the runs overview is only the river"`
Status: closed

**C15** - Com execução selecionada: o rio encolhe para faixa ≤ 120px e uma única visão de execução ocupa o resto; nenhuma folha lateral (AC 15)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C15 a chosen run replaces the overview"`
Status: closed

**C16** - A visão de execução tem as seções Resumo, Passos e Log e abre em Resumo (AC 16)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C16 the run view has summary, steps and log"`
Status: closed

**C17** - Resumo começa com a linha do agente e as ações "Executar de novo", "Continuar" e "Perguntar ao agente" (AC 17)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C17 the summary starts with the agent and its actions"`
Status: closed

**C18** - O erro de uma execução aparece exatamente uma vez em cada seção da visão (Resumo, Passos, Log) (AC 18)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C18 a run says its error once"`
Status: closed

**C19** - Esc ou voltar restaura o rio inteiro e tira a visão (AC 19)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C19 Esc gives the river back"`
Status: closed

**C20** - `/runs/:id` abre direto a visão daquela execução (AC 20)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C20 a run's route opens its view"`
Status: closed

**C21** - Dois rótulos do rio que se sobreporiam: o da execução mais antiga some (AC 21)
Proof: `cd apps/command-centre && npx vitest run src/nucleo/scenes/runsRiver.test.ts -t "hides the older of two colliding labels"`
Status: closed

### S4 - Habilidades · 7 files · 70 KB · ~17k

**C22** - Filtros = uma busca em pílula + uma linha de chips acima do anel (AC 22)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C22 skill filters are one search and one row of chips"`
Status: closed

**C23** - Marketplace, Exportar e Nova skill ficam num menu "+" único (AC 23)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C23 one plus menu holds marketplace, export and new"`
Status: closed

**C24** - Execuções recentes, entradas e modelo só aparecem depois de "Detalhes", e os três aparecem (AC 24)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C24 skill details wait to be asked"`
Status: closed

**C25** - Marketplace, Nova skill e o editor abrem como a folha do shell (AC 25)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C25 skill dialogs are the shell's sheet"`
Status: closed

**C26** - Sem registro configurado, o Marketplace mostra uma frase e a ação "Configurar registros" (AC 26)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C26 an empty marketplace says so and offers one action"`
Status: closed

### S5 - Conectores · 3 files · 17 KB · ~5k

**C27** - Cada rótulo de etapa ocupa uma linha a 1280 e 1440px (AC 27)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C27 connector steps never wrap"`
Status: closed

**C28** - Conteúdo mais alto que o espaço acima da linha de voz rola; nada é cortado (AC 28)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C28 a tall scene scrolls instead of clipping"`
Status: closed

**C29** - Conectores são cartões de vidro com orbe de estado, nome e propósito (AC 29)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C29 connectors are cards with a state orb"`
Status: closed

**C30** - Abrir um cartão expande as etapas no lugar e fecha outro aberto (AC 30)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C30 one connector open at a time"`
Status: closed

**C31** - "Auditar" é uma pílula no cabeçalho da cena (AC 31)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C31 audit is a pill in the header"`
Status: closed

### S6 - Artefatos e Gerações · 3 files · 32 KB · ~8k

**C32** - Exatamente um campo de busca em Artefatos e um em Gerações (AC 32)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C32 one search field per gallery"`
Status: closed

**C33** - Tipo, origem e período são chips (AC 33)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C33 gallery filters are chips"`
Status: closed

**C34** - Clicar num cartão abre o item como lâmina que nasce do cartão (AC 34)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C34 a gallery item opens from its tile"`
Status: closed

**C35** - Filtro sem resultado mostra "Nada aqui com esses filtros" e "Limpar filtros" (AC 35)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C35 an empty filter offers to clear"`
Status: closed

### S7 - agente em cada foco · 1 file · 34 KB · ~9k

**C36** - "Perguntar ao agente" num foco abre a conversa com o `@ref` do item na linha, em pendência, execução, habilidade, conector e artefato (AC 36)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/concept.spec.ts -g "C36 ask the agent carries the item"`
Status: closed

## Coverage

| Set (size)                               | Member -> proof                                                                                                                                   | Unproven |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| superfícies que herdam a linguagem (9)   | runs C1 · skills C1 · routines C1 · connectors C1 · artifacts C1 · generations C1 · pixel C1 · settings C1 · Resolver C1, table-driven over all 9 | -        |
| cenas sem `select` nativo (4)            | artifacts C2 · generations C2 · connectors C2 · skills C2, table-driven over all 4                                                                | -        |
| fechamentos de diálogo (2)               | Esc C4 · véu C4                                                                                                                                   | -        |
| temas de contraste (2)                   | dark C5 · light C5                                                                                                                                | -        |
| superfícies novas com contraste (6)      | Resolver C5 · conector aberto C5 · barra de habilidades C5 · barra das galerias C5 · visão da execução C5 · folha de diálogo C5, table-driven     | -        |
| avisos repetidos (2)                     | título idêntico C7 · aviso com e sem tradução C7                                                                                                  | -        |
| tipos de pendência no Resolver (7)       | question C9 · decision C9 · provider C9 · budget C9 · failure C6 C10 · routine C6 · notice C7 C8, C9 table-driven over the seeded kinds           | -        |
| agrupamentos de causa (2)                | falha dentro da rotina C6 · avisos de mesmo título C7                                                                                             | -        |
| resoluções de um item (5)                | aprovar C12 · negar C12 · responder C12 · executar de novo C12 · silenciar C12, table-driven over all 5                                           | -        |
| teclas de navegação do Resolver (5)      | ↓ C11 · ↑ C11 · j C11 · k C11 · clique C11                                                                                                        | -        |
| estados de Execuções (2)                 | visão geral C14 · foco C15                                                                                                                        | -        |
| seções da execução (3)                   | Resumo C16 C18 · Passos C16 C18 · Log C16 C18                                                                                                     | -        |
| ações do Resumo (3)                      | Executar de novo C17 · Continuar C17 · Perguntar ao agente C17                                                                                    | -        |
| saídas do foco da execução (2)           | Esc C19 · voltar C19                                                                                                                              | -        |
| itens do menu "+" de Habilidades (3)     | Marketplace C23 · Exportar C23 · Nova skill C23                                                                                                   | -        |
| diálogos de Habilidades (3)              | Marketplace C25 · Nova skill C25 · editor C25                                                                                                     | -        |
| larguras dos conectores (2)              | 1280 C27 · 1440 C27                                                                                                                               | -        |
| galerias (2)                             | Artefatos C32 C33 C35 · Gerações C32 C33 C35                                                                                                      | -        |
| filtros da galeria (3)                   | tipo C33 · origem C33 · período C33                                                                                                               | -        |
| focos com "Perguntar ao agente" (5)      | pendência C36 · execução C36 · habilidade C36 · conector C36 · artefato C36, table-driven over all 5                                              | -        |
| door 1: primitivas sob `.nu-shell` (1)   | C1                                                                                                                                                | -        |
| door 2: `PendingItem.also` / `count` (1) | C6 C7                                                                                                                                             | -        |

- Nenhuma rota de API é adicionada ou alterada (plan `Surface`: None)
- Nenhuma check afirma mais do que o caso que sua prova exercita, exceto as linhas table-driven acima, que declaram o tamanho

## Test policy

| Code                                                                     | Required proofs              | Coverage expectation                                |
| ------------------------------------------------------------------------ | ---------------------------- | --------------------------------------------------- |
| Decide, sem fronteira de API (agrupamento de pendências, rótulos do rio) | um no próprio nível (vitest) | um caso afirmado por regra de agrupamento / colisão |
| Tela (composição, estados, foco)                                         | um e2e por critério          | cada estado e cada membro enumerado acima           |
| CSS de linguagem                                                         | e2e por estilo computado     | table-driven por cena                               |

Evidence:

- `nucleo/pending/model.ts`: decide sobre 7 tipos, 11 pontos de ramificação -> decides; análogo já provado em `model.test.ts`
- `nucleo/scenes/runsRiver.ts`: decide posição e colisão -> decides; análogo em `runsRiver.test.ts`
- telas: análogo em `tests/e2e/nucleo-shell.spec.ts`, provado por e2e

Cost: 3 provas vitest novas, 1 spec e2e nova com 34 testes.

## Swept

- validation: n/a - nenhuma entrada nova do usuário além de busca e filtros, que já existiam
- failure modes: C10, C18 (erro uma vez), C26, C35 (estados vazios)
- idempotency: C6, C7 (a mesma causa não vira dois itens)
- authorization: n/a - serviço local de um usuário, sem login
- concurrency: existing - `usePending` recalcula a fila a cada consulta; C12 cobre o item que sai enquanto a fila muda
- data lifecycle: C8 (avisos antigos vão para o histórico)
- dependency failure: existing - `ServiceHealthBanner` e o anel de carregamento do hub
- state transitions: C14, C15, C19 (visão geral <-> foco), C12 (item resolvido -> próximo)
- observability: n/a - mudança de interface, sem requisito de log

## Handoff

- S1-S7 = 28k + 8k + 15k + 17k + 5k + 8k + 9k = 90k de arquivos tocados, mais ~15k da spec e2e nova = ~105k, abaixo do orçamento de 150k - um construtor
- Mechanism: one builder (cabe no orçamento)
