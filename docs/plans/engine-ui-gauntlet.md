# Execução contínua — engine, motor, UI e animações

Atualizado em 12/09/2026. Este é o checkpoint canônico para retomada. Atualizar
este arquivo depois de cada reprodução, correção e gate. A análise de origem é
[`docs/analise-engine-ui-2026-09-12.md`](../analise-engine-ui-2026-09-12.md).

Estados: `[ ]` pendente · `[~]` em execução · `[x]` concluído com evidência ·
`[!]` bloqueado com causa registrada.

## Lote 1 — integridade e recuperação

- [x] **E1 · Especificação persistida da execução.** Preservar pedido completo,
  parâmetros e inputs; repetir sem usar `promptSummary`; continuar pela sessão.
  - Baseline: `RunDetail` repete e compõe follow-up com resumo de até 500 caracteres.
  - Aceite: prompt longo, input de skill e timeout são preservados; retry é ligado
    à origem; continuação usa a sessão existente; submissões são idempotentes.
- [x] **E2 · Serialização por sessão.** Impedir dois turnos simultâneos na mesma
  conversa do provedor, mantendo paralelismo entre sessões.
  - Baseline reproduzida em `artifacts/engine-review-2026-09-12/observations.log`:
    pico 2 para o mesmo `providerSessionId`.
- [x] **E3 · Admissão e orçamento centralizados.** Reservar custo para triagem e
  demais origens; representar custo desconhecido e limites informativos.
  - Baseline reproduzida: duas triagens de US$ 0,20 atingiram US$ 0,40 sob teto
    diário de US$ 0,25.
- [x] **E4 · Erros estruturados e recuperação.** Persistir código, categoria,
  recuperabilidade e incerteza de efeitos; mostrar causa e ação em todas as telas.
- [x] **E5 · Estado operacional coerente.** Distinguir fila, execução, aprovação,
  cancelamento, interrupção, falha e conclusão no motor e no núcleo visual.

## Lote 2 — trabalho durável

- [x] **E6 · Objetivos e etapas.** Modelo `projeto → objetivo → etapas → tentativas
  → evidências`, com sequência, dependências, paralelismo limitado e integração.
- [x] **E7 · Checkpoints e retomada.** Reenfileirar somente trabalho comprovadamente
  não iniciado; reconciliar efeitos incertos; preservar próxima ação e bloqueio.
- [x] **E8 · Planejamento por recursos.** Prioridade, envelhecimento, capacidade do
  adapter, sessão e conflitos de workspace em um serviço de admissão.
- [x] **E9 · Entregas verificáveis.** Separar processo finalizado de entrega
  verificada; manifesto com hashes, checks e mudanças atribuíveis à execução.
- [x] **E10 · Contexto do OS.** Pacote inspecionável por etapa com fontes, versões,
  decisões, pendências, orçamento e política de retenção.
- [x] **E11 · Eventos explicáveis e backpressure.** IDs de ferramenta/etapa/tentativa,
  início/fim/duração/resultado; filas de stream e SSE limitadas.

## Lote 3 — experiência integrada

- [x] **U1 · Agora orientado ao trabalho.** Bloqueios e ações do trabalho antes de
  onboarding opcional; primeiro sucesso útil como marco.
- [x] **U2 · Composição responsiva à altura.** Console e trabalho atual preservados
  em 1280×720; conteúdo decisivo sem ficar reduzido a cabeçalhos.
- [x] **U3 · Detalhe de execução.** Resultado/bloqueio/ação e verificações primeiro;
  timeline técnica progressiva.
- [x] **U4 · Contexto entre telas e grafo causal.** Fontes, decisões, etapas e
  artefatos preservados entre cérebro, console e execução.
- [x] **U5 · Semântica de movimento.** Estados persistentes, transições breves,
  equivalência com movimento reduzido e orçamento comum de renderização.
- [x] **U6 · Validação final.** Jornadas completas, acessibilidade, viewports,
  desempenho, build, suites e revisão adversarial do diff.

## Diário de ciclos

