import { describe, expect, test } from 'bun:test'
import {
  BRICK,
  BRICK_MULTI,
  BRICK_WIDE,
  type BrickBody,
  type BrickWall,
  brickLeft,
  brickNewBody,
  brickRun,
  brickSpeed,
  brickStep,
} from '@pp/shared'
import { SeededRandom } from '../../infrastructure/driven/random/SeededRandom'
import { BrickBuster, type BrickBusterState, buildWall } from './brickBuster'

const game = new BrickBuster()
const init = (players: string[], seed = 4): BrickBusterState =>
  game.init({
    players,
    seed,
    random: new SeededRandom(seed),
    now: 0,
    config: { durationMs: 60_000 },
  })
const nn = <T>(x: T | undefined): T => {
  if (x === undefined) throw new Error('unexpected nullish')
  return x
}
const GO = BRICK.startDelayMs
const N = BRICK.rows * BRICK.cols
const EMPTY = '0'.repeat(N)
// A wall with the given bricks set (index → '1' / '2') and capsules.
const wall = (set: Record<number, string>, caps: Record<number, number> = {}): BrickWall => ({
  bricks: Array.from({ length: N }, (_, i) => set[i] ?? '0').join(''),
  caps,
})
// A ball in flight at (x, y) heading (nx, ny), on a board playing `walls`.
function flying(walls: BrickWall[], x: number, y: number, nx: number, ny: number): BrickBody {
  const b = brickNewBody(nn(walls[0]), GO)
  b.serveAt = 0
  b.balls = [{ x, y, nx, ny }]
  return b
}
const brickCenter = (i: number) => ({
  x: ((i % BRICK.cols) + 0.5) / BRICK.cols,
  y: BRICK.top + (Math.floor(i / BRICK.cols) + 0.5) * BRICK.brickH,
})

