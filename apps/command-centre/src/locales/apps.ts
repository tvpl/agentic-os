/**
 * Strings owned by the "apps" frontier. Keys must stay unique across all
 * locale modules; `ptBR` must carry exactly the keys of `en` (enforced by
 * the `satisfies` clause and by i18n.test.ts).
 */
export const en = {
  // ---- Skills detail ----
  "apps.skills.tabResources": "Resources",
  "apps.skills.tabChecks": "Guardrails & success",
  "apps.skills.viewSource": "Source",
  "apps.skills.viewRendered": "Rendered",
  "apps.skills.copyBody": "Copy",
  "apps.skills.copiedBody": "SKILL.md copied.",
  "apps.skills.thickTitle": "Thick skill — {lines} lines",
  "apps.skills.thickBody":
    "Move references, templates and examples into resources/ and keep SKILL.md as a short router that says which file to read for which job.",
  "apps.skills.splitPrompt": "Copy split-assistant prompt",
  "apps.skills.splitCopied": "Prompt copied — paste it into a run to split this skill.",
  "apps.skills.noResources": "No resource files",
  "apps.skills.noResourcesBody":
    "Add brand HTML, images, PDFs or reference markdown under resources/ — they are previewed here and the run prompt points the agent to them.",
  "apps.skills.resourceCount": "{n} file(s)",
  "apps.skills.preview": "Preview",
  "apps.skills.openNewTab": "Open in new tab",
  "apps.skills.noPreview": "No inline preview for this file type.",
  "apps.skills.previewFailed": "Could not load the preview.",
  "apps.skills.previewTooLarge": "Too large to preview inline ({size}).",
  "apps.skills.kind.markdown": "markdown",
  "apps.skills.kind.html": "html",
  "apps.skills.kind.image": "image",
  "apps.skills.kind.pdf": "pdf",
  "apps.skills.kind.other": "file",
  "apps.skills.runHint": "⌘Enter runs · inputs are kept while you navigate",
  "apps.skills.modelEffort": "Model × effort",
  "apps.skills.customModel": "Custom model id",
  "apps.skills.clearInputs": "Clear inputs",
  "apps.skills.approvalTitle": "Approval needed",
  "apps.skills.approvalBody":
    "This run writes files under your security profile. Approve here to launch it now, or deny to cancel.",
  "apps.skills.approvalLaunched": "Approved — run started.",
  "apps.skills.approvalDenied": "Denied — nothing was run.",
  "apps.skills.approvalGone": "This approval was already resolved elsewhere.",
  "apps.skills.htmlPreview": "HTML preview (sandboxed, scripts disabled)",
  // ---- Settings ----
  "apps.settings.tabTheme": "Theme",
  "apps.settings.tabDesktop": "Desktop",
  "apps.settings.tabNotifications": "Notifications",
  "apps.settings.budget": "Daily budget (USD)",
  "apps.settings.budgetHint":
    "Spend across every provider per day. The desktop warns at 80 % and flags the day as over budget at 100 %. 0 disables it.",
  "apps.settings.presets": "Theme preset",
  "apps.settings.presetsHint":
    "A preset sets the accent and the surface family. The accent can still be fine-tuned under Identity.",
  "apps.settings.presetApplied": "Preset applied: {name}",
  "apps.settings.widgets": "Dashboard widgets",
  "apps.settings.widgetsHint":
    "Choose which widgets the desktop shows. Position and size are edited on the desktop itself.",
  "apps.settings.microApps": "Micro apps",
  "apps.settings.microAppsHint":
    "Extra entries for the desktop Micro apps widget: internal routes (/pixel) or http(s) URLs.",
  "apps.settings.noMicroApps": "No custom micro apps yet.",
  "apps.settings.addMicroApp": "Add micro app",
  "apps.settings.maName": "Name",
  "apps.settings.maDesc": "Description",
  "apps.settings.maHref": "Route or URL",
  "apps.settings.maHrefInvalid": "Use an internal route (/pixel) or an http(s) URL.",
  "apps.settings.automation": "Automation & connectors",
  "apps.settings.webhooks": "Webhook delivery",
  "apps.settings.webhooksHint":
    "Routines can only deliver their result to an http(s) webhook while this is on. Off by default: a routine result leaves this machine only when you say so.",
  "apps.settings.allowedCommands": "Connector executables allowlist",
  "apps.settings.allowedCommandsHint":
    "Comma-separated. Absolute paths or bare names resolved on PATH; a connector may only spawn what is listed here.",
  "apps.settings.allowedCommandsExample":
    'An MCP connector installed with npx needs "npx" on this list before it can read anything.',
  "apps.settings.desktopNotify": "System notifications",
  "apps.settings.desktopNotifyHint":
    "Approvals, failures and alerts reach you as system notifications when this tab is not in front. The browser asks for permission once.",
  "apps.settings.desktopDenied":
    "The browser refused notifications for this site; allow them in the address bar.",
  "apps.settings.desktopUnsupported": "This browser has no notification API.",
  "apps.settings.voiceNotify": "Spoken alerts",
  "apps.settings.voiceNotifyHint": "Reads approvals and failures aloud with the browser's own voice.",
  "apps.settings.voiceSample": "Mordomo online.",
  "apps.settings.sound": "Notification sound",
  "apps.settings.soundHint":
    "Play a short sound when a run finishes or an approval is requested. Stored in this browser only.",
  "apps.settings.soundOn": "On",
  "apps.settings.soundOff": "Off",
  "apps.settings.notificationsHint": "Notifications appear in the Inbox widget and in the top-bar bell.",
  "apps.widget.prompt": "Prompt bar",
  "apps.widget.inbox": "Inbox",
  "apps.widget.agenda": "Agenda",
  "apps.widget.calendar": "Calendar",
  "apps.widget.email": "E-mail",
  "apps.widget.cost": "Cost",
  // ---- Setup ----
  "apps.setup.stepConnect": "Connect data",
  "apps.setup.stepDesktop": "Your desktop",
  "apps.setup.connectHint":
    "Calendar and e-mail widgets read through connectors. Nothing needs to be configured now — the checklist stays available under Connectors.",
  "apps.setup.openConnectors": "Open the connectors checklist",
  "apps.setup.noConnectors": "No calendar or e-mail connector is registered.",
  "apps.setup.desktopHint":
    "Pick a look and the widgets you want on the desktop. Everything can change later in Settings.",
  "apps.setup.status.not_configured": "not configured",
  "apps.setup.status.configured": "configured",
  // ---- Pixel Studio ----
  "apps.pixel.redo": "Redo",
  "apps.pixel.brush": "Brush",
  "apps.pixel.swap": "Swap colours",
  "apps.pixel.secondary": "Secondary colour",
  "apps.pixel.recent": "Recent",
  "apps.pixel.prevFrame": "Previous frame",
  "apps.pixel.nextFrame": "Next frame",
  "apps.pixel.exportMeta": "Sprite sheet + JSON",
  "apps.pixel.shortcuts": "Shortcuts",
  "apps.pixel.shortcutsBody":
    "1-4 tools · [ ] frames · + - brush · x swap · o onion · ⌘Z undo · ⌘⇧Z / ⌘Y redo",
} as const;

