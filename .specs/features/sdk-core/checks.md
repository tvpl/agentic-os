# SDK do core checks

Profile: standard
Plan: `.specs/features/sdk-core/plan.md`

68 checks in 6 slices (S6 e as lacunas C47-C51 achadas depois) · 9 one-way doors (1-9, mais a 2a) · 3 open, of which 0 block

Comandos (da raiz):

- unit: `npx vitest run tests/<arquivo> -t "<nome>"`; o nome de cada teste começa por `C<n> ` (com o espaço), então `-t "C1 "` não casa `C10 `
- tipos: `npx tsc -p typetests/tsconfig.json` (arquivos `typetests/*.ts` com `// @ts-expect-error`; compila contra os `.d.ts` construídos, então roda depois de `npm run build:server`)
- build: `npm run build`, `npm run typecheck`, `npm run lint`, `npx vitest run`
- arquivos novos de teste: `tests/sdk.execution.test.ts` (S1, S2, S6), `tests/sdk.api-thin.test.ts` (S3, S6), `tests/sdk.api-http.test.ts` e `tests/sdk.cli.test.ts` (S6), `tests/sdk.instances.test.ts` (S4, S6), `tests/sdk.surface.test.ts` e `tests/sdk.package.test.ts` (S5), apoio em `tests/support/sdk.ts` (provedor em processo, home temporária) e `tests/support/moduleState.ts` (o leitor de estado de módulo, com autotestes em `tests/sdk.module-state.test.ts`)
- o provedor de teste é um adaptador EM PROCESSO (`echo`, sem CLI): a mesma classe que o exemplo do README mostra; os CLIs falsos só entram onde o claim é do adaptador real (C47)
- base da feature: `795306e`. Falhas que a base já tem (rodada inteira de `vitest` na base, 6 min): `tests/security-git.test.ts` C39 e `tests/api.v1.test.ts` C38 - o gate compara com isso

## Checks

### S1 - um programa só com `@mordomo/core` roda um agente · 7 files · 120 KB · ~30k

**C1** - Com um provedor registrado e habilitado por `engine.updateSettings`, `engine.execution.startPrompt({ prompt: "hi", provider: "echo", startedBy: null })` devolve `status: "queued"`, um `runId` e um `sessionId`, e `await wait(runId)` devolve um `RunRecord` com `status: "done"` (AC 1)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C1 "`
Status: closed

**C2** - Depois de a execução terminar, `events(runId)` devolve os eventos gravados em ordem de `id`, o último de tipo `result`, e `events(runId, afterId)` devolve só os de `id` maior que `afterId` (testado com `afterId` = o segundo `id`) (AC 2)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C2 "`
Status: closed

**C3** - `subscribe(runId, listener)` chamado antes de o provedor emitir entrega, em ordem, os 3 eventos que o provedor de teste emite (`text`, `text`, `result`), e depois de chamar a função devolvida o listener não recebe o quarto (AC 3)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C3 "`
Status: closed

**C4** - `cancel(runId)` de uma execução que espera um sinal devolve `true` e `wait` devolve `status: "cancelled"`; `cancel("00000000-0000-4000-8000-000000000000")` devolve `false` (AC 4)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C4 "`
Status: closed

**C5** - `get` de um id sem execução devolve `null`; com duas execuções do provedor `echo` e uma do provedor `echo2`, `list({ provider: "echo", limit: 1 })` devolve 1 execução, a mais nova, do `echo` (AC 5)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C5 "`
Status: closed

**C6** - `wait(runId, { signal })` com o sinal abortado antes do fim rejeita com o `reason` do sinal e a execução termina `done` depois, sem ser tocada (AC 6)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C6 "`
Status: closed

**C7** - `startPrompt` lança `ZodError` e não deixa sessão nem execução com `prompt` vazio, `prompt` de 20 001 caracteres, `timeoutMs` 9 999 e `timeoutMs` 3 600 001; aceita `prompt` de 20 000 caracteres, `timeoutMs` 10 000 e `timeoutMs` 3 600 000 (AC 7)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C7 "`
Status: closed

### S2 - as regras de segurança moram no core · 9 files · 150 KB · ~38k

**C8** - Com o perfil `review_before_write`, `startPrompt` com `mode: "write"` devolve `status: "waiting_approval"`, `pendingApproval.kind` `"write_run"` e um `runId` cuja linha está em `waiting_approval`, e o provedor de teste conta 0 chamadas de `execute` (AC 8)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C8 "`
Status: closed

**C9** - `resolveApproval(id, "approved", "owner")` dessa aprovação devolve o mesmo `runId` da execução parada, a execução chega a `done`, existe exatamente 1 linha em `runs` e o provedor foi chamado 1 vez (AC 9)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C9 "`
Status: closed

**C10** - `resolveApproval(id, "denied", "owner")` deixa a execução parada em `cancelled` e o provedor com 0 chamadas (AC 10)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C10 "`
Status: closed

**C11** - Com o perfil `read_only`, `startPrompt` com `mode: "write"` lança `MordomoError` com `statusCode` 403 e `code` `"profile_refused"`, e as tabelas `sessions` e `runs` ficam com 0 linhas (AC 11)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C11 "`
Status: closed

**C12** - `cwd` fora da home e das pastas indexadas, `cwd` que contém a home e `cwd` que é um link para `config/` lançam `PathAccessError` em `startPrompt` e em `startSkill`, sem sessão nem execução; `cwd` ausente e `cwd` igual à home criam a execução com `cwd` `<home>/workspace` (AC 12)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C12 "`
Status: closed

**C13** - Com `startedBy` `device:abc`, um provedor com `readConfinement` `"none"` faz `startPrompt` e `startSkill` lançarem `statusCode` 403 `code` `"device_provider_refused"` sem sessão; com `readConfinement` `"workdir"` a execução é criada (AC 13)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C13 "`
Status: closed

**C14** - Para cada um dos 4 perfis (`read_only`, `review_before_write`, `controlled_write`, `approved_automation`) e cada um de 2 pedintes (`owner`, `device:abc`), `startPrompt` com `mode: "write"` dá a decisão da tabela: `read_only` lança 403 `profile_refused` para os dois; `review_before_write` estaciona os dois; `controlled_write` e `approved_automation` põem o `owner` em `queued` e estacionam `device:abc` (AC 14)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C14 "`
Status: closed

