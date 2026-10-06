# CI gate verification

**Verdict**: PASS
**Profile**: standard
**Diff range**: c3b3650..a8b81dd (HEAD = `a8b81dd`; correção da rodada 2 = `bfaf355..a8b81dd`)
**Round**: 3 - scoped
**Verifier**: independent sub-agent (author != verifier)

Resumo: a correção `a8b81dd` troca a ordem de duas linhas do leitor de gatilhos
(`tests/ci.workflow.test.ts:19-20`: comentários e linhas em branco são pulados antes do teste de
coluna 0) e acrescenta três asserções positivas à prova 2 de C1 (`:52`, `:53-55`, `:60`). Fora do
teste, só `checks.md` mudou (linha de Coverage de 4 para 5 membros) e o relatório da rodada 2 foi
commitado; `ci.yml`, `tests/helpers.ts` e `tests/core.spawn-tree.test.ts` não mudaram desde `bfaf355`.
O mutante P6 da rodada 2 agora é morto pela prova 1 contra o `ci.yml` real (`:39`), e a prova 2 foi
feita falhar três vezes: reverter a correção do leitor (`:60`), descartar as linhas sob um gatilho
(`:49`) e guardar só a primeira linha (`:46`). As 5 provas passam numa invocação. A suíte completa
deu 1 falha não identificada na primeira execução e 533/533 nas 14 seguintes (ver Gate).

## Binding sources

Carried from `bfaf355` (que carregou de `fad566f`): não há `plan.md` (`Plan: none`) e nenhuma fonte é
marcada como vinculante; a correção não tocou interface. O perfil `standard` não exige o passo 1.

| Source            | Opened | Contradiction | Uncovered |
| ----------------- | ------ | ------------- | --------- |
| no binding source | n/a    | -             | -         |

## Checks

Verified at `a8b81dd`. Proof run, uma única invocação na árvore real:
`npx vitest run tests/ci.workflow.test.ts tests/core.spawn-tree.test.ts --reporter=verbose` - exit 0,
`Test Files 2 passed (2)`, `Tests 5 passed (5)`, com cinco linhas `✓` individuais:

- `✓ tests/ci.workflow.test.ts > ci workflow triggers > C1 ci runs on pull requests and pushes to main 4ms`
- `✓ tests/ci.workflow.test.ts > ci workflow triggers > C1 the trigger reader rejects narrowed or look-alike filters 2ms`
- `✓ tests/core.spawn-tree.test.ts > cancellation kills a TERM-resistant descendant even when its parent exits first 132ms`
- `✓ tests/core.spawn-tree.test.ts > C3 liveness: alive, gone 0ms`
- `✓ tests/core.spawn-tree.test.ts > C4 liveness: a zombie is not alive 4ms`

Existência: `rg -n --glob '!.specs/**' 'C1 ci runs on pull requests|C1 the trigger reader rejects|TERM-resistant descendant even|C3 liveness: alive, gone|C4 liveness: a zombie'`
dá um hit por nome: `tests/ci.workflow.test.ts:33`, `:43`, `tests/core.spawn-tree.test.ts:8`, `:38`,
`:44`. Citações de `tests/ci.workflow.test.ts` refeitas (o comentário novo em `:18` deslocou a prova 1
em +1). Citações de `tests/core.spawn-tree.test.ts` e `tests/helpers.ts` carried from `bfaf355`
(arquivos intocados pela correção) e reconfirmadas por `rg -n 'expect'` nesta rodada: `:25`, `:39`,
`:41`, `:52`, `:55`; `tests/helpers.ts:64` é `return state !== "Z"`.

