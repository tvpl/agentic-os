# Desktop agêntico — rediagnóstico e redesenho

Rascunho 3 · 13/09/2026 · Direção decidida. Protótipo clicável: [`prototype/desktop-v3.html`](prototype/desktop-v3.html) (atual) · [`desktop-v2.html`](prototype/desktop-v2.html) (primeira tentativa, austera demais). Alvo: `apps/command-centre/src/desktop/**`, `src/components/Workspace.tsx`, `src/brain/**` (reuso de câmera).

O desktop atual é um dashboard: nove painéis ligados ao mesmo tempo, cada um cortando o próprio conteúdo. Este documento separa o que está errado (com o código que produz cada sintoma), o modelo de interação proposto e a ordem de execução.

---

## 1. Diagnóstico

### 1.1 Tudo ligado ao mesmo tempo
`DEFAULT_LAYOUT` (`defaultLayout.ts:110`) marca nove widgets `visible: true` numa grade de 24 colunas × `MIN_ROWS = 20`. Cada um monta o corpo inteiro no primeiro render e o mantém. Não existe estado "presente mas quieto": ou o widget ocupa caixa cheia, ou está escondido pela galeria.

### 1.2 Adaptação por corte, não por desenho
`heightTier` (`widgetSize.ts:38`) troca a forma do corpo por faixa de altura, mas o conteúdo continua maior que a caixa. A prova é `useOverflowCue` em `WidgetLayer.tsx:96`: o sistema mede o corte e marca `data-overflow="more"` para avisar que há mais abaixo. Ou seja, cortar não é acidente — virou recurso. Nos prints: "Otimizador de Recursos do Claude Code" cortado ao meio, "DURAÇÃO MÉDIA" cortado, "mais 13" como saída para 13 skills que não cabem.

### 1.3 Sem hierarquia de atenção
Pulso em 23 % de sucesso, "Precisa de atenção" com três falhas, e o relógio têm exatamente o mesmo peso visual: mesma moldura, mesmo título, mesma borda. A resposta anterior à sobrecarga foi acrescentar um widget chamado *attention* — mais um cartão competindo com os outros pela mesma atenção que ele deveria dirigir.

### 1.4 Expandir é binário e desperdiça
`maximized` (`WidgetLayer.tsx:164`) põe `visibility: hidden` nos irmãos e estica um corpo desenhado para ~300 px até ~2000 px. O print 2 mostra o resultado: o painel "Agora" em tela cheia com três linhas de conteúdo e 70 % de vazio. Expandir muda a caixa, não a informação.

### 1.5 O anel de arquivos é decoração desconectada
`buildRingChips` (`ringChips.ts:57`) orbita até 22 chips ao redor do icosfério, posicionados pelo espaço que sobra entre as colunas (`freeRegion`, `index.tsx:186`). Clicar leva para fora (`/runs/:id` ou `/brain`). Não tem zoom, agrupamento, relação com o console nem com a execução. Disputa pixel com os widgets e não entrega nada que o Segundo Cérebro não faça melhor — por isso parece colado no produto.

### 1.6 Não existe "janela"
Só há dois estados: widget preso à grade, ou rota de página inteira (`/brain`, `/artifacts`, `/runs/:id`). Falta exatamente o meio-termo pedido: um diagrama aberto ao lado do console, referenciável por estar aberto. `withConsoleReference` (`consoleDraft.ts:56`) já existe e hoje não tem o que referenciar.

### 1.7 MicroApps é um lançador ocupando imóvel permanente
Cinco colunas × sete linhas fixas para quatro links e dois conectores pendentes — usado talvez três vezes por sessão, presente cem por cento do tempo.

### 1.8 Modos não guardam nada
`overview` / `focus` / `explore` (`Workspace.tsx:20`) só ligam e desligam visibilidade. Nenhum guarda o que estava aberto, então trocar de modo é perder o contexto de trabalho.

---

