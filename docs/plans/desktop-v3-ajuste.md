# Plano de ajuste — do dashboard ao HUD do protótipo v3

15/09/2026 · protótipo aprovado: [`prototype/desktop-v3.html`](prototype/desktop-v3.html) ·
promessa registrada: [`desktop-v3-paridade.md`](desktop-v3-paridade.md) (versão de 13/09)

## O diagnóstico, sem atenuante

Você está certo. O que roda hoje **não é** a experiência do protótipo, e o motivo é um erro
meu de modelo, não de acabamento.

O protótipo tem **um primitivo**: o painel (`.pan`), uma placa chanfrada que se materializa
com íris, tem `@ref` no cabeçalho, recolhe para o dock, expande, fecha, encaixa nas bordas.
Tudo que aparece no palco é um painel de um de seis tipos — **app**, **artefato**, **run**,
**superfície**, **imagem**, **nó**. Os apps inteiros (Segundo Cérebro, Skills, Rotinas,
Execuções, Conectores, Artefatos, Gerações, Ajustes com 10 abas, Pixel Studio) abrem **dentro
do desktop** como painéis. Rodar uma skill abre o **trace** como painel e o **resultado** como
outro painel. O desktop nunca navega para fora de si.

O que eu fiz em F1–F6 foi construir um gerenciador de janelas **por baixo do registro de
widgets antigo** — os mesmos 14 widgets (Hoje, Workspace, Custo, Deck, Rotinas, Pulso,
Console…), com a mesma casca (título em `h2`, engrenagem de configuração, ocultar, maximizar
para um modal), a galeria, os presets, a barra de edição. Os apps continuaram sendo **rotas de
página inteira** com "Voltar ao OS". Rodar uma skill continua fazendo `navigate('/runs/:id')`.
Uma skill com entradas obrigatórias faz `navigate('/skills/:slug')`. Em F7 eu pendurei pods,
campo, deck e palco limpo **em cima** disso. O resultado é exatamente o que você viu: o
dashboard antigo com decoração nova.

Tratei "widget" e "painel" como a mesma coisa, e portei a **casca** do protótipo em vez do
seu **modelo**. Este plano corrige o modelo.

## Inventário: o que o protótipo é × o que a produção tem

