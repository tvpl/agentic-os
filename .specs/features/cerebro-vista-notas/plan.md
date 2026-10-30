# Cérebro: vista de notas — árvore, Home, abas, propriedades e leitura fora do grafo

## Problem

O Segundo Cérebro só se lê como grafo. Levantamento em `chore/cerebro-v3-roteiro`:

- **Não há onde ler o acervo como acervo.** As duas telas (`views/SecondBrain.tsx`, `nucleo/scenes/BrainScene.tsx`) partem de
  um grafo de até 3 000 nós escolhidos pelos mais recentes (`graph.ts:66`); a nota aparece num painel lateral
  (`brain/PreviewPanel.tsx`) ou num leitor da cena, e uma pasta não é coisa que se abre. A pesquisa de 29/10/2026 registra que o
  grafo global vira "novelo" e serve de diagnóstico, não de navegação (`reports/Segundo cérebro para agentes.md`, seção "Exibir
  para diagnosticar…", fontes do fórum Zettelkasten e da comparação de bibliotecas de grafo).
- **Editar é um diálogo que esconde o resto.** O editor é um `Modal` (`brain/NoteEditor.tsx`), então ler os backlinks ou uma
  nota vizinha enquanto se escreve exige fechar e reabrir; só há uma nota aberta por vez.
- **As propriedades da nota não existem para a pessoa.** O índice lê do cabeçalho só `title` e `tags`
  (`core/src/memory/frontMatter.ts`) e os campos `chave:: valor` do corpo (`fields.ts`); `type`, `status`, `updated`,
  `last_reviewed` que um cabeçalho traga não são vistos nem editáveis, e mudar uma é reescrever o YAML à mão no `textarea`.
- **O que não se edita não diz por quê.** Só `memory/` é editável (AD-031); as pastas do usuário são somente leitura e
  `ROUTER.md`, `areas/`, `journal/` são gerados, mas a tela só descobre isso ao abrir o editor (`editable: false`, `reason`).
- **O estado do índice mora longe da leitura.** "Reindexar" e o progresso ficam na barra do grafo; quem lê não sabe se o que
  vê está atualizado.
- **Três cópias do mesmo acesso a dados.** O pedido do grafo, a busca enquanto digita e os relacionados estão duplicados nas
  duas telas (`SecondBrain.tsx:79` e `:324`, `BrainScene.tsx:118`, `:693` e `:782`); uma terceira tela copiaria de novo.

O dono mandou como inspiração prints de outro produto (árvore, Home, abas, tabela de propriedades) com a regra "não copie,
pense em features e robustez para o nosso". Nenhuma métrica de uso foi dada.

Quando isto sair: em `/brain` a pessoa alterna "Grafo | Notas"; na vista de notas escolhe o contexto de trabalho (`cerebro-contextos`, C2) e, dentro dele, a raiz (`memory/` ou uma pasta
indexada, com o que se edita e o que não), vê o estado do índice, navega pela árvore, fixa uma Home, abre notas em abas, lê o
Markdown com tabelas e links que abrem outra aba, edita as propriedades tipadas e o corpo no lugar, com backlinks e relacionadas
ao lado.

## Flow

Reutiliza o índice (`files`), o `rowFilter`, `GET /api/memory/note` e `PUT /api/memory/notes` (com `baseVersion` e
`409 edit_conflict`), `linksOf` (só `note_links`, desde `cerebro-correcoes`), `relatedFiles`, `contextMembership` e
`contextOkPaths` (`cerebro-contextos`), a regra de onde mora `_index.md` (`core/src/memory/maps.ts`, `cerebro-organizar`), o
renderizador único `components/Markdown.tsx`, as primitivas de `ui/`, o registro de comandos, `UiPreferences`,
`useWorkContext` e os eventos `index.*`; nenhum leitor de disco novo, nenhum segundo renderizador.

1. Árvore → `GET /api/memory/tree` (new, door 1) em `apps/api/src/routes/memory.ts` (exists) chama `memoryTree` (new, door 1)
   em `core/src/memory/tree.ts`, que lê só linhas de `files` sob a raiz e a pasta pedidas, filtradas por `rowFilter` e, com
   `context`, por `contextMembership` (`core/src/memory/contexts.ts`, exists), e devolve as subpastas com contagem, os arquivos
   com título, tipo (`fields.type`), `mtime`, `editable`/`reason`, e a nota-índice da pasta, achada nas linhas pela regra de
   `INDEX_NOTE`/`rootSlug` (`core/src/memory/maps.ts`, exists) e, sem ela, pelos nomes de sempre.
2. Nota → `GET /api/memory/note` (exists, muda: door 2) devolve também as `properties` lidas por `parseProperties` (new, door 3)
   em `core/src/memory/frontMatter.ts` (exists) e o `bodyStart`.
3. Propriedade → `PUT /api/memory/notes/properties` (new, door 2) → `saveProperties` (new) em `core/src/memory/notes.ts`
   (exists) confere a mudança, a nota e a versão, chama `setProperties` (new, door 3) em `frontMatter.ts`, que reescreve só as
   linhas das chaves tocadas, e grava por `writeWorkspaceFile` (exists) com `expectSha256`; devolve a versão nova e pede a
   reindexação do caminho (`requestIndexPaths`, exists).
4. Pasta nova → `POST /api/memory/notes` (exists, muda: door 2) aceita `folder` sob `memory/notes`; `createNote` (exists,
   `core/src/memory/notes.ts`) a cria com a primeira nota; com `memory.notes.fixedStructure` (door 5) recusa criar pasta.
5. Interface → `brain/memoryData.ts` (new, no door - placement per conventions) concentra o pedido do grafo (`graphRequest`,
   que saiu de `contexts/useWorkContext.ts`), a busca (`useBrainSearch`, que saiu de `brain/useBrainSearch.ts`) e os
   relacionados (`useRelatedFiles`) para `SecondBrain.tsx` (exists), `BrainScene.tsx` (exists) e a vista de notas
   (`brain/notes/`, new, no door - placement per conventions, um chunk próprio carregado por `brain/BrainViewSwitch.tsx`, que
   desenha "Grafo | Notas" e registra `v` nos dois shells); a vista lê a árvore, a nota e os links por
   `brain/notes/notesData.ts` e desenha a barra (com a linha do contexto ativo de `useWorkContext`, exists, que abre o
   `ContextSelector` do shell, exists), as abas, as propriedades, o corpo por `Markdown` (exists; `brain/markdown.ts` lê os
   callouts de natureza) e o painel com `LinksSection` (exists).
6. Persistência da vista → `PUT /api/ui-preferences` (exists) guarda `brain.notes` (door 4): raiz, Home por raiz, abas, aba
   ativa, ordem e pastas abertas.

## Impact

| Front         | What changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain        | new term: `raiz` — `memory/` ou uma pasta indexada habilitada (com um contexto ativo: um caminho `ok` dele ou a pasta de notas dele); um escopo da vista sobre o que o índice já tem, não um cofre novo                                                                                                                                                                                                                                                                                                                                                                                                                |
| domain        | new term: `propriedade` — uma linha `chave: valor` de primeiro nível do cabeçalho `---` de uma nota, com um tipo (`text`, `list`, `date`, `status`); o resto do cabeçalho é "outras propriedades", preservado byte a byte                                                                                                                                                                                                                                                                                                                                                                                              |
| domain        | new term: `nota-índice` — o `_index.md` de uma pasta onde `cerebro-organizar` o põe (ao lado das notas em `memory/notes/`, em `memory/maps/<slug da raiz>/…` para uma pasta do usuário) e, sem ele, o primeiro de `index.md`, `README.md`, `CLAUDE.md`, `AGENTS.md` na pasta; quem escreve `_index.md` é a skill organize-brain, a vista só lê                                                                                                                                                                                                                                                                         |
| domain        | existing term: `brain.view` em `UiPreferences` era o agrupamento do grafo (`areas`, `folders`); não muda; a vista nova é a rota `/brain/notes`, não um valor de `view` — quem ramifica hoje em `view`: `brain/state.ts:57`                                                                                                                                                                                                                                                                                                                                                                                             |
| domain        | existing term: `title` do índice vinha de `title:` ou do primeiro `#`; não muda — o índice guarda do cabeçalho `title`, `tags` e, desde `cerebro-organizar` (door 6), as sete chaves de `FRONT_MATTER_FIELDS` em `fields`; a árvore lê o tipo de `fields.type`, a tabela de propriedades lê o arquivo                                                                                                                                                                                                                                                                                                                  |
| stored data   | nada a migrar no banco; `config/ui-preferences.json` ganha `brain.notes` (aditivo, `.catch` como o resto); `settings.json` ganha `memory.notes.fixedStructure` (padrão `false`); um cabeçalho existente só muda quando a pessoa edita uma propriedade daquela nota                                                                                                                                                                                                                                                                                                                                                     |
| contrato REST | `GET /api/memory/note` ganha `properties`, `otherProperties`, `bodyStart`; `POST /api/memory/notes` ganha `folder?` e o erro `409 structure_fixed`; duas rotas novas (`Surface`; a árvore com `omitted` e `files[].type`, "Emendas" 5 e 10)                                                                                                                                                                                                                                                                                                                                                                            |
| interface     | `/brain` ganha o seletor "Grafo \| Notas" nos dois shells; o `NoteEditor` em diálogo continua para "Nova nota" fora da vista e para o grafo; o pedido do grafo, a busca e os relacionados passam a vir de um só módulo (e os relacionados da cena do Núcleo passam a levar o contexto ativo); a barra das notas segue o contexto ativo de `useWorkContext` e não monta um segundo `ContextSelector`; o renderizador único desenha `> [!fato]`, `> [!opiniao]`, `> [!plano]`, `> [!hipotese]` e `> [!relato]` como callout em toda forma (`page`, `panel`, `scene`), e qualquer outro `> [!x]` como citação, como antes |

## Relations

None - no stored-data shape change (o banco não muda; as propriedades vivem no arquivo, e `brain.notes` é um documento de
preferências)

## Surface

| Route                              | In                                                             | Out                                                                                                                                                                                                                                                 | Status                                   |
| ---------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `GET /api/memory/tree`             | query `context?`, `root?`, `dir?`, `sort?` (`name`, `updated`) | `roots[]` (`path` · `name` · `editable` · `indexing`) · `root` · `dir` · `folders[]` (`rel` · `name` · `count` · `editable` · `reason`) · `files[]` (`id` · `rel` · `name` · `title` · `mtime` · `editable` · `reason`) · `indexNote` · `truncated` | `200`, `400`, `404`                      |
| `PUT /api/memory/notes/properties` | `path`, `baseVersion`, `set` (chave → valor), `remove[]`       | `path` · `name` · `version` · `size` · `mtime` · `properties[]`                                                                                                                                                                                     | `200`, `400`, `403`, `404`, `409`, `413` |
| `GET /api/memory/note` (muda)      | query `p`                                                      | ganha `properties[]` (`key` · `kind` · `value`) · `otherProperties` · `bodyStart`                                                                                                                                                                   | `200`, `400`, `403`, `404`, `413`        |
| `POST /api/memory/notes` (muda)    | ganha `folder?`                                                | sem mudança                                                                                                                                                                                                                                         | `201`, `400`, `403`, `409`, `413`        |

## Landing

| One-way door                                             | Literal shape                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Alternative rejected                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Rota da árvore                                        | `memory.tree`: escopo `content`; `context?` = id de um contexto (as raízes passam a ser os caminhos `ok` dele, na ordem dele, e a pasta de notas dele; `404 context_not_found` para um id que não existe); `root` = caminho absoluto de uma raiz (padrão: `memory/`, ou o primeiro caminho do contexto); `dir` = caminho relativo à raiz (padrão `""`); um nível por pedido; até 1 000 itens por pasta, `truncated: true` acima; `indexNote` = id do primeiro de `index.md`, `README.md`, `CLAUDE.md`, `AGENTS.md` na pasta, ou `null`; `400 unknown_root` para uma raiz que não é `memory/` nem pasta indexada habilitada, `404 not_found` para `dir` sem linha no índice                                                                                                                                                                                                                                                                                                                                   | a árvore inteira numa resposta: um acervo de 35 mil arquivos (a medição do `docs/memory-guide.md`) vira megabytes por clique; ler o disco na rota: o índice já tem `dir`, `rel` e `title`, e ler o disco abriria pastas que a política esconde                                         |
| 2. Contrato de propriedades                              | `GET /api/memory/note` ganha `properties: Array<{ key: string; kind: "text" \| "list" \| "date" \| "status" \| "select" \| "interval"; value: string \| string[] }>`, `otherProperties: string \| null` (as linhas do cabeçalho que o leitor não entende, como estão), `bodyStart: number` (o deslocamento em caracteres do corpo); `memory.notes.properties`: escopo `owner`, corpo `{ path, baseVersion, set?: Record<string, string \| string[]>, remove?: string[] }`, erros `400 validation`, `403 note_not_editable`/`forbidden_path`, `404 note_missing`, `409 edit_conflict`, `409 front_matter_unreadable`, `413 note_too_large`; `POST /api/memory/notes` ganha `folder?: string` (relativo a `memory/notes`, até 4 níveis, cada nível pelo mesmo slug do nome da nota)                                                                                                                                                                                                                            | o cliente montar o YAML e mandar pelo `PUT` do corpo: duas implementações do formato (a tela e o agente pelo MCP) que divergem na primeira aspa; uma rota por propriedade (`PATCH …/properties/:key`): uma edição de várias chaves vira várias versões e vários conflitos              |
| 3. Formato e tipos das propriedades                      | uma propriedade é uma linha `^([a-z][a-z0-9_-]{0,39}):[ \t]*(.*)$` de primeiro nível; lista em linha `[a, b]` ou em bloco `- a`; tipos fixos por chave: `tags`, `aliases` → `list`; `created`, `updated`, `last_reviewed`, `due` → `date` (`AAAA-MM-DD`); `status` → `status` com os valores `active`, `draft`, `paused`, `done`, `archived` (outro valor lido é mostrado e mantido, mas a seleção oferece só esses); `natureza` → `select` com `fato`, `opiniao`, `plano`, `hipotese`, `relato`; `escopo` → `select` com `pessoal`, `equipe`, `externo` (nos dois, outro valor lido é mostrado e mantido); `review_every` → `interval` (`^[1-9][0-9]{0,2}d$` ou `never`); qualquer outra chave → `text` (uma linha, até 500 caracteres); escrever troca só as linhas das chaves tocadas, acrescenta as novas antes do `---` final na ordem do pedido, e mantém byte a byte toda outra linha; sem cabeçalho, cria um no topo; acima de 4 096 bytes ou sem `---` de fechamento, `409 front_matter_unreadable` | um parser YAML completo como dependência (`yaml`, `js-yaml`): reescrever o cabeçalho inteiro muda aspas, ordem e comentários do dono em toda edição; tipos inferidos pelo valor: `2026-10-14` num título vira data, e a higiene da C5 leria `last_reviewed` de forma diferente da tela |
| 4. Preferências da vista                                 | `UiPreferences.brain.notes = { root: string \| null, home: Record<string, string>, tabs: string[], active: string \| null, sort: "name" \| "updated", expanded: string[] }` — caminhos absolutos; `home` por raiz; até 12 abas e 500 pastas abertas (o excedente é cortado na leitura); `.catch` em cada campo como o resto do documento                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | um arquivo no acervo (`memory/.home`): a Home é preferência de quem lê, não conteúdo que o agente indexa, e iria no backup das notas; `localStorage`: perde a Home ao trocar de navegador e não vale para o app de desktop e o navegador ao mesmo tempo                                |
| 5. Estrutura fixa                                        | `settings.memory.notes.fixedStructure: boolean` (padrão `false`); ligada, `POST /api/memory/notes` que criaria uma pasta (por `folder` ou `area` sem pasta) ou escreveria direto em `memory/notes/` responde `409 structure_fixed` e não escreve; vale para a interface, a CLI e o MCP, porque a regra está no core                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | uma preferência só da interface: o agente pelo MCP e a CLI continuariam criando pastas no topo, que é justamente o que a regra "estrutura fixa" quer impedir                                                                                                                           |
| 6. Árvore sem raiz (door 1, lote A)                      | `root: string \| null` na resposta de `GET /api/memory/tree`: `null` só quando não há raiz nenhuma (um contexto sem caminho `ok` e sem pasta de notas), com `roots: []` e nenhuma entrada; com `root` pedido nesse caso, `400 unknown_root`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `404 context_unavailable`: o seletor de um contexto cujos caminhos sumiram viraria erro; cair em `memory/`: a vista mostraria notas fora do contexto escolhido                                                                                                                         |
| 7. `area` e `folder` juntos (door 2, lote A)             | `POST /api/memory/notes` com `area` e `folder` ao mesmo tempo é `400 validation` e nada é escrito; `folder` sozinho dá a pasta, `area` sozinha dá a pasta da área, como antes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `folder` vencer em silêncio: a área pedida seria ignorada sem aviso; a área como subpasta de `folder`: um terceiro sentido para dois campos que já dizem onde a nota mora                                                                                                              |
| 8. Detalhes da escrita das propriedades (door 3, lote A) | uma chave posta com o valor que já tem mantém a linha como está; uma lista em bloco continua em bloco (os itens com a indentação do primeiro); um texto que não se lê igual sem aspas (vazio, começa por algo que não é letra, termina em espaço, `true`/`null`/`yes`…, ou tem um caractere fora de letras, dígitos, espaço e `_.,()/'-`) é escrito como string JSON; lido sem aspas, um valor perde o ` # comentário` final; numa chave repetida a primeira linha é a propriedade e as outras ficam em "outras propriedades"; a mesma chave em `set` e `remove` é `400 validation`; `GET /api/memory/note` lê um cabeçalho ilegível como nenhum (`[]`, `null`, `0`)                                                                                                                                                                                                                                                                                                                                         | pôr aspas em todo texto: toda linha tocada mudaria o estilo do dono, e `createNote` já escreve `created:` sem aspas; reescrever a lista em bloco em linha: o diff de uma tag a mais mostraria a lista inteira trocada                                                                  |

- Nothing else in this change is hard to reverse: a largura das colunas, a ordem das seções do painel, o texto de cada estado e
  o nome do módulo de dados da interface mudam por refatoração.

## Criteria

### S1: escolher a raiz, ver o índice e navegar pela árvore (P1)

A pessoa troca para "Notas", escolhe a raiz, vê se o índice está em dia e anda pela árvore sem que nada seja lido do disco.

**Acceptance Criteria**

1. WHEN the person chooses "Notas" in the view switcher of `/brain` (or runs the command "Ver notas", or presses `V` in the `view:brain` scope) THEN the moldura SHALL show the notes view at `/brain/notes` and the Núcleo SHALL show it in the brain scene, and "Grafo" SHALL return to the graph with its state as it was.
2. WHEN `GET /api/memory/tree` is called with no `root` THEN the system SHALL answer `roots` with `memory/` first (`editable: true`) and every enabled indexed folder after it in settings order (`editable: false`), and the entries of the top level of `memory/`.
3. WHEN `GET /api/memory/tree?root=<R>&dir=<D>` is called THEN the system SHALL answer only the direct subfolders of D (each with the number of indexed files under it) and the files directly in D, folders first, ordered by `name` (case-insensitive, accent-folded) or by `mtime` descending for `sort=updated`.
4. The tree route SHALL build its answer from the rows of `files` and SHALL NOT open any file.
5. IF a row under the requested folder is excluded by today's policy THEN the tree SHALL NOT return it and SHALL NOT count it in its folder's `count`.
6. IF `root` is neither `memory/` nor an enabled indexed folder THEN the tree SHALL answer `400 unknown_root`; IF `dir` has no indexed row under it THEN it SHALL answer `404 not_found`.
7. WHEN a folder holds more than 1 000 entries THEN the tree SHALL return the first 1 000 in the requested order with `truncated: true`, and the screen SHALL show "+N não mostrados" with N the number left out.
8. WHEN an entry is outside `memory/` THEN the tree SHALL answer `editable: false` with `reason: "outside_memory"`, WHEN it is `memory/ROUTER.md` or under `memory/areas/` or `memory/journal/` THEN `reason: "generated"`, and the screen SHALL show the `Lock` icon with the reason's text in a tooltip and in the accessible name.
9. WHEN a folder holds `index.md`, `README.md`, `CLAUDE.md` or `AGENTS.md` THEN the tree SHALL answer `indexNote` as the id of the first of them in that order, and selecting the folder SHALL show that note with the label "Índice da pasta"; WHEN it holds none THEN the screen SHALL list the folder's entries with title, type and updated date.
10. WHILE an index pass runs the sidebar SHALL show "Indexando <x> de <y>" from `index.progress`, WHEN it finishes SHALL show "Indexado · <há quanto>", WHEN it is cancelled SHALL show "Indexação cancelada", and WHEN it fails SHALL show "Falhou" with the code translated in a tooltip, each with its icon and text, in a `role="status"` region.
11. WHEN the person chooses "Reindexar" in the sidebar THEN the screen SHALL call `POST /api/memory/index`, and WHILE the pass runs the same button SHALL read "Cancelar" and call `POST /api/memory/index/cancel`.
12. The tree SHALL be operable by keyboard as an ARIA `tree` (arrow up/down move, right expands, left collapses, Enter opens), and WHEN the person chooses "Recolher tudo" THEN every folder SHALL collapse.
13. WHILE the index has no row THEN the tree SHALL show "Nada indexado ainda." with "Reindexar"; WHILE the tree loads it SHALL show the skeleton with the hidden text "Carregando…"; IF it fails THEN it SHALL show the error with "Tentar de novo" in a `role="alert"`.

**Independent test:** com um acervo de teste indexado e uma pasta de usuário indexada, trocar para "Notas", escolher a pasta do
usuário (todos os itens com cadeado), voltar para `memory/`, abrir uma pasta com `README.md` e ver o índice da pasta.

### S2: abas, Home e leitura com links que navegam (P1)

**Acceptance Criteria**

14. WHEN the person opens a note from the tree, the search, a link or the Home THEN the screen SHALL focus its tab if it is open and SHALL otherwise open a new tab after the active one.
15. WHEN a 13th tab would open THEN the screen SHALL close the least recently focused tab that has no unsaved changes, and IF all 12 have unsaved changes THEN it SHALL not open the 13th and SHALL say "Feche uma aba para abrir outra."
16. WHEN the person closes a tab with unsaved changes THEN the screen SHALL ask "Descartar as alterações não salvas?" before closing it, with "Continuar editando" focused.
17. WHEN the view is reloaded THEN it SHALL reopen the root, the tabs, the active tab, the order and the expanded folders stored in `UiPreferences.brain.notes`, and a tab whose note no longer exists SHALL show "Esta nota não existe mais." with "Fechar aba".
18. WHEN the person chooses "Definir como Home" on a note THEN that note SHALL become the Home of the current root, shown at the top of the sidebar, and WHEN no tab is open THEN the reading area SHALL show the Home.
19. WHILE the current root has no Home the sidebar SHALL show "Definir uma Home", and WHEN no tab is open and no Home exists THEN the reading area SHALL show "Abra uma nota na árvore ou defina uma Home."
20. WHEN a note is shown for reading THEN its body SHALL be drawn by `components/Markdown.tsx` without the front-matter block, pipe tables as tables, and SHALL NOT use `dangerouslySetInnerHTML`.
21. WHEN the body holds `[[alvo]]`, `[[alvo|texto]]` or a relative link to an indexed note THEN the screen SHALL draw a button that opens the note `GET /api/memory/links` resolves it to, in a tab; IF it resolves to nothing THEN it SHALL draw text with the `Unlink` icon and the tooltip "Nenhuma nota com este nome".
22. WHEN a note is open THEN the side panel SHALL show "Backlinks" and "Links quebrados" (the links section of `cerebro-v2`), "Relacionadas" from `GET /api/memory/related` with each `why`, and "Nesta nota" with the note's `##` headings, each section with its own loading and error states.
23. WHEN the person chooses "Ver no grafo" THEN the screen SHALL switch to the graph with that note selected in local mode with 1 hop.
24. WHEN the person chooses "Exportar Markdown" THEN the screen SHALL download the note's exact bytes as `<nome>.md`, and WHEN they choose "Abrir no editor do sistema" THEN it SHALL call `POST /api/memory/open` with the note's path.

**Independent test:** abrir três notas pela árvore, seguir um wikilink, definir a Home, recarregar e ver as abas e a Home de
volta; exportar uma nota e comparar os bytes.

### S3: propriedades tipadas e editáveis (P1)

**Acceptance Criteria**

25. WHEN `GET /api/memory/note` reads a note whose header holds `type: context`, `status: active`, `tags: [offer, accelerator]` and `updated: 2026-10-14` THEN it SHALL answer `properties` with those four keys in file order and the kinds `text`, `status`, `list`, `date`.
26. WHEN the header holds lines the property reader does not understand (a nested map, a multi-line string, a comment) THEN `GET /api/memory/note` SHALL answer them unchanged in `otherProperties`, and the screen SHALL show them read-only under "Outras propriedades (somente leitura)".
27. WHEN the owner calls `PUT /api/memory/notes/properties` with `set: { "status": "archived" }` and the current `baseVersion` THEN the system SHALL change only the `status:` line, keep every other byte of the file, answer `200` with the new `version` and `properties`, and request an index pass for that path.
28. WHEN `set` names a key the header does not have THEN the system SHALL add the line before the closing `---` in request order, and WHEN the note has no header THEN it SHALL create `---`, the lines and `---` at the top, followed by the old content unchanged.
29. WHEN `remove` names a key THEN the system SHALL delete its line (and the `- item` lines of a block list under it) and keep the rest.
30. IF a `date` value is not `AAAA-MM-DD`, a `status` value is not one of `active`, `draft`, `paused`, `done`, `archived`, a `text` value has a line break or more than 500 characters, a `list` has more than 20 entries, a `tags` entry is outside `[\p{L}\d_-]{2,30}`, or a key is outside `[a-z][a-z0-9_-]{0,39}`, THEN the system SHALL answer `400 validation` and write nothing.
31. IF the header is longer than 4 096 bytes or has no closing `---` THEN `PUT /api/memory/notes/properties` SHALL answer `409 front_matter_unreadable` and write nothing.
32. IF the file changed after `baseVersion` THEN the system SHALL answer `409 edit_conflict` and write nothing, and the screen SHALL show the conflict banner of `cerebro-v2` over the property table.
33. IF the note is not editable or the path crosses a symbolic link THEN the route SHALL answer `403` (`note_not_editable` or `forbidden_path`) as `PUT /api/memory/notes` does, and the screen SHALL show the table read-only with no "+ Adicionar propriedade".
34. WHEN the person edits a value in the table and presses Enter or leaves the field THEN the screen SHALL save it through the route, and WHEN they press Esc THEN it SHALL restore the value with no request.
35. WHILE the body has unsaved changes in the editor the property table SHALL be read-only with the text "Salve o texto para editar as propriedades."
36. WHEN the person chooses "+ Adicionar propriedade" THEN the screen SHALL ask the key and the kind (preselected by the fixed kind of a known key) and SHALL add it with an empty value only after a value is given.

**Independent test:** numa nota com o cabeçalho do print e uma linha YAML aninhada, mudar `status` para `archived`, acrescentar
`last_reviewed` e remover `type`; o diff do arquivo mostra só essas três linhas.

### S4: editar no lugar, com `[[` que sugere (P2)

**Acceptance Criteria**

37. WHEN the person chooses "Editar" on an editable note THEN the reading area SHALL become the editor of `cerebro-v2` in place (the `textarea`, the state line with icon and text, "Salvar", the conflict banner, ⌘S / Ctrl+S), with the side panel still visible.
38. WHEN the person types `[[` in the editor THEN the screen SHALL show a `listbox` of up to 8 notes whose title or name contains the text typed after `[[` (accent-folded), and Enter SHALL insert `[[<título>]]` and close it, and Esc SHALL close it with nothing inserted.
39. WHEN a save succeeds THEN the tab SHALL lose its unsaved mark, the reading body and the side panel SHALL show the saved text, and the tree SHALL show the new title within one index pass.
40. IF the note is not editable THEN the header SHALL show "Somente leitura" with the reason and SHALL NOT show "Editar".

**Independent test:** editar uma nota da vista, digitar `[[Pla` e escolher "Planejamento", salvar, e ver o backlink na nota
"Planejamento".

### S5: criar nota e pasta na árvore, com estrutura fixa opcional (P2)

**Acceptance Criteria**

41. WHEN the person chooses "Nova nota" with a folder of `memory/notes` selected THEN the create dialog SHALL have that folder chosen, and "Criar" SHALL create the note there and open it in a tab in edit mode.
42. WHEN the owner calls `POST /api/memory/notes` with `folder: "clientes/acme"` THEN the system SHALL create `memory/notes/clientes/acme/<nome>.md` with the folders it needs, and IF `folder` has more than 4 levels, an empty level, `..` or a segment that slugs to nothing THEN it SHALL answer `400 validation` and create nothing.
43. WHEN the person chooses "Nova pasta" THEN the dialog SHALL ask "Nome da pasta" and "Título da primeira nota", both required, and "Criar" SHALL create the folder with that note.
44. WHILE `memory.notes.fixedStructure` is `true` the system SHALL answer `409 structure_fixed` and write nothing for a `POST /api/memory/notes` that would create a folder or write directly in `memory/notes/`, from the API, the CLI and the MCP tool alike.
45. WHILE `memory.notes.fixedStructure` is `true` the screen SHALL disable "Nova pasta" and "Nova nota" where they would be refused, with the tooltip "Estrutura fixa: crie dentro de uma pasta existente".
46. The new controls SHALL appear only while the root is `memory/`.

**Independent test:** ligar a estrutura fixa, tentar criar uma pasta no topo pela interface e pelo MCP (ambos recusados) e
criar uma nota dentro de uma pasta existente (aceita).

### S6: uma só camada de dados para as três telas (P2)

**Acceptance Criteria**

47. The interface SHALL request `/api/memory/graph`, `/api/memory/search` and `/api/memory/related` from one module of `apps/command-centre/src/brain/`, and `SecondBrain.tsx`, `BrainScene.tsx` and the notes view SHALL hold no `apiCall` to those three routes.
48. WHEN a search or a related request fails in any of the three screens THEN it SHALL show the error and "Tentar de novo" (the same state that `cerebro-correcoes` gives the two existing screens) rather than keep the previous hits.

**Independent test:** a varredura de `apiCall` acha os três caminhos só no módulo de dados; os testes das duas telas existentes
continuam passando.

### S7: o contexto ativo e a natureza da informação (P1)

A vista segue o contexto de trabalho escolhido e mostra o que é fato, opinião, plano, hipótese ou relato.

**Acceptance Criteria**

53. WHILE a context is active (`UiPreferences.activeContext`, `cerebro-contextos`) the top of the notes sidebar SHALL be the context selector of that feature, and `GET /api/memory/tree?context=<id>` SHALL answer `roots` with the context's `ok` paths in its order followed by its notes folder when it exists.
54. WHEN the person switches the context in the selector THEN the tree SHALL reload with the new roots, the root SHALL become the new context's first root, and the open tabs SHALL stay.
55. IF `context` names no context THEN the tree SHALL answer `404 context_not_found`, and IF `root` is not one of the context's roots THEN it SHALL answer `400 unknown_root`.
56. WHEN a note's front matter holds `natureza`, `escopo` or `review_every` THEN the properties table SHALL show `natureza` and `escopo` as a select of their fixed values and `review_every` with the suggestions `7d`, `30d`, `90d`, `180d`, `365d`, `never`, and IF a typed `review_every` does not match `^[1-9][0-9]{0,2}d$` or `never` THEN the field SHALL show "Use um número de dias, como 30d, ou never." and SHALL NOT save.
57. WHEN the body holds a callout `> [!fato]`, `> [!opiniao]`, `> [!plano]`, `> [!hipotese]` or `> [!relato]` THEN the reading SHALL draw it as a box with its icon and the label "Fato", "Opinião", "Plano", "Hipótese" or "Relato" as text, never by color alone, and an unknown `> [!x]` SHALL be drawn as a plain quote.

**Independent test:** criar um contexto com duas pastas, escolhê-lo e ver as duas como raízes; abrir uma nota com `natureza: plano`
e um callout `> [!opiniao]` e ver a seleção e o rótulo.

### Cross-cutting (P1)

**Acceptance Criteria**

49. The system SHALL declare the two new routes in the `API` table with schemas, scope (`content` for the tree, `owner` for properties) and errors, regenerate the OpenAPI document, list them in `EXPECTED_ROUTE_SCOPES` and `docs/security.md`, and give each a scenario in the refusal probe.
50. The notes view SHALL keep text at 12px minimum (13px body), colors only from tokens, state never by color alone, and SHALL pass axe at WCAG A/AA in both themes and both shells, with an entry in the component gallery.
51. The notes view SHALL load as its own chunk on first use, and the entry JS SHALL grow by no more than the recorded baseline allows (`npm run bundle:check`).
52. The system SHALL add no raw `fs` read or write outside the list of `tests/security-reads.test.ts` and no module-level mutable state outside the list of `tests/sdk.instances.test.ts`.

## Out of scope

| Excluded                                                                                   | Why                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Menções não linkadas no painel da nota                                                     | precisa de uma busca no índice por nome e apelido com corte de ruído; entra em `cerebro-rituais` (C8)                                                                                                      |
| Gerar notas-índice por pasta                                                               | a vista as mostra; quem as escreve é a skill de `cerebro-organizar` (C3)                                                                                                                                   |
| Exportar uma pasta inteira (zip) e importar                                                | é da `cerebro-memoria-confiavel` (C7), com o histórico e a restauração                                                                                                                                     |
| Permissão por pasta para agentes e dispositivos (ler, escrever, esconder)                  | o cadeado desta feature só diz o que a pessoa não edita; a permissão por pasta é da `cerebro-memoria-confiavel` (C7)                                                                                       |
| Editar arquivos fora de `memory/`                                                          | pergunta 1 do dono no `cerebro-v2`, ainda aberta; aqui eles são lidos, nunca escritos                                                                                                                      |
| Renomear e mover nota ou pasta pela árvore                                                 | sem reescrita de links (pergunta 3 do dono) seria quebrar links em silêncio; a `cerebro-faxina-guiada` (C5) traz a reparação dos links quebrados                                                           |
| Grafo local em miniatura no painel e grafo local como padrão do grafo                      | o grafo local já existe na cena (`ui.local`, `localHops`) e "Ver no grafo" o abre; um segundo canvas no painel é custo de exibição sem evidência de uso; reavaliado depois de `cerebro-faxina-guiada` (C5) |
| Editor rico (WYSIWYG), pré-visualização lado a lado                                        | o editor segue um campo de texto Markdown; alternar Ler/Editar cobre o uso                                                                                                                                 |
| Filtrar a árvore e a busca por `natureza` ou `escopo`, fila de revisões por `review_every` | a segregação da informação por natureza e a revisão periódica são da `cerebro-natureza` (C6); aqui as propriedades só se leem e se editam                                                                  |
| Membros, papéis, convites, sincronização em nuvem, vários cofres                           | o produto é de um dono só; dispositivos já têm escopos (AD-015); o contexto (`cerebro-contextos`, C2) e a raiz são escopos sobre as pastas que o índice já tem                                             |

## Assumptions

| Assumption                         | Chosen default                                                                                                   | Rationale                                                                                                              | Confirmed? |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------- |
| Onde a vista mora                  | rota `/brain/notes` na moldura e modo "Notas" da cena do cérebro no Núcleo, com o mesmo seletor "Grafo \| Notas" | AD-005: os dois shells mostram os mesmos dados; uma rota permite link direto para uma nota aberta                      | y          |
| Tecla da vista                     | `V` no escopo `view:brain`, além dos comandos da paleta                                                          | `/`, `p`, `f`, `l` e `N` já são do escopo; `V` está livre e não colide com o navegador                                 | y          |
| `updated` automático               | salvar não muda `updated:`; a árvore ordena por `mtime`                                                          | mudar o cabeçalho em todo salvamento muda o diff de toda nota; uma rotina ou a skill podem cuidar disso                | y          |
| Clique num link                    | abre em aba nova ou foca a existente; não substitui a aba atual                                                  | quem lê segue links sem perder o lugar; o teto de 12 abas fecha a menos usada                                          | y          |
| Remover propriedade                | pelo menu da linha, sem confirmação                                                                              | o menu já é o segundo passo, e o valor está no histórico quando a `cerebro-memoria-confiavel` (C7) versionar `memory/` | y          |
| Dependência de `cerebro-correcoes` | esta feature vem depois dela no roteiro e herda o estado de erro da busca e o `404` dos relacionados             | AD-003 (roteiro em ordem); os links da vista usam `GET /api/memory/links`, que já resolve wikilinks hoje               | y          |

**Open questions:** none - all resolved or logged above. As perguntas 1 (a Home e as abas são preferência desta máquina, em `UiPreferences`, door 4) e 2 (a estrutura fixa vem desligada, `false`, door 5) foram respondidas pelo dono em 29/10/2026 com os padrões recomendados.

## Observable

| Surface                                                                   | Decision                              | Landing                                                                                                                                        |
| ------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| screen vista de notas (barra, árvore)                                     | empty state                           | AC 13, AC 19                                                                                                                                   |
| screen vista de notas (barra, árvore)                                     | loading state                         | AC 13                                                                                                                                          |
| screen vista de notas (barra, árvore)                                     | error state                           | AC 13                                                                                                                                          |
| screen vista de notas                                                     | unauthorised                          | n/a - a interface do dono usa o token do dono; um dispositivo sem `content` cai no erro (AC 13) e sem `owner` recebe `403` ao escrever (AC 33) |
| screen vista de notas (árvore)                                            | density and ordering                  | AC 3, AC 7                                                                                                                                     |
| screen vista de notas (abas)                                              | destructive action confirms           | AC 16                                                                                                                                          |
| screen vista de notas (leitura)                                           | empty, loading, error states          | AC 17, AC 19, AC 22                                                                                                                            |
| screen vista de notas (propriedades)                                      | error state                           | AC 30, AC 31, AC 32                                                                                                                            |
| screen vista de notas (propriedades)                                      | destructive action confirms           | n/a - remover pelo menu da linha, sem confirmação (Assumptions)                                                                                |
| screen vista de notas (editor)                                            | loading, error, conflict states       | AC 37 (os do `cerebro-v2`)                                                                                                                     |
| screen vista de notas (nova pasta)                                        | error state                           | AC 42, AC 45                                                                                                                                   |
| API `GET /api/memory/tree`                                                | error shape and codes                 | AC 6, AC 55                                                                                                                                    |
| API `PUT /api/memory/notes/properties`                                    | error shape and codes                 | AC 30, AC 31, AC 32, AC 33                                                                                                                     |
| API `POST /api/memory/notes`                                              | error shape and codes                 | AC 42, AC 44                                                                                                                                   |
| all new `/api/memory/*` routes                                            | who may call                          | AC 49                                                                                                                                          |
| all new `/api/memory/*` routes                                            | versioning, rate limits               | n/a - `/api/v1` é o mesmo conjunto de rotas (api-v1) e nenhuma rota nova tem limite próprio                                                    |
| collection árvore de notas                                                | grouping, naming, ordering            | AC 3                                                                                                                                           |
| collection árvore de notas                                                | duplicates                            | n/a - um caminho é uma linha de `files`; o mesmo nome em pastas diferentes são dois itens                                                      |
| collection árvore de notas                                                | the exception that does not fit       | AC 7 (pasta acima do teto), AC 8 (o que não se edita)                                                                                          |
| collection propriedades                                                   | grouping, naming, ordering, exception | AC 25, AC 26, AC 28                                                                                                                            |
| command "Ver notas" / "Ver grafo" / "Definir como Home"                   | document or copy a person reads       | AC 1, AC 18                                                                                                                                    |
| screen vista de notas (contexto ativo)                                    | empty, loading, error states          | AC 53, AC 54; os estados do seletor são os de `cerebro-contextos`                                                                              |
| screen vista de notas (propriedades `natureza`, `escopo`, `review_every`) | error state                           | AC 56                                                                                                                                          |
| document callouts de natureza na leitura                                  | structure                             | AC 57                                                                                                                                          |

## Emendas depois da aprovação, registradas em vez de reescritas

O texto aprovado acima fica como foi aprovado, exceto `Flow` e `Impact`, que se mantêm verdadeiros. O plano foi escrito antes
de `cerebro-correcoes` (C1), `cerebro-contextos` (C2) e `cerebro-organizar` (C3); o que as três construíram (`b2f1e70..HEAD`,
AD-037 a AD-040) e o que a derivação dos checks achou ficam aqui, cada um com como `checks.md` resolve. Nenhum muda uma door;
as que acrescentam campo a uma resposta (5, 10) só acrescentam.

1. **Seletor de contexto e seletor de raiz (AC 53, design.md item 0).** A C2 monta um `ContextSelector` por shell (na moldura
   abaixo da marca, no Núcleo à esquerda da linha de voz), que registra `action:switch-context` e `action:whole-brain` e avisa
   uma vez quando o contexto ativo some; um segundo na barra das notas registraria os comandos e o aviso duas vezes. O topo da
   barra das notas é a linha do contexto ativo (ícone `Crosshair`, o nome do contexto ou "Todo o cérebro", de
   `useWorkContext`), que, escolhida, abre o menu do seletor do shell pelo comando `action:switch-context`; o seletor de raiz
   fica logo abaixo, com as raízes que a rota da árvore devolve. A vista não monta outro `ContextSelector` (C31). As leituras
   da vista que aceitam contexto (árvore, busca, relacionadas) levam `context=<id>` de `useWorkContext().query` (C32, C74);
   `GET /api/memory/note`, `GET /api/memory/links` e a rota de propriedades não têm contexto.
2. **Raízes de um contexto (door 1, AC 53).** A C2 só conta os caminhos `ok` (`contextOkPaths`), aceita uma pasta de `memory/`
   como caminho e guarda as notas do contexto em `memory/notes/<id>/` (`contextNotesDir`). As raízes de `?context=<id>` são os
   caminhos `ok` na ordem do contexto (um `missing` ou `not_indexed` fica fora), depois a pasta de notas quando existe; um
   caminho dentro de `memory/` e a pasta de notas são `editable: true`; as entradas são as que `contextMembership` deixa (C10).
   `context=all` é a resposta sem contexto, como em toda leitura da C2 (C11).
3. **Fonte da árvore e a rota de mapas da C3 (Flow 1, door 1).** `GET /api/memory/maps` devolve a lista plana de todas as
   pastas com o digest e o estado da nota-índice, sem arquivos, títulos, ordem, nível nem edição, e lê o cabeçalho de
   `_index.md` do disco. A árvore continua uma rota própria, um nível por pedido, só das linhas de `files`, sem abrir arquivo
   (AC 4), pelo mesmo `rowFilter`; da C3 ela reaproveita só a regra de onde mora a nota-índice (`INDEX_NOTE`, `MAPS_DIR`,
   `rootSlug` de `core/src/memory/maps.ts`). O estado `fresh`/`stale`/`missing` não entra na árvore: é da skill (C3, C8).
4. **Nota-índice (Impact, door 1, AC 9).** A C3 escreve `_index.md` ao lado das notas para uma pasta de `memory/notes/`, e em
   `memory/maps/<rootSlug(raiz)>/<subcaminho>/_index.md` para uma pasta do usuário (nunca dentro dela); a ordem aprovada
   (`index.md`, `README.md`, `CLAUDE.md`, `AGENTS.md`) não o conhecia. `indexNote` é o id da linha indexada do `_index.md` da
   pasta, onde a regra da C3 o põe, e, sem ele, o primeiro daqueles quatro na pasta. Por vir das linhas, um `_index.md` escrito
   depois da última passada só conta depois da próxima (C8).
5. **O cabeçalho no índice (Impact, AC 9).** Desde a C3 (door 6), `type`, `status`, `updated`, `last_reviewed`, `natureza`,
   `escopo` e `review_every` (até 64 caracteres) entram em `files.fields`. A lista de uma pasta sem nota-índice mostra o tipo
   de `fields.type` sem abrir arquivo: `files[]` da árvore ganha `type` (`string | null`) (C9, C40). A tabela de propriedades
   continua lendo o arquivo (`GET /api/memory/note`), porque `fields` corta em 64 caracteres e não guarda listas nem as outras
   chaves.
6. **Tipos das propriedades e o vocabulário da C3 (door 3, AC 25, AC 30).** (a) `type` tem onze valores no guia da C3, e o dono
   pode acrescentar outros na entrevista: continua `text` (AC 25), sem seleção nem recusa. (b) `status`: os cinco valores são os
   da C3; um valor que o dono acrescentou é lido, mostrado e mantido (door 3), e a rota recusa escrevê-lo (AC 30); ele se
   escreve pelo editor do corpo. (c) `natureza`, `escopo` e `review_every` são os da C3; o AC 30 não lista os tipos `select` e
   `interval`, que entraram na door 3 depois dele, e eles valem como `status`: um valor fora deles é `400 validation` (C19).
   (d) `createNote` com `frontMatter` escreve `title: "<JSON>"` e `created: <instante ISO 8601>`; um valor entre aspas lê-se sem
   elas (como `parseFrontMatter`), e uma chave `date` cujo valor lido não é `AAAA-MM-DD` mantém o tipo e o valor como estão e é
   mostrada como texto (C14, C56). (e) `children-digest` e `generated-by` de um `_index.md` são `text` (C14).
7. **Links e backlinks (AC 21, AC 22) e `note_links` da C1.** Desde a C1 os links vêm só de `note_links` (a migração 22 tirou
   `file_links`), resolvidos na leitura por `linksOf`. O corpo resolve `[[alvo]]`, `[[alvo|texto]]` e links relativos pelo
   `outgoing[].resolved` da mesma resposta de `GET /api/memory/links` que o painel usa, para corpo e painel nunca divergirem
   (C51). `GET /api/memory/links` não tem `context`: os backlinks são do acervo inteiro, e as relacionadas seguem o contexto
   (C52).
8. **Uma camada de dados (AC 47, AC 48, Flow 5).** A C1 entregou `brain/useBrainSearch.ts` (a busca das duas telas, com o estado
   de erro) e a C2 `graphRequest` em `contexts/useWorkContext.ts`; a cena do Núcleo ainda chama `GET /api/memory/related`
   direto, sem `context`, e `SecondBrain.tsx` não pede relacionadas (os vizinhos vêm das arestas do grafo). O módulo único é um
   de `apps/command-centre/src/brain/` que reúne os três pedidos (o `graphRequest` passa para ele, e `contexts/` o importa de
   lá); a varredura do C72 vale para as três telas, e os leitores que a C2 deixou fora (a paleta, a busca universal do Núcleo,
   o grafo de 700 nós da área de trabalho, o diálogo de novo contexto) ficam como estão. O AC 48 vale, para as relacionadas,
   nas telas que as pedem: a cena e a vista (C73, C74).
9. **Gerados e não editáveis (AC 8).** A C2 acrescentou `memory/contexts/` aos gerados (`classifyNotePath`): a árvore responde
   `reason: "generated"` também para ele. `memory/maps/` (C3) é editável. Um arquivo de `memory/` que não é `.md` não se edita
   (`classifyNotePath`) e o AC 8 não o nomeava: `reason: "not_markdown"`, com o texto "Só notas .md se editam" (C7, C39;
   design.md).
10. **Teto da pasta (AC 7).** A tela mostra "+N não mostrados", e `truncated` não dá N: a resposta ganha `omitted`, quantos
    ficaram de fora (`0` sem corte) (C6, C38).
11. **`indexing` por raiz (door 1).** `index.progress` não diz a raiz e uma passada percorre todas: `roots[].indexing` é `true`
    para toda raiz enquanto o `indexHost` está `running` (C12).
12. **Estrutura fixa e quem escreve fora de `POST /api/memory/notes` (door 5, AC 44).** O `PATCH /api/contexts/:id {brief:true}`
    da C2 cria `memory/notes/<id>/_resumo.md` por `ensureContextBrief`, e a skill organize-brain da C3 escreve `_index.md`,
    `inbox/` e `maps/` pelos arquivos da execução; nenhum passa pela rota e a door 5 não os recusa. A regra vale para
    `POST /api/memory/notes`, `mordomo note new` e a ferramenta MCP `note_create` (C26, C27). O `PUT /api/settings` mescla
    `memory` um nível só (C3, doors 12 e 13): `{memory:{notes:{fixedStructure:true}}}` troca `memory.notes` inteiro e mantém
    `journalBudgetTokens`, `agentStance` e `embeddings` (C28). A pergunta 2 previa que a skill de `cerebro-organizar` pudesse
    ligar a estrutura fixa ao fim da entrevista; a C3 não construiu isso, e esta feature não o acrescenta.
13. **Tecla da vista.** As teclas do escopo `view:brain` são minúsculas (`/`, `p`, `f`, `l`, `n`): a `V` e a `N` do plano são
    `v` e `n` (C30).
14. **Peso do build (AC 51).** `bundle:check` mede contra a entrada mais nova de `scripts/bundle-baseline.json` × 1,05, e a
    entrada desta feature seria a mais nova: sozinho não falha. Como em `cerebro-v2`, o teto é sobre a entrada anterior
    (`cerebro-contextos`): no máximo 8 KB de JS gzip e 1,5 KB de CSS gzip a mais (C79).

## Sources

- `reports/Segundo cérebro para agentes.md`, roteiro A6 e M7, e a seção "Exibir para diagnosticar…" — o que entra e o que fica.
- `.specs/features/cerebro-correcoes/plan.md`, `.specs/features/cerebro-v2/plan.md` e `design.md` — o estado de erro herdado, o editor, os links e a regra de quem escreve.
- `design.md` desta feature — binding para as telas.
- `git log b2f1e70..HEAD`, `.specs/STATE.md` AD-037 a AD-040 e os `checks.md` de `cerebro-correcoes`, `cerebro-contextos` e
  `cerebro-organizar` — o que as três construíram antes desta ("Emendas depois da aprovação").
