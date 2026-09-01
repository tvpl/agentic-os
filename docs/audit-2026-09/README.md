# MordomoOS: auditoria técnica e de interface

**Data:** 1 de setembro de 2026 · **Alvo:** `tvpl/agentic-os` no commit `7013816` (v0.3.0 do changelog) · **Escopo:** core, adapters, API, CLI, Command Centre, design system, testes, tooling e documentação.

## 0. Sumário executivo

MordomoOS é um projeto pequeno (cerca de 15 mil linhas incluindo o frontend), coerente, bem tipado (TypeScript `strict` + `noUncheckedIndexedAccess`) e com uma postura de segurança acima da média para um projeto local: spawn só com argv, contenção de caminhos com `realpath`, redação de segredos, token local e CSP. O build passa limpo, os 70 testes passam em 3,6 s, e o servidor sobe e executa runs reais contra o Claude Code CLI. A visão de produto (ARMS: Applications, Routines, Memory, Skills) está implementada de ponta a ponta e a interface tem identidade própria.

Dito isso, várias das alegações mais fortes do `README` e do `docs/security.md` não estão implementadas, existem dois bugs com potencial de perda de dados, uma vulnerabilidade autenticada de path traversal com escrita (apagar qualquer `.json` alcançável), e o ciclo de vida de processos (encerramento, cancelamento, scheduler) tem corridas reais. No frontend, um bug de layout esconde os botões primários em cinco das nove telas, o Segundo Cérebro reconstrói o loop inteiro de render a cada movimento do mouse, e o desktop mantém dois canvases a 60 fps sob sete camadas de `backdrop-filter`.

Nada disso exige reescrever o produto. A maior parte dos itens críticos cabe em uma a duas semanas de trabalho focado; o restante é evolução.

### Os dez achados que mais importam

| # | Achado | Área | Gravidade |
|---|---|---|---|
| 1 | `DELETE /api/routines/:id` e `/api/connectors/:id` aceitam `..%2F` e apagam qualquer `.json` fora da pasta. Reproduzido nesta sessão. | Segurança | Crítica |
| 2 | `createBackup` copia o `mordomo.db` com WAL aberto sem checkpoint: o backup pode não ter nenhuma tabela. Verificado pelo agente de auditoria. | Dados | Crítica |
| 3 | `POST /api/backups/:name/restore` sobrescreve o banco aberto e apaga `-wal`/`-shm` com o processo vivo. | Dados | Crítica |
| 4 | `mordomo stop` não cancela runs: os agentes filhos (spawn `detached`) sobrevivem e, ao terminar, escrevem num DB fechado, gerando unhandled rejection que derruba o processo. | Runtime | Alta |
| 5 | Adapters são construídos uma vez no `AppContext` com o `binaryPath` da inicialização; mudar o provider nas configurações não tem efeito até reiniciar. Um `PUT /api/settings` parcial ainda reseta `binaryPath` para `null`. Reproduzido: a run caiu no CLI do PATH em vez do binário pinado. | Runtime | Alta |
| 6 | O chrome fixo "Voltar ao OS / Menu" cobre os botões de ação primários em Skills, detalhe da skill, Rotinas, Conectores e Pixel Studio. | UI | Alta |
| 7 | `useT()` devolve uma closure nova por render e está nas dependências do efeito que monta o loop de canvas do Segundo Cérebro: cada mousemove sobre um nó cancela o rAF, descarta o cache de sprites e reconstrói o fundo. | Frontend | Alta |
| 8 | `Esc` dentro de qualquer modal fecha o modal **e** navega para o desktop, descartando o formulário. | UX | Alta |
| 9 | Perfis de segurança não são consultados em lugar nenhum: `review_before_write`, `controlled_write` e `approved_automation` se comportam igual. Aprovação para "acessar novas pastas" não existe. | Segurança | Alta |
| 10 | Sem CI, sem ESLint, sem Prettier, sem testes de frontend; `npm audit` reporta 1 crítica e 2 altas (uma delas `@fastify/static`, em produção). | Tooling | Média |

### Notas por dimensão

| Dimensão | Nota | Justificativa em uma linha |
|---|---|---|
| Arquitetura | 7/10 | Fronteiras limpas e composição simples; "vendor-neutral" só no nível de pacote, com os três providers hard-coded no core |
| Correção (backend) | 5/10 | Bugs de backup, restore, shutdown, retry e cancelamento; scheduler com `protect` inoperante |
| Segurança | 6/10 | Base sólida, mas traversal em DELETE, preview sem exclusões, Host check quebrado para IPv6, perfis não aplicados |
| Dados e API | 6/10 | SQLite/FTS5 bem usado; validação zod devolve 500; sem retenção; sem paginação real |
| Frontend (código) | 5/10 | Dois componentes-deus de 1.100 e 1.700 linhas, polling triplo, sem cache, sem ErrorBoundary, loop de canvas reconstruído por evento |
| Interface (visual) | 7/10 | Identidade forte e memorável; problemas de colisão, estados vazios, tema claro e densidade de controles |
| UX | 6/10 | Fluxos completos, mas becos sem saída, formulários sem validação e feedback inconsistente |
| Acessibilidade | 4/10 | Contraste do accent reprova AA, sem focus trap, canvas sem alternativa |
| Testes e tooling | 5/10 | 70 testes bons no backend; zero no frontend; nenhum lint, nenhum CI |
| Documentação | 8/10 | Excelente cobertura; o problema é prometer mais do que o código faz |

## 1. Método e evidências

O que foi feito nesta sessão, nesta ordem:

1. Leitura integral do código (core, adapters, API, CLI, frontend, testes, scripts, docs), com dois agentes de auditoria em paralelo (backend e frontend) e revisão cruzada das alegações críticas por mim.
2. `npm install`, `npm run build` (limpo; bundle único de 367 kB), `npm test` (70/70), `npm audit` (6 vulnerabilidades).
3. Servidor real (`mordomo start --foreground`) com quatro pastas do próprio repositório indexadas (94 arquivos), duas runs reais via API e cancelamento de uma delas.
4. Sondas contra a API para confirmar suspeitas: traversal em DELETE (reproduzido), backup com WAL (reproduzido pelo agente), `PUT /api/settings` parcial (reproduzido), erro 500 em validação zod (reproduzido), `Host: [::1]:4777` recusado (reproduzido).
5. 40 capturas de tela com Playwright em cinco viewports, dois temas, dois idiomas, incluindo launcher, modo de edição, modais, preview do Segundo Cérebro, wizard de setup e detalhe de run.
6. Análise estática do `theme.css` (tamanhos de fonte, transições, keyframes, easings, breakpoints) e do dicionário i18n (paridade de chaves e valores não traduzidos).

Todas as referências `arquivo:linha` abaixo apontam para o commit auditado.

## 2. Arquitetura e backend

### 2.1 O que está bem

