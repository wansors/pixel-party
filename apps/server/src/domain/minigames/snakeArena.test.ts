import { describe, expect, test } from 'bun:test'
import { SNAKE, type SnakeSim, snakeCell, snakeStep } from '@pp/shared'
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
const GRID = 15
const at = (x: number, y: number): number => y * GRID + x
const head = (s: ReturnType<typeof init>, id = 'p') => snakeCell(nn(nn(s.snakes.get(id)).body[0]))

// Sets the snake off to the right on step 1 (the first direction starts it).
const go = (game: SnakeArena, s: ReturnType<typeof init>, id = 'p') =>
  game.onInput(s, id, { kind: 'turn', dir: 'right' }, 0)

describe('SnakeArena', () => {
  test('builds a seeded food sequence (deterministic from the Random port)', () => {
    const a = init(['p'])
    const b = init(['p'])
    expect(a.foods.length).toBeGreaterThan(0)
    expect(a.foods).toEqual(b.foods)
    expect(nn(a.foods[0])).toBe(0)
  })

  test('a snake holds still until its player picks a direction', () => {
    const game = new SnakeArena()
    let s = init(['p'])
    const head0 = head(s)
    s = game.tick(s, 0, STEP_MS * 5)
    expect(s.stepsTaken).toBe(5)
    expect(head(s)).toEqual(head0)
    expect(nn(s.snakes.get('p')).waiting).toBe(true)
    s = game.onInput(s, 'p', { kind: 'turn', dir: 'up' }, STEP_MS * 5 + 10)
    s = game.tick(s, 0, STEP_MS * 6)
    expect(head(s)).toEqual({ x: head0.x, y: head0.y - 1 })
    expect(nn(s.snakes.get('p')).waiting).toBe(false)
  })

  test('a first direction straight back reverses the (still straight) snake instead of killing it', () => {
    const game = new SnakeArena()
    let s = init(['p'])
    const tail0 = snakeCell(nn(nn(s.snakes.get('p')).body.at(-1)))
    s = game.onInput(s, 'p', { kind: 'turn', dir: 'left' }, 0)
    s = game.tick(s, 0, STEP_MS)
    const snake = nn(s.snakes.get('p'))
    expect(snake.alive).toBe(true)
    expect(snake.dir).toBe('left')
    expect(head(s)).toEqual({ x: tail0.x - 1, y: tail0.y })
  })

  test('an idle snake sets off on its own after the start grace', () => {
    const game = new SnakeArena()
    let s = init(['p'])
    const head0 = head(s)
    const autoStep = Math.ceil(SNAKE.autoStartMs / STEP_MS)
    s = game.tick(s, 0, STEP_MS * (autoStep - 1))
    expect(head(s)).toEqual(head0)
    s = game.tick(s, 0, STEP_MS * autoStep)
    expect(head(s)).toEqual({ x: head0.x + 1, y: head0.y })
    // ...and nobody hits a wall before the grace is over, however idle.
    expect(nn(s.snakes.get('p')).alive).toBe(true)
  })

  test('advances a moving snake one cell per STEP_MS via tick(now)', () => {
    const game = new SnakeArena()
    let s = go(game, init(['p']))
    const head0 = head(s)
    s = game.tick(s, 0, STEP_MS)
    expect(s.stepsTaken).toBe(1)
    expect(head(s)).toEqual({ x: head0.x + 1, y: head0.y })
    s = game.tick(s, 0, STEP_MS * 3)
    expect(s.stepsTaken).toBe(3)
    expect(head(s)).toEqual({ x: head0.x + 3, y: head0.y })
  })

  test('turning updates direction but a direct reversal is ignored', () => {
    const game = new SnakeArena()
    let s = go(game, init(['p']))
    s = game.tick(s, 0, STEP_MS)
    s = game.onInput(s, 'p', { kind: 'turn', dir: 'left' }, STEP_MS)
    expect(nn(s.snakes.get('p')).turns).toEqual([])
    s = game.onInput(s, 'p', { kind: 'turn', dir: 'down' }, STEP_MS)
    expect(nn(s.snakes.get('p')).turns).toEqual([{ dir: 'down', at: 2 }])
    s = game.tick(s, 0, STEP_MS * 2)
    expect(nn(s.snakes.get('p')).dir).toBe('down')
  })

  test('two quick turns inside one step both apply, one per step (a U-turn)', () => {
    const game = new SnakeArena()
    let s = go(game, init(['p']))
    s = game.tick(s, 0, STEP_MS)
    const head0 = head(s)
    s = game.onInput(s, 'p', { kind: 'turn', dir: 'up' }, STEP_MS + 10)
    s = game.onInput(s, 'p', { kind: 'turn', dir: 'left' }, STEP_MS + 20)
    s = game.tick(s, 0, STEP_MS * 2)
    expect(head(s)).toEqual({ x: head0.x, y: head0.y - 1 })
    s = game.tick(s, 0, STEP_MS * 3)
    const snake = nn(s.snakes.get('p'))
    expect(snake.dir).toBe('left')
    expect(head(s)).toEqual({ x: head0.x - 1, y: head0.y - 1 })
    expect(snake.alive).toBe(true)
  })

  test('the turn queue judges reversals against the queued heading and holds two turns', () => {
    const game = new SnakeArena()
    let s = go(game, init(['p']))
    s = game.tick(s, 0, STEP_MS)
    s = game.onInput(s, 'p', { kind: 'turn', dir: 'up' }, STEP_MS)
    s = game.onInput(s, 'p', { kind: 'turn', dir: 'down' }, STEP_MS)
    s = game.onInput(s, 'p', { kind: 'turn', dir: 'right' }, STEP_MS)
    s = game.onInput(s, 'p', { kind: 'turn', dir: 'down' }, STEP_MS)
    expect(nn(s.snakes.get('p')).turns.map((t) => t.dir)).toEqual(['up', 'right'])
  })

  test('a turn booked for a later step waits for it; a late one turns on the next step', () => {
    const game = new SnakeArena()
    let s = go(game, init(['p']))
    s = game.tick(s, 0, STEP_MS * 2)
    const head0 = head(s)
    // The client saw step 3 already and wants the turn on step 4: the server holds it one step.
    s = game.onInput(s, 'p', { kind: 'turn', dir: 'down', at: 4 }, STEP_MS * 2 + 30)
    s = game.tick(s, 0, STEP_MS * 3)
    expect(head(s)).toEqual({ x: head0.x + 1, y: head0.y })
    s = game.tick(s, 0, STEP_MS * 4)
    expect(head(s)).toEqual({ x: head0.x + 1, y: head0.y + 1 })
    // Asking for a step already taken turns on the next one; asking far ahead is capped.
    s = game.onInput(s, 'p', { kind: 'turn', dir: 'right', at: 1 }, STEP_MS * 4)
    expect(nn(s.snakes.get('p')).turns).toEqual([{ dir: 'right', at: 5 }])
    s = game.onInput(s, 'p', { kind: 'turn', dir: 'up', at: 99 }, STEP_MS * 4)
    expect(nn(s.snakes.get('p')).turns.at(-1)?.at).toBe(4 + 1 + SNAKE.turnQueue)
  })

  test('inputs are acknowledged by sequence number, even a refused turn', () => {
    const game = new SnakeArena()
    let s = go(game, init(['p']))
    s = game.tick(s, 0, STEP_MS)
    s = game.onInput(s, 'p', { kind: 'turn', dir: 'left', seq: 4 }, STEP_MS)
    expect(game.snapshot(s, STEP_MS).snakes.p?.ack).toBe(4)
  })

  test('an unknown direction is ignored', () => {
    const game = new SnakeArena()
    let s = init(['p'])
    s = game.onInput(s, 'p', { kind: 'turn', dir: 'toString' as 'up' }, 0)
    expect(nn(s.snakes.get('p')).turns).toEqual([])
  })

  test('running into a wall kills the snake and its length stops growing', () => {
    const game = new SnakeArena()
    // No food anywhere near the wall path: RNG=0.99 → all candidates at the far corner.
    const far: Random = { next: () => 0.99 }
    let s = init(['p'], far)
    s = game.onInput(s, 'p', { kind: 'turn', dir: 'up' }, 0)
    s = game.tick(s, 0, STEP_MS * 30)
    const snake = nn(s.snakes.get('p'))
    expect(snake.alive).toBe(false)
    const lenDead = snake.len
    s = game.tick(s, 0, STEP_MS * 40)
    expect(nn(s.snakes.get('p')).len).toBe(lenDead)
    expect(nn(s.snakes.get('p')).alive).toBe(false)
  })

  test('a player who leaves is out, so the all-crashed early end does not wait for them', () => {
    const game = new SnakeArena()
    let s = init(['a', 'b'])
    nn(s.snakes.get('a')).alive = false
    expect(game.isFinished(s, 1000)).toBe(false)
    s = game.leave(s, 'b', 1000)
    expect(game.isFinished(s, 1000)).toBe(true)
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

  test('equal lengths: whoever reached that length first ranks higher', () => {
    const game = new SnakeArena()
    const s = init(['late', 'early', 'tie'])
    for (const [id, lenAt] of [
      ['late', 90],
      ['early', 40],
      ['tie', 40],
    ] as const) {
      const snake = nn(s.snakes.get(id))
      snake.len = 6
      snake.lenAt = lenAt
    }
    const result = game.getResult(s)
    expect(result.placements[2]).toBe('late')
    expect(result.ranks).toEqual({ early: 0, tie: 0, late: 2 })
  })

  test('eating records the step the snake reached its new length', () => {
    const game = new SnakeArena()
    let s = go(game, init(['p']))
    // Every food candidate right in front of the head (it starts at (7,7) heading right).
    s.foods.fill(at(8, 7))
    s = game.tick(s, 0, STEP_MS * 2)
    const snake = nn(s.snakes.get('p'))
    expect(snake.len).toBe(4)
    expect(snake.lenAt).toBe(1)
  })

  test('snapshot carries what the client needs to step its own snake', () => {
    const game = new SnakeArena()
    let s = go(game, init(['p']))
    s = game.tick(s, 0, STEP_MS + 40)
    const snap = game.snapshot(s, STEP_MS + 40)
    expect(snap.grid).toBe(15)
    expect(snap.step).toBe(1)
    expect(snap.stepMs).toBe(STEP_MS)
    expect(snap.t).toBe(STEP_MS + 40)
    expect(snap.snakes.p?.body).toEqual([at(8, 7), at(7, 7), at(6, 7)])
    expect(snap.snakes.p?.waiting).toBe(false)
    expect(snap.progress.p).toBe(3)
    expect(snap.food.p).toBe(0)
    expect(snap.remainingMs).toBe(45_000 - STEP_MS - 40)
  })
})

describe('snakeStep (shared with the client prediction)', () => {
  const sim = (body: number[], dir: SnakeSim['dir'] = 'right'): SnakeSim => ({
    body,
    dir,
    turns: [],
    alive: true,
    waiting: false,
  })

  test('moves, eats and crashes the same way on both sides', () => {
    const s = sim([at(3, 3), at(2, 3), at(1, 3)])
    expect(snakeStep(s, 1, null)).toBe('moved')
    expect(s.body).toEqual([at(4, 3), at(3, 3), at(2, 3)])
    expect(snakeStep(s, 2, at(5, 3))).toBe('ate')
    expect(s.body.length).toBe(4)
    const wall = sim([at(14, 0), at(13, 0)])
    expect(snakeStep(wall, 1, null)).toBe('crashed')
    expect(wall.alive).toBe(false)
    expect(snakeStep(wall, 2, null)).toBe('idle')
  })

  test('a turn applies on its step, not before', () => {
    const s = sim([at(3, 3), at(2, 3)])
    s.turns.push({ dir: 'down', at: 2 })
    snakeStep(s, 1, null)
    expect(s.body[0]).toBe(at(4, 3))
    snakeStep(s, 2, null)
    expect(s.body[0]).toBe(at(4, 4))
  })
})
