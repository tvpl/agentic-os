import type { Lang } from "../i18n";
import type { StepId } from "./state";

interface StepCopy {
  title: string;
  body: string;
  hint: string;
  tags: string[];
}
interface TourCopy {
  label: string;
  welcome: string;
  intro: string;
  duration: string;
  start: string;
  skip: string;
  resume: string;
  restart: string;
  back: string;
  next: string;
  finish: string;
  close: string;
  chapter: string;
  chapters: string[];
  progress: string;
  live: string;
  optional: string;
  modes: string;
  modeNames: string[];
  modeHints: string[];
  modeDone: string;
  practice: string;
  promptLabel: string;
  promptPlaceholder: string;
  template: string;
  sample: string;
  draftHint: string;
  draftDone: string;
  quiz: string;
  review: string;
  approve: string;
  correct: string;
  incorrect: string;
  generations: string;
  artifacts: string;
  theme: string;
  security: string;
  notifications: string;
  complete: string;
  completeBody: string;
  visited: string;
  ready: string;
  pending: string;
  providerCheck: string;
  memoryCheck: string;
  practiceCheck: string;
  providerAction: string;
  go: string;
  goDraft: string;
  replayHint: string;
  unavailable: string;
  steps: Record<StepId, StepCopy>;
}

const ptBR: TourCopy = {
  label: "Guia do OS",
  welcome: "Seu próximo passo.\nUm OS de possibilidades.",
  intro:
    "Vamos explorar seu espaço de trabalho de verdade. Eu mostro o caminho, você experimenta — no seu ritmo.",
  duration: "12 paradas · cerca de 4 minutos",
  start: "Vamos começar",
  skip: "Pular por enquanto",
  resume: "Continuar de onde parei",
  restart: "Recomeçar o tour",
  back: "Voltar",
  next: "Próximo passo",
  finish: "Finalizar jornada",
  close: "Pausar guia",
  chapter: "Capítulo",
  progress: "Progresso do guia",
  chapters: ["Encontre seu ritmo", "Prepare sua inteligência", "Do pedido ao resultado", "Expanda seu OS"],
  live: "NO SEU OS, AGORA",
  optional: "Você pode avançar sem fazer a atividade.",
  modes: "Viaje entre as cenas pelos módulos destacados à esquerda ou aqui:",
  modeNames: ["Núcleo", "Cérebro", "Execuções"],
  modeHints: [
    "O núcleo é onde a IA vive: o que importa hoje fica em volta dela.",
    "Sua memória como uma constelação: gire, aproxime, voe até uma nota.",
    "O rio do tempo: cada execução, e o rastro dela no lugar.",
  ],
  modeDone: "Pronto. As teclas 1 a 5 e [ ] também viajam entre as cenas.",
  practice: "Seu primeiro pedido",
  promptLabel: "Rascunho de treino",
  promptPlaceholder: "O que você quer fazer? Dê contexto e descreva o resultado esperado…",
  template: "Usar um exemplo",
  sample:
    "Analise a pasta de trabalho selecionada e resuma os principais arquivos. Não altere nada. Entregue uma lista com 3 próximos passos sugeridos.",
  draftHint: "Só um rascunho de treino. Ao terminar, você pode levá-lo ao console e revisar antes de enviar.",
  draftDone: "Rascunho preparado. Contexto + objetivo + resultado: um bom começo.",
  quiz: "O agente pediu autorização para alterar um arquivo. Qual é o próximo passo?",
  review: "Revisar a ação e decidir",
  approve: "Aprovar sem conferir",
  correct: "Isso! Confira a ação, o contexto e o escopo. Você pode aprovar ou recusar.",
  incorrect:
    "Primeiro confira o que será alterado. Uma aprovação é uma decisão sua, não uma etapa automática.",
  generations: "Ver gerações",
  artifacts: "Ver artefatos",
  theme: "Aparência",
  security: "Segurança",
  notifications: "Notificações",
  complete: "Pronto para dar\no primeiro passo.",
  completeBody:
    "Você conhece o caminho. Comece com um pedido pequeno, acompanhe a execução e evolua a partir do resultado.",
  visited: "áreas exploradas",
  ready: "Pronto",
  pending: "Para preparar",
  providerCheck: "Provedor disponível",
  memoryCheck: "Pasta de memória configurada",
  practiceCheck: "Primeiro pedido preparado",
  providerAction: "Configurar meu provedor",
  go: "Entrar no meu OS",
  goDraft: "Levar rascunho ao console",
  replayHint: "Este guia fica em Configurações e no menu de comandos. Seu progresso é salvo neste navegador.",
  unavailable: "A área ainda está carregando ou está oculta no seu layout. Você pode continuar o guia.",
  steps: {
    desktop: {
      title: "Seu dia começa aqui.",
      body: "No centro está o agente: ele respira quando espera, gira quando trabalha e pulsa quando responde. Em volta dele ficam as leituras do dia; clique numa e ela é projetada ao lado como uma lâmina.",
      hint: "No máximo duas lâminas ficam no ar. Esc dispensa a mais nova; nada precisa ser arrumado.",
      tags: ["Núcleo", "Leituras", "Lâminas"],
    },
    modes: {
      title: "Sem janelas: cenas.",
      body: "Cada lugar do OS ocupa a tela inteira — Núcleo, Cérebro, Execuções, Habilidades, Rotinas. Os módulos à esquerda levam a cada uma e o nome no topo mostra onde você está; entrar numa cena é um zoom, voltar é recolhê-la.",
      hint: "Use 1–5 ou [ ] para viajar; Esc volta ao núcleo.",
      tags: ["Navegação", "Cenas", "Horizonte"],
    },
    console: {
      title: "Transforme intenção em ação.",
      body: "Na linha de voz, sempre no mesmo lugar em todas as cenas, descreva o objetivo. Os controles — pasta de trabalho, provedor, modo — ficam no botão ao lado. A conversa sobe acima da linha.",
      hint: "Escolha leitura para analisar e escrita quando precisar alterar arquivos. Você também pode chamar uma skill com /nome.",
      tags: ["Conversa", "Pasta de trabalho", "Leitura e escrita"],
    },
    providers: {
      title: "Escolha quem trabalha com você.",
      body: "Conecte Claude Code, Cursor ou Codex. Confira a instalação e a autenticação, escolha o padrão e ajuste modelo e esforço conforme a tarefa.",
      hint: "Se um provedor não estiver pronto, esta tela mostra como prepará-lo. Ao final, o guia oferece um atalho para voltar aqui.",
      tags: ["Provedores", "Modelos", "Esforço"],
    },
    brain: {
      title: "Seu conhecimento tem um mapa.",
      body: "O Segundo Cérebro conecta pastas, arquivos e áreas da sua memória. Busque, navegue pelo grafo e abra uma prévia para encontrar contexto antes de pedir algo ao agente.",
      hint: "Cadastre pastas em Configurações → Memória. Os filtros, a lista de arquivos e o zoom ajudam a explorar o mapa.",
      tags: ["Busca", "Grafo de memória", "Prévias e contexto"],
    },
    skills: {
      title: "Ensine uma vez. Use muitas.",
      body: "Skills são instruções reutilizáveis para tarefas recorrentes. Explore o catálogo, veja entradas e permissões e execute quando estiver pronto.",
      hint: "Você pode criar skills, importar do marketplace, favoritar e exportar para seus provedores. Favoritos viram atalhos no desktop.",
      tags: ["Catálogo e marketplace", "Favoritos", "Exportação"],
    },
    runs: {
      title: "Acompanhe. Entenda. Decida.",
      body: "Execuções mostram o trabalho em andamento e o histórico. Abra uma execução para acompanhar eventos, agentes, arquivos alterados, uso e resultado.",
      hint: "Ações que exigem autorização aparecem para sua revisão. A linha do tempo e o replay ajudam a entender o que aconteceu.",
      tags: ["Eventos ao vivo", "Aprovações", "Replay e alterações"],
    },
    artifacts: {
      title: "O trabalho vira algo concreto.",
      body: "Artefatos reúne as saídas das execuções. Gerações organiza os resultados de criação. Troque de área abaixo para conhecer as duas telas.",
      hint: "Uma área vazia no início é normal: os resultados aparecem conforme você usa o OS.",
      tags: ["Arquivos produzidos", "Resultados", "Gerações"],
    },
    routines: {
      title: "Dê um ritmo às suas skills.",
      body: "Rotinas ligam skills a horários ou eventos. Escolha o que executar, configure as entradas e acompanhe os próximos disparos e o histórico.",
      hint: "Antes de ativar uma rotina, confira o gatilho, as permissões e o custo esperado da skill.",
      tags: ["Agendamentos", "Gatilhos", "Histórico"],
    },
    connectors: {
      title: "Amplie o alcance dos agentes.",
      body: "Conectores integram ferramentas e serviços ao OS por MCP. Confira os detalhes, a configuração e o status de cada conexão.",
      hint: "Habilite os conectores que fazem sentido para seu trabalho. Credenciais e disponibilidade dependem de cada serviço.",
      tags: ["Integrações", "Ferramentas MCP", "Status"],
    },
    pixel: {
      title: "Também existe espaço para criar.",
      body: "O Pixel Studio é seu ateliê de pixel art: desenhe, escolha cores, trabalhe com quadros e exporte suas criações.",
      hint: "Micro apps ficam no desktop. Você pode gerenciar seus atalhos em Configurações → Desktop.",
      tags: ["Pixel art", "Quadros e exportação", "Micro apps"],
    },
    settings: {
      title: "Deixe o OS com a sua cara.",
      body: "Personalize tema, cor e intensidade visual. Ajuste segurança, limites e notificações. Backups e diagnósticos ajudam a manter tudo funcionando.",
      hint: "Use o menu ou ⌘K / Ctrl+K para buscar apps, skills e ações. Procure “guia” sempre que quiser voltar a esta jornada.",
      tags: ["Personalização", "Limites e segurança", "Backups e diagnósticos"],
    },
  },
};

