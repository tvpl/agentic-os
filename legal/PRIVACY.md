# MordomoOS — Política de Privacidade

> **MINUTA para revisão do dono. Não é aconselhamento jurídico.** Quem escreveu este texto não é
> advogado e ninguém com formação em direito o revisou: ele descreve o que o código faz hoje (conferido
> por `node scripts/network-scan.mjs --check`, que reprova um destino de rede que este texto não
> cita) e deixa em `[A PREENCHER PELO DONO: …]` o que depende do dono. A lista está em
> `.specs/STATE.md`, item "revisão jurídica do dono". Não publique um instalador com este texto antes da revisão.

Versão da minuta: 11/10/2026 · vale para o MordomoOS 0.8.0 em diante

## 1. Em cinco linhas

1. Seus dados ficam no seu computador, em arquivos e num banco SQLite.
2. O MordomoOS **não envia nada a servidores do licenciante**: não há conta, cadastro, servidor nem
   serviço nosso a que ele se conecte.
3. **Nenhuma telemetria.** Nem de uso, nem de erros, nem anônima.
4. O que sai do seu computador sai porque você configurou (Telegram, push, webhook, registro de skills,
   conector, verificação de versão) ou porque os CLIs que você escolheu (Claude Code, Codex, Cursor Agent)
   falam com o provedor deles. A seção 4 lista todos.
5. Você controla cada um desses destinos nas Configurações (ou em `config/settings.json`), e a maioria vem desligada.

## 2. Quem responde por este texto

Licenciante: `[A PREENCHER PELO DONO: titular dos direitos autorais]`, documento
`[A PREENCHER PELO DONO: documento do titular (CNPJ ou CPF)]`, endereço
`[A PREENCHER PELO DONO: endereço do titular]`. Contato de privacidade:
`[A PREENCHER PELO DONO: e-mail de contato jurídico e de privacidade]`.
`[A PREENCHER PELO DONO: encarregado pelo tratamento de dados (LGPD), se aplicável]`

Como o licenciante não recebe seus dados, ele não os trata na operação normal do Aplicativo. Quem escrever
ao suporte entrega o que escrever: `[A PREENCHER PELO DONO: o que o suporte guarda, por quanto tempo e com que base legal]`.

## 3. O que fica no seu computador

Tudo mora numa pasta só, a "casa" do MordomoOS:

| Como você usa                  | Onde fica a casa                                                           |
| ------------------------------ | -------------------------------------------------------------------------- |
| Aplicativo instalado, macOS    | `~/Library/Application Support/MordomoOS`                                  |
| Aplicativo instalado, Linux    | `$XDG_DATA_HOME/mordomo-os` (por padrão `~/.local/share/mordomo-os`)       |
| Aplicativo instalado, Windows  | `%LOCALAPPDATA%\MordomoOS`                                                 |
| A partir do código-fonte       | a própria pasta do repositório                                             |
| Qualquer um, por sua escolha   | a pasta que você indicar em `MORDOMO_HOME`                                 |

Lá estão suas configurações, o banco SQLite (execuções, conversas, aprovações, avisos, memória indexada),
os registros (`logs/`), suas skills, rotinas, conectores e artefatos, as cópias de segurança e o token
local (`config/token`) que protege o serviço. Em sistemas POSIX as pastas e arquivos sensíveis são criados
só para o seu usuário (`0700` e `0600`); no Windows valem as permissões da pasta (`docs/security.md`, T13).
O serviço escuta só em `127.0.0.1`. O acesso remoto é opcional, vem desligado e exige TLS ou um túnel.

Os registros passam por uma redação de segredos reconhecíveis (chaves de API, tokens, senhas em
`chave=valor`), que reduz o risco e não o elimina: não trate `logs/` como livre de segredos.

`mordomo uninstall` para o serviço e **preserva** os dados; `mordomo uninstall --purge` apaga o estado.
`mordomo backup` copia a casa para dentro dela mesma (`config/backups/`). Apagar a casa apaga tudo que o
MordomoOS guardou; ele não mantém cópia em outro lugar.

## 4. O que sai do seu computador

Esta é a lista inteira dos destinos de rede que o código do MordomoOS conhece. Cada linha vem de
`legal/network-policy.json`, que um teste compara com o código a cada mudança.
Nas tabelas, "o dono" é a pessoa que instalou e administra o MordomoOS (você), e não o licenciante.

### 4.1. Destinos a que o MordomoOS se conecta

