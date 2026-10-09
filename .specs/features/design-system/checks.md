# Design system checks

Profile: ui
Plan: `.specs/features/design-system/plan.md`

14 checks in 3 slices · 2 one-way doors · 0 open, of which 0 block

Comandos (da raiz): interface `npm run test -w apps/command-centre -- <arquivo> -t "<nome>"`; lint
`npm run lint`; e2e `npx playwright test --config tests/e2e/playwright.config.ts <spec> -g "<nome>"`.

Fora do alcance destes checks, por tela: espaçamento e peso de tipo (a feature só decide tamanho
mínimo, cor por token e acessibilidade); a composição das telas não muda.

## Checks

### S1 - piso de 12px · 20 files · 120 KB · ~30k

**C1** - `theme.css` define `--fs-2` a `--fs-8` e `--fs-hero`, e nenhum arquivo de `src` define ou usa `--fs-0` ou `--fs-1` (AC 1)
Proof: `npm run test -w apps/command-centre -- src/typography.test.ts -t "C1 the type scale starts at 12px"`
Status: closed

**C2** - Lendo cada CSS de `src` como árvore (postcss): nenhum `font-size` nem atalho `font:` abaixo de 12px, resolvendo tokens `--fs-*`, `px`, `rem`/`em` (16px de base) e `calc`/`clamp` com o menor valor; o teste se prova contra `font: 600 11px/1 x`, `font-size: .7rem`, `font-size: var(--fs-1)` e `clamp(10px, 1vw, 14px)` (AC 2)
Proof: `npm run test -w apps/command-centre -- src/typography.test.ts -t "C2 no CSS sets text below 12px"`
Status: closed

**C3** - Lendo os TSX/TS de `src` pela árvore sintática do TypeScript: nenhum `fontSize` em `style` abaixo de 12 e nenhuma atribuição a `ctx.font` com tamanho abaixo de 12px (AC 3)
Proof: `npm run test -w apps/command-centre -- src/typography.test.ts -t "C3 no inline or canvas text below 12px"`
Status: closed

**C4** - No navegador, o `font-size` computado de um `.badge` da galeria é `12px`, nos dois temas (AC 4)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/a11y.spec.ts -g "C4 badges read at 12px"`
Status: closed

### S2 - cores por token · 18 files · 110 KB · ~28k

**C5** - `npm run lint` roda o stylelint sobre `apps/command-centre/src/**/*.css` com `color-no-hex`, `color-named: never` e `function-disallowed-list` (rgb, rgba, hsl, hsla), e um arquivo temporário com `a { color: #fff }` faz o comando sair com código ≠ 0 (AC 5)
Proof: `npm run test -w apps/command-centre -- src/typography.test.ts -t "C5 the colour lint refuses a literal"`
Status: closed

**C6** - `npx stylelint "apps/command-centre/src/**/*.css"` sai `0` sobre a árvore (os literais de hoje viraram tokens ou `--mask-ink`), e os únicos trechos com a regra desligada são os blocos de definição de token de `theme.css` (`:root`, `[data-theme]`, `[data-preset]`) (AC 6)
Proof: `npm run test -w apps/command-centre -- src/typography.test.ts -t "C6 the tree passes the colour lint"`
Status: closed

**C7** - No navegador, com tema claro e preset `hud-orange`, o `color` computado de `.display-digits` e de `.hud-label.accent` não é o `--text` do JARVIS (`#cfe9ff`-família) e é igual ao token do tema claro; com o preset `jarvis` escuro, o JARVIS continua aplicado (AC 7)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/a11y.spec.ts -g "C7 the light theme keeps its own tokens"`
Status: closed

### S3 - acessibilidade e galeria · 8 files · 60 KB · ~15k

**C8** - axe (tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`) sem violação `serious`/`critical` na moldura: Hoje, Execuções, Skills, Rotinas, Memória, Configurações — tema escuro e claro (AC 8)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/a11y.spec.ts -g "C8 the app frame has no serious violation"`
Status: closed

**C9** - O mesmo no Núcleo: início, Execuções, Skills, Configurações — tema escuro e claro (AC 8)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/a11y.spec.ts -g "C9 the Núcleo has no serious violation"`
Status: closed