- **Grafo de workspaces correto.** `core` ← `adapters/*` ← `apps/api`; o frontend só fala HTTP. `tsc -b` com project references funciona, e o `vitest.config.ts` faz alias de `@mordomo/*` para `src`, então os testes rodam sem build.
- **Camada de spawn.** `safeSpawn` + `executeInvocation` é uma boa separação: cada adapter só constrói um argv e um parser de linhas. `shell: false`, `detached` para matar o grupo, timeout com SIGTERM e SIGKILL.
- **Compilador de sync.** O modelo de manifesto com hashes de conteúdo (`core/src/sync/compiler.ts:151-229`) é a abordagem certa para "vistas compiladas, não cópias divergentes": detecta arquivo existente, faz backup, mostra diff e exige aprovação em conflito. Está testado.
- **Zod como fonte única** da forma de settings, rotinas e skills. `AppContext` como composition root é adequado para o tamanho atual.
- **Migrações** com `user_version`, DDL em transação e cópia do banco após `wal_checkpoint(TRUNCATE)` antes de migrar.

### 2.2 "Vendor-neutral" é verdadeiro no pacote e falso na semântica

Os três providers estão hard-coded no core em quatro lugares:

- `core/src/config/schema.ts:3` define `ProviderId = z.enum(["claude","cursor","codex"])` e `providers` é um objeto fixo de três chaves.
- `core/src/sync/compiler.ts:82-146` tem o layout nativo de cada provider (`CLAUDE.md`, `.claude/skills`, `.cursor/rules`, `.agents/skills`).
- `core/src/runs/runManager.ts:61` tem `WRITE_TOOLS`, uma lista de nomes de ferramentas do Claude e do Codex vivendo no gerenciador "agnóstico".
- `core/src/connectors/auditor.ts:39-44` conhece `~/.claude.json`, `~/.cursor/mcp.json` e `~/.codex/config.toml`.

`apps/api/src/context.ts:57-61` constrói os três adapters num literal. O próprio `docs/adapters-guide.md` admite que adicionar um provider exige editar o enum, o schema, o compilador e o `context.ts`. Não há registro, nem declaração de capacidades ("consegue impor read-only", "suporta effort", "prompt via stdin ou argv"). O método `cancel()` da interface é redundante: os três adapters chamam o mesmo `cancelRunProcess` global de `baseExec.ts`, então o registro de cancelamento é estado global de módulo em vez de pertencer ao `RunManager`.

### 2.3 Fragilidades estruturais

- **`AppContext.settings()` relê e reparseia `settings.json` do disco a cada chamada** (`context.ts:72-74`), e é chamado dentro de `acquireSlot` por run, em toda rota e em todo disparo do scheduler. Toda mutação é read-modify-write sem lock: dois `PUT` concorrentes, ou CLI e servidor ao mesmo tempo (compartilham arquivos e DB), perdem escrita.
- **Adapters congelados na inicialização.** O `binaryPath` e as opções são lidos uma vez no construtor. Trocar o provider padrão, o binário ou habilitar um provider na UI não tem efeito no processo vivo. Reproduzido: com `binaryPath` apontando para um binário de teste, a run usou `/opt/node22/bin/claude` do PATH.
- **Um arquivo de rotina inválido derruba tudo.** `RoutineStore.list()` lança no primeiro JSON inválido (`core/src/routines/store.ts:20-21`), o que faz `scheduler.reload()`, `GET /api/routines` e até o start do servidor falharem para todas as rotinas.
- **`PROFILES` é exportado e nunca lido** (`core/src/security/profiles.ts:13-38`). Os quatro perfis colapsam em dois comportamentos.

### 2.4 Bugs de correção (H = perda de dados ou crash; M = errado em condições realistas)

| ID | Gravidade | Descrição | Onde |
|---|---|---|---|
| B1 | H | Backup copia o DB em WAL sem checkpoint; a cópia pode não ter tabelas. Após 50 inserts o backup tinha `no such table: meta` com WAL de 527 kB. | `core/src/backup.ts:38-41` |
| B2 | H | Restore via API sobrescreve o DB aberto e apaga `-wal`/`-shm`. O CLI recusa com serviço rodando; a API não. | `routes/system.ts:150-156`, `backup.ts:81-88` |
| B3 | H | Shutdown não cancela runs; filhos `detached` sobrevivem; ao terminar, `finish()` chama `db.prepare` num DB fechado e a rejeição não tratada mata o processo. `recoverInterrupted` só atualiza linhas; a coluna `pid` nunca é escrita. | `server.ts:126-133`, `runManager.ts:88-95` |
| B4 | M | `protect: true` do croner nunca engaja porque o callback devolve `undefined` em vez da promise; disparos sobrepostos de uma rotina longa não são impedidos. | `scheduler.ts:52-56` |
| B5 | M | `void this.fire()` em dois pontos e `Promise.race` na rota descartam rejeições; qualquer erro em `store.get`, `runs.create` ou `skills.load` vira unhandled rejection. | `scheduler.ts:55,70`, `routes/routines.ts:64-67` |
| B6 | M | Retry reexecuta o **mesmo** run id: eventos, `started_at` e artefatos da tentativa anterior são misturados; retenta em timeout; o `sleep` do backoff não é cancelável após `stop()`. | `scheduler.ts:130-138` |
| B7 | M | `cancel()` devolve `true` mesmo sem handle (janela de `buildInvocation`); o processo roda até o fim e a run é marcada `cancelled` por causa de `cancelRequested`. | `runManager.ts:267-272`, `baseExec.ts:12-17` |
| B8 | M | `catchUpMissed` anda até 4.000 passos a partir de `now − 7d`; para `* * * * *` (10.080 slots) para cerca de 2,8 dias após o início da janela em vez do slot anterior real. | `scheduler.ts:198-216` |
| B9 | M | Se o corpo do consumidor do generator lança (erro em `persistEvent`), o `finally` aguarda a vida inteira do processo (até 15 min) antes de propagar, sem cancelar o filho. | `baseExec.ts:101-103` |
| B10 | M | Run manual de rotina devolve um id "adivinhado" (`runs.list({limit:1, origin:"routine"})`) após 1,5 s, que pode ser de outra rotina. | `routes/routines.ts:64-70` |
| B11 | L | `run_events` nunca é podado; replay capado em 2.000 linhas; `safeSpawn` acumula stdout inteiro em memória; sem limite de fila em `POST /api/runs`. | `runManager.ts:324`, `safeSpawn.ts:67-68` |

**Indexador** (`core/src/memory/indexer.ts`): não usa transação (dois a três autocommits por arquivo; crash no meio deixa `files` e `files_fts` divergentes); é totalmente síncrono, então uma indexação grande bloqueia o event loop da API inteira, inclusive SSE e scheduler; `rebuildMarkdownLinks` relê todos os markdowns do disco a cada indexação; detecção de binário só por extensão; raízes aninhadas produzem `area`/`root` do último a escrever.

**Settings**: `PUT /api/settings` com `providers` parcial reseta os campos irmãos para o default (`SettingsSchema.partial()` com `.default()` aninhados). Reproduzido: `{providers:{claude:{enabled:true}}}` devolveu `binaryPath: null`.

## 3. Segurança: alegações versus código

