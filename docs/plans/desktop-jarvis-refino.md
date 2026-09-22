# Desktop JARVIS — refino profundo em 60 itens

Rascunho 1 · 21/09/2026 · Sucessor de [`desktop-agentico-redesign.md`](desktop-agentico-redesign.md) e [`desktop-v3-ajuste.md`](desktop-v3-ajuste.md) (G1–G6 concluídos). Alvo: `apps/command-centre/src/desktop/**`, `src/brain/**`, `src/views/**`, `src/runs/**`, `src/components/**`, com pontos de contato em `apps/api/src/routes/**` e `core/src/**` onde um item precisa de dado que a API ainda não entrega.

Base da análise: sete capturas de uma sessão real (21/09, 21:41–21:45), o código do desktop e a superfície da API. Cada item cita a evidência, o que muda, o critério de aceite e a âncora no código.

---

## 1. Diagnóstico raiz

O sistema já tem os órgãos de um JARVIS e ainda se comporta como um dashboard com janelas soltas. Quatro causas produzem quase tudo que aparece nas capturas:

| # | Causa | Evidência | Onde nasce |
|---|-------|-----------|------------|
| R1 | **O agente é invisível.** Não há thread, resposta em streaming, narração nem corpo que mude de estado. O console dispara e entrega o resultado a um painel. | Captura 1: o run abre como painel e a única voz do agente é "CLAUDE pronto" na faixa. | `desktop/console/Console.tsx` (o thread fica "dobrado atrás do readout de turnos"), `desktop/AgentPresence.tsx` (um `div` sem canvas, sem conteúdo). |
| R2 | **Camadas sem regra.** Painéis translúcidos sobre painéis mostram texto atrás de texto. | Captura 1: Agora vaza pelo Run. Captura 7: rótulos ROTINAS / APLICAÇÕES / MEMÓRIA do cérebro atravessam Conectores. | `desktop/desktop.css` (`.panel` com fundo translúcido), `windowModel.ts` só ordena `z`, não escurece nem desfoca quem está atrás. |
| R3 | **Corte ainda é o mecanismo de adaptação.** | "US$ 0,", "QUEIMA POR HO", "SEGURAN", "PADR", "CLAUDE-MOBILE-…". | `desktop/widgetSize.ts` (tiers de altura), `views/Settings.tsx` (abas em linha), `desktop/SkillDeck.tsx` (nome truncado por CSS). |
| R4 | **Sinal sem calibração.** Atenção 20 em vermelho permanente, 30 não lidas das quais sete são "Configurações salvas", falha de cinco dias com o mesmo peso de uma de agora. | Capturas 1 e 2. | `core/src/notifications/recorder.ts` (grava "system" para todo save), `desktop/signal.ts` (`attentionSignal(count)` não decai por idade). |

E uma quinta, invisível nas capturas: **o backend sabe muito mais do que o desktop mostra.** Objetivos (`core/src/objectives`), sentinelas (`core/src/sentinels`: triagem, falha repetida, rotina silenciosa, delta de conectores, watch de pastas), fatos de memória e recall (`core/src/memory/facts.ts`, `recall.ts`, `journal.ts`), canais (Telegram, web push), pareamento de dispositivos, replay e diff de runs. Tudo isso existe na API e quase nada tem lugar no palco. Os itens 31–60 são, em grande parte, dar rosto a isso.

---

## 2. Princípios (somam aos sete do redesenho)

8. **O agente fala primeiro.** Toda tela responde "o que o agente acha disso" antes de "o que os dados dizem".
9. **Transparência é confiança.** O que ele lembrou, planejou, gastou e por que decidiu aparece sem pedir.
10. **Corte é bug.** Um componente que não cabe troca de forma, não de recorte. Testável.
11. **Uma entrada.** Texto, `@`, `/`, `>` e voz no mesmo campo. Nada de três lançadores.
12. **Sinal tem meia-vida.** Idade e resolução rebaixam o nível. Vermelho só para o que só você pode resolver.
13. **Primitivas antes de telas.** Nenhum item entra com CSS ad hoc; entra com Panel, Metric, Chip, Field, Card, Timeline.

---

## 3. Os 60 itens

Formato de cada item: **o quê** · evidência · aceite · âncora.

### A. O agente como presença (1–9)

**1. Console vira conversa.** Thread persistente no palco, resposta do agente em streaming, cada coisa citada vira chip que abre o painel. · O `Console.tsx` documenta que "o thread é a história, o trace é a resposta"; na prática o usuário nunca vê o agente responder. · Aceite: enviar um prompt mostra a resposta chegando por token no próprio console; um `run:` citado abre ao clicar; a thread sobrevive a recarregar (já há `SESSION_KEY`). · `desktop/console/ConsoleThread.tsx`, `runs/useRunStream.ts`.

