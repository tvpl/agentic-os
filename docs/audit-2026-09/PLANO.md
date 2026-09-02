# Plano de ação: execução da auditoria de setembro de 2026

Este plano transforma os 43 itens da seção 10 do relatório em trabalho executável, organizado em ondas para permitir paralelismo sem conflito de arquivos. Cada frente tem um conjunto de arquivos próprio; arquivos compartilhados (`i18n.ts`, `theme.css`) aceitam adições de qualquer frente.

## Convenções

- Nenhum item é fechado sem teste (unitário, de API ou e2e) que reproduza o problema antes e passe depois.
- Sem `any`, sem `eslint-disable` novo, sem promise descartada sem `.catch`.
- Toda string visível passa pelo dicionário `i18n.ts` (EN + pt-BR).
- Contrato do barramento de eventos: `core/src/events.ts` (`events.emit(type, payload)`, `events.subscribe(fn)`, `events.since(id)`).

## Onda 0: preparação (feita pelo orquestrador)

| Item | Ação | Estado |
|---|---|---|
| 18 | `@fastify/static` 10.1.3, `vite` 8, `vitest` 4: `npm audit` com 0 vulnerabilidades, build e 70 testes passando | Feito |
| — | Tooling instalado: `@tanstack/react-query`, `@tanstack/react-virtual`, Testing Library, jsdom, ESLint 9 + typescript-eslint + react-hooks + jsx-a11y, Prettier, husky, lint-staged, `@playwright/test`, `@axe-core/playwright` | Feito |
| 27 (contrato) | `core/src/events.ts`: `EventBus` tipado com ring buffer para `Last-Event-ID` | Feito |

## Onda 1: oito frentes em paralelo

### B1: camada de API (`apps/api/src/server.ts`, `routes/*`, `context.ts`, `doctor.ts`, `tests/api.test.ts`)

Itens 1 (validação de `:id`/`:slug` em toda rota), 3 (restore recusa com DB aberto ou fecha → copia → reabre), 6 (adapters reconstruídos quando settings mudam; `PUT /api/settings` com deep-merge), 7 (zod → 400 com `{error:{code, message, issues}}`), 8 (Host via `new URL`, Host ausente recusado, `timingSafeEqual`), 9 (contenção em `skills/import`, `sync target`), 19 (`npm audit` no doctor), 23 (`reply.hijack()`, `Last-Event-ID` no SSE), 25 (log de requisições em `logs/api.jsonl` via redator; versão do `package.json`; `/api/health` real), 27 (`GET /api/events` SSE sobre o barramento), 4 (wiring: `close()` chama `runs.shutdown()` antes de fechar o DB).

### B2: runtime do core (`backup.ts`, `runs/runManager.ts`, `agents/baseExec.ts`, `spawn/safeSpawn.ts`, `routines/scheduler.ts`, `db/migrations.ts`, `tests/core.runs.test.ts`, `tests/core.scheduler.test.ts`)

Itens 2 (backup via `db.backup()`; teste com WAL populado), 4 (`RunManager.shutdown(graceMs)`; coluna `pid` gravada; `unhandledRejection` logado), 5 (callback do croner devolve a promise; guarda em voo; `try/catch` em `fire()`), 10 (handle registrado antes de `buildInvocation`; status pela saída real), 11 (retry cria run nova com `parent_run_id`; não retenta timeout; backoff cancelável), 23 (retenção de `runs`/`run_events`; cap de stdout), B8 (`previousScheduledTime` com croner), B9 (generator cancela o filho se abandonado), B10 (run manual devolve o id real), 37 (transições explícitas de estado), emissão de eventos no barramento.

### B3: memória, config e stores (`memory/*`, `config/store.ts`, `routines/store.ts`, `connectors/registry.ts`, `skills/catalog.ts`, `logs/jsonl.ts`, `security/*`, testes correspondentes)

Itens 1 (stores recusam ids com separador ou `..`), 9 (preview e open honram exclusões e blocklist de diretórios), 20 (indexação em transação; links incrementais; fatiamento com `setImmediate`; detecção de binário por conteúdo), 21 (cache de settings por mtime; mutações serializadas), 22 (isolamento por arquivo nos stores), 25 (rotação de `service.out.log`; poda por retenção no boot), eventos `index.progress`/`index.finished`.

### B4: CLI e tooling (`cli.ts`, `osIntegration.ts`, `eslint.config.js`, `.prettierrc`, `.editorconfig`, `.nvmrc`, `.github/workflows/ci.yml`, scripts do `package.json`)

Itens 24 (`node:util.parseArgs`; validação de `--provider`/`--effort`; aspas nas units; identidade no pidfile; confirmação de `--purge`), 35 (ESLint + Prettier + husky/lint-staged; CI com typecheck, lint, test, build, audit em Node 20/22 e três SOs), `test:e2e` apontando para config real.

