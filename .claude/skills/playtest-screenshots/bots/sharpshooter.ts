// Sharpshooter bot: shoots the bandits, bottles and cans it sees (never the townsfolk), a little off
// the mark and not every chance — so it lands most shots, like a decent cowboy.
const { SHOOT, shootTargetAt } = await import(
  `${process.env.PP_REPO}/packages/shared/src/games/sharpshooter.ts`
)

interface Target {
  id: number
  kind: string
  spot: number
  at: number
  stay: number
}
interface Snap {
  targets: Target[]
  t: number
}

const shotAt = new Map<string, number>()
const tried = new Map<string, Set<number>>()

export default function play(snapshot: unknown, me: string): unknown {
  const s = snapshot as Snap
  const t = s.t - SHOOT.startDelayMs + 60
  if (t < 0 || t - (shotAt.get(me) ?? -1e9) < 450 || Math.random() < 0.3) return null
  const seen = tried.get(me) ?? new Set<number>()
  tried.set(me, seen)
  for (const tg of s.targets) {
    if (tg.kind === 'civilian' || seen.has(tg.id)) continue
    const pos = shootTargetAt(tg, t)
    if (!pos?.live) continue
    seen.add(tg.id)
    shotAt.set(me, t)
    const wobble = () => (Math.random() - 0.5) * 0.06
    return { kind: 'shot', x: pos.x + wobble(), y: pos.y + wobble(), at: Math.round(t) }
  }
  return null
}
