# Relatório final do ciclo

Data: 2026-10-17. Escopo: o roteiro de `roadmap.md` (features 1 a 15, mais S1 a S5) e as features de apoio que apareceram no caminho.

## Resumo

- Todas as features do roteiro foram planejadas, construídas e passaram pelo Verifier independente. Estão integradas na `main` (PR #9 foi o último merge).
- Veredito dos `verification.md`: **5 PASS** e **18 FAIL**. Um FAIL não quer dizer que a feature não funciona. É o resíduo que o Verifier achou e que o ciclo escalou ao dono em vez de decidir sozinho. Os resíduos estão no fim de cada `verification.md`, e as decisões de produto estão em "Perguntas ao dono" no `STATE.md`.
- Decisão de escopo de 17/10/2026: o produto **roda só localmente, sem distribuição**. Tudo o que só serve para distribuir ficou fora do caminho crítico (ver abaixo).

## O que foi entregue

| Fase | Features | Resultado |
| --- | --- | --- |
| P0 segurança | `seguranca-p0`, `seguranca-p1`, `escopos-dispositivo`, `ci-gate` | Autenticação pela rota casada, token só para socket loopback, credenciais fora do argv, `config/` e `logs/` fora da API, dispositivo pareado por allowlist de rotas e por escopos, TLS ou túnel para acesso remoto, CI em push e PR |
| P1 núcleo | `motor-composicao`, `capacidades-aplicadas`, `contratos`, `preferencias-ui`, `provedores-plugaveis`, `api-v1`, `adaptadores-tipados`, `dados-v2`, `sdk-core`, `contratos-rest` | `createEngine()` no core, perfis que exigem capacidade declarada, pacote `@mordomo/contracts`, provedores plugáveis, `/api/v1` com OpenAPI, adaptadores tipados, migração e backup com checksum, SDK do core |
| P2 interface | `moldura-app`, `design-system`, `primitivas`, `comandos-atalhos`, `limpeza-legado`, `conceito-em-todo-sistema` | Segundo shell (moldura), piso de 12px e cores por token, primitivas sobre Radix, registro de comandos e atalhos com escopo, remoção do legado |
| P3 produto | `cerebro-v2`, `distribuicao`, `licenca-comercial` | Notas com backlinks e embeddings, shell Tauri com pipeline de release, minuta de licença FSL |

## Mudança de escopo: uso local (17/10/2026)

Removido do repositório:

- o pacote `MordomoOS-0.8.0-macos-arm64.zip` (37 MB, estava versionado);
- os documentos jurídicos `legal/EULA.md`, `legal/NOTICE.md`, `legal/THIRD_PARTY_NOTICES*.md`, `legal/trademarks.json`, `legal/license-policy.json`, `legal/vendor/` e `legal/README.md`;
- as ferramentas de conformidade de licença e SBOM: `scripts/licenses*.mjs`, `scripts/sbom*.mjs`, `scripts/legal-stage.mjs` e os scripts npm `licenses:*` e `sbom`;
- os testes dessas peças: `legal.docs`, `legal.licenses`, `desktop.licenses` e `release.workflow`;
- os passos de SBOM, avisos e licenças dos workflows `ci.yml` e `release.yml`, o parágrafo de rascunhos jurídicos do README e as menções nos docs.

Mantido de propósito:

- `legal/PRIVACY.md` e `legal/network-policy.json`. O teste `tests/legal.network.test.ts` e o `npm run network:scan` verificam que o código só fala com os destinos declarados e que não há telemetria. Isso vale também para uso local.
- O `LICENSE` (FSL) e o `CONTRIBUTING.md`. Não atrapalham o uso local. Se não quiser nenhum dos dois, dá para apagar numa próxima rodada.
- O shell Tauri (`apps/desktop`), o `release.yml` e `docs/release.md`. Os testes `desktop.release` e `desktop.docs` e vários comentários no código dependem deles. O release só dispara com tag e nunca publica sozinho.

## Pendências do dono, todas só para quando for distribuir

- Segredos de assinatura (Apple Developer ID, certificado Windows) e a chave do atualizador.
- Revisão jurídica: titular do `LICENSE`, PRIVACY e os campos `[A PREENCHER PELO DONO]` que sobraram.
- Publicar `@mordomo/core` e `@mordomo/contracts` no npm, e o escopo `@mordomo`.
- Remover o zip do histórico do git (`git filter-repo` e force-push). O arquivo saiu da árvore, mas continua nos commits antigos.
- Responder "Perguntas ao dono". Os padrões adotados funcionam sem resposta.

## O que nunca foi executado neste ambiente

Windows, macOS, notarização, o workflow de release no GitHub e uma atualização real. Está listado em `docs/release.md` §8.

## Decisões que mudam o uso diário

- Um telefone pareado recebe `monitor`, `content` e `run` por padrão. Aprovar escritas depende do escopo `approve`, e uma escrita pedida pelo telefone espera aprovação humana.
- Acesso remoto por HTTP puro dá `403 tls_required`. Use TLS ou um túnel.
- Backups feitos antes do `dados-v2` só restauram com `mordomo restore <nome> --allow-unverified`.
