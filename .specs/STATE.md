# Project state

## Decisions

| ID     | Decision                                                                                                                            | Rationale                                                                                        | Status | Date       |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------ | ---------- |
| AD-001 | Toda rota sob `/api/` exige credencial, decidida pela rota casada (`req.routeOptions`); só `config: { public: true }` abre uma rota | a checagem pela URL crua foi contornada com `/%61pi/`; negar por padrão vale para toda rota nova | active | 2026-10-06 |
| AD-002 | O broker de permissão usa uma credencial por execução que nunca aprova; aprovar exige o token do dono                               | o agente não pode aprovar as próprias ferramentas                                                | active | 2026-10-06 |
| AD-003 | O roteiro em `.specs/roadmap.md` é executado em ordem, uma feature verificada por vez                                               | as features P1 dependem do core estável e da segurança P0                                        | active | 2026-10-06 |

## Handoff

**Feature**: ci-gate
**Where**: seguranca-p0 verificada (rodada 2, PASS, `.specs/features/seguranca-p0/verification.md`); ci-gate com checks escritos, nenhum código
**In progress**: nenhum
**Next step**: construir ci-gate (C1-C3), depois motor-composicao (plano e checks prontos)
**Blockers**: nenhum
**Uncommitted**: nenhum
**Branch**: chore/tlc-spec-lean-skill
