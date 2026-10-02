// Pang bot: gets under the highest-flying balloon to fire, and steps clear of anything coming down.
type Arena = {
  id: string
  x: number
  harpoon: number | null
  balloons: [number, number, number, number, number][]
  out: boolean
}
const RADIUS = [0, 0.022, 0.036, 0.056, 0.082]
const H = 0.7

export default function play(s: { arenas: Arena[] }, me: string): unknown {
  const a = s.arenas.find((x) => x.id === me)
  if (!a || a.out) return null
  // Danger: a balloon low and close overhead — run the other way.
  const threat = a.balloons.find(
    ([x, y, size]) => y > H - 0.25 && Math.abs(x - a.x) < (RADIUS[size] ?? 0.03) + 0.08,
  )
  if (threat) return { kind: 'move', dir: threat[0] > a.x ? -1 : 1 }
  const target = [...a.balloons].sort((p, q) => p[1] - q[1])[0]
  if (!target) return { kind: 'move', dir: 0 }
  const dx = target[0] - a.x
  const r = RADIUS[target[2]] ?? 0.03
  const out: unknown[] = [{ kind: 'move', dir: Math.abs(dx) < r * 0.5 ? 0 : dx < 0 ? -1 : 1 }]
  if (Math.abs(dx) < r && a.harpoon === null) out.push({ kind: 'fire' })
  return out
}
