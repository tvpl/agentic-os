# Checkpoint — execução do plano MordomoOS

## Retomada 09/09 — estado que prevalece sobre o histórico

Lote de implementação fechado em fonte: supervisor POSIX compatível com fonte/build e erro de spawn; notificações estruturadas ao vivo, reconexão e leitura entre janelas; filtros/ordenação global do histórico com índices; identidade de submissão também na execução rápida; recuperação de fonte removida; foco e layout de modais. Detalhes em `submission-and-navigation.md`.

**Soak antigo encerrado deliberadamente**, sessão 56080 terminou com 143. O runner antigo não respondeu ao primeiro SIGINT; foram encerrados somente os PIDs verificados 70835 (runner), 70839 (worker), 70838 (API isolada). Aproximadamente 40 minutos observados não equivalem a 2h aprovadas. Artefatos preservados em `artifacts/workspace-soak-1788901107285`; este resultado é do bundle anterior, não do lote atual. Não há soak novo.

O serviço pessoal 4777 continua na publicação anterior à migração 13. **Não publicar o novo lote antes da validação final**, que é o próximo passo. Último runner de validação anterior: sessão 49474; conferir término antes de iniciar outro pesado. Logs `/tmp/mordomo-closeout-{types,lint,engine,ui}.log`; não atribuir aprovação antiga às alterações posteriores.

Dependências externas e 2h/8h/suspensão real continuam sem aceite. Implementação não significa conclusão integral validada.


## Estado operacional mais recente — 08/09, 21:00 UTC

**Plano ainda não integralmente concluído.** Esta seção prevalece sobre estados históricos abaixo.

- Serviço pessoal **4777 atualizado**; supervisor reiniciou em PID observado 70763, saúde e scheduler ok, zero tarefas/pendências. `quick_check=ok`, tabela da migração 12 confirmada. Backup prévio: `config/backups/full-2026-09-08T20-57-18-507Z-Ct7eaH` (inclui artefatos). Evidências `artifacts/execution-2026-09-07/service-{pre,after}-upgrade.json`.
- Gates: **444/444 motor/API** na última passagem; **202/202 UI** na passagem anterior (última mudança UI foi CSS do dock, validada em browser); typecheck/lint/build atuais aprovados. Browser global **67 passaram + 2 opcionais pulados**, seguido por **17/17 contraste de oito páginas em dois temas + reflow** após última correção CSS. Não somar repetições. Logs duráveis em `artifacts/execution-2026-09-07/logs/`.
- Achados corrigidos nesta retomada: controles/legenda do cérebro sob navegação em tela estreita; reserva concorrente de orçamento, teto de skill aprovada e recálculo de retry; trecho vazio na recuperação de memória; contraste do modo selecionado no dock claro. Corpus português com 4 fontes esperadas + caso sem resposta aprovado; limites em `recall-quality.md`.
- **PROCESSO ATIVO: soak de workspace 120 min**, exec session **56080**, Playwright/servidor em **4788**, home `tests/.tmp/e2e-home`, iniciado **2026-09-08 20:58:27 UTC**. Log `/tmp/mordomo-workspace-soak-120.log`; resultados `artifacts/workspace-soak-1788901107285/{manifest,environment,samples,result}.json*`. `result.json` só é escrito ao terminar/falhar. Ainda NÃO aprovado. NÃO reconstruir bundles nem iniciar outro E2E enquanto ativo. Processo é limitado a duas horas, sem automação futura.
- Próximo passo exato: acompanhar sessão 56080; conferir `result.json`, duração observada, gaps e séries. Se passou 2h, aprofundar análise de heap/listeners e preparar a passagem 8h a partir de estado conhecido conforme roteiro. Se falhou, preservar artefatos e corrigir causa antes de repetir. Mudança no bundle exige nova identificação de versão; não atribuir evidência retroativamente.
- Ainda faltam critérios locais: órfãos após crash com identidade durável; histórico volumoso; cobertura de modais/contraste e câmera com fonte removida; consolidação de notificações estruturadas; observação prolongada e revisão final de todos os aceites. Não chamar estes itens de bloqueio externo.
- Dependências reais anteriores seguem sem resposta: autenticação Claude/Cursor, Codex CLI, conta/conector e projeto/comando mobile. Suspensão macOS real não observada. Integrações pagas não executadas. Não afirmar entrega integral nem percentual de RAM do Claude.


Atualizado em 06/09/2026. Estado: execução em andamento; conclusão integral NÃO atingida.

## Preservação e baseline

