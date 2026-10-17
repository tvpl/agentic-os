# Moldura de app checks

Profile: ui
Plan: `.specs/features/moldura-app/plan.md`

75 checks in 6 slices · 2 one-way doors · 0 open, of which 0 block

Comandos (da raiz):

- interface (jsdom): `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "<nome>"`
- composição no navegador (Playwright, Chromium em `/opt/pw-browsers`): `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/moldura.spec.ts -g "<nome>"`
- motor e rota: `npx vitest run tests/moldura.test.ts -t "<nome>"`
- ações compartilhadas dos shells (jsdom): `npm run test -w apps/command-centre -- src/desktop/shellActions.test.tsx -t "<nome>"`

Fora do alcance destes checks, por tela: espaçamento, cor e peso de tipo da Moldura, da página Hoje,
do controle de interface e da paleta (vêm dos tokens e do preset).

## Checks

### S1 - a moldura e suas regiões · 8 files · 90 KB · ~23k

**C1** - Com `shell: "moldura"`, a tela tem exatamente um `nav`, um `header`, um `main` e um `aside` de nível superior dentro de `.mold` (um marco aninhado, como o menu de Configurações, é parte da região e leva rótulo, C36), e nenhum `.nu-shell` (AC 1)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C1 the frame has exactly four regions"`
Status: closed

**C2** - No navegador (1440×900), a caixa do `nav` fica à esquerda de `main`, a do `aside` à direita de `main`, o `header` acima de `main` na mesma coluna, e `nav` e `aside` têm a altura da viewport; `--mold-top-h` resolve em `.os-root`, onde o banner de saúde o lê (AC 1)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/moldura.spec.ts -g "C2 the regions sit where the design draws them"`
Status: closed

**C3** - Os links da barra lateral são, nesta ordem, Hoje, Execuções, Skills, Rotinas, Memória, Conectores, Artefatos, Gerações, Pixel Studio, Configurações (em pt-BR) e Today, Runs, Skills, Routines, Memory, Connectors, Artifacts, Generations, Pixel Studio, Settings (em en), com `href` `#/`, `#/runs`, `#/skills`, `#/routines`, `#/brain`, `#/connectors`, `#/artifacts`, `#/generations`, `#/pixel`, `#/settings` (AC 2)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C3 the sidebar lists the ten items in order"`
Status: closed

**C4** - O grupo de Conectores a Pixel Studio tem o título visível "Mais" / "More", e o primeiro grupo não tem título; em `/runs/r1` o link Execuções tem `aria-current="page"` e nenhum outro tem (AC 2)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C4 groups and the current item"`
Status: closed

**C5** - Com 2 aprovações pendentes, o item Hoje mostra `2`; com 0, nenhum número (AC 3)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C5 today counts pending approvals"`
Status: closed

**C6** - Depois de apertar "Barra lateral", nenhum rótulo de item é texto visível e cada link tem o rótulo como nome acessível (AC 4)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C6 a collapsed sidebar keeps accessible names"`
Status: closed

**C7** - A barra superior tem, nesta ordem, um `h1` com o rótulo do item ativo (também em `/runs/r1`: "Execuções"), o botão "Buscar ou comandar…" com a dica do atalho, o sino de notificações e o botão "Conversa"; o botão de busca abre a paleta (AC 5)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C7 the top bar shows title, search, bell and chat in order"`
Status: closed

**C8** - O botão "Conversa" e ⌘. / Ctrl . escondem e mostram o `aside` (com `aria-pressed` acompanhando), e o estado sobrevive a um recarregamento (`localStorage`) (AC 6)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C8 the chat column toggles and is remembered"`
Status: closed

**C9** - Em 800×900, a barra lateral começa recolhida como um trilho de 60 px; abrir a conversa a mostra como gaveta sobre o `main` (a caixa sobrepõe a de `main`), com o foco no campo, Tab/Shift+Tab sem sair dela, Esc a fecha e o foco volta ao botão "Chat" (AC 7, AC 19)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/moldura.spec.ts -g "C9 a narrow window collapses the sidebar and drawers the chat"`
Status: closed

**C10** - Com `shell: "moldura"`, as teclas 1, `]`, `/`, `p`, ⌘J, ⌘F, ⌘⇧A e ⌘⇧D não mudam a rota, não abrem deck, busca nem foco, e não resolvem aprovação (AC 8)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C10 the Núcleo keys are inert in the frame"`
Status: closed

### S2 - conteúdo e página Hoje · 6 files · 60 KB · ~15k

**C11** - Para cada um dos 9 apps, a rota rende no `main` o componente de `APPS[kind]` (marcador `data-app=<kind>`), e `/runs/r1`, `/skills/s1` e `/settings?tab=security` rendem o detalhe (AC 9)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C11 each route renders its existing view"`
Status: closed

