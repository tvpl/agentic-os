# Adaptadores tipados checks

Profile: ui
Plan: `.specs/features/adaptadores-tipados/plan.md`

32 checks in 7 slices · 5 one-way doors · 0 open, of which 0 block

Comandos (da raiz): `npx vitest run tests/adapters.typed.test.ts -t "<nome>"`; a interface com
`npm run test -w apps/command-centre -- <arquivo> -t "<nome>"`. As fixtures ficam em
`tests/fixtures/streams/{claude,codex}/*.jsonl`, uma por cenário, escritas a partir dos tipos
oficiais dos SDKs (citados no cabeçalho de cada arquivo de teste).

Os checks C16-C22 e as emendas aos C2, C4, C6, C7, C9-C15 vêm da revisão de código sênior da feature (não de uma
rodada do Verifier): cada um foi fechado só depois da prova rodar. Os checks C23-C28 e as emendas aos C18-C20 vêm da
primeira verificação independente (`verification.md`, rodada 1: FAIL): cada um foi fechado só depois da prova rodar e de
o mutante nomeado morrer (M17, M25, M55-M57, G1-G5).

Os checks C29-C32 e as emendas aos C19, C24 e C26 vêm da segunda verificação independente (`verification.md`, rodada 2:
FAIL, 8 mutantes vivos: F2, F3, B7, P6, T3, S1, U2, U3): cada um foi fechado só depois da prova rodar e de o mutante
nomeado morrer, injetado e restaurado à mão. O F2 literal (tirar `|| discarding` do `flushStdout`) era equivalente, porque
uma linha em descarte já tem `pendingChars` acima do teto; a redundância saiu do código e o mutante que importa
(o flush que ignora a linha em descarte) morre no C31.

Perfil `ui`: a feature muda uma tela (Configurações › Provedores, o aviso de versão), então o `checks.md` foi reaprovado sob
`ui`, com a fonte binding `design.md` e a enumeração da tela em `## Binding sources`. Fora do alcance destes checks, por
tela: Configurações › Provedores - espaçamento, cor e peso de tipo do parágrafo `meta` do aviso (vêm dos tokens da classe `meta`).

## Checks

### S1 - mensagens com tipo · 6 files · 60 KB · ~15k

**C1** - Toda linha de toda fixture em `tests/fixtures/streams/claude` passa em `ClaudeStreamMessage.safeParse`, e toda linha de `tests/fixtures/streams/codex` passa em `CodexStreamEvent.safeParse`; um campo extra (`{ ..., "novo": 1 }`) continua no resultado (AC 1)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C1 every fixture line matches its schema"`
Status: closed

**C2** - `@mordomo/contracts` exporta `ClaudeStreamMessage` e `CodexStreamEvent` (importados da raiz do pacote) e, do arquivo dos schemas, só mais `SessionId` e `KnownStreamTypes`; as peças internas não são API pública (AC 1)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C2 the stream schemas are part of the contract"`
Status: closed

**C3** - O parser do Claude, sobre a fixture `claude/complete-run.jsonl`, emite a sequência de eventos gravada em `claude/complete-run.events.json`, gerada com o parser de antes da feature (commit base) e conferida à mão (AC 2)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C3 the claude parser keeps its event sequence"`
Status: closed

**C4** - O parser do Codex emite a mesma sequência para `codex/item-type-current.jsonl` (`item.type`) e para `codex/item-type-legacy.jsonl` (`item_type`), a menos do campo `paths` do `file_change` (C15), e a do formato antigo `codex/legacy-msg.jsonl` não muda (AC 3)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C4 both codex item shapes parse alike"`
Status: closed

**C5** - O CLI falso `tests/fixtures/fake-bin/codex` emite `item.type`, e uma execução do Codex pelo `RunManager` termina `done` com `assistant` e `usage` (AC 3)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C5 the fake codex speaks the current format"`
Status: closed

### S2 - linhas estranhas · 4 files · 40 KB · ~10k

**C6** - Cada um dos três parsers (claude, codex, cursor) recebe `oi`, `{"type":"assistant"` (truncada), `null`, `[]`, `[1]`, `"str"`, `42`, `true`, quatorze objetos de forma errada (`content: 5`, `content: [null,5]`, `message: null`, `item: null`, `changes: 5`, `msg: null`, …) e uma linha JSON de 1 MiB e não lança; `oi`, a truncada e os JSON que não são objeto devolvem `null` (viram `text`) (AC 4)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C6 a strange line never throws"`
Status: closed

