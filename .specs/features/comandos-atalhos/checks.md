# Comandos e atalhos checks

Profile: ui
Plan: `.specs/features/comandos-atalhos/plan.md`

33 checks in 4 slices · 7 one-way doors · 0 open, of which 0 block

Comandos (da raiz): interface (jsdom) `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "<nome>"`
(registro, paleta, ajuda), `.../commands.screens.test.tsx` (as telas, as doors, as guardas) e `.../commands.source.test.ts`
(o que se lê na árvore sintática do código-fonte);
e2e `npx playwright test --config tests/e2e/playwright.config.ts <spec> -g "<nome>"`.

Fora do alcance destes checks, por tela: espaçamento, cor e peso de tipo da ajuda de atalhos e da
paleta (vêm dos tokens).

## Checks

### S1 - registro e gerenciador · 6 files · 50 KB · ~13k

**C1** - Um componente que chama `useCommands([cmd])` faz `cmd` aparecer no registro enquanto está montado e sumir ao desmontar (AC 1)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C1 commands live while their owner is mounted"`
Status: closed

**C2** - Com a mesma tecla `x` registrada em `global`, `nucleo`, `view:pixel`, `overlay` e `modal`, cada combinação de escopos ativos roda só o comando do escopo mais interno (tabela sobre as 5 posições) (AC 2)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C2 the innermost active scope wins"`
Status: closed

**C3** - Com o foco em `input`, `textarea`, `select` e num `contenteditable`, a tecla `p` não roda; um comando com `allowInInput` roda; `Mod+K` roda (AC 3)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C3 bare keys never fire while typing"`
Status: closed

**C4** - Com a plataforma simulada como Mac, `Mod+K` responde a ⌘K e não a Ctrl+K; simulada como Windows e Linux, responde a Ctrl+K e não a Win(meta)+K (AC 4)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C4 Mod is the platform's command key"`
Status: closed

**C5** - Registrar `Mod+K` duas vezes no escopo `global` lança um erro cujo texto tem os dois ids; o mesmo em escopos diferentes não lança (AC 5)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C5 a duplicate key in one scope is refused"`
Status: closed

**C6** - Com `when: () => false`, o comando não roda (a tecla vai ao escopo de baixo) e não aparece na paleta; com `true`, roda e aparece (AC 6)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C6 a disabled command falls through and hides"`
Status: closed

### S2 - paleta e ajuda · 6 files · 60 KB · ~15k

**C7** - Com a paleta aberta na moldura, as seções "Apps" e "Ações" listam exatamente os comandos registrados com `palette: true` para o shell (mesmos ids, mesma ordem de registro), e uma ação com teclas mostra a dica (`⌘K` simulando Mac, `Ctrl K` em outros) (AC 7)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C7 the palette lists the registered commands with their keys"`
Status: closed

**C8** - Skills, arquivos, execuções e as páginas aninhadas (painéis, temas, rodar skill) continuam na paleta como antes: a suíte de testes da paleta e o e2e `smoke.spec.ts` "launcher opens with Ctrl+M and searches skills" passam (AC 7)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/smoke.spec.ts -g "launcher opens with Ctrl\+M and searches skills"`
Status: closed

**C9** - A ajuda de atalhos mostra um bloco por escopo com teclas, na ordem Geral → shell → tela, cada linha com os chips e o título; o conjunto de linhas é exatamente o dos comandos com teclas registrados para o shell e a tela atuais, menos a tecla que um escopo interno também declara (AC 8, 17)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C9 the help lists exactly the registered keys by scope"`
Status: closed

**C10** - Na moldura, a ajuda não tem 1, `[`, `]`, `p` nem ⌘J; no Núcleo, tem os cinco; com Pixel Studio aberto, tem o bloco "Pixel Studio" (AC 9)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C10 the help follows the shell and the screen"`
Status: closed

**C11** - A lista escrita à mão saiu: `shell.shortcuts.desktop` (valores trocados entre `en` e `ptBR`) não existe em idioma nenhum, e toda chave `shell.shortcuts.*` que sobra é mostrada por alguma tela (AC 10)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.source.test.ts -t "C11"`
Status: closed

### S3 - conflitos e migração · 10 files · 110 KB · ~28k

**C12** - No Núcleo com Pixel Studio aberto, as teclas 2 e `]` trocam a ferramenta/quadro e a cena continua `pixel` (AC 11)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C12 Pixel Studio keys stay in Pixel Studio"`
Status: closed