describe('Brick Buster rules (shared)', () => {
  test('the ball speeds up over the round (D40) and with each wall', () => {
    expect(brickSpeed(GO, 0)).toBeCloseTo(0.7, 9)
    const early = brickSpeed(GO + 20_000, 0) - brickSpeed(GO + 10_000, 0)
    const late = brickSpeed(GO + 50_000, 0) - brickSpeed(GO + 40_000, 0)
    expect(late).toBeGreaterThan(early * 2)
    expect(brickSpeed(GO + 90_000, 0)).toBeCloseTo(1.3, 9)
    expect(brickSpeed(GO, 2)).toBeGreaterThan(brickSpeed(GO, 1))
  })

  test('a served ball rides the paddle, then launches upward', () => {
    const walls = [wall({ 0: '1' })]
    const b = brickNewBody(nn(walls[0]), GO)
    brickRun(b, GO + 300, [{ at: GO, x: 0.2 }], walls)
    expect(b.serveAt).toBeGreaterThan(0)
    expect(nn(b.balls[0]).x).toBe(b.px)
    expect(b.px).toBeLessThan(0.5)
    brickRun(b, b.serveAt + 2 * BRICK.dtMs, [], walls)
    expect(b.serveAt).toBe(0)
    expect(nn(b.balls[0]).ny).toBeLessThan(0)
    // Launched away from the nearer side wall.
    expect(nn(b.balls[0]).nx).toBeGreaterThan(0)
  })

  test('the paddle chases its aim at a capped speed and stays on the board', () => {
    const walls = [wall({ 0: '1' })]
    const b = brickNewBody(nn(walls[0]), GO)
    brickStep(b, 1, walls)
    expect(b.px).toBeCloseTo(0.5 + (BRICK.paddleSpeed * BRICK.dtMs) / 1000, 9)
    brickRun(b, GO + 1000, [], walls)
    expect(b.px).toBeCloseTo(1 - BRICK.paddleW / 2, 9)
  })

  test('side walls and the ceiling bounce the ball', () => {
    const walls = [wall({ 0: '1' })]
    const b = flying(walls, 0.02, 0.8, -0.6, -0.8)
    brickRun(b, GO + 50, [], walls)
    expect(nn(b.balls[0]).nx).toBeGreaterThan(0)
    const c = flying(walls, 0.95, 0.02, 0, -1)
    brickRun(c, GO + 50, [], walls)
    expect(nn(c.balls[0]).ny).toBeGreaterThan(0)
  })

  test('the paddle returns the ball, wider the further out it lands', () => {
    const walls = [wall({ 0: '1' })]
    const y = BRICK.paddleY - BRICK.ballR - 0.005
    const centre = flying(walls, 0.5, y, 0, 1)
    brickRun(centre, GO + 60, [], walls)
    const edge = flying(walls, 0.58, y, 0, 1)
    brickRun(edge, GO + 60, [], walls)
    expect(centre.returns).toBe(1)
    expect(edge.returns).toBe(1)
    expect(nn(centre.balls[0]).ny).toBeLessThan(0)
    expect(Math.abs(nn(centre.balls[0]).nx)).toBeLessThan(0.01)
    expect(nn(edge.balls[0]).nx).toBeGreaterThan(0.4)
  })

  test('bricks score a point a hit; hard ones take two; a capsule drops on the last', () => {
    const walls = [wall({ 15: '1', 16: '2', 0: '1' }, { 15: BRICK_WIDE })]
    const a = brickCenter(15)
    const b = flying(walls, a.x, a.y + 0.08, 0, -1)
    brickRun(b, GO + 200, [], walls)
    expect(b.bricks[15]).toBe('0')
    expect(b.score).toBe(1)
    expect(b.caps).toHaveLength(1)
    expect(nn(b.balls[0]).ny).toBeGreaterThan(0)
    const h = brickCenter(16)
    const c = flying(walls, h.x, h.y + 0.08, 0, -1)
    brickRun(c, GO + 200, [], walls)
    expect(c.bricks[16]).toBe('1')
    expect(c.caps).toHaveLength(0)
  })

  test('a WIDE capsule widens the paddle; a MULTI one splits the ball in three', () => {
    const walls = [wall({ 0: '1' })]
    const b = flying(walls, 0.1, 0.3, 0, -1)
    b.caps = [{ x: 0.5, y: BRICK.paddleY - 0.03, kind: BRICK_WIDE }]
    brickRun(b, GO + 200, [], walls)
    expect(b.caught).toBe(1)
    expect(b.wideUntil).toBeGreaterThan(b.t)
    const m = flying(walls, 0.1, 0.3, 0.6, -0.8)
    m.caps = [{ x: 0.5, y: BRICK.paddleY - 0.03, kind: BRICK_MULTI }]
    brickRun(m, GO + 200, [], walls)
    expect(m.balls).toHaveLength(3)
  })

  test('losing the last ball costs a drop and time: a new one waits on the paddle', () => {
    const walls = [wall({ 0: '1' })]
    const b = flying(walls, 0.05, BRICK.h - 0.02, 0, 1)
    brickRun(b, GO + 100, [], walls)
    expect(b.drops).toBe(1)
    expect(b.balls).toHaveLength(1)
    expect(b.serveAt).toBeGreaterThanOrEqual(b.t + BRICK.dropMs)
    expect(b.score).toBe(0)
  })

  test('clearing a wall scores the bonus and brings the next one', () => {
    const walls = [wall({ 15: '1' }), wall({ 3: '2', 4: '2' })]
    const a = brickCenter(15)
    const b = flying(walls, a.x, a.y + 0.08, 0, -1)
    brickRun(b, GO + 200, [], walls)
    expect(b.wall).toBe(1)
    expect(b.score).toBe(1 + BRICK.clearBonus)
    expect(b.bricks).toBe(nn(walls[1]).bricks)
    expect(b.serveAt).toBeGreaterThan(0)
  })
})