| Alegação (README / `docs/security.md`) | Realidade no código |
|---|---|
| Bind em 127.0.0.1, validação de Host, token como guarda CSRF | Bind ✓. Token de 32 bytes aleatórios, arquivo 0600 ✓. Host check faz `host.split(":")[0]` (`server.ts:31-32`): quebra IPv6 (`Host: [::1]:4777` → 403, reproduzido) e um Host **ausente** passa (`if (host && …)`). Comparação do token com `!==` (não constant-time). "CORS estrito" não existe no código (o same-origin do navegador é o que protege). Se o usuário aprovar `bindAddress: 0.0.0.0`, o Host check rejeita todo cliente não-local: a exposição é inoperante por construção. Token vai na query string para SSE. |
| Spawn só com argv + allowlist de executáveis com caminho absoluto pinado | argv-only ✓, `shell:false` ✓. Mas a allowlist é **só por basename** (`safeSpawn.ts:12,48-53`): qualquer executável chamado `claude`, `cursor-agent`, `codex` ou `node` em qualquer lugar passa. O `binaryPath` é editável via `PUT /api/settings` sem validação. Mesmo nível de confiança do usuário local, então não é escalada, mas o "pin" é decorativo. `node` na allowlist é desnecessário em produção. |
| Todo caminho do usuário passa por contenção com `realpath` | `resolveInsideRoots` é correto e seguro contra symlinks; usado em preview, cwd, artefatos e open. **Não** é usado em `DELETE /api/routines/:id` e `DELETE /api/connectors/:id`: `store.remove(id)` faz `path.join(dir, id + ".json")`. **Reproduzido nesta sessão:** `DELETE /api/routines/..%2Ftests%2F.tmp%2Fvictim` → 200 e o arquivo foi apagado. `config/settings.json`, `config/sync-manifest.json` e `package.json` são alcançáveis. O regex de id existe no `RoutineSchema`, mas a rota valida com `z.string()`. Também sem contenção: `POST /api/skills/import { sourceDir }` (cpSync recursivo), `sync target` e `indexedFolders` (qualquer diretório existente). |
| Acesso a novas pastas exige aprovação | Não implementado. A rota só checa se a pasta existe. Dos nove `ApprovalKind`, só `expose_port` e `connector_write` são pedidos. O status `waiting_approval` nunca é atribuído. |
| Blocklist de segredos e redação em logs | Indexação honra exclusões e padrões de segredo ✓. **Preview não aplica a lista de exclusões**, só o blocklist de basename (`preview.ts:34`): `<root>/.git/config`, `<root>/.aws/credentials` e `<root>/.ssh/config` são pré-visualizáveis se o diretório estiver dentro de uma raiz indexada. |
| Perfis de segurança; `review_before_write` implica revisão humana do diff | `PROFILES` nunca é consultado. Para Claude, qualquer run `write` usa `--permission-mode acceptEdits` independentemente do perfil; Cursor `write` = `--force`. Read-only: Claude por regras de permissão ✓; Codex por `--sandbox read-only` e recusa sem ele ✓; **Cursor só por texto no prompt**. |
| `npm audit` no doctor | Não existe em `doctor.ts`. |
| Processos órfãos são reaped | Falso; ver B3. |

Outros pontos: o error handler devolve `err.message` verbatim (vaza caminhos absolutos e arrays de issues zod com 500); sem rate limiting (baixa prioridade, local); prompts para Cursor e Codex vão como **elemento de argv** (visíveis em `ps` para outros usuários locais, sujeitos a `ARG_MAX`, e um prompt começando com `-` pode virar flag); Claude usa stdin ✓. DB, logs JSONL e artefatos herdam a umask (normalmente 0644) e os logs contêm prompts e eventos redigidos.

Sobre a execução real observada: com `--permission-mode default` em modo headless, o Claude Code negou todo comando `Bash` com múltiplas operações ("This Bash command contains multiple operations… require approval"), e a run terminou com sucesso (exit 0) sem ter conseguido listar arquivos. Um run "read-only" que impede `ls` e `git status` não é útil; as regras de permissão do modo read-only precisam liberar explicitamente os comandos de leitura mais comuns.

## 4. Dados, API e CLI

**Dados.** `better-sqlite3` 12.11 (addon nativo, API síncrona): cada query bloqueia o event loop, precisa de binário pré-compilado por ABI do Node, e tem `db.backup()` disponível e não usado. WAL ✓, `foreign_keys = ON` sem nenhuma FK declarada, sem `busy_timeout` explícito (o default de 5 s cobre o caso CLI + servidor). FTS5 com `porter unicode61`, `bm25` e `snippet()` ✓; `toFtsQuery` é seguro contra injeção (testado). A tabela FTS armazena conteúdo completo até 200 mil caracteres por arquivo, então o DB dobra o texto indexado; uma tabela `content=''` com rebuild reduziria pela metade. Sem triggers de sincronização entre `files` e `files_fts`. Sem retenção para `runs`, `run_events` e `routine_history`.

**API.** Todas as rotas validam com zod (bom), mas **falha de validação devolve 500** com o dump bruto de issues (`server.ts:57-60`); `tests/api.test.ts:78` chega a afirmar o 500. Envelope de erro é só `{error: string}`, sem código nem request id. Sem prefixo de versão, sem OpenAPI, sem paginação além de `limit` (máx. 200; `/api/artifacts/recent` varre 200 runs por chamada). Formas inconsistentes: `PUT /api/settings` → `{settings, pendingApproval}`; `PUT /api/providers/default` → settings puro. Toggles são `POST /toggle` não idempotentes. O SSE funciona (replay + evento terminal `run_state`), mas sem `reply.hijack()` e sem `Last-Event-ID`: reconectar replaya do zero ou trunca em 2.000.

**CLI** (`apps/api/src/cli.ts`, 657 linhas). Parser artesanal: todo `--x` é booleano e todo token sem `--` é posicional, então `mordomo sync --approve /path/CLAUDE.md dir` trata o caminho como alvo. `--provider foo` quebra com TypeError; `--effort` não é validado. O serviço de startup divide comandos por espaço e a unit systemd gerada tem `ExecStart` sem aspas: ambos quebram com caminhos contendo espaços (comum no macOS). `readPidInfo` usa `kill(pid, 0)` sem checar identidade (reuso de PID = falso "já rodando"). `uninstall --purge` pula confirmação fora de TTY. Pontos bons: `restore` recusa com serviço rodando; `setup` é idempotente e faz merge; `doctor` tem exit codes.

**Observabilidade.** Fastify com `logger: false`: zero log de requisição e de erro além da resposta JSON. O único log estruturado é `logs/runs.jsonl` com dois registros por run, rotacionado por tamanho e podado só na rotação. `service.out.log` nunca é rotacionado. `settings.timezone` é coletado no setup e nunca lido pelo scheduler. `/api/health` é uma constante. `PKG_VERSION = "0.1.0"` é fixo em `routes/system.ts:17` enquanto o changelog está em 0.3.0.
## 5. Frontend: arquitetura, estado e performance

### 5.1 Estrutura

| Arquivo | Linhas | Papel |
|---|---|---|
| `views/SecondBrain.tsx` | 1.688 | Um componente com 25 `useState`, um ref mutável de 24 campos, dez efeitos e um loop de render de 450 linhas |
| `views/Desktop.tsx` | 1.126 | Shell, motor de grade, wallpaper de partículas, sete widgets e um modal no mesmo arquivo |
| `views/PixelStudio.tsx` | 737 | Micro-app com CSS embutido como string injetada em `<style>` a cada render |
| `theme.css` | 844 | Design system (só cor); ~120 linhas mortas de layouts anteriores |
| `components/ui.tsx` | 172 | `useApi`, `Loading`, `ErrorBox`, `Empty`, `Modal`, `StatusBadge`, toasts |

