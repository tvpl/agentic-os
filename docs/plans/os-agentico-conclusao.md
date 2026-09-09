# Plano de conclusão — MordomoOS como OS agêntico de uso diário

Data: 06/09/2026. Revisão: 2. Estado: proposta refinada; implementação destas fases ainda não iniciada.

Leia junto o [roteiro de aprofundamento, execução e revisão](os-agentico-execucao.md) e o [registro da revisão da proposta](os-agentico-revisao.md). Este documento define o escopo e os aceites; o roteiro define como investigar, implementar e produzir evidência. Havendo conflito, registre-o e refine os documentos antes da tarefa afetada. Instruções do usuário têm precedência.

## 1. Objetivo e limites da entrega

Concluir as lacunas da revisão anterior para que o usuário consiga navegar, organizar seu espaço, executar agentes, consultar memória e manter rotinas no macOS com continuidade, controle e recuperação compreensível. A experiência imersiva deve ajudar a trabalhar: encontrar contexto, acompanhar ações, trocar de aplicativo e recuperar falhas sem perder o trabalho.

Este plano complementa `docs/review-2026-09-06/README.md`. As correções já entregues permanecem como baseline, não como tarefas a refazer. Os 399 testes de motor/API, 196 de UI e 32 cenários de navegador documentados são evidência daquela revisão, não comprovação antecipada deste plano.

Entregas obrigatórias: integração real validada; auditoria dos contratos do motor; desempenho e estabilidade medidos; fluxos completos dos aplicativos; experiência imersiva consistente; validação prática das skills; relatório final rastreável. Execução por contêiner, desktop Linux remoto e adoção de ACP são decisões arquiteturais a avaliar, não requisitos automaticamente acrescentados à visão JARVIS. Recursos de voz já existentes entram na auditoria; escuta contínua e novos serviços de voz exigem definição própria.

## 2. Forma de execução e rastreabilidade

Cada tarefa abaixo deve gerar um registro com: ID, requisito original, cenário de reprodução, comportamento esperado, componentes afetados, alteração, teste/evidência, riscos, reversão e estado. Estados permitidos: não iniciado, em investigação, em implementação, em validação, bloqueado por dependência identificada e concluído com evidência.

Prioridades: P0 para perda de dados, execução indevida ou indisponibilidade essencial; P1 para confiabilidade e fluxos centrais; P2 para refinamento de experiência. A prioridade da tarefa não presume que o defeito já existe. Achados recebem severidade após reprodução.

Sequência principal: F0 → contratos de F1/F2 e diagnóstico inicial de F3 → F4/F5 em incrementos → validações práticas de F6 → F7. Um achado P0 interrompe a evolução da área afetada e é tratado antes de trabalho visual; não aguarda a fase final. A coleta de F3 começa na baseline e acompanha as alterações, não apenas depois do motor. F1 pode avançar até o limite da autenticação; F2–F6 não precisam parar se uma conta estiver indisponível. F4 define estados e contratos de interação antes da conclusão visual de F5. O benchmark documental de F6 começa após F0 e informa F2/F5 antes de decisões arquiteturais. As skills são exercitadas durante F3 e F7.

Usar mudanças pequenas e coesas, preservar diffs anteriores e limitar a um runner pesado por vez. Construir um bundle estável antes dos testes de navegador; não reconstruir o diretório servido durante uma passagem. Ambientes: home/porta isolados para testes destrutivos e falhas simuladas; ambiente pessoal apenas para verificações reais controladas. Não sobrescrever layouts pessoais para melhorar capturas.

## 3. F0 — Baseline reproduzível e mapa de cobertura

**F0.1 · P1 · Inventário de contratos e fluxos.** Mapear rotas, widgets, microapps, ações do launcher, atalhos, eventos, provedores, conectores e persistência. Para cada controle, registrar destino, carregamento, estado vazio, resultado, erro e recuperação. Mapear os cinco prints originais aos testes de regressão existentes.

