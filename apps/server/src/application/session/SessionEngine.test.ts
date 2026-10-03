import { describe, expect, test } from 'bun:test'
import type { ServerMsg } from '@pp/shared'
import { Player } from '../../domain/entities/Player'
import { Room } from '../../domain/entities/Room'
import type { Random } from '../../domain/ports/Random'
import type { Clock } from '../ports/Clock'
import type { Publisher } from '../ports/Publisher'
import { type SessionConfig, SessionEngine } from './SessionEngine'

const CONFIG: SessionConfig = {
  introMs: 100,
  roundResultMs: 100,
  scoreboardMs: 100,
  tickHz: 10,
  snapshotEveryNTicks: 1,
  defaultDurationMs: 500,
  baseSeed: 1,
  handicap: { enabled: false, maxBonusPct: 0.2 },
}

const noRandom: Random = { next: () => 0 }

function roomWith(...names: string[]): Room {
  const room = Room.create('TEST', 10)
  for (const n of names) room.add(Player.create({ id: n, name: n, color: '#fff', avatar: 'x' }))
  room.configure(['button-masher'], 1)
  return room
}

// Drive the engine deterministically with a controllable clock; `a` mashes every tick, `b` never does.
function playSession(room: Room, cfg: SessionConfig = CONFIG): ServerMsg[] {
  let t = 0
  const clock: Clock = { now: () => t }
  const captured: ServerMsg[] = []
  const publisher: Publisher = { toRoom: (_code, msg) => captured.push(msg) }
  const engine = new SessionEngine(room, publisher, clock, noRandom, cfg)

  engine.start()
  for (let i = 0; i < 400 && !engine.isFinished; i++) {
    t += 1000 / cfg.tickHz
    engine.onInput('a', { kind: 'mash' })
    engine.tick()
  }
  return captured
}

