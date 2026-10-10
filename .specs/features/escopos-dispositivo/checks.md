# Escopos de dispositivo checks

Profile: ui
Plan: `.specs/features/escopos-dispositivo/plan.md`

43 checks in 6 slices + transversal · 6 one-way doors · 0 open, of which 0 block

Comandos (da raiz): `npx vitest run tests/<arquivo> -t "<nome>"`; a interface com
`npm run test -w apps/command-centre -- <arquivo> -t "<nome>"`. Pedidos de dispositivo e de outro endereço usam
`app.inject({ remoteAddress })` com um dispositivo pareado por `ctx.devices` e `remote.enabled: true`; um par não
loopback que fala TLS é simulado com `light-my-request` sobre `app.server.emit("request")` (o mesmo caminho do
listener TLS de `startServer`), e os listeners de verdade são provados com `startServer`. Rota nova, escopo novo e
tabela esperada moram em `tests/helpers/routeScopes.ts` (a autoridade independente do código: a classificação é
lida no teste, não derivada do servidor).

Vocabulário: `escopo` é o `config.scope` da rota; `conjunto` é o que um dispositivo tem (já fechado).

## Checks

### S1 - cada rota diz quem a chama · 9 files · 150 KB · ~38k

**C1** - Para cada uma das 125 rotas `/api` não públicas, um dispositivo pareado com o conjunto vazio recebe `403` com `error.code` `owner_only` nas 61 rotas `owner` e `scope_required` nas 64 demais, e nada muda: o número de linhas de `runs`, `approvals`, `notifications` e `devices`, os bytes de `settings.json` e o número de processos de provedor criados ficam iguais (AC 1, 3)
Proof: `npx vitest run tests/device-scopes.test.ts -t "C1 an empty device is refused on every route and nothing changes"`
Status: closed

**C2** - Para cada conjunto fechado (`monitor`; `monitor`+`content`; `monitor`+`content`+`run`; `monitor`+`approve`) e cada uma das 125 rotas, o dispositivo recebe `403` (`scope_required` ou `owner_only`) exatamente quando o escopo da rota não está no conjunto; nas outras o gancho o deixa passar (o status é qualquer outro, por exemplo `400` de validação ou `404`), e `GET /api/events` e `GET /api/runs/:id/stream` ficam para C29 (AC 1, 2, 3)
Proof: `npx vitest run tests/device-scopes.test.ts -t "C2 each closed set reaches exactly its routes"`
Status: closed

**C3** - O mapa `rota -> escopo` de `app.apiRoutes` é igual, nos dois sentidos, ao mapa esperado de `tests/helpers/routeScopes.ts`: 125 rotas não públicas (61 `owner`, 36 `monitor`, 21 `content`, 6 `run`, 1 `approve`), as duas rotas `public` (`GET /api/meta`, `POST /api/pair/claim`) sem escopo, e o OpenAPI traz `x-mordomo-scope` em toda operação não pública com o mesmo valor (AC 5)
Proof: `npx vitest run tests/device-scopes.test.ts -t "C3 the route table is the expected one"`
Status: closed

**C4** - Registrar uma rota `/api/` sem `public` e sem `scope` lança na hora, com uma mensagem que contém o método e o caminho; uma rota com `public: true` e uma com `scope: "monitor"` registram sem erro; e a decisão para um dispositivo diante de um escopo ausente (`deviceVerdict`) é `owner_only`, diante de `owner` também, e `scope_required` diante de um escopo que ele não tem (AC 4)
Proof: `npx vitest run tests/device-scopes.test.ts -t "C4 a route without a scope does not register"`
Status: closed

**C5** - `closeDeviceScopes` devolve: `[]`->`[]`, `["monitor"]`->`["monitor"]`, `["content"]`->`["monitor","content"]`, `["run"]`->`["monitor","content","run"]`, `["approve"]`->`["monitor","approve"]`, `["content","approve"]`->`["monitor","content","approve"]`, repetidos e fora de ordem ficam uma vez na ordem de `DEVICE_SCOPES`; `DEFAULT_DEVICE_SCOPES` é `["monitor","content","run"]`; uma linha de `devices` com `scopes` `NULL` lê como o padrão e uma com texto que não é o JSON de um conjunto de escopos lê como `[]` (AC 6)
Proof: `npx vitest run tests/device-scopes.test.ts -t "C5 scopes close and a missing column reads as the default"`
Status: closed

**C6** - `POST /api/pair/start` com `{ scopes: ["approve"] }` e o `claim` do código dão um dispositivo com `scopes` `["monitor","approve"]` (em `claim`, em `GET /api/devices` e no banco); sem `scopes`, o padrão; `{ scopes: ["root"] }` responde `400`; um dispositivo chamando `pair/start` recebe `403 owner_only` (AC 7)
Proof: `npx vitest run tests/device-scopes.test.ts -t "C6 pairing hands the chosen scopes to the device"`
Status: closed

**C7** - `PATCH /api/devices/:id` com `{ scopes: ["monitor"] }` responde `200` com o dispositivo, e o próximo `POST /api/runs` desse dispositivo (que passava) responde `403 scope_required`; com `{ scopes: ["run"] }` guarda `["monitor","content","run"]`; id desconhecido e dispositivo revogado respondem `404`; `{ scopes: ["x"] }` e corpo sem `scopes` respondem `400`; um dispositivo chamando o `PATCH` recebe `403 owner_only` (AC 8)
Proof: `npx vitest run tests/device-scopes.test.ts -t "C7 the owner changes the scopes of a paired device"`
Status: closed

**C8** - Um dispositivo com os quatro escopos, revogado, e outro, expirado (`expiresAt` no passado), recebem `401 unauthorized` em `GET /api/runs` e em `POST /api/approvals/:id/resolve` (AC 9)
Proof: `npx vitest run tests/device-scopes.test.ts -t "C8 a revoked or expired device is refused whatever its scopes"`
Status: closed

