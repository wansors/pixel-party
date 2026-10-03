// Marbles Duel bot: hides 1–4 marbles, or bets 1–3 on a coin-flip call, a moment into each turn.
type View = {
  role: 'hide' | 'guess'
  phase: string
  youChose: boolean
  mine: number
  msLeft: number
}

export default function play(s: { players: Record<string, View> }, me: string): unknown {
  const v = s.players[me]
  if (!v || v.phase !== 'choose' || v.youChose || v.msLeft > 4500) return null
  const n = 1 + Math.floor(Math.random() * Math.min(4, v.mine))
  return v.role === 'hide'
    ? { kind: 'hide', count: n }
    : { kind: 'guess', bet: Math.min(n, 3), odd: Math.random() < 0.5 }
}
