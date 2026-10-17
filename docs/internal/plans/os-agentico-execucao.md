# Roteiro de aprofundamento, execução, revisão e refino

Revisão 2 · 06/09/2026 · Planejado. Complementa o [plano principal](os-agentico-conclusao.md). Os pacotes abaixo organizam as tarefas F0–F7; não representam outra lista independente de entregas.

## 1. Procedimento para cada pacote

**Entrada.** Leia requisitos, diffs locais, contrato atual e evidência anterior. Localize os arquivos reais; caminhos citados no plano são pontos de entrada, não autorização para alterar todos eles. Registre ambiente e estado do código; se houver diff não commitado, gere identificação do conteúdo para relacionar testes à versão efetivamente testada, sem gravar conteúdo sensível.

**Aprofundamento.** Trace uma jornada completa: controle → handler → estado/cache → requisição → motor → persistência → evento → renderização. Inspecione quem cria, atualiza e descarta cada recurso. Reproduza o defeito ou a limitação. Separe fato observado, hipótese e decisão proposta. Para afirmações sobre CLIs ou terceiros, confirme versão e documentação oficial no momento de executar.

**Proposta.** Escreva uma nota curta apenas para mudanças que envolvam contrato, persistência, concorrência ou interação nova. Inclua causa, proposta mínima, alternativa viável, impacto, compatibilidade, falhas possíveis e teste que refutaria a solução. Correções locais simples podem registrar isso no próprio cartão, sem documento adicional.

**Revisão antes do código.** Faça uma passagem separada pelas lentes de produto, arquitetura/dados, operação e verificabilidade. A proposta resolve a jornada? Duplica uma abstração? Tem estado sem saída? Preserva dados? Depende de uma suposição não testada? Os critérios permitem um falso positivo? Corrija problemas bloqueantes antes da implementação afetada. A revisão não exige outro agente e não será chamada de independente quando feita pelo mesmo executor.

**Implementação.** Prefira incrementos verticais: interface, contrato e comportamento real funcionando juntos. Evite controles decorativos sem ação e backends sem forma de recuperação no produto. Não acrescente dependências para tarefas simples sem justificar custo e manutenção. Preserve diferenças legítimas entre provedores; evite uma interface genérica que prometa capacidades ausentes.

**Gauntlet.** Rode a menor verificação comportamental útil; revise o diff; injete falhas relevantes; corrija; repita verificações afetadas. Depois execute os gates de integração do pacote. Testes não são substituídos por logs de sucesso. Screenshot não comprova persistência; mudança de URL não comprova navegação; fixture não comprova conta real.

**Saída.** Atualize rastreabilidade, notas de decisão, resultado e limitações. Só marque concluído após verificar os critérios associados. Se um contrato mudar durante implementação, volte à revisão dessa proposta e atualize testes/dependentes. Continue o próximo pacote desbloqueado; não encerre a execução inteira por uma dependência de conta que afeta apenas um cenário.

## 2. Pacotes executáveis e ordem

### E01 — Inventário e protocolo de medição (F0, início de F3)

1. Conferir git, comandos de build/test, configuração do serviço e isolamento dos testes. Ler relatório anterior e reproduzir um fluxo corrigido por print para estabelecer continuidade.
2. Montar matriz por ação com rota, controle, handler, API, persistência e feedback. Incluir ações via teclado, botões de widget e launcher, evitando duplicatas de cobertura.
3. Classificar capacidades: existente e validada, existente não validada, parcialmente implementada, ausente ou indisponível no ambiente. Não confundir ausência de evidência com ausência de funcionalidade.
4. Preparar fixtures e coletor conforme seção 4; medir antes de alterar desempenho. Estimar esforço por pacote somente após esse inventário, informando incerteza e dependências.

**Saída:** matriz e baseline; lista de contratos que precisam de decisão; primeiros achados priorizados. **Revisão:** confirmar que cada requisito original tem cobertura e nenhum ponto já resolvido foi reiniciado sem motivo.

