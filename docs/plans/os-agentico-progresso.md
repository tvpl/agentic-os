# Checkpoint — execução do plano MordomoOS

Atualizado em 09/09/2026, 18:05 UTC. **Implementação do último lote publicada; conclusão integral ainda depende dos aceites abaixo.** Este arquivo é o estado vigente. Registros anteriores, inclusive processos já encerrados, estão em [histórico](os-agentico-progresso-historico-ate-2026-09-09.md) e não representam processos atuais.

## Entrega atual

- Serviço pessoal na porta **4777**, PID observado **47202**, atualizado em 09/09. Backup anterior à publicação: `config/backups/full-2026-09-09T09-34-25-410Z-vqkWtA`, com artefatos. Saúde, scheduler, integridade SQLite e migração 13 confirmados; zero execuções/filas/aprovações naquele instante. Evidência: `artifacts/execution-2026-09-09/{pre,after}-upgrade.json`.
- E03: guardian POSIX ligado ao ciclo de vida da API por IPC elimina grupo próprio após crash; encerramento usa closure da execução viva, sem sinalizar PID persistido possivelmente reutilizado. Regressão real de SIGKILL e descendente resistente passou. Grupos deliberadamente desacoplados por código hostil não são uma sandbox suportada.
- Histórico: filtros e ordenação aplicados globalmente em SQL antes da paginação, índices e contrato com 10 mil registros. Submissão rápida também possui recibo persistido contra duplicação.
- Notificações: chave/parâmetros estruturados, tradução, entrega ao vivo, reconexão e leitura entre janelas. EventBus agora drena emissões aninhadas em FIFO: corrige perda de index.finished no cursor SSE e atualização do grafo.
- Cérebro: fonte selecionada removida mostra recuperação sem perder zoom. Modais com foco visível, ações alcançáveis em tela baixa e contraste corrigido.
- Entregas anteriores preservadas: navegação/menu/microapps, Agora ocultável, console redimensionável/maximizável, dock/modos, presets, zoom/contexto do cérebro, recuperação de autenticação, orçamento concorrente, backup/restauração, índice consistente, benchmark e duas skills. Rastreabilidade em `docs/execution-2026-09-06/acceptance.md`.

## Verificações válidas do bundle publicado

- Typecheck, lint e build aprovados; **447/447 motor/API**, **203/203 UI**.
- Browser global: **83 passaram e 1 falhou** porque a asserção capturava zoom durante animação. Espera do teste corrigida; os **2 cenários focais passaram** (fonte removida/zoom e modal baixo com teclado/axe). Não apresentar como uma passagem global 84/84 nem somar repetições.
- Nenhum código de produção mudou depois desses gates. Somente o harness prolongado e documentação foram alterados nesta retomada.
- Logs preservados em `artifacts/execution-2026-09-09/logs/`. Testes com CLI fake não comprovam integração autenticada.

## Processo ativo — fechamento E12

- Sequência local limitada iniciada **2026-09-09 18:05:25 UTC** via `node scripts/workspace-endurance.mjs`.
- Exec session **18354**, coordenador PID **30284**; API isolada inicial PID **30288**, porta **4788**, home `tests/.tmp/e2e-home`.
- Artefatos: `artifacts/workspace-endurance-1788977125921/`. Consultar `status.json`, `120min.log`, `120min/{manifest,samples,result,assessment}.json*`; depois `480min/` se a etapa anterior for aprovada.
- Executa 120 minutos de ciclos; avalia duração, gaps, erros e crescimento das medianas de heap/listeners/documentos após aquecimento. Alerta >10% interrompe a sequência para investigação; não é prova automática de vazamento. Só então executa 480 minutos em home novo, alternando cinco minutos de atividade e cinco de repouso observado.
- API/SQLite/Chromium reais, fontes sintéticas e CLI fake. Sem chamadas pagas, sem suspensão real do macOS. Impressões de zero durante suspensão não são fabricadas; gaps invalidam a passagem.
- **Não aprovado enquanto estiver rodando. Não reconstruir bundles, não iniciar outro E2E e não reutilizar sua home/porta.** O script não cria automação, agendamento ou processo recorrente.
- O soak anterior `artifacts/workspace-soak-1788901107285` foi encerrado deliberadamente após ~40 minutos; não vale como 2h. Sessão 56080 não está ativa.

## Pendências e próximo passo exato

1. Acompanhar sessão 18354 e `status.json`. Se houver falha/alerta, ler artefatos, investigar causa e corrigir antes de nova passagem. Se completar, revisar séries e incorporar conclusão limitada ao cenário na matriz de aceites; não repetir todos os testes sem mudança que justifique.
2. C01/E02: última sondagem real confirmou Claude sem login, Cursor desabilitado/sem login e Codex CLI ausente. Jornada autenticada depende de login interativo. Não executar prompt pago para sondagem.
3. C10: falta conta/conector identificado para jornada real de acesso revogado e recuperação.
4. E11: falta caminho do projeto mobile e comando/operação lenta para medir a skill no caso real. Skills criadas e instaladas; não alegar redução de memória do Claude sem medição.
5. C04/E12: suspensão/retomada real do macOS não observada. Não suspender a máquina do usuário durante seu trabalho sem combinar o momento.
6. C12: teclado/axe e contraste padrão verificados; zoom nativo do navegador e cores personalizadas não têm cobertura integral. Ver limites na matriz.

Preservar o workspace sujo; não resetar, não atribuir todos os diffs à última rodada e não declarar ausência absoluta de bugs. Revisões feitas pelo mesmo executor não são independentes.
