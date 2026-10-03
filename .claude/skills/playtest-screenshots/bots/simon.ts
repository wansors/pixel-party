// Simon bot: repeats its own sequence one pad per call, then slips at a level of its own (2–7).
type View = { seq: number[]; pos: number; alive: boolean }

// The view each bot last answered, so a stale snapshot never gets the same pad twice.
const answered = new Map<string, string>()

export default function play(s: { players: Record<string, View> }, me: string): unknown {
  const v = s.players[me]
  const key = `${v?.seq.length}:${v?.pos}`
  if (!v?.alive || answered.get(me) === key) return null
  answered.set(me, key)
  const slipAt = 2 + (me.charCodeAt(1) % 6)
  const pad = v.seq[v.pos] ?? 0
  return {
    kind: 'pad',
    pad: v.seq.length > slipAt && v.pos === v.seq.length - 1 ? (pad + 1) % 4 : pad,
  }
}