**C15** - `resolveApproval(id, "approved", "device:abc")` lança 403 `self_approval` quando `device:abc` pediu a aprovação, e para cada um dos 11 tipos de aprovação criada por outro pedinte lança 403 `owner_only` em 9 deles e deixa passar `write_run` e `tool_use`; a lista dos 11 do teste é igual, lida da árvore sintática de `contracts/src/policy.ts`, à união `ApprovalKind` (um tipo novo sem linha reprova); a aprovação continua `pending` nos casos que lançam (AC 15)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C15 "`
Status: closed

**C16** - `provider: "ghost"` (não registrado) lança `statusCode` 400 `code` `"unknown_provider"`, e um provedor registrado com `enabled` falso lança `statusCode` 400, em `startPrompt` e em `startSkill`, sem sessão nem execução (AC 16)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C16 "`
Status: closed

**C17** - Com o mesmo `submissionId`: a segunda chamada de mesmo corpo e mesmo `startedBy` devolve o `runId` da primeira e `runs` tem 1 linha; corpo diferente e `startedBy` diferente lançam cada um 409 `submission_conflict`; uma reserva sem resposta (linha em `prompt_submissions` com `response` nulo) lança 409 `submission_uncertain` (AC 17)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C17 "`
Status: closed

**C18** - Quando o gate lança depois de o `submissionId` ser reservado (perfil `read_only`, `mode: "write"`), a linha de `prompt_submissions` não existe mais e a chamada seguinte com o mesmo `submissionId` e `mode: "read_only"` cria a execução (AC 18)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C18 "`
Status: closed

**C19** - `startSkill` lança 404 para a skill ausente, 400 para a skill desabilitada, 400 para um provedor que a skill não lista, 400 para um `input` obrigatório em branco e 409 `budget_exhausted` com o orçamento diário gasto, e nenhuma deixa linha em `runs` (AC 19)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C19 "`
Status: closed

**C20** - Sob `review_before_write`, `startSkill` de uma skill de escrita devolve `"waiting_approval"` com `pendingApproval`; de uma skill de leitura devolve `"queued"` e o prompt recebido pelo provedor é exatamente o de `SkillCatalog.buildRunPrompt(skill, inputs, <artifacts>/<runId>)` (AC 20)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C20 "`
Status: closed

**C21** - `retry` de uma execução de prompt cria uma execução com o mesmo prompt, provedor, modelo, esforço, `cwd` e modo, e `parentRunId` igual à primeira da linhagem; 409 `request_unavailable` sem `request` gravado; 409 `skill_unavailable` para skill removida; o mesmo `submissionId` do mesmo pedinte devolve o primeiro resultado e de outro pedinte lança 409 `submission_conflict` (AC 21)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C21 "`
Status: closed

**C22** - `resolveApproval` de uma aprovação além do TTL (`approvalTtlDays` 1 e relógio avançado em 2 dias) lança 409 e a execução que ela parava está `cancelled` (AC 22)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C22 "`
Status: closed

**C23** - `smokeTest("echo", null)` devolve `{ run, passed: true }` quando o provedor responde `MORDOMO_OK` e `passed: false` com `run.status` `"done"` quando responde outra coisa; a execução roda em `<home>/workspace` (AC 23)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C23 "`
Status: closed

**C24** - `startPrompt` com o `sessionId` de uma conversa do provedor `echo2` e sem `provider` nem `cwd` cria a execução com provedor `echo2` e o `cwd` da sessão; com um `sessionId` desconhecido lança 404 e não cria execução (AC 24)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C24 "`
Status: closed

**C25** - `startPrompt` com `parentRunId` cria a execução com `parentRunId` igual ao informado (AC 25)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C25 "`
Status: closed

**C26** - Com `<home>/workspace` sendo um arquivo, `startPrompt` lança 409 `workspace_unavailable` e `sessions` e `runs` ficam com 0 linhas (AC 26)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C26 "`
Status: closed

**C27** - `pendingApprovals()` devolve exatamente as aprovações `pending` (3 criadas: uma aprovada, uma negada, uma expirada, uma pendente → devolve só a pendente) (AC 27)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C27 "`
Status: closed

### S3 - a API e a CLI são clientes finos · 14 files · 160 KB · ~40k

**C28** - Lendo o código (árvore sintática), os únicos arquivos fora de testes que iniciam uma execução (`runs.create`, `runs.execute`: chamados, por elemento de acesso `["create"]`, por conversão de tipo, por um alias de `runs` ou desestruturados) são `core/src/engine.ts` (a execução parada do gate), os de `core/src/execution/`, `core/src/routines/scheduler.ts` e `core/src/sentinels/triage.ts`; nenhum arquivo de `apps/api/src` os usa, nenhum chama `gateWrite` fora de `core/src/engine.ts` e `core/src/execution/`, nenhum escreve em `prompt_submissions` nem em `run_action_receipts` fora de `core/src/execution/`, e o único arquivo fora de `core/src/execution/` que chama `gateAndLaunchSkill`, `launchSkillRun` ou `launchPromptRun` é `apps/api/src/routes/objectives.ts`, uma vez; o leitor é provado contra fontes de exemplo de cada forma (AC 28; F41, F42, F43)
Proof: `npx vitest run tests/sdk.api-thin.test.ts -t "C28 "`
Status: closed

**C29** - As oito suítes `tests/api.profiles.test.ts`, `tests/api.submission.test.ts`, `tests/api.run-retry.test.ts`, `tests/api.hardening.test.ts`, `tests/device-scopes.test.ts`, `tests/api.sessions.test.ts`, `tests/api.objectives.test.ts` e `tests/cli.write-gate.test.ts` passam com as asserções iguais às da base `795306e` (o diff dessas suítes contra a base `795306e` só altera linhas de importação e linhas que mencionam `events`, verificado por um teste que reprova qualquer outra linha alterada); as respostas que a feature muda de propósito têm os checks C61 e C63 (AC 29)
Proof: `npx vitest run tests/sdk.api-thin.test.ts -t "C29 "`
Proof: `npx vitest run tests/api.profiles.test.ts tests/api.submission.test.ts tests/api.run-retry.test.ts tests/api.hardening.test.ts tests/device-scopes.test.ts tests/api.sessions.test.ts tests/api.objectives.test.ts tests/cli.write-gate.test.ts`
Status: closed

### S4 - dois motores no mesmo processo não compartilham estado · 18 files · 230 KB · ~35k

