# Distribuição — shell Tauri 2, instaladores assinados, updater assinado e release por tag

> **Aviso permanente.** O dono tem Apple Developer ID e certificado Windows e cadastra os segredos ele mesmo
> (AD-008). Nada aqui inventa, guarda ou grava um segredo, uma chave ou um certificado: o pipeline roda sem eles e,
> sem eles, entrega artefatos **marcados como não assinados**. O que só um Windows, um macOS ou um segredo real prova
> está em `checks.md` como **não verificado**, com o job que o prova.

## Problem

Quem compra o MordomoOS hoje recebe um `.zip` (macOS) ou `.tar.gz` (Linux) que contém um bundle de Node, um
lançador de shell e, no macOS, uma janela Swift (`scripts/macos-app/main.swift`) compilada só se houver `swiftc`:

- Não há instalador no Windows nem no Linux: o Windows recebe um `MordomoOS.cmd` que abre o navegador, o Linux um
  script `MordomoOS` e um `.desktop` com `INSTALL_DIR` para o usuário editar.
- Não há atualização: quem quer a versão nova baixa o zip de novo. A verificação de versão existente
  (`apps/api/src/updates.ts`) só avisa que há uma versão, desligada por padrão.
- O `release.yml` é manual, usa `macos-13` (runner aposentado) e tem um defeito de lógica: `if: env.CERT != ''` lê um
  `env` do próprio passo, que o `if` não enxerga, então o passo de certificado nunca roda. Nada o testa.
