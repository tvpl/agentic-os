/* This file deliberately lives outside the Vite module graph and asset cache. */
(() => {
  const pt = navigator.language.toLowerCase().startsWith("pt");
  const message = document.getElementById("boot-message");
  const reload = document.getElementById("boot-reload");
  if (message && pt) message.textContent = "Iniciando seu espaço de trabalho…";
  if (reload) {
    reload.textContent = pt ? "Recarregar" : "Reload";
    reload.addEventListener("click", () => location.reload());
  }
  const failed = () => {
    if (!document.getElementById("boot-status")) return;
    if (message)
      message.textContent = pt
        ? "Não foi possível abrir a interface. Recarregue para tentar novamente."
        : "The interface could not start. Reload to try again.";
    if (reload) reload.hidden = false;
  };
  window.addEventListener(
    "error",
    (event) => {
      if (event instanceof ErrorEvent || event.target instanceof HTMLScriptElement) failed();
    },
    true,
  );
  window.setTimeout(failed, 8000);
  // The entry module may already have failed before this script ran (module
  // scripts load in parallel). Fetch it again through the browser cache: a
  // network error or a non-JavaScript answer means the app cannot start.
  const entry = document.querySelector('script[type="module"][src]');
  if (entry && typeof fetch === "function") {
    fetch(entry.getAttribute("src"), { cache: "force-cache", credentials: "same-origin" })
      .then((res) => {
        const type = (res.headers.get("content-type") || "").toLowerCase();
        if (!res.ok || !/javascript|ecmascript/.test(type)) failed();
      })
      .catch(failed);
  }

  if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) return;
  // A new worker removes only obsolete Mordomo shell caches. Reload once if
  // the old cached script failed before React could replace the boot screen.
  const key = "mordomo.boot-recovery.v2";
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!document.getElementById("boot-status") || reloaded) return;
    reloaded = true;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* at most once in this document when storage is unavailable */
    }
    location.reload();
  });
  navigator.serviceWorker
    .register("/sw.js", { updateViaCache: "none" })
    .then((registration) => registration.update())
    .catch(() => undefined);
})();