**F0.2 · P1 · Baseline da máquina.** Registrar hardware, RAM, macOS, navegador, versões das CLIs, dimensões de viewport, escala e tamanho dos dados de teste. Medir processos por PID/PPID sem expor argumentos, tokens ou conteúdo privado. Separar API, renderer, provedores, MCPs e ferramentas mobile.

**F0.3 · P1 · Fixtures e evidência.** Preparar conjuntos pequenos, médios e grandes de arquivos, histórico e eventos. Usar conteúdo sintético e raízes isoladas. Definir scripts reproduzíveis e formato CSV/JSON para métricas. Capturas devem aguardar estado estável; os testes de movimento, separadamente, observam a animação em execução.

**Aceite:** matriz de cobertura sem controles centrais sem destino definido; baseline reproduzível; testes existentes executáveis sem atingir dados pessoais; falhas preexistentes identificadas. Saídas: matriz de requisitos, inventário de ambiente e baseline de desempenho.

## 4. F1 — Provedores e conectores reais

**Componentes:** `adapters/claude`, `adapters/codex`, `adapters/cursor`, `apps/api/src/providers.ts`, `apps/api/src/doctor.ts`, `core/src/connectors`, Settings, Connectors e `runs/authRecovery.ts`.

**F1.1 · P1 · Estado verdadeiro do provedor.** Distinguir CLI encontrada, versão compatível, autenticação válida, capacidade disponível e erro de execução. Um processo instalado não deve produzir indicador de prontidão quando a sessão está expirada. Testar ausência do binário, versão incompatível, login expirado, limite do provedor, rede indisponível e erro inesperado.

**F1.2 · P1 · Recuperação de autenticação.** Unificar orientação no console, detalhes da execução e configurações. Exibir provedor afetado, comando correto, cópia do comando e ação de verificar novamente. Usar o mecanismo interativo oficialmente suportado; só oferecer abertura de terminal se a aplicação tiver um caminho seguro e verificável. Nunca pedir credenciais no prompt nem repetir automaticamente uma tarefa que possa ter produzido efeitos.

**F1.3 · P1 · Jornada real do Claude.** Após o usuário autenticar sua conta: executar leitura simples; continuar a mesma sessão; cancelar uma tarefa; verificar histórico, artefato e indicação de consumo disponível. Exercitar uma escrita pequena em diretório descartável pelo fluxo de aprovação existente. Identificar modelo, versão e custo conhecido/desconhecido. Codex e Cursor recebem o mesmo contrato quando instalados e configurados; indisponibilidade deve ficar explícita.

**F1.4 · P1 · Conector do início ao fim.** Para cada conector suportado, testar configuração inválida, conexão, leitura, atualização, timeout, revogação e reconexão. Validar no mínimo um conector real disponível. Widgets devem mostrar origem, última sincronização e erro acionável, diferenciando “sem dados” de “sem configuração”. Escritas externas só entram com destino e autorização definidos.

**Aceite:** usuário consegue identificar e recuperar uma sessão inválida; há evidência de execução real do Claude e de leitura real de um conector configurado; resultados simulados são rotulados. Ausência de login bloqueia apenas esse aceite e não é convertida em sucesso.

## 5. F2 — Auditoria e robustez do motor

**Componentes:** `core/src/runs/runManager.ts`, `sessionStore.ts`, `core/src/spawn/safeSpawn.ts`, `core/src/routines`, `core/src/memory`, `core/src/security`, `core/src/backup.ts`, rotas de runs/events/sse/sessions e `runs/useRunStream.ts`.

**F2.1 · P1 · Máquina de estados e concorrência.** Documentar transições reais de queued/running/waiting_approval até estados terminais. Testar clique duplo, submissões concorrentes, limite de slots, aprovação repetida/expirada, cancelamento simultâneo à conclusão e encerramento durante execução. Reaproveitar a fila existente; separar fila do motor de eventual fila de mensagens da conversa. Garantir uma conclusão por execução e ausência de processos filhos órfãos.