### E02 — Prontidão e recuperação de provedores (F1.1–F1.3)

1. Seguir detecção/autenticação de cada adaptador até indicadores do desktop e Settings. Conferir se a sondagem usa rede, custo, cache ou dados que possam estar desatualizados.
2. Propor estados com fonte, instante de verificação e capacidade verificada. “Autenticação desconhecida” deve ser diferente de “válida” e “inválida”. Não verificar login a cada render.
3. Padronizar resposta de erro interpretável pela UI, preservando diagnóstico técnico redigido. Associar ações de copiar comando, verificar novamente e abrir configuração.
4. Manter rascunho e execução com falha durante recuperação. Após reautenticar, oferecer ação explícita de nova tentativa com vínculo à original; não duplicar ações já efetuadas.
5. Testar expiração simulada; depois executar a jornada real quando a conta estiver pronta. Para rate limit/rede, usar falhas simuladas, sem provocar abuso da conta.

**Aceite específico:** indicador nunca confunde instalação com autenticação; nova verificação atualiza todas as superfícies; a recuperação não dispara tarefa automaticamente. **Evidência real:** versão da CLI, passos, IDs de execução, resultado e custo disponível, sem credenciais.

### E03 — Execuções, streaming e aprovação (F2.1–F2.3, F2.6–F2.7)

1. Derivar tabela de transições do `runManager`, incluindo guardas, efeito em slots, eventos, timestamps e sessões. Ler `recoverInterrupted` antes de propor retomada: há mecanismo existente de interrupção após reinício.
2. Definir identidade de submissão, tentativa e execução; testar dois envios simultâneos da mesma ação. Se for necessária idempotência, definir escopo, retenção e comportamento para payload diferente com mesma chave.
3. Usar fixture com barreiras determinísticas: bloquear início/fim, liberar duas operações em ordem conhecida e provocar cancelamento na fronteira. Evitar depender de sleeps arbitrários para reproduzir corrida.
4. Forçar desconexão antes/depois de evento terminal e aprovação. Reconciliar snapshot com eventos; nunca recriar execução por reconectar o stream.
5. Conferir árvore de processos antes/depois de cancelamento e shutdown. Injetar filho que ignora SIGTERM em ambiente isolado e validar escalonamento e limpeza dos timers.
6. Diferenciar evento de transporte repetido de efeito de negócio repetido. Definir política para aprovação expirada, terminal já gravado, sessão excluída e ferramenta com resultado incerto.

**Aceite específico:** um terminal por execução; nenhuma liberação dupla de slot; nenhuma aprovação reutilizável fora do seu escopo; reconexão preserva resultado; estado impossível gera diagnóstico, não UI eternamente carregando.

### E04 — Rotinas, persistência e recuperação (F2.4–F2.5)

1. Descrever linha do tempo de uma rotina: horário previsto, decisão de disparo, execução, tentativa e histórico. Definir política de atraso e sobreposição antes de modificar scheduler.
2. Testar relógio controlado para virada de dia, timezone com mudança de horário, horário inexistente/duplicado e múltiplos horários perdidos. Separar estes casos de uma suspensão real do macOS.
3. Testar editar/pausar/excluir enquanto enfileirada, executando e em backoff. Definir destino da execução corrente e impedir disparos futuros incompatíveis.
4. Inventariar o conteúdo real do backup: banco, arquivos, configurações e referências externas. Documentar o que fica fora; credenciais externas não são presumidas restauráveis.
5. Restaurar em home separado e conferir contagens, relacionamentos, amostras de conteúdo e abertura no produto. Validar migração com schema anterior e layout antigo; não abrir banco migrado em código anterior sem compatibilidade demonstrada.
6. Testar erro de escrita por injeção/volume isolado; não encher o disco pessoal. Plano de rollback deve incluir dados e código, não só reversão de commit.

**Aceite específico:** histórico explica cada horário perdido/disparo; recuperação não duplica efeitos; restauração é utilizável; migrações falham de forma recuperável.

