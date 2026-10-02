// Room Rush bot: rides the music, then heads for the nearest open room that still has space and stops
// once inside (or safe). Geometry mirrors ROOM_RUSH in packages/shared/src/games/roomRush.ts.
type Snap = {
  phase: string
  n: number
  rooms: { slot: number; count: number; locked: boolean }[]
  players: { id: string; x: number; y: number; alive: boolean; safe: boolean }[]
}
const SLOTS = 10
const ROOM_R = 0.4
const centre = (slot: number): [number, number] => {
  const a = -Math.PI / 2 + (slot * Math.PI * 2) / SLOTS
  return [0.5 + Math.cos(a) * ROOM_R, 0.5 + Math.sin(a) * ROOM_R]
}

export default function play(s: Snap, me: string): unknown {
  const p = s.players.find((q) => q.id === me)
  const stop = { kind: 'move', dx: 0, dy: 0 }
  if (!p?.alive || p.safe || s.phase !== 'call') return stop
  const open = s.rooms.filter((r) => !r.locked && r.count < s.n)
  const target = open
    .map((r) => centre(r.slot))
    .sort((a, b) => Math.hypot(a[0] - p.x, a[1] - p.y) - Math.hypot(b[0] - p.x, b[1] - p.y))[0]
  if (!target) return stop
  const dx = target[0] - p.x
  const dy = target[1] - p.y
  if (Math.hypot(dx, dy) < 0.03) return stop
  // Aim at the door first (on the line from the centre), then in.
  const doorX = 0.5 + (target[0] - 0.5) * 0.78
  const doorY = 0.5 + (target[1] - 0.5) * 0.78
  const pastDoor = Math.hypot(p.x - 0.5, p.y - 0.5) > ROOM_R * 0.78
  return pastDoor ? { kind: 'move', dx, dy } : { kind: 'move', dx: doorX - p.x, dy: doorY - p.y }
}
