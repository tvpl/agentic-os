# Cérebro: perguntar — design das telas (binding para a feature)

Decide a vista "Perguntar" do cérebro (escopo, modo, pergunta, visão do dono, espera, resposta com citações, retorno sobre a
visão, provocação, perguntas recentes), as entradas que a abrem, a ação "Perguntar sobre esta nota" da vista de notas e a
aba "Agentes (MCP)" das Configurações, com os estados, o texto nas duas línguas e o movimento. Ficam fora daqui: o texto que
as ferramentas MCP devolvem a um agente e o formato de `answer.json` (são do `plan.md`, doors 3 e 4), e o `SKILL.md` de
`brain-ask` (lido por um agente, não por uma pessoa).

## Binding sources

| Source | O que decide |
| ------ | ------------ |
| `.specs/features/design-system/design.md` | piso de 12px, texto corrido a 13px, cor só por token (stylelint), estado nunca só por cor (ícone e texto), axe sem `serious`/`critical`, a galeria cobre as duas camadas |
| `.specs/features/primitivas/design.md` | o seletor de escopo é `Menu`; o modo é `Tabs` de dois itens; "Ver a resposta do cérebro" é `Fold`; `Field` leva rótulo, dica e erro; nenhum CSS fora de `ui/ui.css` desenha parte de primitiva; toda animação de `ui.css` mora dentro de `@media (prefers-reduced-motion: no-preference)` |
| `.specs/features/comandos-atalhos/design.md` | "Perguntar ao cérebro" é um comando do registro (`global`, na paleta); `a` abre a vista no escopo `view:brain`; `Mod+Enter` manda a pergunta no escopo `view:ask`; uma tecla nua não age dentro de um campo |
| `.specs/features/moldura-app/design.md` (Tela do Segundo Cérebro) | a vista vive na moldura (conteúdo à esquerda, chat fixo à direita); o botão "Perguntar" entra na barra de ferramentas do cérebro e usa `.btn.sm` |
| `.specs/features/cerebro-rituais/design.md` (Entradas) | as entradas seguem as da Revisão semanal: botão da barra, linha do menu da cena do cérebro no Núcleo, comando da paleta |
| `.specs/features/cerebro-paineis/design.md` (Pergunta) | a citação é `nome § seção`, abre `/brain?sel=<fileId>`; o cartão "Como esta resposta foi feita" é o mesmo do painel de pergunta |
| `.specs/features/cerebro-natureza/design.md` | o rótulo de natureza (`plano`, `hipotese`, `opiniao`) é o mesmo chip das listas de busca e de revisões |
| `.specs/features/cerebro-natureza/design.md` e `cerebro-rituais/design.md` | o estado de erro (mensagem e "Tentar de novo"), o de carregando (spinner e "Carregando…") e o `role="status"` para o estado lido por leitor de tela |
| `apps/command-centre/src/views/Settings.tsx` | a tela nova é mais uma aba (`TabId` `agents-mcp`) do grupo `think`, logo depois de `memory`, com rótulo e palavras de busca (`settings.keys.agentsMcp`); o título é o `h2.settings-section-title` da aba e o conteúdo são cartões `.card.stack` |
| `.specs/features/limpeza-legado/design.md` | um só renderizador de Markdown (`components/Markdown.tsx`); nada de CSS ou chave de tradução sem uso |

## Vista - Perguntar

Rota `/brain/ask` na moldura; no Núcleo, o mesmo conteúdo num painel da cena do cérebro. Uma coluna de leitura de no máximo
720px de largura, centrada no espaço do conteúdo. De cima para baixo:

1. **Cabeçalho.** Título "Perguntar ao cérebro" (13px, peso 600). Abaixo, uma linha de 12px, cor secundária: "As respostas
   citam as suas notas. Confira as fontes."
