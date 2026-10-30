# Cérebro: vista de notas — design das telas (binding para a feature)

Decide a vista de notas do Segundo Cérebro (a alternativa ao grafo), nos dois shells, o texto de cada parte nas duas línguas e o
que ela herda. A inspiração é uma imagem de outro produto que o dono mandou (árvore à esquerda, Home, abas, tabela de
propriedades, corpo renderizado); a regra do dono foi "não copie, pense em features e robustez para o nosso", então o que segue
é a composição do MordomoOS, não a do print: as raízes são as pastas que o índice já tem, o estado do índice entra onde o print
mostra sincronização, e o que não se edita diz por quê. Ficam fora daqui: o grafo e a cena imersiva (só ganham o seletor de
vista e "Ver no grafo"), e o formato de arquivo das propriedades (é do `plan.md`, door 3).

## Binding sources

| Source                                                           | O que decide                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.specs/features/design-system/design.md`                        | piso de 12px, texto corrido a 13px, cor só por token (stylelint), estado nunca só por cor (ícone e texto), axe sem `serious`/`critical` nos dois temas, a galeria cobre as duas camadas                                                                                          |
| `.specs/features/primitivas/design.md`                           | abas são `Tabs` (Radix), menus de linha são `Menu`, confirmações são `Modal`, dicas são `Tooltip`; nenhum CSS fora de `ui/ui.css` desenha parte de primitiva; não há primitiva de select (o `<select>` nativo do tema)                                                           |
| `.specs/features/comandos-atalhos/design.md`                     | "Ver notas", "Ver grafo", "Definir como Home" e "Fechar aba" são comandos do registro; `V` alterna a vista no escopo `view:brain`; ⌘S / Ctrl+S salva no escopo do campo; uma tecla nua não age dentro de um campo; a `listenersAllowlist` não cresce                             |
| `.specs/features/moldura-app/design.md` (Tela 1)                 | na moldura a vista ocupa o `main` de `/brain`; a conversa continua no `aside` à direita; nada desenha por cima da barra lateral do app                                                                                                                                           |
| `.specs/features/limpeza-legado/design.md`                       | um só renderizador de Markdown (`components/Markdown.tsx`, forma `panel`); a vista não desenha Markdown por conta própria e não usa `dangerouslySetInnerHTML`                                                                                                                    |
| `.specs/features/cerebro-v2/design.md` (Tela Editor, Tela Links) | os estados do editor (`Salvo`, `Alterações não salvas`, `Salvando…`, `Conflito`, `Erro ao salvar`, ícone + texto), a faixa de conflito com "Carregar a versão do disco" e "Salvar como cópia", a confirmação de descarte, e a seção de links (backlinks, quebrados, vazio, erro) |
| `.specs/features/cerebro-contextos/design.md` (Tela Seletor)     | o seletor de contexto no topo da barra das notas é o mesmo componente, com os mesmos estados e textos                                                                                                                                                                            |

## Tela - Vista de notas (`/brain/notes` na moldura; modo "Notas" da cena do cérebro no Núcleo)

Três colunas dentro da área da vista: a barra das notas (260px, redimensionável de 200 a 400px, recolhível), a área de leitura
(o resto) e o painel da nota (280px, recolhível, fechado abaixo de 1100px de largura útil). Acima das três, a fileira da vista
com o seletor "Grafo | Notas" (dois botões `.btn.sm` com `aria-pressed`, o mesmo nos dois shells).

### Barra das notas (esquerda)

0. **Contexto**, acima de tudo: o seletor de contexto de `cerebro-contextos` (o mesmo componente, binding em
   `.specs/features/cerebro-contextos/design.md`). Com um contexto ativo, as raízes abaixo são os caminhos dele e a pasta de
   notas dele; com "Todo o cérebro", as raízes de sempre.
1. **Raiz**, logo abaixo do contexto: um botão com o ícone da raiz, o nome (`Memória` para `memory/`, o nome da pasta para uma pasta
   indexada) e o caminho em mono 12px abaixo; abre um `Menu` com as raízes: `memory/` primeiro, depois as pastas indexadas
   habilitadas na ordem das configurações (ou, com contexto ativo, os caminhos do contexto na ordem dele). Cada item mostra o nome, o caminho e um selo de texto: `Editável` (só `memory/`) ou
   `Somente leitura` (as outras), e `Indexando` enquanto o índice passa por ela. A raiz escolhida filtra a árvore.
2. **Estado do índice**, na mesma caixa da raiz, uma linha: ícone + texto — `Indexado · <há quanto>` (`Check`),
   `Indexando <x> de <y>` (`Loader`, com a fase do `index.progress`), `Indexação cancelada` (`Ban`), `Falhou` (`CircleAlert`,
   o código traduzido no `Tooltip`). Ao lado, um botão de ícone "Reindexar" (`RefreshCw`) que vira "Cancelar" (`X`) enquanto
   indexa. É `role="status"`.
3. **Home**: com uma Home definida, uma linha com o ícone `Home` e o título da nota; clicar abre a nota numa aba. Sem Home, um
   botão tracejado "Definir uma Home" que abre o `Menu` "Escolher nota…" (a busca do cérebro) — e o comando "Definir como Home"
   na nota aberta. A Home é por raiz.
4. **NOTAS**, cabeçalho em versalete 12px, com ícones à direita (cada um com `Tooltip` e rótulo acessível): "Nova nota"
   (`FilePlus`), "Nova pasta" (`FolderPlus`), "Recolher tudo" (`ChevronsDownUp`), "Ordenar" (`ArrowDownWideNarrow`, abre um
   `Menu`: `Nome` / `Atualizado`). Os dois primeiros só aparecem com a raiz `memory/`.
5. **Árvore**: pastas primeiro, depois arquivos, cada grupo na ordem escolhida. Pasta: chevron, ícone `Folder`/`FolderOpen`,
   nome, e, quando não se edita, o ícone `Lock` com `Tooltip` dizendo o motivo ("Pasta fora de memory/: somente leitura",
   "Gerada pelo MordomoOS"). Arquivo: ícone `FileText`, o título (ou o nome sem extensão), `Lock` pelo mesmo motivo. A linha
   ativa tem o fundo de seleção do tema; foco por teclado com setas (cima/baixo move, direita abre, esquerda fecha), Enter abre,
   como uma `tree` ARIA (`role="tree"`, `treeitem`, `aria-expanded`, `aria-level`). Uma pasta com mais itens que o teto mostra
   ao fim "+N não mostrados" (texto, sem ação).

### Área de leitura (centro)

1. **Abas** (`Tabs`): uma por nota aberta, com o título e um botão "Fechar aba" (`X`, rótulo acessível "Fechar <título>"); uma
   aba com alterações não salvas mostra um ponto e o texto oculto "alterações não salvas". Ao fim, "+" abre a busca do cérebro
   para abrir outra nota. Até 12 abas.
2. **Cabeçalho da nota**: o título (24px, o maior texto da vista), o caminho em mono 12px, e à direita as ações em `.btn.sm`:
   "Editar" / "Ler" (alterna), "Ver no grafo", e um `Menu` "Mais" com "Definir como Home", "Exportar Markdown",
   "Abrir no editor do sistema" e "Copiar caminho". Uma nota que não se edita mostra o selo "Somente leitura" com o motivo e
   nenhum "Editar".
3. **Propriedades**: uma tabela de duas colunas logo abaixo do cabeçalho. Coluna da chave: o ícone do tipo (`Text`, `Tag`,
   `Calendar`, `CircleDot`, `ListChecks` para seleção, `Repeat` para intervalo) e a chave; coluna do valor: texto, chips de
   etiqueta com "remover" (`X`), data, o `<select>` de `status`, de `natureza` (Fato, Opinião, Plano, Hipótese, Relato) e de
   `escopo` (Pessoal, Equipe, Externo), ou o campo de `review_every` com a lista de sugestões (`7d`, `30d`, `90d`, `180d`,
   `365d`, `never`) e o erro "Use um número de dias, como 30d, ou never." abaixo dele. Clicar num valor edita no lugar; Enter ou sair do campo grava, Esc desfaz. A última linha é "+ Adicionar
   propriedade" (abre a chave e o tipo). Cada linha tem um `Menu` com "Remover". Linhas que o leitor não entende (YAML aninhado)
   aparecem juntas, em mono, sob "Outras propriedades (somente leitura)". Sem cabeçalho no arquivo, só "+ Adicionar
   propriedade". Numa nota que não se edita, a tabela é só leitura e o "+" não aparece.
4. **Corpo**: lendo, o Markdown pelo renderizador único (forma `panel`), sem o bloco de cabeçalho; tabelas como tabela;
   `[[alvo]]`, `[[alvo|texto]]` e links relativos para nota viram botões que abrem a nota numa aba (o link quebrado é texto
   com o ícone `Unlink` e o `Tooltip` "Nenhuma nota com este nome"). Os callouts de natureza (`> [!fato]`, `> [!opiniao]`,
   `> [!plano]`, `> [!hipotese]`, `> [!relato]`) são uma caixa com borda à esquerda em token, o ícone (`CheckCircle2`,
   `MessageCircle`, `Map`, `FlaskConical`, `BookOpen`) e o rótulo em texto 12px (Fato, Opinião, Plano, Hipótese, Relato) acima
   do conteúdo; um callout desconhecido é citação comum. Editando, o `<textarea>` do editor (mono 13px), a linha de
   estado do `cerebro-v2` (ícone + texto, `role="status"`) e "Salvar". Digitar `[[` abre uma lista (`listbox`) de até 8 notas
   que casam com o texto depois do `[[`; setas movem, Enter insere `[[Título]]`, Esc fecha.
5. **Pasta selecionada**: clicar numa pasta da árvore mostra, se a pasta tiver nota-índice, essa nota (com o selo "Índice da
   pasta"); senão, a lista dos itens da pasta com título, tipo e data de atualização.

### Painel da nota (direita)

Três seções recolhíveis, nesta ordem: "Backlinks" e "Links quebrados" (a seção de links do `cerebro-v2`, sem mudança de texto),
"Relacionadas" (do índice, com o porquê em 12px), e "Nesta nota" (os títulos `##` como sumário; clicar rola até eles).

### Estados

- Carregando a árvore: três linhas de esqueleto com o texto oculto "Carregando…"; a nota: spinner + "Carregando…".
- Nada indexado: na árvore, "Nada indexado ainda." com "Reindexar"; raiz sem notas: "Nenhuma nota nesta pasta." e, em
  `memory/`, "Nova nota".
- Nenhuma aba aberta: a Home, se houver; senão "Abra uma nota na árvore ou defina uma Home." com "Definir uma Home".
- Erro da árvore ou da nota: a mensagem e "Tentar de novo" no lugar do conteúdo (`role="alert"`).
- Nota que sumiu (404): "Esta nota não existe mais." com "Fechar aba".
- Conflito ao salvar corpo ou propriedade: a faixa de conflito do `cerebro-v2`.

## Tela - Nova nota / Nova pasta

"Nova nota" abre o `Modal` de criação do `cerebro-v2`, com a pasta selecionada na árvore já escolhida (campo "Pasta", só
leitura, com "Trocar"). "Nova pasta" abre um `Modal` pequeno (420px) com "Nome da pasta" e "Título da primeira nota", ambos
obrigatórios, e "Criar": uma pasta nasce com uma nota (pasta vazia não entra no índice). Com a estrutura fixa ligada, "Nova
pasta" na raiz de `memory/notes` fica desabilitado com o `Tooltip` "Estrutura fixa: crie dentro de uma pasta existente".

## Texto (as duas línguas; as chaves entram em `locales/brain.ts`, `en` e `ptBR` com as mesmas chaves)

| pt-BR                                              | en                                                |
| -------------------------------------------------- | ------------------------------------------------- |
| Grafo / Notas                                      | Graph / Notes                                     |
| Memória                                            | Memory                                            |
| Editável / Somente leitura / Indexando             | Editable / Read-only / Indexing                   |
| Indexado · {quando}                                | Indexed · {when}                                  |
| Indexando {x} de {y}                               | Indexing {x} of {y}                               |
| Indexação cancelada / Falhou                       | Indexing cancelled / Failed                       |
| Reindexar / Cancelar                               | Reindex / Cancel                                  |
| Definir uma Home / Definir como Home               | Set a home / Set as home                          |
| NOTAS                                              | NOTES                                             |
| Nova nota / Nova pasta / Recolher tudo / Ordenar   | New note / New folder / Collapse all / Sort       |
| Nome / Atualizado                                  | Name / Updated                                    |
| Pasta fora de memory/: somente leitura             | Folder outside memory/: read-only                 |
| Gerada pelo MordomoOS                              | Generated by MordomoOS                            |
| +{n} não mostrados                                 | +{n} not shown                                    |
| Fechar {título}                                    | Close {title}                                     |
| Editar / Ler / Ver no grafo / Mais                 | Edit / Read / Show in graph / More                |
| Exportar Markdown / Abrir no editor do sistema     | Export Markdown / Open in system editor           |
| Copiar caminho                                     | Copy path                                         |
| + Adicionar propriedade / Remover                  | + Add property / Remove                           |
| Outras propriedades (somente leitura)              | Other properties (read-only)                      |
| Fato / Opinião / Plano / Hipótese / Relato         | Fact / Opinion / Plan / Hypothesis / Account      |
| Pessoal / Equipe / Externo                         | Personal / Team / External                        |
| Use um número de dias, como 30d, ou never.         | Use a number of days, like 30d, or never.         |
| Nenhuma nota com este nome                         | No note with this name                            |
| Índice da pasta                                    | Folder index                                      |
| Relacionadas / Nesta nota                          | Related / On this note                            |
| Nada indexado ainda.                               | Nothing indexed yet.                              |
| Nenhuma nota nesta pasta.                          | No notes in this folder.                          |
| Abra uma nota na árvore ou defina uma Home.        | Open a note from the tree or set a home.          |
| Esta nota não existe mais.                         | This note no longer exists.                       |
| Nome da pasta / Título da primeira nota / Criar    | Folder name / First note title / Create           |
| Estrutura fixa: crie dentro de uma pasta existente | Fixed structure: create inside an existing folder |

## Emendas depois da aprovação, registradas em vez de reescritas

O texto aprovado acima fica como foi aprovado. O desenho veio antes de `cerebro-contextos` (C2) e `cerebro-organizar` (C3)
estarem construídas; o que elas mudam nesta tela fica aqui, com o item de `plan.md` ("Emendas depois da aprovação") e o check
que o prova.

- **Barra das notas, item 0 (plan 1).** O `ContextSelector` da C2 é um por shell e já está na tela (moldura: abaixo da marca;
  Núcleo: à esquerda da linha de voz). O item 0 é a linha do contexto ativo: o ícone `Crosshair` e o nome do contexto, ou
  "Todo o cérebro" / "Whole brain" (a chave `context.all` da C2), num botão que abre o menu desse seletor (o comando
  `action:switch-context`, "Trocar de contexto" / "Switch context"). Nenhum segundo seletor é montado (C31).
- **Raiz, item 1 (plan 2, 11).** Com um contexto ativo o `Menu` lista só os caminhos `ok` dele, na ordem dele, e a pasta de
  notas dele quando existe; um caminho dentro de `memory/` e a pasta de notas têm o selo `Editável`. O selo `Indexando` aparece
  em toda raiz enquanto uma passada roda, porque a passada não diz a raiz (C12, C32).
- **Árvore, item 5 (plan 9).** O `Lock` ganha um terceiro motivo: um arquivo de `memory/` que não é `.md`, com o `Tooltip`
  "Só notas .md se editam" / "Only .md notes can be edited". "Gerada pelo MordomoOS" vale também para `memory/contexts/` (C39).
- **Pasta selecionada, item 5 da área de leitura (plan 4, 5).** A nota-índice é primeiro o `_index.md` de `cerebro-organizar`
  (ao lado das notas em `memory/notes/`, em `memory/maps/…` para uma pasta do usuário), depois `index.md`, `README.md`,
  `CLAUDE.md`, `AGENTS.md`; a lista de uma pasta sem ela tira o tipo de `fields.type` do índice (C40).
- **Propriedades, item 3 (plan 6).** `type` é texto (o vocabulário da C3 é aberto); uma data lida que não é `AAAA-MM-DD` (o
  `created` que "Nova nota" escreve é um instante ISO) aparece como texto, sem campo de data, e fica como está (C56).
- **"+N não mostrados" (plan 10).** N vem do campo `omitted` da resposta da árvore (C38).

| pt-BR                  | en                           |
| ---------------------- | ---------------------------- |
| Só notas .md se editam | Only .md notes can be edited |
