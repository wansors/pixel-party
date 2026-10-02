import type { AthleticsFoot } from '@pp/shared'

// Shared sprint model behind the track & field games (`trackRace`, `fieldEvent`): the classic
// two-button arcade run. Every stride on the opposite foot adds a speed impulse that shrinks as the
// runner nears top speed; the same foot twice adds nothing; speed bleeds off continuously. Steady
// speed therefore tracks the alternating tap rate: ~7 m/s at 6 strides/s, ~9.3 at 10, ~10.8 at 15.

const STRIDE_BOOST = 2.2 // m/s added per stride at a standstill
const TOP_SPEED = 16 // asymptote the boost saturates toward (never reached by humans)
const DRAG = 1.0 // exponential speed decay per second
// Strides closer together than this are ignored (20 strides/s cap): no macro out-runs a thumb.
export const MIN_STRIDE_MS = 50

export interface Runner {
  x: number
  v: number
  lastFoot: AthleticsFoot | null
  lastStrideAt: number
}

export function createRunner(): Runner {
  return { x: 0, v: 0, lastFoot: null, lastStrideAt: Number.NEGATIVE_INFINITY }
}

export function isFoot(foot: unknown): foot is AthleticsFoot {
  return foot === 'L' || foot === 'R'
}

// Applies one tap. Returns true when it counted as a stride (alternating foot, under the rate cap).
export function stride(r: Runner, foot: AthleticsFoot, now: number): boolean {
  if (foot === r.lastFoot || now - r.lastStrideAt < MIN_STRIDE_MS) return false
  r.lastFoot = foot
  r.lastStrideAt = now
  r.v += STRIDE_BOOST * (1 - r.v / TOP_SPEED)
  return true
}

// Advances the runner by dt ms: speed decays (extra `drag` for a runner easing up past the line),
// position integrates.
export function coast(r: Runner, dtMs: number, extraDrag = 0): void {
  const s = dtMs / 1000
  r.v *= Math.exp(-(DRAG + extraDrag) * s)
  if (r.v < 0.01) r.v = 0
  r.x += r.v * s
}

// Ranks already-sorted player ids: equal keys share a rank (0-based), like the other games' results.
export function rankSorted(
  sorted: readonly string[],
  key: (id: string) => number,
): Record<string, number> {
  const ranks: Record<string, number> = {}
  let rank = 0
  let prev: number | undefined
  sorted.forEach((id, idx) => {
    const k = key(id)
    if (idx > 0 && k !== prev) rank = idx
    ranks[id] = rank
    prev = k
  })
  return ranks
}