| Check | Claim                                                                                                                                                                                      | Proof run                                                                                                                          | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Result |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| C1    | dispara exatamente em `pull_request` (sem filtro), `push` com só `branches: [main]` e `workflow_dispatch`; leitor normaliza CRLF e recusa `main-legacy`, `paths` e `pull_request` restrito | batch acima, `✓ C1 ci runs on pull requests and pushes to main` e `✓ C1 the trigger reader rejects narrowed or look-alike filters` | prova 1 (lê `ci.yml` em `tests/ci.workflow.test.ts:34`): `:35` - `expect([...on.keys()].sort()).toEqual(["pull_request", "push", "workflow_dispatch"])`; `:37` - `expect(on.get("pull_request")).toEqual([])`; `:39` - `expect(on.get("push")).toEqual(["branches: [main]"])`; `:40` - `expect(on.get("workflow_dispatch")).toEqual([])`. Prova 2: `:52` - `expect(read("  push:\n    branches: [main-legacy]").get("push")).toEqual(["branches: [main-legacy]"])`; `:53-55` - `...get("pull_request")).toEqual(["branches: [release]"])`; `:60` - `expect(commented.get("push")).toEqual(["branches: [main]", "paths: [docs/**]"])`; `:50` - CRLF `toEqual(["branches: [main]"])`; `:45`, `:46-48`, `:49` - `.not.toEqual(...)` | PASS   |
| C2    | No Linux, zumbi (`Z` em `/proc/<pid>/stat`) conta como morto e o teste passa neste contêiner                                                                                               | `✓ cancellation kills a TERM-resistant descendant even when its parent exits first`                                                | `tests/core.spawn-tree.test.ts:25` - `await expect.poll(alive, { timeout: 1000 }).toBe(false)` com `alive = () => processAlive(pid)` em `:21`; decisão em `tests/helpers.ts:64` - `return state !== "Z"` (carried from `fad566f`: F3 provou que aqui o neto é zumbi)                                                                                                                                                                                                                                                                                                                                                                                                                                                             | PASS   |
| C3    | helper devolve `true` para `process.pid` e `false` para PID inexistente                                                                                                                    | `✓ C3 liveness: alive, gone`                                                                                                       | `tests/core.spawn-tree.test.ts:39` - `expect(processAlive(process.pid)).toBe(true)`; `:41` - `expect(processAlive(2 ** 30)).toBe(false)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | PASS   |
| C4    | No Linux, um zumbi criado de propósito (estado `Z`) é dado como não vivo pelo helper, em qualquer máquina                                                                                  | `✓ C4 liveness: a zombie is not alive`                                                                                             | pré-condição `tests/core.spawn-tree.test.ts:52-54` - `await expect.poll(() => <estado lido de /proc/${zombie}/stat>, { timeout: 2000 }).toBe("Z")`; decisão `:55` - `expect(processAlive(zombie)).toBe(false)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | PASS   |

Asserções que decidem C1. Prova 1: `:39` (igualdade exata do `push`, mata P6, P3, P4) e `:37` (mata
P2). Prova 2: `:60` (filtro depois de comentário na coluna 0 continua visível, mata R2), `:52` e
`:53-55` (o leitor guarda o texto que lê); os `not.toEqual` de `:45-49` agora também têm poder de
falha demonstrado (R3 em `:49`, R4 em `:46`).

Nível: carried from `bfaf355`. C1 é configuração provada lendo o arquivo (`:34`); C2, C3 e C4 afirmam o
retorno do próprio helper. Nenhuma afirmação nomeia status, rota ou formato de resposta - nenhum level
gap. C4 é `skipIf(process.platform !== "linux")`, coerente com "No Linux" da afirmação.

Observações sem mudar o resultado: a normalização CRLF em `:12` continua redundante com `\s*$` em
`:13`/`:21` e `trim()` em `:26` (R1 equivalente, carried from `bfaf355`; a correção não tocou esse
caminho), então `:50` prova que o leitor aceita CRLF, não que `:12` é necessária. A igualdade exata
segue recusando formas legítimas (`branches: [ main ]`, `- main` em bloco): falso negativo
conservador, aceitável para fixar configuração.

## Coverage

Verified at `a8b81dd` para a linha cuja autoridade a correção tocou (`filtros que estreitam um
gatilho`, agora 5 membros no `checks.md`). As demais carried from `bfaf355`: `ci.yml`,
`tests/helpers.ts` e `tests/core.spawn-tree.test.ts` não mudaram (`git diff bfaf355..a8b81dd --stat`
mostra só `tests/ci.workflow.test.ts` e `.specs/`); as citações de `ci.workflow.test.ts` foram
refeitas.

