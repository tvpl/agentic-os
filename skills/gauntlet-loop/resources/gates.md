# Gates proporcionais

| Mudança | Evidência necessária |
| --- | --- |
| Correção visual | Inspeção renderizada, overflow, clique/teclado e contraste/foco nos elementos afetados; movimento reduzido |
| Navegação | Abrir a partir da origem real, confirmar conteúdo visível e utilizável, voltar e repetir sem recarregar |
| API/engine | Contrato, entrada inválida, erro de dependência, cancelamento e limpeza; teste de integração com dados isolados |
| Persistência | Salvar/reabrir, migração relevante, escrita inválida e preservação de dados anteriores |
| Auth | Credencial ausente/expirada representada por fixture; instrução de recuperação. Nunca usar segredos reais em snapshots |
| Scheduler | Fuso, próximo disparo, execução em andamento, reinício e deduplicação; relógio controlado quando possível |
| Mobile/performance | Mesmo cenário antes/depois, RSS e duração com unidades, build relevante; distinguir cache frio/quente |
| Skills | Metadados válidos, referências existentes e cenário realista incluindo falha/limite do loop |

Formato mínimo de registro: critério → reprodução → resultado inicial → correção → comando/ação → resultado final. Uma suíte não substitui teste manual de funcionalidades que ela não cobre. Não declare “zero bugs”.
