# Critérios de conclusão — evidência consolidada

Atualização: 09/09/2026. Quantidades de testes não substituem critérios. “Parcial” significa que parte obrigatória ainda falta. Nenhuma linha abaixo transforma fixture em integração real.

| Critério | Evidência implementada/verificada | Estado e falta real |
| --- | --- | --- |
| C01 · autenticação expirada | Adaptadores distinguem instalação/login; cache compartilhado; console/Settings orientam recuperação; provider-readiness + desktop-regressions | Parcial: leitura real confirmou Claude sem login, Cursor sem login, Codex CLI ausente. Falta jornada após autenticação |
| C02 · aprovação/reconexão | Guards de aprovação existentes, SSE com cursor/replay; tools approval via CLI fake no E2E flows; recibo persistido de submissão sobre reinício | Consulta de pendências e duas decisões concorrentes aprovadas em api.submission; execução única. Interrupção literal do transporte SSE ainda deve ser distinguida desse teste de contrato |
| C03 · cancelamento de árvore | safeSpawn elimina grupo resistente ao TERM mesmo após pai fechar; teste POSIX real com filho; cancelamento da fila por barreira determinística | Validado também após SIGKILL real do processo que representa a API: guardian POSIX via IPC encerra o grupo próprio; sinalização usa closure viva, sem PID persistido. Não é sandbox para descendente hostil que deliberadamente cria outra sessão |
| C04 · horários perdidos | core.scheduler cobre catch-up uma vez, período/fuso, backoff e edição/pausa/exclusão | Parcial: falta suspensão/retomada real do macOS; não inventar observação |
| C05 · restauração | Backup WAL consistente, integridade/schema antes de tocar dados, cópia em staging, rollback de falha de publicação, artefatos opcionais, testes de falha | Jornada em home esvaziado passou: navegador abriu fonte, API recuperou sessão e quick_check aprovou. Corte de energia no meio de renames não é transação global |
| C06 · integridade de fontes | Exclusões/remoções/incremental e scan incompleto preservado; preview revalida acesso antes de enviar referência | Rename → busca/grafo/preview aprovado em api.memory-rename; quatro perguntas portuguesas ambíguas com fontes/trechos esperados e ausência de resposta aprovadas (recall-quality.md). Corpus pequeno e lexical, não avaliação semântica generalizável |
| C07 · contexto do console | console-context, layouts-presets, desktop-regressions e product-workflows; texto/cwd/sessão preservados, pasta revogada bloqueia envio | Validado com API real e execução interceptada/CLI simulado; não demonstra conta Claude real |
| C08 · navegação do cérebro | brain-context: fechar preview pendente, histórico de seleção, Pixel → cérebro; console-context: referência sem disparar tarefa | Zoom, busca e seleção preservados entre apps: brain-context 3/3. Fonte selecionada removida, aviso de recuperação e zoom de 130% preservado aprovados em closeout-recovery. FIFO do EventBus corrigiu a perda de index.finished em SSE. Pan durante remoção não foi uma asserção específica |
| C09 · dois clientes de layout | layout-conflict passou com dois contextos Chromium; conflito visível, conteúdo local preservado, escolha explícita e reload | Validado; presets são por navegador e aplicar preset publica layout na API |
| C10 · conector revogado | Contratos simulados de conectores já existentes; indicadores/diagnóstico | Bloqueado para leitura real: nenhum conector/conta identificado pelo usuário |
| C11 · ciclos/recursos | 200 navegações, capacidade com três corpora × três repetições; coletor API com CPU/RSS/WAL/hash; benchmark de renderer 6,1 min aprovado (três amostras por perfil após aquecimento) | Parcial: sequência limitada 2h → avaliação → 8h iniciada em 09/09 às 18:05 UTC, sessão 18354, artifacts/workspace-endurance-1788977125921. Ainda sem aprovação. Tentativas anteriores interrompidas não são passes. Histórico global validado com 10 mil registros |
| C12 · acessibilidade | Smoke teclado/mobile/axe; galeria clara/escura com contraste explícito e referências macOS inspecionadas | Reflow e clique no zoom aprovados a 720×450 CSS (equivalente 200%, não zoom nativo). Sobreposição corrigida. Contraste também aprovado em oito páginas × dois temas (16/16), após corrigir seleção do dock claro; modal de criação de skill também passou teclado/axe a 720×450 após correção de contraste. Dados externos/cores personalizadas e zoom nativo não cobertos integralmente |

## Pedidos originais

Prints 1/4: navegação de Fazer, launcher e microapps corrigida; os testes exigem conteúdo utilizável. Print 2: notificações abrem destino e templates conhecidos são localizados. Print 3: console com scroll, resize/maximização, recuperação de autenticação. Print 5: Agora gerenciável, dock/modos, Pixel funcional, ciclo de rotinas, cérebro com zoom/controles retráteis. Há evidência de UI/API local; contas externas permanecem explicitamente limitadas.

Benchmark GitHub e decisões: `benchmark.md`, documental. Skills: dois diretórios criados e instalados anteriormente; procedimento gauntlet exercitado nesta implementação, mas chamada nativa no Claude Code e medição mobile ainda não demonstradas. Nenhuma otimização percentual de RAM do Claude é alegada.

## Bloqueios e itens que NÃO são bloqueios externos

Dependem de usuário/ambiente: autenticação interativa Claude; conector para leitura; caminho do projeto mobile e comando lento; observação real de suspensão sem interromper trabalho alheio. Não repetir pedidos de permissão para ações locais já autorizadas.

Trabalho local de restore/rename, concorrência/orçamento, histórico volumoso, notificações estruturadas e recuperação do cérebro implementado e verificado nos cenários registrados. Permanecem fechamento do ensaio prolongado e revisão de suas séries, com limites de cobertura descritos acima. Não atribuir esses itens à falta de autenticação. O plano não está integralmente concluído.
