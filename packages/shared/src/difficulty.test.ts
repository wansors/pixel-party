import { describe, expect, test } from 'bun:test'
import { compound, easeIn, rampEase, rampExp } from './difficulty'

describe('difficulty curves', () => {
  test('easeIn accelerates and clamps', () => {
    expect(easeIn(0)).toBe(0)
    expect(easeIn(0.5)).toBe(0.25)
    expect(easeIn(1)).toBe(1)
    expect(easeIn(0.5, 3)).toBe(0.125)
    expect(easeIn(-1)).toBe(0)
    expect(easeIn(2)).toBe(1)
  })

  test('rampEase moves slowly first, fast last, both directions', () => {
    expect(rampEase(100, 50, 0)).toBe(100)
    expect(rampEase(100, 50, 1)).toBe(50)
    const firstHalf = 100 - rampEase(100, 50, 0.5)
    const secondHalf = rampEase(100, 50, 0.5) - 50
    expect(secondHalf).toBeGreaterThan(firstHalf * 2)
    expect(rampEase(1, 3, 0.5)).toBe(1.5)
  })

  test('rampExp is geometric', () => {
    expect(rampExp(1, 4, 0)).toBe(1)
    expect(rampExp(1, 4, 0.5)).toBeCloseTo(2)
    expect(rampExp(1, 4, 1)).toBeCloseTo(4)
    expect(rampExp(1000, 250, 0.5)).toBeCloseTo(500)
  })

  test('compound steps and clamps', () => {
    expect(compound(1000, 0.9, 0)).toBe(1000)
    expect(compound(1000, 0.9, 2)).toBeCloseTo(810)
    expect(compound(1000, 0.5, 10, 300)).toBe(300)
    expect(compound(1, 2, 10, 0, 64)).toBe(64)
    expect(compound(5, 2, -3)).toBe(5)
  })
})
