import { describe, expect, test } from 'bun:test'
import { PROTOCOL_VERSION } from './protocol'

describe('protocol', () => {
  test('PROTOCOL_VERSION is a positive integer', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true)
    expect(PROTOCOL_VERSION).toBeGreaterThan(0)
  })
})
