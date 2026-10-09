# Adaptadores tipados — o que cada CLI emite vira contrato, e uma linha estranha não derruba a execução

## Problem

Os parsers de saída do Claude (`claudeStreamParser`, `adapters/claude/src/index.ts:355-473`) e do
Codex (`codexStreamParser`, `adapters/codex/src/index.ts:248-364`) leem cada linha de JSON como
`any` e procuram campos por nome. Não há tipo para o que o CLI emite, então uma mudança de formato
numa versão nova do CLI passa calada: o campo some, o parser não acha nada, e a execução termina
`done` sem uso, sem custo e sem a lista de arquivos alterados. Isso já aconteceu uma vez no Codex,
que trocou `msg.*` por `item.*` (o parser carrega os dois formatos) e hoje emite `item.type` onde o
CLI falso do repositório ainda usa `item_type` (`tests/fixtures/fake-bin/codex`).

Nada avisa o dono de que o CLI instalado é mais antigo ou mais novo do que o que o MordomoOS
conhece. `detect()` lê `--version` (`adapters/claude/src/index.ts:78`) e não compara com nada.

A decisão do dono (AD-006, 06/10/2026) foi manter os CLIs e não adotar os SDKs oficiais agora: o
do Claude é proprietário e pede zod 4, e o do Codex perderia o kill de grupo, a allowlist e o filtro
de ambiente. Esta feature entrega o que os SDKs dariam de mais útil (eventos tipados) sem trocar o
transporte.

Evidência: pesquisa dos adaptadores e dos SDKs de 06/10/2026 (nesta sessão), com os tipos oficiais
das mensagens lidos de `@anthropic-ai/claude-agent-sdk` 0.3.291 (`sdk.d.ts`) e de
`@openai/codex-sdk` 0.160.1 (`dist/index.d.ts`).

## Flow

Reutiliza `LineParser` e `executeInvocation` (`core/src/agents/baseExec.ts`, exists), os parsers
exportados de cada adaptador (exists) e o `RunEvent` do contrato (`contracts/src/runs.ts`, exists).

1. Formato → `contracts/src/providerStreams.ts` (new) declara, em zod, as mensagens que cada CLI
   emite e que o MordomoOS lê (door 1): do Claude, `system/init`, `assistant`, `user`, `result`; do
   Codex, `thread.started`, `turn.completed`, `turn.failed`, `item.started|updated|completed` (com
   `item.type`) e o formato antigo `msg.*`. `@mordomo/core` reexporta os dois schemas, e os
   adaptadores os importam de lá (continuam dependendo só do core).
2. Parser → cada parser valida a linha contra o schema da door 1 antes de lê-la. Uma linha que é JSON mas não
   casa com nenhuma mensagem conhecida conta como "desconhecida"; o parser nunca lança, e `executeInvocation`
   é a rede de segurança: se `parseLine` ou `finish` lançam, a linha só é contada (ou anotada) e a execução segue até o
   `result`; uma linha acima de 4 MiB é descartada e contada, sem crescer o buffer, e a última linha sem `\n` é lida
   como as outras (traz o `result` com custo e uso). Antes de qualquer schema, `readTypedLine` confere o tamanho do JSON
   (`exceedsShapeBudget`: nenhum array com mais de 10 000 itens, no máximo 50 000 valores no total); uma linha acima disso é
   contada, nunca validada, porque o zod gera um erro por elemento errado e uma linha de 4 MiB congelava o daemon por 14 s.
   Os campos que só enfeitam uma linha (`usage` de uma mensagem com texto, `modelUsage`, o `model` do `system` do
   Claude, dos eventos do Codex e do evento antigo, o `message` das mensagens antigas do Codex) são tolerantes: se não casam, a linha é lida sem eles.
