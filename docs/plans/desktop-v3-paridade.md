# Paridade do protótipo v3 com o produto atual

13/09/2026 · gauntlet-loop · protótipo [`prototype/desktop-v3.html`](prototype/desktop-v3.html)

## Resposta curta

**Não, nada foi reimplementado.** `apps/command-centre` está intocado — nenhuma linha de
produção mudou nesta conversa. O protótipo é uma peça de decisão em HTML com dados falsos.

Quando você perguntou se tudo estava lá, a resposta honesta era **não**: faltavam Ajustes
inteiro, onboarding, configuração de provedores, paleta de comandos, o sino de
notificações, os controles do console e — o mais grave, porque você tinha reclamado disso
— o Segundo Cérebro tinha um canvas bonito e **zero** dos seus controles reais.

Levantei o inventário do código, achei as lacunas, corrigi as principais no protótipo e
listo abaixo o que ficou de fora.

## Inventário do produto × protótipo

### Rotas (12 no produto)
| Produto | Protótipo v3 |
|---|---|
| `/` desktop | ✅ o HUD |
| `/brain` | ✅ app com controles reais |
| `/skills` · `/skills/:slug` | ⚠️ grade e deck; **falta o formulário de entradas obrigatórias** |
| `/routines` | ⚠️ semana + disparar; **falta o editor de cron** |
| `/runs` · `/runs/:id` | ✅ app de execuções + trace como painel |
| `/connectors` | ✅ app |
| `/pixel` | ⚠️ painel-esqueleto |
| `/artifacts` | ✅ app com busca e filtros |
| `/generations` | ⚠️ grade; **falta a ação de gerar** |
| `/settings` | ✅ app com as 10 abas |

### Abas de Ajustes (10 no produto)
Identidade · Tema · Provedores · Memória · Desktop · Segurança · Notificações · Tendências ·
Backups · Diagnóstico — **todas presentes** no app de Ajustes, cada uma com campos reais
(alternadores, segmentos, cores de destaque, perfil de renderização, pastas permitidas).

### Provedores (Claude · Cursor · Codex)
✅ Aba Provedores com os três, estado por provedor (`PRONTO` / `SEM LOGIN` / `AUSENTE`),
alternador de padrão e ação contextual (tornar padrão / instalar). ✅ Também trocável pelo
console (`● Claude`), que atualiza a faixa ambiente.

### Onboarding (5 passos no produto)
✅ Os cinco: provedores → identidade → pastas → conectar dados → montar HUD. Com barra de
progresso, voltar/avançar/pular. Acessível pela paleta e pela aba Provedores.

### Segundo Cérebro
Era a maior lacuna. Agora o app tem, e **funcionando de verdade**:
busca por nó · 5 disposições (arcos, força, círculo, hex, anéis) que reposicionam o grafo
com interpolação · 2 visões (áreas / pastas) que trocam a cor · 4 filtros de aresta ·
modo local (isola o nó selecionado e seus vizinhos) · linha do tempo que filtra por idade ·
zoom por roda (30 %–900 %) · deslocamento por arrasto · rótulos que aparecem no hover e
acima de 210 % · duplo clique traz o arquivo para o palco.
Além disso o **campo de fundo** continua sendo o cérebro vivo, com hover e clique.

Faltam: minimapa, grupos de consulta salvos, bake/higiene, painel de pré-visualização lateral.

### Contexto do agente
✅ Bandeja com um chip por painel aberto · `@` com autocomplete · amarra tracejada do
console até cada painel citado · botão `@` no cabeçalho de cada painel · o resultado de uma
execução abre como painel e entra na bandeja.
✅ Controles do console: modo **somente leitura / escrita**, pasta de execução, modelo ·
esforço, provedor, nova conversa, contador de turnos e custo.

### Navegação
✅ Paleta de comandos `⌘K` (e `/`) com apps, ações, skills, arquivos e execuções — cobre
reindexar, backup, diagnóstico, alternar tema, refazer onboarding, editar HUD, visão geral.
✅ Sino de notificações com contador. ✅ Espaços. ✅ Dock com painéis abertos.

## Defeitos encontrados e corrigidos nesta passagem

1. **`Tab` sequestrado para a visão geral** (alto, acessibilidade). Nenhum pod, painel ou
   botão do dock era alcançável por teclado. `Tab` voltou a ser navegação; a visão geral
   migrou para `\`, a paleta para `⌘K` / `/` e o deck para `⌘J`.
2. **Paleta inerte ao perder o foco** (médio). Sem fundo clicável e com o teclado preso ao
   campo: se o foco escapasse, setas e Enter paravam de funcionar. Agora o teclado é
   tratado na captura do documento e clicar fora fecha.
3. **Glifo `undefined`** (baixo) na bandeja e no dock para tipos de painel novos. O mapa
   virou um `Proxy` com valor de reserva.
4. `#stage` sem regra de posição (corrigido antes): altura zero quebrava toda a matemática
   de colocação.

## Segunda passagem: lacunas fechadas

Tudo o que a lista anterior marcava como faltando no protótipo, menos uma coisa:

