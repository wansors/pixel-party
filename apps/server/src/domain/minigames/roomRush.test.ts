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
    for (let alive = 2; alive <= 12; alive++) {
      for (let seed = 1; seed <= 12; seed++) {
        const s = init(alive, seed)
        toCall(s)
        // A big field never gets single rooms (ten of them would let almost everyone through).
        expect(s.n).toBeGreaterThanOrEqual(alive >= 10 ? 2 : 1)
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

  test('a room locks the moment it holds N; the buzzer eliminates everyone else', () => {
    const s = init(6, 4)
    let t = toCall(s)
    const n = s.n
    const room = s.rooms[0]
    if (!room) throw new Error('no room')
    // Pack exactly N players into the first room.
    spots(room.slot)
      .slice(0, n)
      .forEach(([x, y], i) => park(s, `p${i}`, x, y))
    t = run(s, t, t + 50)
    expect(room.locked).toBe(true)
    for (let i = 0; i < n; i++) expect(body(s, `p${i}`).safe).toBe(true)
    // Everyone else idles on the floor until the buzzer.
    while (s.phase === 'call') t = run(s, t, t + 50)
    expect(s.phase).toBe('reveal')
    for (const b of s.bodies) expect(b.alive).toBe(b.safe)
    expect(s.outThisCall.length).toBe(6 - n)
  })

  test('a room overshooting N in one tick keeps the deepest N; the late one is bounced out', () => {
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
    // N players deep in the room side by side and one more just inside the door, all in one tick.
    const [cx, cy] = roomCenter(room.slot)
    const a = roomRushSlotAngle(room.slot)
    const late = `p${s.n}`
    for (let i = 0; i < s.n; i++) {
      const lv = (i - (s.n - 1) / 2) * 0.062
      park(
        s,
        `p${i}`,
        cx + Math.cos(a) * 0.035 - Math.sin(a) * lv,
        cy + Math.sin(a) * 0.035 + Math.cos(a) * lv,
      )
    }
    park(s, late, cx - Math.cos(a) * 0.04, cy - Math.sin(a) * 0.04)
    t = run(s, t, t + 50)
    expect(room.locked).toBe(true)
    expect(room.count).toBe(s.n)
    for (let i = 0; i < s.n; i++) expect(body(s, `p${i}`).safe).toBe(true)
    const bounced = body(s, late)
    expect(bounced.safe).toBe(false)
    expect(Math.hypot(bounced.x - cx, bounced.y - cy)).toBeGreaterThan(ROOM_RUSH.half)
    // The slammed door keeps it out until the buzzer.
    while (s.phase === 'call') t = run(s, t, t + 50)
    expect(bounced.alive).toBe(false)
    expect(s.bodies.filter((b) => b.alive)).toHaveLength(s.n)
  })

  test('the final two: the first one in locks the room, the follower cannot spoil it', () => {
    const s = init(2, 5)
    let t = toCall(s)
    const room = s.rooms[0]
    if (!room) throw new Error('no room')
    const [cx, cy] = roomCenter(room.slot)
    park(s, 'p0', cx, cy)
    t = run(s, t, t + 50)
    expect(room.locked).toBe(true)
    // The follower charges the door: it's shut.
    const a = roomRushSlotAngle(room.slot)
    park(s, 'p1', 0.5 + Math.cos(a) * 0.27, 0.5 + Math.sin(a) * 0.27)
    game.onInput(s, 'p1', { kind: 'move', dx: cx - 0.5, dy: cy - 0.5 }, t)
    while (!s.done) t = run(s, t, t + 50)
    const result = game.getResult(s)
    expect(result.placements).toEqual(['p0', 'p1'])
    expect(result.ranks?.p1).toBe(1)
  })

  test('a wipeout (nobody made it) replays the call instead of ending in one big tie', () => {
    const s = init(4, 2)
    let t = toCall(s)
    const call = s.call
    while (s.phase === 'call') t = run(s, t, t + 50)
    expect(s.phase).toBe('reveal')
    expect(s.outThisCall).toEqual([])
    expect(s.bodies.every((b) => b.alive)).toBe(true)
    toCall(s, t)
    expect(s.call).toBe(call + 1)
  })

  test('respawns spread a full room around the hub without overlaps', () => {
    const s = init(12, 9)
    for (let i = 0; i < s.bodies.length; i++) {
      for (let j = i + 1; j < s.bodies.length; j++) {
        const a = s.bodies[i] as (typeof s.bodies)[number]
        const b = s.bodies[j] as (typeof s.bodies)[number]
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(ROOM_RUSH.playerR * 2)
      }
      const b = s.bodies[i] as (typeof s.bodies)[number]
      expect(fromCenter(b.x, b.y)).toBeLessThan(ROOM_RUSH.carouselR - ROOM_RUSH.playerR)
    }
  })

  test('bodies stacked on the exact same spot are pushed apart', () => {
    const s = init(2)
    park(s, 'p0', 0.5, 0.5)
    park(s, 'p1', 0.5, 0.5)
    run(s, 0, 100)
    const [a, b] = [body(s, 'p0'), body(s, 'p1')]
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(ROOM_RUSH.playerR)
  })

  test('a player gone for good is out at once; the last one left wins', () => {
    const s = init(3, 6)
    game.leave(s, 'p1', 1000)
    expect(body(s, 'p1').alive).toBe(false)
    expect(s.done).toBe(false)
    game.leave(s, 'p2', 1500)
    expect(game.isFinished(s, 1500)).toBe(true)
    const result = game.getResult(s)
    expect(result.placements[0]).toBe('p0')
    expect(result.ranks?.p2).toBe(1)
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