**C30** - Lendo o código (árvore sintática) de `core/src` e dos três adaptadores, o estado mutável de nível de módulo é exatamente os 9 itens da lista fechada (`restoreLock.ts` `heldHere` e `live`, `safeSpawn.ts` `ownedKillers`, `which.ts` `pathCache`, `ownerLock.ts` o registro de locks, em `globalThis` sob `Symbol.for` (o leitor acusa qualquer `globalThis`), `notifications/recorder.ts` e `memory/journal.ts` `installed` e `memory/related.ts` `caches`, chaveados pela instância, e `channels/pushEndpoint.ts` `PRIVATE`, a tabela de faixas enchida ao carregar), cada um com um motivo escrito na lista; um item novo ou removido reprova (AC 30)
Proof: `npx vitest run tests/sdk.instances.test.ts -t "C30 "`
Status: closed

**C31** - Com dois motores de homes diferentes no mesmo processo, cada um dos 11 módulos que anunciam (`config/store`, `ui-preferences`, `objectiveStore`, `notifications/store`, `backup`, `sessionStore`, `runManager`, `indexer`, `scheduler`, as aprovações do motor e os sentinelas) emite no barramento do motor A e o listener do B recebe 0 eventos; `lastId` de A passa de 0 e o de B fica 0 (AC 31)
Proof: `npx vitest run tests/sdk.instances.test.ts -t "C31 "`
Status: closed

**C32** - Construindo o motor A com um registro cujo binário é `alpha` e depois o B com `beta`: `A.spawnPolicy.assertAllowed("alpha")` passa e `("beta")` lança `ExecutableNotAllowedError`; `B.spawnPolicy.assertAllowed("beta")` passa e `("alpha")` lança; `node` passa nos dois e um caminho em `allowPaths` passa só quando informado (AC 32)
Proof: `npx vitest run tests/sdk.instances.test.ts -t "C32 "`
Status: closed

**C33** - Com `limits`/ambiente que fazem A largar `A_SECRET` e B largar `B_SECRET`, um probe por `spawnPolicy.probe` que imprime o ambiente mostra: pela política de A, `B_SECRET` presente e `A_SECRET` ausente; pela de B, o contrário; `MORDOMO_` ausente nas duas (AC 33)
Proof: `npx vitest run tests/sdk.instances.test.ts -t "C33 "`
Status: closed

**C34** - `relatedEdges` para dois bancos com os mesmos `id` e `mtime` e conteúdos diferentes devolve, em qualquer ordem de chamada (A,B,A e B,A,B), as arestas do conteúdo de cada um, com termos diferentes (AC 34)
Proof: `npx vitest run tests/sdk.instances.test.ts -t "C34 "`
Status: closed

**C35** - Com A em `start()`, o `start()` de B na mesma home lança `EngineLockedError` com `holderPid` igual a `process.pid` e o arquivo de lock não muda (mesmo `token`); depois de `A.stop()` o `start()` de B passa; B em outra home passa com A ainda ligado; um lock escrito à mão com o PID do processo e fora do registro continua sendo tomado (AC 35)
Proof: `npx vitest run tests/sdk.instances.test.ts -t "C35 "`
Status: closed

**C36** - Com um `RestoreLock` exclusivo na home A, construir o motor da home B retorna sem esperar (menos de 1 000 ms com `restoreWaitMs` 10 000); dois motores da mesma home no mesmo processo são construídos (AC 36)
Proof: `npx vitest run tests/sdk.instances.test.ts -t "C36 "`
Status: closed

### S5 - o pacote é publicável e a superfície é uma lista fechada · 16 files · 190 KB · ~48k

**C37** - `Object.keys` de `@mordomo/core` é exatamente os 11 valores das doors 2 e 2a (ordem alfabética), `@mordomo/core/internal` não tem `events`, `setProviderBinaries` nem `setProbeEnvDrop` nem nenhum dos 11, e os tipos exportados por `core/src/index.ts` (lidos pelo compilador) são exatamente a lista de `tests/fixtures/sdk-public-types.json` (AC 37)
Proof: `npx vitest run tests/sdk.surface.test.ts -t "C37 "`
Status: closed

**C38** - Cada um dos nomes que `core/src/index.ts` exportava na base (603, fixos em `tests/fixtures/core-exports-before.json`) está em exatamente um entre `@mordomo/core` e `@mordomo/core/internal`, ou é um dos 3 removidos (`events`, `setProviderBinaries`, `probe`) com o motivo escrito no fixture, e os três esquemas zod `ProviderId`, `EffortLevel` e `SecurityProfile` são os únicos em ambos (tipo no público, esquema no `internal`) (AC 38)
Proof: `npx vitest run tests/sdk.surface.test.ts -t "C38 "`
Status: closed

**C39** - Cada um dos exports de `@mordomo/core` tem comentário de documentação (lido pelo compilador) e um título `### <nome>` em `docs/sdk.md`, e cada título `### <nome>` do arquivo nomeia um export (AC 39)
Proof: `npx vitest run tests/sdk.surface.test.ts -t "C39 "`
Status: closed

**C40** - `startPrompt({ prompt: "x" })` sem `startedBy`, a leitura de `engine.db`, `engine.runs` e `engine.approvals` num `Engine`, `resolveApproval(id, "maybe", null)` e `createEngine({ providers, applyPendingRestore: true })` não compilam (`// @ts-expect-error`), e a chamada mínima do README compila (AC 40)
Proof: `npx tsc -p typetests/tsconfig.json`
Status: closed

**C41** - `core/package.json` e `contracts/package.json` têm, literalmente, `license` `"SEE LICENSE IN LICENSE"`, `engines` `{ "node": ">=22" }`, `sideEffects` `false`, `files` `["dist", "!dist/**/*.map", "!dist/**/*.tsbuildinfo", "README.md", "LICENSE"]`, `publishConfig` `{ "access": "public" }` e nenhum `private`, `repository` `{ type: "git", url: "git+https://github.com/tvpl/agentic-os.git", directory }`; `core/package.json` tem `exports` igual aos dois pontos da door 2 e `peerDependencies` `{ "@types/node": ">=22" }` com `peerDependenciesMeta` opcional; o `LICENSE` de cada um é igual, byte a byte, ao `LICENSE` da raiz e contém `# Functional Source License, Version 1.1, ALv2 Future License` (a raiz hoje abre com o bloco de aviso `<!-- MINUTA PARA REVISÃO DO DONO`, que o dono apaga depois da revisão; o teste não depende dele) e o `README.md` de cada um não tem link relativo que saia do pacote (AC 41)
Proof: `npx vitest run tests/sdk.package.test.ts -t "C41 "`
Status: closed

