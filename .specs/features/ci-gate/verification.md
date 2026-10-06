# CI gate verification

**Verdict**: FAIL
**Profile**: standard
**Diff range**: c3b3650..bfaf355 (HEAD = `bfaf355`; correção da rodada 1 = `fad566f..bfaf355`)
**Round**: 2 - scoped
**Verifier**: independent sub-agent (author != verifier)

Resumo: a correção fecha as cinco lacunas da rodada 1. P4 (`main-legacy` em bloco e em fluxo), P3
(`paths` no push) e P2 (`branches` no `pull_request`) agora são mortos pela igualdade exata em
`tests/ci.workflow.test.ts:36,38`, o arquivo inteiro em CRLF passa, e o novo C4 cria um zumbi de
propósito e morre quando `processAlive` passa a tratar `Z` como vivo. A suíte completa passa
(533/533). O FAIL vem de uma sonda nova contra o leitor novo: ele para no primeiro texto na coluna 0
(`:18`) antes de pular comentários (`:19`), então um comentário na coluna 0 dentro de `on:` esconde
o resto do bloco. Com os gatilhos reordenados (`push` por último), `paths: ["docs/**"]` depois de um
`# ...` passa nas duas provas de C1, enquanto o parse YAML dá `push.paths = ["docs/**"]`. É a mesma
classe de P3: um mutante sobrevivente que contradiz "recusa filtro de `paths`".

## Binding sources

Carried from `fad566f`: não há `plan.md` (`Plan: none`) e nenhuma fonte é marcada como vinculante; a
correção não tocou interface. O perfil `standard` não exige o passo 1.

| Source            | Opened | Contradiction | Uncovered |
| ----------------- | ------ | ------------- | --------- |
| no binding source | n/a    | -             | -         |

## Checks

Verified at `bfaf355`. Proof run, uma única invocação na árvore real:
`npx vitest run tests/ci.workflow.test.ts tests/core.spawn-tree.test.ts --reporter=verbose` - exit 0,
`Test Files 2 passed (2)`, `Tests 5 passed (5)`, com cinco linhas `✓` individuais:

- `✓ tests/ci.workflow.test.ts > ci workflow triggers > C1 ci runs on pull requests and pushes to main 3ms`
- `✓ tests/ci.workflow.test.ts > ci workflow triggers > C1 the trigger reader rejects narrowed or look-alike filters 1ms`
- `✓ tests/core.spawn-tree.test.ts > cancellation kills a TERM-resistant descendant even when its parent exits first 147ms`
- `✓ tests/core.spawn-tree.test.ts > C3 liveness: alive, gone 1ms`
- `✓ tests/core.spawn-tree.test.ts > C4 liveness: a zombie is not alive 6ms`