**C7** - Uma execução do Claude falso cujo prompt tem `[[unknown:novidade]]` (gatilho novo do CLI falso: imprime `{"type":"novidade"}` duas vezes) termina `done` e tem exatamente um evento `text` `[mordomo] claude emitted 2 unrecognized line(s): unknown type novidade. <consequência e dica>`, antes do `result` (AC 5)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C7 unknown lines become one warning"`
Status: closed

**C8** - Uma execução do Claude falso sem o gatilho não tem nenhum evento com `unrecognized` (AC 6)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C8 a known run has no warning"`
Status: closed

**C9** - Um `result` do Claude com `total_cost_usd` `"x"`, `-1` ou `1e999`, e um `turn.completed` do Codex com `usage` de `"x"`, negativo ou `1e999`, não geram `usage` e contam como `known type … with an invalid field`; um `token_count` antigo com `-1` idem, e uma mensagem antiga de outro tipo com `info: 5` continua lida (AC 7)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C9 a wrong needed field is unrecognized, never NaN or negative"`
Status: closed

### S3 - versão conferida · 6 files · 50 KB · ~13k

**C10** - Os manifestos de claude (`2.0.0`–`2.1.291`) e codex (`0.100.0`–`0.160.1`) declaram `testedVersions` com `min` ≤ `max`; o do cursor não declara e o status dele é `unknown` (AC 8)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C10 claude and codex declare the range they were developed against, cursor declares none"`
Status: closed

**C11** - `versionStatus(range, saída)` devolve `tested` para `2.1.0 (Claude Code)`, `older` para `0.0.1`, `newer` para `99.0.0`, `unknown` para `dev build`, os limites `min` e `max` contam como `tested`, uma pré-release vale a sua versão, uma faixa malformada dá `unknown`, e `installedVersion` devolve o semver (`codex-cli 0.99.0-fake` → `0.99.0`) ou `null` (AC 9)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C11 the version status follows the range"`
Status: closed

**C12** - Com o Claude falso respondendo `--version` `0.0.1` (`FAKE_CLAUDE_VERSION`), o snapshot de `GET /api/providers` traz `installedVersion` `"0.0.1"` e `versionStatus` `"older"` (AC 9)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C12 an older CLI is reported as older"`
Status: closed

**C13** - `GET /api/providers` traz `installedVersion`, `versionStatus` e `testedVersions` em cada snapshot, com os valores literais esperados (claude `tested` 2.1.0, codex `older` 0.99.0, cursor `unknown` com `testedVersions: null`) (AC 10)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C13 snapshots carry the version status"`
Status: closed

**C14** - A aba de provedores mostra o aviso com o semver lido (não o texto cru de `--version`), a faixa com que esta versão foi desenvolvida e o que fazer, quando `versionStatus` é `older` ou `newer`, e não mostra com `tested` nem `unknown` nem sem os campos novos (AC 11)
Proof: `npm run test -w apps/command-centre -- src/views/settings/providers.test.tsx -t "C14 an untested CLI version shows a notice"`
Status: closed

### S4 - escritas do Codex · 4 files · 30 KB · ~8k

**C15** - O parser do Codex põe todos os `changes[].path` de um `file_change` em `paths` no evento `tool_use` (o `detail` volta a ser `{"status":"completed"}`), com o caminho do Windows `C:\work\b.ts` literal, o `writeToolPattern` do Codex casa `file_change`, e uma execução do Codex falso com `[[patch]]` (sete caminhos, cinco deles longos: mais de 400 caracteres no total) grava os sete em `filesChanged` pelo `RunManager` (AC 12, 13)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C15 every path of a codex file_change counts as changed"`
Status: closed

### Rodada 2 - revisão de qualidade · 4 files · 40 KB · ~25k

**C16** - Um `file_change` com 300 caminhos põe só os 200 primeiros em `paths`, cada um inteiro; caminhos vazios ou com mais de 4096 caracteres ficam de fora; sem `changes` o evento não tem `paths` (AC 13)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C16 the paths of a patch are neither cut nor unbounded"`
Status: closed

**C17** - Um `tool_use` `Write`/`Edit` sem `paths` (adaptador de teste) cujo `content` cita `/var/www` e `/etc/hosts` grava só o primeiro caminho em `filesChanged`, e um nome com vírgula (`/repo/with, comma.ts`) é cortado no espaço como antes da feature (AC 14)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C17 a tool without paths records its first path only, as before"`
Status: closed

