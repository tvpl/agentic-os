# Capacidades aplicadas — o perfil exige o que o provedor declara

## Problem

O manifesto de cada provedor declara se ele garante o modo somente-leitura
(`capabilities.enforcesReadOnly`), mas nada no motor lê esse campo. No Cursor, o modo
`read_only` é só uma frase no fim do prompt. Isso vale também para execuções que ninguém
acompanha: a triagem das sentinelas roda no provedor padrão com um prompt montado de dados
externos (`core/src/sentinels/triage.ts`), e as rotinas rodam de madrugada. Com o Cursor como
padrão, um texto hostil num e-mail ou num arquivo indexado pode pedir uma escrita, e só a frase
segura.

O perfil `controlled_write` promete escrita "restrita ao diretório de trabalho" (`docs/security.md`).
Isso vale para o Claude (broker de permissão) e para o Codex (`--sandbox workspace-write`). No
Cursor, a escrita sai com `--force`, que aplica qualquer mudança em qualquer lugar, sem revisão.

Os processos dos provedores herdam o ambiente inteiro do serviço (`core/src/spawn/safeSpawn.ts`):
o token do bot do Telegram e qualquer `MORDOMO_*` chegam ao agente e à ferramenta Bash dele.

Quem paga é o dono da máquina, que escolheu um perfil esperando que ele valesse para qualquer
provedor. Evidência: análise do motor de 06/10/2026 (achados S2 e S3). Não há relato de incidente.

## Flow

Reutiliza o manifesto de cada provedor (`core/src/agents/registry.ts`), o `gateWrite` do motor
(feature 3) e o ponto único de execução `RunManager.execute`. Nenhuma regra nova vive na API.

1. Execução → `core/src/runs/runManager.ts` (exists) `execute()`: antes de chamar o adaptador,
   lê `adapter.manifest.capabilities`. Execução `read_only` de origem `routine` ou `sentinel` num
   provedor com `enforcesReadOnly: false` termina `failed` sem chamar o adaptador. Execução
   `read_only` manual nesse provedor segue, com um evento `permission` dizendo que o modo é só
   pedido no prompt.
2. Escrita → `core/src/engine.ts` (exists) `gateWrite()`: quando o perfil liberaria a escrita
   direto e o provedor declara `writeConfinement: "none"` (door 1), a escrita é estacionada para
   aprovação como em `review_before_write`, exceto em `approved_automation`.
3. Ambiente → `core/src/agents/baseExec.ts` (exists) passa a `safeSpawn`
   (`core/src/spawn/safeSpawn.ts`, exists) a lista de nomes a remover (door 2), montada pelo
   `RunManager` a partir das configurações.

## Impact

| Front       | What changes                                                                                                                                                                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | novo termo: `writeConfinement` - como o provedor confina uma escrita: `broker` (cada ferramenta pede permissão), `sandbox` (o CLI limita a escrita ao diretório), `none`; vive no manifesto                                                           |
| domain      | termo existente: `controlled_write` liberava toda escrita manual na hora; passa a liberar só em provedor com confinamento; quem decide é `writeDecision` + `gateWrite`                                                                                |
| domain      | termo existente: `enforcesReadOnly` era informativo; passa a decidir se uma execução sem supervisão roda                                                                                                                                              |
| contrato    | `POST /api/runs` e `POST /api/skills/:slug/run` com `provider: "cursor"`, `mode: "write"` sob `controlled_write` respondem `202` com `pendingApproval` em vez de iniciar; a UI já trata `202 waiting_approval` (é o caminho de `review_before_write`) |
| stored data | nada a migrar                                                                                                                                                                                                                                         |

## Relations

None - no stored-data shape change

## Surface

| Route                                                       | In                           | Out                                                      | Status                        |
| ----------------------------------------------------------- | ---------------------------- | -------------------------------------------------------- | ----------------------------- |
| `POST /api/runs` (escrita no Cursor sob `controlled_write`) | `provider`, `mode`, `prompt` | `pendingApproval`, `runId`, `status: "waiting_approval"` | `202` (antes iniciava direto) |

## Landing

| One-way door                                     | Literal shape                                                                                                                                                                           | Alternative rejected                                                                                                                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Campo de confinamento de escrita no manifesto | `capabilities.writeConfinement: "broker" \| "sandbox" \| "none"`; claude `"broker"`, codex `"sandbox"`, cursor `"none"`                                                                 | Derivar de `enforcesReadOnly`: o Codex confina a escrita por sandbox e o Claude por broker, dois mecanismos diferentes que uma flag de leitura não descreve; um adaptador de terceiros precisa declarar o seu         |
| 2. Regra de ambiente dos processos de provedor   | remover toda variável com prefixo `MORDOMO_` e a variável nomeada em `settings.channels.telegram.botTokenEnv`; o resto do ambiente segue (PATH, HOME, chaves de API do provedor, proxy) | Allowlist de variáveis: o login dos CLIs depende de variáveis que mudam por provedor e por versão (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, proxies, `XDG_*`); uma allowlist quebraria a autenticação de usuários reais |

