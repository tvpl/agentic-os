# Roteiro do segundo cérebro: estado, o que falta, gaps e o que revisar

> **Atualização de 14/11/2026:** a **C8 `cerebro-rituais`** está construída e fechada (101 checks mais 10 de correção, verificação PASS na
> rodada 3, AD-048 e AD-049). Faltam C9 a C11, que só têm a linha do roteiro, e a sessão de andar as telas com o dono.
>
> **Atualização de 08/11/2026:** C1 a C7 estão construídas e fechadas (C7 por escalonamento depois de quatro verificações, AD-046),
> as oito perguntas de maior efeito foram respondidas (AD-047) e o PR #11 abriu. Faltam C8 a C11, que só têm a linha do roteiro;
> o próximo passo é planejar a **C8 `cerebro-rituais`** (seção 7). O resto deste arquivo descreve o estado de 01/11/2026; para o que
> mudou depois, valem o `STATE.md` (AD-046, AD-047 e "Perguntas ao dono") e o `roadmap.md`.

Escrito em 01/11/2026, a pedido do dono, quando a construção foi parada. Branch `chore/cerebro-v3-roteiro`, tudo empurrado até o
commit `2cd2578`. A fonte de cada decisão é o `.specs/STATE.md` (AD-037 a AD-045 e "Perguntas ao dono"); o plano de cada
feature está em `.specs/features/<nome>/`.

## 1. Onde parou

A **C7 `cerebro-memoria-confiavel`** estava na correção da rodada 2 da verificação (FAIL). A parte A dos consertos está feita e
empurrada. A **parte B foi interrompida** pelo dono no meio da construção:

- o trabalho dela está guardado, **sem passar nos portões e sem ser empurrado para a branch do roteiro**, na branch
  `wip/c7-rodada2-parte-b` (commit `00c22c8`, 23 arquivos, inclui a migração 32). Não é para integrar como está;
- a branch do roteiro (`chore/cerebro-v3-roteiro`) não tem nada pendente e está limpa.

## 2. Estado das features

| #   | Feature                     | Estado                                                                   | Checks | Fechamento                                                           |
| --- | --------------------------- | ------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------- |
| C1  | `cerebro-correcoes`         | construída e fechada                                                     | -      | rodada 3 FAIL, aceita pelo dono (AD-039)                             |
| C2  | `cerebro-contextos`         | construída e fechada                                                     | -      | rodada 2 PASS                                                        |
| C3  | `cerebro-organizar`         | construída e fechada                                                     | -      | rodada 2 PASS                                                        |
| C4  | `cerebro-vista-notas`       | construída e fechada                                                     | 90     | rodada 2 PASS                                                        |
| C5  | `cerebro-faxina-guiada`     | construída e fechada                                                     | 90     | rodada 3 FAIL, testes escritos depois, sem nova verificação (AD-042) |
| C6  | `cerebro-natureza`          | construída e fechada                                                     | 94     | rodada 3 FAIL, testes escritos depois, sem nova verificação (AD-043) |
| C6b | `cerebro-paineis`           | construída e fechada                                                     | 104    | rodada 3 FAIL, testes escritos depois, sem nova verificação (AD-044) |
| C7  | `cerebro-memoria-confiavel` | **construída (A1-B2, com B1b), em correção depois de 2 rodadas em FAIL** | 171    | aberta: rodada 3, a última, ainda não rodou                          |
| C8  | `cerebro-rituais`           | construída e fechada (111 checks)                                        | 111    | rodada 3 PASS (AD-049)                                               |
| C9  | `cerebro-busca-significado` | **só linha no roteiro**                                                  | -      | sem plano, sem checks                                                |
| C10 | `cerebro-perguntar`         | **só linha no roteiro**                                                  | -      | sem plano, sem checks                                                |
| C11 | `cerebro-entidades-resumos` | **só linha no roteiro**                                                  | -      | sem plano, sem checks                                                |

## 3. O que falta, em ordem

### 3.1 Terminar a C7

1. **Parte B da rodada 2** (interrompida). Pedia, a partir do relatório `verification.md` da rodada 2:
   - achado 3: arestas "relacionadas" e "Conteúdo semelhante" do grafo calculadas só sobre o que o público vê (hoje TF-IDF do
     acervo inteiro, e o C113 não pega porque o gêmeo reusa as arestas);
   - achado 4: com embeddings ligados, a lista vetorial é cortada a 50 antes de tirar os arquivos ocultos (F13 sobrevive);
   - achado 6: nota movida para uma pasta oculta mantém as versões antigas legíveis por um dispositivo (histórico por caminho);
   - achado 7: F15 (`holdsExports`, o índice do dispositivo exclui cópias de exportação);
   - achado 8: `memory/status` conta arquivos ocultos; o título do sentinela fsWatch cita a pasta oculta; o C159 não pega os dois.
