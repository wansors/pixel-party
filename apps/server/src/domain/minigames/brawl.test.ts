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
})
