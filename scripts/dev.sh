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

# LAN play: admit each of this machine's addresses as a WS origin (the client dev server binds
# 0.0.0.0, so other devices join via http://<lan-ip>:4200 and their Origin must be allowed).
ORIGINS="http://localhost:4200"
LAN_IP=""
for ip in $(hostname -I 2>/dev/null); do
  ORIGINS="$ORIGINS,http://$ip:4200"
  [[ -z "$LAN_IP" ]] && LAN_IP="$ip"
done
export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-$ORIGINS}"

echo "[dev] starting server on http://localhost:3000 …"
NODE_ENV=development bun run --watch apps/server/src/index.ts &
SERVER_PID=$!

# Give the server a moment so the client's first proxy calls succeed.
sleep 1

echo "[dev] starting client on http://localhost:4200 … (Ctrl-C to stop both)"
[[ -n "$LAN_IP" ]] && echo "[dev] LAN play: open http://$LAN_IP:4200 and share room links from there"
bun run --filter client start
