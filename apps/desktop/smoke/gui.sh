#!/usr/bin/env bash
# Linux smoke test of the desktop app, window and all (.specs/features/distribuicao, AC 23-29).
#
#   apps/desktop/smoke/gui.sh <mordomo-desktop binary> [payload dir]
#
# A debug build needs the payload dir (`node scripts/package.mjs --payload apps/desktop/payload`); an installed package
# (/usr/bin/mordomo-desktop from the .deb) finds its own and takes no second argument. Needs Xvfb, xdotool, a window
# manager (metacity), dbus-run-session and node. It runs the app against a throwaway home and data folder, never yours.
# What it settles: the page of the Command Centre gets the owner's token through the launch secret, a second launch
# comes forward instead of starting a service, closing the window stops the service and leaves no lock behind, a service
# that dies shows the failure screen (Retry is the focused control, so Enter starts it again), and `--self-test` says
# `ok` or the reason, and (debug build) a page that sends the window to another origin finds it still on the Command
# Centre, the other origin unasked and the address handed to the system, and a real click on `<a target="_blank">` (with
# and without rel="noreferrer noopener") hands its address to the system and leaves the window where it is. It cannot say how the window looks: tests/desktop.screens.test.ts reads the two screens.
set -euo pipefail

BIN=${1:?usage: gui.sh <mordomo-desktop binary> [payload dir]}
if [ -n "${2:-}" ]; then export MORDOMO_DESKTOP_PAYLOAD=$2; fi
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then exec dbus-run-session -- "$0" "$@"; fi

