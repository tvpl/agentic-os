# MordomoOS — Contrato de Licença de Uso do Aplicativo (EULA)

> **MINUTA para revisão do dono. Não é aconselhamento jurídico.** Quem escreveu este texto não é
> advogado e ninguém com formação em direito o revisou: ele descreve o que o produto é e faz hoje, e
> propõe a forma de um contrato. Tudo que depende de decisão ou de dado do dono está em
> `[A PREENCHER PELO DONO: …]` e listado em `.specs/STATE.md`, item "revisão jurídica do dono". Não
> publique um instalador com este texto antes da revisão.

Versão da minuta: 11/10/2026 · vale para o MordomoOS 0.8.0 em diante

## 1. Objeto e relação com a licença do código

1.1. Este contrato trata do **aplicativo MordomoOS distribuído em instalador** (o "Aplicativo"), do
suporte e das atualizações a ele ligados, e da relação dele com programas de terceiros.

1.2. O código-fonte do MordomoOS, e o Aplicativo que o contém, é licenciado sob a **Functional Source
License, Version 1.1, ALv2 Future License (FSL-1.1-ALv2)**, cujo texto está no arquivo `LICENSE`. Em tudo
que diz respeito ao que se pode fazer com o software, **prevalece o `LICENSE`**. Este contrato não restringe
nada que o `LICENSE` permite. Sobre a conversão para a Apache License 2.0, o `LICENSE` diz (citação literal):

> FSL: We hereby irrevocably grant you an additional license to use the Software under the Apache License, Version 2.0 that is effective on the second anniversary of the date we make the Software available.

`[A PREENCHER PELO DONO: confirmar com o advogado qual texto prevalece e se o contrato pode ser mais restritivo que o FSL]`

1.3. O titular dos direitos e licenciante é `[A PREENCHER PELO DONO: titular dos direitos autorais]`,
inscrito sob o documento `[A PREENCHER PELO DONO: documento do titular (CNPJ ou CPF)]`, com endereço em
`[A PREENCHER PELO DONO: endereço do titular]`. Contato jurídico e de privacidade:
`[A PREENCHER PELO DONO: e-mail de contato jurídico e de privacidade]`.

## 2. O que se pode fazer e o que não

Neste contrato, cada trecho marcado **FSL** é uma citação literal do `LICENSE` (em inglês, linha por linha,
conferida por teste contra o arquivo); cada trecho marcado **Termo adicional** é do EULA e **não está no
`LICENSE`**: é proposta do redator, a revisar pelo advogado.

2.1. **O que o `LICENSE` diz sobre o uso permitido** (citação literal):

> FSL: A Permitted Purpose is any purpose other than a Competing Use. A Competing Use means making the Software available to others in a commercial product or service that:
> FSL: 1. substitutes for the Software;
> FSL: 2. substitutes for any other product or service we offer using the Software that exists as of the date we make the Software available; or
> FSL: 3. offers the same or substantially similar functionality as the Software.
> FSL: Permitted Purposes specifically include using the Software:
> FSL: 1. for your internal use and access;
> FSL: 2. for non-commercial education;
> FSL: 3. for non-commercial research; and
> FSL: 4. in connection with professional services that you provide to a licensee using the Software in accordance with these Terms and Conditions.

2.2. **Em português, só para leitura (resumo, não literal; se divergir do `LICENSE`, vale o `LICENSE`):** pode-se
usar o Aplicativo para qualquer finalidade que não seja um _Competing Use_, isto é, disponibilizar a terceiros,
em produto ou serviço comercial, algo que substitui o MordomoOS, que substitui outro produto ou serviço do
licenciante que use o MordomoOS **e que já exista na data em que a versão foi disponibilizada**, ou que oferece a
mesma funcionalidade ou uma substancialmente parecida. São expressamente permitidos o uso interno, a educação e a
pesquisa não comerciais e a prestação de serviços profissionais a quem tem o software licenciado.

2.3. **Termo adicional (a revisar):** quem precisa de um uso que o `LICENSE` não permite (um _Competing Use_)
precisa de uma licença comercial separada, fora desta minuta:
`[A PREENCHER PELO DONO: licença comercial para uso concorrente, se o dono quiser oferecê-la]`. Modelo de
venda, preço e forma de pagamento do Aplicativo:
`[A PREENCHER PELO DONO: preço e modelo de venda (por usuário, por máquina, assinatura)]`. O Aplicativo não tem
hoje chave de licença, ativação nem verificação online de licença: o código não contém nenhum desses
mecanismos, e este contrato não os cria.

2.4. **O que o `LICENSE` diz sobre redistribuir** (citação literal):

> FSL: If you redistribute any copies, modifications or derivatives of the Software, you must include a copy of or a link to these Terms and Conditions and not remove any copyright notices provided in or with the Software.

