# Licença comercial — FSL-1.1, avisos de terceiros, EULA, privacidade e "nenhuma telemetria"

> **Aviso permanente.** Quem escreve este plano e os textos que ele pede não é advogado. Todo texto
> jurídico desta feature (`LICENSE` com os dados do titular, `CONTRIBUTING.md`, `legal/EULA.md`,
> `legal/PRIVACY.md`, `legal/NOTICE.md`) é **minuta para revisão do dono**, e cada arquivo diz isso
> na primeira linha. Nada aqui foi revisado por profissional de direito. O que depende do dono está
> em `[A PREENCHER PELO DONO: …]` nos arquivos e listado em `.specs/STATE.md`, item "revisão jurídica
> do dono".

## Problem

O dono decidiu vender o MordomoOS com o código visível (AD-007: Fair Source FSL-1.1, futura
Apache-2.0 após dois anos) e distribuí-lo em instaladores assinados (AD-008). Hoje o repositório diz
o contrário em todo lugar e não diz nada do resto:

- `LICENSE` é MIT ("Copyright (c) 2026 Thiago Lopes"), os oito `package.json` dizem `"license":
"MIT"` (só o da raiz; os outros sete não dizem nada) e o `README.md` termina em "MIT — see
  LICENSE". Quem baixar o zip de hoje recebe uma licença que o dono não quer vender.
- Não existe aviso de software de terceiros. O distribuível leva 184 pacotes npm (32 do Radix e
  suas dependências, React, Fastify, better-sqlite3…) mais o Node.js embutido, cada um com uma
  licença que **exige** a reprodução do aviso (MIT, ISC, BSD, Apache-2.0, Python-2.0 do `argparse`,
  0BSD). Nada gera, confere nem reprova esse conjunto: uma dependência GPL ou sem licença entraria
  sem que ninguém visse. A lista do `tests/ui-deps.test.ts` ("a lista que o NOTICE começa") é o
  único rastro.
- Não existe EULA, política de privacidade nem política de contribuição. O produto orquestra três
  CLIs de terceiros (Claude Code, Codex, Cursor Agent) e cita marcas de dezenas de empresas, e
  nenhum texto diz que ele não os redistribui, que cada um segue os termos do seu fornecedor, nem
  que as marcas são citadas sem endosso.
- Quem avalia a compra pergunta "o que sai da minha máquina?". A resposta existe só no código: o
  produto fala com `api.github.com` (verificação de versão, desligada por padrão), `api.telegram.org`
  (se configurado), serviços de push dos navegadores (se o dono assinar), `npm audit` no `doctor`,
  URLs de webhook, de registro de skills e de conector que o dono escreve, e os CLIs falam com os
  provedores que o usuário escolheu. Nenhum documento diz isso, e nada impede que um commit
  acrescente um destino novo sem ninguém reparar.