Workspace: `<repo>`. Há diffs anteriores de implementação e do usuário, incluindo packages, remoção de Approvals.tsx e introdução de ApprovalCards.tsx; não resetar nem atribuir todos os diffs à rodada atual. Planos e relatório foram lidos. Não há AGENTS.md encontrado no workspace pelo inventário inicial.

Mapa inicial e decisões: `docs/execution-2026-09-06/baseline.md`.

| Pacote | Estado / próximo trabalho |
| --- | --- |
| E01 | Em andamento: ambiente e macrofluxos inventariados, coletor de recursos criado; 200 navegações medidas; falta baseline de capacidade e cobertura fina |
| E02 | Implementação parcial validada: falsos positivos de auth corrigidos, Claude status oficial, recheck na UI. Jornada real bloqueada por login; comando de login copiável e sondagem concorrente coalescida; falta jornada real e validade das capacidades |
| E03 | Em andamento: interrompida sinalização insegura de PID persistido sem identidade; testes de cancelamento/shutdown aprovados. Projetar limpeza durável de órfãos e aprofundar corridas/streaming |
| E04 | Parcial: backups publicados atomicamente, nomes únicos, limpeza de cópia falha, restauração de artefatos e proteção do caminho. Falta recuperação integral/soak |
| E05 | Scan incompleto preserva snapshot; erro 409 recuperável; evento terminal de falha e notificação implementados. Corpus/capacidade pendentes |
| E06 | Rascunho preserva texto/pasta/sessão; pasta removida bloqueia envio até escolha explícita. Demais critérios pendentes |
| E07–E09 | Pendente além da entrega anterior; não anunciar como concluído |
| E10 | Referências documentais anteriores disponíveis; benchmark aprofundado pendente |
| E11 | Skills instaladas e estruturalmente válidas da etapa anterior; uso mobile real pendente |
| E12 | Gates parciais executados; soak de 2 h/8 h NÃO iniciado |

## Mudanças da rodada

- Adaptadores: health exige autenticação explicitamente verdadeira; Claude/Codex não confundem presença de arquivo/chave com validade. Cursor verifica negação antes de substring positiva.
- Claude usa `auth status --json` somente quando comando anunciado no help, timeout curto, resposta sanitizada e fallback desconhecido.
- Settings diferencia auth verdadeira/falsa/desconhecida; ação de verificar novamente via cache forçado. Indicador principal do desktop deixou de ser sempre verde.
- Novos testes `tests/adapters.readiness.test.ts` e `tests/e2e/provider-readiness.spec.ts`.
- Recuperação de runs não mata mais PIDs persistidos sem prova de propriedade. Mensagem explica processo não sinalizado. `tests/core.runs.test.ts` ajustado para o contrato seguro.
- Coletor somente leitura `scripts/resource-snapshot.mjs`, sem argv/credenciais; três amostras iniciais.

## Evidências

- Antes da correção E02: 8 falhas / 1 aprovação no teste focalizado; `/tmp/mordomo-readiness-before.log`.
- Após E02: motor/API 44 arquivos / 414 testes aprovados; `/tmp/mordomo-e02-engine.log`.
- UI: 33 arquivos / 196 testes aprovados; `/tmp/mordomo-e02-ui.log`.
- Navegador E02 + prints: 5 cenários aprovados; `/tmp/mordomo-e02-e2e.log`.
- Build/lint aprovados após E02. Mudança posterior E03 requer build e gates finais novamente.
- Recuperação E03: regressão reproduzida antes; 16 testes core.runs aprovados após; `/tmp/mordomo-recovery-before.log`, `/tmp/mordomo-recovery-after.log`.
- Status REAL Claude: `artifacts/execution-2026-09-06/claude-health-real.json`: CLI instalada 2.1.217, sem login ativo. Nenhum prompt real pago executado.
- Não confundir essas evidências com soak, desempenho de 100 ciclos, teste mobile real ou validação de conector real.

## Dependências externas

Pergunta assíncrona enviada sobre caminho/operação lenta do projeto mobile e conector já configurado; resposta ainda não recebida neste checkpoint. Claude precisa de autenticação interativa (`claude auth login`) antes da jornada real. Não interromper outras frentes por isso.

## Processos e próximo passo

Runners desta rodada são efêmeros; não foi iniciado monitor prolongado nem automação. Servidor E2E em porta 4788, home isolado, encerrado pelo Playwright após execução. Serviço pessoal na porta 4777 não foi reiniciado nesta rodada. Não reconstruir bundle enquanto o teste de navegador está em execução.

