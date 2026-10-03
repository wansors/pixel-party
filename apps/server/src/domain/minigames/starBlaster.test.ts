import { describe, expect, test } from 'bun:test'
import { STAR, STAR_ENEMY, buildStarScript, starBulletsAt, starEnemyAt } from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import { StarBlaster, type StarBlasterState } from './starBlaster'

const game = new StarBlaster()
const init = (players: string[], seed = 2): StarBlasterState =>
  game.init({
    players,
    seed,
    random: new SeededRandom(seed),
    now: 0,
    config: { durationMs: 50_000 },
  })
const arena = (s: StarBlasterState, id: string) => {
  const a = s.arenas.find((x) => x.id === id)
  if (!a) throw new Error(`no arena ${id}`)
  return a
}
const none = new Map<number, number>()

describe('Star Blaster script', () => {
  test('is a pure function of the seed, with drones, gunners and a late boss', () => {
    const a = buildStarScript(77, 50_000)
    expect(buildStarScript(77, 50_000)).toEqual(a)
    expect(buildStarScript(78, 50_000)).not.toEqual(a)
    const kinds = new Set(a.enemies.map((e) => e.kind))
    expect([...kinds].sort()).toEqual(['boss', 'drone', 'gunner'])
    const boss = a.enemies.find((e) => e.kind === 'boss')
    expect(boss?.spawnAt ?? 0).toBeGreaterThan(30_000)
    expect(boss?.endAt ?? 0).toBeLessThanOrEqual(51_000)
  })

  test('enemies exist only between spawn and exit; a hovering gunner settles on screen', () => {
    const s = buildStarScript(5, 50_000)
    const g = s.enemies.find((e) => e.kind === 'gunner')
    if (!g) throw new Error('no gunner')
    expect(starEnemyAt(g, g.spawnAt - 1)).toBeNull()
    expect(starEnemyAt(g, g.endAt)).toBeNull()
    const settled = starEnemyAt(g, g.spawnAt + 2000)
    expect(settled?.y ?? 0).toBeGreaterThan(0.15)
    expect(settled?.y ?? 1).toBeLessThan(0.4)
  })

  test('bullets: a full pattern per emission, none after the shooter dies, consumed ones gone', () => {
    const s = buildStarScript(5, 50_000)
    const g = s.enemies.find((e) => e.kind === 'gunner')
    if (!g || g.shots.length < 2) throw new Error('gunner without shots')
    const at = (g.shots[0] ?? 0) + 200
    const fired = starBulletsAt(s, at, none).filter((b) => b.id.startsWith(`${g.id}:`))
    expect(fired).toHaveLength(g.count)
    // Killed before its second volley: that one never happens for this player.
    const later = (g.shots[1] ?? 0) + 100
    const killed = new Map([[g.id, (g.shots[1] ?? 0) - 10]])
    const second = starBulletsAt(s, later, killed).filter((b) => b.id.startsWith(`${g.id}:1:`))
    expect(second).toHaveLength(0)
    const consumed = new Set([fired[0]?.id ?? ''])
    expect(starBulletsAt(s, at, none, consumed).some((b) => b.id === fired[0]?.id)).toBe(false)
  })
})