**Termo adicional (a revisar):** quem redistribui o Aplicativo inclui também `legal/THIRD_PARTY_NOTICES.md`. Essa
exigência não vem do `LICENSE`: vem das licenças dos componentes de terceiros, que pedem a reprodução do aviso de
cada um.

## 3. Os CLIs de terceiros: Claude Code, Codex e Cursor Agent

3.1. O MordomoOS **orquestra** programas de linha de comando de terceiros que a pessoa instala por conta
própria: o Claude Code, o Codex e o Cursor Agent (os "CLIs"). O Aplicativo os procura no computador,
inicia o que a pessoa escolheu e lê o que ele devolve.

3.2. O MordomoOS **não inclui, não redistribui e não sublicencia** nenhum CLI, nenhum modelo e nenhum
serviço desses fornecedores. Nada deles está no instalador, e nada deles é baixado ou instalado pelo
Aplicativo por conta própria: a tela de configuração só mostra o comando de instalação e de login de cada
um.

3.3. **Cada CLI segue os termos do seu fornecedor.** A pessoa usa **a própria conta** de cada fornecedor,
entra nela pelo próprio CLI e é a única responsável por ter o direito de usá-lo, pelos termos de uso, pelos
limites de uso e pelo custo dessa conta, inclusive quando o MordomoOS o inicia por uma rotina ou por um
dispositivo pareado. O MordomoOS não vê nem guarda a chave ou o login do provedor.

3.4. Os fornecedores podem mudar seus programas, seus termos e seus preços, ou restringir o uso
automatizado ou por terceiros, quando quiserem. O licenciante não controla isso e não garante que um CLI
continue funcionando com o MordomoOS. O que o Aplicativo envia ao CLI, e o CLI ao provedor, está dito em
`legal/PRIVACY.md`.

3.5. `[A PREENCHER PELO DONO: revisão jurídica dos termos de uso de cada fornecedor de CLI quanto à orquestração por terceiros (já está nos itens do dono do roteiro)]`

## 4. Marcas de terceiros

4.1. Os nomes de produtos e empresas de terceiros citados no repositório, na documentação, na interface, nos
conectores e nas skills embutidas são marcas ou nomes de produto dos respectivos titulares. Aparecem **só para
identificar com o que o MordomoOS funciona** (uso nominativo). Nenhum titular patrocina, endossa ou tem relação
com o MordomoOS, e o MordomoOS não usa os logotipos deles. **A lista abaixo não é exaustiva**: reúne os nomes que
a varredura do repositório (`tests/legal.docs.test.ts`) achou, e um nome citado que ela não conhece não perde a
natureza de marca de terceiro por não estar aqui.

- CLI de terceiros que o MordomoOS orquestra: Claude Code, Codex, Cursor Agent.
- Produto de terceiros (modelos e CLI): Claude.
- Fornecedor de terceiros: OpenAI.
- Produto de terceiros: Cursor, Obsidian, Logseq, Cline, Hermes, OpenClaw, OpenFang, Letta, Glance, AIOS, RUBRIC, RoboNuggets, Raycast, HumanLayer.
- Serviço de terceiros (canal opcional): Telegram.
- Serviço de terceiros: GitHub, Google, Gmail, Google Calendar, Tailscale, Cloudflare, DigitalOcean, Discord, Notion, Slack, WhatsApp, Stripe, PayPal, YouTube, Zapier, Fastly, Linear.
- Plataforma de terceiros: Apple, macOS, iOS, Windows, PowerShell, Microsoft, Linux, Ubuntu, Android, iPhone, iPad, Gatekeeper, SmartScreen, WSL, Developer ID, Debian, Spotlight, Finder.
- Navegador de terceiros: Safari, Chrome, Chromium, Firefox, Mozilla, Microsoft Edge.
- Tecnologia de terceiros: WebKit, Node.js, npm, SQLite, Electron, TypeScript, Kotlin, Dart, Flutter, Swift, React Native, Tauri, JavaScript, MCP.
- Ferramenta de terceiros: Playwright, Syncthing, Caddy, nginx, Homebrew, Vite, Vitest, Xcode, Gradle, Metro, Watchman, Expo, Docker, Envoy, esbuild, Prettier, ESLint, pnpm, Storybook.
- Biblioteca de terceiros: React, Radix UI, Fastify, Zod, cmdk.
- Fonte de terceiros: JetBrains Mono, Rajdhani.
- Nome de ficção de terceiros: JARVIS.

4.2. `[A PREENCHER PELO DONO: confirmar o titular e a política de uso de marca de cada nome da lista acima]`

## 5. Seus dados

Os dados ficam no seu computador, e o Aplicativo não os envia a servidores do licenciante. O que fica, o
que sai da máquina e por quê estão em `legal/PRIVACY.md`, que faz parte deste contrato.

