# CI gate verification

**Verdict**: FAIL
**Profile**: standard
**Diff range**: c3b3650..fad566f (HEAD = `fad566f`, o único commit da feature)
**Round**: 1 - full
**Verifier**: independent sub-agent (author != verifier)

Resumo: os três checks passam em `fad566f` com asserção localizada, os cinco mutantes de comportamento
foram mortos (inclusive o do zumbi, que só é observável neste contêiner porque o PID 1 é
`process_api` e não recolhe órfãos) e a suíte completa passa (531/531). O FAIL vem da precisão da
prova de C1: a segunda alternativa da regex em `tests/ci.workflow.test.ts:30`
(`branches:\s*\n\s*-\s*main`) não tem âncora no fim, então um workflow com
`branches:` em forma de bloco apontando para `- main-legacy` (que **não** dispara em push na `main`)
passa no teste - um mutante que contradiz a própria afirmação de C1 e sobreviveu. Além disso, a
varredura da sintaxe de gatilhos do GitHub Actions encontrou um conjunto sem linha (filtros que
restringem gatilhos: `branches` em `pull_request`, `paths`/`paths-ignore`, `types`), que o teste
aceita e que contradiria a Intent ("todo PR e todo push na `main`").

## Binding sources

no binding source - não há `plan.md` (o `checks.md` declara `Plan: none` e carrega um parágrafo de
Intent) e nenhuma fonte é marcada como vinculante. O perfil `standard` não exige o passo 1.

| Source            | Opened | Contradiction | Uncovered |
| ----------------- | ------ | ------------- | --------- |
| no binding source | n/a    | -             | -         |

## Checks

Verificado em `fad566f`. Proof run, uma única invocação:
`npx vitest run tests/ci.workflow.test.ts tests/core.spawn-tree.test.ts --reporter=verbose` - exit 0,
`Test Files 2 passed (2)`, `Tests 3 passed (3)`, com três linhas `✓` individuais:

- `✓ tests/ci.workflow.test.ts > ci workflow triggers > C1 ci runs on pull requests and pushes to main 2ms`
- `✓ tests/core.spawn-tree.test.ts > cancellation kills a TERM-resistant descendant even when its parent exits first 146ms`
- `✓ tests/core.spawn-tree.test.ts > C3 liveness: alive, gone 0ms`

Existência confirmada com `rg -n 'C1 ci runs|TERM-resistant descendant even|C3 liveness: alive, gone'`
fora de `.specs`: `tests/ci.workflow.test.ts:24`, `tests/core.spawn-tree.test.ts:6`,
`tests/core.spawn-tree.test.ts:36` - um hit por nome. Os três testes estão no diff: C1 e C3 são novos
e C2 teve o `alive()` trocado por `processAlive(pid)` (`tests/core.spawn-tree.test.ts:19`), que é o
comportamento novo.

| Check | Claim                                                                                        | Proof run                                                                           | Evidence                                                                                                                                                                                                                                                                                                                                                                  | Result |
| ----- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| C1    | `ci.yml` dispara em `pull_request` e em `push` para `main`, mantém `workflow_dispatch`       | batch acima, `✓ C1 ci runs on pull requests and pushes to main`                     | `tests/ci.workflow.test.ts:26` - `expect(on).toMatch(/^ {2}pull_request:/m)`; `:27` - `expect(on).toMatch(/^ {2}workflow_dispatch:/m)`; `:29` - `expect(push, "push trigger").not.toBeNull()`; `:30` - `expect(push![1]).toMatch(/branches:\s*\[\s*main\s*\]\|branches:\s*\n\s*-\s*main/)` (ver falha de precisão em Faults: a alternativa de bloco aceita `main-legacy`) | PASS   |
| C2    | No Linux, zumbi (`Z` em `/proc/<pid>/stat`) conta como morto e o teste passa neste contêiner | `✓ cancellation kills a TERM-resistant descendant even when its parent exits first` | `tests/core.spawn-tree.test.ts:23` - `await expect.poll(alive, { timeout: 1000 }).toBe(false)` com `alive = () => processAlive(pid)` em `:19`; decisão em `tests/helpers.ts:64` - `return state !== "Z"`. F3 provou que o neto é de fato zumbi aqui                                                                                                                       | PASS   |
| C3    | helper devolve `true` para `process.pid` e `false` para PID inexistente                      | `✓ C3 liveness: alive, gone`                                                        | `tests/core.spawn-tree.test.ts:37` - `expect(processAlive(process.pid)).toBe(true)`; `:39` - `expect(processAlive(2 ** 30)).toBe(false)`                                                                                                                                                                                                                                  | PASS   |