Próximo passo: continuar baseline E01, reproduzir scan parcial E05 e concluir revisão dos achados E03; construir versão estável e repetir gates impactados. Atualizar este checkpoint antes de interromper. Manter os planos originais como critérios de saída, sem declarar conclusão com dependências reais e uso prolongado pendentes.

## Continuação — evidências e decisões atualizadas

- E02: `tests/api.provider-cache.test.ts` reproduziu sondagens redundantes e resultado antigo após invalidação; cache agora compartilha solicitações em andamento e impede publicação de resposta invalidada. Settings oferece copiar comando oficial de login. Não executa tentativa automaticamente.
- E04: quatro regressões cobrem colisão de nome, falha de cópia, artefatos e origem inválida/symlink. Backups incompletos ficam ocultos e são removidos em caso de erro. Restore ainda não é uma transação única entre arquivos e SQLite; backup de segurança não equivale a validação integral de recuperação.
- E05: falha de leitura de diretório aborta antes de alterar o índice. Pasta temporariamente ausente não equivale a remoção intencional da configuração. Tradeoff: alterações das raízes saudáveis aguardam nova tentativa; o índice anterior continua pesquisável. API responde 409 `index_scan_incomplete`; UI traduz orientação. Evento `index.failed` encerra progresso também para observadores e gera notificação acionável. Não inclui caminhos/erro bruto no evento.
- E06: `consoleDraft.ts` armazena texto, pasta e sessão juntos em sessionStorage; sessão explicitamente nula não herda outra conversa. Pasta salva que saiu da configuração exige escolha explícita. E2E inspeciona payload interceptado; não executa provedor real.
- Baseline preliminar: `artifacts/execution-2026-09-06/navigation-baseline.json`: 100 navegações por app, Pixel mediana 26,1 ms / p95 29,7 ms; Segundo Cérebro mediana 28,9 ms / p95 30,9 ms. Medição interna entre handler e elemento renderizado, após aquecimento; não é latência física de entrada, nem motor/provedor. Sem fingerprint do bundle/corpus, não usar como gate final de desempenho.
- Motor/API: 45 arquivos, 423 testes aprovados antes da inclusão de `index.failed`: `/tmp/mordomo-stage-engine-final.log`. Typecheck e lint aprovados naquele estado.
- UI após rascunho: 34 arquivos / 199 testes aprovados em `/tmp/mordomo-draft-ui.log`. Build aprovado em `/tmp/mordomo-console-build.log`.
- E2E console + produto + prontidão: 8 aprovados em `/tmp/mordomo-console-e2e.log`. Inclui navegação/recarga, pasta inválida, login simulado e falha de índice simulada. Não comprova autenticação real.
- Gauntlet `index.failed`: antes, regressão falhou por evento terminal ausente (1 falha/19 aprovações); `/tmp/mordomo-index-terminal-before.log`. Gate posterior em `/tmp/mordomo-engine-latest.log`.

Próxima ação atualizada: finalizar gates da alteração `index.failed`, validar observador SSE e notificação, revisar transições/corridas E03 e matriz E01. Ainda faltam integração real autenticada, conector, projeto mobile identificado, corpus de capacidade e soak 2 h/8 h. Nenhum monitor prolongado iniciado; serviço pessoal 4777 ainda não reiniciado. Não reconstruir durante E2E. Logs em `/tmp` são efêmeros; evidências duráveis devem ser copiadas para `artifacts/execution-2026-09-06` antes da entrega.

## Checkpoint mais recente — fila e gate de navegador

- E03: espera por vaga agora é abortável. Cancelar uma tarefa aguardando capacidade remove seu listener/waiter, encerra a tarefa e não libera uma vaga que ela nunca adquiriu. Regressão por barreiras falhou antes (`queued` em vez de `cancelled`) e passou depois; `/tmp/mordomo-queue-before.log`, `/tmp/mordomo-queue-after.log` (22 testes focalizados aprovados, incluindo notificações).
- Navegador completo: 38 cenários aprovados, 18 falhas **por ausência de baseline macOS da galeria**. Não houve aprovação integral da suíte. Log `/tmp/mordomo-e2e-latest.log`. O novo teste de observador SSE comprovou indicador visível antes da falha e removido depois; transporte controlado, não conexão real com falha de indexação.
- As 18 imagens criadas automaticamente foram movidas para `artifacts/execution-2026-09-06/gallery-candidates/`; não adicionadas como referências aprovadas. Inspeção parcial de widgets/dialógos/Agora feita, revisão visual completa ainda pendente. Referências Linux existentes preservadas.
- Gate final motor após fila em `/tmp/mordomo-engine-final.log`; UI em `/tmp/mordomo-ui-final.log`. Conferir resultados antes de reportar contagens.

