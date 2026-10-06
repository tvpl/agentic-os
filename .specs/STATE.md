# Project state

## Decisions

| ID     | Decision                                                                                                                                    | Rationale                                                                                        | Status | Date       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------ | ---------- |
| AD-001 | Toda rota sob `/api/` exige credencial, decidida pela rota casada (`req.routeOptions`); só `config: { public: true }` abre uma rota         | a checagem pela URL crua foi contornada com `/%61pi/`; negar por padrão vale para toda rota nova | active | 2026-10-06 |
| AD-002 | O broker de permissão usa uma credencial por execução que nunca aprova; aprovar exige o token do dono                                       | o agente não pode aprovar as próprias ferramentas                                                | active | 2026-10-06 |
| AD-003 | O roteiro em `.specs/roadmap.md` é executado em ordem, uma feature verificada por vez                                                       | as features P1 dependem do core estável e da segurança P0                                        | active | 2026-10-06 |
| AD-004 | Só o processo que chama `engine.start()` (dono de `config/run/engine.lock`) recupera estado e liga timers; montar o motor nunca muda estado | a CLI montava o contexto e recuperava objetivos do servidor vivo                                 | active | 2026-10-06 |

## Handoff

**Feature**: motor-composicao
**Where**: C1-C19 fechados, verificação independente pendente
**In progress**: nenhum
**Next step**: verificação da feature 3; depois `capacidades-aplicadas` (feature 4)
**Blockers**: nenhum
**Uncommitted**: nenhum
**Branch**: chore/tlc-spec-lean-skill
