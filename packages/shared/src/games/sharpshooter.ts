import { rampEase } from '../difficulty'

// Sharpshooter wire shapes and rules shared by the server and the client (D45). A Wild West shooting
// gallery: cardboard bandits pop up in the saloon's and the store's windows and doors, bottles stand on
// the fence and tin cans are tossed across the sky — everyone gets every target, from one seeded
// schedule. Civilians pop up too: shooting one costs points. The aim breathes: the crosshair sways in a
// slow figure-eight with each breath (shootSway); holding your breath steadies it until your lungs run
// out. A six-shooter: six shots, then a reload.
//
// World units: the scene is SHOOT.w wide and 1 tall (0 = top). Times are ms after GO.

export type ShootKind = 'bandit' | 'civilian' | 'bottle' | 'can'
export type ShootSpotKind = 'window' | 'door' | 'fence'

export const SHOOT = {
  w: 16 / 9,
  // Everyone gets ready this long after the round starts.
  startDelayMs: 1500,
  ammo: 6,
  reloadMs: 1300,
  // Fastest the hammer can be fanned.
  shotGapMs: 230,
  // How old a shot's `at` may be when it arrives (the rest is clamped).
  lateMs: 250,
  // Pop-up targets take this long to rise and to drop (not hittable while moving).
  popMs: 140,
  points: { bandit: 100, bottle: 150, can: 250, civilian: -200 } as Record<ShootKind, number>,
  // Hit boxes (half sizes, world units) for the cardboard cut-outs and the bottles; cans are round.
  box: {
    bandit: [0.055, 0.085],
    civilian: [0.055, 0.085],
    bottle: [0.02, 0.042],
  } as Record<Exclude<ShootKind, 'can'>, readonly [number, number]>,
  canR: 0.032,
  // Breath: one slow cycle, the sway's size, holding it down to this share, how long the lungs last
  // and refill, and the gasp after running out.
  breathMs: 3600,
  sway: 0.034,
  holdShare: 0.15,
  lungsMs: 2600,
  refillMs: 3200,
  gaspMs: 1200,
} as const

export interface ShootSpot {
  kind: ShootSpotKind
  x: number
  y: number
}

// Where targets show up: the saloon (left) and the store (right), and the fence between them.
export const SHOOT_SPOTS: readonly ShootSpot[] = [
  { kind: 'window', x: 0.27, y: 0.4 },
  { kind: 'window', x: 0.5, y: 0.4 },
  { kind: 'door', x: 0.385, y: 0.6 },
  { kind: 'window', x: 1.3, y: 0.42 },
  { kind: 'door', x: 1.52, y: 0.6 },
  { kind: 'fence', x: 0.74, y: 0.72 },
  { kind: 'fence', x: 0.84, y: 0.72 },
  { kind: 'fence', x: 0.94, y: 0.72 },
  { kind: 'fence', x: 1.04, y: 0.72 },
]

export interface ShootTarget {
  id: number
  kind: ShootKind
  // A spot index (pop-ups and bottles), or -1 for a tossed can.
  spot: number
  at: number
  stay: number
  // A can's flight: from x0 to x1, peaking `peak` above the ground line.
  x0?: number
  x1?: number
  peak?: number
}

// Pace over the round (`p` = 0..1): how long targets stay and how often they come, eased in (D40).
export const SHOOT_PACE = {
  rampMs: 40_000,
  popStay: [1700, 750] as const,
  bottleStay: [2600, 1200] as const,
  canStay: [2300, 1300] as const,
  gap: [850, 420] as const,
  civilian: [0.1, 0.28] as const,
  // The crosshair's sway grows with the nerves of the last stretch.
  nerves: [1, 1.4] as const,
}

export function shootProgress(t: number): number {
  return Math.min(1, Math.max(0, t / SHOOT_PACE.rampMs))
}

export function shootNerves(t: number): number {
  return rampEase(SHOOT_PACE.nerves[0], SHOOT_PACE.nerves[1], shootProgress(t), 2)
}

const GROUND = 0.92

