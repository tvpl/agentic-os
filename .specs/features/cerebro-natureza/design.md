# Cérebro: natureza da informação — design das telas (binding para a feature)

Decide a tela "Revisões" (lista do que venceu e aba "Sem classificação"), o diálogo "Virou realidade", os selos e filtros de
natureza na busca e no preview do cérebro, o texto de cada um nas duas línguas e o bloco que os agentes leem. Ficam fora
daqui: o desenho do grafo e do Núcleo (não mudam), o formato do cabeçalho e das passagens (é do `plan.md`, doors 1 e 2) e a
resposta segregada numa tela de pergunta (é de `cerebro-perguntar`).

## Binding sources

| Source                                                            | O que decide                                                                                                                                                                                  |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.specs/features/design-system/design.md`                         | piso de 12px, texto corrido a 13px, cor só por token (stylelint), estado nunca só por cor (ícone e texto), axe sem `serious`/`critical`, a galeria cobre as duas camadas                      |
| `.specs/features/primitivas/design.md`                            | o diálogo "Virou realidade" e o menu "Adiar" são `Modal` e `Menu` das primitivas; os filtros são botões com `aria-pressed`; nenhum CSS fora de `ui/ui.css` desenha parte de primitiva         |
| `.specs/features/comandos-atalhos/design.md`                      | "Revisões" é um comando do registro (`global`, na paleta); as teclas da lista (`j`/`k`, `v` = Ainda vale, `a` = Adiar) são do escopo `view:reviews`; uma tecla nua não age dentro de um campo |
| `.specs/features/moldura-app/design.md` (Tela do Segundo Cérebro) | a lista é uma página da moldura (lista à esquerda, detalhe à direita, chat fixo); o botão "Revisões (N)" entra na barra de ferramentas do cérebro e usa `.btn.sm`                             |
| `.specs/features/cerebro-v2/design.md` (Editor de nota)           | "Atualizar" abre o editor de nota (ou a vista de notas de `cerebro-vista-notas`, quando existir) com o mesmo estado de salvamento e de conflito                                               |
| `.specs/features/limpeza-legado/design.md`                        | um só renderizador de Markdown (`components/Markdown.tsx`): o trecho mostrado no detalhe passa por ele; nada de CSS ou chave de tradução sem uso                                              |

## Selo de natureza

Um selo é ícone + texto, sempre os dois; a cor é de apoio. Tokens de cor por natureza saem do conjunto existente
(`--tone-ok`, `--tone-info`, `--tone-warn`, `--tone-muted`, `--accent`), sem cor nova.

| Natureza   | Texto (pt-BR / en)                                  | Ícone (lucide)  | Token          |
| ---------- | --------------------------------------------------- | --------------- | -------------- |
| `fato`     | Fato / Fact                                         | `CircleCheck`   | `--tone-ok`    |
| `relato`   | Relato / Report                                     | `FileText`      | `--tone-muted` |
| `plano`    | Plano — ainda não é realidade / Plan — not yet real | `Compass`       | `--tone-info`  |
| `hipotese` | Hipótese / Hypothesis                               | `FlaskConical`  | `--tone-warn`  |
| `opiniao`  | Opinião / Opinion                                   | `MessageCircle` | `--accent`     |
| (nenhuma)  | Não classificado / Unclassified                     | `CircleDashed`  | `--tone-muted` |

O escopo é um segundo selo menor, só texto: Pessoal / Personal, Equipe / Team, Externo / External. "Abandonado em
AAAA-MM-DD" é um terceiro selo com `Archive`. Em listas densas (busca de 8 resultados) o selo do plano mostra só "Plano" e o
`title` do selo diz o resto.

## Tela - Revisões

Página `/brain/reviews` na moldura; no Núcleo, o mesmo conteúdo num painel de cena aberto pela paleta. Duas abas (`Tabs` das
primitivas): "Para revisar (N)" e "Sem classificação (N)".

- **Cabeçalho:** título "Revisões", à direita os filtros "Natureza" (seis botões com o selo) e "Escopo" (três), e o contexto
  ativo como texto ("Contexto: Projeto X · Todo o cérebro"), com o atalho de `cerebro-contextos` para trocar.
- **Lista (esquerda):** um item por arquivo, o mais velho primeiro. Linha 1: nome da nota (13px, peso 600) e o selo de
  natureza. Linha 2 (12px, cor secundária): caminho relativo, "revisado há 4 meses" (ou "nunca revisado · alterado há 5
  meses") e o selo de escopo. Foco visível; `j`/`k` movem; `Enter` abre o detalhe.
- **Detalhe (direita):** o trecho do começo da nota (até 600 caracteres, pelo renderizador único) e, para um arquivo com
  passagens, a lista das passagens com seu selo. Abaixo, as ações em uma fileira:
  `Ainda vale` (`.btn.primary`, `Check`), `Atualizar` (`.btn`, `PencilLine`), `Virou realidade` (`.btn`, `CircleCheck`; só para
  `plano` e `hipotese`), `Mudei de ideia` (`.btn`, `Archive`), `Adiar` (`Menu`: 7, 14, 30, 90 dias), `Não cobrar mais`
  (`.btn.ghost`, `BellOff`).
- **Arquivo fora de `memory/`:** só `Ainda vale`, `Adiar` e `Não cobrar mais`; acima delas, com `Lock`: "Fora de memory/: a
  decisão fica no MordomoOS, o arquivo não muda."
- **Depois de decidir:** o item sai com transição de altura e opacidade de 150 ms (nenhuma com `prefers-reduced-motion`), o
  foco vai ao próximo item, e o aviso "Marcado como ainda vale." (ou o texto da ação) fica 8 s com "Desfazer". O estado da
  lista é anunciado em `role="status"` ("3 itens para revisar").
- **Conflito:** no item, com `AlertTriangle`, "A nota mudou desde que a lista foi carregada." e "Recarregar"; o item fica.
- **Vazio:** `CircleCheck` grande (32px), "Nada para revisar hoje." e, abaixo, "Próxima revisão em 12 dias" (ou nada, se não
  houver). **Carregando:** spinner + "Carregando…". **Erro:** mensagem + "Tentar de novo".
- **Aba Sem classificação:** a mesma lista; no detalhe, "Sugestão: Plano" (o selo) com "Confirmar", os cinco selos como
  botões para escolher outra, e "Não classificar" (esconde por 90 dias). Sem sugestão: "Sem sugestão" e os cinco botões.

## Diálogo - Virou realidade

`Modal` de 480px. Título "Virou realidade". Campo "Desde" (`<input type="date">`, hoje). Seção opcional, fechada por
padrão, "Registrar como fato" com três campos: "O quê" (sujeito), "Atributo" (predicado), "Valor" (objeto), cada um até 200
caracteres. Rodapé: "Cancelar" e "Confirmar" (`.btn.primary`). Erro de gravação no corpo do diálogo, que fica aberto.

## Busca e preview do cérebro

- Cada resultado da busca (as duas telas) ganha o selo de natureza à direita do nome.
- Acima da lista, uma fileira de filtros de natureza (os seis selos como botões com `aria-pressed`), escondida até a pessoa
  abrir "Filtros"; o filtro vai na consulta (`natureza=`).
- O preview mostra os selos de natureza e de escopo na fileira de selos que já existe, e um botão "Revisar agora" que leva ao
  item em "Revisões".
- A barra de ferramentas do cérebro ganha "Revisões (N)" quando N > 0.

## Texto do bloco para os agentes

Vai no `AGENTS.md`/`CLAUDE.md` compilado (depois das regras gerais) e no prompt das execuções com acesso à memória:

```
## Natureza da informação
- Cada nota ou trecho pode ter `natureza`: fato, relato, plano, hipotese ou opiniao (e `escopo`: pessoal, equipe, externo).
- Plano, hipótese e opinião não são a realidade. Nunca os apresente como fato; diga "está planejado", "a hipótese é", "na opinião de".
- Ao citar, diga a natureza do que cita. Trecho sem natureza é "não classificado": diga isso quando a resposta depender dele.
- Para só fatos, use o recall com `natureza=fato`.
- Uma nota com `status: archived` e `abandoned` é uma ideia abandonada: não a trate como intenção atual.
```

## Texto (as duas línguas; as chaves entram em `locales/brain.ts`, `en` e `ptBR` com as mesmas chaves)

| Chave                             | pt-BR                                                             | en                                                                          |
| --------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `reviews.title`                   | Revisões                                                          | Reviews                                                                     |
| `reviews.tab.due`                 | Para revisar ({n})                                                | To review ({n})                                                             |
| `reviews.tab.unclassified`        | Sem classificação ({n})                                           | Unclassified ({n})                                                          |
| `reviews.keep`                    | Ainda vale                                                        | Still holds                                                                 |
| `reviews.update`                  | Atualizar                                                         | Update                                                                      |
| `reviews.becameFact`              | Virou realidade                                                   | Became real                                                                 |
| `reviews.abandon`                 | Mudei de ideia                                                    | Changed my mind                                                             |
| `reviews.snooze`                  | Adiar                                                             | Snooze                                                                      |
| `reviews.snooze.days`             | {n} dias                                                          | {n} days                                                                    |
| `reviews.never`                   | Não cobrar mais                                                   | Stop reminding                                                              |
| `reviews.readonly`                | Fora de memory/: a decisão fica no MordomoOS, o arquivo não muda. | Outside memory/: the decision stays in MordomoOS; the file does not change. |
| `reviews.age.reviewed`            | revisado há {age}                                                 | reviewed {age} ago                                                          |
| `reviews.age.never`               | nunca revisado · alterado há {age}                                | never reviewed · changed {age} ago                                          |
| `reviews.empty`                   | Nada para revisar hoje.                                           | Nothing to review today.                                                    |
| `reviews.next`                    | Próxima revisão em {n} dias                                       | Next review in {n} days                                                     |
| `reviews.conflict`                | A nota mudou desde que a lista foi carregada.                     | The note changed since the list was loaded.                                 |
| `reviews.reload`                  | Recarregar                                                        | Reload                                                                      |
| `reviews.undo`                    | Desfazer                                                          | Undo                                                                        |
| `reviews.done.keep`               | Marcado como ainda vale.                                          | Marked as still holding.                                                    |
| `reviews.suggestion`              | Sugestão: {natureza}                                              | Suggestion: {natureza}                                                      |
| `reviews.confirm`                 | Confirmar                                                         | Confirm                                                                     |
| `reviews.noClassify`              | Não classificar                                                   | Don't classify                                                              |
| `reviews.fact.since`              | Desde                                                             | Since                                                                       |
| `reviews.fact.record`             | Registrar como fato                                               | Record as a fact                                                            |
| `reviews.fact.subject`            | O quê                                                             | What                                                                        |
| `reviews.fact.predicate`          | Atributo                                                          | Attribute                                                                   |
| `reviews.fact.object`             | Valor                                                             | Value                                                                       |
| `reviews.notification`            | {n} itens para revisar                                            | {n} items to review                                                         |
| `nature.fato` … `nature.none`     | os textos da tabela "Selo de natureza"                            | idem                                                                        |
| `scope.pessoal` … `scope.externo` | Pessoal, Equipe, Externo                                          | Personal, Team, External                                                    |