## Estado operacional final deste checkpoint (06/09, 22:07 BRT)

- **426 testes motor/API e 200 UI aprovados**. Build, typecheck, lint e `git diff --check` aprovados. Logs preservados em `artifacts/execution-2026-09-06/logs/` (a cópia substitui a dependência dos caminhos efêmeros acima).
- Correção adicional E03: erro ao ler configurações durante aquisição de slot agora encerra a tarefa como falha com diagnóstico. Antes, permanecia `queued`; teste reproduziu e comprovou nova execução bem-sucedida após recuperação. Aquisição está dentro do tratamento de erro, sem liberação de slot inexistente.
- **Serviço pessoal 4777 atualizado e reiniciado** após verificar zero running/queued/waiting_approval. O supervisor reiniciou automaticamente; o comando start detectou a instância nova, sem duplicá-la. PID observado 38628. Health real: DB aberto, scheduler ativo, zero tarefas/pendências. Artefato `artifacts/execution-2026-09-06/service-after-restart.json`.
- Provedores no serviço real: Claude instalado, auth falsa; Cursor instalado, auth falsa; Codex CLI não instalado. Nenhum prompt pago executado. Esses estados são do ambiente local, não da autenticação do aplicativo Codex que está executando esta tarefa.
- Runners e servidor de testes encerrados; permanece apenas o serviço pessoal gerenciado já existente. Nenhum soak iniciado. Imagens da galeria continuam candidatas não aprovadas; 38 E2E passaram, 18 referências macOS ausentes impediram aprovação integral.
- **Próximo passo exato:** concluir matriz fina E01 e tabela de transições E03, aprofundar cancelamento de árvore com SIGTERM ignorado, reconexão/terminal e idempotência de submissão; seguir E04 scheduler/restore em home isolado. Revisar 18 candidatas visuais antes de estabelecer referências macOS. Prosseguir E05 corpus e E06–E09 conforme dependências. E10 benchmark e E11 validação real das skills continuam pendentes. Não repetir correções/testes focais já evidenciados sem alteração nova.
- **Conclusão integral não atingida.** Também faltam critérios de capacidades/provedores reais, conector real, identificação/ensaio mobile, migrações/restore completo, presets/conflitos, contexto entre apps, perfis de recursos e soak 2 h/8 h previstos nos planos.

## Continuação após pedido de execução até terminar (06/09, 23h BRT)

- E03: reproduzido descendente resistente a SIGTERM que sobrevivia quando o pai fechava primeiro. `safeSpawn` finaliza o grupo POSIX de sua própria execução antes de descartar escalonamento. Nunca faz fallback para PID possivelmente reutilizado nessa limpeza. Teste real com processo Node/filho em `tests/core.spawn-tree.test.ts`; antes falhou, depois passou junto de segurança/runs. Windows não coberto por esse teste.
- E04: tentativas pertencem à configuração que criou a primeira execução. Edição, pausa, exclusão ou arquivo inválido interrompem novas tentativas, preservando a tentativa corrente e registrando motivo no histórico. Reload cancela o backoff correspondente. Três regressões por relógio controlado passaram.
- E04: restauração valida existência, integridade SQLite e versão suportada antes de tocar arquivos. Banco futuro é recusado também em `openDb`, que fecha o handle em falha. Testes comprovaram arquivos atuais preservados diante de banco ausente/corrompido e banco futuro byte a byte intacto.
- E08: preview ganhou “Usar no console”; revalida acessibilidade da fonte, acrescenta caminho citado ao rascunho, preserva projeto/sessão e abre foco sem executar. E2E 3/3 em `/tmp/mordomo-context-e2e.log`; unidade de fonte com aspas. Validação da fonte depois que usuário edita o rascunho ainda depende da execução; não há snapshot imutável do arquivo.
- E09 em implementação: seletor automático/imersivo/econômico em Aparência. Econômico: wallpaper estático, grafo limitado a 30 fps em movimento e 1 fps em repouso. Reduced motion do OS sempre prevalece; não altera motor/eventos. Typecheck passou; E2E do perfil ainda a executar.
- Gate motor atual: **433 testes / 46 arquivos aprovados**, `/tmp/mordomo-round-engine.log`. UI antes do perfil: 201 testes. Lint encontrou nome de handler parecido com hook (`useInConsole`), corrigido para `sendToConsole`; repetir lint após perfil.

### Processo prolongado ativo — NÃO ENCERRAR OU CONFUNDIR COM E2E