**C42** - `npm pack --dry-run --json` de `@mordomo/core` e de `@mordomo/contracts` lista `package.json`, `README.md`, `LICENSE` e os arquivos de `dist` para onde `exports` aponta, e 0 arquivos `.map`, `.test.`, `.tsbuildinfo`, `src/`, `tests/`, `fixtures/`, `.env` ou com nome de segredo (os padrões de `SECRET_FILE_PATTERNS`) (AC 42)
Proof: `npx vitest run tests/sdk.package.test.ts -t "C42 "`
Status: closed

**C43** - Com os dois `.tgz` extraídos num projeto vazio (ligadas ao repositório só as dependências e `peerDependencies` que os manifestos declaram, e o `typescript`), `node` roda o exemplo do README com saída 0, o exemplo do README e um `.ts` que importa `createEngine` e os tipos públicos compilam com `tsc --noEmit` (strict, `skipLibCheck: false`), e `import("@mordomo/core/dist/engine.js")` falha com `ERR_PACKAGE_PATH_NOT_EXPORTED` (AC 43)
Proof: `npx vitest run tests/sdk.package.test.ts -t "C43 "`
Status: closed

**C44** - O bloco marcado `<!-- example:quickstart -->` de `core/README.md`, extraído, transpilado e executado contra os fontes, sai com 0 e imprime `done` (AC 44)
Proof: `npx vitest run tests/sdk.package.test.ts -t "C44 "`
Status: closed

**C45** - Importar `@mordomo/core` num processo Node novo cria 0 arquivos no diretório de trabalho e na pasta temporária, não acrescenta ouvinte a `process` e o processo sai sozinho em menos de 5 s (AC 45)
Proof: `npx vitest run tests/sdk.package.test.ts -t "C45 "`
Status: closed

**C46** - `npm run build` sai com 0 e deixa `core/dist/index.d.ts` e `core/dist/internal.d.ts`; `npm run typecheck` e `npm run lint` saem com 0 (AC 46)
Proof: `npm run build && test -f core/dist/index.d.ts && test -f core/dist/internal.d.ts && npm run typecheck && npm run lint`
Status: closed

### Lacunas que a leitura do código achou ao escrever os checks

**C47** - Um `ClaudeAdapter` criado sem `spawn` usa uma política que permite `node` e `claude` e recusa `cursor-agent` (`ExecutableNotAllowedError`) no `probe`, e um adaptador criado pela fábrica do motor usa a política do motor (a mesma instância de `engine.spawnPolicy`) (door 4)
Proof: `npx vitest run tests/sdk.instances.test.ts -t "C47 "`
Status: closed

**C48** - `npm run dist:quick` monta o pacote de distribuição e `mordomo status --json` dele imprime `"running":false` (o empacotador resolve `@mordomo/core/internal` pelo `exports`) (AC 46; configuração de partida)
Proof: `npm run dist:quick && stage=$(ls -d build/package/*/ | head -1) && MORDOMO_HOME=$(mktemp -d) MORDOMO_SKIP_NPM_AUDIT=1 "$stage/bin/mordomo" status --json | grep -q '"running":false'` (o passo "Packager smoke" do CI, depois de `npm run build`)
Status: closed

**C49** - O leitor de estado de módulo (`tests/support/moduleState.ts`) acusa cada uma destas formas em fontes de exemplo: `let x`, `var x`, `const m = new Map()`, `const s = new Set()` com `.add` no arquivo, `const o = {}` com atribuição de propriedade no arquivo, `const a = []` com `.push` no arquivo, `const e = new EventBus()`, `globalThis` usado num registro ou lido numa função; e não acusa: `const T = [..]` e `const O = {..}` só lidos, `const R = /x/`, `const f = () => {}`, uma classe, e um `let` dentro de função (AC 30)
Proof: `npx vitest run tests/sdk.module-state.test.ts -t "C49 "`
Status: closed

**C50** - `ENGINE_ERROR_CODES` é, em `toEqual`, a lista de 14 códigos da door 5 (`profile_refused`, `unknown_provider`, `device_provider_refused`, `self_approval`, `owner_only`, `submission_conflict`, `submission_uncertain`, `budget_exhausted`, `request_unavailable`, `skill_unavailable`, `workspace_unavailable`, `engine_locked`, `approval_expired`, `approval_resolved`) e cada um aparece em `docs/sdk.md` (door 5)
Proof: `npx vitest run tests/sdk.surface.test.ts -t "C50 "`
Status: closed

**C51** - Um provedor em processo cujo `execute` lança deixa a execução `failed` com `error` igual à mensagem lançada, `wait` resolve essa execução, e `onError` de `StartOptions` não é chamado (o `execute` do `RunManager` trata a falha) (AC 1; dependência)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C51 "`
Status: closed

### S6 - a fachada segura onde a primeira verificação a atacou · 30 files · 110 KB · ~28k

Acrescentado na correção da rodada 1 (11/10/2026), depois de a verificação achar uma regressão HTTP e 21 mutantes vivos; cada check mata os mutantes que o relatório nomeia (`verification.md`, "Faults injected").

**C52** - `wait` de uma execução que já terminou devolve o registro (sem esperar um evento que não virá) e `wait` de um id sem execução rejeita com `statusCode` 404; depois de resolver, de rejeitar e de ser abortado, o barramento do motor não tem ouvinte a mais (AC 47; F22, F16)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C52 "`
Status: closed

**C53** - Uma execução deixada `running` por um processo morto, com um `wait` já registrado, termina quando `runs.recoverInterrupted()` a marca `interrupted`: `run.finished` é anunciado com esse status e o `wait` devolve o registro (AC 48)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C53 "`
Status: closed

**C54** - `retry` de um `retry` cria uma execução cujo `parentRunId` é a primeira da linhagem (não o retry), e a requisição retida de um prompt de escrita continua `write` (o provedor recebe `mode` `write` três vezes); o mesmo vale para uma skill (AC 49; F05, H14)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C54 "`
Status: closed

**C55** - `retry` com `startedBy` `null` grava `program` no recibo (`run_action_receipts.requested_by`), repete para `null` e dá `submission_conflict` para `"owner"`; um `retry` que o gate recusa depois do recibo (perfil `read_only`) apaga o recibo e o mesmo `submissionId` serve ao retry seguinte (AC 50; F04, F06)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C55 "`
Status: closed