2. **Rodada 3 da verificação** da C7 (a última). Se der FAIL, vai ao dono; já houve duas rodadas em FAIL com achados de segurança
   reais, então a chance de um terceiro FAIL é alta.
3. Registrar o fechamento (AD-046), as lições e o handoff.

### 3.2 Planejar e construir C8 a C11

Cada uma só tem a linha do `roadmap.md`. Para cada: plano (com `design.md` se tiver tela) levado ao dono, checks, construção em
lotes, verificação independente. Escopo das linhas:

- **C8** rituais: revisão semanal GTD, Projetos e Arquivo, `last_reviewed` como prazo, menções não linkadas.
- **C9** busca por significado: conjunto de avaliação em PT, embedder local real por seção, radicalização PT, recall híbrido com
  abstenção, reranker opcional. **Mexe nos índices por público da C7 (migração 31)**, então depende de a C7 fechar.
- **C10** perguntar ao cérebro: citações, modo "raciocine primeiro", provocações, busca/links/higiene pelo MCP, página de
  conexão MCP. **Depende das regras de acesso por pasta da C7** (o MCP lê com o token do dono; ver gap 4.6).
- **C11** entidades e resumos: camada de entidades, PageRank personalizado, resumos por área e contexto com marca de
  desatualização.

Estimativa grosseira pelas features anteriores: cada uma pede de 4 a 6 lotes e de 2 a 3 rodadas de verificação.

## 4. Gaps e riscos conhecidos

### 4.1 De processo

1. **Nenhum humano andou pelas telas.** O passo 5 de `verify.md` ("andar o fluxo com o dono") nunca rodou em nenhuma
   verificação. Todas as telas (notas, faxina, revisões, painéis, caixa do agente, permissões por pasta, exportar/importar) foram
   provadas por teste automático e navegador sem cabeça, mas **nunca vistas e usadas por você**.
2. **Quatro features fecharam por escalonamento** (C1, C5, C6, C6b) com os testes do resíduo escritos depois e **sem nova
   verificação independente**. Os mutantes plantados hoje morrem, mas ninguém re-verificou.
3. **Padrão repetido:** quase toda feature foi a FAIL nas rodadas 1 e 2 por mutantes que sobrevivem (limites sem a borda aceita,
   filtros testados por um só caminho, regras de dia local testadas em UTC). As lições L-044 a L-061 registram isso, mas estão
   como `candidate`; só L-015, L-034 e L-039 estão confirmadas. **Rever e promover ou descartar as lições.**
4. **Nada foi integrado.** Todo o roteiro vive em `chore/cerebro-v3-roteiro` (cerca de 200 commits desde 29/10/2026); não há PR
   aberto nem merge. O custo de integrar cresce com a lista de pinos de contagem de rotas, migrações e exportações que cada
   feature mexeu (hoje 164 rotas, migrações até a 31).
5. **A branch parcial** `wip/c7-rodada2-parte-b` precisa de decisão: continuar, descartar ou recomeçar.

### 4.2 De produto e segurança

1. **C7 ainda tem furos de segurança abertos** (seção 3.1, item 1). Os achados 3, 4, 6 e 8 deixam um dispositivo inferir ou ler
   algo sobre pastas ocultas. Até a rodada 3 passar, **não vale confiar em "esconder pasta" como fronteira de segurança**.
2. **Limites documentados em `docs/security.md`** que continuam valendo mesmo depois dos consertos:
   - Codex e Cursor leem o disco inteiro, e a pasta oculta ao lado da pasta da execução não é protegida; as regras de bloqueio do
     Claude não cobrem a ferramenta `Bash`;
   - `x-total-count` de runs e sessions conta itens ocultos;
   - `mordomo mcp` lê com o token do dono: uma sessão de agente que tenha as ferramentas lê pastas ocultas;
   - a saída de uma execução a que se deu uma pasta oculta só de dispositivos pode citá-la (G36);
   - binários em artefatos e imagens de skills são servidos como estão.
3. **Busca:** o filtro `dir` da busca é prefixo de texto (`core/src/memory/search.ts`), então `projetos` também casa
   `projetos-antigo/`. Já existia antes; ficou fora de todas as features.
4. **`Engine.updateSettings` do SDK** (`core/src/config/store.ts`) ainda faz mesclagem profunda e mantém `apiKeyEnv`; a rota
   `PUT /api/settings` foi consertada na C3, o SDK não. `spawn_task` expirou e **nunca virou tarefa**.
