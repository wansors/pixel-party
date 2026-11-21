import { rampEase } from '../difficulty'

// Wing It wire shapes and the flight rules shared by the server and the client's prediction (D42). A
// tap-to-flap course: everyone flies the same seeded columns at once (as ghosts — riders never touch),
// gravity pulls you down, a tap kicks you up, and touching a column or the floor ends your flight.
// The flight is integrated on a fixed WING.dtMs grid with plain arithmetic only (no Math.pow/sin…), so
// the server and every client compute bit-identical trajectories from the same flap times. Flaps carry
// the time they were pressed (on the server's round clock) and the server judges crashes WING.judgeMs
// behind real time, so a flap counts exactly when it was pressed. The world scrolls faster and the gaps
// narrow on an ease-in (D40).

export const WING = {
  // Everyone hovers this long after the round starts (GET READY), then the flight starts.
  startDelayMs: 1500,
  // Integration step (ms) — flap times snap up to this grid.
  dtMs: 5,
  // Units: the playfield is 1 tall (0 = top, 1 = floor); x is world distance in the same units.
  startY: 0.42,
  gravity: 2.9, // units/s²
  flapVy: -0.82, // units/s, set by a flap
  maxFallVy: 1.5,
  radius: 0.032,
  // The bird sits this far right of the screen's left edge (world units).
  birdX: 0.45,
  // Columns: width, and how far ahead of the bird they are listed in the snapshot.
  columnW: 0.13,
  viewAhead: 1.9,
  // How far behind real time the server judges crashes: the most a flap's trip may take.
  judgeMs: 150,
  // Flaps closer than this are dropped (key repeat / mashing).
  minFlapGapMs: 70,
} as const

// Pace over the round (`p` = 0..1 of the round): speed, column spacing and gap height ease in.
export const WING_PACE = {
  speed: [0.42, 0.78] as const, // units/s
  spacing: [1.05, 0.72] as const, // units between columns
  gap: [0.36, 0.25] as const, // gap height
  // The ramp runs over this long (ms after GO); the pace holds after it.
  rampMs: 45_000,
}

// Scroll speed (units/s) at `t` ms after GO.
export function wingSpeed(t: number): number {
  const [a, b] = WING_PACE.speed
  return rampEase(a, b, t / WING_PACE.rampMs, 2)
}

// World distance scrolled by `t` ms after GO: the integral of wingSpeed (a + (b−a)·(t/T)² up to T).
export function wingDistance(t: number): number {
  if (t <= 0) return 0
  const [a, b] = WING_PACE.speed
  const T = WING_PACE.rampMs
  const s = Math.min(t, T)
  const ramped = (a * s + ((b - a) * s * s * s) / (3 * T * T)) / 1000
  return ramped + (t > T ? (b * (t - T)) / 1000 : 0)
}

export interface WingColumn {
  id: number
  // World x of the column's center.
  x: number
  // Gap center and height (0..1 playfield units).
  gapY: number
  gapH: number
}

// One flier's state at a point in time (ms after GO).
export interface WingBody {
  t: number
  y: number
  vy: number
}

export const wingSnap = (t: number): number => Math.ceil(t / WING.dtMs) * WING.dtMs

// One integration step (WING.dtMs) — flap first when one is due at this step's start.
export function wingStep(b: WingBody, flap: boolean): void {
  const dt = WING.dtMs / 1000
  if (flap) b.vy = WING.flapVy
  b.vy = Math.min(WING.maxFallVy, b.vy + WING.gravity * dt)
  b.y += b.vy * dt
  // The ceiling stops you (no crash); the floor is a crash the caller judges.
  if (b.y < WING.radius) {
    b.y = WING.radius
    if (b.vy < 0) b.vy = 0
  }
  b.t += WING.dtMs
}

// Whether a flier at `y`, with the world scrolled to `dist`, touches a column or the floor.
export function wingHits(y: number, dist: number, columns: readonly WingColumn[]): boolean {
  if (y + WING.radius >= 1) return true
  const bx = dist + WING.birdX
  const reach = WING.columnW / 2 + WING.radius * 0.8
  for (const c of columns) {
    if (Math.abs(c.x - bx) > reach) continue
    const half = c.gapH / 2
    if (y - WING.radius * 0.8 < c.gapY - half || y + WING.radius * 0.8 > c.gapY + half) return true
  }
  return false
}

// Carries a body forward to `until` (ms after GO, on the grid), flapping at the given (snapped) times.
// Stops early on a crash when `columns` are given; returns the crash time or null.
export function wingFly(
  b: WingBody,
  until: number,
  flaps: readonly number[],
  columns?: readonly WingColumn[],
): number | null {
  let i = 0
  while (i < flaps.length && (flaps[i] as number) < b.t) i++
  while (b.t < until) {
    let flap = false
    while (i < flaps.length && (flaps[i] as number) <= b.t) {
      flap = true
      i++
    }
    wingStep(b, flap)
    if (columns && wingHits(b.y, wingDistance(b.t), columns)) return b.t
  }
  return null
}

export interface WingFlierView {
  // Judged state: position and speed at `t` (ms after GO)...
  t: number
  y: number
  vy: number
  // ...and the flaps already taken after it (snapped ms after GO, ascending).
  flaps: number[]
  alive: boolean
  // When it crashed (ms after GO; 0 = still flying).
  outAt: number
  // Columns flown through.
  passed: number
  // The last input `seq` the server has taken (0 = none).
  ack: number
}

export interface WingSnapshot {
  fliers: Record<string, WingFlierView>
  // Columns from just behind the birds to WING.viewAhead in front.
  columns: WingColumn[]
  // Round time (ms since the round started — GO is at WING.startDelayMs) at this snapshot.
  t: number
  // playerId -> columns passed, for the live standings.
  progress: Record<string, number>
  remainingMs: number
}

// Flap. `at` is when it was pressed, in ms after GO on the client's estimate of the server clock.
export interface WingInput {
  kind: 'flap'
  at?: number
  seq?: number
}
