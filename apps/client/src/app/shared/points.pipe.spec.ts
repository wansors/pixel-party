import { formatPoints } from './points.pipe'

describe('formatPoints', () => {
  it('keeps whole numbers whole and rounds fractions to one decimal', () => {
    expect(formatPoints(10)).toBe('10')
    expect(formatPoints(16 / 3)).toBe('5.3')
    expect(formatPoints(8.5)).toBe('8.5')
    expect(formatPoints(7.96)).toBe('8')
    expect(formatPoints(0)).toBe('0')
  })
})
