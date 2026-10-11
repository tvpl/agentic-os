# Licença comercial checks

Profile: standard
Plan: `.specs/features/licenca-comercial/plan.md`

> Os textos jurídicos que estes checks seguram são **minuta para revisão do dono, não aconselhamento
> jurídico**. Os checks provam que o texto existe, é coerente com o código e não inventa dados; eles não
> provam que o texto é juridicamente suficiente. Isso é a revisão do dono.

43 checks in 7 slices · 7 one-way doors · 3 open, of which 2 block go-live

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

**C3** - O campo `license` dos 8 `package.json` (raiz, `contracts`, `core`, `adapters/claude`, `adapters/cursor`, `adapters/codex`, `apps/api`, `apps/command-centre`) é exatamente `FSL-1.1-ALv2` (rodada 1: o identificador SPDX, AD-023), e nenhum workspace do `package.json` raiz fica de fora da lista (AC 3)
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

**C15** - Uma entrada da trava com `version` diferente do tarball de `resolved` (caso real, corrigido na integração, `adfe2c5`), um pacote distribuído que `node_modules` não tem, e um instalado em versão diferente da travada fazem `--check`, `--write` e `--stdout` sairem `2` citando o pacote; um `legal/license-policy.json` ilegível sai `2` (AC 15)
Proof: `npx vitest run tests/legal.licenses.test.ts -t "C15 "`
Status: closed

**C16** - `sbom.mjs` escreve um CycloneDX 1.5 (`bomFormat`, `specVersion`, `serialNumber` `urn:uuid:`) cujos componentes npm são exatamente os `nome@versão` distribuídos (183 `bom-ref` únicos para 184 entradas da trava: dois `semver@7.8.5` aninhados), sem nenhuma ferramenta de build (`vitest`, `typescript`, `vite`), cada componente com licença, hash e `purl`, toda referência de `dependencies` aponta para um componente, e duas execuções escrevem os mesmos bytes (AC 16)
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

**C20** - Toda marca da lista de vigia (as 102 de `legal/trademarks.json` mais 73 nomes que o repositório não cita hoje; ampliada na rodada 1, ver C37) que aparece no texto que o produto mostra (README, `docs/*.md`, `docs/README.pt-BR.md`, textos da interface, conectores, manifestos dos adaptadores) está em `legal/trademarks.json`; toda entrada de `brands` ainda é citada em algum desses arquivos e aparece no EULA; a varredura acha uma marca acrescentada num texto de teste (AC 19)
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

### S7 - correção da rodada 1 da verificação · 9 files · 90 KB · ~25k

**C33** - A lista real `allowedDistributed` de `legal/license-policy.json` é, por `toEqual`, as 12 licenças do plano, na ordem; `allowedToolingExtra` é `["MPL-2.0","CC-BY-4.0"]`; `overrides` só tem `svg-tags@1.0.0`; e cada uma de 16 licenças proibidas (`GPL-3.0-only`, `GPL-2.0-or-later`, `AGPL-3.0-only`, `AGPL-3.0-or-later`, `LGPL-3.0-only`, `LGPL-2.1-only`, `SSPL-1.0`, `MPL-2.0`, `CC-BY-4.0`, `CC-BY-NC-4.0`, `EUPL-1.2`, `BUSL-1.1`, `Elastic-2.0`, `UNLICENSED`, `SEE LICENSE IN LICENSE.txt`, `Proprietary`) reprova com `--check` em `1` sob a política real, e na ferramenta só `MPL-2.0` e `CC-BY-4.0` passam (AC 34)
Proof: `npx vitest run tests/legal.licenses.test.ts -t "C33 "`
Status: closed