| Set (size)                             | Recomputed from                                                                                                                                                                                                                | Member -> proof                                                                                                                                                                                                                                                                                                                                                                                                                        | Unproven |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| filtros que estreitam um gatilho (5)   | verified at `a8b81dd`: sintaxe do GitHub Actions (`branches`/`branches-ignore`/`paths`/`paths-ignore`/`tags`/`types` sob `pull_request` e `push`) contra o leitor em `tests/ci.workflow.test.ts:11-30`; membros do `checks.md` | `main-legacy` C1 `:39` no arquivo real (P4 carried) e `:45`/`:52` no leitor · `paths` no push C1 `:39` (P3 carried) e `:46-48` (R4 morto) · `branches` no `pull_request` C1 `:37` (P2 carried) e `:49`/`:53-55` (R3 morto) · CRLF C1 `:50` e sonda P1 carried · filtro depois de comentário na coluna 0 C1 `:39` no arquivo real (P6 morto nesta rodada) e `:60` no leitor (R2 morto). Os demais filtros caem na mesma igualdade exata | -        |
| gatilhos do CI (3)                     | carried from `bfaf355`: `.github/workflows/ci.yml:5-9`, inalterado; parse `yaml` dá `{"pull_request":null,"push":{"branches":["main"]},"workflow_dispatch":null}`                                                              | conjunto exato C1 `:35` · `pull_request` C1 `:37` · `push` C1 `:39` · `workflow_dispatch` C1 `:40` (linhas refeitas)                                                                                                                                                                                                                                                                                                                   | -        |
| branch do filtro de `push` (1: `main`) | carried from `bfaf355`: `.github/workflows/ci.yml:8` (`branches: [main]`)                                                                                                                                                      | `main` exato C1 `:39`; P4a/P4b mortos em `bfaf355`                                                                                                                                                                                                                                                                                                                                                                                     | -        |
| terminação de linha (2: LF, CRLF)      | carried from `bfaf355`: `ci.yml` é LF; sem `.gitattributes`; a perna `windows-latest` roda o teste                                                                                                                             | LF C1 `:39` sobre o arquivo real · CRLF C1 `:50` e sonda P1                                                                                                                                                                                                                                                                                                                                                                            | -        |
| estados de processo (3)                | carried from `bfaf355`: Linux `proc(5)`; só `Z` decide "morto" em `tests/helpers.ts:64`                                                                                                                                        | vivo C3 `:39` · inexistente C3 `:41` · zumbi C4 `:55` em qualquer Linux e C2 `:25` neste contêiner                                                                                                                                                                                                                                                                                                                                     | -        |

Varredura de conjuntos sem linha, verified at `a8b81dd` para o leitor: um gatilho escrito em uma
linha (`  push: {branches: [main], paths: [docs]}`) ou com comentário no fim (`  push: # x`) não casa
`:21` e vira linha do gatilho anterior, o que quebra `:35`/`:37` - recusa conservadora, sem membro
novo. `on:` em fluxo (`on: [push]`) ou entre aspas não casa `:13` e falha em `:14`. Carried from
`bfaf355`:

- Ramo `tests/helpers.ts:66` (falha ao ler `/proc`): sem prova, declarado na Test policy como corrida
  sem prova determinística; leva ao estado "inexistente", já provado por `:57`/C3 `:41`. Registro, não
  lacuna.
- `kill(pid, 0)` com `EPERM`: inalcançável para as fixtures do próprio teste.
- Jobs condicionados (`if:` em `jobs.*`): fora da afirmação de C1, que fala só de gatilhos.

## Test policy rows

Re-julgada em `a8b81dd` a linha que classifica arquivo tocado (configuração: a prova que lê `ci.yml`
mudou). A linha do helper carried from `bfaf355` (estava `yes`; `tests/helpers.ts` e
`tests/core.spawn-tree.test.ts` intocados).

| Row                                                           | Files it classifies                       | Required proof                                                                                                    | Expectation met                                                                                                                                                                     |
| ------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decides, not reached across a boundary (helper de vivacidade) | `tests/helpers.ts:53-68` (`processAlive`) | uma prova na própria camada: C3 `tests/core.spawn-tree.test.ts:39,41` e C4 `:55`, todos sobre o retorno do helper | yes - carried from `bfaf355`: um caso afirmado por estado (vivo `:39`, inexistente `:41`, zumbi `:55`); `:66` registrado acima                                                      |
| Configuration (`ci.yml`)                                      | `.github/workflows/ci.yml:5-9`            | uma prova lendo o arquivo: C1 `tests/ci.workflow.test.ts:34`                                                      | yes - verified at `a8b81dd`: cada gatilho afirmado (`:37`, `:39`, `:40`) e o conjunto exato (`:35`); o leitor agora vê filtros depois de comentário na coluna 0 (P6 morto em `:39`) |

Swept `existing`, carried from `bfaf355` (`ci.yml` inalterado): concurrency em
`.github/workflows/ci.yml:11-13` (`group: ci-${{ github.ref }}`, `cancel-in-progress: true`) -
confere, relido nesta rodada. As linhas `n/a` são política aprovada.

