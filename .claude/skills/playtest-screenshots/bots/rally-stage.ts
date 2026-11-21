// Top-down racer bot (Rally Stage; Speed Circuit and Micro Race re-export it): an autopilot that aims at
// the centreline a few samples ahead and eases off in the bends. Rally: it pulls the handbrake for one
// beat (~150 ms, one call) to flick the car into a sharp bend at speed, then lets the steering catch the
// slide. Micro Race / Speed Circuit: it fires the turbo once the meter is full and the road ahead is
// straight. The course geometry comes from the shared package: $PP_REPO if set, else the repo this file
// lives in (shoot.ts run in place, or the bots folder symlinked rather than copied).
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

type Car = {
  id: string
  x: number
  y: number
  a: number
  vx?: number
  vy?: number
  finishMs: number | null
  driftMs?: number
  turbo?: number
}
// Course racers name a `kind` + `course`; Micro Race a `track`.
type Snap = { kind?: 'stage' | 'circuit'; course?: number; track?: number; cars: Car[] }
type Pt = { x: number; y: number }
type Shared = {
  courseDef: (kind: 'stage' | 'circuit', i: number) => unknown
  sampleCourse: (def: unknown) => Pt[]
  MICRO_RACE_TRACKS: readonly unknown[]
  sampleMicroRaceTrack: (def: unknown) => Pt[]
}

const repo = [process.env.PP_REPO, resolve(import.meta.dir, '../../../..')].find(
  (dir) => dir && existsSync(`${dir}/packages/shared/src/index.ts`),
)
if (!repo) console.warn('racer bot: no repo found (set PP_REPO=<repo root>), the cars stay parked')
const shared: Shared | null = repo ? await import(`${repo}/packages/shared/src/index.ts`) : null
const cache = new Map<string, Pt[]>()
// When each bot last pulled the handbrake (it is let go on the next call; one pull per second at most).
const pulledAt = new Map<string, number>()
const PULL_GAP_MS = 1000

function centreline(s: Snap): Pt[] | null {
  if (!shared) return null
  const key = s.track !== undefined ? `micro-${s.track}` : `${s.kind}-${s.course}`
  let samples = cache.get(key)
  if (!samples) {
    samples =
      s.track !== undefined
        ? shared.sampleMicroRaceTrack(shared.MICRO_RACE_TRACKS[s.track])
        : shared.sampleCourse(shared.courseDef(s.kind ?? 'stage', s.course ?? 0))
    cache.set(key, samples)
  }
  return samples
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a))

// How much the road turns between `from` and `to` samples ahead (radians, signed).
function bendAhead(samples: Pt[], i: number, from: number, to: number, open: boolean): number {
  const n = samples.length
  const at = (k: number): Pt => samples[open ? Math.min(n - 1, i + k) : (i + k) % n] as Pt
  const a = at(from)
  const b = at(Math.round((from + to) / 2))
  const c = at(to)
  return wrap(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x))
}

export default function play(s: Snap, me: string): unknown {
  const car = s.cars.find((c) => c.id === me)
  const samples = centreline(s)
  if (!samples || !car || car.finishMs !== null) return null
  let best = 0
  let bestD = Number.POSITIVE_INFINITY
  samples.forEach((p, i) => {
    const d = (p.x - car.x) ** 2 + (p.y - car.y) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  const n = samples.length
  const open = s.kind === 'stage'
  const target = samples[open ? Math.min(n - 1, best + 8) : (best + 8) % n]
  if (!target) return null
  const diff = wrap(Math.atan2(target.y - car.y, target.x - car.x) - car.a)
  const wobble = (me.charCodeAt(0) % 3) * 0.05 // a little variety between bots
  const drive = {
    kind: 'drive',
    steer: Math.max(-1, Math.min(1, diff / 0.35 + wobble)),
    throttle: Math.abs(diff) > 0.6 ? 0.5 : 0.95,
  }
  const speed = Math.hypot(car.vx ?? 0, car.vy ?? 0)
  if (open) {
    // Rally: a sharp bend coming up at speed → one beat of handbrake, steering into it.
    const bend = bendAhead(samples, best, 4, 22, true)
    const now = Date.now()
    const flick =
      now - (pulledAt.get(me) ?? 0) > PULL_GAP_MS &&
      Math.abs(bend) > 0.55 &&
      speed > 130 &&
      (car.driftMs ?? 0) === 0
    if (flick) pulledAt.set(me, now)
    return { ...drive, handbrake: flick }
  }
  // Micro Race / Speed Circuit: turbo on a straight with a full meter.
  const straight = Math.abs(bendAhead(samples, best, 2, 40, false)) < 0.25
  return { ...drive, turbo: (car.turbo ?? 0) >= 1 && straight && Math.abs(diff) < 0.2 }
}