3. Aviso → ao fim da execução, se houve linhas desconhecidas, o adaptador emite um único evento
   `text` no rastro, com a contagem e os tipos vistos (door 2): `LineParser` ganha um `finish()`
   opcional que `executeInvocation` chama depois da última linha e antes do `result` (o parser do
   Cursor não o define e não muda); a contagem fica em `createUnrecognizedTally()` do core
   (`core/src/agents/streamTally.ts`), que nomeia no máximo dez rótulos distintos e diz o motivo real: `unknown type X`
   (tipo que o schema não tem) ou `known type X with an invalid field`; o tipo impresso passa por um filtro de
   caracteres e de tamanho. Uma falha do Codex (`turn.failed`, `error`) vira um `text` no rastro, nunca silêncio, e a
   mensagem do CLI entra como uma linha de texto simples de até 400 caracteres (`plainText`: sem escapes, controle, bidi nem
   quebra de linha), de modo que não imita um aviso `[mordomo]`.
4. Versão → os manifestos do Claude e do Codex declaram `testedVersions` (door 3): a faixa com que esta versão do
   MordomoOS foi desenvolvida, conferida por versão, não certificada. O snapshot do provedor
   (`apps/api/src/context.ts`) é o único lugar que calcula `versionStatus`: `tested`, `older`, `newer` ou `unknown`,
   a partir de `versionStatus(range, saída)` do core (pura, exportada), e traz `installedVersion`, o semver lido de
   `--version`. No tipo `ProviderManifest` o campo é opcional (dá `unknown`), e o Cursor não declara faixa: não há
   gravação nem schema do `cursor-agent` em que ancorá-la. A aba Configurações › Provedores mostra o aviso de uma linha
   com a versão lida, a faixa e o que fazer.
5. Arquivos → um `tool_use` ganha `paths?: string[]` (door 5): o parser do Codex preenche com `file_change.changes[].path`
   (no máximo 200, sem escape nem corte) e o `RunManager` grava `paths` em `filesChanged` quando existe; sem `paths`
   segue lendo `detail`, como antes da feature (primeiro caminho encontrado). O `RunManager` não confia no produtor:
   aplica o mesmo `boundedPaths` (só strings não vazias de até 4096 caracteres, as 200 primeiras por evento; um `paths`
   que não é lista é ignorado e vale o `detail`) e limita `filesChanged` a 5000 arquivos por execução.
6. Fixtures → `tests/fixtures/streams/` (new) guarda transcrições escritas a partir dos tipos
   oficiais dos SDKs, uma por cenário; o CLI falso do Codex passa a emitir `item.type`.

## Impact

| Front       | What changes                                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| domain      | novo termo: `versionStatus` - se a versão instalada do CLI está na faixa testada (`tested`), abaixo (`older`), acima (`newer`) ou não foi lida (`unknown`)                                             |
| contrato    | `@mordomo/contracts` exporta os schemas das mensagens dos CLIs (e `SessionId`, `KnownStreamTypes`); `GET /api/providers` ganha `installedVersion`, `versionStatus` e `testedVersions` em cada snapshot |
| contrato    | o evento `tool_use` do `RunEvent` ganha o campo opcional `paths`                                                                                                                                       |
| contrato    | o rastro de uma execução pode ter um `text` final de aviso sobre linhas desconhecidas                                                                                                                  |
| stored data | nada a migrar                                                                                                                                                                                          |

## Relations

None - no stored-data shape change

## Surface

| Route                | In  | Out                                                                       | Status |
| -------------------- | --- | ------------------------------------------------------------------------- | ------ |
| `GET /api/providers` | -   | cada snapshot ganha `installedVersion`, `versionStatus`, `testedVersions` | `200`  |

## Landing

