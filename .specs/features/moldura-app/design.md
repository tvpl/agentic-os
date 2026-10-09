# Moldura de app — design (binding)

Fonte de design da feature `moldura-app`. Decide composição, ordem, contagem e textos de cada
tela. Ficam fora daqui (e dos checks): espaçamento, cor e peso de tipo, que vêm dos tokens de
`theme.css` e do preset ativo.

Larguras são de composição, não de pixel: "estreita" = abaixo de 900 px de viewport. A página Hoje é
a exceção: ela mede a coluna central (ver Tela 2).

## Tela 1 - Moldura (todas as rotas, `shell: "moldura"`)

```
┌──────────────┬──────────────────────────────────────────────┬──────────────────┐
│ BARRA LATERAL│ BARRA SUPERIOR                               │ CONVERSA (dock)  │
│ marca        │ título da página · [Buscar ou comandar… ⌘K]  │ Console          │
│ ── principal │                         [sino] [Conversa]    │ (empilhado)      │
│ Hoje     (n) ├──────────────────────────────────────────────┤                  │
│ Execuções    │ CONTEÚDO                                     │                  │
│ Skills       │ a view da rota                               │                  │
│ Rotinas      │                                              │                  │
│ Memória      │                                              │                  │
│ ── mais      │                                              │                  │
│ Conectores   │                                              │                  │
│ Artefatos    │                                              │                  │
│ Gerações     │                                              │                  │
│ Pixel Studio │                                              │                  │
│ ──           │                                              │                  │
│ Configurações│                                              │                  │
│ [recolher]   │                                              │                  │
└──────────────┴──────────────────────────────────────────────┴──────────────────┘
```

Regiões: exatamente 4 de nível superior - barra lateral (`nav`, esquerda), barra superior (`header`,
topo da coluna central), conteúdo (`main`, abaixo da barra superior) e conversa (`aside`, direita).
A barra superior e o conteúdo dividem a coluna central; a barra lateral e a conversa ocupam a
altura toda. Um marco dentro de uma região (o menu de Configurações, o painel de contexto do
Console) faz parte dela e leva rótulo próprio. O `h1` da página é o título da barra superior; o
título que uma view traz é rebaixado a nível 2 para tecnologia assistiva.

Barra lateral, de cima para baixo:

1. Marca: o `systemName` das configurações.
2. Grupo "principal" (sem título visível), 5 itens, nesta ordem: Hoje (`/`), Execuções (`/runs`),
   Skills (`/skills`), Rotinas (`/routines`), Memória (`/brain`).
3. Grupo "Mais" (título visível "Mais" / "More"), 4 itens, nesta ordem: Conectores (`/connectors`),
   Artefatos (`/artifacts`), Gerações (`/generations`), Pixel Studio (`/pixel`).
4. Separador, depois Configurações (`/settings`) sozinho.
5. Botão "Barra lateral" / "Sidebar" (ícone, e o texto quando aberta), com `aria-expanded`: um nome só
   nos dois estados, a dica (`title`) diz o que o toque faz ("Recolher" / "Expandir"). Recolhida, a
   barra mostra só os ícones, com o rótulo como nome acessível; o item Hoje leva a contagem
   pendente no nome ("Hoje, 2 aprovações pendentes").

Cada item: ícone (o `Icon` de `APPS`, e `Sun` para Hoje) + rótulo. O item da rota atual tem
`aria-current="page"`. "Hoje" mostra um contador quando há aprovações pendentes (o número; nada
quando é 0).

Textos dos itens (EN / PT): Today / Hoje · Runs / Execuções · Skills / Skills · Routines / Rotinas ·
Memory / Memória · Connectors / Conectores · Artifacts / Artefatos · Generations / Gerações ·
Pixel Studio / Pixel Studio · Settings / Configurações.

Barra superior, da esquerda para a direita: título da página (`h1`, o rótulo do item ativo; numa
rota de detalhe, o mesmo do item pai), botão de busca com o texto "Search or run a command…" /
"Buscar ou comandar…" e a dica do atalho (⌘K no Mac, Ctrl K nos outros), que abre a paleta; depois,
alinhados à direita, o sino de notificações (abre a caixa de entrada existente) e o botão
"Conversa" / "Chat", que mostra e esconde a coluna da conversa (`aria-pressed`).

