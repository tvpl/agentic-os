# Revisão de produto e gauntlet — 6 de setembro de 2026

## Problemas corrigidos

| Evidência | Causa | Correção |
| --- | --- | --- |
| Links alteravam o hash mas mantinham o desktop | `useGridMetrics` retornava um objeto novo em cada render; `WidgetLayer` o reportava ao pai, que renderizava novamente. Atualizações concorrentes de navegação ficavam sem concluir | Métricas memoizadas; navegação urgente, animações visuais separadas. Regressão verifica que a realimentação se estabiliza |
| Fazer, microapps, launcher e notificações pareciam inertes | Compartilhavam o fluxo de navegação afetado | Testes verificam conteúdo de destino utilizável, não apenas URL |
| “Agora” bloqueava o mapa e não podia ser ocultado | Painel absoluto fora do registro de widgets | Widget gerenciável, ocultação persistida, restauração pelo catálogo e controles de janela |
| Console cortado | Altura 100% somada ao cabeçalho; conteúdo ancorado ao fim de grid podia ficar inacessível | Coluna flexível com rolagem e cabeçalho fixo; maximizar/restaurar sem perder rascunho; resize acessível fora do modo de edição |
| Falha OAuth sem orientação | Erro bruto sem ação de recuperação | Detecção de falhas de autenticação, comando específico e acesso aos provedores. Sem repetir execuções automaticamente |
| Notificações antigas em inglês | Texto do servidor persistido em inglês | Tradução dos templates legados conhecidos na apresentação, preservando nomes, prompts e comandos |
| Segundo Cérebro difícil de explorar | Navegação impedia acesso; painel lateral sempre ocupava espaço | Zoom existente agora acessível e testado; painel retrátil em ícone, busca por teclado reabre controles |
| Preview de artefatos falhava no macOS | Uma segunda checagem comparava raiz lexical `/var` com caminho real `/private/var` após uma validação segura | Usa a validação canônica já realizada; testes mantêm bloqueio a traversal e caminhos externos |
| Rotinas apareciam como serviço de outra instalação | Probe verificava apenas existência do launch agent/systemd do usuário | Verifica também o home do OS na definição do serviço |
| Histórico às vezes invertia sessões | Empate de timestamps sem critério de desempate | Ordenação por inserção após última atividade/criação; teste força empate no mesmo milissegundo |

Os testes E2E agora usam porta 4788 e home isolado. Não reutilizam silenciosamente o serviço pessoal da porta 4777. Alterações locais anteriores foram preservadas.

## Experiência imersiva e personalização

- Dock persistente entre apps, com ícones, identificação do destino, tooltips, foco por teclado e opção de recolher.
- Modos **Visão geral**, **Foco** e **Explorar**. Foco amplia o console; Explorar libera o mapa e oferece entrada para o Segundo Cérebro. O modo persiste entre recargas sem sobrescrever a geometria dos widgets. O mapa usa a área liberada pelas janelas ocultas, com espaço reservado para a introdução.
- Rascunho do console preservado na sessão do navegador, inclusive ao sair para outro app e recarregar. Nova altura padrão acomoda melhor os controles; layouts personalizados existentes são preservados.
- Área reservada para o dock nas janelas ampliadas e nos controles do grafo. Em telas estreitas permanece a navegação mobile e o empilhamento de widgets.
- Segundo Cérebro com indicador percentual de zoom, painel recolhível, filtros e layouts acessíveis sem sobreposição do dock.
- Cards com bordas, espaçamento e controles uniformes; textura menos intensa, hover e transições curtas respeitando preferência de movimento reduzido.

Validação funcional adicional: Pixel Studio desenha/desfaz, adiciona frame, exporta PNG, salva e abre a imagem no catálogo. Rotina é criada, editada, habilitada, executada, consultada no histórico e excluída. O launcher é exercitado por cliques nos oito aplicativos. Esses cenários usam dados isolados e o adaptador de teste, sem alterar rotinas pessoais.

## Referências de produto

Consulta aos repositórios públicos em 06/09/2026; estrelas são valores aproximados exibidos pelo GitHub, não uma medida de qualidade garantida. Comparação documental, sem instalar ou executar os concorrentes.

