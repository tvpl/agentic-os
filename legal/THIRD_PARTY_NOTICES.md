# Avisos de software de terceiros — MordomoOS

> **MINUTA para revisão do dono.** Este arquivo foi gerado por script e não é aconselhamento jurídico: ninguém com formação em direito o revisou. A revisão é do dono (ver `.specs/STATE.md`, "revisão jurídica do dono").

O MordomoOS é distribuído sob a Functional Source License 1.1 com licença futura Apache-2.0 (FSL-1.1-ALv2; texto em `LICENSE`). Ele reúne componentes de terceiros, cada um sob a licença do seu autor, reproduzida abaixo como essas licenças pedem. Nada aqui muda a licença de nenhum deles.

Gerado por `node scripts/licenses.mjs --write` a partir de `package-lock.json`, dos arquivos de licença dos pacotes instalados e de `legal/license-policy.json`. **Não edite à mão**: `npm run licenses:write` reescreve e `npm run licenses:check` reprova um arquivo que não bate.

Componentes npm distribuídos: 184 · ferramentas de build (não distribuídas): 484

## 1. Componentes que não vêm do npm

### Node.js — MIT

- Onde: pasta runtime/ do instalador (binário oficial do Node.js; o instalador copia o LICENSE do Node, que reúne os avisos das dependências do próprio Node, para runtime/LICENSE). Com `--node none` o instalador usa o Node do sistema e não leva nada.
- Origem: https://github.com/nodejs/node/blob/main/LICENSE
- Nota: a versão embutida é a do computador que gera o instalador (`node scripts/package.mjs --node <versão>`); a de cada instalador está em runtime/LICENSE e no nome do binário baixado.

### SQLite — Domínio público (SQLite blessing)

- Onde: compilado dentro do módulo nativo do pacote better-sqlite3 (lib/node_modules/better-sqlite3 do instalador)
- Origem: https://www.sqlite.org/copyright.html
- Nota: o pacote better-sqlite3 (MIT) tem o próprio aviso na seção 2.

### JetBrains Mono (fonte) — SIL Open Font License 1.1

- Onde: apps/command-centre/public/fonts/jetbrains-mono-latin.woff2, servida pelo Command Centre
- Origem: https://github.com/JetBrains/JetBrainsMono
- Nota: texto copiado de https://raw.githubusercontent.com/JetBrains/JetBrainsMono/master/OFL.txt em 11/10/2026. A origem do arquivo .woff2 do repositório não está registrada: o dono deve confirmar que ele vem desse projeto (ver `.specs/STATE.md`).

~~~~text
Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://openfontlicense.org


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
~~~~

### Rajdhani (fonte) — SIL Open Font License 1.1

- Onde: apps/command-centre/public/fonts/rajdhani-600-latin.woff2 e rajdhani-700-latin.woff2, servidas pelo Command Centre
- Origem: https://github.com/itfoundry/rajdhani
- Nota: texto copiado de https://raw.githubusercontent.com/google/fonts/main/ofl/rajdhani/OFL.txt em 11/10/2026. A origem dos arquivos .woff2 do repositório não está registrada: o dono deve confirmar que eles vêm desse projeto (ver `.specs/STATE.md`).

~~~~text
Copyright (c) 2014, Indian Type Foundry (info@indiantypefoundry.com).

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
~~~~

## 2. Pacotes npm distribuídos

