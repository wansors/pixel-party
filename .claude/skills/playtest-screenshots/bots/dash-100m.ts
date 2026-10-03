// Track race bot (100 m; the hurdles re-export it): waits for the gun, then alternates feet once per
// call (~7 strides/s) and jumps each hurdle a stride before it. Every other bot is sloppy and leaves a
// hurdle standing now and then, so knocks show up too.
type Runner = {
  id: string
  x: number
  v: number
  finishMs: number | null
  held: boolean
  air: boolean
}
type Snap = { phase: 'set' | 'go'; hurdles: number[]; runners: Runner[] }

const lastFoot = new Map<string, 'L' | 'R'>()

export default function play(s: Snap, me: string): unknown {
  const r = s.runners.find((q) => q.id === me)
  if (!r || s.phase !== 'go' || r.held || r.finishMs !== null) return null
  const next = s.hurdles.findIndex((h) => h > r.x)
  const ahead = next >= 0 ? (s.hurdles[next] as number) - r.x : Number.POSITIVE_INFINITY
  const sloppy = me.charCodeAt(0) % 2 === 0 && next % 3 === 2
  if (!r.air && !sloppy && ahead > 0.3 && ahead < 0.3 + r.v * 0.2) return { kind: 'jump' }
  const foot = lastFoot.get(me) === 'L' ? 'R' : 'L'
  lastFoot.set(me, foot)
  return { kind: 'step', foot }
}