**C9** - Para cada uma das 125 rotas, a credencial `brk_` de uma execução ativa passa o gancho exatamente nas 3 rotas de aprovação e recebe `403 forbidden` nas outras 122, e a credencial `rc_` de uma execução de memória passa nas 6 rotas de memória da lista (as 4 de leitura sempre; as 2 de escrita só quando a execução escreve) e recebe `403 forbidden` nas outras 119, qualquer que seja o escopo declarado da rota (AC 10)
Proof: `npx vitest run tests/device-scopes.test.ts -t "C9 broker and run credentials keep their own route lists"`
Status: closed

### S2 - o que o dispositivo inicia · 8 files · 170 KB · ~43k

**C10** - Um dispositivo com `run` faz `POST /api/runs` (`mode: "read_only"`) em um provedor cujo manifesto declara `readConfinement: "workdir"`: `200`, a linha de `runs` tem `startedBy` `device:<id>` e o processo do provedor é lançado; o mesmo pedido com o token do dono grava `startedBy` `owner` (AC 11, 16)
Proof: `npx vitest run tests/device-scopes.test.ts -t "C10 a device starts a read-only run where reads stay in the workdir"`
Status: closed

**C11** - Um dispositivo com `run` em cada uma das cinco rotas (`POST /api/runs`, `/api/runs/:id/children`, `/api/runs/:id/retry`, `/api/sessions/:id/continue`, `/api/skills/:slug/run`), apontando para cada um de três provedores (Codex `none`, Cursor `none`, um provedor registrado sem `readConfinement`), recebe `403 device_provider_refused`, e o número de linhas de `runs`, `sessions` e `approvals` e de processos de provedor fica igual (AC 12)
Proof: `npx vitest run tests/device-scopes.test.ts -t "C11 a device cannot start a run on a provider that reads the whole disk"`
Status: closed

**C12** - No motor, `RunManager.create` com `startedBy` `device:x` lança `403 device_provider_refused` para Codex, Cursor e um provedor sem manifesto, e aceita Claude; com `startedBy` `owner`, `null` e ausente aceita os quatro; e `engine.gateWrite` com `startedBy` `device:x` em modo escrita estaciona a execução (`waiting_approval`) e cria o `write_run` com `requestedBy` `device:x`, no perfil `controlled_write` em que o dono teria `allow` (AC 12, 13)
Proof: `npx vitest run tests/device-scopes.test.ts -t "C12 the engine enforces the device limits itself"`
Status: closed

**C13** - Um dispositivo com `run` pede `POST /api/runs` com `mode: "write"` no Claude sob `review_before_write`, `controlled_write` e `approved_automation`: em cada um `202`, `status` `waiting_approval`, uma aprovação `write_run` com `requestedBy` `device:<id>`, a linha de `runs` parada em `waiting_approval` e nenhum processo de provedor lançado; o mesmo para uma skill de escrita (`POST /api/skills/:slug/run`) e para o repetir de uma execução do dono (`POST /api/runs/:id/retry`); sob `read_only`, `403 profile_refused` e nada criado (AC 13, 14)
Proof: `npx vitest run tests/device-scopes.test.ts -t "C13 a write asked by a device waits for a human in every profile"`
Status: closed

**C14** - O dono aprova a aprovação de C13: `200`, a mesma linha de `runs` vai a `queued` e depois executa, com `startedBy` ainda `device:<id>`, e o processo do provedor é lançado uma vez; aprovar de novo responde `409 approval_resolved` (AC 15)
Proof: `npx vitest run tests/device-scopes.test.ts -t "C14 the owner approval launches the parked run"`
Status: closed

**C15** - Uma execução de rotina (`scheduler.runNow`), uma de sentinela e uma criada pela API do motor sem `startedBy` ficam com `startedBy` `null`; as das cinco rotas de execução feitas com o token do dono ficam com `owner`; uma linha criada antes da migração lê `null` (AC 16, 23)
Proof: `npx vitest run tests/device-scopes.test.ts -t "C15 who started a run is recorded only for requests"`
Status: closed

**C16** - Os manifestos declaram `readConfinement`: Claude `"workdir"`, Codex `"none"`, Cursor `"none"`; `docs/adapters-guide.md` descreve o campo; e `ProviderCapabilities` o exige (um manifesto sem ele não compila: `typetests`) (AC 17)
Proof: `npx vitest run tests/core.capabilities.test.ts -t "C16 manifests declare where reads stop"`
Status: closed

### S3 - quem pediu não aprova · 6 files · 120 KB · ~30k

**C17** - O dispositivo A, com `run` e `approve`, pede uma escrita (C13) e chama `POST /api/approvals/:id/resolve` com `approved`: `403 self_approval`, a aprovação continua `pending` e a execução continua `waiting_approval` (AC 18)
Proof: `npx vitest run tests/device-scopes.test.ts -t "C17 a device cannot approve what it asked for"`
Status: closed

**C18** - O mesmo dispositivo A responde `denied` à própria aprovação: `200`, `resolvedBy` `device:<A>`, a execução parada vai a `cancelled` (AC 19)
Proof: `npx vitest run tests/device-scopes.test.ts -t "C18 a device may deny what it asked for"`
Status: closed

**C19** - A aprovação pedida por A é aprovada com `200` pelo dono (`resolvedBy` `owner`), pelo Telegram (a função que o poller chama, `resolveApprovalForChat`, com o `from.id` 42: `telegram:42`; o filtro `allowedUserIds` é o C24 da api-v1) e por outro dispositivo B com `approve` (`device:<B>`); um dispositivo C sem `approve` recebe `403 scope_required`; a resolução de um id inexistente responde `404` (AC 20)
Proof: `npx vitest run tests/device-scopes.test.ts -t "C19 another principal approves what a device asked for"`
Status: closed