## 2. Princípios do redesenho

1. **Silêncio por padrão.** A superfície permanente mostra *estado*; dado se pede.
2. **Sinal só aparece se mudar uma decisão.** Cada instrumento declara um nível; ocioso não ganha peso visual.
3. **Expandir é outra composição.** A versão expandida é um layout próprio, não a caixa esticada.
4. **O que o agente produz vira janela, não navegação.** Sair do desktop deve ser exceção.
5. **Janela aberta é contexto.** O que está na tela é referenciável pelo prompt.
6. **Câmera, não barra de rolagem.** Profundidade por voo e zoom — o motor já existe em `brain/camera.ts` e `brain/engine/flight.ts`.
7. **Nada de moldura para tudo.** Moldura é sinal de janela; sinal ambiente não tem moldura.

---

## 3. Arquitetura proposta — três camadas

```
┌──────────────────────────────────────────────────────────────┐
│  FAIXA AMBIENTE   provedor · custo · runs · atenção · hora    │  L2 chrome
├──┬────────────────────────────────────────────────────────┬──┤
│R │                                                        │ I│
│A │                    PALCO (stage)                       │ N│  L0 palco
│I │      janelas: console · artefato · trace · imagem      │ S│
│L │      câmera com zoom/voo · grade viva ao fundo         │ T│
│  │                                                        │ R│  L1 instrumentos
│  │  ┌──────────────────────────────────────────────┐      │ U│    (sinais)
│  │  │  CONSOLE (âncora)   [@artefato] [@run] chips │      │ M│
├──┴──┴──────────────────────────────────────────────┴──────┴──┤
│                     DOCK  espaços · apps ativos               │  L2 chrome
└──────────────────────────────────────────────────────────────┘
```

### 3.1 L1 — Instrumentos: um widget, dois renderizadores

O contrato do registro (`registry.tsx`) ganha duas funções em vez de uma:

```ts
interface WidgetDefinition {
  id: WidgetId;
  titleKey: TKey;
  /** Estado permanente: glifo + número + nível. Sem moldura, sem título, sem scroll. */
  Signal: ComponentType<SignalProps>;
  /** Composição expandida, desenhada para a área que recebe. Ausente = instrumento só de sinal. */
  Surface?: ComponentType<SurfaceProps>;
  /** Área mínima em que a superfície é honesta (px, não células). */
  surfaceMin?: { w: number; h: number };
}

interface SignalValue {
  level: "idle" | "info" | "warn" | "critical";
  /** Um número ou glifo. Nunca uma frase. */
  value: string;
  /** Lido por leitor de tela e pelo tooltip; não desenhado no estado ocioso. */
  label: string;
}
```

Regras derivadas:

- **`Signal` nunca rola e nunca corta.** Se não cabe em ~56 px de altura, não é sinal — é superfície.
- **`level: "idle"` desenha em `--muted` sem brilho, sem badge.** Só `warn`/`critical` acendem. Hoje 23 % de sucesso e o relógio brilham igual; depois, só o pulso acende.
- **Instrumento sem `Surface` não expande.** É o caso do relógio: a hora *é* o dado completo. Clicar faz o sinal pulsar e nada mais — a interface deixa de prometer uma tela que não existe (pedido explícito do print 1).
- **`Surface` recebe `{ width, height }` em pixels reais** e escolhe a composição. O `Pulso` expandido não é a mesma lista maior: é série temporal + distribuição por skill + últimas falhas. Quem não tiver uma composição honesta para a área recebida devolve a compacta centrada, com respiro — e não a esticada.

### 3.2 Onde os sinais vivem

Os sinais deixam a grade e passam a morar em duas bordas:

- **Faixa ambiente (topo):** provedor, orçamento do dia, runs ativos, atenção, hora. Uma linha, altura ~28 px, tipografia mono, sem molduras. Substitui hoje: Pulso, Hoje, Workspace, Custo, e o cabeçalho duplicado de telemetria (`HudTelemetry.tsx`).
- **Trilho lateral (esquerda):** instrumentos com superfície — Deck, Rotinas, Atenção, Inbox, Agenda, E-mail. Coluna de glifos de 40 px, com pip de notificação.

