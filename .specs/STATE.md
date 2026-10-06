# Project state

## Decisions

| ID     | Decision                                                                                                                                    | Rationale                                                                                        | Status | Date       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------ | ---------- |
| AD-001 | Toda rota sob `/api/` exige credencial, decidida pela rota casada (`req.routeOptions`); só `config: { public: true }` abre uma rota         | a checagem pela URL crua foi contornada com `/%61pi/`; negar por padrão vale para toda rota nova | active | 2026-10-06 |
| AD-002 | O broker de permissão usa uma credencial por execução que nunca aprova; aprovar exige o token do dono                                       | o agente não pode aprovar as próprias ferramentas                                                | active | 2026-10-06 |
| AD-003 | O roteiro em `.specs/roadmap.md` é executado em ordem, uma feature verificada por vez                                                       | as features P1 dependem do core estável e da segurança P0                                        | active | 2026-10-06 |
| AD-004 | Só o processo que chama `engine.start()` (dono de `config/run/engine.lock`) recupera estado e liga timers; montar o motor nunca muda estado | a CLI montava o contexto e recuperava objetivos do servidor vivo                                 | active | 2026-10-06 |

## Handoff

**Feature**: preferencias-ui (construída na worktree `feat/preferencias`, a aplicar e verificar); provedores-plugaveis em construção na worktree `feat/provedores`
**Where**: seguranca-p0, ci-gate, motor-composicao e capacidades-aplicadas verificadas. contratos: 3 rodadas, todas as lacunas fechadas; a 3ª deixou um mutante (import com aspas simples escapando do C16), corrigido pelo autor em `c438d30` e morto por sonda do autor (não por um verificador independente) - escalado ao dono no resumo da sessão
**In progress**: provedores-plugaveis (plano e checks em `4191472`)
**Next step**: aplicar preferencias-ui, verificar; integrar provedores-plugaveis, verificar; depois api-v1
**Blockers**: nenhum até a feature 9 (direção da interface, decisão do dono)
**Uncommitted**: nenhum
**Branch**: chore/tlc-spec-lean-skill