describe('SessionEngine', () => {
  test('runs a full single round: intro -> state -> result -> scoreboard -> final', () => {
    const msgs = playSession(roomWith('a', 'b'))
    const types = new Set(msgs.map((m) => m.type))
    expect(types.has('ROUND_INTRO')).toBe(true)
    expect(types.has('ROUND_STATE')).toBe(true)
    expect(types.has('ROUND_RESULT')).toBe(true)
    expect(types.has('SCOREBOARD')).toBe(true)
    expect(types.has('FINAL_RANKING')).toBe(true)
  })

  test('reveals the round result before the cumulative scoreboard', () => {
    const msgs = playSession(roomWith('a', 'b'))
    const roundResult = msgs.findIndex((m) => m.type === 'ROUND_RESULT')
    const scoreboard = msgs.findIndex((m) => m.type === 'SCOREBOARD')
    expect(roundResult).toBeGreaterThanOrEqual(0)
    expect(scoreboard).toBeGreaterThan(roundResult)
  })

  test('publishes the cumulative scoreboard together with the round result, once per round', () => {
    const msgs = playSession(roomWith('a', 'b'))
    const roundResult = msgs.findIndex((m) => m.type === 'ROUND_RESULT')
    expect(msgs[roundResult + 1]?.type).toBe('SCOREBOARD')
    expect(msgs.filter((m) => m.type === 'SCOREBOARD')).toHaveLength(1)
  })

  test('publishes a final snapshot, then holds the result back for the grace period', () => {
    const room = roomWith('a', 'b')
    let t = 0
    const clock: Clock = { now: () => t }
    const captured: { at: number; msg: ServerMsg }[] = []
    const publisher: Publisher = { toRoom: (_code, msg) => captured.push({ at: t, msg }) }
    const engine = new SessionEngine(room, publisher, clock, noRandom, {
      ...CONFIG,
      roundEndGraceMs: 300,
    })
    engine.start()
    for (let i = 0; i < 400 && !engine.isFinished; i++) {
      t += 1000 / CONFIG.tickHz
      engine.onInput('a', { kind: 'mash' })
      engine.tick()
    }
    const final = captured.find((c) => c.msg.type === 'ROUND_STATE' && c.msg.final)
    const result = captured.find((c) => c.msg.type === 'ROUND_RESULT')
    if (!final || !result) throw new Error('missing final snapshot or result')
    expect(result.at - final.at).toBeGreaterThanOrEqual(300)
    // Frozen during the grace period: no further live snapshots after the final one.
    const between = captured.filter(
      (c) => c.at > final.at && c.at < result.at && c.msg.type === 'ROUND_STATE',
    )
    expect(between).toHaveLength(0)
  })

  test('the only masher wins the round and the final ranking', () => {
    const msgs = playSession(roomWith('a', 'b'))
    const final = msgs.find((m) => m.type === 'FINAL_RANKING')
    expect(final).toBeDefined()
    if (final?.type !== 'FINAL_RANKING') throw new Error('no final')
    const a = final.scores.find((s) => s.playerId === 'a')
    const b = final.scores.find((s) => s.playerId === 'b')
    expect(a?.rank).toBe(1)
    expect(a?.points).toBe(10)
    expect(b?.rank).toBe(2)
    expect(b?.points).toBe(7)
  })

  test('sets the room phase to final when done', () => {
    const room = roomWith('a', 'b')
    playSession(room)
    expect(room.phase).toBe('final')
  })

  test('a handicap-enabled session still completes and keeps the winner on top', () => {
    const room = roomWith('a', 'b')
    // Host toggle on (room is the source of truth); server cap from config.
    room.configure(['button-masher'], 1, true)
    const msgs = playSession(room, { ...CONFIG, handicap: { enabled: true, maxBonusPct: 0.2 } })
    const final = msgs.find((m) => m.type === 'FINAL_RANKING')
    if (final?.type !== 'FINAL_RANKING') throw new Error('no final')
    // Round 1 standings are level so no bonus applies; the masher still wins outright.
    expect(final.scores.find((s) => s.playerId === 'a')?.rank).toBe(1)
  })

  test('final ranking carries the Phase 4 analysis (radars + summary)', () => {
    const msgs = playSession(roomWith('a', 'b'))
    const final = msgs.find((m) => m.type === 'FINAL_RANKING')
    if (final?.type !== 'FINAL_RANKING') throw new Error('no final')
    // A radar per player; the round winner scores 1.0 on the game's axis (button-masher → speed).
    expect(final.radars?.length).toBe(2)
    const a = final.radars?.find((r) => r.playerId === 'a')
    expect(a?.axes.speed).toBe(1)
    // Summary reports the per-round winner and the most-wins leader.
    expect(final.summary?.perRound.length).toBe(1)
    expect(final.summary?.mostRoundWins).toEqual({ playerId: 'a', wins: 1 })
  })

  test('round result carries the skill radar built so far, not just the final one', () => {
    const msgs = playSession(roomWith('a', 'b'))
    const roundResult = msgs.find((m) => m.type === 'ROUND_RESULT')
    if (roundResult?.type !== 'ROUND_RESULT') throw new Error('no round result')
    // Only one round has been played at this point, so this already matches the final radar.
    expect(roundResult.result.radars?.length).toBe(2)
    const a = roundResult.result.radars?.find((r) => r.playerId === 'a')
    expect(a?.axes.speed).toBe(1)
  })

  test('plays a multi-game sequence with no repeats and finishes', () => {
    const room = Room.create('SEQ', 10)
    room.add(Player.create({ id: 'a', name: 'a', color: '#fff', avatar: 'x' }))
    room.add(Player.create({ id: 'b', name: 'b', color: '#fff', avatar: 'x' }))
    room.configure(['button-masher', 'reaction-duel'], 2)

    let t = 0
    const clock: Clock = { now: () => t }
    const captured: ServerMsg[] = []
    const engine = new SessionEngine(
      room,
      { toRoom: (_c, m) => captured.push(m) },
      clock,
      noRandom,
      CONFIG,
    )
    engine.start()
    for (let i = 0; i < 800 && !engine.isFinished; i++) {
      t += 1000 / CONFIG.tickHz
      engine.onInput('a', { kind: 'mash' })
      engine.onInput('a', { kind: 'tap' })
      engine.tick()
    }

    const ids = captured.flatMap((m) => (m.type === 'ROUND_INTRO' ? [m.minigameId] : []))
    expect(ids.length).toBe(2)
    // Both configured games appear exactly once (order is seeded-shuffled, so not asserted).
    expect(new Set(ids)).toEqual(new Set(['button-masher', 'reaction-duel']))
    expect(captured.some((m) => m.type === 'FINAL_RANKING')).toBe(true)
  })

  test('skips picked games whose player range does not fit the headcount (D27)', () => {
    const room = Room.create('FIT', 12)
    room.add(Player.create({ id: 'a', name: 'a', color: '#fff', avatar: 'x' }))
    // A duel needs a second player: a solo host only plays the game that fits one.
    room.configure(['sink-the-fleet', 'button-masher'], 2)

    let t = 0
    const clock: Clock = { now: () => t }
    const captured: ServerMsg[] = []
    const engine = new SessionEngine(
      room,
      { toRoom: (_c, m) => captured.push(m) },
      clock,
      noRandom,
      CONFIG,
    )
    engine.start()
    for (let i = 0; i < 400 && !engine.isFinished; i++) {
      t += 1000 / CONFIG.tickHz
      engine.tick()
    }

    const intros = captured.flatMap((m) => (m.type === 'ROUND_INTRO' ? [m] : []))
    expect(intros.map((m) => m.minigameId)).toEqual(['button-masher'])
    expect(intros[0]?.totalRounds).toBe(1)
  })

  test('caps rounds at the number of distinct games (no-repeat)', () => {
    const room = Room.create('CAP', 10)
    room.add(Player.create({ id: 'a', name: 'a', color: '#fff', avatar: 'x' }))
    // Two distinct solo-friendly games but five rounds requested — a no-repeat session plays only two.
    room.configure(['button-masher', 'color-trap'], 5)

    let t = 0
    const clock: Clock = { now: () => t }
    const captured: ServerMsg[] = []
    const engine = new SessionEngine(
      room,
      { toRoom: (_c, m) => captured.push(m) },
      clock,
      noRandom,
      CONFIG,
    )
    engine.start()
    for (let i = 0; i < 1600 && !engine.isFinished; i++) {
      t += 1000 / CONFIG.tickHz
      engine.onInput('a', { kind: 'mash' })
      engine.onInput('a', { kind: 'tap' })
      engine.tick()
    }

    const ids = captured.flatMap((m) => (m.type === 'ROUND_INTRO' ? [m.minigameId] : []))
    expect(ids.length).toBe(2)
    expect(new Set(ids).size).toBe(2)
    const intro = captured.find((m) => m.type === 'ROUND_INTRO')
    expect(intro?.type === 'ROUND_INTRO' && intro.totalRounds).toBe(2)
  })

  test('avoids two consecutive games sharing the same primary skill axis when an alternative exists', () => {
    const room = Room.create('AXIS', 10)
    room.add(Player.create({ id: 'a', name: 'a', color: '#fff', avatar: 'x' }))
    // bug-smash & pixel-rain are both primary-axis `reflexes`; button-masher (speed) and trivia
    // (knowledge) give the draw a way to keep them apart.
    room.configure(['bug-smash', 'pixel-rain', 'button-masher', 'trivia'], 4)

    let t = 0
    const clock: Clock = { now: () => t }
    const captured: ServerMsg[] = []
    const engine = new SessionEngine(
      room,
      { toRoom: (_c, m) => captured.push(m) },
      clock,
      noRandom,
      CONFIG,
    )
    engine.start()
    for (let i = 0; i < 3200 && !engine.isFinished; i++) {
      t += 1000 / CONFIG.tickHz
      engine.onInput('a', { kind: 'mash' })
      engine.onInput('a', { kind: 'tap' })
      engine.tick()
    }

    const ids = captured.flatMap((m) => (m.type === 'ROUND_INTRO' ? [m.minigameId] : []))
    expect(ids.length).toBe(4)
    const axisOf: Record<string, string> = {
      'bug-smash': 'reflexes',
      'pixel-rain': 'reflexes',
      'button-masher': 'speed',
      trivia: 'knowledge',
    }
    for (let i = 1; i < ids.length; i++) {
      expect(axisOf[ids[i] as string]).not.toBe(axisOf[ids[i - 1] as string])
    }
  })

  test('team round awards team-position points and reports the winning team', () => {
    const room = Room.create('TEAM', 10)
    for (const id of ['a', 'b', 'c', 'd']) {
      room.add(Player.create({ id, name: id, color: '#fff', avatar: 'x' }))
    }
    room.setTeams(
      new Map([
        ['a', 'red'],
        ['b', 'red'],
        ['c', 'blue'],
        ['d', 'blue'],
      ]),
    )
    room.configure(['tug-of-war'], 1)

    let t = 0
    const clock: Clock = { now: () => t }
    const captured: ServerMsg[] = []
    const engine = new SessionEngine(
      room,
      { toRoom: (_c, m) => captured.push(m) },
      clock,
      noRandom,
      CONFIG,
    )
    engine.start()
    for (let i = 0; i < 400 && !engine.isFinished; i++) {
      t += 1000 / CONFIG.tickHz
      // Only red pulls -> red wins.
      engine.onInput('a', { kind: 'pull' })
      engine.onInput('b', { kind: 'pull' })
      engine.tick()
    }

    const rr = captured.find((m) => m.type === 'ROUND_RESULT')
    if (rr?.type !== 'ROUND_RESULT') throw new Error('no round result')
    expect(rr.result.teams).toBeDefined()
    expect(rr.result.teams?.find((tm) => tm.rank === 0)?.id).toBe('red')

    const final = captured.find((m) => m.type === 'FINAL_RANKING')
    if (final?.type !== 'FINAL_RANKING') throw new Error('no final')
    // Both red members get the winning team's points (10), undiluted by team size.
    expect(final.scores.find((s) => s.playerId === 'a')?.points).toBe(10)
    expect(final.scores.find((s) => s.playerId === 'b')?.points).toBe(10)
    expect(final.scores.find((s) => s.playerId === 'c')?.points).toBe(7)
  })

  test('duel round runs and produces per-player scores (no team summary)', () => {
    const room = Room.create('DUEL', 10)
    room.add(Player.create({ id: 'a', name: 'a', color: '#fff', avatar: 'x' }))
    room.add(Player.create({ id: 'b', name: 'b', color: '#fff', avatar: 'x' }))
    room.configure(['sink-the-fleet'], 1)

    let t = 0
    const clock: Clock = { now: () => t }
    const captured: ServerMsg[] = []
    const engine = new SessionEngine(
      room,
      { toRoom: (_c, m) => captured.push(m) },
      clock,
      noRandom,
      CONFIG,
    )
    engine.start()
    // No inputs: the duel resolves at the time cap. Enough ticks to clear the 60s round window.
    for (let i = 0; i < 1400 && !engine.isFinished; i++) {
      t += 1000 / CONFIG.tickHz
      engine.tick()
    }

    const rr = captured.find((m) => m.type === 'ROUND_RESULT')
    if (rr?.type !== 'ROUND_RESULT') throw new Error('no round result')
    expect(rr.result.teams).toBeUndefined()
    expect(rr.result.scores).toHaveLength(2)
    expect(captured.some((m) => m.type === 'FINAL_RANKING')).toBe(true)
  })

  test('resumeMessages rebuilds the live round for a reconnecting socket', () => {
    const room = roomWith('a', 'b')
    let t = 0
    const clock: Clock = { now: () => t }
    const engine = new SessionEngine(room, { toRoom: () => {} }, clock, noRandom, CONFIG)
    engine.start()
    t += CONFIG.introMs
    engine.tick() // intro -> playing
    t += 1000 / CONFIG.tickHz
    engine.onInput('a', { kind: 'mash' })
    engine.tick()

    const msgs = engine.resumeMessages()
    const types = msgs.map((m) => m.type)
    expect(types).toContain('SCOREBOARD')
    expect(types).toContain('ROUND_INTRO')
    expect(types).toContain('ROUND_STATE')
  })

  test('resumeMessages returns the final ranking once the session is over', () => {
    const room = roomWith('a', 'b')
    let t = 0
    const clock: Clock = { now: () => t }
    const engine = new SessionEngine(room, { toRoom: () => {} }, clock, noRandom, CONFIG)
    engine.start()
    for (let i = 0; i < 400 && !engine.isFinished; i++) {
      t += 1000 / CONFIG.tickHz
      engine.onInput('a', { kind: 'mash' })
      engine.tick()
    }
    const msgs = engine.resumeMessages()
    expect(msgs).toHaveLength(1)
    expect(msgs[0]?.type).toBe('FINAL_RANKING')
  })
})