| Pacote | Versão | Licença (SPDX) | Origem |
| --- | --- | --- | --- |
| @clack/core | 0.5.0 | MIT | https://registry.npmjs.org/@clack/core/-/core-0.5.0.tgz |
| @clack/prompts | 0.11.0 | MIT | https://registry.npmjs.org/@clack/prompts/-/prompts-0.11.0.tgz |
| @fastify/accept-negotiator | 2.1.0 | MIT | https://registry.npmjs.org/@fastify/accept-negotiator/-/accept-negotiator-2.1.0.tgz |
| @fastify/ajv-compiler | 4.0.6 | MIT | https://registry.npmjs.org/@fastify/ajv-compiler/-/ajv-compiler-4.0.6.tgz |
| @fastify/error | 4.2.0 | MIT | https://registry.npmjs.org/@fastify/error/-/error-4.2.0.tgz |
| @fastify/fast-json-stringify-compiler | 5.1.0 | MIT | https://registry.npmjs.org/@fastify/fast-json-stringify-compiler/-/fast-json-stringify-compiler-5.1.0.tgz |
| @fastify/forwarded | 3.0.2 | MIT | https://registry.npmjs.org/@fastify/forwarded/-/forwarded-3.0.2.tgz |
| @fastify/merge-json-schemas | 0.2.1 | MIT | https://registry.npmjs.org/@fastify/merge-json-schemas/-/merge-json-schemas-0.2.1.tgz |
| @fastify/proxy-addr | 5.1.0 | MIT | https://registry.npmjs.org/@fastify/proxy-addr/-/proxy-addr-5.1.0.tgz |
| @fastify/send | 4.1.1 | MIT | https://registry.npmjs.org/@fastify/send/-/send-4.1.1.tgz |
| @fastify/static | 10.1.3 | MIT | https://registry.npmjs.org/@fastify/static/-/static-10.1.3.tgz |
| @floating-ui/core | 1.8.0 | MIT | https://registry.npmjs.org/@floating-ui/core/-/core-1.8.0.tgz |
| @floating-ui/dom | 1.8.0 | MIT | https://registry.npmjs.org/@floating-ui/dom/-/dom-1.8.0.tgz |
| @floating-ui/react-dom | 2.1.9 | MIT | https://registry.npmjs.org/@floating-ui/react-dom/-/react-dom-2.1.9.tgz |
| @floating-ui/utils | 0.2.12 | MIT | https://registry.npmjs.org/@floating-ui/utils/-/utils-0.2.12.tgz |
| @lukeed/ms | 2.0.2 | MIT | https://registry.npmjs.org/@lukeed/ms/-/ms-2.0.2.tgz |
| @pinojs/redact | 0.4.0 | MIT | https://registry.npmjs.org/@pinojs/redact/-/redact-0.4.0.tgz |
| @radix-ui/primitive | 1.1.7 | MIT | https://registry.npmjs.org/@radix-ui/primitive/-/primitive-1.1.7.tgz |
| @radix-ui/react-arrow | 1.1.15 | MIT | https://registry.npmjs.org/@radix-ui/react-arrow/-/react-arrow-1.1.15.tgz |
| @radix-ui/react-collection | 1.1.15 | MIT | https://registry.npmjs.org/@radix-ui/react-collection/-/react-collection-1.1.15.tgz |
| @radix-ui/react-compose-refs | 1.1.5 | MIT | https://registry.npmjs.org/@radix-ui/react-compose-refs/-/react-compose-refs-1.1.5.tgz |
| @radix-ui/react-context | 1.2.2 | MIT | https://registry.npmjs.org/@radix-ui/react-context/-/react-context-1.2.2.tgz |
| @radix-ui/react-dialog | 1.1.23 | MIT | https://registry.npmjs.org/@radix-ui/react-dialog/-/react-dialog-1.1.23.tgz |
| @radix-ui/react-direction | 1.1.4 | MIT | https://registry.npmjs.org/@radix-ui/react-direction/-/react-direction-1.1.4.tgz |
| @radix-ui/react-dismissable-layer | 1.1.19 | MIT | https://registry.npmjs.org/@radix-ui/react-dismissable-layer/-/react-dismissable-layer-1.1.19.tgz |
| @radix-ui/react-dropdown-menu | 2.1.24 | MIT | https://registry.npmjs.org/@radix-ui/react-dropdown-menu/-/react-dropdown-menu-2.1.24.tgz |
| @radix-ui/react-focus-guards | 1.1.6 | MIT | https://registry.npmjs.org/@radix-ui/react-focus-guards/-/react-focus-guards-1.1.6.tgz |
| @radix-ui/react-focus-scope | 1.1.16 | MIT | https://registry.npmjs.org/@radix-ui/react-focus-scope/-/react-focus-scope-1.1.16.tgz |
| @radix-ui/react-id | 1.1.4 | MIT | https://registry.npmjs.org/@radix-ui/react-id/-/react-id-1.1.4.tgz |
| @radix-ui/react-menu | 2.1.24 | MIT | https://registry.npmjs.org/@radix-ui/react-menu/-/react-menu-2.1.24.tgz |
| @radix-ui/react-popover | 1.1.23 | MIT | https://registry.npmjs.org/@radix-ui/react-popover/-/react-popover-1.1.23.tgz |
| @radix-ui/react-popper | 1.3.7 | MIT | https://registry.npmjs.org/@radix-ui/react-popper/-/react-popper-1.3.7.tgz |
| @radix-ui/react-portal | 1.1.17 | MIT | https://registry.npmjs.org/@radix-ui/react-portal/-/react-portal-1.1.17.tgz |
| @radix-ui/react-presence | 1.1.10 | MIT | https://registry.npmjs.org/@radix-ui/react-presence/-/react-presence-1.1.10.tgz |
| @radix-ui/react-primitive | 2.1.10 | MIT | https://registry.npmjs.org/@radix-ui/react-primitive/-/react-primitive-2.1.10.tgz |
| @radix-ui/react-roving-focus | 1.1.19 | MIT | https://registry.npmjs.org/@radix-ui/react-roving-focus/-/react-roving-focus-1.1.19.tgz |
| @radix-ui/react-slot | 1.3.3 | MIT | https://registry.npmjs.org/@radix-ui/react-slot/-/react-slot-1.3.3.tgz |
| @radix-ui/react-switch | 1.3.7 | MIT | https://registry.npmjs.org/@radix-ui/react-switch/-/react-switch-1.3.7.tgz |
| @radix-ui/react-tabs | 1.1.21 | MIT | https://registry.npmjs.org/@radix-ui/react-tabs/-/react-tabs-1.1.21.tgz |
| @radix-ui/react-tooltip | 1.2.16 | MIT | https://registry.npmjs.org/@radix-ui/react-tooltip/-/react-tooltip-1.2.16.tgz |
| @radix-ui/react-use-callback-ref | 1.1.4 | MIT | https://registry.npmjs.org/@radix-ui/react-use-callback-ref/-/react-use-callback-ref-1.1.4.tgz |
| @radix-ui/react-use-controllable-state | 1.2.6 | MIT | https://registry.npmjs.org/@radix-ui/react-use-controllable-state/-/react-use-controllable-state-1.2.6.tgz |
| @radix-ui/react-use-effect-event | 0.0.5 | MIT | https://registry.npmjs.org/@radix-ui/react-use-effect-event/-/react-use-effect-event-0.0.5.tgz |
| @radix-ui/react-use-is-hydrated | 0.1.3 | MIT | https://registry.npmjs.org/@radix-ui/react-use-is-hydrated/-/react-use-is-hydrated-0.1.3.tgz |
| @radix-ui/react-use-layout-effect | 1.1.4 | MIT | https://registry.npmjs.org/@radix-ui/react-use-layout-effect/-/react-use-layout-effect-1.1.4.tgz |
| @radix-ui/react-use-rect | 1.1.4 | MIT | https://registry.npmjs.org/@radix-ui/react-use-rect/-/react-use-rect-1.1.4.tgz |
| @radix-ui/react-use-size | 1.1.4 | MIT | https://registry.npmjs.org/@radix-ui/react-use-size/-/react-use-size-1.1.4.tgz |
| @radix-ui/react-visually-hidden | 1.2.11 | MIT | https://registry.npmjs.org/@radix-ui/react-visually-hidden/-/react-visually-hidden-1.2.11.tgz |
| @radix-ui/rect | 1.1.3 | MIT | https://registry.npmjs.org/@radix-ui/rect/-/rect-1.1.3.tgz |
| @tanstack/query-core | 5.102.8 | MIT | https://registry.npmjs.org/@tanstack/query-core/-/query-core-5.102.8.tgz |
| @tanstack/react-query | 5.102.8 | MIT | https://registry.npmjs.org/@tanstack/react-query/-/react-query-5.102.8.tgz |
| @tanstack/react-virtual | 3.14.10 | MIT | https://registry.npmjs.org/@tanstack/react-virtual/-/react-virtual-3.14.10.tgz |
| @tanstack/virtual-core | 3.17.8 | MIT | https://registry.npmjs.org/@tanstack/virtual-core/-/virtual-core-3.17.8.tgz |
| abstract-logging | 2.0.1 | MIT | https://registry.npmjs.org/abstract-logging/-/abstract-logging-2.0.1.tgz |
| ajv | 8.20.0 | MIT | https://registry.npmjs.org/ajv/-/ajv-8.20.0.tgz |
| ajv-formats | 3.0.1 | MIT | https://registry.npmjs.org/ajv-formats/-/ajv-formats-3.0.1.tgz |
| argparse | 1.0.10 | MIT | https://registry.npmjs.org/argparse/-/argparse-1.0.10.tgz |
| aria-hidden | 1.2.6 | MIT | https://registry.npmjs.org/aria-hidden/-/aria-hidden-1.2.6.tgz |
| atomic-sleep | 1.0.0 | MIT | https://registry.npmjs.org/atomic-sleep/-/atomic-sleep-1.0.0.tgz |
| avvio | 9.3.0 | MIT | https://registry.npmjs.org/avvio/-/avvio-9.3.0.tgz |
| balanced-match | 4.0.4 | MIT | https://registry.npmjs.org/balanced-match/-/balanced-match-4.0.4.tgz |
| base64-js | 1.5.1 | MIT | https://registry.npmjs.org/base64-js/-/base64-js-1.5.1.tgz |
| better-sqlite3 | 12.11.1 | MIT | https://registry.npmjs.org/better-sqlite3/-/better-sqlite3-12.11.1.tgz |
| bindings | 1.5.0 | MIT | https://registry.npmjs.org/bindings/-/bindings-1.5.0.tgz |
| bl | 4.1.0 | MIT | https://registry.npmjs.org/bl/-/bl-4.1.0.tgz |
| brace-expansion | 5.0.9 | MIT | https://registry.npmjs.org/brace-expansion/-/brace-expansion-5.0.9.tgz |
| buffer | 5.7.1 | MIT | https://registry.npmjs.org/buffer/-/buffer-5.7.1.tgz |
| chownr | 1.1.4 | ISC | https://registry.npmjs.org/chownr/-/chownr-1.1.4.tgz |
| content-disposition | 2.0.1 | MIT | https://registry.npmjs.org/content-disposition/-/content-disposition-2.0.1.tgz |
| cookie | 1.1.1 | MIT | https://registry.npmjs.org/cookie/-/cookie-1.1.1.tgz |
| croner | 9.1.0 | MIT | https://registry.npmjs.org/croner/-/croner-9.1.0.tgz |
| d3-dispatch | 3.0.1 | ISC | https://registry.npmjs.org/d3-dispatch/-/d3-dispatch-3.0.1.tgz |
| d3-force | 3.0.0 | ISC | https://registry.npmjs.org/d3-force/-/d3-force-3.0.0.tgz |
| d3-quadtree | 3.0.1 | ISC | https://registry.npmjs.org/d3-quadtree/-/d3-quadtree-3.0.1.tgz |
| d3-timer | 3.0.1 | ISC | https://registry.npmjs.org/d3-timer/-/d3-timer-3.0.1.tgz |
| decompress-response | 6.0.0 | MIT | https://registry.npmjs.org/decompress-response/-/decompress-response-6.0.0.tgz |
| deep-extend | 0.6.0 | MIT | https://registry.npmjs.org/deep-extend/-/deep-extend-0.6.0.tgz |
| depd | 2.0.0 | MIT | https://registry.npmjs.org/depd/-/depd-2.0.0.tgz |
| dequal | 2.0.3 | MIT | https://registry.npmjs.org/dequal/-/dequal-2.0.3.tgz |
| detect-libc | 2.1.2 | Apache-2.0 | https://registry.npmjs.org/detect-libc/-/detect-libc-2.1.2.tgz |
| detect-node-es | 1.1.0 | MIT | https://registry.npmjs.org/detect-node-es/-/detect-node-es-1.1.0.tgz |
| end-of-stream | 1.4.5 | MIT | https://registry.npmjs.org/end-of-stream/-/end-of-stream-1.4.5.tgz |
| escape-html | 1.0.3 | MIT | https://registry.npmjs.org/escape-html/-/escape-html-1.0.3.tgz |
| esprima | 4.0.1 | BSD-2-Clause | https://registry.npmjs.org/esprima/-/esprima-4.0.1.tgz |
| expand-template | 2.0.3 | (MIT OR WTFPL) | https://registry.npmjs.org/expand-template/-/expand-template-2.0.3.tgz |
| extend-shallow | 2.0.1 | MIT | https://registry.npmjs.org/extend-shallow/-/extend-shallow-2.0.1.tgz |
| fast-decode-uri-component | 1.0.1 | MIT | https://registry.npmjs.org/fast-decode-uri-component/-/fast-decode-uri-component-1.0.1.tgz |
| fast-deep-equal | 3.1.3 | MIT | https://registry.npmjs.org/fast-deep-equal/-/fast-deep-equal-3.1.3.tgz |
| fast-json-stringify | 7.0.1 | MIT | https://registry.npmjs.org/fast-json-stringify/-/fast-json-stringify-7.0.1.tgz |
| fast-querystring | 1.1.2 | MIT | https://registry.npmjs.org/fast-querystring/-/fast-querystring-1.1.2.tgz |
| fast-uri | 3.1.6 | BSD-3-Clause | https://registry.npmjs.org/fast-uri/-/fast-uri-3.1.6.tgz |
| fast-uri | 4.1.3 | BSD-3-Clause | https://registry.npmjs.org/fast-uri/-/fast-uri-4.1.3.tgz |
| fastify | 5.12.1 | MIT | https://registry.npmjs.org/fastify/-/fastify-5.12.1.tgz |
| fastify-plugin | 6.0.0 | MIT | https://registry.npmjs.org/fastify-plugin/-/fastify-plugin-6.0.0.tgz |
| fastq | 1.20.3 | ISC | https://registry.npmjs.org/fastq/-/fastq-1.20.3.tgz |
| file-uri-to-path | 1.0.0 | MIT | https://registry.npmjs.org/file-uri-to-path/-/file-uri-to-path-1.0.0.tgz |
| find-my-way | 9.9.0 | MIT | https://registry.npmjs.org/find-my-way/-/find-my-way-9.9.0.tgz |
| fs-constants | 1.0.0 | MIT | https://registry.npmjs.org/fs-constants/-/fs-constants-1.0.0.tgz |
| get-nonce | 1.0.1 | MIT | https://registry.npmjs.org/get-nonce/-/get-nonce-1.0.1.tgz |
| github-from-package | 0.0.0 | MIT | https://registry.npmjs.org/github-from-package/-/github-from-package-0.0.0.tgz |
| glob | 13.0.6 | BlueOak-1.0.0 | https://registry.npmjs.org/glob/-/glob-13.0.6.tgz |
| gray-matter | 4.0.3 | MIT | https://registry.npmjs.org/gray-matter/-/gray-matter-4.0.3.tgz |
| http-errors | 2.0.1 | MIT | https://registry.npmjs.org/http-errors/-/http-errors-2.0.1.tgz |
| ieee754 | 1.2.1 | BSD-3-Clause | https://registry.npmjs.org/ieee754/-/ieee754-1.2.1.tgz |
| inherits | 2.0.4 | ISC | https://registry.npmjs.org/inherits/-/inherits-2.0.4.tgz |
| ini | 1.3.8 | ISC | https://registry.npmjs.org/ini/-/ini-1.3.8.tgz |
| ipaddr.js | 2.5.0 | MIT | https://registry.npmjs.org/ipaddr.js/-/ipaddr.js-2.5.0.tgz |
| is-extendable | 0.1.1 | MIT | https://registry.npmjs.org/is-extendable/-/is-extendable-0.1.1.tgz |
| js-tokens | 4.0.0 | MIT | https://registry.npmjs.org/js-tokens/-/js-tokens-4.0.0.tgz |
| js-yaml | 3.15.2 | MIT | https://registry.npmjs.org/js-yaml/-/js-yaml-3.15.2.tgz |
| json-schema-ref-resolver | 3.0.0 | MIT | https://registry.npmjs.org/json-schema-ref-resolver/-/json-schema-ref-resolver-3.0.0.tgz |
| json-schema-traverse | 1.0.0 | MIT | https://registry.npmjs.org/json-schema-traverse/-/json-schema-traverse-1.0.0.tgz |
| kind-of | 6.0.3 | MIT | https://registry.npmjs.org/kind-of/-/kind-of-6.0.3.tgz |
| light-my-request | 6.6.0 | BSD-3-Clause | https://registry.npmjs.org/light-my-request/-/light-my-request-6.6.0.tgz |
| loose-envify | 1.4.0 | MIT | https://registry.npmjs.org/loose-envify/-/loose-envify-1.4.0.tgz |
| lru-cache | 11.5.2 | BlueOak-1.0.0 | https://registry.npmjs.org/lru-cache/-/lru-cache-11.5.2.tgz |
| lucide-react | 0.468.0 | ISC | https://registry.npmjs.org/lucide-react/-/lucide-react-0.468.0.tgz |
| mime | 3.0.0 | MIT | https://registry.npmjs.org/mime/-/mime-3.0.0.tgz |
| mimic-response | 3.1.0 | MIT | https://registry.npmjs.org/mimic-response/-/mimic-response-3.1.0.tgz |
| minimatch | 10.2.6 | BlueOak-1.0.0 | https://registry.npmjs.org/minimatch/-/minimatch-10.2.6.tgz |
| minimist | 1.2.8 | MIT | https://registry.npmjs.org/minimist/-/minimist-1.2.8.tgz |
| minipass | 7.1.3 | BlueOak-1.0.0 | https://registry.npmjs.org/minipass/-/minipass-7.1.3.tgz |
| mkdirp-classic | 0.5.3 | MIT | https://registry.npmjs.org/mkdirp-classic/-/mkdirp-classic-0.5.3.tgz |
| napi-build-utils | 2.0.0 | MIT | https://registry.npmjs.org/napi-build-utils/-/napi-build-utils-2.0.0.tgz |
| node-abi | 3.96.0 | MIT | https://registry.npmjs.org/node-abi/-/node-abi-3.96.0.tgz |
| on-exit-leak-free | 2.1.2 | MIT | https://registry.npmjs.org/on-exit-leak-free/-/on-exit-leak-free-2.1.2.tgz |
| once | 1.4.0 | ISC | https://registry.npmjs.org/once/-/once-1.4.0.tgz |
| path-scurry | 2.0.2 | BlueOak-1.0.0 | https://registry.npmjs.org/path-scurry/-/path-scurry-2.0.2.tgz |
| picocolors | 1.1.1 | ISC | https://registry.npmjs.org/picocolors/-/picocolors-1.1.1.tgz |
| pino | 10.3.1 | MIT | https://registry.npmjs.org/pino/-/pino-10.3.1.tgz |
| pino-abstract-transport | 3.0.0 | MIT | https://registry.npmjs.org/pino-abstract-transport/-/pino-abstract-transport-3.0.0.tgz |
| pino-std-serializers | 7.1.0 | MIT | https://registry.npmjs.org/pino-std-serializers/-/pino-std-serializers-7.1.0.tgz |
| prebuild-install | 7.1.3 | MIT | https://registry.npmjs.org/prebuild-install/-/prebuild-install-7.1.3.tgz |
| process-warning | 4.0.1 | MIT | https://registry.npmjs.org/process-warning/-/process-warning-4.0.1.tgz |
| process-warning | 5.1.0 | MIT | https://registry.npmjs.org/process-warning/-/process-warning-5.1.0.tgz |
| pump | 3.0.4 | MIT | https://registry.npmjs.org/pump/-/pump-3.0.4.tgz |
| quick-format-unescaped | 4.0.4 | MIT | https://registry.npmjs.org/quick-format-unescaped/-/quick-format-unescaped-4.0.4.tgz |
| rc | 1.2.8 | (BSD-2-Clause OR MIT OR Apache-2.0) | https://registry.npmjs.org/rc/-/rc-1.2.8.tgz |
| react | 18.3.1 | MIT | https://registry.npmjs.org/react/-/react-18.3.1.tgz |
| react-dom | 18.3.1 | MIT | https://registry.npmjs.org/react-dom/-/react-dom-18.3.1.tgz |
| react-remove-scroll | 2.7.2 | MIT | https://registry.npmjs.org/react-remove-scroll/-/react-remove-scroll-2.7.2.tgz |
| react-remove-scroll-bar | 2.3.8 | MIT | https://registry.npmjs.org/react-remove-scroll-bar/-/react-remove-scroll-bar-2.3.8.tgz |
| react-router | 7.18.3 | MIT | https://registry.npmjs.org/react-router/-/react-router-7.18.3.tgz |
| react-router-dom | 7.18.3 | MIT | https://registry.npmjs.org/react-router-dom/-/react-router-dom-7.18.3.tgz |
| react-style-singleton | 2.2.3 | MIT | https://registry.npmjs.org/react-style-singleton/-/react-style-singleton-2.2.3.tgz |
| readable-stream | 3.6.2 | MIT | https://registry.npmjs.org/readable-stream/-/readable-stream-3.6.2.tgz |
| real-require | 0.2.0 | MIT | https://registry.npmjs.org/real-require/-/real-require-0.2.0.tgz |
| real-require | 1.0.0 | MIT | https://registry.npmjs.org/real-require/-/real-require-1.0.0.tgz |
| require-from-string | 2.0.2 | MIT | https://registry.npmjs.org/require-from-string/-/require-from-string-2.0.2.tgz |
| ret | 0.5.0 | MIT | https://registry.npmjs.org/ret/-/ret-0.5.0.tgz |
| reusify | 1.1.0 | MIT | https://registry.npmjs.org/reusify/-/reusify-1.1.0.tgz |
| rfdc | 1.4.1 | MIT | https://registry.npmjs.org/rfdc/-/rfdc-1.4.1.tgz |
| safe-buffer | 5.2.1 | MIT | https://registry.npmjs.org/safe-buffer/-/safe-buffer-5.2.1.tgz |
| safe-regex2 | 5.1.1 | MIT | https://registry.npmjs.org/safe-regex2/-/safe-regex2-5.1.1.tgz |
| safe-stable-stringify | 2.5.0 | MIT | https://registry.npmjs.org/safe-stable-stringify/-/safe-stable-stringify-2.5.0.tgz |
| scheduler | 0.23.2 | MIT | https://registry.npmjs.org/scheduler/-/scheduler-0.23.2.tgz |
| section-matter | 1.0.0 | MIT | https://registry.npmjs.org/section-matter/-/section-matter-1.0.0.tgz |
| secure-json-parse | 4.1.0 | BSD-3-Clause | https://registry.npmjs.org/secure-json-parse/-/secure-json-parse-4.1.0.tgz |
| semver | 7.8.5 | ISC | https://registry.npmjs.org/semver/-/semver-7.8.5.tgz |
| semver | 7.8.5 | ISC | https://registry.npmjs.org/semver/-/semver-7.8.5.tgz |
| set-cookie-parser | 2.7.2 | MIT | https://registry.npmjs.org/set-cookie-parser/-/set-cookie-parser-2.7.2.tgz |
| setprototypeof | 1.2.0 | ISC | https://registry.npmjs.org/setprototypeof/-/setprototypeof-1.2.0.tgz |
| simple-concat | 1.0.1 | MIT | https://registry.npmjs.org/simple-concat/-/simple-concat-1.0.1.tgz |
| simple-get | 4.0.1 | MIT | https://registry.npmjs.org/simple-get/-/simple-get-4.0.1.tgz |
| sisteransi | 1.0.5 | MIT | https://registry.npmjs.org/sisteransi/-/sisteransi-1.0.5.tgz |
| sonic-boom | 4.2.1 | MIT | https://registry.npmjs.org/sonic-boom/-/sonic-boom-4.2.1.tgz |
| split2 | 4.2.0 | ISC | https://registry.npmjs.org/split2/-/split2-4.2.0.tgz |
| sprintf-js | 1.0.3 | BSD-3-Clause | https://registry.npmjs.org/sprintf-js/-/sprintf-js-1.0.3.tgz |
| statuses | 2.0.2 | MIT | https://registry.npmjs.org/statuses/-/statuses-2.0.2.tgz |
| string_decoder | 1.3.0 | MIT | https://registry.npmjs.org/string_decoder/-/string_decoder-1.3.0.tgz |
| strip-bom-string | 1.0.0 | MIT | https://registry.npmjs.org/strip-bom-string/-/strip-bom-string-1.0.0.tgz |
| strip-json-comments | 2.0.1 | MIT | https://registry.npmjs.org/strip-json-comments/-/strip-json-comments-2.0.1.tgz |
| tar-fs | 2.1.5 | MIT | https://registry.npmjs.org/tar-fs/-/tar-fs-2.1.5.tgz |
| tar-stream | 2.2.0 | MIT | https://registry.npmjs.org/tar-stream/-/tar-stream-2.2.0.tgz |
| thread-stream | 4.2.0 | MIT | https://registry.npmjs.org/thread-stream/-/thread-stream-4.2.0.tgz |
| toad-cache | 3.7.4 | MIT | https://registry.npmjs.org/toad-cache/-/toad-cache-3.7.4.tgz |
| toidentifier | 1.0.1 | MIT | https://registry.npmjs.org/toidentifier/-/toidentifier-1.0.1.tgz |
| tslib | 2.8.1 | 0BSD | https://registry.npmjs.org/tslib/-/tslib-2.8.1.tgz |
| tunnel-agent | 0.6.0 | Apache-2.0 | https://registry.npmjs.org/tunnel-agent/-/tunnel-agent-0.6.0.tgz |
| use-callback-ref | 1.3.3 | MIT | https://registry.npmjs.org/use-callback-ref/-/use-callback-ref-1.3.3.tgz |
| use-sidecar | 1.1.3 | MIT | https://registry.npmjs.org/use-sidecar/-/use-sidecar-1.1.3.tgz |
| util-deprecate | 1.0.2 | MIT | https://registry.npmjs.org/util-deprecate/-/util-deprecate-1.0.2.tgz |
| wrappy | 1.0.2 | ISC | https://registry.npmjs.org/wrappy/-/wrappy-1.0.2.tgz |
| zod | 3.25.76 | MIT | https://registry.npmjs.org/zod/-/zod-3.25.76.tgz |

