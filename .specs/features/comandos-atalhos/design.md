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
além do que o registro tem para o shell e a tela atuais. Uma tecla que um escopo interno também declara aparece só no bloco do interno, com o significado dele (com o Pixel Studio aberto no Núcleo, o `2` é "Borracha", uma vez); um comando que ficou sem tecla própria sai da folha. Não aparecem: as teclas do campo da própria paleta (↑↓ ↵ ⌘↵ → ⌫, no rodapé dela) e o `>` da linha de voz (um caractere digitado, não um comando).

## Tela - Paleta

Mesma composição de hoje. Muda só: as linhas de "Apps" e "Ações" vêm do registro e, quando o comando
tem teclas, a dica (chips) aparece à direita da linha, no lugar do texto auxiliar. As ações que falam com o servidor (reindexar, backup, diagnóstico, tema, trocar de interface) fecham a paleta na hora e o resultado vira um aviso (toast), o erro inclusive; o diagnóstico leva a Configurações quando responde (AD-014). A ordem das linhas vem do registro: de fora para dentro, depois a de registro.