| Destino | Endereços | Quando | Padrão | O que é enviado |
| --- | --- | --- | --- | --- |
| O próprio serviço (127.0.0.1) | (nenhum endereço fixo) | sempre: a interface, o CLI `mordomo`, o broker de permissão e o MCP do Mordomo falam com o serviço em 127.0.0.1 | ligado | tudo que o produto faz; não sai da máquina (o acesso remoto é opcional, exige TLS ou túnel e vem desligado) |
| Verificação de versão (api.github.com) | `api.github.com` | só quando `updates.check` está ligado ou quando o dono pede "Verificar agora" (`GET /api/updates?force=1`) | desligado | um GET anônimo a /repos/tvpl/agentic-os/releases/latest com o cabeçalho `user-agent: mordomo-os` (o nome do produto, sem versão); nenhum identificador da instalação, da máquina ou da pessoa; o GitHub vê o endereço IP; a resposta fica em cache por seis horas |
| Canal Telegram (api.telegram.org) | `api.telegram.org` | só com `channels.telegram.enabled`, um token de bot numa variável de ambiente e um `chatId`; receber respostas (`getUpdates`) exige também `channels.telegram.inbound` | desligado | o texto dos avisos do inbox acima do tom mínimo (título e corpo), os botões de aprovação e as respostas de quem escreve no chat; o token do bot vai na URL, como a API do Telegram exige |
| Notificações push dos navegadores (fcm.googleapis.com e outros) | `fcm.googleapis.com`, `android.googleapis.com`, `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com` | só com `channels.push.enabled` ligado e depois que o dono, ou um dispositivo pareado com o escopo `content`, assina notificações num navegador; o serviço então envia cada aviso ao endereço da assinatura, e resolve o nome desse endereço no DNS do sistema antes de cada envio | desligado; sem assinatura, nada é enviado | o aviso (título e corpo) cifrado de ponta a ponta (RFC 8291, chave do navegador que assinou), com uma credencial VAPID assinada que leva o campo `channels.push.subject` (por padrão `mailto:mordomo@localhost`; se o dono puser um e-mail seu ali, o serviço de push o vê); o serviço do navegador vê o endereço da assinatura, o tamanho e o horário, não o texto |
| Servidor de push escolhido pelo dono | (o endereço que você escreve) | só com `channels.push.enabled` ligado e quando o dono (nunca um dispositivo) registra uma assinatura cujo endereço é um servidor https público dele | nenhum | o mesmo aviso cifrado das notificações push; o endereço é validado (https, porta padrão, só endereços públicos) a cada envio |
| Webhook de rotina (endereço do dono) | (o endereço que você escreve) | só com `routines.allowWebhooks` ligado e uma rotina com entrega por webhook; o endereço é o que o dono escreveu na rotina | desligado | POST com o id e o nome da rotina, o id e o status da execução, a duração, os artefatos, o horário e um resumo de até 4000 caracteres com segredos reconhecíveis redigidos |
| Registro de skills (endereço do dono) | (o endereço que você escreve) | só quando o dono adiciona um registro em `marketplace.registries` e abre o marketplace ou instala uma skill; https obrigatório (ou uma pasta local `file://`) | nenhum registro | GETs do índice e dos arquivos da skill, sem corpo e sem redirecionamento; o servidor do registro vê o endereço IP e os caminhos pedidos |
| Conector de dados por API (endereço do dono) | (o endereço que você escreve) | só com um conector de dados do tipo API configurado pelo dono (`dataMapping.url`, http ou https) e sincronizado | nenhum conector configurado | GET com os cabeçalhos que o dono escreveu (podem trazer um token lido de variável de ambiente), sem redirecionamento |
| Conectores MCP de terceiros (Gmail, Google Calendar, Playwright…) | (nenhum endereço fixo) | só com um conector do tipo MCP configurado pelo dono e o comando dele em `settings.connectors.allowedCommands`; o MordomoOS inicia esse programa de terceiros ao sincronizar (os embutidos de Gmail e Google Calendar o fazem por `npx -y`, que primeiro baixa o pacote: ver "Registro do npm") e este fala com o serviço dele (Google, por exemplo) | nenhum conector vem configurado | o que o programa do conector enviar ao serviço dele, sob os termos desse serviço; o MordomoOS recebe o resultado e o guarda na casa |
| Registro do npm (auditoria do doctor e npx dos conectores) | (nenhum endereço fixo) | (1) `mordomo doctor` (e a rota `GET /api/doctor` para o dono) roda `npm audit` quando o CLI do npm está ao lado do Node e a pasta de dados tem `package-lock.json`; o instalador, que leva só o binário do Node, pula o item. (2) Os conectores embutidos de Gmail e Google Calendar usam o comando `npx -y <pacote>`: se o dono os configurar e o MordomoOS os iniciar, o npm baixa o pacote do conector do registro do npm (`registry.npmjs.org`, por padrão) a cada uso, sem cache garantido | (1) ligado ao pedir o diagnóstico, exceto com MORDOMO_SKIP_NPM_AUDIT=1; (2) nenhum conector vem configurado | (1) o npm envia nomes e versões das dependências ao registro configurado nele; (2) o nome do pacote do conector. O MordomoOS não envia nada além disso; o que o pacote baixado faz depois está em "Conectores MCP de terceiros" |
| Provedores dos CLIs (Claude Code, Codex, Cursor Agent) | (nenhum endereço fixo) | toda execução: o MordomoOS inicia o CLI que o usuário escolheu e este fala com o servidor do provedor dele, com a conta do usuário | ligado, por definição do produto | o prompt e os arquivos da pasta da execução, sob os termos e a política de privacidade do provedor, não desta; o MordomoOS não lê nem grava o conteúdo das credenciais do provedor (só verifica se o login do CLI ou a variável ANTHROPIC_API_KEY / OPENAI_API_KEY existe), mas o ambiente do processo dele, essas variáveis inclusive, é repassado ao CLI que ele inicia |

