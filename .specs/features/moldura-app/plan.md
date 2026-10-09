# Moldura de app — um segundo shell completo, alternável com o Núcleo

## Problem

O MordomoOS tem um único shell, o Núcleo imersivo: cenas trocadas por tecla (1-5, `[`, `]`), uma
espinha só de ícones (`nucleo/ModuleSpine.tsx`), até duas lâminas flutuantes e o Console na base
(`nucleo/index.tsx`). É o diferencial visual do produto, mas quem chega não acha onde estão as
coisas: não há navegação com rótulos, não há uma página inicial que diga o que pede atenção hoje, e
a conversa disputa espaço com a cena. A análise de 06/10/2026 apontou isso como a maior barreira
para venda (achado D1, "curva de aprendizado do shell").

O dono decidiu (AD-005, 06/10/2026) ter dois shells completos e alternáveis nas preferências: a
moldura de app (barra lateral, lista/detalhe, conversa fixa à direita, página "Hoje") e o Núcleo.
As views clássicas (`desktop/apps.tsx` `APPS`) já rendem sozinhas numa área de conteúdo, e o
`Console` já tem um modo empilhado; falta a moldura, a página "Hoje" e a troca.

Evidência: mapeamento das telas de 06/10/2026 (nesta sessão); decisão AD-005.

## Flow

Reutiliza `APPS` (`desktop/apps.tsx`, exists), o `Console` (`desktop/console/Console.tsx`, exists),
os widgets de `desktop/registry.tsx` (exists), a paleta (`components/CommandPalette.tsx`, exists),
`DesktopActionsProvider` (`desktop/actions.tsx`, exists) e as preferências da interface
(`contracts/src/preferences.ts`, exists).

1. Escolha → `UiPreferences.shell` (door 1) diz qual shell monta. `App.tsx` (exists) `OsShell` lê
   a preferência e rende `Nucleo` ou `Moldura`; paleta, ajuda de atalhos, ProviderGate, banner de
   saúde e caixa de notificações continuam compartilhados.
2. Moldura → `moldura/Moldura.tsx` (new) monta as quatro regiões do design (barra lateral, barra
   superior, conteúdo, conversa) e um `DesktopActionsProvider` próprio: `openRun` navega para
   `/runs/:id`, `openDoc` abre a gaveta de documento (`DocWindow`, exists), `openApp` navega para a
   rota do app, `openPanel` de um instrumento leva a Hoje; o sino abre `InboxList`
   (`desktop/widgets/InboxWidget.tsx`, exists) e o botão Skills da conversa abre o `SkillDeck`
   (`desktop/SkillDeck.tsx`, exists), sem ⌘J.
3. Conteúdo → a rota escolhe a view de `APPS` (como `appForPath`), dentro de `.page`; `/` rende a
   página Hoje (`moldura/Today.tsx`, new) com os seis widgets do design.
4. Conversa → o `Console` (exists) em modo `stacked` na coluna direita; gaveta modal em viewport estreita.
5. Troca → controle segmentado em `views/settings/theme.tsx` (exists) e uma ação na paleta; os dois
   gravam `shell` por `api.putUiPreferences` e o `OsShell` troca sem recarregar. A rota
   (`apps/api/src/routes/system.ts`, exists) valida `shell` estrito na escrita (sem o `.catch`).
6. Padrão → uma instalação nova abre na moldura; quem já tinha um `ui-preferences.json` de antes
   da feature (sem a chave `shell`) lê `nucleo`, e quem migra de `settings.json` v1 recebe
   `shell: "nucleo"` na migração (door 2). `UiPreferencesStore.load` decide: a chave ausente num
   arquivo que existe é "casa de antes"; todo `save()` grava a chave.
7. Primeira pintura → `moldura/shell.ts` (new) `useShell` decide o shell enquanto a preferência viaja:
   a resposta do servidor manda; antes dela (ou se ela falhar) vale o último shell visto neste
   navegador, espelhado em `localStorage` como o preset de tema; sem espelho, um esqueleto neutro
   (nunca uma página vazia nem um palpite) e, se a requisição falhar, a moldura com nova tentativa
   quieta. Uma falha nunca troca um usuário do Núcleo para a moldura.
