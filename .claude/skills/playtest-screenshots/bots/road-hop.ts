// Road Hop bot: carries its own hopper to "now" with the game's shared rules (from $PP_REPO), then
// tries each move — up first, then waiting, sideways toward the middle, back down — and takes the first
// one it survives for a short look-ahead. It reads a slightly stale snapshot and only looks ~0.4 s
// ahead, so it still gets squashed or soaked now and then — like a person.
const shared = await import(`${process.env.PP_REPO}/packages/shared/src/games/roadHop.ts`)
const { HOP, hopRun, hopSnap } = shared

interface Body {
  t: number
  row: number
  x: number
  waitUntil: number
  deaths: number
}
interface View {
  body: Body
  moves: { at: number; dir: number }[]
  home: number
}
interface Snap {
  lanes: unknown[]
  hoppers: Record<string, View>
  t: number
}

const LOOK_MS = 420

export default function play(snapshot: unknown, me: string): unknown {
  const s = snapshot as Snap
  const v = s?.hoppers?.[me]
  if (!v) return null
  // The snapshot's present (its judged state is HOP.judgeMs older), plus its trip here.
  const now = hopSnap(s.t + 30)
  if (now < HOP.startDelayMs) return null
  const body: Body = { ...v.body }
  hopRun(body, now, v.moves, s.lanes, v.home)
  if (body.waitUntil > 0 || (v.moves.at(-1)?.at ?? -1e9) > now - HOP.minHopGapMs) return null
  const survives = (dir: number): boolean => {
    const b = { ...body }
    hopRun(b, now + LOOK_MS, dir < 0 ? [] : [{ at: now, dir }], s.lanes, v.home)
    return b.deaths === body.deaths
  }
  const toMiddle = body.x < HOP.cols / 2 ? 1 : 3
  for (const dir of [0, -1, toMiddle, 4 - toMiddle, 2]) {
    if (dir === -1) {
      // Waiting is fine unless a ride is carrying you toward an edge.
      const edge = body.x < 1.5 || body.x > HOP.cols - 1.5
      if (survives(-1) && !(body.row > HOP.verge && edge)) return null
      continue
    }
    if (survives(dir)) return { kind: 'hop', dir, at: now }
  }
  return null
}