Clicar em qualquer sinal abre sua **superfície** como janela no palco, com `backdrop-filter: blur(18px)` e escurecimento radial do fundo (`--stage-veil`), não com `visibility: hidden` nos irmãos. O palco continua legível atrás: é o que dá a sensação de profundidade que hoje falta.

### 3.3 L0 — O palco e o gerenciador de janelas

Substitui icosfério + anel de chips. É uma superfície com câmera (pan/zoom) onde vivem janelas:

```ts
type WindowKind = "console" | "artifact" | "run" | "image" | "diagram" | "surface" | "app";

interface StageWindow {
  id: string;                    // "art:runs/42/plan.md"
  kind: WindowKind;
  title: string;
  /** Handle referenciável pelo console: "@plan.md". */
  ref: string;
  rect: { x: number; y: number; w: number; h: number };  // coordenadas do palco
  z: number;
  state: "open" | "minimized" | "peek";
  source?: { path?: string; runId?: string };
}
```

Comportamento:

- **Abrir é voar, não trocar de tela.** Clicar num artefato numa lista faz a câmera voar até um ponto livre do palco e a janela materializar lá (`flight.ts` já implementa o voo com easing e reserva de margens).
- **Zoom com nível de detalhe.** Afastado: janelas viram cartões com título e miniatura. Perto: conteúdo vivo. É o comportamento do Segundo Cérebro aplicado ao trabalho, não ao grafo.
- **Layout automático em vez de arrastar tudo.** Atalhos "lado a lado", "console + 1", "console + 2" reorganizam com transição FLIP. Arrastar continua possível, mas não é obrigatório para chegar num arranjo bom.
- **Ladrilhamento com o console fixo.** O console nunca é coberto: ele é a âncora inferior e as janelas ocupam o espaço restante.

### 3.4 O console referencia o que está aberto

É a peça que transforma "dashboard com prompt" em OS agêntico:

- Acima do campo do console, uma **bandeja de contexto**: um chip por janela aberta (`@plan.md`, `@run-42`, `@diagrama`).
- Clicar num chip insere `@plan.md` no texto; `withConsoleReference` (`consoleDraft.ts:56`) já faz a parte de anexar caminho sem destruir o rascunho — falta a fonte e a forma curta.
- Arrastar a janela sobre o console anexa também.
- `@` no campo abre o autocompletar das janelas abertas, do mesmo jeito que `/` já abre o de skills (`skillSuggestions`, `PromptWidget.tsx:56`).
- No envio, a referência é resolvida para caminho absoluto antes de ir ao agente — o modelo recebe caminho, o usuário vê nome.

Consequência direta: a resposta do agente também abre janela. Um run que gera um `.md` faz o artefato aparecer no palco ao lado do console, referenciável na mensagem seguinte. O anel de arquivos inútil vira o resultado do trabalho, no lugar onde o trabalho acontece.

### 3.5 L2 — Trilho de apps (substitui o quadrado de MicroApps)

Espinha luminosa de 6 px colada à borda esquerda, gradiente no accent, com pips de estado dos conectores. Em `hover` ou `⌘K`, expande para ~200 px:

- itens entram em cascata (28 ms de atraso entre eles), do topo para baixo;
- o item sob o cursor cresce e empurra os vizinhos (escala magnética, curva `--ease-emphasized`);
- o rótulo desliza da esquerda com máscara; ícone sozinho quando recolhido;
- conector não configurado entra como fantasma com o pip âmbar já visível na espinha recolhida — a informação que hoje exige o widget aberto;
- abrir um app coloca-o como janela no palco (`kind: "app"`), não como troca de rota.