**2. Núcleo vivo com estado real.** O campo de pontos vira o corpo do agente: partículas são eventos reais de runs, o pulso segue `CoreState` (ouvindo, pensando, ferramenta, respondendo, aguardando, alerta). · `LivingField.tsx` já desenha "um ponto por coisa que o OS conhece" mas não reage a eventos; `AgentPresence` é um `div` vazio. · Aceite: cada `tool_use` de um run vivo produz um pulso visível no campo; os 11 estados de `coreState.ts` têm assinatura visual distinta e testada em `data-core`. · `desktop/LivingField.tsx`, `desktop/AgentPresence.tsx`, `desktop/coreState.ts`.

**3. Voz nos dois sentidos.** Modo mãos livres: wake word opcional, transcrição ao vivo no console, resposta falada curta por padrão. · Push-to-talk existe (`LISTENING_EVENT`), síntese existe em `hooks/systemNotify.ts`, nada os liga. · Aceite: com o modo ligado, a última resposta do agente é falada em até 2 s; o texto falado é o resumo de uma frase, não o trace. · `desktop/console/Console.tsx`, `hooks/systemNotify.ts`.

**4. Briefing proativo ao abrir.** Três linhas ao iniciar o dia: o que rodou, o que falhou, o que precisa de você. Substitui "Próximo passo" e zera as não lidas. · Captura 2: 30 não lidas; captura 1: cartão estático. · Aceite: primeira abertura do dia mostra o briefing gerado do `journal` e das notificações não lidas; ao fechar, tudo é marcado como lido. · `desktop/NowPanel.tsx`, `desktop/nextStep.ts`, `GET /api/memory/journal`, `GET /api/notifications`.

**5. Aprovação como diálogo junto ao núcleo.** Cartão flutuante ao lado do core com diff em uma frase, Aprovar, Recusar, Perguntar, atalho. · Captura 7: "aguardando aprovação" só na faixa; o cartão vive dentro de um painel. · Aceite: uma aprovação pendente aparece em até 500 ms sem abrir painel; `⌘⇧A` aprova a primeira; recusar pede motivo em uma linha que vai para o run. · `desktop/widgets/ApprovalsWidget.tsx`, `runs/ApprovalCards.tsx`, `POST /api/approvals/:id/resolve`.

**6. Plano ao vivo.** Tarefa com mais de um passo mostra checklist que se marca conforme executa, passo atual em destaque, custo estimado. · Objetivos existem em `core/src/objectives` com `steps` e `retry`; não aparecem no palco. · Aceite: dispatch de um objetivo cria um painel "missão" com passos, estado por passo e link para o run de cada um. · `views/`, `GET /api/objectives/:id`, `POST /api/objectives/:id/dispatch`.

**7. Skills por intenção, deck como atalho.** Digitar o que quer sugere a skill e preenche inputs; o deck ganha nome completo, descrição, última execução e busca. · Captura 5: nomes truncados, centro vazio, "+6 OUTRAS". · Aceite: nenhum nome truncado em 1280 px; digitar "revisa esse PR" ranqueia `code-review` no topo; o centro do deck mostra descrição da skill focada. · `desktop/SkillDeck.tsx`, `desktop/console/refs.ts` (`skillSuggestions`).

**8. Memória com rosto.** O agente diz o que lembrou e de onde, com chips que abrem no cérebro; ao aprender uma preferência, avisa em uma linha com "desfazer". · `GET /api/memory/recall` e `recall/stats` existem; o desktop não os mostra. · Aceite: todo run com recall exibe "lembrei de N arquivos" expansível; um fato novo aparece como toast com retract em um clique. · `runs/RunDetail.tsx`, `POST /api/memory/facts/:id/retract`.

**9. Um único campo de comando.** Texto fala com o agente, `@` painel, `/` skill, `>` comando do sistema, voz. Paleta e deck viram modos do mesmo campo. · `components/CommandPalette.tsx`, `SkillDeck.tsx` e o console são três entradas. · Aceite: `⌘K` foca o console; `>` lista os comandos da paleta atual; o placeholder cabe em uma linha em 1280 px. · `desktop/console/Console.tsx`, `components/CommandPalette.tsx`, `components/paletteMatch.ts`.

### B. Palco, janelas e legibilidade (10–19)

