// Brawl bot: walks up to the nearest fighter still standing, lines up on their lane and throws punches
// (with the odd kick and grab), so screenshots show hits, knock-downs and KOs.
type Fighter = { id: string; x: number; y: number; action: string }
const tick = new Map<string, number>()

export default function play(s: { fighters: Fighter[] }, me: string): unknown {
  const f = s.fighters.find((x) => x.id === me)
  if (!f || f.action === 'ko') return null
  const foe = s.fighters
    .filter((o) => o.id !== me && o.action !== 'ko')
    .sort((a, b) => Math.hypot(a.x - f.x, a.y - f.y) - Math.hypot(b.x - f.x, b.y - f.y))[0]
  if (!foe) return { kind: 'move', dx: 0, dy: 0 }
  const n = (tick.get(me) ?? 0) + 1
  tick.set(me, n)
  const dx = foe.x - f.x
  const dy = foe.y - f.y
  if (Math.abs(dx) < 0.09 && Math.abs(dy) < 0.04) {
    const attack = n % 7 === 0 ? 'grab' : n % 4 === 0 ? 'kick' : 'punch'
    return [{ kind: 'move', dx: Math.sign(dx) * 0.01, dy: 0 }, { kind: attack }]
  }
  return { kind: 'move', dx: Math.abs(dx) < 0.07 ? 0 : dx, dy: Math.abs(dy) < 0.02 ? 0 : dy * 3 }
}