- **formulário de entradas obrigatórias de skill** — `/code-review`, `/pixel-icon` e
  `/brainstorm` abrem formulário em vez de executar; executar vazio bloqueia, marca o campo
  e anuncia o erro; preenchido, dispara o trace;
- **editor de cron das rotinas** — horário, dias e ativa/pausada, com pré-visualização do
  cron atualizando ao vivo (`15 04 * * 1,2,3,4,5,0`), validação de `HH:MM` e a lista do app
  refletindo o que foi salvo;
- **Pixel Studio** — editor 16×16 que pinta de verdade, paleta, apagar, limpar e salvar,
  que insere o arquivo em Artefatos;
- **Gerações** — campo de prompt, estado de carregamento e a imagem entrando na grade;
- **tema claro** — tokens espelhados de `theme.css`, trocado pela aba Tema, com as duas
  telas de canvas lendo as cores do tema por `MutationObserver` (no claro a constelação é
  desenhada com tinta, não com brilho — repetir as cores do escuro a tornava invisível);
- **cor de destaque** — as seis predefinições reais, aplicadas ao vivo;
- **minimapa e grupos salvos do cérebro** — minimapa com o retângulo do que está à vista,
  grupos aplicáveis, criáveis e removíveis, e "reiniciar" devolvendo tudo ao padrão;
- **acessibilidade** — região `aria-live` anunciando execuções, foco preso nas camadas
  modais com devolução ao fechar, `Esc` fechando o painel em foco, painéis como `region`
  com rótulo e `:focus-visible` visível.

**Não fiz i18n `en` no protótipo.** O produto já resolve isso com 452 chaves em
`locales/desktop.ts` e teste de paridade entre dicionários; repetir o mecanismo numa peça
de decisão não informaria nada. É trabalho de tradução na implementação, não de projeto.

## O que continua faltando — e é deliberado

- formulário de entradas obrigatórias de skill; editor de cron das rotinas; editor do Pixel;
  ação de gerar imagem; restaurar backup de verdade; verificação de atualização;
- tema claro e `en` (o protótipo é escuro e pt-BR);
- foco preso em modais, `aria-live` para estado de execução, travessia completa por teclado;
- minimapa, grupos salvos e bake do cérebro.

Nada disso muda a decisão de arquitetura — são superfícies conhecidas que entram na
implementação. Presets de layout, popover de configuração por widget e galeria de widgets
**não** voltam: foram substituídos por "Editar HUD", por decisão sua de eliminar a grade.

## Evidência

Verificado no navegador a 1440×900, sem erros de console: paleta abrindo e filtrando;
pods abrindo apps; abas de Ajustes trocando conteúdo; provedores renderizando os três
estados; disposição do cérebro mudando de `arcos` para `hex` com a contagem de arestas
acompanhando; bandeja e dock com glifo correto; distribuir organizando os painéis.

Não executado: suíte do projeto (`vitest`, Playwright) — o protótipo não faz parte dela.
Nenhum teste de produção foi alterado, porque nenhum código de produção foi tocado.

## F1 entregue — primeira mudança em produção

Arquivos novos: `desktop/signal.ts`, `desktop/signal.test.ts`,
`desktop/WidgetLayer.surface.test.tsx`.
Alterados: `desktop/registry.tsx`, `desktop/WidgetLayer.tsx`, `desktop/index.tsx`,
`desktop/budget.ts`, `desktop/budget.test.ts`, `desktop/registry.test.ts`.

**O contrato de sinal** (`signal.ts`) é puro e define, num lugar só, o que merece cor:
`idle` nunca acende, `warn` e `critical` acendem. Cada derivação carrega a decisão de
produto — pulso abaixo de 50 % avisa e abaixo de 25 % alarma; execução em voo é informação,
nunca alarme, porque o usuário a iniciou; rotina que venceu e não disparou é o único caso
interessante; aprovação pendente distingue-se de e-mail não lido; provedor instalado sem
login distingue-se de ausente, porque o desktop prometia prontidão e a execução falharia no
envio. `costSignal` reaproveita `budgetState` para a faixa e o widget não poderem discordar.

**O contrato de superfície** (`registry.tsx`) acrescenta `hasSurface` e `surfaceMin`.
`today: hasSurface: false` — a hora é o dado inteiro. Consequência visível: o frame deixa
de desenhar o botão de expandir do relógio, provado por teste de componente no frame real,
não na flag.

### Bug de produção encontrado pelo teste

`budgetState(3, 2.40)` devolvia `ok` em vez de `warn`. Em ponto flutuante binário
`2.4 / 3 = 0.7999999999999999`, então `>= 0.8` era falso: um orçamento diário de US$ 3,00
com US$ 2,40 gastos **pulava o aviso de 80 %** — exatamente o aviso que a funcionalidade
existe para dar. O teste antigo só usava `10 / 8`, que é exato em binário, e por isso nunca
pegou. Corrigido com épsilon bem abaixo de um centavo, com regressão que fixa o caso.

### Gates