**10. Fim do texto atrás de texto.** Painel ativo opaco; os demais recebem véu e desfoque de fundo. Transparência só no chrome. · Capturas 1 e 7. · Aceite: teste visual com dois painéis sobrepostos: contraste do texto do painel ativo ≥ 4.5:1 medido sobre o fundo real. · `desktop/desktop.css` (`.panel`, `.desktop-depth`).

**11. Janelas com regras.** Tiling automático em 1–3 colunas, snap por arrasto, modo foco que empurra os outros para as laterais com escala. · `windowModel.ts` já tem `tile`, `snapEdgeAt`, `overviewSlots`; nada disso é o padrão ao abrir. · Aceite: abrir o terceiro painel reflui os três em colunas sem sobreposição; arrastar até a borda mostra o alvo do snap antes de soltar. · `desktop/windowModel.ts`, `desktop/useWindowLayout.ts`, `desktop/useWindowDrag.ts`.

**12. Expandir é outra composição.** Execuções: lista com colunas quando larga, cartões quando estreita; o formulário "Executar um prompt" sai do painel. · Captura 3: descrição, formulário e lista empilhados com 60 % de vazio. · Aceite: painel Execuções não contém campo de prompt; em 900 px de largura mostra colunas status, nome, custo, duração. · `runs/RunList.tsx`, `runs/index.tsx`.

**13. Duas famílias, cinco tamanhos.** Caps espaçadas só para eyebrow; display só para valores; sans para texto. · Três famílias e caps por toda parte (`desktop.css` alterna `--font-mono` e `--font-display` 20 vezes). · Aceite: escala tipográfica em `theme.css` com 5 tokens; lint que falha para `font-size` literal fora dos tokens. · `theme.css`, `desktop/desktop.css`, `components/workspace.css`.

**14. Ficha de run, não sopa de pills.** Linha 1 nome e status; linha 2 provedor, modelo, esforço em texto; linha 3 custo, tokens, duração como métricas com unidade. · Captura 1: nove chips do mesmo peso. · Aceite: cabeçalho do run tem no máximo 2 chips clicáveis; tokens mostram ↑ ↓ com rótulo. · `desktop/RunPanel.tsx`, `runs/RunDetail.tsx`.

**15. Corte é bug, com mecanismo.** Cada widget declara três formas: completa, compacta, sinal. · Captura 1: "US$ 0,", "QUEIMA POR HO". · Aceite: teste que renderiza cada widget em 3 larguras e falha se `scrollWidth > clientWidth` em qualquer texto. · `desktop/widgetSize.ts`, `desktop/widgets/*.tsx`, `desktop/WidgetLayer.surface.test.tsx`.

**16. Tamanho certo na abertura.** Largura mínima por tipo de painel; grid de 8 px; gutters únicos. · Captura 4: Configurações estreita cortou abas. · Aceite: `panelKinds.ts` expõe `preferredSize(kind, contentHint)`; nenhum painel abre menor que o mínimo do seu tipo. · `desktop/panelKinds.ts`, `desktop/surfaceSize.ts`, `desktop/windowModel.ts` (`placeNew`).

**17. Configurações por pergunta.** Navegação vertical com busca: quem é você, quanto pode gastar, onde pode escrever, como avisar. Auto-save silencioso. · Captura 4: sete abas cortadas; captura 2: sete "Configurações salvas". · Aceite: nenhuma notificação por save; busca acha "orçamento" e "budget"; `Settings.tsx` (1 666 linhas) dividido por seção. · `views/Settings.tsx`, `views/SettingsFields.tsx`, `core/src/notifications/recorder.ts`.

**18. Movimento com origem.** Painel abre do chip ou pod que o chamou e fecha de volta; runs voam do console ao palco; 200–300 ms; zero em `prefers-reduced-motion`. · Hoje painéis surgem no lugar. · Aceite: toda abertura tem origem espacial registrada (`openFrom: DOMRect`); nenhuma animação além de transform e opacity. · `desktop/Panel.tsx`, `desktop/actions.tsx`.

**19. Cor com papel.** Âmbar é sistema, ciano é agente, verde é ok, vermelho é "precisa de você". Tema claro desenhado. · Tudo âmbar; o agente não tem cor. · Aceite: tokens `--agent`, `--ok`, `--attention` em `theme.css`; a resposta do agente, o core e os chips de recall usam `--agent`. · `theme.css`.

### C. Instrumentos, cérebro, notificações e acabamento (20–30)

**20. Notificações com triagem.** Agrupar por tipo, colapsar repetidas, separar informativo de "precisa de você", ações inline. · Captura 2. · Aceite: 7 saves consecutivos viram 1 linha ou nenhuma; a lista tem duas seções; cada item tem ao menos uma ação. · `core/src/notifications/store.ts`, `desktop/AmbientStrip.tsx`.

