import { describe, expect, test } from 'bun:test'
import type { Random } from '../ports/Random'
import { SnakeArena } from './snakeArena'

// Deterministic RNG: next()=0 → every food candidate is cell (0,0).
const zero: Random = { next: () => 0 }
const nn = <T>(x: T | undefined): T => {
  if (x === undefined) throw new Error('unexpected nullish')
  return x
}
const init = (players: string[], random: Random = zero, now = 0) =>
  new SnakeArena().init({ players, seed: 1, random, now, config: { durationMs: 45_000 } })

const STEP_MS = 160

describe('SnakeArena', () => {
  test('builds a seeded food sequence (deterministic from the Random port)', () => {
    const a = init(['p'])
    const b = init(['p'])
    expect(a.foods.length).toBeGreaterThan(0)
    expect(a.foods).toEqual(b.foods)
    expect(nn(a.foods[0])).toEqual({ x: 0, y: 0 })
  })

  test('advances a snake one cell per STEP_MS via tick(now)', () => {
    const game = new SnakeArena()
    let s = init(['p'])
    const head0 = nn(nn(s.snakes.get('p')).body[0])
    s = game.tick(s, 0, STEP_MS)
    expect(s.stepsTaken).toBe(1)
    const head1 = nn(nn(s.snakes.get('p')).body[0])
    // Default heading is right → head moves +1 in x.
    expect(head1).toEqual({ x: head0.x + 1, y: head0.y })
    s = game.tick(s, 0, STEP_MS * 3)
    expect(s.stepsTaken).toBe(3)
  })

  test('turning updates direction but a direct reversal is ignored', () => {
    const game = new SnakeArena()
    let s = init(['p'])
    // Heading right → reversing to left is ignored.
    s = game.onInput(s, 'p', { kind: 'turn', dir: 'left' }, 0)
    expect(nn(s.snakes.get('p')).pendingDir).toBe('right')
    // A perpendicular turn is accepted.
    s = game.onInput(s, 'p', { kind: 'turn', dir: 'down' }, 0)
    expect(nn(s.snakes.get('p')).pendingDir).toBe('down')
    s = game.tick(s, 0, STEP_MS)
    expect(nn(s.snakes.get('p')).dir).toBe('down')
  })

  test('running into a wall kills the snake and its length stops growing', () => {
    const game = new SnakeArena()
    // No food anywhere near the wall path: RNG=0.99 → all candidates at the far corner.
    const far: Random = { next: () => 0.99 }
    let s = init(['p'], far)
    s = game.onInput(s, 'p', { kind: 'turn', dir: 'up' }, 0)
    // Grid is 15, head starts near the middle (y=7) → run up long enough to hit the top wall.
    s = game.tick(s, 0, STEP_MS * 30)
    const snake = nn(s.snakes.get('p'))
    expect(snake.alive).toBe(false)
    const lenDead = snake.len
    s = game.tick(s, 0, STEP_MS * 40)
    expect(nn(s.snakes.get('p')).len).toBe(lenDead)
    expect(nn(s.snakes.get('p')).alive).toBe(false)
  })

  test('getResult ranks the longer snake first', () => {
    const game = new SnakeArena()
    const s = init(['a', 'b'])
    nn(s.snakes.get('a')).len = 7
    nn(s.snakes.get('b')).len = 4
    const result = game.getResult(s)
    expect(result.placements[0]).toBe('a')
    expect(result.ranks?.a).toBe(0)
    expect(result.ranks?.b).toBe(1)
    expect(result.stats?.a).toBe('7 long')
  })

  test('snapshot exposes the grid plus this player`s snake and food', () => {
    const game = new SnakeArena()
    const s = init(['p'])
    const snap = game.snapshot(s, 0)
    expect(snap.grid).toBe(15)
    expect(snap.snakes.p?.len).toBe(3)
    expect(snap.snakes.p?.body.length).toBe(3)
    expect(snap.food.p).toBeDefined()
    expect(snap.remainingMs).toBe(45_000)
  })
})
