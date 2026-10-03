// Tug of War bot: pulls about 5 times a second (a brisk human pace), so the rope actually moves.
type Snap = { teams: Record<string, string>; done: boolean }

export default function play(s: Snap, me: string): unknown {
  if (!s.teams[me] || s.done) return null
  return Math.random() < 0.75 ? { kind: 'pull' } : null
}
