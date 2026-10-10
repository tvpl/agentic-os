# Comandos e atalhos — um registro tipado e um gerenciador de teclas com escopo

## Problem

Cada tela trata o teclado por conta própria. São 21 ouvintes de `keydown` espalhados pela interface
(levantamento de 06/10/2026), sem biblioteca e sem um lugar que saiba quem responde a qual tecla.
Isso já produz conflitos reais: no Pixel Studio, as teclas 1–4 e `[ ]` trocam a ferramenta **e**
fazem o Núcleo viajar de cena; `p` liga a apresentação do Cérebro e o modo foco ao mesmo tempo; `/`
disputa entre a linha de voz e três buscas; `r` e `c` de uma execução disparam duas vezes quando ela
aparece numa lâmina e na cena; ⌘Enter da paleta também roda a skill que está atrás dela.

A paleta de comandos define as ações dentro do próprio componente (`components/CommandPalette.tsx`
`:300-468`), sem atalho, escopo ou condição, e repete lógica que vive em outras telas (reindexar,
backup, doctor, som, presets). A ajuda de atalhos (`components/ShortcutsHelp.tsx`) é uma lista
escrita à mão que já diverge do código: faltam ⌘J, `r`/`c`, Replay, o modo foco e Shift+1–4, e na
moldura de app (feature 9) ela mostra teclas do Núcleo que não fazem nada lá. As chaves
`shell.shortcuts.desktop` estão trocadas entre inglês e português. `RESET_LAYOUT_EVENT` e
`SHORTCUTS_EVENT` não têm ouvinte.

Evidência: levantamento de comandos e atalhos de 06/10/2026 (nesta sessão), com arquivo e linha de
cada ouvinte e de cada conflito.

## Flow

Reutiliza a paleta (`components/CommandPalette.tsx`, exists), a ajuda (`components/ShortcutsHelp.tsx`,
exists), a pilha de diálogos (`components/dialog.tsx`, exists) e os dois shells (`App.tsx` `OsShell`,
`nucleo/index.tsx`, `moldura/Moldura.tsx`, exist).

1. Registro → `commands/registry.ts` (new): `Command` tipado (door 1) e um `CommandsProvider` em
   `OsShell`. Shells e telas registram os seus com `useCommands(commands)`, que os remove ao
   desmontar.
2. Teclas → `commands/keys.ts` (new): um único ouvinte de `keydown` na janela. A tecla vai ao comando
   do escopo mais interno ativo (door 2); uma tecla simples não dispara com o foco num campo de
   texto; `Mod` é ⌘ no Mac e Ctrl nos outros (door 3).
3. Conflito → registrar duas vezes a mesma combinação no mesmo escopo lança um erro em
   desenvolvimento e em teste, com os dois ids.
4. Paleta → as seções "Apps" e "Ações" passam a vir do registro (os comandos marcados para a paleta, door 1),
   com a dica do atalho à direita; skills, arquivos, execuções e páginas aninhadas continuam como são.
5. Ajuda → `ShortcutsHelp` (exists) lista o que o registro tem para o shell atual, agrupado por escopo, em vez
   da lista escrita à mão.
6. Migração → os ouvintes globais e de shell (`App.tsx`, exists; `nucleo/index.tsx`, e na moldura `useFrameLayout.ts`, `useFrameActions.ts` e `BellPopover.tsx`)
   e os de tela com conflito (`views/PixelStudio.tsx`, `views/SecondBrain.tsx`, `runs/RunDetail.tsx`)
   passam a registrar comandos. Ouvintes locais de um elemento (canvas do Cérebro, `Replay`, campos de
   texto, diálogos) continuam como estão.

## Impact

| Front       | What changes                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | novo termo: `Command` - uma ação nomeada que a paleta, um atalho e a ajuda mostram do mesmo jeito                                                                   |
| domain      | novo termo: `scope` de comando - onde uma tecla vale: `global`, o shell (`moldura`/`nucleo`), uma tela (`view:<app>`), uma camada (`overlay`), um diálogo (`modal`) |
| contrato    | nenhum na API; na interface, os eventos `RESET_LAYOUT_EVENT` e `SHORTCUTS_EVENT` sem ouvinte saem                                                                   |
| stored data | nada a migrar                                                                                                                                                       |

## Relations

None - no stored-data shape change

## Surface

None - no API, CLI or file surface changes; the screens are in Observable

## Landing

