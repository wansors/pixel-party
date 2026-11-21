// Bar Rush bot: carries its own bar to "now" with the shared rules (from $PP_REPO). An empty glass
// about to reach the end comes first (go to that bar); otherwise it serves the bar whose front
// customer is closest to its end and not already covered by a drink in flight. It decides per
// snapshot and each bot hesitates a little differently, so glasses still smash now and then.
const shared = await import(`${process.env.PP_REPO}/packages/shared/src/games/barRush.ts`)
const { BAR, BAR_WALK, barClone, barRun, barSnap } = shared

interface Body {
  t: number
  lane: number
  canServeAt: number
  customers: { lane: number; x: number; state: number }[]
  glasses: { lane: number; x: number; full: boolean }[]
}
interface Snap {
  arrivals: unknown[]
  boards: Record<string, { body: Body; cmds: unknown[] }>
  t: number
}

export default function play(snapshot: unknown, me: string): unknown {
  const s = snapshot as Snap
  const v = s?.boards?.[me]
  if (!v) return null
  const now = barSnap(s.t + 30)
  if (now < BAR.startDelayMs) return null
  const b = barClone(v.body) as Body
  barRun(b, now, v.cmds, s.arrivals)
  let h = 0
  for (const ch of me) h = (h * 31 + ch.charCodeAt(0)) | 0
  const patience = 0.35 + (Math.abs(h) % 4) * 0.1
  // An empty glass close to the end: be there.
  const empty = b.glasses
    .filter((g) => !g.full)
    .map((g) => ({ lane: g.lane, eta: (BAR.tapX - g.x) / BAR.emptySpeed }))
    .sort((a, c) => a.eta - c.eta)[0]
  if (empty && empty.eta < patience)
    return empty.lane === b.lane ? null : { kind: 'bar', lane: empty.lane, at: now }
  // The most urgent bar: its front walking customer is nearest the end, with no drink on the way.
  let best = -1
  let bestX = -1
  for (let lane = 0; lane < BAR.lanes; lane++) {
    const walkers = b.customers.filter((c) => c.lane === lane && c.state === BAR_WALK).length
    const drinks = b.glasses.filter((g) => g.lane === lane && g.full).length
    if (walkers <= drinks) continue
    const front = Math.max(
      ...b.customers.filter((c) => c.lane === lane && c.state === BAR_WALK).map((c) => c.x),
    )
    if (front > bestX) {
      bestX = front
      best = lane
    }
  }
  if (best < 0) return null
  if (best !== b.lane) return { kind: 'bar', lane: best, at: now }
  return b.t >= b.canServeAt ? { kind: 'bar', serve: true, at: now } : null
}