describe('BrickBuster', () => {
  test('seeded walls: identical per seed, mirror-symmetric, never thin, with capsules', () => {
    const a = init(['a'], 11)
    expect(init(['a'], 11).walls).toEqual(a.walls)
    for (const [k, w] of a.walls.entries()) {
      expect(brickLeft(w.bricks)).toBeGreaterThanOrEqual(16)
      for (let row = 0; row < BRICK.rows; row++) {
        const line = w.bricks.slice(row * BRICK.cols, (row + 1) * BRICK.cols)
        expect(line).toBe([...line].reverse().join(''))
      }
      expect(Object.keys(w.caps).length).toBeGreaterThanOrEqual(4)
      for (const i of Object.keys(w.caps)) expect(w.bricks[Number(i)]).not.toBe('0')
      if (k > 0) expect(w.bricks).not.toBe(EMPTY)
    }
    const r = new SeededRandom(3)
    expect(brickLeft(buildWall(6, r).bricks)).toBeGreaterThan(brickLeft(buildWall(0, r).bricks))
  })

  test('aims before GO are ignored; after it they count when set, clamped to now', () => {
    const s = init(['a'])
    const board = nn(s.boards.get('a'))
    game.onInput(s, 'a', { kind: 'aim', x: 0.2, seq: 1 }, 800)
    expect(board.aims).toEqual([])
    expect(board.ack).toBe(1)
    game.onInput(s, 'a', { kind: 'aim', x: 0.3, at: GO + 40 }, GO + 60)
    game.onInput(s, 'a', { kind: 'aim', x: 7, at: GO + 99_000 }, GO + 200)
    expect(board.aims).toEqual([
      { at: GO + 40, x: 0.3 },
      { at: GO + 200, x: 1 },
    ])
  })

  test('aims too close together and junk are dropped', () => {
    const s = init(['a'])
    const board = nn(s.boards.get('a'))
    game.onInput(s, 'a', { kind: 'aim', x: 0.3, at: GO + 100 }, GO + 100)
    game.onInput(s, 'a', { kind: 'aim', x: 0.4, at: GO + 110 }, GO + 110)
    game.onInput(s, 'a', { kind: 'aim', x: Number.NaN }, GO + 300)
    game.onInput(s, 'a', { kind: 'aim', x: '0.5' as unknown as number }, GO + 300)
    expect(board.aims).toHaveLength(1)
  })

  test('the server plays every board on its aims, behind real time', () => {
    const s = init(['a', 'b'])
    game.onInput(s, 'a', { kind: 'aim', x: 0.1, at: GO + 10 }, GO + 20)
    game.tick(s, 0, GO + 1000)
    const a = nn(s.boards.get('a'))
    const b = nn(s.boards.get('b'))
    expect(a.body.t).toBe(GO + 1000 - BRICK.judgeMs)
    expect(a.body.px).toBeLessThan(0.2)
    expect(b.body.px).toBe(0.5)
    expect(a.aims).toEqual([])
  })

  test('the round runs to the bell; score ranks, fewer lost balls break ties', () => {
    const s = init(['a', 'b', 'c'])
    const set = (id: string, score: number, drops: number) =>
      Object.assign(nn(s.boards.get(id)).body, { score, drops })
    set('a', 30, 4)
    set('b', 41, 9)
    set('c', 30, 2)
    expect(game.isFinished(s, 59_000)).toBe(false)
    expect(game.isFinished(s, 60_000)).toBe(true)
    const res = game.getResult(s)
    expect(res.placements).toEqual(['b', 'c', 'a'])
    expect(res.stats).toEqual({ a: '30 pts', b: '41 pts', c: '30 pts' })
  })

  test('the snapshot carries the walls, every board with its pending aims, and the clock', () => {
    const s = init(['a'])
    game.onInput(s, 'a', { kind: 'aim', x: 0.6, at: GO + 50, seq: 2 }, GO + 60)
    const snap = game.snapshot(s, GO + 60)
    expect(snap.walls).toHaveLength(8)
    expect(snap.t).toBe(GO + 60)
    expect(snap.boards.a).toMatchObject({ ack: 2, aims: [{ at: GO + 50, x: 0.6 }] })
    // A copy: running it forward doesn't touch the server's board.
    const view = nn(snap.boards.a)
    brickRun(view.body, GO + 3000, view.aims, snap.walls)
    expect(nn(s.boards.get('a')).body.t).toBe(GO)
  })
})