| Gate | Resultado |
|---|---|
| `npm test` (raiz) | 62 arquivos · 491 testes · passou |
| `npm run test -w apps/command-centre` | 43 arquivos · 286 testes · passou |
| `npm run typecheck` | limpo |
| `npx eslint .` | limpo |
| `prettier --check` | limpo |

Não executado: Playwright (`npm run test:e2e`) — precisa do serviço em execução; os
cenários de desktop que ele cobre não foram alterados por esta mudança (o botão de expandir
do relógio não aparece em nenhum spec).

## F2 entregue — a superfície em janela

Arquivos novos: `desktop/Surface.tsx`, `desktop/surfaceSize.ts`, `desktop/surfaceSize.test.ts`.
Alterados: `desktop/WidgetLayer.tsx`, `desktop/index.tsx`, `desktop/desktop.css`,
`desktop/WidgetLayer.surface.test.tsx`, `tests/e2e/desktop-regressions.spec.ts`.

O `maximized` antigo escondia todos os irmãos com `visibility: hidden` e esticava um widget
sobre a tela inteira. A superfície abre **sobre** o desktop: o véu desfoca o que está atrás
em vez de apagar, e o painel é dimensionado por `surfaceBox` — um múltiplo limitado
(`GROW = 1.6`) do mínimo que o widget declarou. O Pulso abre em 672×544 num monitor de
1440×900, não em 1400×704.

É um diálogo de verdade, reaproveitando o `useDialog` que o resto do app já usa: portal
para fora da casca, `inert` em tudo atrás, foco preso e devolvido, `Escape` e clique no véu
fechando. Assim a superfície não pode divergir do comportamento modal do produto.

O corpo **muda de lugar**, não é montado duas vezes: enquanto expandido, a célula da grade
fica sem corpo e o widget vive na superfície. Um segundo console montado em paralelo
disputaria o rascunho e a sessão.

O critério original do plano era "no máximo 35 % de área vazia". Troquei por um verificável:
**a superfície nunca passa do teto declarado pelo widget em nenhum eixo**. Medir vazio
renderizado exigiria um motor de layout que o jsdom não tem, e eu não ia afirmar uma medição
que não fiz. O teto é a causa do vazio; limitá-lo é o que resolve.

### Defeitos encontrados nesta passagem

1. **Colisão de maiúsculas** entre `Surface.tsx` e `surface.ts` no filesystem do macOS,
   pega pelo `tsc`. O módulo puro virou `surfaceSize.ts`, em paralelo ao `widgetSize.ts`.
2. **Estado vazio no topo da superfície** — o print do Pulso sem execuções mostrava o
   cartão colado no topo com ~380 px de vácuo: exatamente o defeito que a superfície existe
   para evitar. Um estado vazio sozinho agora se centraliza no espaço que recebeu.
3. **Asserção instável** no e2e: a largura ao restaurar é lida durante o FLIP de 200 ms.
   Medi em vez de adivinhar — 813,33 px antes e depois, idênticos — e passei a usar `poll`.
4. **Dependência de ordem pré-existente na suíte e2e** (não causada pelo F2): o teste que
   esconde o widget `now` deixava o layout sujo no home compartilhado, e `objective-engine`
   depois não achava o painel Now. Reproduzido isolando o par. O teste agora devolve o
   desktop à composição padrão ao terminar.

### Gates

| Gate | Resultado |
|---|---|
| `npm test` (raiz) | 62 arquivos · 491 testes · passou |
| `npm run test -w apps/command-centre` | 44 arquivos · 296 testes · passou |
| `npx playwright test` (suíte inteira) | 99 passaram · 2 pulados · 0 falhas · 4,6 min |
| `npm run typecheck` | limpo |
| `npx eslint .` | limpo |
| `prettier --check` | limpo |

Evidência visual: `test-results/f2-superficie.png` — o Pulso expandido em 672×544, desktop
desfocado atrás, estado vazio centralizado.

## F3 entregue — faixa ambiente e trilho de apps

Arquivos novos: `desktop/AmbientStrip.tsx`, `desktop/AmbientStrip.test.tsx`,
`desktop/AppRail.tsx`, `desktop/appRows.tsx`.
Removido: `desktop/HudTelemetry.tsx` (e o CSS que só ele usava).
Alterados: `desktop/index.tsx`, `desktop/WidgetLayer.tsx`, `desktop/defaultLayout.ts`,
`desktop/signal.ts`, `desktop/desktop.css`, `theme.css`,
`widgets/MicroAppsWidget.tsx`, `tests/e2e/desktop-regressions.spec.ts`,
`tests/e2e/product-workflows.spec.ts`.

**É a primeira fase que muda a tela ao abrir o app.**

### A faixa ambiente
`HudTelemetry` imprimia todo número no mesmo cinza: 23 % de sucesso e o relógio tinham o
mesmo peso, e nada lia como urgente. A faixa usa os `SignalValue` da F1 — `idle` fica
apagado, só `warn` e `critical` tomam cor. Com dois runs falhos e uma rotina doente, o
desktop acende **uma** coisa: `NEEDS ATTENTION 2` em âmbar. O resto permanece morno.