**F2.2 · P1 · Retomada e streaming.** Interromper a conexão SSE, recarregar o browser, reiniciar a API e reconectar. Conferir sequência de eventos, ausência de duplicação, consistência de texto/status e associação à sessão. Se uma execução não puder ser retomada, marcá-la como interrompida com explicação e ação segura. Retomar visualização não deve significar executar novamente.

**F2.3 · P1 · Timeout, tentativas e orçamento.** Auditar mecanismos já existentes. Classificar falhas transitórias, autenticação, entrada inválida e resultado incerto. Definir limite de tentativas e backoff por caso; não repetir escrita de resultado incerto sem reconciliação. Testar orçamento sob concorrência e tratamento de custo desconhecido; limites baseados em estimativa devem ser apresentados como tal.

**F2.4 · P1 · Rotinas no macOS.** Testar suspensão/retomada da máquina, API desligada no horário previsto, timezone, mudança de horário, edição durante execução, rotina sobreposta, pausa e exclusão. Definir política de horário perdido: executar uma vez, ignorar ou reagendar, com histórico. Não prometer execução exatamente uma vez em sistemas externos; prevenir duplicação local e explicitar incerteza externa.

**F2.5 · P0/P1 · Persistência e recuperação.** Auditar migrações, gravações concorrentes, atomicidade entre arquivo/banco, referências quebradas e crescimento de logs. Gerar backup e restaurar em home descartável, verificando integridade de sessões, skills, rotinas e configurações. Simular interrupção de gravação e falta de espaço na fixture. Não aceitar backup só porque um arquivo foi criado.

**F2.6 · P0/P1 · Fronteiras de execução.** Exercitar aprovação de escrita, isolamento entre raízes/sessões, paths e symlinks, argumentos de processos, redaction de logs e escopos de conectores. Conteúdo indexado, skills importadas e respostas de ferramentas são dados não confiáveis; testar que não ampliem permissões por instrução textual. Corrigir achados concretos sem reescrever mecanismos corretos.

**F2.7 · P1 · Diagnóstico correlacionado.** Relacionar execução, tentativa, sessão, rotina e ferramenta no diagnóstico. Expor estado da fila, última atividade, duração, falha e ação possível. Reutilizar eventos e métricas existentes antes de introduzir outra infraestrutura de tracing. Proibir tokens e prompts privados em exportações por padrão.

**F2.8 · P1 · Integridade e utilidade da memória.** Auditar `indexer.ts`, `search.ts`, `recall.ts`, `graph.ts` e preview. Testar criar/editar/renomear/mover/excluir arquivo, indexação concorrente e interrompida, arquivo inacessível, exclusões e mudança de raiz. Conferir que busca, grafo, preview e contexto enviado ao agente correspondam à mesma fonte e respeitem os limites de acesso. Montar perguntas com arquivos/trechos esperados, incluindo português, termos ambíguos e ausência de resposta; medir recuperação relevante e citações, não apenas quantidade de nós. Não introduzir busca vetorial ou outro banco antes de demonstrar limitação do mecanismo atual.

**Aceite:** falhas injetadas terminam em estado explicável; reconexão não duplica ações; cancelamento encerra a árvore de teste dentro do prazo configurado e sua tolerância documentada; backup restaurado; nenhum achado crítico/alto aberto nesta frente. Saídas: mapa de estados, decisões de recuperação, matriz de integridade/recuperação da memória e testes de regressão.

## 6. F3 — Desempenho, memória e estabilidade prolongada

**F3.1 · P1 · Instrumentação.** Medir RSS, heap quando disponível, CPU, processos, listeners/conexões, duração de requisições locais, volume de logs e desempenho de frames. Informar unidade e ferramenta. Não misturar RAM do Claude com RAM de navegador, Gradle ou simuladores. Não usar memória virtual como medida de RAM física.

