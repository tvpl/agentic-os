# Cérebro: organizar — skill de organização com entrevista, notas-índice por pasta e metas no mapa dos agentes

## Problem

Quem aponta o MordomoOS para uma pasta bagunçada, ou cria uma subpasta nova, recebe um índice que sabe **onde** estão os
arquivos e não sabe **o que** cada pasta é nem **o que importa** para o dono. O código de `chore/cerebro-v3-roteiro` (a partir
de `main` em `b2f1e70`) mostra isso:

- **Nenhuma pasta se explica.** O `ROUTER.md` lista áreas e pastas, e cada `areas/<área>.md` lista os 30 arquivos mais recentes
  (`core/src/memory/routers.ts:131-151`). Não há nota que diga o que vive numa pasta, que subpastas ela tem e por onde começar;
  um agente que abre uma pasta de 400 arquivos começa pelo `grep`.
- **Nada pergunta o que importa.** O `mordomo setup` pergunta nome do sistema, tema, idioma e porta
  (`apps/api/src/cli.ts:756-790`). Ninguém pergunta quem é o dono, o negócio, o cliente, a voz, as metas; as skills partem do zero
  a cada conversa e o vídeo de referência e a pesquisa de 29/10/2026 (`reports/Segundo cérebro para agentes.md`, M6;
  `research_notes/Segundo cérebro para agentes/metodos_pkm_agentes.md`: `/init-bootstrap` do Claudesidian, `/onboard` do
  obsidian-claude-pkm) põem essa entrevista no primeiro dia.
- **Os agentes não sabem das metas.** O `AGENTS.md`/`CLAUDE.md` compilado tem o roteador, a lista de skills e quatro regras
  genéricas (`core/src/sync/compiler.ts:314-342`); nada diz o que o dono quer alcançar, e nada pede ao agente que conteste um
  pedido que vai contra isso.
- **Um agente que quisesse organizar não tem como fazer isso com segurança.** Uma skill de memória recebe `memory/` e a skill
  folder (`core/src/runs/runManager.ts:528-539`); uma pasta do usuário só entra como diretório de trabalho, onde o agente pode
  escrever, e a decisão do dono é que as pastas do usuário seguem somente leitura (`.specs/STATE.md`, cerebro-v2, pergunta 1).
- **Uma subpasta nova passa em silêncio.** Nada percebe que uma pasta ganhou filhos e que o que se sabia dela envelheceu.

Ninguém deu número de uso; a evidência é o código acima e a prática levantada pela pesquisa.

Quando isto sair: o dono roda a skill **Organizar o Cérebro**; ela entrevista (uma nota de entrevista no inbox que o dono
preenche no editor), grava as notas do negócio e o arquivo de metas em `memory/notes/negocio/`, escreve uma
nota-índice por pasta (dentro de `memory/`, nunca na pasta do usuário), diz quais pastas não têm índice ou têm índice velho, e
o `AGENTS.md`/`CLAUDE.md` compilado passa a abrir com as metas do dono e, se ele ligar, a instrução de contestar o que conflita
com elas.

## Flow

Reutiliza o catálogo de skills e a injeção de caminhos de `SkillCatalog.locationsBlock` (exists), as `readDirs`/`protectedDirs`
da execução e o bloqueio de edição do adaptador do Claude (exists), a credencial de execução e a sua lista fechada de rotas
(`RUN_API_READ_ROUTES`, exists), o indexador e as linhas de `files`, o leitor de front matter, `generateRouters`, o compilador de
sincronização e o editor de notas do `cerebro-v2`; nenhuma segunda forma de dar pasta a um agente, nem de ler front matter.

1. Pedido de execução (`POST /api/skills/:slug/run`, `mordomo run` e a ferramenta MCP `skills_run`, exists) → `Execution.startSkill`
   (exists) recebe `organize-brain` com a entrada `folder` (door 5) ou com `contextId` (`cerebro-contextos`, exists; a pasta é
   então o primeiro caminho `ok` do contexto); confere que a pasta está dentro de uma das `settings.indexedFolders` (ou de
   `memory/`), fora do que a política esconde, dentro do contexto quando há um, e que o provedor declara `protectsDirs` (door 5)
   → `RunManager` (exists) confere de novo ao lançar, começa a execução em `<home>/workspace` e acrescenta a pasta (e os
   caminhos `ok` do contexto) a `readDirs` e a `protectedDirs`, ao lado de `memory/` (door 9). Uma rotina, uma repetição
   e uma aprovação chegam ao `RunManager` sem passar de novo por `startSkill`: a regra da door 5 é lida ali, e uma pasta
   recusada ao lançar termina a execução `failed` com o código da door 11.
2. A execução lê `skills/organize-brain/SKILL.md` (new, door 1), `resources/guia.md` e `resources/perguntas.md` (new, door 1), e
   pede `GET /api/memory/maps` (new, door 4) com a sua credencial, que só vê `memory/notes/` e as pastas da execução (door 10),
   para saber quais pastas não têm índice ou o têm velho e onde cada índice fica (`indexPath`).
3. Etapa `entrevista` → a execução escreve `memory/inbox/entrevista-<AAAA-MM-DD>.md` (door 2) com as perguntas que faltam; o dono
   a preenche no `NoteEditor` (exists, `cerebro-v2`); etapa `aplicar` → a execução lê as respostas e grava as notas de
   `memory/notes/negocio/` (door 2), entre elas `metas.md`.