8. Modais → as duas gavetas (conversa estreita, documento) e a barra lateral estreita aberta usam
   `components/dialog.tsx` (`useDialog`), no lugar: foco entra, o resto fica `inert`, Esc fecha a
   de cima, o foco volta. O que `desktop/shellActions.ts` guarda (rodar skill, skills em
   execução, `@ref`, eventos de painel) é comum aos dois shells.

## Impact

| Front       | What changes                                                                                                                                                    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | novo termo: `shell` - qual interface monta: `moldura` (barra lateral, conteúdo, conversa à direita) ou `nucleo` (cenas imersivas)                               |
| contrato    | `UiPreferences` ganha `shell`; `GET/PUT /api/ui-preferences` passam a levá-lo (a rota já aceita o schema parcial)                                               |
| contrato    | a paleta ganha uma ação de troca e esconde "Open panel" e "organizar" na moldura                                                                                |
| stored data | `ui-preferences.json`: campo novo `shell`; um arquivo existente sem o campo lê `nucleo` (casa de antes), sem arquivo lê `moldura`; a migração v1 grava `nucleo` |

## Relations

| Data                          | Change                       | Existing rows                                                                                                                                                                              | Reversible                                 |
| ----------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `ui-preferences.json` `shell` | campo novo, padrão `moldura` | arquivos criados pela migração v1→v2 recebem `nucleo`; arquivos que existem sem o campo (escritos antes da feature) leem `nucleo` e o ganham no próximo `save()`; sem arquivo lê `moldura` | sim - o campo é ignorado por código antigo |

## Surface

| Route                     | In               | Out                       | Status |
| ------------------------- | ---------------- | ------------------------- | ------ |
| `GET /api/ui-preferences` | -                | inclui `shell`            | `200`  |
| `PUT /api/ui-preferences` | `{ shell }`      | o documento com `shell`   | `200`  |
| `PUT /api/ui-preferences` | `{ shell: "x" }` | `error.code` `validation` | `400`  |

## Landing

| One-way door         | Literal shape                                                                                                                                                                                                                                                     | Alternative rejected                                                                                                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Campo de shell    | `UiPreferences.shell: "moldura" \| "nucleo"`, padrão `"moldura"`; um valor desconhecido lido do disco vira o padrão (`.catch`), como os outros campos de apresentação                                                                                             | Rota por shell (`/app/...` e `/nucleo/...`): dobraria cada link profundo e quebraria os links de notificações e do Telegram, que apontam para `/runs/:id`                                                                     |
| 2. Padrão por origem | instalação nova (sem `ui-preferences.json`) → `moldura`; `ui-preferences.json` que existe sem a chave `shell` → `nucleo` (todo `save()` grava a chave, então ausência só vem de antes da feature); migração v1 → `nucleo` gravado; valor desconhecido → `moldura` | Todo mundo para a moldura, ou o padrão do schema (`moldura`) para arquivo sem a chave: quem já usa o Núcleo, inclusive quem migrou ou rodou o Setup antes desta feature, acordaria numa interface diferente sem ter escolhido |

- Nothing else in this change is hard to reverse

## Criteria

### S1: A moldura e suas regiões (P1)

**Acceptance Criteria**

