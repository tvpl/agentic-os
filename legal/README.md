# legal/

> **MINUTA para revisão do dono. Não é aconselhamento jurídico.** Quem preparou estes textos não é
> advogado e ninguém com formação em direito os revisou. O que depende do dono está em
> `[A PREENCHER PELO DONO: …]` nos arquivos e listado em `.specs/STATE.md`, item "revisão jurídica do dono".

A licença do código é o `LICENSE` da raiz (Functional Source License 1.1, ALv2 Future License). Esta pasta
tem o resto, e o instalador (`npm run dist`) a leva inteira para `legal/` dentro dele.

| Arquivo                      | O que é                                                                                                  | Como nasce                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `EULA.md`                    | contrato de uso do aplicativo distribuído (minuta)                                                       | escrito à mão                                               |
| `PRIVACY.md`                 | política de privacidade (minuta): o que fica na máquina, o que sai, "nenhuma telemetria"                 | escrito à mão; as tabelas da seção 4 repetem a política     |
| `NOTICE.md`                  | aviso do produto: titular, licença, marcas                                                               | escrito à mão                                               |
| `THIRD_PARTY_NOTICES.md`     | os componentes de terceiros do instalador, cada um com a sua licença                                     | **gerado**: `npm run licenses:write`                        |
| `license-policy.json`        | licenças aceitas no que o instalador leva e nas ferramentas de build; exceções por `nome@versão`; fontes e runtime embutidos | escrito à mão, conferido por `npm run licenses:check`       |
| `network-policy.json`        | cada destino de rede do código, com quando, padrão e o que é enviado                                     | escrito à mão, conferido por `npm run network:scan -- --check` |
| `trademarks.json`            | as marcas de terceiros que o repositório cita                                                            | escrito à mão, conferido por `tests/legal.docs.test.ts`     |
| `vendor/`                    | textos canônicos copiados sem alteração (FSL-1.1-ALv2, o DCO 1.1 e as licenças das duas fontes)           | copiados; o SHA-256 está abaixo                             |

## Comandos

```bash
npm run licenses:write        # reescreve legal/THIRD_PARTY_NOTICES.md a partir de package-lock.json
npm run licenses:check        # exit 0 confere · 1 licença fora da lista ou aviso desatualizado · 2 árvore fora da trava
npm run sbom                  # build/sbom/mordomo-os.cdx.json (CycloneDX 1.5) do que o instalador leva
npm run network:scan          # lista os pontos de rede e os hosts do código; com -- --check, compara com a política
```

O CI roda tudo isso em `npm test` (`tests/legal.*.test.ts`).

## Textos canônicos em `vendor/`

| Arquivo                                  | Origem                                                                                    | SHA-256                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `FSL-1.1-ALv2.template.md`               | https://fsl.software/FSL-1.1-ALv2.template.md (lido em 11/10/2026)                        | `36b6082235c0a2105174927fc57cc6ae9c41f45a08af2bdcaee18a8dace56177` |
| `DCO-1.1.txt`                            | https://developercertificate.org/ (lido em 11/10/2026); `CONTRIBUTING.md` o reproduz       | `f7ac75b443f4ca16b503241344b41aeff9503b0c30bedc2b119551d83cb0fa90` |
| `fonts/JetBrainsMono-OFL.txt`            | https://raw.githubusercontent.com/JetBrains/JetBrainsMono/master/OFL.txt (11/10/2026)     | `a76abf002c49097d146e86740a3105a5d00450b1592e820a1109a8c5680cd697` |
| `fonts/Rajdhani-OFL.txt`                 | https://raw.githubusercontent.com/google/fonts/main/ofl/rajdhani/OFL.txt (11/10/2026)     | `f62ef357d3a1c3d27edd35a6e1ba350e8a8d13499797964eeadefbf0b3b15d1f` |

Mudar o texto de uma licença é uma edição deliberada: o teste compara o SHA-256 acima e o `LICENSE` com o
modelo (só o ano e o titular diferem).

## Identificador da licença

O nome abreviado oficial do texto é **FSL-1.1-ALv2**. Nos `package.json` o campo `license` é
`SEE LICENSE IN LICENSE`, que o npm entende como "leia o arquivo", em vez de um identificador SPDX cuja
existência na lista do SPDX esta minuta não conseguiu confirmar.
