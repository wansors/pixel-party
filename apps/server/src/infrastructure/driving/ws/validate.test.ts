import { describe, expect, test } from 'bun:test'
import { isValidClientMsg } from './validate'

describe('isValidClientMsg', () => {
  test('accepts a well-formed JOIN', () => {
    expect(isValidClientMsg({ type: 'JOIN', name: 'Ada', color: '#f00', avatar: 'cat' })).toBe(true)
  })

  test('rejects a KNOWN type with a bad shape', () => {
    expect(isValidClientMsg({ type: 'SET_READY', ready: 'yes' })).toBe(false)
    expect(isValidClientMsg({ type: 'JOIN', name: 'Ada' })).toBe(false)
    expect(isValidClientMsg({ type: 'HOST_CONFIG', minigameIds: [1], rounds: 3 })).toBe(false)
  })

  test('defers an unknown discriminant to the caller (returns true)', () => {
    expect(isValidClientMsg({ type: 'FUTURE_INTENT' })).toBe(true)
  })

  test('rejects non-objects', () => {
    expect(isValidClientMsg(null)).toBe(false)
    expect(isValidClientMsg('JOIN')).toBe(false)
  })
})