Roteamento com `react-router-dom` v7 em `HashRouter`, sem rotas aninhadas, sem `errorElement` e **sem nenhum `ErrorBoundary`**: uma exceção de render em qualquer view apaga o app inteiro. Estado global reduzido a `meta`, idioma e toasts; todo o resto é local por view, sem cache: voltar ao desktop refaz oito requisições e mostra o spinner de novo. Comunicação entre componentes por evento global no `window` (`mordomo:launcher`). Preferências do Segundo Cérebro persistem em `localStorage`; layout do desktop persiste no servidor: duas estratégias para a mesma classe de dado.

Busca de dados por polling em três intervalos desencontrados: desktop a cada 10 s (oito endpoints, incluindo `/api/runs?limit=200`), lista de runs a cada 5 s, Segundo Cérebro a cada 4 s. SSE só para o log de uma run. Nada pausa quando a aba está oculta. O `request()` não tem `AbortController`, timeout nem retry.

Bundle único de 367 kB (114 kB gzip), sem `React.lazy`: PixelStudio, d3-force e o Segundo Cérebro são baixados e parseados antes do desktop pintar. O limite de aviso do Vite foi elevado para 900 kB para silenciar o alerta.

### 5.2 Performance: o achado mais importante

`useT()` devolve uma closure nova a cada render (`i18n.ts:556-559`). O efeito que monta o loop de render do Segundo Cérebro depende de `[t]` (`SecondBrain.tsx:998`) e o efeito de interação de ponteiro depende de `[select, navigate, t, toggleHub]` (`:1175`). Consequência verificada no código: **cada `setHover` em `onMove` (mover o mouse sobre qualquer nó) re-renderiza o componente, gera um novo `t`, cancela o `requestAnimationFrame`, descarta o cache de sprites, reconstrói o fundo (220 estrelas + centenas de hexágonos + gradiente), recria o `ResizeObserver` e reanexa cinco listeners.** Isso acontece na taxa de eventos de ponteiro. O mesmo vale para digitar na busca e para o `setLiveCount` a cada 4 s. A correção é pequena: memoizar `useT` por idioma e ler rótulos de um ref dentro do loop.

Custos por frame no loop do cérebro: `getBoundingClientRect` + `getComputedStyle` com três `getPropertyValue`; `w.hubs.find` dentro do loop de arquivos (O(arquivos × hubs)); até 3.000 `drawImage`; até 1.500 arestas traçadas duas vezes; mais de 70 desenhos com `shadowBlur` (a operação mais cara do canvas 2D); minimapa inteiro redesenhado. Não há dirty flag: roda a 60 fps mesmo com tudo parado, e `reduceMotion` congela o twinkle mas mantém o loop.

Desktop: 620 partículas e 140 estrelas a 60 fps sob sete widgets com `backdrop-filter: blur(7px)`. Desfocar um canvas que muda a cada frame obriga o compositor a refiltrar continuamente. O slider de "molas" está nas dependências do efeito da simulação, então arrastar o slider reconstrói o `forceSimulation` a cada evento.

### 5.3 Bugs de correção confirmados

1. **Vazamento do SSE em `RunDetail`** (`Runs.tsx:128-145`): a função `stop` é retornada de dentro do `.then()`, não do efeito, então o React nunca recebe cleanup. Trocar de run mantém o `EventSource` anterior aberto e os eventos da run antiga são anexados ao log da nova.
2. **`Esc` em um modal navega para o desktop.** `Modal` foca o primeiro `input, select, textarea, button` na ordem do DOM, que é sempre o botão ✕ do cabeçalho. O `OsShell` escuta `Esc` no `window` e navega para `/` se o foco não estiver em um campo. Resultado: `Esc` fecha o modal **e** joga o usuário para o desktop, descartando o formulário.
3. **Foco roubado a cada 10 s** no modal de modelo × esforço: o efeito do `Modal` depende de `[onClose]`, e o desktop passa uma arrow inline que muda a cada poll.
4. **Desktop sem estado de erro.** Se qualquer das oito chamadas do `Promise.all` falha, `data` fica nulo e o componente retorna `null`: tela em branco sem retry.
5. **Layout do desktop reverte silenciosamente.** `persistLayout` engole falhas do PUT e o próximo poll sobrescreve o estado local com o do servidor.
6. **`SkillDetail` sem `key`:** navegar de `/skills/a` para `/skills/b` mantém provider/modelo/esforço da skill anterior.
7. **Atalhos de zoom sem modificador** (`+`, `-`, `0`) capturam `Ctrl +`/`Ctrl -` do navegador; `/` com `preventDefault` global.
8. **Race no preview** do Segundo Cérebro: dois cliques rápidos podem mostrar o conteúdo do arquivo A sob o cabeçalho do B.
9. **Promessas sem tratamento** (sem toast nem feedback) em Skills, Settings (5 pontos), Connectors e Setup (falha ao carregar providers deixa "Carregando…" para sempre).
10. **`useApi` rotula bugs como offline:** qualquer erro que não seja `ApiError` (um `TypeError` por formato inesperado) mostra "Não foi possível alcançar o serviço local".
11. Tema "system" avaliado uma vez, sem ouvir `matchMedia('change')`. `document.documentElement.lang` nunca é atualizado.
12. Em 1024×768 o grid tem 14 linhas, mas o layout padrão coloca widgets em `y=13/14` com `h=3-4`: Workspace, Pulso e Atenção são cortados pelo `overflow: hidden`.
13. Controles de zoom do cérebro (`right: 284px; z-index: 10`) ficam sob a gaveta de preview (`right: 16px; width: 340px; z-index: 11`).

### 5.4 i18n

O dicionário tem 267 chaves em EN e 267 em pt-BR, sem faltas em nenhum sentido (verificado por script). Os problemas são **strings fixas fora do dicionário**: cabeçalhos da tabela de runs, rótulos dos modais de skill/rotina (`DESCRIPTION`, `MODE`, `ATTEMPTS`, `TIMEOUT (MIN)`), dicas em Settings, textos em Connectors, "Agentic OS", "Wk", e datas formatadas com locale fixo `"en-GB"` independentemente do idioma. A chave `settings.name` ("Nome do sistema") é reutilizada como rótulo do nome de skill e de rotina.

## 6. Interface: análise visual tela a tela

Todas as capturas abaixo foram feitas contra o servidor real (`mordomo start`), com 94 arquivos indexados e duas execuções reais no histórico. Viewports: 1440×900, 1280×800, 1024×768, 768×1000 e 390×844. Tema escuro e claro.

### 6.1 Desktop (tela inicial)

![Desktop](img/01-desktop.jpg)

**O que funciona.** A composição de três colunas com widgets em painéis "bracketed" tem identidade. O relógio grande, os pontos de quarter-week e o deck de skills com matriz modelo × esforço são detalhes que só este produto tem. A topbar com o seletor de provider é clara.

**O que não funciona.**

