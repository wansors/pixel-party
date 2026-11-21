// Spook Snatch bot: works the card out with the shared rule, a beat late and right most of the time —
// sometimes it panics and grabs the wrong one (and sits out the lock), like a person.
const { spookAnswer } = await import(
  `${process.env.PP_REPO}/packages/shared/src/games/spookSnatch.ts`
)

interface Snap {
  phase: string
  cardNo: number
  figures: { shape: number; color: number }[]
  phaseMs: number
  windowMs: number
  players: Record<string, { answered: boolean; lockedMs: number }>
}

const thinkMs = new Map<string, number>()

export default function play(snapshot: unknown, me: string): unknown {
  const s = snapshot as Snap
  const p = s.players?.[me]
  if (s.phase !== 'card' || !p || p.answered || p.lockedMs > 0) return null
  const key = `${me}:${s.cardNo}`
  if (!thinkMs.has(key)) thinkMs.set(key, 700 + Math.random() * 1800)
  if (s.windowMs - s.phaseMs < (thinkMs.get(key) ?? 0)) return null
  const right = spookAnswer(s.figures)
  const item = Math.random() < 0.75 ? right : (right + 1 + Math.floor(Math.random() * 4)) % 5
  return { kind: 'grab', item, card: s.cardNo }
}
