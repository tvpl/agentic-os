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
# `ok` or the reason. It cannot say how the window looks: tests/desktop.screens.test.ts reads the two screens.
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
