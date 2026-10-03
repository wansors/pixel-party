// Quick Draw bot: waits for the signal and draws a few ticks later (so reaction times vary); one bot in
// eight jumps the gun instead.
type View = { opponentId: string | null; fired: boolean; youDrew: boolean; done: boolean }

const firedAt = new Map<string, number>()

export default function play(s: { players: Record<string, View> }, me: string): unknown {
  const v = s.players[me]
  if (!v?.opponentId || v.done || v.youDrew) return null
  if (me.charCodeAt(1) % 8 === 0) return Math.random() < 0.2 ? { kind: 'draw' } : null
  if (!v.fired) return null
  const ticks = (firedAt.get(me) ?? 0) + 1
  firedAt.set(me, ticks)
  return ticks > 1 + Math.floor(Math.random() * 3) ? { kind: 'draw' } : null
}
