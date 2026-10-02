import { describe, expect, test } from 'bun:test'
import { ROOM_RUSH, roomRushSlotAngle } from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import { RoomRush, type RoomRushState } from './roomRush'

const game = new RoomRush()
const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `p${i}`)
const init = (n: number, seed = 3): RoomRushState =>
  game.init({
    players: ids(n),
    seed,
    random: new SeededRandom(seed),
    now: 0,
    config: { durationMs: 75_000 },
  })
const body = (s: RoomRushState, id: string) => {
  const b = s.bodies.find((x) => x.id === id)
  if (!b) throw new Error(`no body ${id}`)
  return b
}
const roomCenter = (slot: number): [number, number] => {
  const a = roomRushSlotAngle(slot)
  return [0.5 + Math.cos(a) * ROOM_RUSH.roomR, 0.5 + Math.sin(a) * ROOM_RUSH.roomR]
}
// Four non-overlapping standing spots inside a room (its local corners, clear of the walls).
const spots = (slot: number): [number, number][] => {
  const a = roomRushSlotAngle(slot)
  const [cx, cy] = roomCenter(slot)
  const u = [Math.cos(a), Math.sin(a)]
  const v = [-Math.sin(a), Math.cos(a)]
  const k = 0.032
  return [
    [-1, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
  ].map(([su = 0, sv = 0]) => [
    cx + k * (su * (u[0] ?? 0) + sv * (v[0] ?? 0)),
    cy + k * (su * (u[1] ?? 0) + sv * (v[1] ?? 0)),
  ])
}
const fromCenter = (x: number, y: number): number => Math.hypot(x - 0.5, y - 0.5)
// Ticks at 20 Hz; returns the time reached.
const run = (s: RoomRushState, from: number, to: number): number => {
  let t = from
  while (t + 50 <= to) {
    t += 50
    game.tick(s, 50, t)
  }
  return t
}
const toCall = (s: RoomRushState, from = 0): number => {
  let t = from
  while (s.phase !== 'call') t = run(s, t, t + 50)
  return t
}
// Parks a body at rest at a point (inside a room, say).
const park = (s: RoomRushState, id: string, x: number, y: number): void => {
  Object.assign(body(s, id), { x, y, vx: 0, vy: 0, ax: 0, ay: 0 })
}

describe('RoomRush', () => {
  test('starts with everyone on the carousel during the music, no rooms open', () => {
    const s = init(6)
    expect(s.phase).toBe('music')
    expect(s.call).toBe(1)
    expect(s.rooms).toHaveLength(0)
    for (const b of s.bodies) expect(fromCenter(b.x, b.y)).toBeLessThan(ROOM_RUSH.carouselR)
  })

  test('is deterministic per seed', () => {
    const a = init(6, 11)
    const b = init(6, 11)
    toCall(a)
    toCall(b)
    expect(a.n).toBe(b.n)
    expect(a.rooms).toEqual(b.rooms)
    expect(a.bodies.map((x) => [x.x, x.y])).toEqual(b.bodies.map((x) => [x.x, x.y]))
  })

  test('the music holds everyone on the turning carousel', () => {
    const s = init(2)
    const a = body(s, 'p0')
    const still = body(s, 'p1')
    const r0 = fromCenter(still.x, still.y)
    const ang0 = Math.atan2(still.y - 0.5, still.x - 0.5)
    game.onInput(s, 'p0', { kind: 'move', dx: 1, dy: 0.2 }, 0)
    run(s, 0, 3000)
    expect(s.phase).toBe('music')
    expect(fromCenter(a.x, a.y)).toBeLessThanOrEqual(ROOM_RUSH.carouselR)
    // A rider standing still keeps its radius and turns with the carousel.
    expect(fromCenter(still.x, still.y)).toBeCloseTo(r0, 2)
    expect(Math.atan2(still.y - 0.5, still.x - 0.5)).not.toBeCloseTo(ang0, 1)
  })

  test('capacity always stays below the survivors; the final two get one room for one', () => {
    for (let alive = 2; alive <= 10; alive++) {
      for (let seed = 1; seed <= 12; seed++) {
        const s = init(alive, seed)
        toCall(s)
        expect(s.n).toBeGreaterThanOrEqual(1)
        expect(s.n).toBeLessThanOrEqual(Math.min(4, alive - 1))
        expect(s.rooms.length * s.n).toBeLessThanOrEqual(alive - 1)
        expect(new Set(s.rooms.map((r) => r.slot)).size).toBe(s.rooms.length)
        if (alive === 2) expect([s.n, s.rooms.length]).toEqual([1, 1])
      }
    }
  })

  test('a shut door blocks the way in; an open one lets a runner through', () => {
    const s = init(4)
    let t = toCall(s)
    const open = s.rooms[0]?.slot ?? 0
    const shut =
      [...Array(ROOM_RUSH.slots).keys()].find((k) => !s.rooms.some((r) => r.slot === k)) ?? 0
    const dive = (id: string, slot: number): void => {
      const [cx, cy] = roomCenter(slot)
      const a = roomRushSlotAngle(slot)
      // Start on the floor in front of the door, steering straight in.
      park(s, id, 0.5 + Math.cos(a) * 0.27, 0.5 + Math.sin(a) * 0.27)
      game.onInput(s, id, { kind: 'move', dx: cx - 0.5, dy: cy - 0.5 }, t)
    }
    dive('p0', open)
    dive('p1', shut)
    t = run(s, t, t + 1500)
    const inRoom = (id: string, slot: number): boolean => {
      const [cx, cy] = roomCenter(slot)
      const b = body(s, id)
      return Math.hypot(b.x - cx, b.y - cy) < ROOM_RUSH.half
    }
    expect(inRoom('p0', open)).toBe(true)
    expect(inRoom('p1', shut)).toBe(false)
  })

  test('a room holding exactly N locks; the buzzer eliminates everyone else', () => {
    const s = init(6, 4)
    let t = toCall(s)
    const n = s.n
    const room = s.rooms[0]
    if (!room) throw new Error('no room')
    // Pack exactly N players into the first room.
    spots(room.slot)
      .slice(0, n)
      .forEach(([x, y], i) => park(s, `p${i}`, x, y))
    t = run(s, t, t + ROOM_RUSH.lockMs + 100)
    expect(room.locked).toBe(true)
    for (let i = 0; i < n; i++) expect(body(s, `p${i}`).safe).toBe(true)
    // Everyone else idles on the floor until the buzzer.
    while (s.phase === 'call') t = run(s, t, t + 50)
    expect(s.phase).toBe('reveal')
    for (const b of s.bodies) expect(b.alive).toBe(b.safe)
    expect(s.outThisCall.length).toBe(6 - n)
  })

  test('a room with the wrong count at the buzzer takes everyone inside down with it', () => {
    // A seed whose call is N ≤ 3, so N + 1 players still fit the room's four spots.
    let seed = 1
    while (true) {
      const probe = init(5, seed)
      toCall(probe)
      if (probe.n <= 3) break
      seed++
    }
    const s = init(5, seed)
    let t = toCall(s)
    const room = s.rooms[0]
    if (!room) throw new Error('no room')
    const crowd = s.n + 1
    spots(room.slot)
      .slice(0, crowd)
      .forEach(([x, y], i) => park(s, `p${i}`, x, y))
    while (s.phase === 'call') t = run(s, t, t + 50)
    expect(room.locked).toBe(false)
    for (let i = 0; i < crowd; i++) expect(body(s, `p${i}`).alive).toBe(false)
  })

  test('ends once one survivor is left; ranks by the call each player fell in', () => {
    const s = init(3, 6)
    const [a, b, c] = [body(s, 'p0'), body(s, 'p1'), body(s, 'p2')]
    Object.assign(a, { alive: false, outCall: 1, outAt: 10_000 })
    Object.assign(b, { alive: false, outCall: 2, outAt: 22_000 })
    s.phase = 'reveal'
    s.phaseEndsAt = 23_000
    run(s, 22_950, 23_050)
    expect(game.isFinished(s, 23_050)).toBe(true)
    const result = game.getResult(s)
    expect(result.placements).toEqual(['p2', 'p1', 'p0'])
    expect(c.alive).toBe(true)
    // Victims of the same call tie.
    b.outCall = 1
    const tied = game.getResult(s)
    expect(tied.ranks?.p1).toBe(tied.ranks?.p0)
  })

  test('dash bursts in the steering direction, with a cooldown; junk input is ignored', () => {
    const s = init(2)
    const a = body(s, 'p0')
    game.onInput(s, 'p0', { kind: 'move', dx: 0, dy: -1 }, 0)
    game.onInput(s, 'p0', { kind: 'dash' }, 100)
    expect(a.vy).toBeLessThan(-0.8)
    a.vy = 0
    game.onInput(s, 'p0', { kind: 'dash' }, 600)
    expect(a.vy).toBe(0)
    game.onInput(s, 'p0', { kind: 'move', dx: Number.NaN, dy: 1 }, 700)
    expect(a.ay).toBe(-1)
    game.onInput(s, 'nobody', { kind: 'dash' }, 700)
  })
})