**C18** - O aviso separa `unknown type X` de `known type X with an invalid field` (e do `type X with an oversized structure`, C24), nomeia o item do Codex (`item.completed/collab_tool_call`), imprime o tipo só com `[\w.:/-]` e até 40 caracteres (nenhum caractere de controle nem bidi sobrevive) e termina com a consequência e onde conferir a versão do CLI (AC 5)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C18 the warning names the real reason and prints only safe text"`
Status: closed

**C19** - Um `session_id`/`thread_id` que começa com `-` ou `.`, ou que tem espaço, uma quebra de linha **de verdade** (`\n`, no meio, no fim ou no começo; `\r`), tabulação, NUL, `/`, `..`, vazio, 201 caracteres ou não ASCII, em qualquer um dos sítios onde o schema o lê (a linha do Claude, `thread_id`, `msg.session_id` de `session_configured` e de `token_count`, e o `session_id` de topo do formato antigo do Codex), torna a linha desconhecida e não gera evento `session`; um id guardado assim não chega a `--resume` nem a `exec resume` (começa uma conversa nova), e um UUID chega; o teste envia os caracteres reais (não a barra invertida seguida de `n`) e confere que a lista tem um `\n` de verdade (AC 16)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C19 a provider session id is a plain token, here and on the command line"`
Status: closed

**C20** - Uma mensagem `assistant` do Claude com `usage` malformado (`input_tokens: null`, `"x"`, negativo, `usage: "x"`, `model: 5`) ainda emite o texto e o `tool_use`; um `result` com `usage` nulo, malformado ou `modelUsage: 5` ainda emite o custo, e um `outputTokens` ruim num item de `modelUsage` só tira aquele item; `usage` malformado conta no aviso e `null` não; e o mesmo vale para o `model: 5` de um `system/init` do Claude (a sessão começa com `model=?`), de um `turn.completed` do Codex (o `usage` sai, com o `model` quando é texto) e de uma mensagem antiga do Codex, e para um `message: 5` de uma mensagem antiga que não é `agent_message` (o `tool_use` sai e nada é contado) (AC 17)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C20 a bad decorative field does not drop the line"`
Status: closed

**C21** - Sobre `codex/failed-turn.jsonl` o parser emite um `text` para o item `error`, um para o `error` do topo e um para o `turn.failed`, com a mensagem, e nenhum evento `error` nem aviso; um `turn.failed` sem mensagem também deixa uma linha (AC 18)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C21 a failed codex turn is never silent"`
Status: closed

**C22** - Pelo `executeInvocation` real: um parser cujo `parseLine`, `summarize` e `finish` lançam deixa a execução terminar com `result` (`exitCode` 0, sem evento `error`) e duas notas; um parser com `dropped()` é chamado uma vez por linha; uma linha de 1 MiB em vários pedaços é lida inteira; uma de 5 MiB (acima de 4 MiB) é descartada e contada uma vez (`an unreadable line`) e a execução segue até o `result` (AC 15)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C22 a throwing parser, or a huge line, costs that line and nothing more"`
Status: closed

### Rodada 2 - lacunas da primeira verificação · 9 files · 80 KB · ~25k

**C23** - Uma execução do Claude falso com `[[nonl]]` (gatilho novo: a linha `result`, com `total_cost_usd` 0.5, sai sem `\n` final) termina com o `usage` `scope: total` de `costUsd` 0.5, o `result` com `summary` `No newline.`, nenhum aviso e nenhuma cópia da linha como texto (AC 19)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C23 a stream that ends without a newline still yields its last line"`
Status: closed

**C24** - Uma linha de ~4 MB com dois milhões de `1` onde vai uma lista (`message.content` do Claude, `item.changes` do `file_change` do Codex; gatilho novo `[[wide]]` nos dois CLIs falsos) passa pelo `executeInvocation` real com menos de 1000 ms gastos no `parseLine`, vira um único aviso `type assistant with an oversized structure` / `type item.completed/file_change with an oversized structure` e a execução segue até o `result` (o Codex ainda entrega a resposta e o `usage` do turno); a linha **nunca** vira evento `text` no rastro (nenhum `text` com mais de 1000 caracteres nem com `1,1,1,1`: o `readTypedLine` devolve `[]`, não `null`); `exceedsShapeBudget` aceita um array de 10 000 itens e recusa um de 10 001, recusa mais de 50 000 valores no total (seis arrays de 9 000, 60 000 chaves), anda por 200 000 níveis sem estourar a pilha, e um patch de 3000 arquivos (9 000 valores) ainda é lido e fica com os 200 primeiros caminhos (AC 20)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C24 a hostile wrong-shape array line costs a skipped line, not seconds of the event loop"`
Status: closed

