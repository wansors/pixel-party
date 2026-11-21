import {
  BRICK,
  BRICK_MULTI,
  BRICK_WIDE,
  type BrickAim,
  type BrickBoardView,
  type BrickBody,
  type BrickBusterInput,
  type BrickBusterSnapshot,
  type BrickWall,
  brickClone,
  brickNewBody,
  brickRun,
  brickSnap,
} from '@pp/shared'
import type { Random } from '../ports/Random'
import type { MiniGame, MiniGameInitCtx, NormalizedResult, PlayerId } from './MiniGame'

const DEFAULT_DURATION_MS = 60_000
// More walls than anyone clears in a round (they wrap anyway).
const WALLS = 8

// Wall `k`: a mirror-symmetric pattern, taller, fuller and harder as k grows; a few bricks hold a
// capsule (alternating WIDE / MULTI).
export function buildWall(k: number, random: Random): BrickWall {
  const rows = Math.min(BRICK.rows, 5 + k)
  const fill = Math.min(0.92, 0.78 + 0.03 * k)
  const hard = Math.min(0.5, 0.08 + 0.07 * k)
  const half = BRICK.cols / 2
  const cells: string[] = Array.from({ length: BRICK.rows * BRICK.cols }, () => '0')
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < half; col++) {
      if (random.next() >= fill) continue
      // The top rows go hard first.
      const cell = random.next() < hard * (row < 2 ? 1.6 : 0.7) ? '2' : '1'
      cells[row * BRICK.cols + col] = cell
      cells[row * BRICK.cols + (BRICK.cols - 1 - col)] = cell
    }
  }
  // Never an empty-ish wall: top it up row by row from the bottom of the pattern.
  for (let i = 0; cells.filter((c) => c !== '0').length < 16 && i < cells.length; i++)
    if (cells[i] === '0' && Math.floor(i / BRICK.cols) < rows) cells[i] = '1'
  const filled = cells.flatMap((c, i) => (c === '0' ? [] : [i]))
  const caps: Record<number, number> = {}
  const count = Math.min(filled.length, 4 + (k % 3))
  for (let n = 0; n < count; n++) {
    const pool = filled.filter((i) => caps[i] === undefined)
    const pick = pool[Math.floor(random.next() * pool.length)]
    if (pick !== undefined) caps[pick] = n % 2 === 0 ? BRICK_WIDE : BRICK_MULTI
  }
  return { bricks: cells.join(''), caps }
}

interface Board {
  body: BrickBody
  // Aims not yet integrated (snapped round ms, ascending, all ≥ body.t).
  aims: BrickAim[]
  lastAim: number
  ack: number
  gone: boolean
}

export interface BrickBusterState {
  players: PlayerId[]
  walls: BrickWall[]
  boards: Map<PlayerId, Board>
  startedAt: number
  endsAt: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

// Brick Buster (D49): a real-time FFA brick breaker. Everyone plays their own board against the same
// seeded walls; bricks score a point a hit, a cleared wall scores a bonus and brings the next one, a lost
// ball only costs time. The board rules live in @pp/shared and are integrated on a fixed grid with plain
// arithmetic, so the client predicts its own board bit for bit; paddle aims carry the moment they were
// set and the server judges BRICK.judgeMs behind real time. Highest score wins; fewer lost balls break
// ties.
export class BrickBuster implements MiniGame<BrickBusterState, BrickBusterInput> {
  readonly id = 'brick-buster'
  readonly format = 'ffa' as const

  init(ctx: MiniGameInitCtx): BrickBusterState {
    const durationMs =
      typeof ctx.config?.durationMs === 'number' ? ctx.config.durationMs : DEFAULT_DURATION_MS
    const walls = Array.from({ length: WALLS }, (_, k) => buildWall(k, ctx.random))
    const first = walls[0] as BrickWall
    const boards = new Map<PlayerId, Board>(
      ctx.players.map((id) => [
        id,
        { body: brickNewBody(first), aims: [], lastAim: -Infinity, ack: 0, gone: false },
      ]),
    )
    return {
      players: [...ctx.players],
      walls,
      boards,
      startedAt: ctx.now,
      endsAt: ctx.now + durationMs,
    }
  }

