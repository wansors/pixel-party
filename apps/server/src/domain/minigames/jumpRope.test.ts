import { describe, expect, test } from 'bun:test'
import { JUMP_ROPE } from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import { JumpRope, type JumpRopeState } from './jumpRope'

const game = new JumpRope()
const init = (players: string[]): JumpRopeState =>
  game.init({
    players,
    seed: 1,
    random: new SeededRandom(1),
    now: 0,
    config: { durationMs: 50_000 },
  })
const jumper = (s: JumpRopeState, id: string) => {
  const j = s.jumpers.get(id)
  if (!j) throw new Error(`no jumper ${id}`)
  return j
}
const run = (s: JumpRopeState, from: number, to: number): void => {
  for (let t = from + 50; t <= to; t += 50) game.tick(s, 50, t)
}

describe('JumpRope', () => {
  test('the rope speeds up turn after turn, from a calm first pass', () => {
    const s = init(['a'])
    expect(s.passes[0]).toBe(2200)
    const gaps = s.passes.slice(1).map((t, i) => t - (s.passes[i] as number))
    expect(gaps[0]).toBe(1500)
    for (let i = 1; i < gaps.length; i++) expect(gaps[i] ?? 0).toBeLessThanOrEqual(gaps[i - 1] ?? 0)
    expect(gaps.at(-1)).toBe(620)
  })

  test('in the air as the rope passes: cleared; on the ground: a heart, then out', () => {
    const s = init(['a', 'b', 'c'])
    const first = s.passes[0] as number
    game.onInput(s, 'a', { kind: 'jump' }, first - 200)
    run(s, 0, first)
    expect(jumper(s, 'a').cleared).toBe(1)
    expect(jumper(s, 'b').hearts).toBe(1)
    const second = s.passes[1] as number
    game.onInput(s, 'a', { kind: 'jump' }, second - 100)
    run(s, first, second)
    expect(jumper(s, 'b').alive).toBe(false)
    expect(jumper(s, 'a').cleared).toBe(2)
  })

  test('too early or too late misses the pass; no double jump mid-air', () => {
    const s = init(['a', 'b'])
    const first = s.passes[0] as number
    game.onInput(s, 'a', { kind: 'jump' }, first - JUMP_ROPE.clearTo - 50) // landed before it came
    game.onInput(s, 'b', { kind: 'jump' }, first - 10) // still taking off
    run(s, 0, first)
    expect(jumper(s, 'a').hearts).toBe(1)
    expect(jumper(s, 'b').hearts).toBe(1)
    game.onInput(s, 'a', { kind: 'jump' }, 5000)
    game.onInput(s, 'a', { kind: 'jump' }, 5100) // ignored: still in the air
    expect(jumper(s, 'a').jumpAt).toBe(5000)
  })

  test('the last one standing ends the round; ranked by standing, then passes cleared', () => {
    const s = init(['a', 'b', 'c'])
    Object.assign(jumper(s, 'b'), { alive: false, cleared: 5, outAt: 9000 })
    Object.assign(jumper(s, 'c'), { alive: false, cleared: 2, outAt: 5000 })
    expect(game.isFinished(s, 9000)).toBe(true)
    expect(game.getResult(s).placements).toEqual(['a', 'b', 'c'])
    expect(game.snapshot(s, 0).nextPassMs).toBe(2200)
  })
})
