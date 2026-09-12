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