describe('Star Blaster', () => {
  test('the ship auto-fires; shots destroy an enemy in the line of fire and score', () => {
    const s = init(['a', 'b'])
    const drone = s.script.enemies.find((e) => e.kind === 'drone')
    if (!drone) throw new Error('no drone')
    const a = arena(s, 'a')
    // Park under the drone a moment after it appears, then let the shots climb.
    const t0 = drone.spawnAt + 400
    a.nextShotAt = t0
    let hit = false
    for (let t = t0; t < t0 + 1500 && !hit; t += 50) {
      const p = starEnemyAt(drone, t)
      if (p) {
        a.x = p.x
        a.shieldUntil = Number.POSITIVE_INFINITY // ignore incoming fire for this check
      }
      game.tick(s, 50, t)
      hit = a.killedAt.has(drone.id)
    }
    expect(hit).toBe(true)
    expect(a.score).toBe(STAR_ENEMY.drone.pts)
    // Per player: b's copy of that drone is still alive.
    expect(arena(s, 'b').killedAt.has(drone.id)).toBe(false)
  })

  test('a bullet hit costs a life and points, then a shield; a rammed drone dies too', () => {
    const s = init(['a'])
    const a = arena(s, 'a')
    a.nextShotAt = Number.POSITIVE_INFINITY // no own fire in this check
    // A moment with an enemy bullet low enough for the ship to sit on it.
    let t = 0
    let bullet: { id: string; x: number; y: number } | undefined
    for (t = 2000; t < 40_000 && !bullet; t += 50) {
      bullet = starBulletsAt(s.script, t, a.killedAt).find(
        (b) => b.y > STAR.h * 0.5 && b.y < STAR.h - 0.05,
      )
    }
    if (!bullet) throw new Error('no low bullet')
    t -= 50
    Object.assign(a, { x: bullet.x, y: bullet.y, score: 100 })
    game.tick(s, 50, t)
    expect(a.lives).toBe(STAR.lives - 1)
    expect(a.score).toBe(100 - STAR.hitPenalty)
    expect(a.consumed.has(bullet.id)).toBe(true)
    expect(a.shieldUntil).toBe(t + STAR.shieldMs)
    game.tick(s, 50, t + 50) // shielded: the same spot is safe now
    expect(a.lives).toBe(STAR.lives - 1)
    // Ram a drone low on the screen: it is destroyed (no points) and the ship loses a life.
    a.shieldUntil = 0
    let drone: { id: number; at: number; x: number; y: number } | undefined
    for (const e of s.script.enemies.filter((x) => x.kind === 'drone')) {
      for (let u = e.spawnAt; u < e.endAt && !drone; u += 50) {
        const q = starEnemyAt(e, u)
        if (q && q.y > STAR.h * 0.6 && q.x > 0.05 && q.x < 0.95) drone = { id: e.id, at: u, ...q }
      }
      if (drone) break
    }
    if (!drone) throw new Error('no low drone')
    const before = a.score
    Object.assign(a, { x: drone.x, y: drone.y })
    game.tick(s, 50, drone.at)
    expect(a.killedAt.get(drone.id)).toBe(drone.at)
    expect(a.score).toBe(Math.max(0, before - STAR.hitPenalty))
    expect(a.lives).toBe(STAR.lives - 2)
  })

  test('out of lives you are out; the round ends once everyone is', () => {
    const s = init(['a'])
    const a = arena(s, 'a')
    Object.assign(a, { lives: 0, out: true })
    expect(game.isFinished(s, 1000)).toBe(true)
    game.onInput(s, 'a', { kind: 'move', dx: 1, dy: 0 }, 1000)
    expect(a.dx).toBe(0)
  })

  test('ranks by score then lives; snapshots keep only kills that still matter', () => {
    const s = init(['a', 'b', 'c'])
    Object.assign(arena(s, 'a'), { score: 120, lives: 1 })
    Object.assign(arena(s, 'b'), { score: 120, lives: 3 })
    Object.assign(arena(s, 'c'), { score: 300, lives: 0, out: true })
    expect(game.getResult(s).placements).toEqual(['c', 'b', 'a'])
    const first = s.script.enemies[0]
    if (!first) throw new Error('empty script')
    arena(s, 'a').killedAt.set(first.id, first.spawnAt + 100)
    expect(game.snapshot(s, first.spawnAt + 200).arenas[0]?.killed).toEqual([
      [first.id, first.spawnAt + 100],
    ])
    expect(game.snapshot(s, first.endAt + STAR.bulletLifeMs + 10).arenas[0]?.killed).toEqual([])
  })

  test('steering is normalized; junk is ignored', () => {
    const s = init(['a'])
    game.onInput(s, 'a', { kind: 'move', dx: 3, dy: 4 }, 0)
    expect(arena(s, 'a').dx).toBeCloseTo(0.6)
    game.onInput(s, 'a', { kind: 'move', dx: Number.NaN, dy: 0 }, 0)
    expect(arena(s, 'a').dy).toBeCloseTo(0.8)
  })
})