4. Etapa `indexar` → a execução grava uma nota-índice `_index.md` por pasta (door 2, door 3): dentro de `memory/notes/…` ao lado
   das notas, ou em `memory/maps/<slug da raiz>/<subcaminho>/_index.md` (door 8) para uma pasta do usuário; com um contexto, a
   etapa `aplicar` escreve no `memory/notes/<id>/_resumo.md` do contexto (exists, `cerebro-contextos`); escreve em `artifacts/`
   o relatório do que propôs e do que não fez.
5. Indexação → `MemoryIndexer` (exists) lê do front matter `type`, `status`, `updated`, `last_reviewed`, `natureza`, `escopo` e `review_every` para `fields` (door 6);
   `folderDigests` (new, door 4) calcula o resumo dos filhos de cada pasta a partir das linhas de `files`.
6. Roteadores → `generateRouters` (exists) lista no `ROUTER.md` as notas-índice e as pastas sem índice ou com índice velho.
7. Compilação → `SyncCompiler.agentsFileContent` (exists) acrescenta a seção "Goals and priorities" a partir de
   `memory/notes/negocio/metas.md` e, com `memory.agentStance` (door 7) em `contest-conflicts`, a instrução de contestar; vale
   para a compilação no home e para a de um contexto (`GET /api/sync/plan?context=<id>`, exists), que usam o mesmo
   `agentsFileContent`.
8. Interface → a tela de Configurações (exists), seção Memória, ganha o seletor de `memory.agentStance`.

## Impact

| Front       | What changes                                                                                                                                                                                                                                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | new term: `nota-índice` - um `_index.md` que diz o que uma pasta é e aponta para as notas-índice das subpastas; vive em `memory/`, nunca na pasta do usuário                                                                                                                                                                                 |
| domain      | new term: `resumo dos filhos` (`children-digest`) - `sha256:` da lista ordenada dos filhos diretos de uma pasta como o índice os conhece; uma nota-índice com outro resumo está velha                                                                                                                                                        |
| domain      | new term: `postura do agente` (`memory.agentStance`) - `neutral` ou `contest-conflicts`; só o dono muda                                                                                                                                                                                                                                      |
| domain      | existing term: entrada `path` de uma skill era só texto no prompt; numa skill de memória, a entrada chamada `folder` passa a dar uma pasta somente leitura à execução - quem ramifica hoje: nenhuma skill embarcada tem entrada `folder` (`skills/*/SKILL.md`)                                                                               |
| domain      | existing term: `fields` de um arquivo eram só os `chave:: valor` do texto; passam a ter também `type`, `status`, `updated`, `last_reviewed`, `natureza`, `escopo` e `review_every` do front matter - quem lê hoje: o grafo (`graph.ts:132`) e a interface que mostra `fields` (`brain/PreviewPanel.tsx`)                                     |
| stored data | nada migra: `fields` é JSON livre e a próxima passada que tocar um arquivo com front matter grava os novos campos; arquivos que não mudaram ganham os campos na passada completa seguinte (eles só são relidos quando mudam - fica dito na Assumptions)                                                                                      |
| settings    | `settings.memory.agentStance` (padrão `neutral`); `settings.memorySkills` passa a ter `organize-brain` no padrão - um `settings.json` que já grava `memorySkills` não muda e a skill, sem `memory/`, para dizendo como ligar                                                                                                                 |
| contrato    | manifesto de provedor ganha `capabilities.protectsDirs` (Claude `true`, Codex e Cursor `false`)                                                                                                                                                                                                                                              |
| arquivos    | `memory/inbox/`, `memory/notes/negocio/` e `memory/maps/` passam a existir quando a skill roda; `ROUTER.md` ganha a seção de notas-índice; o `AGENTS.md`/`CLAUDE.md` compilado ganha uma seção                                                                                                                                               |
| domain      | nome evitado: as notas do negócio vão para `memory/notes/negocio/`, não `contexto/`, porque `contexto` passa a ser o escopo de trabalho de `cerebro-contextos` (C2), com pasta de notas em `memory/notes/<id>/`                                                                                                                              |
| domain      | existing term: uma execução de contexto começa no primeiro caminho `ok` (`cerebro-contextos`, AC 17); uma execução que recebe pasta protegida (door 5) começa em `<home>/workspace` e todos os caminhos `ok` do contexto fora de `memory/` ficam protegidos (door 9) - quem ramifica hoje: `Execution.contextCwd` e `RunManager.contextDirs` |
| domain      | existing term: o resumo de um contexto (`memory/notes/<id>/_resumo.md`, `cerebro-contextos` door 9) tem `type: brief` e as seções `O que é`, `O que importa`, `Metas`, `O que ignorar`; o guia passa a listar `brief` entre os `type`                                                                                                        |
| contrato    | `POST /api/skills/:slug/run` ganha os erros `400 folder_not_indexed` e `409 folder_protection_unsupported`; `GET /api/memory/maps` entra na tabela `API`, na `RUN_API_READ_ROUTES` e em `EXPECTED_ROUTE_SCOPES` (`content`)                                                                                                                  |
| contrato    | `RunFailure.code` ganha `folder_not_indexed` e `folder_protection_unsupported` (door 11) - quem lê hoje: a interface, que mostra o código ao lado da mensagem (`desktop/NowPanel.tsx`) e procura um conserto por código (`failureFix`), sem conserto para estes; o MCP e a CLI só repassam a mensagem                                        |

