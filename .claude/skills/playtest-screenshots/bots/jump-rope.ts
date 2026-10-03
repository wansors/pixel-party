// Jump Rope bot: jumps a beat before the rope comes round (one of them is sloppy and trips).
type Snap = { nextPassMs: number; players: { id: string; alive: boolean; jumpMs: number | null }[] }

export default function play(s: Snap, me: string): unknown {
  const p = s.players.find((q) => q.id === me)
  if (!p?.alive || p.jumpMs !== null) return null
  const sloppy = me.charCodeAt(1) % 2 === 0
  const lead = sloppy ? 380 : 230
  return s.nextPassMs <= lead && s.nextPassMs > lead - 150 ? { kind: 'jump' } : null
}