**C34** - Cada uma das 15 entradas de `hosts` declara `defaultState` (`on`, `off`, `none`, `never`, `mixed`) e o texto de `default` começa pela palavra desse estado; uma entrada `contact` ou `user-defined` só é `off` ou `none`, `link` e `build` só `never`, `on` só em `local` ou `cli`; o `gate.setting` de cada entrada `off` ou `none` vale `false` ou `[]` nas configurações padrão reais; os conectores embutidos são todos `not_configured` e sem URL; um site `fetch` ou `eventsource` só aponta para `contact`, `user-defined`, `local` ou `build`, uma entrada `implicit` ou `cli` não tem endereço e nenhum site aponta para `link` (AC 35)
Proof: `npx vitest run tests/legal.network.test.ts -t "C34 "`
Status: closed

**C35** - O código faz o que o texto de privacidade diz: o aviso de versão guarda a resposta por seis horas (5h59 reaproveita, 6h01 busca de novo) e envia só `user-agent: mordomo-os`; o agendador não envia webhook algum com `routines.allowWebhooks` desligado, mesmo numa rotina que já tem a URL, e com ele ligado faz um `POST` à URL da rotina com resumo de 4000 caracteres e os oito campos do corpo; o registro de skills e a API de conector fazem `fetch` com `redirect: "error"`; o `subject` padrão do push é `mailto:mordomo@localhost`; o token do Telegram vai na URL (AC 36)
Proof: `npx vitest run tests/legal.network.test.ts -t "C35 "`
Status: closed

**C36** - O SBOM valida contra o esquema oficial CycloneDX 1.5 (três arquivos com SHA-256 fixado) e o validador reprova um rótulo de algoritmo inventado, um `license.id` em minúsculas, um campo faltando e um `bomFormat` errado; cada componente npm tem o hash igual ao `integrity` da trava, rotulado pelo próprio prefixo e com o comprimento do algoritmo, `externalReferences` igual a `resolved`, licença inteira (uma expressão `OR`/`AND`/`WITH` não vira id); os `bom-ref` são únicos, nenhuma referência de `dependencies` aponta para nada, as arestas são exatamente as `dependencies` e `optionalDependencies` da trava; Node.js, SQLite e as duas fontes são componentes, e a licença do aplicativo é o `license` do manifesto (AC 37)
Proof: `npx vitest run tests/legal.licenses.test.ts -t "C36 "`
Status: closed

**C37** - A varredura de marcas lê todo o texto do produto (mais de 500 arquivos: README, `docs/**` de todas as pastas, código, skills, scripts, arquivos públicos, conectores, workflows), nenhum nome de vigia aparece nele, cada uma das 102 marcas ainda é citada, `Claude`, `Cursor`, `Google` e `Vite` só valem como nome isolado (não dentro de `Claude Code`, `Cursor Agent`, `Google Calendar`, `Vitest`), os nomes do EULA são exatamente os de `legal/trademarks.json` agrupados pelos mesmos tipos, e o EULA diz que a lista não é exaustiva (AC 38)
Proof: `npx vitest run tests/legal.docs.test.ts -t "C37 "`
Proof: `npx vitest run tests/legal.docs.test.ts -t "C20 "`
Status: closed

**C38** - Nenhum dos seis textos jurídicos traz nome de empresa (`Ltda`, `S.A.`, `Inc`, `LLC`…), valor em dinheiro (`R$`, `US$`, `$ 5`, "reais"), telefone, e-mail nem link fora da lista de domínios permitidos; a frase que nomeia o licenciante no EULA e na privacidade e a linha de copyright do aviso e do `LICENSE` só têm a marcação do dono; os detectores acham `Acme Software Ltda`, `R$ 100,00`, um telefone e um link inventado (AC 39)
Proof: `npx vitest run tests/legal.docs.test.ts -t "C38 "`
Status: closed