`node scripts/soak-api.mjs 480 60 4791`, PID **6715**, sessão exec **2063**, porta **4791**, home `tests/.tmp/soak-gDCcYJ`. Saída incremental: `artifacts/soak-gDCcYJ/manifest.json`, `samples.jsonl`, futuro `result.json`; stdout `/tmp/mordomo-soak-8h.log`. Iniciado 06/09 por volta de 23h; consultar manifest para instante exato. Encerramento automático após 8 h; SIGTERM fecha servidor e registra ensaio incompleto. Não remover o home enquanto estiver ativo.

Escopo: API/SQLite reais com 100 arquivos sintéticos, busca e indexação incremental, nenhum provedor/conector externo/browser. CPU/memória do processo incluem o driver local. Não substitui E12 completo. Teste curto do coletor passou em `artifacts/soak-txtXYi/`. Lacunas longas por suspensão são registradas e impedem `passed`. O serviço pessoal permanece na 4777; E2E na 4788; não reutilizar 4791. Código já carregado no processo é o da inicialização; alterações posteriores não ganham evidência retroativa desse soak.

## Retomada 07/09 — não usar o estado de processo anterior

O ensaio `soak-gDCcYJ` **encerrou incompleto**: 5.623.331 ms (~94 min), 89 amostras, zero falhas de saúde/busca, 1 lacuna longa, `interrupted: true`, `passed: false`. Não está mais ativo. Causa externa do sinal não determinada; não atribuir a crash do produto. Resultado persistido no próprio diretório. Logs de `/tmp` de ontem desapareceram; usar cópias duráveis quando disponíveis.

- E07: teste de hook reproduziu reenvio indevido do layout confirmado ao desmontar o desktop; timer agora é limpo após disparo. Teste passou.
- E07: API aceita `dashboardLayoutBase` opcional e recusa escrita divergente com 409 `layout_conflict`. UI serializa suas mutações, preserva rascunho local em conflito e exige escolha explícita de carregar remoto ou salvar local. Clientes legados sem base continuam compatíveis. Teste API concorrente e E2E com escrita concorrente real aprovados (`api.layout-conflict`, `layout-conflict`).
- E07: layouts nomeados implementados em `LayoutPresets.tsx`, chave local individual por preset, versão 1, atualização entre abas por storage event, normalização à viewport ao aplicar. Validação E2E ainda em curso; não declarar aprovada antes de consultar resultado.
- E09: perfil econômico passou nos quatro E2E junto do contexto de console; typecheck/lint/build aprovados antes das alterações E07. Gate novo necessário após presets.
- E10: comparação documental reconsultada e decisões aplicadas registradas em `docs/execution-2026-09-06/benchmark.md`. Sem execução de concorrentes, sem benchmark comparativo de RAM/velocidade.

## 07/09 — execução concentrada, validação consolidada ao final

**Instrução vigente do usuário:** priorizar implementação e deixar testes para o final. Não executar testes a cada incremento; manter gauntlet/revisão e gates finais pendentes, sem tratar código novo como validado.

- E07: layouts nomeados passaram junto do smoke: 21 E2E, incluindo sete superfícies axe, antes dessa mudança de estratégia. Na jornada foram corrigidos Escape quando o botão focado fica desabilitado (listener do diálogo no documento respeitando a pilha) e barra de edição coberta pelo dock (área inferior reservada). Log `/tmp/mordomo-presets-smoke.log`; copiar para artefato durável no fechamento.
- E08 implementado nesta passagem: token de preview invalidado também ao desselecionar e desmontar. Resposta de arquivo antigo não deve reabrir painel fechado. Regressão `tests/e2e/brain-context.spec.ts` já reproduziu falha antes; não foi reexecutada após correção, conforme instrução atual.
- E08: `navigationSnapshot.ts` guarda filtros/seleção pelos codecs existentes e câmera em sessionStorage versionado por aba. Restaura ao entrar em `/brain` sem parâmetros; deep links explícitos prevalecem. Câmera validada numericamente e zoom limitado. Estado salvo em saída/desmontagem/pagehide. Sem adicionar conteúdo de arquivos ao armazenamento.
- E08: painéis legenda/lista/controles preservam abertura/retração na mesma aba por `usePanelPreference`. Storage indisponível mantém controles operacionais. Não há garantia de persistência quando navegador bloqueia armazenamento.
- Revisão de contrato: preferências de painel são independentes de links compartilhados; câmera é contexto local, não parte da URL; nenhuma restauração dispara execução. Histórico semântico interno de voltar/avançar ainda requer aprofundamento. Seleção removida do índice e recuperação de contexto com mudanças externas precisam de cobertura no gate final.
- **Nenhum teste/build executado para estas últimas alterações E08.** Próxima validação consolidada deve incluir typecheck/lint, brain-context, navegação com filtros/zoom/seleção → console → retorno, deep link sobre contexto salvo, storage inválido/bloqueado e restauração de painéis; depois gates globais proporcionais.
- Próxima implementação: E03 identidade/idempotência de submissão (rota `/api/runs` ainda cria a cada POST; revisar persistência atômica antes de alterar), histórico de navegação E08 e rastreabilidade dos critérios restantes. Soak anterior continua interrompido; nenhum novo runner prolongado iniciado. Serviço pessoal ainda não recebeu estas últimas alterações.

