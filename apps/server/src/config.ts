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
  roomMaxPlayers: envInt(process.env.ROOM_MAX_PLAYERS, 10),
  roomIdleTimeoutSec: envInt(process.env.ROOM_IDLE_TIMEOUT_SEC, 900),
  get allowedOrigins(): string[] {
    return parseAllowedOrigins()
  },
} as const