### Textos de licença (115 textos distintos)

#### Texto 1 — 2 pacotes

@clack/core@0.5.0, @clack/prompts@0.11.0

~~~~text
MIT License

Copyright (c) Nate Moore

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
~~~~

#### Texto 2 — 3 pacotes

@fastify/accept-negotiator@2.1.0, @fastify/ajv-compiler@4.0.6, @fastify/fast-json-stringify-compiler@5.1.0

~~~~text
MIT License

Copyright (c) 2022-present The Fastify team <https://github.com/fastify/fastify#team>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 3 — 1 pacote

@fastify/error@4.2.0

~~~~text
MIT License

Copyright (c) 2020 Fastify

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 4 — 1 pacote

@fastify/forwarded@3.0.2

~~~~text
MIT License

Copyright (c) 2014-2017 Douglas Christopher Wilson
Copyright (c) 2021-present The Fastify team <https://github.com/fastify/fastify#team>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 5 — 1 pacote

@fastify/merge-json-schemas@0.2.1

~~~~text
MIT License

Copyright (c) 2024 Fastify

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 6 — 1 pacote

@fastify/proxy-addr@5.1.0

~~~~text
MIT License

Copyright (c) 2014-2016 Douglas Christopher Wilson
Copyright (c) 2021-present The Fastify team

The Fastify team members are listed at https://github.com/fastify/fastify#team.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 7 — 1 pacote

@fastify/send@4.1.1

~~~~text
MIT License

Copyright (c) 2012 TJ Holowaychuk
Copyright (c) 2014-2022 Douglas Christopher Wilson
Copyright (c) 2023-present The Fastify team <https://github.com/fastify/fastify#team>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 8 — 2 pacotes

@fastify/static@10.1.3, fastify-plugin@6.0.0

~~~~text
MIT License

Copyright (c) 2017-present The Fastify team <https://github.com/fastify/fastify#team>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 9 — 4 pacotes

@floating-ui/core@1.8.0, @floating-ui/dom@1.8.0, @floating-ui/react-dom@2.1.9, @floating-ui/utils@0.2.12

~~~~text
MIT License

Copyright (c) 2021-present Floating UI contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
~~~~

#### Texto 10 — 1 pacote

@lukeed/ms@2.0.2

~~~~text
MIT License

Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
~~~~

#### Texto 11 — 1 pacote

@pinojs/redact@0.4.0

~~~~text
MIT License

Copyright (c) 2025 pinojs contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 12 — 32 pacotes

@radix-ui/primitive@1.1.7, @radix-ui/react-arrow@1.1.15, @radix-ui/react-collection@1.1.15, @radix-ui/react-compose-refs@1.1.5, @radix-ui/react-context@1.2.2, @radix-ui/react-dialog@1.1.23, @radix-ui/react-direction@1.1.4, @radix-ui/react-dismissable-layer@1.1.19, @radix-ui/react-dropdown-menu@2.1.24, @radix-ui/react-focus-guards@1.1.6, @radix-ui/react-focus-scope@1.1.16, @radix-ui/react-id@1.1.4, @radix-ui/react-menu@2.1.24, @radix-ui/react-popover@1.1.23, @radix-ui/react-popper@1.3.7, @radix-ui/react-portal@1.1.17, @radix-ui/react-presence@1.1.10, @radix-ui/react-primitive@2.1.10, @radix-ui/react-roving-focus@1.1.19, @radix-ui/react-slot@1.3.3, @radix-ui/react-switch@1.3.7, @radix-ui/react-tabs@1.1.21, @radix-ui/react-tooltip@1.2.16, @radix-ui/react-use-callback-ref@1.1.4, @radix-ui/react-use-controllable-state@1.2.6, @radix-ui/react-use-effect-event@0.0.5, @radix-ui/react-use-is-hydrated@0.1.3, @radix-ui/react-use-layout-effect@1.1.4, @radix-ui/react-use-rect@1.1.4, @radix-ui/react-use-size@1.1.4, @radix-ui/react-visually-hidden@1.2.11, @radix-ui/rect@1.1.3

