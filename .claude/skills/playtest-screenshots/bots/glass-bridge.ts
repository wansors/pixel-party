// Glass Bridge bot: on its turn it either guesses blind after a short pause (★ if the panel holds) or
// waits for the lightning glint and plays it safe (no ★) until the timer runs low; otherwise it points
// at a random panel for whoever is jumping.
type Snap = {
  phase: string
  active: string | null
  target: number | null
  decideMs: number
  decideTotalMs: number
  glint: { row: number; side: 'L' | 'R' } | null
}
const seen = new Map<number, 'L' | 'R'>()
const brave = new Map<number, boolean>()

export default function play(s: Snap, me: string): unknown {
  if (s.glint) seen.set(s.glint.row, s.glint.side)
  if (s.phase !== 'decide' || s.target === null) return null
  if (s.active === me) {
    if (s.decideTotalMs - s.decideMs < 900) return null
    if (!brave.has(s.target)) brave.set(s.target, Math.random() < 0.5)
    const lit = seen.get(s.target)
    const guess = Math.random() < 0.5 ? 'L' : 'R'
    if (brave.get(s.target)) return { kind: 'jump', side: guess }
    if (lit) return { kind: 'jump', side: lit }
    return s.decideMs < 600 ? { kind: 'jump', side: guess } : null
  }
  return Math.random() < 0.05 ? { kind: 'point', side: Math.random() < 0.5 ? 'L' : 'R' } : null
}
