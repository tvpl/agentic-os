# Guia de organização do segundo cérebro

Este guia diz como o segundo cérebro se organiza: o vocabulário do front matter, onde cada coisa vive, o formato da
nota-índice de uma pasta e as regras que a skill nunca quebra. A `<pasta de memória>` é a que o prompt da execução dá
(`Memory folder`).

## Estrutura

- `<pasta de memória>/inbox/`: o que chegou e ainda não tem lugar, entre elas as notas de entrevista.
- `<pasta de memória>/notes/negocio/`: as notas do negócio (`perfil.md`, `estrategia.md`, `cliente-ideal.md`, `marca.md`,
  `voz.md`, `oferta.md`, `organizacao.md`, `stakeholders.md`, `dores.md`, `crencas.md`, `respostas.md`) e o arquivo de
  metas, `metas.md`, com a seção `## Metas`.
- `<pasta de memória>/notes/<id>/_resumo.md`: o resumo de um contexto de trabalho (`type: brief`).
- `<pasta de memória>/notes/<pasta>/_index.md`: a nota-índice de uma pasta de notas, ao lado das notas.
- `<pasta de memória>/maps/<slug da raiz>/<subcaminho>/_index.md`: a nota-índice de uma pasta do usuário. Nunca dentro da
  pasta do usuário: o caminho exato vem no `indexPath` que `GET /api/memory/maps` dá.

## Vocabulário

O front matter de uma nota fica entre duas linhas `---` no topo. Cada chave abaixo tem um valor de uma linha, de até 64
caracteres.

### type

| Valor       | Quando                                                          |
| ----------- | --------------------------------------------------------------- |
| `context`   | o que alguém precisa saber antes de trabalhar num assunto       |
| `guide`     | como fazer algo, passo a passo                                  |
| `project`   | um trabalho com começo, meio e fim                              |
| `decision`  | uma decisão tomada, com o porquê                                |
| `reference` | material de consulta que não muda com o trabalho                |
| `log`       | registro datado do que aconteceu                                |
| `goals`     | metas e prioridades (o `metas.md`)                              |
| `profile`   | quem é uma pessoa, um cliente ou o próprio negócio              |
| `index`     | a nota-índice de uma pasta (`_index.md`)                        |
| `inbox`     | o que ainda não tem lugar, entre elas a nota de entrevista      |
| `brief`     | o resumo de um contexto de trabalho (`_resumo.md`)              |

### status

| Valor      | Quando                                  |
| ---------- | --------------------------------------- |
| `active`   | em uso                                  |
| `draft`    | rascunho, ainda não vale                |
| `paused`   | parado de propósito, volta depois       |
| `done`     | terminado, fica como registro           |
| `archived` | fora de uso, guardado só por histórico  |

O dono pode acrescentar valores de `type` e de `status` na entrevista (seção `preferencias`); os que ele acrescentar valem
como estes.

### natureza

| Valor      | Quando                                              |
| ---------- | --------------------------------------------------- |
| `fato`     | algo que aconteceu ou que se pode conferir          |
| `opiniao`  | o que alguém acha                                   |
| `plano`    | uma intenção, uma meta, o que se pretende fazer     |
| `hipotese` | uma suposição ainda não conferida                   |
| `relato`   | o que alguém contou, como contou                    |

Uma nota sem `natureza` não está classificada: não é um fato por omissão.

### escopo

| Valor     | Quando                                         |
| --------- | ---------------------------------------------- |
| `pessoal` | só do dono                                     |
| `equipe`  | vale para quem trabalha com o dono             |
| `externo` | pode sair para clientes ou para o público      |

### review_every

De quanto em quanto tempo a nota deve ser revista: um número seguido de `d` (dias), como `30d` ou `90d`, ou `never` para
uma nota que não envelhece.

| Valor   | Quando                                 |
| ------- | -------------------------------------- |
| `30d`   | muda rápido (metas do mês, oferta)     |
| `90d`   | muda devagar (estratégia, perfil)      |
| `never` | não envelhece (uma decisão registrada) |

### Callouts

Um trecho dentro de uma nota que é de outra natureza que a nota leva um callout no começo do parágrafo:

| Callout         | Natureza do trecho |
| --------------- | ------------------ |
| `> [!fato]`     | `fato`             |
| `> [!opiniao]`  | `opiniao`          |
| `> [!plano]`    | `plano`            |
| `> [!hipotese]` | `hipotese`         |
| `> [!relato]`   | `relato`           |

## Nota-índice

Uma nota-índice (`_index.md`) diz o que uma pasta é e aponta para as notas-índice das subpastas. Front matter:

```yaml
---
type: index
status: active
tags: [clientes, contratos]
source: /caminho/absoluto/da/pasta
children-digest: sha256:<o digest que a rota de mapas deu para a pasta>
generated-by: organize-brain
updated: AAAA-MM-DD
last_reviewed: AAAA-MM-DD
---
```

Corpo:

```markdown
# <nome da pasta>

Um parágrafo do que vive nesta pasta e para que serve.

| Categoria | O que vive ali | Índice |
| --------- | -------------- | ------ |
| Contratos | um por cliente, assinados | [contratos](contratos/_index.md) |

## Comece por

- [o arquivo mais útil](…) - por quê
```

"Comece por" tem até 5 links. A tabela tem uma linha por subpasta.

## Regras

1. Escreva só dentro da pasta de memória (e no diretório de artefatos da execução).
2. Nunca crie um arquivo no topo de `notes/`: toda nota fica numa subpasta (`notes/negocio/`, `notes/<id>/`, ...).
3. Nunca mova, renomeie, edite ou apague um arquivo fora da pasta de memória.
4. Nunca sobrescreva um arquivo cujo front matter não tem `generated-by: organize-brain`.
5. Uma nota-índice guarda ponteiros, não conteúdo copiado das notas: o conteúdo envelhece, o ponteiro não.
6. Um plano ou uma opinião nunca é escrito como fato: leva `natureza: plano` ou `natureza: opiniao`, ou o callout
   `> [!plano]` ou `> [!opiniao]` no trecho.
7. Classificar uma nota que já existe fora da pasta de memória é uma proposta no relatório, nunca uma escrita.

Exceção: o `_resumo.md` do contexto de trabalho da execução. A etapa `aplicar` só preenche uma seção vazia e nunca
reescreve o texto de uma seção; um resumo que falta é criado com `type: brief`, `status: active` e as quatro seções
`## O que é`, `## O que importa`, `## Metas` e `## O que ignorar`.

## Limite de leitura

Leia no máximo 200 arquivos por execução, pelos cabeçalhos e pelas primeiras linhas. Diga no relatório o que ficou de fora:
a próxima execução continua pelas pastas ainda `missing` ou `stale`.
