# Cérebro v2 — design das telas (binding para a feature)

Decide as três telas que a feature toca (o editor de nota, a seção de links do preview, o progresso da indexação), o texto
de cada uma nas duas línguas, e o que elas herdam. Ficam fora daqui: o desenho do grafo e do Núcleo (não mudam), o formato
de arquivo da nota (é do `plan.md`).

## Binding sources

| Source                                                            | O que decide                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.specs/features/design-system/design.md`                         | piso de 12px, texto corrido a 13px, cor só por token (stylelint), estado nunca só por cor (ícone e texto), axe sem `serious`/`critical`, a galeria cobre as duas camadas                                                                                                                    |
| `.specs/features/primitivas/design.md`                            | o editor, a confirmação e o novo-nota são `Modal` (Radix `Dialog`): foco entra, o resto fica inerte, o foco volta a quem abriu, Esc fecha o de cima; o select de área é o `<select>` nativo do tema (não há primitiva de select); nenhum CSS fora de `ui/ui.css` desenha parte de primitiva |
| `.specs/features/comandos-atalhos/design.md`                      | "Nova nota" é um comando do registro (`global`, na paleta) e `N` é tecla do escopo `view:brain`; nenhum ouvinte de teclado novo fora do registro (a `listenersAllowlist` não cresce); uma tecla nua não age dentro de um campo                                                              |
| `.specs/features/moldura-app/design.md` (Tela do Segundo Cérebro) | o preview é o painel `aside` do cérebro, com título, caminho, selos e ações; o botão novo entra na fileira de ações e usa `.btn.sm`                                                                                                                                                         |
| `.specs/features/limpeza-legado/design.md`                        | um só renderizador de Markdown (`components/Markdown.tsx`); o editor não desenha Markdown, só edita texto; nada de CSS ou chave de tradução sem uso (os testes de varredura valem)                                                                                                          |

## Tela - Editor de nota

Diálogo (`Modal`, largura até 880px, altura até 85vh), aberto de três lugares: o comando "Nova nota" (que abre antes o diálogo
de criação abaixo e depois este), "Editar" no preview de uma nota editável, e a cópia de um conflito.

- Cabeçalho: o título da nota (o `# ` da primeira linha ou o nome do arquivo), o caminho em fonte mono 12px, e à direita o
  estado: ícone + texto (`Salvo` com `Check`, `Alterações não salvas` com `Circle`, `Salvando…` com `Loader`, `Conflito` com
  `AlertTriangle`, `Erro ao salvar` com `AlertTriangle`). O estado é `role="status"`; o conflito e o erro repetem-se no corpo.
- Corpo: um `<textarea>` com rótulo (`aria-label` = "Texto da nota"), fonte mono 13px, `spellcheck` ligado, ocupa a altura toda,
  sem editor rico. Abaixo, uma linha de apoio: tamanho em bytes / limite (`12 KB de 1 MB`).
- Rodapé: "Fechar" (`.btn`), "Salvar" (`.btn.primary`, desabilitado enquanto o texto é igual ao salvo ou enquanto salva).
  ⌘S / Ctrl+S salva (tecla do campo, registrada no escopo `modal` do registro).
- Carregando: spinner + "Carregando…" no lugar do corpo. Erro de leitura: mensagem + "Tentar de novo". Não editável: a razão
  (`reason`) no lugar do campo e nenhum "Salvar".
- Conflito: faixa `role="alert"` acima do campo: "Esta nota mudou no disco depois que você a abriu." com "Carregar a versão do disco"
  (troca o texto pelo do disco, descarta o seu) e "Salvar como cópia" (cria `<título> (cópia)` com o seu texto e abre a cópia).
  Enquanto a faixa está, "Salvar" fica desabilitado; o texto da pessoa nunca é apagado sem ela escolher.
- Fechar com alterações: `Modal` de confirmação "Descartar as alterações não salvas?" com "Descartar" e "Continuar editando"
  (o foco inicial é "Continuar editando"); Esc, Fechar e o véu passam por ela.

## Tela - Nova nota

