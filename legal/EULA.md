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
que diz respeito ao que se pode fazer com o software (usar, copiar, modificar, redistribuir, e a
conversão para a Apache License 2.0 na segunda data de aniversário da disponibilização de cada versão),
**prevalece o `LICENSE`**. Este contrato não restringe nada que o `LICENSE` permite.
`[A PREENCHER PELO DONO: confirmar com o advogado qual texto prevalece e se o contrato pode ser mais restritivo que o FSL]`

1.3. O titular dos direitos e licenciante é `[A PREENCHER PELO DONO: titular dos direitos autorais]`,
inscrito sob o documento `[A PREENCHER PELO DONO: documento do titular (CNPJ ou CPF)]`, com endereço em
`[A PREENCHER PELO DONO: endereço do titular]`. Contato jurídico e de privacidade:
`[A PREENCHER PELO DONO: e-mail de contato jurídico e de privacidade]`.

## 2. O que se pode fazer e o que não

2.1. Resumo, sem substituir o `LICENSE`: é permitido usar o Aplicativo para qualquer finalidade que não
seja um _Competing Use_ (disponibilizar a terceiros, em produto ou serviço comercial, algo que substitui o
MordomoOS, que substitui outro produto ou serviço do licenciante que use o MordomoOS, ou que oferece a
mesma funcionalidade ou uma substancialmente parecida). São expressamente permitidos o uso interno, a
educação e a pesquisa não comerciais e a prestação de serviços profissionais a quem tem o software
licenciado.

2.2. Quem precisa de um uso que o `LICENSE` não permite (um _Competing Use_) precisa de uma licença
comercial separada, fora desta minuta: `[A PREENCHER PELO DONO: licença comercial para uso concorrente, se o dono quiser oferecê-la]`.

2.3. Modelo de venda, preço e forma de pagamento do Aplicativo: `[A PREENCHER PELO DONO: preço e modelo de venda (por usuário, por máquina, assinatura)]`.
O Aplicativo não tem hoje chave de licença, ativação nem verificação online de licença: o código não
contém nenhum desses mecanismos, e este contrato não os cria.

2.4. Quem redistribui o software deve incluir o `LICENSE` e não remover os avisos de direitos autorais,
como o próprio `LICENSE` exige, e o arquivo `legal/THIRD_PARTY_NOTICES.md`, que reproduz os avisos dos
componentes de terceiros.

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

4.1. Os nomes abaixo, citados no repositório, na documentação, na interface e nos manifestos, são marcas
ou nomes de produto dos respectivos titulares. Aparecem **só para identificar com o que o MordomoOS
funciona** (uso nominativo). Nenhum titular patrocina, endossa ou tem relação com o MordomoOS, e o
MordomoOS não usa os logotipos deles.

- CLI de terceiros que o MordomoOS orquestra: Claude Code, Codex, Cursor Agent.
- Produto de terceiros (modelos e CLI): Claude.
- Fornecedor de terceiros: OpenAI.
- Produto de terceiros: Cursor, Obsidian.
- Serviço de terceiros (canal opcional): Telegram.
- Serviço de terceiros: GitHub, Google, Gmail, Google Calendar, Tailscale, Cloudflare.
- Plataforma de terceiros: Apple, macOS, iOS, Windows, PowerShell, Microsoft, Linux, Ubuntu.
- Navegador de terceiros: Safari, Chrome, Chromium, Firefox, Mozilla.
- Tecnologia de terceiros: WebKit, Node.js, npm, SQLite, Electron, TypeScript.
- Ferramenta de terceiros: Playwright, Syncthing, Caddy, nginx, Homebrew, Vite, Vitest.
- Biblioteca de terceiros: React, Radix UI, Fastify, Zod.
- Fonte de terceiros: JetBrains Mono, Rajdhani.

4.2. `[A PREENCHER PELO DONO: confirmar o titular e a política de uso de marca de cada nome da lista acima]`

## 5. Seus dados

Os dados ficam no seu computador, e o Aplicativo não os envia a servidores do licenciante. O que fica, o
que sai da máquina e por quê estão em `legal/PRIVACY.md`, que faz parte deste contrato.

## 6. Sem garantia

6.1. O Aplicativo é entregue **"no estado em que se encontra" ("as is")**, sem garantia de nenhuma
espécie, expressa ou implícita, inclusive de adequação a uma finalidade, de comercialização, de titularidade
e de não violação, nos termos do `LICENSE`.

6.2. `[A PREENCHER PELO DONO: garantia legal e prazos aplicáveis se houver venda a consumidor; o advogado deve dizer se a exclusão acima vale para esses casos]`

## 7. Limitação de responsabilidade

7.1. Nos limites da lei, o licenciante não responde por danos indiretos, especiais, incidentais ou
consequenciais, nem por perda de dados, de lucro ou de oportunidade, ainda que avisado da possibilidade,
como diz o `LICENSE`.

7.2. O Aplicativo faz agentes de IA lerem e, conforme o perfil de segurança que a pessoa escolher,
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

9.1. Os direitos concedidos pelo `LICENSE` valem enquanto os termos dele forem cumpridos. Quem o descumpre
perde o direito de continuar a usar o software nos termos dele, e o licenciante pode exigir que pare de
distribuí-lo.

9.2. `[A PREENCHER PELO DONO: prazo e hipóteses de rescisão do contrato de venda, se houver]`

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
