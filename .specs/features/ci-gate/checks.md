# CI gate checks

Profile: standard
Plan: none - change under three files with no one-way door (see Intent)

## Intent

Nenhum push e nenhum pull request passa por verificação hoje: `.github/workflows/ci.yml` só roda
por `workflow_dispatch`, então um commit que quebra typecheck, lint, testes ou build chega à `main`
sem ninguém ver. A única falha da suíte local (`tests/core.spawn-tree.test.ts`) também não é do
código: o teste pergunta se o neto ainda existe com `process.kill(pid, 0)`, que responde "vivo"
para um processo zumbi, e em contêiner sem `init` o PID 1 não recolhe órfãos - o neto morreu e o
teste diz que não. Quando isso chegar: todo PR e todo push na `main` rodam o CI, e a suíte local
passa inteira num contêiner.

4 checks in 2 slices · 0 one-way doors · 0 open, of which 0 block

Comandos (da raiz): `npx vitest run tests/ci.workflow.test.ts tests/core.spawn-tree.test.ts -t "<nome>"`

## Checks

### S1 - CI em push e PR · 2 files · 4 KB · ~1k

**C1** - `.github/workflows/ci.yml` dispara exatamente em `pull_request` (sem filtro), `push` com só `branches: [main]` e `workflow_dispatch`; o leitor de gatilhos normaliza CRLF e recusa `main-legacy`, filtro de `paths` e `pull_request` restrito
Proof: `npx vitest run tests/ci.workflow.test.ts -t "C1 ci runs on pull requests and pushes to main"`
Proof: `npx vitest run tests/ci.workflow.test.ts -t "C1 the trigger reader rejects narrowed or look-alike filters"`
Status: closed

### S2 - processo zumbi conta como morto · 1 file · 2 KB · ~1k

**C2** - No Linux, o teste de árvore de processos considera morto um processo cujo estado em `/proc/<pid>/stat` é `Z`, e passa neste contêiner
Proof: `npx vitest run tests/core.spawn-tree.test.ts -t "cancellation kills a TERM-resistant descendant even when its parent exits first"`
Status: closed

**C3** - O helper de vivacidade devolve `true` para um processo vivo (o próprio `process.pid`) e `false` para um PID inexistente
Proof: `npx vitest run tests/core.spawn-tree.test.ts -t "C3 liveness: alive, gone"`
Status: closed

### Rodada 2

**C4** - No Linux, um zumbi criado de propósito (`sh -c 'true & …; exec sleep 5'`, estado `Z` em `/proc/<pid>/stat`) é dado como não vivo pelo helper, em qualquer máquina
Proof: `npx vitest run tests/core.spawn-tree.test.ts -t "C4 liveness: a zombie is not alive"`
Status: closed

## Coverage

| Set (size)                           | Member -> proof                                                                                                                              | Unproven |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| gatilhos do CI (3)                   | `pull_request` C1 · `push` em `main` C1 · `workflow_dispatch` C1                                                                             | -        |
| estados de processo (3)              | vivo C3 · inexistente C3 · zumbi C2 (contêiner), C4 (qualquer Linux)                                                                         | -        |
| filtros que estreitam um gatilho (5) | branch parecida `main-legacy` C1 · `paths` no push C1 · branches no `pull_request` C1 · CRLF C1 · filtro depois de comentário na coluna 0 C1 | -        |

- Claims naming a status code, route or response shape: none

## Test policy

O helper de vivacidade decide entre três estados (4 branch points; a falha de leitura de `/proc` cobre um processo que sumiu entre as duas chamadas e não tem prova determinística); prova na própria camada (C3)
e pelo teste que o usa (C2). O workflow é configuração: provado lendo o arquivo (C1).

| Code                                                          | Required proofs      | Coverage expectation        |
| ------------------------------------------------------------- | -------------------- | --------------------------- |
| Decides, not reached across a boundary (helper de vivacidade) | one at its own layer | one asserted case per state |
| Configuration (`ci.yml`)                                      | one reading the file | each trigger asserted       |

Evidence:

- `tests/core.spawn-tree.test.ts` `alive()`: vivo / zumbi / inexistente -> decides
- closest analogue in the repo: nenhum teste lê workflows hoje; `tests/seeds.test.ts` lê arquivos de seed do repositório da mesma forma

Cost: 1 arquivo de teste novo, 3 provas.

## Swept

- validation: n/a - nenhuma entrada de usuário
- failure modes: C2 (o filho morto que vira zumbi)
- idempotency: n/a - nada é gravado
- authorization: n/a - o workflow não ganha permissões novas; segue sem `permissions:` de escrita
- concurrency: existing - `concurrency: ci-${{ github.ref }}` com `cancel-in-progress` já está no workflow
- data lifecycle: n/a - nada persiste
- dependency failure: n/a - nenhuma dependência nova
- state transitions: C2, C3
- observability: n/a - o resultado do CI já aparece no PR

## Handoff

- S1-S2 = ~2k tokens (ci.yml 3 KB, spawn-tree test 2 KB, teste novo ~2 KB), abaixo de 150k - one builder