const en: TourCopy = {
  label: "OS guide",
  welcome: "Your next step.\nAn OS of possibilities.",
  intro: "Let's explore your actual workspace. I'll show the way, you try things out — at your own pace.",
  duration: "12 stops · about 4 minutes",
  start: "Let's get started",
  skip: "Skip for now",
  resume: "Continue where I left off",
  restart: "Restart the tour",
  back: "Back",
  next: "Next step",
  finish: "Finish the journey",
  close: "Pause guide",
  chapter: "Chapter",
  chapters: ["Find your rhythm", "Prepare your intelligence", "From request to result", "Expand your OS"],
  progress: "Guide progress",
  live: "IN YOUR OS, RIGHT NOW",
  optional: "You can move on without completing the activity.",
  modes: "Travel between scenes with the highlighted modules on the left, or here:",
  modeNames: ["Core", "Brain", "Runs"],
  modeHints: [
    "The core is where the AI lives: what matters today sits around it.",
    "Your memory as a constellation: orbit, zoom, fly to a note.",
    "The river of time: every run, and its trace in place.",
  ],
  modeDone: "Done. Keys 1 to 5 and [ ] travel between scenes too.",
  practice: "Your first request",
  promptLabel: "Practice draft",
  promptPlaceholder: "What would you like to do? Add context and describe the expected result…",
  template: "Use an example",
  sample:
    "Analyze the selected working folder and summarize the main files. Do not change anything. Return a list of 3 suggested next steps.",
  draftHint:
    "Just a practice draft. When you finish, you can bring it to the console and review it before sending.",
  draftDone: "Draft prepared. Context + objective + result: a good start.",
  quiz: "The agent requests permission to change a file. What should you do next?",
  review: "Review the action and decide",
  approve: "Approve without checking",
  correct: "Exactly! Check the action, context and scope. You can approve or deny it.",
  incorrect: "First check what will change. Approval is your decision, not an automatic step.",
  generations: "View generations",
  artifacts: "View artifacts",
  theme: "Appearance",
  security: "Security",
  notifications: "Notifications",
  complete: "Ready for\nyour first step.",
  completeBody:
    "You know your way around. Start with a small request, follow its execution and build on the result.",
  visited: "areas explored",
  ready: "Ready",
  pending: "To prepare",
  providerCheck: "Provider available",
  memoryCheck: "Memory folder configured",
  practiceCheck: "First request prepared",
  providerAction: "Set up my provider",
  go: "Enter my OS",
  goDraft: "Bring draft to console",
  replayHint: "Find this guide in Settings and the command menu. Your progress is saved in this browser.",
  unavailable: "This area is still loading or hidden in your layout. You can continue the guide.",
  steps: {
    desktop: {
      title: "Your day starts here.",
      body: "The agent is in the middle: it breathes while it waits, spins while it works and pulses while it answers. The day's readings sit around it; click one and it is projected beside it as a sheet.",
      hint: "Two sheets at most stay up. Escape dismisses the newest; nothing needs arranging.",
      tags: ["Core", "Readings", "Sheets"],
    },
    modes: {
      title: "No windows: scenes.",
      body: "Each place in the OS fills the screen — Core, Brain, Runs, Skills, Routines. The modules on the left take you to each one and the name on top shows where you are; entering a scene zooms in, leaving it folds it away.",
      hint: "Use 1–5 or [ ] to travel; Escape goes back to the core.",
      tags: ["Navigation", "Scenes", "Horizon"],
    },
    console: {
      title: "Turn intention into action.",
      body: "On the voice line, in the same place in every scene, describe your goal. The controls — working folder, provider, mode — sit behind the button beside it. The conversation rises above the line.",
      hint: "Choose read-only to analyze, or write to change files. You can also call a skill with /name.",
      tags: ["Conversation", "Working folder", "Read and write"],
    },
    providers: {
      title: "Choose who works with you.",
      body: "Connect Claude Code, Cursor or Codex. Check installation and authentication, pick a default and adjust the model and effort to the task.",
      hint: "If a provider isn't ready, this page explains how to prepare it. At the end, the guide offers a shortcut back here.",
      tags: ["Providers", "Models", "Effort"],
    },
    brain: {
      title: "Your knowledge has a map.",
      body: "Second Brain connects the folders, files and areas of your memory. Search, navigate the graph and open previews to gather context before asking an agent.",
      hint: "Add folders in Settings → Memory. Filters, the file list and zoom help you explore the map.",
      tags: ["Search", "Memory graph", "Previews and context"],
    },
    skills: {
      title: "Teach once. Use often.",
      body: "Skills are reusable instructions for recurring tasks. Explore the catalog, review inputs and permissions and run them when ready.",
      hint: "Create skills, import from the marketplace, add favorites and export to your providers. Favorites become desktop shortcuts.",
      tags: ["Catalog and marketplace", "Favorites", "Export"],
    },
    runs: {
      title: "Follow. Understand. Decide.",
      body: "Runs show ongoing work and history. Open a run to follow events, agents, changed files, usage and results.",
      hint: "Actions requiring permission appear for your review. The timeline and replay help you understand what happened.",
      tags: ["Live events", "Approvals", "Replay and changes"],
    },
    artifacts: {
      title: "Work becomes something tangible.",
      body: "Artifacts gathers the outputs of your runs. Generations organizes creative results. Switch areas below to explore both screens.",
      hint: "An empty area is normal at first: results appear as you use the OS.",
      tags: ["Produced files", "Results", "Generations"],
    },
    routines: {
      title: "Give your skills a rhythm.",
      body: "Routines connect skills to schedules or events. Choose what to run, configure inputs and follow upcoming triggers and history.",
      hint: "Before enabling a routine, check the trigger, permissions and expected cost of the skill.",
      tags: ["Schedules", "Triggers", "History"],
    },
    connectors: {
      title: "Extend your agents' reach.",
      body: "Connectors integrate tools and services with the OS through MCP. Review each connection's details, configuration and status.",
      hint: "Enable connectors that fit your work. Credentials and availability depend on each service.",
      tags: ["Integrations", "MCP tools", "Status"],
    },
    pixel: {
      title: "There is room to create, too.",
      body: "Pixel Studio is your pixel art workshop: draw, choose colors, work with frames and export your creations.",
      hint: "Micro apps live on the desktop. Manage their shortcuts in Settings → Desktop.",
      tags: ["Pixel art", "Frames and export", "Micro apps"],
    },
    settings: {
      title: "Make this OS your own.",
      body: "Personalize theme, color and visual intensity. Adjust security, limits and notifications. Backups and diagnostics help keep everything running.",
      hint: "Use the menu or ⌘K / Ctrl+K to search apps, skills and actions. Search for “guide” to return to this journey.",
      tags: ["Personalization", "Limits and security", "Backups and diagnostics"],
    },
  },
};

export const tourCopy = (lang: Lang): TourCopy => (lang === "pt-BR" ? ptBR : en);
