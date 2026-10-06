# Project state

## Decisions

| ID     | Decision                                                                                                                            | Rationale                                                                                        | Status | Date       |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------ | ---------- |
| AD-001 | Toda rota sob `/api/` exige credencial, decidida pela rota casada (`req.routeOptions`); só `config: { public: true }` abre uma rota | a checagem pela URL crua foi contornada com `/%61pi/`; negar por padrão vale para toda rota nova | active | 2026-10-06 |
| AD-002 | O broker de permissão usa uma credencial por execução que nunca aprova; aprovar exige o token do dono                               | o agente não pode aprovar as próprias ferramentas                                                | active | 2026-10-06 |
| AD-003 | O roteiro em `.specs/roadmap.md` é executado em ordem, uma feature verificada por vez                                               | as features P1 dependem do core estável e da segurança P0                                        | active | 2026-10-06 |

## Handoff

**Feature**: seguranca-p0
**Where**: plan.md escrito, aguardando revisão do dono
**In progress**: nenhum código
**Next step**: aprovação do plano → `checks.md`
**Blockers**: revisão humana do plano
**Uncommitted**: `.specs/`
**Branch**: chore/tlc-spec-lean-skill