Nível: C1 é configuração provada lendo o arquivo, como a Test policy pede; C2 e C3 afirmam o valor de
retorno do próprio helper. Nenhuma afirmação nomeia status, rota ou formato de resposta - nenhum
level gap.

Validade do workflow: `yaml.parseDocument` sobre `.github/workflows/ci.yml` dá 0 erros e 0 avisos e
`on` = `{"pull_request":null,"push":{"branches":["main"]},"workflow_dispatch":null}`. `pull_request:`
sem valor (tipos padrão `opened`, `synchronize`, `reopened`), `push.branches: [main]` e
`workflow_dispatch:` são sintaxe válida do GitHub Actions; o arquivo atual faz o que C1 afirma.

## Coverage

Recalculado em `fad566f` a partir da autoridade de cada conjunto, não da tabela do autor.

| Set (size)                                               | Recomputed from                                                                                                                                                                | Member -> proof                                                                                                                                               | Unproven                                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| gatilhos do CI (3)                                       | o próprio workflow: `.github/workflows/ci.yml:5-9`, conferido pelo parse YAML acima                                                                                            | `pull_request` C1 `:26` · `push` C1 `:29` · `workflow_dispatch` C1 `:27` (F1 morto)                                                                           | -                                                                                                        |
| branch do filtro de `push` (1: `main`)                   | `.github/workflows/ci.yml:8` (`branches: [main]`)                                                                                                                              | `main` na forma inline C1 `:30` (F2 morto)                                                                                                                    | forma de bloco aceita qualquer nome com prefixo `main` (`- main-legacy`, `- maintenance`): P4 sobreviveu |
| filtros que restringem um gatilho (sem linha nos checks) | sintaxe de gatilhos do GitHub Actions: `branches`/`branches-ignore`/`paths`/`paths-ignore`/`types` sob `pull_request` e `push`; a Intent exige "todo PR e todo push na `main`" | nenhuma prova afirma a ausência deles: `pull_request: branches: [release]` (P2) e `push: paths: ["docs/**"]` (P3) passam em C1                                | ausência de filtro em `pull_request`; ausência de `paths`/`paths-ignore` em `push`                       |
| estados de processo (3)                                  | Linux `proc(5)`: `kill(pid, 0)` falha (inexistente) vs. sucede; letra de estado em `/proc/<pid>/stat` (`R S D T t X Z I ...`), só `Z` decide "morto" em `tests/helpers.ts:64`  | vivo (`R`, o próprio processo) C3 `:37` (F5 morto) · inexistente (`ESRCH`) C3 `:39` (F4 morto) · zumbi `Z` C2 `:23` (F3 morto, só observável neste contêiner) | -                                                                                                        |

Varredura de conjuntos sem linha, além do terceiro acima:

- Ramos do helper: o `checks.md` diz "2 branch points", o código tem 4 (`tests/helpers.ts:57` catch do
  `kill`, `:59` plataforma não-Linux, `:64` estado, `:66` falha ao ler `/proc`). O ramo não-Linux é
  exercido por C3 `:37` nas pernas macOS/Windows do CI, não observável aqui. O ramo `:66` (o processo
  some entre o `kill` e a leitura) é uma corrida sem prova; baixa severidade, fora das afirmações.