### E05 — Memória e conectores com fonte verificável (F2.8, F1.4)

1. Rastrear índice → busca → recall → grafo → preview. Preservar a separação atual entre engine do grafo e renderização React; não mover física para estado global por conveniência.
2. Criar corpus com conteúdos conhecidos, links válidos/quebrados, nomes iguais em pastas diferentes, acentos e arquivos excluídos das raízes. Registrar fonte esperada por consulta.
3. Executar alterações incrementais e interrupção de indexação; verificar exclusões, dados obsoletos e reconciliação após reinício. Verificar retorno parcial de raiz inacessível sem apagar silenciosamente dados de raízes saudáveis.
4. Para recall, medir presença da fonte esperada nos primeiros resultados e validade do trecho/citação. Avaliar consultas sem resposta; resultado vazio pode ser o comportamento correto. Congelar exemplos e limiar de qualidade após baseline, antes de ajustar ranking.
5. Em conectores, distinguir resultado vazio, cache antigo, timeout e revogação. Mostrar origem e atualização na UI. Testar reconexão sem duplicar itens ou processos MCP.

**Aceite específico:** nenhum dado fora das raízes permitidas retornado nos cenários; citações resolvem para fontes corretas; atualizações convergem em prazo medido e documentado; uma falha de conector não bloqueia o restante do desktop.

### E06 — Contratos de interação e migração de mensagens (F4)

1. Especificar os estados de cada ação e sua recuperação antes de desenhar variações. Reutilizar botões, dialogs e APIs do projeto quando atendam ao contrato.
2. Migrar notificações por leitura compatível: novo evento estruturado, renderização por idioma e fallback para histórico legado. Testar texto antigo, chave desconhecida, parâmetros ausentes e destino excluído. Não reescrever todos os dados sem necessidade.
3. Definir propriedade do rascunho do console: sessão/projeto, vida útil, troca de provedor e múltiplas abas. Hoje há rascunho em sessionStorage; a nova proposta deve preservar o existente e resolver ambiguidade de contexto.
4. Auditar gravação/edição/exportação em cada app, inclusive mudança não salva e erro de persistência. Exibir êxito somente após confirmação da operação relevante.
5. Ampliar os E2E existentes com asserções de conteúdo, persistência e recuperação; adicionar contraste e foco a partir de falhas reais.

**Aceite específico:** não há perda silenciosa de edição ou troca silenciosa de projeto; cada erro central tem uma ação válida; idioma do sistema consistente em jornadas pt-BR.

### E07 — Workspace e janelas (F5.1–F5.2)

1. Modelar estados persistidos de layout/preset separados de estados temporários de maximização/foco. Definir “ocultar” versus “minimizar” e onde o usuário restaura cada um.
2. Definir hierarquia de foco e camadas: canvas, widgets, dock, popovers, launcher, dialogs. Apenas a camada interativa correta recebe teclado; fechar modal devolve foco ao invocador ainda existente.
3. Implementar uma jornada completa primeiro: minimizar console → abrir cérebro → restaurar console com rascunho → maximizar → voltar ao layout. Só depois generalizar aos widgets compatíveis.
4. Acrescentar presets e persistência versionada. Tratar duas abas editando layout: escolher e documentar detecção de conflito ou outra política compreensível, sem mesclar geometrias arbitrárias.
5. Encaixe deve respeitar tamanho mínimo, dock e viewport útil. Ao voltar de outro monitor, trazer controles para dentro da área visível; desfazer restaura a ação anterior e não um estado global antigo.

**Aceite específico:** nenhuma janela fica irrecuperável; conteúdo editável preservado; geometria antiga migra; teclado oferece caminho equivalente; salvar preset não altera outros perfis inesperadamente.

### E08 — Cérebro progressivo e contexto entre apps (F5.3, F5.7)

