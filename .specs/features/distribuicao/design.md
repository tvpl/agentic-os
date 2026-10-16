# Distribuição — telas do shell (design, binding para `ui`)

O Command Centre não muda. As duas telas novas são as do próprio shell, páginas estáticas em
`apps/desktop/ui/` (`index.html`, `shell.css`, `shell.js`, `icon.png`), carregadas do disco pelo Tauri com uma
política de conteúdo `default-src 'none'`. O desenho segue as regras de `.specs/features/design-system/design.md`
(binding): cor só por token, nenhum texto abaixo de 12px, texto corrido a partir de 13px, estado nunca só por
cor, foco visível, AA de contraste, `prefers-reduced-motion`.

## Arranjo (uma coluna, centrada, na ordem do DOM)

`main.shell` contém, nesta ordem: o ícone (`img.mark`, decorativo, `alt=""`), a seção ativa (`#starting` **ou**
`#failure`, nunca as duas) e a linha de versão (`p.version`).

- `#starting` (`role="status"`): spinner (`aria-hidden`), `h1`, um parágrafo, e, depois de 10 s, uma nota (`#slow`).
- `#failure` (`role="alert"`): `h1` (em `--danger`, com o sinal ⚠ antes do texto: o estado não é só cor), um
  parágrafo de explicação, `p.detail` (`Detail: <code>`), `details` com a cauda do serviço (só se houver linhas) e
  `div.actions` com **Try again** (`#retry`, primário, recebe o foco quando a tela aparece) e **Quit** (`#quit`,
  secundário), nessa ordem.

## Estados

| Estado         | O que a tela mostra                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------- |
| iniciando      | `#starting` visível, `#failure` oculta; sem botões (sair é fechar a janela)                    |
| falha          | `#failure` visível, `#starting` oculta; uma sentença por tipo de falha, em inglês ou português |
| pronto         | a janela deixa de mostrar esta página (o shell navega para o Command Centre)                   |
| vazio          | n/a: a tela não lista nada                                                                     |
| não autorizado | n/a: o serviço local recusa quem não tem token; esta página não tem login                      |

## Texto (binding): título e explicação por tipo de falha

A língua vem de `navigator.language` (`pt…` → português, o resto → inglês). Os textos são `textContent`, nunca HTML.
A cauda do serviço é mostrada como veio, em `<pre>`, e a falha de tipo desconhecido usa o texto de `crashed`.

| `kind`            | English                                                                                                                                                                                             | Português                                                                                                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payload_missing` | **The app is incomplete** — Part of the installed app is missing, so the local service cannot start. Reinstall MordomoOS.                                                                           | **O app está incompleto** — Falta uma parte do app instalado, então o serviço local não consegue iniciar. Reinstale o MordomoOS.                                                                              |
| `spawn_failed`    | **The local service could not be started** — The system refused to run the Node bundled with the app. Reinstall MordomoOS; if it keeps happening, check your security software.                     | **Não foi possível iniciar o serviço local** — O sistema recusou executar o Node que vem com o app. Reinstale o MordomoOS; se continuar, verifique o seu software de segurança.                               |
| `home_in_use`     | **MordomoOS is already running** — Another MordomoOS service is using your data folder (a login service, a terminal session or another copy of the app). Stop it with "mordomo stop" and try again. | **O MordomoOS já está rodando** — Outro serviço do MordomoOS está usando a sua pasta de dados (um serviço de login, uma sessão de terminal ou outra cópia do app). Pare-o com "mordomo stop" e tente de novo. |
| `home_blocked`    | **Your data folder needs attention** — A restore left files in your data folder that must be cleared by hand. Run "mordomo doctor" in a terminal for the steps.                                     | **A sua pasta de dados precisa de atenção** — Uma restauração deixou arquivos na sua pasta de dados que precisam ser limpos à mão. Rode "mordomo doctor" num terminal para ver os passos.                     |
| `port_busy`       | **A local port is taken** — MordomoOS could not get a free local port. Close the program that is using it and try again.                                                                            | **Uma porta local está ocupada** — O MordomoOS não conseguiu uma porta local livre. Feche o programa que a usa e tente de novo.                                                                               |
| `crashed`         | **The local service stopped while starting** — It ended before it was ready. The detail and, when there is one, the note under "What the service wrote" say why.                                    | **O serviço local parou ao iniciar** — Ele terminou antes de ficar pronto. O detalhe e, quando houver, a nota em "O que o serviço escreveu" dizem o motivo.                                                   |
| `timeout`         | **The local service is taking too long** — It did not answer within 30 seconds. Try again.                                                                                                          | **O serviço local está demorando demais** — Ele não respondeu em 30 segundos. Tente de novo.                                                                                                                  |
| `bad_ready`       | **The local service answered in a way the app does not understand** — The app and the service may be different versions. Reinstall MordomoOS.                                                       | **O serviço local respondeu de um jeito que o app não entende** — O app e o serviço podem ser de versões diferentes. Reinstale o MordomoOS.                                                                   |
| `ui_not_served`   | **The Command Centre did not load** — The local service is running but does not serve the interface. Reinstall MordomoOS.                                                                           | **O Command Centre não carregou** — O serviço local está rodando, mas não serve a interface. Reinstale o MordomoOS.                                                                                           |
| `stopped`         | **The local service stopped** — It was running and it ended. Try again.                                                                                                                             | **O serviço local parou** — Ele estava rodando e terminou. Tente de novo.                                                                                                                                     |

Rótulos fixos: iniciando — "Starting MordomoOS…" / "Iniciando o MordomoOS…", corpo "The local service is starting. This
takes a few seconds." / "O serviço local está iniciando. Leva alguns segundos."; nota lenta "Still starting. The first launch
prepares your data folder." / "Ainda iniciando. A primeira abertura prepara a sua pasta de dados."; "Detail" / "Detalhe";
"What the service wrote" / "O que o serviço escreveu"; botões "Try again" / "Tentar de novo" e "Quit" / "Sair"; versão
"Version 0.8.0" / "Versão 0.8.0".

## Menu nativo

Em inglês, como os do sistema: **MordomoOS** (About com versão e licença; "Check for Updates…" só numa compilação com
atualizador; Quit; no macOS Services, Hide), **Edit** (Undo, Redo, Cut, Copy, Paste, Select All), **View** (Reload; no
macOS tela cheia), **Window** (Minimize, Maximize fora do macOS, Close). Sem barra de ferramentas, sem bandeja.

## Endereços da janela (aditivo, rodada 2)

Não é uma tela; é o que a pessoa vê quando um clique tenta sair do Command Centre. O veredito é `nav.rs`
(`on_navigation`, `on_new_window`): o que for de outra origem vai para o navegador do sistema e a janela fica onde está.
Um clique em `<a target="_blank">` chega ao mesmo veredito por `window.open`, por um script da janela. Se um início
falha com a janela fora da tela do shell (a atualização que falhou ao instalar e cujo reinício também falhou), a janela
volta para a tela de falha. **Limite dito:** `http(s)://tauri.localhost` é permitido em todos os sistemas (é a origem das
páginas do próprio app só no Windows); no Linux e no macOS é um nome da porta 80 desta máquina. Pergunta 20 do dono.
