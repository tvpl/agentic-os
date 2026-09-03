# Análise: o Agentic OS do vídeo, o MordomoOS e o estado da arte open-source

**Data:** 3 de setembro de 2026 · **Alvo:** `tvpl/agentic-os` em `291fa59` (v0.4.0) · **Escopo:** funcionalidades, experiência, widgets, ferramentas, animação, fluidez e Segundo Cérebro. Segurança fica fora deste documento (coberta em `docs/audit-2026-09/`).

**Fontes primárias.** Vídeo [The NEW Agentic OS standard for Claude 5 Models is here](https://www.youtube.com/watch?v=8NSyI-npJCU) (Jay E, RoboNuggets, 20/08/2026, 21:38): transcrição integral extraída (legendas automáticas), thumbnail 1280×720 e storyboard de frames (um a cada 10 s, 160×90). Vídeo complementar do mesmo autor, [Build your Ultimate Second Brain with Claude Fable 5](https://www.youtube.com/watch?v=VoKiKvgpk78) (13:41): transcrição integral e storyboard (um frame a cada 5 s). Site do produto mostrado, [RUBRIC](https://www.getrubric.app/). Post [The NEW Agentic OS format for Claude 5 Models](https://robonuggets.beehiiv.com/p/the-new-agentic-os-format-for-claude-5-models). Código do MordomoOS (leitura completa de `apps/command-centre/src`, `core/src`, `apps/api/src`) e capturas de tela em `docs/audit-2026-09/img-after/`. Cerca de 40 repositórios do GitHub com estrelas consultadas em 03/09/2026.

**Limite honesto.** O vídeo não pôde ser baixado em resolução plena (bloqueio do YouTube). Tudo o que está descrito sobre a interface dele vem da narração completa, da thumbnail em alta resolução (que é uma captura real do dashboard) e dos 150 frames do storyboard. Layout, widgets, cores e fluxos estão confirmados; micro-detalhes de easing e duração de animações não são verificáveis por essa via e estão marcados como inferência.

---

## 0. Sumário executivo

1. **O vídeo mostra o RUBRIC, produto do próprio apresentador**, e o nosso `docs/product-spec.md` foi escrito a partir do PDF do mesmo autor. Resultado: o MordomoOS já é estruturalmente um irmão do RUBRIC (anéis concêntricos, deck de skills com modelo × esforço, relógio com semana e quarter dots, micro-apps, anel de artefatos, `ROUTER.MD` no centro). Não há um "salto conceitual" a copiar; há um **salto de dados, de polimento e de profundidade**.
2. **A diferença que mais aparece no vídeo não é visual, é de conteúdo.** O dashboard dele responde perguntas reais: 47 e-mails nas últimas 24 h e 3 sinalizados como "precisa de você", eventos do calendário, quantos vídeos no YouTube, qual rotina dispara às 10:00, quais artefatos foram feitos para o cliente X em 5 de agosto. O nosso desktop, na captura oficial, mostra "Nada em execução", "Nenhuma rotina habilitada", "Nenhum artefato ainda" no espaço mais nobre da tela. Conectores de e-mail e calendário existem em `connectors/*.json` como registro (`status: not_configured`), e **nenhum código do core consome dados de conector**.
3. **O Segundo Cérebro dele é uma ferramenta de navegação e de auditoria; o nosso ainda é sobretudo um mapa.** Ele substitui o Finder (busca instantânea, abrir no SO, preview), mostra arquivos como arcos concêntricos ordenados por departamento (legível com 35 mil arquivos), abre o conteúdo de uma skill e suas conexões ao clicar, e usa a densidade dos anéis como diagnóstico ("apps conectados demais", "rotinas que ninguém lembra"). O nosso descarta dois dos três tipos de aresta que a API já devolve (`world.ts:232-235`), não tem grafo local, backlinks, filtros por extensão/tag/data, nem estado na URL.
4. **Sob o capô, o "second brain" dele tem um mecanismo de retrieval determinístico** (`brain.js`: extrai palavras-chave, pontua fontes pelos índices sem abrir arquivos, abre só o de maior score, lê só a seção, segue ponteiros) que reduz o custo de 50 mil para 30 mil tokens por consulta. Temos FTS5 e routers, mas nada equivalente exposto às skills como um comando de retrieval por camadas.
5. **Animação e fluidez: a base está certa, os detalhes estão errados.** Tokens de motion, `prefers-reduced-motion`, entradas com stagger e presença no launcher são bons. Mas: não há animação de saída em modais, não há transição entre desktop e apps, o arrastar de widgets re-renderiza a camada inteira a cada `pointermove` usando `left/top`, o Segundo Cérebro roda a 60 fps sem dirty flag e sem pausar com a aba oculta, e há 27 regras `:hover` e zero `:active` no `theme.css`.
6. **Bugs visuais concretos encontrados agora**: o corpo do `SKILL.md` na tela de skill é renderizado com a classe do caminho de arquivo (11 px, texto apagado, quebra no meio das palavras) em `SkillDetail.tsx:222`; o wallpaper lê três tokens (`--canvas-star`, `--canvas-particle`, `--canvas-line`) que não existem no `theme.css`, logo o tema claro tem estrelas invisíveis; oito classes usadas no JSX não existem no CSS (`.empty-state.compact`, `.ma-icon.ghost`, `.orbit-chip.artifact`, entre outras).
7. **Runs: o pipeline de eventos é bom (SSE, timeline virtualizada), mas faltam as três coisas que todo painel de agente do GitHub tem em 2026**: custo/tokens (nenhum adapter lê `usage`; o Claude Code emite isso no `stream-json` e nós descartamos), lista de arquivos alterados com diff (o backend já produz `filesChanged`, a UI nunca renderiza), e aprovações inline (hoje o fluxo redireciona para Configurações).
8. **O ecossistema open-source convergiu em padrões que ainda não temos**: paleta de comandos com páginas aninhadas (cmdk), grafo com filtros/grupos/local graph/animação temporal (Obsidian), memória em markdown com notas diárias e consolidação em "sono" (OpenClaw, Letta), heartbeat com horário ativo, checkpoints ramificáveis com diff (opcode, LangGraph), medidor de contexto e de burn rate (claude-view, CCSeva), dock com física de mola (Magic UI), widgets declarativos com TTL (Glance).
9. **Recomendação de foco** (detalhe na seção 5): (a) transformar o centro do desktop em algo vivo (prompt bar + inbox de aprovações + corrida em andamento), (b) fazer o Segundo Cérebro virar navegação (arestas tipadas, grafo local, hover de vizinhos, filtros, URL), (c) fechar a dívida de motion (saídas, transições de rota, drag com transform, dirty flag), (d) capturar custo e diff nos runs, (e) trazer dados reais para dois widgets (calendário e e-mail) através de um conector somente-leitura.
10. **Nada disso exige reescrever.** Os itens de maior impacto cabem em arquivos que já existem e estão apontados com linha nas seções 3 e 5.

---

## 1. O que o vídeo mostra, de fato

### 1.1 O dashboard (00:43 a 03:54)

O apresentador chama de "virtual command center for my Agentic operating system". É **uma tela só**, sem janelas, sem barra de tarefas, sem multitarefa: um dashboard de página única com grade de widgets. A thumbnail do vídeo é uma captura real dele. Anatomia, coluna a coluna:

| Zona | Conteúdo observado | Dados |
|---|---|---|
| Coluna esquerda, topo | **Micro apps**: Generations ("every image and video you have generated"), Teleprompter ("scripts you read on camera"), Second Brain ("your whole workspace as a living map"), Excalidraw ("hand-drawn diagrams ready to copy into your canvas"), botão "+ ADD APP" | Links para apps HTML locais |
| Coluna esquerda, base | **Calendar**: "Wk34 · Aug 21 2026 (Fri)", relógio grande `03:06:44 pm` em laranja, botão "OPEN CAL"; fusos que ele acompanha | Calendário real conectado |
| Centro | Título "RUBRIC Agentic OS · Jay E / RoboNuggets", quatro ícones (editar, buscar, grade, info), **anel de artefatos** (cerca de 40 chips circulares com ícone por tipo: documento, vídeo, código, raio, escudo, e-mail), **núcleo de partículas** multicolorido (cada cor é um departamento da memória) sobre uma malha poligonal | Artefatos reais com busca por nome de cliente e data |
| Coluna direita, topo | **Email**: "47 emails past 24h", "Flagged · needs Jay" com três itens e idade (2h, 4h, 7h), "Today's mix: 9 partners · 14 leads · 8 personal · 16 other", "synced 03:06 PM" | Gmail lido por Claude, que classifica e sinaliza |
| Coluna direita, meio | **Skills deck** em 2×2: `/sprint-planning SONNET·MEDIUM`, `/newsletter OPUS·XHIGH`, `/games OPUS·XHIGH`, `/clean-up FABLE·XHIGH`, cada card com botão executar e botão configurar; "+ ADD SKILL" | Runs headless via `claude -p`, relatório HTML no final |
| Coluna direita, base | **Routines** como tabela hora · rotina · status: `daily inbox digest 07:00 FIRED`, `deliverables status sweep FIRED`, `community pulse digest FIRED`, `content pipeline check NEXT` (linha destacada em laranja), `client report drafts QUEUED`; rodapé "CLAUDE DESKTOP 3 · HERMES 14 · DATA 21 AUG 03:06 PM" | Contagem por runner: 3 rotinas locais, 14 no agente Hermes na nuvem |
| Widget custom | Um widget de YouTube ("because obviously I do a lot of content") | API do canal |

Interações narradas e confirmadas nos frames:

- **Widgets redimensionáveis e reposicionáveis**, e a criação de widgets novos é delegada ao Claude Code ("Claude Code is actually really good in creating these for me"). O RUBRIC se descreve como "zero npm dependencies" e "1 copy-paste install": é um scaffold HTML/JS que agentes baseados em arquivos leem e escrevem. Isso explica a facilidade de gerar widgets: um widget é um arquivo.
- **Anel de artefatos com busca**: ele digita o nome de um cliente ("THRO"), o anel filtra, e ele abre o HTML criado em 5 de agosto. O frame do storyboard aos ~1:50 mostra o anel com uma linha de busca e chips agrupados.
- **Clique no centro abre o Segundo Cérebro** (transição para outra tela cheia).
- **Deck de skills**: ajustar modelo e esforço no card e executar dali; a saída é um relatório (ele abre o relatório da skill `/clean-up`).
- **Tema por cliente**: aos ~2:36 aparecem uma versão inteira do dashboard em verde ("Beto Green") e um mockup para uma financeira australiana. O produto é vendido como serviço de consultoria, então a **retematização completa por um único token** é requisito.
- **Detalhe de artefato/skill** em painel lateral (frame aos ~1:40: painel "DETAILS" à direita com metadados).
- **Modal de confirmação** com borda laranja (frame aos ~2:20).

Animação (inferência a partir dos frames, não verificável quadro a quadro): o núcleo de partículas está sempre em movimento lento; o anel de artefatos gira muito devagar; chips têm hover com escala; o relógio conta os segundos. Não há indícios de animação de janela, dock, ou transições de rota elaboradas. O apresentador dedica 3 minutos ao dashboard e diz explicitamente que "this visual interface captures only around 20 to 30% of the value" (03:30).

### 1.2 O Segundo Cérebro (12:25 a 14:31 neste vídeo; vídeo complementar inteiro)

**Estrutura (confirmada na thumbnail do vídeo complementar, que é uma captura real):**

- Centro: `CLAUDE.MD`, tratado como **router mestre**, que lista os departamentos e diz ao agente em que conjunto de arquivos operar.
- Anel 1, **SKILLS**: estrelas laranja, uma por skill. Clique abre o `SKILL.md` e mostra arquivos e rotinas conectados.
- Anel 2, **MEMORY**: dividido em **setores por departamento** (Business, Content, Community, Product, Personal), cada setor com **arcos concêntricos pontilhados** onde cada ponto é um arquivo, ordenado. É isso que torna 35.466 arquivos legíveis: a densidade do setor mostra o tamanho relativo de cada departamento sem sobreposição. Cada departamento tem um **router próprio** (`content.md` lista skills e referências daquele departamento).
- Anel 3, **ROUTINES**: relógios amarelos, ligados por linha à skill que executam; a maioria roda no Hermes na nuvem.
- Anel 4, **APPLICATIONS**: hexágonos com o logo do app (Gmail, Notion, HubSpot, Drive, entre outros) e o tipo de conexão (MCP, API ou CLI).

**Interações confirmadas nos frames:** tooltip no hover; clique em skill abre painel lateral com o conteúdo e conexões; clique em app abre painel com detalhes e um grupo de controles (toggles e sliders, aos ~9:40 do vídeo complementar); expandir pasta dentro do setor; **abrir o arquivo no sistema operacional** (ele abre uma grade 5×5 de fotos direto do grafo); busca instantânea que ele usa no lugar do Finder; layouts alternativos, incluindo um **force layout com clusters coloridos por departamento** e um **circle packing** em cinza (frames aos ~0:20 e ~3:50 do vídeo complementar).

**Uso que ele defende, e que é a parte mais transferível:**

- **Explicar sistemas a clientes**: "a much better way to communicate the idea of a second brain system than showing a folder".
- **Auditoria por densidade**: muitos hexágonos no anel de aplicações = muito poder e muito risco; app que não é mais usado deve ser desconectado. Muitas rotinas = muita automação, mas rotina que ninguém lembra deve ser aposentada. O grafo vira um painel de higiene do sistema.
- **Substituir o explorador de arquivos** para o humano, já que a organização de pastas passou a ser "para o agente".

**Sob o capô (vídeo complementar, 09:32 a 11:02):** `brain.js`, código determinístico chamado no início de toda consulta de memória: extrai palavras-chave da pergunta, pontua fontes candidatas usando os índices e mapas de referência sem abrir arquivo nenhum, abre só o de maior score, procura a seção relevante em vez de ler tudo, e segue ponteiros quando a seção aponta para outro lugar. Medido com `/context`: 30 mil tokens contra 50 mil do Claude Code padrão na mesma pergunta, e resposta mais rápida. Ele usa `/goal` para o agente checar o próprio trabalho: "sem lag ao trocar layout" e "carrega em menos de 10 s".

### 1.3 O framework, no que muda em relação ao nosso spec

O ARMS em três níveis já está no `docs/product-spec.md`. O que o vídeo acrescenta ou enfatiza:

- **Skills "grossas" viram pastas com referências ricas**, incluindo HTML de marca (fontes, paleta) para skills de design; ele gera um PDF de 17 páginas alinhado à marca com um prompt porque a skill `/robo` carrega o design system. Nosso detector de thick-skill e o split assistido existem; falta a noção de **recurso visual dentro da skill** e de preview desses recursos.
- **Rotinas nível 2 = agente sempre-ligado (Hermes) + Syncthing**, com contagem por runner exposta no dashboard. Nós temos o guia de VPS, mas a UI não distingue "onde" uma rotina roda.
- **Conectores por skill** (`search connectors`: procura oficial, depois comunitário em CLI/API/MCP, recomenda um) e **construção de conector próprio** (CLI printing press). Nosso auditor recomenda até 3; não temos o fluxo "procurar na web e recomendar".
- **Micro-apps com dados reais**: Generations (grade masonry de imagens/vídeos gerados), Excalidraw landing pad (colar diagramas), teleprompter. Nós temos Pixel Studio.

### 1.4 O que o RUBRIC oferece além do que aparece no vídeo

Do site: dez painéis. Scaffold (hub com abas e tema), Icons (galeria pixel-art para identificar agentes), **Flows** (visualizador de pipelines com **playback** passo a passo), **Skill Trees** (grafo force-directed gerado a partir do setup, para achar skills duplicadas), **Agents** (quem está ativo e fazendo o quê), **Crons** (calendário de recorrências), **Generations** (log de mídia com custo por geração), **Docs** (markdown vivo que agentes leem e escrevem), Links, **Sprints** (board + backlog). Instalação por prompt colado no agente; "built by a team of agents".

---

## 2. MordomoOS hoje: comparação direta

| Dimensão | Vídeo / RUBRIC | MordomoOS v0.4.0 | Leitura |
|---|---|---|---|
| Modelo mental | Dashboard de tela única; "OS" é a organização de arquivos por baixo | Desktop fullscreen com launcher, apps que abrem por cima, "Voltar ao OS" | Nosso é mais "OS" no sentido literal; o dele é mais útil por minuto |
| Centro da tela | Anel de artefatos pesquisável + núcleo de partículas por departamento; clique abre o cérebro | Painel "Agora" (runs ativas, próxima rotina, últimos artefatos) sobre núcleo de partículas e chips orbitais de arquivos recentes | Painel "Agora" resolveu o achado 6.1 da auditoria; mas em estado vazio mostra três "nenhum" |
| Widgets | Micro apps, Calendar, Email, YouTube, Skills deck, Routines; criáveis por prompt; retematizáveis por cliente | Micro apps, Hoje, Workspace, Deck, Rotinas, Pulso, Atenção; conjunto fixo em `desktop/index.tsx:103-111`; sem configuração por widget; sem "adicionar widget" | Falta dado externo (e-mail, agenda) e extensibilidade |
| Skills deck | 2×2, modelo × esforço no card, run + config, "+ ADD SKILL" | Deck com matriz modelo × esforço persistida por skill, favoritos, run | Paridade; falta indicador "rodando agora" no card (`DeckWidget.tsx`) |
| Rotinas | Tabela hora · rotina · status com linha NEXT destacada; contagem por runner | Board Fired/Next/Queued/Paused, próximas 3 no "Hoje", validação de cron e preview | Paridade funcional; falta agenda/timeline e "onde roda" |
| Artefatos | Anel com busca por cliente e data, abrir HTML | 3 últimos no painel "Agora"; `/api/artifacts/recent` e `/file` | Falta galeria com busca, thumbnails e filtros |
| Segundo Cérebro | Setores por departamento com arcos de arquivos; painel de detalhe com conteúdo e conexões; abrir no SO; layouts force/circle-packing; controles em painel; `brain.js` | Anéis SKILLS/MEMORY/ROUTINES/APPLICATIONS; hubs com nebulosas expansíveis; preview lateral; abrir no editor; Force/Círculo/Hex/Anéis; minimapa; cometas de runs ativas | Nosso é visualmente mais rico (cometas, minimapa); o dele é mais legível em escala (arcos) e mais útil como navegação |
| Runs | Relatório HTML ao final; nada de timeline no vídeo | Timeline virtualizada com tool_use, permission, result; SSE; cancelar; filtros | **Vantagem nossa**, mas sem custo, diff nem aprovação inline |
| Execução | Claude Code apenas (`claude -p`) + Hermes | Claude, Cursor, Codex por adapter; perfis de segurança; scheduler croner | **Vantagem nossa** |
| Tema | Retematização por cliente inteira (verde, azul) | Accent configurável com contraste derivado; dark/light | Paridade parcial: só o accent muda, não a família de superfícies |
| Ferramentas de criação | Widgets e micro-apps gerados por prompt | Pixel Studio; skills via UI | Falta o "peça ao agente que crie um widget" como fluxo de produto |

### 2.1 Desktop e widgets

- **O espaço nobre continua sem dado quando o sistema está ocioso.** A captura oficial (`img-after/01-desktop.jpg`) mostra o painel "Agora" com três negativas. O dashboard do vídeo nunca está vazio porque puxa e-mail e calendário. Enquanto não houver conector, o painel deveria degradar para conteúdo útil: últimas execuções concluídas com resumo de uma linha, arquivos mais alterados nas últimas 24 h (já indexados), próximos disparos mesmo de rotinas pausadas.
- **Não existe prompt no desktop.** O único campo de execução rápida está em `runs/RunList.tsx:84-96`, a uma navegação de distância, em modo somente-leitura fixo (`:49`), sem escolher pasta nem skill. No vídeo, o deck resolve isso para skills; para prompt livre, os painéis open-source (claudecodeui, opcode, HumanLayer) põem a caixa de prompt na home.
- **Widgets são um conjunto fechado.** `WIDGET_ORDER` em `desktop/defaultLayout.ts` e a lista em `desktop/index.tsx:103-111`. Sem registro, sem galeria de "adicionar widget", sem configuração (fusos do relógio, dias do sparkline), sem duplicar. O vídeo e o Glance (36,8 mil estrelas) mostram o caminho: widget como **declaração** (fonte, TTL de cache, colapsar após N itens) ou como **arquivo HTML** que o agente gera.
- **Estados vazios ainda são texto.** Workspace com 0 arquivos não oferece "adicionar pasta"; Deck com zero skills não tem estado vazio; Pulso com "—" tem CTA que depende de `querySelector` (`desktop/index.tsx:109`).
- **Micro-apps não configurados parecem apps reais** porque `.ma-icon.ghost` e `.ma-name.dim` não existem no CSS (`MicroAppsWidget.tsx:34-38`).
- **Sem centro de notificações.** Eventos `run.finished`, `routine.fired`, `approval.requested` chegam pelo SSE (`hooks/useEventStream.ts`) e só invalidam caches; nada acumula um histórico com contagem de não lidos.

### 2.2 Animação e fluidez

O que está bem: tokens de motion e `--ease-standard`; todas as entradas dentro de `@media (prefers-reduced-motion: no-preference)` (`theme.css:200-222`) com kill-switch global; widgets entram com `enter-fade-up` e stagger de 40 ms (`WidgetLayer.tsx:269-274`); launcher com backdrop, `scale-in-96` de 240 ms e saída via `usePresence` (`components/dialog.tsx:126-148`); toasts com barra de progresso; wallpaper com tokens em cache via `MutationObserver`, throttle a 12 fps em idle e pausa com `document.hidden` (`desktop/Wallpaper.tsx:238-291`); `tweenTransform` no cérebro dá zoom suave (`brain/engine/physics.ts:435-442`).

O que está errado ou faltando, em ordem de percepção pelo usuário:

1. **Modais e confirmações somem sem animação de saída** (`components/ui.tsx:204-223` desmonta na hora). Só o launcher usa `usePresence`.
2. **Desktop ↔ app é um corte seco.** Nenhuma transição de rota (`App.tsx:242-267`), nenhum uso da View Transitions API, nenhum elemento compartilhado entre o tile do launcher ou o card do deck e a tela que abre. É a diferença entre "abrir um app" e "trocar de página".
3. **Arrastar widget re-renderiza a camada inteira a cada `pointermove`** (`desktop/useGridLayout.ts:515-542`, `setGhost` a cada evento) e posiciona com `left/top` (propriedades de layout) em vez de `transform`. Sem rAF, sem FLIP nos vizinhos, sem destaque da célula alvo, sem animação de encaixe ao soltar; o único feedback é `opacity: .85` (`theme.css:394`).
4. **Esconder/mostrar widget e resetar layout pulam** (`WidgetLayer.tsx:267-270` escreve geometria sem transição).
5. **Zero estados `:active`/pressionado** em todo o `theme.css` (27 regras `:hover`, nenhuma `:active`). Botões, tiles e chips não "afundam" ao clicar.
6. **Segundo Cérebro a 60 fps sempre**: `raf` rearmado incondicionalmente (`views/SecondBrain.tsx:805-807`), sem dirty flag, sem throttle em idle, sem `visibilitychange`. Por frame: `getBoundingClientRect` (`:503`), array `ringDefs` novo com quatro `t()` (`:525-530`), 11 pontos com `shadowBlur`, cada aresta traçada duas vezes (`:586-597`) mais até 240 sprites de pulso, até 3.000 `drawImage`, `w.orbs.find` por cometa (`:665`), minimapa inteiro redesenhado (`:770-803`) sem DPR (fica borrado em telas HiDPI). A auditoria de setembro marcou "minimapa com DPR" e "slider de molas não reconstrói a simulação" como feitos; **não estão**: `linkSpring` continua nas dependências do efeito que cria o `forceSimulation` (`:864`).
7. **`backdrop-filter: blur(7px)` sobre canvas vivo** continua em `.widget-inner` (`theme.css:362`), `.now-panel`, `.os-chip` e `.edit-bar`. O compositor refiltra a cada frame do wallpaper. E o wallpaper entra em modo 60 fps sempre que o mouse está em qualquer lugar do desktop, porque `hover` é ligado no `pointerenter` de um wrapper `inset: 0` (`Wallpaper.tsx:347-352`).
8. **Sem física de mola no DOM, sem tween de números** (Pulso e contagem regressiva do "Agora" trocam valor seco), **sem skeleton no cérebro** (canvas em branco até o grafo chegar, `SecondBrain.tsx:124-126`, e nenhum uso do evento `index.progress` durante o refresh).
9. **`pulse-glow` anima `box-shadow`** (`theme.css:801`, e inline em `SecondBrain.tsx:1006`), que força repaint a cada frame, infinito.

### 2.3 Interatividade

- **Teclado**: `Esc`, `Ctrl/⌘ M`, setas no launcher, setas e Shift+setas no modo edição (só com o grip focado), `/`, `p`, `⌘±0` no cérebro, `1-4` e `⌘Z` no Pixel Studio. Faltam: `⌘K` (o padrão que Raycast, Linear, cmdk e HumanLayer fixaram; `Ctrl M` não é reconhecível), `?` com folha de atalhos, `⌘Enter` para executar em `SkillDetail` e `RunList`, `Esc` para fechar lista/preview do cérebro, retorno de foco ao voltar ao desktop, redo e `[`/`]` no Pixel Studio.
- **Launcher não é uma paleta de comandos** (`App.tsx:313-454`): busca substring em 8 apps e nas 8 primeiras skills; não executa ações (reindexar, backup, doctor, nova skill, alternar edição), não busca arquivos via `/api/memory/search`, não tem páginas aninhadas. Item 3 do roadmap da auditoria continua aberto.
- **Ponteiro**: nenhum `onContextMenu` no projeto; sem multi-seleção; sem arrastar nós no grafo (`pointerdown` sempre faz pan, `SecondBrain.tsx:892-898`); sem arrastar-e-soltar entre widgets (uma skill sobre Rotinas para agendar, por exemplo). No cérebro, scroll de trackpad com dois dedos dá zoom em vez de pan e pinça (`ctrlKey`) não é distinguida (`:878-891`); sem `touch-action: none`, toque é imprevisível.
- **Undo só no Pixel Studio.** Esconder widget, resetar layout, trocar accent: sem desfazer.
- **Affordances quebradas por CSS ausente**: `.dimmed` no canvas, `.orbit-chip.artifact/.file` (artefato e arquivo ficam idênticos), `.hud-label.accent`, `.empty-state.compact` (padding de 32 px dentro de widgets de 4 linhas), `.modal-hint`, `.modal-intro`, `.req`. Linhas de Board, Hoje, Atenção e `.list-row` sem hover; `RunList` usa `role="link"` em `<tr>` (`:169`). Glifos de texto no lugar de ícones (`⠿ ✕ ☰ ◆ ◉ ⚙ →`) misturados com lucide.
- **Bug de leitura**: `SkillDetail.tsx:222` renderiza o corpo do `SKILL.md` com `className="skill-source numbered"`, e `.skill-source` é o estilo do caminho de arquivo (11 px, `--text-faint`, `word-break: break-all`, `theme.css:1106`).

### 2.4 Segundo Cérebro

Modelo (`brain/engine/world.ts`): `FileNode` com posição, velocidade e alvo polar; `Hub` por área ou pasta; `OrbNode` para skills, rotinas e conectores em anéis fixos; efeitos, cometas e transform. Layouts puros em `layouts.ts` (halo, hex, círculo áureo, leque em setor); force via d3 no componente. Hit-test hubs → orbs → arquivo mais próximo com tolerância por zoom. Busca local por substring mais FTS. Preview com token de corrida. Minimapa. Cometas para runs ativas. É um motor sólido e testado.

O que falta para ele virar **navegação** e **diagnóstico**, como no vídeo e no Obsidian:

1. **Arestas tipadas.** `/api/memory/graph` devolve `markdown-link`, `same-dir` e `same-area` com um `why` humano; `buildWorld` mantém só `markdown-link` (`world.ts:232-235`) e descarta tipo, direção e peso. Consequência: o grafo de arquivos sem links markdown (a maioria) fica sem aresta nenhuma.
2. **Sem grafo local** (vizinhança a N saltos do nó selecionado), **sem backlinks** (a lista "relacionados" mostra só o `why`), **sem destaque de vizinhos no hover** (`selectedEdges` só acende no clique; hover só tinge hubs e orbs, `:913-926`).
3. **Sem filtros por extensão, tag, data ou tamanho.** `tags` está no modelo e nunca é usado. Obsidian resolve com Filters + Groups (query → cor).
4. **Tamanho do nó por tamanho de arquivo** (`world.ts:228`) em vez de grau ou recência. Um `README.md` central e um `.log` gigante ficam invertidos.
5. **Sem estado na URL**: seleção, layout, filtro e zoom não vão para o hash; nada é linkável, nem de um run para o arquivo que ele alterou.
6. **Sem pinar/arrastar nós, sem órfãos, sem linha do tempo** (o "Animate" do Obsidian: replay do vault por data de criação; nós temos `mtime` em todo nó).
7. **Hub click alterna expansão em vez de focar/filtrar**; legenda filtra mas não dá zoom; clicar em skill ou rotina navega para fora sem confirmação.
8. **Preferências em `localStorage` ("Bake") enquanto o layout do desktop vai para o servidor**: duas estratégias para a mesma classe de dado (achado 5.1 da auditoria, ainda aberto).
9. **Tema claro com constantes escuras**: hexágono `#10131a` (`:1336`), glifo de pasta `#0b0a08` (`:740`), núcleo da estrela `#fff8ee`, minimapa `rgba(0,0,0,.25)` (`:779`).
10. **Legibilidade em escala**: nossas nebulosas por hub são bonitas até algumas centenas de arquivos; com 35 mil (o caso do vídeo) elas viram uma mancha. Os **arcos concêntricos por setor** do RUBRIC são uma função de layout a mais em `layouts.ts` (ordenar por `dir` e `mtime`, distribuir em arcos de raio crescente com passo fixo).

### 2.5 Runs e experiência do agente

Pontos fortes reais: `EventTimeline.tsx` virtualizada, agrupamento de stdout/stderr, ícone por tipo, detalhes de tool colapsáveis, autoscroll só no fim com "n novos"; `useRunStream.ts` agrupa SSE por frame e fecha limpo; `RunDetail` com badges, cwd, artefatos com preview.

Lacunas, em ordem de valor:

1. **Custo e tokens**: nenhum adapter emite `usage`; `RunEvent` não tem esse tipo (`core/src/agents/types.ts`). O `stream-json` do Claude Code e o JSON do Codex já trazem tokens e custo no evento `result`; hoje `adapters/claude/src/index.ts:222` lê só `subtype`/texto.
2. **Arquivos alterados e diff**: `filesChanged` é produzido em `core/src/runs/runManager.ts` e tipado em `useRunStream.ts:24`, e nunca renderizado. Cline, opcode e claudecodeui mostram cada edição como diff revisável.
3. **Aprovação é um beco**: `waiting_approval` vira toast + navegação para `/settings?tab=security` (`RunList.tsx:55-58`, `SkillDetail.tsx:47-51`, `desktop/index.tsx:88-90`). Precisa de card inline com aprovar/negar, e de uma inbox.
4. **Sem re-executar, sem continuar com follow-up, sem copiar log, sem busca na timeline, sem timestamps absolutos**, timeline com altura fixa de 480 px (`EventTimeline.tsx:42`), botão morto oculto em `RunDetail.tsx:183-190`.
5. **Deck não sabe que a skill está rodando.** `DeckWidget.tsx` não cruza com `useDesktopRuns()`.
6. **Sem replay**: opcode e claude-code-stats mostram sessão como grafo animado com scrubber; temos todos os eventos com `ts` no SQLite.

### 2.6 Visual

Escala tipográfica (`--fs-1…8`) e espaçamento de 4 px tokenizados, mas chips de 9 px (`theme.css:1046-1047`) e numeração de 10 px furam o piso de 11 px, e restam 78 objetos `style={{}}` inline (muitos em `SecondBrain.tsx`). Raio inconsistente (`--r-1…4` convivendo com `--radius`/`--radius-sm`; cards 4 px, modais 8 px, tiles 10 px). Accent com contraste derivado está bem resolvido. Páginas de app usam coluna de 1.240 px que deixa monitores largos vazios. Ícones lucide de 13 a 22 px misturados com glifos de texto. Glass e neon coerentes, mas pesados sobre canvas vivo.

---

## 3. O que os projetos mais bem avaliados do GitHub ensinam

Estrelas consultadas em 03/09/2026. Só entram recursos concretos e transferíveis.

### 3.1 Segundo cérebro e grafos

- **Obsidian** (obsidianmd/obsidian-releases, 21 mil; núcleo fechado). O graph view é a referência: **Filters** (query, tags, anexos, órfãos, "só existentes"), **Groups** (query → cor), **Display** (setas, limiar de fade do texto, tamanho de nó, espessura de link, e **Animate**: replay do cofre por data de criação), **Forces** (centro, repulsão, força e distância do link), **Local graph** com slider de profundidade e toggles de entrada/saída. Hover realça vizinhos e esmaece o resto. **JSON Canvas** (3,7 mil) é um formato aberto e minúsculo para canvas infinito, adotável como formato de persistência de layouts.
- **Smart Connections** (5,4 mil): painel "relacionados" por embedding local que atualiza enquanto você digita; grafo semântico onde distância = similaridade, mostrando clusters **não ligados explicitamente**.
- **Graph Analysis** (530): Jaccard, predição de links (Adamic-Adar, vizinhos comuns), **co-citação** (backlinks de segunda ordem), detecção de comunidades. Predição de link = "você provavelmente deveria ligar estes dois", desenhável como aresta fantasma.
- **Juggl** (821): grafo local em Cytoscape com **modo workspace** (pinar, esconder, expandir vizinhos sob demanda, salvar e retomar uma vista curada) e painel de estilo por tipo de nó.
- **Dataview** (9,3 mil): campos inline `chave:: valor` e consultas que renderizam tabelas e listas de tarefas dentro de notas. Notas de memória com metadados viram widgets consultáveis.
- **Logseq** (44,7 mil): **journal diário como tela inicial**, blocos referenciáveis, flashcards. **SiYuan** (46 mil): links bidirecionais por bloco, bases de dados por atributo, **multi-aba com arrastar para dividir tela**, servidor MCP para o agente coeditar. **Trilium** (37,7 mil): **Relation Map** com relações tipadas desenhadas como grafo, histórico por nota. **Anytype** (8,7 mil): tudo é objeto com tipo e relações tipadas; **barra lateral de widgets** pináveis. **Foam** (17,4 mil): tags como nós, painel de órfãos, placeholders (links para notas que ainda não existem). **Dendron** (7,5 mil): hierarquias por ponto (`proj.agentos.memory`) e **lookup fuzzy que cria-ou-abre**.
- **Khoj** (37 mil): agentes com persona, conhecimento e ferramentas; **automações agendadas que entregam "newsletters pessoais"**.
- **Memória de agente**: **Mem0** (64,6 mil), três escopos (usuário, sessão, agente), retrieval multi-sinal (semântico + BM25 + entidade), dashboard de memória. **Letta** (24,6 mil): **blocos de memória** editáveis pelo agente e compartilháveis; **sleep-time agents** que refinam memória em idle; **Context Window Viewer** mostrando exatamente o que está no prompt agora. **Graphiti** (30,5 mil): grafo bitemporal, `valid_from/valid_to`, contradições **invalidam em vez de apagar**, toda aresta aponta para o episódio de origem. **Padrão Generative Agents** (Park et al.): score = recência (decaimento exponencial) × relevância × importância, e **reflexão** quando a importância acumulada cruza um limiar. **OpenClaw memory**: `USER.md`, `MEMORY.md` com orçamento de tokens no boot, `memory/AAAA-MM-DD.md` (hoje e ontem carregados automaticamente), **flush de memória antes da compactação**, e "dreaming" que promove notas diárias para a memória longa por frequência de recall.

### 3.2 Agent OS e painéis de agentes

- **OpenClaw** (388 mil). **Automations** com tipos `at | every | cron | on-exit | stream`, contexto de execução `main | isolated | sessão nomeada`, payload (evento de sistema, mensagem ao agente, comando shell, script), entrega `announce | webhook | none`. **Heartbeat**: turno periódico do sistema (30 min) com janela de horário ativo, `HEARTBEAT_OK` suprimido e alertas exibidos, checklist "scratch" por job, modelo barato e contexto leve. **openclaw-os** (322): o agente **transmite UI React gerada** (tabelas, formulários, dashboards) que persiste como "apps" editáveis por prompt.
- **Agent Zero** (19 mil): desktop XFCE que o agente opera, **snapshots com viagem no tempo** (diff do workspace + reverter), editor markdown colaborativo humano+agente, perfis de agente.
- **opcode** (ex-Claudia, 22,4 mil): biblioteca de agentes com system prompt próprio rodando em background, **linha do tempo de checkpoints ramificável com fork e diff entre checkpoints**, painel de uso filtrável por modelo/projeto/período, editor de `CLAUDE.md`.
- **claudecodeui** (13,6 mil): sessões, árvore de arquivos com edição, painel git (stage/commit/branch), shell embutido, PWA mobile, ferramentas desativadas por padrão com ativação individual.
- **claude-view** (104): cards de sessão ao vivo (última mensagem, modelo, custo, status), **medidor de preenchimento da janela de contexto + contagem regressiva do cache**, árvore de sub-agentes com custo por nó, vistas Grid/List/Kanban/Monitor, `⌘K`, sons de conclusão/erro/precisa-de-input.
- **claude-code-stats** (33) e **claude-monitor**: **replay da sessão como grafo de nós com partículas e scrubber play/pause**; detecção de anomalia de cache; atribuição de tokens por ferramenta.
- **CCSeva** (805) e **claude-usage** (2,2 mil): medidor na barra de menu, contagem regressiva do bloco de 5 h e do reset semanal, **burn rate**, alertas em 70 % e 90 %.
- **HumanLayer / CodeLayer** (11,4 mil): gramática de teclado estilo Superhuman (`⌘N` tarefa, `⌘K` pular para sessão, `⌘⇧A` abrir artefato, `⌘⏎` enviar, `⌘/` comentar seleção), portões de aprovação para bash/escrita, fork de sessão, artefatos versionados (planos, pesquisas) com comentários inline.
- **oh-my-claudecode** (39 mil): **statusline HUD** com métricas de orquestração, extração de skills a partir de sessões de debug, auto-resume em rate limit, notificações Telegram/Discord.
- **goose** (block/goose): receitas com parâmetros e sub-receitas, **agendador cron cujas execuções aparecem como sessões normais** com tag `schedule_id` e vista Schedules com inspecionar/matar. **Archon** (23 mil): workflows YAML em DAG, cada run num worktree, portões humanos, painel de runs via CLI/Slack/Telegram. **Cline** (67 mil): Plan/Act, toda edição como diff revisável, checkpoints, auto-approve. **LangGraph Studio**: rebobinar a qualquer checkpoint, editar estado, fork. **Codex CLI 0.149**: painel `codex agents` (buscar, iniciar, renomear, parar) e `codex queue` para enfileirar mensagem numa sessão em curso.
- **AIOS** (6,3 mil): metáfora de kernel (scheduler, gerente de contexto e memória, sistema de arquivos semântico com TUI, hub de agentes).

### 3.3 Desktops web, docks e dashboards

- **daedalOS** (13 mil): janelas com tamanho/posição/maximização persistidos, **miniaturas ao passar o mouse na taskbar**, wallpapers animados, animações de abrir/fechar.
- **win11React** (9,7 mil): **snap layouts**, painel lateral de widgets, central de notificações, flyout de calendário, tela de bloqueio e sequência de boot, tudo em CSS.
- **Puter** (43 mil): desktop completo com app store, KV store e SDK.
- **Dock com magnificação** (Magic UI, 22 mil; receita do BuildUI): `useMotionValue(mouseX)` → distância por ícone → `useTransform` → `useSpring({ mass: 0.1, stiffness: 150, damping: 12 })`.
- **cmdk** (12,9 mil): grupos, **páginas aninhadas**, estado de loading, aliases de palavras-chave, navegação em loop, milhares de itens.
- **Glance** (36,8 mil): páginas/colunas/grupos em YAML; widgets de RSS, releases, Docker, clima, mercado, **API custom + iframe + HTML**; **TTL de cache por widget** e colapsar após N. **Dashy** (26 mil): ping de status com tempo de resposta, **teclas 0-9 vinculadas a itens**, busca ao digitar, abrir em modal ou "workspace view" (sidebar + iframe). **Homarr** (4,6 mil): grade drag-and-drop com 40+ integrações e refresh por WebSocket.

---

## 4. Mapa de oportunidades

Cada item tem impacto (I), esforço (E) em dias de uma pessoa, e os arquivos a tocar. Ordem dentro de cada camada é a ordem sugerida.

### 4.1 Correções que mudam a percepção em horas

| # | Oportunidade | I | E | Onde |
|---|---|---|---|---|
| 1 | Corrigir o corpo do `SKILL.md` (classe própria `.skill-body`: mono, `--fs-2`, `pre-wrap`) | Alto | 0,1 | `views/Skills/SkillDetail.tsx:222`, `theme.css:1106` |
| 2 | Definir `--canvas-star`, `--canvas-particle`, `--canvas-line` em `:root` e no tema claro | Alto | 0,1 | `theme.css`, `desktop/Wallpaper.tsx:54-56` |
| 3 | Definir as oito classes órfãs (`.empty-state.compact`, `.ma-icon.ghost`, `.ma-name.dim`, `.orbit-chip.artifact/.file`, `.hud-label.accent`, `.modal-hint`, `.req`, `canvas.dimmed`) | Médio | 0,2 | `theme.css` |
| 4 | Estados `:active` para `.btn`, `.os-tool`, `.launcher-tile` (`scale(.97)`), `.m-dot`, `.deck-card` | Médio | 0,2 | `theme.css` |
| 5 | Saída animada em `Modal` e `ConfirmDialog` com o `usePresence` que o launcher já usa | Alto | 0,3 | `components/ui.tsx:204-223`, `theme.css:215-216` |
| 6 | Escopo do hover do wallpaper: só no núcleo e nos chips, não no wrapper `inset: 0` | Médio | 0,1 | `desktop/Wallpaper.tsx:347-352` |
| 7 | Tirar `linkSpring` das dependências do efeito da simulação; ajustar `force("link").strength()` e `alpha(0.3).restart()` no efeito de settings | Médio | 0,2 | `views/SecondBrain.tsx:847-864, 205-216` |
| 8 | Minimapa com `devicePixelRatio` e redesenho só quando algo mudou | Médio | 0,3 | `views/SecondBrain.tsx:770-803` |
| 9 | `pulse-glow` via `opacity`/`transform` num pseudo-elemento em vez de `box-shadow` | Baixo | 0,1 | `theme.css:801`, `SecondBrain.tsx:1006` |
| 10 | Ícones lucide no lugar dos glifos de texto; `Segmented` primitivo nos grupos crus do cérebro e do seletor de provider | Médio | 0,5 | `WidgetLayer.tsx`, `SecondBrain.tsx:1061-1073`, `desktop/index.tsx:163-178` |

### 4.2 Fluidez e motion (uma a duas semanas)

| # | Oportunidade | I | E | Onde |
|---|---|---|---|---|
| 11 | **Dirty flag e pausa no Segundo Cérebro**: rodar a 60 fps só com deslocamento (`maxDisplacement` já existe em `physics.ts:445`), tween de transform, efeitos ou cometas; 12 fps em repouso; parar em `visibilitychange`. Cachear `ringDefs` e `getBoundingClientRect` fora do frame | Alto | 1,5 | `views/SecondBrain.tsx:499-507, 805` |
| 12 | **Arrastar widgets com `transform: translate3d` em ref + rAF**, commit só no `pointerup`, FLIP de 200 ms nos vizinhos, célula alvo destacada, encaixe animado ao soltar | Alto | 2 | `desktop/useGridLayout.ts:515-542`, `WidgetLayer.tsx:267-270` |
| 13 | **Transições de rota com View Transitions API**: `document.startViewTransition` no `navigate`, `view-transition-name` no tile do launcher, no card do deck e no chip "Voltar ao OS"; fallback `.enter-fade` | Alto | 1,5 | `App.tsx` (`OsShell`), `theme.css` |
| 14 | Remover `backdrop-filter` de `.widget-inner`, `.now-panel`, `.os-chip`, `.edit-bar`; blur só em launcher e modais; superfícies com `color-mix` opaco | Médio | 0,5 | `theme.css:362, 999` |
| 15 | Tween numérico (300 ms, `tabular-nums`) em Pulso, contagem regressiva do "Agora" e contadores do Workspace | Médio | 0,5 | `desktop/widgets/PulseWidget.tsx`, `NowPanel.tsx`, `WorkspaceWidget.tsx` |
| 16 | Skeleton e barra de progresso no cérebro enquanto `graph === null` e durante `index.progress` | Médio | 0,5 | `views/SecondBrain.tsx:124-126`, `queries.ts:868` |
| 17 | Dock inferior com magnificação por mola (`useSpring`, massa 0,1, rigidez 150, amortecimento 12) para apps abertos recentemente e runs ativas, com miniatura ao hover | Médio | 2 | novo `desktop/Dock.tsx` |
| 18 | Estados de widget com transição de altura (hide/show, expandir "n more" no deck, chips de filtro) | Baixo | 0,5 | `WidgetLayer.tsx`, `DeckWidget.tsx` |

### 4.3 Desktop, widgets e ferramentas (duas a quatro semanas)

| # | Oportunidade | I | E | Onde |
|---|---|---|---|---|
| 19 | **Prompt bar no desktop** (widget e atalho `⌘K` → aba "Executar"): modo leitura/escrita, pasta, autocompletar `/skill`, `⌘Enter`. Reusa a mutação de `RunList.tsx:84-96` | Muito alto | 2 | novo `desktop/widgets/PromptWidget.tsx`, `defaultLayout.ts` |
| 20 | **Launcher vira paleta de comandos** (cmdk-like): ações (reindexar, backup, doctor, nova skill, alternar edição, trocar tema), arquivos via `/api/memory/search`, runs recentes, páginas aninhadas ("Executar skill →" escolhe modelo). `⌘K` como atalho principal, `⌘M` mantido | Muito alto | 3 | `App.tsx:313-454` |
| 21 | **Inbox de aprovações e notificações**: widget alimentado por `approval.requested`, `run.finished`, `routine.fired` com histórico limitado, não lidos e card inline aprovar/negar (mutação já existe em `Settings.tsx:340-349`); trocar os três redirecionamentos para Configurações | Muito alto | 2 | novo `desktop/widgets/InboxWidget.tsx`, `AttentionWidget.tsx`, `RunList.tsx:55-58`, `SkillDetail.tsx:47-51`, `desktop/index.tsx:88-90` |
| 22 | **Painel "Agora" nunca vazio**: cair para últimas execuções com resumo de uma linha, arquivos alterados nas últimas 24 h (índice já tem `mtime`), próximos disparos mesmo pausados com "Habilitar" inline | Alto | 1 | `desktop/NowPanel.tsx` |
| 23 | **Registro de widgets + galeria "Adicionar widget"** + configuração por widget (fusos, dias, limite de itens) persistida em `settings.dashboardLayout` | Alto | 3 | `desktop/index.tsx:103-111`, `defaultLayout.ts`, `Settings` |
| 24 | **Widgets declarativos** (JSON: fonte `api|file|command`, TTL, template, colapsar após N), inspirados no Glance, para que uma skill possa gerar um widget novo sem tocar em React; e widget "HTML" sandboxed em iframe para os que o agente gerar | Alto | 4 | novo `desktop/widgets/DeclarativeWidget.tsx`, `apps/api/src/routes/microapps.ts` |
| 25 | **Galeria de artefatos com busca**: thumbnails (PNG do Pixel Studio, primeira linha de `.md`, título de `.html`), filtros por skill/data/pasta, busca por texto; substitui os chips orbitais crípticos por um anel pesquisável como no vídeo | Alto | 2 | `desktop/Wallpaper.tsx` (chips), novo `views/Artifacts.tsx`, `apps/api/src/routes/system.ts` (`/api/artifacts/recent` com metadados) |
| 26 | **Agenda de rotinas** (timeline 24 h / 7 d a partir de `nextRunAt` e `nextCronRuns` em `views/cron.ts:117`), com coluna "onde roda" (local / serviço / VPS) e o rodapé de contagem por runner do vídeo | Médio | 1,5 | novo `desktop/widgets/AgendaWidget.tsx`, `views/Routines.tsx` |
| 27 | **Widgets Calendário e E-mail somente-leitura** por cima dos conectores já registrados (`connectors/calendar-google.json`, `email-gmail.json`): o core precisa de um consumidor de conector (MCP client em modo leitura, cache com TTL, sem escrita), e a UI mostra "hoje", "fusos", "sinalizados por Claude" como no vídeo. Sem conector configurado, o widget mostra o passo de configuração, não um placeholder | Muito alto | 5 | `core/src/connectors/` (novo `client.ts`), `apps/api/src/routes/connectors.ts`, dois widgets novos |
| 28 | **Micro-app Generations**: grade masonry de todas as imagens e vídeos em `artifacts/` (Pixel Studio já salva PNG), com lightbox e "copiar caminho" | Médio | 1,5 | novo `views/Generations.tsx`, `connectors/generations.json` |
| 29 | **Retematização por preset** (não só accent): famílias de superfícies e tipografia por perfil de cliente, exportáveis como JSON; a versão verde do vídeo é um preset | Médio | 1,5 | `theme.css` tokens, `views/Settings.tsx` |
| 30 | **Folha de atalhos `?`**, `⌘Enter` em SkillDetail/RunList, `Esc` fecha painéis do cérebro antes de sair, retorno de foco ao desktop, redo e `[`/`]` no Pixel Studio | Médio | 1 | `App.tsx`, `SkillDetail.tsx`, `SecondBrain.tsx`, `PixelStudio.tsx` |

### 4.4 Segundo Cérebro como navegação e diagnóstico (duas a quatro semanas)

| # | Oportunidade | I | E | Onde |
|---|---|---|---|---|
| 31 | **Manter todas as arestas com tipo, direção e `why`**; cor e traço por tipo; legenda por tipo; toggles por tipo no painel | Muito alto | 1 | `brain/engine/world.ts:232-235`, `SecondBrain.tsx:586-597` |
| 32 | **Hover realça vizinhos e esmaece o resto**; **modo Local** (N saltos do selecionado, slider 1-3) | Muito alto | 1,5 | `SecondBrain.tsx:913-926`, loop de desenho |
| 33 | **Painel de detalhe com backlinks e links de saída** (em vez de só o `why`), contagem de grau, "abrir no editor" e "copiar caminho" também no tooltip do canvas | Alto | 1 | `SecondBrain.tsx:1218-1240` |
| 34 | **Filtros por extensão, tag, data (`mtime`) e tamanho**, com grupos query → cor como no Obsidian; `tags` já está no modelo | Alto | 1,5 | painel do `SecondBrain.tsx`, `w.matched` |
| 35 | **Tamanho do nó por grau e recência** (`r = base + log(grau) + boost(mtime)`) com pré-cálculo de grau | Alto | 0,5 | `brain/engine/world.ts:228` |
| 36 | **Layout "Arcos"** (setores por área, arquivos em arcos concêntricos ordenados por pasta e data): a versão legível em dezenas de milhares de nós, como no vídeo | Alto | 1,5 | `brain/engine/layouts.ts` |
| 37 | **Estado na URL** (`selected`, `layout`, `view`, `filter`, `zoom`) e preferências do cérebro em `settings.brain` em vez de `localStorage`; permite linkar de um run para o arquivo que ele alterou | Alto | 1 | `SecondBrain.tsx` (`useSearchParams`) |
| 38 | **Arrastar e pinar nós** (`fx/fy` no d3 ou flag `pinned` ignorada por `stepWorld`); **modo workspace** salvável por projeto (Juggl) | Médio | 1,5 | `SecondBrain.tsx:892-898`, `physics.ts` |
| 39 | **Linha do tempo ("Animate")**: scrubber que reconstrói o grafo por `mtime`; o mesmo scrubber serve para replay de runs (cometas históricos) | Médio | 2 | `SecondBrain.tsx`, `brain/engine/world.ts` |
| 40 | **Órfãos e higiene**: painel com arquivos sem aresta, routers apontando para arquivo inexistente (`/api/memory/routers/check` já existe), skills nunca executadas, rotinas silenciosas, conectores não usados há N dias; é a "auditoria por densidade" do vídeo transformada em lista acionável | Alto | 1,5 | `SecondBrain.tsx` painel, `apps/api/src/routes/memory.ts` |
| 41 | **Arestas semânticas opcionais** (embeddings locais, spec 4.6 "search first, embeddings later"): "relacionados por conteúdo" como arestas fantasma e clusters coloridos por comunidade; predição de link como sugestão | Médio | 5 | `core/src/memory/` (novo `embeddings.ts`), `graph.ts` |
| 42 | **Retrieval por camadas exposto como skill** (`/recall`): keywords → score por routers e índices sem abrir arquivos → abrir só o melhor → seção → seguir ponteiro; medir tokens antes e depois e mostrar no painel de métricas. É o `brain.js` do vídeo, e é o que faz o cérebro valer os "70 %" | Muito alto | 3 | `core/src/memory/search.ts`, `routers.ts`, nova skill `skills/recall/` |
| 43 | Tema claro no cérebro: substituir as constantes `#10131a`, `#0b0a08`, `#fff8ee`, `rgba(0,0,0,.25)` por tokens; trackpad (`ctrlKey` → zoom, senão pan) e `touch-action: none` | Médio | 0,5 | `SecondBrain.tsx:740, 779, 878-891, 1336` |

### 4.5 Runs e agentes (duas a três semanas)

| # | Oportunidade | I | E | Onde |
|---|---|---|---|---|
| 44 | **Custo e tokens por run**: novo `RunEvent` `usage` (input, output, cache, custo); parse do `result` do `stream-json` do Claude e do JSON do Codex; coluna em `runs`; badge em `RunDetail`, coluna em `RunList`, **widget de custo** com bloco de 5 h, reset semanal e burn rate (CCSeva) | Muito alto | 2,5 | `core/src/agents/types.ts`, `adapters/*/src/index.ts`, `core/src/db/migrations.ts`, `runs/RunDetail.tsx:110-136` |
| 45 | **Arquivos alterados e diff** em `RunDetail`: renderizar `filesChanged`, preview via `/api/memory/preview`, diff por arquivo (git quando o cwd é repositório) | Muito alto | 2 | `runs/RunDetail.tsx`, `apps/api/src/routes/runs.ts` |
| 46 | **Re-executar, continuar com follow-up, copiar log, busca na timeline, timestamps absolutos no hover, timeline ocupando a viewport** | Alto | 1,5 | `runs/RunDetail.tsx`, `EventTimeline.tsx:42, 125-127` |
| 47 | **Indicador "rodando agora" nos cards do deck** e nos tiles do launcher, com link para o run | Alto | 0,5 | `desktop/widgets/DeckWidget.tsx` |
| 48 | **Replay de sessão** com scrubber (eventos já têm `ts`): timeline como grafo de nós ou como o próprio cérebro reproduzindo os arquivos tocados | Médio | 3 | novo `runs/Replay.tsx` |
| 49 | **Medidor de contexto** (Letta, claude-view): quanto do prompt de uma run é system, skills, memória, mensagens; exige que os adapters exponham `init`/`usage` por turno | Médio | 2 | `adapters/claude/src/index.ts:196`, `RunDetail.tsx` |
| 50 | **Rotinas com o modelo do OpenClaw**: `at | every | cron | on-exit`, sessão isolada ou principal, entrega `announce | webhook`, **heartbeat** com horário ativo e checklist; execuções aparecem como runs normais com tag da rotina (goose) | Alto | 3 | `core/src/routines/`, `views/Routines.tsx` |

### 4.6 Memória que aprende (apostas de médio prazo)

| # | Oportunidade | I | E | Onde |
|---|---|---|---|---|
| 51 | **Memória em markdown com notas diárias**: `memory/journal/AAAA-MM-DD.md` criado automaticamente, hoje e ontem injetados no router com orçamento de tokens; "journal de hoje" como estado padrão do painel "Agora" quando não há runs (Logseq, OpenClaw) | Alto | 2 | `core/src/memory/routers.ts`, `NowPanel.tsx` |
| 52 | **Rotina de consolidação ("sono")**: promove notas diárias para `MEMORY.md` por frequência de recall e escreve reflexões quando a importância acumulada cruza um limiar (Letta, Generative Agents); roda como rotina do sistema em `approved_automation` | Médio | 3 | nova rotina + skill |
| 53 | **Fatos bitemporais com proveniência**: `valid_from/valid_to` e link para o run de origem; contradições invalidam em vez de apagar (Graphiti). O cérebro mostra fatos expirados esmaecidos | Médio | 4 | `core/src/db/migrations.ts`, `core/src/memory/` |
| 54 | **Campos inline e consultas** (Dataview): `chave:: valor` em notas de memória, consultáveis como widget de tabela | Baixo | 3 | indexador + widget declarativo (item 24) |

---

## 5. Sequência recomendada

1. **Semana 1**: itens 1 a 10 (correções), 11 a 14 (motion estrutural). Percepção de qualidade muda antes de qualquer feature nova.
2. **Semanas 2 e 3**: 19, 20, 21, 22 (o centro do desktop passa a comandar), 44, 45, 47 (custo, diff, indicador de execução).
3. **Semanas 4 e 5**: 31 a 37 e 40 (o cérebro vira navegação e diagnóstico), 25 e 26 (artefatos e agenda).
4. **Semanas 6 a 8**: 27 (calendário e e-mail em leitura), 23 e 24 (widgets extensíveis e declarativos), 42 (retrieval por camadas), 50 (rotinas com heartbeat).
5. **Depois**: 39, 41, 48, 49, 51 a 54.

Critério de "pronto" para cada bloco: captura de tela nas mesmas rotas de `docs/audit-2026-09/img-after/`, baseline Playwright atualizada, e uma medição de fps no desktop e no cérebro em repouso (meta: ≤ 12 fps em repouso, 60 fps só durante interação).

---

## 6. Fontes

- Vídeo analisado: https://www.youtube.com/watch?v=8NSyI-npJCU (transcrição integral, thumbnail, storyboard). Vídeo complementar: https://www.youtube.com/watch?v=VoKiKvgpk78. Post: https://robonuggets.beehiiv.com/p/the-new-agentic-os-format-for-claude-5-models. Produto: https://www.getrubric.app/. Curso (índice de módulos do "Command Centre"): https://robonuggets-agentic-ai-foundations.vercel.app/.
- Grafos e PKM: https://github.com/obsidianmd/obsidian-help/blob/master/en/Plugins/Graph%20view.md · https://github.com/obsidianmd/jsoncanvas · https://github.com/brianpetro/obsidian-smart-connections · https://github.com/SkepticMystic/graph-analysis · https://github.com/HEmile/juggl · https://github.com/blacksmithgu/obsidian-dataview · https://github.com/logseq/logseq · https://github.com/siyuan-note/siyuan · https://github.com/TriliumNext/Trilium · https://github.com/anyproto/anytype-ts · https://github.com/foambubble/foam · https://github.com/dendronhq/dendron · https://github.com/khoj-ai/khoj
- Memória: https://github.com/mem0ai/mem0 · https://github.com/letta-ai/letta · https://docs.letta.com/guides/agents/architectures/sleeptime/ · https://docs.letta.com/guides/ade/context-window-viewer/ · https://github.com/getzep/graphiti · https://arxiv.org/pdf/2304.03442 · https://docs.openclaw.ai/concepts/memory
- Agent OS e painéis: https://github.com/openclaw/openclaw · https://docs.openclaw.ai/automation/cron-jobs · https://docs.openclaw.ai/gateway/heartbeat · https://github.com/thesysdev/openclaw-os · https://github.com/agent0ai/agent-zero · https://github.com/winfunc/opcode · https://github.com/siteboon/claudecodeui · https://github.com/tombelieber/claude-view · https://github.com/AeternaLabsHQ/claude-code-stats · https://github.com/Iamshankhadeep/ccseva · https://github.com/humanlayer/humanlayer · https://github.com/Yeachan-Heo/oh-my-claudecode · https://github.com/block/goose · https://github.com/coleam00/Archon · https://github.com/cline/cline · https://docs.langchain.com/oss/python/langgraph/use-time-travel · https://github.com/agiresearch/AIOS
- Desktops e dashboards: https://github.com/DustinBrett/daedalOS · https://github.com/blueedgetechno/win11React · https://github.com/HeyPuter/puter · https://github.com/magicuidesign/magicui · https://buildui.com/recipes/magnified-dock · https://github.com/pacocoursey/cmdk · https://github.com/glanceapp/glance · https://github.com/Lissy93/dashy · https://github.com/homarr-labs/homarr