- **O centro da tela não informa nada.** O núcleo de partículas com o cubo em wireframe ocupa cerca de 50% da área útil e não responde a nenhuma pergunta do usuário. Numa tela chamada "Command Centre", o espaço mais nobre deveria mostrar o que está acontecendo agora: execuções em andamento com progresso, próxima rotina, últimos artefatos. Hoje isso está espremido em widgets laterais.
- **Chips orbitais crípticos.** Os oito círculos com ícone de arquivo e o rótulo "1D" só revelam o nome do arquivo no hover. Sem hover, são ruído decorativo.
- **Widgets vazios em estado normal.** "Rotinas" mostra uma linha riscada e 60% de área vazia. "Pulso" mostra "—" em dois de três indicadores até existir uma run. Estados vazios precisam de uma mensagem e uma ação ("Habilitar rotina", "Executar uma skill").
- **Deck de skills corta os cards.** Só quatro cards cabem; o quinto aparece cortado ao meio sem indicação de rolagem. Nomes longos quebram em três linhas (`/agent-usage-report`).
- **Ruído de fundo custa CPU.** O wallpaper redesenha 620 partículas e 140 estrelas a 60 fps por baixo de sete widgets com `backdrop-filter: blur`. É a causa mais provável de ventoinha ligada só de deixar a tela inicial aberta.

### 6.2 Launcher e modo de edição

![Launcher](img/02-launcher.jpg)

O launcher é limpo e legível, mas aparece e some sem transição, não tem busca por teclado (o padrão que qualquer usuário de Spotlight/Raycast espera) e não move o foco para dentro do diálogo. A tela "Painel" no grid é redundante quando o launcher já é acionado do desktop.

![Modo de edição](img/03-edit-mode.jpg)

O modo de edição é a parte mais bem resolvida do desktop: bordas tracejadas, alça de arrastar, botão de ocultar e barra inferior com "Resetar layout" e "Concluir". Faltam: confirmação antes de resetar, uma alternativa por teclado e um snap visual (a grade de 24 colunas não aparece durante o arraste).

### 6.3 Segundo Cérebro

![Segundo Cérebro](img/04-brain-rings.jpg)

É a peça de identidade do produto e a mais ambiciosa. O layout em anéis com o `ROUTER.MD` pixelado no centro é memorável.

Problemas visíveis na captura:

- O rótulo **"APLICAÇÕES" é cortado pelo badge hexagonal** do conector Playwright (aparece "APLICAÇÕE"). Os rótulos dos anéis são desenhados sob os nós, então "ROTINAS" e "MEMÓRIA" ficam sobrepostos por partículas.
- **Painel de controle expõe parâmetros de debug.** "Giro dos anéis 0.16", "Molas dos links 0.05", "Tamanho dos clusters 1.00" são constantes de física, não decisões do usuário. Um usuário final precisa de três controles: layout, visão (áreas/pastas) e busca. O resto pertence a um menu "Ajustes avançados" recolhido.
- **Placeholder da busca truncado** ("Busque arquivos enquanto di…").
- **A gaveta de preview cobre os controles.** Ao selecionar um arquivo, a gaveta de 340 px cobre o painel de layout e os botões de zoom (ambos ancorados à direita).

![Preview](img/05-brain-preview.jpg)

- **Tema claro quebra a metáfora.** O brilho aditivo (`globalCompositeOperation: "lighter"`) que dá vida ao mapa no escuro vira uma mancha lavada no claro; os badges hexagonais ficam pretos e pesados; o minimapa vira um bloco cinza.

![Tema claro](img/12-light-brain.jpg)

- **Sem alternativa acessível.** Todo o conteúdo é um único `<canvas>`. Não há lista de arquivos navegável por teclado, e o tooltip é apenas por mouse.

### 6.4 Skills e detalhe da skill

![Colisão do chrome](img/06-skills-overlap.jpg)

**Bug de layout reproduzido em cinco das nove telas:** o chrome fixo "Voltar ao OS / Menu" (position: fixed, canto superior direito) fica na mesma faixa vertical dos botões de ação de cada página e os cobre. Na lista de Skills o botão "Nova skill" fica escondido; no detalhe da skill, "Pausar"; em Rotinas, "Nova rotina"; em Conectores, "Auditar"; no Pixel Studio, "Criar skill". É o primeiro item a corrigir na UI porque bloqueia ações primárias.

![Detalhe da skill](img/07-skill-detail.jpg)

No detalhe da skill, "Executar com: Desabilitada" é um beco sem saída: não diz o quê está desabilitado (a skill? o provider?) nem oferece o caminho para habilitar. A coluna esquerda termina na metade da tela; o SKILL.md à direita quebra linhas de forma irregular por causa do `white-space: pre-wrap` sem largura mínima.

A lista de skills não tem busca nem filtro por provider/modo, e cada card carrega seis badges com o mesmo peso visual (slug, modo, linhas, três providers). Badges deveriam diferenciar o que é estado (modo) do que é metadado (linhas).

### 6.5 Execuções

![Detalhe da run](img/08-run-detail.jpg)

- O título da página diz "Execuções" em vez do nome/prompt da run.
- O log de eventos é um bloco monoespaçado sem estrutura. Uma run agentic tem uma narrativa natural (início → chamadas de ferramenta → resultado), e a UI deveria mostrar essa linha do tempo com eventos agrupados, colapsáveis e com ícone por tipo (texto, tool_use, permissão, erro). Hoje é preciso ler tudo para achar onde a ferramenta foi negada.
- A rolagem automática força o fim do log a cada evento, impedindo a leitura enquanto a run está viva.
- A tabela usa cabeçalhos em inglês ("PROVIDER", "ORIGIN", "STATUS", "DURATION", "WHEN") com a UI em pt-BR.

### 6.6 Rotinas, Conectores e modais

![Modal de rotina](img/09-routine-modal.jpg)

- O rótulo do campo nome usa a chave `settings.name` ("Nome do sistema") nos modais de skill e de rotina. É um erro de reuso de chave que confunde o usuário.
- "DESCRIPTION", "MODE", "ATTEMPTS", "TIMEOUT (MIN)" aparecem em inglês no tema pt-BR: são strings fixas fora do dicionário.
- O campo cron não valida nem pré-visualiza ("próximas 3 execuções: …"), e o fuso horário é um texto livre.
- O modal abre e fecha sem transição, e o `Esc` fecha o modal **e** navega para o desktop, descartando o formulário.

### 6.7 Configurações

![Configurações](img/10-settings.jpg)

Funciona, mas é uma parede de campos com o mesmo peso. Cinco grupos (Identidade, Provedores, Memória, Backups, Diagnóstico) cabem em abas ou em uma navegação lateral. A dica "127.0.0.1 only — restart to apply" está em inglês. O bloco "Diretório de dados" é um parágrafo explicando uma variável de ambiente, o que denuncia uma funcionalidade que a UI não consegue executar.

### 6.8 Pixel Studio

![Pixel Studio](img/11-pixel-studio.jpg)

Bem resolvido para um micro-app: ferramentas com atalhos numerados, paleta, frames, preview com fps, exportação. Melhorias: a área de desenho não usa o espaço vertical disponível (a tela 16×16 ocupa menos de 60% da altura), não há zoom, e "Conta-gotas" é cortado no botão. Um `Esc` acidental destrói todos os frames sem confirmação, porque o estado é só memória.

### 6.9 Responsividade

![Tablet](img/14-tablet-desktop.jpg) ![Mobile](img/15-mobile-desktop.jpg)

Em 768 px os cards do deck quebram nome de skill letra por letra; em 390 px o desktop é inutilizável (a grade de 24 colunas vira células de 14 px). O desktop não tem nenhum breakpoint. Como o produto é local e de desktop, isso é aceitável como prioridade, mas precisa de um fallback mínimo: abaixo de ~900 px, empilhar os widgets em uma coluna rolável.