## Relations

`None - no stored-data shape change`: `fields` já existe e é JSON; as notas-índice e as notas do negócio são arquivos `.md`
indexados como qualquer outro.

## Surface

| Route                                          | In                                                 | Out                                                                                                                                                   | Status                            |
| ---------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `GET /api/memory/maps`                         | query `root?`                                      | `folders[]`: `path` · `rel` · `children` · `digest` · `index` (caminho ou `null`) · `indexDigest` (ou `null`) · `state` (`missing`, `stale`, `fresh`) | `200`, `400`, `404`               |
| `PUT /api/settings` (muda)                     | `memory.agentStance`                               | as configurações                                                                                                                                      | `200`, `400`                      |
| `POST /api/runs` (muda)                        | `inputs.folder` numa skill de memória              | a execução                                                                                                                                            | `202`, `400`, `409`               |
| `POST /api/skills/:slug/run` (muda; emenda 1)  | `inputs.folder` numa skill de memória, `contextId` | a execução                                                                                                                                            | `200`, `202`, `400`, `404`, `409` |
| `GET /api/memory/maps` (emenda 5: `indexPath`) | query `root?`                                      | cada item de `folders[]` ganha `indexPath`: onde o índice está ou ficará (door 8)                                                                     | `200`, `400`, `403`, `404`        |

## Landing

| One-way door                            | Literal shape                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Alternative rejected                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. A skill e os seus recursos           | `skills/organize-brain/SKILL.md` (`mode: write`, `providers: [claude]`, entradas `etapa` (`select`: `entrevista`, `aplicar`, `indexar`; padrão `entrevista`) e `folder` (`path`, opcional)), `resources/guia.md` (vocabulário, estrutura, formato da nota-índice, regras) e `resources/perguntas.md` (banco de perguntas por tema)                                                                                                                                                                                | uma skill por etapa: três entradas no catálogo para um só trabalho, e o guia duplicado; um comando do motor (`mordomo organize`) sem agente: a parte que exige ler e entender texto é exatamente a do agente                                                                                                                                         |
| 2. Onde a skill escreve                 | só sob `memory/`: `memory/inbox/entrevista-AAAA-MM-DD.md`; `memory/notes/negocio/{perfil,estrategia,cliente-ideal,marca,voz,oferta,organizacao,stakeholders,dores,crencas,respostas,metas}.md`; `_index.md` dentro de uma pasta de `memory/notes/` que já existe ou que a entrevista aprovou; `memory/maps/<slug da raiz>/<subcaminho>/_index.md` para uma pasta do usuário; nada no topo de `memory/notes/`                                                                                                      | escrever a nota-índice dentro da pasta do usuário (o `CLAUDE.md` por pasta do produto de inspiração): fere a decisão do dono de pastas do usuário somente leitura e colide com o `CLAUDE.md` que `mordomo sync` compila; guardar perfil e metas em `settings.json`: o backup e a interface tratam configurações como máquina, não como texto do dono |
| 3. Formato da nota-índice               | front matter `type: index`, `status: active`, `tags: [...]`, `source: <caminho absoluto da pasta>`, `children-digest: sha256:<64 hex>`, `generated-by: organize-brain`, `updated: AAAA-MM-DD`, `last_reviewed: AAAA-MM-DD`; corpo: `# <nome>`, um parágrafo do que a pasta é, a tabela `\| Categoria \| O que vive ali \| Índice \|` com um link `[…](…/_index.md)` por subpasta, e "Comece por" com até 5 links                                                                                                  | o nome `CLAUDE.md` ou `AGENTS.md`: só um provedor o carrega e o compilador já escreve esses nomes; `README.md`: o usuário já tem os seus e a skill não sobrescreve arquivo que não criou; conteúdo copiado das notas: envelhece, e a pesquisa diz "ponteiros, não conteúdo"                                                                          |
| 4. Resumo dos filhos e a rota de mapas  | `children-digest = "sha256:" + hex(SHA-256(join("\n", sort(["d:" + nome da subpasta] ∪ ["f:" + nome do arquivo]))))` sobre os filhos diretos que `files` conhece, sem `_index.md` e sem nomes que começam com `.`; `GET /api/memory/maps` com escopo `content` e na `RUN_API_READ_ROUTES`                                                                                                                                                                                                                         | ler o disco para o resumo: a rota da execução passaria a abrir pastas do usuário fora do índice e da política; `mtime` da pasta: muda com um arquivo editado, e um índice que só fala de estrutura ficaria "velho" a cada salvamento                                                                                                                 |
| 5. Pasta somente leitura para uma skill | numa skill de `memorySkills`, a entrada `folder` resolvida (realpath) tem de estar dentro de uma de `settings.indexedFolders` e ser permitida pelo filtro; entra em `readDirs` e em `protectedDirs`; provedor sem `capabilities.protectsDirs: true` → `409 folder_protection_unsupported`; fora das pastas indexadas → `400 folder_not_indexed`                                                                                                                                                                   | dar a pasta como diretório de trabalho: o agente escreve nela; confiar na regra escrita no `SKILL.md`: o arquivo é editável por agente e por dispositivo (`skills/types.ts:31-35`), então a regra não é mecanismo                                                                                                                                    |
| 6. Campos do front matter               | `parseFrontMatter` lê também `type`, `status`, `updated`, `last_reviewed`, `natureza`, `escopo`, `review_every` (texto até 64 caracteres); eles entram em `fields` com essas chaves, e um `chave:: valor` do corpo com a mesma chave vence                                                                                                                                                                                                                                                                        | uma coluna por campo em `files`: migração para um vocabulário que o dono personaliza; ler todo o YAML: o leitor é pequeno de propósito (`frontMatter.ts:1-5`)                                                                                                                                                                                        |
| 7. Postura e metas no mapa dos agentes  | `settings.memory.agentStance: "neutral" \| "contest-conflicts"` (padrão `neutral`, valor ilegível lido como `neutral`); o compilado ganha, depois do título, `## Goals and priorities` com até 10 itens de primeiro nível da seção `## Metas` de `memory/notes/negocio/metas.md` (cada um cortado em 160 caracteres) e a linha `Full goals: <caminho>`; com `contest-conflicts`, mais a linha `- When a request conflicts with these goals, say so and propose the alternative that serves them before doing it.` | a postura escrita pela própria skill no arquivo de metas: uma nota que um agente escreve passaria a mudar as instruções de todo agente (envenenamento de memória, OWASP ASI06); o arquivo de metas inteiro no compilado: o compilado é lido em toda conversa e deve ser um mapa                                                                      |