**21. Atenção que decai.** Falhas antigas pesam menos; itens têm re-executar, silenciar, trace; resolvido some. · Captura 3: falhas de 5 dias com o mesmo peso. · Aceite: `attentionSignal` recebe idades e retorna `warn` para >24 h; badge vermelho só com item que exige humano. · `desktop/signal.ts`, `desktop/widgets/AttentionWidget.tsx`.

**22. Pods com identidade.** Rótulo ao aproximar do arco, ícone mais micro-valor mais cor; pods sem sinal apagados em foco. · Captura 1: hexágonos com "14", "20 %", "1/1" sem nome. · Aceite: `.pod-arc.near` mostra rótulos; pod idle tem opacidade ≤ 0.5. · `desktop/DesktopPods.tsx`, `desktop.css` (`.pod-arc.near`).

**23. Faixa ambiente como HUD.** Custo, runs, atenção e hora como micro-instrumentos com sparkline 24 h e tendência. · Hoje texto. · Aceite: cada leitura tem sparkline de `GET /api/metrics/history`; clique abre o painel. · `desktop/AmbientStrip.tsx`, `runs/sparkline.ts`.

**24. Preview do cérebro renderizado.** Markdown real, sem comentários HTML, com ações do agente: resumir, relacionados, usar no console. · Captura 6. · Aceite: `<!-- -->` nunca aparece; tabelas viram tabelas; três ações presentes. · `brain/PreviewPanel.tsx`, `brain/markdown.ts`, `GET /api/memory/preview`.

**25. Grafo legível.** Rótulos sem colisão, LOD por zoom, halos por área, forma por tipo, busca que voa. · Captura 6: "/code review" sob o nó. · Aceite: teste de colisão de rótulos em 3 zooms; busca centraliza o nó em ≤ 600 ms. · `brain/BrainCanvas.tsx`, `brain/render/**`, `brain/engine/flight.ts`.

**26. Controles do cérebro em uma barra.** Quatro visíveis: layout, visão, filtro, busca; avançado recolhido. · Doze grupos na captura 6. · Aceite: barra flutuante de uma linha; painel avançado fechado por padrão e lembrado. · `brain/BrainChrome.tsx`, `brain/usePanelPreference.ts`.

**27. Cérebro embutido com clipping.** Modo mini com câmera e busca; nenhum rótulo vazando. · Captura 7. · Aceite: `overflow: hidden` no painel e rótulos de área dentro do canvas, não em DOM absoluto. · `views/SecondBrain.tsx`, `desktop/AppPanel.tsx`.

**28. Conectores como fluxo guiado.** Assistente de três passos conduzido pelo agente, teste ao final, estado vivo. · Captura 7: cards "NÃO CONFIGURADO" com riscos e texto em inglês. · Aceite: configurar um MCP sem sair do painel; card configurado mostra "última leitura há N min". · `views/Connectors.tsx`, `GET /api/connectors/:id/setup`.

**29. Rotinas em linha do tempo.** Timeline 24 h / 7 d, edição por arrasto, card de diagnóstico para falha repetida. · Captura 7: lista; "Nightly memory consolidation" falha há 4 dias. · Aceite: timeline com rodadas passadas e futuras; falha repetida traz "por quê" do sentinela e botão corrigir. · `views/Routines.tsx`, `views/cron.ts`, `core/src/sentinels/repeatedFailure.ts`.

**30. Acabamento que produtiza.** i18n completo, plural, unidades, tooltips, foco visível, teclado, estados vazios com ação. · "nothing running" em `signal.ts:100`, "1 turnos", "6.7 S", "trace". · Aceite: lint que falha para string literal fora de `i18n.ts` nos diretórios do desktop; zero strings em inglês com locale pt-BR. · `i18n.ts`, `desktop/signal.ts`, `runs/`.

### D. Inteligência visível (31–46)

**31. Missão no palco.** Objetivo → passos → runs como painel `objective:<id>`, com anel de progresso no core. · `objectiveStore.ts` com dispatch e retry por passo, sem UI. · Aceite: novo `PanelKind` "objective"; retry de passo direto do painel; o core mostra progresso enquanto a missão roda. · `desktop/panelKinds.ts`, `apps/api/src/routes/objectives.ts`.

