# Licença comercial checks

Profile: standard
Plan: `.specs/features/licenca-comercial/plan.md`

> Os textos jurídicos que estes checks seguram são **minuta para revisão do dono, não aconselhamento
> jurídico**. Os checks provam que o texto existe, é coerente com o código e não inventa dados; eles não
> provam que o texto é juridicamente suficiente. Isso é a revisão do dono.

32 checks in 6 slices · 7 one-way doors · 3 open, of which 2 block go-live

Comandos (da raiz): `npx vitest run tests/legal.docs.test.ts -t "<nome>"`,
`npx vitest run tests/legal.licenses.test.ts -t "<nome>"`, `npx vitest run tests/legal.network.test.ts -t "<nome>"`.
Todo teste desta feature começa o nome pelo número do check (`C7 …`).

## Checks

### S1 - o repositório diz uma licença só · 12 files · 60 KB · ~15k

**C1** - `LICENSE` é o bloco de minuta mais o texto de `legal/vendor/FSL-1.1-ALv2.template.md` com exatamente duas trocas: `${year}` por `2026` e `${licensor name}` por `[A PREENCHER PELO DONO: titular dos direitos autorais]`; os termos (de `## Terms and Conditions` até o fim) são byte a byte os do modelo (AC 1)
Proof: `npx vitest run tests/legal.docs.test.ts -t "C1 "`
Status: closed

**C2** - O modelo guardado em `legal/vendor/` tem o SHA-256 `36b60822…56177` e o `legal/README.md` o registra, o mesmo vale para as duas licenças de fonte (`a76abf00…0cd697`, `f62ef357…15d1f`); trocar uma letra do modelo reprova (AC 2)
Proof: `npx vitest run tests/legal.docs.test.ts -t "C2 "`
Status: closed

**C3** - O campo `license` dos 8 `package.json` (raiz, `contracts`, `core`, `adapters/claude`, `adapters/cursor`, `adapters/codex`, `apps/api`, `apps/command-centre`) é exatamente `SEE LICENSE IN LICENSE`, e nenhum workspace do `package.json` raiz fica de fora da lista (AC 3)
Proof: `npx vitest run tests/legal.docs.test.ts -t "C3 "`
Status: closed

**C4** - A seção `## License` do `README.md` nomeia `FSL-1.1-ALv2`, diz que cada versão passa à Apache License 2.0 na segunda data de aniversário, diz que os textos são minuta e linka `LICENSE`, `legal/EULA.md`, `legal/PRIVACY.md` e `legal/THIRD_PARTY_NOTICES.md`; nenhuma linha dela chama o produto de MIT (AC 4)
Proof: `npx vitest run tests/legal.docs.test.ts -t "C4 "`
Status: closed

**C5** - `CONTRIBUTING.md` traz o texto do DCO 1.1 (as quatro alíneas e o título), exige `Signed-off-by:`, diz que a contribuição entra sob FSL-1.1-ALv2, diz que não há CLA e se declara minuta (AC 5)
Proof: `npx vitest run tests/legal.docs.test.ts -t "C5 "`
Status: closed

**C6** - Ao montar o instalador, `LICENSE` e `legal/` (com `EULA.md`, `PRIVACY.md`, `NOTICE.md`, `THIRD_PARTY_NOTICES.md`) vão para dentro dele junto com `legal/sbom.cdx.json`, e `scripts/package.mjs` chama o passo que faz isso (AC 6)
Proof: `npx vitest run tests/legal.docs.test.ts -t "C6 "`
Proof: `npm run dist:quick && test -f build/package/*/legal/EULA.md && test -f build/package/*/legal/PRIVACY.md && test -f build/package/*/legal/NOTICE.md && test -f build/package/*/legal/THIRD_PARTY_NOTICES.md && test -f build/package/*/legal/sbom.cdx.json && test -f build/package/*/LICENSE` (depois de `npm run build`)
Status: closed

### S2 - o aviso de terceiros nasce da trava · 7 files · 70 KB · ~20k

**C7** - `legal/THIRD_PARTY_NOTICES.md` tem, para cada um dos pacotes distribuídos da trava (184 hoje), uma linha com nome, versão, expressão SPDX e a URL `resolved` do tarball, e contém o texto do arquivo de licença do pacote instalado, lido pelo teste direto de `node_modules` (AC 7)
Proof: `npx vitest run tests/legal.licenses.test.ts -t "C7 "`
Status: closed

