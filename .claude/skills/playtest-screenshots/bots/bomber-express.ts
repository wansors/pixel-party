// Bomber Express bot: wanders the open floor, drops a bomb next to crates now and then and walks away
// from any bomb in its row or column (crudely — enough to show blasts, crates and knock-outs).
type Snap = {
  grid: string
  bombs: [number, number, number, number][]
  players: { id: string; x: number; y: number; tx: number; ty: number; alive: boolean }[]
}
const W = 17
const DIRS = [
  ['up', 0, -1],
  ['down', 0, 1],
  ['left', -1, 0],
  ['right', 1, 0],
] as const
const memory = new Map<string, number>()

export default function play(s: Snap, me: string): unknown {
  const p = s.players.find((x) => x.id === me)
  if (!p?.alive) return null
  const open = (x: number, y: number): boolean => {
    const c = s.grid[y * W + x]
    return (
      (c === '.' || c === 'r' || c === 'b' || c === 's') &&
      !s.bombs.some((b) => b[0] === x && b[1] === y)
    )
  }
  const danger = s.bombs.some(([bx, by]) => bx === p.tx || by === p.ty)
  const nearCrate = DIRS.some(([, dx, dy]) => s.grid[(p.ty + dy) * W + p.tx + dx] === 'c')
  const out: unknown[] = []
  const tick = (memory.get(me) ?? 0) + 1
  memory.set(me, tick)
  if (nearCrate && !danger && tick % 12 === 0) out.push({ kind: 'bomb' })
  const options = DIRS.filter(([, dx, dy]) => open(p.tx + dx, p.ty + dy))
  const pick = options[(tick + me.length) % Math.max(1, options.length)]
  out.push({ kind: 'move', dir: pick ? pick[0] : null })
  return out
}