  // Round ms at server time `now` (capped at the bell).
  private roundTime(state: BrickBusterState, now: number): number {
    return Math.min(now, state.endsAt) - state.startedAt
  }

  onInput(
    state: BrickBusterState,
    playerId: PlayerId,
    input: BrickBusterInput,
    now: number,
  ): BrickBusterState {
    if (input?.kind !== 'aim') return state
    const board = state.boards.get(playerId)
    if (!board || board.gone) return state
    if (Number.isInteger(input.seq) && (input.seq as number) > board.ack)
      board.ack = input.seq as number
    if (typeof input.x !== 'number' || !Number.isFinite(input.x)) return state
    const live = this.roundTime(state, now)
    if (live < BRICK.startDelayMs || now >= state.endsAt) return state
    // When it was set: never in the future, never before what's already judged.
    const asked = typeof input.at === 'number' && Number.isFinite(input.at) ? input.at : live
    const at = brickSnap(clamp(asked, Math.max(board.body.t, BRICK.startDelayMs), live))
    if (at - board.lastAim < BRICK.minAimGapMs) return state
    board.aims.push({ at, x: clamp(input.x, 0, 1) })
    board.aims.sort((a, b) => a.at - b.at)
    board.lastAim = Math.max(board.lastAim, at)
    return state
  }

  tick(state: BrickBusterState, _dt: number, now: number): BrickBusterState {
    // Judged BRICK.judgeMs behind real time, except at the bell (nothing more can arrive).
    const live = this.roundTime(state, now)
    const lag = now >= state.endsAt ? 0 : BRICK.judgeMs
    const until = Math.floor((live - lag) / BRICK.dtMs) * BRICK.dtMs
    for (const board of state.boards.values()) {
      if (board.gone || until <= board.body.t) continue
      brickRun(board.body, until, board.aims, state.walls)
      board.aims = board.aims.filter((a) => a.at >= board.body.t)
    }
    return state
  }

  // A player who left stops where they are and keeps their score.
  leave(state: BrickBusterState, playerId: PlayerId, _now: number): BrickBusterState {
    const board = state.boards.get(playerId)
    if (board) {
      board.gone = true
      board.aims = []
    }
    return state
  }

  isFinished(state: BrickBusterState, now: number): boolean {
    if (now >= state.endsAt) return true
    for (const board of state.boards.values()) if (!board.gone) return false
    return true
  }

  private cmp(state: BrickBusterState, a: PlayerId, b: PlayerId): number {
    const ba = state.boards.get(a)?.body
    const bb = state.boards.get(b)?.body
    if (!ba || !bb) return 0
    return bb.score - ba.score || ba.drops - bb.drops
  }

  getResult(state: BrickBusterState): NormalizedResult {
    const sorted = [...state.players].sort((a, b) => this.cmp(state, a, b))
    const ranks: Record<PlayerId, number> = {}
    let rank = 0
    sorted.forEach((id, idx) => {
      if (idx > 0 && this.cmp(state, sorted[idx - 1] as PlayerId, id) !== 0) rank = idx
      ranks[id] = rank
    })
    const stats: Record<PlayerId, string> = {}
    for (const id of state.players) stats[id] = `${state.boards.get(id)?.body.score ?? 0} pts`
    return { placements: sorted, ranks, stats }
  }

  snapshot(state: BrickBusterState, now: number): BrickBusterSnapshot {
    const boards: Record<PlayerId, BrickBoardView> = {}
    const progress: Record<PlayerId, number> = {}
    for (const id of state.players) {
      const board = state.boards.get(id) as Board
      boards[id] = { body: brickClone(board.body), aims: [...board.aims], ack: board.ack }
      progress[id] = board.body.score
    }
    return {
      walls: state.walls,
      boards,
      t: now - state.startedAt,
      progress,
      remainingMs: Math.max(0, state.endsAt - now),
    }
  }
}