## 07/09 — motor, retorno entre apps e revisão consolidada (continuação)

- E03: migração SQLite **12**, tabela `prompt_submissions`, UUID opcional nas rotas de prompt/continuação. Recibo durável impede duplicação no replay inclusive após reinício; mesmo UUID com conteúdo diferente → 409; reserva sem recibo → resultado incerto, consultar histórico. Console conserva UUID na sessão do browser e bloqueia envio síncrono duplo. Contrato/limitações/reversão em `docs/execution-2026-09-06/submission-and-navigation.md`.
- E03/E04: rotinas não repetem automaticamente escrita que pode ter tido efeito parcial, nem falhas reconhecidas de autenticação/permissão/orçamento. Leitura mantém política limitada. Hint do formulário atualizado; classificação textual ainda não equivale a erro estruturado de todos os provedores.
- E04: restore prepara todos os arquivos em `.restore-*` antes de publicar, troca por rename e desfaz em ordem inversa se uma troca falhar. Se rollback falhar, preserva staging e informa backup de segurança. Não é atomicidade contra corte de energia entre várias renames; encerramento abrupto ainda exige recuperação pelo snapshot. Regressões injetam falta de espaço durante cópia e falha durante publicação; dados atuais e DB preservados.
- E08: histórico de seleção usa push; ajustes contínuos usam replace. Sincronização URL/UI em layout effect evita corrida de retorno; snapshot usa último parâmetro confirmado. Preview tardio não reabre seleção fechada. Em desktop >=1100px lista e preview ficam lado a lado; em tela estreita mantém alternância existente.
- **Gates atuais:** motor/API **438/438** (48 arquivos), UI **202/202**, build/typecheck/lint aprovados. Logs duráveis em `artifacts/execution-2026-09-07/logs/`; atualizar cópias com últimas execuções ao fechar.
- Navegador: passagem inicial sem galeria **41 passaram/3 falharam**. Falhas corrigidas: lista escondida pelo preview; isolamento de idioma/layout de fixture; corrida no retorno do cérebro. Repetição: conflito em **dois contextos reais** + presets + preview passaram (3/4); último brain-context **2/2** passou, incluindo histórico → Pixel → cérebro. Não somar repetições como cenários distintos.
- Galeria: 18 referências macOS geradas e inspecionadas visualmente em 07/09. São candidatas: inspeção revelou contraste insuficiente em badges/avisos do tema claro. Novo teste `gallery-contrast.spec.ts` reproduziu oito nós abaixo de 4,5:1. Tokens `--ok`, `--warn` e contraste derivado do acento claro corrigidos; **contraste 2/2 aprovado**. É necessário atualizar SOMENTE referências afetadas após inspeção e repetir comparação sem update. Galeria é de componentes/fixtures; não certifica todas as páginas, estados de modal aberto ou contraste integral do app.
- Coletor soak melhorado para hash de todos os bundles API/core/adapters, CPU por núcleo e volume SQLite incluindo WAL/SHM. Ainda NÃO iniciado novo soak. Gate anterior de 94 min permanece incompleto. Falta hash do lock no manifesto (adicionar antes de iniciar).
- Próximos passos locais: concluir referências visuais claras corrigidas; capacidade 100/1.000/10.000 arquivos e métricas por perfil; revisar matriz C01–C12 e completar critérios locais; ensaio prolongado 2h/8h conforme protocolo. Não reconstruir enquanto um E2E usa o bundle. Confirmar processos no momento da retomada; sessões recentes já encerraram (brain 40989, galeria 98160, contraste 21687).
- Serviço pessoal 4777 ainda NÃO atualizado para a migração 12/últimas correções. Antes de atualização: backup + zero execução ativa + migração em home isolado (motor cobre migration e recibo após reinício); atualização continua autorizada.
- Bloqueios externos inalterados: Claude/Cursor sem autenticação comprovada, Codex CLI ausente na última sondagem; nenhum conector real identificado; nenhum caminho/cenário mobile informado. Não declarar conclusão integral.

