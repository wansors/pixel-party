import { MAX_ROOM_PLAYERS } from '@pp/shared'

const isDevelopment = process.env.NODE_ENV === 'development'

// Coerce an operator-supplied env integer with a documented default and a floor: a non-numeric or
// out-of-range value falls back to the default rather than poisoning the tick/room math.
export const envInt = (raw: string | undefined, fallback: number, min = 1): number => {
  const n = Math.floor(Number(raw))
  return Number.isFinite(n) && n >= min ? n : fallback
}

// Browser origins allowed to open the WS upgrade. Fail-closed: when unset, the dev client origin is
// admitted ONLY in an explicit development environment; everywhere else the list is empty so an
// unconfigured non-dev deployment rejects every origin. Parsed once, then frozen for the process.
let cachedOrigins: string[] | undefined
const parseAllowedOrigins = (): string[] => {
  if (cachedOrigins) return cachedOrigins
  const origins = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0)
  if (origins.length === 0 && isDevelopment) origins.push('http://localhost:4200')
  cachedOrigins = origins
  return origins
}

export const config = {
  port: envInt(process.env.PORT, 3000),
  isDevelopment,
  // Fixed-timestep sim loop for real-time mini-games (party games don't need 60).
  tickHz: envInt(process.env.TICK_HZ, 20),
  snapshotEveryNTicks: envInt(process.env.SNAPSHOT_EVERY_N_TICKS, 3),
  // Deterministic RNG seed for mini-game rolls (a determinism knob, NOT a secret).
  seed: envInt(process.env.RNG_SEED, 1, 0),
  wsIdleTimeoutSec: envInt(process.env.WS_IDLE_TIMEOUT_SEC, 60),
  roomCodeLen: envInt(process.env.ROOM_CODE_LEN, 4),
  // Capped at the catalog's ceiling: no mini-game is built (or player-count tagged) for more.
  roomMaxPlayers: Math.min(
    MAX_ROOM_PLAYERS,
    envInt(process.env.ROOM_MAX_PLAYERS, MAX_ROOM_PLAYERS),
  ),
  roomIdleTimeoutSec: envInt(process.env.ROOM_IDLE_TIMEOUT_SEC, 900),
  // Party mode: the production client build this server serves on its own port (`bun run start`). In
  // dev the folder may be missing or stale — the Angular dev server serves the client — so it's only
  // served when SERVE_CLIENT isn't "false" and the build exists.
  clientDir: process.env.CLIENT_DIR ?? `${import.meta.dir}/../../client/dist/client/browser`,
  serveClient: (process.env.SERVE_CLIENT ?? (isDevelopment ? 'false' : 'true')) !== 'false',
  // Bounded scoring catch-up (Phase 3). Ships OFF; enable per deployment while tuning. The cap is an
  // integer percent (default 20 → up to +20% for the furthest-behind player).
  handicapEnabled: (process.env.HANDICAP_ENABLED ?? '').toLowerCase() === 'true',
  handicapMaxBonusPct: envInt(process.env.HANDICAP_MAX_BONUS_PCT, 20, 0) / 100,
  get allowedOrigins(): string[] {
    return parseAllowedOrigins()
  },
} as const
