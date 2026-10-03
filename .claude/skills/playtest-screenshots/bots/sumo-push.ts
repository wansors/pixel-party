// Sumo Push bot: holds the middle when pushed wide (the ring shrinks), otherwise goes for the nearest
// rival and dashes into them once close.
type Snap = { ring: number; bodies: { id: string; x: number; y: number; alive: boolean }[] }

export default function play(s: Snap, me: string): unknown {
  const p = s.bodies.find((b) => b.id === me)
  if (!p?.alive) return null
  if (Math.hypot(p.x - 0.5, p.y - 0.5) > s.ring * 0.5) {
    return { kind: 'move', dx: 0.5 - p.x, dy: 0.5 - p.y }
  }
  const rival = s.bodies
    .filter((b) => b.alive && b.id !== me)
    .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0]
  if (!rival) return { kind: 'move', dx: 0, dy: 0 }
  const move = { kind: 'move', dx: rival.x - p.x, dy: rival.y - p.y }
  return Math.hypot(rival.x - p.x, rival.y - p.y) < 0.15 ? [move, { kind: 'dash' }] : move
}
