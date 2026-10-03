// Color Trap bot: answers most prompts a moment in, usually the ink but sometimes falling for the word
// (a wrong tap costs a point).
type View = {
  index: number
  word: number | null
  ink: number | null
  promptRemainingMs: number
  answeredCurrent: string[]
}

export default function play(s: View, me: string): unknown {
  if (s.ink === null || s.answeredCurrent.includes(me)) return null
  if (s.promptRemainingMs > 1300 || Math.random() < 0.5) return null
  return { kind: 'answer', prompt: s.index, color: Math.random() < 0.75 ? s.ink : s.word }
}