| 8. Slug da raiz em `memory/maps/` (acrescentada ao derivar os checks) | `<slug da raiz>` = o nome da pasta raiz como em `settings.indexedFolders` em NFD, sem acentos, minúsculo, cada sequência fora de `[a-z0-9]` vira `-`, sem `-` nas pontas, até 40 caracteres (`pasta` quando vazio), mais `-` e os 8 primeiros hex do SHA-256 do caminho absoluto da raiz; a rota de mapas devolve o caminho em `indexPath` | só o nome: duas raízes chamadas `Projetos` colidem; só o hash: quem abre `memory/maps/` não reconhece a pasta; o agente calcular o caminho sozinho: um SHA-256 feito por um agente erra em silêncio |
| 9. Pasta de trabalho de uma execução com pasta protegida (acrescentada ao derivar os checks, emenda 2) | uma execução que recebe uma pasta protegida (door 5) começa em `<home>/workspace`; com `contextId` e sem `folder`, a pasta é o primeiro caminho `ok` do contexto, e todo caminho `ok` do contexto fora de `memory/` entra em `readDirs` e em `protectedDirs`; `memory/notes/<id>/` entra só em `readDirs`; uma pasta sob `<home>/memory/` é aceita e fica fora de `protectedDirs` | começar no primeiro caminho `ok`, como `cerebro-contextos` AC 17 faz para toda execução: é dar a pasta como diretório de trabalho, que a door 5 recusa, e o prompt de uma skill de escrita diz que ela pode mudar o diretório de trabalho |
| 10. O que a credencial da execução vê na rota de mapas (acrescentada ao derivar os checks, emenda 4) | com a credencial de uma execução, `GET /api/memory/maps` responde só pastas sob `memory/notes/` e sob as pastas protegidas da execução (a entrada `folder` e os caminhos `ok` do contexto); um `root` fora delas é `404 not_found`; com o token do dono nada muda | o acervo inteiro: o agente veria pela API nomes e estrutura de pastas que a execução não recebeu, o que a AD-012 e a AD-040(d) recusam |
| 11. Código da falha de uma execução recusada ao lançar (acrescentada na construção, lote A) | `RunFailure.code` (`contracts/src/runs.ts` e `RunFailureSchema`) ganha `folder_not_indexed` e `folder_protection_unsupported`: uma execução cuja pasta deixou de valer entre o pedido e o lançamento (door 5 lida ao lançar: aprovação, rotina, repetição) termina `failed` com esse código e `recoverable: false`; as recusas das rotas são classes próprias com `statusCode` e `code` (`FolderNotIndexedError` 400, `FolderProtectionUnsupportedError` 409), como `ContextNotFoundError`, fora de `ENGINE_ERROR_CODES` | o código `unknown` com a razão só no texto: o C20 pede o código, e a interface não teria como dizer o que fazer; somar os dois a `ENGINE_ERROR_CODES`: muda a lista que o C50 de `sdk` fixa como a Landing dele |

- Nothing else in this change is hard to reverse: o texto do guia e das perguntas, a ordem das perguntas e o relatório em
  `artifacts/` mudam por edição.

## Criteria

### S1: a skill, o guia e o banco de perguntas (P1)

A skill existe no catálogo, com um guia que define a estrutura e o vocabulário e um banco de perguntas por tema.

**Acceptance Criteria**