**C25** - Um adaptador de teste que emite `tool_use` com `paths` hostil: só strings não vazias de até 4096 caracteres contam (o de 4096 entra, o de 4097 não), no máximo 200 por evento e na ordem; `paths` que não é lista (uma string, um objeto com `length`) é ignorado e vale o `detail`; 30 eventos de 200 arquivos novos param em 5000 em `filesChanged`; e o diário guarda a lista já limitada (AC 21)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C25 the run manager does not trust the paths an adapter lists"`
Status: closed

**C26** - A mensagem de um `turn.failed`, de um `error` do topo, de um item `error` e do `error` do formato antigo do Codex (que vira `permission`) com quebra de linha, `ESC[31m`, `ESC]0;...BEL`, bidi `U+202E`, `U+2028`, `\r` e BEL chega ao rastro numa linha só (a classe inteira de formato, um ponto de código por vez, é o C32), sem nenhum caractere de controle nem bidi, e o texto `[mordomo]` não começa linha; é cortada em 400 caracteres sem partir um par substituto; uma mensagem de 4 MB leva menos de 1000 ms; uma só de controle deixa `[codex] turn failed` (AC 18)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C26 the text of a CLI failure is one plain line and cannot pose as a notice"`
Status: closed

**C27** - `TestedVersions` e `VersionStatus` são importáveis de `@mordomo/contracts` e idênticos aos de `@mordomo/core`, e o `paths` de um `tool_use` é uma lista de strings opcional (uma string ou uma lista de números não compila) (`typetests/exports.ts`, `typetests/core-exports.ts`)
Proof: `npx tsc -p typetests/tsconfig.json`
Status: closed

**C28** - Na aba de provedores o aviso é um `<p role="note">` sem marcação, filho direto do cartão do seu provedor, depois do cabeçalho e antes do bloco de login e da grade, um por cartão (2 de 3) e nenhum no `tested`; e em português traz o texto de `older` e de `newer` com o semver lido e sem o `--version` cru (AC 11, `design.md`)
Proof: `npm run test -w apps/command-centre -- src/views/settings/providers.test.tsx -t "C28 the notice sits in its own provider card, between the header and the login block"`
Proof: `npm run test -w apps/command-centre -- src/views/settings/providers.test.tsx -t "C28 the notice reads in Portuguese too, with the parsed version and no raw --version text"`
Status: closed

### Rodada 3 - lacunas da segunda verificação · 6 files · 50 KB · ~20k

**C29** - Na aba de provedores, com `versionStatus` `older` ou `newer`, cada campo que o aviso imprime ausente **sozinho** (`installedVersion` ausente, `null` ou vazio; `testedVersions` ausente ou `null`) não mostra aviso nenhum nem escreve `undefined`/`null`/`NaN`, enquanto o cartão ao lado, completo, mostra o seu; e o aviso é o `<p class="meta">` simples (`className` exatamente `meta`, nunca `badge warn`), em inglês e em português (AC 11, `design.md` "Quando aparece" e "Forma")
Proof: `npm run test -w apps/command-centre -- src/views/settings/providers.test.tsx -t "C29 the notice needs every field it prints, each missing on its own"`
Status: closed

**C30** - O teto de 5000 arquivos por execução vale para a fonte `detail` (uma ferramenta sem `paths`): 5001 eventos `Write` com um arquivo cada deixam 5000 em `filesChanged`, o primeiro e o 5000º inclusos e o 5001º fora; e as duas fontes dividem o mesmo orçamento (4998 de `detail`, um patch de três em `paths`, mais um de `detail`: ficam 5000, entram os dois primeiros do patch e nenhum depois) (AC 21)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C30 the 5000-file cap holds for the detail source too, and across both sources"`
Status: closed

