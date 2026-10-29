# Cérebro: faxina guiada — design das telas (binding para a feature)

Decide a tela que a feature cria (o assistente de faxina, em cinco etapas), os três lugares de onde ele abre, o texto nas duas
línguas e o movimento. Ficam fora daqui: o grafo, a vista de notas e o seletor de contexto em si (são de `cerebro-correcoes`,
`cerebro-vista-notas` e `cerebro-contextos`; esta feature só acrescenta uma entrada no menu do seletor), o formato do arquivo e
do manifesto (é do `plan.md`).

## Binding sources

| Source                                                            | O que decide                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.specs/features/design-system/design.md`                         | piso de 12px, texto corrido a 13px, cor só por token (stylelint), estado nunca só por cor (ícone e texto), axe sem `serious`/`critical`, a galeria cobre as duas camadas                                                                                                                                                              |
| `.specs/features/primitivas/design.md`                            | o assistente é `Modal` (Radix `Dialog`): foco entra, o resto fica inerte, o foco volta a quem abriu, Esc fecha o de cima; os grupos de achados são `Tabs`; nenhum CSS fora de `ui/ui.css` desenha parte de primitiva; toda animação de `ui.css` mora dentro de `@media (prefers-reduced-motion: no-preference)` (C15 de `primitivas`) |
| `.specs/features/comandos-atalhos/design.md`                      | "Faxina guiada" é um comando do registro (`global`, na paleta); nenhum ouvinte de teclado novo fora do registro; uma tecla nua não age dentro de um campo                                                                                                                                                                             |
| `.specs/features/moldura-app/design.md` (Tela do Segundo Cérebro) | o botão de entrada fica na fileira de ações da tela e usa `.btn.sm`                                                                                                                                                                                                                                                                   |
| `.specs/features/cerebro-v2/design.md`                            | o padrão de estado de erro (mensagem + "Tentar de novo"), de carregando (spinner + texto) e de progresso por fase em texto                                                                                                                                                                                                            |
| `apps/command-centre/src/desktop/useTweenNumber.ts`               | os números que sobem: o mesmo gancho, que devolve o valor final de uma vez sob `prefers-reduced-motion: reduce`                                                                                                                                                                                                                       |

## Tela - Assistente de faxina

`Modal` largo (até 960px, altura até 88vh), o mesmo nos dois shells. Aberto de três lugares, sempre com um escopo:

- o menu do seletor de contexto: "Fazer faxina neste contexto";
- a paleta: "Faxina guiada" (abre na etapa "Escopo", com o contexto ativo preselecionado, se houver);
- a fileira de ações da tela do Segundo Cérebro (moldura) e o menu da cena do cérebro (Núcleo): "Faxina".

Cabeçalho fixo: o título "Faxina guiada", o escopo (nome do contexto ou caminho da pasta, mono 12px) e a barra de etapas: cinco
círculos numerados ligados por uma linha, cada um com o nome por baixo; a etapa atual tem o número em destaque e
`aria-current="step"`; as concluídas têm o ícone `Check`. A etapa atual também aparece em texto: "Etapa 2 de 5 · O que tem
aqui". Rodapé fixo: "Voltar" (`.btn`), a ação da etapa (`.btn.primary`) e, à esquerda, "Fechar".

### Etapa 1 - Escopo

Lista dos contextos (nome, caminho principal, número de arquivos) e um campo "Ou uma pasta…" com o seletor de pastas indexadas.
Um item escolhido mostra a linha "N arquivos, última mudança há D dias". Ação: "Ver o que tem aqui". Sem contextos e sem pastas
indexadas: "Nada indexado ainda. Adicione uma pasta em Configurações › Pastas." e nenhuma ação.

### Etapa 2 - O que tem aqui

Grade de cartões (duas colunas em tela larga, uma em estreita), cada um com título 12px em maiúsculas pequenas e o número grande
(20px) que sobe de zero:

- **Arquivos**: total e bytes;
- **Por tipo**: barras horizontais por grupo (notas, texto, PDF, imagem, código, outros), cada barra com o número ao lado;
- **Idade**: quatro colunas (até 30 dias, 31-90, 91-365, mais de um ano), a altura proporcional e o número em cima; a coluna
  "mais de um ano" usa o token de aviso e o texto "parados" ao lado do número;
- **Maiores pastas**: as dez, nome e tamanho, cada uma com uma barra fina;
- **Grupos**: até doze pílulas com o nome do grupo (subpasta ou os três termos) e a contagem.

Enquanto carrega: o esqueleto dos cartões com spinner + "Lendo o índice…". Ação: "Procurar o que decidir" (inicia a varredura);
enquanto roda, a fase em texto e `done/total` abaixo dos cartões, com uma barra de progresso e "Cancelar".

### Etapa 3 - Achados

`Tabs` por tipo, na ordem: Duplicatas, Quase iguais, Parados, Órfãs, Links quebrados, Pastas vazias, Grandes, Sem título; cada aba
com a contagem (`Parados (14)`); abas sem achado não aparecem. Dentro da aba, cartões empilhados, um por achado:

- linha 1: o ícone do tipo e a frase do motivo ("Não muda há 410 dias.", "92% igual a `plano-v2.md`.");
- os arquivos: nome, pasta, idade, tamanho; em "Juntar", um botão de rádio por arquivo ("Manter este"), o mais novo marcado;
- as respostas como botões de uma fileira: "Manter", "Arquivar", "Juntar" (só duplicatas e quase iguais), "Revisar depois",
  "Não sei"; a escolhida fica marcada com ícone e texto, e o cartão encolhe e desliza para baixo da pilha ("Respondido");
- no topo da aba: "Aplicar a todos deste tipo" com as mesmas respostas, e a contagem "8 de 14 respondidos".

Abaixo das abas, a caixa "O que importa aqui?" (`<textarea>` de três linhas, 13px), com o texto de apoio "Vai para a nota-resumo
do contexto." e "Guardar"; desabilitada com a razão quando o escopo não tem nota-resumo. Ação da etapa: "Conferir mudanças".

Sem achados: o ícone `Sparkles`, "Nada para decidir aqui. Este contexto está em ordem." e a ação "Fechar".

### Etapa 4 - Conferir

Lista agrupada em "Vai para o arquivo (N)" e "Propostas para você fazer (N)" (arquivos fora de `memory/`), uma linha por arquivo:
origem (mono 12px), seta, destino (mono 12px) ou "proposta", e a decisão em texto. Totais no topo. Ação: "Aplicar". Sem nada a
mudar (tudo "Manter" ou "Não sei"): "Nenhuma mudança a aplicar. As respostas ficaram guardadas." e a ação "Fechar".

### Etapa 5 - Pronto

Três números (movidos, pulados, propostas), a lista dos pulados com o motivo traduzido (`changed` → "mudou depois da
varredura", `missing` → "não existe mais", `exists` → "o destino já existe", `forbidden_path` → "caminho com link"), o link
"Abrir a lista de propostas" quando houver, e "Desfazer" (`.btn`) ao lado de "Fechar" (`.btn.primary`). Desfeito: "Desfeito: N
arquivos voltaram." e os pulados do desfazer com o motivo.

### Estados de erro

Falha de inventário, de varredura, de guardar resposta ou de aplicar: faixa `role="alert"` na etapa, ícone `AlertTriangle`, a
frase da tabela de texto e "Tentar de novo"; as respostas já guardadas ficam. Varredura cancelada: "Varredura cancelada." e a
ação "Procurar de novo".

## Movimento

- Os números dos cartões sobem com `useTweenNumber` (300 ms); as barras e colunas crescem da base (`transform: scaleY`/`scaleX`,
  240 ms, `ease-out`), uma depois da outra com 40 ms de atraso.
- Trocar de etapa: o conteúdo entra deslizando 12px na direção do avanço com `opacity` (200 ms).
- Um cartão respondido encolhe para uma linha e vai para baixo da pilha (200 ms).
- Tudo dentro de `@media (prefers-reduced-motion: no-preference)`; fora dela, nada se move e os valores aparecem prontos. Nenhum
  estado depende do movimento: cada um tem texto.

## Texto (as duas línguas; as chaves entram em `locales/brain.ts`, `en` e `ptBR` com as mesmas chaves)

| Chave                      | pt-BR                                                      | en                                                |
| -------------------------- | ---------------------------------------------------------- | ------------------------------------------------- |
| `cleanup.title`            | Faxina guiada                                              | Guided cleanup                                    |
| `cleanup.step.scope`       | Escopo                                                     | Scope                                             |
| `cleanup.step.inventory`   | O que tem aqui                                             | What is here                                      |
| `cleanup.step.findings`    | Achados                                                    | Findings                                          |
| `cleanup.step.review`      | Conferir                                                   | Review                                            |
| `cleanup.step.done`        | Pronto                                                     | Done                                              |
| `cleanup.stepOf`           | Etapa {n} de 5 · {name}                                    | Step {n} of 5 · {name}                            |
| `cleanup.phase.inventory`  | Lendo o índice                                             | Reading the index                                 |
| `cleanup.phase.signatures` | Calculando assinaturas                                     | Computing signatures                              |
| `cleanup.phase.links`      | Conferindo links                                           | Checking links                                    |
| `cleanup.phase.findings`   | Separando achados                                          | Sorting findings                                  |
| `cleanup.answer.keep`      | Manter                                                     | Keep                                              |
| `cleanup.answer.archive`   | Arquivar                                                   | Archive                                           |
| `cleanup.answer.merge`     | Juntar                                                     | Merge                                             |
| `cleanup.answer.snooze`    | Revisar depois                                             | Review later                                      |
| `cleanup.answer.unsure`    | Não sei                                                    | Not sure                                          |
| `cleanup.applyAll`         | Aplicar a todos deste tipo                                 | Apply to all of this kind                         |
| `cleanup.matters`          | O que importa aqui?                                        | What matters here?                                |
| `cleanup.matters.help`     | Vai para a nota-resumo do contexto.                        | Goes into the context's brief note.               |
| `cleanup.matters.none`     | Este escopo não tem nota-resumo.                           | This scope has no brief note.                     |
| `cleanup.empty`            | Nada para decidir aqui. Este contexto está em ordem.       | Nothing to decide here. This context is in order. |
| `cleanup.noChanges`        | Nenhuma mudança a aplicar. As respostas ficaram guardadas. | No changes to apply. Your answers were saved.     |
| `cleanup.saveFailed`       | Não foi possível guardar a resposta.                       | Could not save the answer.                        |
| `cleanup.failed`           | A faxina falhou.                                           | The cleanup failed.                               |
| `cleanup.cancelled`        | Varredura cancelada.                                       | Scan cancelled.                                   |
| `cleanup.undone`           | Desfeito: {n} arquivos voltaram.                           | Undone: {n} files are back.                       |
| `cleanup.retry`            | Tentar de novo                                             | Try again                                         |