1. WHEN the catalog loads THEN it SHALL list `organize-brain` with `mode: write`, `providers: [claude]`, the inputs `etapa` (`select` of `entrevista`, `aplicar`, `indexar`, default `entrevista`) and `folder` (`path`, optional), and pt-BR name "Organizar o Cérebro".
2. The skill folder SHALL hold `resources/guia.md` and `resources/perguntas.md`, and the catalog SHALL list both as markdown resources.
3. The guide SHALL define the `type` values `context`, `guide`, `project`, `decision`, `reference`, `log`, `goals`, `profile`, `index`, `inbox`, the `status` values `active`, `draft`, `paused`, `done`, `archived` (the same set as `cerebro-vista-notas` and `cerebro-paineis`), the `natureza` values `fato`, `opiniao`, `plano`, `hipotese`, `relato` (absent = not classified), the `escopo` values `pessoal`, `equipe`, `externo`, `review_every` (`30d`, `90d`, `never`, …) and the callouts `> [!fato]`, `> [!opiniao]`, `> [!plano]`, `> [!hipotese]`, `> [!relato]` for a passage inside a note, and SHALL say the owner may add `type` and `status` values in the interview.
4. The guide SHALL state the rules: write only under `memory/`; never create a file at the top of `memory/notes/`; never move, rename, edit or delete a file outside `memory/`; never overwrite a file whose front matter lacks `generated-by: organize-brain`; an index note holds pointers, not copied content; a plan or an opinion is never written as a fact (it gets `natureza: plano` or `opiniao`, or the matching callout); classifying an existing note outside `memory/` is a proposal in the report, never a write.
5. The question bank SHALL have one section per theme `perfil`, `estrategia`, `cliente-ideal`, `marca`, `voz`, `oferta`, `organizacao`, `stakeholders`, `dores`, `crencas`, `respostas`, `metas`, `estrutura` (folders and areas to approve), `escopo` (for each context note: `pessoal` or `equipe`; strategy and goals notes are marked `natureza: plano` when they state an intention) and `preferencias` (vocabulary of `type`/`status`, what never to index), each with 3 to 8 questions and the file under `memory/notes/negocio/` it fills.
6. The `SKILL.md` procedure SHALL say, per `etapa`, what it reads and writes: `entrevista` writes only `memory/inbox/entrevista-AAAA-MM-DD.md` with the questions still unanswered; `aplicar` reads the newest interview note and writes `memory/notes/negocio/*.md`; `indexar` calls `GET /api/memory/maps` and writes `_index.md` only for folders whose `state` is `missing` or `stale`.
7. WHEN the `entrevista` stage finds a `memory/notes/negocio/` note already holding an answer THEN the procedure SHALL tell the agent to skip that question and list it under "Já respondido" in the interview note.
8. WHEN a run of `organize-brain` starts THEN the run prompt SHALL hold the memory locations block (memory folder, long-term memory, journal) and, when `folder` is given, the line `Folder to organize (read-only): <real path>`.
9. The default `settings.memorySkills` SHALL be `["recall", "consolidate-memory", "organize-brain"]`, and IF a run of `organize-brain` has no memory access THEN the run prompt SHALL say the skill is not in `memorySkills` and how to add it.

**Independent test:** carregar o catálogo e conferir a skill, as entradas e os recursos; montar o prompt de uma execução com
`folder` e ler as linhas.

### S2: uma pasta do usuário, só para ler (P1)

**Acceptance Criteria**

10. WHEN a run of a skill in `memorySkills` has the input `folder` naming a folder inside one of `settings.indexedFolders` THEN the run SHALL receive that folder's real path in `readDirs` and in `protectedDirs`, besides the skill folder and `memory/`.
11. IF `folder` resolves outside every `settings.indexedFolders` entry THEN `POST /api/runs` SHALL answer `400 folder_not_indexed` and start nothing.
12. IF `folder` resolves to a path today's policy hides (the home's `config/` or `logs/`, a user exclude, a secret name), or holds a link into the home's `config/` or `logs/` THEN `POST /api/runs` SHALL answer `400 folder_not_indexed` and start nothing.
13. IF the run's provider does not declare `capabilities.protectsDirs: true` and `folder` is given THEN `POST /api/runs` SHALL answer `409 folder_protection_unsupported` and start nothing.
14. WHEN the Claude adapter builds a run with `folder` THEN its arguments SHALL hold `--add-dir <folder>` and a deny rule for each edit tool under that folder, as for the skill folder today.
15. IF the skill is not in `memorySkills` THEN the input `folder` SHALL stay text in the prompt only and SHALL NOT be added to `readDirs`.
16. The manifests SHALL declare `capabilities.protectsDirs`: `true` for Claude, `false` for Codex and Cursor.

**Independent test:** pedir uma execução com `folder` dentro e fora das pastas indexadas, e com o Codex; ler os argumentos do
adaptador do Claude.

### S3: mapa de pastas, notas-índice e o roteador (P1)

**Acceptance Criteria**

