// Star Blaster bot: sweeps side to side along the bottom (enemy positions come from the shared script,
// which this standalone bot doesn't load) — enough to show kills, hits and a game over in screenshots.
// The steer vector is scaled up so the ship flies at full speed (a vector shorter than 1 flies slower).
type Snap = { t: number; arenas: { id: string; x: number; y: number; out: boolean }[] }

export default function play(s: Snap, me: string): unknown {
  const a = s.arenas.find((x) => x.id === me)
  if (!a || a.out) return null
  const target = 0.5 + 0.38 * Math.sin(s.t / 1400 + me.length)
  return { kind: 'move', dx: (target - a.x) * 8, dy: (1.15 - a.y) * 8 }
}