1. WHILE `shell` is `moldura`, the app SHALL render exactly four regions: a left `nav` (sidebar), a `header` (top bar) above a `main` (content) in the centre column, and a right `aside` (chat), as in `design.md` Tela 1
2. The sidebar SHALL list, in this order, the main group (Today, Runs, Skills, Routines, Memory), the group titled "More" (Connectors, Artifacts, Generations, Pixel Studio), then Settings, with the labels of `design.md` in the interface language, each linking to its route, and the current item SHALL carry `aria-current="page"`
3. WHEN approvals are pending THEN the Today item SHALL show their count; WHEN none THEN no count
4. WHEN the collapse button is pressed THEN the sidebar SHALL show icons only, each with its label as accessible name
5. The top bar SHALL show, in order, the page title (`h1`, the active item's label, also on a detail route), the search button that opens the palette with the shortcut hint, the notifications bell and the "Chat" toggle
6. WHEN the "Chat" toggle or ⌘. / Ctrl . is pressed THEN the chat column SHALL hide or show, and the choice SHALL survive a reload
7. WHILE the viewport is narrower than 900 px, the sidebar SHALL start as a 60 px icon rail that unfolds over the content (an overlay, never pushing it) and the chat SHALL open as a drawer over the content; each is a modal dialog (AC 19) that Esc closes
8. WHILE `shell` is `moldura`, the Núcleo keys (1-5, `[`, `]`, `/`, `p`, ⌘J, ⌘F, ⌘⇧A, ⌘⇧D) SHALL do nothing

**Independent test:** com `shell: "moldura"`, a tela tem as quatro regiões e a barra lateral os dez itens na ordem.

### S2: O conteúdo e a página Hoje (P1)

**Acceptance Criteria**

9. WHEN a sidebar item is followed THEN the content region SHALL render that app's existing view (`APPS[kind].Component`), and deep routes (`/runs/:id`, `/skills/:slug`, `/settings?tab=…`) SHALL render their detail
10. WHEN `/` is open in the frame THEN the content SHALL show the Today page: a heading with "Today"/"Hoje" and the long date, and six cards in the order and with the titles of `design.md` Tela 2, each rendering its widget
11. WHILE the content column is at least 720 px wide (a container query on the centre column, not the viewport), the Today cards SHALL sit in two columns; below that, in one column, in the same order
12. WHEN a run is opened from anywhere in the frame (chat, palette, a card) THEN the app SHALL navigate to `/runs/:id`; WHEN a document is opened THEN a drawer with the document viewer and a "Close" button SHALL open over the content

**Independent test:** em `/`, a moldura mostra os seis cartões na ordem; clicar em Execuções leva à lista de execuções.

### S3: A troca de shell (P1)

**Acceptance Criteria**

13. The UI preferences SHALL carry `shell` (door 1): `GET /api/ui-preferences` on a new home SHALL return `moldura`; `PUT` with `{ shell: "nucleo" }` SHALL answer `200` and with `{ shell: "x" }` SHALL answer `400 validation`
14. WHEN a v1 `settings.json` is migrated THEN the new `ui-preferences.json` SHALL hold `shell: "nucleo"`; WHEN a `ui-preferences.json` exists without a `shell` key THEN `GET` SHALL return `nucleo` and a `PUT` of another field SHALL write `shell: "nucleo"` into the file; WHEN there is no file THEN `moldura`; WHEN the value is unknown THEN `moldura` (door 2)
15. The appearance settings tab SHALL show the "Interface" segmented control above the presets, with the options "App frame" and "Immersive Núcleo" in that order and the current one marked
16. WHEN another option is chosen there, or the palette's switch action is run THEN the preference SHALL be saved and the other shell SHALL mount without a page reload
17. WHILE `shell` is `moldura`, the palette SHALL offer "Switch to the immersive Núcleo" and SHALL NOT offer "Open panel" nor the arrange action; WHILE `nucleo`, it SHALL offer "Switch to the app frame"

**Independent test:** trocar em Configurações › Aparência troca a interface na hora, e a escolha volta depois de recarregar.

### S4: Robustez da moldura (P1) — veio da revisão de qualidade

**Acceptance Criteria**

18. WHILE the preferences request is pending or has failed, the app SHALL show the last shell seen on this browser (mirrored in `localStorage`); WITH no mirror it SHALL show a skeleton while pending and the frame once the request has failed, retrying quietly; the server's answer, once there, SHALL be the shell shown, and a failed or retried request SHALL NOT unmount a shell already shown
19. WHILE a drawer (chat under 900 px, document) or the unfolded narrow sidebar is open, it SHALL be a dialog: focus moves into it, everything behind it is `inert`, Tab stays inside, Esc closes the topmost one (a palette over it first), focus returns to what opened it, and the shell does not recede (`data-depth`) behind it
20. WHEN a page is left (a link, a run, an app, a skill form, an instrument, the palette) THEN the document drawer SHALL close; WHEN `openPanel` gets an id that is no page or drawer THEN nothing SHALL happen
21. The bell SHALL name its unread count, the Today item its pending count (also folded), the sidebar button SHALL keep one name with `aria-expanded`, and the search button SHALL keep its name when its text is not drawn
22. The frame SHALL show one top-level heading per page (the top bar's `h1`; a view's own `h1` steps down to level 2), and a landmark nested in a region (the settings menu) SHALL be labelled and count as part of that region
23. WHEN the address is no place of the frame THEN the app SHALL replace it by `/` (Today)
24. WHILE `shell` is `moldura`, Settings SHALL NOT offer the tour button
25. The frame SHALL read (text contrast of at least 4.5:1 for the links, titles and card titles) in dark and light for each of the five presets, and mount without console errors
26. The two shells SHALL share one implementation of launching a skill, in-flight runs, `@ref` of a panel and the panel events; the frame's actions SHALL keep their identity across its renders

**Independent test:** com o servidor lento ou fora do ar, quem usa o Núcleo nunca vê a moldura; numa janela estreita a conversa aberta prende o foco e Esc a fecha devolvendo-o.

## Out of scope

| Excluded                                      | Why                                                                                                                                                                                                                                                                                          |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tour de boas-vindas na moldura                | os passos apontam elementos do Núcleo; na moldura o tour não abre, e o botão "Tour" de Configurações some nela (ver Assumptions). Quem instala já na moldura conta com o assistente de Setup; um tour guiado da moldura é seguimento da feature 12                                           |
| Ajuda de atalhos (`?`) por shell              | a folha lista as teclas do Núcleo (1-5, `[` `]`, `/`, ⌘F, ⌘⇧A/D) que na moldura não fazem nada e não lista ⌘. - a ajuda dirigida pelo registro de comandos é a feature 11; remendar a folha aqui duplicaria o que ela substitui. Até lá a moldura herda a folha como está (lacuna conhecida) |
| Um tour/boas-vindas guiado na moldura         | feature 12; depende dos passos do tour apontarem para as regiões da moldura                                                                                                                                                                                                                  |
| Registro de comandos e atalhos por escopo     | feature 11; aqui a moldura só liga os três atalhos do design                                                                                                                                                                                                                                 |
| Redesenho das views clássicas                 | feature 10 (design-system); aqui elas entram como estão                                                                                                                                                                                                                                      |
| Remover o Núcleo, widgets ou cérebros antigos | feature 12 (limpeza), agora com os dois shells como alvo                                                                                                                                                                                                                                     |

## Assumptions

| Assumption                              | Chosen default                                      | Rationale                                                                    | Confirmed? |
| --------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- | ---------- |
| Tour na moldura                         | não abre e o botão "Tour" some de Configurações     | evita um tour apontando para o vazio e um botão morto                        | n          |
| Endereço desconhecido na moldura        | vai para `/` (Hoje) sem aviso                       | a moldura só tem as páginas da barra lateral; um 404 não ensina nada         | n          |
| Shell enquanto a preferência viaja      | último shell visto neste navegador; senão esqueleto | evita o lampejo do shell errado e a tela vazia (regra em `moldura/shell.ts`) | n          |
| Estado da barra recolhida e da conversa | `localStorage` por navegador                        | é conveniência de quem está olhando, não preferência da instalação           | n          |
| Ícone de Hoje                           | `Sun` do lucide                                     | os outros vêm de `APPS`                                                      | n          |

**Open questions:** none - all resolved or logged above.

## Observable

| Surface                            | Decision             | Landing                                     |
| ---------------------------------- | -------------------- | ------------------------------------------- |
| screen `Moldura`                   | composition and copy | AC 1-8, `design.md` Tela 1                  |
| screen `Hoje`                      | composition and copy | AC 10-11, `design.md` Tela 2                |
| screen `Configurações › Aparência` | new control          | AC 15, `design.md` Tela 3                   |
| screen `Paleta`                    | actions per shell    | AC 17, `design.md` Tela 4                   |
| API `GET/PUT /api/ui-preferences`  | response shape       | AC 13                                       |
| API (todas)                        | who may call it      | existing - regra de auth das features 1 e 7 |

## Sources

- `.specs/features/moldura-app/design.md` - **binding**: composição, ordem, contagem e textos das quatro telas
- AD-005 em `.specs/STATE.md` - a decisão do dono
- Mapeamento das telas de 06/10/2026 (nesta sessão)