**C13** - No Cérebro clássico, `p` liga a apresentação e o modo foco não abre; `/` foca a busca do Cérebro e não a linha de voz (AC 12)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C13 Second Brain keys stay in the Second Brain"`
Status: closed

**C14** - Com uma execução aberta numa lâmina e na cena de execuções ao mesmo tempo, `r` faz exatamente uma chamada de nova execução (AC 13)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C14 a run's r fires once"`
Status: closed

**C15** - Com a paleta aberta sobre o detalhe de uma skill, Ctrl+Enter roda só a ação secundária da paleta (a skill atrás não é chamada) (AC 14)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C15 Mod+Enter belongs to the open palette"`
Status: closed

**C16** - Lido pela árvore sintática do TypeScript, com autoteste do leitor (a página por qualquer nome: cópias, desestruturação, `body`, `documentElement`, `top`, `parent`, `globalThis`, `self`, a raiz por `getElementById`, laço sobre alvos; `addEventListener` por ponto, colchete, sem receptor, `bind`, `call`, `apply`, `Reflect.apply` e função-invólucro; `onkeydown` por `=`, `??=`, `||=`, `Object.assign`, `Reflect.set`; tipo em string, template, soma, constante do arquivo ou importada; e o que não é ouvinte da página): `App.tsx`, `nucleo/index.tsx`, `views/PixelStudio.tsx`, `views/SecondBrain.tsx`, `runs/RunDetail.tsx` e todo arquivo de `moldura/` não escutam `keydown` na página; os que sobram em `src` são exatamente os da allowlist, com contagem e motivo, e nenhum tem tipo de evento ilegível; nenhum arquivo define ou usa `RESET_LAYOUT_EVENT`, `SHORTCUTS_EVENT`, `OPEN_DECK_EVENT` nem o nome de um desses eventos. O limite é explícito: o leitor prova o que consegue ler; o que ele não vê (código que o arquivo não contém, um objeto passado de fora por um nome que não segue) a sonda de execução conta: desde antes do primeiro `import` do app, cada `keydown` posto em `window`, `document`, `body` e `documentElement`, em cada shell e cada tela, é exatamente um do registro mais os da allowlist (AC 15)
Proof: npm run test -w apps/command-centre -- src/commands/commands.source.test.ts -t "C16" && npm run test -w apps/command-centre -- src/commands/commands.probe.test.tsx
Status: closed

**C17** - e2e: `tests/e2e/nucleo-shell.spec.ts` "⌘⇧A and ⌘⇧D resolve the first decision from anywhere" passa (AC 16)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/nucleo-shell.spec.ts -g "resolve the first decision from anywhere"`
Status: closed

**C18** - e2e: `tests/e2e/nucleo-shell.spec.ts` "the voice line is in every scene, in the same place, and / reaches it" e "opens focus by click, by P" passam (AC 16)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/nucleo-shell.spec.ts -g "reaches it|opens focus by click"`
Status: closed

**C19** - e2e: `tests/e2e/smoke.spec.ts` "a modal's Escape is its own" e `tests/e2e/desktop-context.spec.ts` (⌘F) passam (AC 16)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/smoke.spec.ts tests/e2e/desktop-context.spec.ts -g "Escape is its own|search"`
Status: closed

**C20** - e2e: `tests/e2e/desktop-intel.spec.ts` (deck por ⌘J) e `tests/e2e/onboarding.spec.ts` "command palette reopens a completed guide" passam (AC 16)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/desktop-intel.spec.ts tests/e2e/onboarding.spec.ts -g "deck|reopens a completed guide"`
Status: closed

**C21** - e2e: `tests/e2e/moldura.spec.ts` passa inteiro (⌘. e Esc da moldura) (AC 16)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/moldura.spec.ts`
Status: closed

**C22** - `npm run typecheck` e a suíte da interface saem `0` (AC 1-16)
Proof: `npm run typecheck && npm run test -w apps/command-centre`
Status: closed

### S4 - correções da rodada 1 da verificação · 5 files · 90 KB · ~22k

**C23** - Com um diálogo da pilha aberto (com ou sem comando em `modal`), ou a tecla vinda de dentro de um `role="dialog"` modal, ou o escopo `overlay` seguro à mão, as teclas de `global`, shell e tela não recebem nada e as do próprio escopo da camada rodam; ao sair a camada, voltam; um popover (`aria-modal="false"`) não é camada (door 4)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.screens.test.tsx -t "C23"`
Status: closed

