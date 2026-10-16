// Injected into the main window before any page script runs (shell.rs, `initialization_script`).
//
// A link that asks for a new window with `<a target="_blank">` (every external link the Command Centre renders, with or
// without `rel="noreferrer noopener"`) does nothing in the Linux window: the shell's `on_new_window` is never called for
// it (observed under Xvfb with WebKitGTK 2.52 and a real click; `target="somewin"`, `rel="noopener"` on a named target,
// and `window.open(address, "_blank")` all do reach it, so it is the click on `_blank` and not the handler that fails).
// `on_new_window` is the one place that decides where a new window's address goes: the system browser for a web or mail
// address, nowhere for the rest, and no window is ever made.
//
// So a plain click on such a link is turned into that call. It grants the page nothing it could not do itself:
// `window.open` is the page's own, and no command of the shell is reachable from here.
(function () {
  // Only the service's own origin (http://127.0.0.1:<port>) has links of this kind; the shell's screens have none.
  if (location.protocol !== "http:" || location.hostname !== "127.0.0.1") return;
  document.addEventListener("click", function (event) {
    // The page's own handler (a router, a menu) comes first and may have taken the click.
    if (event.defaultPrevented || event.button !== 0) return;
    var anchor = event.target && event.target.closest ? event.target.closest("a[target]") : null;
    if (!anchor || anchor.hasAttribute("download")) return;
    var target = String(anchor.getAttribute("target")).trim().toLowerCase();
    // Empty and the three relative names load in a frame of the window, which `on_navigation` already decides.
    if (target === "" || target === "_self" || target === "_parent" || target === "_top") return;
    // Only an address the shell hands to the system; anything else keeps the browser's own (blocked) behaviour.
    if (!/^(https?|mailto):/i.test(anchor.href)) return;
    event.preventDefault();
    window.open(anchor.href, "_blank");
  });
})();