### Ciclo 0 — baseline

- Análise de código, serviço local e UI registrada em
  `docs/analise-engine-ui-2026-09-12.md`.
- Motor/API: 442 testes aprovados no sandbox; três arquivos dependentes de porta e
  processos repetidos fora da restrição, 39/39 aprovados. UI: 203/203 aprovados.
- Duas reproduções diagnósticas isoladas confirmaram concorrência por sessão e
  excesso de orçamento na triagem. Nenhuma chamada paga.
- Próximo passo: E1, começando pela especificação persistida e endpoints de retry
  e continue; depois teste focado, revisão adversarial e atualização deste arquivo.

### Ciclo 1 — contratos de execução e estados

- E1: `runs.request_json` guarda prompt ou skill completos; retry possui recibo
  idempotente, linhagem e recusa legado incompleto; continuação usa `sessionId`.
- E2: lock FIFO por sessão, com paralelismo entre sessões e cancelamento antes do
  adapter. Regressão original agora tem pico 1 na mesma sessão e pico 2 em sessões
  diferentes.
- E3: triagem e skills reservam o teto antes de admitir; custo terminal desconhecido
  conserva a reserva. Duas triagens sob US$ 0,25 agora admitem somente uma.
- E5: fila, execução e aprovação produzem estados visuais persistentes distintos;
  cancelamento e interrupção têm transições e cores próprias.
- Evidência: typecheck aprovado; 11 testes de contratos/retry/objetivos aprovados;
  12 testes focados de layout, onboarding e estado visual aprovados; lint da UI e
  `git diff --check` aprovados.
- Achado do gauntlet: cancelamento durante espera por sessão não persistia a falha
  estruturada. Corrigido e mantido como regressão automatizada.
- Próximo passo: concluir E4 e integrar E6–E11 ao fluxo e à interface.

### Ciclo 2 — objetivos duráveis e causalidade

- E4 e E6–E10: objetivos, etapas, tentativas, dependências e evidências agora são
  persistidos. Recuperação só reenfileira tentativa não iniciada; efeitos possíveis
  bloqueiam a etapa até reconciliação explícita.
- O planejador aplica prioridade com envelhecimento, exclusão por recurso e rejeita
  ciclos. Cada execução recebe um pacote local inspecionável com fontes, decisões,
  orçamento, dependências, pendências e retenção.
- Processo concluído e entrega verificada são estados distintos. Evidências incluem
  resposta, arquivos alterados, artefatos, tamanho e SHA-256, com caminhos contidos
  no diretório de artefatos.
- E11: eventos carregam tentativa, sequência, chamada, fase, duração e resultado;
  SSE respeita backpressure e encerra clientes que excedem a fila limitada.
- U1–U5: o painel Agora prioriza objetivo ativo e ação; detalhe mostra resultado e
  cadeia causal antes da telemetria; estados e movimento reduzido mantêm equivalência.
- Achados do gauntlet: conflito de recurso dentro da mesma onda, ciclos de dependência,
  contraste durante entrada de modal e bloco rolável sem foco. Todos corrigidos com
  regressões automatizadas.

### Ciclo 3 — fechamento dos gates

- Gauntlet de layout encontrou colisão ao combinar layout parcial com defaults. A
  normalização agora escolhe a posição livre mais próxima; conflito entre janelas e
  presets preservando o rascunho passaram no navegador.
- Build, typecheck, lint, Prettier e `git diff --check` aprovados.
- Motor/API: 58 arquivos e 463 testes aprovados. UI: 36 arquivos e 205 testes
  aprovados. Contratos focados de objetivo, retry, sessão e SSE: 16/16 aprovados.
- Browser: 86 jornadas aprovadas em Chromium, incluindo Axe, temas, 1280×720,
  mobile, persistência, objetivo causal e 200 navegações aquecidas. Dois ensaios
  opt-in ficaram corretamente omitidos: comparação após cinco minutos e soak longo.
- Estado final: E1–E11 e U1–U6 concluídos. Este arquivo permanece como registro de
  retomada e evidência da execução.