| One-way door                     | Literal shape                                                                                                                                                                                                                                                                                                                    | Alternative rejected                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1. Schemas das mensagens         | `contracts/src/providerStreams.ts` exporta `ClaudeStreamMessage` e `CodexStreamEvent` (uniões zod discriminadas por `type`, com `.passthrough()` em cada objeto: campos novos não quebram a leitura)                                                                                                                             | `.strict()`: cada campo novo de um CLI viraria linha desconhecida e encheria o rastro de avisos sem mudança de comportamento |
| 2. Aviso de linhas desconhecidas | um único `RunEvent` `{ kind: "text", stream: "stderr", text: "[mordomo] <provider> emitted <n> unrecognized line(s): <motivos>. <consequência e dica>" }` no fim, antes de `result`; nenhum aviso quando `n` = 0; `<motivos>` são `unknown type X`, `known type X with an invalid field` ou `type X with an oversized structure` | Um evento por linha: um CLI novo com um tipo novo por turno inundaria o rastro                                               |
| 3. Faixa testada                 | `manifest.testedVersions: { min: string; max: string }` em semver (`major.minor.patch`), opcional; é a faixa com que esta versão do MordomoOS foi desenvolvida; `versionStatus` compara a primeira versão semver achada na saída de `--version`                                                                                  | Bloquear versões fora da faixa: o dono ficaria sem provedor a cada atualização do CLI; o aviso informa e a execução segue    |

| 4. Formato antigo do Codex no contrato | `CodexStreamEvent = z.union([CodexThreadEvent, CodexLegacyEvent])`: `CodexThreadEvent` é a união discriminada por `type` da door 1; `CodexLegacyEvent` é `{ msg: { type: string, … } }` (passthrough), porque essas linhas não têm `type` no topo | Deixar `msg.*` fora do schema: toda linha de um CLI antigo contaria como desconhecida e o aviso apareceria em toda execução, embora o parser saiba lê-las |

