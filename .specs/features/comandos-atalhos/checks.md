# Comandos e atalhos checks

Profile: ui
Plan: `.specs/features/comandos-atalhos/plan.md`

22 checks in 3 slices · 3 one-way doors · 0 open, of which 0 block

Comandos (da raiz): interface (jsdom) `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "<nome>"`;
e2e `npx playwright test --config tests/e2e/playwright.config.ts <spec> -g "<nome>"`.

Fora do alcance destes checks, por tela: espaçamento, cor e peso de tipo da ajuda de atalhos e da
paleta (vêm dos tokens).

## Checks

### S1 - registro e gerenciador · 6 files · 50 KB · ~13k

**C1** - Um componente que chama `useCommands([cmd])` faz `cmd` aparecer no registro enquanto está montado e sumir ao desmontar (AC 1)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C1 commands live while their owner is mounted"`
Status: open

**C2** - Com a mesma tecla `x` registrada em `global`, `nucleo`, `view:pixel`, `overlay` e `modal`, cada combinação de escopos ativos roda só o comando do escopo mais interno (tabela sobre as 5 posições) (AC 2)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C2 the innermost active scope wins"`
Status: open

**C3** - Com o foco em `input`, `textarea`, `select` e num `contenteditable`, a tecla `p` não roda; um comando com `allowInInput` roda; `Mod+K` roda (AC 3)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C3 bare keys never fire while typing"`
Status: open

**C4** - Com a plataforma simulada como Mac, `Mod+K` responde a ⌘K e não a Ctrl+K; simulada como Windows e Linux, responde a Ctrl+K e não a Win(meta)+K (AC 4)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C4 Mod is the platform's command key"`
Status: open

**C5** - Registrar `Mod+K` duas vezes no escopo `global` lança um erro cujo texto tem os dois ids; o mesmo em escopos diferentes não lança (AC 5)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C5 a duplicate key in one scope is refused"`
Status: open

**C6** - Com `when: () => false`, o comando não roda (a tecla vai ao escopo de baixo) e não aparece na paleta; com `true`, roda e aparece (AC 6)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C6 a disabled command falls through and hides"`
Status: open

### S2 - paleta e ajuda · 6 files · 60 KB · ~15k

**C7** - Com a paleta aberta na moldura, as seções "Apps" e "Ações" listam exatamente os comandos registrados com `palette: true` para o shell (mesmos ids, mesma ordem de registro), e uma ação com teclas mostra a dica (`⌘K` simulando Mac, `Ctrl K` em outros) (AC 7)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C7 the palette lists the registered commands with their keys"`
Status: open

**C8** - Skills, arquivos, execuções e as páginas aninhadas (painéis, temas, rodar skill) continuam na paleta como antes: a suíte de testes da paleta e o e2e `smoke.spec.ts` "launcher opens with Ctrl+M and searches skills" passam (AC 7)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/smoke.spec.ts -g "launcher opens with Ctrl+M and searches skills"`
Status: open

**C9** - A ajuda de atalhos mostra um bloco por escopo com teclas, na ordem Geral → shell → tela, cada linha com os chips e o título; o conjunto de linhas é exatamente o dos comandos com teclas registrados para o shell e a tela atuais (AC 8)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C9 the help lists exactly the registered keys by scope"`
Status: open

**C10** - Na moldura, a ajuda não tem 1, `[`, `]`, `p` nem ⌘J; no Núcleo, tem os cinco; com Pixel Studio aberto, tem o bloco "Pixel Studio" (AC 9)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C10 the help follows the shell and the screen"`
Status: open

**C11** - `shell.shortcuts.desktop` é "Scenes" em `en` e "Cenas" em `ptBR` (AC 10)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C11 the scenes heading reads right in both languages"`
Status: open

### S3 - conflitos e migração · 10 files · 110 KB · ~28k

**C12** - No Núcleo com Pixel Studio aberto, as teclas 2 e `]` trocam a ferramenta/quadro e a cena continua `pixel` (AC 11)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C12 Pixel Studio keys stay in Pixel Studio"`
Status: open

**C13** - No Cérebro clássico, `p` liga a apresentação e o modo foco não abre; `/` foca a busca do Cérebro e não a linha de voz (AC 12)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C13 Second Brain keys stay in the Second Brain"`
Status: open

**C14** - Com uma execução aberta numa lâmina e na cena de execuções ao mesmo tempo, `r` faz exatamente uma chamada de nova execução (AC 13)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C14 a run's r fires once"`
Status: open

**C15** - Com a paleta aberta sobre o detalhe de uma skill, Ctrl+Enter roda só a ação secundária da paleta (a skill atrás não é chamada) (AC 14)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C15 Mod+Enter belongs to the open palette"`
Status: open

**C16** - Lido pela árvore sintática do TypeScript: `App.tsx`, `nucleo/index.tsx`, `moldura/Moldura.tsx`, `views/PixelStudio.tsx`, `views/SecondBrain.tsx` e `runs/RunDetail.tsx` não chamam `addEventListener("keydown"…)` nem `onKeyDown` em `window`/`document`; nenhum arquivo de `src` (fora de testes) define ou usa `RESET_LAYOUT_EVENT` ou `SHORTCUTS_EVENT` (AC 15)
Proof: `npm run test -w apps/command-centre -- src/commands/commands.test.tsx -t "C16 the migrated screens own no keydown listener"`
Status: open

