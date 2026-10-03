// Asteroids bot: turns toward the nearest rock (or rival), fires when lined up, thrusts now and then.
type Snap = {
  ships: { id: string; x: number; y: number; a: number; alive: boolean }[]
  rocks: [number, number, number, number, number, number][]
}
const W = 1.6
const H = 1
const delta = (d: number, size: number): number => d - size * Math.round(d / size)

export default function play(s: Snap, me: string): unknown {
  const ship = s.ships.find((x) => x.id === me)
  if (!ship?.alive) return null
  const targets = [
    ...s.rocks.map(([, x, y]) => ({ x, y })),
    ...s.ships.filter((o) => o.id !== me && o.alive),
  ]
  const near = targets
    .map((t) => ({ dx: delta(t.x - ship.x, W), dy: delta(t.y - ship.y, H) }))
    .sort((p, q) => Math.hypot(p.dx, p.dy) - Math.hypot(q.dx, q.dy))[0]
  if (!near) return { kind: 'controls', rot: 1, thrust: false, fire: false }
  const want = Math.atan2(near.dy, near.dx)
  let diff = want - ship.a
  diff = Math.atan2(Math.sin(diff), Math.cos(diff))
  const dist = Math.hypot(near.dx, near.dy)
  return {
    kind: 'controls',
    rot: Math.abs(diff) < 0.12 ? 0 : diff > 0 ? 1 : -1,
    thrust: dist > 0.45 && Math.abs(diff) < 0.5,
    fire: Math.abs(diff) < 0.25,
  }
}