## Faults injected

Verified at `a8b81dd`. Worktree descartável em `.../scratchpad/wt-r3` (`git worktree add --detach`,
`node_modules` por symlink), baseline `Tests 2 passed (2)` antes das mutações; cada mutação revertida
com `git checkout --` antes da próxima. Superfícies: a que a correção tocou (o leitor, `:19-20`) e a
que ela criou (as asserções novas da prova 2). 4 faults, teto de 5. Faults da rodada 2 (P4a, P4b, P3,
P2, Z) e da rodada 1 (F1-F5) carried from `bfaf355` / `fad566f`: superfícies intocadas (`ci.yml`,
`tests/helpers.ts`) ou asserções inalteradas (`:37`, `:39`, `:55`).

| Mutation                                                                                                                | Location                          | Killed                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P6 gatilhos reordenados (`push` por último), `# docs-only pushes for now` na coluna 0 e depois `    paths: ["docs/**"]` | `.github/workflows/ci.yml:5-11`   | yes - `yaml.parseDocument` dá 0 erros e `push = {"branches":["main"],"paths":["docs/**"]}`; só `-t "C1 ci runs on pull requests and pushes to main"`: falha em `tests/ci.workflow.test.ts:39:28` (`expected [ 'branches: [main]', …(1) ] to deeply equal [ 'branches: [main]' ]`) |
| R2 correção revertida: `if (/^\S/.test(line)) break;` volta para antes do `continue` de comentário                      | `tests/ci.workflow.test.ts:19-20` | yes - prova 1 passa (o `ci.yml` real não tem comentário dentro de `on:`) e a prova 2 falha em `:60:35` (`expected [ 'branches: [main]' ] to deeply equal [ 'branches: [main]', …(1) ]`) - a prova 2 pode falhar                                                                   |
| R3 leitor descarta toda linha sob um gatilho (`out.get(current)!.push(line.trim())` -> `void line`)                     | `tests/ci.workflow.test.ts:26`    | yes - só `-t "C1 the trigger reader rejects narrowed or look-alike filters"`: falha em `:49:86` (`expected [] to not deeply equal []`)                                                                                                                                            |
| R4 leitor guarda só a primeira linha de cada gatilho (`if (out.get(current)!.length === 0) ...push(...)`)               | `tests/ci.workflow.test.ts:26`    | yes - só a prova 2: falha em `:46:89` (`expected [ 'branches: [main]' ] to not deeply equal [ 'branches: [main]' ]`)                                                                                                                                                              |

Fora da tabela, carried from `bfaf355`: P1 (arquivo inteiro em CRLF passa nas duas provas) e R1
(remover a normalização CRLF em `:12` é mutante equivalente).

Isolamento: `git status --porcelain` da árvore real antes = vazio, depois = vazio (`cmp` igual);
porcelain do worktree vazio antes da remoção (fora o symlink, removido); `git worktree remove`
executado; `git worktree list` mostra só a árvore real e o `wt-motor` preexistente, que não foi tocado.

## Gate

`npx vitest run` (em `a8b81dd`, árvore real) - 533 passed, 0 failed (66 arquivos, nenhum skip), em
14 execuções seguidas (12 sequenciais e 2 em paralelo). A primeira execução, logo depois da remoção do
worktree, deu `Tests 1 failed | 532 passed (533)` / `Test Files 1 failed | 65 passed (66)`; só o
rodapé foi capturado, então o teste não foi identificado, e as 14 reexecuções com saída completa não
reproduziram a falha. As 5 provas desta feature passaram na invocação dedicada e em todas as
execuções completas capturadas.

Gaps em ordem (nenhum muda o veredito):

1. Falha intermitente não identificada na suíte completa - sem check - 1 em 15 execuções em
   `a8b81dd`, teste desconhecido. Não atribuível a esta feature com a evidência disponível; candidatos
   sensíveis a tempo incluem `tests/core.spawn-tree.test.ts:25` (`expect.poll` com 1000 ms), mas isso é
   hipótese. Registro.
2. Ramo `tests/helpers.ts:66` (falha ao ler `/proc`) sem prova - C2/C3/C4 - declarado na Test policy.
   Registro, baixa severidade.
3. Normalização CRLF em `tests/ci.workflow.test.ts:12` redundante (R1 equivalente) - C1 - `:50` prova
   que CRLF é aceito, não que `:12` é necessária. Registro.
