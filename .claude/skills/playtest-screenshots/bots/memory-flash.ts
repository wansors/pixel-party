// Memory Flash bot: counts the target colour in its board's packed burst and answers once the flash
// is over, right most of the time (some bots shakier than others). Timed in calls (one every 150 ms),
// not wall-clock, so the server bench's simulated clock plays it the same way.
type Board = {
  level: number
  cells: string
  targetColor: number
  flashMs: number
  choices: number[]
}
type Snap = { boards: Board[]; at: Record<string, number | null> }

const COLORS = [0xe63946, 0x2a9d3f, 0x3a7bd5, 0xf4c20d]
const CALL_MS = 150
const seen = new Map<string, { level: number; calls: number }>()

export default function play(s: Snap, me: string): unknown {
  const board = s.boards.find((b) => b.level === s.at[me])
  if (!board) return null
  const mine = seen.get(me)
  if (mine?.level !== board.level) {
    seen.set(me, { level: board.level, calls: 0 })
    return null
  }
  mine.calls++
  if (mine.calls * CALL_MS < board.flashMs + 400 || Math.random() > 0.3) return null
  const target = String(COLORS.indexOf(board.targetColor))
  const count = [...board.cells].filter((c) => c === target).length
  const shaky = Math.random() < 0.15 + (me.charCodeAt(1) % 3) * 0.1
  const value = shaky ? (board.choices.find((c) => c !== count) ?? count) : count
  return { kind: 'answer', level: board.level, value }
}