17. WHEN `GET /api/memory/maps` is called THEN the system SHALL return one entry per folder that holds an indexed file or an indexed subfolder, under the indexed roots and `memory/notes/`, with `children` as the count of direct children the index knows.
18. The system SHALL compute `digest` as `sha256:` of the sorted, newline-joined `d:<name>`/`f:<name>` list of direct children, without `_index.md` and names starting with `.`, and two calls over the same index SHALL return the same digest.
19. WHEN a folder has no `_index.md` (inside it for `memory/notes/…`, under `memory/maps/<root slug>/<subpath>/` for a user folder) THEN its `state` SHALL be `missing` and `index` `null`.
20. WHEN its `_index.md` front matter `children-digest` equals `digest` THEN `state` SHALL be `fresh`, and WHEN it differs or is absent THEN `state` SHALL be `stale`.
21. WHEN a file is added to a folder that had a `fresh` index and the pass finished THEN the next `GET /api/memory/maps` SHALL report that folder `stale`, and editing a file's text without adding or removing a child SHALL keep it `fresh`.
22. IF `root` names no indexed root and is not `memory` THEN the route SHALL answer `404 not_found`, and IF it is not an absolute path or `memory` THEN `400 validation`.
23. IF a folder is hidden by today's policy THEN `GET /api/memory/maps` SHALL NOT return it, nor count it as a child.
24. WHEN a run credential calls `GET /api/memory/maps` THEN the route SHALL answer `200`, and a device without `content` SHALL get `403`.
25. WHEN a Markdown file's front matter holds `type`, `status`, `updated`, `last_reviewed`, `natureza`, `escopo` or `review_every` THEN the index SHALL store them in the file's `fields` with those keys, and an inline `key:: value` with the same key SHALL win.
26. WHEN `generateRouters` runs THEN `ROUTER.md` SHALL hold a section "Folder indexes" listing each `fresh` or `stale` index note as a link with its folder, and a section "Folders without an index" listing up to 20 `missing` or `stale` folders by number of children (most first), and SHALL omit both sections when empty.

**Independent test:** indexar um acervo com três pastas, gravar à mão um `_index.md` com o resumo certo numa e errado noutra,
pedir a rota de mapas e gerar o roteador.

### S4: metas e postura no mapa dos agentes (P1)

**Acceptance Criteria**

27. WHEN `memory/notes/negocio/metas.md` has a `## Metas` section THEN the compiled `AGENTS.md` and `CLAUDE.md` SHALL hold `## Goals and priorities` right after the title with up to 10 of its first-level list items, each cut at 160 characters, and the line `Full goals: <path of metas.md>`.
28. IF `metas.md` is missing, has no `## Metas` section, or is a link out of `memory/` THEN the compiled files SHALL have no `## Goals and priorities` section and `mordomo sync` SHALL still succeed.
29. WHILE `settings.memory.agentStance` is `contest-conflicts` the goals section SHALL end with the line "- When a request conflicts with these goals, say so and propose the alternative that serves them before doing it.", and WHILE it is `neutral` that line SHALL be absent.
30. The system SHALL read an unreadable `memory.agentStance` in `settings.json` as `neutral`, and `PUT /api/settings` with any other value SHALL answer `400 validation`.
31. WHEN the owner opens Settings › Memória THEN the screen SHALL show "Postura dos agentes" with the two options "Neutra" and "Contestar o que conflita com as metas", the current value selected, and a line saying it takes effect at the next `mordomo sync`.
32. IF saving the stance fails THEN the setting SHALL show the error text beside an icon and keep the previous value selected.
33. The new text SHALL be 12px minimum, colors only from tokens, and the Settings screen SHALL pass axe at WCAG A/AA in both themes.

**Independent test:** escrever um `metas.md` com 12 itens, mudar a postura, rodar `mordomo sync` e ler os dois compilados.

### S5: o contexto de trabalho (P1)

A skill organiza o contexto ativo quando a execução tem um (`cerebro-contextos`, C2), sem pedir a pasta de novo.

**Acceptance Criteria**

34. WHEN a run of `organize-brain` carries `contextId` and no `folder` THEN the input `folder` SHALL be the context's first path whose `state` is `ok`, and the run SHALL get it in `readDirs` and `protectedDirs` as AC 10 says.
35. IF a run of `organize-brain` carries `contextId` and a `folder` that is not inside one of the context's paths THEN the route SHALL answer `400 validation` and start nothing.
36. WHEN the `entrevista` stage runs with a context THEN the interview note SHALL be `memory/inbox/entrevista-<id do contexto>-AAAA-MM-DD.md` and its questions SHALL be about that context (what it is, what matters, goals, what to ignore), and the `aplicar` stage SHALL write the answers into the context's `memory/notes/<id>/_resumo.md` with `natureza: plano` on the goals section.

**Independent test:** criar um contexto, iniciar `organize-brain` com `contextId` e sem `folder`, e conferir os `readDirs` e o
nome da nota da entrevista.

## Out of scope

| Excluded                                                                 | Why                                                                                                                                                         |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mover, renomear ou acrescentar front matter a arquivos fora de `memory/` | decisão do dono: pastas do usuário somente leitura (cerebro-v2, pergunta 1); a skill propõe no relatório, não aplica                                        |
| Aplicar pelo motor as propostas do relatório (mover, mesclar, arquivar)  | exige uma rota de escrita em pasta do usuário com `dryRun`, a operação de maior estrago do módulo; é a `cerebro-faxina-guiada` (C5), com arquivo reversível |
| Membros, papéis, sincronização de equipe, permissões por pessoa          | o produto é de um dono só (AD-005, AD-015); o vídeo de referência fala de equipe, e isso fica fora                                                          |
| Triagem do inbox e revisão semanal                                       | entram em `cerebro-rituais` (C8); a fila de revisões periódicas por `review_every` e a segregação por natureza na busca entram em `cerebro-natureza` (C6)   |
| Organização por embeddings (agrupar por similaridade de vetor)           | depende do provedor de embeddings que o dono ainda não escolheu (cerebro-v2, pergunta 5); a skill organiza por leitura do agente e por estrutura            |
| Uma tela própria de entrevista ou de mapa de pastas                      | a entrevista é uma nota no editor que já existe; a vista nova de notas é `cerebro-vista-notas` (C4)                                                         |
| Codex e Cursor para esta skill                                           | não protegem pasta (door 5); a skill declara só o Claude                                                                                                    |