**C24** - Um `CommandsGate enabled={false}` tira do registro o que está dentro e `true` o devolve; de duas instâncias com a mesma chave `exclusive` só a mais nova registra e, ao sair, a mais velha assume; no Núcleo, a cena que está saindo (650 ms) não responde (a tecla `2` logo depois de sair do Pixel Studio viaja de cena, não troca a ferramenta) e a lâmina que se dissolve perde as teclas da sua tela (`runs.again` sai do registro enquanto ela ainda é desenhada) (door 5)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.screens.test.tsx -t "C24"`
Status: closed

**C25** - Na moldura estreita, com a gaveta da conversa aberta, ⌘. / Ctrl . a fecha e a abre; com a paleta aberta por cima da gaveta, ⌘. não fecha a gaveta (door 6)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C25 the narrow chat drawer"`
Status: closed

**C26** - No Pixel Studio aberto no Núcleo, cada tecla faz o que diz, uma tabela que aperta e lê o efeito: 1, 2, 3, 4 (ferramenta), `=`/`+` e `-`/`_` (pincel), `x` (cores), `o` (onion), ⌘Z, ⌘⇧Z e ⌘Y (desfazer/refazer, e não dentro de um campo), `[` `]` (quadros, em C12) e Esc (pergunta antes de sair com pixels não salvos, e não pergunta com o foco num campo; sem pixels, vai para o início), sem a cena sair de `pixel` (AC 11)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.screens.test.tsx -t "C26"`
Status: closed

**C27** - No Cérebro clássico, cada tecla faz o que diz: ⌘= / ⌘+ aproxima, ⌘- afasta, ⌘0 volta (o que a câmera recebe), `f` liga e desliga o modo local, `l` os nomes dos arquivos, `/` desdobra o painel dobrado ou sai da apresentação e foca a busca uma vez só (não de novo ao dobrar e desdobrar), e Esc fecha a lista, depois a apresentação, e só então é do shell (AC 12)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.screens.test.tsx -t "C27"`
Status: closed

**C28** - Numa execução, `/` foca a busca do registro, `c` abre e foca o seguir e `r` chama a nova execução uma vez, e `r`/`c` num campo são texto; na página de uma skill, ⌘Enter a executa (da página e de um campo), Enter e Ctrl+Shift+Enter não, e enquanto ela roda a tecla não é outra execução (AC 13)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.screens.test.tsx -t "C28"`
Status: closed

**C29** - No Núcleo: 1-5 e `[` `]` viajam entre as cenas; Esc dobra a conversa, depois fecha a busca (⌘F) — a conversa primeiro quando as duas estão abertas —, depois dispensa a lâmina, depois volta ao início; com uma lâmina e o deck abertos, o Esc fecha o deck e a lâmina fica; ⌘J abre o deck e a mesma tecla o fecha, Ctrl+Shift+J não; ⌘⇧A e ⌘⇧D só respondem com uma decisão esperando (AC 16)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.screens.test.tsx -t "C29"`
Status: closed

**C30** - Uma tecla já tratada (`defaultPrevented`), parte de uma composição de IME (`isComposing`, `keyCode` 229) ou apertada com o guia aberto não roda comando; o Shift faz parte da tecla da letra: Ctrl+Shift+J não é ⌘J, Ctrl+A não é ⌘⇧A, Shift+P não é `p` e Caps Lock P é (AC 18)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.screens.test.tsx -t "C30"`
Status: closed

**C31** - `"1"` casa a tecla que digita "1" com ou sem Shift (AZERTY) e `"Shift+1"` a tecla física com Shift; no Núcleo, um 1 de AZERTY viaja, Shift+P não abre o modo foco e Caps Lock P abre; Ctrl+M abre e fecha a paleta no Mac, onde Ctrl+K não abre e ⌘M abre; Esc só vai para o início fora do início e só no Núcleo (AC 18, 19; plan Assumptions)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.screens.test.tsx -t "C31"`
Status: closed

**C32** - Com a paleta aberta, cada uma das cinco ações que falam com o servidor fecha a paleta antes de o servidor responder e, ao responder, avisa com o texto e o tom certos e faz o que diz: reindexar (aviso `ok`, chamada ao índice), backup (aviso com o nome, `ok`, chamada), diagnóstico (aviso `ok` ou, com falhas, `danger`; navega para Configurações), tema (aviso com o tema oposto ao de agora, `ok`, nas duas direções; `putSettings` com ele) e trocar de interface (aviso `ok`; `putUiPreferences` com a outra); uma falha de qualquer das cinco vira um aviso de erro que nomeia a ação, com a paleta fechada; a linha "Abrir o deck" da moldura abre o deck (AC 20, AD-014)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.screens.test.tsx -t "C32"`
Status: closed

**C33** - Com Pixel Studio aberto no Núcleo, a ajuda mostra 1-4, `[`, `]` e Esc uma vez, no bloco do Pixel, e as linhas que perderam todas as teclas saem; no início, Esc é só o do Núcleo; Ctrl+K e Ctrl+M são um grupo de chips fora do Mac, ⌘K, ⌘M e ⌃M no Mac (AC 17)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.screens.test.tsx -t "C33"`
Status: closed