| One-way door                                                                  | Literal shape                                                                                                                                                                                                                                                                                                                                                                                                                             | Alternative rejected                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Forma de `Command`                                                         | `{ id: string; title: TKey; group: "apps" \| "actions" \| "navigation" \| "view"; scope: CommandScope; keys?: string[]; keywords?: string[]; icon?: LucideIcon; palette?: boolean; allowInInput?: boolean; when?: () => boolean; run: () => void }`; `keys` no formato `"Mod+K"`, `"Shift+1"`, `"["`, `"Escape"`                                                                                                                          | Comandos como eventos `CustomEvent` na janela (o que existe hoje): nenhum lugar sabe quem responde a qual tecla, e a ajuda não tem de onde se gerar                                                                           |
| 2. Ordem dos escopos                                                          | `modal` > `overlay` > `view:<app>` > shell (`moldura` ou `nucleo`) > `global`; a tecla vai ao primeiro escopo ativo que tem a combinação, e os de baixo não a recebem                                                                                                                                                                                                                                                                     | Todos os ouvintes recebem a tecla (hoje): é exatamente a origem dos conflitos 1–4, `p`, `/`, `r`/`c`                                                                                                                          |
| 3. Modificador por sistema                                                    | `Mod` = ⌘ (`metaKey`) no Mac e Ctrl (`ctrlKey`) nos outros; no Mac, Ctrl+K não abre a paleta, e no Windows, Win+K não abre                                                                                                                                                                                                                                                                                                                | Aceitar os dois em todo sistema (hoje): Win+K é atalho do Windows, e no Mac Ctrl+letra é edição de texto (Ctrl+K apaga até o fim da linha num campo)                                                                          |
| 4. Camadas escondem o que está embaixo (achada no build)                      | `modal` (um diálogo da pilha de `components/dialog.tsx` aberto, ou a tecla veio de dentro de um `[role="dialog"]` que não é gaveta da moldura) e `overlay` (o modo foco, `useCommandScope("overlay")`), quando ativos, são o único escopo ativo: `view`, shell e `global` não recebem nada até a camada sair. O "cai para o escopo de baixo" da door 2 e do AC 6 vale entre os escopos ativos                                             | Door 2 ao pé da letra (só a combinação que a camada declara para): com um diálogo aberto, 1–5, `p`, `?` e ⌘K iriam para o Núcleo atrás dele — hoje cada ouvinte ignora teclas vindas de um diálogo                            |
| 5. Uma instância por tela (achada no build)                                   | `useCommands(cmds, { exclusive: "<chave>" })`: entre as instâncias montadas com a mesma chave, só a mais nova registra; as outras esperam e assumem quando ela desmonta. `RunDetail` usa `exclusive: "run-detail"`. E `CommandsGate enabled={false}` tira do registro o que está saindo (a cena que viaja para fora, a lâmina que se dissolve)                                                                                            | Deixar as duas registrarem: `r`/`c` duas vezes em `view:runs` é o conflito do AC 5 (erro em desenvolvimento) - e em produção a tecla iria às duas                                                                             |
| 6. Quem registra o que na moldura (achada no rebase sobre a moldura dividida) | `useFrameLayout` registra `moldura.chat` (`Mod+.`, escopo `moldura`, na paleta) e a mesma tecla em `modal` enquanto a gaveta estreita da conversa é o diálogo do topo; `useFrameActions` registra `action:skill-deck` (no lugar da ponte `OPEN_DECK_EVENT`, que sai); `BellPopover` registra o Esc que fecha o sino (`moldura`). O Esc das gavetas é do `dialog.tsx` (já são diálogos). `moldura/keys.ts` sai: a dica vem de `comboLabel` | Deixar o ouvinte de ⌘. em `useFrameLayout` e o de Esc em `BellPopover`: dois ouvintes fora do registro, e o ⌘. continuaria valendo no Windows com a tecla Win (door 3)                                                        |
| 7. Dígitos e Shift (achada na verificação da rodada 1)                        | um comando `"1"` responde à tecla que digita "1", com ou sem Shift (num AZERTY o Shift é como se digita); `"Shift+1"` responde à tecla física (`code: Digit1`) com Shift apertado, seja qual for o sinal que digita ("!" num teclado americano). Letra: o Shift faz parte da tecla (`p` não é Shift+P; Caps Lock P, sem Shift, é `p`)                                                                                                     | Casar o dígito por `code` quando há Shift (como estava): quem usa AZERTY perdia 1-5 do Núcleo (o ouvinte de hoje lê `event.key` e ignora o Shift). Ignorar o Shift nas letras: Ctrl+Shift+J abriria o deck e Ctrl+A aprovaria |

