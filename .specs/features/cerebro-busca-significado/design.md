# Cérebro: busca por significado — design da tela (binding para a feature)

Decide o bloco "Busca por significado" de Configurações › Memória: as três opções de provedor, o gerenciador de modelos
(baixar, cancelar, remover, aceitar a licença), o bloco do servidor próprio com "Testar conexão", a linha do reranker, as
confirmações, os estados, o texto nas duas línguas e o movimento. Ficam fora daqui: o texto que o MCP e o terminal imprimem na
abstenção e o formato do arquivo de avaliação (são do `plan.md`, doors 4 e 6), o resto da aba Memória (pastas indexadas, não
muda) e o comando `mordomo eval` (não tem tela).

## Binding sources

| Source                                                                     | O que decide                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.specs/features/design-system/design.md`                                  | piso de 12px, texto corrido a 13px, cor só por token (stylelint), estado nunca só por cor (ícone e texto), axe sem `serious`/`critical`, a galeria cobre as duas camadas                                                                                                                                  |
| `.specs/features/primitivas/design.md`                                     | a licença Gemma abre um `Modal`; "Remover" e a troca de provedor usam a confirmação das primitivas (`useConfirm`); `Field` leva rótulo, dica e erro; nenhum CSS fora de `ui/ui.css` desenha parte de primitiva; toda animação de `ui.css` mora dentro de `@media (prefers-reduced-motion: no-preference)` |
| `apps/command-centre/src/views/settings/memory.tsx`                        | o bloco é um segundo `.card.stack` na aba Memória, abaixo do card das pastas indexadas, com o mesmo padrão de `Field` e de `Button`                                                                                                                                                                       |
| `.specs/features/cerebro-faxina-guiada/design.md` (Etapa 2)                | a barra de progresso com o número em texto ("N de M") e o gancho `useTweenNumber` para os números que sobem                                                                                                                                                                                               |
| `.specs/features/cerebro-natureza/design.md` e `cerebro-rituais/design.md` | o estado de erro (mensagem e "Tentar de novo"), o de carregando (spinner e "Carregando…"), o cadeado com o motivo de uma opção que não vale e o `role="status"` para o estado lido por leitor de tela                                                                                                     |
| `.specs/features/limpeza-legado/design.md`                                 | nada de CSS ou chave de tradução sem uso                                                                                                                                                                                                                                                                  |

## Bloco - Busca por significado

Um `.card.stack` com cinco partes, nesta ordem, dentro da aba Memória (a mesma nos dois shells):

1. **Cabeçalho.** Título "Busca por significado" (13px, peso 600); à direita o estado em texto com ícone, "Ligada"
   (`CircleCheck`, `--tone-ok`) ou "Desligada" (`CircleDashed`, `--tone-muted`), e o botão liga/desliga de
   `memory.embeddings.enabled` (o mesmo botão `aria-pressed` das linhas de sentinelas). Abaixo, uma frase de apoio (12px,
   cor secundária).
2. **Provedor.** Três opções em grupo de rádio (`role="radiogroup"`, uma seleção), cada uma com título (13px, peso 600) e uma
   linha de descrição (12px): "Palavras e vetor simples", "Servidor seu" e "Modelo neste computador". A escolhida mostra
   o ícone `CircleDot` e o texto "Em uso"; as outras, `Circle`. Uma opção que não vale fica desabilitada, com `Lock` e o
   motivo em texto abaixo da descrição.
3. **Detalhe do provedor escolhido**, um dos três:
   - **Palavras e vetor simples:** só a frase "Funciona sem baixar nada e sem rede. Entende plurais e variações de grafia,
     não sinônimos."
   - **Servidor seu:** `Field`s "Endereço" (mono), "Modelo", "Dimensões" (número) e "Variável da chave" (mono), a caixa
     "Permitir servidor fora deste computador" com o aviso em `--tone-warn` e `AlertTriangle` ao lado, e o botão "Testar
     conexão" (`.btn`, `Plug`) com o resultado em texto logo depois.
   - **Modelo neste computador:** a lista de modelos do catálogo (abaixo) e, embaixo dela, o bloco "Releitura mais cuidadosa
     (reranker)".
4. **Estado do índice** (só com a busca ligada): uma linha de 12px, "N seções indexadas com <modelo>" (ou "com o vetor
   simples"), o erro da última passada em texto quando houver (`index.semantic_error`) e o ícone `AlertTriangle`.
5. **Rodapé do bloco:** o link de ajuda "Como instalar o Ollama" que abre o guia `docs/memory-guide.md` (a seção da busca por
   significado, escrita nesta feature).

### Lista de modelos

Uma linha por modelo do catálogo, na ordem do catálogo. Linha 1: nome (13px, peso 600), o selo "Recomendado" no modelo marcado
e o tipo ("Embedding" ou "Reranker"). Linha 2 (12px, cor secundária): "209 MB · 768 dimensões · licença Gemma" (o tamanho em MB e
o nome da licença), e à direita o estado em texto com ícone: "Não baixado" (`CircleDashed`), "Baixando: 120 de 209 MB"
(`Download`), "Pronto" (`CircleCheck`, `--tone-ok`) ou "Falhou: <motivo>" (`AlertTriangle`, `--tone-warn`). Ações à direita:
`Baixar` (`.btn.primary`, `Download`) em "Não baixado" e "Falhou" (com o rótulo "Tentar de novo" neste), `Cancelar` (`.btn`,
`X`) em "Baixando", `Remover` (`.btn.ghost`, `Trash2`) em "Pronto" (desabilitado no modelo em uso, com o `title` "Em uso:
troque o provedor antes de remover.") e `Usar este modelo` (`.btn`, `Check`) em "Pronto" quando não é o ativo.

Enquanto baixa: a barra de progresso abaixo da linha 2 (a da faxina, `role="progressbar"` com `aria-valuenow`), o número em
texto à direita e a leitura do estado a cada 1 s.

### Diálogo - Licença do modelo

`Modal` aberto por "Baixar" quando `license.acceptRequired`: título "Termos do modelo", o nome da licença (ex. "Gemma Terms of
Use") e seu link (abre fora), a frase "O MordomoOS não distribui este modelo: ele é baixado do repositório do autor para o seu
computador, sob estes termos.", a caixa nativa "Li e aceito os termos" (desmarcada) e as ações "Cancelar" e "Baixar"
(`.btn.primary`, desabilitado até marcar a caixa). Foco entra na caixa; Esc cancela.

### Bloco - Releitura mais cuidadosa (reranker)

Só dentro de "Modelo neste computador". Uma linha com o botão liga/desliga de `memory.recall.rerank.enabled` (desligado por
padrão, habilitado só com um reranker "Pronto") e o texto "Mais lento: cerca de meio segundo por seção candidata. Só vale
para agentes." Abaixo, a linha do modelo do reranker na mesma lista de modelos.

### Confirmações

- **Trocar provedor, modelo ou dimensões com índice pronto:** `useConfirm` com o título "Recalcular o índice?", o corpo "As N
  seções serão calculadas de novo." e, só no servidor próprio, "Seus textos serão enviados de novo para <endereço>."; ação
  "Continuar", e nada é salvo antes dela.
- **Remover um modelo:** `useConfirm` com "Remover <nome>?", o corpo "Libera X MB. Você pode baixar de novo." e a ação "Remover"
  (`danger`).

### Estados

- **Carregando:** spinner e "Carregando…" no lugar da lista de modelos; o cabeçalho e as opções já aparecem.
- **Erro de leitura:** faixa `role="alert"` com `AlertTriangle`, "Não deu para carregar os modelos." e "Tentar de novo".
- **Sem runtime** (macOS Intel): a opção "Modelo neste computador" desabilitada com `Lock` e "Este computador não tem o runtime do
  modelo local (macOS Intel). Use um servidor seu."
- **Nenhum modelo baixado:** a lista mostra os modelos "Não baixado" e, acima, "Escolha um modelo para baixar. O download
  não começa sem o seu pedido."
- **Download falho:** o estado "Falhou: soma de verificação diferente" (`checksum`), "Falhou: endereço fora da lista"
  (`host_not_allowed`) ou "Falhou: <erro de rede>", com "Tentar de novo".
- **Teste de conexão:** "Testando…" com spinner; depois "OK: 768 dimensões, 143 ms" (`CircleCheck`, `--tone-ok`) ou "Falhou:
  <tipo>" (`AlertTriangle`, `--tone-warn`) com o tipo traduzido (`timeout`, `status`, `dimension`, `malformed`, `network`,
  `local_crashed`).
- **Troca em andamento:** depois de "Continuar", o estado do índice mostra "Recalculando…" com spinner até a passada acabar.

## Movimento

- A barra de progresso cresce da esquerda (`transform: scaleX`, 240 ms, `ease-out`); o número do progresso sobe com
  `useTweenNumber` (300 ms).
- Trocar a opção de provedor: o detalhe novo entra com `opacity` (200 ms).
- Tudo dentro de `@media (prefers-reduced-motion: no-preference)`; fora dela nada se move e os valores aparecem prontos.
  Nenhum estado depende do movimento: cada um tem texto.

## Texto (as duas línguas; as chaves entram em `locales/brain.ts`, `en` e `ptBR` com as mesmas chaves)

| Onde              | pt-BR                                                                                                                                                            | en                                                                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| título            | Busca por significado                                                                                                                                            | Search by meaning                                                                                                                                                             |
| apoio             | Acha a nota que responde mesmo quando ela não usa as mesmas palavras da pergunta.                                                                                | Finds the note that answers even when it does not use the words of the question.                                                                                              |
| estado            | Ligada · Desligada                                                                                                                                               | On · Off                                                                                                                                                                      |
| opção 1           | Palavras e vetor simples · Funciona sem baixar nada e sem rede. Entende plurais e variações de grafia, não sinônimos.                                            | Words and simple vector · Works with no download and no network. Understands plurals and spelling variants, not synonyms.                                                     |
| opção 2           | Servidor seu · Ollama ou outro servidor com o formato OpenAI de embeddings.                                                                                      | Your own server · Ollama or another server with the OpenAI embeddings format.                                                                                                 |
| opção 3           | Modelo neste computador · Baixa um modelo e roda aqui, sem enviar nada para fora.                                                                                | Model on this computer · Downloads a model and runs it here, sending nothing out.                                                                                             |
| em uso            | Em uso                                                                                                                                                           | In use                                                                                                                                                                        |
| sem runtime       | Este computador não tem o runtime do modelo local (macOS Intel). Use um servidor seu.                                                                            | This computer has no runtime for the local model (Intel Mac). Use your own server.                                                                                            |
| servidor          | Endereço · Modelo · Dimensões · Variável da chave · Permitir servidor fora deste computador                                                                      | Address · Model · Dimensions · Key variable · Allow a server outside this computer                                                                                            |
| aviso             | Seus textos e suas perguntas serão enviados para este endereço.                                                                                                  | Your texts and your questions will be sent to this address.                                                                                                                   |
| teste             | Testar conexão · Testando… · OK: {dim} dimensões, {ms} ms · Falhou: {kind}                                                                                       | Test connection · Testing… · OK: {dim} dimensions, {ms} ms · Failed: {kind}                                                                                                   |
| tipos de falha    | timeout · status · dimensão · resposta inválida · rede · o modelo parou                                                                                          | timeout · status · dimension · malformed response · network · the model stopped                                                                                               |
| modelos           | Modelos · Escolha um modelo para baixar. O download não começa sem o seu pedido.                                                                                 | Models · Pick a model to download. The download does not start without your request.                                                                                          |
| linha             | {name} · Recomendado · Embedding · Reranker · {mb} MB · {dim} dimensões · licença {license}                                                                      | {name} · Recommended · Embedding · Reranker · {mb} MB · {dim} dimensions · {license} license                                                                                  |
| estados           | Não baixado · Baixando: {done} de {total} MB · Pronto · Falhou: {reason}                                                                                         | Not downloaded · Downloading: {done} of {total} MB · Ready · Failed: {reason}                                                                                                 |
| motivos           | soma de verificação diferente · endereço fora da lista · {erro de rede}                                                                                          | checksum mismatch · address outside the list · {network error}                                                                                                                |
| ações             | Baixar · Tentar de novo · Cancelar · Remover · Usar este modelo                                                                                                  | Download · Try again · Cancel · Remove · Use this model                                                                                                                       |
| em uso (remover)  | Em uso: troque o provedor antes de remover.                                                                                                                      | In use: change the provider before removing.                                                                                                                                  |
| licença           | Termos do modelo · O MordomoOS não distribui este modelo: ele é baixado do repositório do autor para o seu computador, sob estes termos. · Li e aceito os termos | Model terms · MordomoOS does not distribute this model: it is downloaded from the author's repository to your computer, under these terms. · I have read and accept the terms |
| reranker          | Releitura mais cuidadosa · Mais lento: cerca de meio segundo por seção candidata. Só vale para agentes.                                                          | Careful re-reading · Slower: about half a second per candidate section. Only useful for agents.                                                                               |
| confirmar troca   | Recalcular o índice? · As {n} seções serão calculadas de novo. · Seus textos serão enviados de novo para {endpoint}. · Continuar                                 | Recalculate the index? · The {n} sections will be calculated again. · Your texts will be sent again to {endpoint}. · Continue                                                 |
| confirmar remover | Remover {name}? · Libera {mb} MB. Você pode baixar de novo. · Remover                                                                                            | Remove {name}? · Frees {mb} MB. You can download it again. · Remove                                                                                                           |
| índice            | {n} seções indexadas com {model} · com o vetor simples · Recalculando…                                                                                           | {n} sections indexed with {model} · with the simple vector · Recalculating…                                                                                                   |
| erros             | Não deu para carregar os modelos. · Tentar de novo · Carregando…                                                                                                 | Could not load the models. · Try again · Loading…                                                                                                                             |
| ajuda             | Como instalar o Ollama                                                                                                                                           | How to install Ollama                                                                                                                                                         |