- `kill(pid, 0)` com `EPERM` (processo de outro usuário) cai em `:57` e vira "morto". Inalcançável
  para a fixture do próprio teste; registro apenas.
- Passos que a Intent nomeia (typecheck, lint, testes, build): já existiam (`ci.yml:31,32,35,39`) e
  nenhum check os reivindica. Não é lacuna desta feature.

## Test policy rows

| Row                                                           | Files it classifies                       | Required proof                                                                                                                                                                         | Expectation met                                                                                                                                                                                                                    |
| ------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decides, not reached across a boundary (helper de vivacidade) | `tests/helpers.ts:53-68` (`processAlive`) | uma prova na própria camada: C3 `tests/core.spawn-tree.test.ts:37,39` afirma o retorno do helper; o zumbi é afirmado sobre o mesmo retorno em C2 `:23`, como a prosa da policy atribui | yes - um caso afirmado por estado (vivo `:37`, inexistente `:39`, zumbi `:23`). Ressalva: o caso zumbi depende do ambiente; num host cujo PID 1 recolhe órfãos (os runners do GitHub), `:23` passa pelo ramo `ESRCH`, não pelo `Z` |
| Configuration (`ci.yml`)                                      | `.github/workflows/ci.yml:5-9`            | uma prova lendo o arquivo: C1 `tests/ci.workflow.test.ts:25` (`fs.readFileSync(... "ci.yml")`)                                                                                         | yes - cada gatilho afirmado (`:26`, `:27`, `:29-30`); a precisão da afirmação de branch é tratada em Faults                                                                                                                        |

Swept `existing`, relido no código:

- concurrency: `.github/workflows/ci.yml:11-13` - `group: ci-${{ github.ref }}` e
  `cancel-in-progress: true`. Confere.
- As linhas `n/a` são política aprovada. Registro só que `ci.yml` não tem nenhuma chave
  `permissions:`, então o token segue o padrão do repositório, como a linha de authorization diz.

## Faults injected

Worktree descartável em `.../scratchpad/wt` (`git worktree add --detach`, `node_modules` por
symlink), baseline verde (3/3) antes das mutações; cada mutação revertida com `git checkout --` antes
da próxima. F1-F5 são os cinco mutantes de comportamento (teto de 5, uma superfície de asserção cada).
P2-P4 são as sondas de precisão pedidas no brief sobre o parser por regex; P4 contradiz a própria
afirmação de C1 e entra aqui como mutante sobrevivente.

| Mutation                                                                                     | Location                     | Killed                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 remove a linha `pull_request:`                                                            | `.github/workflows/ci.yml:6` | yes - C1 falha em `tests/ci.workflow.test.ts:26` (`expected '  push:\n    branches: [main]\n  work…' to match /^ {2}pull_request:/m`)                                                                |
| F2 `branches: [main]` -> `branches: [develop]`                                               | `.github/workflows/ci.yml:8` | yes - C1 falha em `:30` (`expected '    branches: [develop]\n' to match …`)                                                                                                                          |
| F3 zumbi conta como vivo (`return state !== "Z"` -> `return true`)                           | `tests/helpers.ts:64`        | yes - C2 falha em `tests/core.spawn-tree.test.ts:23` (`expected true to be false`, após 1170 ms de poll): confirma que neste contêiner o neto vira zumbi (PID 1 = `process_api`, não recolhe órfãos) |
| F4 `processAlive` sempre devolve `true`                                                      | `tests/helpers.ts:53`        | yes - C3 falha em `tests/core.spawn-tree.test.ts:39` (`expected true to be false`)                                                                                                                   |
| F5 condição invertida (`state !== "Z"` -> `state === "Z"`)                                   | `tests/helpers.ts:64`        | yes - C3 falha em `tests/core.spawn-tree.test.ts:37:37` (`expected false to be true`)                                                                                                                |
| P4 `branches: [main]` -> bloco `branches:` / `- main-legacy` (não dispara em push na `main`) | `.github/workflows/ci.yml:8` | no - survived: `Tests 1 passed`; a alternativa `branches:\s*\n\s*-\s*main` em `tests/ci.workflow.test.ts:30` casa o prefixo                                                                          |
| P2 `pull_request:` ganha `branches: [release]` (PRs para `main` não rodam)                   | `.github/workflows/ci.yml:6` | no - survived: `Tests 1 passed`; precisão do check (C1 não proíbe filtros)                                                                                                                           |
| P3 `push:` ganha `paths: ["docs/**"]` (push na `main` só roda se tocar docs)                 | `.github/workflows/ci.yml:8` | no - survived: `Tests 1 passed`; precisão do check                                                                                                                                                   |

