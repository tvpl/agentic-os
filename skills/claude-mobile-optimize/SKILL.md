---
name: claude-mobile-optimize
description: Diagnostica lentidão e consumo de RAM do Claude Code em projetos mobile, separando contexto, MCP, watchers, builds e simuladores. Aplica ajustes reversíveis medidos quando solicitados.
triggers: [/claude-mobile-optimize, otimizar Claude Code mobile]
providers: [claude]
mode: write
enabled: true
version: 1.0.0
guardrails:
  - Não encerrar processos de outros projetos nem apagar caches globais.
successCriteria:
  - Diagnóstico e comparação antes/depois, ou limitação da medição, registrados.
---

# Otimizar Claude Code e ambiente mobile

Trabalhe no projeto indicado pelo usuário. Se o pedido for apenas diagnóstico, não altere configurações. Leia [o roteiro mobile](resources/mobile.md) somente se houver React Native/Expo, Flutter, Android ou iOS.

1. Estabeleça uma linha de base: sistema/RAM, versão do Claude, stack do projeto, duração do comando lento, RSS/CPU e árvore de processos relevantes. No macOS use `memory_pressure`, `vm_stat` e `ps -axo pid,ppid,rss,%cpu,etime,comm`; não colete argumentos completos, variáveis de ambiente ou credenciais. Registre horário e unidades (RSS em KiB). Observe duas amostras curtas; RAM virtual não é RSS.
2. Separe evidências: processo Claude, MCP, Metro/Watchman, Gradle/Kotlin, Dart, Xcode, simuladores. Compare a mesma operação antes/depois. Contexto grande consome tokens e pode aumentar latência, mas não prova a origem da pressão de RAM.
3. Inspecione apenas instruções/configurações relevantes: CLAUDE.md, regras, skills, hooks, MCP habilitados e comandos de desenvolvimento. Não abra `.credentials.json`, `.env`, chaves ou bancos de sessão. Peça o resumo de `/context` se a interface interativa não estiver acessível; não invente métricas de contexto.
4. Aplique a menor mudança que trate uma causa observada. Prefira buscas delimitadas, saídas curtas, referências sob demanda, um bundler por projeto e testes focados. Não crie limites arbitrários de memória, não desligue segurança/testes e não modifique configurações globais para resolver um único projeto.
5. Antes de encerrar processos, identifique PID, dono e relação com o projeto; só pare processos iniciados nesta tarefa ou cuja interrupção foi autorizada. Nunca use `killall`, limpeza global do Watchman, remoção geral de caches ou encerramento de simuladores de outros projetos.
6. Preserve diffs locais, faça backup das configurações alteradas e registre a reversão. Reexecute o cenário original. Se não houver melhora mensurável, reverta a tentativa ou explique por que a medição é inconclusiva; não prometa ganhos percentuais.
7. Entregue um relatório curto com causa/evidência, alterações, medição antes/depois, comandos de reversão e limitações. Use o diretório de artefatos fornecido pelo OS; fora dele, um arquivo no projeto quando útil.

Para sessões extensas, registre um checkpoint enxuto (objetivo, decisões, diff, verificações pendentes) antes de compactar/recomeçar. Não acumule o histórico inteiro em CLAUDE.md. Consulte a documentação oficial para flags ou configurações dependentes de versão.