## Assumptions

| Assumption                               | Chosen default                                                                                                                 | Rationale                                                                                                                                          | Confirmed? |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Entrevista assíncrona                    | a etapa `entrevista` grava a nota de perguntas e para; o dono preenche no editor; a etapa `aplicar` lê                         | continuar a conversa (`POST /api/sessions/:id/continue`) é um prompt solto, sem a skill e sem `memory/` (`routes/sessions.ts:27-35`)               | n          |
| Campos novos em arquivos que não mudaram | só aparecem quando o arquivo muda ou numa passada depois de um "Reindexar tudo"                                                | a passada não relê arquivo sem mudança (cerebro-v2, AC 35); reler tudo uma vez é o que o botão já faz                                              | n          |
| Raiz de `memory/notes` congelada         | regra no guia mais o relatório da execução; nenhuma trava no motor                                                             | a execução escreve com as ferramentas do agente, não pela rota de notas; a detecção de nota fora do lugar é da higiene (`cerebro-higiene-rituais`) | n          |
| Limite de leitura por execução           | o guia manda ler no máximo 200 arquivos por execução, por cabeçalhos e primeiras linhas, e dizer o que ficou de fora           | uma pasta de milhares de arquivos estouraria o contexto; a reexecução continua pelas pastas ainda `missing` ou `stale`                             | n          |
| Nomes das notas do negócio               | em português, sem acento, os de door 2                                                                                         | o produto de inspiração usa os nomes em inglês de uma marca; os nossos seguem o idioma do dono e o slug das notas (cerebro-v2, AC 3)               | n          |
| Postura padrão dos agentes               | `neutral`; o dono liga `contest-conflicts` em Configurações › Memória                                                          | resposta do dono à pergunta 1 em 29/10/2026 (o padrão recomendado); AC 29 vale para os dois valores                                                | y          |
| Perfil da skill                          | `controlled_write` em `memory/`, sem aprovação a cada escrita; sob `review_before_write` cada escrita espera o dono, como hoje | resposta do dono à pergunta 2 em 29/10/2026 (o padrão recomendado)                                                                                 | y          |

**Open questions:** none - all resolved or logged above. As perguntas 1 (postura padrão) e 2 (perfil da skill) foram respondidas pelo dono em 29/10/2026 com os padrões recomendados: a postura padrão é `neutral` e a skill roda sob `controlled_write` em `memory/`.

## Observable

| Surface                                                 | Decision                                          | Landing                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| screen Configurações › Memória (postura)                | empty state                                       | n/a - sempre há um valor (padrão `neutral`)                                                            |
| screen Configurações › Memória (postura)                | loading state                                     | existing - a tela de Configurações carrega as configurações inteiras                                   |
| screen Configurações › Memória (postura)                | error state                                       | AC 32                                                                                                  |
| screen Configurações › Memória (postura)                | unauthorised                                      | existing - `PUT /api/settings` é `owner`; um dispositivo recebe `403` e cai no AC 32                   |
| screen Configurações › Memória (postura)                | density and ordering                              | AC 31                                                                                                  |
| screen Configurações › Memória (postura)                | destructive action confirms                       | n/a - trocar a postura não apaga nada e volta com um clique                                            |
| API `GET /api/memory/maps`                              | error shape and codes                             | AC 22                                                                                                  |
| API `GET /api/memory/maps`                              | who may call                                      | AC 24                                                                                                  |
| API `POST /api/runs` (entrada `folder`)                 | error shape and codes                             | AC 11, AC 12, AC 13                                                                                    |
| all new or changed routes                               | versioning, rate limits                           | n/a - `/api/v1` é o mesmo conjunto de rotas; a rota de mapas só lê e entra no limite geral da API      |
| command `mordomo run organize-brain`                    | output, flags, exit codes                         | existing - `mordomo run <skill>` com as entradas da skill; os erros de `POST /api/runs` saem como hoje |
| document `resources/guia.md`                            | structure, tone, depth, what the reader does next | AC 3, AC 4                                                                                             |
| document `resources/perguntas.md`                       | structure, what the reader does next              | AC 5, AC 7                                                                                             |
| document nota-índice `_index.md`                        | structure, what the reader does next              | door 3; AC 6                                                                                           |
| document `AGENTS.md`/`CLAUDE.md` compilado              | structure, what the reader does next              | AC 27, AC 29                                                                                           |
| collection pastas do mapa                               | grouping, naming, ordering, duplicates, exception | AC 17, AC 18, AC 26; exceção: pasta escondida pela política (AC 23)                                    |
| collection notas do negócio                             | naming, duplicates                                | door 2; AC 7 (pergunta já respondida não gera nota nova)                                               |
| API `POST /api/runs` (entrada `folder` com `contextId`) | error shape and codes                             | AC 34, AC 35                                                                                           |

## Emendas depois da aprovação, registradas em vez de reescritas

O texto aprovado acima fica como foi aprovado, exceto `Flow` e `Impact`, que se mantêm verdadeiros, e as linhas que `Surface`
e `Landing` ganharam (doors 8 a 10), que só acrescentam. O plano foi escrito antes de `cerebro-contextos` (C2); o que a C2
construiu (`a85b2c9..c0ff2e7`, AD-040) e o que a derivação dos checks achou ficam aqui, cada um com como `checks.md` resolve.