As leituras que têm widget são botões: pressionar abre a superfície daquele widget, então a
faixa é entrada e não rótulo. Para isso o estado de expansão subiu para o `Desktop`, e o
`WidgetLayer` passou a aceitá-lo de fora (com os callbacks lidos por ref, senão um
`onExpandedChange` inline fecharia a superfície a cada render do pai).

`attentionItems` entrou no `signal.ts` para que a faixa e o widget não possam divergir —
mesma disciplina de `costSignal` reusar `budgetState`. A faixa nunca dirá 3 enquanto o
painel lista 2.

### O trilho de apps
Cinco colunas permanentes da grade para quatro links usados umas poucas vezes por sessão
eram o caso mais claro de espaço gasto com algo que não é estado. O trilho custa uma
espinha luminosa até você ir até ele. Conector não configurado vira pip âmbar na espinha
fechada — a única informação do bloco antigo que merecia espaço permanente.

Abrir não é só hover: foco abre também, e há um botão com `aria-expanded`, para o teclado e
o toque não serem cidadãos de segunda. `useAppRows` é a fonte única do trilho e do widget
legado, que continua registrado para quem o trouxer de volta pela galeria.

### A composição padrão
Micro apps sai de visível. A coluna da esquerda passa a ser Hoje (10 linhas — tem conteúdo
para elas), Workspace (5) e Custo (5, antes escondido). Esticar o Workspace sobre as linhas
livres deixava um widget com uma barra e 200 px de nada: o mesmo defeito que a F2 existe
para remover. `isLegacyDefault` reconhece a composição anterior, para quem nunca rearranjou
nada receber a nova em vez de ficar com o trilho e o bloco ao mesmo tempo.

### Defeitos encontrados nesta passagem

1. **A faixa era inclicável.** `.desktop-depth` é `pointer-events: none` com os filhos
   liberados um a um; as leituras não estavam na lista.
2. **A barra superior engolia os cliques.** `.os-topbar .side` ocupa a altura toda da linha
   e é quase vazia, mas capturava tudo — invisível enquanto a faixa era só texto, fatal
   quando virou botão. Agora a coluna é transparente ao ponteiro e só os filhos recebem.
3. **Supressão de lint em vez de causa.** O `setMaximized` controlado ia levar um
   `eslint-disable`; a causa era identidade instável. Passou a ser lido por ref, é estável
   de verdade e entra na lista de dependências sem supressão.
4. **Asserção vazia** em `product-workflows`: verificava que micro apps some no modo foco —
   com ele escondido por padrão, passaria pelo motivo errado. Trocada por `today`.

### Gates

| Gate | Resultado |
|---|---|
| `npm test` (raiz) | 62 arquivos · 491 testes |
| `npm run test -w apps/command-centre` | 45 arquivos · 304 testes |
| `npx playwright test` (suíte inteira) | 100 passaram · 2 pulados · 0 falhas · 4,6 min |
| `typecheck` · `eslint` · `prettier` | limpos |

Evidência visual: `artifacts/f3-desktop.png` e `artifacts/f3-trilho.png`.

## Legado removido

Pedido em 13/09, já que o app não foi para produção: saíram `isLegacyDefault`, o aviso de
"nova composição" com seu CSS e suas seis chaves de i18n, os testes associados e a migração
da chave antiga do rascunho do console. Cerca de 5 KB que só existiam para um passado que
não aconteceu.

## F4a entregue — o modelo de janela

Arquivos novos: `desktop/windowModel.ts`, `desktop/windowModel.test.ts`,
`desktop/defaultWindows.ts`, `desktop/defaultWindows.test.ts`, `desktop/useWindowLayout.ts`,
`desktop/useWindowDrag.ts`, `tests/e2e/desktop-windows.spec.ts`.
Removidos: `desktop/useGridLayout.ts`, `desktop/dragReducer.ts` e três suítes de teste da
grade (~700 linhas).
Alterados: `core/src/config/schema.ts`, `desktop/WidgetLayer.tsx`, `desktop/index.tsx`,
`desktop/defaultLayout.ts` (reduzido a identidade e ordenação), `desktop/registry.tsx`,
`AddWidgetGallery`, `LayoutPresets`, `views/Setup.tsx`, `views/Settings.tsx`, `api.ts`,
`theme.css`, `desktop.css` e cinco specs e2e.

**A grade acabou.** Uma janela tem posição em pixels e ordem de empilhamento, pode
sobrepor as vizinhas, é arrastada pela barra de título **a qualquer momento** — o modo de
edição deixou de ser pré-requisito para mexer no próprio desktop e ficou só com o que é
realmente edição do *conjunto*: a engrenagem por widget e a galeria.

Encostar numa borda encaixa em meia tela ou tela cheia, com pré-visualização. Tocar numa
janela a traz para a frente. Arrastar com as setas do teclado continua funcionando.

A persistência mudou de células para pixels no esquema do core. Como pixels dependem da
tela, `clampIntoStage` puxa tudo de volta quando a janela do app encolhe — e um
redimensionamento **nunca** persiste: reduzir a janela não pode reescrever o arranjo feito
num monitor maior.