Diálogo pequeno (`Modal`, 420px): campo "Título" (obrigatório, até 200 caracteres, foco inicial), select "Área (opcional)" com as áreas
das configurações, caixa "Cabeçalho YAML" (desmarcada), "Criar" e "Cancelar". "Criar" desabilitado com o título vazio; erro da
API na própria caixa; ao criar, fecha e abre o editor sobre a nota nova.

## Tela - Links no preview

Seção `aria-label="Links"` logo abaixo das relações existentes, no `PreviewPanel`, só para Markdown:

- "Backlinks (N)": lista de botões `.brain-md-link` (o nome da nota de origem, a linha, o texto do link); clicar seleciona a nota.
- "Links quebrados (N)": os destinos que não resolvem, em lista simples com o texto do link e o ícone `Unlink`; sem botão.
- Vazio: "Nenhuma nota aponta para esta." Carregando: spinner + texto. Erro: mensagem + "Tentar de novo".

## Tela - Progresso da indexação

Na barra do Segundo Cérebro (onde "Reindexar" já mora): enquanto roda, a fase em texto (`Varrendo`, `Indexando`, `Removendo`,
`Calculando relações`, `Vetores`) e `scanned/total`, e o botão "Cancelar". Depois do cancelamento: "Indexação cancelada" (texto,
ícone `Ban`). Falha: o código traduzido (`index_worker_crashed` → "O indexador parou; o índice anterior foi mantido").

## Texto (as duas línguas; as chaves entram em `locales/brain.ts`, `en` e `ptBR` com as mesmas chaves)

| Chave                       | en                                             | pt-BR                                             |
| --------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| `note.new`                  | New note                                       | Nova nota                                         |
| `note.new.title`            | Title                                          | Título                                            |
| `note.new.area`             | Area (optional)                                | Área (opcional)                                   |
| `note.new.frontMatter`      | YAML header                                    | Cabeçalho YAML                                    |
| `note.new.create`           | Create                                         | Criar                                             |
| `note.edit`                 | Edit                                           | Editar                                            |
| `note.edit.title`           | Edit note                                      | Editar nota                                       |
| `note.field`                | Note text                                      | Texto da nota                                     |
| `note.save`                 | Save                                           | Salvar                                            |
| `note.state.saved`          | Saved                                          | Salvo                                             |
| `note.state.dirty`          | Unsaved changes                                | Alterações não salvas                             |
| `note.state.saving`         | Saving…                                        | Salvando…                                         |
| `note.state.conflict`       | Conflict                                       | Conflito                                          |
| `note.state.error`          | Could not save                                 | Erro ao salvar                                    |
| `note.loading`              | Loading…                                       | Carregando…                                       |
| `note.conflict.body`        | This note changed on disk after you opened it. | Esta nota mudou no disco depois que você a abriu. |
| `note.conflict.reload`      | Load the version on disk                       | Carregar a versão do disco                        |
| `note.conflict.copy`        | Save as a copy                                 | Salvar como cópia                                 |
| `note.discard.title`        | Discard unsaved changes?                       | Descartar as alterações não salvas?               |
| `note.discard.confirm`      | Discard                                        | Descartar                                         |
| `note.discard.keep`         | Keep editing                                   | Continuar editando                                |
| `note.size`                 | {size} of {limit}                              | {size} de {limit}                                 |
| `brain.links`               | Links                                          | Links                                             |
| `brain.links.backlinks`     | Backlinks                                      | Backlinks                                         |
| `brain.links.broken`        | Links to nothing                               | Links quebrados                                   |
| `brain.links.none`          | No note points here.                           | Nenhuma nota aponta para esta.                    |
| `brain.links.retry`         | Try again                                      | Tentar de novo                                    |
| `brain.links.line`          | line {n}                                       | linha {n}                                         |
| `brain.index.phase.scan`    | Scanning                                       | Varrendo                                          |
| `brain.index.phase.index`   | Indexing                                       | Indexando                                         |
| `brain.index.phase.prune`   | Removing                                       | Removendo                                         |
| `brain.index.phase.related` | Computing relations                            | Calculando relações                               |
| `brain.index.phase.vectors` | Vectors                                        | Vetores                                           |
| `brain.index.cancel`        | Cancel                                         | Cancelar                                          |
| `brain.index.cancelled`     | Indexing cancelled                             | Indexação cancelada                               |