export const ptBR = {
  "apps.skills.tabResources": "Recursos",
  "apps.skills.tabChecks": "Guardrails e sucesso",
  "apps.skills.viewSource": "Fonte",
  "apps.skills.viewRendered": "Renderizado",
  "apps.skills.copyBody": "Copiar",
  "apps.skills.copiedBody": "SKILL.md copiado.",
  "apps.skills.thickTitle": "Skill grossa — {lines} linhas",
  "apps.skills.thickBody":
    "Mova referências, modelos e exemplos para resources/ e deixe o SKILL.md como um roteador curto que diz qual arquivo ler para cada tarefa.",
  "apps.skills.splitPrompt": "Copiar prompt do assistente de divisão",
  "apps.skills.splitCopied": "Prompt copiado — cole numa execução para dividir esta skill.",
  "apps.skills.noResources": "Sem arquivos de recurso",
  "apps.skills.noResourcesBody":
    "Adicione HTML de marca, imagens, PDFs ou markdown de referência em resources/ — eles aparecem aqui em preview e o prompt da execução aponta o agente para eles.",
  "apps.skills.resourceCount": "{n} arquivo(s)",
  "apps.skills.preview": "Preview",
  "apps.skills.openNewTab": "Abrir em nova aba",
  "apps.skills.noPreview": "Sem preview inline para este tipo de arquivo.",
  "apps.skills.previewFailed": "Não foi possível carregar o preview.",
  "apps.skills.previewTooLarge": "Grande demais para preview inline ({size}).",
  "apps.skills.kind.markdown": "markdown",
  "apps.skills.kind.html": "html",
  "apps.skills.kind.image": "imagem",
  "apps.skills.kind.pdf": "pdf",
  "apps.skills.kind.other": "arquivo",
  "apps.skills.runHint": "⌘Enter executa · os campos ficam guardados enquanto você navega",
  "apps.skills.modelEffort": "Modelo × esforço",
  "apps.skills.customModel": "Id de modelo personalizado",
  "apps.skills.clearInputs": "Limpar campos",
  "apps.skills.approvalTitle": "Aprovação necessária",
  "apps.skills.approvalBody":
    "Esta execução escreve arquivos sob o seu perfil de segurança. Aprove aqui para iniciar agora, ou negue para cancelar.",
  "apps.skills.approvalLaunched": "Aprovado — execução iniciada.",
  "apps.skills.approvalDenied": "Negado — nada foi executado.",
  "apps.skills.approvalGone": "Esta aprovação já foi resolvida em outro lugar.",
  "apps.skills.htmlPreview": "Preview HTML (sandbox, scripts desativados)",
  "apps.settings.tabTheme": "Tema",
  "apps.settings.tabDesktop": "Desktop",
  "apps.settings.tabNotifications": "Notificações",
  "apps.settings.budget": "Orçamento diário (US$)",
  "apps.settings.budgetHint":
    "Gasto somado de todos os provedores por dia. O desktop avisa aos 80 % e marca o dia como estourado aos 100 %. 0 desliga.",
  "apps.settings.presets": "Preset de tema",
  "apps.settings.presetsHint":
    "Um preset define o accent e a família de superfícies. O accent ainda pode ser ajustado em Identidade.",
  "apps.settings.presetApplied": "Preset aplicado: {name}",
  "apps.settings.widgets": "Widgets do painel",
  "apps.settings.widgetsHint":
    "Escolha quais widgets o desktop mostra. Posição e tamanho são editados no próprio desktop.",
  "apps.settings.microApps": "Micro apps",
  "apps.settings.microAppsHint":
    "Entradas extras para o widget Micro apps do desktop: rotas internas (/pixel) ou URLs http(s).",
  "apps.settings.noMicroApps": "Nenhum micro app personalizado ainda.",
  "apps.settings.addMicroApp": "Adicionar micro app",
  "apps.settings.maName": "Nome",
  "apps.settings.maDesc": "Descrição",
  "apps.settings.maHref": "Rota ou URL",
  "apps.settings.maHrefInvalid": "Use uma rota interna (/pixel) ou uma URL http(s).",
  "apps.settings.automation": "Automação e conectores",
  "apps.settings.webhooks": "Entrega por webhook",
  "apps.settings.webhooksHint":
    "As rotinas só entregam o resultado num webhook http(s) enquanto isto estiver ligado. Desligado por padrão: o resultado de uma rotina só sai desta máquina quando você quiser.",
  "apps.settings.allowedCommands": "Executáveis permitidos aos conectores",
  "apps.settings.allowedCommandsHint":
    "Separados por vírgula. Caminhos absolutos ou nomes resolvidos no PATH; um conector só pode iniciar o que estiver aqui.",
  "apps.settings.allowedCommandsExample":
    'Um conector MCP instalado com npx precisa de "npx" nesta lista antes de conseguir ler qualquer coisa.',
  "apps.settings.desktopNotify": "Notificações do sistema",
  "apps.settings.desktopNotifyHint":
    "Aprovações, falhas e alertas chegam como notificação do sistema quando esta aba não está na frente. O navegador pede permissão uma vez.",
  "apps.settings.desktopDenied":
    "O navegador recusou notificações para este site; permita na barra de endereço.",
  "apps.settings.desktopUnsupported": "Este navegador não tem API de notificações.",
  "apps.settings.voiceNotify": "Alertas falados",
  "apps.settings.voiceNotifyHint": "Lê aprovações e falhas em voz alta com a voz do próprio navegador.",
  "apps.settings.voiceSample": "Mordomo online.",
  "apps.settings.sound": "Som de notificação",
  "apps.settings.soundHint":
    "Toca um som curto quando uma execução termina ou uma aprovação é pedida. Guardado só neste navegador.",
  "apps.settings.soundOn": "Ligado",
  "apps.settings.soundOff": "Desligado",
  "apps.settings.notificationsHint": "As notificações aparecem no widget Inbox e no sino da barra superior.",
  "apps.widget.prompt": "Barra de prompt",
  "apps.widget.inbox": "Inbox",
  "apps.widget.agenda": "Agenda",
  "apps.widget.calendar": "Calendário",
  "apps.widget.email": "E-mail",
  "apps.widget.cost": "Custo",
  "apps.setup.stepConnect": "Conectar dados",
  "apps.setup.stepDesktop": "Seu desktop",
  "apps.setup.connectHint":
    "Os widgets de calendário e e-mail leem através de conectores. Nada precisa ser configurado agora — o checklist continua disponível em Conectores.",
  "apps.setup.openConnectors": "Abrir o checklist de conectores",
  "apps.setup.noConnectors": "Nenhum conector de calendário ou e-mail está registrado.",
  "apps.setup.desktopHint":
    "Escolha um visual e os widgets que quer no desktop. Tudo pode mudar depois em Configurações.",
  "apps.setup.status.not_configured": "não configurado",
  "apps.setup.status.configured": "configurado",
  "apps.pixel.redo": "Refazer",
  "apps.pixel.brush": "Pincel",
  "apps.pixel.swap": "Trocar cores",
  "apps.pixel.secondary": "Cor secundária",
  "apps.pixel.recent": "Recentes",
  "apps.pixel.prevFrame": "Quadro anterior",
  "apps.pixel.nextFrame": "Próximo quadro",
  "apps.pixel.exportMeta": "Sprite sheet + JSON",
  "apps.pixel.shortcuts": "Atalhos",
  "apps.pixel.shortcutsBody":
    "1-4 ferramentas · [ ] quadros · + - pincel · x trocar · o onion · ⌘Z desfazer · ⌘⇧Z / ⌘Y refazer",
} satisfies Record<keyof typeof en, string>;
