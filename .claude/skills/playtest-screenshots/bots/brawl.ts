// Brawl bot: grabs a weapon lying nearby when empty-handed, then walks up to the nearest fighter still
// standing, lines up on their lane and swings (punch = the weapon; the odd kick and grab bare-handed).
// With a fuel can it stops a throw's length short and throws it. Screenshots then show held weapons,
// weapon hits, flying cans, explosions, knock-downs and KOs.
type Fighter = {
  id: string
  x: number
  y: number
  action: string
  hp: number
  weapon: string | null
}
type Snap = { fighters: Fighter[]; items: [number, number, number, string][] }
const tick = new Map<string, number>()

export default function play(s: Snap, me: string): unknown {
  const f = s.fighters.find((x) => x.id === me)
  if (!f || f.action === 'ko') return null
  const n = (tick.get(me) ?? 0) + 1
  tick.set(me, n)
  const walk = (dx: number, dy: number): unknown => ({
    kind: 'move',
    dx: Math.abs(dx) < 0.02 ? 0 : dx,
    dy: Math.abs(dy) < 0.02 ? 0 : dy * 3,
  })
  // Empty-handed: fetch the closest weapon (or chicken when hurt) within reach of a short walk.
  const item = s.items
    .filter(([, , , kind]) => (kind === 'chicken' ? f.hp < 70 : f.weapon === null))
    .map(([, x, y]) => ({ x, y, d: Math.hypot(x - f.x, y - f.y) }))
    .sort((a, b) => a.d - b.d)[0]
  if (item && item.d < 0.9) return walk(item.x - f.x, item.y - f.y)
  const foe = s.fighters
    .filter((o) => o.id !== me && o.action !== 'ko')
    .sort((a, b) => Math.hypot(a.x - f.x, a.y - f.y) - Math.hypot(b.x - f.x, b.y - f.y))[0]
  if (!foe) return { kind: 'move', dx: 0, dy: 0 }
  const dx = foe.x - f.x
  const dy = foe.y - f.y
  if (f.weapon === 'fuel') {
    if (Math.abs(dy) < 0.03 && Math.abs(dx) > 0.15 && Math.abs(dx) < 0.6) {
      return [{ kind: 'move', dx: Math.sign(dx) * 0.01, dy: 0 }, { kind: 'punch' }]
    }
    return walk(Math.abs(dx) < 0.25 ? -Math.sign(dx) : dx, dy)
  }
  const reach = f.weapon === 'pipe' || f.weapon === 'bat' ? 0.13 : 0.09
  if (Math.abs(dx) < reach && Math.abs(dy) < 0.04) {
    const attack = f.weapon ? 'punch' : n % 7 === 0 ? 'grab' : n % 4 === 0 ? 'kick' : 'punch'
    return [{ kind: 'move', dx: Math.sign(dx) * 0.01, dy: 0 }, { kind: attack }]
  }
  return walk(Math.abs(dx) < reach * 0.8 ? 0 : dx, dy)
}