## Coverage

| Set (size)                                     | Member -> proof                                                                                                                                                                                                                                                | Unproven |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| escopos (6)                                    | `global` C2 · `nucleo` C2 · `view` C2 · `overlay` C2, C23 · `modal` C2, C23 · `moldura` C25                                                                                                                                                                    | -        |
| alvos de digitação (4)                         | `input` C3 · `textarea` C3 · `select` C3 · `contenteditable` C3                                                                                                                                                                                                | -        |
| plataformas (3)                                | Mac C4 · Windows C4 · Linux C4                                                                                                                                                                                                                                 | -        |
| ouvintes migrados (6)                          | `App.tsx` C16 · `nucleo/index.tsx` C16 · `moldura/Moldura.tsx` C16 · `PixelStudio.tsx` C16 · `SecondBrain.tsx` C16 · `RunDetail.tsx` C16                                                                                                                       | -        |
| ouvintes de teclado que ficam na página (11)   | `commands/registry.ts` C16 · `dialog.tsx` C16 · `primitives.tsx` C16 · `FocusMode.tsx` C16 · `useTourSurface.ts` C16 · `Replay.tsx` C16 · `SkillsScene.tsx` C16 · `BrainScene.tsx` C16 · `RunsScene.tsx` C16 · `RoutinesScene.tsx` C16 · `NucleoScene.tsx` C16 | -        |
| conflitos do inventário (5)                    | 1–4/`[ ]` C12, C26 · `p` C13 · `/` C13, C28 · `r`/`c` C14, C28 · ⌘Enter C15, C28                                                                                                                                                                               | -        |
| teclas migradas do Pixel Studio (14)           | 1 C26 · 2 C26 · 3 C26 · 4 C26 · `=` C26 · `+` C26 · `-` C26 · `_` C26 · `x` C26 · `o` C26 · ⌘Z C26 · ⌘⇧Z C26 · ⌘Y C26 · Esc C26                                                                                                                                | -        |
| teclas migradas do Cérebro (8)                 | ⌘= C27 · ⌘+ C27 · ⌘- C27 · ⌘0 C27 · `f` C27 · `l` C27 · Esc C27 · `/` C27                                                                                                                                                                                      | -        |
| teclas migradas de Execuções e Habilidades (4) | `/` C28 · `c` C28 · `r` C14, C28 · ⌘Enter C15, C28                                                                                                                                                                                                             | -        |
| teclas do Núcleo (10)                          | 1–5 C29 · `[ ]` C29 · `/` C18 · `p` C18 · ⌘F C29 · Esc C29 · ⌘J C29 · ⌘⇧A C17, C29 · ⌘⇧D C17, C29 · ⌘J dentro do deck C29                                                                                                                                      | -        |
| comportamentos de teclado no e2e (8)           | palette C8 · Esc modal C19 · ⌘F C19 · ⌘J C20 · palette reabre o guia C20 · ⌘⇧A/⌘⇧D C17 · `/` e `p` C18 · moldura C21                                                                                                                                           | -        |
| guardas do gerenciador (8)                     | `defaultPrevented` C30 · IME C30 · guia aberto C30 · Shift em letra C30 · Shift+P C30, C31 · dígito de AZERTY C31 · Ctrl+M no Mac C31 · Esc em `/` C31                                                                                                         | -        |
| blocos da ajuda (4)                            | Geral C9 · shell C9, C10 · tela C10 · tecla coberta por escopo interno C33                                                                                                                                                                                     | -        |
| doors (7)                                      | forma de `Command` C1, C6, C7 · ordem dos escopos C2 · modificador C4 · camadas C23 · instância única e `CommandsGate` C24 · quem registra na moldura C25 · dígitos e Shift C30, C31                                                                           | -        |
| ações da paleta que falam com o servidor (5)   | reindexar C32 · backup C32 · diagnóstico C32 · tema C32 · trocar de interface C32                                                                                                                                                                              | -        |

## Binding sources

