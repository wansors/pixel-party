// Balloon Chicken bot: pumps each balloon up to a target it picks per balloon (4–12 pumps), then cashes
// out — greedy targets pop, and a slow bot gets caught by the buzzer.
type View = {
  players: Record<string, { pumps: number; outcomes: string[] }>
  remainingMs: number
}

const targets = new Map<string, number>()

export default function play(s: View, me: string): unknown {
  const p = s.players[me]
  if (!p || p.outcomes.length >= 3 || s.remainingMs <= 0 || Math.random() < 0.4) return null
  const key = `${me}:${p.outcomes.length}`
  const target = targets.get(key) ?? 4 + Math.floor(Math.random() * 9)
  targets.set(key, target)
  return p.pumps >= target ? { kind: 'cashout' } : { kind: 'pump' }
}