| # | Subsistema no protótipo | Produção hoje | Veredito |
|---|---|---|---|
| 1 | **Painel** (`.pan`): placa chanfrada, íris ao abrir, `@ref` no cabeçalho, ▁ ⤢ ✕, `on`/`off` (o focado brilha, os outros esmaecem), grip, encaixe nas bordas | `WidgetFrame`: `h2`, ocultar, maximizar → modal `Surface`, engrenagem, grip. Encaixe e arrasto existem (F4a) e são bons | **Substituir a casca**, manter `windowModel` |
| 2 | **Seis tipos** de painel | 14 widgets + `doc:` | Construir `app`, `run`, `surface`; manter `doc` como `artifact` |
| 3 | **Apps como painéis**: 9 apps abrem no palco | 9 rotas de página inteira com `AppFrame` + "Voltar ao OS" | **Montar as views existentes dentro de painéis** |
| 4 | **Run → painel de trace** + resultado como painel | `navigate('/runs/:id')` | Construir |
| 5 | **Entradas de skill → painel de formulário** | `navigate('/skills/:slug')` | Construir |
| 6 | **Console fixo** no rodapé: bandeja (chip por painel aberto), `@` autocompleta qualquer painel, `/` abre o deck, linha de controles (modo · pasta · modelo·esforço · provedor · nova conversa · turnos·custo), moldura acende quando ocupado | Widget-janela com título "CONSOLE"; bandeja e `@` só para documentos; controles parciais | **Reconstruir como console fixo**, fora do layout |
| 7 | **Faixa ambiente** no topo: marca · Claude·pronto · Dia US$ · Runs · Atenção · sino · relógio — cada segmento abre a superfície correspondente | Barra de marca com 8 ícones de ferramenta, segmentado de provedores, sino | **Substituir** |
| 8 | **Dock**: espaços · **painéis abertos** (recolher/restaurar) · Editar HUD · Visão geral · Distribuir | Dock: 9 ícones de app + espaços + recolher | **Substituir** |
| 9 | **HUD editável**: Editar HUD → pods balançam, ✕ remove, `+` abre a galeria de instrumentos; lados configuráveis | Pods fixos (F7) | Estender + persistir |
| 10 | **Superfícies de instrumento** (Pulso, Atenção, Caixa, Orçamento) com blocos de métrica `.mt`, barras, linhas `.rw` | Widgets `pulse`, `attention`, `inbox`, `cost` | Converter os corpos para o tipo `surface` |
| 11 | Pods à esquerda: cérebro, skills, artefatos, gerações, conectores, ajustes, pixel | brain, skills, pixel, generations, artifacts, connectors — todos **navegam** | Abrir painel |
| 12 | Paleta `⌘K` / `/`: apps, ações, skills, arquivos, execuções | Existe e é boa | Linhas passam a abrir painéis |
| 13 | Onboarding em 5 passos (provedor, identidade, pasta, conectores, **montar HUD**) | `Setup.tsx` (5 passos) + guia do OS em 12 paradas | Manter; passo 5 vira "Monte seu HUD" |
| 14 | Sino com contador | Existe | Manter |
| 15 | Espaços (Trabalho · Pesquisa · Ops) guardam painéis | Existe (F6), guarda widgets | Manter; mesma store |
| 16 | Visão geral `\` e Distribuir | Existem (F4b) | Manter |
| 17 | Amarras do console até o painel citado | Existem (F5), só para documentos | Estender a todo painel |
| 18 | Campo vivo, pods, deck radial | Existem (F7) | Manter |
| 19 | Não existe no protótipo: Hoje/fusos, Workspace, Micro apps, Agenda, Calendário, Email, galeria de widgets, presets, popover de configuração, barra de edição | Existem | **Apagar** (decisão 1 abaixo) |

O que **fica** de F1–F7 porque está certo e testado: `windowModel.ts` (arrasto, encaixe,
empilhamento, clamp, `placeNew`, `tile`, `cascade`, `overviewSlots`), `useWindowDrag`,
`useWindowLayout` + espaços, `signal.ts`, pods, campo, deck, tethers, `Surface` (vira a
expansão do painel), paleta, sino, onboarding, o schema de layout com `.catch({})`.

## Ordem de execução

Seis blocos, cada um com um portão visual: ao fim de cada um eu ponho o print do produto ao
lado do protótipo a 1440×900 e **não chamo de pronto** enquanto os dois não lerem igual.
Foi a verificação que faltou.

### G1 — O painel ✅ (`ab97a1e` + casca; registro em `desktop-v3-paridade.md`)

O primitivo. Sem ele, nada do resto tem onde morar.

- `desktop/Panel.tsx` substitui `WidgetFrame` dentro de `WidgetLayer`: placa chanfrada
  (`clip-path` com `--cut`), materialização com íris, cabeçalho com glifo por tipo · título ·
  `@ref` · ▁ ⤢ ✕, `on`/`off` pelo foco, grip. **Sem** engrenagem, **sem** "ocultar widget".
- Tipo no modelo: `WindowMap[id].kind: "app" | "artifact" | "run" | "surface" | "image" | "node"`
  e `ref: string` (o nome que o console usa). O id continua sendo a chave: `app:brain`,
  `run:41`, `sur:pulse`, `doc:<path>`.
- ▁ recolhe para o dock (transição para baixo + escala, como o protótipo); ⤢ usa o `Surface`
  atual; ✕ fecha com `bye`.
- **Apagados**: `WidgetConfigPopover`, `LayoutPresets`, `AddWidgetGallery`, a barra de edição
  (`edit-bar`), o modo de edição de widgets, `widgetTypes`/`configSchema`, os widgets
  `today`, `workspace`, `microapps`, `agenda`, `calendar`, `email` (decisão 1), o `deck`
  em card (o deck radial já é o deck).
- **Convertidos** para `surface`: `pulse`, `attention`, `inbox`, `cost`, `routines`
  (resumo), `now`. O corpo ganha os blocos `.mt` / `.bars` / `.rw` do protótipo.
- Testes: `WidgetLayer.surface.test.tsx` → `Panel.test.tsx`; os 9 specs e2e que usam
  `data-widget-id` passam a `data-panel`; `stage.ts` ganha `kind`.

Portão: palco limpo com o console; abrir Pulso pelo pod → placa com íris, `@pulso` no
cabeçalho, chip na bandeja.

### G2 — Apps como painéis

- `desktop/apps.ts`: `APPDEF` com `kind: "app"`, `ref`, título, tamanho inicial e o
  componente da view existente: `Artifacts`, `Runs`, `Routines`, `Connectors`, `Generations`,
  `Skills`, `Settings`, `SecondBrain`, `PixelStudio`. O painel de app tem `.bd{padding:0}`
  e a view preenche.
- `openApp(kind)` no `DesktopActions`. Pods da esquerda, paleta, "abrir execuções ⤢" nas
  superfícies e o passo do onboarding passam a chamar isso.
- **Rotas viram deep links**: `/settings?tab=security` → vai para `/` e abre `app:settings`
  na aba. `AppFrame` e "Voltar ao OS" saem do caminho principal; ficam apenas como
  fallback do modo empilhado (< 1024 px), onde painéis flutuantes não fazem sentido.
- Riscos conhecidos, por view: `SecondBrain` (730 linhas) mede o host para o canvas — ok
  em painel; `Settings` (1667) tem abas fixas — precisam rolar dentro do painel;
  `PixelStudio` (1016) tem atalhos globais de teclado — passam a valer só com o painel
  focado; `Routines` (1057) abre modais — continuam modais.
- Cada view perde o cabeçalho próprio de página (o painel já tem título).

Portão: os 9 pods/apps abrem dentro do palco; nenhum clique no desktop muda a rota.

### G3 — Execução no palco

- `runSkill` deixa de navegar. Abre `run:<id>` (tipo `run`) com o trace ao vivo — o stream
  de eventos que `/runs/:id` já consome, num corpo `.tr` com cursor piscando; o pod Pulso
  fica `live`, o console `busy`, `data-core="thinking"`.
- Ao concluir: os artefatos produzidos pela run abrem como painéis `artifact` (o `openDoc`
  atual) e entram na bandeja. Falha → o painel fica com a linha em vermelho e a Atenção
  acende.
- Skill com entradas obrigatórias → painel `surface` com o formulário (reaproveita o
  formulário de `SkillDetail`), validação inline, "executar ▶" dispara G3.
- Aprovação pendente → painel `surface` com aprovar/negar (hoje é um estado dentro do
  console).
- "Reexecutar" no app de Execuções e "disparar" no de Rotinas usam o mesmo caminho.

Portão: escrever no console → trace abre como painel → resultado abre como painel →
`@relatorio` funciona no prompt seguinte.

### G4 — Console fixo

- O console sai do `WidgetLayer` e vira `desktop/Console.tsx`, fixo em
  `bottom: dock + 12px`, `width: min(860px, 100vw − 220px)`, moldura que acende em `busy`.
  `prompt` sai do registro e do `DEFAULT_SPECS`.
- Bandeja: um chip por **painel aberto** (não só documentos). `@` autocompleta todo painel
  pelo `ref`. `/` no campo vazio abre o deck.
- Linha de controles como no protótipo: modo (existe) · pasta (existe) · **modelo·esforço**
  (novo, abre o `ModelEffortPopover`) · provedor (existe) · nova conversa (existe) ·
  turnos·custo (existe). O `PromptWidget` de 783 linhas é fatiado: thread, campo, controles.
- Amarras saem do console para qualquer painel citado.

Portão: console idêntico ao do protótipo; `@` lista tudo que está no palco.

### G5 — Faixa, dock, HUD editável

- **Faixa ambiente** substitui a barra de marca: `MORDOMO·OS` · provedor·estado · Dia US$ ·
  Runs · Atenção · sino · relógio. Cada segmento tem `data-level` de `signal.ts` e abre a
  superfície correspondente. Os 8 ícones de ferramenta saem: editar/buscar/distribuir/visão
  geral vão para o dock e a paleta; cor de destaque fica em Ajustes → Tema.
- **Dock** substitui o `WorkspaceDock`: espaços (com contagem de painéis) · divisor ·
  **painéis abertos** (botão por painel; recolhido = tracejado; run = ponto vivo; clique
  alterna foco/recolher/restaurar) · Editar HUD · Visão geral · Distribuir.
- **Editar HUD**: pods balançam, ✕ remove, `+` abre "Adicionar ao HUD" com os instrumentos
  fora do arco. Persistido em `settings.hud = { l: string[], r: string[] }` (schema Zod com
  `.catch` do mesmo jeito que o layout). Instrumentos disponíveis: os 9 apps + pulso,
  atenção, execuções, rotinas, caixa, orçamento, diagrama.

Portão: topo, rodapé e arcos idênticos ao protótipo; remover/adicionar pod sobrevive ao
reload.

### G6 — Amarras finais e paridade

- Espaços guardam painéis de qualquer tipo (o `app:` reabre a view; o `run:` reabre o trace
  pelo id; o `doc:` já funciona).
- Paleta: linhas de apps/arquivos/execuções abrem painéis; ações ganham "Editar HUD".
- Onboarding: passo 5 vira "Monte seu HUD" com os pods reais.
- Modo empilhado (< 1024 px): uma coluna de painéis + console; apps via `AppFrame`.
- Tema claro: as placas e a faixa com a tinta certa (o campo já trata).
- e2e reescrita onde o modelo mudou; unit para `Panel`, `apps`, `Console`, `hud`.
- `docs/plans/desktop-v3-paridade.md` fecha com a tabela deste inventário marcada.
- Pacote macOS refeito e verificado no home isolado.

## Decisões que preciso de você

Só quatro. O resto eu decido e registro.

1. **Apagar de vez** Hoje/fusos, Workspace, Micro apps, Agenda, Calendário, Email, galeria de
   widgets, presets e popover de configuração. O protótipo não tem nenhum deles e a versão de
   13/09 já dizia: *"presets, popover e galeria não voltam; substituídos por Editar HUD"*.
   Agenda/Email voltam um dia como **conectores**, não como widgets. **Recomendo apagar.**
2. **`now` (objetivo atual)**: o protótipo não tem. Tem função real (motor de objetivos) e
   teste e2e. **Recomendo manter como superfície** aberta pelo pod Execuções e pela paleta,
   não como painel padrão.
3. **Rotas**: manter `/brain`, `/settings?tab=…` etc. como deep links que abrem o painel no
   desktop (recomendo — links de notificação, onboarding e docs continuam valendo) ou
   remover.
4. **Ordem**: G1 → G2 → G3 é o que muda a experiência; G4 → G5 é o que muda a cara. Posso
   fazer G4 (console) antes de G2 se você quiser sentir o console primeiro. **Recomendo a
   ordem como está.**

## Decisões tomadas (15/09, por delegação sua)

1. **Apagados**: Hoje/fusos, Workspace, Micro apps, Agenda, Calendário, Email, galeria de
   widgets, presets, popover de configuração, barra de edição.
2. **`now`** vira superfície, aberta pelo pod Execuções e pela paleta.
3. **Rotas** ficam como deep links que abrem o painel no desktop.
4. **Ordem**: G1 → G2 → G3 → G4 → G5 → G6.

## O que muda no meu método

- Cada bloco termina com **print lado a lado** com o protótipo, na mesma resolução, antes de
  eu dizer "pronto". Se não lê igual, não está pronto.
- Nenhuma peça nova entra "em cima" de uma antiga. Quando o protótipo substitui algo, o
  antigo sai no mesmo commit.
- O doc de paridade recebe a tabela do inventário e cada linha só vira ✅ com o print.
