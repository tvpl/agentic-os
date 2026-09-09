# Execução e navegação — contrato implementado em 07/09

## Submissões

`POST /api/runs` e `POST /api/sessions/:id/continue` aceitam `submissionId` UUID opcional. Clientes anteriores continuam funcionando. O console gera uma identidade por composição (texto, modo, projeto, sessão e provedor), bloqueia dois envios síncronos e guarda a identidade na sessão do navegador até receber sucesso. Uma resposta perdida pode ser consultada reenviando a mesma composição com a mesma identidade.

A migração SQLite 12 acrescenta `prompt_submissions`. Antes de criar sessão/execução, a API reserva a identidade com SHA-256 do payload validado e chaves ordenadas. Repetição idêntica retorna o recibo original, inclusive após reinício; conteúdo diferente recebe 409 `submission_conflict`. A identidade abrange as duas rotas: uma sessão diferente também é outro conteúdo. Não é uma garantia de exatamente uma vez para efeitos externos do provedor.

Uma reserva sem recibo indica interrupção ou falha de gravação depois da reserva. O retorno é 409 `submission_uncertain`; não dispara novamente. O usuário deve consultar Execuções. Erros de validação anteriores ao despacho liberam a reserva. Recibos concluídos não são apagados automaticamente nesta versão, para não converter uma repetição antiga em execução nova. O banco guarda hash e resposta, sem uma segunda cópia do prompt. Backups incluem recibos por incluírem o banco inteiro.

O recibo representa a aceitação original; o estado atual da tarefa é consultado pela rota de execução. Repetir envio não repete aprovação nem cancela tarefa. A falta de sessionStorage reduz a proteção do console após recarga, mas a API continua respeitando a identidade fornecida. `/skill` e submissões por outros clientes ainda dependem de sua própria identidade; não há garantia global de deduplicação de todas as ações do OS.

Reversão: código anterior à migração 12 é incompatível com o banco novo. Usar backup pré-migração em home isolado e verificar antes de substituir dados. Não baixar `user_version` manualmente. A migração automática mantém backup antes de alterar banco existente.

## Tentativas de rotinas

Falha/timeout de uma execução de escrita pode ter efeitos parciais. Novas tentativas automáticas são bloqueadas com registro no histórico, mesmo com `maxAttempts > 1`. Falhas reconhecidas de autenticação, permissão e orçamento também exigem intervenção. Leitura mantém a política limitada existente; a classificação textual é conservadora e não equivale a um contrato estruturado de erro de todos os provedores.

## Segundo Cérebro

Contexto por aba: seleção, filtros e câmera são restaurados ao voltar ao cérebro sem parâmetros explícitos; links explícitos prevalecem. Painéis mantêm abertura/retração independentemente de links. Selecionar outra entidade cria entrada no histórico; ajustes contínuos substituem a entrada corrente. Voltar/avançar atualiza o estado com um único sincronizador, evitando que a renderização anterior sobrescreva a URL recebida. A câmera reenquadra seleção recebida por histórico/link; não existe um snapshot de câmera por entrada de histórico.

Preview usa identidade de requisição e cancelamento lógico na desmontagem. Fechar seleção invalida respostas antigas; não aborta uma leitura que já esteja em execução na API. Enviar fonte ao console continua exigindo revalidação de acesso e revisão do usuário antes da execução.

A implementação não está integralmente aprovada só por este documento; resultados e lacunas devem ser lidos no checkpoint.

## Orçamento sob concorrência — 08/09

A admissão de skills e rotinas agora considera valores gastos **ou reservados**. Uma execução enfileirada/em andamento reserva seu teto inteiro; custo conhecido ao terminar libera a diferença. Se começou e terminou sem informar custo, a reserva permanece conservadoramente até o encerramento do dia. Cancelamento antes de iniciar libera a reserva. Execuções vivas que cruzam a meia-noite continuam reservadas. Métricas de gasto continuam usando somente custos reportados, sem apresentar reserva como cobrança.

A leitura do saldo e a criação/claim são síncronas no processo único proprietário do home. Isso não representa uma transação distribuída nem um teto financeiro garantido no provedor externo: uso reportado pode ultrapassar o limite antes do cancelamento. Tentativas de rotina recalculam o saldo no instante de criar cada tentativa, em vez de reutilizar o teto calculado para a primeira. O comportamento conservador pode recusar outra tarefa enquanto a anterior ainda executa; é preferível a prometer o mesmo saldo duas vezes. Não há previsão de custo inventada para provedores sem telemetria.

## Fechamento de implementação — 09/09

- POSIX usa supervisor de grupo e lease IPC, que recebe a saída do provedor separadamente do sinal usado na limpeza. Perda da API encerra o grupo sem reaproveitar PID persistido. O programa do supervisor é estático e recebe o executável/argumentos separadamente, tanto em desenvolvimento quanto no build. Falha ao iniciar preserva erro de spawn para o chamador. Não é sandbox contra um descendente que crie outra sessão deliberadamente; Windows segue sem essa garantia POSIX.
- Histórico aplica filtros e ordenação globalmente no SQL com desempate por ID e índices da migração 13. A UI solicita um registro excedente para saber se existe próxima página. Execução rápida possui identidade de submissão própria e mantém texto alterado durante o envio.
- Novas notificações possuem código e parâmetros redigidos/limitados; dados autorais não são identificados por comparação com títulos traduzíveis. Eventos persistidos alimentam a caixa ao vivo e na reconexão. Marcação como lida é propagada às outras janelas. Linhas legadas continuam no tradutor de compatibilidade.
- Fonte removida informa a causa sem apagar filtros/câmera. Modais em altura reduzida preservam cabeçalho e ações com scroll. Clipboard confirma somente após sucesso.
