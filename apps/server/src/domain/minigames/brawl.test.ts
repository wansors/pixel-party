import { describe, expect, test } from 'bun:test'
import { BRAWL } from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import { Brawl, type BrawlState } from './brawl'

const game = new Brawl()
const init = (players: string[], seed = 4): BrawlState =>
  game.init({
    players,
    seed,
    random: new SeededRandom(seed),
    now: 0,
    config: { durationMs: 75_000 },
  })
const fighter = (s: BrawlState, id: string) => {
  const f = s.fighters.find((x) => x.id === id)
  if (!f) throw new Error(`no fighter ${id}`)
  return f
}
// Puts two fighters face to face (a looking right at b) `gap` apart on the same lane.
const square = (s: BrawlState, gap: number): void => {
  Object.assign(fighter(s, 'a'), { x: 1, y: 0.2, face: 1 })
  Object.assign(fighter(s, 'b'), { x: 1 + gap, y: 0.2, face: -1 })
}
const run = (s: BrawlState, from: number, to: number): number => {
  let t = from
  while (t + 50 <= to) {
    t += 50
    game.tick(s, 50, t)
  }
  return t
}

describe('Brawl', () => {
  test('fighters line up along the street at full health', () => {
    const s = init(['a', 'b', 'c', 'd'])
    const xs = s.fighters.map((f) => f.x)
    expect(xs).toEqual([...xs].sort((p, q) => p - q))
    for (const f of s.fighters) expect(f.hp).toBe(BRAWL.hp)
  })

  test('walking moves along and across the street, turns to face, stays inside', () => {
    const s = init(['a'])
    const a = fighter(s, 'a')
    game.onInput(s, 'a', { kind: 'move', dx: -1, dy: 1 }, 0)
    run(s, 0, 5000)
    expect(a.face).toBe(-1)
    expect(a.x).toBe(BRAWL.bodyR)
    expect(a.y).toBe(BRAWL.depth)
  })

  test('a punch only lands in front, on about the same lane; the third in a row knocks down', () => {
    const s = init(['a', 'b'])
    square(s, 0.08)
    const b = fighter(s, 'b')
    game.onInput(s, 'a', { kind: 'punch' }, 0)
    expect(b.hp).toBe(BRAWL.hp - 8)
    expect(b.action).toBe('hurt')
    game.onInput(s, 'a', { kind: 'punch' }, 100) // still cooling down
    expect(b.hp).toBe(BRAWL.hp - 8)
    run(s, 0, 300)
    b.x = 1.08
    game.onInput(s, 'a', { kind: 'punch' }, 300)
    run(s, 300, 600)
    b.x = 1.08
    game.onInput(s, 'a', { kind: 'punch' }, 600)
    expect(b.hp).toBe(BRAWL.hp - 8 - 8 - 14)
    expect(b.action).toBe('down')
    run(s, 600, 900)
    game.onInput(s, 'a', { kind: 'punch' }, 900) // nobody gets hit while down
    expect(b.hp).toBe(BRAWL.hp - 30)
    // Behind or on another lane: no hit.
    run(s, 900, 2000)
    Object.assign(b, { x: 0.95, guardUntil: 0 })
    game.onInput(s, 'a', { kind: 'punch' }, 2000)
    expect(b.hp).toBe(BRAWL.hp - 30)
  })

  test('getting up comes with a moment of guard', () => {
    const s = init(['a', 'b'])
    square(s, 0.06)
    game.onInput(s, 'a', { kind: 'grab' }, 0)
    const b = fighter(s, 'b')
    expect(b.action).toBe('down')
    expect(b.x).toBeCloseTo(1.06 + 0.25)
    run(s, 0, 1000) // up again
    expect(b.action).not.toBe('down')
    expect(b.guardUntil).toBeGreaterThan(1000)
    Object.assign(b, { x: 1.08 })
    game.onInput(s, 'a', { kind: 'kick' }, 1400)
    expect(b.hp).toBe(BRAWL.hp - 16) // guarded: the kick didn't land
  })

  test('a kick reaches further and shoves; a KO is final and credits the attacker', () => {
    const s = init(['a', 'b', 'c'])
    square(s, 0.12)
    const [a, b] = [fighter(s, 'a'), fighter(s, 'b')]
    game.onInput(s, 'a', { kind: 'kick' }, 0)
    expect(b.hp).toBe(BRAWL.hp - 12)
    expect(b.x).toBeCloseTo(1.2)
    b.hp = 5
    b.x = 1.08
    run(s, 0, 700)
    game.onInput(s, 'a', { kind: 'punch' }, 700)
    expect(b.action).toBe('ko')
    expect(a.kos).toBe(1)
    expect(game.isFinished(s, 700)).toBe(false) // c still up
    fighter(s, 'c').action = 'ko'
    expect(game.isFinished(s, 700)).toBe(true)
    expect(game.getResult(s).placements[0]).toBe('a')
  })

  test('items: chicken heals, a pipe hits harder for a few swings, a bottle smashes once', () => {
    const s = init(['a', 'b'])
    square(s, 0.12)
    const [a, b] = [fighter(s, 'a'), fighter(s, 'b')]
    a.hp = 50
    s.items = [{ id: 1, x: a.x, y: a.y, kind: 'chicken' }]
    run(s, 0, 50)
    expect(a.hp).toBe(80)
    s.items = [{ id: 2, x: a.x, y: a.y, kind: 'pipe' }]
    run(s, 50, 100)
    expect(a.weapon).toBe('pipe')
    game.onInput(s, 'a', { kind: 'punch' }, 100) // 0.12 away: a bare fist wouldn't reach
    expect(b.hp).toBe(BRAWL.hp - 14)
    expect(a.uses).toBe(5)
    a.weapon = 'bottle'
    b.x = 1.08
    run(s, 100, 500)
    game.onInput(s, 'a', { kind: 'punch' }, 500)
    expect(b.action).toBe('down')
    expect(a.weapon).toBeNull()
    // Knocked down while armed: the weapon falls to the street.
    a.weapon = 'pipe'
    a.uses = 3
    Object.assign(b, {
      action: 'idle',
      actionUntil: 0,
      guardUntil: 0,
      x: 0.94,
      face: 1,
      nextAttackAt: 0,
    })
    game.onInput(s, 'b', { kind: 'grab' }, 2000)
    expect(a.weapon).toBeNull()
    expect(s.items.some((i) => i.kind === 'pipe')).toBe(true)
  })

  test('items drop onto the street on a seeded schedule; ranking is standing, KOs, then hp', () => {
    const s = init(['a', 'b', 'c'], 21)
    run(s, 0, 20_000)
    expect(s.items.length).toBeGreaterThan(0)
    const t = init(['a', 'b', 'c'], 21)
    run(t, 0, 20_000)
    expect(t.items).toEqual(s.items)
    Object.assign(fighter(s, 'a'), { action: 'ko', kos: 3, outAt: 9000 })
    Object.assign(fighter(s, 'b'), { kos: 0, hp: 20 })
    Object.assign(fighter(s, 'c'), { kos: 0, hp: 60 })
    expect(game.getResult(s).placements).toEqual(['c', 'b', 'a'])
  })

  test('seats are dealt out in a seeded order, not the join order', () => {
    const players = Array.from({ length: 8 }, (_, i) => `p${i}`)
    const seated = (seed: number): string[] => init(players, seed).fighters.map((f) => f.id)
    expect(seated(4)).toEqual(seated(4))
    expect([...seated(4)].sort()).toEqual(players)
    const orders = new Set([1, 2, 3, 4, 5].map((seed) => seated(seed).join()))
    expect(orders.size).toBeGreaterThan(1)
    expect(orders.has(players.join())).toBe(false)
  })

  test('a KO is shared: the finisher takes half, the rest is split by damage dealt', () => {
    const s = init(['a', 'b', 'c'])
    const [a, b, c] = [fighter(s, 'a'), fighter(s, 'b'), fighter(s, 'c')]
    Object.assign(c, { x: 1.2, y: 0.2, face: -1 })
    square(s, 0.12)
    b.hurtBy.set('c', 60) // c softened b up…
    b.hp = 10
    game.onInput(s, 'a', { kind: 'kick' }, 0) // …a lands the last 10
    expect(b.action).toBe('ko')
    expect(a.kos).toBeCloseTo(0.5 + 0.5 * (10 / 70))
    expect(c.kos).toBeCloseTo(0.5 * (60 / 70))
    const result = game.getResult(s)
    expect(result.stats?.a).toBe('0.6 KO')
    expect(result.stats?.c).toBe('0.4 KO')
    expect(result.placements.slice(0, 2)).toEqual(['a', 'c'])
    expect(game.snapshot(s, 0).fighters.find((f) => f.id === 'c')?.kos).toBe(0.4)
  })

  test('a fighter who leaves is out for nobody’s credit; the last one standing still wins', () => {
    const s = init(['a', 'b', 'c'])
    const b = fighter(s, 'b')
    b.weapon = 'pipe'
    game.leave(s, 'b', 1000)
    expect(b.action).toBe('ko')
    expect(s.items.some((i) => i.kind === 'pipe')).toBe(true)
    expect(s.fighters.reduce((sum, f) => sum + f.kos, 0)).toBe(0)
    expect(game.snapshot(s, 1000).fighters.map((f) => f.id)).not.toContain('b')
    expect(game.isFinished(s, 1000)).toBe(false)
    game.leave(s, 'c', 2000)
    expect(game.isFinished(s, 2000)).toBe(true)
    expect(game.getResult(s).placements[0]).toBe('a')
  })

  test('turning is instant: a punch right after pressing the other way swings that way', () => {
    const s = init(['a', 'b'])
    // b stands just BEHIND a (a faces right, b is on its left).
    Object.assign(fighter(s, 'a'), { x: 1, y: 0.2, face: 1 })
    Object.assign(fighter(s, 'b'), { x: 0.93, y: 0.2, face: 1 })
    game.onInput(s, 'a', { kind: 'move', dx: -1, dy: 0 }, 10)
    expect(fighter(s, 'a').face).toBe(-1)
    game.onInput(s, 'a', { kind: 'punch' }, 12)
    expect(fighter(s, 'b').hp).toBeLessThan(BRAWL.hp)
    // Mid-swing a direction doesn't turn you round.
    game.onInput(s, 'a', { kind: 'move', dx: 1, dy: 0 }, 20)
    expect(fighter(s, 'a').face).toBe(-1)
  })

  test('a bat reaches past a fist and every swing knocks down, for four swings', () => {
    const s = init(['a', 'b'])
    square(s, 0.14)
    const [a, b] = [fighter(s, 'a'), fighter(s, 'b')]
    s.items = [{ id: 1, x: a.x, y: a.y, kind: 'bat' }]
    run(s, 0, 50)
    expect(a.weapon).toBe('bat')
    expect(a.uses).toBe(4)
    game.onInput(s, 'a', { kind: 'punch' }, 50)
    expect(b.hp).toBe(BRAWL.hp - 18)
    expect(b.action).toBe('down')
    expect(b.x).toBeGreaterThan(1.14 + 0.1) // sent flying
    expect(a.uses).toBe(3)
    // A whiff costs no swing.
    game.onInput(s, 'a', { kind: 'punch' }, 2000)
    expect(a.uses).toBe(3)
    a.uses = 1
    Object.assign(b, { action: 'idle', actionUntil: 0, guardUntil: 0, x: 1.14 })
    game.onInput(s, 'a', { kind: 'punch' }, 4000)
    expect(a.weapon).toBeNull()
  })

  test('a thrown fuel can blows up on the first fighter in its path and floors the blast', () => {
    const s = init(['a', 'b', 'c', 'd'])
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => fighter(s, id))
    Object.assign(a, { x: 0.5, y: 0.2, face: 1, weapon: 'fuel', uses: 1 })
    Object.assign(d, { x: 0.45, y: 0.2 }) // right behind the thrower: never hit by its own throw
    Object.assign(b, { x: 0.9, y: 0.21 }) // first in the can's path
    Object.assign(c, { x: 1.02, y: 0.25 }) // caught in b's blast
    s.items = [{ id: 9, x: 1, y: 0.12, kind: 'fuel' }] // a can lying in the blast goes up too
    game.onInput(s, 'a', { kind: 'punch' }, 0)
    expect(a.weapon).toBeNull()
    expect(s.cans).toHaveLength(1)
    expect(game.snapshot(s, 0).cans).toHaveLength(1)
    const t = run(s, 0, 600)
    expect(s.cans).toHaveLength(0)
    expect(b.action).toBe('down')
    expect(c.action).toBe('down')
    expect(b.hp).toBeLessThan(BRAWL.hp)
    expect(c.hp).toBeLessThan(BRAWL.hp)
    expect(b.x).toBeGreaterThan(0.9) // blown clear, away from the centre
    expect(a.hp).toBe(BRAWL.hp)
    expect(d.hp).toBe(BRAWL.hp)
    expect(s.items.some((i) => i.kind === 'fuel')).toBe(false)
    expect(game.snapshot(s, t).blasts.length).toBeGreaterThanOrEqual(2) // the throw + the chained can
    run(s, t, t + 1000)
    expect(game.snapshot(s, t + 1000).blasts).toHaveLength(0)
  })

  test('a fuel can with nobody in its path blows up where it lands', () => {
    const s = init(['a', 'b'])
    const [a, b] = [fighter(s, 'a'), fighter(s, 'b')]
    Object.assign(a, { x: 0.3, y: 0.05, face: 1, weapon: 'fuel', uses: 1 })
    Object.assign(b, { x: 0.3 + BRAWL.fuel.range + 0.05, y: 0.3 }) // another lane, inside the blast
    game.onInput(s, 'a', { kind: 'punch' }, 0)
    run(s, 0, 2000)
    expect(s.cans).toHaveLength(0)
    expect(s.blasts).toHaveLength(0)
    expect(b.hp).toBe(BRAWL.hp) // 0.25 across the street: outside the blast's depth
  })
})
