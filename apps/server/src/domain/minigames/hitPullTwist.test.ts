import { describe, expect, test } from 'bun:test'
import { HPT, HPT_FREEZE, HPT_OPPOSITE, hptExpected, hptOrder, hptWindowMs } from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import { HitPullTwist, type HptState } from './hitPullTwist'

const game = new HitPullTwist()
const init = (players: string[], seed = 3): HptState =>
  game.init({
    players,
    seed,
    random: new SeededRandom(seed),
    now: 0,
    config: { durationMs: 60_000 },
  })
const nn = <T>(x: T | undefined): T => {
  if (x === undefined) throw new Error('unexpected nullish')
  return x
}

// Answers player `id`'s orders right, `rt` ms after each shows, until order `upTo` (FREEZEs wait out).
function play(s: HptState, id: string, upTo: number, rt = 300): number {
  const r = nn(s.runners.get(id))
  let now = r.orderAt
  while (r.alive && r.k < upTo) {
    const order = hptOrder(s.seed, r.k)
    if (order.action === HPT_FREEZE) {
      now = r.orderAt + hptWindowMs(r.k)
      game.tick(s, 0, now)
      continue
    }
    now = r.orderAt + rt
    game.onInput(s, id, { kind: 'act', k: r.k, action: hptExpected(order) }, now)
  }
  return now
}

describe('Hit, Pull, Twist rules (shared)', () => {
  test('the same seed gives the same orders on every side', () => {
    const a = Array.from({ length: 80 }, (_, k) => hptOrder(12345, k))
    const b = Array.from({ length: 80 }, (_, k) => hptOrder(12345, k))
    expect(a).toEqual(b)
    expect(Array.from({ length: 80 }, (_, k) => hptOrder(999, k))).not.toEqual(a)
  })

  test('the tricks come in at their orders', () => {
    const seed = 7
    const orders = Array.from({ length: 200 }, (_, k) => hptOrder(seed, k))
    orders.slice(0, HPT.paintFrom).forEach((o) => {
      expect(o.paint).toBe(o.action)
    })
    expect(orders.slice(HPT.paintFrom).some((o) => o.action < 4 && o.paint !== o.action)).toBe(true)
    expect(orders.slice(0, HPT.flipFrom).some((o) => o.flipped)).toBe(false)
    expect(orders[HPT.flipFrom]?.flipped).toBe(true)
    expect(orders.slice(0, HPT.freezeFrom).some((o) => o.action === HPT_FREEZE)).toBe(false)
    expect(orders.some((o) => o.action === HPT_FREEZE)).toBe(true)
    // Never a FREEZE inside an upside-down stretch.
    expect(orders.some((o) => o.flipped && o.action === HPT_FREEZE)).toBe(false)
  })

  test('the right move: the action, its opposite when flipped, none on a FREEZE', () => {
    expect(hptExpected({ action: 0, paint: 2, flipped: false })).toBe(0)
    expect(hptExpected({ action: 1, paint: 1, flipped: true })).toBe(HPT_OPPOSITE[1])
    expect(hptExpected({ action: HPT_FREEZE, paint: 0, flipped: false })).toBe(-1)
  })

  test('each order gives a little less time, down to a floor (D40)', () => {
    expect(hptWindowMs(0)).toBe(HPT.windowMs)
    expect(hptWindowMs(10)).toBeLessThan(hptWindowMs(9))
    expect(hptWindowMs(200)).toBe(HPT.windowMinMs)
  })
})

