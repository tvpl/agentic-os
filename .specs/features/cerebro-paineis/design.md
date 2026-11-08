# Painéis — design das telas (binding para a feature)

Decide a página "Painéis" (moldura) e a cena "Painéis" (Núcleo), a composição dos três modelos de painel, cada tipo de widget
com os seus estados, as cores dos gráficos e o texto nas duas línguas. Fica fora daqui: o formato do arquivo e do snapshot (é do
`plan.md`, doors 1 e 4) e a tela Hoje, que só ganha um link.

Inspiração, não referência: as três capturas do dono (visão geral, uma área, uma pergunta). O que vem delas é a ideia de três
tipos de painel, a fileira de números com tendência no topo e as listas com selo de estado; o resto é nosso.

## Binding sources

| Source                                                                  | O que decide                                                                                                                                                                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.specs/features/design-system/design.md`                               | piso de 12px, texto corrido 13px, cor só por token (stylelint), estado nunca só por cor (ícone e texto), axe sem `serious`/`critical` nas duas interfaces e nos dois temas, a galeria cobre as duas camadas  |
| `.specs/features/primitivas/design.md`                                  | o seletor de painel é o `Menu` das primitivas; "Ver como tabela" é um `Switch`; o diálogo "Novo painel" é `Modal`; os selos são o `Badge` do tema; nenhum CSS fora de `ui/ui.css` desenha parte de primitiva |
| `.specs/features/moldura-app/design.md`                                 | a página entra no grupo principal da barra lateral, depois de "Hoje"; layout de página da moldura (`.page`), sem painel de detalhe à direita; o chat continua fixo à direita                                 |
| `.specs/features/comandos-atalhos/design.md`                            | "Abrir painéis" e "Atualizar painel" são comandos do registro (`global`); a tecla `6` do Núcleo entra pela lista de cenas, não por ouvinte novo                                                              |
| `.specs/features/cerebro-natureza/design.md`                            | o rótulo de natureza ("Plano", "Hipótese", "Opinião") com o ícone da natureza; um plano nunca leva o selo "Decidido"                                                                                         |
| método do skill `dataviz` (forma, cor, marcas, interação, anti-padrões) | stat tile com valor, delta e sparkline; uma série por gráfico, um só eixo; marcas finas; tooltip que nunca é o único caminho para o valor; vista de tabela; cor validada por script, não a olho              |

## Cores dos gráficos

Todos os gráficos desta feature têm uma série; nenhum precisa de paleta categórica nem de legenda (o título nomeia a série). A
cor de destaque da pessoa (`--accent`, injetável) **não** é usada em marcas de dado: ela pode cair fora da faixa de claridade.
Tokens novos em `theme.css`, um valor por tema, validados com `dataviz/scripts/validate_palette.js`:

| Token               | Escuro (superfície `#131109`) | Claro (superfície `#fdfcf9`) | Uso                                                            | Validador                                                                                                 |
| ------------------- | ----------------------------- | ---------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `--chart-mark`      | `#ea580c`                     | `#c2410c`                    | barra, linha do sparkline no período atual, ponto final        | escuro: L dentro de 0,48–0,67, contraste ≥ 3:1, PASS; claro: L dentro de 0,43–0,77, contraste ≥ 3:1, PASS |
| `--chart-mark-soft` | `--chart-mark` a 10%          | `--chart-mark` a 10%         | área sob o sparkline                                           | lavagem, não marca                                                                                        |
| `--chart-muted`     | `var(--text-faint)`           | `var(--text-faint)`          | histórico do sparkline antes do período atual, trilho da barra | de-ênfase                                                                                                 |
| `--chart-grid`      | `var(--border)`               | `var(--border)`              | linha de base e grade, 1px, sólida                             | recessiva                                                                                                 |

`#f97316` (o laranja de hoje) falhou no escuro (L 0,705, acima da faixa) e passou com aviso no claro (contraste 2,73:1); por isso
os dois valores acima. Selos de estado usam os tokens de estado que já existem (`--ok`, `--warn`, `--danger`, `--info` e os
`-bg`), sempre com ícone e texto; eles nunca pintam uma série.

## Página - Painéis

Cabeçalho (uma linha, quebra em duas abaixo de 720px):