// Where a target is at `t` and whether it can be hit then (pop-ups only once fully up).
export function shootTargetAt(
  tg: ShootTarget,
  t: number,
): { x: number; y: number; live: boolean; rise: number } | null {
  const age = t - tg.at
  if (age < 0 || age > tg.stay) return null
  if (tg.kind === 'can') {
    const p = age / tg.stay
    const x0 = tg.x0 ?? 0
    const x1 = tg.x1 ?? SHOOT.w
    return {
      x: x0 + (x1 - x0) * p,
      y: GROUND - 4 * (tg.peak ?? 0.6) * p * (1 - p),
      live: true,
      rise: 1,
    }
  }
  const spot = SHOOT_SPOTS[tg.spot] as ShootSpot
  if (tg.kind === 'bottle') return { x: spot.x, y: spot.y - 0.05, live: true, rise: 1 }
  const rise = Math.min(1, age / SHOOT.popMs, (tg.stay - age) / SHOOT.popMs)
  return { x: spot.x, y: spot.y, live: rise >= 1, rise }
}

// The target a shot at (x, y) hits at `t` among `targets` (skipping ids in `done`), or null. The
// smaller target wins an overlap (a bottle in front of a bandit's window, a can across a door).
export function shootHit(
  targets: readonly ShootTarget[],
  t: number,
  x: number,
  y: number,
  done?: ReadonlySet<number>,
): ShootTarget | null {
  let best: ShootTarget | null = null
  let bestSize = Number.POSITIVE_INFINITY
  for (const tg of targets) {
    if (done?.has(tg.id)) continue
    const pos = shootTargetAt(tg, t)
    if (!pos?.live) continue
    let size: number
    if (tg.kind === 'can') {
      const dx = x - pos.x
      const dy = y - pos.y
      if (dx * dx + dy * dy > SHOOT.canR * SHOOT.canR) continue
      size = SHOOT.canR
    } else {
      const [hw, hh] = SHOOT.box[tg.kind]
      if (Math.abs(x - pos.x) > hw || Math.abs(y - pos.y) > hh) continue
      size = hw * hh
    }
    if (size < bestSize) {
      best = tg
      bestSize = size
    }
  }
  return best
}

// The breathing sway at `t` (scene ms): a slow figure-eight with a lazy drift, `steady` 0..1 (holding
// your breath) shrinking it, `gasp` 0..1 (just ran out of breath) swelling it, scaled by the nerves.
// `phase` gives every player their own rhythm.
export function shootSway(
  t: number,
  phase: number,
  steady: number,
  gasp: number,
  nerves: number,
): { dx: number; dy: number } {
  const a = (t / SHOOT.breathMs) * Math.PI * 2 + phase
  const amp = SHOOT.sway * nerves * (1 - (1 - SHOOT.holdShare) * steady) * (1 + 0.8 * gasp)
  return {
    dx: amp * (Math.sin(a) + 0.25 * Math.sin(2.7 * a + 1.3)),
    dy: amp * (0.6 * Math.sin(2 * a) + 0.3 * Math.sin(0.5 * a + 0.7)),
  }
}

export interface ShootPlayerView {
  score: number
  ammo: number
  // Ms of reloading left (0 = ready).
  reloadMs: number
  shots: number
  hits: number
}

export interface ShootHole {
  // Target hit, by whom, where (world units) and when.
  target: number
  player: string
  x: number
  y: number
  at: number
}

export interface ShootSnapshot {
  // Targets on screen now or about to be (and those just gone, for their exit).
  targets: ShootTarget[]
  players: Record<string, ShootPlayerView>
  // Recent hits by everyone (rivals' holes show in their colors).
  holes: ShootHole[]
  // Round time (ms since the round started; GO is at SHOOT.startDelayMs) at this snapshot.
  t: number
  // playerId -> score, for the live standings.
  scores: Record<string, number>
  remainingMs: number
}

// Shoot at (x, y) world units; `at` = ms after GO on the client's estimate of the server clock. Or
// reload early.
export type ShootInput = { kind: 'shot'; x: number; y: number; at?: number } | { kind: 'reload' }