describe('HitPullTwist', () => {
  test('right moves in time keep you going; the next order shows after the gap', () => {
    const s = init(['a'])
    const now = play(s, 'a', 25)
    const r = nn(s.runners.get('a'))
    expect(r.alive).toBe(true)
    expect(r.k).toBe(25)
    expect(r.orderAt).toBe(now + HPT.gapMs)
  })

  test('a wrong move is out', () => {
    const s = init(['a', 'b'])
    const order = hptOrder(s.seed, 0)
    game.onInput(
      s,
      'a',
      { kind: 'act', k: 0, action: (hptExpected(order) + 1) % 4 },
      HPT.startDelayMs + 200,
    )
    expect(nn(s.runners.get('a')).alive).toBe(false)
  })

  test('too slow is out: the window plus the trip, then the tick says so', () => {
    const s = init(['a', 'b'])
    const late = HPT.startDelayMs + hptWindowMs(0) + HPT.lateMs + 1
    game.tick(s, 0, late - 2)
    expect(nn(s.runners.get('a')).alive).toBe(true)
    game.tick(s, 0, late)
    expect(nn(s.runners.get('a')).alive).toBe(false)
    // An answer that arrives within the trip allowance still counts.
    const s2 = init(['a'])
    const ok = HPT.startDelayMs + hptWindowMs(0) + HPT.lateMs - 10
    game.onInput(s2, 'a', { kind: 'act', k: 0, action: hptExpected(hptOrder(s2.seed, 0)) }, ok)
    expect(nn(s2.runners.get('a')).k).toBe(1)
  })

  test('a FREEZE passes by itself; touching anything during one is out', () => {
    const s = init(['a', 'b'])
    let f = 0
    while (hptOrder(s.seed, f).action !== HPT_FREEZE) f++
    play(s, 'a', f)
    play(s, 'b', f)
    const ra = nn(s.runners.get('a'))
    const rb = nn(s.runners.get('b'))
    expect(ra.k).toBe(f)
    game.onInput(s, 'b', { kind: 'act', k: f, action: 0 }, rb.orderAt + 100)
    expect(rb.alive).toBe(false)
    game.tick(s, 0, ra.orderAt + hptWindowMs(f))
    expect(ra.alive).toBe(true)
    expect(ra.k).toBe(f + 1)
  })

  test('stale, early or junk answers are ignored', () => {
    const s = init(['a'])
    const right = hptExpected(hptOrder(s.seed, 0))
    game.onInput(s, 'a', { kind: 'act', k: 0, action: right }, 200)
    game.onInput(s, 'a', { kind: 'act', k: 5, action: right }, HPT.startDelayMs + 100)
    game.onInput(s, 'a', { kind: 'act', k: 0, action: 9 }, HPT.startDelayMs + 100)
    const r = nn(s.runners.get('a'))
    expect(r).toMatchObject({ k: 0, alive: true })
  })

  test('the round ends once everyone is out; more orders done ranks higher', () => {
    const s = init(['a', 'b', 'c'])
    play(s, 'a', 10)
    play(s, 'b', 4)
    const rb = nn(s.runners.get('b'))
    game.onInput(
      s,
      'b',
      { kind: 'act', k: 4, action: (hptExpected(hptOrder(s.seed, 4)) + 1) % 4 },
      rb.orderAt + 100,
    )
    game.tick(s, 0, 30_000)
    expect(game.isFinished(s, 30_000)).toBe(true)
    const res = game.getResult(s)
    expect(res.placements).toEqual(['a', 'b', 'c'])
    expect(res.stats).toEqual({ a: 'streak 10', b: 'streak 4', c: 'streak 0' })
  })

  test('survivors level at the bell share the top', () => {
    const s = init(['a', 'b'])
    play(s, 'a', 6)
    play(s, 'b', 6)
    expect(game.isFinished(s, 60_000)).toBe(true)
    expect(game.getResult(s).ranks).toEqual({ a: 0, b: 0 })
  })

  test('the snapshot says when each player’s order shows', () => {
    const s = init(['a'])
    const snap = game.snapshot(s, 1000)
    expect(snap.players.a).toEqual({ k: 0, alive: true, orderInMs: HPT.startDelayMs - 1000 })
    expect(snap.seed).toBe(s.seed)
  })
})