WORK=$(mktemp -d)
export MORDOMO_HOME=$WORK/home XDG_DATA_HOME=$WORK/data HOME=$WORK/user MORDOMO_SKIP_NPM_AUDIT=1
mkdir -p "$MORDOMO_HOME" "$XDG_DATA_HOME" "$HOME"
export DISPLAY=:97
PIDS=()
cleanup() {
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  pkill -f "$WORK" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT
fail() {
  echo "FAIL: $*" >&2
  for f in "$WORK"/*.err "$WORK"/*.out; do [ -s "$f" ] && { echo "--- $f" >&2; tail -n 15 "$f" >&2; }; done
  exit 1
}
ok() { echo "ok: $*"; }
until_true() { # until_true <seconds> <description> <command...>
  local seconds=$1 what=$2; shift 2
  for _ in $(seq 1 $((seconds * 4))); do if "$@" 2>/dev/null; then return 0; fi; sleep 0.25; done
  fail "$what (waited ${seconds}s)"
}
services() { pgrep -f "lib/mordomo.mjs start --foreground --sidecar" || true; }
service_count() { services | wc -l | tr -d ' '; }
service_count_is() { [ "$(service_count)" = "$1" ]; }
log_has() { grep -qh -- "$1" "$MORDOMO_HOME"/logs/*.jsonl 2>/dev/null; }

Xvfb "$DISPLAY" -screen 0 1400x1000x24 >/dev/null 2>&1 & PIDS+=($!)
sleep 1
metacity --sm-disable >/dev/null 2>&1 & PIDS+=($!)
sleep 1

# ---- self-test: the payload, the supervisor and the page, without a window ----------------------------------
SELF=$("$BIN" --self-test 2>/dev/null | tail -1) || fail "--self-test exited non-zero: $SELF"
echo "$SELF" | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8")); if(!r.ok||!r.port||!r.version) process.exit(1)' \
  || fail "--self-test line is not ok: $SELF"
ok "--self-test: $SELF"

# ---- A. start: the window loads the Command Centre with the token ---------------------------------------------
"$BIN" >"$WORK/app.out" 2>"$WORK/app.err" & APP=$!; PIDS+=($APP)
until_true 40 "the service did not start" service_count_is 1
until_true 20 "the launch secret was not traded for the cookie" log_has 'url":"/?launch=\[REDACTED\]","status":302'
until_true 20 "the page did not reach the API with the owner's token" log_has '"by":"owner"'
ok "A. the window got the owner's token through the launch secret"
if grep -rq 'launch=[A-Za-z0-9_-]\{43\}' "$MORDOMO_HOME/logs" 2>/dev/null; then fail "the launch secret is in a log"; fi
PORT=$(sed -n 's/.*"port": *\([0-9]*\).*/\1/p' "$XDG_DATA_HOME"/*/desktop-state.json | head -1)
SERVICE_PORT=$(sed -n 's/.*"port":\([0-9]*\).*/\1/p' "$MORDOMO_HOME/config/run/server.pid")
test -n "$PORT" && test "$PORT" = "$SERVICE_PORT" || fail "desktop-state.json says '$PORT', the service listens on '$SERVICE_PORT'"
ok "A. the port is remembered ($PORT)"

# ---- B. a second launch comes forward and starts nothing ----------------------------------------------------
"$BIN" >"$WORK/second.out" 2>&1 & SECOND=$!
until_true 15 "the second launch did not exit" bash -c "! kill -0 $SECOND"
service_count_is 1 || fail "a second service started"
kill -0 "$APP" || fail "the first instance went away"
ok "B. single instance: the second launch exited, one service"

# ---- C. closing the window stops the service and leaves no lock ------------------------------------------------
xdotool key alt+F4
until_true 30 "the app did not exit when its window closed" bash -c "! kill -0 $APP"
until_true 20 "the service outlived the app" service_count_is 0
test ! -e "$MORDOMO_HOME/config/run/engine.lock" || fail "engine.lock was left behind"
test ! -e "$MORDOMO_HOME/config/run/server.pid" || fail "server.pid was left behind"
ok "C. closing the window stopped the service cleanly"

# ---- D. a service that dies shows the failure screen; Retry starts it again ------------------------------
"$BIN" >"$WORK/app2.out" 2>"$WORK/app2.err" & APP=$!; PIDS+=($APP)
until_true 40 "the service did not start again" service_count_is 1
until_true 20 "the page did not reach the API" bash -c "grep -c '\"by\":\"owner\"' $MORDOMO_HOME/logs/api.jsonl | grep -qv '^0\$'"
FIRST=$(services | head -1)
kill -9 "$FIRST"
sleep 5   # the monitor looks once a second; the screen is up well inside this
kill -0 "$APP" || fail "the app went away with its service"
xdotool key Return   # the failure screen focuses Try again
until_true 40 "Try again did not start a new service" bash -c "test \"\$(pgrep -f 'lib/mordomo.mjs start --foreground --sidecar' | head -1)\" != '$FIRST' && pgrep -f 'lib/mordomo.mjs start --foreground --sidecar' >/dev/null"
ok "D. the dead service showed the failure screen and Try again started a new one"
xdotool key alt+F4
until_true 30 "the app did not exit" bash -c "! kill -0 $APP"
until_true 20 "the service outlived the app" service_count_is 0

# ---- F. a page that sends the window to another origin is not shown there (AC 22) ------------------------------
# (Placed before E, which leaves a holder of the home running.) A debug build only: it points the app at a COPY of the
# payload whose page, a second after it loads, sets `location.href` to a server of another origin that this script
# runs. The window must stay on the Command Centre (the page then reaches the API again), that server must never be
# asked for anything, and the address must have been handed to the system's opener, which here is a stub `xdg-open`.
# Then the same page puts a link over the whole window, `target="_blank"`, and a real click (xdotool) on it must hand its
# address to the opener, once for the plain form and once for rel="noreferrer noopener" (the Command Centre's form): in
# WebKitGTK that click alone reaches nothing, the window script (src-tauri/src/new-window.js) is what routes it.
if [ -n "${MORDOMO_DESKTOP_PAYLOAD:-}" ]; then
  PROBE=$WORK/payload-probe
  cp -a "$MORDOMO_DESKTOP_PAYLOAD" "$PROBE"
  node -e '
    const http = require("http"), fs = require("fs");
    const server = http.createServer((req, res) => { fs.appendFileSync(process.argv[1], req.url + "\n"); res.end("another origin"); });
    server.listen(0, "127.0.0.1", () => fs.writeFileSync(process.argv[2], String(server.address().port)));
  ' "$WORK/other-origin.requests" "$WORK/other-origin.port" & PIDS+=($!)
  until_true 10 "the other-origin server did not start" test -s "$WORK/other-origin.port"
  OTHER=$(cat "$WORK/other-origin.port")
  cat >"$PROBE/ui/nav-probe.js" <<JS
setTimeout(function () { location.href = "http://127.0.0.1:$OTHER/left-the-window"; }, 1000);
setTimeout(function () { fetch("/probe-alive"); }, 4000);
setTimeout(function () {
  var variants = [["/blank-plain", ""], ["/blank-noopener", "noreferrer noopener"]], n = 0;
  var a = document.createElement("a");
  a.textContent = "link"; a.target = "_blank";
  a.style.cssText = "position:fixed;left:0;top:0;width:100%;height:100%;z-index:99999";
  function next() {
    a.href = "http://127.0.0.1:$OTHER" + variants[n][0];
    if (variants[n][1]) a.rel = variants[n][1]; else a.removeAttribute("rel");
  }
  next();
  document.body.appendChild(a);
  a.addEventListener("click", function () {
    n++;
    if (n < variants.length) setTimeout(next, 300);
    else setTimeout(function () { fetch("/probe-links-done"); }, 2000);
  });
  fetch("/probe-anchor-ready");
}, 6000);
JS
  sed -i 's#<head>#<head><script src="/nav-probe.js"></script>#' "$PROBE/ui/index.html"
  mkdir -p "$WORK/bin"
  printf '#!/bin/sh\necho "$1" >> "%s"\n' "$WORK/opened-by-system" >"$WORK/bin/xdg-open"
  chmod +x "$WORK/bin/xdg-open"
  MORDOMO_DESKTOP_PAYLOAD=$PROBE PATH="$WORK/bin:$PATH" "$BIN" >"$WORK/app3.out" 2>"$WORK/app3.err" & APP=$!; PIDS+=($APP)
  until_true 40 "the service did not start for scenario F" service_count_is 1
  until_true 30 "the page with the probe was not served" log_has 'nav-probe.js'
  until_true 30 "the address was not handed to the system opener" grep -q "left-the-window" "$WORK/opened-by-system"
  until_true 30 "the page was replaced: it never reached the API again" log_has 'probe-alive'
  ok "F. a page that navigates away stays on the Command Centre; the address went to the system"
  until_true 30 "the page did not put its link over the window" log_has 'probe-anchor-ready'
  click_window() {
    local win geometry X Y WIDTH HEIGHT
    win=$(xdotool search --onlyvisible --name '^MordomoOS$' | head -1)
    if [ -n "$win" ]; then
      eval "$(xdotool getwindowgeometry --shell "$win")"
      xdotool mousemove $((X + WIDTH / 2)) $((Y + HEIGHT / 2)) click 1
    else
      xdotool mousemove 640 400 click 1
    fi
  }
  click_window
  until_true 20 "a click on target=_blank was not handed to the system opener" grep -q "/blank-plain" "$WORK/opened-by-system"
  sleep 1
  click_window
  until_true 20 "a click on target=_blank rel=noreferrer noopener was not handed to the system opener" grep -q "/blank-noopener" "$WORK/opened-by-system"
  until_true 30 "the page was replaced by a click on target=_blank: it never reached the API again" log_has 'probe-links-done'
  test "$(grep -c "/blank-" "$WORK/opened-by-system")" = 2 || fail "the links were handed to the system more or less than once each: $(cat "$WORK/opened-by-system")"
  test ! -s "$WORK/other-origin.requests" || fail "the window asked another origin for: $(cat "$WORK/other-origin.requests")"
  ok "F. a click on target=_blank (plain and noreferrer noopener) was handed to the system; the window stayed on the Command Centre and no other origin was asked for anything"
  xdotool key alt+F4
  until_true 30 "the app did not exit" bash -c "! kill -0 $APP"
  until_true 20 "the service outlived the app" service_count_is 0
else
  echo "skipped: F. needs a debug build (MORDOMO_DESKTOP_PAYLOAD): the installed package cannot be given a page that leaves"
fi

# ---- E. another service holds the home: the app says so and starts nothing --------------------------------------
HOLD=$WORK/hold; mkfifo "$HOLD"
sleep 300 >"$HOLD" & PIDS+=($!)
MORDOMO_LAUNCH_TOKEN=$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64url"))') \
  node "${MORDOMO_DESKTOP_PAYLOAD:-/usr/lib/MordomoOS/payload}/lib/mordomo.mjs" start --foreground --sidecar --port 0 <"$HOLD" >/dev/null 2>&1 & PIDS+=($!)
until_true 20 "the holding service did not start" service_count_is 1
BUSY=$("$BIN" --self-test 2>/dev/null | tail -1 || true)
echo "$BUSY" | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8")); if(r.ok||r.error.kind!=="home_in_use") process.exit(1)' \
  || fail "--self-test over a held home did not say home_in_use: $BUSY"
ok "E. a held home is reported as home_in_use, and the holder was not stopped ($(service_count) service)"
service_count_is 1 || fail "the app stopped the service that held the home"
echo "gui smoke: all scenarios passed"
