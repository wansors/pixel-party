// Pixel Pong bot: slides its paddle toward the ball, a little late and a little off, so points happen.
type View = { opponentId: string | null; done: boolean; youY: number; ballY: number }

export default function play(s: { players: Record<string, View> }, me: string): unknown {
  const v = s.players[me]
  if (!v?.opponentId || v.done) return null
  const aim = v.ballY + (Math.random() - 0.5) * 0.3
  return { kind: 'move', y: Math.max(0, Math.min(1, v.youY + (aim - v.youY) * 0.5)) }
}