5. **Contextos (C2):** `retry` e execuções-filhas não levam `contextId`; `PUT /api/settings` pode gravar `contexts` sem checar
   caminhos; a busca ⌘F do Núcleo, as facetas e o grafo do desktop não respeitam o contexto ativo.
6. **Casos que não deu para testar aqui:** pasta `memory/archive` que a execução torna ilegível (mode 000) — os testes rodam como
   root. Condição de corrida entre `lstat` e `unlink` e reuso de inode em `removeCreatedFile`: risco baixo, aceito.
7. **Testes instáveis conhecidos:** `notes-view.spec.ts` ("Response has been disposed", corrida no interceptor do próprio
   spec, já existia antes) e, uma vez, `cleanupMotion` C72. Confirmado fora do código das features, mas nunca consertado.
8. **Peso do pacote:** a C7 deixou **646 B de JS** sob o teto da própria feature (16 KB); a regra de 2% do `pixel.plugin` C28
   passa com poucos bytes. **Qualquer feature nova de tela quebra o limite**: C8 a C11 precisarão de um teto novo ou de uma
   regra que meça só o que a entrada carrega (hoje a medida soma todo o `dist`, inclusive os pedaços preguiçosos).
9. **Documentação de usuário:** não foi verificado se `README.md`, `docs/` e a ajuda dentro do produto descrevem contextos, vista
   de notas, faxina, revisões, painéis, caixa do agente e permissões por pasta. Só `docs/security.md`, `docs/events.md`,
   `docs/memory-guide.md` e `legal/PRIVACY.md` (uma frase) foram tocados.

## 5. O que precisa ser revisto pelo dono

### 5.1 Bloqueia entrada em uso

- **`cerebro-faxina-guiada` pergunta 1:** a faxina pode **mover** arquivos de verdade fora de `memory/`? Padrão em vigor: só
  **propõe** (lista em `artifacts/cleanup/`). Enquanto não responder, a faxina não toca nas pastas do usuário.
- **`cerebro-natureza` pergunta 2 / plano:** a revisão diária vem ligada (no máximo uma notificação por dia)? Em vigor: ligada.

### 5.2 Decisões que tomei ou os construtores tomaram durante a construção, sem pergunta prévia

Estão todas com um padrão seguro em vigor e uma linha em `.specs/STATE.md`; vale rever pelo menos estas:

- **Portas de mão única acrescentadas na construção:** C4 doors 6-8; C5 doors 7-8 (chave do achado, desfazer move o manifesto);
  C6 `restore`/`previous` e emenda do C52 (sem "mesmo inode"); C6b migração 27 (`notification-reminder`), nomes exportados em
  `@mordomo/contracts` (dez na C6b, mais os da C7), ids dos widgets como chave das séries; C7 portas 16-19 (JSON por tipo da proposta, códigos
  de falha de execução por pasta, lista de acesso ilegível = `read`/`hide`, um índice FTS por público).
- **Correção de check pelo construtor:** C6b C86 (o painel de fatos só mostra fatos abertos); C73 do C6 (ajuda de data no fim do
  mês); C7 C80 (códigos de erro das rotas, emenda 2).
- **Mudança de comportamento para existentes:** a consolidação noturna vem **desligada** em instalações novas; escritas de
  agentes (incluindo MCP) viram **propostas** em vez de escritas diretas; três testes de features anteriores foram ajustados
  por isso. Isso é decisão sua (AD-045), mas muda o uso diário.
- **Tetos de peso** subidos por feature: C4 24 KB, C5 12 KB, C6 12 KB, C6b 24 KB, C7 16 KB (todas as perguntas ainda abertas).

### 5.3 Perguntas abertas (todas com padrão)

Contagem em `.specs/STATE.md`: cerebro-v2 15-19; cerebro-contextos 1; cerebro-vista-notas 1-2; cerebro-faxina-guiada 1-9;
cerebro-natureza 1-10; cerebro-paineis 1-19; cerebro-memoria-confiavel 8-11, 15-16, 18-22 (G24 a G39). As de maior efeito:

- **C2 pergunta 1:** com a credencial de uma execução, `context=all` é "o que a credencial lê" (padrão, mais seguro) ou o acervo
  inteiro?
- **C7 G36:** esconder de dispositivos a saída inteira de qualquer execução que recebeu a pasta oculta?
- **C7 G39:** uma proposta que parafraseia uma linha sua começa desmarcada (padrão) ou marcada como "Escrito por você"?
- **C7 G35:** `knownAt` não devolve fatos "como estavam" (exigiria mudar a porta 2).
- **C6b 18:** `legal/PRIVACY.md` deve dizer que o retrato guarda também id, hora, marca e link de cada item de conector?
- **C7 G37/G38:** tamanho 12px×13px das dicas de permissão e texto do conflito ao restaurar (os dois documentos de projeto
  discordam).