**C20** - Um dispositivo com `approve` aprova com `200` as aprovações de tipo `write_run` e `tool_use` e recebe `403 owner_only`, com a aprovação `pending`, nos outros nove tipos (`install_software`, `change_global_config`, `destructive_command`, `access_new_folder`, `connector_write`, `create_startup_service`, `expose_port`, `send_external_data`, `overwrite_existing_config`); `denied` passa nos onze (AC 21)
Proof: `npx vitest run tests/device-scopes.test.ts -t "C20 a device approves only the kinds it may"`
Status: closed

**C21** - Uma execução iniciada pelo dispositivo D, em modo escrita já aprovado pelo dono, pede uma ferramenta pelo broker (`POST /api/approvals/tool` com a credencial `brk_`): a aprovação `tool_use` tem `requestedBy` `device:<D>`; D com `approve` recebe `403 self_approval` ao aprovar; o broker nega a própria aprovação com `200` e recebe `403 forbidden` ao tentar aprovar; uma execução iniciada pelo dono dá `requestedBy` `owner` (AC 22)
Proof: `npx vitest run tests/device-scopes.test.ts -t "C21 the broker approval of a device run is the device's own request"`
Status: closed

**C22** - Um banco na versão 16 com um dispositivo, uma aprovação resolvida e uma execução abre migrado para a 17: as três colunas novas existem, o dispositivo lê o padrão, a aprovação `requestedBy` `null` e a execução `startedBy` `null`, e nenhuma linha antiga muda de valor (AC 6, 23)
Proof: `npx vitest run tests/device-scopes.test.ts -t "C22 old rows read back without the new facts"`
Status: closed

### S4 - acesso remoto só com TLS ou túnel · 6 files · 90 KB · ~23k

**C23** - Com `remoteAddress` `203.0.113.9` e sem TLS, `GET /api/meta`, `POST /api/pair/claim`, `GET /api/runs` com o token do dono, `GET /` , `GET /index.html` e `GET /assets/x.js` respondem `403` com `error.code` `tls_required` e uma mensagem que contém `remote.tls.enabled` e a palavra `tunnel`; o `Host` desconhecido e a credencial errada não mudam a resposta, e nenhum `401` conta no limite de tentativas (AC 24)
Proof: `npx vitest run tests/remote-transport.test.ts -t "C23 a plain request from outside this machine is refused"`
Status: closed

**C24** - O mesmo par `203.0.113.9` por uma conexão marcada TLS (`socket.encrypted`, via `app.server.emit("request")`): `GET /api/meta` `200`; `GET /api/runs` com um token de dispositivo com `monitor` `200`; com credencial errada `401`; um `Host` fora de `allowedHosts` `403 forbidden_host` (AC 25)
Proof: `npx vitest run tests/remote-transport.test.ts -t "C24 a TLS request from outside this machine is judged as before"`
Status: closed

**C25** - Os pares `127.0.0.1`, `127.0.0.2`, `::1` e `::ffff:127.0.0.1`, sem TLS, com `Host` `127.0.0.1` e com um `Host` de `allowedHosts` (o túnel), recebem `200` em `GET /api/meta` e passam o gancho com um token de dispositivo (AC 26)
Proof: `npx vitest run tests/remote-transport.test.ts -t "C25 loopback peers and tunnels are not asked for TLS"`
Status: closed

**C26** - O plano de escuta, para `bindAddress` `127.0.0.1`, `localhost`, `::1`, `0.0.0.0`, `::` e `192.0.2.7` com TLS ligado e desligado, escuta o listener sem TLS em loopback (`127.0.0.1` quando o endereço não é de loopback) e o TLS em `bindAddress` só com `remote.enabled` e `remote.tls.enabled`; `startServer` com `bindAddress` `0.0.0.0` e TLS ligado tem o listener sem TLS em `127.0.0.1` e o TLS em `0.0.0.0`, e com TLS desligado não tem listener fora do loopback (AC 27)
Proof: `npx vitest run tests/remote-transport.test.ts -t "C26 only the TLS listener leaves loopback"`
Status: closed

**C27** - Com `bindAddress` `0.0.0.0` e sem TLS, `startServer` imprime e registra um aviso que contém `remote.enabled`, `remote.tls.enabled` e `tunnel`, e `mordomo doctor` traz a verificação de `bindAddress` com status `warn` e o mesmo texto; com `127.0.0.1` ou com TLS ligado, `ok` (AC 28)
Proof: `npx vitest run tests/remote-transport.test.ts -t "C27 an exposed bind without TLS is said out loud"`
Status: closed

### S5 - bilhete de SSE · 6 files · 110 KB · ~28k

**C28** - `POST /api/stream-tickets` com `{ target: "events" }` e com `{ target: "run", runId }` responde `200` para o dono e para um dispositivo com `monitor`, com um `ticket` que casa `^tk_[A-Za-z0-9_-]{32}$`, diferente a cada chamada, e `expiresAt` de 30 s à frente (±1 s); dispositivo sem `monitor` `403 scope_required`; sem credencial `401`; corpo `{}`, `{ target: "x" }` e `{ target: "run" }` sem `runId` `400` (AC 29)
Proof: `npx vitest run tests/stream-tickets.test.ts -t "C28 a ticket is minted for the two streams"`
Status: closed

**C29** - `GET /api/v1/events?ticket=T` e `GET /api/v1/runs/<id>/stream?ticket=T` (com o `runId` do bilhete), sem `x-mordomo-token`, abrem `200 text/event-stream` e entregam um evento emitido depois; o bilhete de um dispositivo abre o fluxo como `device:<id>` e o do dono como `owner` (o principal que o gancho decidiu para a requisição; a resposta de um fluxo é sequestrada e não entra no log de requisições) (AC 30)
Proof: `npx vitest run tests/stream-tickets.test.ts -t "C29 a ticket opens the stream as the one who minted it"`
Status: closed