A composição padrão é declarada em **frações** do palco e materializada em pixels na
primeira abertura, então um laptop de 1280 e um monitor de 2560 abrem ambos compostos.

### Defeitos encontrados nesta passagem

1. **O `z` era desfeito pelo próprio arrasto.** O box capturado no pointerdown carregava a
   ordem *anterior* ao raise, e o commit final o espalhava inteiro. Só a geometria é
   commitada agora.
2. **A janela ficava 0 × 0 depois de arrastar.** O `up()` limpava `width`/`height` inline,
   mas quem os escreveu foi o React, pelo mesmo objeto de estilo — e um movimento que não
   muda o tamanho não gera diff, então o React não os reescrevia.
3. **Arrastar selecionava o texto do desktop.** `user-select: none` no `body` não alcança
   descendentes que declaram o seu.
4. **O trilho abria sob o ponteiro no meio do arrasto**, justamente na borda onde se encaixa
   à esquerda.
5. **O palco crescia com uma janela estacionada na borda**, dando rolagem horizontal à
   página — e o palco medido a partir dela crescia junto, fazendo a composição padrão em
   frações depender de onde estava a última janela.
6. **As janelas passavam por cima da faixa ambiente**, que é chrome: com ordem de
   empilhamento própria, uma janela engolia o clique na leitura de atenção.
7. **O palco começava debaixo do chrome**, então uma janela podia ser estacionada sob a
   barra superior que cobria sua própria barra de título. Agora o palco é a área utilizável.
8. **Mínimo incoerente**: `attention` declarava altura menor que o piso global. Um teste
   agora impede que qualquer mínimo por widget fique abaixo dele.

### Sobre os testes e2e

Três specs quebraram por **acoplamento de estado**, não por regressão: o layout do desktop é
estado de servidor compartilhado, e specs que o rearranjam vazavam para os seguintes. Cada
um passou a ser dono do próprio fixture. O spec de janelas foi para arquivo próprio e
devolve o layout **depois** de desmontar o app, porque o desmonte descarrega uma gravação
pendente que desfaria a devolução.

Duas asserções minhas mediam no meio de transições de 200 ms — medi os valores reais
(813,33 px idênticos antes e depois; 497 exatamente entre 300 e 702) antes de trocar por
`expect.poll`, em vez de afrouxar o teste no escuro.

### Gates

| Gate | Resultado |
|---|---|
| `npm test` (raiz) | 62 arquivos · 491 testes |
| `npm run test -w apps/command-centre` | 44 arquivos · 308 testes |
| `npx playwright test` (suíte inteira) | 101 passaram · 2 pulados · 0 falhas |
| `typecheck` · `eslint` · `prettier` | limpos |

Evidência visual: `artifacts/f4-desktop.png` e `artifacts/f4-sobreposta.png`.

## F4b entregue — a câmera e o fim do icosfério

Removidos: `desktop/Wallpaper.tsx` (837 linhas), `desktop/icosphere.ts`,
`desktop/ringChips.ts` e seus testes, mais o CSS do anel e do núcleo em `desktop.css` e
`theme.css` (~10 KB). Novo: `desktop/AgentPresence.tsx` (18 linhas).
Alterados: `desktop/windowModel.ts` (`overviewSlots`), `desktop/WidgetLayer.tsx`,
`desktop/index.tsx`, `desktop/ArtifactSearch.tsx`, `desktop/coreState.ts`,
`locales/desktop.ts`, `theme.css`, `desktop.css`, `tests/e2e/desktop-windows.spec.ts`.

**O anel saiu.** Ele orbitava arquivos ao redor de uma esfera e, ao clicar, navegava para
fora do desktop — decoração com nome de arquivo. A única coisa insubstituível que o
icosfério fazia era dizer sem palavras que o agente estava ocupado; isso virou
`AgentPresence`: um respiro quente atrás do console, um elemento e nenhum canvas, movido só
por CSS a partir de `data-core`. Um desktop ocioso não paga nada por ele.

**A busca ganhou uma lista.** Ela destacava chips no anel; sem anel, os resultados agora são
uma lista legível com título e caminho, e escolher um abre o mesmo modal de detalhe.

**A câmera afasta.** `\\` ou o botão do telescópio dispõe todas as janelas abertas numa
grade, cada uma escalada para caber na própria célula — **nunca ampliada**, para a visão
geral ser um mapa do desktop e não uma distorção dele. Escolher uma volta ao desktop e a
traz para a frente. É um movimento de câmera, não de layout: as caixas reais não mudam, só
a transformação, então sair não tem nada a desfazer.

### O defeito que estava escondido desde a F4a

A visão geral não funcionava, e investigar por quê revelou algo maior: **arrastar uma janela
não a movia na tela**. Ela só saltava para o lugar ao soltar.

`.desktop .widget.enter-fade-up` usava `animation: fade-up … both`, e a classe fica no
elemento para sempre. Com `fill-mode: both` o último quadro — `transform: none` — continua
aplicado depois que a animação termina, e **um valor de animação vence o estilo inline**.
Todo `transform` escrito pelo arrasto ou pela câmera era anulado.