**C56** - `startPrompt`, `startSkill` e `retry` sem `startedBy`, com `undefined`, com `""`, com `"null"` e com `"program"` lançam `ZodError` e não deixam sessão nem execução (AC 51; F44)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C56 "`
Status: closed

**C57** - Com um provedor de `writeConfinement` `"none"`, `startPrompt` de escrita pelo `owner` devolve `"waiting_approval"` (e o provedor com 0 chamadas) sob `controlled_write` e `review_before_write`, e `"queued"` sob `approved_automation`; com `"broker"` sob `controlled_write` devolve `"queued"` (AC 52; F25)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C57 "`
Status: closed

**C58** - Uma skill de `budgetUsd` 1 com 0,75 gasto roda com `maxCostUsd` 0,25; com o gasto somado em exatamente 1,00 `startSkill` lança 409 `budget_exhausted`; com 0,95 roda com `maxCostUsd` 0,05 (AC 53; F11)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C58 "`
Status: closed

**C59** - `resolveApproval` aprovando e negando duas escritas paradas anuncia, nessa ordem, `approval.resolved` com `{ id, kind: "write_run", status, runId }`, o `runId` da execução lançada ao aprovar e `null` ao negar (AC 54; H11)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C59 "`
Status: closed

**C60** - `resolveApproval` de uma aprovação já decidida lança `MordomoError` 409 `approval_resolved`; de uma além do TTL, varrida pela chamada ou chamada direto no `ApprovalStore` antes da varredura, lança `MordomoError` 409 `approval_expired` (AC 55)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C60 "`
Status: closed

**C61** - Com `settings.limits.defaultTimeoutMs` 7 200 000, `POST /api/objectives/:id/dispatch` de um passo de prompt com 20 000 caracteres responde 200, a execução tem `timeoutMs` 7 200 000 e prompt maior que 20 000 (o pacote de contexto); `timeoutMs` 3 600 001 no corpo responde 400 e 3 600 000 responde 200; `POST /api/runs` com prompt de 20 001 responde 400 e sem `timeoutMs` toma o default do setting (AC 56; F18, a regressão HTTP)
Proof: `npx vitest run tests/sdk.api-http.test.ts -t "C61 "`
Status: closed

**C62** - `closeAllSse(servidorA)` fecha o canal aberto por uma requisição de A e não o de B, no mesmo processo (AC 57; F35)
Proof: `npx vitest run tests/sdk.api-http.test.ts -t "C62 "`
Status: closed

**C63** - Repetir `POST /api/runs/:id/retry` com o `submissionId` de um retry que estacionou responde 202 com o mesmo corpo, e com o de um que ficou `queued` responde 200 (AC 58)
Proof: `npx vitest run tests/sdk.api-http.test.ts -t "C63 "`
Status: closed

**C64** - A execução que `POST /api/skills/:slug/notes/promote` estaciona e a que `POST /api/providers/:id/smoke` roda têm `startedBy` `"owner"` (AC 59; G04, G12)
Proof: `npx vitest run tests/sdk.api-http.test.ts -t "C64 "`
Status: closed

**C65** - `cancel(runId, motivo)` de uma execução parada deixa `error` igual ao motivo, e de uma em andamento grava um evento `permission` com `detail` igual ao motivo (AC 60; H08)
Proof: `npx vitest run tests/sdk.execution.test.ts -t "C65 "`
Status: closed

**C66** - Com o motor A em `start()` numa home, o `start()` de um motor da mesma pasta escrita por um link lança `EngineLockedError`, e o de um motor de outra cópia do pacote (módulos recarregados) lança um erro de `code` `"engine_locked"` e `holderPid` `process.pid`; depois de `A.stop()` o `start()` pelo link passa (AC 61; F33, o registro em `globalThis`)
Proof: `npx vitest run tests/sdk.instances.test.ts -t "C66 "`
Status: closed

**C67** - `mordomo run` (a CLI construída) sai com 1, imprime o motivo e deixa 0 execuções novas para: skill desabilitada, skill que não lista o provedor, provedor não habilitado, entrada obrigatória ausente ou em branco, e orçamento diário gasto; com 0,40 gasto de `budgetUsd` 1 a execução que cria tem `max_cost_usd` 0,6 (AC 62)
Proof: `npx vitest run tests/sdk.cli.test.ts -t "C67 "`
Status: closed

**C68** - Lendo o código (árvore sintática) de `apps/api/src`, os únicos `.min(`/`.max(` com um número igual a um dos de `RUN_LIMITS` (20 000, 10 000, 3 600 000) são o excerto de `routes/memory.ts` e a descrição de `routes/objectives.ts`; os de pedido de execução importam `RUN_LIMITS` (AC 63)
Proof: `npx vitest run tests/sdk.api-thin.test.ts -t "C68 "`
Status: closed

## Coverage

