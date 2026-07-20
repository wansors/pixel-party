#!/usr/bin/env bash
# One-command local launcher: runs the game server and the Angular dev client together for
# play-testing. Server on :3000 (WS + /api, hot-reloaded); client on :4200 (proxies /api + /ws to the
# server). Ctrl-C stops both.
#
# Usage: bun run dev   (or: bash scripts/dev.sh)
set -euo pipefail
cd "$(dirname "$0")/.."

SERVER_PID=""
cleanup() {
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[dev] starting server on http://localhost:3000 …"
NODE_ENV=development bun run --watch apps/server/src/index.ts &
SERVER_PID=$!

# Give the server a moment so the client's first proxy calls succeed.
sleep 1

echo "[dev] starting client on http://localhost:4200 … (Ctrl-C to stop both)"
bun run --filter client start