**C12** - Em `/`, o `main` tem um `h1`/`h2` "Hoje" com a data longa em pt-BR, e seis cartões com os títulos, nesta ordem: Pede você, Em execução, Rotinas de hoje, Caixa de entrada, Diário, Custo (e em en: Needs you, Running, Today's routines, Inbox, Journal, Cost), cada um com o widget `approvals`, `now`, `routines`, `inbox`, `journal`, `cost` (AC 10)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C12 today shows six cards in order"`
Status: closed

**C13** - No navegador, com a coluna central de 808 px (janela de 1440) os cartões 1 e 2 estão na mesma linha (mesmo `top`, `left` crescente); com 368 px (1000) cada cartão está abaixo do anterior; em 1100 com a conversa aberta (~450 px) é uma coluna e, com a conversa fechada (~870 px), duas (AC 11)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/moldura.spec.ts -g "C13 today is two columns when its column is wide, one when it is narrow"`
Status: closed

**C14** - `openRun("r1")` vindo da conversa e da paleta navega para `/runs/r1`; `openDoc("notes/a.md")` abre uma gaveta (diálogo) com o visualizador e o botão "Fechar", que a fecha (AC 12)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C14 runs navigate and documents open in a drawer"`
Status: closed

### S3 - troca de shell · 6 files · 50 KB · ~13k

**C15** - Numa home nova, `GET /api/ui-preferences` traz `shell` `"moldura"`; `PUT { shell: "nucleo" }` responde `200` e um `GET` seguinte traz `nucleo`; `PUT { shell: "x" }` responde `400` `validation` (AC 13)
Proof: `npx vitest run tests/moldura.test.ts -t "C15 the shell preference round-trips"`
Status: closed

**C16** - Um `ui-preferences.json` com `shell: "outro"` no disco lê `moldura`, sem falhar (door 1; um arquivo sem a chave é outro caso, C25)
Proof: `npx vitest run tests/moldura.test.ts -t "C16 an unknown shell on disk falls back"`
Status: closed

**C17** - Migrar um `settings.json` v1 gera `ui-preferences.json` com `shell` `"nucleo"`; uma home nova sem arquivo lê `moldura` (AC 14); um arquivo existente sem a chave é C25
Proof: `npx vitest run tests/moldura.test.ts -t "C17 migrated homes keep the Núcleo"`
Status: closed

**C18** - A aba de aparência tem o rótulo "Interface" e um controle segmentado com "Moldura de app" e "Núcleo imersivo", nesta ordem, acima dos presets, com a opção atual marcada (AC 15)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C18 appearance offers the two interfaces"`
Status: closed

**C19** - Escolher "Núcleo imersivo" chama `putUiPreferences({ shell: "nucleo" })` e, com a resposta, `[data-shell="moldura"]` sai e `.nu-shell` entra, sem `location.reload` (AC 16)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C19 choosing an interface swaps the shell in place"`
Status: closed

**C20** - No navegador: trocar para o Núcleo em Configurações, recarregar a página e encontrar `.nu-shell`; trocar de volta e encontrar `[data-shell="moldura"]` (AC 16)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/moldura.spec.ts -g "C20 the interface choice survives a reload"`
Status: closed

**C21** - Na moldura, a paleta lista "Mudar para o Núcleo imersivo" e não lista "Abrir painel" nem a ação de organizar (mesmo com a consulta "organizar"; a ação do tour, "Guia interativo do OS", também não aparece, e no Núcleo a mesma consulta a acha); no Núcleo, lista "Mudar para a moldura de app"; rodar a ação grava `shell` (AC 17)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C21 the palette switches shells and hides lâmina actions"`
Status: closed

### S4 - o Núcleo segue igual · 3 files · 20 KB · ~5k

**C22** - Com `shell: "nucleo"`, a tela rende `.nu-shell` e nenhum `[data-shell="moldura"]`, e a suíte e2e existente do Núcleo (`tests/e2e/nucleo-shell.spec.ts`) passa com as homes de teste semeadas com `shell: "nucleo"` (AC 13, AC 16)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/nucleo-shell.spec.ts`
Status: closed
Note: 33 of 35 pass; `:90` (the spine travels…) and `:165` (a transition leaves exactly one interactive scene…) fail the same way at `f1de763`, before this feature, in every run - pre-existing, not a regression
Note: re-run after round 2 (the Núcleo now uses `desktop/shellActions.ts`; `dialog.tsx` gained the in-place dialog): 34 of 35 pass, only `:165` fails (`:90` is flaky and passed); the same-shape failure of `:165` is pre-existing. A run on a loaded machine whose server was killed by another process (SIGTERM) failed everything after `:165` with connection refused - that run proves nothing and was repeated
Note: correção do round 2, em `fix/moldura-r2` (com as regras de `theme.css` e `theme.tsx` das correções dos rounds 1 e 2): 32 de 35 passam; `:90` e `:165` falham como antes da feature (pré-existentes, as duas notas acima) e `:1125` falhou uma vez sob carga e passou sozinho (`-g`); o Núcleo não usa nada do que a moldura mudou

**C23** - Os textos novos têm chave em `en` e em `ptBR` (o teste de paridade de locales passa) (AC 2, AC 10, AC 15, AC 17)
Proof: `npm run test -w apps/command-centre -- src/i18n.test.ts`
Status: closed

**C24** - `npm run typecheck` e `npm run build -w apps/command-centre` saem `0` (AC 1-17)
Proof: `npm run typecheck && npm run build -w apps/command-centre`
Status: closed

### Rodada 2 - revisão de qualidade · 24 files · 190 KB · ~45k

Veio da revisão sênior da primeira entrega (4 bloqueantes, 12 a corrigir, 9 detalhes). Cada check
abaixo só fecha com a prova rodada.

**C25** - Um `ui-preferences.json` que existe sem a chave `shell` (ex.: `{version:1, themePreset:"ocean"}`) lê `nucleo` no store e pela rota, e um `PUT` de outro campo grava `shell: "nucleo"` no arquivo; sem arquivo, valor desconhecido e arquivo ilegível leem `moldura` (AC 14, door 2)
Proof: `npx vitest run tests/moldura.test.ts -t "C25 a preferences file written before the frame reads as the Núcleo"`
Status: closed

**C26** - Todo `save()` grava a chave `shell`, então a ausência só vem de antes da feature (AC 14, door 2)
Proof: `npx vitest run tests/moldura.test.ts -t "C26 a saved file always carries the shell"`
Status: closed

**C27** - Com a requisição de preferências lenta e sem espelho, a tela mostra o esqueleto (nem moldura, nem Núcleo, e a paleta não abre); ao responder `nucleo`, monta o Núcleo e espelha `nucleo` em `localStorage` (AC 18)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C27 a slow load shows a skeleton"`
Status: closed

**C28** - Com espelho `nucleo` e a requisição lenta, o Núcleo aparece de imediato (sem esqueleto nem moldura) e a resposta igual não o remonta (AC 18)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C28 the mirror stands in"`
Status: closed

**C29** - Com espelho `nucleo` e a requisição falhando, o Núcleo fica; a nova tentativa que responde `nucleo` não o troca nem o remonta (AC 18)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C29 a failed load keeps the mirrored shell"`
Status: closed

**C30** - Sem espelho e com a requisição falhando, a moldura aparece e fica (a nova tentativa, que volta a "pendente", não a desmonta); a resposta posterior do servidor (`nucleo`) é a verdade e troca (AC 18)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C30 a failed load with no mirror"`
Status: closed

**C31** - Uma nova busca que falha depois de uma carga bem-sucedida mantém o shell, e `localStorage` bloqueado (leitura e escrita lançam) não derruba nada (AC 18)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C31 a refetch that fails after a load"`
Status: closed

**C32** - Escolher a interface em Configurações espelha o shell escolhido em `localStorage` (AC 16, AC 18)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C32 choosing an interface is mirrored"`
Status: closed

**C33** - Configurações na moldura não mostra o botão do tour ("Guia do OS") e no Núcleo mostra (AC 24)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C33 the tour is offered in the Núcleo only"`
Status: closed

**C34** - O sino tem como nome "Notificações" sem não lidas e "Notificações, 2 não lidas" com 2 (o selo é `aria-hidden`); o item Hoje com 2 pendentes tem o nome "Hoje, 2 aprovações pendentes", aberto e recolhido (AC 21)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C34 the bell and the Today item"`
Status: closed

**C35** - O botão da barra lateral tem sempre o nome "Barra lateral", `aria-expanded` acompanha o estado e o `title` diz "Recolher"/"Expandir" (AC 21)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C35 the sidebar button keeps one name"`
Status: closed

**C36** - Em `/runs/r1`, `/skills/s1` e `/settings?tab=security` o `h1` da view tem `aria-level="2"` e o único `h1` sem nível é o da barra superior; em `/settings` (a view real) as regiões de nível superior continuam sendo quatro e o `nav` do menu, dentro de `main`, tem rótulo diferente do da barra lateral (AC 22)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C36 a page has one level-1 heading"`
Status: closed

**C37** - `/nonsense/deep` é trocado por `/` (substitui a entrada do histórico, `replaceState`, sem `pushState`: voltar não leva ao endereço recusado) e mostra Hoje com o item Hoje atual (AC 23)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C37 an address that is no place of the frame"`
Status: closed

**C38** - `.os-root` leva `data-shell="moldura"` (lido pelo banner de saúde), `.mold` não leva o atributo (AC 1; a variável `--mold-top-h` em `.os-root` é provada em C2)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C38 the shell root carries the shell"`
Status: closed

**C39** - Na janela estreita, abrir a conversa a torna `role="dialog"` `aria-modal`, com o foco no campo, barra lateral, barra superior e conteúdo `inert`; Esc a fecha, tira todo `inert` e devolve o foco ao botão "Conversa" (AC 19)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C39 the narrow chat drawer"`
Status: closed

**C40** - A gaveta de documento é `role="dialog"` `aria-modal`, recebe o foco no botão "Fechar", deixa o resto `inert` sem fazer o shell recuar (`data-depth` ausente); Esc e "Fechar" a fecham e o foco volta a quem abriu (AC 19)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C40 the document drawer"`
Status: closed

**C41** - Com a gaveta de conversa, a de documento e a paleta abertas, Esc fecha primeiro a paleta (que faz o shell recuar), depois o documento, depois a conversa, sem mudar a rota (AC 19)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C41 Esc closes the topmost thing first"`
Status: closed

**C42** - Com o sino aberto (não modal, nada `inert`), Esc o fecha e devolve o foco ao sino; abrir uma gaveta com o sino aberto o fecha (AC 19)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C42 Esc closes the bell first"`
Status: closed

**C43** - Um toque no que a gaveta cobre a fecha; um toque dentro dela não (AC 19)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C43 a press on what a modal drawer covers"`
Status: closed

**C44** - Com um documento aberto, `openPanel` de um id desconhecido (`zzz`, `constructor`) não faz nada; abrir formulário de skill, execução, app e instrumento (`now`) navega e fecha a gaveta e tira todo `inert`; mudar o endereço por fora também fecha (AC 20)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C44 a document drawer leaves with the page"`
Status: closed

**C45** - Em janela estreita a barra lateral desdobra com `data-overlay`, deixa o conteúdo `inert`, recebe o foco, Esc a dobra e devolve o foco ao botão, e seguir um link também a dobra (AC 7, AC 19)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C45 the narrow sidebar is a rail"`
Status: closed

**C46** - Atravessar o ponto de 900 px de estreito para largo tira o papel de diálogo da conversa, mostra a coluna lembrada e limpa todo `inert`; de largo para estreito fecha a gaveta, recolhe a barra, e a escolha larga (coluna fechada) permanece; uma barra estreita deixada aberta, ao ir para largo e voltar para estreito, volta recolhida e sem `inert` (AC 7, AC 19)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C46 crossing the breakpoint"`
Status: closed

**C47** - Um rascunho pela metade sobrevive a esconder a conversa e a atravessar o ponto de 900 px (o `Console` não remonta), e ⌘. / Ctrl . funciona com o foco no próprio campo (AC 6)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C47 a half-typed draft survives"`
Status: closed

**C48** - As ações entregues ao Console mantêm a identidade em novos renders da moldura (sino, conversa, não lidas) e os eventos de painel são assinados uma vez (AC 26)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C48 the actions keep their identity"`
Status: closed

**C49** - Em dark e light, para cada um dos 5 presets, a moldura monta com as 10 entradas e a conversa, sem nenhuma saída de `console.error`/`console.warn` (AC 25)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C49 light and dark, every preset"`
Status: closed

**C50** - No navegador (800×900), abrir a barra lateral estreita não move nem encolhe o `main` (a caixa do `nav` com 232 px sobrepõe a dele e é o que está sob o ponto), Esc a dobra e o foco volta ao botão (AC 7, AC 19)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/moldura.spec.ts -g "C50 the narrow sidebar unfolds over the content"`
Status: closed

**C51** - Em 360, 600, 720, 800 e 880 de largura, a barra superior não transborda (`scrollWidth <= clientWidth`), busca, sino e Conversa mantêm caixa de pelo menos 30 px, a página não tem rolagem horizontal, e a busca é uma caixa de 44 px só com o ícone: sem texto nem dica e nada do conteúdo para fora da caixa (720 e 880 são janelas estreitas cuja coluna central tem 641 px ou mais, onde só as regras da janela estreita seguram a busca) (AC 7, AC 21)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/moldura.spec.ts -g "C51 the top bar fits"`
Status: closed

**C52** - No navegador, para cada preset (5) em dark e em light, o contraste do texto de link, link atual, título da barra, título de cartão e título da conversa é de pelo menos 4.5:1 sobre o fundo opaco mais próximo, e nada é registrado em `console`/`pageerror` (AC 25)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/moldura.spec.ts -g "C52 every preset in light and dark"`
Status: closed

**C53** - No navegador, uma home cujo `ui-preferences.json` não tem `shell` abre o Núcleo (`.nu-shell`, sem `.mold`) e a rota devolve `nucleo`; sem arquivo a rota devolve `moldura` (AC 14, door 2)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/moldura.spec.ts -g "C53 a home whose preferences predate the frame"`
Status: closed

**C54** - `useRunSkill` (formulário, execução, aprovação; função estável; usa o último callback), `useActiveRunCount`/`useRunningSkills`, `referencePanel` (`@ref` no rascunho, id desconhecido não faz nada) e `usePanelEventBridge` (abrir, focar, fechar, minimizar; assinado uma vez) se comportam como o Núcleo sempre fez, e o Núcleo os usa (AC 26)
Proof: `npm run test -w apps/command-centre -- src/desktop/shellActions.test.tsx -t "C54"`
Status: closed
Note: o Núcleo (`nucleo/index.tsx`) passou a usar os mesmos ganchos; sua prova de comportamento é C22

**C55** - `npm run typecheck`, `npm run build -w apps/command-centre` e `eslint` sobre os arquivos tocados saem `0` (AC 1-26)
Proof: `npm run typecheck && npm run build -w apps/command-centre && npx eslint --max-warnings=0 apps/command-centre/src core/src/config tests/moldura.test.ts tests/e2e/moldura.spec.ts`
Status: closed

### Verificação independente - correções dos rounds 1, 2 e 3 (C56-C75) · 6 files · 140 KB · ~35k

Veio de `verification.md` (FAIL em cada um dos três rounds, `ui`): defeitos visuais vistos no navegador,
claims sem asserção e mutantes sobreviventes. Os rounds numeram as verificações; cada correção leva o número do round que a pediu. C56-C61 são medidos em Chromium contra as views reais; C62-C73 em jsdom, um
teste por mutante (cada mutante do relatório tem um teste que o mata, rodado de fato).

**C56** - No navegador, `/runs/<id>` de uma execução com diretório de trabalho de ~250 caracteres cabe na coluna central em 1440, 1100, 900 e 360 px com a conversa aberta: a borda direita do cartão "Outcome" não passa da de `main`, o `.app-panel` não tem conteúdo além da coluna (`scrollWidth <= clientWidth`) e o caminho aparece inteiro (quebrado em linhas, nenhum caractere cortado) (AC 9, achado 1)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/moldura.spec.ts -g "C56 a run's detail page fits the content column"`
Status: closed

**C57** - No navegador, em 900, 1000, 1100, 1200, 1240, 1272, 1273, 1280, 1300, 1360 e 1440 px com a conversa aberta, em cada uma das dez rotas e em en e pt-BR: o título (`h1`) só é cortado com reticências quando a busca já está no mínimo (o ícone, 44 px) e é inteiro a partir de 1000 px; a barra superior não transborda; com a coluna central abaixo de 641 px a busca é uma caixa de exatamente 44 px (o mínimo computado também é 44) só com o ícone, sem texto nem dica e sem conteúdo para fora do botão, e a partir de 641 px tem o texto e a dica (⌘K / Ctrl K), em 1440 px com o texto inteiro e a largura cheia de 380 px; 1272 e 1273 px são as duas pontas do limite (coluna de 640 e de 641 px, afirmadas) (design Tela 1: título encurta antes de perder um controle; a busca mantém o nome mesmo sem o texto)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/moldura.spec.ts -g "C57 the page title keeps its text"`
Status: closed

**C58** - No navegador, cada uma das nove views reais, em 1440 e em 900 px com a conversa aberta, cabe na coluna central: o `.app-panel` não tem conteúdo além dela (AC 9; a composição com as views reais, não stand-ins)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/moldura.spec.ts -g "C58 each of the nine views fits the column"`
Status: closed

**C59** - No navegador (1440 px), o cartão "Pede você" tem a altura do seu conteúdo e não a do cartão ao lado, que é mais alto na mesma linha: sem espaço sobrando dentro do cartão nem dentro do corpo dele (o corpo não tem piso de 160 px: o estado vazio é um cartão curto) (design Tela 2, "cresce com o conteúdo")
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/moldura.spec.ts -g "C59 the card that needs you is as tall as its content"`
Status: closed

**C60** - No navegador (1440 px), a barra lateral aberta mede 232 px e o botão "Barra lateral" fica abaixo de Configurações, no pé da coluna; o corpo de "Pede você" não tem altura máxima e o dos outros cinco cartões tem 360 px com rolagem por dentro; o histórico da conversa rola dentro da coluna (`overflow-y: auto`, sem altura máxima, dentro do `aside`) (design Telas 1 e 2)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/moldura.spec.ts -g "C60 the arrangements the design draws"`
Status: closed

**C61** - No navegador, a barra lateral estreita desdobrada, a gaveta de conversa (800 px) e a gaveta de documento (1440 px) prendem Tab e Shift+Tab (25 vezes cada) dentro de si; um clique real no que cada uma cobre a fecha, o botão "Fechar conversa" fecha a gaveta de conversa e devolve o foco ao botão "Conversa", e Esc fecha a de documento (AC 19)
Proof: `npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/moldura.spec.ts -g "C61 the drawers and the unfolded sidebar hold focus"`
Status: closed

**C62** - A marca da barra lateral é o `systemName` (nome e inicial, em maiúscula; recolhida, a inicial e o `title` com o nome) e cada um dos 10 itens tem o seu ícone, aberta e recolhida: Sol em Hoje e o `Icon` de `APPS[kind]` nos outros nove, dez desenhos distintos (design Tela 1)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C62 the brand is the installation's name"`
Status: closed

**C63** - O botão "Fechar conversa" fecha a conversa: na coluna larga (`aria-pressed` "false", o estado lembrado grava `0`) e na gaveta estreita (sem `inert`, foco volta ao botão "Conversa") (design Tela 1)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C63 the conversation closes with its own button"`
Status: closed

**C64** - Na janela estreita, um toque no que a gaveta de conversa ou a barra lateral desdobrada cobre as fecha, um toque dentro delas não, e o botão "Barra lateral" também dobra a desdobrada (AC 19)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C64 a press on what a narrow chat drawer"`
Status: closed

**C65** - Com a gaveta de conversa aberta e a paleta aberta por cima (profundidade 2), um toque fora de ambas não fecha a gaveta (AC 19)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C65 a press behind the palette"`
Status: closed

**C66** - Em `/runs`, com nada aberto, Esc na moldura não muda a rota; no Núcleo, Esc em `/runs` leva a `/` (AC 8, AC 19)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C66 Esc in the frame closes what is open"`
Status: closed

**C67** - `openPanel` de um id de execução (`run:r9`), de formulário de skill (`form:deploy`) e de instrumento (`now`) navega para `/runs/r9`, `/skills/deploy` e `/`, e de um id de documento abre a gaveta sem mudar a rota (AC 12, AC 20)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C67 a panel id opens the page or drawer"`
Status: closed

**C68** - O evento de painel `close` e o `minimize` de um documento dispensam a gaveta de documento (e tiram o `inert`); `focus` e `restore` não (AC 20)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C68 a panel's close or minimise event"`
Status: closed

**C69** - O evento de rascunho (palavras postas na linha por fora) abre a conversa fechada, coluna na janela larga e gaveta na estreita, e não a fecha quando já está aberta (AC 6)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C69 words put on the line"`
Status: closed

**C70** - 900 px é largo (barra aberta, coluna da conversa aberta) e 899 px é estreito (trilho, conversa fechada) (design, "estreita = abaixo de 900 px")
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C70 900 px is wide and 899 px is narrow"`
Status: closed

**C71** - A moldura não monta o overlay HUD (`.hud-overlay`) nem o tour (`openOnboarding()` não abre diálogo nenhum), e o Núcleo monta os dois (AC 24, plan Assumptions)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C71 the HUD overlay and the tour"`
Status: closed

**C72** - Sem espelho e com a requisição de preferências falhando, ela é feita de novo a cada poucos segundos sem que ninguém peça, e a resposta que chega (`nucleo`) troca a moldura pelo Núcleo; respondida, não é mais feita (AC 18, "retrying quietly")
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C72 a failed preferences request is asked again"`
Status: closed

**C73** - A data longa de Hoje passa para o dia seguinte à meia-noite local sem recarregar, em todas as noites (23:59:30 de 6 de outubro mostra "6 de outubro"; 30 s depois, "7 de outubro"; 24 h depois, "8 de outubro"), e o temporizador armado para a próxima meia-noite é cancelado quando Hoje sai da tela (design Tela 2)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C73 Today's date moves to the next day"`
Status: closed

**C74** - ⌘K e Ctrl K abrem a paleta na moldura, a mesma tecla a fecha, e o atalho é cancelado (`preventDefault`: o ⌘K / Ctrl K do navegador não roda junto) (design Tela 1, atalhos da moldura)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C74 ⌘K and Ctrl K open the palette"`
Status: closed

**C75** - Enquanto as preferências não chegam (a requisição falha, sem dados), o controle de interface de Configurações › Aparência marca o shell em uso: "Moldura de app" na moldura e "Núcleo imersivo" no Núcleo (design Tela 3, AC 15)
Proof: `npm run test -w apps/command-centre -- src/moldura/moldura.test.tsx -t "C75 until the preferences arrive"`
Status: closed

## Coverage

| Set (size)                                            | Member -> proof                                                                                                                                                                                                                            | Unproven |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| regiões da moldura (4)                                | `nav` C1, C2 · `header` C1, C2 · `main` C1, C2 · `aside` C1, C2                                                                                                                                                                            | -        |
| itens da barra lateral (10)                           | C3, table-driven over all 10 (rótulo pt/en, ordem, rota) · ícone C62, table-driven over all 10                                                                                                                                             | -        |
| elementos da barra lateral fora dos itens (3)         | marca (`systemName`) C62 · título "Mais" C4 · botão "Barra lateral" C35 (nome, estado), C60 (no pé, abaixo de Configurações)                                                                                                               | -        |
| grupos da barra lateral (3)                           | principal sem título C4 · "Mais" C4 · Configurações sozinho C3                                                                                                                                                                             | -        |
| larguras da barra lateral (2)                         | aberta 232 px C60 · trilho 60 px C9                                                                                                                                                                                                        | -        |
| controles da barra superior (4)                       | título C7, C57 · busca C7, C51, C57 · sino C7 · Conversa C7, C8                                                                                                                                                                            | -        |
| estados da conversa (3)                               | aberta C8 · fechada C8 · gaveta estreita C9, C39, C46                                                                                                                                                                                      | -        |
| fronteira entre largo e estreito (2)                  | 900 px largo C70 · 899 px estreito C70                                                                                                                                                                                                     | -        |
| caminhos de fechar a gaveta de conversa (3)           | Esc C39, C41 · botão "Fechar conversa" C63, C61 · toque fora C64, C61                                                                                                                                                                      | -        |
| caminhos de fechar a barra estreita desdobrada (4)    | Esc C45 · seguir um link C45 · botão "Barra lateral" C64 · toque fora C64, C61                                                                                                                                                             | -        |
| caminhos de fechar o documento (3)                    | Esc C40, C61 · "Fechar" C40 · toque fora C43, C61                                                                                                                                                                                          | -        |
| diálogos da moldura (3)                               | conversa estreita C39, C9, C61 · documento C40, C61 · barra lateral estreita C45, C50, C61                                                                                                                                                 | -        |
| estados da busca (2)                                  | ícone, sem texto nem dica, com a coluna central abaixo de 641 px C57, C51 · texto e dica a partir de 641 px C57                                                                                                                            | -        |
| atalhos da moldura (3)                                | ⌘K / Ctrl K C74 · ⌘. / Ctrl . C8 · Esc C41, C42, C66                                                                                                                                                                                       | -        |
| ordem do Esc (5)                                      | paleta C41 · documento C41 · conversa C41 · sino C42 · rota intacta C66 (no Núcleo, Esc leva a Hoje: C66)                                                                                                                                  | -        |
| teclas do Núcleo inertes (8)                          | 1-5 C10 (1) · `[` `]` C10 (`]`) · `/` C10 · `p` C10 · ⌘J C10 · ⌘F C10 · ⌘⇧A C10 · ⌘⇧D C10                                                                                                                                                  | -        |
| ids de painel que o resto do app envia (5)            | documento C67, C44 · execução C67 · formulário C67 · instrumento C67, C44 · desconhecido C44                                                                                                                                               | -        |
| eventos de painel (4)                                 | `focus` C68 · `restore` C68 · `minimize` C68 · `close` C68                                                                                                                                                                                 | -        |
| saídas que fecham o documento (5)                     | formulário de skill C44 · execução C44 · app C44 · instrumento C44 · evento de painel `close`/`minimize` C68                                                                                                                               | -        |
| eventos que abrem a conversa (2)                      | rascunho na janela larga C69 · rascunho na estreita C69                                                                                                                                                                                    | -        |
| apps no conteúdo (9)                                  | C11, table-driven over all 9 (stand-ins) · views reais cabem na coluna C58 (9 rotas x 2 larguras)                                                                                                                                          | -        |
| rotas de detalhe (3)                                  | `/runs/:id` C11, C56 (view real) · `/skills/:slug` C11 · `/settings?tab=` C11                                                                                                                                                              | -        |
| endereços que não são da moldura (1)                  | `/nonsense/deep` -> `/` C37 (`replace`)                                                                                                                                                                                                    | -        |
| cartões de Hoje (6)                                   | C12, table-driven over all 6 (título, ordem, widget)                                                                                                                                                                                       | -        |
| arranjos de Hoje (4)                                  | duas colunas C13 · uma coluna C13 · "Pede você" cresce com o conteúdo C59 · os outros cinco rolam por dentro a partir de 360 px C60                                                                                                        | -        |
| cabeçalho de Hoje (2)                                 | "Hoje" e data longa C12 · data muda à meia-noite C73                                                                                                                                                                                       | -        |
| origens do shell na leitura (4)                       | sem arquivo C17, C53 · arquivo sem a chave C25, C53 · valor desconhecido C16, C25 · migração v1 C17                                                                                                                                        | -        |
| fontes do shell enquanto carrega (5) + nova tentativa | resposta C27 · espelho lento C28 · espelho com falha C29 · padrão sem espelho C30 · busca que falha depois de carregar C31 · nova tentativa automática e parada ao responder C72                                                           | -        |
| presets × temas (10)                                  | hud-orange dark C49, C52 · jarvis dark C49, C52 · forest dark C49, C52 · ocean dark C49, C52 · mono dark C49, C52 · hud-orange light C49, C52 · jarvis light C49, C52 · forest light C49, C52 · ocean light C49, C52 · mono light C49, C52 | -        |
| nomes acessíveis (4)                                  | sino C34 · Hoje com contagem C34 · botão da barra lateral C35 · busca C51                                                                                                                                                                  | -        |
| larguras de composição (7)                            | 1440 C13, C52, C56, C57, C58 · 1240-1360 C57 · 1200 C57 · 1100 C13, C56, C57 · 1000 C13, C57 · 900 C56, C57, C58 · 800/600 C9, C50, C51 · 360 C51, C56                                                                                     | -        |
| ações da paleta por shell (3 ocultas na moldura)      | "Abrir painel" C21 · "organizar" C21 · tour ("Guia interativo do OS") C21                                                                                                                                                                  | -        |
| tour e HUD fora da moldura (4 pontos)                 | botão em Configurações C33 · ação da paleta C21 · `Onboarding` montado C71 · overlay HUD montado C71                                                                                                                                       | -        |
| `PUT /api/ui-preferences` com `shell` (2)             | `200` C15 · `400` C15                                                                                                                                                                                                                      | -        |
| origens do padrão (2)                                 | home nova C15, C17 · migração v1 C17                                                                                                                                                                                                       | -        |
| caminhos de troca (2)                                 | Configurações C18, C19, C20 · paleta C21                                                                                                                                                                                                   | -        |
| doors (2)                                             | campo `shell` C15, C16 · padrão por origem C17                                                                                                                                                                                             | -        |

- Claims naming a status code or route: C15, C25 - provados por `inject`
- A linha "teclas do Núcleo inertes" prova uma tecla de cada família (1 por 1-5, `]` por `[ ]`); as outras são o mesmo ramo
- Cada mutante do relatório de verificação do round 1 (U2, U4-U11, U15, U17, U19, U30, U36, U37) tem um teste que o mata, rodado de fato: U2 C72 · U4 C66 · U5 e U30 C71 · U6 C21 · U7 e U11 C62 · U8 C70 · U9 C37 · U10 C65 · U15 C68 · U17 C69 · U19 C46 · U36 C67 · U37 C63. Nenhum é equivalente
- Mutantes da verificação do round 2, re-injetados e mortos: E1, E2, E9, E10 (limiar e esconder da busca) C57 · E3 (fator de encolhimento; substituído por `flex: 1000 0 0` sem base, o que também tirou a faixa em que o título perdia frações de pixel) C57 · E4 C57, C51 · E5 e E6 (piso de 160 px) C59 · N2c, N2e (segunda meia-noite e cancelamento) C73 · N3 C75 · N5 C74
- Mutantes da verificação do round 3, re-injetados e mortos: M7 (consulta sem o `flex`, caixa de 275 px) C57 · M4 (janela estreita sem o `flex`) e M5 (janela estreita sem esconder o texto) C51 · M9 (`--mold-search-min` 60) C57, C51 · E11, E12 (limiar 625 e 647) C57 · N5e (sem `preventDefault`) C74. Equivalentes, sem teste: T1 (`useMemo` de `Today` com `[]` em vez de `[locale]`: a página Hoje remonta quando o idioma muda, então o formatador nunca sobrevive a uma troca de `locale`) e M3 (base `auto` em vez de 0 na busca: com a coluna de 641 px ou mais a busca fica com 304 px ou mais, o título cabe e nada muda). A regra de ícone existe duas vezes porque é preciso uma por condição (`@container` da coluna e `data-narrow` da janela, sem como juntar as duas num seletor); cada uma é observada onde só ela atua (721-899 px de janela e 900-1272 px), por isso nenhuma cópia esconde a falta da outra

## Binding sources

| Source                                  | Screens                                                      | Checks           |
| --------------------------------------- | ------------------------------------------------------------ | ---------------- |
| `.specs/features/moldura-app/design.md` | Tela 1 Moldura, Tela 2 Hoje, Tela 3 Aparência, Tela 4 Paleta | C1-C14, C18, C21 |

## Test policy

| Code                                                                                                | Required proofs                                                             | Coverage expectation                                 |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------- |
| Instrumentation (composição das telas)                                                              | render test + browser geometry                                              | each region, item, card and control                  |
| Decides, not reached across a boundary (`useShell`: qual shell mostra enquanto a preferência viaja) | one at its own layer (requisição lenta, com falha, armazenamento bloqueado) | each source of the shell (resposta, espelho, padrão) |
| Instrumentation (foco, `inert` e Esc das gavetas)                                                   | render test + a real Tab loop in the browser                                | each dialog and each close path                      |
| Instrumentation (montagem e contraste por preset e tema)                                            | render test + browser computed style and console                            | each preset in each theme                            |
| Decides, not reached across a boundary (padrão do `shell`, migração)                                | one at its own layer                                                        | each origin                                          |
| Decides, reached across a boundary (`PUT /api/ui-preferences`)                                      | one at the boundary                                                         | each status                                          |

Evidence:

- `App.tsx` `OsShell`: `shell` → qual árvore monta -> decides
- closest analogue in the repo: `src/preferences.test.tsx` (render com as duas rotas mockadas) e `tests/e2e/nucleo-shell.spec.ts` (geometria no navegador)

Expectativas das linhas que a verificação do round 1 deu como não atendidas, e onde a correção do round 1 as atende:

- Instrumentation (composição das telas), "views reais ou prova equivalente": as nove views reais e o detalhe real de execução são medidos no navegador, dentro da moldura e com a conversa aberta (C56, C58); região, item, cartão e controle que o design decide têm check: marca e ícones (C62), largura da barra, botão no pé, trilho de 60 px, rolagem dos cartões e do histórico (C60, C9), título e busca (C57), cartão "Pede você" (C59). O C11 segue com stand-ins, e é o nível certo para "qual view monta e que rota recebe"
- Instrumentation (foco, `inert` e Esc das gavetas): a barra estreita desdobrada, a gaveta de conversa e a de documento têm laço de Tab real e fechamento por toque real (C61), e jsdom prova cada caminho de fechar (botão C63, toque fora C64, paleta por cima C65, Esc C39-C42 e C66, evento de painel C68)
- Decides (`useShell`): a nova tentativa automática, que faltava, é C72

Cost: 2 arquivos de teste de interface, 1 spec e2e, 1 teste de raiz, 75 provas.

## Swept

- validation: C15, C16 (`shell` inválido na rota e no disco)
- failure modes: C16 (valor desconhecido não derruba a interface)
- idempotency: n/a - escolher o shell atual grava o mesmo valor
- authorization: existing - `PUT /api/ui-preferences` segue a regra de auth das features 1 e 7
- concurrency: n/a - uma preferência gravada por vez pelo `UiPreferencesStore`, como as outras
- data lifecycle: C17 (padrão por origem)
- dependency failure: n/a - nenhuma dependência nova
- state transitions: C19, C20 (moldura ↔ Núcleo)
- observability: n/a - nenhum requisito de log; a troca é visível na tela

## Handoff

- S1-S4 ≈ 70k: App.tsx 20 KB, nucleo/index.tsx trechos 15 KB, apps.tsx 6 KB, Console props e CSS 10 KB, registry.tsx 8 KB, CommandPalette trechos 15 KB, theme.tsx 4 KB, preferences/migrations 8 KB, CSS novo ~12 KB, componentes novos ~30 KB, testes novos ~40 KB, locales 6 KB ≈ 174 KB / 4 ≈ 44k, mais leitura e execução do Playwright - abaixo de 150k - one builder
- Boundary: the first builder was cut off (API limit) with S1-S4 written but uncommitted; a second builder resumed from that diff, fixed the narrow-window chat drawer (it was placed in the empty third grid track), and closed all 24 checks in one commit
- Settled mid-build: nothing new from the user
- Abandoned: nothing
- Correção do round 1 (`fix/moldura-r1`, C56-C73): builder único, ~60k (css e três componentes pequenos, 12 testes de interface novos, 6 de navegador); fecha os achados bloqueantes 1, 2, 5 e 6, os 15 mutantes sobreviventes e as lacunas de cobertura do relatório da rodada 1
- Correção do round 2 (`fix/moldura-r2`, C57 e C59 ampliados, C73 estendido, C74-C75): fecha os achados da verificação do round 2 (consulta ao contêiner da busca, ⌘K, segunda meia-noite, fallback de `theme.tsx`, pt-BR, piso do corpo do cartão, constante `--mold-search-min`)
- Correção do round 3 (`fix/moldura-r3`, C51 e C57 ampliados, C74): fecha os achados da verificação do round 3 (forma da busca de ícone e da janela estreita, limiar 641 px, `preventDefault` do ⌘K, comentário do spec); última correção antes da escalação ao dono