**C31** - Uma última linha **sem `\n`** é tratada como as outras: uma de 5 MiB (acima do teto; gatilho novo `[[nonl-huge]]` do CLI falso) é descartada e contada uma vez como `an unreadable line` (o cursor, que não conta, ganha a nota genérica), sem aparecer como texto, e a execução termina com o `result`; uma de tipo desconhecido (gatilho novo `[[nonl-unknown]]`) entra no aviso único (`emitted 3 ... unknown type novidade, unknown type ultima`), que sai antes do `result`, e sozinha é o aviso inteiro (AC 15, 5)
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C31 an unterminated last line is counted, whether it is over the size cap or of an unknown type"`
Status: closed

**C32** - Cada caractere da classe de formato do Unicode que o `plainText` promete remover (`U+200B`-`U+200F`, `U+202A`-`U+202E`, `U+2060`-`U+2064`, `U+2066`-`U+2069`, `U+FEFF`, `U+00AD`, `U+061C`, `U+E0001`, `U+E0041`), testado **um por vez**, vira um espaço no meio de uma mensagem de falha do Codex, não deixa nada sozinho (`[codex] turn failed`) e some no fim (AC 18 "bidi")
Proof: `npx vitest run tests/adapters.typed.test.ts -t "C32 every bidi, zero-width and other format character of a CLI failure becomes a space"`
Status: closed

## Coverage

| Set (size)                                        | Member -> proof                                                                                                                                                                                                                                                                                                                  | Unproven |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| mensagens do Claude lidas (4)                     | `system/init` C1, C3 · `assistant` C1, C3 · `user` C1, C3 · `result` C1, C3                                                                                                                                                                                                                                                      | -        |
| formas de evento do Codex (3)                     | `item.type` C4, C5 · `item_type` C4 · `msg.*` C4                                                                                                                                                                                                                                                                                 | -        |
| linhas estranhas (11)                             | não-JSON C6 · `null`, texto, número, `true`, array C6 · truncada C6 · 1 MiB C6 · forma errada aninhada C6 · acima de 4 MiB C22 · parser que lança C22 · última linha sem `\n` C23 · array ou total de valores acima do orçamento C24 · última linha sem `\n` acima de 4 MiB C31 · última linha sem `\n` de tipo desconhecido C31 | -        |
| orçamento de uma linha (5)                        | (4 limites e a saída) 10 000 itens passa C24 · 10 001 recusa C24 · 50 000 valores no total C24 · profundidade 200 000 sem estourar C24 · a linha grande não vira texto no rastro C24                                                                                                                                             | -        |
| parsers que não lançam (3)                        | claude C6 · codex C6 · cursor C6                                                                                                                                                                                                                                                                                                 | -        |
| desfechos do aviso (2)                            | com linhas desconhecidas C7 · sem C8                                                                                                                                                                                                                                                                                             | -        |
| campos necessários com tipo errado (2 provedores) | Claude C9 · Codex C9                                                                                                                                                                                                                                                                                                             | -        |
| campos decorativos com tipo errado (9)            | `usage` de mensagem C20 · `usage` de `result` C20 · `modelUsage` C20 · `outputTokens` de um item de `modelUsage` C20 · `model` de mensagem C20 · `model` de `system` C20 · `model` de evento do Codex C20 · `model` do evento antigo C20 · `message` do msg antigo C20                                                           | -        |
| motivos do aviso (2)                              | `unknown type` C7, C18 · `known type … with an invalid field` C9, C18                                                                                                                                                                                                                                                            | -        |
| ids de sessão inválidos (2 destinos)              | linha do stream C19 · argv de `--resume` / `exec resume` C19                                                                                                                                                                                                                                                                     | -        |
| caracteres que a regra de `SessionId` recusa (9)  | `-` inicial C19 · `.` inicial (`..`) C19 · espaço C19 · `\n` real (meio, fim, começo) C19 · `\r` C19 · tabulação C19 · NUL C19 · `/` C19 · vazio, 201 e não ASCII C19                                                                                                                                                            | -        |
| sítios de `SessionId` no schema (6)               | linha do Claude C19 · `thread_id` C19 · `session_configured.session_id` C19 · `token_count.session_id` C19 · `session_id` de topo do formato antigo C19 · UUID válido nos cinco C19                                                                                                                                              | -        |
| falhas do Codex (3)                               | `turn.failed` C21 · `error` do topo C21 · item `error` C21                                                                                                                                                                                                                                                                       | -        |
| texto de falha do Codex (8)                       | fontes: `turn.failed` C26 · `error` C26 · item `error` C26 · `error` antigo C26; filtros: escapes ANSI/OSC C26 · controle, separadores e `U+202E` C26 · todo o conjunto de formato (bidi, zero-width, isolates, `U+FEFF`, `U+00AD`) um por vez C32 · corte em 400 sem partir par substituto C26 · só controle C26                | -        |
| limites de `paths` no consumidor (7)              | não é lista C25 · item que não é string C25 · vazio C25 · 4096 entra e 4097 sai C25 · 200 por evento C25 · 5000 por execução na fonte `paths` C25 · 5000 por execução na fonte `detail` e nas duas juntas C30                                                                                                                    | -        |
| estados do aviso na tela (7)                      | `older` C14, C28 · `newer` C14, C28 · `tested` C14, C28 · `unknown` C14 · `versionStatus` ausente C14 · `installedVersion` ausente, `null` ou vazio C29 · `testedVersions` ausente ou `null` C29                                                                                                                                 | -        |
| tipos de fio nos typetests (3)                    | `TestedVersions` C27 · `VersionStatus` C27 · `tool_use.paths` C27                                                                                                                                                                                                                                                                | -        |
| `versionStatus` (4)                               | `tested` C11 · `older` C11, C12 · `newer` C11 · `unknown` C11, C13 (cursor)                                                                                                                                                                                                                                                      | -        |
| manifestos embutidos (3)                          | claude C10 · codex C10 · cursor (sem faixa) C10                                                                                                                                                                                                                                                                                  | -        |
| caminhos de um `file_change` (2 formas)           | POSIX C15 · Windows C15                                                                                                                                                                                                                                                                                                          | -        |
| origem de `filesChanged` (2)                      | `paths` C15, C16, C25 · primeiro caminho de `detail` C17, C30                                                                                                                                                                                                                                                                    | -        |
| doors (5)                                         | schemas C1, C2 · aviso C7, C8, C18, C24 · faixa C10-C13 · formato antigo do Codex C4 · `paths` C15-C17, C25, C30                                                                                                                                                                                                                 | -        |