**C39** - A varredura conta `globalThis["fetch"]`, `window["WebSocket"]`, `globalThis[nome]`, `process.binding`, módulo por variável (`import(x)`, `require(x)`), `createRequire`, módulo por URL, o `spawn` de `npm`, `npx`, `git`, `ssh`, `scp`, `sftp`, `ftp`, `rsync`, `nc`, `ncat`, `telnet`, `curl` e `wget`, `curl`/`wget` em prosa e o `command` de um conector; lê IP puro e constante com nome de endereço como host, e não lê chave de tradução; um host ignorado só vale nos arquivos que a entrada nomeia e um ignorado sem uso é velho; a privacidade nomeia o `npx -y <pacote>` e o registro do npm e lista o que a varredura não vê (AC 40)
Proof: `npx vitest run tests/legal.network.test.ts -t "C39 "`
Status: closed

**C40** - O `license` dos 8 `package.json` é `FSL-1.1-ALv2`, igual à abreviatura do `LICENSE` e presente na lista SPDX que o esquema do CycloneDX vendorado carrega, `FSL-1.1-Apache-2.0` não está nela, `core` e `contracts` dizem o mesmo e levam cópia do `LICENSE`, e nenhum texto diz mais que o identificador não foi confirmado (AC 41)
Proof: `npx vitest run tests/legal.docs.test.ts -t "C40 "`
Proof: `npx vitest run tests/sdk.package.test.ts -t "C41 both packages carry the literal fields"`
Status: closed

**C41** - Cada uma de pelo menos 15 linhas do EULA marcadas `> FSL:` aparece, uma a uma, no `LICENSE`; a ressalva "that exists as of the date we make the Software available" está citada; perda de dados, de lucro e de oportunidade, término do contrato e dever de parar de distribuir (que o `LICENSE` não tem) e a exigência do `THIRD_PARTY_NOTICES.md` estão marcados "Termo adicional (a revisar)" ou como vindos de outra licença; o EULA nunca diz "como o `LICENSE` diz/exige" fora de uma citação; e um trecho inventado não aparece no `LICENSE` (AC 42)
Proof: `npx vitest run tests/legal.docs.test.ts -t "C41 "`
Status: closed

**C42** - O README (seção License), o CHANGELOG e o cabeçalho do aviso dizem "runtime dependency set" e "superset"/"superconjunto" e que o aviso não afirma que cada pacote está dentro do instalador; nenhum texto diz que o aviso lista tudo que o instalador leva nem que os 184 são do instalador; a seção 2 do aviso se chama "Pacotes npm de runtime" (AC 43)
Proof: `npx vitest run tests/legal.docs.test.ts -t "C42 "`
Status: closed