**32. Sentinelas com rosto.** Painel "o que estou vigiando": triagem, falha repetida, rotina silenciosa, delta de conectores, watch de pastas, cada um com último check e próximo. · `core/src/sentinels/*` gera notificações sem dizer de onde vêm. · Aceite: toda notificação de sentinela carrega `source` e "por quê"; o painel lista os cinco com estado. · `core/src/sentinels/runner.ts`, `core/src/notifications/recorder.ts`, novo `desktop/widgets/SentinelsWidget.tsx`.

**33. O que sei sobre você.** Painel de fatos curáveis: o agente propõe fatos após runs, você confirma ou retira inline. · `GET/POST /api/memory/facts`, `retract` existem; nenhuma tela. · Aceite: fato novo aparece com origem (run) e botão retirar; lista filtra por área. · `core/src/memory/facts.ts`, `apps/api/src/routes/memory.ts`.

**34. Recall com prova.** No run: "lembrei de X, Y" com relevância e link, e estatísticas de acerto. · `GET /api/memory/recall/stats`. · Aceite: seção recall em `RunDetail` com N itens e score; stats no painel de memória. · `runs/RunDetail.tsx`, `core/src/memory/recall.ts`.

**35. Diário do agente.** Painel "hoje" narrado a partir do journal; a rotina de digest escreve nele. · `GET /api/memory/journal`, `POST journal/append`. · Aceite: cada run concluído gera uma entrada de uma linha; o briefing (item 4) lê daqui. · `core/src/memory/journal.ts`, `routines/daily-workspace-digest.json`.

**36. Trace em linguagem humana.** Eventos viram frases: "li 3 arquivos", "editei `x.ts`", "pedi aprovação"; JSON cru só sob "detalhes". · `runs/EventTimeline.tsx` mostra eventos brutos. · Aceite: 100 % dos tipos em `logText.ts` têm frase pt-BR; JSON colapsado por padrão. · `runs/logText.ts`, `runs/EventTimeline.tsx`.

**37. Replay com scrub.** Linha do tempo arrastável no run, "pular para o erro", velocidade. · `runs/Replay.tsx` e `replayEngine.ts` existem, sem scrub. · Aceite: arrastar o cursor reconstrói o estado; botão "erro" salta ao primeiro evento com falha. · `runs/Replay.tsx`, `runs/replayEngine.ts`.

**38. Diff no cartão de aprovação.** Perfil "revisão antes de escrever" mostra o diff por arquivo com aceitar parcial. · `GET /api/runs/:id/diff` e `runs/diff.ts` existem; a aprovação é texto. · Aceite: cartão lista arquivos; expandir mostra diff; aceitar 2 de 3 arquivos é possível. · `runs/ApprovalCards.tsx`, `runs/FilesChanged.tsx`.

**39. Custo preditivo.** Antes de rodar: "≈ US$ 0,10 e 40 s" a partir de runs parecidos; barra de orçamento do dia no console; bloqueio explicado a 100 %. · `desktop/budget.ts`, `GET /api/metrics/history`. · Aceite: estimativa para skills com ≥ 3 execuções; console mostra restante do dia; a 100 % o botão explica e oferece elevar. · `desktop/budget.ts`, `desktop/console/ConsoleControls.tsx`.

**40. Inputs de skill como conversa.** O agente pede os inputs que faltam na thread, pré-preenchidos de fatos; roda quando completo. · `desktop/SkillInputsPanel.tsx` é um formulário. · Aceite: skill com input obrigatório vazio gera pergunta no console; resposta preenche e dispara. · `desktop/SkillInputsPanel.tsx`, `desktop/promptSubmission.ts`.

**41. Skill a partir de repetição.** "Tarefa recorrente — transformar em skill?" vira fluxo: rascunho de SKILL.md dos prompts repetidos, preview, salvar e agendar em um clique. · Captura 2: a notificação existe (sentinela de triagem) e leva a lugar nenhum. · Aceite: aceitar a notificação abre o rascunho; salvar cria a skill em `skills/`; opcionalmente cria rotina. · `core/src/sentinels/triage.ts`, `views/Skills/**`, `POST /api/skills`.

**42. Rotina por linguagem natural.** "Toda segunda às 8" vira cron; o agente propõe rotina após runs repetidos. · `views/cron.ts` parseia; a proposta não existe. · Aceite: campo de agenda aceita frase pt-BR e mostra o cron resultante; sentinela `silentRoutine` sugere reativar com um clique. · `views/cron.ts`, `core/src/sentinels/silentRoutine.ts`.