| Set (size)                                                           | Member -> proof                                                                                                                                                                                                                                                                                                                                                                                                                                            | Unproven |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| métodos de `Execution` (12)                                          | `startPrompt` C1 · `startSkill` C19 · `retry` C21 · `resolveApproval` C9 · `smokeTest` C23 · `get` C5 · `list` C5 · `cancel` C4 · `events` C2 · `subscribe` C3 · `wait` C1 · `pendingApprovals` C27                                                                                                                                                                                                                                                        | -        |
| códigos de `ENGINE_ERROR_CODES` (14)                                 | `profile_refused` C11 · `unknown_provider` C16 · `device_provider_refused` C13 · `self_approval` C15 · `owner_only` C15 · `submission_conflict` C17 · `submission_uncertain` C17 · `budget_exhausted` C19 · `request_unavailable` C21 · `skill_unavailable` C21 · `workspace_unavailable` C26 · `engine_locked` C35 · `approval_expired` C60 · `approval_resolved` C60                                                                                     | -        |
| perfil × pedinte em escrita (8)                                      | C14, table-driven over all 8 (4 perfis × `owner` e `device:abc`)                                                                                                                                                                                                                                                                                                                                                                                           | -        |
| `ApprovalKind` aprovado por dispositivo (11)                         | C15, table-driven over all 11, a lista conferida contra a união do contrato                                                                                                                                                                                                                                                                                                                                                                                | -        |
| recusas de `startSkill` (5)                                          | skill ausente C19 · desabilitada C19 · provedor não listado C19 · entrada obrigatória em branco C19 · orçamento gasto C19                                                                                                                                                                                                                                                                                                                                  | -        |
| arestas de limite de `startPrompt` (7)                               | prompt vazio C7 · prompt 20 000 C7 · prompt 20 001 C7 · prazo 9 999 C7 · prazo 10 000 C7 · prazo 3 600 000 C7 · prazo 3 600 001 C7                                                                                                                                                                                                                                                                                                                         | -        |
| desfechos de uma aprovação parada (3)                                | aprovada C9 · negada C10 · expirada C22                                                                                                                                                                                                                                                                                                                                                                                                                    | -        |
| lugares que iniciam uma execução fora de testes (5)                  | `core/src/engine.ts` (a parada do gate) C28 · `core/src/execution/` C28 · `core/src/routines/scheduler.ts` C28 · `core/src/sentinels/triage.ts` C28 · `apps/api/src` (nenhum) C28                                                                                                                                                                                                                                                                          | -        |
| rotas e comandos que iniciam ou aprovam (13)                         | `POST /api/runs` C29 · `POST /api/runs/:id/children` C29 · `POST /api/runs/:id/retry` C29 · `POST /api/sessions/:id/continue` C29 · `POST /api/skills/:slug/run` C29 · `POST /api/skills/:slug/notes/promote` C29 · `POST /api/objectives/:id/dispatch` C29 · `POST /api/providers/:id/smoke` C29 · `POST /api/approvals/:id/resolve` C29 · botões do Telegram C29 · broker de permissão C29 · `mordomo run` C29 · smoke do assistente de configuração C29 | -        |
| módulos que anunciam no barramento (11)                              | `config/store` C31 · `ui-preferences` C31 · `objectiveStore` C31 · `notifications/store` C31 · `backup` C31 · `sessionStore` C31 · `runManager` C31 · `indexer` C31 · `scheduler` C31 · aprovações do motor C31 · sentinelas C31                                                                                                                                                                                                                           | -        |
| singletons removidos (4)                                             | `events` C31 · `providerBinaries` C32 · `probeEnvDrop` C33 · cache de `related.ts` C34                                                                                                                                                                                                                                                                                                                                                                     | -        |
| estado de módulo que fica, com o motivo (9)                          | `heldHere` C30 · `live` C30 · `ownedKillers` C30 · `pathCache` C30 · registro de locks C30 · `installed` do recorder C30 · `installed` do journal C30 · `caches` de `related.ts` C30 · `PRIVATE` de `pushEndpoint.ts` C30                                                                                                                                                                                                                                  | -        |
| formas que o leitor de estado acusa ou deixa passar (12)             | acusa: `let` C49 · `var` C49 · `new Map` C49 · `Set` com `.add` C49 · objeto com atribuição C49 · array com `.push` C49 · `new EventBus` C49; deixa passar: tabela só lida C49 · regex C49 · função C49 · classe C49 · `let` em função C49                                                                                                                                                                                                                 | -        |
| nomes removidos do barril (3)                                        | `events` C38 · `setProviderBinaries` C38 · `probe` C38                                                                                                                                                                                                                                                                                                                                                                                                     | -        |
| valores exportados por `@mordomo/core` (11)                          | C37, table-driven over all 11 (`toEqual` da lista)                                                                                                                                                                                                                                                                                                                                                                                                         | -        |
| campos do manifesto do pacote (7)                                    | `license` C41 · `engines` C41 · `sideEffects` C41 · `files` C41 · `publishConfig` C41 · sem `private` C41 · `exports` C41                                                                                                                                                                                                                                                                                                                                  | -        |
| pacotes (2)                                                          | `@mordomo/core` C42 · `@mordomo/contracts` C42                                                                                                                                                                                                                                                                                                                                                                                                             | -        |
| startup config: resolução de `@mordomo/core/internal` (5 assemblies) | `tsc -b` C46 · alias do `vitest.config.ts` C37 · projeto de tipos `typetests` C40 · instalação do `.tgz` C43 · empacotador `dist:quick` C48                                                                                                                                                                                                                                                                                                                | -        |
| startup config: o exemplo do README (2 assemblies)                   | contra os fontes C44 · contra o `.tgz` instalado C43                                                                                                                                                                                                                                                                                                                                                                                                       | -        |
| doors (9)                                                            | 1 C1, C8, C40 · 2 e 2a C37, C41 · 3 C31 · 4 C32, C33, C47 · 5 C50, C60 · 6 C41, C42, C43 · 7 C35, C66 · 8 C40, C43 · 9 C43                                                                                                                                                                                                                                                                                                                                 | -        |
| respostas HTTP que a feature muda de propósito (2)                   | `dispatch` com o default de setting acima do teto C61 (corrigida: 200 como na base) · replay de um retry estacionado C63 (202, dito em AD-022 e)                                                                                                                                                                                                                                                                                                           | -        |
| pedinte gravado por rotas que o relatório nomeou (2)                 | `notes/promote` C64 · smoke de provedor C64                                                                                                                                                                                                                                                                                                                                                                                                                | -        |
| recusas e teto de `mordomo run` (7)                                  | skill desabilitada C67 · provedor que a skill não lista C67 · provedor não habilitado C67 · entrada ausente C67 · entrada em branco C67 · orçamento gasto C67 · teto de custo da run C67                                                                                                                                                                                                                                                                   | -        |
| formas de iniciar uma execução que o C28 acusa (7)                   | `runs.create` chamado C28 · `[\"create\"]` com conversão C28 · alias de `runs` C28 · desestruturado C28 · `gateAndLaunchSkill` direto C28 · `launchPromptRun` C28 · chave calculada C28                                                                                                                                                                                                                                                                    | -        |
| números de `RUN_LIMITS` que as rotas importam (3)                    | 20 000 C68 · 10 000 C68 · 3 600 000 C68                                                                                                                                                                                                                                                                                                                                                                                                                    | -        |
| `startedBy` recusado em tempo de execução (5)                        | ausente C56 · `undefined` C56 · vazio C56 · `"null"` C56 · `"program"` C56                                                                                                                                                                                                                                                                                                                                                                                 | -        |

- Claims naming a status code, route or response shape: C11, C13, C15, C16, C17, C19, C21, C22, C24, C26 (cada um tem uma prova que cruza a fronteira da fachada); as rotas HTTP não mudam e continuam provadas pelas oito suítes de C29, que cruzam o HTTP
- C29 usa as suítes inteiras de propósito: o claim é "continuam passando sem mudar de asserção", e a prova de que as asserções não mudaram é o teste de diff, não o nome de um caso
- C28 e C49 leem a árvore sintática do TypeScript (lição L-029), não regex; C49 prova o leitor contra formas que ele deve e que não deve acusar
- C14, C15, C31, C37 e C57 são table-driven: a enumeração mora no teste (lição L-030)
- Claims naming a status code, route or response shape, acrescentados na rodada 1: C60, C61, C63, C67 (cada um cruza a fronteira: a fachada, o HTTP ou a CLI construída)
- Nenhum outro check afirma mais que o caso que a sua prova exercita