1. Especificar contrato de navegação com entidade selecionada, área/pasta, filtros, câmera e histórico. Definir qual parte pode ir na URL e qual é estado efêmero; não serializar dados privados em links sem necessidade.
2. Implementar percurso completo com voltar/avançar, zoom ancorado e preview. Alteração de filtro não deve deixar painel apontando para entidade inválida sem explicação.
3. Adotar níveis de detalhe a partir do perfil medido: grupos em visão ampla, rótulos quando legíveis, itens selecionados sempre identificáveis. Evitar otimização que torne nós desenhados impossíveis de clicar.
4. Implementar ação contextual “usar no console” com referência à fonte/projeto. Usuário revisa a composição antes de executar. Testar arquivo alterado ou removido entre seleção e envio.
5. Ligar execução → artefato e prompt → rascunho de skill/rotina quando coerente com os contratos existentes. Criar rascunho não agenda nem dispara tarefa.

**Aceite específico:** ida e volta preservam contexto; referências são resolvíveis; operação entre apps não dispara escrita sem intenção; dataset grande continua navegável pelo grafo e por alternativa em lista.

### E09 — Movimento, legibilidade e recursos (F3.3–F3.4, F5.4–F5.5)

1. Comparar telas reais com dados longos, vários estados de execução e idioma pt-BR. Definir tokens e densidade; remover exceções de CSS conflitantes quando houver evidência de duplicação.
2. Aplicar movimento aos eventos de abrir/fechar/trocar/encaixar, usando transform/opacity quando adequado. Não ligar um loop React à animação do canvas.
3. Perfis automático/imersivo/econômico precisam de comportamento enumerado: efeitos que mudam, coleta usada e prioridade de movimento reduzido. Só adaptar automaticamente com sinal confiável; oferecer override persistente.
4. Estado do agente deve vir dos contratos E02/E03. Reduzir animação não pode mudar status, frequência necessária de execução nem entrega de notificações.
5. Medir com e sem efeitos, em primeiro/segundo plano. Investigar custo de transições e frametimes altos, não apenas média de FPS.

**Aceite específico:** legibilidade e foco preservados; nenhum hit target bloqueado por efeito; desempenho atende protocolo; reaparecer após suspensão não acelera timers nem duplica streams.

### E10 — Benchmark e decisões externas (F6.1–F6.2; inicia após E01)

1. Selecionar perguntas que mudariam uma decisão local: recuperação, fila, memória, janelas ou diagnóstico. Consultar fontes oficiais fixando versão/commit.
2. Registrar uma evidência por afirmação e sua relação com um problema local. Comparar alternativas equivalentes; desktop de contêiner e painel web têm capacidades distintas.
3. Para decisão incerta de alto custo, executar prova curta isolada com critério de encerramento. Não instalar três sistemas só para ampliar o relatório.
4. Fechar decisão: adotar com tarefa e aceite; experimentar com hipótese; ou adiar com motivo e gatilho para reconsiderar.

**Aceite específico:** toda recomendação adotada tem problema, custo, risco, responsável funcional e ligação ao pacote afetado; nenhuma avaliação documental é apresentada como teste de produto.

### E11 — Skills como procedimentos verificáveis (F6.3–F6.4)

1. Escolher projeto e comando mobile lento, fixar condições e coletar baseline conforme seção 4. Exercitar a skill sem assumir que Claude é o maior consumidor.
2. Testar mudança mínima e reversível; se não melhorar, verificar comparabilidade antes de reverter ou investigar outra causa. Não limpar caches globais nem encerrar processos de outros projetos.
3. Executar gauntlet em um caso SDD e um prompt, acompanhando consumo de runners e qualidade dos critérios. Usar tarefa pequena com falha real de UI/integração, não desafio artificial que apenas reproduza a skill.
4. Refinar instruções e recursos a partir dos achados. Verificar a sincronização das versões local/global preservando customizações e registrar o que mudou.

**Aceite específico:** relatório prático antes/depois ou limitação identificada; nenhum ganho inventado; gauntlet não encerra como sucesso com gate pendente.

### E12 — Consolidação e entrega (F7)