## 7. Design system: identidade, tipografia, cor e movimento

### 7.1 Diagnóstico

O `theme.css` tem uma boa base de cores (fundo quente, três níveis de superfície, quatro pares semânticos, tema claro completo), mas para em cor. Não existem tokens de espaçamento, tipografia, z-index ou movimento:

| Dimensão | Estado atual |
|---|---|
| Tamanhos de fonte | 14 valores distintos no CSS (9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 14, 15, 21, 22, 26, 34) mais 8 inline |
| Espaçamento | 24 valores de px diferentes em padding/margin/gap |
| z-index | 2, 3, 4, 5, 6, 9, 10, 11, 12, 30, 40, 50, 60, 80 ad hoc |
| Transições | 8 declarações, todas `ease`, 120–150 ms |
| Keyframes | 3 (`spin`, `pulse-glow`, `blink`) |
| Fontes | `system-ui` e `ui-monospace` |
| Estilos inline | ~190 objetos `style={{}}` nas views |

A identidade "HUD futurista" está sendo carregada por rótulos em caixa alta com tracking a 9–11 px, que é justamente o texto menos legível da página. A fonte do sistema não sustenta a proposta: um HUD pede uma face de display e uma mono com personalidade.

### 7.2 Proposta de tokens

**Tipografia.** Uma escala de 8 passos e dois pares de fontes carregadas localmente (sem CDN, o servidor é offline-first):

- Display/rótulos: uma grotesca condensada com caráter técnico (ex.: `Chakra Petch`, `Rajdhani` ou `Orbitron` só para o relógio e os números grandes).
- Corpo: uma sans humanista neutra e legível (ex.: `IBM Plex Sans` ou `Inter Tight`).
- Mono: `JetBrains Mono` ou `IBM Plex Mono` para caminhos, cron, logs e slugs.
- Escala: 11 / 12 / 13 / 14 / 16 / 20 / 28 / 40 px, com line-height 1.25 para display e 1.5 para corpo. Rótulos em caixa alta nunca abaixo de 11 px, com `letter-spacing: 0.08em`.

**Espaçamento.** Base 4 px: `--s-1: 4px` … `--s-8: 48px`. Padding de painel `--s-5` (20 px), gap de grid `--s-4` (16 px).

**Elevação e camadas.** `--z-base 0`, `--z-widget 10`, `--z-chrome 20`, `--z-drawer 30`, `--z-modal 40`, `--z-toast 50`. Apenas o modal e a gaveta ganham sombra; widgets usam só borda.

**Cor.** Manter a paleta quente. Corrigir o contraste: `--accent-contrast` derivado da luminância do accent em runtime (branco sobre `#f97316` tem 2.8:1 e reprova AA). Texto `--text-faint` sobe para ≥ 4.5:1. Nunca usar o accent como cor de texto corrido no tema claro. Canvas do desktop e do cérebro passam a ler cores dos tokens (hoje têm hexes fixos escuros).

**Movimento.** Tokens de duração e easing, usados por todas as transições:

```
--dur-fast: 120ms;  --dur-base: 200ms;  --dur-slow: 320ms;  --dur-enter: 480ms;
--ease-standard: cubic-bezier(.2,.8,.2,1);
--ease-emphasized: cubic-bezier(.3,0,0,1);
--ease-out: cubic-bezier(0,0,.2,1);
```

### 7.3 Animação e microinterações

Onde o movimento deve entrar, por ordem de impacto:

1. **Entrada do desktop.** Ao carregar, widgets aparecem em cascata (opacity 0→1 + translateY 8→0, 320 ms, stagger 40 ms) e o núcleo faz um fade-in de 480 ms. Hoje o desktop simplesmente "aparece" depois de um `return null`.
2. **Launcher.** Backdrop com fade (200 ms) e grade com scale 0.96→1 (240 ms, `--ease-emphasized`); tiles com stagger de 20 ms. Fechamento em 160 ms.
3. **Transição entre desktop e apps.** Usar a View Transitions API (`document.startViewTransition`) com crossfade de 200 ms; o chip "Voltar ao OS" ganha uma transição compartilhada com o botão de origem.
4. **Modais e gaveta de preview.** Modal: scale 0.98→1 + fade. Gaveta: translateX 24→0. Ambos com saída animada (hoje desmontam abruptamente).
5. **Toasts.** Entrada por translateY + fade, saída por fade, com botão de fechar e barra de tempo.
6. **Estados de execução.** Linha de run "em andamento" com um indicador pulsante e sparkline ao vivo; ao terminar, a linha muda de cor com transição de 320 ms e emite um toast.
7. **Hover e foco.** Cards e tiles: translateY(-1px) + borda mais forte em 120 ms. Botões primários: sem `filter: brightness` (custo de paint); usar mudança de cor via token.
8. **Skeletons.** Substituir o spinner "Carregando…" por skeletons com o formato do conteúdo (cards, linhas de tabela).
9. **Respeito a `prefers-reduced-motion`.** Já existe o kill-switch global; os loops de canvas devem pausar (não só congelar o twinkle) e os staggers viram zero.

### 7.4 Refino visual por componente

- **Painéis.** Manter os cantos "bracket", mas reduzir para 1 px e usar só nos widgets do desktop; nas páginas internas usar borda simples, para que a marca não vire papel de parede.
- **Badges.** Dois estilos: *estado* (preenchido, cor semântica) e *metadado* (contorno, texto dim). Máximo três badges por card; o resto vai para o detalhe.
- **Tabelas.** Cabeçalhos em 12 px com tracking, zebra sutil, célula de status com pill, alinhamento de números à direita com `tabular-nums`.
- **Formulários.** Rótulo acima, ajuda abaixo em 12 px, erro inline em vermelho semântico, grupos com título. Selects e inputs com a mesma altura (36 px) e mesmo raio.
- **Ícones.** Lucide já está no projeto; padronizar 16 px em botões e 20 px em títulos.
- **Empty states.** Ícone de linha + título + uma frase + ação primária. Nunca "Nada por aqui ainda" sem ação.

## 8. Acessibilidade

Auditoria por código e por inspeção:

- **Contraste.** Branco sobre o accent laranja: 2.8:1 (reprova AA em todos os botões primários e no seletor ativo). Texto `--text-faint`: 4.3:1 no escuro e 3.4:1 no claro, usado em 9–11 px.
- **Foco.** Launcher e Modal têm `role="dialog"` mas não capturam foco, não restauram o foco ao fechar e não marcam o fundo como `inert`. Tab escapa para a página por trás.
- **Canvas sem alternativa.** O Segundo Cérebro é um `<canvas role="img">` sem lista equivalente. Um usuário de teclado ou leitor de tela não acessa nenhum arquivo por ali.
- **ARIA inválida.** A alça de redimensionar é um `<span role="slider">` sem `tabIndex`, `aria-valuenow` ou teclado. Botão de ocultar com `aria-label="✕ Título"`.
- **Atalhos de tecla única** (`/`, `+`, `-`, `0`, `1`–`4`, `p`) sem checar modificadores: `Ctrl +` e `Ctrl -` dão zoom no grafo e no navegador ao mesmo tempo; `/` mata o quick-find do Firefox.
- **Idioma do documento.** `<html lang="en">` nunca muda para `pt-BR`.
- **Live regions.** O log inteiro de uma run é `aria-live="polite"`, anunciando cada linha.

