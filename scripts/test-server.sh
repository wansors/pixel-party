#!/usr/bin/env bash
# Server/shared test runner. WS-handshake suites are split into a second `bun test` invocation so they
# get a fresh, lightly-loaded process (cumulative cross-suite WS resource accumulation flakes them
# otherwise — see utopia-offline). Do NOT run root `bun test` (it would load Phaser -> `window is not
# defined`); server tests stay path-scoped.
#
# Usage: bash scripts/test-server.sh   (also: bun run test)
set -euo pipefail

shopt -s nullglob globstar
SERVER_TESTS=(apps/server/src/**/*.test.ts apps/server/test/*.test.ts)
SHARED_TESTS=(packages/shared/src/**/*.test.ts)

if [[ ${#SERVER_TESTS[@]} -eq 0 && ${#SHARED_TESTS[@]} -eq 0 ]]; then
  echo "no server/shared test suites found yet — nothing to run."
  exit 0
fi

# WS suites: any test that boots the server or opens a socket.
WS=()
NONWS=()
for f in "${SERVER_TESTS[@]}"; do
  if grep -lqE 'startGameServer|new WebSocket' "$f"; then WS+=("$f"); else NONWS+=("$f"); fi
done

A_RC=0
B_RC=0

echo "=== group A: non-WS server suites + packages/shared ==="
bun test "${NONWS[@]}" "${SHARED_TESTS[@]}" || A_RC=$?

if [[ ${#WS[@]} -gt 0 ]]; then
  echo ""
  echo "=== group B: WS suites ==="
  bun test "${WS[@]}" || B_RC=$?
fi

if [[ $A_RC -ne 0 || $B_RC -ne 0 ]]; then exit 1; fi