## 6. Sem garantia

6.1. O `LICENSE` diz (citação literal):

> FSL: THE SOFTWARE IS PROVIDED "AS IS" AND WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION WARRANTIES OF FITNESS FOR A PARTICULAR PURPOSE, MERCHANTABILITY, TITLE OR NON-INFRINGEMENT.

6.2. `[A PREENCHER PELO DONO: garantia legal e prazos aplicáveis se houver venda a consumidor; o advogado deve dizer se a exclusão acima vale para esses casos]`

## 7. Limitação de responsabilidade

7.1. O `LICENSE` diz (citação literal):

> FSL: IN NO EVENT WILL WE HAVE ANY LIABILITY TO YOU ARISING OUT OF OR RELATED TO THE SOFTWARE, INCLUDING INDIRECT, SPECIAL, INCIDENTAL OR CONSEQUENTIAL DAMAGES, EVEN IF WE HAVE BEEN INFORMED OF THEIR POSSIBILITY IN ADVANCE.

**Termo adicional (a revisar):** nos limites da lei, o licenciante também não responde por perda de dados, de
lucro ou de oportunidade. Essa lista não está no `LICENSE`.

7.2. **Termo adicional (a revisar):** o Aplicativo faz agentes de IA lerem e, conforme o perfil de segurança que a pessoa escolher,
escreverem arquivos e executarem ferramentas no computador dela. Os perfis e as aprovações existem para
controlar isso (`docs/security.md`), mas a escolha do perfil, a aprovação de cada pedido e a cópia de
segurança (`mordomo backup`) são da pessoa. O licenciante não responde pelo que um agente, um CLI ou um
provedor fizer ou deixar de fazer.

7.3. `[A PREENCHER PELO DONO: teto de responsabilidade, se houver, e o que a lei de defesa do consumidor impede de limitar]`

## 8. Suporte e atualizações

8.1. `[A PREENCHER PELO DONO: o que o suporte inclui, canais e prazos]`; contato:
`[A PREENCHER PELO DONO: e-mail de suporte]`. `[A PREENCHER PELO DONO: política de reembolso]`.

8.2. O Aplicativo **não se atualiza sozinho** e não consulta a existência de versão nova por conta própria:
a verificação de versão (`updates.check`) vem desligada e só consulta o GitHub se a pessoa a ligar ou pedir.
Se um dia houver atualizador assinado, esta minuta e `legal/PRIVACY.md` mudam antes.

## 9. Vigência e término

9.1. O `LICENSE` condiciona a concessão ao cumprimento de suas cláusulas e encerra a licença de patentes quando
há ação de patente (citações literais):

> FSL: Subject to your compliance with this License Grant and the Patents, Redistribution and Trademark clauses below, we hereby grant you the right to use, copy, modify, create derivative works, publicly perform, publicly display and redistribute the Software for any Permitted Purpose identified below.
> FSL: If you make a claim against any party that the Software infringes or contributes to the infringement of any patent, then your patent license to the Software ends immediately.

O `LICENSE` **não tem** cláusula de término do contrato nem dever de parar de distribuir o software; o que
acontece a quem descumpre a licença é matéria da lei e do advogado.

9.2. **Termo adicional (a revisar):** `[A PREENCHER PELO DONO: prazo e hipóteses de rescisão do contrato de venda, se houver]`

9.3. A pessoa pode deixar de usar o Aplicativo quando quiser: `mordomo uninstall` para o serviço e preserva
os dados; `mordomo uninstall --purge` apaga o estado (`docs/backup-restore-uninstall.md`).

## 10. Lei aplicável e foro

`[A PREENCHER PELO DONO: lei aplicável e foro]`. Se o Aplicativo for vendido a consumidor, regras de ordem
pública de defesa do consumidor podem se aplicar no lugar de cláusulas contrárias deste contrato; o
advogado do dono deve dizer como.

## 11. Disposições gerais

11.1. Este contrato, o `LICENSE`, `legal/PRIVACY.md` e `legal/THIRD_PARTY_NOTICES.md` são o acordo inteiro
sobre o Aplicativo. Cada componente de terceiros segue a licença do seu autor, reproduzida em
`legal/THIRD_PARTY_NOTICES.md`; nada aqui muda essas licenças.

11.2. O texto está em português; o `LICENSE` fica no texto canônico em inglês, que prevalece sobre o dele
mesmo. `[A PREENCHER PELO DONO: decidir se o contrato também terá versão em inglês]`

## 12. O que falta ao dono

Todas as marcações `[A PREENCHER PELO DONO: …]` acima, mais a revisão deste texto por advogado. A lista
completa, com o que já foi decidido e o que não foi, está em `.specs/STATE.md`, "Perguntas ao dono",
"licenca-comercial".
