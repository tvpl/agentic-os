# Revisão e refino da proposta — revisão 2

06/09/2026. Revisão documental pelo mesmo executor, com leitura focalizada do código. Não é revisão independente nem validação da implementação futura.

## O que foi confrontado

Plano anterior, relatório da entrega, estrutura de testes, `Workspace.tsx`, engine `brain/engine/world.ts`, indexador, recall e pontos de recuperação de `runManager.ts`. A leitura confirma pontos de partida para a execução: modos em contexto com persistência local; engine do grafo separada de React; recuperação de execuções interrompidas; recuperação de memória com ranking determinístico. Isso não comprova correção de todos esses contratos.

## Achados da proposta e alterações realizadas

| Achado | Consequência se mantido | Refino aplicado | Verificação na execução |
| --- | --- | --- | --- |
| Fases descreviam o objetivo, mas pouco o percurso da investigação | Implementação por suposição ou refatoração excessiva | Roteiro exige trace ponta a ponta, reprodução e separação de fato/hipótese | Cartão de cada pacote deve apontar evidência da causa |
| Revisão adversarial concentrada no código final | Contrato inadequado poderia ganhar implementação antes de ser questionado | Revisão da proposta antes do código e revisão do diff depois | Decisões relevantes devem registrar achados e resolução |
| Sequência linear deixava diagnóstico de recursos e benchmark tarde | Otimização visual poderia aumentar custo ou duplicar soluções existentes | Medição começa em E01; benchmark E10 informa decisões antes da implementação afetada | Baseline identificada e decisões com fonte |
| Qualidade da memória tratada principalmente como navegação | Grafo bonito poderia recuperar contexto errado ou obsoleto | F2.8 e E05 incluem corpus, mutações e fonte/trecho esperados | Recall, busca, grafo e preview coerentes |
| Visão imersiva ainda centrada em janelas e efeitos | Aplicativos continuariam desconectados na jornada de trabalho | F5.7/E08 definem passagem de contexto e referências entre apps | Seleção no cérebro chega ao console sem disparar execução |
| Persistência não detalhava duas abas e escopo do rascunho | Perda de layout ou uso de contexto do projeto errado | E06/E07 exigem política explícita, migração e teste de conflito | Casos C07/C09 e migração de dados existentes |
| Metas de desempenho sem método suficiente | Comparações incomparáveis ou percentis sem amostragem | Protocolo fixa condições, amostragem, tempo de feedback e frames | Dados brutos e método junto da conclusão |
| Observação de 24 h podia parecer prova de scheduler correto | Cobertura enganosa de timezone, atraso e suspensão | Casos determinísticos e jornada real separados; 24 h condicional | Histórico esperado por cenário, não só ausência de crash |
| Backup/rollback pouco específicos quanto ao dado migrado | Reverter código poderia deixar dados incompatíveis | E04/E12 exigem inventário, restauração e compatibilidade de schema | Home restaurado utilizável e procedimento ensaiado |
| Sem procedimento explícito de retomada e bloqueio parcial | Trabalho repetido, processos órfãos ou encerramento prematuro | Checkpoint, registro de processos e continuidade em pacote desbloqueado | Evidência preservada, sem conclusão enquanto gate está pendente |

## Decisões deliberadamente deixadas para investigação

Esses pontos não têm resposta fundamentada apenas com a revisão documental. O executor deve aprofundá-los, decidir e registrar; não são perguntas obrigatórias ao usuário agora.

| Questão | O que investigar | Critério de decisão | Momento |
| --- | --- | --- | --- |
| Como verificar autenticação sem custo e sem sondagem excessiva? | APIs/CLI por versão, semântica da resposta e expiração | Melhor evidência disponível, estado desconhecido explícito, frequência limitada | E02 |
| Quais erros permitem retry? | Efeitos parciais, idempotência e retorno de cada adaptador/ferramenta | Não repetir resultado incerto de escrita; limitar falhas transitórias | E03 |
| O que fazer com horários perdidos? | Semântica atual, tipos de rotina e histórico esperado | Política compreensível por rotina, sem avalanche inesperada | E04 |
| Onde persistir presets e contexto de navegação? | Settings existentes, session/localStorage, escopo por projeto/dispositivo | Uma fonte de verdade por dado, migração compatível e restauração | E06–E08 |
| Qual teto de memória e dataset suportar? | Baseline da máquina, custo por nó/stream e pressão externa | Limite medido e honesto, com degradação útil | E01/E05/E09 |
| Introduzir infraestrutura nova? | Gargalo/limitação demonstrado e alternativa com código existente | Benefício comprovado maior que custo de manutenção e migração | E10 antes da mudança dependente |

## Parecer desta revisão

A proposta está mais acionável: possui investigação dirigida, pacotes relacionados às fases, casos de aceite, protocolo de medição e critérios de revisão/refino. Está pronta para iniciar E01 e aprofundar os primeiros contratos. Não está “aprovada tecnicamente” como se todos os contratos já tivessem sido demonstrados: a revisão de cada proposta é parte obrigatória da execução.

O próximo trabalho autorizado por uma solicitação de implementação deve produzir baseline e propostas dos pacotes iniciais, tratar achados críticos primeiro e avançar por incrementos verificáveis. A presente rodada alterou somente documentação de planejamento.