O que está bem: `:focus-visible` definido globalmente, `aria-hidden` nos ícones, `aria-pressed` nos toggles, `<details>` nos riscos dos conectores, o núcleo orbital é um `<button>` real.
## 9. Testes, tooling e CI

**O que existe.** 70 testes Vitest (7 arquivos), todos passando em 3,6 s. Cobrem fundação do core, seeds, adapters (com CLIs falsos fiéis em `tests/fixtures/fake-bin`), API (20 casos), memória, segurança e run manager (cancelamento, timeout). Um script `tests/e2e/visual-check.mjs` que tira screenshots de nove rotas em três larguras e conta erros de console.

**O que falta.**

- **Nenhum teste de frontend.** Sem Vitest + Testing Library no workspace `command-centre`; o `visual-check` não compara baselines (não é regressão visual) e não está ligado a nenhum script npm.
- **Sem lint nem formatação.** Não há ESLint, Prettier, nem `.editorconfig`. Os comentários `eslint-disable-next-line react-hooks/exhaustive-deps` no código são decorativos: nunca houve um linter para desabilitar. Um `eslint-plugin-react-hooks` teria apontado metade dos bugs da seção 5.3.
- **Sem CI.** Não existe `.github/workflows`. Nada roda `typecheck`, `test` e `build` em pull requests.
- **Sem cobertura.** Módulos como `sync/compiler.ts` (330 linhas de backup/diff/conflito), `routines/scheduler.ts` (cron, fuso, catch-up) e `backup.ts` têm cobertura indireta ou nula.
- **`npm audit`: 6 vulnerabilidades** (1 crítica, 2 altas, 3 moderadas). A que importa em produção é `@fastify/static` ≤ 10.1.1 (path traversal e bypass de rota); as demais são de `vite`/`vitest`/`esbuild` em dev.

**Recomendação de harness.**

1. ESLint flat config com `typescript-eslint`, `react-hooks`, `jsx-a11y`; Prettier; `lint-staged` + `husky`.
2. Vitest + `@testing-library/react` + `jsdom` no frontend: `useApi`, `Modal`, formatadores, matemática do grid, `layoutFiles`, `floodFill`, paridade de i18n como teste.
3. `@playwright/test` com `toHaveScreenshot` por rota/largura/tema e `axe-core` para acessibilidade; fluxos: setup → desktop, criar skill → executar → log SSE, arrastar widget e recarregar, `Esc` dentro do modal.
4. GitHub Actions: matriz Node 20/22 em ubuntu e macos rodando `typecheck`, `test`, `build`, `audit --audit-level=high`, e o e2e contra um servidor com os CLIs falsos.
5. MSW para rodar componentes e Storybook sem servidor.
## 10. Plano de ação priorizado

Esforço: **S** ≤ 1 dia · **M** 2–5 dias · **L** 1–2 semanas. A ordem dentro de cada bloco é a ordem sugerida de execução.

### 10.1 Corrigir agora (bugs e segurança)

| # | Ação | Esforço | Fecha |
|---|---|---|---|
| 1 | Validar `id`/`slug` em toda rota com os mesmos regexes dos schemas; `RoutineStore`, `ConnectorRegistry` e `SkillCatalog` recusam ids com separador ou `..` | S | Traversal em DELETE |
| 2 | Backup via `db.backup()` (ou checkpoint e depois copiar); passar `Db` para `createBackup`; teste de regressão com WAL populado | S | B1 |
| 3 | Restore via API: recusar com DB aberto, ou fechar → copiar → reabrir e reconstruir o `AppContext` | S/M | B2 |
| 4 | Shutdown gracioso: cancelar runs ativas (SIGTERM no grupo com prazo), aguardar `execute`, só então fechar o DB; `process.on("unhandledRejection")` como rede; nunca `void` em promise sem `.catch` | M | B3, B5 |
| 5 | Devolver a promise no callback do croner; guarda de "em voo" por rotina; `try/catch` em `fire()` gravando `failed_to_fire` no histórico | S | B4, B5 |
| 6 | Reconstruir adapters quando settings mudam (ou ler `binaryPath` a cada `execute`); `PUT /api/settings` com deep-merge ou exigir objetos completos de provider | S | Adapter congelado, reset de `binaryPath` |
| 7 | Erros zod → 400 com `{error:{code, issues}}`; ajustar o teste que afirma 500 | S | API |
| 8 | Host check com `new URL("http://"+host)` (IPv6) e recusa de Host ausente; `crypto.timingSafeEqual` no token | S | T1 |
| 9 | Preview e open honram a lista de exclusões e um blocklist de diretórios (`.git`, `.aws`, `.ssh`, `.gnupg`) | S | T4 |
| 10 | Cancelamento: registrar o handle antes de `buildInvocation` e decidir o status final pela saída real, não por `cancelRequested` | S | B7 |
| 11 | Retry cria uma run nova por tentativa (ligada por `parent_run_id`); não retentar timeout por padrão; backoff cancelável | M | B6 |
| 12 | **UI:** tirar o chrome "Voltar ao OS / Menu" do `position: fixed` e colocá-lo no cabeçalho de cada app, à esquerda das ações da página | S | Colisão em 5 telas |
| 13 | **UI:** memoizar `useT` por idioma e tirar `t` das dependências dos efeitos de canvas; `hover` em ref | S | Loop reconstruído por mousemove |
| 14 | **UI:** `Modal` e `Launcher` com focus trap, foco no primeiro campo, restauração de foco, `stopPropagation` no `Esc` e `onClose` estável | S | `Esc` navega para o desktop, foco roubado a cada 10 s |
| 15 | **UI:** devolver o `stop` do SSE do efeito, com flag de cancelamento | S | Vazamento de EventSource |
| 16 | **UI:** desktop com `Promise.allSettled`, estado de erro e retry; `ErrorBoundary` por rota | S | Tela em branco |
| 17 | **UI:** `--accent-contrast` derivado da luminância do accent; subir `--text-faint`; accent nunca como texto corrido no claro | S | Contraste AA |
| 18 | Atualizar `@fastify/static` (≥ 10.1.3) e `vite`/`vitest` | S | `npm audit` |
| 19 | Alinhar docs e código: aprovação de pastas, reaping, `npm audit` no doctor, perfis, "CORS estrito", read-only do Cursor. Implementar ou remover a alegação | S | Confiança |

### 10.2 Melhorar em seguida (robustez e qualidade)