~~~~text
MIT License

Copyright (c) 2022 WorkOS

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 13 — 4 pacotes

@tanstack/query-core@5.102.8, @tanstack/react-query@5.102.8, @tanstack/react-virtual@3.14.10, @tanstack/virtual-core@3.17.8

~~~~text
MIT License

Copyright (c) 2021-present Tanner Linsley

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 14 — 1 pacote

abstract-logging@2.0.1

~~~~text
(O pacote não inclui arquivo de licença. Licença declarada: MIT. Autor declarado: James Sumners.)
~~~~

#### Texto 15 — 1 pacote

ajv@8.20.0

~~~~text
The MIT License (MIT)

Copyright (c) 2015-2021 Evgeny Poberezkin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 16 — 1 pacote

ajv-formats@3.0.1

~~~~text
MIT License

Copyright (c) 2020 Evgeny Poberezkin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 17 — 1 pacote

argparse@1.0.10

~~~~text
(The MIT License)

Copyright (C) 2012 by Vitaly Puzrin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

#### Texto 18 — 5 pacotes

aria-hidden@1.2.6, react-remove-scroll@2.7.2, react-style-singleton@2.2.3, use-callback-ref@1.3.3, use-sidecar@1.1.3

~~~~text
MIT License

Copyright (c) 2017 Anton Korzunov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 19 — 1 pacote

atomic-sleep@1.0.0

~~~~text
The MIT License (MIT)
Copyright (c) 2020 David Mark Clements


Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE
OR OTHER DEALINGS IN THE SOFTWARE.
~~~~

#### Texto 20 — 1 pacote

avvio@9.3.0

~~~~text
MIT License

Copyright (c) 2016-2020 Matteo Collina
Copyright (c) 2020-present The Fastify team <https://github.com/fastify/fastify#team>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 21 — 1 pacote

balanced-match@4.0.4

~~~~text
(MIT)

Original code Copyright Julian Gruber <julian@juliangruber.com>

Port to TypeScript Copyright Isaac Z. Schlueter <i@izs.me>

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 22 — 1 pacote

base64-js@1.5.1

~~~~text
The MIT License (MIT)

Copyright (c) 2014 Jameson Little

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

#### Texto 23 — 1 pacote

better-sqlite3@12.11.1

~~~~text
The MIT License (MIT)

Copyright (c) 2017 Joshua Wise

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 24 — 1 pacote

bindings@1.5.0

~~~~text
(The MIT License)

Copyright (c) 2012 Nathan Rajlich &lt;nathan@tootallnate.net&gt;

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
~~~~

#### Texto 25 — 1 pacote

bl@4.1.0

~~~~text
The MIT License (MIT)
=====================

Copyright (c) 2013-2019 bl contributors
----------------------------------

*bl contributors listed at <https://github.com/rvagg/bl#contributors>*

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
~~~~

#### Texto 26 — 1 pacote

brace-expansion@5.0.9

~~~~text
MIT License

Copyright Julian Gruber <julian@juliangruber.com>

TypeScript port Copyright Isaac Z. Schlueter <i@izs.me>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 27 — 1 pacote

buffer@5.7.1

~~~~text
The MIT License (MIT)

Copyright (c) Feross Aboukhadijeh, and other contributors.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

#### Texto 28 — 6 pacotes

chownr@1.1.4, ini@1.3.8, once@1.4.0, semver@7.8.5, semver@7.8.5, wrappy@1.0.2

~~~~text
The ISC License

Copyright (c) Isaac Z. Schlueter and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
~~~~

#### Texto 29 — 1 pacote

content-disposition@2.0.1

~~~~text
(The MIT License)

Copyright (c) 2014-2017 Douglas Christopher Wilson

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
~~~~

#### Texto 30 — 1 pacote

cookie@1.1.1

~~~~text
(The MIT License)

Copyright (c) 2012-2014 Roman Shtylman <shtylman@gmail.com>
Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
~~~~

#### Texto 31 — 1 pacote

croner@9.1.0

~~~~text
The MIT License (MIT)

Copyright (c) 2015-2021 Hexagon <github.com/Hexagon>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 32 — 4 pacotes

d3-dispatch@3.0.1, d3-force@3.0.0, d3-quadtree@3.0.1, d3-timer@3.0.1

~~~~text
Copyright 2010-2021 Mike Bostock

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
~~~~

#### Texto 33 — 2 pacotes

decompress-response@6.0.0, mimic-response@3.1.0

~~~~text
MIT License

Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
~~~~

#### Texto 34 — 1 pacote

deep-extend@0.6.0

~~~~text
The MIT License (MIT)

Copyright (c) 2013-2018, Viacheslav Lotsmanov

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
~~~~

#### Texto 35 — 1 pacote

depd@2.0.0

~~~~text
(The MIT License)

Copyright (c) 2014-2018 Douglas Christopher Wilson

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
~~~~

#### Texto 36 — 1 pacote

dequal@2.0.3

~~~~text
The MIT License (MIT)

Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

#### Texto 37 — 1 pacote

detect-libc@2.1.2

~~~~text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "{}"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright {yyyy} {name of copyright owner}

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
~~~~

#### Texto 38 — 1 pacote

detect-node-es@1.1.0

~~~~text
MIT License

Copyright (c) 2017 Ilya Kantor

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 39 — 4 pacotes

end-of-stream@1.4.5, pump@3.0.4, tar-fs@2.1.5, tar-stream@2.2.0

~~~~text
The MIT License (MIT)

Copyright (c) 2014 Mathias Buus

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

#### Texto 40 — 1 pacote

escape-html@1.0.3

~~~~text
(The MIT License)

Copyright (c) 2012-2013 TJ Holowaychuk
Copyright (c) 2015 Andreas Lubbe
Copyright (c) 2015 Tiancheng "Timothy" Gu

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
~~~~

#### Texto 41 — 1 pacote

esprima@4.0.1

~~~~text
Copyright JS Foundation and other contributors, https://js.foundation/

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

  * Redistributions of source code must retain the above copyright
    notice, this list of conditions and the following disclaimer.
  * Redistributions in binary form must reproduce the above copyright
    notice, this list of conditions and the following disclaimer in the
    documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
~~~~

#### Texto 42 — 1 pacote

expand-template@2.0.3

~~~~text
The MIT License (MIT)

Copyright (c) 2018 Lars-Magnus Skog

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

#### Texto 43 — 1 pacote

extend-shallow@2.0.1

~~~~text
The MIT License (MIT)

Copyright (c) 2014-2015, Jon Schlinkert.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

#### Texto 44 — 1 pacote

fast-decode-uri-component@1.0.1

~~~~text
MIT License

Copyright (c) 2018 Tomas Della Vedova
Copyright (c) 2017 Justin Ridgewell
Copyright (c) 2008-2009 Bjoern Hoehrmann <bjoern@hoehrmann.de>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 45 — 2 pacotes

fast-deep-equal@3.1.3, json-schema-traverse@1.0.0

~~~~text
MIT License

Copyright (c) 2017 Evgeny Poberezkin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 46 — 1 pacote

fast-json-stringify@7.0.1

~~~~text
MIT License

Copyright (c) 2016-present Matteo Collina
Copyright (c) 2016-present The Fastify team <https://github.com/fastify/fastify#team>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 47 — 1 pacote

fast-querystring@1.1.2

~~~~text
Copyright (c) 2022 Yagiz Nizipli

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
~~~~

#### Texto 48 — 2 pacotes

fast-uri@3.1.6, fast-uri@4.1.3

~~~~text
Copyright (c) 2011-2021, Gary Court until https://github.com/garycourt/uri-js/commit/a1acf730b4bba3f1097c9f52e7d9d3aba8cdcaae
Copyright (c) 2021-present The Fastify team <https://github.com/fastify/fastify#team>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * The names of any contributors may not be used to endorse or promote
      products derived from this software without specific prior written
      permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDERS AND CONTRIBUTORS BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

                                  *   *   *

The complete list of contributors can be found at:
- https://github.com/garycourt/uri-js/graphs/contributors
~~~~

#### Texto 49 — 1 pacote

fastify@5.12.1

~~~~text
MIT License

Copyright (c) 2016-present The Fastify team <https://github.com/fastify/fastify#team>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 50 — 1 pacote

fastq@1.20.3

~~~~text
Copyright (c) 2015-2020, Matteo Collina <matteo.collina@gmail.com>

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
~~~~

#### Texto 51 — 1 pacote

file-uri-to-path@1.0.0

~~~~text
Copyright (c) 2014 Nathan Rajlich <nathan@tootallnate.net>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
~~~~

#### Texto 52 — 1 pacote

find-my-way@9.9.0

~~~~text
MIT License

Copyright (c) 2017-2019 Tomas Della Vedova

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 53 — 1 pacote

fs-constants@1.0.0

~~~~text
The MIT License (MIT)

Copyright (c) 2018 Mathias Buus

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

#### Texto 54 — 1 pacote

get-nonce@1.0.1

~~~~text
MIT License

Copyright (c) 2020 Anton Korzunov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 55 — 2 pacotes

github-from-package@0.0.0, minimist@1.2.8

~~~~text
This software is released under the MIT license:

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
~~~~

#### Texto 56 — 1 pacote

glob@13.0.6

~~~~text
All packages under `src/` are licensed according to the terms in
their respective `LICENSE` or `LICENSE.md` files.

The remainder of this project is licensed under the Blue Oak
Model License, as follows:

-----

# Blue Oak Model License

Version 1.0.0

## Purpose

This license gives everyone as much permission to work with
this software as possible, while protecting contributors
from liability.

## Acceptance

In order to receive this license, you must agree to its
rules.  The rules of this license are both obligations
under that agreement and conditions to your license.
You must not do anything with this software that triggers
a rule that you cannot or will not follow.

## Copyright

Each contributor licenses you to do everything with this
software that would otherwise infringe that contributor's
copyright in it.

## Notices

You must ensure that everyone who gets a copy of
any part of this software from you, with or without
changes, also gets the text of this license or a link to
<https://blueoakcouncil.org/license/1.0.0>.

## Excuse