Os testes não pegaram porque todos verificavam a caixa *final*, que sempre ficou certa: o
`left`/`top` não são animados. Passou a haver um teste que mede a janela **no meio do
arrasto**, antes de soltar.

O FLIP tinha o mesmo conflito: escreve `transform` direto no elemento, no mesmo canal do
React, que não reescreve um estilo cujo valor não mudou. Ele agora se desliga enquanto a
câmera está afastada.

### Uma asserção que passava por acaso

Meu primeiro teste da visão geral verificava que nada se sobrepõe. A composição padrão
**já** não se sobrepõe, então ele passava com a câmera completamente quebrada. Trocado por
uma asserção que exige escala aplicada e janelas efetivamente menores.

Também troquei um `expect.poll(...).not` que rodou 48 minutos antes de falhar: um poll
negado repete até passar, então uma expectativa errada trava em vez de falhar.

### Gates

| Gate | Resultado |
|---|---|
| `npm test` (raiz) | 62 arquivos · 491 testes |
| `npm run test -w apps/command-centre` | 42 arquivos · 297 testes |
| `npx playwright test` (suíte inteira) | 104 passaram · 2 pulados · 0 falhas |
| `typecheck` · `eslint` · `prettier` | limpos |

Evidência visual: `artifacts/f4b-desktop.png` e `artifacts/f4b-overview.png`.

## F5 entregue — o contexto do console

Arquivos novos: `desktop/DocWindow.tsx`, `desktop/widgets/promptRefs.test.ts`,
`tests/e2e/desktop-context.spec.ts`.
Removido: `ArtifactModal` (virou beco sem saída).
Alterados: `desktop/defaultWindows.ts`, `desktop/actions.tsx`, `desktop/index.tsx`,
`desktop/widgets/PromptWidget.tsx`, `desktop/ArtifactSearch.tsx`, `desktop/consoleDraft.ts`,
`desktop/desktop.css`, `locales/desktop.ts`, `tests/e2e/desktop-windows.spec.ts`.

### A decisão que define a fase

Uma referência só vale se o agente puder segui-la. Um widget é interface — apontar para
`@pulso` seria apontar para um gráfico. Um **documento** tem caminho. Então a F5 introduziu
a **janela de documento**: um arquivo no palco, com id `doc:<caminho>`, que arrasta,
redimensiona, empilha, entra na visão geral e persiste como qualquer outra janela.

De onde elas vêm:
- **da busca** — escolher um resultado põe o arquivo no palco, em vez de um modal que
  fechava consigo mesmo;
- **do agente** — quando uma execução do console termina com artefato, ele abre sozinho.
  Esse é o momento de pagamento da promessa: o que o agente acabou de fazer está na sua
  frente e já é referenciável.

### O laço fechado
Bandeja de contexto com um chip por documento aberto; clicar escreve `@nome` no rascunho.
Digitar `@` lista os documentos e `Tab` completa — sem atrapalhar o `/` das skills, porque
enquanto uma referência está sendo digitada o `Tab` pertence a ela. No envio,
`resolveReferences` acrescenta os caminhos: **o usuário vê um nome, o modelo recebe o
arquivo.**

### Defeitos encontrados nesta passagem

1. **O chip não inseria nada com o prompt vazio.** `completeReference` só substituía uma
   referência parcial no cursor; um clique no chip não é uma conclusão, é um acréscimo.
2. **Caminho embaralhado.** `direction: rtl` põe as reticências no início (bom, para o nome
   do arquivo sobreviver) mas reordena a barra: `/tmp/a.md` aparecia como `tmp/a.md/`.
   `unicode-bidi: plaintext` deixa o texto decidir a própria direção.
3. Uma expectativa minha estava errada, não o código: `@.md` filtrar por substring é o
   comportamento certo. Corrigi o teste, não a função.

### Gates

| Gate | Resultado |
|---|---|
| `npm test` (raiz) | 62 arquivos · 491 testes |
| `npm run test -w apps/command-centre` | 43 arquivos · 310 testes |
| `npx playwright test` (suíte inteira) | 106 passaram · 2 pulados · 0 falhas |
| `typecheck` · `eslint` · `prettier` | limpos |

Evidência visual: `artifacts/f5-contexto.png`.

### O que ficou de fora, e por quê
As **amarras** — a linha animada do console até o painel citado — não entraram. São efeito
visual sobre um laço que já funciona e já é visível pela bandeja; entram junto da F6, se
ainda parecerem valer o custo depois de você usar isto.

## As amarras

Entraram depois de tudo: a curva tracejada do console até cada janela citada. Sai do meio da
borda superior do console e chega na borda da janela voltada para ele, nunca no meio dela.

Desenhada **por cima** das janelas. Por baixo ela ficava escondida por qualquer coisa entre
o console e o alvo — que é quase sempre. Uma linha de 1 px a meia opacidade lê como um feixe
sem esconder nada.

## F6 entregue — espaços nomeados

