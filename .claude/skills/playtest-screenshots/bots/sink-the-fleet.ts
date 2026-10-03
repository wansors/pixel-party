// Sink the Fleet bot: on its turn, after a short think, fires next to an earlier hit (or anywhere new).
type Shot = { cell: number; hit: boolean }
type View = { opponentId: string | null; yourTurn: boolean; turnRemainingMs: number; shots: Shot[] }
type Snap = { grid: number; players: Record<string, View> }

export default function play(s: Snap, me: string): unknown {
  const v = s.players[me]
  if (!v?.opponentId || !v.yourTurn || v.turnRemainingMs > 4000) return null
  const n = s.grid
  const fired = new Set(v.shots.map((x) => x.cell))
  const near = v.shots
    .filter((x) => x.hit)
    .flatMap(({ cell }) => [
      cell - n,
      cell + n,
      cell % n > 0 ? cell - 1 : -1,
      cell % n < n - 1 ? cell + 1 : -1,
    ])
    .filter((c) => c >= 0 && c < n * n && !fired.has(c))
  const free = Array.from({ length: n * n }, (_, i) => i).filter((c) => !fired.has(c))
  const pool = near.length > 0 ? near : free
  const cell = pool[Math.floor(Math.random() * pool.length)]
  return cell === undefined ? null : { kind: 'fire', cell }
}