- A janela nativa só existe no macOS; no Windows e no Linux o produto "abre o navegador" num endereço fixo
  (`127.0.0.1:4777`), e `GET /` entrega o token do dono a qualquer processo da máquina que mande cabeçalhos de
  navegador (`docs/security.md`, "uma redução, não uma fronteira"; "fechar exige um segredo que o lançador entrega
  ao navegador", projeto conhecido e não construído).
- Nenhum arquivo diz qual versão o CLI é (`mordomo --version` falha com "Unknown option"), e nada obriga as oito
  versões de `package.json` a serem iguais às do shell e do instalador.

O pedido é o AD-008 e a linha 14 do roteiro ("Shell Tauri 2, instaladores assinados, updater assinado, workflow de
release por tag"). O repositório não traz número de downloads nem chamado de suporte.

Quando isto entregar: um app instalável nos três sistemas que sobe o serviço local sozinho, mostra o Command Centre
na própria janela, desliga o serviço ao sair e diz o que houve quando ele não sobe; uma tag `v*` produz um release
**rascunho** com instaladores, somas de verificação, SBOM, avisos de terceiros e as notas do `CHANGELOG`,
assinados quando o dono cadastrou os segredos e marcados "NÃO ASSINADO" quando não; um app com a chave pública do
dono se atualiza por um manifesto assinado; e `mordomo --version`, os manifestos e o instalador dizem o mesmo número.

## Flow

Reutiliza `scripts/package.mjs` (já monta `lib/mordomo.mjs`, o addon SQLite, `ui/`, `seed/`, o Node embutido e
`legal/` por `scripts/legal-stage.mjs`), o servidor que já serve a UI e injeta o token (`apps/api/src/server.ts`),
o desligamento limpo de `startServer` e o formato de teste de workflow de `tests/ci.workflow.test.ts`; não cria
um segundo empacotador nem um segundo servidor.

1. `npm run build` (exists) -> `node scripts/package.mjs --payload apps/desktop/payload` (door 8) - monta o payload
   (bundle, addon, UI, seed, Node, `legal/` com o SBOM) numa pasta fixa e, no macOS com identidade, assina o código
   nativo dentro dela.
2. `tauri build` (door 9) - `apps/desktop/src-tauri` (new, door 9) embrulha o payload como recurso e produz
   `.app`/`.dmg`, NSIS `-setup.exe`, `.deb` e `.AppImage`; assina com os segredos do passo, se existirem.
3. App aberto -> `mordomo-shell-core` (door 9; biblioteca sem webview) - gera o segredo do lançamento, escolhe a
   porta preferida, sobe `lib/mordomo.mjs start --foreground --sidecar` com o Node embutido (door 7), lê a linha
   `MORDOMO_READY`, sonda `GET /` e devolve a URL.
4. `apps/api` (exists) `cli.ts` e `server.ts` - em modo sidecar: porta, linha de prontidão, desligamento por EOF do
   stdin, recusa em vez de tomar o lock e a porta de outro serviço, e o aperto de mão do cookie (door 7) que só então
   injeta o token do dono em `GET /`.
5. Janela principal (Tauri, door 9) - `navigate(URL?launch=…)`; o servidor responde `302 /` com
   `Set-Cookie: mordomo_launch=…; HttpOnly; SameSite=Lax`; o Command Centre (exists) abre.
6. Sair (menu, ⌘Q, fechar) -> `mordomo-shell-core` (door 9) fecha o stdin do serviço, espera até 15 s e só então mata.
7. Tag `v*` -> `.github/workflows/release.yml` (exists, reescrito; door 10) -> `scripts/version-sync.mjs --check --tag`,
   `scripts/release-notes.mjs`, `scripts/updater-manifest.mjs` (new, no door - placement) -> release rascunho.
8. App com a chave do dono -> `tauri-plugin-updater` (door 4) -> `latest.json` do release `latest` -> verifica a
   assinatura minisign -> para o serviço -> instala -> reinicia.

## Impact

| Front       | What changes                                                                                                                                                                                                                                                                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | new term: `sidecar` - o serviço local iniciado e supervisionado pelo shell, com segredo de lançamento; vive em `apps/api` (modo) e `apps/desktop/shell-core` (supervisor)                                                                                                                                                                           |
| domain      | existing term: `start --foreground` só escutava `settings.port` e matava um serviço antigo que segurasse a porta ou o lock; com `--sidecar` nunca mata outro processo e escuta a porta pedida. Quem ramifica nele hoje: `startDetached` (`cli.ts`), o serviço de login e o `launch`; nenhum passa `--sidecar`, então o comportamento deles não muda |
| domain      | existing term: `GET /` "injeta o token a quem parece um navegador" continua assim sem `--sidecar`; com o segredo definido, exige o cookie. Quem depende: `tests/api.security-p0.test.ts`, `tests/api.ui-assets.test.ts` e o e2e, que não definem o segredo                                                                                          |
| domain      | existing term: o instalador era `package.mjs` + lançador; passa a ser o app Tauri. `npm run dist` continua gerando o arquivo portátil para quem o quiser, mas o CI de release não o publica mais (pergunta 1)                                                                                                                                       |
| stored data | nada a migrar: a casa de dados é a mesma (`MORDOMO_HOME` ou a pasta do usuário); o shell guarda só `desktop-state.json` (a última porta) na pasta de dados do app                                                                                                                                                                                   |
| tooling     | `Cargo.lock` e a árvore de crates (476 do runtime com o atualizador) entram no repositório; `@tauri-apps/cli` vira devDependency; `licenses:check` ganha o ramo Rust                                                                                                                                                                                |

## Relations

`None - no stored-data shape change` no banco. O único arquivo novo no disco do usuário é `desktop-state.json`
(a última porta usada, para o `localStorage` do Command Centre manter a mesma origem entre aberturas).

## Surface

Nenhuma rota nova no contrato REST (a API continua congelada, AD-024: a troca de cookie acontece em `GET /` e
`GET /index.html`, que já não são rotas do contrato). A superfície nova é de processo:

| Route                                         | In                         | Out                                                                     | Status       |
| --------------------------------------------- | -------------------------- | ----------------------------------------------------------------------- | ------------ |
| `GET /?launch=<segredo>` (só em modo sidecar) | o segredo de 43 caracteres | `302` para `/` com `Set-Cookie: mordomo_launch` · ou a página sem token | `302`, `200` |
| `GET /` (modo sidecar)                        | cookie `mordomo_launch`    | a página com `<meta name="mordomo-token">` preenchido ou vazio          | `200`        |

Superfícies de processo (sem código de status HTTP; o que decide é o código de saída):

- `mordomo start --foreground --sidecar --port <n>` · entra `MORDOMO_LAUNCH_TOKEN` (≥ 32 caracteres) e `--port` 0..65535 · sai a linha `MORDOMO_READY {"v":1,"pid","port","version","updatesCheck"}` no stdout e o desligamento no EOF do stdin · saídas `0`, `2`, `4`, `5`
- `mordomo --version` · `-v` · `mordomo version` · sai `mordomo <versão>` · saída `0`
- `mordomo-desktop --self-test` · sai uma linha JSON `{ok,port,version,stopped}` ou `{ok,error:{kind,detail,tail}}` · saídas `0`, `1`

## Landing

| One-way door                                     | Literal shape                                                                                                                                                                                                                                                                                                           | Alternative rejected                                                                                                                                                                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Identificador do pacote                       | `"identifier": "com.mordomo.desktop"` em `tauri.conf.json`                                                                                                                                                                                                                                                              | `com.mordomo.app` (o `CFBundleIdentifier` do `.app` Swift do 0.8.0) - o Tauri avisa que um identificador terminado em `.app` colide com a extensão do pacote do macOS, e o 0.8.0 só saiu com assinatura ad hoc, então não há assinado a continuar |
| 2. Nome do produto                               | `productName: "MordomoOS"` (nome do instalador, do atalho, da pasta de instalação)                                                                                                                                                                                                                                      | `Mordomo OS` com espaço - o nome da pasta de dados já é `MordomoOS` e a de instalação não pode colidir com ela por grafia                                                                                                                         |
| 3. Chave de atualização                          | chave pública minisign em `apps/desktop/src-tauri/tauri.updater.conf.json` (`plugins.updater.pubkey`), privada só em `TAURI_SIGNING_PRIVATE_KEY`; **perder a privada = nenhum app instalado atualiza de novo**                                                                                                          | chave dentro do repositório - quem lê o repositório assinaria atualizações                                                                                                                                                                        |
| 4. Endpoint e canal                              | um endpoint `https://github.com/tvpl/agentic-os/releases/latest/download/latest.json` (canal único: o release `latest`, não rascunho e não pré-release); tags `v<semver>`; pré-release (`v1.0.0-rc.1`) publicado como pré-release não é oferecido                                                                       | dois manifestos (`stable`/`beta`) - um segundo canal é um segundo contrato que nenhum app antigo conhece                                                                                                                                          |
| 5. Nomes dos segredos                            | os do cabeçalho do `release.yml` (`MACOS_CERT_P12_BASE64`, `MACOS_CERT_PASSWORD`, `MACOS_SIGN_IDENTITY`, `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD`) mais `WINDOWS_CERT_PFX_BASE64`, `WINDOWS_CERT_PASSWORD`, `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`                                  | os nomes que o Tauri lê (`APPLE_CERTIFICATE`…) - o dono já cadastra pela convenção do cabeçalho                                                                                                                                                   |
| 6. Identidades de assinatura                     | Developer ID Application (equipe do dono) e o certificado Authenticode do dono; trocar o editor do Windows zera a reputação do SmartScreen                                                                                                                                                                              | assinar com certificado do CI - não existe e não pode existir no repositório                                                                                                                                                                      |
| 7. Protocolo do sidecar                          | `start --foreground --sidecar --port <n>`; env `MORDOMO_LAUNCH_TOKEN`; uma linha `MORDOMO_READY {json}` com `v: 1`; EOF do stdin desliga; saída `4` = outro serviço segura o lock/porta da casa, `5` = a porta pedida está ocupada; cookie `mordomo_launch` (`HttpOnly`, `SameSite=Lax`, `Path=/`) trocado por `302`    | uma rota HTTP de saúde - a API está congelada (AD-024), uma rota pública nova exige entrada no contrato; sinais no Windows - `SIGTERM` não existe lá e o `kill` perde o desligamento limpo                                                        |
| 8. Payload fixo                                  | `node scripts/package.mjs --payload <pasta>` escreve `lib/`, `ui/`, `seed/`, `runtime/`, `legal/`, `package.json` e nada mais (sem lançadores, sem arquivo)                                                                                                                                                             | reaproveitar a pasta de estágio por plataforma - o nome muda com versão e plataforma e o `tauri.conf.json` precisaria de um valor por build                                                                                                       |
| 9. Tauri 2 e um crate Rust no repositório        | `apps/desktop/{shell-core,src-tauri}` (workspace Cargo), `tauri` 2.12 e os plugins `single-instance`, `dialog`, `opener`, `updater` (este atrás da feature `updater`); `Cargo.lock` versionado; as chaves de capacidade só `allow-shell-status`, `allow-shell-retry`, `allow-shell-quit` na janela `main`, sem `remote` | Electron - leva um Chromium inteiro (~150 MB) e um segundo runtime JS ao lado do Node; manter só a janela Swift - existe só no macOS                                                                                                              |
| 10. Workflow de release                          | `on: push: tags: ["v*"]` e `workflow_dispatch` (este só constrói, nunca publica); `permissions: contents: read` no topo e `contents: write` só no job `publish`; só `actions/*` em tag maior; todo o resto fixo por SHA; release sempre `draft`                                                                         | `softprops/action-gh-release` e `tauri-apps/tauri-action` - dois terceiros com acesso aos segredos de assinatura; `gh release` e `tauri build` direto fazem o mesmo                                                                               |
| 11. Política de rede e de privacidade do updater | entrada `desktop-updater` (contato, desligada, `gate.setting: updates.check`) em `legal/network-policy.json`; `github-links` perde o endereço `github.com` (passa a ser dono dele o updater)                                                                                                                            | duplicar `github.com` nas duas entradas - o teste exige endereços únicos                                                                                                                                                                          |
| 12. Licenças das crates                          | seção `rust` em `legal/license-policy.json` (a lista de runtime mais `Unicode-3.0` e `CDLA-Permissive-2.0`; `MPL-2.0` só para as 5 crates nomeadas, que o Tauri traz), `legal/THIRD_PARTY_NOTICES.desktop.md` e `legal/sbom.desktop.cdx.json` gerados                                                                   | liberar `MPL-2.0` para tudo - a política diz que ele fica fora do que se distribui                                                                                                                                                                |

- Nada mais nesta mudança é difícil de reverter

## Criteria

### S1: O serviço sabe ser filho de um shell (P1)

`mordomo` ganha `--version` e um modo sidecar que o shell supervisiona sem tomar nada de outro serviço.

**Acceptance Criteria**

1. WHEN `mordomo --version`, `mordomo -v` or `mordomo version` runs THEN the CLI SHALL print exactly `mordomo <version>` where `<version>` is the `version` of the root `package.json`, and exit `0`
2. WHEN `mordomo --help` runs THEN the CLI SHALL list `--version` and exit `0`
3. WHEN `mordomo start --foreground --sidecar --port 0` runs with `MORDOMO_LAUNCH_TOKEN` of at least 32 characters THEN the service SHALL listen on `127.0.0.1` on a port chosen by the system and print one stdout line `MORDOMO_READY {"v":1,"pid":…,"port":…,"version":…,"updatesCheck":…}` whose `port` is the bound port and whose `updatesCheck` is the `updates.check` setting, only after the listener is up
4. IF `--sidecar` runs without `MORDOMO_LAUNCH_TOKEN`, or with one shorter than 32 characters, or with `--port` outside 0..65535 THEN the CLI SHALL exit `2` naming the variable or the flag and start nothing
5. IF `--port` or `--sidecar` is given to any command other than `start` THEN the CLI SHALL exit `2`
6. WHILE the service runs as a sidecar, WHEN its stdin reaches end of file THEN the service SHALL shut down through the same path as `SIGTERM` and exit `0`
7. IF another MordomoOS service holds the home's engine lock THEN the sidecar SHALL NOT stop it and SHALL exit `4` printing the holder's pid on stderr
8. IF the requested non-zero port is already in use THEN the sidecar SHALL NOT stop its holder and SHALL exit `5`
9. WHILE the launch secret is set, WHEN `GET /` arrives from loopback without the secret (query or cookie) THEN the service SHALL answer `200` with an empty `mordomo-token` meta, even when the request looks like a browser navigation
10. WHEN `GET /?launch=<secret>` arrives from loopback with the right secret THEN the service SHALL answer `302` to `/` with `Set-Cookie: mordomo_launch=<secret>; HttpOnly; SameSite=Lax; Path=/`, and the next `GET /` that carries the cookie and looks like a browser navigation SHALL carry the owner token in the meta
11. IF `?launch=` carries a wrong value THEN the service SHALL answer `200` with an empty meta and set no cookie
12. The system SHALL NOT write the launch secret to a request log line (`safeUrl` redacts `launch`)
13. WHERE no launch secret is set (every start path that exists today) the service SHALL behave exactly as before (`GET /` injects the token as it did)

**Independent test:** `MORDOMO_LAUNCH_TOKEN=… node apps/api/dist/cli.js start --foreground --sidecar --port 0`, ler a linha, `curl -i` com e sem o segredo, fechar o stdin.

### S2: O supervisor do shell (P1)

Uma biblioteca Rust sem webview sobe, vigia e desliga o serviço; roda em `cargo test` sem GTK.

**Acceptance Criteria**

14. The launch token generator SHALL return 43 URL-safe base64 characters from 32 bytes of operating-system randomness, two calls SHALL differ, and the token's `Debug` output SHALL NOT contain it
15. WHEN the sidecar prints a well-formed `MORDOMO_READY` line with `v` 1 and a port 1..65535 THEN the parser SHALL return the port, pid, version and `updatesCheck`; IF the line has another prefix, malformed JSON, `v` other than 1, port 0 or a missing field THEN it SHALL reject it
16. WHEN the supervisor starts THEN it SHALL spawn `<node> <entry> start --foreground --sidecar --port <p>` with the secret in the environment and never in argv, stdin piped, and SHALL return only after the ready line and a `GET /` answering `200` with `text/html` on `127.0.0.1:<port>`
17. IF the process exits before the ready line THEN the supervisor SHALL return an error carrying the exit code and the last 20 stderr lines, classified `home_in_use` for `4`, `port_busy` for `5`, `home_blocked` for `3`, `crashed` for any other
18. IF no ready line arrives within the startup timeout (30 s by default) THEN the supervisor SHALL kill the process and return `timeout`
19. WHEN `stop` is called THEN the supervisor SHALL close the child's stdin, wait up to the grace period (15 s by default) for it to exit and only then kill it, reap it in every case, and be idempotent; dropping a running supervisor SHALL do the same
20. IF the node binary or the entry file is missing from the payload THEN the supervisor SHALL return `payload_missing` naming the path and SHALL NOT fall back to a Node found on the system
21. WHEN the preferred port is busy (`port_busy`) THEN the shell SHALL start again once with port `0`, and SHALL store the bound port as the preference for the next launch
22. The navigation policy SHALL allow `http://127.0.0.1:<the sidecar port>` (that exact port, no userinfo) and the app's own origins, hand every other `http`, `https` and `mailto` address to the system browser (an address with another port of `127.0.0.1`, with userinfo, or with a look-alike host is such an address, never loaded in the window), and refuse every other scheme (`javascript:`, `file:`, `data:`, `blob:`, `ftp:`, a custom one) and anything that does not parse

**Independent test:** `cargo test -p mordomo-shell-core`.

### S3: O app (P1)

**Acceptance Criteria**

23. WHEN the app starts THEN the main window SHALL show the local starting screen, the sidecar SHALL be started once, and the window SHALL navigate to the loopback address with the launch secret in that first URL only
24. IF the sidecar cannot start THEN the window SHALL show the failure screen with the failure kind, the text in English and Portuguese, the stderr tail, and the buttons Retry and Quit
25. IF the sidecar exits while the UI is loaded THEN the window SHALL show the failure screen (kind `stopped`) within 5 seconds, with Retry
26. WHEN the user quits (menu, ⌘Q/Ctrl+Q, closing the last window) THEN the app SHALL stop the sidecar through its stdin before it exits, and no sidecar process SHALL remain
27. WHILE an instance is running, WHEN a second one is started THEN the second SHALL exit at once, the first window SHALL come to the front, and no second sidecar SHALL start
28. The system SHALL load into the webview only its own local assets and the sidecar's loopback origin, with a content-security-policy on the local assets of `default-src 'none'` plus `'self'` for script, style and image only, and `connect-src ipc:`; the window capability SHALL grant exactly the three app commands and no `remote` scope, shell, filesystem or http permission
29. WHEN `mordomo-desktop --self-test` runs THEN the binary SHALL locate the payload, start the sidecar, probe the UI, stop it, print one JSON line and exit `0` on success and `1` on any failure, without creating a window

**Independent test:** `xvfb-run mordomo-desktop` (Linux) e `--self-test` nas três plataformas do CI.

### S4: Atualização assinada (P2)

**Acceptance Criteria**

30. WHERE the build was made with the updater's public key the app SHALL contact the update endpoint only (a) at start when the ready line's `updatesCheck` is `true` or (b) when the user picks "Check for updates"; otherwise it SHALL make no network call
31. WHEN an update is found THEN the app SHALL ask for confirmation, download it, accept it only if its minisign signature verifies against the configured public key, stop the sidecar, install and restart; IF the signature fails THEN it SHALL install nothing and say so
32. WHERE the build has no public key the app SHALL contain no updater (no plugin, no menu item) and SHALL say so in "About"
33. The system SHALL declare the update endpoint and its download hosts in `legal/network-policy.json` and `legal/PRIVACY.md`, gated by `updates.check`, off by default, and `scripts/network-scan.mjs --check` SHALL read the Rust and Tauri configuration files

### S5: Uma versão só (P1)

**Acceptance Criteria**

34. WHEN `node scripts/version-sync.mjs --check` runs THEN it SHALL exit `1` naming file and value if the 9 `package.json` versions, `tauri.conf.json`, the workspace `Cargo.toml` or a workspace crate in `Cargo.lock` differ, and `0` when equal
35. WHEN `node scripts/version-sync.mjs --check --tag v<x>` runs and `<x>` is not the common version THEN it SHALL exit `1`
36. WHEN `node scripts/version-sync.mjs --write <semver>` runs THEN it SHALL set all of them and `--check` SHALL then pass

### S6: Release por tag (P1)

**Acceptance Criteria**

37. The release workflow SHALL run on a push of a `v*` tag and on `workflow_dispatch`, SHALL NOT run on branches or pull requests, SHALL grant `contents: read` at the top and `contents: write` only to the job that publishes, and that job SHALL run only on a tag ref
38. The release workflow SHALL reference each secret only in the step that needs it, and `uses:` SHALL be a major tag for `actions/*` and a 40-hex commit for anything else
39. WHEN a signing secret is absent THEN the matching platform SHALL still build, its artifacts SHALL carry `UNSIGNED` in the file name and in the release notes, and the signing step SHALL NOT run
40. The release SHALL stay a draft; it SHALL carry the installers, `SHA256SUMS.txt`, `sbom.cdx.json`, `sbom.desktop.cdx.json`, `THIRD_PARTY_NOTICES.md`, `THIRD_PARTY_NOTICES.desktop.md` and the notes of the version's `CHANGELOG` section, and `latest.json` only when every platform of the matrix signed its updater artifact and the macOS and Windows files carry the operating-system signature
41. IF the tag differs from the common version, or the `CHANGELOG` has no section for it, THEN the workflow SHALL fail before building
42. The workflow SHALL fail a platform's job when `LICENSE` or any of the seven `legal/` files (`EULA.md`, `PRIVACY.md`, `NOTICE.md`, `THIRD_PARTY_NOTICES.md`, `THIRD_PARTY_NOTICES.desktop.md`, `sbom.cdx.json`, `sbom.desktop.cdx.json`) is not inside the staged payload before the installers are built

### S7: Licenças e rede do que é Rust (P2)

**Acceptance Criteria**

43. WHEN `node scripts/licenses-rust.mjs --check` runs with `cargo` THEN it SHALL exit `1` for a crate of the runtime graph whose license is not in the `rust` policy and for a stale `legal/THIRD_PARTY_NOTICES.desktop.md`
44. WHERE `cargo` is not on the machine `npm run licenses:check` SHALL print that the Rust part was skipped and say how to require it (`--require-cargo`), and SHALL exit `0` only when the npm part passes

## Out of scope

| Excluded                                                     | Why                                                                                                        |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Assinar, notarizar ou rodar de verdade no macOS e no Windows | não há máquina nem segredo aqui; `checks.md` lista o job que prova cada um                                 |
| Windows ARM64 e Linux ARM64                                  | o tarball de arm64 não tem instalador; a primeira leva é x64 (pergunta 2)                                  |
| Publicar o release (tirar de rascunho)                       | o dono, depois de olhar os artefatos                                                                       |
| Canal beta/nightly                                           | segundo contrato; ver porta 4                                                                              |
| Tela "Sobre" no Command Centre                               | já é pergunta aberta da `licenca-comercial`; o app tem o "Sobre" nativo                                    |
| Reescrever `ci.yml` ou o e2e                                 | só ganha um job `desktop`; o resto do portão não muda                                                      |
| Troca do token do dono para um token de dispositivo          | exigiria rota nova no contrato congelado; o segredo de lançamento resolve o buraco de `GET /` para o shell |

## Assumptions

| Assumption                                               | Chosen default                                                                                        | Rationale                                                                                                 | Confirmed? |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------- |
| Quais plataformas a primeira leva entrega                | macOS arm64 e x64, Windows x64, Linux x64 (`.deb` e `.AppImage`)                                      | as quatro que o dono pode testar; arm64 do Linux e do Windows sem máquina de prova                        | n          |
| O atualizador liga sozinho?                              | desligado: segue `updates.check` (padrão `false`); "Verificar atualizações" no menu sempre disponível | `legal/PRIVACY.md` promete que nenhum destino de contato vem ligado; trocar o padrão é decisão de produto | n          |
| Identificador do pacote                                  | `com.mordomo.desktop`                                                                                 | o Tauri avisa contra um identificador terminado em `.app`; nada assinado usa o antigo                     | n          |
| O release publica o arquivo portátil (`.zip`/`.tar.gz`)? | não; só instaladores                                                                                  | um segundo caminho de assinatura dobra o que ninguém provou                                               | n          |
| Linux entrega `.rpm`                                     | não                                                                                                   | `.deb` e `.AppImage` cobrem o grosso; rpm sem máquina de prova                                            | n          |
| Onde fica a chave pública                                | `tauri.updater.conf.json` com um marcador `[A PREENCHER PELO DONO]` até o dono gerar o par            | nenhuma chave inventada; sem ela o build não inclui o updater (AC 32)                                     | n          |
| `MPL-2.0` nas 5 crates do Tauri                          | aceito só para as nomeadas, sem modificação; o código fonte é o do crates.io                          | a política barra `MPL-2.0` no que se distribui; a exceção é nomeada e fica sob revisão do dono            | n          |
| Português nas telas do shell                             | inglês e português lado a lado na tela de falha, escolhido por `navigator.language`                   | o produto é bilíngue; a tela não tem acesso às preferências do Command Centre                             | n          |

**Open questions** (the rest is in `.specs/STATE.md`, "Perguntas ao dono", distribuicao):

| #   | Kind           | Question                                                                                                                                         | Until answered                                                |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| 1   | open           | O release deve continuar publicando o arquivo portátil além dos instaladores?                                                                    | só instaladores (AC 40)                                       |
| 2   | open           | Quais plataformas na primeira leva, e o Linux entrega?                                                                                           | as quatro da suposição                                        |
| 3   | blocks go-live | Gerar o par minisign (`npx tauri signer generate`) e cadastrar `TAURI_SIGNING_PRIVATE_KEY` e a senha; pôr a pública em `tauri.updater.conf.json` | sem a chave não há atualização; o build diz "sem atualizador" |
| 4   | blocks go-live | Cadastrar os segredos Apple e Windows (lista no runbook)                                                                                         | os artefatos saem "NÃO ASSINADO"                              |

## Observable

| Surface                                            | Decision                                                                     | Landing                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| screen `starting` (shell)                          | loading state                                                                | AC 23                                                                                 |
| screen `starting` (shell)                          | empty state                                                                  | n/a - a tela não lista nada                                                           |
| screen `failure` (shell)                           | error state, copy in EN and PT-BR, the buttons                               | AC 24, AC 25                                                                          |
| screen `failure` (shell)                           | unauthorised state                                                           | n/a - a janela não tem login; o serviço local recusa quem não tem token               |
| screens of the shell                               | destructive action confirms                                                  | n/a - nenhuma ação destrói dados; "Quit" só fecha o app e o serviço                   |
| screens of the shell                               | density and ordering                                                         | design.md (uma coluna, título, texto, cauda do erro, botões)                          |
| native menu                                        | "Check for updates", "About", Quit                                           | AC 30, AC 31, AC 32                                                                   |
| CLI `mordomo --version`, `--help`                  | output format, exit codes                                                    | AC 1, AC 2                                                                            |
| CLI `start --sidecar`                              | every flag and its default, exit codes, what it prints when it fails halfway | AC 3 - AC 8                                                                           |
| CLI `mordomo-desktop --self-test`                  | output format and exit codes                                                 | AC 29                                                                                 |
| `GET /` and `GET /index.html` in sidecar mode      | who may call it, error shape                                                 | AC 9, AC 10, AC 11                                                                    |
| `GET /` and `GET /index.html` in sidecar mode      | versioning, rate limits                                                      | n/a - não são rotas do contrato; o limite de falhas de autenticação segue o de sempre |
| `.github/workflows/release.yml`                    | triggers, permissions, secrets, what it prints when it fails halfway         | AC 37 - AC 42                                                                         |
| `docs/release.md`, `README.md`, `legal/PRIVACY.md` | structure, depth, what the reader does next                                  | AC 33, `docs/release.md` pelo roteiro do dono; teste de deriva dos nomes dos segredos |

## Sources

- `.specs/roadmap.md` item 14 e `AD-008` - o pedido e a decisão de assinar com os segredos do dono
- `.specs/features/licenca-comercial` decisão 11 (`STATE.md`) - o instalador leva `legal/` inteira e o CI confere os seis arquivos
- `docs/security.md`, ameaça T1, "Closing it needs a secret the launcher hands the browser" - o desenho que o segredo de lançamento constrói só para o shell