Arquivos novos: `desktop/spaces.ts`, `desktop/spaces.test.ts`.
Alterados: `core/src/config/schema.ts`, `api.ts`, `components/Workspace.tsx`,
`desktop/index.tsx`, `desktop/WidgetLayer.tsx`, `desktop/useWindowLayout.ts`,
`brain/PreviewPanel.tsx`, `onboarding/Onboarding.tsx`, `onboarding/copy.ts` e cinco specs.

Os modos `overview` / `focus` / `explore` **saíram**. Eles só mexiam em opacidade: sair de um
e voltar perdia o que você tinha arrumado. Um espaço guarda as próprias janelas — trocar é
pôr um contexto de trabalho no chão e pegar outro.

O dock traz Trabalho · Pesquisa · Ops. A troca é feita pelo desktop, não pelo dock, porque o
desktop tem o layout ao vivo — incluindo um arrasto que o debounce ainda não persistiu.

### Defeitos encontrados nesta passagem

1. **Efeito que se limpava sozinho.** O reset da expansão usava uma chave que continha o
   próprio `maximized`: abrir uma superfície mudava a chave, que disparava o efeito, que a
   fechava. A superfície nunca abria. O reset foi para onde pertence: a troca de espaço.
2. **Estado obsoleto.** Eu lia o mapa de espaços das settings, que ainda não tinham refeito
   o fetch depois do PUT anterior — a segunda troca recriava o espaço deixado a partir dos
   padrões, perdendo o arranjo que a troca deveria ter salvo. Agora há uma cópia local.
3. **Trocar de espaço de dentro de outro app não fazia nada.** O dock navega para casa e
   despacha o evento, mas o desktop ainda não montou para ouvi-lo. O pedido fica guardado e
   é drenado quando o desktop sobe.
4. **Asserção de e2e boa demais.** O tour garantia "nenhuma escrita na API"; trocar de espaço
   persiste. Estreitei para "nada de runs, skills ou rotinas" em vez de afrouxar de vez.

## F7 entregue — a camada visual do protótipo

Este é o F que não estava no plano, e o único que veio de você rodar o sistema: *"o app que
rodou, o layout e a proposta não tem nada a haver com o plano e protótipo que me mostrou"*.
Estava certo. Do protótipo aprovado, F1–F6 entregaram o **comportamento** — janelas, câmera,
contexto, espaços — e nada da **linguagem visual**. E havia um motivo concreto: o
`defaultWindows.ts` reproduzia a grade de três colunas de propósito, com um comentário
chamando isso de virtude — *"nothing about the first impression changes"*. Cada moldura nova
foi pendurada no mesmo dashboard de nove painéis que o redesenho existia para substituir.

Arquivos novos: `desktop/DesktopPods.tsx`, `desktop/LivingField.tsx`,
`desktop/fieldPoints.ts` (+ teste), `desktop/SkillDeck.tsx` (+ teste),
`desktop/FirstRunHint.tsx`, `tests/e2e/stage.ts`.
Apagados: `desktop/AmbientStrip.tsx` (+ teste), `desktop/AppRail.tsx`.

### Os pods

A faixa ambiente provou a regra — `idle` nunca acende — mas manteve a forma errada: uma
linha de números no topo, que é o que o dashboard já era. Os instrumentos viraram hexágonos
em dois arcos: apps à esquerda, leituras à direita. Um pod dá corpo à mesma leitura — glifo,
um valor, um contador quando há pendência — então um relance na borda responde "alguma coisa
precisa de mim?" sem ler nada. Os níveis continuam vindo de `signal.ts`, então um pod e o
painel atrás dele não podem discordar.

### O deck radial

"Onde eu aciono uma skill?" era a primeira pergunta que o desktop não respondia, e uma lista
rolável dentro de um card não era a resposta. O arco abre sobre o console — onde a mão já
está quando você vai pedir alguma coisa — e fecha no instante em que uma é escolhida. É um
diálogo de verdade: renderiza fora da casca para que a casca possa ficar `inert`, e o
`useDialog` dá Escape, focus trap e devolução de foco. Três entradas, porque uma skill nunca
deve estar a mais de um gesto: o pod de skills, `⌘J` (que funciona de dentro do console, por
isso mantém o modificador) e a paleta. O que não cabe no arco **não some**: o último assento
diz quantas sobraram e as entrega à página de skills.

### O palco abre limpo

O padrão agora é o console sozinho. Toda outra janela chega quando um pod, o dock ou o agente
a coloca lá — e é posicionada com `placeNew` contra o que está realmente aberto, não no canto
que uma composição antiga escolheu para ela. As frações do `DEFAULT_SPECS` continuam
existindo, mas passaram a ser **destino**, não primeira impressão.

### O chão vira o workspace

O campo desenhava um ponto por arquivo indexado, e numa máquina real isso deu três pontinhos
apagados. A correção não foi inventar pontos — foi desenhar tudo o que o OS de fato sabe:
skills, rotinas e execuções recentes são memória tanto quanto os arquivos. Uma run que falhou
ou uma rotina doente **queima** em vez de brilhar, então o chão carrega o mesmo aviso que os
pods. Uma linha acima dele nomeia os gestos uma vez e se aposenta — no timer e no primeiro
gesto de verdade.