Outras sondas, fora da tabela por não serem mutantes das afirmações:

- P1, falso negativo: `ci.yml` com terminadores CRLF faz C1 falhar (`push trigger: expected null not
to be null`), porque `onBlock` faz `split("\n")` e a regex de `push` exige `push:\n`. O repo não tem
  `.gitattributes`, e a matriz roda `npx vitest run --exclude ...` no `windows-latest`
  (`ci.yml:36-38`) sem excluir `tests/ci.workflow.test.ts`. Se o checkout no Windows converter para
  CRLF (`core.autocrlf=true` do Git for Windows), C1 fica vermelho nas duas pernas Windows. Não
  confirmei o `autocrlf` do runner: o log do run `34710618337` não o mostra. Esse run (12/09, push na
  `main`) já tinha as pernas Windows e o e2e vermelhos por falhas preexistentes (`tests/adapters.readiness.test.ts`, `tests/cli.test.ts`, `tests/core.publish.test.ts`, entre outros), então o gate liga já vermelho nessas pernas, independente desta feature.
- P5, jobs condicionados (`if: github.event_name == 'workflow_dispatch'` em `check`): C1 passa. Fora
  da afirmação de C1, que fala só de gatilhos, mas a Intent ("todo PR ... roda o CI") fica sem prova
  de que os jobs rodam.

Isolamento: `git status --porcelain` da árvore real antes = vazio, depois = vazio (`cmp` igual);
worktree removido (`git worktree remove`), e `git worktree list` mostra só a árvore real e o
`wt-motor` preexistente, que não foi tocado.

## Gate

`npx vitest run` (em `fad566f`, árvore real) - 531 passed, 0 failed (66 arquivos, nenhum skip). A
falha conhecida de `tests/core.spawn-tree.test.ts` neste contêiner deixou de existir.

Gaps em ordem:

1. Mutante sobrevivente P4: a alternativa em bloco aceita qualquer branch com prefixo `main`. C1, em
   `tests/ci.workflow.test.ts:30`. Correção sugerida: ancorar (`-\s*main\s*$` com flag `m`) ou fazer
   o parse com `yaml` (já está em `node_modules`) e afirmar `on.push.branches` igual a `["main"]`.
2. Lacuna de precisão no check C1: nada afirma a ausência de filtros que contradizem "todo PR / todo
   push na `main`" (P2, P3), em `tests/ci.workflow.test.ts:26,28-30`. Com parse YAML: afirmar
   `on.pull_request` nulo (ou sem `branches`/`paths`/`types` restritivos) e `on.push` sem `paths`.
3. Risco de falso negativo com CRLF nas pernas Windows do CI (P1), em
   `tests/ci.workflow.test.ts:12,28`. Usar `split(/\r?\n/)` ou o parse YAML.
4. C2 e o caso zumbi dependem do ambiente: só exercitam `tests/helpers.ts:64` onde o PID 1 não
   recolhe órfãos. Um zumbi determinístico em qualquer Linux é possível (por exemplo
   `sh -c 'true & exec sleep 5'`, em que o filho de fundo vira zumbi sob o `sleep`). Baixa
   severidade, a policy aprovada aceitou C2 como prova.
5. A prosa da Test policy diz "2 branch points" e o helper tem 4. O ramo de falha da leitura de
   `/proc` (`tests/helpers.ts:66`) não tem prova. Baixa severidade.
