// Lightning Quiz bot: guesses a random answer a couple of seconds into each question (some never
// answer in time), so the early close, the reveal and the contestant lights all get exercised.
type View = {
  phase: string
  index: number
  phaseRemainingMs: number
  answeredCurrent: string[]
}

export default function play(s: View, me: string): unknown {
  if (s.phase !== 'question' || s.answeredCurrent.includes(me)) return null
  if (s.phaseRemainingMs > 5000 || Math.random() < 0.6) return null
  return { kind: 'answer', question: s.index, choice: Math.floor(Math.random() * 4) }
}