## 6. Próximos passos que recomendo

1. Decidir o destino da branch `wip/c7-rodada2-parte-b`: **continuar** de onde parou (o construtor retoma da árvore, 23 arquivos)
   ou **recomeçar** a parte B com o relatório da rodada 2 em mãos.
2. Rodar a rodada 3 da C7. Se ainda falhar, decidir como nas anteriores (testes depois e fechar, ou uma rodada a mais): para
   segurança, eu **não recomendaria fechar com resíduo de segurança aberto**.
3. Sessão curta de **andar as telas com você** (passo 5 de `verify.md`) antes de planejar C8-C11, para pegar o que teste não pega.
4. Abrir o PR da branch do roteiro (ou fatiar por feature) e decidir quem revisa; hoje são ~200 commits numa branch.
5. Responder as perguntas de 5.1 e as de maior efeito de 5.3; as demais seguem nos padrões.
6. Só então planejar C8 a C11 (ordem sugerida: C8, C9, C10, C11; C9 e C10 dependem de a C7 fechar).

## 7. Como continuar em outro chat: planejar a C8

Abra o chat na branch `chore/cerebro-v3-roteiro` (PR #11) e comece com algo como:

> Retome o roteiro do segundo cérebro. Leia `.specs/cerebro-v3-status.md`, o Handoff e "Perguntas ao dono" de `.specs/STATE.md`
> e `.specs/roadmap.md`. Planeje a **C8 `cerebro-rituais`** com a skill `tlc-spec-lean` (fase de plano: `plan.md` e `design.md`
> em `.specs/features/cerebro-rituais/`, sem checks nem código) e leve o plano a mim para aprovar. Perfil `ui`, orçamento 150k.

O que o novo chat precisa saber:

- **Escopo da C8** (linha do roteiro): revisão semanal GTD, Projetos e Arquivo, `last_reviewed` como prazo de revisão, menções não
  linkadas. Fonte da pesquisa: `reports/Segundo cérebro para agentes.md` (M5) e `research_notes/Segundo cérebro para agentes/`.
- **Reuso obrigatório, não recriar:** a fila de revisões e o sentinela `reviewDue` da C6 (`core/src/memory/reviews.ts`,
  `reviewDecisions.ts`), a faxina da C5 (inventário, achados, arquivar com desfazer), os contextos da C2, a vista de notas da C4 e
  os painéis da C6b (lembretes, destaques). A C8 deve dizer o que reaproveita e o que é novo.
- **Peso:** política do dono (AD-047 h): um teto novo por feature, acima da anterior. O último é o da C7, em 17 152 B de JS gzip
  acima de `cerebro-paineis`, com 44 B de folga; o plano da C8 deve propor o seu e a medição atual está em
  `scripts/bundle-baseline.json`.
- **Processo que funcionou:** plano aprovado pelo dono, depois checks (agente à parte), construção em lotes sequenciais, só em
  verde, e verificação independente por agente novo, até 3 rodadas. Leia as lições L-044 a L-066 em `.specs/LESSONS.md`: quase toda
  feature falhou nas rodadas 1 e 2 por mutantes que sobrevivem (limites sem a borda aceita, filtro testado por um só caminho, dia
  local testado em UTC, prova que pula sem build). Elas valem para o plano e para os checks da C8.
- **Convenções do repo:** a tabela `API` é a única fonte de rotas; cada rota, migração, configuração, evento ou exportação nova
  move pinos de contagem (veja os commits da C6 e da C7 como modelo); `docs/events.md` se regenera com `UPDATE_EVENTS_DOC=1`;
  trailers de commit `Co-Authored-By` e `Claude-Session`; commits pequenos, assunto até 72 caracteres.
- **Antes de planejar:** a sessão de andar as telas com o dono nunca aconteceu (seção 4.1). Vale propor uma, curta, junto do plano.
- **CI do PR #11:** os três pinos de e2e e os três caminhos de macOS foram corrigidos (`44cc859`). Os quatro jobs de Node ainda
  falham no `npm audit --omit=dev --audit-level=high` por um aviso novo de severidade alta no `zod` (3.25.76, corrigido só na 4.6.6, uma
  mudança maior); o `package.json` e o lockfile não mudaram nesta branch, então o `main` está igual. Decidir a atualização do `zod`
  é um assunto à parte.