If anyone notifies you in writing that you have not
complied with [Notices](#notices), you can keep your
license by taking all practical steps to comply within 30
days after the notice.  If you do not do so, your license
ends immediately.

## Patent

Each contributor licenses you to do everything with this
software that would otherwise infringe any patent claims
they can license or become able to license.

## Reliability

No contributor can revoke this license.

## No Liability

***As far as the law allows, this software comes as is,
without any warranty or condition, and no contributor
will be liable to anyone for any damages related to this
software or this license, under any kind of legal claim.***
~~~~

#### Texto 57 — 1 pacote

gray-matter@4.0.3

~~~~text
The MIT License (MIT)

Copyright (c) 2014-2018, Jon Schlinkert.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

#### Texto 58 — 1 pacote

http-errors@2.0.1

~~~~text
The MIT License (MIT)

Copyright (c) 2014 Jonathan Ong me@jongleberry.com
Copyright (c) 2016 Douglas Christopher Wilson doug@somethingdoug.com

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

#### Texto 59 — 1 pacote

ieee754@1.2.1

~~~~text
Copyright 2008 Fair Oaks Labs, Inc.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
~~~~

#### Texto 60 — 1 pacote

inherits@2.0.4

~~~~text
The ISC License

Copyright (c) Isaac Z. Schlueter

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
~~~~

#### Texto 61 — 1 pacote

ipaddr.js@2.5.0

~~~~text
Copyright (C) 2011-2017 whitequark <whitequark@whitequark.org>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

#### Texto 62 — 1 pacote

is-extendable@0.1.1

~~~~text
The MIT License (MIT)

Copyright (c) 2015, Jon Schlinkert.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

#### Texto 63 — 1 pacote

js-tokens@4.0.0

~~~~text
The MIT License (MIT)

Copyright (c) 2014, 2015, 2016, 2017, 2018 Simon Lydell

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

#### Texto 64 — 1 pacote

js-yaml@3.15.2

~~~~text
(The MIT License)

Copyright (C) 2011-2015 by Vitaly Puzrin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

#### Texto 65 — 1 pacote

json-schema-ref-resolver@3.0.0

~~~~text
MIT License

Copyright (c) 2023 Fastify

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 66 — 1 pacote

kind-of@6.0.3

~~~~text
The MIT License (MIT)

Copyright (c) 2014-2017, Jon Schlinkert.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

#### Texto 67 — 1 pacote

light-my-request@6.6.0

~~~~text
Copyright (c) 2017 The Fastify Team
Copyright (c) 2012-2017, Project contributors
Copyright (c) 2012-2014, Walmart
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * The names of any contributors may not be used to endorse or promote
      products derived from this software without specific prior written
      permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDERS AND CONTRIBUTORS BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

                                  *   *   *

The complete list of contributors can be found at:
- https://github.com/hapijs/shot/graphs/contributors
- https://github.com/fastify/light-my-request/graphs/contributors
~~~~

#### Texto 68 — 1 pacote

loose-envify@1.4.0

~~~~text
The MIT License (MIT)

Copyright (c) 2015 Andres Suarez <zertosh@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

#### Texto 69 — 3 pacotes

lru-cache@11.5.2, minipass@7.1.3, path-scurry@2.0.2

~~~~text
# Blue Oak Model License

Version 1.0.0

## Purpose

This license gives everyone as much permission to work with
this software as possible, while protecting contributors
from liability.

## Acceptance

In order to receive this license, you must agree to its
rules.  The rules of this license are both obligations
under that agreement and conditions to your license.
You must not do anything with this software that triggers
a rule that you cannot or will not follow.

## Copyright

Each contributor licenses you to do everything with this
software that would otherwise infringe that contributor's
copyright in it.

## Notices

You must ensure that everyone who gets a copy of
any part of this software from you, with or without
changes, also gets the text of this license or a link to
<https://blueoakcouncil.org/license/1.0.0>.

## Excuse

If anyone notifies you in writing that you have not
complied with [Notices](#notices), you can keep your
license by taking all practical steps to comply within 30
days after the notice.  If you do not do so, your license
ends immediately.

## Patent

Each contributor licenses you to do everything with this
software that would otherwise infringe any patent claims
they can license or become able to license.

## Reliability

No contributor can revoke this license.

## No Liability

***As far as the law allows, this software comes as is,
without any warranty or condition, and no contributor
will be liable to anyone for any damages related to this
software or this license, under any kind of legal claim.***
~~~~

#### Texto 70 — 1 pacote

lucide-react@0.468.0

~~~~text
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
~~~~

#### Texto 71 — 1 pacote

mime@3.0.0

~~~~text
The MIT License (MIT)

Copyright (c) 2010 Benjamin Thomas, Robert Kieffer

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

#### Texto 72 — 1 pacote

minimatch@10.2.6

~~~~text
# Blue Oak Model License

Version 1.0.0

## Purpose

This license gives everyone as much permission to work with
this software as possible, while protecting contributors
from liability.

## Acceptance

In order to receive this license, you must agree to its
rules. The rules of this license are both obligations
under that agreement and conditions to your license.
You must not do anything with this software that triggers
a rule that you cannot or will not follow.

## Copyright

Each contributor licenses you to do everything with this
software that would otherwise infringe that contributor's
copyright in it.

## Notices

You must ensure that everyone who gets a copy of
any part of this software from you, with or without
changes, also gets the text of this license or a link to
<https://blueoakcouncil.org/license/1.0.0>.

## Excuse

If anyone notifies you in writing that you have not
complied with [Notices](#notices), you can keep your
license by taking all practical steps to comply within 30
days after the notice. If you do not do so, your license
ends immediately.

## Patent

Each contributor licenses you to do everything with this
software that would otherwise infringe any patent claims
they can license or become able to license.

## Reliability

No contributor can revoke this license.

## No Liability

**_As far as the law allows, this software comes as is,
without any warranty or condition, and no contributor
will be liable to anyone for any damages related to this
software or this license, under any kind of legal claim._**
~~~~

#### Texto 73 — 1 pacote

mkdirp-classic@0.5.3

~~~~text
The MIT License (MIT)

Copyright (c) 2020 James Halliday (mail@substack.net) and Mathias Buus

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

#### Texto 74 — 1 pacote

napi-build-utils@2.0.0

~~~~text
MIT License

Copyright (c) 2018 inspiredware

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 75 — 1 pacote

node-abi@3.96.0

~~~~text
MIT License

Copyright (c) 2016 Lukas Geiger

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 76 — 2 pacotes

on-exit-leak-free@2.1.2, thread-stream@4.2.0

~~~~text
MIT License

Copyright (c) 2021 Matteo Collina

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 77 — 1 pacote

picocolors@1.1.1

~~~~text
ISC License

Copyright (c) 2021-2024 Oleksii Raspopov, Kostiantyn Denysov, Anton Verinov

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
~~~~

#### Texto 78 — 1 pacote

pino@10.3.1

~~~~text
The MIT License (MIT)

Copyright (c) 2016-2025 Matteo Collina, David Mark Clements and the Pino contributors listed at <https://github.com/pinojs/pino#the-team> and in the README file.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 79 — 1 pacote

pino-abstract-transport@3.0.0

~~~~text
MIT License

Copyright (c) 2021 pino

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 80 — 1 pacote

pino-std-serializers@7.1.0

~~~~text
Copyright Mateo Collina, David Mark Clements, James Sumners

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
~~~~

#### Texto 81 — 1 pacote

prebuild-install@7.1.3

~~~~text
The MIT License (MIT)

Copyright (c) 2015 Mathias Buus

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

#### Texto 82 — 1 pacote

process-warning@4.0.1

~~~~text
MIT License

Copyright (c) Fastify

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 83 — 1 pacote

process-warning@5.1.0

~~~~text
MIT License

Copyright (c) 2020-present The Fastify team <https://github.com/fastify/fastify#team>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 84 — 1 pacote

quick-format-unescaped@4.0.4

~~~~text
The MIT License (MIT)

Copyright (c) 2016-2019 David Mark Clements

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 85 — 1 pacote

rc@1.2.8

~~~~text
[LICENSE.APACHE2]
Apache License, Version 2.0

Copyright (c) 2011 Dominic Tarr

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

[LICENSE.BSD]
Copyright (c) 2013, Dominic Tarr
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

The views and conclusions contained in the software and documentation are those
of the authors and should not be interpreted as representing official policies,
either expressed or implied, of the FreeBSD Project.

[LICENSE.MIT]
The MIT License

Copyright (c) 2011 Dominic Tarr

Permission is hereby granted, free of charge,
to any person obtaining a copy of this software and
associated documentation files (the "Software"), to
deal in the Software without restriction, including
without limitation the rights to use, copy, modify,
merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom
the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR
ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
~~~~

#### Texto 86 — 3 pacotes

react@18.3.1, react-dom@18.3.1, scheduler@0.23.2

~~~~text
MIT License

Copyright (c) Facebook, Inc. and its affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 87 — 1 pacote

react-remove-scroll-bar@2.3.8

~~~~text
(O pacote não inclui arquivo de licença. Licença declarada: MIT. Autor declarado: Anton Korzunov.)
~~~~

#### Texto 88 — 2 pacotes

react-router@7.18.3, react-router-dom@7.18.3

~~~~text
MIT License

Copyright (c) React Training LLC 2015-2019
Copyright (c) Remix Software Inc. 2020-2021
Copyright (c) Shopify Inc. 2022-2023

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 89 — 2 pacotes

readable-stream@3.6.2, string_decoder@1.3.0

~~~~text
Node.js is licensed for use as follows:

"""
Copyright Node.js contributors. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
"""

This license applies to parts of Node.js originating from the
https://github.com/joyent/node repository:

"""
Copyright Joyent, Inc. and other Node contributors. All rights reserved.
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
"""
~~~~

#### Texto 90 — 2 pacotes

real-require@0.2.0, real-require@1.0.0

~~~~text
The MIT License (MIT)

Copyright (c) 2021 Paolo Insogna and the real-require contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 91 — 1 pacote

require-from-string@2.0.2

~~~~text
The MIT License (MIT)

Copyright (c) Vsevolod Strukchinsky <floatdrop@gmail.com> (github.com/floatdrop)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

#### Texto 92 — 1 pacote

ret@0.5.0

~~~~text
MIT License

Copyright (C) 2011 by fent

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

#### Texto 93 — 1 pacote

reusify@1.1.0

~~~~text
The MIT License (MIT)

Copyright (c) 2015-2024 Matteo Collina

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 94 — 1 pacote

rfdc@1.4.1

~~~~text
Copyright 2019 "David Mark Clements <david.mark.clements@gmail.com>"

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
~~~~

#### Texto 95 — 1 pacote

safe-buffer@5.2.1

~~~~text
The MIT License (MIT)

Copyright (c) Feross Aboukhadijeh

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

#### Texto 96 — 1 pacote

safe-regex2@5.1.1

~~~~text
MIT License

Copyright (c) 2019-present The Fastify team <https://github.com/fastify/fastify#team>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 97 — 1 pacote

safe-stable-stringify@2.5.0

~~~~text
The MIT License (MIT)

Copyright (c) Ruben Bridgewater

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 98 — 1 pacote

section-matter@1.0.0

~~~~text
The MIT License (MIT)

Copyright (c) 2017, Jon Schlinkert.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 99 — 1 pacote

secure-json-parse@4.1.0

~~~~text
Copyright (c) 2019, Sideway Inc, and project contributors
Copyright (c) 2019-present The Fastify team
All rights reserved.

The Fastify team members are listed at https://github.com/fastify/fastify#team.

The complete list of contributors can be found at:
- https://github.com/hapijs/bourne/graphs/contributors
- https://github.com/fastify/secure-json-parse/graphs/contributors

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
~~~~

#### Texto 100 — 1 pacote

set-cookie-parser@2.7.2

~~~~text
The MIT License (MIT)

Copyright (c) 2015 Nathan Friedly <nathan@nfriedly.com> (http://nfriedly.com/)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

#### Texto 101 — 1 pacote

setprototypeof@1.2.0

~~~~text
Copyright (c) 2015, Wes Todd

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
~~~~

#### Texto 102 — 2 pacotes

simple-concat@1.0.1, simple-get@4.0.1

~~~~text
The MIT License (MIT)

Copyright (c) Feross Aboukhadijeh

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
~~~~

#### Texto 103 — 1 pacote

sisteransi@1.0.5

~~~~text
MIT License

Copyright (c) 2018 Terkel Gjervig Nielsen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 104 — 1 pacote

sonic-boom@4.2.1

~~~~text
MIT License

Copyright (c) 2017 Matteo Collina

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 105 — 1 pacote

split2@4.2.0

~~~~text
Copyright (c) 2014-2018, Matteo Collina <hello@matteocollina.com>

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
~~~~

#### Texto 106 — 1 pacote

sprintf-js@1.0.3

~~~~text
Copyright (c) 2007-2014, Alexandru Marasteanu <hello [at) alexei (dot] ro>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
* Redistributions of source code must retain the above copyright
  notice, this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright
  notice, this list of conditions and the following disclaimer in the
  documentation and/or other materials provided with the distribution.
* Neither the name of this software nor the names of its contributors may be
  used to endorse or promote products derived from this software without
  specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
~~~~

#### Texto 107 — 1 pacote

statuses@2.0.2

~~~~text
The MIT License (MIT)

Copyright (c) 2014 Jonathan Ong <me@jongleberry.com>
Copyright (c) 2016 Douglas Christopher Wilson <doug@somethingdoug.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

#### Texto 108 — 1 pacote

strip-bom-string@1.0.0

~~~~text
The MIT License (MIT)

Copyright (c) 2015, 2017, Jon Schlinkert

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

#### Texto 109 — 1 pacote

strip-json-comments@2.0.1

~~~~text
The MIT License (MIT)

Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
~~~~

#### Texto 110 — 1 pacote

toad-cache@3.7.4

~~~~text
MIT License

Copyright (c) 2023 Igor Savin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 111 — 1 pacote

toidentifier@1.0.1

~~~~text
MIT License

Copyright (c) 2016 Douglas Christopher Wilson <doug@somethingdoug.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

#### Texto 112 — 1 pacote

tslib@2.8.1

~~~~text
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
~~~~

#### Texto 113 — 1 pacote

tunnel-agent@0.6.0

~~~~text
Apache License

Version 2.0, January 2004

http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

"License" shall mean the terms and conditions for use, reproduction, and distribution as defined by Sections 1 through 9 of this document.

"Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License.

"Legal Entity" shall mean the union of the acting entity and all other entities that control, are controlled by, or are under common control with that entity. For the purposes of this definition, "control" means (i) the power, direct or indirect, to cause the direction or management of such entity, whether by contract or otherwise, or (ii) ownership of fifty percent (50%) or more of the outstanding shares, or (iii) beneficial ownership of such entity.

"You" (or "Your") shall mean an individual or Legal Entity exercising permissions granted by this License.

"Source" form shall mean the preferred form for making modifications, including but not limited to software source code, documentation source, and configuration files.

"Object" form shall mean any form resulting from mechanical transformation or translation of a Source form, including but not limited to compiled object code, generated documentation, and conversions to other media types.

"Work" shall mean the work of authorship, whether in Source or Object form, made available under the License, as indicated by a copyright notice that is included in or attached to the work (an example is provided in the Appendix below).

"Derivative Works" shall mean any work, whether in Source or Object form, that is based on (or derived from) the Work and for which the editorial revisions, annotations, elaborations, or other modifications represent, as a whole, an original work of authorship. For the purposes of this License, Derivative Works shall not include works that remain separable from, or merely link (or bind by name) to the interfaces of, the Work and Derivative Works thereof.

"Contribution" shall mean any work of authorship, including the original version of the Work and any modifications or additions to that Work or Derivative Works thereof, that is intentionally submitted to Licensor for inclusion in the Work by the copyright owner or by an individual or Legal Entity authorized to submit on behalf of the copyright owner. For the purposes of this definition, "submitted" means any form of electronic, verbal, or written communication sent to the Licensor or its representatives, including but not limited to communication on electronic mailing lists, source code control systems, and issue tracking systems that are managed by, or on behalf of, the Licensor for the purpose of discussing and improving the Work, but excluding communication that is conspicuously marked or otherwise designated in writing by the copyright owner as "Not a Contribution."

"Contributor" shall mean Licensor and any individual or Legal Entity on behalf of whom a Contribution has been received by Licensor and subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of this License, each Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright license to reproduce, prepare Derivative Works of, publicly display, publicly perform, sublicense, and distribute the Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of this License, each Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable (except as stated in this section) patent license to make, have made, use, offer to sell, sell, import, and otherwise transfer the Work, where such license applies only to those patent claims licensable by such Contributor that are necessarily infringed by their Contribution(s) alone or by combination of their Contribution(s) with the Work to which such Contribution(s) was submitted. If You institute patent litigation against any entity (including a cross-claim or counterclaim in a lawsuit) alleging that the Work or a Contribution incorporated within the Work constitutes direct or contributory patent infringement, then any patent licenses granted to You under this License for that Work shall terminate as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the Work or Derivative Works thereof in any medium, with or without modifications, and in Source or Object form, provided that You meet the following conditions:

You must give any other recipients of the Work or Derivative Works a copy of this License; and

You must cause any modified files to carry prominent notices stating that You changed the files; and

You must retain, in the Source form of any Derivative Works that You distribute, all copyright, patent, trademark, and attribution notices from the Source form of the Work, excluding those notices that do not pertain to any part of the Derivative Works; and

If the Work includes a "NOTICE" text file as part of its distribution, then any Derivative Works that You distribute must include a readable copy of the attribution notices contained within such NOTICE file, excluding those notices that do not pertain to any part of the Derivative Works, in at least one of the following places: within a NOTICE text file distributed as part of the Derivative Works; within the Source form or documentation, if provided along with the Derivative Works; or, within a display generated by the Derivative Works, if and wherever such third-party notices normally appear. The contents of the NOTICE file are for informational purposes only and do not modify the License. You may add Your own attribution notices within Derivative Works that You distribute, alongside or as an addendum to the NOTICE text from the Work, provided that such additional attribution notices cannot be construed as modifying the License. You may add Your own copyright statement to Your modifications and may provide additional or different license terms and conditions for use, reproduction, or distribution of Your modifications, or for any such Derivative Works as a whole, provided Your use, reproduction, and distribution of the Work otherwise complies with the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise, any Contribution intentionally submitted for inclusion in the Work by You to the Licensor shall be under the terms and conditions of this License, without any additional terms or conditions. Notwithstanding the above, nothing herein shall supersede or modify the terms of any separate license agreement you may have executed with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade names, trademarks, service marks, or product names of the Licensor, except as required for reasonable and customary use in describing the origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or agreed to in writing, Licensor provides the Work (and each Contributor provides its Contributions) on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied, including, without limitation, any warranties or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A PARTICULAR PURPOSE. You are solely responsible for determining the appropriateness of using or redistributing the Work and assume any risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory, whether in tort (including negligence), contract, or otherwise, unless required by applicable law (such as deliberate and grossly negligent acts) or agreed to in writing, shall any Contributor be liable to You for damages, including any direct, indirect, special, incidental, or consequential damages of any character arising as a result of this License or out of the use or inability to use the Work (including but not limited to damages for loss of goodwill, work stoppage, computer failure or malfunction, or any and all other commercial damages or losses), even if such Contributor has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing the Work or Derivative Works thereof, You may choose to offer, and charge a fee for, acceptance of support, warranty, indemnity, or other liability obligations and/or rights consistent with this License. However, in accepting such obligations, You may act only on Your own behalf and on Your sole responsibility, not on behalf of any other Contributor, and only if You agree to indemnify, defend, and hold each Contributor harmless for any liability incurred by, or claims asserted against, such Contributor by reason of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS
~~~~

#### Texto 114 — 1 pacote

util-deprecate@1.0.2

~~~~text
(The MIT License)

Copyright (c) 2014 Nathan Rajlich <nathan@tootallnate.net>

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.
~~~~

#### Texto 115 — 1 pacote

zod@3.25.76

~~~~text
MIT License

Copyright (c) 2025 Colin McDonnell

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~~

## 3. Ferramentas de build (não distribuídas)

Usadas para compilar, testar e empacotar. Nenhuma entra no instalador; por isso aparecem só com nome, versão e licença. Uma ferramenta sob `MPL-2.0` ou `CC-BY-4.0` é aceita aqui e reprovada se virar componente distribuído.

| Pacote | Versão | Licença (SPDX) |
| --- | --- | --- |
| @adobe/css-tools | 4.5.0 | MIT |
| @asamuzakjp/css-color | 6.0.7 | MIT |
| @asamuzakjp/dom-selector | 8.3.2 | MIT |
| @axe-core/playwright | 4.13.0 | MPL-2.0 |
| @babel/code-frame | 7.29.7 | MIT |
| @babel/compat-data | 7.29.7 | MIT |
| @babel/core | 7.29.7 | MIT |
| @babel/generator | 7.29.8 | MIT |
| @babel/helper-compilation-targets | 7.29.7 | MIT |
| @babel/helper-globals | 7.29.7 | MIT |
| @babel/helper-module-imports | 7.29.7 | MIT |
| @babel/helper-module-transforms | 7.29.7 | MIT |
| @babel/helper-string-parser | 7.29.7 | MIT |
| @babel/helper-validator-identifier | 7.29.7 | MIT |
| @babel/helper-validator-option | 7.29.7 | MIT |
| @babel/helpers | 7.29.7 | MIT |
| @babel/parser | 7.29.8 | MIT |
| @babel/runtime | 7.29.7 | MIT |
| @babel/template | 7.29.7 | MIT |
| @babel/traverse | 7.29.8 | MIT |
| @babel/types | 7.29.8 | MIT |
| @bramus/specificity | 2.4.2 | MIT |
| @cacheable/memory | 2.2.0 | MIT |
| @cacheable/utils | 2.5.0 | MIT |
| @csstools/color-helpers | 6.1.1 | MIT-0 |
| @csstools/css-calc | 3.3.0 | MIT |
| @csstools/css-color-parser | 4.2.2 | MIT |
| @csstools/css-parser-algorithms | 4.0.2 | MIT |
| @csstools/css-syntax-patches-for-csstree | 1.1.12 | MIT-0 |
| @csstools/css-tokenizer | 4.0.2 | MIT |
| @csstools/media-query-list-parser | 5.0.2 | MIT |
| @csstools/selector-resolve-nested | 4.0.2 | MIT-0 |
| @csstools/selector-specificity | 6.0.1 | MIT-0 |
| @eslint-community/eslint-utils | 4.10.1 | MIT |
| @eslint-community/regexpp | 4.12.2 | MIT |
| @eslint/config-array | 0.21.2 | Apache-2.0 |
| @eslint/config-helpers | 0.4.2 | Apache-2.0 |
| @eslint/core | 0.17.0 | Apache-2.0 |
| @eslint/eslintrc | 3.3.7 | MIT |
| @eslint/js | 9.39.5 | MIT |
| @eslint/object-schema | 2.1.7 | Apache-2.0 |
| @eslint/plugin-kit | 0.4.1 | Apache-2.0 |
| @exodus/bytes | 1.15.1 | MIT |
| @humanfs/core | 0.19.2 | Apache-2.0 |
| @humanfs/node | 0.16.8 | Apache-2.0 |
| @humanfs/types | 0.15.0 | Apache-2.0 |
| @humanwhocodes/module-importer | 1.0.1 | Apache-2.0 |
| @humanwhocodes/retry | 0.4.3 | Apache-2.0 |
| @jridgewell/gen-mapping | 0.3.13 | MIT |
| @jridgewell/remapping | 2.3.5 | MIT |
| @jridgewell/resolve-uri | 3.1.2 | MIT |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT |
| @jridgewell/trace-mapping | 0.3.31 | MIT |
| @keyv/bigmap | 1.3.1 | MIT |
| @keyv/serialize | 1.1.1 | MIT |
| @nodelib/fs.scandir | 2.1.5 | MIT |
| @nodelib/fs.stat | 2.0.5 | MIT |
| @nodelib/fs.walk | 1.2.8 | MIT |
| @oxc-project/types | 0.147.0 | MIT |
| @playwright/test | 1.62.1 | Apache-2.0 |
| @rolldown/binding-android-arm-eabi | 1.2.6 | MIT |
| @rolldown/binding-android-arm64 | 1.2.6 | MIT |
| @rolldown/binding-darwin-arm64 | 1.2.6 | MIT |
| @rolldown/binding-darwin-x64 | 1.2.6 | MIT |
| @rolldown/binding-freebsd-x64 | 1.2.6 | MIT |
| @rolldown/binding-linux-arm-gnueabihf | 1.2.6 | MIT |
| @rolldown/binding-linux-arm64-gnu | 1.2.6 | MIT |
| @rolldown/binding-linux-arm64-musl | 1.2.6 | MIT |
| @rolldown/binding-linux-ppc64-gnu | 1.2.6 | MIT |
| @rolldown/binding-linux-s390x-gnu | 1.2.6 | MIT |
| @rolldown/binding-linux-x64-gnu | 1.2.6 | MIT |
| @rolldown/binding-linux-x64-musl | 1.2.6 | MIT |
| @rolldown/binding-openharmony-arm64 | 1.2.6 | MIT |
| @rolldown/binding-win32-arm64-msvc | 1.2.6 | MIT |
| @rolldown/binding-win32-x64-msvc | 1.2.6 | MIT |
| @rolldown/pluginutils | 1.0.1 | MIT |
| @rolldown/pluginutils | 1.0.1 | MIT |
| @sindresorhus/merge-streams | 4.0.0 | MIT |
| @standard-schema/spec | 1.1.0 | MIT |
| @testing-library/dom | 10.4.1 | MIT |
| @testing-library/jest-dom | 7.0.1 | MIT |
| @testing-library/react | 16.3.3 | MIT |
| @testing-library/user-event | 14.6.6 | MIT |
| @types/aria-query | 5.0.4 | MIT |
| @types/better-sqlite3 | 7.6.13 | MIT |
| @types/chai | 5.2.3 | MIT |
| @types/d3-force | 3.0.10 | MIT |
| @types/deep-eql | 4.0.2 | MIT |
| @types/estree | 1.0.9 | MIT |
| @types/json-schema | 7.0.15 | MIT |
| @types/node | 22.20.1 | MIT |
| @types/prop-types | 15.7.15 | MIT |
| @types/react | 18.3.31 | MIT |
| @types/react-dom | 18.3.7 | MIT |
| @typescript-eslint/eslint-plugin | 8.69.0 | MIT |
| @typescript-eslint/parser | 8.69.0 | MIT |
| @typescript-eslint/project-service | 8.69.0 | MIT |
| @typescript-eslint/scope-manager | 8.69.0 | MIT |
| @typescript-eslint/tsconfig-utils | 8.69.0 | MIT |
| @typescript-eslint/type-utils | 8.69.0 | MIT |
| @typescript-eslint/types | 8.69.0 | MIT |
| @typescript-eslint/typescript-estree | 8.69.0 | MIT |
| @typescript-eslint/utils | 8.69.0 | MIT |
| @typescript-eslint/visitor-keys | 8.69.0 | MIT |
| @vitejs/plugin-react | 6.1.1 | MIT |
| @vitest/expect | 4.1.11 | MIT |
| @vitest/mocker | 4.1.11 | MIT |
| @vitest/pretty-format | 4.1.11 | MIT |
| @vitest/runner | 4.1.11 | MIT |
| @vitest/snapshot | 4.1.11 | MIT |
| @vitest/spy | 4.1.11 | MIT |
| @vitest/utils | 4.1.11 | MIT |
| acorn | 8.18.0 | MIT |
| acorn-jsx | 5.3.2 | MIT |
| ajv | 6.15.0 | MIT |
| ajv | 6.15.0 | MIT |
| ansi-regex | 5.0.1 | MIT |
| ansi-regex | 6.4.0 | MIT |
| ansi-styles | 4.3.0 | MIT |
| ansi-styles | 4.3.0 | MIT |
| ansi-styles | 5.2.0 | MIT |
| argparse | 2.0.1 | Python-2.0 |
| argparse | 2.0.1 | Python-2.0 |
| aria-query | 5.3.0 | Apache-2.0 |
| aria-query | 5.3.2 | Apache-2.0 |
| array-buffer-byte-length | 1.0.2 | MIT |
| array-includes | 3.1.9 | MIT |
| array.prototype.flat | 1.3.3 | MIT |
| array.prototype.flatmap | 1.3.3 | MIT |
| arraybuffer.prototype.slice | 1.0.4 | MIT |
| assertion-error | 2.0.1 | MIT |
| ast-types-flow | 0.0.8 | MIT |
| astral-regex | 2.0.0 | MIT |
| async-function | 1.0.0 | MIT |
| available-typed-arrays | 1.0.7 | MIT |
| axe-core | 4.13.0 | MPL-2.0 |
| axobject-query | 4.1.0 | Apache-2.0 |
| balanced-match | 1.0.2 | MIT |
| balanced-match | 1.0.2 | MIT |
| balanced-match | 1.0.2 | MIT |
| balanced-match | 1.0.2 | MIT |
| baseline-browser-mapping | 2.11.20 | Apache-2.0 |
| bidi-js | 1.0.3 | MIT |
| brace-expansion | 1.1.18 | MIT |
| brace-expansion | 1.1.18 | MIT |
| brace-expansion | 1.1.18 | MIT |
| brace-expansion | 1.1.18 | MIT |
| braces | 3.0.3 | MIT |
| browserslist | 4.28.8 | MIT |
| cacheable | 2.5.0 | MIT |
| call-bind | 1.0.9 | MIT |
| call-bind-apply-helpers | 1.0.2 | MIT |
| call-bound | 1.0.4 | MIT |
| callsites | 3.1.0 | MIT |
| caniuse-lite | 1.0.30001810 | CC-BY-4.0 |
| chai | 6.2.2 | MIT |
| chalk | 4.1.2 | MIT |
| color-convert | 2.0.1 | MIT |
| color-name | 1.1.4 | MIT |
| colord | 2.10.0 | MIT |
| concat-map | 0.0.1 | MIT |
| convert-source-map | 2.0.0 | MIT |
| cosmiconfig | 9.0.2 | MIT |
| cross-spawn | 7.0.6 | MIT |
| css-functions-list | 3.3.3 | MIT |
| css-tree | 3.2.1 | MIT |
| css.escape | 1.5.1 | MIT |
| cssesc | 3.0.0 | MIT |
| csstype | 3.2.3 | MIT |
| damerau-levenshtein | 1.0.8 | BSD-2-Clause |
| data-urls | 7.0.0 | MIT |
| data-view-buffer | 1.0.2 | MIT |
| data-view-byte-length | 1.0.2 | MIT |
| data-view-byte-offset | 1.0.1 | MIT |
| debug | 4.4.3 | MIT |
| decimal.js | 10.6.0 | MIT |
| deep-is | 0.1.4 | MIT |
| define-data-property | 1.1.4 | MIT |
| define-properties | 1.2.1 | MIT |
| dom-accessibility-api | 0.5.16 | MIT |
| dom-accessibility-api | 0.6.3 | MIT |
| dunder-proto | 1.0.1 | MIT |
| electron-to-chromium | 1.5.420 | ISC |
| emoji-regex | 8.0.0 | MIT |
| emoji-regex | 9.2.2 | MIT |
| entities | 8.0.0 | BSD-2-Clause |
| env-paths | 2.2.1 | MIT |
| error-ex | 1.3.4 | MIT |
| es-abstract | 1.24.2 | MIT |
| es-abstract-get | 1.0.0 | MIT |
| es-define-property | 1.0.1 | MIT |
| es-errors | 1.3.0 | MIT |
| es-module-lexer | 2.3.2 | MIT |
| es-object-atoms | 1.1.2 | MIT |
| es-set-tostringtag | 2.1.0 | MIT |
| es-shim-unscopables | 1.1.0 | MIT |
| es-to-primitive | 1.3.4 | MIT |
| escalade | 3.2.0 | MIT |
| escape-string-regexp | 4.0.0 | MIT |
| eslint | 9.39.5 | MIT |
| eslint-plugin-jsx-a11y | 6.10.2 | MIT |
| eslint-plugin-react-hooks | 7.1.1 | MIT |
| eslint-scope | 8.4.0 | BSD-2-Clause |
| eslint-visitor-keys | 3.4.3 | Apache-2.0 |
| eslint-visitor-keys | 4.2.1 | Apache-2.0 |
| eslint-visitor-keys | 5.0.1 | Apache-2.0 |
| espree | 10.4.0 | BSD-2-Clause |
| esquery | 1.7.0 | BSD-3-Clause |
| esrecurse | 4.3.0 | BSD-2-Clause |
| estraverse | 5.3.0 | BSD-2-Clause |
| estree-walker | 3.0.3 | MIT |
| esutils | 2.0.3 | BSD-2-Clause |
| expect-type | 1.4.0 | Apache-2.0 |
| fast-glob | 3.3.3 | MIT |
| fast-json-stable-stringify | 2.1.0 | MIT |
| fast-levenshtein | 2.0.6 | MIT |
| fastest-levenshtein | 1.0.16 | MIT |
| fdir | 6.5.0 | MIT |
| file-entry-cache | 11.1.5 | MIT |
| file-entry-cache | 8.0.0 | MIT |
| fill-range | 7.1.1 | MIT |
| find-up | 5.0.0 | MIT |
| flat-cache | 4.0.1 | MIT |
| flat-cache | 6.1.23 | MIT |
| flatted | 3.4.4 | ISC |
| for-each | 0.3.5 | MIT |
| fsevents | 2.3.2 | MIT |
| fsevents | 2.3.3 | MIT |
| function-bind | 1.1.2 | MIT |
| function.prototype.name | 1.2.0 | MIT |
| functions-have-names | 1.2.3 | MIT |
| generator-function | 2.0.1 | MIT |
| gensync | 1.0.0-beta.2 | MIT |
| get-east-asian-width | 1.7.0 | MIT |
| get-intrinsic | 1.3.0 | MIT |
| get-proto | 1.0.1 | MIT |
| get-symbol-description | 1.1.0 | MIT |
| glob-parent | 5.1.2 | ISC |
| glob-parent | 6.0.2 | ISC |
| global-modules | 2.0.0 | MIT |
| global-prefix | 3.0.0 | MIT |
| globals | 14.0.0 | MIT |
| globals | 17.12.0 | MIT |
| globalthis | 1.0.4 | MIT |
| globby | 16.2.4 | MIT |
| globjoin | 0.1.4 | MIT |
| gopd | 1.2.0 | MIT |
| has-bigints | 1.1.0 | MIT |
| has-flag | 4.0.0 | MIT |
| has-flag | 5.0.1 | MIT |
| has-property-descriptors | 1.0.2 | MIT |
| has-proto | 1.2.0 | MIT |
| has-symbols | 1.1.0 | MIT |
| has-tostringtag | 1.0.2 | MIT |
| hashery | 1.5.1 | MIT |
| hasown | 2.0.4 | MIT |
| hermes-estree | 0.25.1 | MIT |
| hermes-parser | 0.25.1 | MIT |
| hookified | 1.15.1 | MIT |
| hookified | 2.2.0 | MIT |
| html-encoding-sniffer | 6.0.0 | MIT |
| html-tags | 5.1.0 | MIT |
| husky | 9.1.7 | MIT |
| ignore | 5.3.2 | MIT |
| ignore | 7.0.12 | MIT |
| ignore | 7.0.12 | MIT |
| ignore | 7.0.8 | MIT |
| import-fresh | 3.3.1 | MIT |
| import-meta-resolve | 4.2.0 | MIT |
| imurmurhash | 0.1.4 | MIT |
| indent-string | 4.0.0 | MIT |
| internal-slot | 1.1.0 | MIT |
| is-array-buffer | 3.0.5 | MIT |
| is-arrayish | 0.2.1 | MIT |
| is-async-function | 2.1.1 | MIT |
| is-bigint | 1.1.0 | MIT |
| is-boolean-object | 1.2.2 | MIT |
| is-callable | 1.2.7 | MIT |
| is-data-view | 1.0.2 | MIT |
| is-date-object | 1.1.0 | MIT |
| is-document.all | 1.0.0 | MIT |
| is-extglob | 2.1.1 | MIT |
| is-finalizationregistry | 1.1.1 | MIT |
| is-fullwidth-code-point | 3.0.0 | MIT |
| is-generator-function | 1.1.2 | MIT |
| is-glob | 4.0.3 | MIT |
| is-map | 2.0.3 | MIT |
| is-negative-zero | 2.0.3 | MIT |
| is-number | 7.0.0 | MIT |
| is-number-object | 1.1.1 | MIT |
| is-path-inside | 4.0.0 | MIT |
| is-potential-custom-element-name | 1.0.1 | MIT |
| is-regex | 1.2.1 | MIT |
| is-set | 2.0.3 | MIT |
| is-shared-array-buffer | 1.0.4 | MIT |
| is-string | 1.1.1 | MIT |
| is-symbol | 1.1.1 | MIT |
| is-typed-array | 1.1.15 | MIT |
| is-weakmap | 2.0.2 | MIT |
| is-weakref | 1.1.1 | MIT |
| is-weakset | 2.0.4 | MIT |
| isarray | 2.0.5 | MIT |
| isexe | 2.0.0 | ISC |
| js-yaml | 4.3.2 | MIT |
| js-yaml | 4.3.2 | MIT |
| jsdom | 30.0.1 | MIT |
| jsesc | 3.1.0 | MIT |
| json-buffer | 3.0.1 | MIT |
| json-parse-even-better-errors | 2.3.1 | MIT |
| json-schema-traverse | 0.4.1 | MIT |
| json-schema-traverse | 0.4.1 | MIT |
| json-stable-stringify-without-jsonify | 1.0.1 | MIT |
| json5 | 2.2.3 | MIT |
| jsx-ast-utils | 3.3.5 | MIT |
| keyv | 4.5.4 | MIT |
| keyv | 5.6.0 | MIT |
| keyv | 5.6.0 | MIT |
| keyv | 5.6.0 | MIT |
| language-subtag-registry | 0.3.23 | CC0-1.0 |
| language-tags | 1.0.9 | MIT |
| levn | 0.4.1 | MIT |
| lightningcss | 1.33.0 | MPL-2.0 |
| lightningcss-android-arm64 | 1.33.0 | MPL-2.0 |
| lightningcss-darwin-arm64 | 1.33.0 | MPL-2.0 |
| lightningcss-darwin-x64 | 1.33.0 | MPL-2.0 |
| lightningcss-freebsd-x64 | 1.33.0 | MPL-2.0 |
| lightningcss-linux-arm-gnueabihf | 1.33.0 | MPL-2.0 |
| lightningcss-linux-arm64-gnu | 1.33.0 | MPL-2.0 |
| lightningcss-linux-arm64-musl | 1.33.0 | MPL-2.0 |
| lightningcss-linux-x64-gnu | 1.33.0 | MPL-2.0 |
| lightningcss-linux-x64-musl | 1.33.0 | MPL-2.0 |
| lightningcss-win32-arm64-msvc | 1.33.0 | MPL-2.0 |
| lightningcss-win32-x64-msvc | 1.33.0 | MPL-2.0 |
| lines-and-columns | 1.2.4 | MIT |
| lint-staged | 17.4.1 | MIT |
| locate-path | 6.0.0 | MIT |
| lodash.merge | 4.6.2 | MIT |
| lodash.truncate | 4.4.2 | MIT |
| lru-cache | 5.1.1 | ISC |
| lz-string | 1.5.0 | MIT |
| magic-string | 0.30.21 | MIT |
| math-intrinsics | 1.1.0 | MIT |
| mathml-tag-names | 4.0.0 | MIT |
| mdn-data | 2.27.1 | CC0-1.0 |
| meow | 14.1.0 | MIT |
| merge2 | 1.4.1 | MIT |
| micromatch | 4.0.8 | MIT |
| min-indent | 1.0.1 | MIT |
| minimatch | 3.1.5 | ISC |
| minimatch | 3.1.5 | ISC |
| minimatch | 3.1.5 | ISC |
| minimatch | 3.1.5 | ISC |
| ms | 2.1.3 | MIT |
| nanoid | 3.3.18 | MIT |
| natural-compare | 1.4.0 | MIT |
| node-releases | 2.0.54 | MIT |
| normalize-path | 3.0.0 | MIT |
| object-inspect | 1.13.4 | MIT |
| object-keys | 1.1.1 | MIT |
| object.assign | 4.1.7 | MIT |
| object.fromentries | 2.0.8 | MIT |
| object.values | 1.2.1 | MIT |
| obug | 2.1.4 | MIT |
| optionator | 0.9.4 | MIT |
| own-keys | 1.0.2 | MIT |
| p-limit | 3.1.0 | MIT |
| p-locate | 5.0.0 | MIT |
| parent-module | 1.0.1 | MIT |
| parse-json | 5.2.0 | MIT |
| parse5 | 8.0.1 | MIT |
| path-exists | 4.0.0 | MIT |
| path-key | 3.1.1 | MIT |
| pathe | 2.0.3 | MIT |
| picomatch | 2.3.2 | MIT |
| picomatch | 4.0.7 | MIT |
| playwright | 1.62.1 | Apache-2.0 |
| playwright-core | 1.62.1 | Apache-2.0 |
| possible-typed-array-names | 1.1.0 | MIT |
| postcss | 8.5.26 | MIT |
| postcss-safe-parser | 7.1.0 | MIT |
| postcss-selector-parser | 7.1.6 | MIT |
| postcss-value-parser | 4.2.0 | MIT |
| prelude-ls | 1.2.1 | MIT |
| prettier | 3.9.6 | MIT |
| pretty-format | 27.5.1 | MIT |
| punycode | 2.3.1 | MIT |
| qified | 0.10.1 | MIT |
| queue-microtask | 1.2.3 | MIT |
| react-is | 17.0.2 | MIT |
| redent | 3.0.0 | MIT |
| reflect.getprototypeof | 1.0.10 | MIT |
| regexp.prototype.flags | 1.5.4 | MIT |
| resolve-from | 4.0.0 | MIT |
| rolldown | 1.2.6 | MIT |
| run-parallel | 1.2.0 | MIT |
| safe-array-concat | 1.1.4 | MIT |
| safe-push-apply | 1.0.0 | MIT |
| safe-regex-test | 1.1.0 | MIT |
| saxes | 6.0.0 | ISC |
| semver | 6.3.1 | ISC |
| semver | 7.8.5 | ISC |
| set-function-length | 1.2.2 | MIT |
| set-function-name | 2.0.2 | MIT |
| set-proto | 1.0.0 | MIT |
| shebang-command | 2.0.0 | MIT |
| shebang-regex | 3.0.0 | MIT |
| side-channel | 1.1.1 | MIT |
| side-channel-list | 1.0.1 | MIT |
| side-channel-map | 1.0.1 | MIT |
| side-channel-weakmap | 1.0.2 | MIT |
| siginfo | 2.0.0 | ISC |
| signal-exit | 4.1.0 | ISC |
| slash | 5.1.0 | MIT |
| slice-ansi | 4.0.0 | MIT |
| source-map-js | 1.2.1 | BSD-3-Clause |
| stackback | 0.0.2 | MIT |
| std-env | 4.2.0 | MIT |
| stop-iteration-iterator | 1.1.0 | MIT |
| string-argv | 0.3.2 | MIT |
| string-width | 4.2.3 | MIT |
| string-width | 8.3.0 | MIT |
| string.prototype.includes | 2.0.1 | MIT |
| string.prototype.trim | 1.2.11 | MIT |
| string.prototype.trimend | 1.0.10 | MIT |
| string.prototype.trimstart | 1.0.8 | MIT |
| strip-ansi | 6.0.1 | MIT |
| strip-ansi | 7.2.0 | MIT |
| strip-indent | 3.0.0 | MIT |
| strip-json-comments | 3.1.1 | MIT |
| stylelint | 17.16.0 | MIT |
| stylelint-config-recommended | 18.0.0 | MIT |
| stylelint-config-standard | 40.0.0 | MIT |
| supports-color | 10.2.2 | MIT |
| supports-color | 7.2.0 | MIT |
| supports-hyperlinks | 4.6.0 | MIT |
| svg-tags | 1.0.0 | MIT (override) |
| symbol-tree | 3.2.4 | MIT |
| table | 6.9.0 | BSD-3-Clause |
| tinybench | 2.9.0 | MIT |
| tinyexec | 1.3.0 | MIT |
| tinyglobby | 0.2.17 | MIT |
| tinyrainbow | 3.1.1 | MIT |
| tldts | 7.4.11 | MIT |
| tldts-core | 7.4.11 | MIT |
| to-regex-range | 5.0.1 | MIT |
| tough-cookie | 6.0.2 | BSD-3-Clause |
| tr46 | 6.0.0 | MIT |
| ts-api-utils | 2.5.0 | MIT |
| type-check | 0.4.0 | MIT |
| typed-array-buffer | 1.0.3 | MIT |
| typed-array-byte-length | 1.0.3 | MIT |
| typed-array-byte-offset | 1.0.4 | MIT |
| typed-array-length | 1.0.8 | MIT |
| typescript | 5.9.3 | Apache-2.0 |
| typescript-eslint | 8.69.0 | MIT |
| unbox-primitive | 1.1.0 | MIT |
| undici | 8.10.1 | MIT |
| undici-types | 6.21.0 | MIT |
| unicorn-magic | 0.4.1 | MIT |
| update-browserslist-db | 1.3.2 | MIT |
| uri-js | 4.4.1 | BSD-2-Clause |
| vite | 8.2.2 | MIT |
| vite | 8.2.2 | MIT |
| vitest | 4.1.11 | MIT |
| w3c-xmlserializer | 5.0.0 | MIT |
| webidl-conversions | 8.0.1 | BSD-2-Clause |
| whatwg-mimetype | 5.0.0 | MIT |
| whatwg-url | 16.0.1 | MIT |
| whatwg-url | 17.1.0 | MIT |
| which | 1.3.1 | ISC |
| which | 2.0.2 | ISC |
| which-boxed-primitive | 1.1.1 | MIT |
| which-builtin-type | 1.2.1 | MIT |
| which-collection | 1.0.2 | MIT |
| which-typed-array | 1.1.22 | MIT |
| why-is-node-running | 2.3.0 | MIT |
| word-wrap | 1.2.5 | MIT |
| write-file-atomic | 7.0.1 | ISC |
| xml-name-validator | 5.0.0 | Apache-2.0 |
| xmlchars | 2.2.0 | MIT |
| yallist | 3.1.1 | ISC |
| yaml | 2.9.0 | ISC |
| yocto-queue | 0.1.0 | MIT |
| zod-validation-error | 4.0.2 | MIT |