Existência: `rg -n --glob '!.specs/**' 'C1 ci runs on pull requests|C1 the trigger reader rejects|TERM-resistant descendant even|C3 liveness: alive, gone|C4 liveness: a zombie'`
dá um hit por nome: `tests/ci.workflow.test.ts:32`, `:42`, `tests/core.spawn-tree.test.ts:8`, `:38`,
`:44`. As duas provas novas (C1 #2, C4) estão no diff da correção; as citações de
`tests/core.spawn-tree.test.ts` mudaram de linha (+2 pelos imports) e foram refeitas.
`tests/helpers.ts` e `.github/workflows/ci.yml` não mudaram desde `fad566f`.

| Check | Claim                                                                                                                                                                                      | Proof run                                                                                                                          | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Result |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| C1    | dispara exatamente em `pull_request` (sem filtro), `push` com só `branches: [main]` e `workflow_dispatch`; leitor normaliza CRLF e recusa `main-legacy`, `paths` e `pull_request` restrito | batch acima, `✓ C1 ci runs on pull requests and pushes to main` e `✓ C1 the trigger reader rejects narrowed or look-alike filters` | prova 1: `tests/ci.workflow.test.ts:34` - `expect([...on.keys()].sort()).toEqual(["pull_request", "push", "workflow_dispatch"])`; `:36` - `expect(on.get("pull_request")).toEqual([])`; `:38` - `expect(on.get("push")).toEqual(["branches: [main]"])`; `:39` - `expect(on.get("workflow_dispatch")).toEqual([])`. Prova 2: `:44`, `:45`, `:48` - `.not.toEqual(...)` sobre `main-legacy`, `paths`, `branches: [release]`; `:49` - `expect(read("  push:\r\n    branches: [main]\r\n").get("push")).toEqual(["branches: [main]"])`. Precisão: ver P6 em Faults | PASS   |
| C2    | No Linux, zumbi (`Z` em `/proc/<pid>/stat`) conta como morto e o teste passa neste contêiner                                                                                               | `✓ cancellation kills a TERM-resistant descendant even when its parent exits first`                                                | `tests/core.spawn-tree.test.ts:25` - `await expect.poll(alive, { timeout: 1000 }).toBe(false)` com `alive = () => processAlive(pid)` em `:21`; decisão em `tests/helpers.ts:64` - `return state !== "Z"` (carried from `fad566f`: F3 provou que aqui o neto é zumbi)                                                                                                                                                                                                                                                                                           | PASS   |
| C3    | helper devolve `true` para `process.pid` e `false` para PID inexistente                                                                                                                    | `✓ C3 liveness: alive, gone`                                                                                                       | `tests/core.spawn-tree.test.ts:39` - `expect(processAlive(process.pid)).toBe(true)`; `:41` - `expect(processAlive(2 ** 30)).toBe(false)`                                                                                                                                                                                                                                                                                                                                                                                                                       | PASS   |
| C4    | No Linux, um zumbi criado de propósito (estado `Z`) é dado como não vivo pelo helper, em qualquer máquina                                                                                  | `✓ C4 liveness: a zombie is not alive`                                                                                             | pré-condição `tests/core.spawn-tree.test.ts:52-54` - `await expect.poll(() => <estado lido de /proc/${zombie}/stat>, { timeout: 2000 }).toBe("Z")`; decisão `:55` - `expect(processAlive(zombie)).toBe(false)`                                                                                                                                                                                                                                                                                                                                                 | PASS   |

Nível: C1 é configuração provada lendo o arquivo (`:33`, `fs.readFileSync(... "ci.yml")`); C2, C3 e
C4 afirmam o retorno do próprio helper. Nenhuma afirmação nomeia status, rota ou formato de
resposta - nenhum level gap. C4 é `skipIf(process.platform !== "linux")`, coerente com "No Linux" da
afirmação; o zumbi não depende do PID 1 porque o pai dele é o `sleep` que nunca chama `wait`.

Observações sobre a prova 2 de C1 (sem mudar o resultado): `:44`, `:45` e `:48` são `not.toEqual`
contra um leitor que preserva o texto das linhas, então só caem se o leitor descartar linhas; e a
normalização CRLF em `:12` é redundante com `\s*$` em `:13`/`:20` e `trim()` em `:25` - remover a
normalização (R1) é um mutante equivalente, e `:49` passa igual. Os mutantes reais de C1 são mortos
pela prova 1 contra o arquivo real. Em sentido contrário, a igualdade exata recusa formas legítimas
(`branches: [ main ]`, `- main` em bloco): falso negativo conservador, aceitável para fixar
configuração.

## Coverage

Verified at `bfaf355` para as linhas cuja autoridade a correção tocou (o leitor de gatilhos, o caso
zumbi); `gatilhos do CI` recalculado de novo porque a prova mudou. `ci.yml` não mudou, então a
autoridade dos gatilhos é a mesma de `fad566f`.

| Set (size)                                                   | Recomputed from                                                                                                                                                 | Member -> proof                                                                                                                                          | Unproven                                                                                                                                                 |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gatilhos do CI (3)                                           | `.github/workflows/ci.yml:5-9`, inalterado; parse `yaml` carried from `fad566f` (`{"pull_request":null,"push":{"branches":["main"]},"workflow_dispatch":null}`) | conjunto exato C1 `:34` · `pull_request` C1 `:36` · `push` C1 `:38` · `workflow_dispatch` C1 `:39`                                                       | -                                                                                                                                                        |
| branch do filtro de `push` (1: `main`)                       | `.github/workflows/ci.yml:8` (`branches: [main]`)                                                                                                               | `main` exato C1 `:38`; `- main-legacy` em bloco morto (P4a) e `[main-legacy]` em fluxo morto (P4b)                                                       | -                                                                                                                                                        |
| filtros que estreitam um gatilho (sintaxe do GitHub Actions) | `branches`/`branches-ignore`/`paths`/`paths-ignore`/`tags`/`types` sob `pull_request` e `push`; a Intent exige "todo PR e todo push na `main`"                  | `branches` no `pull_request` C1 `:36` (P2 morto) · `paths` no `push` C1 `:38` (P3 morto) · os demais caem na mesma igualdade exata quando o leitor os vê | qualquer filtro escrito depois de um comentário na coluna 0 dentro de `on:` - o leitor para em `tests/ci.workflow.test.ts:18` e não o vê (P6 sobreviveu) |
| terminação de linha (2: LF, CRLF)                            | `ci.yml` é LF no repo; o repo não tem `.gitattributes`, e a perna `windows-latest` roda `tests/ci.workflow.test.ts`                                             | LF C1 `:38` sobre o arquivo real · CRLF C1 `:49` e a sonda P1 (arquivo inteiro em CRLF passa nas duas provas)                                            | -                                                                                                                                                        |
| estados de processo (3)                                      | Linux `proc(5)`: `kill(pid, 0)` falha vs. sucede; letra de estado em `/proc/<pid>/stat`, só `Z` decide "morto" em `tests/helpers.ts:64`                         | vivo C3 `:39` · inexistente C3 `:41` · zumbi C4 `:55` em qualquer Linux (Z morto) e C2 `:25` neste contêiner                                             | -                                                                                                                                                        |

Varredura de conjuntos sem linha:

- Ramos do helper (`tests/helpers.ts:53-68`): 4 pontos de decisão, e a prosa da Test policy agora diz 4
  (lacuna 5 da rodada 1 fechada). `:57` (catch do `kill`) C3 `:41`; `:59` (não-Linux) C3 `:39` só nas
  pernas macOS/Windows do CI; `:64` (estado) C3 `:39` e C4 `:55`; `:66` (falha ao ler `/proc`) sem prova,
  declarado na policy como corrida sem prova determinística. O conjunto que a policy exige é o de
  estados, e `:66` leva ao estado "inexistente", já provado por `:57`. Registro, não lacuna.
- `kill(pid, 0)` com `EPERM`: carried from `fad566f` - inalcançável para as fixtures do próprio teste.
- Jobs condicionados (`if:` em `jobs.*`, sonda P5 da rodada 1): carried from `fad566f`, fora da
  afirmação de C1, que fala só de gatilhos.

## Test policy rows

Re-julgadas em `bfaf355`: a linha do helper (a ressalva da rodada 1 era a dependência de ambiente) e
a da configuração (a prova que a classifica mudou).

| Row                                                           | Files it classifies                       | Required proof                                                                                                    | Expectation met                                                                                                                                                                 |
| ------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decides, not reached across a boundary (helper de vivacidade) | `tests/helpers.ts:53-68` (`processAlive`) | uma prova na própria camada: C3 `tests/core.spawn-tree.test.ts:39,41` e C4 `:55`, todos sobre o retorno do helper | yes - um caso afirmado por estado: vivo `:39`, inexistente `:41`, zumbi `:55`. O caso zumbi agora é determinístico em qualquer Linux; a ressalva da rodada 1 não se aplica mais |
| Configuration (`ci.yml`)                                      | `.github/workflows/ci.yml:5-9`            | uma prova lendo o arquivo: C1 `tests/ci.workflow.test.ts:33`                                                      | yes - cada gatilho afirmado (`:36`, `:38`, `:39`) e o conjunto exato (`:34`); a precisão do leitor é tratada em Faults (P6)                                                     |

Swept `existing`, carried from `fad566f` (`ci.yml` inalterado): concurrency em
`.github/workflows/ci.yml:11-13` (`group: ci-${{ github.ref }}`, `cancel-in-progress: true`) -
confere, relido nesta rodada. As linhas `n/a` são política aprovada.

## Faults injected

Verified at `bfaf355`. Worktree descartável em `.../scratchpad/wt-r2` (`git worktree add --detach`,
`node_modules` por symlink), baseline 5/5 verde antes das mutações; cada mutação revertida com
`git checkout --` antes da próxima. Faults F1-F5 da rodada 1 carried from `fad566f` (superfícies que a
correção não tocou: `ci.yml` e `tests/helpers.ts`). Teto de 5 faults: P4 nas duas formas pedidas, P3,
P2 e Z. P6 é uma sonda de precisão contra o leitor novo, achada lendo `:18-19`, e entra na tabela por
contradizer a afirmação de C1.

| Mutation                                                                                                                   | Location                       | Killed                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P4a `branches: [main]` -> bloco `branches:` / `- main-legacy`                                                              | `.github/workflows/ci.yml:8`   | yes - C1 falha em `tests/ci.workflow.test.ts:38:28` (`expected [ 'branches:', '- main-legacy' ] to deeply equal [ 'branches: [main]' ]`)                                                                                                               |
| P4b `branches: [main]` -> `branches: [main-legacy]`                                                                        | `.github/workflows/ci.yml:8`   | yes - C1 falha em `:38:28` (`expected [ 'branches: [main-legacy]' ] to deeply equal [ 'branches: [main]' ]`)                                                                                                                                           |
| P3 `push:` ganha `paths: ["docs/**"]`                                                                                      | `.github/workflows/ci.yml:8`   | yes - C1 falha em `:38:28` (`expected [ 'branches: [main]', …(1) ] to deeply equal [ 'branches: [main]' ]`)                                                                                                                                            |
| P2 `pull_request:` ganha `branches: [release]`                                                                             | `.github/workflows/ci.yml:6`   | yes - C1 falha em `:36:36` (`expected [ 'branches: [release]' ] to deeply equal []`)                                                                                                                                                                   |
| Z zumbi conta como vivo (`return state !== "Z"` -> `return true`)                                                          | `tests/helpers.ts:64`          | yes - C4 falha em `tests/core.spawn-tree.test.ts:55:34` (`expected true to be false`), rodando só `-t "C4 liveness: a zombie is not alive"`                                                                                                            |
| P6 gatilhos reordenados (`push` por último) e `# docs-only pushes for now` na coluna 0 seguido de `    paths: ["docs/**"]` | `.github/workflows/ci.yml:5-9` | no - survived: `Tests 2 passed (2)`; `yaml.parseDocument` dá 0 erros e `push = {"branches":["main"],"paths":["docs/**"]}`; o leitor para em `tests/ci.workflow.test.ts:18` (`if (/^\S/.test(line)) break;`) antes do `continue` de comentário em `:19` |

Outras sondas, fora da tabela:

- P1, CRLF: `ci.yml` inteiro convertido para CRLF (`file`: "with CRLF line terminators") - as duas
  provas de C1 passam (`Tests 2 passed (2)`). Falso negativo da rodada 1 fechado.
- R1, leitor sem normalização CRLF (`workflow.replace(/\r\n?/g, "\n").split("\n")` ->
  `workflow.split("\n")` em `tests/ci.workflow.test.ts:12`): as duas provas passam. Mutante
  equivalente - `\s*$` em `:13`/`:20` casa o `\r` e `trim()` em `:25` o remove, então o comportamento
  afirmado se mantém. Consequência: a prova 2 de C1 nunca foi feita falhar nesta rodada.

Isolamento: `git status --porcelain` da árvore real antes = vazio, depois = vazio (`cmp` igual);
symlink removido e worktree removido (`git worktree remove`); `git worktree list` mostra só a árvore
real e o `wt-motor` preexistente, que não foi tocado.

## Gate

`npx vitest run` (em `bfaf355`, árvore real) - 533 passed, 0 failed (66 arquivos, nenhum skip; 531
da rodada 1 + as 2 provas novas).

Gaps em ordem:

1. Mutante sobrevivente P6 - C1 - `tests/ci.workflow.test.ts:18-19`. Um comentário na coluna 0 dentro
   de `on:` encerra a leitura, e um filtro escrito depois dele (aqui `paths` no `push`, com `push` como
   último gatilho) passa nas duas provas. Correção sugerida: pular linhas em branco e comentários antes
   do teste de coluna 0 (trocar a ordem de `:18` e `:19`), ou fazer o parse com `yaml` (já em
   `node_modules`) e afirmar `on` igual a
   `{ pull_request: null, push: { branches: ["main"] }, workflow_dispatch: null }`.
2. Prova 2 de C1 sem poder de falha demonstrado - C1 - `tests/ci.workflow.test.ts:44,45,48,49`. As
   asserções `not.toEqual` só caem se o leitor descartar linhas, e a de CRLF (`:49`) não distingue a
   normalização de `:12` (R1 equivalente). Baixa severidade: os mutantes de C1 são mortos pela prova 1.
3. Ramo `tests/helpers.ts:66` (falha ao ler `/proc`) sem prova - C2/C3/C4 - declarado na Test policy.
   Registro, baixa severidade.