**F3.2 · P1 · Cenários comparáveis.** Medir após aquecimento: desktop parado; grafo parado/animado; 100 trocas de app; redimensionamento de janelas; 100 execuções simuladas; stream volumoso; busca/indexação. Fixtures iniciais de 100, 1.000 e 10.000 arquivos, mais histórico de 1.000 e 10.000 execuções. Caso a arquitetura não suporte um patamar, registrar limite e política de degradação em vez de ocultar o resultado.

**F3.3 · P1 · Corrigir causas medidas.** Investigar renderizações, timers, observers, SSE duplicado, consultas sem limite, logs acumulados, buffers e trabalho do canvas fora de tela. Aplicar paginação, virtualização, descarte e pausa de animação apenas onde a evidência justificar. Manter busca, cancelamento e controles responsivos durante indexação.

**F3.4 · P1 · Perfis de experiência.** Oferecer automático, imersivo e econômico, com efeitos desacoplados da lógica. Em segundo plano, reduzir trabalho visual; movimento reduzido deve respeitar o sistema. Mostrar dados de diagnóstico sob demanda, com coleta leve e limpeza ao fechar.

**Metas iniciais propostas, a ratificar após F0 e medidas conforme o protocolo do roteiro:** resposta visual de controles locais p95 ≤ 100 ms; navegação já carregada p95 ≤ 300 ms; alvo de 60 fps e mediana ≥ 55 fps nas interações do dataset médio no equipamento de referência. Medir separadamente transição fria, indexação e latência remota. Não apresentar estes números como resultados existentes.

**Memória e CPU:** fixar tetos em MiB/% após baseline para cada processo; congelar os tetos antes de validar a correção. Para ciclos repetidos, comparar platôs em repouso após aquecimento; crescimento sustentado exige investigação mesmo abaixo do teto. Como triagem inicial, aumento maior que 10% entre platôs comparáveis deve abrir um achado. Não usar GC forçado na aceitação de uso real.

**F3.5 · P1 · Teste prolongado em duas etapas.** Executar 2 h de carga sintética intermitente para corrigir problemas rapidamente; depois 8 h com alternância de atividade, repouso, suspensão/reconexão e reabertura do navegador. Uma passagem de 24 h é observação adicional quando houver achado ou requisito que a justifique. A correção do agendamento é comprovada por cenários determinísticos de relógio/timezone e uma jornada real de suspensão/retomada; esperar um dia, sozinho, não valida esse contrato. Usar simulação para volume; chamadas reais ficam limitadas ao cenário e orçamento acordados. Este plano não agenda nem inicia execução futura.

**Aceite:** relatórios antes/depois no mesmo ambiente; tetos respeitados; nenhuma tendência inexplicada de crescimento, processo órfão, travamento ou duplicação de rotina; controles recuperáveis durante carga. Saídas: scripts de medição, CSV/JSON, gráficos e envelope de capacidade publicado.

## 7. F4 — Experiência funcional completa e português consistente

**F4.1 · P1 · Contrato de ação.** Para onboarding, launcher, dock, notificações e widgets: clique/teclado → feedback imediato → destino ou resultado → erro acionável. “Depois” deve adiar, “Fazer” deve abrir o passo correto e a conclusão deve depender do estado real da configuração.

**F4.2 · P1 · Console como local de trabalho.** Mostrar projeto/cwd, provedor, modo, sessão e execução ativos sem confusão. Preservar rascunho e contexto na navegação. Validar resposta longa, seleção/cópia, rolagem, aprovação, cancelamento, anexos se suportados, voz existente e abertura de artefatos. Se houver fila de mensagens, torná-la cancelável e ordenada; reutilizar contratos do motor e impedir envio silencioso após mudança de projeto/provedor.