**43. Falha com causa e conserto.** Erro em linguagem clara, causa provável, botão de correção (reconectar provedor, elevar orçamento, reindexar). · Captura 3: "authentication" há 5 dias; `runs/authRecovery.ts` sabe recuperar. · Aceite: toda falha tem `cause` classificada e ao menos uma ação; falha de auth oferece login em um clique. · `runs/authRecovery.ts`, `runs/status.ts`, `components/providerReadiness.ts`.

**44. Provedor vivo no console.** Chip do provedor mostra login, modelo, limite de taxa; "auto" explica o roteamento. · `ModelEffortPopover.tsx` escolhe; não informa estado. · Aceite: chip vermelho antes de tentar rodar com provedor deslogado; tooltip explica "auto → claude por custo". · `desktop/ModelEffortPopover.tsx`, `components/ProviderGate.tsx`.

**45. Artefatos anexados à resposta.** Saídas de run aparecem como cartões com preview na thread: abrir, enviar por Telegram, fixar no HUD. · `GET /api/artifacts/recent`, `desktop/DocWindow.tsx`. · Aceite: run com artefato mostra o cartão em ≤ 1 s após concluir; fixar adiciona ao HUD. · `desktop/console/ConsoleThread.tsx`, `desktop/hud.ts`.

**46. Squad visível.** Runs filhos orbitam o run pai no campo vivo; paralelismo legível. · `GET /api/runs/:id/children`, `runs/Squad.tsx`. · Aceite: run com filhos mostra N satélites no campo; clicar abre o filho. · `desktop/LivingField.tsx`, `runs/Squad.tsx`.

### E. Espaço, comando e ritmo (47–55)

**47. HUD generativo.** "Organize minha tela para revisar código" faz o agente compor o layout com os painéis do catálogo. · `hud.ts` tem catálogo; `windowModel.tile` existe. · Aceite: comando `>organizar <intenção>` retorna um layout válido (`normalizeHud`) aplicado com animação. · `desktop/hud.ts`, `desktop/defaultLayout.ts`.

**48. Espaços com intenção.** Cada espaço guarda layout, sessão do console, provedor e perfil de segurança; trocar de espaço troca o contexto do agente. · `spaces.ts` guarda só layout. · Aceite: `Space` ganha `sessionId`, `provider`, `policy`; a faixa mostra o espaço ativo. · `desktop/spaces.ts`, `desktop/console/Console.tsx`.

**49. Sessões como conversas.** Lista de conversas, retomar, título gerado pelo agente, painéis que estavam abertos. · `GET /api/sessions`, `brain/navigationSnapshot.ts`. · Aceite: retomar restaura thread e painéis; título é um resumo de ≤ 6 palavras. · `apps/api/src/routes/sessions.ts`, `desktop/console/ConsoleThread.tsx`.

**50. Teclado primeiro.** `⌘K` campo, `⌘1–6` espaços, `⌘⇧A` aprovar, `Esc` fecha o topo, setas movem foco entre painéis, `?` overlay. · `components/ShortcutsHelp.tsx` existe; cobertura parcial. · Aceite: cenário de teste completo sem mouse: abrir skill, rodar, aprovar, abrir artefato, fechar. · `components/ShortcutsHelp.tsx`, `desktop/index.tsx`.

**51. Modo cinema.** Um painel mais console; o resto escurecido; entrada automática opcional enquanto um run transmite. · Só há overview e stage. · Aceite: `F` alterna; ao entrar, o painel ativo ocupa o palco com margem e o console permanece. · `desktop/desktopModes.ts`, `desktop/windowModel.ts` (`overviewSlots`).

**52. Busca única.** `⌘F` acha runs, arquivos, skills, notificações e fatos, agrupados; "voar até" no cérebro. · `desktop/ArtifactSearch.tsx`, `GET /api/memory/search`. · Aceite: uma consulta retorna 5 grupos; Enter abre; `⌥Enter` voa no cérebro. · `desktop/ArtifactSearch.tsx`, `brain/engine/flight.ts`.

**53. Ritmo do dia.** Horário silencioso, tema noturno mais escuro, briefing de manhã, "boa noite, deixei 2 rotinas agendadas" ao fim. · Nada sabe que horas são além do relógio. · Aceite: `quietHours` nas configurações; nenhuma voz ou som fora do horário; a faixa muda de tom após o pôr do sol. · `views/Settings.tsx`, `hooks/systemNotify.ts`.

**54. Som com significado.** Três tons: precisa de você, concluído, falhou. Desligado no silencioso. · Não há áudio. · Aceite: sons ≤ 400 ms, distintos entre si, com toggle e respeito a `quietHours`. · `hooks/systemNotify.ts`.