- Claims naming a route: C13 - provado por `inject`

## Binding sources

| Source                                          | Screens / sets                                       | Checks   |
| ----------------------------------------------- | ---------------------------------------------------- | -------- |
| `.specs/features/adaptadores-tipados/design.md` | Configurações › Provedores: o aviso de versão do CLI | C14, C28 |

Enumeração da tela **Configurações › Provedores** (o que o `design.md` decide e um seletor alcança; cópia e arranjo):

| Elemento ou arranjo                                                             | O design decide                                                 | Check    |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------- |
| texto de `older` em inglês, com `{version}`, `{min}`, `{max}`                   | a frase exata                                                   | C14      |
| texto de `newer` em inglês                                                      | a frase exata                                                   | C14      |
| texto de `older` em português                                                   | a frase exata                                                   | C28      |
| texto de `newer` em português                                                   | a frase exata                                                   | C28      |
| a versão mostrada é o semver lido, nunca o `--version` cru                      | `installedVersion`                                              | C14, C28 |
| presença: `older`, `newer`                                                      | o aviso aparece                                                 | C14, C28 |
| ausência: `tested`, `unknown`, servidor sem os campos                           | nenhum aviso                                                    | C14, C28 |
| contagem: um aviso por cartão (2 de 4 em C14, 2 de 3 em C28), nenhum no topo    | um por provedor afetado                                         | C14, C28 |
| arranjo: filho direto do cartão do próprio provedor                             | dentro do `.provider-row` do provedor                           | C28      |
| arranjo: ordem das regiões do cartão (cabeçalho, aviso, login, grade)           | `provider-head`, aviso, `auth-recovery` (quando existe), `grid` | C28      |
| forma: um `<p>` de texto simples com `role="note"`, sem marcação dentro         | uma frase, tom de informação                                    | C14, C28 |
| forma: `class="meta"` (tom de informação, nunca `badge warn`), nos dois idiomas | `<p class="meta" role="note">`                                  | C28, C29 |
| ausência: `older`/`newer` sem `installedVersion` (ausente, `null`, vazio)       | "sem `installedVersion`" -> nunca                               | C29      |
| ausência: `older`/`newer` sem `testedVersions` (ausente, `null`)                | "sem `testedVersions`" -> nunca                                 | C29      |