1. **Rota de uma execução de skill.** A linha `POST /api/runs (muda)` de `Surface` e do `Observable`: uma skill começa por
   `POST /api/skills/:slug/run` (e `mordomo run`, `skills_run`, pelo mesmo `Execution.startSkill`), que responde `200`
   (`queued`) ou `202` (`waiting_approval`); `POST /api/runs` leva um prompt, sem skill nem `inputs`, e não muda. Os checks
   provam a linha acrescentada em `Surface` (C12-C16, C44-C46).
2. **Pasta de trabalho com contexto (C2 AC 17).** A C2 começa uma execução de contexto no primeiro caminho `ok` e dá os outros
   como `readDirs` sem proteção; a door 5 recusa dar a pasta como diretório de trabalho. Door 9: começa em `<home>/workspace` e
   todo caminho `ok` fora de `memory/` fica protegido (C13, C44). O C17 de `cerebro-contextos` segue verdadeiro para toda
   execução que não protege pasta.
3. **Caminho de contexto dentro de `memory/`.** A C2 aceita uma pasta de `memory/` como caminho de contexto; a door 5 só fala de
   `settings.indexedFolders`. Uma `folder` sob `<home>/memory/` é aceita e fica fora de `protectedDirs` (door 9, C21).
4. **Alcance da credencial na rota de mapas (AD-040(d)).** O AC 17 fala das raízes indexadas; a C2 estreitou o que a credencial
   de uma execução lê a `memory/` e ao seu contexto. Door 10: com essa credencial a rota só vê `memory/notes/` e as pastas da
   execução (C31). Segue a pergunta ao dono ainda aberta de `cerebro-contextos` (1).
5. **Onde fica um índice que falta.** O AC 19 dá `index: null` para `missing` e a door 2 não dava a forma de `<slug da raiz>`:
   o agente não saberia onde escrever. Não vem da C2, foi achado ao derivar. Door 8 e o campo `indexPath` (C24, C26, C32).
6. **`type: brief` e a seção de metas do resumo (C2 door 9).** O `_resumo.md` da C2 tem `type: brief` e as seções `## O que é`,
   `## O que importa`, `## Metas`, `## O que ignorar`; o AC 3 não lista `brief`, e `natureza` é chave do front matter (door 6),
   não de uma seção. O guia lista `brief`, e `aplicar` marca a seção `## Metas` com o callout `> [!plano]` (C3, C47).
7. **Não sobrescrever vs. o resumo.** O AC 4 proíbe sobrescrever arquivo sem `generated-by: organize-brain`, e o `_resumo.md`
   (do dono ou do `PATCH /api/contexts/:id {brief:true}`) não o tem. A única exceção é o resumo do contexto da execução:
   `aplicar` só preenche seção vazia, nunca reescreve texto do dono, e cria um que falta na forma do modelo da C2 (C4, C47).
8. **Caminhos no texto da skill.** O AC 6 e a door 2 escrevem `memory/inbox/…`; o teste do seguranca-p1 C49
   (`tests/builtin-context.test.ts`) recusa um arquivo de skill embarcada que nomeie caminho relativo ao home. O texto diz "na
   pasta de memória que o prompt dá" (`<pasta de memória>/inbox/…`); os arquivos escritos são os mesmos (C6, C11).
9. **O id do contexto no prompt.** O bloco do contexto da C2 traz o nome e o mapa `…/contexts/<id>.md`, sem uma linha de id; o
   `SKILL.md` tira o `<id>` do nome do arquivo do mapa para nomear a nota da entrevista; o banco de perguntas ganha a seção `contexto` (C5, C47).
10. **Lugar do seletor de postura.** O AC 31 diz só Configurações › Memória; a C2 pôs Contextos logo depois das pastas indexadas
    (C52 dela). "Postura dos agentes" é o último bloco da aba, depois do campo de registros, e nada da C2 muda de lugar (C41).
11. **Compilação de um contexto (C2 AC 30).** A compilação na pasta principal de um contexto usa o mesmo `agentsFileContent`; a
    seção de metas (do `metas.md` geral) também vai para lá (C36).
12. **O padrão de `etapa`.** A door 1 dá a `etapa` o padrão `entrevista`, e `SkillInputSchema` (`contracts/src/skills.ts`) não
    tem campo de padrão: o padrão é a primeira opção e o `placeholder`, e o `SKILL.md` diz que sem `etapa` roda `entrevista`
    (C1, C6).

## Sources

- Pedido do dono (29/10/2026): "uma skill interna para rodar com as IAs para organizar e indexar de forma semântica e útil
  para o segundo cérebro para estruturas desorganizadas ou subpastas novas, oferecendo um guia e perguntas para personalizar o
  que realmente importa e como quer"; prints do produto de inspiração (nota de guia por pasta com tabela de categorias, pasta
  `Context/`, front matter `type`/`status`/`tags`/`updated`) — inspiração, não cópia.
- `reports/Segundo cérebro para agentes.md`, roteiro M6 (onboarding por entrevista, metas no compilado).
- `.specs/STATE.md`, cerebro-v2, pergunta 1 (pastas do usuário somente leitura) e AD-012 (caminhos absolutos e credencial da
  execução para skills de memória).