### Defeitos encontrados nesta passagem

1. **Quadro perdido em aba oculta.** Uma aba carregada em segundo plano não recebe animation
   frames, então esperar o `requestAnimationFrame` deixava o chão em branco até a aba ganhar
   foco pela primeira vez. O primeiro quadro passou a ser pintado de forma síncrona.
2. **`ResizeObserver` apagando o próprio quadro.** Atribuir `canvas.width` limpa o canvas
   **mesmo quando o valor não muda**, e o observer dispara uma vez no instante em que começa
   a observar — apagando exatamente o quadro recém-pintado. Agora só redimensiona quando o
   tamanho muda de fato, e repinta quando muda.
3. **Campo agarrado no lugar da janela.** Uma spec pegava a barra de título logo após o
   reload e o ponteiro caía no canvas atrás: a janela ainda estava animando para o lugar.
   Virou um helper `settled()` que espera duas leituras iguais, em vez de um `waitForTimeout`
   no escuro.
4. **Colisão do pod com o console.** O primeiro `onExpand` reusava a caixa guardada, escolhida
   para outra composição — `attention` (fy 0.85, centro) caía em cima do console ancorado.
   Daí o `placeNew`.
5. **Fixture e2e que semeava nada, em silêncio.** O schema degrada um layout ilegível para
   `{}` em vez de lançar (a correção que impediu o serviço de cair). Uma entrada parcial no
   fixture, portanto, não semeava nada e não avisava. O `stage.ts` escreve caixas completas e
   lê de volta o que gravou.

### Sobre as specs que quebraram

Nove specs falharam ao abrir o palco limpo, e todas pelo mesmo motivo honesto: assumiam os
nove painéis do default antigo. Cada uma passou a declarar a composição de que precisa. Duas
asserções mediam propriedades do default e não do comportamento — "algo encolheu na visão
geral" passava porque as janelas padrão eram grandes; agora a spec semeia um palco lotado de
propósito, que é para isso que a câmera existe.

## Revisão final

Uma varredura no arco inteiro F1–F6 encontrou **código especulativo meu**: `tile`, `cascade`,
`normalizeZ`, `freeRegion`, `pulseSignal`, `inboxSignal`, `connectorsSignal`,
`providerSignal`, `mostSevere` e `signalRank` — escritos e nunca usados.

Resolvido caso a caso, não em bloco:
- **Ligados** porque têm valor real: `tile` e `cascade` viraram ferramentas de arranjo no
  topo; `normalizeZ` passou a compactar a ordem de empilhamento na leitura, senão uma sessão
  longa persiste inteiros que só crescem; `pulseSignal` entrou na faixa ambiente — a taxa de
  sucesso era justamente a leitura que motivou tudo isto.
- **Apagados** porque o produto não precisa deles: `freeRegion` (morreu com o papel de
  parede), `providerSignal` e `connectorsSignal` (duplicavam o que a barra e o trilho já
  faziam), `inboxSignal`, `mostSevere` e `signalRank`.

Também saíram 20 chaves de i18n órfãs dos modos, do explorar e do anel. Restam 12 órfãs
pré-existentes, de antes deste trabalho.

### Gates finais (após F7)

| Gate | Resultado |
|---|---|
| `npm test` (raiz) | 62 arquivos · 492 testes |
| `npm run test -w apps/command-centre` | 44 arquivos · 334 testes |
| `npx playwright test` (suíte inteira) | 108 passaram · 0 falhas |
| `typecheck` · `eslint` · `prettier` | limpos |

Os números de F1–F6 acima ficaram como estavam: são o registro daquele momento, não uma
contagem viva.

## Pacote para macOS

O `release/MordomoOS-0.8.0-macos-arm64.zip` que está no disco é **anterior ao F7** — foi
gerado e verificado no fim do F6, e não contém os pods, o deck, o campo nem o palco limpo.
Reempacotar está pendente de propósito, esperando o aceite visual.

O que a verificação do pacote de F6 estabeleceu, e que continua valendo como método: extrair
com `ditto` (não `unzip`), conferir a assinatura com `codesign`, subir numa porta e num home
isolados — **nunca** rodar o `.app` de verdade durante o teste, porque ele abre o navegador e
se acopla a qualquer coisa que responda na 4777. Naquela verificação: assinatura íntegra
(`valid on disk`, `satisfies its Designated Requirement`), UI servida com o MIME certo, API
respondendo, `doctor` 6 ok · 3 warn · 0 fail, parada limpa.

Assinatura **ad-hoc**: `spctl` rejeita, o que só importa para uma cópia baixada (com atributo
de quarentena). Aberto localmente, abre normalmente. Assinar com o Developer ID e notarizar
está disponível no empacotador se for distribuir.

## Uma nota sobre atualizar um install existente

O palco limpo é o **padrão**, não uma migração. Um install que já tem um arranjo salvo
continua abrindo com ele — apagar o arranjo de alguém em silêncio seria a decisão errada. O
caminho é **Editar layout → Redefinir layout**, que agora devolve o palco limpo.
