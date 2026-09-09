# E01 — Baseline e rastreabilidade inicial

06/09/2026. Inventário inicial concluído; baseline de latência, capacidade e cobertura fina ainda em execução. Não equivale à conclusão de E01.

Ambiente medido: macOS 26.6.2, arm64, 24 GiB de RAM, 12 CPUs lógicas, Node 22.23.2. Navegador de testes: Chrome instalado, viewport por cenário. O coletor `scripts/resource-snapshot.mjs` registrou três amostras com 30 processos de nomes relevantes. Nomes não comprovam vínculo com este projeto; portanto os totais não são apresentados como consumo do Mordomo. Arquivo: `artifacts/execution-2026-09-06/resources-initial.json`.

## Fluxos e pontos de entrada

| Jornada | Interface | Contrato/motor | Evidência herdada / lacuna |
| --- | --- | --- | --- |
| Fazer / launcher / notificações | NowPanel, CommandPalette, InboxWidget | navegação e rotas API | desktop-regressions e product-workflows; enumeração fina de ações pendente |
| Console / execução | PromptWidget, RunDetail, useRunStream | runs, sessions, runManager, safeSpawn | smoke/flows/core.runs; corridas e falhas parciais a aprofundar |
| Provedores | desktop/index, Settings | providerSnapshot, adapters | falsos positivos reproduzidos e corrigidos nesta rodada |
| Rotinas | Routines | scheduler, store, osIntegration | lifecycle testado; suspensão e política de atraso pendentes |
| Segundo Cérebro | SecondBrain, BrainPanel, engine/world | indexer, graph, search, recall, preview | navegação/zoom testados; scan incompleto preservado e erro recuperável; corpus de qualidade pendente |
| Skills | SkillList/Detail/NewSkillModal | skills routes/store, adapters | execução e marketplace simulados; skills práticas em projeto mobile pendentes |
| Pixel / artefatos | PixelStudio, Artifacts, Generations | microapps/pixel, artifacts/raw | desenho/exportação/save/preview aprovados anteriormente |
| Personalização | Workspace, WidgetLayer, useGridLayout | settings/dashboardLayout, storage browser | resize/hide/foco/persistência aprovados; presets/conflito de abas pendentes |
| Conectores | Connectors, widgets | connector client/registry/auditor | contrato API/MCP simulado; conector real não informado |
| Recuperação de dados | Settings / diagnóstico | backup, restore, migrações | testes existentes; inventário e ensaio completo de restauração pendentes |

## Decisões e achados desta rodada

E02: presença de credencial não valida login; desconhecido não é verdadeiro. Claude consulta status oficial somente quando anunciado no help, com timeout de 5 s, leitura estrita do booleano e nenhuma exposição do JSON bruto. Fallback e home de teste continuam explicitamente não verificados. Cache de health existente (60 s) preservado. Settings oferece atualização forçada sem executar smoke/prompt.

Referência de contrato consultada: [CLI oficial Claude](https://code.claude.com/docs/en/cli-reference), comando `auth status`. Diagnóstico real com a CLI 2.1.217 retornou `authenticated: false`; nenhuma inferência paga foi executada. Isso bloqueia a jornada real, não os testes simulados.

E03: revisão identificou que recuperação no macOS confiava cegamente em PID persistido e que no Linux aceitava até um processo node genérico. Mudança imediata: não sinalizar processo cuja identidade não pode ser comprovada após reinício; registrar aviso na execução. Cancelamento e shutdown de handles vivos continuam funcionando. Tradeoff explícito: limpeza automática de órfãos após crash fica pendente de desenho com identidade durável/supervisão; um PID salvo sozinho não autoriza matar trabalho de outro projeto.

E05: reproduzida perda de índice por falha de leitura de diretório. Corrigido com aborto do scan antes da fase de escrita e erro 409 recuperável. Um evento terminal `index.failed` também encerra progresso para outros clientes e gera aviso persistido. O índice anterior é preservado no erro de scan; outros erros não recebem essa promessa. Remover uma raiz da configuração continua removendo suas entradas. Tradeoff: raízes saudáveis também aguardam nova tentativa para atualizar.

E04: backup agora usa staging e publicação por rename, nomes únicos, limpeza em falha e restauração opcional de artefatos com cópia de segurança. Origem por traversal ou symlink é rejeitada antes de tocar o destino. Restauração integral e comportamento durante falhas entre passos ainda exigem ensaio.

E06: rascunho passou a preservar texto/pasta/sessão conjuntamente. Pasta fora da configuração exige escolha explícita antes de envio. Testes de navegação e recarga inspecionam o payload sem executar provedor.

Baseline preliminar de navegação: 200 alternâncias aquecidas (100 por app). Pixel mediana 26,1 ms / p95 29,7 ms; cérebro mediana 28,9 ms / p95 30,9 ms. Intervalo interno handler–elemento renderizado, sem medir latência física da entrada. Artefato `navigation-baseline.json`; falta fingerprint/corpus para comparação final. Não representa desempenho do motor ou soak.

E03: cancelamento de uma execução aguardando slot antes dependia do término de outra tarefa. Reproduzido por barreira determinística e corrigido com espera abortável; remover um waiter não decrementa a ocupação. Teste comprova tarefa cancelada terminal, tarefa original ainda executando e sucessora ainda na fila até liberação real.

