// Higher or Lower bot: plays the odds (higher on a low card, lower on a high one) and banks once its
// streak reaches a target it picks — or busts trying.
type View = {
  cards: Record<string, { current: number; index: number; status: string }>
  scores: Record<string, number>
}

const targets = new Map<string, number>()

export default function play(s: View, me: string): unknown {
  const card = s.cards[me]
  if (card?.status !== 'playing' || Math.random() < 0.5) return null
  const target = targets.get(me) ?? 3 + Math.floor(Math.random() * 6)
  targets.set(me, target)
  if ((s.scores[me] ?? 0) >= target) return { kind: 'bank' }
  return { kind: 'guess', index: card.index, dir: card.current <= 8 ? 'higher' : 'lower' }
}