**C17** - e2e: `tests/e2e/nucleo-shell.spec.ts` "⌘⇧A and ⌘⇧D resolve the first decision from anywhere" passa (AC 16)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/nucleo-shell.spec.ts -g "resolve the first decision from anywhere"`
Status: open

**C18** - e2e: `tests/e2e/nucleo-shell.spec.ts` "the voice line is in every scene, in the same place, and / reaches it" e "opens focus by click, by P" passam (AC 16)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/nucleo-shell.spec.ts -g "reaches it|opens focus by click"`
Status: open

**C19** - e2e: `tests/e2e/smoke.spec.ts` "a modal's Escape is its own" e `tests/e2e/desktop-context.spec.ts` (⌘F) passam (AC 16)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/smoke.spec.ts tests/e2e/desktop-context.spec.ts -g "Escape is its own|search"`
Status: open

**C20** - e2e: `tests/e2e/desktop-intel.spec.ts` (deck por ⌘J) e `tests/e2e/onboarding.spec.ts` "command palette reopens a completed guide" passam (AC 16)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/desktop-intel.spec.ts tests/e2e/onboarding.spec.ts -g "deck|reopens a completed guide"`
Status: open

**C21** - e2e: `tests/e2e/moldura.spec.ts` passa inteiro (⌘. e Esc da moldura) (AC 16)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/moldura.spec.ts`
Status: open

**C22** - `npm run typecheck` e a suíte da interface saem `0` (AC 1-16)
Proof: `npm run typecheck && npm run test -w apps/command-centre`
Status: open

## Coverage

| Set (size)                           | Member -> proof                                                                                                      | Unproven |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | -------- |
| escopos (5)                          | C2, table-driven over all 5                                                                                          | -        |
| alvos de digitação (4)               | `input` C3 · `textarea` C3 · `select` C3 · `contenteditable` C3                                                      | -        |
| plataformas (3)                      | Mac C4 · Windows C4 · Linux C4                                                                                       | -        |
| ouvintes migrados (6)                | C16, table-driven over all 6                                                                                         | -        |
| conflitos do inventário (5)          | 1–4/`[ ]` C12 · `p` C13 · `/` C13 · `r`/`c` C14 · ⌘Enter C15                                                         | -        |
| comportamentos de teclado no e2e (8) | palette C8 · Esc modal C19 · ⌘F C19 · ⌘J C20 · palette reabre o guia C20 · ⌘⇧A/⌘⇧D C17 · `/` e `p` C18 · moldura C21 | -        |
| blocos da ajuda (3)                  | Geral C9 · shell C9, C10 · tela C10                                                                                  | -        |
| doors (3)                            | forma de `Command` C1, C6, C7 · ordem dos escopos C2 · modificador C4                                                | -        |

## Binding sources

| Source                                       | Screens / sets                                      | Checks          |
| -------------------------------------------- | --------------------------------------------------- | --------------- |
| `.specs/features/comandos-atalhos/design.md` | inventário (6 ouvintes, 5 conflitos), ajuda, paleta | C7-C10, C12-C16 |

## Test policy

| Code                                                 | Required proofs               | Coverage expectation         |
| ---------------------------------------------------- | ----------------------------- | ---------------------------- |
| Decides, not reached across a boundary (gerenciador) | one at its own layer          | each scope, target, platform |
| Instrumentation (telas migradas, ajuda, paleta)      | render test + e2e + AST check | each listener and conflict   |

Evidence:

- `commands/keys.ts`: tecla × escopos ativos × foco × plataforma -> decides
- closest analogue in the repo: `components/paletteMatch.test.ts` (unidade) e `tests/e2e/nucleo-shell.spec.ts` (teclado no navegador)

Cost: 1 arquivo de teste de interface, e2e existentes, 22 provas.

## Swept

- validation: C5 (conflito de registro)
- failure modes: C6 (comando desligado cai para o escopo de baixo)
- idempotency: C14 (uma tecla, uma ação)
- authorization: n/a - nenhuma rota nova; os comandos chamam a API como antes
- concurrency: n/a - um ouvinte, eventos em ordem
- data lifecycle: C1 (registro some ao desmontar)
- dependency failure: n/a - nenhuma dependência nova
- state transitions: C10 (ajuda muda com o shell e a tela)
- observability: n/a - nenhum requisito de log

## Handoff

- S1-S3 ≈ 56k: CommandPalette.tsx 30 KB, ShortcutsHelp 4 KB, App.tsx trechos 8 KB, nucleo/index.tsx trechos 15 KB, Moldura 8 KB, PixelStudio/SecondBrain/RunDetail trechos 20 KB, novos 15 KB, testes ~30 KB ≈ 130 KB / 4 ≈ 33k, mais e2e - abaixo de 150k - one builder