**C8** - A saída do gerador é idêntica byte a byte rodada de outro diretório, com `LANG`/`LC_ALL` e `TZ` diferentes, é igual ao arquivo versionado, não contém data de hoje, o caminho da máquina nem hora, e `--stdout` e `--write` escrevem o mesmo (AC 8)
Proof: `npx vitest run tests/legal.licenses.test.ts -t "C8 "`
Status: closed

**C9** - `licenses.mjs --check` sai `0` num arquivo igual ao gerado, sai `1` e cita `legal/THIRD_PARTY_NOTICES.md` e `licenses:write` quando o arquivo difere (uma letra do texto, uma versão na trava) ou não existe; `--write` regrava e o `--check` seguinte sai `0` (AC 9)
Proof: `npx vitest run tests/legal.licenses.test.ts -t "C9 "`
Status: closed

**C10** - O aviso contém os 45 pacotes do fecho dos seis do Radix de `tests/ui-deps.test.ts`, cada um com a licença (`MIT` ou `0BSD`); nomeia Node.js (MIT) e SQLite como componentes embutidos; e traz o texto da OFL de cada arquivo de fonte de `apps/command-centre/public/fonts` (todo arquivo da pasta está em `bundled`, e todo `files` de `bundled` existe) (AC 10)
Proof: `npx vitest run tests/legal.licenses.test.ts -t "C10 "`
Status: closed

**C11** - Num pacote distribuído, cada licença da lista (`MIT`, `MIT-0`, `ISC`, `BSD-2-Clause`, `BSD-3-Clause`, `Apache-2.0`, `0BSD`, `BlueOak-1.0.0`, `CC0-1.0`, `Python-2.0`, `Unlicense`, `Zlib`) passa e cada uma destas reprova com `--check` em `1` citando pacote, versão e licença: `GPL-3.0-only`, `GPL-2.0-or-later`, `AGPL-3.0-only`, `LGPL-3.0-only`, `SSPL-1.0`, `MPL-2.0`, `CC-BY-4.0`, `UNLICENSED`, `SEE LICENSE IN x`, nenhuma (AC 11)
Proof: `npx vitest run tests/legal.licenses.test.ts -t "C11 "`
Status: closed

**C12** - Numa ferramenta de build, `MPL-2.0` e `CC-BY-4.0` passam, `GPL-3.0-only` e uma licença ausente reprovam (`1`, citando a ferramenta), e o mesmo `MPL-2.0` num pacote distribuído reprova (AC 12)
Proof: `npx vitest run tests/legal.licenses.test.ts -t "C12 "`
Status: closed

**C13** - Expressões SPDX: `MIT` passa; `MIT OR GPL-3.0-only` passa; `GPL-3.0-only OR AGPL-3.0-only` reprova; `MIT AND ISC` passa; `MIT AND GPL-3.0-only` reprova; `(MIT OR WTFPL) AND ISC` passa; `Apache-2.0 WITH LLVM-exception` passa; `MIT OR` e `SEE LICENSE IN x` e vazio reprovam (AC 13)
Proof: `npx vitest run tests/legal.licenses.test.ts -t "C13 "`
Status: closed

**C14** - Um pacote sem campo `license` reprova (`1`), passa com um `overrides["nome@versão"]` que traz `license` e `reason`, reprova de novo com a versão seguinte e com `reason` vazio (AC 14)
Proof: `npx vitest run tests/legal.licenses.test.ts -t "C14 "`
Status: closed

**C15** - Uma entrada da trava com `version` diferente do tarball de `resolved` (caso real corrigido em `40fee52`), um pacote distribuído que `node_modules` não tem, e um instalado em versão diferente da travada fazem `--check`, `--write` e `--stdout` sairem `2` citando o pacote; um `legal/license-policy.json` ilegível sai `2` (AC 15)
Proof: `npx vitest run tests/legal.licenses.test.ts -t "C15 "`
Status: closed

**C16** - `sbom.mjs` escreve um CycloneDX 1.5 (`bomFormat`, `specVersion`, `serialNumber` `urn:uuid:`) cujos componentes são exatamente os `nome@versão` distribuídos (183 `bom-ref` únicos para 184 entradas da trava: dois `semver@7.8.5` aninhados), sem nenhuma ferramenta de build (`vitest`, `typescript`, `vite`), cada componente com licença, hash e `purl`, toda referência de `dependencies` aponta para um componente, e duas execuções escrevem os mesmos bytes (AC 16)
Proof: `npx vitest run tests/legal.licenses.test.ts -t "C16 "`
Status: closed

