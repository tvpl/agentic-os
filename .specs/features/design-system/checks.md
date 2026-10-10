# Design system checks

Profile: ui
Plan: `.specs/features/design-system/plan.md`

18 checks in 3 slices · 2 one-way doors · 0 open, of which 0 block

Comandos (da raiz): interface `npm run test -w apps/command-centre -- <arquivo> -t "<nome>"`; lint
`npm run lint`; e2e `npx playwright test --config tests/e2e/playwright.config.ts <spec> -g "<nome>"`.

Fora do alcance destes checks, por tela: espaçamento e hierarquia de peso e tamanho acima do piso (a
feature decide tamanho mínimo, texto corrido a 13px, cor por token, estado nunca só por cor e
acessibilidade); a composição das telas não muda. Duas regras do `design.md` têm exceção enumerada
no próprio teste, com o motivo de cada entrada: rótulos, contadores, dicas de tecla e metadados a
12px (C15, `MICROCOPY`, 53 entradas, uma por seletor) e estados cuja marca vive na marcação ou numa palavra ao lado (C16, `MARKED_ELSEWHERE`, 54 entradas).

## Checks

### S1 - piso de 12px · 20 files · 120 KB · ~30k

**C1** - `theme.css` define `--fs-2` a `--fs-8` e `--fs-hero`, e nenhum arquivo de `src` define ou usa `--fs-0` ou `--fs-1` (AC 1)
Proof: `npm run test -w apps/command-centre -- src/typography.test.ts -t "C1 the type scale starts at 12px"`
Status: closed

**C2** - Lendo cada CSS de `src` como árvore (postcss): nenhum `font-size` nem atalho `font:` abaixo de 12px, resolvendo tokens `--fs-*`, `px`, `rem` (16px), `em` e `%` (contra um pai de 12px, o menor possível), unidades de viewport (0, a janela mais estreita) e `calc`/`clamp`/`min`/`max` com o menor valor; o teste se prova contra `font: 600 11px/1 x`, `font-size: .7rem`, `font-size: var(--fs-1)`, `clamp(10px, 1vw, 14px)` e `min(10px, 2vw)` (AC 2)
Proof: `npm run test -w apps/command-centre -- src/typography.test.ts -t "C2 no CSS sets text below 12px"`
Status: closed

**C3** - Lendo os TSX/TS de `src` pela árvore sintática do TypeScript: nenhum `fontSize` abaixo de 12 (objeto `style`, `{ fontSize }`, atributo JSX/SVG, `style.fontSize =`, `setProperty`, `cssText` e string HTML com `font-size:`/`font:`) e nenhuma fonte de canvas abaixo de 12px (AC 3). O tamanho de uma expressão é o menor valor que ela pode ter: literais, constantes, `Math.max/min/round`, funções do próprio código (o menor `return`, com os argumentos) e `x / k` só quando `k` é a escala da câmera; qualquer outro divisor (`Math.max(0.8, k)`, escala de sprite) não é limitado e reprova; subtração só com subtraendo literal e multiplicação só com fatores não negativos (senão o limite não é provado e reprova). A fonte de canvas é lida em `px`, `pt`, `pc`, `rem`, `em`, `%`, `in`, `cm`, `mm`, `q` e nas palavras-chave (`small`, `x-small`…), com `/altura-de-linha` e buracos de template, e uma fonte que não se consegue ler falha alto; o texto se monta por literal, template, `+` e `[…].join(sep)`, e `style["fontSize"]`, `{ ["fontSize"]: … }` e `setAttribute`/`setProperty` também valem. O que esta leitura prova é o que ela consegue ler; a medição de runtime (C17) cobre os estados exercitados. Dois pontos ela aceita pelo nome, e estão escritos no teste: `size / k` vale `size` quando o divisor é um identificador chamado `k` (um `const k = 10` que o sombreia passa aqui e é pego por C17 nos estados que a camada exercita), e um método de canvas alcançado por chave calculada (`ctx["fill" + "Text"]`) não é um ponto de texto para o guarda estrutural (o registro de chamadas de C17 o cobre). Um tamanho calculado por aritmética que o leitor não decide reprova em vez de passar, e o que o canvas de fato desenha sob zoom é medido em C17
Proof: `npm run test -w apps/command-centre -- src/typography.test.ts -t "C3 no inline or canvas text below 12px"`
Status: closed

