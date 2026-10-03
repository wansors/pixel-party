// Fleet Battle bot: a captain fires about a second into its call; a crewmate jumps in once the turn
// opens. Aims next to an earlier hit when it can, else at a random cell nobody has tried.
type Shot = { cell: number; hit: boolean }
type Snap = {
  grid: number
  turn: string
  turnRemainingMs: number
  captainId: string | null
  openInMs: number
  teams: Record<string, { shots: Shot[] }>
  playerTeams: Record<string, string>
  done: boolean
}

export default function play(s: Snap, me: string): unknown {
  const team = s.playerTeams[me]
  if (s.done || team !== s.turn) return null
  const mine = s.captainId === me && s.openInMs > 0 && s.turnRemainingMs < 5000
  if (!mine && (s.openInMs > 0 || Math.random() < 0.7)) return null
  const shots = s.teams[team]?.shots ?? []
  const tried = new Set(shots.map((x) => x.cell))
  const n = s.grid
  const near = shots
    .filter((x) => x.hit)
    .flatMap((x) => [
      x.cell - n,
      x.cell + n,
      x.cell % n > 0 ? x.cell - 1 : -1,
      x.cell % n < n - 1 ? x.cell + 1 : -1,
    ])
    .filter((c) => c >= 0 && c < n * n && !tried.has(c))
  const pool = near.length > 0 ? near : [...Array(n * n).keys()].filter((c) => !tried.has(c))
  const cell = pool[Math.floor(Math.random() * pool.length)]
  return cell === undefined ? null : { kind: 'fire', cell }
}