**C17** - No `package-lock.json` real, nenhum pacote distribuído tem licença fora da lista e nenhuma ferramenta tem licença fora da lista ampliada: `node scripts/licenses.mjs --check` sai `0` (184 distribuídos, 484 ferramentas) (AC 11, 12 sobre os dados reais)
Proof: `npx vitest run tests/legal.licenses.test.ts -t "C17 "`
Proof: `node scripts/licenses.mjs --check`
Status: closed

### S3 - o EULA · 3 files · 25 KB · ~6k

**C18** - `legal/EULA.md` abre com o aviso de minuta e tem as seções de objeto e licença, uso permitido e vedado, CLIs de terceiros, marcas de terceiros, sem garantia, limitação de responsabilidade, suporte e atualizações, vigência e término, lei aplicável e foro, nesta ordem (AC 17)
Proof: `npx vitest run tests/legal.docs.test.ts -t "C18 "`
Status: closed

**C19** - A seção de CLIs do EULA nomeia Claude Code, Codex e Cursor Agent e diz que o MordomoOS os orquestra, que não os inclui, não os redistribui e não os sublicencia, que cada um segue os termos do seu fornecedor e que a pessoa usa a própria conta (AC 18)
Proof: `npx vitest run tests/legal.docs.test.ts -t "C19 "`
Status: closed

**C20** - Toda marca da lista de vigia (as 46 de `legal/trademarks.json` mais 32 nomes que o repositório não cita hoje) que aparece no texto que o produto mostra (README, `docs/*.md`, `docs/README.pt-BR.md`, textos da interface, conectores, manifestos dos adaptadores) está em `legal/trademarks.json`; toda entrada de `brands` ainda é citada em algum desses arquivos e aparece no EULA; a varredura acha uma marca acrescentada num texto de teste (AC 19)
Proof: `npx vitest run tests/legal.docs.test.ts -t "C20 "`
Status: closed

**C21** - Os textos jurídicos não trazem e-mail, CNPJ, CPF nem endereço postal que o repositório não tinha (fora os textos copiados em `legal/vendor/` e o aviso gerado), e cada dado do dono tem sua marcação em pelo menos um texto: titular, documento, endereço, contato jurídico e de privacidade, e-mail de suporte, preço e modelo de venda, lei e foro, garantia (AC 20)
Proof: `npx vitest run tests/legal.docs.test.ts -t "C21 "`
Status: closed

### S4 - privacidade e varredura de rede · 7 files · 50 KB · ~13k

**C22** - `legal/PRIVACY.md` abre com o aviso de minuta, dá os quatro caminhos da casa (`~/Library/Application Support/MordomoOS`, `$XDG_DATA_HOME/mordomo-os`, `%LOCALAPPDATA%\MordomoOS`, `MORDOMO_HOME`), diz que o produto não envia nada a servidores do licenciante, tem a seção dos CLIs dizendo que o prompt e os arquivos vão ao provedor sob os termos dele, e nunca cita `~/.mordomo` (que o código não usa) (AC 21, 26)
Proof: `npx vitest run tests/legal.docs.test.ts -t "C22 "`
Status: closed

**C23** - O leitor de código acha cada família de ponto de rede e cada fonte de host, e ignora o que não é: `fetch(...)`, `?? fetch` e `fetch` passado como valor contam; `typeof fetch`, tipos, `x.fetch`, uma string "fetch" e comentários não; `import "node:https"`, `require("http")`, `import("undici")`, `new EventSource`, `new WebSocket`, `new XMLHttpRequest`, `navigator.sendBeacon`, `"npm-cli.js"`, `"curl"`; host de URL literal, de template, de constante `"api.exemplo.com"` e de expressão regular `/^a\.b\.com$/`; `127.0.0.1`, `localhost`, `::1` e comentário não são host (AC 22)
Proof: `npx vitest run tests/legal.network.test.ts -t "C23 "`
Status: closed

**C24** - No código real os pontos e hosts batem com `legal/network-policy.json` nos dois sentidos (`--check` sai `0`); numa cópia da árvore, um `fetch("https://tracker.exemplo.net")` num arquivo novo, um segundo `fetch` num arquivo aprovado, um host novo num arquivo aprovado, uma entrada da política que o código não tem mais e um `hosts` apontando para um id inexistente fazem `--check` sair `1` citando arquivo, tipo e host (AC 22, 23)
Proof: `npx vitest run tests/legal.network.test.ts -t "C24 "`
Status: closed