Recolhido, custa 6 px. Hoje custa 5 × 7 células permanentes.

### 3.6 Dock: espaços em vez de modos

A proposta atual é boa; o que falta:

- **Espaços nomeados e persistentes** substituem `overview`/`focus`/`explore`: um espaço guarda quais janelas estão abertas e onde. Trocar de espaço é trocar de contexto de trabalho, não de nível de opacidade.
- **Apps ativos com estado vivo** no dock: um run em execução aparece como chip com barra de progresso; clicar traz a janela do trace ao foco.
- **Revelar por proximidade:** o dock encolhe para uma linha de 4 px quando o cursor está longe e cresce ao se aproximar.
- **Leitura de zoom do palco** encaixada na ponta direita (`ZoomReadout.tsx` já existe no Segundo Cérebro e pode ser reaproveitado).

---

## 4. O que acontece com o que existe hoje

Decidido em 13/09: **sem esfera e sem grade.** O desktop passa a ser um gerenciador de
janelas de verdade — mover, sobrepor, encaixar, empilhar — com estética futurista e agêntica.

| Hoje | Destino |
|---|---|
| Grade 24 col + `dragReducer` + `useGridLayout` | **Removidos.** Substituídos por janelas livres com posição absoluta, ordem Z, foco, encaixe nas bordas e arranjos automáticos |
| `maximized` com irmãos ocultos | Janela maximizada dentro do palco; as outras continuam atrás, desfocadas |
| Anel de chips + `freeRegion` | **Removidos.** Recentes viram uma janela chamada sob demanda |
| Icosfério (`icosphere.ts`, `Wallpaper.tsx`) | **Removido.** A presença do agente passa a ser um respiro luminoso atrás do console, reagindo a `CoreState` — custo de render próximo de zero |
| `HudTelemetry` | Absorvido pela faixa ambiente |
| Widget `attention` | Vira nível `critical` da faixa + superfície sob demanda |
| Widget `microapps` | Vira o trilho |
| Widget `today` | Vira sinal da faixa, sem superfície |
| `heightTier` / `useOverflowCue` | **Removidos.** A janela tem o tamanho que o usuário deu; não existe mais corte para avisar |
| `settings.dashboardLayout` | Migrado uma vez para `settings.spaces`, com as janelas equivalentes aos widgets que estavam visíveis |

---

## 5. Execução

### F1 — Contrato de sinal e superfície (base)
Introduzir `Signal`/`Surface` no registro com adaptadores para os widgets atuais (`Surface = componente de hoje`, `Signal` derivado). Nada muda na tela ainda; a grade continua funcionando. Entrega: `registry.tsx`, `widgetTypes.ts`, `signal.ts` + testes de unidade dos níveis.
**Critério:** todo widget devolve um `SignalValue` e os testes existentes passam sem alteração.

### F2 — Véu e superfície em janela
Trocar `maximized` por uma superfície sobre véu desfocado, com o palco visível atrás e `Esc` fechando. Composições próprias para Pulso, Deck, Atenção e Agora. Instrumentos sem `Surface` param de mostrar o botão de expandir.
**Critério:** nenhuma superfície abre com mais de 35 % de área vazia em 1440×900; `desktop-regressions.spec.ts` atualizado para a nova semântica de expandir.

### F3 — Faixa ambiente e trilho
Faixa no topo, trilho na esquerda, remoção dos widgets absorvidos do layout padrão. Espaço "Clássico" preservado para quem tiver layout salvo (`isLegacyDefault` já trata a migração de composição).
**Critério:** o desktop padrão abre com zero conteúdo cortado em 1024×768 e em 1440×900.

### F4 — Palco e janelas
Gerenciador de janelas, câmera reusando `camera.ts`/`flight.ts`, arranjos automáticos, minimizar para o dock. Anel de chips removido.
**Critério:** abrir três janelas e aplicar "console + 2" sem sobreposição e sem cobrir o console; 60 fps com quatro janelas no perfil imersivo (`workspace-performance.spec.ts`).