- Nothing else in this change is hard to reverse

## Criteria

### S1: Somente-leitura sem supervisão só onde o provedor garante (P1)

**Acceptance Criteria**

1. IF a run with origin `routine` or `sentinel` and mode `read_only` targets a provider whose manifest declares `enforcesReadOnly: false` THEN the run SHALL end `failed` with an error naming that the provider cannot enforce read-only, and the adapter SHALL NOT be executed
2. WHEN a run with origin `manual` and mode `read_only` targets such a provider THEN the run SHALL execute and its events SHALL include a `permission` event stating that read-only is only requested in the prompt
3. WHEN a run with origin `routine` and mode `read_only` targets a provider with `enforcesReadOnly: true` THEN the run SHALL execute normally

**Independent test:** uma rotina somente-leitura apontada para o Cursor termina `failed` sem processo.

### S2: Escrita sem confinamento pede um humano (P1)

**Acceptance Criteria**

4. The provider manifests SHALL declare `writeConfinement` `"broker"` for claude, `"sandbox"` for codex and `"none"` for cursor
5. WHILE the profile is `controlled_write`, WHEN a manual write run targets a provider with `writeConfinement: "none"` THEN `gateWrite` SHALL return a pending `write_run` approval and a run in `waiting_approval`
6. WHILE the profile is `controlled_write`, WHEN a manual write run targets a provider with `writeConfinement` `"broker"` or `"sandbox"` THEN `gateWrite` SHALL return no approval
7. WHILE the profile is `approved_automation`, WHEN a manual write run targets a provider with `writeConfinement: "none"` THEN `gateWrite` SHALL return no approval
8. WHEN `POST /api/runs` asks for a Cursor write run under `controlled_write` THEN the API SHALL answer `202` with `status` `"waiting_approval"`

**Independent test:** sob `controlled_write`, uma escrita no Cursor vira aprovação.

### S3: O agente não herda os segredos do MordomoOS (P1)

**Acceptance Criteria**

9. The system SHALL NOT pass to a provider process any environment variable whose name starts with `MORDOMO_`
10. The system SHALL NOT pass to a provider process the variable named by `settings.channels.telegram.botTokenEnv`, also when that name does not start with `MORDOMO_`
11. The system SHALL pass to a provider process `PATH`, `HOME` and other variables of the service (e.g. `ANTHROPIC_API_KEY`) unchanged

**Independent test:** o CLI falso imprime o ambiente que recebeu; nenhum `MORDOMO_*` aparece.

## Out of scope

| Excluded                                          | Why                                                                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Sandbox de sistema operacional para o Cursor      | depende do CLI do Cursor ganhar um modo de sandbox; aqui o motor só deixa de prometer o que o provedor não cumpre |
| Execuções de objetivos como origem sem supervisão | objetivos despacham com origem `manual` hoje; mudar a origem é da feature 5 (contratos de execução)               |
| Ambiente dos processos de conectores MCP          | os conectores já recebem só as variáveis declaradas no registro (`dataMapping.env`)                               |

## Assumptions

| Assumption                                  | Chosen default                                     | Rationale                                                                           | Confirmed? |
| ------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------- |
| Quais origens contam como "sem supervisão"  | `routine` e `sentinel`                             | são as que rodam sem uma pessoa ter clicado; `skill` e `manual` partem de um clique | n          |
| Execução manual somente-leitura no Cursor   | segue, com aviso no rastro                         | recusar quebraria o uso interativo do Cursor; o usuário está olhando a execução     | n          |
| Escrita no Cursor sob `review_before_write` | inalterada (já pede aprovação da execução inteira) | a regra nova só muda o caminho que liberava direto                                  | n          |

**Open questions:** none - all resolved or logged above.

## Observable

| Surface                                 | Decision                    | Landing                                                                  |
| --------------------------------------- | --------------------------- | ------------------------------------------------------------------------ |
| API `POST /api/runs`                    | response shape and codes    | AC 8 - mesmo corpo `202` de `review_before_write`                        |
| API `POST /api/runs`                    | who may call it             | existing - regra de auth da feature 1                                    |
| screen `run trace`                      | error state                 | AC 1 - a execução recusada mostra a mensagem de erro como qualquer falha |
| screen `run trace`                      | warning                     | AC 2 - evento `permission` no rastro                                     |
| command `mordomo run --provider cursor` | what it prints when refused | existing - a CLI já imprime o erro de uma execução `failed`              |

## Sources

- Análise do motor de 06/10/2026 (nesta sessão) - achados S2 (perfis não aplicados) e S3 (ambiente herdado)
- `docs/security.md` - perfis e T6