2. **Escopo.** A linha "Sobre:" seguida de um botão `.btn.sm` com o escopo atual e `ChevronDown`, que abre um `Menu` com:
   "Contexto ativo: <nome>" (só com contexto ativo), "Todo o cérebro", os outros contextos pelo nome, "Uma pasta…" (abre a
   árvore de pastas da vista de notas num `Popover`, escolha de uma pasta) e, quando o escopo é `notes`, "Estas notas".
   Com escopo `notes`, abaixo da linha, as notas como fichas (`nome` e um botão `X` com `aria-label` "Tirar <nome>"); tirar a
   última volta o escopo para o contexto ativo ou "Todo o cérebro". Com uma pasta escondida dos agentes no escopo, a linha
   de 12px com `EyeOff`: "Pastas escondidas dos agentes não entram nas respostas."
3. **Modo.** `Tabs` de dois itens: "Perguntar direto" e "Raciocine primeiro". Abaixo de "Raciocine primeiro", a dica de 12px:
   "Escreva o que você pensa antes. O cérebro responde dizendo onde as suas notas concordam, discordam e o que falta."
4. **Campos.**
   - Em "Raciocine primeiro", primeiro o `Field` "Sua visão" (`textarea`, 4 linhas, cresce até 12) com a contagem
     "N de 20 caracteres" enquanto falta e "N caracteres" depois, e só então o `Field` "Pergunta".
   - Em "Perguntar direto", só o `Field` "Pergunta" (`textarea`, 2 linhas, cresce até 6), com o marcador "Ex.: O que eu já
     decidi sobre o onboarding de clientes?".
   - À direita, embaixo dos campos, o botão `.btn.primary` "Perguntar" (`Send`), desabilitado enquanto a pergunta tem menos
     de 3 caracteres ou, em "Raciocine primeiro", a visão tem menos de 20; o `title` do botão desabilitado diz o que falta.
     `Mod+Enter` dentro de um campo manda.
5. **Resultado** (abaixo dos campos, quando há uma pergunta aberta; os campos continuam editáveis). Ver "Resposta" e
   "Estados".
6. **Perguntas recentes.** Um título de 12px em maiúsculas, cor secundária, "PERGUNTAS RECENTES"; uma lista de até 30 linhas,
   cada uma com a pergunta (uma linha, cortada com reticências), o modo como ícone e texto curto (`MessageSquare` "Direto" ou
   `PenLine` "Raciocine primeiro"), o escopo em texto e a hora relativa; o estado como ícone e texto quando não é
   respondida (`Loader` "Respondendo…", `AlertTriangle` "Recusada" ou "Falhou"). A linha da pergunta aberta tem
   `aria-current="true"`. Clicar abre a pergunta: os campos mostram a pergunta, o modo e a visão dela, só para leitura, e o
   botão vira "Nova pergunta" (`Plus`), que limpa os campos.

### Resposta

- **Modo direto:** os parágrafos em ordem, texto a 13px com altura de linha 1,55, renderizados pelo `Markdown.tsx` sem
  títulos (o texto é corrido). Abaixo de cada parágrafo, uma linha de citações: cada citação é um botão-link de 12px
  `FileText` + `nome § seção`, com o chip de natureza logo depois quando a nota é `plano`, `hipotese` ou `opiniao`. As
  citações quebram linha; nunca rolam na horizontal.
- **Raciocine primeiro:** primeiro um cartão "Sua visão" com o texto do dono (12px, cor secundária, até 6 linhas e
  "Mostrar tudo"); depois até três listas, nesta ordem e só as que têm item: "Onde as notas concordam" (`CircleCheck`),
  "Onde discordam" (`CircleSlash`) e "O que falta" (`CircleHelp`); cada item é o texto seguido das suas citações, como nos
  parágrafos. Por último a `Fold` fechada "Ver a resposta do cérebro", com os parágrafos dentro.