Conversa: o `Console` existente no modo empilhado (`stacked`), ocupando a altura da coluna, com o
histórico rolando dentro dela. Aberta por padrão em viewport larga; o estado (aberta/fechada) é
lembrado por navegador.

Viewport estreita: a barra lateral começa como um trilho de 60 px; aberta, ela se desdobra SOBRE o
conteúdo (sem empurrá-lo) e se dobra ao seguir um link, com Esc ou com o botão. A conversa abre como
gaveta sobre o conteúdo (fecha com Esc ou com o botão), e não como coluna. Os dois são diálogos: o
foco entra, o resto fica inerte, o foco volta a quem abriu. A barra superior encurta o título com
reticências antes de perder um controle; a busca mantém o nome mesmo sem o texto.

Atalhos da moldura: ⌘K / Ctrl K abre a paleta (como hoje), ⌘. / Ctrl . mostra e esconde a
conversa, Esc fecha o que está por cima: a paleta, depois a gaveta de documento ou de conversa, e o
sino quando é o único aberto (o foco volta ao sino). As teclas do Núcleo (1-5, `[`, `]`, `/`, `p`, ⌘J, ⌘F, ⌘⇧A, ⌘⇧D) não existem na moldura.

Documento aberto (de Artefatos, da conversa ou da paleta): gaveta à direita sobre o conteúdo, com o
visualizador de documento existente e um botão "Fechar" / "Close". É um diálogo modal e pertence à
página em que foi aberto: sair dela (link, execução, app, formulário, instrumento) a fecha. Um
endereço que não é lugar da moldura leva a Hoje.

## Tela 2 - Hoje (`/` na moldura)

```
┌──────────────────────────────────────────────┐
│ Hoje  ·  terça, 6 de outubro                 │
├──────────────────────┬───────────────────────┤
│ Pede você            │ Em execução           │
├──────────────────────┼───────────────────────┤
│ Rotinas de hoje      │ Caixa de entrada      │
├──────────────────────┼───────────────────────┤
│ Diário               │ Custo                 │
└──────────────────────┴───────────────────────┘
```

Cabeçalho: "Today" / "Hoje" e a data longa no idioma da interface.

Seis cartões, nesta ordem de leitura (esquerda→direita, cima→baixo), cada um com o título visível:

| #   | Título (EN / PT)                   | Conteúdo (widget existente) |
| --- | ---------------------------------- | --------------------------- |
| 1   | Needs you / Pede você              | `approvals`                 |
| 2   | Running / Em execução              | `now`                       |
| 3   | Today's routines / Rotinas de hoje | `routines`                  |
| 4   | Inbox / Caixa de entrada           | `inbox`                     |
| 5   | Journal / Diário                   | `journal`                   |
| 6   | Cost / Custo                       | `cost`                      |

Duas colunas quando a coluna central tem 720 px ou mais; uma coluna abaixo disso, na mesma ordem. É
uma consulta ao contêiner (a coluna central), não à janela: com a barra lateral e a conversa abertas
uma janela de 1100 px deixa ~450 px e cabe uma coluna; sem a conversa, cabem duas. O cartão "Pede
você" cresce com o conteúdo; os outros rolam por dentro a partir de 360 px.

## Tela 3 - Configurações › Aparência: escolha da interface

Na aba existente de aparência (`views/settings/theme.tsx`), acima dos presets: um controle
segmentado com o rótulo "Interface" / "Interface" e duas opções, nesta ordem: "App frame" /
"Moldura de app" e "Immersive Núcleo" / "Núcleo imersivo". A opção atual fica marcada. Escolher
grava na hora e troca a interface sem recarregar a página.

## Tela 4 - Paleta de comandos nos dois shells

Uma ação nova, na seção de ações: na moldura, "Switch to the immersive Núcleo" / "Mudar para o
Núcleo imersivo"; no Núcleo, "Switch to the app frame" / "Mudar para a moldura de app". Na moldura,
as ações "Open panel" (painéis) e "organizar" (arranjo) não aparecem, porque não existem lâminas, e a
ação do tour também não (o tour não abre na moldura; o botão "Tour" de Configurações some nela).