1. Congelar a versão candidata e seu bundle. Conferir matriz e dependências; não preencher células sem evidência para obter 100%.
2. Rodar gates completos proporcionais às mudanças. Uma falha produz achado com reprodução; se for ambiental, corrigir o ambiente e repetir a verificação afetada sem retirar a asserção.
3. Executar 2 h e 8 h conforme seção 4; corrigir falhas e invalidar somente as evidências impactadas. Mudança no motor pode exigir repetir uso prolongado; ajuste de texto não implica automaticamente repetir oito horas.
4. Validar backup/migração/rollback e jornada real. Atualizar relatório de capacidade e guia de recuperação.
5. Encerrar com requisitos atendidos, pendentes, bloqueados, limites e evidências. Entrega parcial pode ser útil, mas não será chamada de conclusão integral.

## 3. Casos de aceite de referência

| ID | Preparação e ação | Resultado obrigatório | Evidência |
| --- | --- | --- | --- |
| C01 | CLI instalada, autenticação expirada, executar | Estado identifica autenticação; rascunho preservado; orientação válida; sem retry automático | E2E simulado + jornada real após login |
| C02 | Aprovação pendente, reconectar e aprovar duas vezes | Uma decisão efetiva; nenhuma nova execução por replay | Teste de contrato, histórico e eventos |
| C03 | Processo com filho resistente, cancelar | Terminal coerente; árvore encerrada conforme grace configurada; slots liberados uma vez | PIDs antes/depois + teste de motor |
| C04 | Rotina perde três horários com serviço offline | Política escolhida aplicada; histórico explica execução/skip; sem avalanche inesperada | Relógio controlado + histórico |
| C05 | Restaurar backup em home vazio | Dados previstos e referências utilizáveis; exclusões documentadas | Manifesto comparado + jornada no navegador |
| C06 | Renomear arquivo e reindexar | Busca/grafo/preview convergem; fonte anterior não aparece como válida | API + verificação de referência |
| C07 | Console com rascunho, minimizar/trocar app/reabrir | Texto e projeto corretos; foco acessível; nada executado | E2E de workspace |
| C08 | Zoom, filtrar, selecionar arquivo, abrir contexto, voltar | Câmera/filtros/seleção válidos; origem preservada | E2E + inspeção visual |
| C09 | Duas abas alteram layout | Política de conflito visível e determinística; layout recuperável | E2E com dois contextos da mesma origem |
| C10 | Conector revogado com dados em cache | Origem/idade e erro claros; restante do OS funciona | Fixture MCP + leitura real configurada |
| C11 | 100 ciclos após aquecimento | Recursos voltam a platô compatível; nenhum órfão; latências no orçamento | Séries temporais e manifesto do ambiente |
| C12 | Zoom 200%, pt-BR, teclado e movimento reduzido | Todas as ações centrais alcançáveis; foco e contraste corretos | E2E, axe e inspeção manual registrada |

Casos são pontos de partida. O executor deve aprofundá-los com os contratos encontrados e acrescentar cenários faltantes; não substituir os critérios das fases por apenas estes doze exemplos.

## 4. Protocolo de medição e uso prolongado

Registrar equipamento, energia/bateria, apps concorrentes, versão, dados, janela, escala, perfil visual e instrumento. Baseline e resultado devem usar condições equivalentes. Fazer três repetições curtas por cenário; guardar amostras, mediana e dispersão. Estimar p95 apenas com amostragem suficiente: pelo menos 100 interações equivalentes por cenário, sem misturar páginas/ações com custos distintos. Não usar o tempo do comando Playwright como latência percebida.

Medir input → primeiro feedback visível, navegação → conteúdo útil e carregamento frio separadamente. Para canvas, capturar intervalos de frames e tarefas longas durante pan/zoom; FPS em repouso ou aba oculta não é medida de fluidez. Medir custo da instrumentação e usar a mesma instrumentação na comparação. Percentual de CPU deve informar convenção por processo/núcleo. Memória: aquecer por ao menos cinco minutos ou até estabilização documentada; amostrar em repouso e após ciclos, registrando caches esperados e variação natural.

