# Design system — regras (binding)

Valem para as duas interfaces (moldura de app e Núcleo) e para a galeria.

## Tipografia

- Escala: `--fs-2` 12px, `--fs-3` 13px, `--fs-4` 14px, `--fs-5` 16px, `--fs-6` 20px, `--fs-7` 28px,
  `--fs-8` 40px, `--fs-hero`. Os tokens `--fs-0` (10px) e `--fs-1` (11px) deixam de existir.
- Piso: nenhum texto abaixo de 12px, em `font-size`, no atalho `font:`, em `style` inline e em texto
  desenhado em canvas.
- Texto corrido (parágrafos, descrições, mensagens) usa no mínimo `--fs-3` (13px); 12px fica para
  rótulos, contadores, dicas de tecla e metadados.
- Rótulos em caixa alta com espaçamento (`--track-label`) continuam permitidos a partir de 12px.

## Cor

- Toda cor de CSS vem de um token. Literais (`#hex`, `rgb()`, `rgba()`, `hsl()`, `hsla()`, cores com
  nome) só aparecem nos blocos que definem tokens: `:root`, `[data-theme]` e `[data-preset]` de
  `theme.css`. `color-mix()` sobre tokens continua permitido. `transparent` e `currentColor` também.
- Máscaras (`mask-image`) usam o token `--mask-ink` (preto opaco), não `#000`.
- Significado: sucesso `--ok`, atenção `--warn`, perigo `--danger`, informação `--info`, cada um com
  `-bg`; destaque `--accent`; o agente `--agent`. Um estado nunca é comunicado só pela cor (sempre há
  rótulo, ícone ou forma).
- Paletas de dados desenhadas em canvas (cérebro, Pixel Studio) ficam fora da regra de literal, mas
  leem do tema as cores de texto e fundo.

## Acessibilidade

- Nenhuma violação `serious` ou `critical` do axe (regras WCAG 2 A e AA) nas telas principais das duas
  interfaces, nos dois temas.
- O contraste de texto segue AA (4.5:1; 3:1 para texto ≥ 18.66px em negrito ou ≥ 24px).

## Galeria

- A galeria (`gallery.html`) mostra as primitivas nos dois temas e também dentro das duas interfaces
  (uma seção com a camada do Núcleo, `.nu-shell`, e uma com a moldura, `[data-shell="moldura"]`).
- As capturas de referência são regeradas nesta feature e revisadas à mão antes do commit.
