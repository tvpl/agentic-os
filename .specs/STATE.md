# Project state

## Decisions

| ID     | Decision                                                                                                                                    | Rationale                                                                                        | Status | Date       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------ | ---------- |
| AD-001 | Toda rota sob `/api/` exige credencial, decidida pela rota casada (`req.routeOptions`); só `config: { public: true }` abre uma rota         | a checagem pela URL crua foi contornada com `/%61pi/`; negar por padrão vale para toda rota nova | active | 2026-10-06 |
| AD-002 | O broker de permissão usa uma credencial por execução que nunca aprova; aprovar exige o token do dono                                       | o agente não pode aprovar as próprias ferramentas                                                | active | 2026-10-06 |
| AD-003 | O roteiro em `.specs/roadmap.md` é executado em ordem, uma feature verificada por vez                                                       | as features P1 dependem do core estável e da segurança P0                                        | active | 2026-10-06 |
| AD-004 | Só o processo que chama `engine.start()` (dono de `config/run/engine.lock`) recupera estado e liga timers; montar o motor nunca muda estado | a CLI montava o contexto e recuperava objetivos do servidor vivo                                 | active | 2026-10-06 |

## Handoff

**Feature**: contratos (verificação independente pendente); próxima: preferencias-ui (plano e checks prontos)
**Where**: seguranca-p0, ci-gate, motor-composicao e capacidades-aplicadas verificadas; contratos commitada em `19df6a7`
**In progress**: nenhum
**Next step**: veredito de contratos; construir preferencias-ui; depois provedores-plugaveis
**Blockers**: nenhum até a feature 9 (direção da interface, decisão do dono)
**Uncommitted**: nenhum
**Branch**: chore/tlc-spec-lean-skill
