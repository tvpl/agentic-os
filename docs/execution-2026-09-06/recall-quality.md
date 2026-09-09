# Recuperação relevante de fontes — 08/09/2026

Ensaio determinístico em home temporário, API/SQLite reais, quatro documentos sintéticos em português. Sem LLM ou provedor externo. Código reproduzível: `tests/api.recall-quality.test.ts`; log `/tmp/mordomo-recall-quality.log`.

| Pergunta | Fonte esperada em primeiro lugar | Evidência exigida no trecho |
| --- | --- | --- |
| Onde fica o backup SQLite do banco de dados Atlas? | banco-dados.md | cofres |
| Quem aprovou a transferência do banco financeiro Atlas? | banco-financeiro.md | Marina |
| Qual porta usa o Metro Aurora? | mobile.md | 8081 |
| Quando será a revisão Aurora com Renata? | agenda.md | 14 horas |

As quatro consultas encontraram a fonte correta no primeiro resultado e o fato esperado no trecho, após a correção descrita abaixo. Todos os trechos retornados foram confrontados com o conteúdo real do arquivo. Consulta sem termo presente no corpus (`xenobiologiaquantica`) retornou contexto vazio. São quatro casos de desambiguação lexical (banco financeiro/dados e Aurora agenda/mobile), não uma avaliação estatística de compreensão semântica ou perguntas sem sobreposição lexical. Não demonstra resposta de agente nem precisão generalizável a um workspace real.

A primeira passagem reproduziu um erro: título vazio “Banco financeiro” recebia score maior que a seção Pagamento e produzia excerpt vazio. `openFile` agora mantém todas as seções para navegação por ponteiros, mas só seleciona para contexto seções com corpo não vazio. Não houve troca de mecanismo de busca nem adição de banco vetorial. Repetição do mesmo corpus passou.