**55. Perfil econômico explícito.** Sem canvas, sem desfoque, sem partículas; automático na bateria. · `LivingField` menciona "economy profile" sem controle visível. · Aceite: toggle nas configurações; detecção de bateria via `navigator.getBattery` quando disponível. · `desktop/LivingField.tsx`, `views/Settings.tsx`.

### F. Extensão e saúde (56–60)

**56. Telegram como braço do JARVIS.** Parear, receber briefing e aprovar pelo Telegram; estado do canal na faixa. · `core/src/channels/telegram.ts` e `telegramInbound.ts`, `POST /api/channels/telegram/test`. · Aceite: aprovação respondida no Telegram fecha o cartão no desktop em ≤ 2 s. · `views/Settings.tsx`, `core/src/channels/**`.

**57. Companheiro móvel.** QR de pareamento, presença do dispositivo, aprovação e voz pelo celular. · `GET /api/devices`, `POST /api/pair/claim`. · Aceite: pareamento em ≤ 30 s; chip do dispositivo na faixa; aprovação pelo celular funciona. · `apps/api/src/routes/devices.ts`, `views/Settings.tsx`.

**58. Saúde e atualização em um pod.** Pod "sistema" com diagnóstico, correções de um clique e atualização disponível. · `GET /api/doctor`, `/api/updates`, `ServiceHealthBanner`. Memória do projeto: serviço fica com build velho após rebuild. · Aceite: pod acende quando `doctor` reporta problema; "reiniciar serviço" e "atualizar" funcionam de dentro do app. · `apps/api/src/doctor.ts`, `apps/api/src/updates.ts`, `components/ServiceHealthBanner.tsx`.

**59. Primeiros dez minutos guiados.** O agente conduz por voz e texto: provedor, pasta, primeira skill, primeira rotina; executa o que puder sozinho. · `onboarding/`, `FirstRunHint.tsx`, `GET /api/startup-plan`. · Aceite: usuário novo chega ao primeiro run concluído em ≤ 10 min sem abrir Configurações; anel de progresso no core. · `onboarding/**`, `desktop/nextStep.ts`.

**60. Sistema de design e galeria.** Tokens (tipo, espaço, cor de estado), primitivas (Panel, Metric, Chip, Field, Card, Timeline), galeria viva, testes visuais. · `gallery/`, `components/primitives.tsx`, `ui.tsx`. · Aceite: todos os 59 itens acima usam primitivas; PR que adiciona CSS fora dos tokens falha no lint; galeria renderiza cada primitiva em 3 larguras e 2 temas. · `components/primitives.tsx`, `gallery/**`, `theme.css`.

---

## 4. Ondas

Cada onda tem critério de saída; a próxima só começa quando o anterior fecha. Item 60 é transversal e começa na Onda 0.

| Onda | Nome | Itens | Saída |
|------|------|-------|-------|
| 0 | **Higiene** | 10, 13, 15, 16, 30, 20, 21, 22, 60 (tokens e primitivas) | Nenhum texto cortado nas 7 capturas refeitas; nenhuma string em inglês em pt-BR; badge vermelho só com item humano; teste de overflow verde. |
| 1 | **Presença** | 1, 2, 9, 5, 38, 36, 3, 4, 19 | Um prompt produz resposta em streaming no console, o core reage a cada evento, aprovação aparece sem abrir painel, briefing na primeira abertura. |
| 2 | **Palco** | 11, 12, 14, 17, 18, 23, 50, 51, 47, 48, 49 | Três painéis abrem sem sobreposição; tudo opera por teclado; espaço guarda sessão. |
| 3 | **Inteligência visível** | 6, 7, 8, 31, 32, 33, 34, 35, 39, 40, 41, 42, 43, 44, 45, 46 | Missão, sentinelas, fatos, recall e diário têm painel; toda falha tem ação; skill nasce de repetição. |
| 4 | **Cérebro e conectores** | 24, 25, 26, 27, 28, 29, 37, 52 | Preview renderizado; rótulos sem colisão; conector configurado sem sair do painel; rotinas em timeline. |
| 5 | **Extensão e ritmo** | 53, 54, 55, 56, 57, 58, 59 | Aprovação por Telegram e celular; horário silencioso; pod de saúde; onboarding em 10 min. |

Ordem dentro da onda segue a lista. Cada item entra por PR próprio com a captura "antes/depois" e o teste de aceite no corpo.

### Registro da Onda 0 — 21/09/2026

Entregue no branch `feature/onboarding`, verificado no app real (dev server, 1440 × 900, pt-BR) e por 365 testes unitários verdes.