### F5 — Contexto do console
Bandeja de chips, `@` no autocompletar, arrastar-para-anexar, resolução de referência no envio, resultado de run abrindo janela.
**Critério:** `console-context.spec.ts` estendido — abrir artefato, referenciar por `@`, enviar, e o caminho absoluto chega ao adaptador.

### F6 — Espaços e dock
Espaços persistentes, chips de run vivos, revelar por proximidade, leitura de zoom.
**Critério:** trocar de espaço e voltar restaura as mesmas janelas nas mesmas posições após recarregar.

---

## 6. Raio de impacto

- **Testes que mudam de semântica:** `desktop-regressions.spec.ts` (maximizar/restaurar), `desktop-reflow.spec.ts`, `layout-presets.spec.ts`, `ringChips.test.ts` (removido em F4), `defaultLayout.test.ts` (nova composição padrão).
- **Persistência:** `settings.dashboardLayout` continua válido para o espaço Clássico; espaços precisam de chave nova (`settings.spaces`), com migração do layout atual para o espaço "Clássico".
- **i18n:** ~40 chaves novas em `locales/desktop.ts`, en + pt-BR, mais as chaves de widget que somem com os widgets absorvidos.
- **Desempenho:** o palco acrescenta uma camada com câmera; `renderProfile: "economy"` precisa desligar o véu desfocado (custo de `backdrop-filter`) e o voo, caindo para corte duro e posicionamento imediato.
- **Acessibilidade:** sinal ocioso sem cor forte não pode virar informação só por cor; cada sinal mantém `label` lido por leitor de tela, e a superfície é `role="dialog"` com foco preso e devolvido ao sinal de origem.

---

## 6.1 Correção de rota: o palco não pode ficar vazio

O primeiro protótipo acertou a mecânica (janelas, referência por `@`, câmera) e errou a
sensação: com nada aberto, virava uma tela preta. Silêncio por padrão não pode significar
vazio — num OS agêntico o ambiente **é** instrumentação. Três peças resolvem isso, e a
terceira também devolve o que parecia perdido (skills, cérebro, apps).

### O campo é o Segundo Cérebro
O fundo do desktop deixa de ser papel de parede e passa a ser a constelação real do
cérebro: nós coloridos por área, ligações que acendem no hover, nome e área desenhados ao
lado do nó sob o cursor, clique trazendo o nó para o palco como painel referenciável. É a
resposta honesta à crítica do anel de arquivos: aquilo era decoração com nome de arquivo;
isto é o grafo que já existe em `brain/engine/world.ts`, vivo atrás do trabalho. Nunca há
tela vazia, e o que preenche tem função.

### Pods: instrumentos em hexágono com contador
Os sinais deixam de ser texto na faixa e viram **pods** hexagonais em dois arcos — apps à
esquerda, instrumentos à direita. Cada pod mostra ícone, um micro-valor (`23%`, `1/3`,
`3%`) e, quando há pendência, um **contador** vermelho ou âmbar pulsando. Hover revela
nome e resumo; clique abre a superfície como painel. "Editar HUD" no dock põe um `✕` em
cada pod e um `+` para adicionar da galeria — o HUD é do usuário, não fixo.

A regra de silêncio continua valendo, só que agora com forma: pod ocioso é contorno morno,
pod com pendência tem contador aceso. Um relance diz o que pede decisão.

### Deck de skills: arco radial sobre o console
`/` ou o botão **Skills** abre um arco de skills em hexágono acima do console, com dois
anéis girando devagar atrás. Cada skill entra em cascata de 26 ms. Clicar executa: o pod
do Pulso pulsa, a faixa marca `runs 1`, o trace abre como painel e, ao terminar, o
artefato produzido abre ao lado. Era a pergunta "onde aciono as skills" — a resposta não é
uma lista num cartão, é um deck que aparece onde a mão já está.