- **Provocação** (quando há): depois dos parágrafos (e, em "Raciocine primeiro", depois da `Fold`), um bloco com a borda
  esquerda de 2px em `--line-strong` e fundo `--surface-2`, **sem** ícone de aviso e sem cor de alerta. Primeira linha, 12px
  em cor secundária, o tipo: "Uma nota contradiz isto", "Uma nota complica isto" ou "Uma nota acrescenta o que falta". Depois
  o texto (13px) e a citação. Dois botões `.btn.sm`: "Abrir a nota" (`ExternalLink`) e "Perguntar sobre isto"
  (`MessageSquarePlus`), que preenche a pergunta com o texto da provocação e põe o escopo em "Estas notas" com a nota citada;
  o foco vai para o campo da pergunta.
- **Como esta resposta foi feita:** o cartão do painel de pergunta, no fim: "Respondida por <provedor> em <duração> ·
  <hora>" e o link "Ver a execução".

### Estados

- **Respondendo:** no lugar do resultado, spinner e "Lendo as suas notas e escrevendo a resposta…", com "Cancelar"
  (`.btn.sm`) à direita; abaixo, em 12px, "Isso usa uma execução do <provedor>." O estado é anunciado em `role="status"`.
  Depois de "Cancelar", "Cancelado." no mesmo lugar e a pergunta volta editável.
- **Não encontrei:** `SearchX` e "Não encontrei nada nas suas notas sobre isso."; abaixo, em 12px, "Procurei em <escopo>:
  <n> arquivos."; com escopo diferente de "Todo o cérebro", o botão `.btn.sm` "Perguntar em todo o cérebro", que manda a
  mesma pergunta com esse escopo.
- **Recusada:** faixa `role="alert"` com `AlertTriangle`, "A resposta não passou na conferência das fontes." e, em 12px, o
  motivo que o servidor deu; botão "Tentar de novo".
- **Falhou:** a mesma faixa com "A execução não terminou." e o motivo; botão "Tentar de novo".
- **Desligado** (`409 skill_unavailable`): no lugar dos campos, `Lock` e "Perguntar está desligado: a skill brain-ask não
  pode ler a memória."; botão `.btn.primary` "Ligar"; depois de ligar, os campos voltam com a pergunta que estava escrita.
- **Outra pergunta em andamento** (`409 ask_in_progress`): nenhum erro; a vista abre a pergunta que está respondendo.
- **Vazio** (nenhuma pergunta recente): no lugar da lista, "Nenhuma pergunta ainda." e três botões-link de exemplo que
  preenchem o campo: "O que eu já decidi sobre <área mais citada>?", "Quais planos meus ainda não viraram realidade?" e "O
  que está parado há mais tempo?"; sem área, o primeiro vira "O que eu já decidi este mês?".
- **Carregando a lista:** spinner e "Carregando…".
- **Erro da lista:** "Não deu para carregar as perguntas." e "Tentar de novo".
- **Pergunta antiga que hoje cita uma pasta escondida:** é o estado "Recusada" (a resposta é julgada na leitura).

## Entradas

- **Barra de ferramentas do cérebro (moldura):** botão `.btn.sm` "Perguntar" com `MessageSquare`, antes de "Revisões (N)".
- **Menu da cena do cérebro (Núcleo):** a linha "Perguntar ao cérebro", acima da linha da faxina.
- **Paleta:** o comando "Perguntar ao cérebro" (en "Ask the brain"), `global`.
- **Tecla:** `a` no escopo `view:brain`.
- **Vista de notas:** no menu de ações da nota aberta, a linha "Perguntar sobre esta nota" (`MessageSquarePlus`), que abre
  `/brain/ask` com o escopo `notes` dela e o foco na pergunta.

## Aba - Agentes (MCP) das Configurações

Uma aba nova, "Agentes (MCP)", no grupo "O que pensa" (`think`), logo depois de "Memória"; a busca das Configurações a acha também por "mcp claude cursor codex conectar agentes" (en "mcp claude cursor codex connect agents"). Três cartões `.card.stack`, nesta ordem:

1. **Conectar.** Frase de apoio, 12px: "Ligue o MordomoOS ao Claude Code, ao Cursor ou ao Codex para que eles busquem e leiam
   o seu cérebro." Um bloco por CLI (Claude Code, Cursor, Codex), cada um com: o nome (13px, peso 600); o estado à direita
   em ícone e texto, "Ligado" (`CircleCheck`, `--tone-ok`) ou "Não ligado" (`CircleDashed`, `--tone-muted`); com "Ligado",
   em 12px mono, o arquivo onde foi achado; com "Não ligado", o comando num bloco `pre` mono de 12px que quebra linha (nunca
   rola na horizontal) e o botão `.btn.sm` "Copiar" (`Copy`), que vira "Copiado" (`Check`) por 2 s; para Cursor e Codex,
   a linha de 12px "Cole em <arquivo>." acima do bloco. Abaixo dos três, a nota de 12px: "Depois de ligar, reabra o
   programa."
2. **Ferramentas.** A linha de 12px com `EyeOff`: "As ferramentas leem como um agente: pastas escondidas dos agentes ficam
   de fora." Uma lista das 13 ferramentas, uma por linha: o nome em mono, a descrição curta em 12px, e a marca em ícone e
   texto à direita: "lê" (`Eye`), "propõe" (`Inbox`, com o `title` "vai para a caixa de revisão") ou "do dono"
   (`KeyRound`).
3. **O que os agentes mais leem.** No topo, "N leituras desde <data>". Três partes: "Por ferramenta" (barras horizontais com o
   número em texto ao lado, a maior a 100%); "Por programa" (lista com o nome, o número e "última vez <hora relativa>"; o
   cliente `run:<provedor>` aparece como "Execuções do <provedor>"); "Mais lidos" (até 20 linhas: `FileText`, o nome, o
   caminho relativo em 12px, o número de leituras; clicar abre `/brain?sel=<fileId>`, e um caminho que não é mais linha do
   índice aparece sem link).

### Estados

- **Carregando:** o esqueleto das seções de Configurações.
- **Erro:** a linha de erro das Configurações, "Não deu para carregar os agentes." e "Tentar de novo".
- **Sem uso:** no cartão 3, `Bot` e "Nenhum agente leu o cérebro ainda."; os cartões 1 e 2 aparecem normais.
- **Arquivo de configuração ilegível:** o CLI aparece "Não ligado" com a linha de 12px "Não deu para ler <arquivo>." e o
  comando para copiar.

## Movimento

- O resultado entra com `opacity` e `translateY(4px)` para 0 (200 ms, `ease-out`); cada parágrafo entra 40 ms depois do
  anterior, no máximo 8.
- As barras de "Por ferramenta" crescem da esquerda (`transform: scaleX`, 240 ms, `ease-out`).
- Tudo dentro de `@media (prefers-reduced-motion: no-preference)`; fora dela nada se move e tudo aparece pronto. Nenhum
  estado depende do movimento: cada um tem texto.

## Texto (as duas línguas; as chaves da vista entram em `locales/brain.ts` e as da aba em `locales/apps.ts`, `en` e `ptBR` com as mesmas chaves)