**C30** - O bilhete é recusado com `401 unauthorized` e o mesmo corpo em oito casos: segunda apresentação; depois de 30 s (`vi.setSystemTime`); em `/api/events` o que foi emitido para um `run`; em `/api/runs/<outro>/stream` o que foi emitido para o `run` X; com o dispositivo revogado depois da emissão; com o dispositivo que perdeu `monitor` depois da emissão; em `GET /api/runs?ticket=` e `GET /api/meta?ticket=`; em `POST /api/runs?ticket=`; e duas apresentações simultâneas do mesmo bilhete abrem exatamente um fluxo (AC 31)
Proof: `npx vitest run tests/stream-tickets.test.ts -t "C30 a ticket is refused the same way in every other case"`
Status: closed

**C31** - `?token=<dispositivo>` em `GET /api/events` e em `GET /api/runs/:id/stream` responde `401` com uma mensagem que contém `ticket`; `?token=<dono>` nas duas abre `200`; `?token=<dispositivo com content>` em `GET /api/artifacts/raw` e `GET /api/skills/:slug/resource` segue servindo (o limite dito no plano); `?token=` em `POST /api/stream-tickets` e em `GET /api/runs` segue `401` (AC 32)
Proof: `npx vitest run tests/stream-tickets.test.ts -t "C31 the device token leaves the stream URLs"`
Status: closed

**C32** - O 33.º bilhete vivo de um principal responde `429 too_many_requests`; outro principal ainda recebe o seu; depois de 30 s o primeiro volta a receber; bilhetes consumidos e vencidos não contam (AC 33)
Proof: `npx vitest run tests/stream-tickets.test.ts -t "C32 live tickets are bounded per principal"`
Status: closed

**C33** - `safeUrl("/api/events?ticket=tk_abc&since=3")` devolve `/api/events?ticket=[REDACTED]&since=3`, e uma linha de `logs/api.jsonl` de um `GET /api/events?ticket=…` não contém o bilhete (AC 34)
Proof: `npx vitest run tests/stream-tickets.test.ts -t "C33 the ticket never reaches the request log"`
Status: closed

**C34** - Na interface, `api.streamEvents` e `api.streamRun` pedem `POST /api/v1/stream-tickets` e abrem o `EventSource` em `/api/v1/events?ticket=T` e `/api/v1/runs/<id>/stream?ticket=T` sem `token=` na URL; quando o fluxo de eventos fecha, `onError` dispara e o `streamEvents` seguinte pede outro bilhete e abre com `since` igual ao último id visto; o de uma execução reabre sozinho, com bilhete novo e `since`, até a moldura final `run_state`; o fechador devolvido antes de o bilhete chegar impede a abertura (AC 35)
Proof: `npm run test -w apps/command-centre -- src/api.test.ts -t "C34 streams open with a ticket"`
Proof: `npm run test -w apps/command-centre -- src/api.test.ts -t "C34 a run stream reopens with a new ticket until its final frame"`
Status: closed

### S6 - a tela e o texto · 7 files · 120 KB · ~30k

Tela: Configurações › Segurança › cartão "Acesso remoto" (`RemoteAccess` em `views/settings/security.tsx`). Nenhuma fonte de
desenho marca esta tela como obrigatória (`Binding sources: none`); o arranjo abaixo é o do cartão existente mais os três
elementos novos, e cada item tem um check.

| #   | Elemento (ordem no cartão)                                                                                                                         | Estado    | Check    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------- |
| R1  | cabeçalho: título, dica e botão de ligar o acesso remoto                                                                                           | existente | C38      |
| R2  | campo de hosts                                                                                                                                     | existente | C38      |
| R3  | campo de validade do token                                                                                                                         | existente | C38      |
| R4  | linha do TLS: título, dica, impressão digital ou dica alternativa, botão                                                                           | existente | C38      |
| R5  | **aviso `#remote-tls-required`** (`p.hint.warn`) logo depois de R4, só com acesso remoto ligado e TLS desligado                                    | novo      | C37      |
| R6  | linha de pareamento: título, dica, botão "Mostrar um código"                                                                                       | existente | C35, C38 |
| R7  | **grupo `fieldset.scope-picker`** entre R6 e R8: legenda e quatro caixas na ordem `monitor`, `content`, `run`, `approve`, cada uma com nome e dica | novo      | C35      |
| R8  | caixa do código de pareamento (só depois de pedir)                                                                                                 | existente | C35      |
| R9  | lista de dispositivos ativos: nome; última vez e validade; **botão "Permissões"** e botão "Revogar"; **linha de permissões**                       | alterado  | C36, C38 |
| R10 | **editor inline** de permissões na linha, com as quatro caixas, "Salvar" e "Cancelar" (só depois de "Permissões")                                  | novo      | C36      |

**C35** - Ao abrir o cartão com acesso remoto ligado, o grupo R7 mostra as quatro caixas na ordem `monitor`, `content`, `run`, `approve`, com `monitor`, `content` e `run` marcadas e `approve` não; marcar `approve` desmarcada e depois desmarcar `run` deixa `monitor` marcada e travada por `approve` e `content` livre e desmarcável; marcar `run` marca e trava `content` e `monitor`; "Mostrar um código" envia `POST /api/pair/start` com `{ scopes }` igual ao conjunto fechado das caixas marcadas; o botão fica desabilitado com o acesso remoto desligado (AC 36)
Proof: `npm run test -w apps/command-centre -- src/views/settings/security.test.tsx -t "C35 the pairing group sends the chosen scopes"`
Status: closed

**C36** - Cada dispositivo ativo da lista mostra a linha `Permissões: <nomes na ordem>` com os nomes da tela (`Acompanhar`, `Ler conteúdo`, `Iniciar execuções`, `Aprovar` em pt-BR); "Permissões" abre R10 com as caixas marcadas como o dispositivo; "Salvar" envia `PATCH /api/v1/devices/<id>` com `{ scopes }`, fecha o editor e atualiza a linha; uma resposta `403`/`400` mantém o editor aberto e mostra a mensagem do servidor em um aviso de erro; "Cancelar" fecha sem enviar (AC 37)
Proof: `npm run test -w apps/command-centre -- src/views/settings/security.test.tsx -t "C36 a device row shows and edits its permissions"`
Status: closed

