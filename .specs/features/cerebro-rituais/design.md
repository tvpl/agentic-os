# Cérebro: rituais — design das telas (binding para a feature)

Decide a página "Revisão semanal" (cinco etapas), as quatro entradas que a abrem, a dobra "Menções sem link" do painel da
nota, a linha nova da lista de sentinelas, o texto nas duas línguas e o movimento. Ficam fora daqui: a tela "Revisões" (é da
`cerebro-natureza` e não muda; a revisão semanal só aponta para ela), o assistente de faxina (não muda), o formato das
decisões, do manifesto e da reescrita do link (é do `plan.md`, doors 1, 5 e 7).

## Binding sources

| Source                                                                          | O que decide                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.specs/features/design-system/design.md`                                       | piso de 12px, texto corrido a 13px, cor só por token (stylelint), estado nunca só por cor (ícone e texto), axe sem `serious`/`critical`, a galeria cobre as duas camadas                                                                                                                                                                        |
| `.specs/features/primitivas/design.md`                                          | o seletor de projeto de "Virar tarefa" é `Menu`; as caixas de "Arquivar" são `Checkbox`; o aviso com ação é a linha `role="status"` da própria página, como na tela "Revisões" (emenda 1); nenhum CSS fora de `ui/ui.css` desenha parte de primitiva; toda animação de `ui.css` mora dentro de `@media (prefers-reduced-motion: no-preference)` |
| `.specs/features/comandos-atalhos/design.md`                                    | "Revisão semanal" é um comando do registro (`global`, na paleta); as teclas da lista (`j`/`k`, `f` = Fechar, `m` = Manter, `r` = Revisado) são do escopo `view:weekly`; uma tecla nua não age dentro de um campo                                                                                                                                |
| `.specs/features/moldura-app/design.md` (Tela do Segundo Cérebro)               | a página vive na moldura (conteúdo à esquerda, chat fixo à direita); o botão "Revisão semanal" entra na barra de ferramentas do cérebro, ao lado de "Revisões (N)", e usa `.btn.sm`                                                                                                                                                             |
| `.specs/features/cerebro-natureza/design.md` (Tela - Revisões)                  | o item que sai com transição, o aviso de 8 s com "Desfazer", o conflito com "Recarregar", o cadeado com a frase de "Fora de memory/" e o estado anunciado em `role="status"` são os mesmos da tela "Revisões"                                                                                                                                   |
| `.specs/features/cerebro-faxina-guiada/design.md` (Tela - Assistente de faxina) | a barra de etapas (círculos numerados ligados por uma linha, nome por baixo, `aria-current="step"`, `Check` nas concluídas, "Etapa N de 5 · Nome" em texto) e o resultado "Desfeito: N arquivos voltaram." são os da faxina                                                                                                                     |
| `.specs/features/cerebro-vista-notas/design.md` (painel da nota)                | a dobra nova é uma `Fold` do painel lateral, com o mesmo cabeçalho e a mesma densidade de "Backlinks"                                                                                                                                                                                                                                           |
| `.specs/features/limpeza-legado/design.md`                                      | um só renderizador de Markdown (`components/Markdown.tsx`); nada de CSS ou chave de tradução sem uso                                                                                                                                                                                                                                            |

## Página - Revisão semanal

Rota `/brain/weekly` na moldura; no Núcleo, o mesmo conteúdo num painel da cena do cérebro. Uma página, não um `Modal`: a
revisão leva até uma hora e "Abrir" uma nota precisa da vista de notas ao lado.

- **Cabeçalho:** título "Revisão semanal", à direita a semana em texto ("Semana de 2 a 8/11") e o contexto ativo como texto,
  com o atalho da `cerebro-contextos` para trocar; abaixo, a barra de etapas da faxina com os cinco nomes. Cada círculo é um
  botão: qualquer etapa pode ser aberta a qualquer momento, nenhuma trava a seguinte.
- **Rodapé fixo:** "Voltar" (`.btn`), à direita "Próxima etapa" (`.btn.primary`); na etapa "Pronto", "Concluir revisão"
  (`.btn.primary`) no lugar.
- **Lista:** um item por linha, foco visível; `j`/`k` movem; as ações do item numa fileira à direita (em tela estreita, abaixo
  do texto). O estado da lista é anunciado em `role="status"` ("12 laços abertos").

### Etapa 1 - Esvaziar

Três blocos, nesta ordem:

1. **Laços abertos (N).** Linha 1: o texto do laço (13px). Linha 2 (12px, cor secundária): "há 18 dias", e, com mais de uma
   fonte, "em 3 lugares" (o `title` lista os caminhos). Ações: `Fechar` (`.btn.primary`, `Check`), `Manter` (`.btn`,
   `Clock`), `Algum dia` (`.btn`, `CloudMoon`), `Virar projeto` (`.btn`, `FolderPlus`), `Virar tarefa` (`.btn`, `ListPlus`).
   "Virar projeto" abre, no próprio item, um campo com o nome (o texto do laço, selecionado) e "Criar". "Virar tarefa" abre um
   `Menu` com os projetos editáveis da etapa 2; sem nenhum, o botão fica desabilitado com o `title` "Nenhum projeto ativo em
   memory/.". Acima do bloco, "Mostrando 50 de 73" quando `total` passa de `maxItems`.
2. **Caixa de entrada (N).** Nome, caminho (mono 12px), "há N dias". Ações: `Abrir` (`.btn`, `FileText`) e `Arquivar`
   (`.btn`, `Archive`; arquiva na hora, com "Desfazer" no aviso). Sem arquivo em `memory/inbox/`: o bloco não aparece.
3. **Notas para revisar.** Só quando a contagem da C6 é maior que zero: uma linha com `Bell`, "N notas para revisar" e o link
   "Abrir Revisões".

Vazio (nenhum laço e nenhuma caixa de entrada): `CircleCheck` grande (32px), "Nada solto. Todo laço tem decisão." e "Próxima
etapa".

### Etapa 2 - Atualizar

**Projetos ativos (N)**, os de revisão vencida primeiro. Linha 1: título (13px, peso 600) e o selo de saúde dos painéis (ícone
e texto: "Atrasado", "Vence hoje", "Em revisão", "No prazo"). Linha 2 (12px): "Próxima ação: <texto>" ou, com
`AlertTriangle` e `--tone-warn`, "Sem próxima ação"; à direita, "revisado há 9 dias" e, quando `reviewDue`, o selo
"revisão vencida" (`CalendarClock`, `--tone-warn`). Linha 3: o campo "Próxima ação" (placeholder "O que é o próximo passo
concreto?") com "Adicionar" (`.btn.sm`). Ações: `Revisado` (`.btn.primary`, `Check`), `Concluído` (`.btn`, `CircleCheck`),
`Pausar` (`.btn`, `Pause`), `Abrir` (`.btn.ghost`, `FileText`).

Projeto fora de `memory/`: sem o campo e só `Revisado` e `Abrir`; acima delas, com `Lock`, a frase da tela "Revisões": "Fora de
memory/: a decisão fica no MordomoOS, o arquivo não muda."

Depois de "Revisado", o item não sai: fica na lista com o selo "revisado hoje" (`Check`, `--tone-ok`) e desce para o fim. Depois
de "Concluído" ou "Pausar", sai (para "Arquivar" ou "Algum dia"), com o aviso "Concluído: <título>." ou "Pausado: <título>." e
"Desfazer".

Vazio: `FolderOpen` grande, "Nenhum projeto ativo." e, abaixo, "Um laço vira projeto na etapa Esvaziar."

### Etapa 3 - Algum dia

Dois blocos: **Laços para algum dia (N)**, com `Fechar`, `Virar projeto`, `Virar tarefa` e `Manter em algum dia` (`.btn.ghost`,
não grava nada, só passa ao próximo); e **Projetos pausados (N)**, com `Reativar` (`.btn`, `Play`) e `Abrir`. Vazio:
`CloudMoon` grande e "Nada em algum dia."

### Etapa 4 - Arquivar

**Projetos concluídos (N)**, cada um com `Checkbox` marcada, título, caminho (mono 12px) e "concluído em 3/11". Os que estão fora
de `memory/` têm, no lugar do caminho de destino, "vira proposta" e o `Lock`. No topo, "Vão para memory/archive/ com desfazer.
Nada é apagado." Ação: "Arquivar N" (`.btn.primary`, `Archive`; desabilitado com 0 marcadas).

Resultado, no lugar da lista: "Arquivados: N." e, quando houver, "Pulados: N" com cada caminho e o motivo traduzido da faxina
("mudou", "não existe mais", "o destino já existe", "caminho com link"), "Abrir a lista de propostas" quando houver proposta, e
"Desfazer" (`.btn`). Desfeito: "Desfeito: N arquivos voltaram." Vazio: `Archive` grande e "Nenhum projeto concluído para
arquivar."

### Etapa 5 - Pronto

Três números grandes (20px) com o rótulo por baixo: "laços decididos", "projetos revisados", "arquivados", e uma linha com
"Ainda sem próxima ação: N" quando N > 0 (com `AlertTriangle`). Ação: "Concluir revisão". Concluída: `CircleCheck`, "Revisão da
semana concluída.", os números como ficaram e "Próximo lembrete: sexta, 13/11, 16:00" (ou "Lembrete semanal desligado." com o
link "Ligar em Configurações"). Aberta numa semana já concluída, a página abre nesta etapa com "Revisão desta semana concluída
em <dia>."

### Estados de toda etapa

- **Carregando:** spinner + "Carregando…" no lugar da lista; a barra de etapas já aparece.
- **Erro de leitura:** faixa `role="alert"` com `AlertTriangle`, "Não deu para carregar a revisão." e "Tentar de novo".
- **Erro de uma ação:** no item, "Não deu para salvar." e "Tentar de novo"; o item fica.
- **Conflito:** no item, com `AlertTriangle`, "A nota mudou desde que a lista foi carregada." e "Recarregar"; o item fica.
- **Laço que sumiu** (`404 loop_not_found`, outro lugar decidiu antes): o item sai com o aviso "Este laço já tinha decisão."

## Entradas

- **Barra de ferramentas do cérebro (moldura):** botão `.btn.sm` "Revisão semanal" com `CalendarCheck`, logo depois de
  "Revisões (N)". Com a semana concluída, o ícone vira `Check` e o `title` diz "Concluída em <dia>".
- **Menu da cena do cérebro (Núcleo):** a linha "Revisão semanal", abaixo da linha da faxina.
- **Paleta:** o comando "Revisão semanal" (en "Weekly review"), `global`.
- **Notificação `weeklyReview`:** o texto do AC 60 do `plan.md`; clicar abre `/brain/weekly`.

## Painel da nota - dobra "Menções sem link"

Uma `Fold` nova entre "Links" e "Relacionadas", título "Menções sem link (N)"; fechada por padrão quando N = 0. Cada item:
nome da nota de origem (13px, peso 600), o trecho (12px, até 160 caracteres) com o termo em `<mark>` (token `--accent` de
fundo, texto do token de texto), e à direita "Linkar" (`.btn.sm`, `Link2`) só quando `editable`. Clicar no item abre a origem
na vista de notas, rolada até a linha. Depois de "Linkar": o item sai e o aviso diz "Linkado em <nota>."; voltar atrás é
restaurar a versão anterior na dobra "Histórico" da nota de origem, como qualquer gravação. Embaixo, em 12px, "Procurando: <termo>, <termo>" (os `terms`), para o dono saber
o que é casado. Mais de 20: "Mostrando 20 de N".

Vazio: "Nenhuma menção sem link." Carregando: "Carregando…". Erro: a frase e "Tentar de novo". Sem nenhum termo de 4 caracteres
ou mais: "O nome desta nota é curto demais para procurar menções." e nada mais. Conflito ou `mention_gone`: no item, "A nota
mudou; a menção não está mais nessa linha." e "Recarregar".

## Lista de sentinelas (desktop)

Uma linha nova depois de "Revisões vencidas": "Revisão semanal", a descrição "Lembra uma vez por semana, no dia e hora
escolhidos, se a revisão ainda não foi feita." e o mesmo botão de ligar e desligar (`aria-pressed`) das outras linhas, sobre `settings.sentinels.weeklyReview.enabled` (emenda 2). Dia e hora não têm
controle nesta feature (o padrão do plano, pergunta 1); mudam por `PUT /api/settings`.

## Movimento

- O item decidido sai com transição de altura e opacidade de 150 ms; o foco vai ao próximo item.
- Trocar de etapa: o conteúdo entra deslizando 12px na direção do avanço com `opacity` (200 ms), como na faxina.
- Os números de "Pronto" sobem com `useTweenNumber` (300 ms).
- Tudo dentro de `@media (prefers-reduced-motion: no-preference)`; fora dela nada se move e os valores aparecem prontos. Nenhum
  estado depende do movimento: cada um tem texto.

## Texto (as duas línguas; as chaves entram em `locales/brain.ts`, `en` e `ptBR` com as mesmas chaves)

| Onde                                                                  | pt-BR                                                                                                                                                                         | en                                                                                                                                                        |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| título                                                                | Revisão semanal                                                                                                                                                               | Weekly review                                                                                                                                             |
| semana                                                                | Semana de {from} a {to}                                                                                                                                                       | Week of {from} to {to}                                                                                                                                    |
| etapas                                                                | Esvaziar · Atualizar · Algum dia · Arquivar · Pronto                                                                                                                          | Get clear · Get current · Someday · Archive · Done                                                                                                        |
| etapa em texto                                                        | Etapa {n} de 5 · {name}                                                                                                                                                       | Step {n} of 5 · {name}                                                                                                                                    |
| rodapé                                                                | Voltar · Próxima etapa · Concluir revisão                                                                                                                                     | Back · Next step · Finish review                                                                                                                          |
| bloco                                                                 | Laços abertos ({n})                                                                                                                                                           | Open loops ({n})                                                                                                                                          |
| idade                                                                 | há {n} dias                                                                                                                                                                   | {n} days ago                                                                                                                                              |
| fontes                                                                | em {n} lugares                                                                                                                                                                | in {n} places                                                                                                                                             |
| ações de laço                                                         | Fechar · Manter · Algum dia · Virar projeto · Virar tarefa · Criar                                                                                                            | Close · Keep · Someday · Make a project · Make a task · Create                                                                                            |
| sem projeto                                                           | Nenhum projeto ativo em memory/.                                                                                                                                              | No active project in memory/.                                                                                                                             |
| corte                                                                 | Mostrando {shown} de {total}                                                                                                                                                  | Showing {shown} of {total}                                                                                                                                |
| bloco                                                                 | Caixa de entrada ({n})                                                                                                                                                        | Inbox ({n})                                                                                                                                               |
| ações                                                                 | Abrir · Arquivar                                                                                                                                                              | Open · Archive                                                                                                                                            |
| notas da C6                                                           | {n} notas para revisar · Abrir Revisões                                                                                                                                       | {n} notes to review · Open Reviews                                                                                                                        |
| vazio 1                                                               | Nada solto. Todo laço tem decisão.                                                                                                                                            | Nothing loose. Every loop has a decision.                                                                                                                 |
| bloco                                                                 | Projetos ativos ({n})                                                                                                                                                         | Active projects ({n})                                                                                                                                     |
| próxima ação                                                          | Próxima ação: {text} · Sem próxima ação                                                                                                                                       | Next action: {text} · No next action                                                                                                                      |
| campo                                                                 | O que é o próximo passo concreto? · Adicionar                                                                                                                                 | What is the next concrete step? · Add                                                                                                                     |
| revisão                                                               | revisado há {n} dias · revisão vencida · revisado hoje · nunca revisado                                                                                                       | reviewed {n} days ago · review due · reviewed today · never reviewed                                                                                      |
| ações de projeto                                                      | Revisado · Concluído · Pausar · Abrir                                                                                                                                         | Reviewed · Done · Pause · Open                                                                                                                            |
| avisos                                                                | Concluído: {title}. · Pausado: {title}. · Fechado. · Mantido até segunda. · Foi para algum dia. · Projeto criado: {title}. · Tarefa adicionada em {title}. · Desfazer · Abrir | Done: {title}. · Paused: {title}. · Closed. · Kept until Monday. · Moved to someday. · Project created: {title}. · Task added to {title}. · Undo · Open   |
| vazio 2                                                               | Nenhum projeto ativo. · Um laço vira projeto na etapa Esvaziar.                                                                                                               | No active project. · A loop becomes a project in Get clear.                                                                                               |
| bloco                                                                 | Laços para algum dia ({n}) · Projetos pausados ({n})                                                                                                                          | Someday loops ({n}) · Paused projects ({n})                                                                                                               |
| ações                                                                 | Manter em algum dia · Reativar                                                                                                                                                | Keep for someday · Reactivate                                                                                                                             |
| vazio 3                                                               | Nada em algum dia.                                                                                                                                                            | Nothing in someday.                                                                                                                                       |
| bloco                                                                 | Projetos concluídos ({n})                                                                                                                                                     | Finished projects ({n})                                                                                                                                   |
| arquivo                                                               | concluído em {day} · vira proposta · Vão para memory/archive/ com desfazer. Nada é apagado. · Arquivar {n}                                                                    | done on {day} · becomes a proposal · They go to memory/archive/ with undo. Nothing is deleted. · Archive {n}                                              |
| resultado                                                             | Arquivados: {n}. · Pulados: {n} · Abrir a lista de propostas · Desfeito: {n} arquivos voltaram.                                                                               | Archived: {n}. · Skipped: {n} · Open the proposal list · Undone: {n} files are back.                                                                      |
| vazio 4                                                               | Nenhum projeto concluído para arquivar.                                                                                                                                       | No finished project to archive.                                                                                                                           |
| números                                                               | laços decididos · projetos revisados · arquivados · Ainda sem próxima ação: {n}                                                                                               | loops decided · projects reviewed · archived · Still without a next action: {n}                                                                           |
| pronto                                                                | Revisão da semana concluída. · Revisão desta semana concluída em {day}. · Próximo lembrete: {when} · Lembrete semanal desligado. · Ligar em Configurações                     | This week's review is done. · This week's review was finished on {day}. · Next reminder: {when} · Weekly reminder is off. · Turn on in Settings           |
| erros                                                                 | Não deu para carregar a revisão. · Não deu para salvar. · Tentar de novo · A nota mudou desde que a lista foi carregada. · Recarregar · Este laço já tinha decisão.           | Could not load the review. · Could not save. · Try again · The note changed since the list was loaded. · Reload · This loop already had a decision.       |
| carregando                                                            | Carregando…                                                                                                                                                                   | Loading…                                                                                                                                                  |
| status                                                                | {n} laços abertos                                                                                                                                                             | {n} open loops                                                                                                                                            |
| fora de memory/                                                       | Fora de memory/: a decisão fica no MordomoOS, o arquivo não muda. (a chave da C6)                                                                                             | Outside memory/: the decision stays in MordomoOS; the file does not change. (the C6 key)                                                                  |
| botão da barra                                                        | Revisão semanal · Concluída em {day}                                                                                                                                          | Weekly review · Finished on {day}                                                                                                                         |
| notificação                                                           | Hora da revisão semanal: {loops} laços abertos, {projects} projetos para revisar.                                                                                             | Time for the weekly review: {loops} open loops, {projects} projects to review.                                                                            |
| sentinela                                                             | Revisão semanal · Lembra uma vez por semana, no dia e hora escolhidos, se a revisão ainda não foi feita.                                                                      | Weekly review · Reminds you once a week, on the chosen day and hour, if the review is not done yet.                                                       |
| dobra                                                                 | Menções sem link ({n}) · Linkar · Procurando: {terms}                                                                                                                         | Unlinked mentions ({n}) · Link · Looking for: {terms}                                                                                                     |
| dobra, estados                                                        | Nenhuma menção sem link. · O nome desta nota é curto demais para procurar menções. · Linkado em {note}. · A nota mudou; a menção não está mais nessa linha.                   | No unlinked mention. · This note's name is too short to look for mentions. · Linked in {note}. · The note changed; the mention is no longer on that line. |
| linha do diário (só pt-BR, como as outras linhas que o motor escreve) | Revisão semanal de {week}: {loops} laços decididos, {projects} projetos revisados, {archived} arquivados.                                                                     | -                                                                                                                                                         |

## Emendas depois da aprovação

1. **13/11/2026, decisão do dono** (achado 1 da rodada 1 de `verification.md`): o aviso com ação ("Fechado." com
   "Desfazer" por 8 s, "Projeto criado: …" com "Abrir", e os outros) é a linha `role="status"` da própria página, entre o
   conteúdo da etapa e o rodapé, como na tela "Revisões" da `cerebro-natureza`, e não o `Toast` das primitivas. A linha
   da tabela de fontes que dizia `Toast` passa a dizer isso. Checado por C102.
2. **13/11/2026, decisão do dono** (item 10 da rodada 1 de `verification.md`, a linha da sentinela): a linha "Revisão
   semanal" da lista de sentinelas usa o mesmo botão de ligar e desligar (`aria-pressed`) das outras linhas, como o
   Observable do plano pede ("liga e desliga como a de `reviewDue`"), e não a primitiva `Switch`. Checado por C95.