### Três profundidades: pod → superfície → app
Nada foi perdido na mudança; o que havia virou camada. **Pod** é o relance (ícone,
micro-valor, contador). **Superfície** é a decisão (Pulso, Atenção, Caixa: o resumo que
cabe em 250 px e responde "preciso agir?"). **App inteiro** é o trabalho — Artefatos com
busca e filtros por tipo, Execuções com histórico, custo e reexecutar, Rotinas com a
semana, Gerações com a grade de imagens, Skills com grade, modelo por skill e `▶`,
Conectores com estado por conector. Cada superfície carrega um degrau explícito
(`abrir execuções ⤢`) e cada app abre como painel no palco, nunca como rota.

O caminho fica reversível: o contador do pod de Conectores é literalmente os dois
pendentes listados no app; resolver lá apaga o contador aqui.

### Amarras de contexto
Quando o prompt cita `@algo`, uma curva tracejada animada é desenhada do console até o
painel referenciado. O usuário **vê** a que o agente está ligado, em vez de confiar que o
texto funcionou. É o detalhe que separa "console com anexos" de HUD agêntico.

### Placa, não janela
Painéis não têm barra de título de sistema operacional: cantos chanfrados por `clip-path`,
borda que vira accent quando em foco, controles finos que só aparecem no hover, abertura
em íris (do centro para fora), não em caixa que cresce. Mover, sobrepor, encaixar e
empilhar continuam iguais aos de um SO — a linguagem visual é que não é a do macOS.

## 7. Decisões tomadas

1. **A grade sai.** Não vira espaço opcional: o modelo passa a ser janela livre, como um SO de verdade. O layout salvo de cada usuário é migrado uma vez para um espaço com as janelas equivalentes.
2. **O icosfério sai.** A presença do agente fica no respiro luminoso atrás do console — comunica "pensando" sem texto e sem canvas animado em tela cheia.
3. **Todos os quatro tipos de janela entram:** artefato, trace de execução, superfície de instrumento e app inteiro. Nenhuma rota nova para ver algo — o desktop é onde tudo acontece.
4. **Janelas persistem por espaço** (últimas 8), porque reabrir o trabalho de ontem é metade do valor de um OS.

## 8. O que o protótipo v3 já prova

Clicável, com dados falsos, tudo verificado no navegador:

- campo do Segundo Cérebro vivo, com hover que acende nó e ligações e clique que abre o nó como painel;
- pods hexagonais nos dois arcos, com micro-valor, contador de pendência e tooltip;
- apps completos abrindo como painel: Artefatos, Execuções, Rotinas, Gerações, Skills, Conectores;
- escalada pod → superfície → app, com o degrau explícito dentro de cada superfície;
- clicar um artefato na grade abre o arquivo como painel; rodar uma skill da grade dispara o trace;
- "Editar HUD": remover pod com `✕`, adicionar pelo `+` e galeria;
- deck de skills em arco radial por `/` ou pelo botão, com execução real do fluxo;
- execução: trace transmitindo linha a linha → artefato abrindo ao lado ao terminar;
- amarras tracejadas do console até cada painel citado com `@`;
- painéis chanfrados: arrastar, redimensionar, sobrepor, encaixar em meia tela, recolher para o dock;
- visão geral (`Tab`) afastando a câmera; espaços que guardam o que estava aberto.

Falta nele, de propósito: dados reais, i18n, tema claro, teclado completo e acessibilidade —
tudo isso entra na implementação, não na peça de decisão.

### Defeitos que o teste no navegador pegou
1. `#stage` ficou sem regra de posição: altura zero, e toda a matemática de colocação,
   distribuição e visão geral caía no fallback — os painéis empilhavam no mesmo ponto.
2. (v2) O dock com revelação por proximidade punha `pointer-events:none` nos filhos ao
   recolher: botão visível e inclicável.
3. (v2) Arrastar pelo título selecionava o texto do corpo do painel.
