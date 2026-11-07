# Cérebro: contextos de trabalho — design das telas (binding para a feature)

Decide as quatro superfícies que a feature cria ou toca: o seletor de contexto (nos dois shells), o diálogo "Novo contexto", a
tela Configurações › Memória › Contextos e o chip no chat; o texto de cada uma nas duas línguas e o que herdam. Ficam fora
daqui: o grafo e a árvore de notas (não mudam de desenho; só recebem o escopo), o formato dos arquivos (é do `plan.md`).

## Binding sources

| Source                                           | O que decide                                                                                                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.specs/features/design-system/design.md`        | piso de 12px, texto corrido a 13px, cor só por token (stylelint), estado nunca só por cor (ícone e texto), axe sem `serious`/`critical`, a galeria cobre as duas camadas                   |
| `.specs/features/primitivas/design.md`           | o seletor é `Menu` (Radix `DropdownMenu`); o diálogo e a confirmação de apagar são `Modal` (Radix `Dialog`); dicas são `Tooltip`; nada de widget feito à mão                               |
| `.specs/features/comandos-atalhos/design.md`     | "Trocar de contexto" e "Todo o cérebro" são comandos do registro (`global`, na paleta); nenhum ouvinte de teclado novo fora do registro                                                    |
| `.specs/features/moldura-app/design.md` (Tela 1) | a barra lateral tem marca, grupo principal, "Mais", Configurações e o botão de recolher; o seletor entra **entre a marca e o grupo principal**, e recolhida a barra mostra só o ícone dele |
| `.specs/features/cerebro-v2/design.md`           | o editor de nota (`NoteEditor`) é o que "Editar resumo" abre; o padrão de erro com "Tentar de novo" e de carregamento com spinner e texto                                                  |

## Tela - Seletor de contexto

- **Moldura:** um botão de largura total logo abaixo da marca, com o ícone `Crosshair`, o nome do contexto ativo (ou "Todo o
  cérebro") em 13px e, abaixo, em 12px, a contagem de arquivos ("1 240 arquivos"). Recolhida a barra, só o ícone, com o nome do
  contexto como nome acessível e `Tooltip`.
- **Núcleo:** o mesmo botão, compacto (ícone + nome), à esquerda da linha de voz.
- **Menu aberto:** "Todo o cérebro" primeiro, um separador, os contextos na ordem de `settings.contexts`, cada um com nome e
  contagem; o ativo com `Check` e `aria-checked`. Um contexto com algum caminho fora de `ok` mostra `AlertTriangle` e o texto
  "Pasta com problema" em 12px. Depois um separador, "Novo contexto…" (`Plus`) e "Gerenciar contextos" (`Settings2`).
- Sem contexto: o menu mostra "Todo o cérebro" e a linha "Crie um contexto para focar o cérebro num projeto." acima de
  "Novo contexto…". Carregando: spinner + "Carregando…". Erro: a mensagem + "Tentar de novo".
- Contexto ativo que sumiu: o botão volta a "Todo o cérebro" e um aviso (o toast que a moldura já usa) diz "O contexto ativo não
  existe mais."

## Tela - Novo contexto

`Modal`, largura até 560px.

- Campo "Nome" (obrigatório, 60 caracteres).
- "Pastas": uma lista com uma linha por pasta escolhida (caminho em mono 12px, botão `X` para tirar) e "Adicionar pasta", que
  abre um `Popover` com a lista das pastas indexadas e, sob cada uma, as subpastas que o índice conhece (dois níveis, com
  busca por nome); um campo "ou digite um caminho".
- A primeira pasta é a principal: o selo "Principal" ao lado dela, e "Tornar principal" no menu das outras.
- Caminho fora das pastas indexadas: abaixo da linha, `AlertTriangle` + "Esta pasta não está indexada." e o botão
  "Indexar e criar" no rodapé no lugar de "Criar".
- Rodapé: "Cancelar" (`.btn`), "Criar" (`.btn.primary`, desabilitado sem nome ou sem pasta). Erro da rota: a mensagem no
  diálogo, acima do rodapé, com `role="alert"`; o diálogo fica aberto.

## Tela - Configurações › Memória › Contextos

Uma seção nova da página Memória (`views/settings/memory.tsx`), depois das pastas indexadas.

- Uma linha por contexto: nome, `id` em mono 12px, contagem de arquivos e a lista de caminhos, cada um com o estado em ícone +
  texto: `Check` "Ok", `FolderX` "Pasta sumiu", `EyeOff` "Fora das pastas indexadas".
- Ações por linha (`.btn.sm`): "Editar" (abre o diálogo acima preenchido; o `id` não muda), "Editar resumo" (abre o
  `NoteEditor` em `_resumo.md`, criando-o pelo modelo quando falta), "Apagar".
- "Apagar": `Modal` de confirmação com "Apagar o contexto <nome>? As notas em memory/notes/<id>/ continuam onde estão." e os
  botões "Cancelar" e "Apagar" (`.btn.danger`).
- Vazio: "Nenhum contexto ainda." e "Novo contexto…".

## Tela - Chip no chat

No compositor do Console (moldura e Núcleo), acima do campo de texto, quando há contexto ativo: um chip com `Crosshair`,
"Neste contexto: <nome>" em 12px e um botão `X` com nome acessível "Usar todo o cérebro". Sem contexto ativo, nada aparece.
Uma conversa continuada mostra o contexto dela (o da sessão), não o ativo, com o texto "Conversa no contexto <nome>".

## Texto (as duas línguas; as chaves entram em `locales/brain.ts`, `en` e `ptBR` com as mesmas chaves)

| Chave                      | pt-BR                                                             | en                                                                 |
| -------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| `context.all`              | Todo o cérebro                                                    | Whole brain                                                        |
| `context.files`            | {n} arquivos                                                      | {n} files                                                          |
| `context.new`              | Novo contexto…                                                    | New context…                                                       |
| `context.manage`           | Gerenciar contextos                                               | Manage contexts                                                    |
| `context.empty`            | Crie um contexto para focar o cérebro num projeto.                | Create a context to focus the brain on a project.                  |
| `context.pathProblem`      | Pasta com problema                                                | Folder needs attention                                             |
| `context.gone`             | O contexto ativo não existe mais.                                 | The active context no longer exists.                               |
| `context.name`             | Nome                                                              | Name                                                               |
| `context.folders`          | Pastas                                                            | Folders                                                            |
| `context.addFolder`        | Adicionar pasta                                                   | Add folder                                                         |
| `context.typePath`         | ou digite um caminho                                              | or type a path                                                     |
| `context.primary`          | Principal                                                         | Primary                                                            |
| `context.makePrimary`      | Tornar principal                                                  | Make primary                                                       |
| `context.notIndexed`       | Esta pasta não está indexada.                                     | This folder is not indexed.                                        |
| `context.indexAndCreate`   | Indexar e criar                                                   | Index and create                                                   |
| `context.create`           | Criar                                                             | Create                                                             |
| `context.state.ok`         | Ok                                                                | Ok                                                                 |
| `context.state.missing`    | Pasta sumiu                                                       | Folder is gone                                                     |
| `context.state.notIndexed` | Fora das pastas indexadas                                         | Outside the indexed folders                                        |
| `context.editBrief`        | Editar resumo                                                     | Edit brief                                                         |
| `context.delete.confirm`   | Apagar o contexto {name}? As notas em {dir} continuam onde estão. | Delete the context {name}? The notes in {dir} stay where they are. |
| `context.none`             | Nenhum contexto ainda.                                            | No contexts yet.                                                   |
| `context.chip`             | Neste contexto: {name}                                            | In this context: {name}                                            |
| `context.chip.off`         | Usar todo o cérebro                                               | Use the whole brain                                                |
| `context.chip.session`     | Conversa no contexto {name}                                       | Conversation in the context {name}                                 |
| `context.deleted`          | Contexto apagado                                                  | Deleted context                                                    |
| `context.cmd.switch`       | Trocar de contexto                                                | Switch context                                                     |

## Modelo do resumo (`_resumo.md`, criado por "Editar resumo")

```markdown
---
type: brief
status: active
---

# <nome do contexto>

## O que é

## O que importa

## Metas

## O que ignorar
```