**F4.3 · P1 · Notificações estruturadas.** Evoluir de strings persistidas para evento com tipo/chave e parâmetros; manter compatibilidade com registros antigos. Separar leitura de navegação. Tratar destino excluído com explicação e alternativa. Datas e mensagens do sistema em pt-BR; nomes e comandos do usuário preservados.

**F4.4 · P1 · Matriz dos aplicativos.** Segundo Cérebro: indexar, buscar, abrir, explorar relações e voltar. Skills: criar, editar, validar, executar e consultar falha. Rotinas: agendar, testar, pausar, retomar e examinar histórico. Runs: acompanhar, aprovar, cancelar e revisar mudanças. Pixel: desenhar, desfazer/refazer, frames, salvar, reabrir e exportar formatos suportados. Artefatos/Generations: pesquisar, visualizar e tratar arquivo removido. Connectors e Settings: persistência, validação, diagnóstico e recuperação.

**F4.5 · P1 · Acessibilidade e resiliência.** Testar teclado completo, foco após fechar/ocultar janelas, ordem de tabulação, Escape, leitores de tela nos controles centrais e zoom de navegador 100/125/150/200%. Incluir contraste antes excluído, medir e corrigir violações aplicáveis; não desabilitar regra para declarar sucesso. Estados vazios, offline e erro devem ter saída útil.

**Aceite:** todos os controles da matriz têm resultado verificável; nenhuma ação central é um no-op silencioso; português consistente; testes dos cinco prints permanecem aprovados; contraste e teclado têm relatório explícito de cobertura.

## 8. F5 — Imersão JARVIS com utilidade diária

**F5.1 · P1 · Modelo de workspace.** Consolidar estados distintos para aplicativo, janela/widget e modo de trabalho. Persistir preferências com versão e migração. Especificar precedência entre layout salvo, maximização temporária, modo Foco e retorno à Visão geral. Restaurar sempre um caminho visível de navegação.

**F5.2 · P1 · Gerenciamento de espaço.** Evoluir widgets existentes com minimizar para ícone, restaurar, maximizar, redimensionar e organizar por encaixe. Oferecer presets de trabalho, salvar/renomear/restaurar layout e desfazer reorganização. Tratar colisões, tamanho mínimo, mudança de resolução e retorno de outro monitor. A operação deve ser possível também por teclado.

**F5.3 · P1 · Navegação progressiva do Segundo Cérebro.** Definir percurso área → pasta/grupo → arquivo → relações → preview → ação. Adicionar breadcrumbs e voltar/avançar de contexto; manter câmera e filtros ao retornar. Zoom com roda/trackpad, botões, percentual, ajustar ao conteúdo e reset. Aplicar nível de detalhe: visão geral legível, rótulos progressivos e limitação de elementos no dataset grande. Tratar grafos vazios, órfãos e arquivo removido.

**F5.4 · P2 · Linguagem visual e movimento.** Definir tokens para espaçamento, tipografia, contraste, raios, elevação e densidade. Hierarquia de cards proporcional à tarefa, truncamento com acesso ao texto integral e ações consistentes. Transições breves de abrir/fechar/encaixar, foco perceptível e redução de brilho/textura onde disputem com conteúdo. Uma animação não deve bloquear clique nem ser requisito para completar uma ação.

**F5.5 · P1 · Presença do agente.** Estado persistente que distingue pronto, executando, aguardando aprovação, desconectado e falhou. Evidenciar contexto em uso e permitir abrir a execução correspondente. Não exibir avatar animado como prova de atividade real nem “saudável” sem verificação.

**F5.6 · P1 · Validação de jornadas.** Executar cinco tarefas: iniciar o dia e escolher pendência; pesquisar contexto e enviá-lo ao agente; trabalhar em foco e acompanhar execução; resolver falha e retomar; organizar workspace e voltar após reinício. Registrar cliques, tempo, becos sem saída e perda de estado. Comparar com baseline F0, sem transformar menos cliques em objetivo quando remover clareza.

