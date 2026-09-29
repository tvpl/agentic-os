# Núcleo imersivo — sem janelas

Aprovado em 26/09/2026 a partir do protótipo navegável
(https://claude.ai/artifact/L2ys3bWJeTAQtjCdEHPiqc). Substitui o desktop de
janelas e o plano de regiões (`desktop-regioes.md`), que resolveu a
sobreposição mas deixou o sistema "engessado".

## Por que

O dono do produto pediu, em 24/09: sair do conceito de janelas e caixas
delimitadas, informação em tela cheia, sub-blocos só quando necessários, uma
experiência imersiva de "estar dentro de uma máquina conversando com a IA", e
um Segundo Cérebro com gráfico, animação e navegação à altura.

## Regras

1. **A IA é o centro, não as caixas.** O Núcleo mostra o agente como um corpo
   de partículas cuja forma é o estado dele (`CoreState`): respira em espera,
   ondula ao ouvir, gira ao trabalhar, pulsa ao responder, fica âmbar ao
   esperar uma decisão, pisca vermelho num alerta e verde ao concluir.
2. **Uma cena por vez, em tela cheia.** A URL é a cena (`/`, `/brain`,
   `/runs/abc`…). As cinco principais ficam no horizonte (1–5); as demais
   entram pelo menu "mais cenas", pela paleta ou por link.
3. **Sub-blocos só quando a conversa pede.** Lâminas: no máximo duas
   projeções ao lado do núcleo (um rastro, um documento, um formulário, um
   instrumento). Não se arrastam, não se redimensionam, não empilham; somem
   ao dispensar (Esc dispensa a mais nova).
4. **A IA age sobre a cena.** Um pedido na linha de voz abre o rastro onde
   você está (projetado no Núcleo; no lugar, em Execuções).
5. **Navegar é viajar.** Entrar numa cena a partir do Núcleo é mergulho,
   voltar é subida, entre cenas é giro no sentido do horizonte; o campo de
   fundo acelera durante a viagem.
6. **A periferia fica nas bordas.** Telemetria em texto no canto superior
   direito; leituras discretas só aparecem quando têm algo a dizer.
7. **A linha de voz é uma só**, no mesmo lugar em todas as cenas. A conversa
   sobe acima da linha; os controles ficam atrás de um botão. As cenas param
   acima da conversa inteira (`--nu-voice-h`, medido).

## Arquitetura

- `src/nucleo/index.tsx` — o shell: cenas e transições, lâminas, horizonte,
  telemetria, linha de voz (o `Console`), busca (⌘F), deck (⌘J), atalhos.
- `src/nucleo/scenes.ts` — registro de cenas e regras de viagem.
- `src/nucleo/projections.ts` — o estado das lâminas (máx. 2).
- `src/nucleo/CoreOrb.tsx`, `Field.tsx`, `Beams.tsx` — os canvases (param com
  a aba oculta; perfil econômico e movimento reduzido desaceleram ou congelam).
- `src/nucleo/scenes/*Scene.tsx` — as composições próprias de Cérebro,
  Execuções, Habilidades e Rotinas; as demais cenas mostram a view de produção
  em tela cheia.
- Saíram: `WidgetLayer`, `Panel`, `windowModel`, `useWindowLayout`,
  `useWindowDrag`, `defaultWindows`, `DesktopPods`, `AmbientStrip`, espaços,
  dock, `LivingField`, `AgentPresence`, `FirstRunHint`, `AppPanel`.

## Registro

- 26/09 — shell, núcleo, lâminas, horizonte, telemetria, linha de voz, paleta
  sem ações de janela, guia de boas-vindas reescrito para cenas, atalhos.
- 26–27/09 — cenas próprias: Cérebro (constelação 3D com leitura lateral,
  percurso guiado, linha do tempo; mapa 2D clássico no menu ⋯), Execuções
  (rio do tempo por origem, rastro no lugar, detalhe completo em folha),
  Habilidades (anel com setores, centro tipográfico, detalhe em folha),
  Rotinas (mostrador de 24 h, agenda, editor de sempre).
- 27/09 — CSS do desktop de janelas removido (~1.900 linhas); E2E reescrito
  para o shell (`tests/e2e/nucleo-shell.spec.ts` + specs adaptadas): 135
  passam, 2 opcionais pulados. Build completo e serviço reiniciado.
- Pendências: em Rotinas uma lâmina cobre as ações à direita da agenda (a cena
  não abre espaço como o Cérebro); o "Inspecionar execução" do painel Agora
  abre o rastro, não o detalhe completo.

## Rodada 2 — "cada coisa no seu lugar" (28/09)

Pedido do dono: ainda pouco agêntico e futurista; o globo fraco; animações
iguais; chat com cara de Windows e caixas de aprovação; pendências e alertas no
canto superior esquerdo; apps e módulos na lateral; Cérebro com zoom, sinapses,
ícones por conteúdo e leitura poderosa.

- **Lugares fixos.** Canto superior esquerdo: pendências (`pending/`), com os
  alertas deslizando por baixo e os toasts no mesmo canto. Lateral esquerda:
  módulos (`ModuleSpine`), no lugar do horizonte. Topo ao centro: o nome da
  cena. Canto superior direito: telemetria. Embaixo: a linha de voz com a íris.
- **Pendências** (`pending/model.ts`, testado): aprovações, provedor que não
  roda, orçamento, falhas das últimas 24 h, rotinas doentes e avisos, numa só
  fila por urgência (decidir › corrigir › olhar › aviso). O **modo foco**
  (clique no hub ou `P`) recua o sistema e abre a fila; A aprova, D nega, Enter
  executa a ação principal. `⌘⇧A`/`⌘⇧D` seguem valendo de qualquer lugar.
- **Conversa sem caixas.** O `DecisionDock` saiu do console; uma decisão
  pausada vira uma linha "↖ enviado às suas pendências". O resumo do dia virou
  fala do agente no Núcleo (`useBriefing`). Acima da linha, três intenções por
  cena (`VoiceHints`).
- **A entidade** (`entity/`): corpo da IA em WebGL2 (cascas de vidro com
  filamentos, núcleo, órbita, HUD com inscrição, satélites de atividade), com
  estados distintos; a íris da linha de voz é a mesma entidade em pequeno.
  CoreOrb fica como fallback sem WebGL2.
- **Presença contínua.** A borda da tela (`Aura`) corre em ciano quando o
  agente trabalha, respira quando responde, brilha em âmbar no canto das
  pendências quando algo espera você, pisca vermelho/verde nos desfechos.
- **Viagens diferentes por gesto** (`travel.ts`): entrar num módulo abre a
  cena como íris a partir do ponto tocado enquanto a anterior passa voando;
  voltar ao Núcleo dobra a cena para o glifo dela; lâminas nascem do elemento
  que as pediu; o foco abre a partir do canto; faíscas (`Sparks`) marcam a
  origem, e o envio de um pedido também.
- **Cérebro v2** (`scenes/Brain*`, `brain*.ts`): céu com parallax e nebulosas
  com volume; ligações como sinapses curvas com pulsos de luz; 15 ícones por
  tipo de conteúdo; zoom semântico (áreas › polos › notas › sinapses, com
  medidor de profundidade); mergulho dentro da nota (ela vira o centro, as
  vizinhas em anéis, viagem pela sinapse com rastro e trilha de volta); quatro
  arranjos (Áreas, Tempo em hélice, Tipos, Ligações) com morph; leitor com
  sumário, progresso, termos-chave que acendem o céu, contexto (citam / cita /
  parecidas / ao lado / perto sem ligação) e ações (referenciar, resumir,
  explicar, projetar, copiar, abrir no editor).

## Rodada 3 — a conversa sobe da linha (2026-09-28)

- **A linha e a conversa.** Dobrada, a voz é só a linha. Ao usá-la (clique,
  foco, `/`), o resto esmaece (`.nu-dialog-veil`) e a conversa sobe como uma
  folha larga com o fio inteiro, os passos do agente em linha do tempo (glifo
  por tipo de trabalho) e a resposta em markdown. `Esc`, o véu ou a seta a
  dobram; viajar também. Nada de execução projetada ao enviar.
- **Perguntas do agente** (`AskUserQuestion`) são conversa: um cartão de
  escolhas no próprio fio e nas pendências (`QuestionCard`), respondido com
  `POST /api/approvals/:id/resolve { decision, answers }`; o MCP de permissão
  devolve `updatedInput` com as respostas. `A`/`⌘⇧A` nunca aprovam pergunta.
- **O Núcleo em repouso** é só a entidade e a saudação; tocar nela abre o dia.

## Rodada 4 — o núcleo como porta, a conversa como luz (2026-09-29)

- **Toque no centro**: uma onda sai do corpo e seis leituras (agora,
  pendências, 24 h, custo, próxima rotina, habilidades) saem em espiral em
  coordenadas polares animadas (`@property --pa/--pr/--ps`, mola), cada uma
  com seu gráfico (barras 24 h, anel, pulsos, hexágonos). Um arco de ações
  sob o corpo: **falar**, conversar, ouvir o dia, resolver. **Segurar** o
  corpo (450 ms, anel que enche) liga o microfone (`talk()` → `LISTEN_EVENT`).
- **Conversa como luz**: folha de vidro arredondada que floresce da linha,
  com corrente de neon no aro; balões (você em âmbar, à direita; o agente em
  ciano, à esquerda, com um orbe que respira) chegam com mola e desfoque;
  enquanto responde, uma corrente corre na borda do balão; "pensando" são
  três gotas de luz. A linha é uma pílula; enviar, microfone e ferramentas
  são redondos.
- **Cérebro v3** (`brainCamera.ts`, `brainLabels.ts`, `brainPick.ts`, testados):
  navegação de espaço (orbitar, deslocar, aproximar rumo ao cursor, inércia,
  W A S D / Q E), profundidade (três camadas de estrelas, névoa, piso polar,
  linhas de queda), rótulos que não colidem nem crescem além de 15 px,
  legendas ao passar o mouse (estrela, ligação, área), bússola e ajuda de
  navegação. Corrigido o canvas medido no meio do zoom da viagem.

## Rodada 5 — o conceito em todo o sistema (2026-09-29)

Feita com a skill tlc-spec-lean: plano, 36 verificações com prova e um
verificador independente (aprovado na 3ª rodada). Artefatos em
`.specs/features/conceito-em-todo-sistema/`.

- **Conectores**: cartões de vidro, um aberto por vez; o assistente de etapas
  voltou a ter estilo (o CSS dele não era carregado pela tela).
- **Resolver**: um cartão por vez com a leitura do agente primeiro; cada
  causa uma vez (falhas dentro da rotina, avisos iguais com "×N"); avisos
  quietos num histórico recolhido; resolver não fecha, o próximo vem.
- **Execuções**: visão geral (o rio) ou uma execução (Resumo, Passos, Log),
  nunca as duas; o erro uma vez por seção; rótulos do rio sem sobreposição.
- **Linguagem Luz** (`nucleo/luz.css`): pílulas, vidro, diálogos como folha
  sobre o véu da conversa, em toda cena menos Núcleo e Cérebro. O build
  descartava `backdrop-filter` quando havia `-webkit-` escrito à mão: nunca
  escrever o prefixo, o minificador o gera.
- **Habilidades**: uma barra acima do anel e um "+"; detalhes sob demanda;
  editor e marketplace como folha.
- **Galerias**: uma busca, chips, item abre como lâmina nascendo do cartão.
- **Perguntar ao agente** em todo foco, com o `@ref` do item (`nucleo/subject.ts`).
