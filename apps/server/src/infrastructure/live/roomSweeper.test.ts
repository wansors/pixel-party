import { describe, expect, test } from 'bun:test'
import type { LiveRoomRegistry } from '../../application/ports/LiveRoomRegistry'
import type { SessionManager } from '../../application/session/SessionManager'
import { Room } from '../../domain/entities/Room'
import { reapIdleRooms } from './roomSweeper'

// Minimal registry backed by a Map; only the methods the sweeper touches are implemented.
function fakeRegistry(rooms: Room[]): LiveRoomRegistry {
  const map = new Map(rooms.map((r) => [r.code, r]))
  return {
    create: () => Room.create('X', 10),
    get: (code) => map.get(code),
    remove: (code) => void map.delete(code),
    list: () => [...map.values()],
  }
}

function fakeManager(running: Set<string>): SessionManager {
  return {
    isRunning: (code: string) => running.has(code),
    stop: (code: string) => void running.delete(code),
  } as unknown as SessionManager
}

function room(code: string, lastActivityAt: number): Room {
  const r = Room.create(code, 10)
  r.touch(lastActivityAt)
  return r
}

const IDLE_MS = 1000

describe('reapIdleRooms', () => {
  test('reaps rooms idle for longer than idleMs', () => {
    // now=2000, idleMs=1000 -> survive iff lastActivity >= 1000.
    const stale = room('STALE', 500)
    const fresh = room('FRESH', 1500)
    const rooms = fakeRegistry([stale, fresh])
    const reaped = reapIdleRooms({
      rooms,
      manager: fakeManager(new Set()),
      now: 2000,
      idleMs: IDLE_MS,
    })
    expect(reaped).toEqual(['STALE'])
    expect(rooms.get('STALE')).toBeUndefined()
    expect(rooms.get('FRESH')).toBeDefined()
  })

  test('never reaps a room with a running session', () => {
    const busy = room('BUSY', 0)
    const rooms = fakeRegistry([busy])
    const reaped = reapIdleRooms({
      rooms,
      manager: fakeManager(new Set(['BUSY'])),
      now: 999_999,
      idleMs: IDLE_MS,
    })
    expect(reaped).toEqual([])
    expect(rooms.get('BUSY')).toBeDefined()
  })

  test('notifies onReap for each reaped room', () => {
    const rooms = fakeRegistry([room('GONE', 0)])
    const notified: string[] = []
    reapIdleRooms({
      rooms,
      manager: fakeManager(new Set()),
      now: 5000,
      idleMs: IDLE_MS,
      onReap: (code) => notified.push(code),
    })
    expect(notified).toEqual(['GONE'])
  })
})