### 4.2. Endereços que aparecem sem o MordomoOS se conectar a eles

| Destino | Endereços | Quando | Padrão | O que é enviado |
| --- | --- | --- | --- | --- |
| Links do GitHub mostrados ao usuário (github.com) | `github.com` | a página de releases e as páginas de origem dos conectores (campo `origin` de connectors/*.json) são mostradas como link; quem decide abri-las é a pessoa, no navegador | nunca acessado pelo produto | nada: o produto não abre conexão para esses endereços |
| Comando de instalação do Cursor (cursor.com) | `cursor.com` | o endereço `https://cursor.com/install` aparece como instrução na tela de configuração; o produto não o executa | nunca acessado pelo produto | nada: o produto não abre conexão para esse endereço |
| Documentação citada em skills embutidas (code.claude.com) | `code.claude.com` | a skill embutida `claude-mobile-optimize` cita páginas da documentação do Claude Code no texto de suas instruções; quem as abriria seria o agente (o CLI) ou a pessoa, nunca o código do MordomoOS | nunca acessado pelo MordomoOS | nada: o MordomoOS não abre conexão para esse endereço |
| Download do Node.js ao gerar o instalador (nodejs.org) | `nodejs.org` | só na máquina de quem gera o instalador (`npm run dist`, `scripts/package.mjs`, e a mensagem de `scripts/setup.sh`): baixa o binário oficial do Node.js e confere o SHA-256; ao empacotar para outra plataforma, o `prebuild-install` baixa o módulo nativo do SQLite do GitHub | nunca roda no computador de quem usa o produto | um GET do binário e da lista de somas; nada do usuário |

## 5. Os CLIs e os provedores de IA

Quando você manda o MordomoOS executar algo, ele inicia o CLI que você escolheu (Claude Code, Codex ou
Cursor Agent) com o seu prompt e a pasta de trabalho da execução. **Quem fala com o provedor é o CLI**,
com a sua conta: o prompt, os arquivos que o CLI ler e o resultado passam pelo servidor do provedor, sob
os termos e a política de privacidade **dele**, não desta. Leia-os antes de usar um CLI com dados que não
podem sair do seu computador. O MordomoOS não lê nem grava o conteúdo das suas credenciais do provedor, mas o ambiente do processo dele (inclusive `ANTHROPIC_API_KEY` e `OPENAI_API_KEY`, se você as definiu) é repassado ao CLI que ele inicia. Os perfis de segurança e
as aprovações do MordomoOS limitam o que o agente pode fazer no seu computador, não o que o provedor faz
com o que recebe.

## 6. Telemetria

**Nenhuma.** O MordomoOS não tem telemetria de uso, de erros nem de desempenho; não inclui biblioteca de
análise ou de relato de falhas; e não envia identificador de instalação, de máquina ou de pessoa. Os únicos
destinos que o produto contata sem você ter configurado um canal, um endereço ou uma assinatura são a
verificação de versão (desligada por padrão e sem identificador) e a auditoria `npm audit` do diagnóstico
(só ao pedir o diagnóstico, e só se o npm estiver ao lado do Node); ambos estão na seção 4.1.

Isto é conferido por testes (`tests/legal.network.test.ts`): nenhuma dependência de telemetria no
`package-lock.json`, nenhum ponto de rede **reconhecido pela varredura** que não esteja na lista acima e
nenhuma configuração com `telemetry`, `analytics` ou `crash` no nome.

**O que a varredura não vê** (limites, ditos para ninguém tomar o teste por mais do que ele é):

- um endereço montado em tempo de execução (concatenação, variável de ambiente, o que o dono escreve numa
  configuração) não é literal no código; a varredura conta o ponto de rede (`fetch` e semelhantes), e é por isso
  que os destinos "do dono" estão nas tabelas sem endereço fixo;
- código fora das pastas que ela lê (testes, `.github`, `docs`, `node_modules`) e o que um CLI ou um programa de
  conector de terceiros faz por conta própria; o código de terceiros que o instalador leva (React, Fastify…) não
  é varrido, só conferido contra a lista de pacotes de telemetria;
- `eval`, `new Function`, um programa escolhido por variável, e texto em prosa que manda um agente acessar um
  endereço (só URLs e `curl`/`wget` em prosa são lidos);
- um `curl` ou `wget` só é lido quando a cadeia dada a `exec`, `spawn` e semelhantes **começa** por ele
  (`exec("curl -s https://…")`); no meio de uma cadeia composta (`cd x && curl …`, `sh -c "… | curl …"`) não é;
- `Reflect.get(globalThis, "fetch")` e `globalThis["fetch"]` são lidos, mas o objeto global com outro nome
  (`const g = globalThis`, depois `g.fetch(…)`) não é;
- um endereço escrito sem esquema só é lido quando a cadeia começa por `//` (`"//host/arquivo.js"`) ou, num
  arquivo de texto, vem logo depois de aspas, de `(` ou de `=`; montado por partes, ou numa constante cujo nome
  não diz que é um endereço e cujo domínio de topo não está na lista conhecida da varredura, não é.

**Se um dia houver telemetria**, ela será: opt-in e desligada por padrão; mínima, sem identificador pessoal
nem conteúdo de prompts, arquivos ou memória; com uma tela de consentimento que mostra exatamente o que seria
enviado; documentada aqui antes de existir; e entrará no mesmo commit que atualiza a lista da seção 4 e o
teste que a vigia. `[A PREENCHER PELO DONO: o dono quer, algum dia, telemetria opt-in? O padrão adotado é não implementar.]`

## 7. Seus controles

| Quero…                                     | Faço…                                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Que o MordomoOS não contate endereço algum por conta própria | deixo desligados Telegram, push, webhooks, registros e a verificação de versão (padrão), e uso `MORDOMO_SKIP_NPM_AUDIT=1` no diagnóstico |
| Ver o que o Aplicativo guarda              | abro a casa (seção 3); tudo é arquivo ou SQLite                                           |
| Apagar tudo                                | `mordomo uninstall --purge`, ou apago a casa                                              |
| Saber o que um CLI manda ao provedor       | leio os termos do provedor; o MordomoOS não intermedia                                    |

## 8. Crianças, dados pessoais de terceiros e transferência internacional

`[A PREENCHER PELO DONO: o advogado deve dizer se são necessárias cláusulas sobre crianças, sobre a LGPD e sobre transferência internacional de dados (os provedores dos CLIs e os serviços da seção 4 ficam fora do país), dado que o licenciante não recebe os dados]`

## 9. Mudanças desta política

Uma versão nova do Aplicativo que acrescentar um destino de rede só passa nos testes com este texto e
`legal/network-policy.json` atualizados no mesmo commit. O atualizador assinado previsto para o instalador
(feature `distribuicao`) é o próximo destino conhecido: esta política mudará antes de ele existir.
`[A PREENCHER PELO DONO: como e com que antecedência os usuários são avisados de uma mudança]`

## 10. O que falta ao dono

Todas as marcações `[A PREENCHER PELO DONO: …]` acima e a revisão por advogado. A lista completa está em
`.specs/STATE.md`, "Perguntas ao dono", "licenca-comercial".
