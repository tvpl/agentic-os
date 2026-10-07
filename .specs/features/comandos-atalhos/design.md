# Comandos e atalhos — design e inventário (binding)

## Inventário de hoje (06/10/2026, `apps/command-centre/src`)

Ouvintes que esta feature migra para o registro (escopo de destino entre parênteses):

| Onde                            | Teclas                                                                                                                                               | Escopo de destino                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `App.tsx:422-447`               | Esc (fecha a paleta, senão vai para `/`), ⌘K / ⌘M, `?`                                                                                               | `global` (Esc→`/` só no `nucleo`)         |
| `nucleo/index.tsx:484-561`      | ⌘J deck, ⌘F busca, ⌘⇧A / ⌘⇧D aprovar/negar, 1–5 cenas, `[` `]`, `/` linha de voz, `p` foco, Esc (dobra a conversa, fecha a busca, dispensa a lâmina) | `nucleo`                                  |
| `moldura/Moldura.tsx`           | ⌘. conversa, Esc fecha a gaveta                                                                                                                      | `moldura`                                 |
| `views/PixelStudio.tsx:480-529` | ⌘Z, ⌘⇧Z / ⌘Y, `[` `]` quadros, `+` `−` pincel, `x`, `o`, 1–4 ferramentas                                                                             | `view:pixel`                              |
| `views/SecondBrain.tsx:550-572` | ⌘+ / ⌘− / ⌘0 zoom, `/`, `p`, `f`, `l`                                                                                                                | `view:brain`                              |
| `runs/RunDetail.tsx:191-209`    | `/`, `r` (de novo), `c` (seguir)                                                                                                                     | `view:runs` (uma instância ativa por vez) |

Ficam como estão (teclas do próprio foco): `BrainSceneCanvas`, `Replay`, `FocusMode` (camada própria,
`overlay`), `SkillsScene` type-to-find, `dialog.tsx`, `Popover`, campos de texto, tour.

Conflitos que devem sumir: 1–4 e `[ ]` (Pixel × Núcleo), `p` (Cérebro × foco), `/` (Núcleo × buscas),
`r`/`c` duplicados (lâmina × cena), ⌘Enter (paleta × skill atrás dela).

## Tela - Ajuda de atalhos (`?`)

Diálogo existente. Dentro: um bloco por escopo com comandos de teclas, nesta ordem: "Geral" / "General"
(`global`), o shell atual ("Moldura" / "App frame" ou "Núcleo" / "Núcleo"), a tela aberta (o título do
app, ex.: "Pixel Studio") quando ela registra teclas. Cada linha: as teclas como chips (⌘ no Mac,
Ctrl nos outros) à esquerda e o título do comando à direita. Um bloco sem comandos não aparece. Nada
além do que o registro tem para o shell e a tela atuais.

## Tela - Paleta

Mesma composição de hoje. Muda só: as linhas de "Apps" e "Ações" vêm do registro e, quando o comando
tem teclas, a dica (chips) aparece à direita da linha, no lugar do texto auxiliar.
