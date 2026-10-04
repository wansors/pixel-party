// Bug Smash bot: whacks a live bug now and then (and, rarely, a bomb by mistake).
type Snap = { live: { index: number; hole: number; kind: 'bug' | 'bomb' }[] }

export default function play(s: Snap, me: string): unknown {
  if (Math.random() > 0.35 + (me.charCodeAt(1) % 3) * 0.1) return null
  const bugs = s.live.filter((b) => b.kind === 'bug' || Math.random() < 0.1)
  const pick = bugs[Math.floor(Math.random() * bugs.length)]
  return pick ? { kind: 'smash', hole: pick.hole } : null
}