**C43** - Os specs e a STATE não citam nenhum commit que a integração deixou de fora (cinco hashes do histórico anterior à integração, listados no teste); a porta 4 do plano tem o título original e as emendas estão registradas abaixo da tabela; a privacidade não diz "nenhum identificador do produto" ao lado do `user-agent: mordomo-os`, diz que ele é o nome do produto sem versão, diz que o ambiente do processo (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) é repassado ao CLI e não diz que o MordomoOS "não vê" a chave; o código confirma as três coisas (`{ ...process.env }`, as duas leituras de variável) (AC 44)
Proof: `npx vitest run tests/legal.docs.test.ts -t "C43 "`
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
| marcas citadas (102)                                 | cada uma de `brands` C20, C37 (citada no repositório, como nome isolado, e no EULA), table-driven over all 102                                                                                                                                                                                                            | -        |
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
| listas da política real pinadas (3)                  | `allowedDistributed` C33 · `allowedToolingExtra` C33 · `overrides` C33                                                                                                                                                                                                                                                    | -        |
| licenças proibidas sob a política real (16)          | cada uma das 16 de C33, table-driven over all 16                                                                                                                                                                                                                                                                          | -        |
| estados padrão das entradas de `hosts` (5)           | `on` C34 · `off` C34 · `none` C34 · `never` C34 · `mixed` C34                                                                                                                                                                                                                                                             | -        |
| entradas de `hosts` com `defaultState` (15)          | C34, table-driven over all 15                                                                                                                                                                                                                                                                                             | -        |
| fatos do código que a privacidade afirma (7)         | cache de seis horas C35 · `user-agent` C35 · webhook desligado não envia C35 · resumo de 4000 C35 · `redirect: "error"` C35 · `subject` do push C35 · token do Telegram na URL C35                                                                                                                                        | -        |
| exigências do SBOM contra o esquema (9)              | esquema oficial C36 · algoritmo C36 · hash C36 · referência de distribuição C36 · licença inteira C36 · `bom-ref` único C36 · referências soltas C36 · arestas da trava C36 · componentes fora do npm C36                                                                                                                 | -        |
| arquivos do esquema CycloneDX (3)                    | `bom-1.5.schema.json` C36 · `spdx.schema.json` C36 · `jsf-0.82.schema.json` C36                                                                                                                                                                                                                                           | -        |
| marcas que a primeira varredura perdeu (20)          | `Android` C37 · `Microsoft Edge` C37 · `iPhone` C37 · `iPad` C37 · `Xcode` C37 · `Gradle` C37 · `Kotlin` C37 · `Metro` C37 · `Watchman` C37 · `Dart` C37 · `Docker` C37 · `Notion` C37 · `Slack` C37 · `WhatsApp` C37 · `Discord` C37 · `Stripe` C37 · `PayPal` C37 · `YouTube` C37 · `Tauri` C37 · `Debian` C37          | -        |
| marcas que só valem como nome isolado (4)            | `Claude` C37 · `Cursor` C37 · `Google` C37 · `Vite` C37                                                                                                                                                                                                                                                                   | -        |
| formas de dado inventado (5)                         | empresa C38 · dinheiro C38 · telefone C38 · e-mail C38 · link C38                                                                                                                                                                                                                                                         | -        |
| frases do licenciante só com a marcação (4)          | EULA 1.3 C38 · privacidade §2 C38 · `NOTICE.md` C38 · `LICENSE` C38                                                                                                                                                                                                                                                       | -        |
| evasões novas da varredura (12)                      | `globalThis["fetch"]` C39 · chave dinâmica C39 · `process.binding` C39 · módulo por variável C39 · `createRequire` C39 · módulo por URL C39 · spawn de programa C39 · prosa `curl`/`wget` C39 · `command` de conector C39 · IP puro C39 · constante com nome de endereço C39 · ignorado por arquivo C39                   | -        |
| programas de rede (13)                               | `npm` C39 · `npx` C39 · `git` C39 · `ssh` C39 · `scp` C39 · `sftp` C39 · `ftp` C39 · `rsync` C39 · `nc` C39 · `ncat` C39 · `telnet` C39 · `curl` C39 · `wget` C39                                                                                                                                                         | -        |
| limites ditos na privacidade (4)                     | endereço montado C39 · `eval` C39 · texto em prosa C39 · código fora das pastas C39                                                                                                                                                                                                                                       | -        |
| identificador SPDX (4)                               | manifestos C40 · abreviatura do `LICENSE` C40 · lista SPDX do esquema C40 · pacotes publicáveis C40                                                                                                                                                                                                                       | -        |
| fontes de verdade do EULA (3)                        | citação literal conferida no `LICENSE` C41 · termo adicional marcado C41 · atribuição falsa ausente C41                                                                                                                                                                                                                   | -        |
| textos que falavam em "distribuído" (4)              | README C42 · CHANGELOG C42 · aviso C42 · seção 2 do aviso C42                                                                                                                                                                                                                                                             | -        |
| rastreabilidade (5)                                  | hashes fora da integração C43 · porta 4 íntegra C43 · `user-agent` C43 · credenciais no ambiente C43 · confirmação no código C43                                                                                                                                                                                          | -        |

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
- round 1: C33-C43 fecham as lacunas de prova da verificação; validation (C36 esquema), failure modes (C35 o envio com a flag desligada), observability (C34/C39)
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