**C10** - A galeria tem as seções `#story-nucleo-layer` (primitivas dentro de `.nu-shell` com `luz.css` carregado) e `#story-frame-layer` (dentro de `[data-shell="moldura"]` com `moldura.css`), cada uma com botões, badges, campo e um diálogo (AC 9)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/gallery.spec.ts -g "C10 the gallery shows both layers"`
Status: closed

**C11** - `tests/e2e/gallery.spec.ts` passa inteiro em Linux, incluindo as duas seções novas, nos dois temas (AC 10)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/gallery.spec.ts`
Status: closed

**C12** - `tests/e2e/gallery-contrast.spec.ts` e `tests/e2e/surface-contrast.spec.ts` continuam passando (AC 8)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/gallery-contrast.spec.ts tests/e2e/surface-contrast.spec.ts`
Status: closed

**C13** - A suíte e2e completa não ganha nenhuma falha nova em relação à base (lista de antes e depois no relatório do build) (AC 1-10)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts`
Status: open

**C14** - `npm run typecheck`, `npm run lint` e a suíte da interface saem `0` (AC 1-10)
Proof: `npm run typecheck && npm run lint && npm run test -w apps/command-centre`
Status: closed

## Coverage

| Set (size)                                 | Member -> proof                                                                                                                                                                                              | Unproven |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| formas de tamanho de texto (6)             | `font-size` C2 · atalho `font:` C2 · token C1, C2 · rem/em C2 · `style` inline C3 · canvas C3                                                                                                                | -        |
| formas de cor literal (5)                  | hex C5, C6 · `rgb/rgba` C5, C6 · `hsl/hsla` C5, C6 · nome C5, C6 · máscara C6                                                                                                                                | -        |
| telas no axe, cada uma nos dois temas (10) | Hoje C8 · Execuções (moldura) C8 · Skills (moldura) C8 · Rotinas C8 · Memória C8 · Configurações (moldura) C8 · início do Núcleo C9 · Execuções (Núcleo) C9 · Skills (Núcleo) C9 · Configurações (Núcleo) C9 | -        |
| camadas na galeria (3)                     | base (existente) C11 · Núcleo C10, C11 · moldura C10, C11                                                                                                                                                    | -        |
| doors (2)                                  | piso da escala C1 · linter C5, C6                                                                                                                                                                            | -        |

## Binding sources

| Source                                    | Rules                                    | Checks |
| ----------------------------------------- | ---------------------------------------- | ------ |
| `.specs/features/design-system/design.md` | tipografia, cor, acessibilidade, galeria | C1-C11 |

## Test policy

| Code                             | Required proofs                     | Coverage expectation            |
| -------------------------------- | ----------------------------------- | ------------------------------- |
| Configuration (tokens, lint)     | a source check that reads the tree  | each form of size and colour    |
| Instrumentation (telas, galeria) | browser check (axe, computed style) | each listed screen, both themes |

Evidence:

- `theme.css` tokens and `typography.test.ts` -> configuration
- closest analogue in the repo: `tests/e2e/surface-contrast.spec.ts` (axe por rota nos dois temas)

Cost: testes estendidos em `typography.test.ts`, 1 spec e2e nova, galeria estendida, 14 provas.

## Swept

- validation: C5 (lint recusa literal)
- failure modes: C2, C3 (cada forma de burlar o piso)
- idempotency: n/a - nada é gravado
- authorization: n/a - nenhuma rota
- concurrency: n/a - nenhum estado
- data lifecycle: n/a - nada persiste
- dependency failure: n/a - stylelint é dependência de desenvolvimento; sem ele o lint falha alto
- state transitions: C7 (tema claro × preset)
- observability: n/a - nenhum requisito de log

## Handoff

- S1-S3 ≈ 73k: theme.css trechos 30 KB, 14 CSS com edições pontuais (~236 tamanhos, ~90 cores) lidos em trechos ~60 KB, typography.test 4 KB, galeria 10 KB, spec nova 8 KB, testes ~20 KB ≈ 132 KB / 4 ≈ 33k, mais e2e e revisão das capturas - abaixo de 150k - one builder