### F1: shell e design system (`App.tsx`, `main.tsx`, `api.ts`, `i18n.ts`, `components/*`, `theme.css`, `index.html`)

Itens 12 (chrome "Voltar ao OS / Menu" dentro do cabeçalho de cada app), 13 (`useT` memoizado), 14 (`Modal`/`Launcher` com focus trap, restauração, `Esc` sem vazar, `onClose` estável; launcher com busca), 16 (`ErrorBoundary` por rota), 17 (contraste derivado do accent; `--text-faint`), 26 (`QueryClientProvider` e hooks `useOs*` compartilhados), 27 (`useEventStream` invalidando queries), 28 (`React.lazy` por rota), 29 (dicionário: novas chaves, `document.lang`, locale por idioma), 32 (tokens de espaçamento/tipo/z/movimento; primitivas `Button`, `Field`, `Segmented`, `ConfirmDialog`, `EmptyState`, `Skeleton`; CSS morto removido), tema "system" reativo, animações de entrada/saída com `prefers-reduced-motion`.

### F2: Desktop e Execuções (`views/Desktop.tsx` → `desktop/*`, `views/Runs.tsx` → `runs/*`)

Itens 15 (SSE com cleanup), 16 (`allSettled` + erro + retry), 30 (tokens de canvas em cache; sem `backdrop-filter` sobre canvas; dirty flag; pausa em `hidden`), 31 (tema claro), 33 (empilhar abaixo de 900 px; validar layout persistido; corrigir corte em 1024×768), 34 (log virtualizado como linha do tempo por tipo de evento; autoscroll pausável), 41 (um arquivo por widget), estados vazios com ação, título da run, cabeçalhos traduzidos, centro do desktop com informação viva (runs ativas, próxima rotina, últimos artefatos).

### F3: Segundo Cérebro (`views/SecondBrain.tsx` → `brain/*`)

Itens 13 (hover em ref; `t` fora das deps), 30 (`hubByKey`; sprites pré-desfocados; dirty flag; pausa em `hidden`; slider de molas sem reconstruir a simulação), 31 (paleta por token; `source-over` no claro), 33 (gaveta não cobre zoom nem painel), 40 (motor em módulo puro `brain/engine.ts` testável), 41 (painel, legenda, preview, controles em arquivos próprios), 43 (lista de arquivos acessível sincronizada com a seleção), zoom só com modificador, race do preview, rótulos dos anéis sem colisão, controles avançados recolhidos, minimapa com DPR.

### F4: Skills, Rotinas, Configurações, Conectores, Setup, Pixel Studio

Itens 29 (strings fixas → dicionário; chave própria para "Nome"), `key` no `SkillDetail`, promessas com toast de erro, validação de cron com prévia das próximas execuções, seleção de fuso, abas em Configurações, idioma do Setup coerente com a UI, CSS do Pixel Studio no `theme.css`, guarda de trabalho não salvo, `ConfirmDialog` em ações destrutivas, `EmptyState` em listas vazias, "Executar com: Desabilitada" com caminho para habilitar, busca e filtro em Skills.

## Onda 2: integração e reconstruções

- Build, typecheck, lint, testes completos; correção de conflitos entre frentes.
- Item 36: registro de providers com manifesto (substitui o enum em `schema.ts`, `compiler.ts`, `auditor.ts`, `context.ts`).
- Item 39: semântica real dos perfis de segurança (`review_before_write` gera aprovação pendente antes de runs de escrita; `approved_automation` é o único que permite escrita em rotinas).
- Item 35: testes de frontend (Vitest + Testing Library) e e2e (`@playwright/test` com baselines e axe).
- Item 19: docs alinhadas ao código (`security.md`, `README`, `architecture.md`).
- Item 42: catálogo de componentes (Ladle) se houver tempo.

## Onda 3: verificação final

Build, 100% dos testes, lint limpo, capturas de tela contra o servidor real nas mesmas rotas do relatório, atualização do status de cada item no relatório, commit e push.

## Estado final (2 de setembro de 2026)

| Onda | Estado |
|---|---|
| 0 | Concluída |
| 1 (B1–B4, F1–F4) | Concluída. F2, F3 e F4 foram finalizadas pelo orquestrador após interrupções por limite de sessão; o rascunho não integrado do motor do cérebro (`brain/engine`) foi descartado. |
| 2 | Concluída. O registro de providers (item 36), a extração do motor do Segundo Cérebro (item 40) e o catálogo de componentes com regressão visual (item 42) foram entregues em uma rodada extra antes do PR. |
| 3 | Concluída: 149 testes de backend, 16 de frontend, 16 cenários e2e, lint e build limpos, capturas em `img-after/`. |