| Item | O que entrou | Como se prova |
|------|--------------|---------------|
| 10 | `.panel-in` opaco; painel inativo recua por luz (véu + saturação), nunca por opacidade. | Dois painéis sobrepostos: fundo computado `rgb(19,17,9) → rgb(11,10,8)`, sem texto atrás. |
| 13 | Token `--fs-0` (10 px) e zero literais de `font-size` em px fora da escala, em todos os `.css` do app. | `src/typography.test.ts` falha para qualquer literal novo. Três famílias (`--font`, `--font-display`, `--font-mono`) mantidas: a regra é "só tokens", não "duas famílias". |
| 15 | `.panel-body` é container; `.pulse-stats` cai para `--fs-6` abaixo de 360 px e para uma coluna abaixo de 250 px; `overflow-wrap`. | Custo a 268 px: nenhum texto com `scrollWidth > clientWidth`; "Queima por hora" quebra em vez de cortar. O teste em três larguras exigido no aceite ficou como verificação no DOM real, não unitária: jsdom não mede layout. |
| 16 | Configurações abre em 900 × 620; `.app-panel .tabs` quebra linha em vez de rolar. | Oito abas visíveis em duas linhas, `scrollWidth === clientWidth`. |
| 20 | Save de configuração não vira notificação; sino com "Precisa de você" / "Para registro"; repetidas (mesma linha e corpo) viram uma com `×N`; corpo limitado a duas linhas. | `hooks/notificationGroups.ts` + testes; sino real: 1 item em "Precisa de você", o resto em registro. |
| 21 | Falha com mais de 24 h não conta nem acende; `critical` só para aprovação pendente ou orçamento estourado; widget com abrir, executar de novo e silenciar; falhas antigas sob dobra. | `signal.test.ts`; faixa "Atenção 1" em âmbar com 20 falhas antigas na dobra. |
| 22 | Pod ocioso a 58 % de opacidade; rótulo ao lado de cada pod quando o mouse se aproxima do arco. | Opacidade computada `0.58` nos ociosos, `1` nos acesos; `.lb` visível em `.pod-arc.near`. |
| 30 | Plural inline `[um|outros]` no tradutor; rótulos dos sinais como chaves; "Runs" → "Execuções"; "Generations" → "Gerações"; `trace` → "abrir"; "6.7 S" → "17,1 s" com locale e sem caixa alta em badges numéricos. | `i18n.test.ts`, `locales/desktop.leak.test.ts` (nenhuma chave `desktop.*` igual em en e pt-BR fora da lista de palavras compartilhadas). |
| 60 | Tokens de tipo fechados; primitivas existentes (`Panel`, `Badge`, `Tabs`) reutilizadas; helpers novos são puros e testados. | Galeria e primitivas seguem na Onda 2. |

Fora da onda, anotado para as seguintes: `costSignal` ainda formata "0.08" sem locale no tooltip (item 23); descrições dos conectores em inglês vêm do catálogo em `connectors/` (item 28); "Processo concluído" vem do backend (item 36).

---

## 5. Métricas de produto que este plano mira

| Métrica | Hoje (sessão de 21/09) | Alvo |
|---------|------------------------|------|
| Tempo do prompt até ver o agente responder | nunca (só o painel de run) | ≤ 1 s para o primeiro token |
| Textos cortados por tela | 3–5 | 0 |
| Não lidas ao abrir | 30 | ≤ 5, só humanas |
| Painéis sobrepostos ilegíveis | 2 de 7 capturas | 0 |
| Cliques até aprovar | 3 (abrir painel, achar, clicar) | 1 ou `⌘⇧A` |
| Tempo do usuário novo até o primeiro run | não medido | ≤ 10 min |
| Strings em inglês com locale pt-BR | ≥ 4 visíveis | 0 |

---

## 6. Decisões que preciso de você

1. **Wake word** (item 3): local via Web Speech ou só push-to-talk mais atalho? Local custa CPU; o atalho é grátis.
2. **Ciano para o agente** (item 19): aceita uma segunda cor no tema ou prefere manter monocromático âmbar com variação de brilho?
3. **Som** (item 54): entra ou fica fora do produto?
4. **Telegram e celular** (56, 57): prioridade sobre a Onda 4 ou depois dela?
5. **Divisão de `Settings.tsx`** (item 17): posso quebrar em 6 arquivos na Onda 0, mesmo sem mudar comportamento?

---

## 7. O que não entra

- Multiusuário, times, permissões por pessoa.
- Editor de código dentro do app; "abrir no editor" continua externo.
- Plugins de terceiros na UI; micro-apps ficam como estão até a Onda 5 fechar.