**C4** - No navegador, o `font-size` computado de um `.badge` da galeria é `12px`, nos dois temas (AC 4)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/a11y.spec.ts -g "C4 badges read at 12px"`
Status: closed

**C15** - Texto corrido (parágrafos, descrições, mensagens) tem no mínimo 13px (`--fs-3`): toda regra de CSS cujo sujeito é um `<p>`, uma classe que algum `<p>` do TSX carrega ou uma classe de descrição de qualquer elemento (`<span>`, `<div>`: `-desc`, `-purpose`, `-hint`, `-note`, `-msg`, `-empty`, `-help`, `-summary`…) fica em 13px ou mais, salvo os seletores de rótulo, contador, dica de tecla e metadado enumerados, um a um, com o motivo em `MICROCOPY` (a isenção é do seletor, não da classe inteira; a classe também é lida quando escrita como `[class~="sub"]`, `[class=…]`, `[class*=…]`, `^=` ou `$=`); o teste se prova contra `p { font-size: 12px }`, `.note { font: 400 var(--fs-2)/1.4 x }` e a mesma regra dentro de `@media`, e falha se uma entrada da lista deixou de ser usada (design.md, Tipografia). Limite: classes de consulta e de propriedade (`.row .desc` que só o contexto torna prosa) não são decidíveis pelo nome; C18 as pega na tela, e três descrições de widgets que nenhuma tela padrão abre (`.sentinel-hint`, `.fact-text`, `.apps-approval .desc`) só têm a leitura de C15 como cobertura
Proof: `npm run test -w apps/command-centre -- src/typography.test.ts -t "C15 paragraphs, descriptions and messages are at least 13px"`
Status: closed

**C17** - O texto que o canvas desenha mede no mínimo 12px NA TELA (tamanho da fonte × escala da transformação × escala do sprite × densidade), em zoom mínimo (0.3), padrão (1) e máximo (9) e em cada estado que acrescenta texto, em todas as camadas que desenham texto: o mapa do cérebro (nós, hubs, planetas, órbitas, anéis, núcleo, iniciais dos apps), a cena do cérebro do Núcleo, o HUD da entidade e o Replay; cada texto é gravado com o arquivo que o desenhou (a pilha da chamada) e cada teste de camada confere que os arquivos são os esperados; um teste estrutural exige que toda fonte com `fillText`/`strokeText` (em qualquer grafia: propriedade, chave entre aspas, desestruturação, chamada solta, `bind`, `Reflect.apply`, `.call`, chamada opcional, cast) tenha essa medição (o PixelStudio não desenha texto). Além disso, cada camada confere que todo ponto que escreve texto (cada linha com `fillText`/`strokeText`) e toda escolha de fonte (cada `.font =`) foi alcançada por algum estado do teste, salvo as fontes que só medem, listadas com o motivo; com isso o Núcleo ganhou os estados dentro de uma nota (a dica de saída) e as quatro disposições (áreas, tipos, tempo, vínculos), que escrevem os nomes de grupo e de guia. A fonte do canvas é lida em todas as unidades de C3 (a gravação resolve `em` e `%` contra 16px) e uma fonte ilegível falha alto (AC 3, design.md Tipografia)
Proof: `npm run test -w apps/command-centre -- -t "C17"`
Status: closed

### S2 - cores por token · 18 files · 110 KB · ~28k

**C5** - `npm run lint` roda o stylelint sobre `apps/command-centre/src/**/*.css` com `color-no-hex`, `color-named: never` e `function-disallowed-list` (rgb, rgba, hsl, hsla e as demais funções de cor, `color()` e `device-cmyk()`), mais `declaration-property-value-disallowed-list` para cor dentro de `data:` URI e para as cores de sistema, as atuais (`Canvas`, `ButtonFace`, `Field`, `Highlight`…) e as depreciadas (`Window`, `WindowText`, `Menu`, `Background`, `ActiveCaption`, `InfoBackground`, `ThreeDFace`…, mais `-webkit-link`, `-moz-default-color` e `-webkit-focus-ring-color`), em qualquer propriedade que aceite cor (`box-shadow`, `text-shadow`, `filter`, `-webkit-text-fill-color`, `-webkit-text-stroke`, `stop-color`, `flood-color`, `fill`, gradientes e propriedades personalizadas; `grid-area: field`, `animation-name: highlight` e `container-name: field` continuam válidos; limite: uma propriedade personalizada com a palavra solta de uma cor de sistema, `--kind: mark`, também é recusada, porque uma propriedade personalizada pode guardar uma cor), a linha de comando fixa `--config stylelint.config.mjs --ignore-path stylelint.ignore` (uma lista vazia, que o teste exige vazia) em `lint:css` e no lint-staged, que cobre só `apps/command-centre/src/**/*.css` como `lint:css` (nem o `.stylelintignore` da pasta de trabalho nem o `.gitignore` valem); `font: menu` e `font: caption` são fontes de sistema e passam, e um arquivo temporário com `a { color: #fff }` faz o comando sair com código ≠ 0 (AC 5)
Proof: `npm run test -w apps/command-centre -- src/typography.test.ts -t "C5 the colour lint refuses a literal"`
Status: closed

**C6** - `npx stylelint "apps/command-centre/src/**/*.css"` sai `0` sobre a árvore (os literais de hoje viraram tokens ou `--mask-ink`), e os únicos trechos com a regra desligada são os blocos de definição de token de `theme.css` (`:root`, `[data-theme]`, `[data-preset]`): toda ocorrência de `stylelint-disable` no texto bruto (inclusive um comentário dentro de um valor, que o postcss não vê como comentário) é um comentário de topo de `theme.css`, e a configuração não ganha `ignoreFiles`, `overrides`, `ignore` nem plugin, nem a regra de cor é enfraquecida; o stylelint roda com `--config stylelint.config.mjs` (a configuração explícita desliga a descoberta) `npm run lint:css` sozinho, numa pasta com um `.stylelintignore` e um `.gitignore` que listam o arquivo (um `dist/probe.css`), ainda reprova `#fff` (sonda), e uma varredura da árvore inteira (`git ls-files` mais os não rastreados) não acha outro `.stylelintrc*`, `stylelint.config.{js,cjs,ts}`, `.stylelintignore` nem chave `stylelint` em `package.json`, cada forma com uma sonda (AC 6)
Proof: `npm run test -w apps/command-centre -- src/typography.test.ts -t "C6 the tree passes the colour lint"`
Status: closed

**C7** - No navegador, com tema claro e preset `hud-orange`, o `color` computado de `.display-digits` e de `.hud-label.accent` não é o `--text` do JARVIS (`#cfe9ff`-família) e é igual ao token do tema claro; com o preset `jarvis` escuro, o JARVIS continua aplicado (AC 7)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/a11y.spec.ts -g "C7 the light theme keeps its own tokens"`
Status: closed

**C16** - Um estado nunca é comunicado só pela cor (design.md, Cor): toda regra de CSS de estado (`[aria-pressed|checked|selected|current|expanded]`, `[data-state|active|status|selected|open|current]`, `.on`, `.active`, `.selected`, `.is-selected`, `.current`, `.open`, `.read`, `.off`, `.dimmed` e os pontos de status `.dot.ok|warn|danger|…`; mais as palavras de estado `.ok .bad .warn .danger .failed .done .paused .live .running`…, `:checked`, `[open]`, `.is-on` e `[class*="active"]`) é agrupada pelo elemento que estiliza, e cada grupo que muda matiz, opacidade, traço ou brilho muda também algo além disso (peso, sublinhado, tachado, borda ou preenchimento que o elemento ainda não tinha, barra ou anel com sombra dura, tracejado com ponta reta, espessura, `display`, glifo); brilho (sombra desfocada), `pointer-events`, `z-index`, gradiente, uma borda ou um preenchimento que só troca de cor e um tracejado com ponta redonda (que fecha os vãos) não são marca; valores de um mesmo estado (`.ok` e `.bad`) cuja marca tem a mesma forma em todas as cores contam como só cor (os pontos da linha do tempo de Rotinas têm quatro formas, decididas por `fireOutcome` para todo status que o agendador ou uma execução grava, com teste em tabela: disco cheio deu certo, losango falhou, meio disco em andamento, traço nada rodou; o desfecho está dito, em en e pt-BR, no `title` e no `aria-label`) ou consta em `MARKED_ELSEWHERE` com a marca que vive na marcação (ícone trocado, palavra); o teste se prova contra `a[aria-pressed="true"] { color: red }` e `li.read { opacity: .5 }`, e falha se uma entrada da lista deixou de ser só cor (e, por sonda, para cada forma do vocabulário)
Proof: `npm run test -w apps/command-centre -- src/states.test.ts -t "C16 a state is never told by colour alone"`
Status: closed

### S3 - acessibilidade e galeria · 8 files · 60 KB · ~15k

**C8** - axe (tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`) sem violação `serious`/`critical` na moldura: Hoje, Execuções, Skills, Rotinas, Memória, Configurações — tema escuro e claro, e Memória com uma área escolhida na legenda (outra fica em `.dimmed`) (AC 8)
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