**C25** - O `legal/PRIVACY.md` traz, para cada uma das 15 entradas de `hosts` da política, o rótulo, cada `match`, e o `trigger`, o `default` e o `data` palavra por palavra; toda entrada declara os três campos; e nenhum host `contact` da política deixa de ter `match` (AC 24)
Proof: `npx vitest run tests/legal.network.test.ts -t "C25 "`
Status: closed

**C26** - Os destinos condicionais fazem o que a política diz: nas configurações padrão `updates.check`, `channels.telegram.enabled`, `channels.telegram.inbound`, `channels.push.enabled`, `routines.allowWebhooks` são `false` e `marketplace.registries` e `connectors.allowedCommands` são `[]`; `GET /api/updates` não chama a rede sem `check` nem `?force=1`; um webhook só sai com `routines.allowWebhooks`; `deliverPush` sem assinatura não chama `fetch`; `npmAuditCheck` com `MORDOMO_SKIP_NPM_AUDIT=1` não roda o npm (AC 25)
Proof: `npx vitest run tests/legal.network.test.ts -t "C26 "`
Proof: `npx vitest run tests/api.system-info.test.ts -t "does not contact the network unless enabled or forced"`
Proof: `npx vitest run tests/core.routines.v2.test.ts -t "refuses webhook delivery unless the settings flag allows it"`
Status: closed

### S5 - nenhuma telemetria · 3 files · 12 KB · ~3k

**C27** - O produto não tem telemetria: nenhuma dependência de análise, relato de falhas ou rastreamento no `package-lock.json` (lista de 24 nomes, ver o teste), nenhum ponto `beacon` na varredura e nenhuma chave com `telemetry`, `analytics` ou `crash` no nome nas configurações padrão nem no esquema; e nenhum arquivo do produto fala em chave de licença ou ativação (AC 27, 29)
Proof: `npx vitest run tests/legal.network.test.ts -t "C27 "`
Status: closed

**C28** - `legal/PRIVACY.md` diz "Nenhuma telemetria" e, para o futuro, que seria opt-in, desligada por padrão, sem identificador pessoal, com tela de consentimento, documentada antes e no mesmo commit da política e da varredura (AC 28)
Proof: `npx vitest run tests/legal.docs.test.ts -t "C28 "`
Status: closed

### S6 - a documentação diz o mesmo e o dono sabe o que falta · 4 files · 20 KB · ~5k

**C29** - `docs/README.pt-BR.md` e `docs/install.md` dizem a licença, que o produto orquestra CLIs de terceiros sem incluí-los, e onde ficam o EULA, a privacidade e os avisos; nenhum dos três documentos (README incluído) diz que o produto é MIT (AC 30)
Proof: `npx vitest run tests/legal.docs.test.ts -t "C29 "`
Status: closed

**C30** - `LICENSE`, `CONTRIBUTING.md`, `legal/EULA.md`, `legal/PRIVACY.md`, `legal/NOTICE.md`, `legal/README.md` e `legal/THIRD_PARTY_NOTICES.md` trazem nas primeiras 12 linhas a palavra "MINUTA", "aconselhamento jurídico" e a revisão do dono; `legal/license-policy.json`, `legal/network-policy.json` e `legal/trademarks.json` trazem o mesmo no campo `note` (AC 31)
Proof: `npx vitest run tests/legal.docs.test.ts -t "C30 "`
Status: closed

**C31** - Cada texto distinto de `[A PREENCHER PELO DONO: …]` achado em `LICENSE`, `CONTRIBUTING.md` e `legal/*.md` aparece em `.specs/STATE.md` na seção "revisão jurídica do dono", e a seção diz que o texto não é aconselhamento jurídico (AC 32)
Proof: `npx vitest run tests/legal.docs.test.ts -t "C31 "`
Status: closed

**C32** - `CHANGELOG.md` tem, em Unreleased, uma entrada `licenca-comercial` que cita FSL-1.1-ALv2, o aviso de terceiros gerado (`THIRD_PARTY_NOTICES`), a varredura de rede (`network`) e "no telemetry" (AC 33)
Proof: `npx vitest run tests/legal.docs.test.ts -t "C32 "`
Status: closed

## Coverage