## Test policy

| Code                                                                                                                                       | Required proofs                                                                            | Coverage expectation                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decides, reached across a boundary (a fachada `Execution`: perfil, pedinte, cwd, provedor, `submissionId`, aprovação)                      | one at the boundary (a chamada pública de `engine.execution`) **and** o existente pela API | the contract at the boundary; one asserted case per row of each decision table (perfil × pedinte, tipo de aprovação, recusas da skill, arestas de limite) |
| Decides, not reached across a boundary (`SpawnPolicy.assertAllowed`, o registro de locks do `OwnerLock`, a chave do cache de `related.ts`) | one at its own layer                                                                       | one asserted case per row                                                                                                                                 |
| Entry point that decides nothing (rotas e comandos que viram clientes da fachada)                                                          | the existing suites (C29) and a source check (C28)                                         | accepted input, each rejected input, each error path - já nas oito suítes                                                                                 |
| Instrumentation (o barril público e `internal`, `package.json`)                                                                            | a closed-list test (`toEqual`)                                                             | every name, every field                                                                                                                                   |

Evidence:

- `apps/api/src/routes/common.ts` `submitPromptRun()`/`createPromptSubmission()`: 5 desvios (recibo existente, conflito, incerto, reserva, falha) e 4 recusas antes de criar -> decides; passa para `core/src/execution/service.ts`
- `apps/api/src/approvalActions.ts` `resolveApproval()`: 6 pontos (expirar, auto-aprovação, tipo de dono, provedor removido, expose_port, write_run) -> decides
- `core/src/spawn/safeSpawn.ts` `assertAllowed()`: nome × allowlist × `allowPaths`, 3 desvios -> decides (C32, C47)
- `core/src/ownerLock.ts` `lockIsStale()`: registro × PID × `procStart`, 4 desvios -> decides (C35; `tests/data.owner-lock.test.ts` já prova o resto)
- `core/src/memory/related.ts` `relatedEdges()`: chave do cache -> decides (C34)
- `core/src/index.ts` e `core/package.json`: reexportam e declaram, sem condição -> instrumentation (C37, C38, C41)
- closest analogue in the repo: `tests/core.engine.test.ts` (motor-composicao), `tests/contracts.test.ts` C16 (a lista fechada de `exports` com `toEqual`) e `tests/provedores-plugaveis` C25 (o `binaryPath` aplicado onde é usado)

Cost: 6 arquivos de teste novos e 3 de apoio (`tests/support/`), 2 fixtures e 1 arquivo de tipos, com 51 provas; os 60 arquivos de teste, 3 adaptadores e a API que importam `@mordomo/core` mudam a linha de importação (feito por script, conferido pela compilação e pelo lint), e os 16 testes que escutavam o barramento do processo passam a construir ou ler o barramento do motor.

## Swept

- validation: C7 (limites do prompt e do prazo), C19 (entrada obrigatória), C16 (id de provedor), C26 (a pasta de trabalho)
- failure modes: C11, C12, C13, C16, C19, C26 (a recusa vem antes de qualquer sessão ou execução), C18 (a reserva volta), C51 (o provedor que lança)
- idempotency: C17, C18, C21
- authorization: C13, C14, C15 (o pedinte decide o que passa); a credencial HTTP continua sendo a da feature 1 (existing - `onRequest` de `server.ts`, provada por `tests/api.security-p0.test.ts`)
- concurrency: C35 (dois `start()` da mesma home no mesmo processo), C36 (dois motores e o `RestoreLock`), C17 (a reserva do `submissionId` é a trava entre duas chamadas)
- data lifecycle: n/a - nenhum dado novo é gravado e nenhuma tabela muda; execuções, recibos e aprovações mantêm a retenção que já têm (dados-v2)
- dependency failure: C16 (provedor não registrado ou desabilitado), C51 (o adaptador falha no meio), C13 (o provedor lê o disco inteiro)
- state transitions: C4 (`running` para `cancelled`), C8 e C9 (`waiting_approval` para `queued`/`done`), C10 (`waiting_approval` para `cancelled`), C22 (aprovação expirada)
- observability: C2 e C3 (os eventos de uma execução), C31 (o barramento de cada motor), C50 (os códigos de erro são uma lista documentada), C53 e C59 (`run.finished` da recuperação e `approval.resolved` da decisão)
- cleanup: C52 (o ouvinte do `wait` sai nos três desfechos), C55 (o recibo de um retry que falhou sai)
- upgrade and compatibility: C61 (o default de setting que a base aceitava), C63 (a única resposta HTTP que mudou, dita em AD-022 e)

## Out of scope

- Publicar no registro, o escopo `@mordomo` e a tag de release - ação remota do dono (regra 8); pergunta 1 em STATE
- Publicar os adaptadores e abrir um kit de adaptador público - pergunta 3 em STATE
- Skills, rotinas, memória, objetivos, conectores, sentinelas e sync na fachada pública - cada área vira API quando houver quem a consuma
- O texto e o titular do `LICENSE` da raiz, que os pacotes copiam, e a revisão jurídica - feature 15 `licenca-comercial`

## Handoff

Tamanho, com a conta (bytes dos arquivos que cada fatia toca, lidos em parte, mais o que nasce; `wc -c` / 4):

