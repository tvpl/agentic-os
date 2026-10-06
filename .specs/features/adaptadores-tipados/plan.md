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
   `item.type`) e o formato antigo `msg.*`.
2. Parser → cada parser valida a linha contra o schema da door 1 antes de lê-la. Uma linha que é JSON mas não
   casa com nenhuma mensagem conhecida conta como "desconhecida"; o parser nunca lança.
3. Aviso → ao fim da execução, se houve linhas desconhecidas, o adaptador emite um único evento
   `text` no rastro, com a contagem e os tipos vistos (door 2).
4. Versão → cada manifesto declara `testedVersions` (door 3). `detect()` compara a versão lida e o
   snapshot do provedor ganha `versionStatus`: `tested`, `older`, `newer` ou `unknown`.
5. Fixtures → `tests/fixtures/streams/` (new) guarda transcrições escritas a partir dos tipos
   oficiais dos SDKs, uma por cenário; o CLI falso do Codex passa a emitir `item.type`.

## Impact

| Front       | What changes                                                                                                                                               |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | novo termo: `versionStatus` - se a versão instalada do CLI está na faixa testada (`tested`), abaixo (`older`), acima (`newer`) ou não foi lida (`unknown`) |
| contrato    | `@mordomo/contracts` exporta os schemas das mensagens dos CLIs; `GET /api/providers` ganha `versionStatus` e `testedVersions` em cada snapshot             |
| contrato    | o rastro de uma execução pode ter um `text` final de aviso sobre linhas desconhecidas                                                                      |
| stored data | nada a migrar                                                                                                                                              |

## Relations

None - no stored-data shape change

## Surface

| Route                | In  | Out                                                   | Status |
| -------------------- | --- | ----------------------------------------------------- | ------ |
| `GET /api/providers` | -   | cada snapshot ganha `versionStatus`, `testedVersions` | `200`  |

## Landing

| One-way door                     | Literal shape                                                                                                                                                                                        | Alternative rejected                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1. Schemas das mensagens         | `contracts/src/providerStreams.ts` exporta `ClaudeStreamMessage` e `CodexStreamEvent` (uniões zod discriminadas por `type`, com `.passthrough()` em cada objeto: campos novos não quebram a leitura) | `.strict()`: cada campo novo de um CLI viraria linha desconhecida e encheria o rastro de avisos sem mudança de comportamento |
| 2. Aviso de linhas desconhecidas | um único `RunEvent` `{ kind: "text", stream: "stderr", text: "[mordomo] <provider> emitted <n> unrecognized line(s): <tipos>" }` no fim, antes de `result`; nenhum aviso quando `n` = 0              | Um evento por linha: um CLI novo com um tipo novo por turno inundaria o rastro                                               |
| 3. Faixa testada                 | `manifest.testedVersions: { min: string; max: string }` em semver (`major.minor.patch`); `versionStatus` compara a primeira versão semver achada na saída de `--version`                             | Bloquear versões fora da faixa: o dono ficaria sem provedor a cada atualização do CLI; o aviso informa e a execução segue    |

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

4. WHEN a parser receives a line that is not JSON, a JSON value that is not an object, a truncated JSON line or a 1 MiB line THEN it SHALL NOT throw, and a non-JSON line SHALL become a `text` event as today
5. WHEN a run's output contains JSON lines of unknown types THEN the adapter SHALL emit exactly one warning `text` event (door 2) naming the count and the distinct types, before the `result` event
6. WHEN a run's output contains only known messages THEN no warning SHALL be emitted
7. WHEN a known message has a field with the wrong type (e.g. `usage.input_tokens: "x"`) THEN the parser SHALL count it as unknown instead of emitting a usage with `NaN`

**Independent test:** uma execução do CLI falso com uma linha `{"type":"novidade"}` termina `done` com um aviso no rastro.

### S3: A versão instalada é conferida (P2)

**Acceptance Criteria**

8. The builtin manifests SHALL each declare `testedVersions`
9. WHEN `detect()` reads a version inside `testedVersions` THEN the snapshot SHALL report `versionStatus: "tested"`; below `min` → `"older"`; above `max` → `"newer"`; no semver in the output → `"unknown"`
10. WHEN `GET /api/providers` is called THEN each snapshot SHALL include `versionStatus` and `testedVersions`
11. WHERE a provider's `versionStatus` is `older` or `newer`, the provider settings screen SHALL show a one-line notice with the installed version and the tested range

**Independent test:** com o CLI falso respondendo `--version` `0.0.1`, o snapshot do Claude diz `older`.

## Out of scope

| Excluded                          | Why                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| SDKs oficiais                     | decisão do dono (AD-006); reavaliar depois da licença                                                                                            |
| Prompt do Codex por stdin         | depende de confirmar no CLI real que `exec -` lê o stdin; sem o CLI aqui, não há como provar sem risco                                           |
| Gravar transcrições de CLIs reais | os CLIs não estão instalados neste ambiente; as fixtures vêm dos tipos oficiais dos SDKs e o CI de quem tiver os CLIs pode acrescentar gravações |
| Cursor                            | o formato do `cursor-agent` não tem tipo oficial publicado; o parser dele não muda                                                               |

## Assumptions

| Assumption                | Chosen default                                      | Rationale                                                                        | Confirmed? |
| ------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------- | ---------- |
| Faixas testadas iniciais  | Claude `2.0.0`–`2.1.291`; Codex `0.100.0`–`0.160.1` | o topo é a versão que os SDKs de hoje empacotam; a base cobre o formato `item.*` | n          |
| Aviso de versão bloqueia? | não, só informa                                     | ver door 3                                                                       | n          |

**Open questions:** none - all resolved or logged above.

## Observable

| Surface                             | Decision                | Landing                    |
| ----------------------------------- | ----------------------- | -------------------------- |
| API `GET /api/providers`            | response shape          | AC 10                      |
| screen `run trace`                  | warning                 | AC 5 - um `text` no rastro |
| screen `Configurações › Provedores` | version notice          | AC 11                      |
| package `@mordomo/contracts`        | what a consumer imports | AC 1                       |

## Sources

- Pesquisa dos adaptadores e SDKs de 06/10/2026 (nesta sessão)
- `@anthropic-ai/claude-agent-sdk` 0.3.291 `sdk.d.ts`; `@openai/codex-sdk` 0.160.1 `dist/index.d.ts`
- AD-006 em `.specs/STATE.md`