**C37** - R5 está no DOM, com o texto `apps.settings.remoteTlsRequired` nas duas línguas, com acesso remoto ligado e TLS desligado; está ausente com TLS ligado e com acesso remoto desligado; fica entre R4 e R6 (AC 38)
Proof: `npm run test -w apps/command-centre -- src/views/settings/security.test.tsx -t "C37 the TLS requirement is said on the card"`
Status: closed

**C38** - A ordem dos filhos do cartão, em cada estado (desligado; ligado sem TLS; ligado com TLS; com o código aberto; com dois dispositivos; com o editor aberto), é a da tabela R1-R10, nenhum elemento fora dela; as novas chaves `apps.settings.scope*`, `apps.settings.remoteTlsRequired` e `apps.settings.perm*` existem em `en` e `pt-BR` com valores diferentes de vazio; nenhuma cor nem tamanho de fonte novo na folha de estilos fora de tokens (AC 36, 37, 38)
Proof: `npm run test -w apps/command-centre -- src/views/settings/security.test.tsx -t "C38 the card keeps its arrangement"`
Status: closed

**C39** - A tabela de rotas e escopos de `docs/security.md` lista exatamente as 125 rotas não públicas com o escopo que cada uma declara (as 2 públicas à parte), e o texto declara cada limite que a feature deixa: `GET /` e a página, `?token=` nas duas rotas de arquivo, `rc_` e `brk_` no ambiente do processo, o endereço comum atrás de um túnel, a aprovação anterior à migração, o Claude `workdir` não verificado, e que `monitor` mostra o que as execuções do dono imprimiram (AC 39)
Proof: `npx vitest run tests/device-scopes.test.ts -t "C39 docs list every route with its scope and say what stays open"`
Status: closed

### Transversal · 8 files · 60 KB · ~15k

**C40** - Os testes das features anteriores que a feature substitui por decisão registrada (AD-015, AD-016) mudaram e dizem o que mudou: `tests/api.v1.test.ts` C12 passa a exigir as 18 rotas `owner` da door 3 da api-v1 dentro do conjunto atual, C13 exige `approve` para resolver, e os casos de `?token=` de dispositivo em SSE passam a `401`; nenhum outro teste foi enfraquecido (a diferença desses arquivos contra `chore/tlc-spec-lean-skill` só toca essas asserções)
Proof: `npx vitest run tests/api.v1.test.ts -t "C12 the owner routes include the door's list"`
Proof: `npx vitest run tests/api.v1.test.ts -t "C13 a device keeps the everyday routes it holds"`
Status: closed

**C41** - As exportações de `@mordomo/contracts` e de `@mordomo/core` que a feature acrescenta são as da door 7 e nenhuma outra: `DEVICE_SCOPES`, `DEFAULT_DEVICE_SCOPES`, `closeDeviceScopes`, `isDeviceActor` em execução e `DeviceScope`, `DeviceRecord` nos tipos (mais os campos `Approval.requestedBy`, `RunRecord.startedBy`, `ProviderCapabilities.readConfinement`, este obrigatório); a lista inteira das exportações de execução está fixada em `tests/contracts.test.ts`, e os tipos e a obrigatoriedade nos `typetests` (`npm run typecheck`)
Proof: `npx vitest run tests/contracts.test.ts -t "C41 the device pieces are the only new exports"`
Status: closed