Elementos que o código desenha e o design não: nenhum. Elementos que o design decide e nenhum check cobre: nenhum **agora**.
Na rodada 2 a verificação achou dois que faltavam (a classe `meta` e a guarda de cada campo), e a afirmação anterior deste
arquivo ("nenhum") era falsa; a enumeração acima é a recomputada do `design.md` (as 5 linhas de "Quando aparece", as 4 regiões
do cartão, a forma e os dois textos) e cada linha tem um check cujo mutante foi injetado e morreu (U1, U2, U3, U5). O que fica fora
por política é só o espaçamento, a cor e o peso do tipo do parágrafo `meta` (vêm dos tokens da classe, sem seletor que os alcance).

## Test policy

| Code                                                                          | Required proofs      | Coverage expectation                                                                                                                                                                                              |
| ----------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decides, not reached across a boundary (parsers, versão)                      | one at its own layer | each message shape, each status, each character a rule refuses (session id, format characters)                                                                                                                    |
| Decides, reached across a boundary (snapshot)                                 | one at the boundary  | the new fields                                                                                                                                                                                                    |
| Decides, reached across a boundary (linhas do processo filho, `filesChanged`) | one at the boundary  | each way a line can fail (throws, oversize, strange shape, no final newline - short, over the cap or unknown -, hostile array, never echoed as text), each source of paths and each limit on it, for every source |
| Instrumentation (aviso na tela)                                               | one render test      | shown, hidden (by status and by each missing field on its own), arranged in its card, its class, in each language                                                                                                 |

Evidence:

- `adapters/claude/src/index.ts` `claudeStreamParser()` e `adapters/codex/src/index.ts` `codexStreamParser()`: tipo da mensagem → evento -> decides
- `core/src/agents/streamTally.ts`: `exceedsShapeBudget` (2 limites, 1 total de valores; interno ao core, não exportado no índice), `plainText` (escapes, controle, formato, corte; exportado porque o adaptador do Codex o usa), `readTypedLine` (4 saídas) -> decides
- `core/src/runs/runManager.ts` `boundedEvent` + `recordFile` + `core/src/agents/eventPaths.ts` `boundedPaths` (4 filtros, 2 tetos) -> decides, reached across a boundary (um adaptador de terceiros)
- closest analogue in the repo: `tests/core.usage.test.ts` (chama os parsers direto)

Cost: 1 arquivo de teste novo na raiz, 1 na interface, fixtures, 32 provas.

## Swept

- validation: C1, C9, C19, C20, C24, C25, C26, C29, C30, C32 (schemas; tipo errado; id de sessão; campos decorativos; orçamento da linha; `paths` no consumidor; texto de falha)
- failure modes: C6 (linha estranha não lança), C7 (formato novo vira aviso, não silêncio), C21 (turno falho do Codex), C22 (parser que lança, linha enorme), C23 e C31 (última linha sem `\n`), C24 (linha hostil dentro do teto, nunca ecoada)
- idempotency: n/a - nada é gravado
- authorization: n/a - nenhuma rota nova; `GET /api/providers` segue a regra de auth existente
- concurrency: n/a - um parser por execução
- data lifecycle: n/a - nada novo é guardado; as fixtures são só de teste
- dependency failure: C12, C13 (CLI de versão fora da faixa)
- state transitions: n/a - o status da execução continua decidido pelos eventos `result`/`error`, que não mudam
- observability: C7 (aviso no rastro), C14 (aviso na tela)

## Handoff

- S1-S3 ≈ 38k: adaptadores claude e codex trechos dos parsers ~25 KB, baseExec 6 KB, contrato 4 KB, fixtures novas ~15 KB, CLI falso 6 KB, providers.tsx 8 KB, testes novos ~25 KB ≈ 89 KB / 4 ≈ 22k, mais leitura - abaixo de 150k - one builder
- Rodada 2 (C23-C28) ≈ 22k: `streamTally.ts` 6 KB, `runManager.ts` trechos 8 KB, `eventPaths.ts` 1 KB, adaptador do Codex trechos 6 KB, CLIs falsos 3 KB, testes ~30 KB, `providers.tsx` 8 KB ≈ 62 KB / 4 ≈ 16k, mais leitura - abaixo de 150k - one builder
- Rodada 3 (C29-C32) ≈ 12k: `providers.tsx` e o teste 10 KB, `baseExec.ts` trechos 4 KB, `streamTally.ts` 6 KB, `runManager.ts` trechos 4 KB, CLI falso 1 KB, testes ~12 KB ≈ 37 KB / 4 ≈ 9k, mais leitura - abaixo de 150k - one builder