| # | Ação | Esforço |
|---|---|---|
| 20 | Indexação em transação, extração de links incremental (por arquivo no upsert), e execução em worker thread ou em fatias com `setImmediate` para não bloquear SSE e scheduler | M |
| 21 | Cache de settings no `AppContext` com verificação de mtime; mutações serializadas por um único método | S |
| 22 | Isolamento por arquivo em `RoutineStore.list` e `ConnectorRegistry.list` (pular e reportar inválidos) | S |
| 23 | Retenção de `runs`/`run_events` (N dias, poda no boot); `Last-Event-ID` no SSE; `reply.hijack()`; cap de stdout em memória (manter a cauda) | M |
| 24 | CLI com `node:util.parseArgs`; validar `--provider`/`--effort` pelos enums zod; aspas nas units geradas; identidade no pidfile | M |
| 25 | Logging de requisições (pino → `logs/api.jsonl` pelo mesmo redator); rotação de `service.out.log`; versão lida do `package.json`; `test:e2e` apontando para um config que existe | S |
| 26 | **UI:** TanStack Query no lugar de `useApi` (cache compartilhado, `refetchInterval` pausado em background, cancelamento, updates otimistas do layout) | M |
| 27 | **UI:** um `/api/events` SSE (runs, rotinas, índice, aprovações) alimentando o cache; um único intervalo de fallback em vez de 4/5/10 s | M |
| 28 | **UI:** `React.lazy` por rota (Segundo Cérebro, Pixel Studio, Settings) | S |
| 29 | **UI:** strings fixas e locale `en-GB` para o dicionário; chave própria para "Nome" em skill e rotina; `document.documentElement.lang` | S |
| 30 | **UI:** custo de canvas: cache de tokens de `getComputedStyle` por tema, `hubByKey` pré-computado, sprites pré-desfocados em vez de `shadowBlur`, dirty flag e pausa em `document.hidden`, sem `backdrop-filter` sobre canvas vivo | M |
| 31 | **UI:** tema claro nos dois canvases (paleta por token, `source-over` no claro) | S |
| 32 | **UI:** tokens de espaçamento, tipografia, z-index e movimento; primitivas `Button`, `Field`, `Segmented`, `ConfirmDialog`, `EmptyState`; remover ~190 estilos inline e ~120 linhas de CSS morto | M |
| 33 | **UI:** desktop responsivo (empilhar abaixo de ~900 px), validar layout persistido contra a grade atual, resolver sobreposição gaveta × zoom | M |
| 34 | **UI:** log de run virtualizado com timeline por tipo de evento e pausa do autoscroll ao rolar para cima | S |
| 35 | Harness de testes e CI (ver seção 9): ESLint + Prettier + husky; Vitest no frontend; Playwright com baselines e axe; GitHub Actions | M |

### 10.3 Vale reconstruir

| # | O quê | Por quê | Como | Esforço |
|---|---|---|---|---|
| 36 | **Registro de providers** no lugar do enum | É o que torna "vendor-neutral" verdadeiro e é pré-requisito para plugins | `ProviderId` vira string com brand; cada adapter exporta um manifesto (`id`, nome, capacidades: `enforcesReadOnly`, `supportsEffort`, `promptTransport`, layout nativo para o compilador, caminhos de config para o auditor); `AppContext`, `SyncCompiler` e `auditor` iteram o registro | M |
| 37 | **Ciclo de vida da run como máquina de estados** dentro do `RunManager` | Hoje o cancelamento é global de módulo, o retry cutuca `runs.status` direto e os estados são strings soltas | `execute` devolve um `RunController`; transições explícitas `queued → starting → running → {done, failed, cancelled, timed_out, interrupted}` com um `UPDATE` por transição; scheduler e retry viram clientes dessa API; remover `AgentAdapter.cancel` | M |
| 38 | **Trabalho longo fora da thread HTTP** | Indexação, backup e sync-apply bloqueiam a API inteira | Jobs com progresso publicado no mesmo barramento de eventos | M/L |
| 39 | **Semântica dos perfis de segurança** | Três dos quatro perfis são indistinguíveis | Implementar `review_before_write` de verdade (runs `write` geram um patch em `artifacts/` e uma aprovação pendente; `apply` é um passo separado) ou remover os perfis redundantes | L (implementar) / S (remover) |
| 40 | **Motor do Segundo Cérebro como pacote agnóstico** (`brain-engine`) | 1.700 linhas com física, hit-test, render e React no mesmo closure; nada é testável | Modelo de mundo em TS puro, `layoutFiles`, tick de física, hit-test e renderer com `OffscreenCanvas` em Web Worker; React vira um controlador de ~200 linhas | L |
| 41 | **Dividir `Desktop.tsx`** em `desktop/` (`useGridLayout`, `Wallpaper`, um arquivo por widget) e `SecondBrain.tsx` em `brain/` (painel, legenda, preview, ponte com o motor) | Componentes-deus impedem teste, reuso e revisão | Extração mecânica após o item 40 | M |
| 42 | **Storybook (ou Ladle)** para primitivas e widgets com toggles de tema e reduced-motion, sobre fixtures MSW | Vira a superfície de regressão visual | Depois do item 32 | M |
| 43 | **Vista acessível paralela ao grafo**: árvore/lista de arquivos pesquisável e navegável por teclado, sincronizada com a seleção | O canvas passa a ser um enriquecimento, não a única interface | Reusar a busca FTS já existente | M |

## 11. Roadmap de evolução (produto)

Ideias que cabem na visão ARMS e se apoiam no que já existe:

1. **Barramento de eventos** (emissor tipado em processo → JSONL + SSE `/api/events`) unificando eventos de run, disparos do scheduler, progresso do índice e aprovações. O widget "Precisa de atenção" já quer isso; o desktop deixa de fazer polling. (M)
2. **Centro do desktop com informação viva.** Substituir a nuvem de partículas por um "agora": runs em andamento com progresso e ferramenta atual, próxima rotina com contagem regressiva, últimos artefatos com preview. O núcleo visual pode continuar como fundo, mais discreto e pausado quando não há atividade. (M)
3. **Launcher como paleta de comandos.** Busca por teclado que encontra apps, skills (`/code-review`), arquivos indexados e ações ("Criar backup", "Reindexar"). É a ponte natural entre o launcher e o Segundo Cérebro. (M)
4. **MordomoOS como servidor MCP.** Expor buscar memória, listar/rodar skills, ler artefatos e pedir aprovação, para que qualquer provider chame o OS de volta durante uma run em vez de receber caminhos no prompt. É a casa natural do conceito de "conectores". (M)
5. **Fluxo de aprovações completo.** Tornar reais os nove `ApprovalKind`, com um decorator "exige aprovação" nas rotas e uma caixa de entrada de pendências na UI e no CLI. (M)
6. **Sistema de plugins** sobre o registro do item 36: adapters, conectores e micro-apps como pacotes npm com manifesto; declarações de permissão viram o payload da aprovação. (L)
7. **Orquestração multiagente.** Skills que abrem sub-runs (`parent_run_id`), herança de orçamento e timeout, passagem de artefatos; os streams JSON do Claude e do Codex já bastam para uma árvore ao vivo na UI. (L)
8. **Memória vetorial** ao lado do FTS5 (`sqlite-vec` ou um embedder local) com ranking híbrido; FTS continua como fallback para manter a promessa "roda em qualquer lugar". (M)
9. **Timeline de execução.** Detalhe da run como linha do tempo com eventos agrupados por ferramenta, diffs de arquivos alterados, custo/tokens quando o provider expõe, e replay. (M)
10. **Distribuição.** Binário único (`node --experimental-sea` ou `pkg`), `brew tap`, `winget`; hoje instalar exige clonar e buildar. (M)

## 12. Como ler este relatório

- As referências `arquivo:linha` apontam para o commit `7013816`.
- "Reproduzido" significa que o comportamento foi observado nesta sessão contra o servidor real, não inferido do código.
- As capturas em `img/` foram geradas com Playwright contra a build de produção servida pela API, com o repositório indexando a si mesmo.
- Este documento não altera nenhum código do produto. Ele foi adicionado em `docs/audit-2026-09/` para servir de base a issues e PRs.
