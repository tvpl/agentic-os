#!/usr/bin/env bash
# MordomoOS bootstrap for macOS/Linux: install deps, build, run guided setup.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js >= 20 is required. Install it from https://nodejs.org or via your package manager." >&2
  exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js >= 20 is required (found $(node --version))." >&2
  exit 1
fi

echo "▸ Installing dependencies…"
npm install
echo "▸ Building MordomoOS…"
npm run build
echo "▸ Starting guided setup (re-runnable, never destroys data)…"
node apps/api/dist/cli.js setup "$@"
