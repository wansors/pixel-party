// Sudoku Race bot: fills a cell that has a single candidate left (a slow, steady solver), else
// guesses one of the candidates of the tightest cell.
type Board = {
  given: number[]
  grid: number[]
  lockedMask: boolean[]
  done: boolean
  cooldownMs: number
}

export default function play(
  s: { size: number; boards: Record<string, Board> },
  me: string,
): unknown {
  const b = s.boards[me]
  if (!b || b.done || b.cooldownMs > 0 || Math.random() < 0.85) return null
  const n = s.size
  const box = Math.round(Math.sqrt(n))
  const known = (i: number) => b.given[i] || (b.lockedMask[i] ? b.grid[i] : 0) || 0
  let best: { index: number; options: number[] } | undefined
  for (let i = 0; i < n * n; i++) {
    if (known(i)) continue
    const r = Math.floor(i / n)
    const c = i % n
    const used = new Set<number>()
    for (let k = 0; k < n; k++) {
      used.add(known(r * n + k)).add(known(k * n + c))
      const br = r - (r % box) + Math.floor(k / box)
      used.add(known(br * n + c - (c % box) + (k % box)))
    }
    const options = [...Array(n).keys()].map((d) => d + 1).filter((d) => !used.has(d))
    if (!best || options.length < best.options.length) best = { index: i, options }
  }
  const value = best?.options[Math.floor(Math.random() * best.options.length)]
  return best && value ? { kind: 'fill', index: best.index, value } : null
}