| 5. Caminhos no evento | `RunEvent` `tool_use` ganha `paths?: string[]` (aditivo, no máximo 200, caminhos literais de até 4096 caracteres); o `RunManager` usa `paths` quando existe, limitado de novo ali (`boundedPaths`), e senão o `detail` como antes | Voltar a ler os caminhos do texto de `detail`: o JSON escapa `\` do Windows e o `detail` é cortado em 400 caracteres, então caminhos se perdem ou se corrompem |

- Nothing else in this change is hard to reverse

## Criteria

### S1: Mensagens dos CLIs com tipo (P1)

**Acceptance Criteria**

1. The contracts package SHALL export `ClaudeStreamMessage` and `CodexStreamEvent` zod schemas that accept every fixture in `tests/fixtures/streams/` and keep unknown fields (passthrough)
2. WHEN the Claude parser reads the fixture of a complete run THEN it SHALL emit the same `RunEvent` sequence as before this feature (session, text of init, assistant, tool_use start/end, usage turn and total with `costUsd`, model)
3. WHEN the Codex parser reads a run whose items use `item.type` THEN it SHALL emit `assistant`, `tool_use` and `usage` events as it does for `item_type`, and the fake Codex CLI SHALL emit `item.type`

**Independent test:** cada fixture passa no schema e produz a mesma sequência de eventos de antes.

### S2: Uma linha estranha não derruba a execução (P1)

**Acceptance Criteria**

4. WHEN a parser receives a line that is not JSON, a JSON value that is not an object (`null`, `[]`, `"str"`, `42`, `true`), a truncated JSON line, a 1 MiB line or an object with a wrong nested shape (e.g. a non-iterable `content`) THEN it SHALL NOT throw, and a line that is not a JSON object SHALL become a `text` event
5. WHEN a run's output contains JSON lines of unknown types THEN the adapter SHALL emit exactly one warning `text` event (door 2) naming the count and the distinct types, before the `result` event; the warning SHALL separate `unknown type X` from `known type X with an invalid field` (and from `type X with an oversized structure`, AC 20), name a Codex item as `item.completed/<item type>`, print the type with only `[\w.:/-]` and at most 40 characters, and end with the consequence and where to check the CLI version
6. WHEN a run's output contains only known messages THEN no warning SHALL be emitted
7. WHEN a known message has a field the parser needs with the wrong type (e.g. `turn.completed` `usage.output_tokens: "x"`, `total_cost_usd: "x"`) THEN the parser SHALL count it as unrecognized instead of emitting a usage with `NaN`; token counts and costs SHALL be finite and non-negative

**Independent test:** uma execução do CLI falso com uma linha `{"type":"novidade"}` termina `done` com um aviso no rastro.

### S3: A versão instalada é conferida (P2)

**Acceptance Criteria**

8. The Claude and Codex manifests SHALL declare `testedVersions` (the range this release was developed against); the Cursor manifest SHALL declare none
9. WHEN the provider snapshot reads a version inside `testedVersions` THEN it SHALL report `versionStatus: "tested"`; below `min` → `"older"`; above `max` → `"newer"`; no semver in the output, or no range → `"unknown"`; this SHALL be computed in one place only
10. WHEN `GET /api/providers` is called THEN each snapshot SHALL include `installedVersion` (the parsed semver), `versionStatus` and `testedVersions`
11. WHERE a provider's `versionStatus` is `older` or `newer`, the provider settings screen SHALL show a one-line notice, in English and Portuguese, with the parsed installed version, the range this release was developed against and what the owner can do; it SHALL NOT show the raw `--version` text

**Independent test:** com o CLI falso respondendo `--version` `0.0.1`, o snapshot do Claude diz `older`.

### S4: As escritas do Codex chegam a `filesChanged` (P1)

**Acceptance Criteria**

12. WHEN a Codex `file_change` item lists several `changes[].path` THEN every one of those paths SHALL be recorded in the run's `filesChanged`

**Independent test:** um `file_change` com dois caminhos (um POSIX, um Windows) registra os dois.

### S5: Robustez, da revisão de qualidade (P1)

**Acceptance Criteria**

13. WHEN a Codex `file_change` lists paths THEN the `tool_use` event SHALL carry them verbatim in `paths` (at most 200, none empty or longer than 4096 characters), without JSON escaping or truncation, and a Windows path `C:\work\b.ts` SHALL be recorded as exactly that
14. WHEN a `tool_use` event has no `paths` THEN the `RunManager` SHALL record only the first path-looking token of `detail`, as before this feature
15. WHEN `parseLine`, `finish` or `summarize` throws, or a stdout line is over 4 MiB, THEN the run SHALL continue, the line SHALL be counted as unrecognized (a generic note once when the parser cannot count), and the `result` event SHALL still be emitted
16. WHEN a provider session id is not a plain token (`[A-Za-z0-9][\w.:-]{0,199}`) THEN the line SHALL be unrecognized and the id never stored (wherever the line carries it: `session_id` of a Claude message, `thread_id`, and `session_id` of the oldest Codex shape, at the top of the line or inside `msg`), and a stored id that is not a plain token SHALL never reach `--resume` / `exec resume` (a fresh conversation starts)
17. WHEN a field that only decorates a line (`usage` of an assistant message or a result, `modelUsage` and its `outputTokens`, and every `model`: of an assistant message, of a Claude `system` line, of a Codex event of either shape; and the `message` of an older Codex message) has the wrong shape THEN the text, tool calls and cost of the line SHALL still be read, and a bad `usage` SHALL still be counted in the warning
18. WHEN a Codex `turn.failed`, top-level `error` or `error` item arrives THEN the trace SHALL get a `text` event with its message, flattened to one line of plain characters (no escape sequence, control, bidi or line-break character) and cut at 400 characters

**Independent test:** uma execução com `[[huge]]` termina `done` com um único aviso `an unreadable line` e o `result`.

### S6: Entrada hostil e consumo, da primeira verificação (P1)

**Acceptance Criteria**

19. WHEN the provider process exits after printing a last stdout line without a trailing newline THEN that line SHALL be read like any other (a `result` line keeps its cost and usage)
20. WHEN a line is a JSON object holding an array of more than 10 000 items, or more than 50 000 values in all, THEN the parser SHALL count it as `type X with an oversized structure` without checking it against the schema, and the run SHALL go on; the time spent reading such a 4 MiB line SHALL stay under one second
21. WHEN an adapter's `tool_use` event lists `paths` THEN the `RunManager` SHALL use only non-empty strings of at most 4096 characters, at most 200 per event, record at most 5000 files per run, journal the bounded list, and read `detail` instead when `paths` is not a list

**Independent test:** uma execução do Codex falso com `[[wide]]` (uma linha de ~4 MB com dois milhões de `1` onde vai uma lista) termina `done` com um único aviso `oversized structure` e a resposta do turno.

## Out of scope

| Excluded                          | Why                                                                                                                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDKs oficiais                     | decisão do dono (AD-006); reavaliar depois da licença                                                                                               |
| Prompt do Codex por stdin         | depende de confirmar no CLI real que `exec -` lê o stdin; sem o CLI aqui, não há como provar sem risco                                              |
| Gravar transcrições de CLIs reais | os CLIs não estão instalados neste ambiente; as fixtures vêm dos tipos oficiais dos SDKs e o CI de quem tiver os CLIs pode acrescentar gravações    |
| Cursor                            | o formato do `cursor-agent` não tem tipo oficial publicado; o parser dele só ganha defesa contra entradas estranhas, sem schema nem faixa de versão |

## Assumptions

| Assumption                | Chosen default                                                        | Rationale                                                                                                                                                                                               | Confirmed? |
| ------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Faixas iniciais           | Claude `2.0.0`–`2.1.291`; Codex `0.100.0`–`0.160.1`                   | a faixa com que esta versão foi desenvolvida (conferida, não certificada): o topo é a versão que os SDKs de hoje empacotam; a base cobre o formato `item.*`                                             | n          |
| Faixa do Cursor           | nenhuma (`unknown`)                                                   | não há gravação nem schema do `cursor-agent` em que ancorar uma faixa; uma inventada daria um falso "newer" a cada versão nova                                                                          | n          |
| Aviso de versão bloqueia? | não, só informa                                                       | ver door 3                                                                                                                                                                                              | n          |
| Orçamento de uma linha    | array até 10 000 itens, 50 000 valores no total                       | uma linha de 4 MiB com dois milhões de erros levou 14 s; a 50 000 valores o zod gasta no máximo ~0,3 s; linhas reais têm algumas centenas de valores (um patch de 1000 arquivos tem 3000)               | n          |
| Gravações dos CLIs reais  | pendentes: as fixtures são escritas à mão a partir dos tipos dos SDKs | risco aberto: o CLI real pode repetir `message.id` e `usage` por bloco de conteúdo (contagem dupla de uso do Claude, achado G6 da verificação) e só uma gravação mostra; nada nesta feature o deduplica | n          |

**Open questions:** none - all resolved or logged above.

## Observable

| Surface                             | Decision                  | Landing                                |
| ----------------------------------- | ------------------------- | -------------------------------------- |
| API `GET /api/providers`            | response shape            | AC 10                                  |
| screen `run trace`                  | warning                   | AC 5 - um `text` no rastro             |
| screen `Configurações › Provedores` | version notice            | AC 11                                  |
| screen `run trace`                  | failed Codex turn         | AC 18 - um `text` no rastro            |
| screen `run trace`                  | hostile or oversized line | AC 19, 20 - um aviso, a execução segue |
| screen `run detail`                 | files changed             | AC 21 - `filesChanged` limitado        |
| package `@mordomo/contracts`        | what a consumer imports   | AC 1                                   |

## Sources

- `.specs/features/adaptadores-tipados/design.md` - **binding**: o aviso de versão em Configurações › Provedores (texto em inglês e português, posição no cartão, quando aparece)
- Pesquisa dos adaptadores e SDKs de 06/10/2026 (nesta sessão)
- `@anthropic-ai/claude-agent-sdk` 0.3.291 `sdk.d.ts`; `@openai/codex-sdk` 0.160.1 `dist/index.d.ts`
- AD-006 em `.specs/STATE.md`