| Onde | pt-BR | en |
| ---- | ----- | -- |
| título | Perguntar ao cérebro | Ask the brain |
| apoio | As respostas citam as suas notas. Confira as fontes. | Answers cite your notes. Check the sources. |
| escopo | Sobre: · Contexto ativo: {name} · Todo o cérebro · Uma pasta… · Estas notas · Tirar {name} | About: · Active context: {name} · The whole brain · A folder… · These notes · Remove {name} |
| escondidas | Pastas escondidas dos agentes não entram nas respostas. | Folders hidden from agents are left out of answers. |
| modo | Perguntar direto · Raciocine primeiro | Ask directly · Reason first |
| dica do modo | Escreva o que você pensa antes. O cérebro responde dizendo onde as suas notas concordam, discordam e o que falta. | Write what you think first. The brain answers by saying where your notes agree, disagree and what is missing. |
| campos | Sua visão · {n} de 20 caracteres · {n} caracteres · Pergunta · Ex.: O que eu já decidi sobre o onboarding de clientes? | Your view · {n} of 20 characters · {n} characters · Question · E.g. What have I already decided about client onboarding? |
| botões | Perguntar · Nova pergunta · Cancelar · Tentar de novo · Ligar · Perguntar em todo o cérebro | Ask · New question · Cancel · Try again · Turn on · Ask the whole brain |
| falta | Escreva a pergunta. · Escreva pelo menos 20 caracteres da sua visão. | Write the question. · Write at least 20 characters of your view. |
| retorno | Sua visão · Mostrar tudo · Onde as notas concordam · Onde discordam · O que falta · Ver a resposta do cérebro | Your view · Show all · Where your notes agree · Where they disagree · What is missing · See the brain's answer |
| provocação | Uma nota contradiz isto · Uma nota complica isto · Uma nota acrescenta o que falta · Abrir a nota · Perguntar sobre isto | A note contradicts this · A note complicates this · A note adds what is missing · Open the note · Ask about this |
| como foi feita | Como esta resposta foi feita · Respondida por {provider} em {duration} · {time} · Ver a execução | How this answer was made · Answered by {provider} in {duration} · {time} · See the run |
| respondendo | Lendo as suas notas e escrevendo a resposta… · Isso usa uma execução do {provider}. · Cancelado. | Reading your notes and writing the answer… · This uses a {provider} run. · Cancelled. |
| não encontrei | Não encontrei nada nas suas notas sobre isso. · Procurei em {scope}: {n} arquivos. | I found nothing in your notes about this. · I looked in {scope}: {n} files. |
| recusada | A resposta não passou na conferência das fontes. | The answer did not pass the source check. |
| falhou | A execução não terminou. | The run did not finish. |
| desligado | Perguntar está desligado: a skill brain-ask não pode ler a memória. | Ask is off: the brain-ask skill cannot read the memory. |
| recentes | PERGUNTAS RECENTES · Direto · Raciocine primeiro · Respondendo… · Recusada · Falhou | RECENT QUESTIONS · Direct · Reason first · Answering… · Refused · Failed |
| vazio | Nenhuma pergunta ainda. · O que eu já decidi sobre {area}? · O que eu já decidi este mês? · Quais planos meus ainda não viraram realidade? · O que está parado há mais tempo? | No questions yet. · What have I already decided about {area}? · What have I decided this month? · Which of my plans have not become real yet? · What has been stalled the longest? |
| lista | Carregando… · Não deu para carregar as perguntas. | Loading… · Could not load the questions. |
| entradas | Perguntar · Perguntar ao cérebro · Perguntar sobre esta nota | Ask · Ask the brain · Ask about this note |
| aba | Agentes (MCP) · mcp claude cursor codex conectar agentes | Agents (MCP) · mcp claude cursor codex connect agents |
| conectar | Ligue o MordomoOS ao Claude Code, ao Cursor ou ao Codex para que eles busquem e leiam o seu cérebro. · Ligado · Não ligado · Cole em {file}. · Copiar · Copiado · Depois de ligar, reabra o programa. · Não deu para ler {file}. | Connect MordomoOS to Claude Code, Cursor or Codex so they can search and read your brain. · Connected · Not connected · Paste into {file}. · Copy · Copied · After connecting, reopen the program. · Could not read {file}. |
| ferramentas | As ferramentas leem como um agente: pastas escondidas dos agentes ficam de fora. · lê · propõe · do dono · vai para a caixa de revisão | Tools read as an agent: folders hidden from agents are left out. · reads · proposes · owner's · goes to the review inbox |
| uso | O que os agentes mais leem · {n} leituras desde {date} · Por ferramenta · Por programa · Mais lidos · última vez {time} · Execuções do {provider} · Nenhum agente leu o cérebro ainda. | What agents read most · {n} reads since {date} · By tool · By program · Most read · last {time} · {provider} runs · No agent has read the brain yet. |
| erro da aba | Não deu para carregar os agentes. · Tentar de novo | Could not load the agents. · Try again |
