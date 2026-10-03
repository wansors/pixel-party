// Weird Trivia bot: guesses a random answer a moment into each question (some never answer in time).
type View = {
  phase: string
  index: number
  phaseRemainingMs: number
  answeredCurrent: string[]
}

export default function play(s: View, me: string): unknown {
  if (s.phase !== 'question' || s.answeredCurrent.includes(me)) return null
  if (s.phaseRemainingMs > 4200 || Math.random() < 0.6) return null
  return { kind: 'answer', question: s.index, choice: Math.floor(Math.random() * 4) }
}
