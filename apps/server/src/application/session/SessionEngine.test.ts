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
}

const noRandom: Random = { next: () => 0 }

function roomWith(...names: string[]): Room {
  const room = Room.create('TEST', 10)
  for (const n of names) room.add(Player.create({ id: n, name: n, color: '#fff', avatar: 'x' }))
  room.configure(['button-masher'], 1)
  return room
}

// Drive the engine deterministically with a controllable clock; `a` mashes every tick, `b` never does.
function playSession(room: Room): ServerMsg[] {
  let t = 0
  const clock: Clock = { now: () => t }
  const captured: ServerMsg[] = []
  const publisher: Publisher = { toRoom: (_code, msg) => captured.push(msg) }
  const engine = new SessionEngine(room, publisher, clock, noRandom, CONFIG)

  engine.start()
  for (let i = 0; i < 400 && !engine.isFinished; i++) {
    t += 1000 / CONFIG.tickHz
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

  test('plays a multi-game sequence in order and finishes', () => {
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

    const intros = captured.filter((m) => m.type === 'ROUND_INTRO')
    expect(intros.length).toBe(2)
    expect(intros[0]?.type === 'ROUND_INTRO' && intros[0].minigameId).toBe('button-masher')
    expect(intros[1]?.type === 'ROUND_INTRO' && intros[1].minigameId).toBe('reaction-duel')
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
