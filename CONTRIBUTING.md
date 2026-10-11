# Contribuindo com o MordomoOS

> **MINUTA para revisão do dono. Não é aconselhamento jurídico.** Quem escreveu este texto não é
> advogado e ninguém com formação em direito o revisou. O que depende do dono está em
> `[A PREENCHER PELO DONO: …]` e listado em `.specs/STATE.md`, item "revisão jurídica do dono".

## Antes de abrir um pull request

O código-fonte é público sob a Functional Source License 1.1 com licença futura Apache-2.0
(FSL-1.1-ALv2, texto em [`LICENSE`](LICENSE)). Isso é "código visível", não software livre pelo critério
da OSI: leia o `LICENSE` antes de contribuir, principalmente a parte sobre _Competing Use_.

Para rodar o que o CI roda:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Os commits seguem [Conventional Commits](https://www.conventionalcommits.org/) (`feat(core): …`,
`fix(api): …`). Mudou a lista de dependências? Rode também `npm run licenses:write` e comite
`legal/THIRD_PARTY_NOTICES.md`; uma dependência com licença fora da lista de `legal/license-policy.json`
reprova (`npm run licenses:check`). Acrescentou um destino de rede? Acrescente-o a
`legal/network-policy.json` e a `legal/PRIVACY.md` (`npm run network:scan -- --check`).

## Origem da contribuição (DCO)

Este projeto usa o **Developer Certificate of Origin**, versão 1.1: em cada commit, a linha

```
Signed-off-by: Seu Nome <seu@email>
```

(com `git commit -s`) afirma que você pode enviar a contribuição e aceita os termos abaixo. É o texto
oficial de <https://developercertificate.org/>, que não pode ser alterado:

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

## Sob qual licença a contribuição entra

A contribuição entra sob a mesma licença do projeto: **FSL-1.1-ALv2**, e passa à Apache-2.0 junto com o
resto, dois anos depois da data em que a versão que a contém for disponibilizada. **Não há CLA**
(acordo de licença de contribuidor): a contribuição não dá ao titular nenhum direito além dos que o
próprio `LICENSE` já dá a qualquer pessoa.

## Pendências do dono

- `[A PREENCHER PELO DONO: política de contribuições externas (DCO como está, CLA, ou não aceitar contribuições externas)]`
  O DCO fala em "open source license" e o FSL não é uma licença aprovada pela OSI; sem CLA, o titular não
  pode mudar a licença da contribuição de terceiros por conta própria. Quem decide é o dono, com seu
  advogado.
- `[A PREENCHER PELO DONO: e-mail de contato jurídico e de privacidade]` para relatos de problema de licença.
- `[A PREENCHER PELO DONO: canal para relatar vulnerabilidades]` (hoje o repositório não define um).
