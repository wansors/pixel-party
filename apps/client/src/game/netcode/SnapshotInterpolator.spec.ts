import { SnapshotInterpolator, lerp } from './SnapshotInterpolator'

describe('SnapshotInterpolator', () => {
  it('returns undefined before any snapshot', () => {
    expect(new SnapshotInterpolator<number>().sample(0)).toBeUndefined()
  })

  it('returns the single snapshot with t=1 until two exist', () => {
    const interp = new SnapshotInterpolator<{ x: number }>(100)
    interp.push({ x: 5 }, 1000)
    const s = interp.sample(1000)
    expect(s).toEqual({ from: { x: 5 }, to: { x: 5 }, t: 1 })
  })

  it('interpolates ~renderDelayMs behind the latest snapshot', () => {
    const interp = new SnapshotInterpolator<{ x: number }>(100)
    interp.push({ x: 0 }, 1000) // prev
    interp.push({ x: 100 }, 1150) // curr, 150ms span
    // now=1200 → renderTime=1100 → 100ms into a 150ms span → t≈0.667
    const s = interp.sample(1200)
    if (!s) throw new Error('no sample')
    expect(s.t).toBeCloseTo(100 / 150)
    expect(lerp(s.from.x, s.to.x, s.t)).toBeCloseTo(66.67, 1)
  })

  it('clamps t to [0,1] outside the snapshot span', () => {
    const interp = new SnapshotInterpolator<{ x: number }>(0)
    interp.push({ x: 0 }, 1000)
    interp.push({ x: 10 }, 1100)
    expect(interp.sample(900)?.t).toBe(0) // before prev
    expect(interp.sample(5000)?.t).toBe(1) // well past curr
  })

  it('latest() exposes the freshest snapshot for discrete fields', () => {
    const interp = new SnapshotInterpolator<{ score: number }>()
    interp.push({ score: 1 }, 10)
    interp.push({ score: 2 }, 20)
    expect(interp.latest()).toEqual({ score: 2 })
  })
})