**F5.7 · P1 · Contexto acionável entre aplicativos.** Definir como arquivo/trecho selecionado no cérebro chega ao console, como uma execução abre seu artefato e como um prompt vira rascunho de rotina ou skill. Preservar origem, projeto, seleção e referência; pedir esclarecimento somente se o destino estiver ambíguo. Abrir uma composição com contexto não deve disparar execução automaticamente. Reutilizar as rotas e contratos existentes; definir um contrato compartilhado apenas se a análise comprovar duplicação divergente.

**Aceite:** personalização restaurável; nenhum controle necessário encoberto; navegação progressiva reversível; estados reais compreensíveis; metas de F3 preservadas com efeitos ativos; revisão visual em 1280×800, 1440×900 e 1920×1080, mais tela estreita para evitar regressão. Saídas: contrato de interação, tokens e capturas comparáveis.

## 9. F6 — Benchmark aprofundado e skills em uso real

**F6.1 · P1 · Comparação rastreável.** Partir de OpenHands, Open WebUI e Agent Zero já consultados. Registrar data, versão/commit e fonte oficial. Examinar especificamente ciclo de execução, recuperação, memória, observabilidade, personalização e custo operacional. Distinguir leitura documental, leitura de código e execução prática; não alegar benchmark de desempenho sem rodar o cenário equivalente.

**F6.2 · P1 · Decisões aplicáveis.** Produzir matriz “capacidade observada → problema local → proposta → custo/risco → decisão → tarefa”. Classificar adotar agora, experimentar ou adiar com justificativa. Se uma comparação prática exigir instalação pesada, começar com um único candidato em ambiente isolado; executá-la apenas se resolver uma decisão concreta. Estrelas contextualizam adoção, não validam arquitetura. Qualquer reutilização de código exige verificar licença.

**F6.3 · P1 · Skill mobile.** No projeto mobile indicado, exercitar diagnóstico de lentidão com duas amostras, identificação da árvore de processos, causa candidata, mudança reversível, repetição da mesma operação e rollback. Distinguir pressão de RAM de contexto/tokens. Testar também cenário sem evidência suficiente: a skill deve admitir a limitação, sem aplicar limpeza genérica. Registrar versões, medições e efeito real; não prometer redução percentual antecipada.

**F6.4 · P1 · Skill gauntlet.** Exercitar uma tarefa com SDD e outra com prompt comum. Incluir falha que teste unitário não captura, gate indisponível e duas tentativas sem progresso. Conferir extração de critérios, priorização de testes, registro de achados, preservação do trabalho e saída honesta. Manter um runner pesado por vez e não gerar revisão por múltiplos agentes sem autorização.

**Aceite:** comparação com decisão concreta e evidência; skills executadas em cenários práticos e refinadas a partir dos resultados; cópias do repositório e do Claude Code coerentes; comandos de uso e limites documentados. Sem projeto mobile definido, a validação prática dessa skill fica explicitamente pendente.

## 10. F7 — Gauntlet final e entrega operacional

Cada conjunto coeso segue o mesmo ciclo: reproduzir → implementar → revisar o diff com postura adversarial → validar → corrigir achados → repetir apenas verificações afetadas. Revisão feita pelo mesmo agente não será chamada de independente. Reavaliar a estratégia após três ciclos ou duas tentativas idênticas sem evidência nova; esse limite evita desperdício, não permite ignorar falhas.

A revisão deve cobrir entrada inválida, concorrência, efeitos parciais, perda de conexão, cancelamento, recuperação, acessibilidade e dados persistidos. Acrescentar regressões comportamentais, sem testes que apenas reproduzam a implementação. Não mudar critérios depois da execução para acomodar resultado ruim; qualquer revisão de meta exige motivo documentado e nova avaliação.

Gates finais:

