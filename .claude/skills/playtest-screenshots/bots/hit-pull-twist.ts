// Hit, Pull, Twist bot: follows its own orders with the shared rules, a beat after each shows; it
// slips now and then (and more as the windows shrink), so bots drop out over the round like people.
const { HPT_FREEZE, hptExpected, hptOrder, hptWindowMs } = await import(
  `${process.env.PP_REPO}/packages/shared/src/games/hitPullTwist.ts`
)

interface Snap {
  seed: number
  players: Record<string, { k: number; alive: boolean; orderInMs: number }>
}

const sent = new Map<string, number>()

export default function play(snapshot: unknown, me: string): unknown {
  const s = snapshot as Snap
  const p = s.players?.[me]
  if (!p?.alive || p.orderInMs > -250 || sent.get(me) === p.k) return null
  const order = hptOrder(s.seed, p.k)
  if (order.action === HPT_FREEZE) return null
  sent.set(me, p.k)
  const slip = Math.random() < 0.02 + 300 / hptWindowMs(p.k) / 40
  const right = hptExpected(order)
  return { kind: 'act', k: p.k, action: slip ? (right + 1) % 4 : right }
}
