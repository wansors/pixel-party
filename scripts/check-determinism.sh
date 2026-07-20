#!/usr/bin/env bash
# Determinism gate: the server DOMAIN must be a pure function of (seed via Random, time via Clock).
# Mini-game logic lives in domain/ and must be reproducible — "same board for everyone" and
# server-validated replays depend on it. Randomness flows through the Random port, time through the
# Clock port. Scoped to apps/server/src/domain/ ONLY; the infra/driving layer legitimately uses wall
# time (setInterval pacing) and is out of scope here.
#
# Usage: bash scripts/check-determinism.sh   (also: bun run lint:determinism)
set -euo pipefail

DOMAIN_DIR="apps/server/src/domain/"

if [[ ! -d "$DOMAIN_DIR" ]]; then
  echo "determinism gate: ${DOMAIN_DIR} not present yet — nothing to check."
  exit 0
fi

if grep -rnE 'Math\.random|Date\.now|performance\.now' "$DOMAIN_DIR"; then
  echo "" >&2
  echo "ERROR: non-deterministic call found in ${DOMAIN_DIR}" >&2
  echo "  The domain must stay deterministic — inject randomness via the Random port and time via" >&2
  echo "  the Clock port instead of calling Math.random / Date.now / performance.now directly." >&2
  exit 1
fi

echo "determinism gate: ${DOMAIN_DIR} is clean (no Math.random / Date.now / performance.now)."
