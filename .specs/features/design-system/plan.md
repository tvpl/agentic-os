# Design system — um piso de tipografia, cores só por token e um portão de acessibilidade

## Problem

A interface tem 19,4 mil linhas de CSS em 15 arquivos e nenhuma regra que segure o básico. Cerca de
236 declarações de fonte ficam abaixo de 12px (89 delas em 10px), inclusive texto que se lê e se
clica: botões do console (`desktop.css:1576`), títulos de decisão (`:1924`), rótulos de grupo das
Configurações (`apps.css:764`) e as pílulas do tour (`onboarding.css:163`). Os badges são 11px em todo
lugar. Para um produto vendido a quem passa o dia nele, isso é cansaço de leitura e um problema de
acessibilidade.

Há cerca de 90 cores escritas à mão no CSS fora dos tokens (39 só em `nucleo.css`), e nenhum lint
impede a próxima. Um bug já mostra o custo: em `theme.css:209-213` uma regra sem corpo
(`[data-theme="light"] .display-digits, … .hud-label.accent,`) cai na lista de seletores do preset
JARVIS, e no tema claro esses dois elementos recebem os tokens escuros do JARVIS.

A galeria de primitivas, que deveria segurar a aparência, está vermelha há um mês: as 9 capturas de
Linux são de 02/09, e o tema e a galeria mudaram depois (a seção de widgets virou "lâminas"). Ela
também não cobre a camada do Núcleo (`luz.css`) nem a moldura de app. O axe completo (WCAG A/AA) só
roda em quatro testes; nenhuma rota da moldura passa por ele.

Evidência: levantamento do design system de 07/10/2026 (nesta sessão), com contagens por arquivo.

## Flow

Reutiliza os tokens de `apps/command-centre/src/theme.css` (exists), o teste `typography.test.ts`
(exists), a galeria (`gallery.html`, `gallery/main.tsx`, exist) e o axe em e2e
(`@axe-core/playwright`, exists).

1. Tipografia → `theme.css` perde `--fs-0` e `--fs-1` (door 1); cada uso passa a `--fs-2` ou maior, e
   texto corrido a `--fs-3`. `typography.test.ts` passa a recusar qualquer tamanho abaixo de 12px:
   literal, token, atalho `font:`, `style` inline e canvas.
2. Cor → `stylelint` (new, door 2) com as regras de `design.md`, rodando no `npm run lint` e no
   lint-staged; os literais fora dos blocos de token viram tokens, e as máscaras usam `--mask-ink`.
3. Bug → a regra sem corpo de `theme.css:209-213` (exists) ganha o corpo que o comentário descreve (o tema claro
   desenha com linha e tinta, sem brilho).
4. Acessibilidade → `tests/e2e/a11y.spec.ts` (new) roda o axe WCAG 2 A/AA nas telas principais das duas
   interfaces e dos dois temas, e falha em `serious`/`critical`.
5. Galeria → seções novas com as primitivas dentro de `.nu-shell` (exists) e de `[data-shell="moldura"]`; as
   capturas de Linux são regeradas e revisadas.

## Impact

| Front       | What changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| domain      | termo existente: escala de tipo - perde os dois degraus abaixo de 12px                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| domain      | novo termo: `--mask-ink` - o preto opaco das máscaras CSS, como token                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| domain      | novos termos, todos em `theme.css`: `--shadow-ink`, `--highlight-ink`, `--paper` (tintas neutras de sombra, brilho e folha branca), `--blue`, `--violet` (matizes categóricos de família de modelo e tipo de executor) e `--agent-contrast` (texto sobre `--agent`)                                                                                                                                                                                                                                                                                                                                                            |
| screen      | mudanças de comportamento que o piso e o gate de acessibilidade tornaram necessárias, fora do plano inicial: `.cons-h.dim` removido (a etiqueta de contexto vazia não esmaece mais), `.inbox-row.read` deixa de ser opacidade e passa a título em `--text-dim` e peso 400, `.kind-off` e `.dimmed` da legenda da Memória passam de opacidade a cor de token e tachado, os estados de seleção só de cor ganham sublinhado, barra ou anel (C16), a guarda `:not([data-shell="moldura"] *)` nas regras de diálogo de `luz.css` (a galeria mostra as duas camadas numa página), 33 regras de texto corrido de 12px para 13px (C15) |
| screen      | o canvas do cérebro: contagens de planeta, nomes de hub, nome do núcleo e rótulos de anel medem no mínimo 12px na tela em qualquer zoom (a contagem do planeta some abaixo de 0.5 de zoom), as iniciais dos apps são desenhadas ao vivo e não mais assadas no sprite (e somem quando o hexágono não as comporta), nome de hub 14px/800 e núcleo 13px/800 sobre contagens 12px/600 (hierarquia acima do piso), halo na cor da página sob esses textos, e nomes de anel, núcleo e hubs partilham o mesmo colocador de colisão                                                                                                    |
| screen      | marcas de estado da rodada 2, fora do plano inicial: `.cons-ctl .ro` aberto ganha sublinhado, `.bs-more` aberto ganha barra, a faixa pausada do mostrador de Rotinas ganha traço tracejado e a focada, linha mais grossa (C16); seis descrições de 12px para 13px (`.cx-purpose`, `.deck-focus-desc`, `.sentinel-hint`, `.fact-text`, `.apps-approval .desc`, C15, C18)                                                                                                                                                                                                                                                        |
| test        | `src/testing/`: leitores de CSS e TS (`sizeScan`, `stateScan`) e um canvas de gravação (`canvasText`) que mede o texto na tela; nenhum código de produção os importa                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| test        | rodada 2: `src/testing/fontSize.ts` (unidades e palavras-chave de fonte, partilhadas pelo leitor de fonte e pelo canvas de gravação, que agora também registra o arquivo que desenhou cada texto); varredura da árvore por configuração avulsa do stylelint; prova de texto corrido na tela em `tests/e2e/a11y.spec.ts` (C18)                                                                                                                                                                                                                                                                                                  |
| contrato    | nenhum na API; no repositório, `npm run lint` passa a rodar o stylelint, com `--config stylelint.config.mjs` fixo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| stored data | nada a migrar                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Relations

