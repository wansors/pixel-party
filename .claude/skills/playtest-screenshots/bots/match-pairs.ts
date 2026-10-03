// Match bot: remembers every face it has seen and flips a known pair when it has one, else a random
// face-down card (a couple of flips a second).
type Snap = {
  cols: number
  rows: number
  boards: Record<string, { up: number[]; matched: number[]; done: boolean }>
  reveal: Record<string, Record<number, number>>
}

const seen = new Map<string, Map<number, number>>()

export default function play(s: Snap, me: string): unknown {
  const board = s.boards[me]
  if (!board || board.done || Math.random() < 0.6) return null
  const memory = seen.get(me) ?? new Map<number, number>()
  seen.set(me, memory)
  for (const [i, v] of Object.entries(s.reveal[me] ?? {})) memory.set(Number(i), v)
  const open = (i: number) => !board.matched.includes(i)
  const first = board.up.length === 1 ? board.up[0] : undefined
  const known = [...memory].filter(([i]) => open(i) && i !== first)
  const partner =
    first === undefined
      ? known.find(([i, v]) => known.some(([j, w]) => j !== i && w === v))
      : known.find(([, v]) => v === memory.get(first))
  if (partner) return { kind: 'flip', index: partner[0] }
  const unknown = [...Array(s.cols * s.rows).keys()].filter(
    (i) => open(i) && i !== first && !memory.has(i),
  )
  const pick = unknown[Math.floor(Math.random() * unknown.length)]
  return pick === undefined ? null : { kind: 'flip', index: pick }
}
