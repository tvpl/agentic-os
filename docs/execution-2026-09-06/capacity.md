# Capacidade local — 07/09/2026

API/SQLite reais, três repetições em homes descartáveis, corpus sintético simples em português. Provedores desabilitados. Script `scripts/capacity-api.mjs`. Não é comparação de produtos nem recuperação semântica completa.

| Arquivos | Indexação fria (ms, intervalo das 3 passagens) | Busca exata aquecida p95 (ms, 100 amostras/passagem) | Construção de grafo (ms) | Nós retornados |
| --- | --- | --- | --- | --- |
| 100 | 24,7–25,4 | 2,11–2,45 | 3,72–3,94 | 100 |
| 1.000 | 65,6–68,2 | 1,88–2,10 | 18,27–19,30 | 1.000 |
| 10.000 | 670,7–694,1 | 1,87–2,19 | 59,73–60,93 | 4.000 |

Busca conferiu o caminho da fonte esperada em cada resposta. API aplica `maxNodes=4000`; os 10.000 arquivos continuam indexados, mas não são todos desenhados nessa resposta. A UI precisa usar filtros/busca para aprofundar o conjunto. Medir este limite no servidor não prova 60 fps no canvas.

Artefatos: `artifacts/capacity-1788826301096`, `capacity-1788826343626`, `capacity-1788826349991`, cada qual com manifesto e amostras. RSS/heap do coletor incluem caches de corpora anteriores; não usar para afirmar vazamento, platô ou teto de RAM. O manifesto registra ambiente e hash do lock; falta identificação completa de fontes nesses três artefatos, portanto são diagnóstico de capacidade desta rodada, não comparação final de versões.

Lacunas: arquivos longos/binários, ranking para ambiguidade/ausência de resposta, histórico de 10.000 execuções, medições de frames e processo do provedor. Ganhos da skill mobile só podem ser medidos com projeto/cenário identificado.

## Perfis visuais — renderer

Medição explícita de 6,1 minutos no Chromium headless, viewport 1440×900, cinco minutos de aquecimento, três janelas de dez segundos por perfil após recarga. `Performance.getMetrics` mede tempo de tarefas do renderer relativo ao tempo decorrido, em percentual de um núcleo; não representa CPU total da máquina/GPU.

- Imersivo: 5,07–5,21%, mediana 5,13%.
- Econômico: 2,30–2,57%, mediana 2,37%.
- Listeners: 269 em todas as seis amostras.
- Heap JS: variou entre 5,97 e 10,86 MB, sem GC forçado. Amostras após recarga não bastam para afirmar platô ou ausência de vazamento; houve uma amostra com dois documentos antes da coleta natural.

O perfil econômico reduziu o trabalho medido do renderer neste cenário. Isso não mede RAM do Claude, qualidade de execução de agentes, FPS sob pan/zoom ou uso prolongado. Artefato: `artifacts/execution-2026-09-07/render-resources.json`. Reproduzir com `MORDOMO_RESOURCE_BENCH=1 npm run test:e2e -- render-resources` e configurar `PLAYWRIGHT_CHROMIUM_PATH` quando necessário. O teste longo fica fora da passagem funcional de rotina.