- Nothing else in this change is hard to reverse

## Criteria

### S1: Um registro e um gerenciador de teclas (P1)

**Acceptance Criteria**

1. The registry SHALL hold the commands registered with `useCommands` while the registering component is mounted, and SHALL drop them when it unmounts
2. WHEN a key combination is pressed THEN only the command of the innermost active scope that declares it SHALL run (door 2)
3. WHEN the focus is in an `input`, `textarea`, `select` or `contenteditable` THEN a command whose keys have no modifier SHALL NOT run, unless it declares `allowInInput`
4. WHILE on a Mac, `Mod` SHALL match ⌘ and not Ctrl; WHILE on another system, `Mod` SHALL match Ctrl and not the Windows key (door 3)
5. IF two commands register the same combination in the same scope THEN registration SHALL throw an error naming both ids (in development and test builds)
6. WHILE a command's `when()` returns false, its keys SHALL fall through to the next scope and it SHALL NOT appear in the palette

**Independent test:** com a tela do Pixel Studio aberta no Núcleo, a tecla 2 troca a ferramenta e o Núcleo não viaja de cena.

### S2: A paleta e a ajuda leem o registro (P1)

**Acceptance Criteria**

7. The palette's "Apps" and "Actions" sections SHALL list the registered commands with `palette: true` for the current shell, each with its key hint when it has keys; the skills, files, runs and nested pages SHALL stay as today
8. The shortcuts help SHALL list, grouped by scope and in the interface language, every command with keys that is registered for the current shell and screen, and nothing else
9. WHILE `shell` is `moldura`, the help SHALL NOT list the Núcleo keys (1–5, `[`, `]`, `p`, ⌘J); WHILE `nucleo`, it SHALL list them
10. The hand-written sheet's strings SHALL be gone: `shell.shortcuts.desktop` (whose English and Portuguese values were swapped) is removed with the list it headed, and no `shell.shortcuts.*` string SHALL be left that no screen shows

**Independent test:** na moldura, `?` abre a ajuda sem nenhuma tecla do Núcleo; no Núcleo, ⌘J aparece nela.

### S3: Os conflitos de hoje somem (P1)

**Acceptance Criteria**

11. WHILE Pixel Studio is the open screen, the keys 1–4 and `[`, `]` SHALL act on Pixel Studio only
12. WHILE the Second Brain classic view is open, `p` SHALL toggle its presentation and SHALL NOT open the focus mode; `/` SHALL focus its search and not the voice line
13. WHEN a run is shown in both a lâmina and the Runs scene THEN `r` SHALL start one follow-up run, not two
14. WHILE the palette is open, ⌘Enter / Ctrl+Enter SHALL run the palette's secondary action only
15. The global and shell key handlers in `App.tsx`, `nucleo/index.tsx` and `moldura/Moldura.tsx`, and the screen handlers in `views/PixelStudio.tsx`, `views/SecondBrain.tsx` and `runs/RunDetail.tsx`, and every file of the frame (`moldura/`), SHALL NOT add their own `keydown` listeners; the key listeners that stay on the page outside the registry SHALL be exactly the ones named, with their reason, in the C16 allowlist; the unused `RESET_LAYOUT_EVENT`, `SHORTCUTS_EVENT` and `OPEN_DECK_EVENT` SHALL be gone
16. The existing keyboard behaviour covered by the e2e suite (palette ⌘K/Ctrl+M, Esc, scene keys, ⌘⇧A/⌘⇧D, ⌘J, ⌘F, `/`, `p`) SHALL keep passing

**Independent test:** a suíte e2e de teclado continua verde, e os quatro conflitos têm uma prova cada.

### S4: Correções da rodada 1 da verificação (P1)

**Acceptance Criteria**

