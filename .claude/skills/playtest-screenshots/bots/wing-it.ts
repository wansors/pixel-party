// Wing It bot: carries its own bird forward with the game's shared flight rules (from $PP_REPO) to
// "now" and flaps when it has sunk below the next gap's center and is falling. It decides only every
// 150 ms on a snapshot that's a little stale, so it scrapes a tower now and then — like a person.
const shared = await import(`${process.env.PP_REPO}/packages/shared/src/games/wingIt.ts`)
const { WING, wingDistance, wingFly } = shared

interface Flier {
  t: number
  y: number
  vy: number
  flaps: number[]
  alive: boolean
}
interface Column {
  x: number
  gapY: number
  gapH: number
}
interface Snap {
  fliers: Record<string, Flier>
  columns: Column[]
  t: number
}

export default function play(snapshot: unknown, me: string): unknown {
  const s = snapshot as Snap
  const f = s?.fliers?.[me]
  if (!f?.alive) return null
  // The snapshot's present (its judged state is WING.judgeMs older), plus its trip here.
  const now = s.t - WING.startDelayMs + 40
  if (now < 0) return null
  const body = { t: f.t, y: f.y, vy: f.vy }
  wingFly(body, Math.floor(now / WING.dtMs) * WING.dtMs, f.flaps)
  const ahead = wingDistance(body.t) + WING.birdX - WING.columnW / 2 - WING.radius
  const next = s.columns.find((c) => c.x >= ahead)
  const target = next ? next.gapY + next.gapH * 0.12 : 0.5
  return body.y > target && body.vy >= 0 ? { kind: 'flap', at: body.t } : null
}
