# Cérebro: memória confiável — design das telas (binding para a feature)

Decide a aba "Do agente" da tela "Revisões" (lista de propostas, diff e operações), a seção "Histórico" do painel da nota e
o diálogo de uma versão, o diálogo "Histórico da memória", o diálogo "Permissões da pasta" com a marca na árvore e a lista
em Configurações › Memória, os diálogos "Exportar pasta" e "Importar pasta", o selo do widget de fatos e o texto de cada um
nas duas línguas. Ficam fora daqui: o formato do `MEMORY.md` e da proposta (é do `plan.md`, doors 6 e 7), o grafo e o
Núcleo (não mudam além do painel de cena que já mostra "Revisões") e uma tela de linha do tempo dos fatos (fora de escopo).

## Binding sources

| Source                                                                            | O que decide                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.specs/features/design-system/design.md`                                         | piso de 12px, texto corrido a 13px, cor só por token (stylelint), estado nunca só por cor (ícone e texto), axe sem `serious`/`critical` nos dois temas, a galeria cobre as duas camadas                                                                                                                                    |
| `.specs/features/primitivas/design.md`                                            | abas são `Tabs`, menus são `Menu` (`DropdownMenu`), confirmações e diálogos são `Modal`, dicas são `Tooltip`; nenhum CSS fora de `ui/ui.css` desenha parte de primitiva; não há primitiva de select (o `<select>` nativo do tema)                                                                                          |
| `.specs/features/comandos-atalhos/design.md`                                      | "Histórico da memória" é um comando do registro (`global`); na aba "Do agente" só `j`/`k` (mover) e `Enter` (abrir) valem no escopo `view:reviews`, e nenhuma tecla nua aceita ou recusa (o `a` desse escopo é "Adiar" da aba "Para revisar"); uma tecla nua não age dentro de um campo; a `listenersAllowlist` não cresce |
| `.specs/features/cerebro-natureza/design.md` (Tela - Revisões)                    | a aba nova segue a lista à esquerda e o detalhe à direita, o item que sai com 150 ms (nenhum com `prefers-reduced-motion`), o foco que vai ao próximo, o `role="status"` e os estados vazio, carregando e erro de lá                                                                                                       |
| `.specs/features/cerebro-vista-notas/design.md` (Painel da nota, Barra das notas) | a seção "Histórico" é a quarta seção recolhível do painel, depois de "Nesta nota"; o menu da pasta e o menu do cabeçalho NOTAS são os `Menu` de lá; o ícone de acesso fica onde o `Lock` de "somente leitura" fica                                                                                                         |
| `.specs/features/cerebro-v2/design.md` (Editor de nota)                           | o conflito ao restaurar usa o texto e a faixa de conflito do editor; a nota restaurada recarrega no mesmo estado "Salvo"                                                                                                                                                                                                   |
| `.specs/features/limpeza-legado/design.md`                                        | um só renderizador de Markdown (`components/Markdown.tsx`); o diff não renderiza Markdown, mostra as linhas em mono                                                                                                                                                                                                        |

O diff das duas telas reusa o leitor de diff unificado das execuções (`apps/command-centre/src/runs/diff.ts` e o desenho de
linhas de `FilesChanged.tsx`): linha acrescentada com `+` e fundo de `--tone-ok` suave, removida com `-` e fundo de
`--tone-danger` suave, o sinal sempre presente (estado nunca só por cor), mono 12px, numeração das duas colunas.

## Rótulos de autor, origem e confiança

| Valor                                                   | Texto (pt-BR / en)                                                                                                          | Ícone (lucide)                  |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| autor `owner`                                           | Você / You                                                                                                                  | `User`                          |
| autor `run:<id>`                                        | Execução <id curto> / Run <short id> (link para a execução)                                                                 | `Bot`                           |
| autor `mcp`                                             | Agente (MCP) / Agent (MCP)                                                                                                  | `Plug`                          |
| autor `external`                                        | Fora do MordomoOS / Outside MordomoOS                                                                                       | `FileEdit`                      |
| autor `system`                                          | MordomoOS                                                                                                                   | `Cpu`                           |
| autor `unknown` (fatos antigos)                         | Origem desconhecida / Unknown origin                                                                                        | `CircleHelp`                    |
| origem `create`, `save`, `properties`, `task`, `review` | Criada / Created, Editada / Edited, Propriedades / Properties, Tarefa / Task, Revisão / Review                              | —                               |
| origem `cleanup`, `proposal`, `restore`, `guard`        | Faxina / Cleanup, Proposta aceita / Accepted proposal, Restaurada / Restored, Desfeita pela guarda / Reverted by the guard  | —                               |
| origem `external`, `baseline`, `removed`, `import`      | Mudou fora do editor / Changed outside the editor, Primeira versão / First version, Apagada / Deleted, Importada / Imported | —                               |
| confiança `usuario`                                     | Escrito por você / Written by you                                                                                           | `UserCheck`, token `--tone-ok`  |
| confiança `ferramenta`                                  | Saída de ferramenta / Tool output                                                                                           | `Wrench`, token `--tone-warn`   |
| confiança `inferido`                                    | Inferido pelo agente / Inferred by the agent                                                                                | `Sparkles`, token `--tone-info` |
| estado `invalid`                                        | Origem inválida / Invalid source                                                                                            | `CircleSlash`                   |
| estado `conflict`                                       | A linha mudou / The line changed                                                                                            | `AlertTriangle`                 |

O selo de confiança é ícone + texto, sempre os dois; a cor é de apoio.

## Tela - Revisões, aba "Do agente"

Terceira aba das `Tabs` de "Revisões", depois de "Sem classificação": "Do agente (N)". `/brain/reviews?tab=agent` abre nela
(é o `href` da notificação). No Núcleo, o mesmo conteúdo no painel de cena de "Revisões".

- **Lista (esquerda):** uma proposta por item, a mais nova primeiro. Linha 1 (13px, peso 600): o título pelo tipo —
  "Consolidação de <dia>" (`consolidation`), "Mudança no MEMORY.md por <autor>" (`memory_edit`), "Fato: <sujeito> · <predicado>"
  (`fact`), "Nova nota: <título>" (`note_create`), "Edição de <nome da nota>" (`note_save`). Linha 2 (12px, cor secundária): o
  autor (rótulo acima), "há <tempo>" e "<n> operações". Foco visível; `j`/`k` movem; `Enter` abre.
- **Detalhe (direita), de cima para baixo:** o resumo da proposta (texto, até 2000 caracteres); o autor com o ícone; o diff
  (altura máxima de 50% da área, rolagem própria, título "O que muda no MEMORY.md" ou "O que muda em <nota>"); a lista das
  operações, uma por linha: caixa de seleção, a seção (`Facts`, `Decisions`, `Open loops`, `Reflections`, ou "Fato", "Tópico
  <slug>"), o texto da operação, a origem como link que abre o arquivo na vista de notas na linha citada, e o selo de
  confiança. Uma operação `invalid` ou `conflict` tem a caixa desligada e, abaixo do texto, o motivo em 12px com o ícone do
  estado. Acima da lista, "Marcar todas" e "Desmarcar todas" (`.btn.ghost.sm`).
- **Ações, ao pé do detalhe:** "Aceitar selecionadas (<k>)" (`.btn.primary`, `Check`; desligado com 0 marcadas) e "Recusar"
  (`.btn`, `X`). Uma proposta `memory_edit`, `note_create` ou `note_save` não tem lista de operações: as ações são "Aceitar"
  e "Recusar".
- **Recusar:** `Modal` "Recusar esta proposta?" com "Nada será gravado. A proposta fica no histórico de propostas." e os
  botões "Cancelar" e "Recusar" (`.btn.danger`).
- **Depois de aceitar:** o item sai como na aba "Para revisar", e o aviso "Proposta aceita." fica 8 s com o link "Ver
  histórico" (abre a seção "Histórico" do `MEMORY.md` ou da nota). Não há "Desfazer" no aviso: desfazer é restaurar a versão
  anterior.
- **Conflito (`409 edit_conflict`):** no detalhe, com `AlertTriangle`, "O MEMORY.md mudou desde que a proposta foi aberta."
  e "Recarregar"; o item fica.
- **Acima do teto (`409 memory_over_budget`):** com `AlertTriangle`, "Com estas operações o MEMORY.md passaria de 200 linhas
  ou 25 KB. Desmarque operações ou peça uma nova consolidação."; o item fica.
- **Vazio:** `Inbox` grande (32px), "Nada do agente para revisar." e o botão "Consolidar agora" (`.btn`, `Sparkles`), que
  inicia `consolidate-memory` e mostra "Consolidação iniciada. A proposta aparece aqui quando terminar." **Carregando** e
  **erro:** os das outras abas.

## Painel da nota, seção "Histórico"

Quarta seção recolhível do painel, depois de "Nesta nota", aberta por padrão. Uma linha por versão, a mais nova primeiro, até
50: o tempo relativo ("há 3 horas", com a data e a hora completas no `Tooltip`), o ícone e o rótulo do autor, e o rótulo da
origem em 12px. A versão igual ao arquivo atual leva o selo "Atual". Clicar numa versão abre o diálogo "Versão de <data e
hora>". Estados: "Sem versões ainda." / "Carregando…" / a mensagem com "Tentar de novo".

### Diálogo - Versão de <data e hora>

`Modal` de 720px. Cabeçalho: autor e origem. Corpo: o diff da versão atual para esta (título "Do texto atual para esta
versão"), ou o texto inteiro em mono quando a nota não existe mais. Rodapé: "Fechar" e "Restaurar esta versão"
(`.btn.primary`, `RotateCcw`; ausente na versão "Atual"). O erro de gravação fica no corpo, e o diálogo aberto. No
conflito, o texto do AC 42 com "Recarregar". Depois de restaurar: o diálogo fecha, a nota recarrega e o aviso "Versão
restaurada." fica 8 s.

## Diálogo - Histórico da memória

Aberto pelo `Menu` do cabeçalho NOTAS (item "Histórico da memória", `History`) e pelo comando de mesmo nome. `Modal` de
720px com a lista das 100 mudanças mais novas de `memory/`: o caminho em mono 12px, o tempo, o autor e a origem; um caminho
que não existe mais leva o selo "Apagada" (`Trash2` + texto) e o botão "Restaurar" (`.btn.sm`), que abre o diálogo da
versão mais nova com bytes. Vazio: "Nenhuma mudança registrada ainda." Carregando e erro como a seção.

## Diálogo - Permissões da pasta

Aberto pelo `Menu` de uma pasta na árvore de notas (item "Permissões…", `Shield`) e pelo botão de mesmo nome na linha da
pasta em Configurações › Memória. `Modal` de 480px, título "Permissões de <nome da pasta>", o caminho em mono 12px abaixo.

- **Agentes** (`<select>`): "Podem escrever" (`write`), "Só ler" (`read`), "Esconder" (`hide`). Abaixo, 12px, o efeito da
  escolha: "Execuções podem trabalhar e gravar aqui." / "Execuções leem, mas não gravam aqui." / "O MordomoOS não entrega esta
  pasta a nenhum agente. Codex e Cursor leem o disco inteiro: com eles, uma execução que contém esta pasta é recusada."
- **Dispositivos** (`<select>`): "Podem pedir escrita" (`write`), "Só ler" (`read`), "Esconder" (`hide`), com "Um
  dispositivo pode pedir uma execução que grava aqui; ela espera sua aprovação." / "Um dispositivo vê, mas não pede escrita
  aqui." / "Nenhum dispositivo vê esta pasta nem o que há nela."
- **Herdado:** quando uma pasta acima decide, uma linha 12px com `CornerLeftUp`: "Herdado de <pasta>"; mudar cria uma regra
  própria.
- Rodapé: "Cancelar" e "Salvar" (`.btn.primary`); "Remover restrição" (`.btn.ghost`) quando a pasta tem regra própria. O erro
  de gravação fica no corpo, e o `Modal` aberto. Nenhuma escolha apaga nada.

**Na árvore:** uma pasta com nível diferente de `write` mostra, depois do nome, `EyeOff` (algo escondido) ou `Lock` (só
ler), com `Tooltip` "Agentes: <nível> · Dispositivos: <nível>".

**Configurações › Memória:** abaixo das pastas indexadas, o bloco "Pastas com acesso restrito": uma linha por regra com o
caminho, "Agentes: <nível>", "Dispositivos: <nível>", "Permissões…" e "Remover restrição"; vazio: "Nenhuma pasta restrita."

## Diálogos - Exportar pasta e Importar pasta

- **Exportar:** item "Exportar pasta…" (`FolderOutput`) no `Menu` da pasta. `Modal` de 480px: "Copia esta pasta para a pasta
  de exportações do MordomoOS, com um manifesto que confere cada arquivo." e "Exportar" (`.btn.primary`). Enquanto copia,
  spinner + "Copiando…". Pronto: `CircleCheck`, "<N> arquivos, <tamanho> em" e o caminho em mono, com "Abrir pasta" e
  "Fechar". Erro: a mensagem do código (`folder_too_large`: "A pasta passa do limite de 2 000 arquivos ou 64 MB.").
- **Importar:** item "Importar pasta…" (`FolderInput`) no `Menu` do cabeçalho NOTAS, só com a raiz `memory/`. `Modal` de
  480px: campo "Pasta de origem" (caminho absoluto; dica "Uma pasta que o MordomoOS já lê: uma pasta indexada ou do home.")
  e campo "Nome da pasta nova" (preenchido pelo nome da origem). "Importar" (`.btn.primary`). Pronto: "<N> arquivos
  importados." e, quando houver, "<M> deixados de fora" com a lista (links, segredos e o que o filtro recusa); a árvore abre a
  pasta nova. Erros: `exists`: "Já existe uma pasta com esse nome em notes/."; `forbidden_path`: "O MordomoOS não lê essa
  pasta. Adicione-a como pasta indexada antes."

## Widget de fatos

Cada fato ganha, abaixo do texto, uma linha 12px com o selo de confiança, o autor e, quando há, a origem como link
("journal/2026-09-03.md:12"). Um fato retratado como errado não aparece na lista padrão.

## Texto (as duas línguas; as chaves entram em `locales/brain.ts`, `en` e `ptBR` com as mesmas chaves)

| Chave                                                   | pt-BR                                                                                                                                             | en                                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `reviews.tab.agent`                                     | Do agente ({n})                                                                                                                                   | From the agent ({n})                                                                                                                  |
| `proposals.title.consolidation`                         | Consolidação de {day}                                                                                                                             | Consolidation of {day}                                                                                                                |
| `proposals.title.memoryEdit`                            | Mudança no MEMORY.md por {author}                                                                                                                 | MEMORY.md change by {author}                                                                                                          |
| `proposals.title.fact`                                  | Fato: {subject} · {predicate}                                                                                                                     | Fact: {subject} · {predicate}                                                                                                         |
| `proposals.title.noteCreate`                            | Nova nota: {title}                                                                                                                                | New note: {title}                                                                                                                     |
| `proposals.title.noteSave`                              | Edição de {name}                                                                                                                                  | Edit of {name}                                                                                                                        |
| `proposals.ops`                                         | {n} operações                                                                                                                                     | {n} operations                                                                                                                        |
| `proposals.diff.memory`                                 | O que muda no MEMORY.md                                                                                                                           | What changes in MEMORY.md                                                                                                             |
| `proposals.diff.note`                                   | O que muda em {name}                                                                                                                              | What changes in {name}                                                                                                                |
| `proposals.selectAll` / `proposals.selectNone`          | Marcar todas / Desmarcar todas                                                                                                                    | Select all / Select none                                                                                                              |
| `proposals.accept`                                      | Aceitar selecionadas ({k})                                                                                                                        | Accept selected ({k})                                                                                                                 |
| `proposals.acceptOne`                                   | Aceitar                                                                                                                                           | Accept                                                                                                                                |
| `proposals.reject`                                      | Recusar                                                                                                                                           | Reject                                                                                                                                |
| `proposals.reject.title`                                | Recusar esta proposta?                                                                                                                            | Reject this proposal?                                                                                                                 |
| `proposals.reject.body`                                 | Nada será gravado. A proposta fica no histórico de propostas.                                                                                     | Nothing will be written. The proposal stays in the proposal history.                                                                  |
| `proposals.accepted`                                    | Proposta aceita.                                                                                                                                  | Proposal accepted.                                                                                                                    |
| `proposals.seeHistory`                                  | Ver histórico                                                                                                                                     | See history                                                                                                                           |
| `proposals.conflict`                                    | O MEMORY.md mudou desde que a proposta foi aberta.                                                                                                | MEMORY.md changed since the proposal was opened.                                                                                      |
| `proposals.overBudget`                                  | Com estas operações o MEMORY.md passaria de 200 linhas ou 25 KB. Desmarque operações ou peça uma nova consolidação.                               | With these operations MEMORY.md would pass 200 lines or 25 KB. Untick operations or ask for a new consolidation.                      |
| `proposals.empty`                                       | Nada do agente para revisar.                                                                                                                      | Nothing from the agent to review.                                                                                                     |
| `proposals.consolidateNow`                              | Consolidar agora                                                                                                                                  | Consolidate now                                                                                                                       |
| `proposals.consolidateStarted`                          | Consolidação iniciada. A proposta aparece aqui quando terminar.                                                                                   | Consolidation started. The proposal shows up here when it finishes.                                                                   |
| `proposals.invalidNotice`                               | A consolidação não deixou uma proposta válida                                                                                                     | The consolidation left no valid proposal                                                                                              |
| `proposals.notification`                                | {n} propostas do agente para revisar                                                                                                              | {n} agent proposals to review                                                                                                         |
| `history.title`                                         | Histórico                                                                                                                                         | History                                                                                                                               |
| `history.current`                                       | Atual                                                                                                                                             | Current                                                                                                                               |
| `history.empty`                                         | Sem versões ainda.                                                                                                                                | No versions yet.                                                                                                                      |
| `history.version`                                       | Versão de {when}                                                                                                                                  | Version of {when}                                                                                                                     |
| `history.diffTitle`                                     | Do texto atual para esta versão                                                                                                                   | From the current text to this version                                                                                                 |
| `history.restore`                                       | Restaurar esta versão                                                                                                                             | Restore this version                                                                                                                  |
| `history.restored`                                      | Versão restaurada.                                                                                                                                | Version restored.                                                                                                                     |
| `history.conflict`                                      | A nota mudou desde que você abriu. Recarregue e tente de novo.                                                                                    | The note changed since you opened it. Reload and try again.                                                                           |
| `history.memory`                                        | Histórico da memória                                                                                                                              | Memory history                                                                                                                        |
| `history.memory.empty`                                  | Nenhuma mudança registrada ainda.                                                                                                                 | No change recorded yet.                                                                                                               |
| `history.deleted`                                       | Apagada                                                                                                                                           | Deleted                                                                                                                               |
| `access.menu`                                           | Permissões…                                                                                                                                       | Permissions…                                                                                                                          |
| `access.title`                                          | Permissões de {name}                                                                                                                              | Permissions of {name}                                                                                                                 |
| `access.agents` / `access.devices`                      | Agentes / Dispositivos                                                                                                                            | Agents / Devices                                                                                                                      |
| `access.agents.write` / `.read` / `.hide`               | Podem escrever / Só ler / Esconder                                                                                                                | May write / Read only / Hide                                                                                                          |
| `access.devices.write` / `.read` / `.hide`              | Podem pedir escrita / Só ler / Esconder                                                                                                           | May ask to write / Read only / Hide                                                                                                   |
| `access.agents.write.hint`                              | Execuções podem trabalhar e gravar aqui.                                                                                                          | Runs may work and write here.                                                                                                         |
| `access.agents.read.hint`                               | Execuções leem, mas não gravam aqui.                                                                                                              | Runs read but do not write here.                                                                                                      |
| `access.agents.hide.hint`                               | O MordomoOS não entrega esta pasta a nenhum agente. Codex e Cursor leem o disco inteiro: com eles, uma execução que contém esta pasta é recusada. | MordomoOS hands this folder to no agent. Codex and Cursor read the whole disk: with them, a run that contains this folder is refused. |
| `access.devices.write.hint`                             | Um dispositivo pode pedir uma execução que grava aqui; ela espera sua aprovação.                                                                  | A device may ask for a run that writes here; it waits for your approval.                                                              |
| `access.devices.read.hint`                              | Um dispositivo vê, mas não pede escrita aqui.                                                                                                     | A device sees but does not ask to write here.                                                                                         |
| `access.devices.hide.hint`                              | Nenhum dispositivo vê esta pasta nem o que há nela.                                                                                               | No device sees this folder or what it holds.                                                                                          |
| `access.inherited`                                      | Herdado de {folder}                                                                                                                               | Inherited from {folder}                                                                                                               |
| `access.remove`                                         | Remover restrição                                                                                                                                 | Remove restriction                                                                                                                    |
| `access.tooltip`                                        | Agentes: {agents} · Dispositivos: {devices}                                                                                                       | Agents: {agents} · Devices: {devices}                                                                                                 |
| `access.restricted`                                     | Pastas com acesso restrito                                                                                                                        | Folders with restricted access                                                                                                        |
| `access.none`                                           | Nenhuma pasta restrita.                                                                                                                           | No restricted folder.                                                                                                                 |
| `export.menu` / `import.menu`                           | Exportar pasta… / Importar pasta…                                                                                                                 | Export folder… / Import folder…                                                                                                       |
| `export.intro`                                          | Copia esta pasta para a pasta de exportações do MordomoOS, com um manifesto que confere cada arquivo.                                             | Copies this folder into the MordomoOS exports folder, with a manifest that checks every file.                                         |
| `export.copying`                                        | Copiando…                                                                                                                                         | Copying…                                                                                                                              |
| `export.done`                                           | {n} arquivos, {size} em                                                                                                                           | {n} files, {size} in                                                                                                                  |
| `export.open`                                           | Abrir pasta                                                                                                                                       | Open folder                                                                                                                           |
| `export.tooLarge`                                       | A pasta passa do limite de 2 000 arquivos ou 64 MB.                                                                                               | The folder passes the limit of 2,000 files or 64 MB.                                                                                  |
| `import.source` / `import.sourceHint`                   | Pasta de origem / Uma pasta que o MordomoOS já lê: uma pasta indexada ou do home.                                                                 | Source folder / A folder MordomoOS already reads: an indexed folder or one in the home.                                               |
| `import.name`                                           | Nome da pasta nova                                                                                                                                | Name of the new folder                                                                                                                |
| `import.done`                                           | {n} arquivos importados.                                                                                                                          | {n} files imported.                                                                                                                   |
| `import.skipped`                                        | {m} deixados de fora                                                                                                                              | {m} left out                                                                                                                          |
| `import.exists`                                         | Já existe uma pasta com esse nome em notes/.                                                                                                      | A folder with that name already exists in notes/.                                                                                     |
| `import.forbidden`                                      | O MordomoOS não lê essa pasta. Adicione-a como pasta indexada antes.                                                                              | MordomoOS does not read that folder. Add it as an indexed folder first.                                                               |
| `trust.usuario` / `trust.ferramenta` / `trust.inferido` | os textos da tabela "Rótulos"                                                                                                                     | idem                                                                                                                                  |
| `author.*`, `origin.*`, `opState.*`                     | os textos da tabela "Rótulos"                                                                                                                     | idem                                                                                                                                  |
