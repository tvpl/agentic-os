# MordomoOS — Guia rápido (pt-BR)

O MordomoOS é o seu sistema operacional agentic local: uma camada única sobre
**Claude Code**, **Cursor Agent** e **OpenAI Codex CLI**, com o framework ARMS
(Applications, Routines, Memory, Skills), um **Command Centre** visual e um
**Segundo Cérebro** pesquisável. Tudo roda na sua máquina, só em `127.0.0.1`.

## Instalação

**App empacotado** (sem Node.js, sem terminal): baixe o arquivo da sua
plataforma, extraia e abra o **MordomoOS** (`MordomoOS.app`, `MordomoOS` ou
`MordomoOS.cmd`). O serviço local inicia e o navegador abre a tela de
configuração, que detecta Claude Code, Cursor Agent e Codex no computador e
mostra como instalar ou fazer login em cada um. Seus dados ficam no seu perfil
de usuário (`~/Library/Application Support/MordomoOS`, `~/.local/share/mordomo-os`
ou `%LOCALAPPDATA%\MordomoOS`). Detalhes por plataforma: [install.md](install.md).

No macOS o app não é notarizado: na primeira abertura use o botão direito →
Abrir → Abrir (ou `xattr -dr com.apple.quarantine MordomoOS.app`).

**A partir do código-fonte** — pré-requisitos: Node.js ≥ 22 e git.

```bash
git clone <este-repo> mordomo-os && cd mordomo-os
scripts/setup.sh        # instala, compila e abre o setup guiado no terminal
npx mordomo launch      # ou: inicia o serviço e abre o navegador (o setup acontece lá)
```

O setup detecta os três provedores (no PATH e nas pastas usuais de instalação),
confirma flags suportadas via `--help`, verifica autenticação **sem nunca
exibir tokens**, deixa você escolher provedores/modelos/esforço, pastas
indexadas, exclusões, nome/tema/porta/idioma e (só com sua aprovação) a
inicialização automática. Pode ser re-executado quantas vezes quiser — nunca
destrói dados.

Para gerar o distribuível você mesmo: `npm run dist` (um único bundle
minificado, sem fontes; veja [install.md](install.md#building-a-distributable)).

## Dia a dia

```bash
mordomo start        # inicia o serviço → http://127.0.0.1:4777
mordomo stop         # para
mordomo status       # estado
mordomo doctor       # diagnóstico completo
mordomo index        # atualiza o índice + routers de memória
mordomo run workspace-digest        # roda uma skill pelo terminal
mordomo backup       # backup completo (mordomo backup --list para listar)
```

No **Command Centre** (o painel web local):

- **Painel** — provedor ativo com seletor rápido Claude/Cursor/Codex, skills
  favoritas com botão Executar, rotinas e próximas execuções, artefatos
  recentes, execuções em andamento, falhas e métricas.
- **Skills** — catálogo canônico; criar, favoritar, executar com
  provedor/modelo/esforço por execução, e **exportar** para os três ambientes
  (CLAUDE.md, AGENTS.md, .claude/, .cursor/, .agents/) com backup e aprovação
  de conflitos por arquivo.
- **Segundo Cérebro** — seu workspace como grafo/grade: busca enquanto digita,
  filtros por área e tipo, prévia segura, caminho copiável, relações explicadas.
- **Rotinas** — agenda cron + timezone, política "computador desligado",
  testar agora, pausar, duplicar, histórico. A rotina de exemplo
  *Daily workspace digest* vem **pausada** — habilite com um clique.
- **Conectores** — auditoria somente leitura (nunca revela credenciais),
  no máximo 3 recomendações; habilitar escrita exige aprovação.
- **Configurações** — idioma **Português/English**, tema escuro/claro, cor,
  porta, pastas, exclusões, perfil de segurança, aprovações pendentes,
  backups e doctor.

## Trocar de provedor

A qualquer momento: pelo seletor no topo do Painel, por execução na tela da
skill, por rotina no formulário da rotina, ou em Configurações → Provedores.
Nada precisa ser reconstruído — Claude, Cursor e Codex são adaptadores sobre a
mesma base.

## Onde ficam meus dados

Tudo em arquivos + SQLite dentro do repositório (`config/`, `skills/`,
`memory/`, `routines/`, `connectors/`, `artifacts/`, `logs/`). Para mover,
defina `MORDOMO_HOME` antes de iniciar. `mordomo uninstall` preserva os dados
por padrão; só `--purge` (com dupla confirmação) remove estado.

Documentação completa (em inglês) em [`docs/`](.); manual do usuário em
[`user-manual.md`](user-manual.md).

## Licença e termos

O MordomoOS é licenciado sob a **Functional Source License 1.1 com licença futura Apache-2.0
(FSL-1.1-ALv2)**: veja o [`LICENSE`](../LICENSE). O código é visível; você pode usá-lo, copiá-lo, modificá-lo e
redistribuí-lo para qualquer fim que não seja um _Competing Use_ (como a licença define), e **cada versão passa
a poder ser usada também sob a Apache License 2.0 na segunda data de aniversário da sua disponibilização**.

- Os textos jurídicos ([EULA](../legal/EULA.md), [privacidade](../legal/PRIVACY.md),
  [NOTICE](../legal/NOTICE.md), [CONTRIBUTING](../CONTRIBUTING.md) e os dados do titular no `LICENSE`) são
  **minutas para revisão do dono, não aconselhamento jurídico**; os pontos em aberto estão marcados com
  `[A PREENCHER PELO DONO: …]`.
- [`legal/THIRD_PARTY_NOTICES.md`](../legal/THIRD_PARTY_NOTICES.md) reúne os componentes de terceiros que o
  instalador leva, cada um com a sua licença.
- O MordomoOS **orquestra** o Claude Code, o Codex e o Cursor Agent e **não os inclui, não os redistribui nem os
  sublicencia**: você os instala, entra com a sua própria conta, e cada um segue os termos do seu fornecedor.
- Seus dados ficam no seu computador, o MordomoOS não envia nada a servidores do licenciante e **não tem
  telemetria**; a lista de tudo que pode sair da máquina está na [política de privacidade](../legal/PRIVACY.md).