| Source                                       | Screens / sets                                      | Checks                   |
| -------------------------------------------- | --------------------------------------------------- | ------------------------ |
| `.specs/features/comandos-atalhos/design.md` | inventário (6 ouvintes, 5 conflitos), ajuda, paleta | C7-C10, C12-C16, C23-C33 |

## Test policy

| Code                                                 | Required proofs               | Coverage expectation                     |
| ---------------------------------------------------- | ----------------------------- | ---------------------------------------- |
| Decides, not reached across a boundary (gerenciador) | one at its own layer          | each scope, target, platform             |
| Instrumentation (telas migradas, ajuda, paleta)      | render test + e2e + AST check | each listener, conflict and migrated key |

Evidence:

- `commands/keys.ts`: tecla × escopos ativos × foco × plataforma -> decides
- closest analogue in the repo: `components/paletteMatch.test.ts` (unidade) e `tests/e2e/nucleo-shell.spec.ts` (teclado no navegador)

Cost: 2 arquivos de teste de interface (+ o `testkit` que dividem), 1 que lê a árvore do código, e2e existentes, 33 provas.

## Swept

- validation: C5 (conflito de registro), C30 (tecla de IME, já tratada ou do guia)
- failure modes: C6 (comando desligado cai para o escopo de baixo)
- idempotency: C14, C24 (uma tecla, uma ação, uma instância)
- authorization: n/a - nenhuma rota nova; os comandos chamam a API como antes
- concurrency: n/a - um ouvinte, eventos em ordem
- data lifecycle: C1 (registro some ao desmontar)
- dependency failure: C32 (o servidor falha ou demora: a paleta já fechou, o aviso diz qual ação)
- state transitions: C10, C33 (ajuda muda com o shell e a tela), C23 (diálogo entra e sai)
- observability: n/a - nenhum requisito de log

## Handoff

- S1-S3 ≈ 56k: CommandPalette.tsx 30 KB, ShortcutsHelp 4 KB, App.tsx trechos 8 KB, nucleo/index.tsx trechos 15 KB, Moldura 8 KB, PixelStudio/SecondBrain/RunDetail trechos 20 KB, novos 15 KB, testes ~30 KB ≈ 130 KB / 4 ≈ 33k, mais e2e - abaixo de 150k - one builder
- S4 (rodada 1 da verificação) ≈ 22k, um construtor. Boundary: as doors 4-7, as 22 teclas migradas sem prova, as guardas, o C16 cego a alias, as regressões e as decisões AD-014 (STATE.md)
- Edição de proof depois da aprovação: o C8 passou de `-g "launcher opens with Ctrl+M and searches skills"` para `-g "launcher opens with Ctrl\+M and searches skills"` (o `+` é quantificador no `-g`, que é uma expressão regular: sem o escape o filtro não casa teste nenhum). O claim não mudou
- Mudanças de C-checks aprovados na S4, por pedido do orquestrador: C9 (AC 17), C11 (a chave sai, AC 10 muda) e C16 (leitor endurecido, allowlist, `OPEN_DECK_EVENT`); os testes de C11 e C16 foram para `commands.source.test.ts`
- Baseline do ambiente, não da feature (idêntico no commit-base, 2f22034): C20 e C57 de `moldura.spec.ts` falham em `page.reload()` com a tela "Pair this device", então a proof do C21 não sai 0 inteira neste ambiente; C17-C20 e as specs de `nucleo-shell` estouram os 5 s do `.boot-screen` e os 30 s do teste (Chromium sem GPU, ~3 quadros por segundo): passam com `timeout` 150 s e `expect.timeout` 40 s numa configuração temporária não comitada
- Abandonado: nada. Decidido: migrar os 13 ouvintes locais restantes (em 11 arquivos) fica para a próxima rodada (plan, Out of scope)
- Rodada 2 da verificação (FAIL): C32 passa a provar o sucesso das cinco ações da paleta (texto, tom e efeito; trocar de interface ganhou o aviso de sucesso, `moldura.palette.switched*`) e a linha "Abrir o deck" da moldura; C24 prova a lâmina que se dissolve; C26-C29 provam os ramos de guarda (Esc em campo, `/` uma vez, ⌘Enter com a execução rodando, Esc sob o deck, conversa antes da busca); duas guardas redundantes saíram do código (`isTypingTarget` no Esc do Pixel, `!deckOpen` no Esc do Núcleo: o gerenciador já fazia isso); C16 ganhou o leitor endurecido, o limite explícito e a sonda de execução (`commands.probe.test.tsx`). AD-014 e as cinco decisões ficaram em "Perguntas ao dono" (STATE.md), pendentes de aceite do dono
