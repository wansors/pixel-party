import { describe, expect, test } from 'bun:test'
import { AUTO_ROUNDS_CAP, effectiveRounds, MAX_ROUNDS, PROTOCOL_VERSION } from './protocol'

describe('protocol', () => {
  test('PROTOCOL_VERSION is a positive integer', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true)
    expect(PROTOCOL_VERSION).toBeGreaterThan(0)
  })
})

describe('effectiveRounds (D40)', () => {
  test('0 is auto: one per playable game, capped', () => {
    expect(effectiveRounds(0, 5)).toBe(5)
    expect(effectiveRounds(0, 55)).toBe(AUTO_ROUNDS_CAP)
    expect(effectiveRounds(-2, 3)).toBe(3)
  })
  test('an explicit count may exceed the line-up, up to MAX_ROUNDS', () => {
    expect(effectiveRounds(30, 5)).toBe(30)
    expect(effectiveRounds(500, 5)).toBe(MAX_ROUNDS)
    expect(effectiveRounds(7.9, 5)).toBe(7)
  })
  test('nothing playable plays nothing', () => {
    expect(effectiveRounds(0, 0)).toBe(0)
    expect(effectiveRounds(10, 0)).toBe(0)
  })
})
