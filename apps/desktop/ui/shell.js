// The shell's own screens: "starting" and "failure". No framework, no inline script (the content-security-policy
// forbids it), every string set with textContent. The window may call three commands (capabilities/main.json).
(function () {
  "use strict";

  var COPY = {
    en: {
      "starting.title": "Starting MordomoOS…",
      "starting.body": "The local service is starting. This takes a few seconds.",
      "starting.slow": "Still starting. The first launch prepares your data folder.",
      "failure.detail": "Detail",
      "failure.tail": "What the service wrote",
      "failure.retry": "Try again",
      "failure.quit": "Quit",
      version: "Version",
      kinds: {
        payload_missing: [
          "The app is incomplete",
          "Part of the installed app is missing, so the local service cannot start. Reinstall MordomoOS.",
        ],
        spawn_failed: [
          "The local service could not be started",
          "The system refused to run the Node bundled with the app. Reinstall MordomoOS; if it keeps happening, check your security software.",
        ],
        home_in_use: [
          "MordomoOS is already running",
          'Another MordomoOS service is using your data folder (a login service, a terminal session or another copy of the app). Stop it with "mordomo stop" and try again.',
        ],
        home_blocked: [
          "Your data folder needs attention",
          'A restore left files in your data folder that must be cleared by hand. Run "mordomo doctor" in a terminal for the steps.',
        ],
        port_busy: [
          "A local port is taken",
          "MordomoOS could not get a free local port. Close the program that is using it and try again.",
        ],
        crashed: [
          "The local service stopped while starting",
          'It ended before it was ready. The detail and, when there is one, the note under "What the service wrote" say why.',
        ],
        timeout: ["The local service is taking too long", "It did not answer within 30 seconds. Try again."],
        bad_ready: [
          "The local service answered in a way the app does not understand",
          "The app and the service may be different versions. Reinstall MordomoOS.",
        ],
        ui_not_served: [
          "The Command Centre did not load",
          "The local service is running but does not serve the interface. Reinstall MordomoOS.",
        ],
        stopped: ["The local service stopped", "It was running and it ended. Try again."],
      },
    },
    pt: {
      "starting.title": "Iniciando o MordomoOS…",
      "starting.body": "O serviço local está iniciando. Leva alguns segundos.",
      "starting.slow": "Ainda iniciando. A primeira abertura prepara a sua pasta de dados.",
      "failure.detail": "Detalhe",
      "failure.tail": "O que o serviço escreveu",
      "failure.retry": "Tentar de novo",
      "failure.quit": "Sair",
      version: "Versão",
      kinds: {
        payload_missing: [
          "O app está incompleto",
          "Falta uma parte do app instalado, então o serviço local não consegue iniciar. Reinstale o MordomoOS.",
        ],
        spawn_failed: [
          "Não foi possível iniciar o serviço local",
          "O sistema recusou executar o Node que vem com o app. Reinstale o MordomoOS; se continuar, verifique o seu software de segurança.",
        ],
        home_in_use: [
          "O MordomoOS já está rodando",
          'Outro serviço do MordomoOS está usando a sua pasta de dados (um serviço de login, uma sessão de terminal ou outra cópia do app). Pare-o com "mordomo stop" e tente de novo.',
        ],
        home_blocked: [
          "A sua pasta de dados precisa de atenção",
          'Uma restauração deixou arquivos na sua pasta de dados que precisam ser limpos à mão. Rode "mordomo doctor" num terminal para ver os passos.',
        ],
        port_busy: [
          "Uma porta local está ocupada",
          "O MordomoOS não conseguiu uma porta local livre. Feche o programa que a usa e tente de novo.",
        ],
        crashed: [
          "O serviço local parou ao iniciar",
          'Ele terminou antes de ficar pronto. O detalhe e, quando houver, a nota em "O que o serviço escreveu" dizem o motivo.',
        ],
        timeout: [
          "O serviço local está demorando demais",
          "Ele não respondeu em 30 segundos. Tente de novo.",
        ],
        bad_ready: [
          "O serviço local respondeu de um jeito que o app não entende",
          "O app e o serviço podem ser de versões diferentes. Reinstale o MordomoOS.",
        ],
        ui_not_served: [
          "O Command Centre não carregou",
          "O serviço local está rodando, mas não serve a interface. Reinstale o MordomoOS.",
        ],
        stopped: ["O serviço local parou", "Ele estava rodando e terminou. Tente de novo."],
      },
    },
  };

  var lang = /^pt\b/i.test(navigator.language || "") ? "pt" : "en";
  var text = COPY[lang];
  document.documentElement.lang = lang === "pt" ? "pt-BR" : "en";

  function $(id) {
    return document.getElementById(id);
  }

  document.querySelectorAll("[data-i18n]").forEach(function (node) {
    var value = text[node.getAttribute("data-i18n")];
    if (value) node.textContent = value;
  });

  function invoke(command) {
    var tauri = window.__TAURI__;
    if (!tauri || !tauri.core) return Promise.reject(new Error("no bridge"));
    return tauri.core.invoke(command);
  }

  var shown = null;
  function show(status) {
    var failed = status.state === "failed" && status.failure;
    $("starting").hidden = !!failed;
    $("failure").hidden = !failed;
    $("version").textContent = status.version ? text.version + " " + status.version : "";
    if (!failed) {
      shown = null;
      return;
    }
    var key = JSON.stringify(status.failure);
    if (key === shown) return;
    shown = key;
    var copy = text.kinds[status.failure.kind] || text.kinds.crashed;
    $("failure-title").textContent = copy[0];
    $("failure-body").textContent = copy[1];
    $("failure-detail").textContent = status.failure.detail || "";
    var tail = status.failure.tail || [];
    $("failure-tail").textContent = tail.join("\n");
    $("failure-tail-box").hidden = tail.length === 0;
    $("retry").focus();
  }

  function poll() {
    invoke("shell_status")
      .then(show)
      .catch(function () {})
      .then(function () {
        setTimeout(poll, 400);
      });
  }

  $("retry").addEventListener("click", function () {
    $("starting").hidden = false;
    $("failure").hidden = true;
    shown = null;
    invoke("shell_retry").catch(function () {});
  });
  $("quit").addEventListener("click", function () {
    invoke("shell_quit").catch(function () {});
  });
  setTimeout(function () {
    $("slow").hidden = $("starting").hidden;
  }, 10000);

  poll();
})();