Não há número de venda, chamado de suporte nem prazo jurídico no que a feature recebeu: o pedido é o
AD-007 e a linha 15 do roteiro ("Licença FSL-1.1 (futura Apache-2.0), EULA, privacidade, telemetria
opt-in", "revisão jurídica do dono").

Quando isto entregar: o repositório carrega o texto canônico do FSL-1.1 com a licença futura
Apache-2.0; um comando gera o aviso de terceiros do que o instalador leva e reprova licença fora da
lista; um teste varre o código atrás de todo destino de rede e reprova o novo sem entrada na política
de privacidade; o EULA e a privacidade existem como minuta honesta, com tudo que é do dono marcado; e
o README e a documentação dizem a mesma coisa. Quem compra lê "nenhuma telemetria" e tem um teste que
a sustenta.

## Flow

Reutiliza o `package-lock.json` (fonte do conjunto distribuído, já com `dev`/`optional` por pacote),
o `scripts/package.mjs` (já copia `LICENSE` e o `LICENSE` do Node para o instalador) e o padrão
"script `.mjs` na raiz + teste que o importa" de `scripts/bundle-size.mjs` com
`tests/bundle-size.test.ts`; não duplica nenhum gerador de licenças de terceiros.

1. `package-lock.json` (exists) + `node_modules/<pacote>/LICENSE*` (exists) + `legal/license-policy.json`
   (door 3) → `scripts/licenses.mjs` (door 3): separa o conjunto **distribuído** (o que a trava marca
   como não-`dev`) das **ferramentas de build**, avalia cada licença SPDX contra a lista, lê o texto de
   licença de cada pacote distribuído → `legal/THIRD_PARTY_NOTICES.md` (door 3, gerado, versionado).
2. `scripts/licenses.mjs --check` (door 3) → compara a saída com o arquivo versionado e sai com `1`
   quando divergem ou quando uma licença reprova; é o que `tests/legal.licenses.test.ts` chama.
3. `package-lock.json` (exists) → `scripts/sbom.mjs` (door 7) → `build/sbom/mordomo-os.cdx.json` (artefato de
   build, não versionado): o mesmo conjunto distribuído do passo 1, escrito como CycloneDX 1.5, sem relógio
   nem acaso.
4. Código-fonte (exists; `core/src`, `contracts/src`, `adapters/*/src`, `apps/api/src`, `apps/command-centre/src`,
   `scripts/`, `connectors/`, `routines/`, `skills/`) → `scripts/network-scan.mjs` (door 5), que
   lê a árvore sintática do TypeScript (`typescript` já é devDependency) e lista cada ponto de rede e cada
   host literal → compara com `legal/network-policy.json` (door 5) → `legal/PRIVACY.md` (door 5) precisa
   citar cada host da política; `tests/legal.network.test.ts` fecha as três pontas.
5. `scripts/package.mjs` (exists) chama `stageLegal` de `scripts/legal-stage.mjs` (door 6), que copia
   `LICENSE`, `legal/` e o SBOM para dentro do instalador; o Node embutido segue com o próprio `LICENSE`
   em `runtime/LICENSE` (exists).

## Impact

| Front       | What changes                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | new term: **componente distribuído** = pacote npm que a trava marca não-`dev`; entra no aviso e na lista estrita. **Ferramenta de build** = o resto; entra no aviso só por nome, versão e licença, e a lista aceita também `MPL-2.0` e `CC-BY-4.0` (hoje: `lightningcss`, `axe-core` e `caniuse-lite`, nenhum entra no instalador). Quem ramifica nisso hoje: ninguém (`tests/ui-deps.test.ts` lê uma lista própria de licenças e não muda).       |
| domain      | existing term: "licença do projeto" era MIT e passa a ser FSL-1.1-ALv2 — quem lê a palavra hoje: `README.md` (última seção), `package.json` da raiz (`"license": "MIT"`), `docs/install.md`, `docs/README.pt-BR.md`, `scripts/package.mjs` (copia `LICENSE`, sem ler o conteúdo) e `tests/ui-deps.test.ts` (só a licença das dependências). Releases antigas (o zip `MordomoOS-0.8.0-macos-arm64.zip`) continuam sob a MIT em que foram entregues. |
| domain      | existing term: "política de privacidade" não existia; `docs/security.md` já descreve o que sai da máquina em pedaços (push, Telegram, `GET /` e proxies) e passa a ser citado pela política, sem mudar.                                                                                                                                                                                                                                            |
| build       | `package.json` da raiz ganha quatro scripts (`licenses:write`, `licenses:check`, `sbom`, `network:scan`); nenhuma dependência nova (doors 3 e 7). `.prettierignore` passa a ignorar `legal/` (o aviso gerado e os textos canônicos mantêm a formatação de quem os escreveu).                                                                                                                                                                       |
| lockfile    | duas entradas tinham `version` 0.6.0 com `resolved` e `integrity` de 0.5.0 (`@clack/core`, `ret`: o aumento de versão de 04/09/2026 as reescreveu). Corrigidas para 0.5.0 num commit à parte (`40fee52`) porque `npm sbom` recusava a árvore e o aviso nomearia versões que não são as entregues.                                                                                                                                                  |
| stored data | nada a migrar: nenhum dado do usuário, nenhuma configuração e nenhum esquema muda. O arquivo `legal/network-policy.json` e o `legal/license-policy.json` são do repositório, não da home.                                                                                                                                                                                                                                                          |

## Relations

None - no stored-data shape change

## Surface

None - nothing consumed outside

(A superfície desta feature são arquivos de texto e quatro comandos; as decisões de cada um estão em
`## Observable`. Nenhuma rota de `/api` muda, e nenhuma tela muda: não existe tela "Sobre" em
Configurações, então a feature roda sem o perfil `ui` e a pergunta de criá-la vai ao dono.)

## Landing

| One-way door                                                                    | Literal shape                                                                                                                                                                                                                                                                                                                                                          | Alternative rejected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Texto e identificador da licença                                             | `LICENSE` na raiz = bloco de minuta + o texto de `https://fsl.software/FSL-1.1-ALv2.template.md` (guardado sem alteração em `legal/vendor/FSL-1.1-ALv2.template.md`, SHA-256 fixado no teste) com `${year}` = `2026` e `${licensor name}` = `[A PREENCHER PELO DONO: titular dos direitos autorais]`. Em todo `package.json`: `"license": "SEE LICENSE IN LICENSE"`.   | `"license": "FSL-1.1-Apache-2.0"` (o nome do pedido; o abreviado oficial do texto é `FSL-1.1-ALv2` e não consegui confirmar o identificador SPDX aqui, então um valor que talvez o npm não reconheça fica fora); `UNLICENSED` (diz ao npm que não há concessão, o contrário do FSL); manter MIT (contradiz o AD-007).                                                                                                                                                                                        |
| 2. Política de contribuição                                                     | `CONTRIBUTING.md`: DCO 1.1 (texto de `developercertificate.org`), `Signed-off-by:` em cada commit (`git commit -s`), contribuição entra sob a mesma licença do projeto (FSL-1.1-ALv2), **sem CLA**.                                                                                                                                                                    | CLA (exige a figura jurídica do titular, o texto e um serviço de assinatura, nenhum dos três decidido; sem CLA o dono não pode relicenciar a contribuição de terceiros, e isso é pergunta ao dono).                                                                                                                                                                                                                                                                                                          |
| 3. Aviso de terceiros gerado + lista de licenças                                | `scripts/licenses.mjs` (`--write`, `--check`) lê `package-lock.json`; `legal/license-policy.json` = `{ "allowedDistributed": [SPDX…], "allowedToolingExtra": ["MPL-2.0","CC-BY-4.0"], "overrides": { "<nome>@<versão>": { "license", "reason" } } }`; saída `legal/THIRD_PARTY_NOTICES.md`. Expressão SPDX com `OR` passa se uma alternativa passa; `AND` exige todas. | Pacote `license-checker`/`license-report`/`generate-license-file` como devDependency (lê `node_modules`, não a trava, dependência nova com a própria árvore de licenças e nada que o teste controle); lista só no CI (não roda no computador do dono).                                                                                                                                                                                                                                                       |
| 4. SBOM (a forma mudou na construção: ver a porta 7)                            | `npm run sbom` = `node scripts/sbom.mjs` → `npm sbom --sbom-format cyclonedx --omit dev --package-lock-only --sbom-type application` → `build/sbom/mordomo-os.cdx.json`; o instalador leva a cópia em `legal/sbom.cdx.json`.                                                                                                                                           | `@cyclonedx/cyclonedx-npm` como devDependency (uma árvore nova só para escrever o que o npm 10 já escreve); escrever o formato à mão (um formato de terceiros mantido por nós).                                                                                                                                                                                                                                                                                                                              |
| 5. Varredura de rede e política de saída                                        | `legal/network-policy.json` = `{ "hosts": [{ "id", "match": ["host"…], "role": "contact"\|"link"\|"user-defined", "trigger", "default", "data" }], "sites": [{ "file", "kind", "count", "hosts": ["id"…] }] }`; `scripts/network-scan.mjs --check` exit `1` em host ou ponto de rede fora da política; `legal/PRIVACY.md` cita cada `match`.                           | Só a lista de hosts (um segundo `fetch` no mesmo arquivo para outro host passaria); regex sobre texto (L-029: erra comentários, template e `?? fetch`); proxy de rede nos testes (mede o que roda, não o que o código pode fazer).                                                                                                                                                                                                                                                                           |
| 6. `legal/` é o caminho que o instalador consome                                | `legal/` na raiz, copiada inteira para `<instalador>/legal/` por `scripts/package.mjs`; a feature `distribuicao` (14) deve manter essa cópia.                                                                                                                                                                                                                          | Textos espalhados na raiz e em `docs/` (a feature 14 teria de listar cada arquivo; um novo texto esqueceria de entrar no instalador).                                                                                                                                                                                                                                                                                                                                                                        |
| 7. SBOM escrito do `package-lock.json` (emenda da porta 4, achada ao construir) | `scripts/sbom.mjs` lê a trava com o mesmo `lockPackages` do aviso e escreve CycloneDX 1.5 em `build/sbom/mordomo-os.cdx.json` (`bom-ref` = o `purl`, uma entrada por `nome@versão`, `dependencies` pelo grafo da trava, sem `timestamp`, `serialNumber` derivado do conteúdo); `npm run sbom` = `node scripts/sbom.mjs`; o instalador leva `legal/sbom.cdx.json`.      | `npm sbom --package-lock-only --omit dev` (a porta 4): **mediu-se que omite 23 dos 184 pacotes distribuídos** (react, react-dom, zod, ajv, picocolors…) neste monorepo, com `--workspaces` ou sem, então um SBOM que parece completo e não é; sem `--package-lock-only` roda sobre `node_modules` (depende da máquina) e escreve um `serialNumber` e um `timestamp` aleatórios (nada reprodutível); `@cyclonedx/cyclonedx-npm` (uma árvore nova de dependências, e sem garantia de não ter o mesmo defeito). |

- Nada além disso é difícil de reverter. Em particular não é porta: o idioma dos textos (pt-BR), a
  lista de marcas, as frases do EULA e da privacidade — mudam por edição de texto.

## Criteria

### S1: o repositório diz uma licença só, e é a do AD-007 (P1)

Quem abre `LICENSE`, qualquer `package.json`, o README ou o `CONTRIBUTING.md` lê FSL-1.1-ALv2 e
"minuta".

**Acceptance Criteria**

1. The repository SHALL hold at its root a `LICENSE` that is the canonical Functional Source License 1.1, ALv2 Future License text, differing from `legal/vendor/FSL-1.1-ALv2.template.md` only in the Notice line (`Copyright 2026 [A PREENCHER PELO DONO: titular dos direitos autorais]`) and in a leading draft block.
2. The vendored template SHALL have the SHA-256 recorded in `legal/README.md`, so that a change to the text of the terms is a visible, deliberate edit.
3. The `license` field of each of the 8 `package.json` files (root, `contracts`, `core`, the three adapters, `apps/api`, `apps/command-centre`) SHALL be `SEE LICENSE IN LICENSE`.
4. The `README.md` license section SHALL name FSL-1.1-ALv2, say that each version converts to Apache-2.0 on the second anniversary of its release, say that the texts are drafts for the owner's review, and link `LICENSE`, `legal/EULA.md`, `legal/PRIVACY.md` and `legal/THIRD_PARTY_NOTICES.md`; no line of it SHALL call the product MIT.
5. The file `CONTRIBUTING.md` SHALL carry the Developer Certificate of Origin 1.1 text, require `Signed-off-by:` on every commit, state that a contribution enters under FSL-1.1-ALv2, state that there is no CLA, and say it is a draft pending the owner's decision.
6. WHEN `npm run dist` builds the distributable THEN it SHALL copy `LICENSE`, `legal/EULA.md`, `legal/PRIVACY.md`, `legal/NOTICE.md`, `legal/THIRD_PARTY_NOTICES.md` and the SBOM into it, next to the Node `LICENSE` it already copies to `runtime/`.

### S2: o aviso de terceiros nasce da trava e reprova o que não pode ir (P1)

Um comando gera o aviso do que o instalador leva; outro o confere; uma licença fora da lista para tudo.

**Acceptance Criteria**

7. WHEN `node scripts/licenses.mjs --write` runs THEN the system SHALL write `legal/THIRD_PARTY_NOTICES.md` listing, for each distributed npm package, its name, version, SPDX license expression, the `resolved` URL of its tarball and the full text of its license file, grouping packages whose license texts are identical.
8. The output SHALL be a pure function of `package-lock.json`, the license files of the installed packages and `legal/license-policy.json`: two runs from different working directories, locales and time zones SHALL write identical bytes, with no date, no path of the machine and no random value.
9. WHEN the committed `legal/THIRD_PARTY_NOTICES.md` differs from the regenerated output THEN `node scripts/licenses.mjs --check` SHALL exit `1` and name the file and `licenses:write`; otherwise it SHALL exit `0`.
10. The notice SHALL contain every package of the dependency closure of the six Radix primitives of `tests/ui-deps.test.ts` (45 packages today), each with its license, SHALL name Node.js (MIT) and SQLite as bundled components, and SHALL carry the license text of every font file under `apps/command-centre/public/fonts`.
11. IF a distributed package has a license that is not in `allowedDistributed` (GPL, AGPL, LGPL, SSPL, MPL-2.0, CC-BY, `UNLICENSED`, a free-text `SEE LICENSE IN`, or none) THEN `--check` SHALL exit `1` naming the package, its version and its license.
12. IF a build-tool package has a license that is in neither `allowedDistributed` nor `allowedToolingExtra` THEN `--check` SHALL exit `1` naming it; a build-tool package under `MPL-2.0` or `CC-BY-4.0` SHALL pass.
13. WHEN a license is an SPDX expression THEN `--check` SHALL accept `A OR B` if at least one alternative is allowed, SHALL accept `A AND B` only if both are, and SHALL treat an unparseable expression as not allowed.
14. WHEN a package declares no license field THEN `--check` SHALL fail it unless `legal/license-policy.json` `overrides` holds an entry for that exact `name@version` with a reason; a new version of the package SHALL fail again.
15. IF a `package-lock.json` entry's `version` differs from the version in its `resolved` tarball name, or an installed package's version differs from the lockfile's, THEN `--check` SHALL exit `2` naming the package.
16. WHEN `npm run sbom` runs THEN it SHALL write `build/sbom/mordomo-os.cdx.json` as a CycloneDX document (`bomFormat: "CycloneDX"`) whose components are the distributed packages, with no build tool in it.

### S3: o EULA diz o que o produto é e o que ele não é (P2)

Uma minuta em português, completa na estrutura, com tudo que é do dono marcado.

**Acceptance Criteria**

17. The file `legal/EULA.md` SHALL open with the draft notice and have these sections: object and license (pointing to `LICENSE` and saying which text prevails), permitted and prohibited use, third-party CLIs, third-party trademarks, no warranty, limitation of liability, support and updates, termination, governing law and venue.
18. The EULA's third-party CLI section SHALL state that MordomoOS orchestrates Claude Code, Codex and Cursor Agent, does not redistribute them, does not sublicense them, that each follows its supplier's terms, and that the user signs in with their own account.
19. The EULA's trademark section SHALL list every third-party brand that the repository cites (the list in `legal/trademarks.json`) and say that they are cited to identify compatibility, without endorsement; IF the sweep of the tracked text finds a brand of its list that `legal/trademarks.json` lacks THEN the test SHALL fail naming it.
20. WHERE a term depends on a decision of the owner (titular, document number, address, contact, price and sales model, governing law, venue, warranty period) the EULA SHALL show it as `[A PREENCHER PELO DONO: …]`, and no person, company, address or tax number SHALL appear that the repository did not already hold.

### S4: a política de privacidade é o que o código faz, e o código não foge dela (P1)

Lista fiel do que fica e do que sai da máquina; uma varredura impede o destino novo sem aviso.

**Acceptance Criteria**

21. The file `legal/PRIVACY.md` SHALL open with the draft notice, state where the data lives (the per-user folder of each platform, `MORDOMO_HOME`, and the checkout itself when run from source), state that the product sends nothing to servers of the licensor, and list every outbound destination with when it happens, whether it is on by default, and what is sent.
22. The sweep SHALL list every network point in the scanned sources (a call or reference to `fetch`, an import of `node:http`, `node:https`, `node:http2`, `node:net`, `node:tls`, `node:dns`, `node:dgram`, `undici`, `ws` or `node-fetch`, `EventSource`, `WebSocket`, `XMLHttpRequest`, `sendBeacon`, a spawn of the npm CLI) and every host literal (a URL, a bare host constant or a host regular expression), ignoring comments, types, and loopback.
23. IF a network point or a host literal is not in `legal/network-policy.json` THEN `node scripts/network-scan.mjs --check` SHALL exit `1` naming file, kind and host; IF a policy entry has no match in the code and is not marked implicit THEN it SHALL also exit `1`.
24. The privacy policy SHALL contain the `match` of every host of `legal/network-policy.json`, and every `contact` host SHALL declare its trigger, its default and the data sent.
25. WHERE a destination is conditional, the policy SHALL match what the code does: `api.github.com` only when `updates.check` is on or the owner asks (off by default), `api.telegram.org` only with the channel enabled (off by default), push services only after a subscription, webhooks only with `routines.allowWebhooks` (off by default), skill registries only when the owner adds one (none by default), `npm audit` of the `doctor` unless `MORDOMO_SKIP_NPM_AUDIT=1`.
26. The privacy policy SHALL say that the third-party CLIs send prompts and files to the provider the user chose, under that provider's terms and not under this policy.

### S5: nenhuma telemetria, e a porta que fica documentada (P1)

Hoje não existe telemetria; o texto diz isso e um teste o sustenta.

**Acceptance Criteria**

27. The product SHALL send no telemetry: no analytics, error-reporting or tracking package in `package-lock.json`, no `sendBeacon` or analytics call in the sweep, and no setting whose name holds `telemetry`, `analytics` or `crash` in the default settings.
28. The file `legal/PRIVACY.md` SHALL state "nenhuma telemetria" and describe the conditions under which telemetry could exist later: opt-in, off by default, no personal identifier, a consent screen, documented first, and the policy and the sweep changed in the same commit.
29. The system SHALL NOT implement telemetry in this feature; the decision whether to ever do so goes to the owner as a question in `.specs/STATE.md` with "não implementar" as the adopted default.

### S6: o README e a documentação dizem a mesma coisa e o dono sabe o que falta (P2)

**Acceptance Criteria**

30. The `README.md`, `docs/README.pt-BR.md` and `docs/install.md` SHALL state the license, that the product orchestrates third-party CLIs it does not bundle, and where the EULA, the privacy policy and the notices are; none of them SHALL state the product license as MIT.
31. The repository SHALL carry the draft notice ("minuta … não é aconselhamento jurídico … revisão do dono") in the first lines of `LICENSE`, `CONTRIBUTING.md` and every file under `legal/` that holds legal text.
32. The file `.specs/STATE.md` SHALL list, under "revisão jurídica do dono", every distinct `[A PREENCHER PELO DONO: …]` text found in the tracked legal files.
33. The file `CHANGELOG.md` SHALL have an entry for the feature under Unreleased.

**Independent test:** `node scripts/licenses.mjs --check && node scripts/network-scan.mjs --check` exit 0 in a clean checkout; `npm run dist:quick` leaves `legal/` in the stage folder; adding `fetch("https://tracker.example.net")` to any scanned file makes the second command exit 1.

## Out of scope

| Excluded                                                      | Why                                                                                                                                                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementar telemetria opt-in                                 | padrão mais conservador: não implementar; a porta fica no texto e a pergunta no STATE (AC 28, 29)                                                                            |
| Tela "Sobre" em Configurações (versão, licença, avisos)       | não existe tela "Sobre" hoje; criá-la é trabalho de `ui` (design.md, primitivas, axe) e vai ao dono como pergunta, com o padrão "sem UI"                                     |
| Chave de licença, ativação ou verificação online              | nada disso existe no código; o EULA diz que não há, e o dono decide o modelo de venda                                                                                        |
| Serviço de assinatura de CLA ou verificação automática de DCO | o DCO é texto e convenção de commit; um bot é decisão do dono depois da pergunta CLA × DCO                                                                                   |
| Cabeçalho de copyright em cada arquivo-fonte                  | a licença se aplica por `LICENSE` na raiz e `license` nos pacotes; cabeçalho por arquivo é decisão de forma do dono e tocaria centenas de arquivos, inclusive o de segurança |
| Atualizador assinado e seus hosts                             | feature 14 (`distribuicao`); a varredura da feature já força a política a ser atualizada quando ele chegar                                                                   |
| Tradução dos textos jurídicos para inglês                     | cada tradução dobra a revisão do dono; pergunta ao dono com padrão pt-BR                                                                                                     |
| Remover o zip do histórico e a revisão jurídica dos termos    | itens do dono já registrados no roteiro                                                                                                                                      |

## Assumptions

| Assumption                                                | Chosen default                                                                                                                                                                                              | Rationale                                                                                                                   | Confirmed? |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Idioma dos textos jurídicos                               | pt-BR (EULA, privacidade, `NOTICE.md`, `CONTRIBUTING.md`); o `LICENSE` e o DCO ficam no texto canônico em inglês                                                                                            | o dono escreve em português; o texto canônico não se traduz                                                                 | n          |
| Titular dos direitos autorais                             | `[A PREENCHER PELO DONO: titular dos direitos autorais]`; o MIT antigo citava "Thiago Lopes", que não é copiado porque o dono pode vender por empresa                                                       | não inventar nome nem razão social                                                                                          | n          |
| Identificador SPDX                                        | o oficial do texto é `FSL-1.1-ALv2`; no `package.json` vale `SEE LICENSE IN LICENSE`                                                                                                                        | o pedido citou `FSL-1.1-Apache-2.0`, que não é o abreviado do texto publicado em `fsl.software`                             | n          |
| CLA × DCO                                                 | DCO, sem CLA                                                                                                                                                                                                | não exige figura jurídica nem serviço                                                                                       | n          |
| Qual texto prevalece, EULA ou FSL                         | o `LICENSE` (FSL) prevalece sobre o código-fonte; o EULA trata do aplicativo distribuído, de suporte e de relação com CLIs                                                                                  | o FSL já concede os usos permitidos; um EULA mais restritivo sobre o mesmo código contradiria a licença que o dono escolheu | n          |
| `MPL-2.0` e `CC-BY-4.0`                                   | aceitas só em ferramenta de build, não em componente distribuído                                                                                                                                            | `lightningcss`, `axe-core` e `caniuse-lite` rodam no build e nos testes e não entram no instalador                          | n          |
| Lista estrita de licenças                                 | `MIT`, `MIT-0`, `ISC`, `BSD-2-Clause`, `BSD-3-Clause`, `Apache-2.0`, `0BSD`, `BlueOak-1.0.0`, `CC0-1.0`, `Python-2.0`, `Unlicense`, `Zlib`                                                                  | permissivas que só pedem o aviso; a lista cresce por edição visível de `legal/license-policy.json`                          | n          |
| Pacote sem campo `license` (`svg-tags@1.0.0`, ferramenta) | `overrides` por nome e versão, com a evidência (o `LICENSE` do pacote é MIT)                                                                                                                                | só ferramenta de build; a exceção cai quando a versão muda                                                                  | n          |
| Dados do usuário                                          | descritos nos caminhos reais (`~/Library/Application Support/MordomoOS`, `~/.local/share/mordomo-os`, `%LOCALAPPDATA%\MordomoOS`, `MORDOMO_HOME`, ou o checkout), não em `~/.mordomo`, que o código não usa | fidelidade ao código (`core/src/paths.ts`)                                                                                  | n          |
| Autoria por IA                                            | os commits trazem `Claude <noreply@anthropic.com>` como autor de grande parte do código; a feature não opina sobre titularidade e registra a pergunta                                                       | é questão jurídica do dono                                                                                                  | n          |
| `LICENSE` e licença de versões antigas                    | o texto novo vale para o que for distribuído a partir daqui; o que saiu sob MIT (o zip 0.8.0) segue MIT                                                                                                     | uma licença concedida não se retira por commit; vai ao dono como pergunta                                                   | n          |

**Open questions:**

| #   | Kind           | Question                                                                                                      | Until answered                                                                                                  |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | blocks go-live | Quem é o titular (pessoa ou empresa), com documento e endereço, e qual o contato de privacidade e de suporte? | `LICENSE`, `EULA`, `PRIVACY` e `NOTICE` ficam com `[A PREENCHER PELO DONO: …]`; não se publica release com eles |
| 2   | blocks go-live | A revisão por advogado dos textos e a decisão sobre foro, lei aplicável, garantia, preço e modelo de venda    | os textos são minuta e dizem isso                                                                               |
| 3   | open           | CLA em vez de DCO; EULA em inglês também; tela "Sobre" em Configurações; telemetria opt-in um dia             | padrão adotado em cada uma: DCO, só pt-BR, sem UI, nenhuma telemetria                                           |

## Observable

Worksheet, não a revisão. Uma linha pode agrupar a mesma decisão em vários comandos.

| Surface                                         | Decision                                                | Landing                                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| command `licenses:write`                        | output format and verbosity                             | AC 7: um arquivo markdown; imprime uma linha com o número de componentes e de ferramentas                                                       |
| command `licenses:check`                        | flags, exit codes, what it prints when it fails halfway | AC 9, 11, 12, 15: `0` confere, `1` divergência ou licença, `2` ambiente fora da trava; lista todos os problemas de uma vez, não só o primeiro   |
| command `sbom`                                  | output format, exit codes                               | AC 16: `0` escreve o arquivo, diferente de zero repete o erro do npm; o caminho de saída pode ser dado com `--out`                              |
| command `network:scan`                          | output format, flags, exit codes                        | AC 22, 23: tabela por padrão, `--check` falha com `1`, `--json` para máquina                                                                    |
| document `LICENSE`, `EULA`, `PRIVACY`, `NOTICE` | structure, tone, depth, what the reader does next       | AC 1, 17, 21, 31: minuta no topo, seções fixas, linguagem direta; o fim de cada texto diz o que o dono precisa preencher e para onde ir (STATE) |
| document `THIRD_PARTY_NOTICES.md`               | structure, ordering, what happens to duplicates         | AC 7, 8: índice em tabela ordenada por nome e versão, textos agrupados por conteúdo idêntico, nada que varie de máquina para máquina            |
| document `README`, `docs/*`                     | structure and next step                                 | AC 4, 30: seção "License" e aviso de CLIs de terceiros com links para os textos                                                                 |
| distributable                                   | what is included                                        | AC 6                                                                                                                                            |
| all new commands                                | authorization, rate limits, versioning                  | n/a - são scripts locais do repositório, sem token, sem rota e sem versão de contrato                                                           |
| all new documents                               | empty, loading, error and unauthorised states           | n/a - texto estático, sem tela                                                                                                                  |

### Nine dimensions

As nove dimensões ficam em `checks.md`, `## Swept`, cada uma com o check que a observa.

## Sources

- AD-007 e AD-008 em `.specs/STATE.md` — licença Fair Source FSL-1.1 com futura Apache-2.0 após dois anos; assinatura de release com segredos que o dono cadastra.
- `.specs/roadmap.md`, linha 15, e "Itens fora do código" — escopo e revisão jurídica do dono.
- Texto oficial do FSL-1.1 (ALv2) em `https://fsl.software/FSL-1.1-ALv2.template.md`, lido em 11/10/2026 — fixa o texto, o abreviado e os dois campos a preencher.