17. WHEN a command's key is also declared by a command of an inner scope (a screen over a shell, a shell over `global`) THEN the shortcuts help SHALL list the key once, under the inner scope with the inner meaning, and a command left with no key of its own SHALL leave the sheet (Pixel Studio inside the Núcleo: 1-4, `[`, `]` and Esc appear once, as Pixel's)
18. A key that is part of an IME composition (`isComposing`, or `keyCode` 229), that was already handled (`defaultPrevented`) or that is pressed while the guided tour is up SHALL NOT run a command; a letter's key includes Shift (`p` is not Shift+P, Ctrl+Shift+J is not `Mod+J`, Ctrl+A is not `Mod+Shift+A`; Caps Lock P, which holds no Shift, is `p`)
19. WHEN a command is written `"1"` THEN it SHALL answer the key that types "1" with or without Shift (AZERTY), and a command written `"Shift+1"` SHALL answer the physical key with Shift held (door 7)
20. WHEN a palette action talks to the server (reindex, backup, diagnostics, theme, switch interface) THEN the palette SHALL close at once, success and failure SHALL be reported by a toast that names the action, and the diagnostics action SHALL take the person to Settings when the server answers (AD-014)

**Independent test:** com Pixel Studio aberto no Núcleo, a ajuda mostra o `2` uma vez, como "Borracha"; Ctrl+Shift+J não abre o deck; com a paleta aberta, "Rodar diagnóstico" fecha a paleta antes de o servidor responder.

## Out of scope

| Excluded                                                                                                                            | Why                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Atalhos personalizáveis pelo usuário                                                                                                | precisa de tela e de preferência própria; o registro deixa isso possível depois                                                                                                                                    |
| Ouvintes locais de um elemento                                                                                                      | canvas do Cérebro, `Replay`, campos e diálogos tratam teclas do próprio foco, sem conflito global                                                                                                                  |
| Unificar a lógica duplicada fora da paleta                                                                                          | reindexar, backup e doctor nas abas de Configurações seguem como estão; a paleta passa a chamar comandos                                                                                                           |
| Migrar os 5 ouvintes de Esc e Shift+1-4 das cenas (`BrainScene` ×2, `RunsScene`, `RoutinesScene`, `SkillsScene` Esc, `NucleoScene`) | são cadeias de Esc em captura que agem no estado da própria cena e respeitam `defaultPrevented`; nenhuma conflita hoje. Ficam listados, com o motivo, na allowlist que o C16 confere; migrá-los é a próxima rodada |

## Assumptions

| Assumption                                                              | Chosen default                                                                                                                       | Rationale                                                                                                                                                                                                                          | Confirmed? |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Ctrl+M no Mac                                                           | continua abrindo a paleta (é a tecla alternativa de hoje)                                                                            | não é edição de texto no Mac; quem já usa não perde                                                                                                                                                                                | n          |
| Erro de conflito em produção                                            | só aviso no console                                                                                                                  | um conflito não deve derrubar a interface de quem comprou                                                                                                                                                                          | n          |
| Ação da paleta que fala com o servidor (AD-014)                         | fecha a paleta na hora; o resultado vira toast (erro inclusive); o diagnóstico leva a Configurações quando responde                  | o "muda só" da tela Paleta não previa o spinner de linha; manter a paleta aberta durante a chamada exigiria que `run` devolvesse uma promessa (door 1: `run: () => void`) e prende o teclado numa tela que a pessoa já quis fechar | y (AD-014) |
| Grupo "Paleta de comandos" (↑↓ ↵ ⌘↵ → ⌫) e `>` da linha de voz na ajuda | não entram: a ajuda lista o registro, e essas são teclas do campo da paleta (o rodapé dela as mostra) e um caractere da linha de voz | "nada além do que o registro tem" (design); não são comandos                                                                                                                                                                       | y          |
| Ordem das ações na paleta                                               | escopos de fora para dentro, depois a ordem de registro: "Abrir o deck" vem depois das de `global`                                   | a ordem vem do registro (C7); a de hoje era a de um array escrito à mão                                                                                                                                                            | y          |

**Open questions:** none - all resolved or logged above.

## Observable

| Surface                   | Decision                                  | Landing                              |
| ------------------------- | ----------------------------------------- | ------------------------------------ |
| screen `Ajuda de atalhos` | content per shell and screen              | AC 8-10, 17                          |
| screen `Paleta`           | key hints, sections, asynchronous actions | AC 7, 20                             |
| keyboard (todas as telas) | who answers a key                         | AC 2-4, 11-14, 18-19 (doors 2, 3, 7) |

## Sources

- `.specs/features/comandos-atalhos/design.md` - **binding**: inventário de ouvintes e conflitos, e as telas de ajuda e paleta
- AD-005 em `.specs/STATE.md` - os dois shells