## Retomada 08/09 — evidências obtidas após o checkpoint anterior

- Galeria macOS: 18 referências inspecionadas; tema claro corrigido por contraste, referências afetadas atualizadas e reinspecionadas. Comparação normal **20/20** (18 snapshots + 2 contraste), sem update. Log `/tmp/mordomo-gallery-final.log`.
- Capacidade: 100/1.000/10.000 arquivos, três passagens reais API/SQLite, resultados/limitações em `docs/execution-2026-09-06/capacity.md`. Coletor `scripts/capacity-api.mjs`; homes de carga removidos. Não é teste de frames.
- Renderer: ensaio de **6,1 min** aprovado, cinco min aquecimento, três amostras por perfil. Mediana de tempo de tarefas: imersivo 5,13% de um núcleo, econômico 2,37%; listeners 269. Heap variou, não prova platô/ausência de leak. Artefato `artifacts/execution-2026-09-07/render-resources.json`.
- C05: `backup-restore.spec.ts` **1/1**: snapshot → home temporário esvaziado → restore → navegador abriu fonte e API recuperou sessão; quick_check ok. Porta 4794 e home de teste encerrados/removidos.
- C06: novo erro `source_missing` 404 para fonte removida, orientação localizada no preview/console. `api.memory-rename.test.ts` confirma rename, busca/grafo convergentes e preview antigo inválido. Primeira asserção usava realpath em contrato lexical macOS; corrigida para caminho configurado. Teste focal **1/1** passou.
- C02: `api.submission.test.ts` acrescenta consulta de pendências e duas decisões concorrentes; uma execução apenas. Última suíte teve **439 aprovados + 1 falha de fixture de caminho**, corrigida e aprovada depois. Próximo gate global deve fechar **440 testes** sem falha; não relatar ainda uma passagem global 440/440.
- Prontidão pessoal consultada: saudável, zero execuções/filas/aprovações; Claude/Cursor não autenticados, Codex CLI ausente. Artefato `personal-readiness.json`. Serviço pessoal não reiniciado/atualizado nesta rodada.
- Documentos novos: `acceptance.md` (matriz honesta, atualizar C02/C05/C06 após evidências acima), `workspace-guide.md`.
- Última ação bloqueada pela revisão automática: E2E adicional de câmera/filtros, por **limite de uso** do revisor. Nenhum contorno realizado. Usuário pediu continuar em 08/09; teste agora escrito em `brain-context.spec.ts`, ainda precisa executar. O comando rejeitado anteriormente não chegou a escrever nem executar esse teste.
- Todos os runners anteriores concluíram. Nenhum novo soak iniciado; 2h/8h e suspensão real continuam pendentes. Próximo passo: validar câmera/filtros; consolidar UI/contraste/zoom; fechar lacunas locais, backup e atualização pessoal após confirmar ocioso; iniciar observação prolongada dentro do escopo autorizado.

## 08/09 — continuação: reflow, orçamento e gate global

- C08: `brain-context` passou **3/3**, incluindo zoom/busca/seleção ao sair e voltar. Reset da câmera tem rótulo próprio, distinto de reset geral dos filtros.
- C12: `desktop-reflow` reproduziu controles do cérebro interceptando clique no reset de câmera a 720×450 CSS. Corrigido com toolbar horizontal e altura reservada para painel; legenda também foi elevada acima da navegação inferior e limitada com scroll. Teste passou, screenshot `artifacts/execution-2026-09-07/reflow-200-equivalent.png` inspecionado. Isto equivale ao espaço de layout de 200%, não testa menus de zoom nativo.
- Primeiro gate desta retomada: **440 motor/API + 202 UI**, typecheck/lint/build passaram; navegador **65 passaram, 2 falharam, 2 opcionais pulados**. Duas falhas decorreram de idioma compartilhado alterado por reflow; teste passou a interceptar somente meta no próprio contexto. Segunda passagem em andamento (sessão 60064); não reconstruir durante E2E.
- E03: achado real de orçamento: somente gasto final era descontado, permitindo reservar o mesmo saldo em tarefas concorrentes; retry reutilizava teto antigo; skill aprovada não recebia teto no claim. Corrigidos os três contratos. `committedTodayUsd` preserva reservas ativas através da meia-noite; custo desconhecido após iniciar mantém reserva no dia; cancelamento antes de começar libera. Labels explicam limite de admissão, não promessa de cobrança externa. Decisão em `submission-and-navigation.md`.
- Segundo gate motor: **443/443** passou, incluindo três regressões novas de reserva/concurrency. UI **202/202**, typecheck/lint/build também passaram antes da repetição E2E. Logs `/tmp/mordomo-{engine,ui,typecheck,lint,build,e2e}-final.log`.
- Novo ensaio `workspace-soak.spec.ts`: API/SQLite e navegador reais, provedor fake, indexação/execução/SSE terminal/navegação/rede offline/reabertura de aba. Smoke explícito 0,1 min **1/1** passou. Ainda NÃO iniciado 2h/8h; smoke não conta como estabilidade prolongada.
- Escrito adicionalmente (ainda sem executar): `api.recall-quality.test.ts`, quatro perguntas portuguesas com ambiguidade de domínio + ausência de resposta; `surface-contrast.spec.ts`, oito rotas × claro/escuro. Executar após runner atual concluir; corrigir achados antes de iniciar soak. Não incluídos no gate já iniciado.
- Serviço pessoal 4777 ainda sem atualização para os últimos bundles. Backup pela API antiga antes de qualquer CLI que abra/migre o DB; confirmar ocioso, atualizar e verificar saúde depois de fechar gates locais. Dependências externas anteriores permanecem.

