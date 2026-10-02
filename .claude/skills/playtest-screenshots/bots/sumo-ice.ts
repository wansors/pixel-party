// Sumo ICE bot: charges the nearest rival, but heads back toward the middle when near the edge.
type Snap = { bodies: { id: string; x: number; y: number; alive: boolean }[] }

export default function play(s: Snap, me: string): unknown {
  const p = s.bodies.find((b) => b.id === me)
  if (!p?.alive) return null
  const fromMid = Math.hypot(p.x - 0.5, p.y - 0.5)
  if (fromMid > 0.3) return { kind: 'move', dx: 0.5 - p.x, dy: 0.5 - p.y }
  const rival = s.bodies
    .filter((b) => b.alive && b.id !== me)
    .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0]
  return rival
    ? { kind: 'move', dx: rival.x - p.x, dy: rival.y - p.y }
    : { kind: 'move', dx: 0, dy: 0 }
}
