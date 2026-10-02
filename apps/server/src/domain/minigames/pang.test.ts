import { describe, expect, test } from 'bun:test'
import { PANG } from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import { Pang, type PangState } from './pang'

const game = new Pang()
const init = (players: string[], seed = 6): PangState =>
  game.init({
    players,
    seed,
    random: new SeededRandom(seed),
    now: 0,
    config: { durationMs: 50_000 },
  })
const arena = (s: PangState, id: string) => {
  const a = s.arenas.find((x) => x.id === id)
  if (!a) throw new Error(`no arena ${id}`)
  return a
}
const run = (s: PangState, from: number, to: number): number => {
  let t = from
  while (t + 50 <= to) {
    t += 50
    game.tick(s, 50, t)
  }
  return t
}

describe('Pang', () => {
  test('everyone starts on the same seeded wave, balloons inside the arena', () => {
    const s = init(['a', 'b', 'c'])
    const [a, b] = [arena(s, 'a'), arena(s, 'b')]
    expect(a.balloons.length).toBeGreaterThan(0)
    expect(b.balloons).toEqual(a.balloons)
    for (const ball of a.balloons) {
      expect(ball.x).toBeGreaterThan(0)
      expect(ball.x).toBeLessThan(PANG.w)
      expect(ball.size).toBe(4)
    }
    expect(init(['a'], 13).waves).toEqual(init(['a'], 13).waves)
  })

  test('balloons bounce back to the same height every time, bigger ones higher', () => {
    const s = init(['a'])
    const a = arena(s, 'a')
    // One balloon per size, left alone (no harpoon, player far away).
    a.x = 0.03
    a.balloons = [1, 4].map((size) => ({ x: 0.7, y: 0.3, vx: 0, vy: 0, size }))
    const apex = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
    const apexLate = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
    for (let t = 50; t <= 8000; t += 10) {
      game.tick(s, 10, t)
      a.balloons.forEach((b, i) => {
        if (t > 1500 && t < 4500) apex[i] = Math.min(apex[i] ?? 1, b.y)
        if (t > 5000) apexLate[i] = Math.min(apexLate[i] ?? 1, b.y)
      })
    }
    expect(Math.abs((apex[0] ?? 0) - (apexLate[0] ?? 1))).toBeLessThan(0.01)
    expect(apex[1] ?? 1).toBeLessThan(apex[0] ?? 0) // the big one tops out higher (smaller y)
  })

  test('the harpoon splits a balloon in two smaller halves; the tiniest just pops', () => {
    const s = init(['a'])
    const a = arena(s, 'a')
    a.balloons = [{ x: 0.5, y: 0.4, vx: 0, vy: 0, size: 3 }]
    a.x = 0.5
    game.onInput(s, 'a', { kind: 'fire' }, 0)
    game.onInput(s, 'a', { kind: 'fire' }, 0) // one harpoon at a time
    let t = 0
    while (a.pops === 0 && t < 2000) t = run(s, t, t + 50)
    expect(a.pops).toBe(1)
    expect(a.harpoon).toBeNull()
    expect(a.balloons.map((b) => b.size)).toEqual([2, 2])
    expect(Math.sign(a.balloons[0]?.vx ?? 0)).toBe(-Math.sign(a.balloons[1]?.vx ?? 0))
    a.balloons = [{ x: 0.5, y: 0.5, vx: 0, vy: 0, size: 1 }]
    game.onInput(s, 'a', { kind: 'fire' }, t)
    while (a.pops === 1 && t < 4000) t = run(s, t, t + 50)
    expect(a.pops).toBe(2)
    // That cleared the arena: the next wave drops in after a short gap.
    expect(a.balloons).toHaveLength(0)
    run(s, t, t + 1500)
    expect(a.wave).toBe(1)
    expect(a.balloons.length).toBeGreaterThan(0)
  })

  test('a missed harpoon vanishes at the ceiling', () => {
    const s = init(['a'])
    const a = arena(s, 'a')
    a.balloons = [{ x: 0.9, y: 0.3, vx: 0, vy: 0, size: 2 }]
    a.x = 0.1
    game.onInput(s, 'a', { kind: 'fire' }, 0)
    run(s, 0, 1000)
    expect(a.harpoon).toBeNull()
    expect(a.pops).toBe(0)
  })

  test('touching a balloon costs a life with a blink of shield; out of lives you are out', () => {
    const s = init(['a', 'b'])
    const a = arena(s, 'a')
    const hit = (t: number): void => {
      a.balloons = [{ x: a.x, y: PANG.h - 0.03, vx: 0, vy: 0, size: 2 }]
      game.tick(s, 10, t)
    }
    hit(100)
    expect(a.lives).toBe(2)
    hit(200) // shielded
    expect(a.lives).toBe(2)
    hit(1700)
    hit(3300)
    expect(a.lives).toBe(0)
    expect(a.out).toBe(true)
    game.onInput(s, 'a', { kind: 'fire' }, 3400)
    expect(a.harpoon).toBeNull()
    expect(game.isFinished(s, 3400)).toBe(false) // b still plays
  })

  test('ranks by pops, then lives; junk input is ignored', () => {
    const s = init(['a', 'b', 'c'])
    Object.assign(arena(s, 'a'), { pops: 10, lives: 1 })
    Object.assign(arena(s, 'b'), { pops: 10, lives: 3 })
    Object.assign(arena(s, 'c'), { pops: 14, lives: 0, out: true })
    const result = game.getResult(s)
    expect(result.placements).toEqual(['c', 'b', 'a'])
    expect(result.stats?.c).toBe('14')
    game.onInput(s, 'a', { kind: 'move', dir: 5 as 1 }, 0)
    expect(arena(s, 'a').dir).toBe(0)
  })
})