## 08/09 — lote de implementação solicitado, validação adiada até o final

Fonte atual diverge dos bundles do serviço pessoal e do soak anterior. Nenhuma validação deste lote executada ainda.

- Processo POSIX: novo `spawn/guardian.ts`, líder do grupo com lease IPC da API. API encerrada abruptamente → desconexão → TERM/KILL do próprio grupo, sem recuperar PID histórico. Saída normal do provedor é reportada pelo canal privado antes de limpar descendentes. Windows permanece caminho anterior; processos que deliberadamente escapam do grupo não equivalem a isolamento de contêiner. Recuperação de registros antigos permanece conservadora.
- Histórico: filtros de grupo de status/provedor e ordenação aplicados no banco ANTES de paginação, ordem estável por timestamp/id; consulta de 51 registros permite mostrar 50 sem uma página vazia adicional. Migração 13 adiciona índices correspondentes.
- Notificações: migração 13 adiciona message_key/params, redigidos e limitados; produtor preserva dados estruturados de índices, orçamento, execução, sentinelas e sugestão de skill. UI traduz código/params, mantém fallback para legado e conteúdo autoral. Evento notification.created passou a ser recebido pelo shell; reconexão recarrega caixa e incorpora marcação de leitura do servidor. Eventos persistidos não geram duplicata local. Notificações de sistema/voz usam texto traduzido.
- Cérebro: fonte desaparecida explica ausência e oferece atualizar/fechar, preservando câmera/filtros; clipboard só confirma sucesso após Promise resolvida.
- Modais: foco inicial ignora campos ocultos/inertes/desabilitados, ações quebram linha; em tela baixa/estreita cabeçalho/ações permanecem acessíveis com scroll.
- Próximo: encerrar/preservar o ensaio dos bundles anteriores se ainda ativo antes de qualquer build; revisar tipos/lint, motor e UI, regressões de guardian, filtros globais/escala, notificações, modais e fonte removida. Só publicar no serviço pessoal após validação e novo backup. Soak deve identificar a nova versão; resultados anteriores não são retroativos.

### 09/09 — correções surgidas na revisão final

- Leitura de notificações passou a emitir evento para atualizar outras janelas; quick-run do histórico usa UUID persistido próprio, bloqueio síncrono de duplo envio e não apaga uma edição feita durante a submissão.
- Supervisor preserva falha de spawn, além do resultado do provedor. Shutdown captura o encerrador do handle vivo, em vez de resolver/matar um PID numérico depois. Não sinaliza grupo após close.
- Achado reproduzido na jornada de fonte removida: `EventBus.emit` reentrante entregava `notification.created` (ID maior) antes do `index.finished` original; cursor SSE descartava este último. Corrigido despacho FIFO com fila de emissões aninhadas. Regressão `core.event-order` reproduz exatamente o descarte pelo cursor.
- Modal New Skill em viewport baixo tinha dica a 3,73:1; dicas em modais agora usam `--text-dim`. Cabeçalho/ações e foco continuam na implementação do lote.
- Gate anterior à última correção: 446 motor + 203 UI passaram. Browser em execução sessão 5407: duas falhas novas motivaram as correções acima; não declarar gate aprovado ainda. Aguardar término antes de rebuild, depois gate consolidado final. Nenhum soak ativo.
