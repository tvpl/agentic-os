---
name: gauntlet-loop
description: Executa ciclos limitados de implementação, revisão adversarial, correção e validação de tarefas com SDD ou prompts comuns, com evidências e critérios de saída explícitos.
triggers: [/gauntlet-loop, rodar gauntlet loop]
providers: [claude, cursor, codex]
mode: write
enabled: true
version: 1.0.0
guardrails:
  - Não repetir tentativas sem nova evidência nem declarar sucesso com gates pendentes.
successCriteria:
  - Critérios rastreados até evidências de validação e achados restantes explícitos.
---

# Gauntlet loop

Conclua o objetivo solicitado por ciclos de evidência, sem confundir passagem em testes com ausência absoluta de bugs. Respeite o escopo e o orçamento do usuário. O loop não autoriza publicação, mensagens, exclusão de dados ou execução paga fora do pedido.

1. Leia instruções locais e estado do git; preserve trabalho existente. Se houver SDD, extraia critérios da especificação e atualize rastreabilidade. Com prompt comum, derive critérios observáveis do pedido, incluindo estados de erro. Não produza uma especificação extensa sem necessidade.
2. Defina um cenário reprodutível para cada problema. Faça a primeira verificação antes da correção quando viável. Registre baseline preexistente e ambientes indisponíveis. Para UI, inclua clique real, conteúdo de destino, teclado, viewport e console do navegador; mudança de URL sozinha não prova navegação.
3. Implemente um conjunto coeso de mudanças. Rode o teste mais barato que pode refutá-las. Consulte [a matriz](resources/gates.md) para escolher gates pelo risco real.
4. Revise o diff adversarialmente: fluxo feliz, entradas inválidas, concorrência, cancelamento, autenticação, acessibilidade, contratos e recuperação. Registre achados concretos com severidade e reprodução. Use outro agente somente se disponível e autorizado; caso contrário faça uma passagem separada sem chamá-la de revisão independente.
5. Corrija achados relevantes e repita verificações afetadas. Acrescente regressão comportamental quando ela captura a falha. Nunca enfraqueça uma asserção para fazer o teste passar sem comprovar que o requisito mudou.
6. Saída: critérios atendidos, gates aplicáveis aprovados e nenhum achado crítico/alto aberto. Uma passagem final limpa é suficiente; não repita toda a suíte sem mudança nova. Como proteção contra repetição improdutiva, reavalie após três ciclos ou duas tentativas idênticas sem nova evidência. Isso limita a tentativa, não converte falha em sucesso: documente bloqueio, causa e próximo passo antes de encerrar.
7. Entregue mudanças, evidências de execução, riscos reais, pendências e rollback. Marque explicitamente testes não executados, fixtures e provedores simulados. Grave relatório no diretório de artefatos do OS, se fornecido; em uso direto no projeto, escolha um caminho curto e apropriado.

Se o usuário continuar ou ampliar o pedido, mantenha os critérios anteriores ainda aplicáveis. Não reinicie a investigação nem descarte evidência válida. Para poupar memória, mantenha somente um runner pesado e saídas resumidas com logs em arquivo; não gere processos de teste órfãos.