None - no stored-data shape change

## Surface

None - no API, CLI or file surface changes; the screens are in Observable

## Landing

| One-way door              | Literal shape                                                                                                                                                                                                                 | Alternative rejected                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Piso da escala de tipo | a escala começa em `--fs-2` (12px); `--fs-0` e `--fs-1` são removidos de `theme.css`, sem apelido                                                                                                                             | Manter `--fs-0`/`--fs-1` apontando para 12px: o nome continuaria prometendo um tamanho menor, e um tema poderia voltar a baixá-lo                           |
| 2. Linter de CSS          | `stylelint` com `stylelint-config-standard` e as regras `color-no-hex`, `color-named: "never"`, `function-disallowed-list: [rgb, rgba, hsl, hsla]`, desligadas só nos blocos de definição de token por um comentário de bloco | Um teste próprio com regex: já existe para tamanho de fonte e não pega o atalho `font:`; o stylelint lê o CSS como árvore e é o que a equipe de CSS conhece |

The shape of door 2 above is the minimum. The config in the tree is a superset, added after the first
verification and not a change of the door: all colour functions (`rgb`, `rgba`, `hsl`, `hsla`, `hwb`, `lab`,
`lch`, `oklab`, `oklch`, `color`, `device-cmyk`), a value ban for `url(data:…)` and for the CSS system colours
in every property that takes a colour, and the command line pins `--config stylelint.config.mjs` so that no
stray config file can replace it (C5, C6). Rejected alternative: leaving config discovery on, since a
`.stylelintrc` in a subfolder silently turns the rule off for that folder.

- Nothing else in this change is hard to reverse

## Criteria

### S1: Nenhum texto abaixo de 12px (P1)

**Acceptance Criteria**

1. The type scale in `theme.css` SHALL start at `--fs-2` (12px) and SHALL NOT define `--fs-0` nor `--fs-1`
2. The CSS of the Command Centre SHALL NOT set a text size below 12px through `font-size`, the `font` shorthand, a token or a relative unit that resolves below 12px
3. The TSX of the Command Centre SHALL NOT set an inline `fontSize` below 12, and the canvas text it draws SHALL NOT use a size below 12px
4. The `.badge` text SHALL be 12px

**Independent test:** o teste de tipografia falha se alguém escrever `font: 600 11px/1 var(--font)`.

### S2: Cores só por token (P1)

**Acceptance Criteria**

5. WHEN `npm run lint` runs THEN stylelint SHALL check every CSS file of the Command Centre and fail on a colour literal outside the token definition blocks
6. The CSS of the Command Centre SHALL pass that check (the ~90 literals of today replaced by tokens or `--mask-ink`)
7. WHILE the light theme is active, `.display-digits` and `.hud-label.accent` SHALL NOT take the JARVIS preset tokens (the empty rule at `theme.css:209-213` fixed)

**Independent test:** escrever `color: #fff` num arquivo CSS faz o lint falhar.

### S3: Acessibilidade e galeria (P1)

**Acceptance Criteria**

8. WHEN the a11y e2e spec runs THEN axe (WCAG 2 A and AA rules) SHALL report no `serious` nor `critical` violation on: in the app frame, Today, Runs, Skills, Routines, Memory, Settings; in the Núcleo, the home, Runs, Skills, Settings; each in the dark and the light theme
9. The gallery SHALL include a section rendering the primitives inside the Núcleo layer and one inside the app frame
10. The gallery screenshot tests SHALL pass on Linux with baselines regenerated by this feature

**Independent test:** a suíte e2e de acessibilidade e a da galeria passam.

## Out of scope

| Excluded                                     | Why                                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Primitivas sobre Radix e migração de widgets | feature 10b (`primitivas`), que usa este piso e este lint                                       |
| Uma linguagem visual única nos dois shells   | feature 10b: hoje `luz.css` reestiliza as primitivas no Núcleo; unificar é trocar as primitivas |
| Paletas de dados em canvas (cérebro, Pixel)  | são dados, não tema (design.md); só o texto delas segue o piso                                  |
| Remover CSS morto                            | feature 12 (limpeza)                                                                            |

## Assumptions

| Assumption                    | Chosen default                                                   | Rationale                                               | Confirmed? |
| ----------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------- | ---------- |
| HUD denso do Núcleo com 12px  | aceito; o layout se ajusta (quebra ou elipse), sem voltar a 11px | o piso vale para tudo; um HUD ilegível não vende        | n          |
| Baselines de macOS da galeria | regeradas só as de Linux; as de darwin ficam para quem tiver Mac | o CI roda Linux; este ambiente não gera capturas de Mac | n          |

**Open questions:** none - all resolved or logged above.

## Observable

| Surface                              | Decision               | Landing |
| ------------------------------------ | ---------------------- | ------- |
| screen (todas, nos dois shells)      | text size floor        | AC 1-4  |
| screen (todas, nos dois shells)      | colours                | AC 5-7  |
| screen (principais, nos dois shells) | accessibility          | AC 8    |
| screen `Galeria`                     | coverage and baselines | AC 9-10 |

## Sources

- `.specs/features/design-system/design.md` - **binding**: escala, regras de cor, acessibilidade e galeria
- Levantamento do design system de 07/10/2026 (nesta sessão)
