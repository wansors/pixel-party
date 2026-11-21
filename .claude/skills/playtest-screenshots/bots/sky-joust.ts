// Sky Joust bot: runs the shared world (from $PP_REPO) forward to "now", picks the nearest rival it can
// hit, steers toward them (across the wrap) and flaps to stay a little above them — or just to keep
// out of the lava. Each bot likes a slightly different height, and it only decides per snapshot, so
// it loses its share of jousts — like a person.
const shared = await import(`${process.env.PP_REPO}/packages/shared/src/games/skyJoust.ts`)
const { JOUST, joustClone, joustDx, joustRun, joustSnap } = shared

interface Rider {
  x: number
  y: number
  vy: number
  steer: number
  downUntil: number
  safeUntil: number
  flapAt: number
}
interface Snap {
  world: { t: number; riders: Rider[] }
  ids: string[]
  cmds: unknown[][]
  t: number
}

export default function play(snapshot: unknown, me: string): unknown {
  const s = snapshot as Snap
  const i = s?.ids?.indexOf(me) ?? -1
  if (i < 0) return null
  const now = joustSnap(s.t + 30)
  if (now < JOUST.startDelayMs) return null
  const w = joustClone(s.world)
  joustRun(w, now, s.cmds, false)
  const r = w.riders[i] as Rider
  if (r.downUntil > w.t) return null
  let h = 0
  for (const ch of me) h = (h * 31 + ch.charCodeAt(0)) | 0
  const above = 0.04 + (Math.abs(h) % 5) * 0.012
  let target: Rider | null = null
  let best = 99
  w.riders.forEach((o, k) => {
    if (k === i || o.downUntil > w.t || o.safeUntil > w.t) return
    const dx = joustDx(r.x, o.x)
    const d = dx * dx + (o.y - r.y) * (o.y - r.y)
    if (d < best) {
      best = d
      target = o
    }
  })
  const t = target as Rider | null
  const steer = t ? (joustDx(r.x, t.x) > 0 ? 1 : -1) : r.x < JOUST.w / 2 ? 1 : -1
  const wantY = t ? t.y - above : 0.4
  const sinceFlap = w.t - r.flapAt
  // Bots beat their wings out of step with each other (two mirror-image bots would otherwise rise and
  // fall as one and never win a joust).
  const inStep = (Math.floor(now / 50) + Math.abs(h)) % 3 !== 0
  const flap = sinceFlap > 170 && r.vy > -0.15 && (r.y > 0.72 || (inStep && r.y > wantY))
  if (!flap && steer === r.steer) return null
  return { kind: 'fly', ...(flap ? { flap: true } : {}), steer, at: now }
}