**C18** - No navegador, nenhum texto corrido mede menos de 13px: em cada tela e tema de C8 e C9 mais as Conexões da moldura, todo elemento que guarda pelo menos 60 caracteres e 8 palavras de texto próprio (fora de `pre`, `code`, `kbd`, `samp`, `input`…) tem `font-size` computado de 13px ou mais; é a prova na tela do que C15 lê no CSS, e pega as classes que o nome não revela (design.md, Tipografia)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/a11y.spec.ts -g "C18 no running text under 13px on screen"`
Status: closed

**C13** - A suíte e2e não ganha nenhuma falha nova em relação à base (AC 1-10). Regra: toda falha na cabeça, rodada com os mesmos timeouts alongados da base (teste 90s, expect 20s, numa configuração temporária não comitada, porque o ambiente compartilhado fica com carga 10 a 19 e a configuração padrão estoura por tempo), também falha na base (`cd2bf28`, o pai da correção; a primeira rodada partiu de `dae68bd`) ou passa quando repetida sozinha na cabeça; as specs rodadas são as que a feature toca (a11y, galeria, os dois contrastes) e as que dependem do cérebro, da moldura e do Núcleo
Proof: `npx playwright test --config <temporária, timeout 90s e expect 20s> tests/e2e/a11y.spec.ts tests/e2e/gallery.spec.ts tests/e2e/gallery-contrast.spec.ts tests/e2e/surface-contrast.spec.ts tests/e2e/brain-context.spec.ts tests/e2e/closeout-recovery.spec.ts tests/e2e/rework.spec.ts tests/e2e/moldura.spec.ts tests/e2e/nucleo-shell.spec.ts tests/e2e/smoke.spec.ts` na cabeça e na base; lista abaixo
Status: closed

Lista (a rodada 1 mediu 141 testes nas 10 specs, 134 passam e 9 falham na cabeça; a rodada 2 acrescentou 22 testes de C18 em `a11y.spec.ts` e repetiu a11y, galeria e os dois contrastes (88 passam) e `brain-context.spec.ts` (as 2 falhas `:27` e `:61`, que também falham na base)):

- passam na cabeça e não são da base: a11y (47, com C18), gallery (23), gallery-contrast (2), surface-contrast (16), closeout-recovery, smoke, e as demais de moldura, nucleo-shell e brain-context; depois das últimas mudanças, a11y, gallery e os dois contrastes foram repetidos: 66 passam
- falham na cabeça e na base, do mesmo jeito (8): `brain-context.spec.ts:27`, `brain-context.spec.ts:61`, `moldura.spec.ts:285` (C20), `moldura.spec.ts:390` (C57), `nucleo-shell.spec.ts:165`, `nucleo-shell.spec.ts:467`, `nucleo-shell.spec.ts:1048`, `rework.spec.ts:49`
- falha só na cabeça na rodada longa e passa nas três repetições sozinho (1): `nucleo-shell.spec.ts:912`, que também passa na base; é o `slip` de uma pendência que chega durante a carga

**C14** - `npm run typecheck`, `npm run lint` e a suíte da interface saem `0` (AC 1-10)
Proof: `npm run typecheck && npm run lint && npm run test -w apps/command-centre`
Status: closed

## Coverage

| Set (size)                                 | Member -> proof                                                                                                                                                                                                                                                                                                                                                                                                                                | Unproven |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| formas de tamanho de texto (7)             | `font-size` C2 · atalho `font:` C2 · token C1, C2 · rem/em C2 · `style` inline, JSX, `setProperty`, `cssText`, string HTML C3 · canvas na fonte, em qualquer unidade, C3 · canvas na tela C17                                                                                                                                                                                                                                                  | -        |
| texto corrido (2)                          | parágrafos, descrições e mensagens a 13px no CSS C15 · computado na tela, nas telas de C8 e C9 e nas Conexões C18                                                                                                                                                                                                                                                                                                                              | -        |
| camadas que desenham texto em canvas (5)   | mapa do cérebro C17 · cena do cérebro do Núcleo C17 · HUD da entidade C17 · Replay C17 · PixelStudio (não desenha texto; o teste estrutural de C17 reprova o primeiro `fillText` que apareça sem medição)                                                                                                                                                                                                                                      | -        |
| estados (1)                                | on/off/active/selected/expanded/current/read/dimmed e os pontos de status têm marca não cromática ou marca na marcação enumerada C16                                                                                                                                                                                                                                                                                                           | -        |
| formas de cor literal (8)                  | hex C5, C6 · `rgb/rgba` C5, C6 · `hsl/hsla` C5, C6 · nome C5, C6 · máscara C6 · `color()`/`device-cmyk()`/funções wide-gamut C5 · cor em `data:` URI e cor de sistema, em qualquer propriedade, C5 · desligar o lint por comentário no valor, `ignoreFiles` ou `overrides` C6 · arquivo de configuração avulso (`.stylelintrc*`, `stylelint.config.*`, `.stylelintignore`, chave em `package.json`) e a linha de comando sem `--config` C5, C6 | -        |
| telas no axe, cada uma nos dois temas (11) | Memória com área escolhida (`.dimmed`) C8 · Hoje C8 · Execuções (moldura) C8 · Skills (moldura) C8 · Rotinas C8 · Memória C8 · Configurações (moldura) C8 · início do Núcleo C9 · Execuções (Núcleo) C9 · Skills (Núcleo) C9 · Configurações (Núcleo) C9                                                                                                                                                                                       | -        |
| camadas na galeria (3)                     | base (existente) C11 · Núcleo C10, C11 · moldura C10, C11                                                                                                                                                                                                                                                                                                                                                                                      | -        |
| doors (2)                                  | piso da escala C1 · linter C5, C6                                                                                                                                                                                                                                                                                                                                                                                                              | -        |

## Binding sources

| Source                                    | Rules                                    | Checks |
| ----------------------------------------- | ---------------------------------------- | ------ |
| `.specs/features/design-system/design.md` | tipografia, cor, acessibilidade, galeria | C1-C18 |

## Test policy

| Code                             | Required proofs                     | Coverage expectation            |
| -------------------------------- | ----------------------------------- | ------------------------------- |
| Configuration (tokens, lint)     | a source check that reads the tree  | each form of size and colour    |
| Instrumentation (telas, galeria) | browser check (axe, computed style) | each listed screen, both themes |

Evidence:

- `theme.css` tokens and `typography.test.ts` -> configuration
- closest analogue in the repo: `tests/e2e/surface-contrast.spec.ts` (axe por rota nos dois temas)

Cost: testes estendidos em `typography.test.ts` (com os leitores em `src/testing`), `states.test.ts` e quatro testes de medição de canvas, 1 spec e2e nova (axe e texto corrido na tela), galeria estendida, 18 provas.

## Swept

- validation: C5 (lint recusa literal)
- failure modes: C2, C3, C17 (cada forma de burlar o piso, e o que o canvas faz com zoom e sprite)
- idempotency: n/a - nada é gravado
- authorization: n/a - nenhuma rota
- concurrency: n/a - nenhum estado
- data lifecycle: n/a - nada persiste
- dependency failure: n/a - stylelint é dependência de desenvolvimento; sem ele o lint falha alto
- state transitions: C7 (tema claro × preset)
- observability: n/a - nenhum requisito de log

## Handoff

- S1-S3 ≈ 73k: theme.css trechos 30 KB, 14 CSS com edições pontuais (~236 tamanhos, ~90 cores) lidos em trechos ~60 KB, typography.test 4 KB, galeria 10 KB, spec nova 8 KB, testes ~20 KB ≈ 132 KB / 4 ≈ 33k, mais e2e e revisão das capturas - abaixo de 150k - one builder
