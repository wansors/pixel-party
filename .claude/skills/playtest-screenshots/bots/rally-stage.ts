// Course racer bot (Rally Stage, and Speed Circuit via its re-export): an autopilot that aims at the
// centreline a few samples ahead and eases off in the bends. Needs the course geometry from the repo:
// run shoot.ts with PP_REPO=<repo root>.
type Car = { id: string; x: number; y: number; a: number; finishMs: number | null }
type Snap = { kind: 'stage' | 'circuit'; course: number; cars: Car[] }
type Shared = {
  courseDef: (kind: 'stage' | 'circuit', i: number) => unknown
  sampleCourse: (def: unknown) => { x: number; y: number }[]
}

const repo = process.env.PP_REPO
const shared: Shared | null = repo ? await import(`${repo}/packages/shared/src/index.ts`) : null
const cache = new Map<string, { x: number; y: number }[]>()

export default function play(s: Snap, me: string): unknown {
  const car = s.cars.find((c) => c.id === me)
  if (!shared || !car || car.finishMs !== null) return null
  const key = `${s.kind}-${s.course}`
  let samples = cache.get(key)
  if (!samples) {
    samples = shared.sampleCourse(shared.courseDef(s.kind, s.course))
    cache.set(key, samples)
  }
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
  const target =
    samples[s.kind === 'circuit' ? (best + 8) % n : Math.min(n - 1, best + 8)] ?? samples[0]
  if (!target) return null
  let diff = Math.atan2(target.y - car.y, target.x - car.x) - car.a
  diff = Math.atan2(Math.sin(diff), Math.cos(diff))
  const wobble = (me.length % 3) * 0.05 // a little variety between bots
  return {
    kind: 'drive',
    steer: Math.max(-1, Math.min(1, diff / 0.35 + wobble)),
    throttle: Math.abs(diff) > 0.6 ? 0.5 : 0.95,
  }
}
