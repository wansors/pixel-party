import { describe, expect, test } from 'bun:test'
import { Player } from './Player'
import { Room } from './Room'

const player = (id: string): Player => Player.create({ id, name: id, color: '#fff', avatar: 'cat' })

function roomWith(...ids: string[]): Room {
  const room = Room.create('TEST', 10)
  for (const id of ids) room.add(player(id))
  return room
}

describe('Room host management', () => {
  test('first joiner becomes host', () => {
    const room = roomWith('a', 'b')
    expect(room.hostId).toBe('a')
    expect(room.isHost('a')).toBe(true)
  })

  test('removing the host reassigns to the next member', () => {
    const room = roomWith('a', 'b')
    room.remove('a')
    expect(room.hostId).toBe('b')
  })

  test('transferHost moves host to a member and no-ops otherwise', () => {
    const room = roomWith('a', 'b')
    expect(room.transferHost('b')).toBe(true)
    expect(room.hostId).toBe('b')
    // Already host / unknown member -> no change.
    expect(room.transferHost('b')).toBe(false)
    expect(room.transferHost('ghost')).toBe(false)
    expect(room.hostId).toBe('b')
  })

  test('reassignHostIfDisconnected hands host to a connected member when the host drops', () => {
    const room = roomWith('a', 'b', 'c')
    room.get('a')?.setConnected(false)
    const next = room.reassignHostIfDisconnected()
    expect(next).toBe('b')
    expect(room.hostId).toBe('b')
  })

  test('reassignHostIfDisconnected is a no-op while the host is connected', () => {
    const room = roomWith('a', 'b')
    expect(room.reassignHostIfDisconnected()).toBeNull()
    expect(room.hostId).toBe('a')
  })

  test('reassignHostIfDisconnected clears host when nobody is connected', () => {
    const room = roomWith('a')
    room.get('a')?.setConnected(false)
    // No connected member to promote: host is cleared (null). In practice the room is torn down first.
    expect(room.reassignHostIfDisconnected()).toBeNull()
    expect(room.hostId).toBeNull()
  })
})

describe('Room activity', () => {
  test('touch records the last activity timestamp', () => {
    const room = roomWith('a')
    room.touch(1234)
    expect(room.lastActivityAt).toBe(1234)
    room.touch(5678)
    expect(room.lastActivityAt).toBe(5678)
  })
})
