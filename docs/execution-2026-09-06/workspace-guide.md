# Usar e recuperar o workspace

O dock inferior abre os aplicativos e pode ser recolhido. Visão geral mostra o layout; Foco amplia o console; Explorar libera o mapa. Os modos não substituem seu layout salvo.

Cada widget oferece ocultar e maximizar. No modo de edição, o catálogo restaura os widgets ocultos, incluindo Agora. O canto redimensiona; Escape restaura uma janela ampliada. “Layouts salvos” guarda configurações nomeadas neste navegador. Se outra janela editar o layout, escolha carregar a versão remota ou salvar a sua: não há mescla automática de posições.

O console preserva rascunho, pasta e sessão ao trocar de app. Se a pasta deixar de estar autorizada, escolha outra explicitamente. “Nova conversa” separa a sessão. Erro de autenticação não executa novamente a tarefa: copie o comando de login indicado em Provedores, autentique no terminal e use “Verificar novamente”. Confira a execução anterior antes de solicitar outra escrita.

Um envio com resultado incerto exige consultar Execuções. A mesma identidade não cria outra tarefa ao reenviar o mesmo conteúdo. Não confunda esse recibo com estado final do agente; consulte a execução vinculada.

No Segundo Cérebro, use os controles de zoom, lista e filtros. O painel recolhe em ícone; `/` reabre a busca. Em desktop amplo, lista e preview coexistem. Seleções entram no histórico do navegador. Ao sair e voltar, o contexto da aba é restaurado; um link explícito tem prioridade. “Usar no console” acrescenta referência ao rascunho e não dispara o agente.

Em Configurações → Aparência, Automático acompanha movimento reduzido do OS; Imersivo mantém os efeitos permitidos; Econômico reduz trabalho visual. Movimento reduzido do OS prevalece. Esses perfis não mudam aprovação, agenda nem entrega de eventos.

## Backup e atualização

Crie backup em Configurações ou com `mordomo backup --include-artifacts` antes de atualizar dados. Sem a opção de artefatos, eles ficam fora do snapshot. Tokens/contas externas não são reautenticados por restore.

Restauração pela interface é preparada e aplicada no próximo início do serviço. Termine ou cancele execuções antes. A restauração valida o banco, cria cópia de segurança, prepara substituições e tenta rollback se a publicação falhar. Se o erro indicar recuperação manual, preserve o diretório `.restore-*` e a cópia de segurança; não apague arquivos para “tentar de novo”.

A migração 12 mantém recibos de submissão. Código anterior que não aceita esse schema exige um backup compatível, ensaiado em home isolado. Não reduza `user_version` manualmente e não faça reset global do projeto: existem alterações locais anteriores a esta revisão.

## Histórico e recuperação

Os filtros de provedor e estado procuram em todo o histórico; cada página mostra até 50 execuções. Ordenar por data reorganiza o conjunto completo. Um envio rápido com resposta de rede perdida conserva a identidade da solicitação para evitar execução repetida quando você tenta novamente com os mesmos dados.

Se uma fonte selecionada desaparecer, o cérebro conserva a câmera e os filtros e oferece atualizar o índice ou fechar a seleção. Avisos novos usam mensagens estruturadas no idioma da interface. A leitura de um aviso é propagada às demais janelas conectadas.

No macOS/Linux, as execuções iniciadas pela nova versão ficam em grupos supervisionados: se a API desaparecer, o supervisor encerra o grupo. Uma execução interrompida continua registrada como interrompida; abrir o histórico não dispara a tarefa novamente. Processos antigos sem esse supervisor não são encerrados apenas por coincidência de PID.