| Projeto | Estrelas observadas | Diferencial documentado | Aplicação ao MordomoOS |
| --- | --- | --- | --- |
| [OpenHands](https://github.com/OpenHands/OpenHands) | 86,3 mil | Controle de agentes com backends locais/remotos e automações; múltiplos agentes compatíveis com ACP | Tornar o destino/estado de execução explícito e confiável. A identificação incorreta do serviço foi corrigida; uma abstração ACP seria evolução separada |
| [Open WebUI](https://github.com/open-webui/open-webui) | 151,1 mil | Memória, artefatos persistentes, fluxos visíveis, mensagens em fila e OpenTelemetry | Priorizar observabilidade e continuidade. Nesta revisão: histórico determinístico, recuperação de autenticação e previews funcionais. Fila de mensagens do console e tracing distribuído continuam oportunidades |
| [Agent Zero](https://github.com/agent0ai/agent-zero) | 19,1 mil | Desktop Linux em contêiner, Canvas, projetos isolados e ponte para a máquina local | Separar imersão visual de execução real de aplicativos. O Mordomo tem microapps próprios; não equivale a um desktop Linux controlável. Contêineres seriam decisão arquitetural adicional |

A inferência de produto é priorizar confiabilidade, recuperação e controle do espaço antes de ampliar efeitos visuais. O grafo, a animação de navegação, as janelas ampliáveis e os controles retráteis reforçam a experiência imersiva usando recursos já presentes.

## Skills entregues

- `skills/claude-mobile-optimize`: diagnóstico com RSS/CPU e duração; distingue Claude/contexto de Metro, Watchman, Gradle, Xcode, Dart e simuladores. Ajustes medidos, reversíveis e limitados ao projeto.
- `skills/gauntlet-loop`: critérios para SDD ou prompt comum; revisão/correção/validação com evidência, gates proporcionais e limite de repetição improdutiva.
- Cópias prontas para descoberta global em `~/.claude/skills/claude-mobile-optimize` e `~/.claude/skills/gauntlet-loop`, com metadados mínimos compatíveis. Invoke `/claude-mobile-optimize` ou `/gauntlet-loop` em uma sessão do Claude Code.

Fontes oficiais para as convenções: [skills](https://code.claude.com/docs/en/skills), [memória](https://code.claude.com/docs/en/memory) e [autenticação da CLI](https://code.claude.com/docs/en/cli-usage). Nenhum ganho de RAM foi alegado sem medição de um projeto mobile real.

## Limites e próximos critérios

A autenticação real do Claude depende da sua conta: o OS agora orienta `claude auth login`, mas não pode renovar uma sessão sem sua participação. Conectores externos continuam dependendo de configuração/credenciais válidas. Os testes automatizados usam CLI falso e não demonstram uma chamada real paga ao provedor.

A revisão não substitui teste prolongado sob carga nem garante ausência de bugs. Há oportunidades adicionais: fila de prompts, diagnóstico de recursos visível no desktop, traduções estruturadas no banco (em vez de compatibilidade com templates legados), execução isolada por contêiner e recuperação integrada de login. Nenhuma dessas capacidades deve ser anunciada como implementada.

## Evidências finais

- Build de produção e typecheck aprovados; ESLint e `git diff --check` sem erros.
- Motor/API: **43 arquivos, 399 testes aprovados**. A suíte exige portas/processos locais de teste; após liberar essas operações, os defeitos de caminhos, ownership de serviço e desempate foram reproduzidos e corrigidos sem enfraquecer os critérios.
- UI: **33 arquivos, 196 testes aprovados**, incluindo estabilidade das métricas, tradução de notificações e classificação de autenticação.
- Navegador: **32 cenários aprovados** na passagem completa de smoke, fluxos do motor, regressões dos prints e fluxos de produto. Após o ajuste final do enquadramento, os **4 cenários de produto** foram repetidos e aprovados. CLI/conta externa simulados. Axe executado nos sete destinos cobertos pela suíte existente; essa suíte exclui a regra de contraste, portanto não equivale a certificação completa de acessibilidade.
- Capturas em `artifacts/qa-workspace-{overview,focus,explore,brain}.png` e `artifacts/qa-console.png`. Capturas com animações CSS concluídas para evitar avaliar um frame intermediário; fixture em inglês, com teste específico em pt-BR.
- Durante a passagem ampliada, reconstruir o bundle com o servidor de testes em uso causou uma resposta HTTP de erro transitória. As etapas foram separadas; o smoke agora exige HTTP válido e shell visível antes de auditar a página.
- Validador de skills aprovado para as duas cópias globais do Claude Code.
- Serviço pessoal reiniciado após verificar ausência de execuções ativas; o launch agent retomou o serviço automaticamente na porta 4777.

Para conferir: recarregue o OS. O dock inferior alterna apps e os modos Visão geral/Foco/Explorar; a seta recolhe o dock. Cada cabeçalho de widget oferece maximizar e ocultar; `Esc` restaura o tamanho. O canto inferior permite redimensionar. No modo de edição, o catálogo restaura widgets ocultos, incluindo “Agora”. No Segundo Cérebro, use os botões de zoom e o ícone do painel para recolher os controles; `/` reabre a busca.

Para reverter código, restaure somente os hunks desta revisão; havia alterações locais anteriores e não se deve usar um reset global. As skills globais são diretórios independentes. Layouts do usuário continuam em settings; maximizar é temporário e não sobrescreve a geometria persistida.