- À esquerda: para `overview`, a saudação pela hora local ("Bom dia", "Boa tarde", "Boa noite") em 24px; para os outros, o título
  do painel. Embaixo, 12px `--text-dim`: o tipo ("Visão geral", "Contexto: <nome>", "Pergunta"), a data longa e "Atualizado às
  HH:MM", e as fontes como selos pequenos (ícone de estado + nome: `Check` ok, `AlertTriangle` erro, `Plug` não configurado,
  `CircleSlash` indisponível).
- À direita: o seletor de painel (`Menu`: os painéis por tipo, "Novo painel…"), "Atualizar" (`.btn.sm` com `RefreshCw`), e o menu
  "Mais" (`Exportar HTML`, `Personalizar`, `Editar no editor do sistema`, `Arquivar painel`).
- Estados do cabeçalho: atualizando = `Loader` girando + "Atualizando…" (`role="status"`); desatualizado = `Clock` + "Desatualizado —
  atualizado às HH:MM"; nunca atualizado = "Ainda sem dados" + "Atualizar".

Corpo, grade de 12 colunas, espaço 16px:

1. Fileira de destaques (`highlights`), se houver itens: até 8 pastilhas numa linha que rola na horizontal, cada uma com ícone da
   regra, texto curto e o tom; clicar abre o alvo. Vazia: a fileira some.
2. Fileira de KPIs: até 5 stat tiles de largura igual (abaixo de 960px, 2 por linha; abaixo de 560px, 1).
3. Widgets em cartões (`.mold-card`), na ordem da definição; `size` de cada widget (`s` = 4 colunas, `m` = 6, `l` = 8, `xl` = 12).

Personalizar (`Modal`): a lista dos widgets com `Switch` de mostrar e alças de reordenar (teclado: ↑/↓ com o item focado); grava
por `PUT /api/dashboards/:id` com a versão; conflito mostra "Este painel mudou em outro lugar." com "Recarregar".

