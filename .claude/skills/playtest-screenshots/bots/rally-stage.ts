// Top-down racer bot (Rally Stage; Speed Circuit and Micro Race re-export it): an autopilot that aims at
// the centreline a few samples ahead and eases off in the bends. The course geometry comes from the
// shared package: $PP_REPO if set, else the repo this file lives in (shoot.ts run in place, or the bots
// folder symlinked rather than copied).
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

type Car = { id: string; x: number; y: number; a: number; finishMs: number | null }
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
  const target = samples[s.kind === 'stage' ? Math.min(n - 1, best + 8) : (best + 8) % n]
  if (!target) return null
  let diff = Math.atan2(target.y - car.y, target.x - car.x) - car.a
  diff = Math.atan2(Math.sin(diff), Math.cos(diff))
  const wobble = (me.charCodeAt(0) % 3) * 0.05 // a little variety between bots
  return {
    kind: 'drive',
    steer: Math.max(-1, Math.min(1, diff / 0.35 + wobble)),
    throttle: Math.abs(diff) > 0.6 ? 0.5 : 0.95,
  }
}