**C42** - No navegador real, com a interface servida pelo serviço real, a página abre sem erro de console, pede `POST /api/v1/stream-tickets`, abre `/api/v1/events?ticket=tk_…` e nenhuma URL requisitada pelo navegador contém `token=`; um evento emitido pelo servidor chega à página (a lista de execuções é pedida de novo depois de `POST /api/v1/runs`)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts smoke.spec.ts -g "C42"` (porta `MORDOMO_E2E_PORT=4886` e tempos alongados numa configuração temporária não comitada, como as features anteriores)
Status: closed

**C43** - `GET /api/v1/openapi.json` descreve `POST /api/v1/stream-tickets` e `PATCH /api/v1/devices/{id}`, marca as duas rotas SSE com o esquema `ticket`, e a descrição do documento diz quais escopos existem; a contagem de operações do documento é a das rotas registradas (127)
Proof: `npx vitest run tests/device-scopes.test.ts -t "C43 the route document knows the new routes and the ticket"`
Status: closed

## Gate

Não é um check (uma suíte verde não prova uma afirmação): é o que roda uma vez, ao fim da construção, antes de entregar para a verificação independente: `npm run build`, `npm run typecheck`, `npm run lint`, `npx vitest run` na raiz e `npm run test -w apps/command-centre`, todos com saída 0.

## Coverage

| Set (size)                                                                       | Member -> proof                                                                                                                                                                                                                                                                                                  | Unproven |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| rotas `/api` não públicas -> escopo (125)                                        | C3, table-driven over all 125 (mapa esperado em `tests/helpers/routeScopes.ts`); C1 e C2 table-driven over all 125                                                                                                                                                                                               | -        |
| valores do escopo da rota (5)                                                    | `owner` C1 · `monitor` C2 · `content` C2 · `run` C2 · `approve` C2                                                                                                                                                                                                                                               | -        |
| escopos de dispositivo (4)                                                       | `monitor` C2 · `content` C2 · `run` C2 · `approve` C2                                                                                                                                                                                                                                                            | -        |
| fecho dos escopos (7)                                                            | `[]` C5 · `["monitor"]` C5 · `["content"]` C5 · `["run"]` C5 · `["approve"]` C5 · `["content","approve"]` C5 · repetidos fora de ordem C5                                                                                                                                                                        | -        |
| origens do conjunto de um dispositivo (4)                                        | padrão do `claim` C6 · `scopes` do `pair/start` C6 · `PATCH` C7 · coluna `NULL` C5                                                                                                                                                                                                                               | -        |
| `POST /api/stream-tickets` statuses (5)                                          | 200 C28 · 400 C28 · 401 C28 · 403 C28 · 429 C32                                                                                                                                                                                                                                                                  | -        |
| `GET /api/events` e `GET /api/runs/:id/stream` com `?ticket=` statuses (2)       | 200 C29 · 401 C30                                                                                                                                                                                                                                                                                                | -        |
| recusas do bilhete (9)                                                           | segunda apresentação C30 · vencido C30 · outro destino (events vs run) C30 · outro run C30 · dispositivo revogado C30 · dispositivo sem `monitor` C30 · rota que não é de bilhete C30 · método que não é GET C30 · simultâneas C30                                                                               | -        |
| credencial em `?token=` nas rotas SSE (3)                                        | dono C31 · dispositivo C31 · `brk_`/`rc_` C9                                                                                                                                                                                                                                                                     | -        |
| `PATCH /api/devices/:id` statuses (4)                                            | 200 C7 · 400 C7 · 403 C7 · 404 C7                                                                                                                                                                                                                                                                                | -        |
| `POST /api/pair/start` statuses (3)                                              | 200 C6 · 400 C6 · 403 C6                                                                                                                                                                                                                                                                                         | -        |
| `POST /api/pair/claim` statuses (4)                                              | 200 C6 · 401 C8 · 403 C23 · 429 C23                                                                                                                                                                                                                                                                              | -        |
| `GET /api/devices` statuses (2)                                                  | 200 C6 · 403 C1                                                                                                                                                                                                                                                                                                  | -        |
| `POST /api/approvals/:id/resolve` statuses (4)                                   | 200 C19 · 403 C17 · 404 C19 · 409 C14                                                                                                                                                                                                                                                                            | -        |
| códigos `403` de aprovação (3)                                                   | `self_approval` C17 · `owner_only` C20 · `scope_required` C19                                                                                                                                                                                                                                                    | -        |
| rotas que iniciam execução com dispositivo (5)                                   | `POST /api/runs` C11 · `/api/runs/:id/children` C11 · `/api/runs/:id/retry` C11 · `/api/sessions/:id/continue` C11 · `/api/skills/:slug/run` C11                                                                                                                                                                 | -        |
| pontos de entrada que iniciam execução (12)                                      | `POST /api/runs` C11 · children C11 · retry C11 · continue C11 · skill run C11 · `POST /api/objectives/:id/dispatch` C1 · `POST /api/objectives/:id/steps/:stepId/retry` C1 · `POST /api/routines/:id/run` C1 · `POST /api/providers/:id/smoke` C1 · rotina agendada C15 · sentinela C15 · CLI `mordomo run` C15 | -        |
| provedores para o dispositivo (4)                                                | Claude (`workdir`) C10 · Codex C11 · Cursor C11 · provedor sem `readConfinement` C11                                                                                                                                                                                                                             | -        |
| origens de `startedBy` (5)                                                       | token do dono C10 · dispositivo C10 · rotina C15 · sentinela C15 · motor sem o campo C15                                                                                                                                                                                                                         | -        |
| perfis de segurança para escrita de dispositivo (4)                              | `read_only` C13 · `review_before_write` C13 · `controlled_write` C13 · `approved_automation` C13                                                                                                                                                                                                                 | -        |
| tipos de aprovação para um dispositivo (11)                                      | `write_run` C20 · `tool_use` C20 · `install_software` C20 · `change_global_config` C20 · `destructive_command` C20 · `access_new_folder` C20 · `connector_write` C20 · `create_startup_service` C20 · `expose_port` C20 · `send_external_data` C20 · `overwrite_existing_config` C20                             | -        |
| quem resolve a aprovação pedida por A (5)                                        | o próprio A aprovando C17 · o próprio A negando C18 · dono C19 · Telegram C19 · outro dispositivo com `approve` C19                                                                                                                                                                                              | -        |
| credenciais de execução (2)                                                      | `brk_` C9, C21 · `rc_` C9                                                                                                                                                                                                                                                                                        | -        |
| colunas novas da migração 17 (3)                                                 | `devices.scopes` C22 · `approvals.requested_by` C22 · `runs.started_by` C22                                                                                                                                                                                                                                      | -        |
| pares TCP (6)                                                                    | `127.0.0.1` C25 · `127.0.0.2` C25 · `::1` C25 · `::ffff:127.0.0.1` C25 · `203.0.113.9` C23 · `203.0.113.9` com TLS C24                                                                                                                                                                                           | -        |
| caminhos recusados sem TLS (6)                                                   | `/api/meta` C23 · `/api/pair/claim` C23 · `/api/runs` C23 · `/` C23 · `/index.html` C23 · `/assets/x.js` C23                                                                                                                                                                                                     | -        |
| `bindAddress` -> listeners (12)                                                  | `127.0.0.1` C26 · `localhost` C26 · `::1` C26 · `0.0.0.0` C26 · `::` C26 · `192.0.2.7` C26, cada um com TLS ligado e desligado (12 casos, table-driven)                                                                                                                                                          | -        |
| listeners da aplicação (1 assembly)                                              | `startServer` em `apps/api/src/server.ts` C26 (nenhum outro `listen` em `apps/api/src`)                                                                                                                                                                                                                          | -        |
| startup configuration: classificação e guarda de transporte (1 assembly)         | `buildServer` C4, C23 (o único montador do gancho; `startServer` o chama)                                                                                                                                                                                                                                        | -        |
| elementos do cartão "Acesso remoto" (10)                                         | R1 C38 · R2 C38 · R3 C38 · R4 C38 · R5 C37 · R6 C35 · R7 C35 · R8 C35 · R9 C36 · R10 C36                                                                                                                                                                                                                         | -        |
| estados do cartão (6)                                                            | desligado C38 · ligado sem TLS C37 · ligado com TLS C37 · com o código aberto C35 · com dois dispositivos C36 · com o editor aberto C36                                                                                                                                                                          | -        |
| línguas das chaves novas (2)                                                     | `en` C38 · `pt-BR` C38                                                                                                                                                                                                                                                                                           | -        |
| rotas de SSE e arquivo abertas por URL na interface (4)                          | `/api/events` C34 · `/api/runs/:id/stream` C34 · `artifacts/raw` C31 · `skills/:slug/resource` C31                                                                                                                                                                                                               | -        |
| limites ditos em `docs/security.md` (6)                                          | `GET /` e a página C39 · `?token=` nas rotas de arquivo C39 · `rc_`/`brk_` no ambiente C39 · endereço comum atrás de um túnel C39 · aprovação anterior à migração C39 · Claude `workdir` não verificado C39                                                                                                      | -        |
| requisições com `GET /api/approvals*` e `GET /api/runs*` com os campos novos (2) | `requestedBy` C19 · `startedBy` C10                                                                                                                                                                                                                                                                              | -        |

- Claims naming a status code, route or response shape: C1-C14, C17-C21, C23-C25, C28-C32 - each has a proof that crosses the HTTP boundary (`app.inject` ou um listener real)
- Nenhum outro check afirma mais que o caso único que a prova exerce

## Test policy

| Code                                                                                                                             | Required proofs                             | Coverage expectation                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Decide e é alcançado por um limite HTTP (o gancho, as rotas, a aprovação)                                                        | um no limite **e** um na própria camada     | o contrato no limite; um caso afirmado por linha da tabela de decisão na camada (principal × escopo, tipo × quem decide, perfil) |
| Decide e não é alcançado por um limite (`closeDeviceScopes`, `TicketStore`, `RunManager.create`, `gateWrite`, o plano de escuta) | um na própria camada                        | um caso afirmado por linha da tabela de decisão                                                                                  |
| Ponto de entrada que não decide (o `PATCH`, `pair/start`, `stream-tickets`)                                                      | um no limite                                | entrada aceita, cada entrada recusada, cada caminho de erro                                                                      |
| Interface que decide (as caixas e o fecho em `security.tsx`)                                                                     | um de renderização com `fetch` interceptado | um caso afirmado por transição do fecho e por estado do cartão                                                                   |
| Instrumentação (a prosa de `docs`, o OpenAPI, os `typetests`)                                                                    | um que compara com a fonte                  | o conjunto inteiro contra o autor independente                                                                                   |

Evidence:

- `apps/api/src/server.ts` (gancho `onRequest`): ~16 pontos de decisão (Host, TLS, limite, `?token=`/`?ticket=`, pública, dono, dispositivo vivo, escopo `owner`, escopo ausente, escopo do dispositivo, broker, `rc_`, bilhete) -> decide; a tabela principal × escopo × transporte mora em C1, C2, C9, C23-C25 e C30
- `core/src/security/devices.ts` (`closeDeviceScopes`, `claim`, `setScopes`): 6 ramos (fecho de 3 implicações, padrão, coluna nula, texto inválido) -> decide
- `core/src/runs/runManager.ts` (`create`, regra de dispositivo): 3 ramos (ator, manifesto ausente, `readConfinement`) -> decide
- `core/src/engine.ts` (`gateWrite`): 4 perfis × origem × ator -> decide
- `apps/api/src/approvalActions.ts` (`resolveApproval`): 11 tipos × 4 resolvedores -> decide
- `apps/api/src/tickets.ts`: 5 ramos (emitir, consumir, vencer, teto, destino) -> decide
- `apps/api/src/routes/devices.ts` (`PATCH`, `pair/start`): valida e grava, sem condicional que decida o resultado -> entrada que não decide
- `apps/command-centre/src/views/settings/security.tsx`: o fecho de 3 implicações e 2 condições de exibição -> decide
- análogo mais próximo no repositório: `tests/api.v1.test.ts` (C11 e C12 são table-driven sobre as rotas) e `tests/api.security-p0.test.ts` (a mesma tabela por credencial), já provados no nível do limite com tabela

Cost: 6 arquivos de teste novos, ~110 provas na própria camada. Sem estas linhas, as tabelas de decisão do gancho e da aprovação seriam provadas só por um caminho que as atravessa.

## Swept

- validation: C5, C6, C7, C28
- failure modes: C11, C12, C13, C27
- idempotency: C14, C30
- authorization: C1, C2, C9, C17, C20, C23
- concurrency: C30
- data lifecycle: C22, C30, C32
- dependency failure: C12, C26
- state transitions: C14, C17, C18
- observability: C15, C29, C33

## Out of scope

- Handshake do lançador e cookie de sessão para o `GET /` - ver o plano (Out of scope e Assumptions)
- `rc_` e `brk_` fora do ambiente do processo - o mesmo usuário lê ambos
- Bilhete para as rotas de arquivo - `<img>`/`<video>` refazem a requisição

## Superseded

A decisão AD-015 troca, de propósito, estes claims aprovados da api-v1 (o registro está em `.specs/STATE.md`):

- api-v1 AC 8/C12, "as rotas `owner` são exatamente as 18 da door 3": passa a "as 18 estão entre as rotas `owner`"; o conjunto exato agora é o de C3
- api-v1 AC 9/C13, "um dispositivo resolve `POST /api/approvals/:id/resolve`": passa a "resolve quem tem `approve`" (C19), e `GET /api/runs`/`POST /api/runs` seguem servidos pelos escopos `monitor`/`run` (C2, C10)
- api-v1 door 4/AC 12, "`?token=` aceito em `GET /api/events` e `GET /api/runs/:id/stream`": o do dono segue aceito; o de dispositivo passa a `401` e o dispositivo usa o bilhete (C31)

## Handoff

Cada fatia estimada por `wc -c` do que ela toca (arquivo inteiro quando pequeno, trecho quando grande, como as features anteriores), dividido por quatro, mais o teste novo:

- S1 = `server.ts` (gancho e `onRoute`) 12 KB, `openapi.ts` 4 KB, 18 arquivos de rotas (uma linha de `config` por rota, ~45 KB de trechos), `devices.ts` 5 KB, `routes/devices.ts` 3 KB, `contracts/src/devices.ts` novo 3 KB, `migrations.ts` (trecho) 3 KB, `helpers/routeScopes.ts` 9 KB, `device-scopes.test.ts` (S1) ~30 KB ≈ 114 KB / 4 ≈ 29k
- S2 = `runManager.ts` (trechos) 12 KB, `engine.ts` (`gateWrite`, `skillRunFields`) 6 KB, `common.ts` 12 KB, `runs.ts`/`sessions.ts`/`skills.ts` (trechos) 14 KB, 3 manifestos 3 KB, `contracts` (`records.ts`, `runs.ts`, `settings.ts` trechos) 6 KB, `docs/adapters-guide.md` 4 KB, `device-scopes.test.ts` (S2) ~28 KB ≈ 85 KB / 4 ≈ 21k
- S3 = `approvals.ts` 5 KB, `approvalActions.ts` 5 KB, `system.ts` (trechos) 8 KB, `context.ts` (trecho) 4 KB, `device-scopes.test.ts` (S3) ~22 KB ≈ 44 KB / 4 ≈ 11k
- S4 = `server.ts` (guarda e plano de escuta) 8 KB, `doctor.ts` 8 KB, `cli.ts` (trecho) 2 KB, `remote-transport.test.ts` ~24 KB ≈ 42 KB / 4 ≈ 11k
- S5 = `tickets.ts` novo 4 KB, `events.ts` 2 KB, `runs.ts` (trecho) 1 KB, `sse.ts` 4 KB, `api.ts` da interface (trechos) 9 KB, `api.test.ts` 8 KB, `stream-tickets.test.ts` ~22 KB ≈ 50 KB / 4 ≈ 12k
- S6 = `security.tsx` 11.5 KB, `locales/apps.ts` (trechos) 3 KB, `apps.css` (trecho) 2 KB, `docs/security.md` (tabela e parágrafos) 14 KB, `docs/architecture.md` e `docs/user-manual.md` (trechos) 5 KB, `security.test.tsx` novo ~16 KB ≈ 52 KB / 4 ≈ 13k
- Transversal = testes das features anteriores a emendar (`api.v1`, `api.devices`, `api.hardening`, `security-p1`, `security-reads`, `contracts`) ~30 KB de trechos, `typetests` 4 KB, `STATE.md` 6 KB, `lessons` 0 ≈ 40 KB / 4 ≈ 10k
- S1-S6 + transversal ≈ 107k, mais leitura e a execução dos testes: abaixo do orçamento de 150k - one builder
- Mechanism: one builder (a estimativa cabe; o risco declarado é a compactação do contexto, porque esta sessão já leu o código inteiro antes de escrever)

- **Boundary:** C1-C43 closed in `feat/escopos-dispositivo` (commits `c81c7bb` server and core, `c4071a6` interface, `f9ca4b0` more of C13/C39); the gate ran once at the end: `npm run build`, `npm run typecheck`, `npm run lint`, `npx vitest run` (90 files, 991 tests) and `npm run test -w apps/command-centre` all exit 0 after the typography floor refused a 12 px rule that was dropped; the e2e `smoke.spec.ts` (with C42) and `flows.spec.ts` (27 tests) pass on port 4886 with a temporary configuration that is not committed
- **Mutants run by the author, each killed by at least one proof:** TLS gate off, device scope always ok, `owner` open to a device, a device write not parked, self approval allowed, ticket reusable, ticket never expiring, device token allowed in a stream URL, provider not checked, `run` not bringing `content`, any kind approvable, tool approval without `requestedBy`, a route registering without a scope, a ticket for any run, no ticket cap, a revoked device's ticket still good, the plain listener on `bindAddress`, a silent `doctor`, `startedBy` not stored, a missing column reading as nothing
- **Settled mid-build:** (1) `GET /api/doctor` is `monitor` (a device gets the report without `npm audit`) and `GET /api/devices` stays `owner`, with the phone's HUD not asking for it (`isPairedDevice`): the e2e pairing flow showed the phone asks for both at start. (2) The scopes live in `contracts/src/devices.ts` and leave through the zod-free `./policy` entry (door 7, added to the plan), because the card reads them in the browser. (3) `RunManager.assertMayStart` is public and asked before a conversation is created, so a refused run leaves nothing behind. (4) The owner's `?token=` keeps working on the two streams (a local client); only a device's is `401`. (5) The run stream reopens by itself with a new ticket and `since`; the event feed hands over to its caller, whose next stream resumes after the last id (`lastFeedEventId`). (6) Earlier tests changed by decision (AD-015, AD-016) and only there: `api.v1` C12/C13/C21/C26 (the exact owner set, a device approving, the migration under test), `api.hardening` (its `/api/__boom` route declares a scope), `security-reads` C21/C23/C24 (a device is turned away with `owner_only` before the folder is looked at), `builtin-context` (a device cannot write a skill at all), and `api.v1`/`api.security-p0` send remote peers through `tests/helpers/tlsPeers.ts`. (7) The proof of C29 reads the principal from the gate and not from the request log: the response of a stream is hijacked and is never logged. (8) The order of the device row on the card is name, last seen, the two buttons, the permissions line, the editor (R9 above, reordered before the tests).
- **Abandoned:** the handshake for `GET /` (kept as a limit and as a question to the owner); a central route-to-scope table in another file; `trustProxy` and `X-Forwarded-Proto`; tickets for the two file routes (`Range` breaks single use); a provider list per device; a `manage` scope; a third contracts entry point.
