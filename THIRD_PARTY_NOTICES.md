# MordomoOS — Avisos de terceiros

> **MINUTA para revisão do dono. Não é aconselhamento jurídico.** Quem escreveu este texto não é advogado e ninguém
> com formação em direito o revisou: ele lista o código de terceiros que o instalador do MordomoOS leva para rodar os
> modelos locais da busca por significado (`.specs/features/cerebro-busca-significado`, door 2) e as licenças que esse
> código declara no seu próprio `package.json`. O texto integral de cada licença vai dentro da pasta do pacote, no
> instalador (`lib/node_modules/<pacote>/LICENSE`). Não publique um instalador com este texto antes da revisão.

Versão da minuta: 16/11/2026 · vale para o MordomoOS 0.8.0 em diante

## 1. O runtime dos modelos locais

O instalador leva estes pacotes em `lib/node_modules/`, só os arquivos de CPU da plataforma do alvo. Eles são
carregados apenas pelo processo filho dos modelos locais (`lib/localChild.mjs`), nunca pelo serviço, e só quando o dono
liga o provedor `local` com um modelo baixado.

| Pacote                                          | Versão           | Licença           | Para que serve                                                                                   |
| ----------------------------------------------- | ---------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| `@huggingface/transformers`                     | 4.3.2            | Apache-2.0        | carrega o modelo, o tokenizador e o pooling, e calcula os vetores e as notas do reranker         |
| `@huggingface/tokenizers`                       | 0.2.0            | Apache-2.0        | o tokenizador, embutido no arquivo de `@huggingface/transformers`                                |
| `@huggingface/jinja`                            | 0.5.13           | MIT               | modelos de texto (templates), embutidos no arquivo de `@huggingface/transformers`                |
| `onnxruntime-node`                              | 1.30.0           | MIT               | o runtime ONNX da Microsoft que executa o modelo na CPU (sem os arquivos de CUDA e TensorRT)     |
| `onnxruntime-common`                            | 1.30.0           | MIT               | a interface comum do runtime ONNX                                                                |
| `sharp`                                         | 0.35.5           | Apache-2.0        | dependência de `@huggingface/transformers` para imagens; carregada com ele, não usada pela busca |
| `@img/sharp-<plataforma>-<arquitetura>`         | 0.35.5           | Apache-2.0        | o módulo nativo do `sharp` para a plataforma do alvo                                             |
| `@img/sharp-libvips-<plataforma>-<arquitetura>` | 1.3.4            | LGPL-3.0-or-later | a biblioteca libvips usada pelo `sharp`, em forma de biblioteca dinâmica que pode ser trocada    |
| `@img/colour`                                   | 1.1.0            | MIT               | dependência do `sharp`                                                                           |
| `detect-libc`                                   | 2.1.2            | Apache-2.0        | dependência do `sharp`                                                                           |
| `semver`                                        | 7 (a do `sharp`) | ISC               | dependência do `sharp`                                                                           |

`[A PREENCHER PELO DONO: confirmar com a revisão jurídica o que a LGPL-3.0 da libvips exige do instalador (o aviso, o
texto da licença e a possibilidade de trocar a biblioteca) e se o `sharp` deve continuar no instalador ou ser
substituído por um módulo vazio, já que a busca não usa imagens.]`

## 2. Os modelos não vão no instalador

Nenhum peso de modelo vai no instalador. O dono baixa, pela tela de Configurações, um modelo do catálogo
(`core/src/models/catalog.ts`) direto do repositório de modelos, depois de ver a licença dele e, quando ela pede,
aceitá-la:

| Modelo                                              | Repositório                                | Licença                                                   |
| --------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------- |
| EmbeddingGemma 300M (`embeddinggemma-300m-q4`)      | `onnx-community/embeddinggemma-300m-ONNX`  | Termos de uso do Gemma (aceite na tela antes do download) |
| Qwen3-Embedding 0.6B (`qwen3-embedding-0.6b-q4f16`) | `onnx-community/Qwen3-Embedding-0.6B-ONNX` | Apache-2.0                                                |
| Qwen3-Reranker 0.6B (`qwen3-reranker-0.6b-q4`)      | `onnx-community/Qwen3-Reranker-0.6B-ONNX`  | Apache-2.0                                                |

`[A PREENCHER PELO DONO: o texto dos Termos de uso do Gemma mostrado na tela e a leitura jurídica de quem é o
licenciado (o dono que baixa, não o MordomoOS, que não redistribui o peso).]`
