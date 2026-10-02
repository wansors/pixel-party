// Glass Bridge bot: jumps after a short pause (trusting the lightning glint when it saw one), and
// otherwise points at a random panel for whoever is jumping.
type Snap = {
  phase: string
  active: string | null
  target: number | null
  decideMs: number
  decideTotalMs: number
  glint: { row: number; side: 'L' | 'R' } | null
}
const seen = new Map<number, 'L' | 'R'>()

export default function play(s: Snap, me: string): unknown {
  if (s.glint) seen.set(s.glint.row, s.glint.side)
  if (s.phase !== 'decide' || s.target === null) return null
  if (s.active === me) {
    if (s.decideTotalMs - s.decideMs < 900) return null
    return { kind: 'jump', side: seen.get(s.target) ?? (Math.random() < 0.5 ? 'L' : 'R') }
  }
  return Math.random() < 0.05 ? { kind: 'point', side: Math.random() < 0.5 ? 'L' : 'R' } : null
}