Limite de 10% do plano é alerta de investigação, não prova automática de leak. Exigir crescimento repetível e atribuição a recurso/processo antes de alegar vazamento; também investigar pequenas tendências persistentes que projetem excesso no uso prolongado. Resultados abaixo das metas iniciais exigem otimização ou decisão explícita sobre capacidade suportada, sem ajustar os números retroativamente para passar.

**Passagem de 2 h:** ciclos de execução simulada, indexação, navegação, espera e reconexão; coleta periódica; falhas graves encerram a carga e abrem investigação.

**Passagem de 8 h:** começar a partir de estado conhecido; alternar carga leve e repouso, incluir desconexão/reabertura e uma suspensão real quando o ambiente permitir. Registrar horário e estado antes/depois, incluindo suspensão do coletor. Ausência de amostras durante sleep não é “zero CPU”. Carga sintética pesada e chamadas reais não são necessárias durante todo o período. Retomar acompanhamento em sessões posteriores se preciso, preservando logs e checkpoint; nunca inventar horas não observadas nem agendar execução futura sem pedido correspondente.

Gerar relatório com versão testada, duração efetivamente observada, lacunas de coleta, workload, séries, falhas, custos conhecidos/desconhecidos e conclusão limitada ao cenário. Backup/restauração e cron determinístico continuam gates separados; um soak sem crash não substitui esses testes.

## 5. Revisão da proposta e controle de refino

Registrar decisões apenas quando há escolha relevante. Para cada uma: requisito, evidência, alternativas, escolha, hipótese ainda aberta, teste de refutação e gatilho para revisitar. Decisões iniciais obrigatórias: prontidão do provedor, semântica de retry, política de horários perdidos, persistência de layout/rascunho, conflito entre abas, navegação do cérebro e envelope de desempenho.

Um achado de proposta deve identificar premissa errada, cenário ausente ou risco concreto. Classificar em bloqueante para o pacote, ajuste local ou evolução futura. Resolver bloqueantes antes da mudança afetada. Evolução futura não pode conter requisito obrigatório do usuário apenas por ser trabalhosa. Revisão não exige unanimidade fictícia nem aprovação humana por padrão; o executor decide rotinas dentro do escopo e explica as escolhas.

Revisitar proposta quando houver: comportamento real incompatível, migração não reversível, falha de limite/acesso, perda de estado, regressão de desempenho, incompatibilidade com provedor ou achado no uso real. Atualizar contrato, dependências e critérios afetados. Não reiniciar as oito fases por um ajuste localizado.

Para retomar execução, manter um checkpoint curto com pacote atual, versão/diff, fatos, decisões, verificações válidas, último erro, processos iniciados e próximo passo. Não chamar o pacote de concluído com testes ainda rodando. Se houver bloqueio externo, registrar exatamente o dado/ação faltante e continuar o trabalho independente.

## 6. Organização das evidências e cartão de tarefa

Ao iniciar a implementação, criar um diretório de evidências por rodada. Versionar resumos e resultados sanitizados; manter logs volumosos/privados fora do repositório conforme a configuração existente. Não criar arquivos vazios que aparentem evidência.

Cartão mínimo:

```text
ID E__/F__ — título e estado
Requisito e jornada:
Baseline e reprodução:
Fatos / hipóteses:
Contrato esperado e cenários de erro:
Proposta / alternativas / decisão:
Arquivos e dependências afetados:
Revisão da proposta: achados e resolução
Implementação e compatibilidade:
Verificações: comando, versão, ambiente, resultado, caminho da evidência
Simulado / real / não executado:
Riscos, rollback e pendências:
Próxima ação ou aceite concluído:
```

Ao concluir cada marco, apresentar o resultado observado, mudanças relevantes e limite restante. O estado de conclusão depende desse cartão e dos gates; quantidade de código, número de testes e extensão do relatório não são critérios suficientes.