1. Build, typecheck, lint e integridade do diff; testes de motor/UI pertinentes aprovados.
2. Suíte E2E ampliada, com documento HTTP válido, conteúdo utilizável e zero erros não tratados nos fluxos auditados.
3. Falhas injetadas de F2, restauração de backup e contratos de aprovação/cancelamento aprovados.
4. Jornadas reais de F1 registradas, com dependências externas explicitadas.
5. Baseline/comparação de F3 e passagem prolongada de 8 h aprovados; casos determinísticos do scheduler e suspensão real documentados. Uma observação de 24 h permanece condicional, com justificativa explícita.
6. Teclado, contraste, zoom, movimento reduzido e revisão visual de F4/F5 documentados.
7. Skills práticas e benchmark de F6 entregues.
8. Nenhum achado crítico/alto aberto; médios remanescentes com reprodução, impacto e decisão explícita. Não chamar de conclusão integral se um aceite obrigatório estiver bloqueado.

Entrega: relatório requisito → alteração → evidência, inventário de testes simulados/reais/não executados, métricas, capturas, guia curto do workspace e recuperação, procedimento de backup/restauração e rollback específico das alterações. Validar migração no home de teste antes de aplicar atualização ao serviço pessoal; verificar execuções ativas e preservar trabalho em andamento.

## 11. Marcos, dependências externas e definição de conclusão

| Marco | Resultado observável | Dependências |
| --- | --- | --- |
| M0 | Baseline e matriz completos | F0 |
| M1 | Execução previsível e recuperável | F1 + F2; login para evidência real |
| M2 | Uso sustentado medido e apps completos | F3 + F4 |
| M3 | Workspace imersivo consistente | F5, mantendo os gates de M1/M2 |
| M4 | Benchmark aplicado e skills exercitadas | F6; projeto mobile para medição real |
| M5 | Entrega integral com evidências | F7 e todos os aceites obrigatórios |

Informações necessárias somente no ponto de uso: autenticação interativa do Claude; conector/conta disponível para leitura; caminho e cenário lento do projeto mobile; limite de gasto para carga com provedor real, se necessária. Carga volumétrica usa fixtures por padrão. Estas dependências não impedem começar F0/F2 nem justificam perguntas repetidas sobre ações já autorizadas.

Não fixar prazo total antes da baseline: F0 deve produzir estimativa por frente baseada no inventário e nos achados. O teste de 8 h tem duração de observação própria; não equivale a oito horas de implementação. A conclusão será demonstrada pelos aceites acima, com descrição precisa do que o produto suporta e do que ainda não foi validado — sem promessa de ausência absoluta de bugs.

## 12. Instrução obrigatória ao executor

Aprofunde a análise antes de implementar cada pacote: percorra o caminho completo entre interação, estado, API, motor e persistência; reproduza o comportamento e procure evidências que contradigam a hipótese inicial. Revise a proposta deste plano contra o código atual e os requisitos do usuário. Refine contratos, dependências e aceites quando encontrar lacunas, preservando rastreabilidade e sem reduzir o escopo silenciosamente.

Para cada proposta relevante, explicite o problema, a causa observada, alternativas proporcionais, decisão recomendada, migração, recuperação e verificação. Em seguida faça uma passagem separada de revisão de produto, técnica e de testes; corrija os achados da proposta antes de implementar a parte afetada. Não transformar essa revisão interna em pedido automático de aprovação do usuário. Avançar autonomamente no escopo autorizado; perguntar apenas por dependências reais que o ambiente e o histórico não resolvam.

O aprofundamento deve terminar em decisão executável. Se a investigação não produzir evidência nova após duas tentativas equivalentes, escolha outro experimento, decomponha o problema ou registre a dependência exata. Não permanecer em refino documental indefinido, nem chamar uma proposta de capacidade implementada. Aplique o roteiro vinculado no início para executar, revisar, refinar e validar até os critérios de saída.