| Set (size)                                           | Member -> proof                                                                                                                                                                                                                                                                                                           | Unproven |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `package.json` com `license` (8)                     | raiz · `contracts` · `core` · `adapters/claude` · `adapters/cursor` · `adapters/codex` · `apps/api` · `apps/command-centre` C3, table-driven over all 8                                                                                                                                                                   | -        |
| arquivos da distribuição (6)                         | `LICENSE` C6 · `legal/EULA.md` C6 · `legal/PRIVACY.md` C6 · `legal/NOTICE.md` C6 · `legal/THIRD_PARTY_NOTICES.md` C6 · `legal/sbom.cdx.json` C6                                                                                                                                                                           | -        |
| licenças aceitas em componente distribuído (12)      | `MIT` C11 · `MIT-0` C11 · `ISC` C11 · `BSD-2-Clause` C11 · `BSD-3-Clause` C11 · `Apache-2.0` C11 · `0BSD` C11 · `BlueOak-1.0.0` C11 · `CC0-1.0` C11 · `Python-2.0` C11 · `Unlicense` C11 · `Zlib` C11                                                                                                                     | -        |
| licenças reprovadas em componente distribuído (10)   | `GPL-3.0-only` C11 · `GPL-2.0-or-later` C11 · `AGPL-3.0-only` C11 · `LGPL-3.0-only` C11 · `SSPL-1.0` C11 · `MPL-2.0` C11, C12 · `CC-BY-4.0` C11 · `UNLICENSED` C11 · `SEE LICENSE IN x` C11 · nenhuma C11, C14                                                                                                            | -        |
| licenças da ferramenta de build (4)                  | `MPL-2.0` aceita C12 · `CC-BY-4.0` aceita C12 · `GPL-3.0-only` reprova C12 · ausente reprova C12                                                                                                                                                                                                                          | -        |
| formas de expressão SPDX (9)                         | simples C13 · `OR` uma alternativa boa C13 · `OR` nenhuma boa C13 · `AND` as duas boas C13 · `AND` uma ruim C13 · parênteses aninhados C13 · `WITH` C13 · expressão truncada C13 · texto livre e vazio C13                                                                                                                | -        |
| códigos de saída do `licenses.mjs` (3)               | `0` C9, C17 · `1` C9, C11, C12, C14 · `2` C15                                                                                                                                                                                                                                                                             | -        |
| saídas do gerador que não podem variar (4)           | diretório de execução C8 · locale C8 · fuso C8 · relógio e caminho da máquina C8                                                                                                                                                                                                                                          | -        |
| fecho dos seis do Radix (45)                         | cada pacote C10, table-driven over the 45 computed from `tests/ui-deps.test.ts`'s walk                                                                                                                                                                                                                                    | -        |
| componentes que não vêm do npm (4)                   | Node.js C10 · SQLite C10 · JetBrains Mono C10 · Rajdhani C10                                                                                                                                                                                                                                                              | -        |
| arquivos de fonte em `public/fonts` (3)              | `jetbrains-mono-latin.woff2` C10 · `rajdhani-600-latin.woff2` C10 · `rajdhani-700-latin.woff2` C10                                                                                                                                                                                                                        | -        |
| pacotes distribuídos no aviso (184)                  | C7, table-driven over all 184 in the lockfile                                                                                                                                                                                                                                                                             | -        |
| componentes do SBOM (183)                            | C16, table-driven over all 183 (the set of name@version compared with the lockfile's; the 184th lock entry is a duplicate purl)                                                                                                                                                                                           | -        |
| fatos que o SBOM deve ter (5)                        | formato e versão C16 · componentes C16 · ferramentas ausentes C16 · referências C16 · determinismo C16                                                                                                                                                                                                                    | -        |
| seções do EULA (9)                                   | objeto e licença C18 · uso C18 · CLIs C18, C19 · marcas C18, C20 · garantia C18 · responsabilidade C18 · suporte C18 · vigência C18 · lei e foro C18                                                                                                                                                                      | -        |
| frases do EULA sobre os CLIs (5)                     | orquestra C19 · não inclui C19 · não redistribui C19 · não sublicencia C19 · termos do fornecedor e conta própria C19                                                                                                                                                                                                     | -        |
| marcas citadas (46)                                  | cada uma de `brands` C20 (citada no repositório e no EULA), table-driven over all 46                                                                                                                                                                                                                                      | -        |
| dados do dono (8)                                    | titular C21 · documento C21 · endereço C21 · contato C21 · suporte C21 · preço e modelo C21 · lei e foro C21 · garantia C21                                                                                                                                                                                               | -        |
| famílias de ponto de rede (10)                       | `fetch` C23 · `module:*` C23 · `eventsource` C23 · `websocket` C23 · `xhr` C23 · `webtransport` C23 · `beacon` C23 · `program:npm-cli` C23 · `program:curl` C23 · `program:wget` C23                                                                                                                                      | -        |
| fontes de host (4)                                   | URL literal C23 · template C23 · constante C23 · expressão regular C23                                                                                                                                                                                                                                                    | -        |
| o que a varredura ignora (4)                         | loopback C23 · comentário C23 · posição de tipo C23 · `x.fetch` e string C23                                                                                                                                                                                                                                              | -        |
| falhas que `network-scan --check` acusa (6)          | ponto novo C24 · contagem maior C24 · host novo C24 · entrada velha de ponto C24 · entrada velha de host C24 · id inexistente C24                                                                                                                                                                                         | -        |
| entradas de `hosts` da política (15)                 | `loopback` C25 · `github-releases` C25 · `github-links` C25 · `telegram` C25 · `push-browsers` C25 · `push-custom` C25 · `webhook` C25 · `skill-registry` C25 · `connector-api` C25 · `mcp-connectors` C25 · `npm-registry` C25 · `cli-providers` C25 · `install-links` C25 · `skill-doc-links` C25 · `node-download` C25 | -        |
| papéis das entradas (6)                              | `local` C25 · `contact` C25 · `user-defined` C25 · `cli` C25 · `link` C25 · `build` C25                                                                                                                                                                                                                                   | -        |
| padrões dos destinos condicionais (7)                | `updates.check` C26 · `telegram.enabled` C26 · `telegram.inbound` C26 · `push.enabled` C26 · `allowWebhooks` C26 · `marketplace.registries` C26 · `connectors.allowedCommands` C26                                                                                                                                        | -        |
| destinos condicionais com prova de comportamento (4) | verificação de versão C26 · webhook C26 · push sem assinatura C26 · `npm audit` com a variável C26                                                                                                                                                                                                                        | -        |
| indícios de telemetria (3)                           | pacotes da trava C27 · ponto `beacon` C27 · chaves de configuração C27                                                                                                                                                                                                                                                    | -        |
| condições futuras da telemetria (5)                  | opt-in C28 · desligada por padrão C28 · sem identificador pessoal C28 · tela de consentimento C28 · mesmo commit da política e da varredura C28                                                                                                                                                                           | -        |
| textos jurídicos com aviso de minuta (7)             | `LICENSE` C30 · `CONTRIBUTING.md` C30 · `EULA.md` C30 · `PRIVACY.md` C30 · `NOTICE.md` C30 · `legal/README.md` C30 · `THIRD_PARTY_NOTICES.md` C30                                                                                                                                                                         | -        |
| JSONs da política com `note` de minuta (3)           | `license-policy.json` C30 · `network-policy.json` C30 · `trademarks.json` C30                                                                                                                                                                                                                                             | -        |
| rotas da superfície do plano (0)                     | `None - nothing consumed outside`: nenhuma rota nova                                                                                                                                                                                                                                                                      | -        |

- Claims naming a status code, route or response shape: none (nenhuma rota); os códigos de saída dos comandos (`0`, `1`, `2`) são provados rodando o comando (C9, C15, C24)
- Nenhum outro check afirma mais que o caso único que a sua prova exercita

## Test policy

O que decide nesta feature: o avaliador de licenças (`parseSpdx`/`isAllowed`/`licenseOf`, 11 pontos de decisão: `OR`, `AND`, `WITH`, parênteses, id desconhecido, ausente, override, ferramenta × distribuído, saída `0`/`1`/`2`) e o leitor de rede (`scanSource`, 14 pontos: cada família de ponto, cada fonte de host, cada exceção, e `compare`, 6 falhas). Texto não decide: é provado por leitura do arquivo.

| Code                                                                                             | Required proofs                                                                     | Coverage expectation                                                                                         |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Decides, reached across a boundary (`licenses.mjs`, `network-scan.mjs`, `sbom.mjs` como comando) | one at the boundary (exit code do processo) **and** one at its own layer (a função) | the contract at the boundary (`0`/`1`/`2`); one asserted case per row of the decision table at its own layer |
| Decides, not reached across a boundary (`isAllowed`, `scanSource`)                               | one at its own layer                                                                | one asserted case per row                                                                                    |
| Text and configuration (`LICENSE`, `legal/*.md`, `legal/*.json`, `package.json`)                 | one reading the file                                                                | each required fact asserted; each forbidden fact asserted absent                                             |
| Instrumentation (`package.mjs` copiando `legal/`)                                                | one at the boundary                                                                 | os arquivos chegam ao estágio                                                                                |

Evidence:

- `scripts/licenses.mjs`: `parseSpdx` e `isAllowed` decidem por `OR`/`AND`/`WITH`/parênteses (6 ramos) e `licenseOf` por campo, objeto, lista e override (5 ramos) -> decides
- `scripts/network-scan.mjs`: `scanSource` decide por tipo de nó e posição (14 ramos), `compare` por 6 falhas -> decides
- `scripts/sbom.mjs`: mapeia a trava para o formato, com `resolveKey` decidindo pelo `node_modules` mais próximo -> decides (deduplicação por `purl`)
- `scripts/package.mjs`: copia uma pasta e escreve um arquivo -> instrumentation
- closest analogue in the repo: `tests/bundle-size.test.ts` prova `scripts/bundle-size.mjs` importando a função e rodando o comando; `tests/api.v1.test.ts` prova um leitor de código na árvore sintática do TypeScript com autoexame por forma (L-029) - o leitor de rede segue os dois

Cost: 3 arquivos de teste novos, 32 checks, cerca de 150 casos; sem estas linhas o avaliador de licenças e o leitor de rede só seriam provados pelo caminho que o repositório real atravessa (um repositório sem GPL e sem `sendBeacon` nunca exercita a reprovação).

## Swept

- validation: C11, C12, C13, C14 (licença fora da lista, expressão malformada, licença ausente), C23 (código que não é host), C21 (texto sem dado inventado)
- failure modes: C15 (trava que não é o que diz, `node_modules` fora da trava, política ilegível: sai `2` sem escrever), C9 (arquivo ausente), C24 (política desatualizada)
- idempotency: C8 (rodar duas vezes escreve os mesmos bytes), C16 (o SBOM idem), C9 (`--write` seguido de `--check` sai `0`)
- authorization: n/a - são scripts locais do repositório e textos; nenhuma rota, token ou escopo muda, e nenhum código de segurança é tocado
- concurrency: n/a - o gerador lê e escreve um arquivo e nenhum processo do produto o consome; dois `--write` simultâneos escrevem os mesmos bytes (C8)
- data lifecycle: n/a - nenhum dado do usuário é criado, movido ou apagado; o aviso e a política são do repositório, e `legal/` vai ao instalador (C6)
- dependency failure: C15 (dependência ausente ou fora da trava), C6 (o instalador monta sem rede: o SBOM e o aviso não pedem rede); o `npm sbom` que omitia 23 pacotes está fora (door 7)
- state transitions: n/a - nenhuma máquina de estados; o único "estado" é aviso fresco × velho (C9)
- observability: C24 (mensagem de falha cita arquivo, tipo e host), C9 e C11 (citam pacote, versão e licença), C23 (a listagem dos pontos de rede é a observabilidade que a feature entrega)

## Out of scope

- Implementar telemetria opt-in - padrão conservador, a porta fica no texto (C28) e a pergunta no STATE
- Tela "Sobre" em Configurações - não existe; criá-la é `ui`
- Chave de licença, ativação e verificação online - o código não tem nada disso (C27 prova a ausência)
- Serviço de CLA, verificação automática de DCO, cabeçalho de copyright em cada arquivo, tradução dos textos
- Atualizador assinado e seus hosts (feature 14): a varredura já força a política a mudar quando ele chegar

## Handoff

- S1-S6 = ~62k tokens: scripts 3 (`licenses.mjs`, `sbom.mjs`, `network-scan.mjs`, ~48 KB), tests 3 (~60 KB), textos (`LICENSE`, `CONTRIBUTING.md`, `legal/*`, ~240 KB com o aviso gerado de 205 KB, que se escreve por comando e não se lê), docs (~12 KB). O que se lê e escreve à mão soma ~190 KB ≈ 48k tokens, mais o gate; abaixo do orçamento de 150k - one builder
- Mechanism: one builder (cabe no orçamento, não houve pergunta)