- S1+S2 (a fachada) ≈ engine.ts 27 KB + runManager.ts (trechos) 20 KB + common.ts 14 KB + approvalActions.ts 7 KB + routes/skills.ts 15 KB + runs.ts 21 KB + objectives.ts 8 KB + sessions.ts 3 KB + context.ts 14 KB + cli.ts (trechos) 20 KB + código novo 35 KB + testes novos 45 KB = 229 KB ≈ 57k
- S3 (a API fina) já está dentro de S1+S2 (as mesmas rotas) mais `tests/sdk.api-thin.test.ts` 10 KB ≈ 3k
- S4 (por instância) ≈ events.ts 2 KB + store.ts 15 KB + objectiveStore.ts 18 KB + notifications/store.ts 8 KB + sessionStore.ts 9 KB + indexer.ts (trechos) 10 KB + scheduler.ts (trechos) 12 KB + backup.ts (trechos) 8 KB + runner.ts 7 KB + safeSpawn.ts 10 KB + related.ts 9 KB + ownerLock.ts 7 KB + engine.ts (já contado) + 3 adaptadores (trechos) 20 KB + testes novos 45 KB = 180 KB ≈ 45k
- S5 (pacote) ≈ index.ts 15 KB + os 93 arquivos de importação (script, sem leitura) + package.json x2 + docs/sdk.md 25 KB + README 6 KB + LICENSE x2 8 KB + testes novos 55 KB + typetests 6 KB = 115 KB ≈ 29k
- S6 (a correção da rodada 1) ≈ service.ts 20 KB + ownerLock.ts 7 KB + runManager.ts (trechos) 6 KB + as quatro rotas 40 KB + testes novos e alterados 70 KB + os documentos 35 KB = 178 KB ≈ 28k (ciclo de correção: não entra nos 150k do `budget` da construção)
- total da construção ≈ 134k, abaixo dos 150k do `budget`; a leitura de saídas de teste e de compilação pesa acima disso - one builder

Mechanism: one builder (a estimativa cabe; construção delegada pelo orquestrador, que não tem como abrir o diálogo da mecânica)

- **Boundary:** C1-C51 closed at `75eae19` (build, typecheck, lint e `vitest` inteiro: 99 arquivos, 1126 provas; `npm run dist:quick` e o `status --json` do pacote; e2e: provider-gate, smoke, product-workflows, objective-engine, approval-request-layout e boot-recovery, 37 provas numa configuração temporária não comitada, com a porta 4894 e prazos alongados: 35 passam; `boot-recovery.spec.ts:3` falha igual na base `795306e` (medido numa cópia limpa dela) e `product-workflows.spec.ts:77` estourou o prazo sob carga e passou na repetição)
- **Settled mid-build:** (1) quatro enumerações do plano estavam erradas e foram emendadas no `plan.md` e aqui, antes de qualquer verificação: o estado de módulo que fica é de nove itens, não sete (o memo de `related.ts` chaveado por `Db` e a tabela `PRIVATE` de `pushEndpoint.ts` entram), os valores públicos são onze (`SpawnPolicy` entra, door 2a), os nomes tirados do barril são três (`setProbeEnvDrop` nunca esteve nele) e as rotas e os lugares que iniciam uma execução incluem `engine.ts`; (2) as doors 2a, 8 e 9 foram escritas no `plan.md` depois do código que as fecha, não antes (a regra do build pede antes); (3) o limite de 20 000 caracteres do prompt vale para texto que um chamador digitou: o prompt que o motor monta de registros seus (o pacote de contexto de um objetivo) e o de um `retry` passam por `composed`/pelo registro, que não o aplicam; (4) o recibo de um `retry` de quem é `null` leva o nome `program`; (5) o C48 tem como prova o comando do passo "Packager smoke" do CI, não um teste do `vitest`, porque pede a interface construída; (6) a prova do C29 compara cada suíte com a base sem importações e sem o caminho até o barramento (`ctx.events.` lido como `events.`); (7) `security-git` C39 e `api.v1` C38 falharam na base sob carga (medição da base) e passaram na cabeça nas duas rodadas completas
- **Abandoned:** o barramento global como valor padrão de quem não passa `bus` (o singleton continuaria existindo); `probe` livre em `safeSpawn.ts` (a doctor usa `new SpawnPolicy().probe`); as classes de erro do banco em `db.ts` e as de trava em `ownerLock.ts`/`restoreLock.ts` (os `.d.ts` públicos puxavam os tipos do driver do SQLite: `tsc` do consumidor com `skipLibCheck: false` falhava); `SettingsPatch` como tipo público de `updateSettings`; `slug` de skill com o padrão de id na fachada (o catálogo responde 404 como sempre)
- **Round 1 (11/10/2026):** a verificação deu FAIL (`verification.md`: uma regressão HTTP, 21 mutantes vivos, mudanças de comportamento não ditas, cinco pontos de contrato, menores e deriva da integração); tudo foi corrigido na branch `fix/sdk-core-r1` e C52-C68 fecham os achados. Gate no fim da rodada: `npm run build`, `npm run typecheck` (inclui `typetests`), `npm run lint`, `vitest` inteiro (104 arquivos, 1434 provas, 0 falhas; uma rodada anterior à troca do `peerDependencies` por opcional deu 7 falhas em `tests/legal.*`, porque o lockfile passou a contar `@types/node` e `undici-types` como distribuídos), `npm run dist:quick` e o `status --json` do pacote, e2e (`provider-gate`, `objective-engine`, `approval-request-layout`: 12 provas, porta 4894, configuração temporária não comitada). Os 25 mutantes da rodada (F22, F16, recuperação sem `run.finished`, F05, H14, F04, F06, F44, nomes reservados, F25, F11, H11, erros de aprovação, H08, F33, F35, F18, a regressão do dispatch, replay 202, G04, G12, F41, F42, F43, C68) foram reaplicados e todos morreram pelo check que o nomeia. Ficam como pontos cegos declarados F45 e F46 (`tests/support/moduleState.ts`); o Handoff de `STATE.md` ainda diz "o `LICENSE` MIT da raiz e o `FSL-1.1-ALv2` dos pacotes convivem" e não foi tocado (é do coordenador)
- **Settled in round 1:** (1) o teto de 3 600 000 ms vale para o `timeoutMs` que o chamador pede e a rota do `dispatch` passa só esse (o engine aplica o default do setting, que só tem mínimo), em vez de dar teto ao setting, porque isso invalidaria um `settings.json` que a base aceitava; (2) `startedBy` `"null"` e `"program"` são recusados no esquema em vez de o recibo ganhar um prefixo, porque o prefixo invalidaria os recibos existentes; (3) a recuperação de `start()` usa `settle` (anuncia `run.finished`) em vez de a fachada consultar o banco no `wait`, porque assim também as notificações, o diário e as credenciais de run saem pelo caminho de todo fim de execução; (4) o motor vazado é documentado e a mensagem do `EngineLockedError` diz como sair, sem `Symbol.dispose`, porque o tipo exigiria a lib `esnext.disposable` de quem consome os `.d.ts` e a superfície pública é uma lista fechada; (5) o `@types/node` é peer opcional e o `README` linka o `docs/sdk.md` por URL do repositório (`origin`), porque copiar o documento para o tarball exigiria um teste de igualdade a mais e mudaria `files` (literal da door 6)
