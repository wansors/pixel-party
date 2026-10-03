import { hashSeed, linesOf, pickLine } from './quips'

describe('quips', () => {
  const pool = ['a', 'b', 'c', 'd', 'e']

  it('picks the same line for the same seed, on every call', () => {
    expect(pickLine(pool, 'round-3:p1')).toBe(pickLine(pool, 'round-3:p1'))
    expect(hashSeed('x')).toBe(hashSeed('x'))
  })

  it('spreads different seeds over the pool', () => {
    const picked = new Set(Array.from({ length: 40 }, (_, i) => pickLine(pool, `seed-${i}`)))
    expect(picked.size).toBeGreaterThan(3)
  })

  it('reads arrays, single strings and junk safely', () => {
    expect(linesOf(['x', 2, 'y'])).toEqual(['x', 'y'])
    expect(linesOf('solo')).toEqual(['solo'])
    expect(linesOf(undefined)).toEqual([])
    expect(pickLine([], 'any')).toBe('')
  })
})