Novo painel (`Modal`): três cartões "Visão geral", "Contexto" (com o select de contextos; sem contextos, o texto "Crie um contexto
primeiro" e o link), "Pergunta" (campo de até 500 caracteres); "Criar" e "Cancelar".

## Cena - Painéis (Núcleo)

A mesma composição sob a moldura do Núcleo: o cabeçalho vira a linha de voz da cena; os KPIs ficam numa faixa no alto, os cartões
viram lâminas na ordem da definição, duas colunas; o seletor de painel é o menu da cena. Sem movimento de câmera; a entrada da
cena segue a regra de movimento abaixo.

## Os três modelos

| Modelo              | Widgets, em ordem                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Visão geral         | KPIs: "Prioridades de hoje" (`tasks` today, `value` feitas, `of` total), "Decisões da semana" (`decisions` week, selo "N abertas"), "Projetos no prazo" (`projects`, `value` on_track, `of` ativos, selo "N atrasados"), "Revisões vencidas" (`reviews`), "Execuções em 24 h" (`metrics` runs24h); `checklist` "Prioridades de hoje" (m); `list` "Decisões da semana" (m); `list` "Em andamento" (`projects` + `runs`, m); `agenda` "Agenda de hoje" (`connector` calendar, l) |
| Contexto (uma área) | KPIs do contexto: tarefas abertas, decisões da semana, notas atualizadas na semana, revisões vencidas; `checklist` "Próximas tarefas" (`tasks` week, m); `bars` "Notas por status" (`notes` agrupado por `status`, m); `list` "Mudou nesta semana" (`notes` por `updated`, m); `list` "Decisões abertas" (`decisions`, `open`, m); um `connector` se o contexto tiver um ligado                                                                                                |
| Pergunta            | a pergunta como título; os widgets que a skill devolve (até 6, dos oito tipos); abaixo de cada um, "Fontes" com as citações `nome § seção`; um cartão `note` "Como esta resposta foi feita" com a data da execução e o link para ela                                                                                                                                                                                                                                           |

## Widgets

Cada cartão: título 13px semibold, um contador à direita em 12px `--text-dim` ("3 de 5", "4 feitas", "26 abertos"), e o corpo.
Estados comuns a todos: carregando (primeira vez, sem snapshot) = esqueleto do corpo em `--bg-raise-2`, sem animação de brilho
quando o movimento é reduzido; erro = `AlertTriangle` + a mensagem + "Tentar de novo" (`.btn.sm`), `role="alert"`; indisponível =
`CircleSlash` + "Esta fonte ainda não existe nesta versão."; não configurado = `Plug` + "Conecte <conector> para ver isto." + link.

| Tipo         | Composição                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Vazio                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `kpi`        | stat tile: rótulo em sentence case sem dois-pontos (12px `--text-dim`); valor 32px semibold, números proporcionais, compactado (1.284 / 12,9 mil); `of` como "/5" em 20px `--text-dim`; sparkline de até 30 pontos à direita (96×32px, linha 2px, histórico em `--chart-muted`, período atual em `--chart-mark`, ponto final 8px com anel de 2px da superfície, área em `--chart-mark-soft`); embaixo, o delta assinado ("↑ 15% na semana", "−1 hoje") em texto, com a cor pela direção × se subir é bom, e o selo (`chip`) | "Sem histórico ainda" no lugar do sparkline; valor `0` aparece como 0                                        |
| `checklist`  | linhas de 36px: caixa de seleção (editável só sob `memory/`; fora, desabilitada com `Lock` e a razão no `title`), o texto, o nome da nota em 12px, e à direita o selo de prazo: `danger` "Atrasada há N d", `warn` "Vence hoje", `info` "Amanhã", data curta depois; prioridade alta = `ChevronsUp` antes do texto                                                                                                                                                                                                          | "Nada com prazo para hoje." + "Como marcar um prazo" (abre a ajuda: `📅 AAAA-MM-DD` ou `[due:: AAAA-MM-DD]`) |
| `list`       | linhas de 44px: título 13px, subtítulo 12px `--text-dim` (data e origem), selo de estado à direita (`Decidido` ok com `Check`, `Aberta` warn com `CircleDot`, `No prazo` ok, `Atrasado` danger, `Vence hoje` warn, `Em revisão` info, `Pausado` neutro, `Executando` info com `Loader`), rótulo de natureza quando há                                                                                                                                                                                                       | texto por fonte: "Nenhuma decisão nesta semana.", "Nenhum projeto ativo." etc.                               |
| `table`      | cabeçalho 12px `--text-faint` em caixa alta pequena; linhas 40px; números com `tabular-nums` alinhados à direita; selos como em `list`; até 20 linhas, "Ver todas (N)" abre a origem                                                                                                                                                                                                                                                                                                                                        | "Nada para mostrar."                                                                                         |
| `bars`       | barras horizontais de até 24px de espessura, cantos de 4px na ponta do dado e retos na base, 2px de superfície entre barras, trilho em `--chart-muted` a 25%, barra em `--chart-mark`; rótulo da categoria à esquerda (13px), valor à direita da barra (13px `tabular-nums`) e, em funil (`ordered` + `funnel`), a conversão "46%" em 12px `--text-dim` numa coluna à parte; uma série, sem legenda                                                                                                                         | "Sem dados para comparar."                                                                                   |
| `agenda`     | linha do tempo vertical: hora em 13px `tabular-nums` numa coluna de 56px, título 13px, nota de preparo 12px `--text-dim` com o ícone do conector; o item atual ganha a barra de 2px `--chart-mark` à esquerda; itens passados em `--text-faint`                                                                                                                                                                                                                                                                             | "Agenda livre hoje."                                                                                         |
| `highlights` | ver a fileira de destaques                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | a fileira some                                                                                               |
| `note`       | um trecho de nota renderizado pelo renderizador único (`components/Markdown.tsx`), até 12 linhas, com "Abrir nota"                                                                                                                                                                                                                                                                                                                                                                                                          | "Esta nota está vazia."                                                                                      |

Interação (de `dataviz`): sparkline e barras têm alvo de toque maior que a marca; passar o ponteiro ou focar mostra um tooltip com o
valor primeiro e o rótulo depois, montado com `textContent`; `Esc` fecha; o tooltip nunca é o único caminho — "Ver como tabela"
(`Switch` no canto do cartão) troca o gráfico por uma tabela com os mesmos valores. Foco visível em toda linha clicável; `Enter` abre.

## Movimento

Só sob `prefers-reduced-motion: no-preference`: os números dos KPIs contam do valor anterior ao novo em 400 ms quando chega
`dashboard.refreshed`; as barras crescem da base em 300 ms na primeira pintura; a pastilha nova de destaque entra com 150 ms de
opacidade. Com movimento reduzido, tudo aparece no estado final. Nenhum estado depende de movimento para ser lido.

## Tela Hoje

Só uma mudança: quando existe um painel `overview`, o cabeçalho de Hoje ganha à direita o link "Ver a visão geral →" (12px,
`--accent-text`), que abre a página Painéis nesse painel. Os seis cartões não mudam (AD-005).

## HTML exportado

Uma página: o cabeçalho do painel (título, data, "Atualizado às HH:MM", fontes), os KPIs e os cartões na mesma ordem, gráficos em
SVG inline com as cores do tema claro, cada gráfico seguido da sua tabela, as citações dos painéis de pergunta, e no rodapé
"Exportado do MordomoOS em <data>". Sem script, sem fonte externa, sem imagem remota; todo texto escapado.

## Texto (as duas línguas; as chaves entram em `locales/dashboards.ts`, `en` e `ptBR` com as mesmas chaves)

| Chave                                                                                                 | pt-BR                                                                                    | en                                                                            |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `dash.nav`                                                                                            | Painéis                                                                                  | Dashboards                                                                    |
| `dash.greet.morning` / `afternoon` / `evening`                                                        | Bom dia / Boa tarde / Boa noite                                                          | Good morning / Good afternoon / Good evening                                  |
| `dash.kind.overview` / `area` / `question`                                                            | Visão geral / Contexto: {name} / Pergunta                                                | Overview / Context: {name} / Question                                         |
| `dash.updatedAt`                                                                                      | Atualizado às {time}                                                                     | Updated at {time}                                                             |
| `dash.updating`                                                                                       | Atualizando…                                                                             | Updating…                                                                     |
| `dash.stale`                                                                                          | Desatualizado — atualizado às {time}                                                     | Out of date — updated at {time}                                               |
| `dash.never`                                                                                          | Ainda sem dados                                                                          | No data yet                                                                   |
| `dash.refresh`                                                                                        | Atualizar                                                                                | Refresh                                                                       |
| `dash.export`                                                                                         | Exportar HTML                                                                            | Export HTML                                                                   |
| `dash.customize`                                                                                      | Personalizar                                                                             | Customize                                                                     |
| `dash.archive`                                                                                        | Arquivar painel                                                                          | Archive dashboard                                                             |
| `dash.new` / `dash.new.area` / `dash.new.question`                                                    | Novo painel / Painel de um contexto / Painel de uma pergunta                             | New dashboard / Context dashboard / Question dashboard                        |
| `dash.widget.error`                                                                                   | Não foi possível carregar.                                                               | Could not load.                                                               |
| `dash.widget.retry`                                                                                   | Tentar de novo                                                                           | Try again                                                                     |
| `dash.widget.unavailable`                                                                             | Esta fonte ainda não existe nesta versão.                                                | This source is not in this version yet.                                       |
| `dash.widget.notConfigured`                                                                           | Conecte {connector} para ver isto.                                                       | Connect {connector} to see this.                                              |
| `dash.widget.noHistory`                                                                               | Sem histórico ainda                                                                      | No history yet                                                                |
| `dash.widget.asTable`                                                                                 | Ver como tabela                                                                          | Show as table                                                                 |
| `dash.context.gone`                                                                                   | O contexto deste painel não existe mais.                                                 | This dashboard's context no longer exists.                                    |
| `dash.task.overdue` / `today` / `tomorrow`                                                            | Atrasada há {n} d / Vence hoje / Amanhã                                                  | {n} d overdue / Due today / Tomorrow                                          |
| `dash.task.readonly`                                                                                  | Fora de memory/: abra a nota para marcar.                                                | Outside memory/: open the note to check it.                                   |
| `dash.state.decided` / `open` / `onTrack` / `behind` / `dueToday` / `inReview` / `paused` / `running` | Decidido / Aberta / No prazo / Atrasado / Vence hoje / Em revisão / Pausado / Executando | Decided / Open / On track / Behind / Due today / In review / Paused / Running |
| `dash.unauthorised`                                                                                   | Este dispositivo não tem permissão para ver painéis.                                     | This device may not view dashboards.                                          |
| `dash.today.link`                                                                                     | Ver a visão geral →                                                                      | See the overview →                                                            |
| `dash.question.sources`                                                                               | Fontes                                                                                   | Sources                                                                       |
| `dash.question.how`                                                                                   | Como esta resposta foi feita                                                             | How this answer was made                                                      |
